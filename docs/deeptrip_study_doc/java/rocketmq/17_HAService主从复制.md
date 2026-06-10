# HAService 主从复制（传统 Master/Slave 协议）

DLedger 之前的方案——HAService 是 RocketMQ 4.x 默认的主从复制实现。理解它有助于理解为什么 DLedger 是更好的演进。

---

## 一、HAService 整体架构

```
Master Broker                            Slave Broker
┌─────────────────┐                     ┌─────────────────┐
│ HAService       │                     │ HAService       │
│                 │                     │                 │
│ AcceptSocket    │◀──── TCP 长连接 ───▶│ HAClient        │
│ Service         │      端口 10912    │                 │
│   │             │                     │   │             │
│   ▼             │                     │   ▼             │
│ HAConnection-1  │                     │ 从 Master       │
│   (per slave)   │                     │ 拉取 CommitLog  │
│                 │                     │                 │
│ GroupTransfer   │                     │ 写本地          │
│ Service         │                     │ MappedFile      │
│                 │                     │                 │
└─────────────────┘                     └─────────────────┘
```

---

## 二、HAConnection（Master 端，每 Slave 一个）

### 2.1 三个内部线程

```
HAConnection（Master 维护的与单个 Slave 的连接）
    │
    ├─ ReadSocketService     ← 读 Slave 发来的 offset 报告
    │
    ├─ WriteSocketService    ← 把 CommitLog 数据推给 Slave
    │
    └─ GroupTransferService  ← 处理 SYNC_MASTER 的等待请求
```

### 2.2 协议格式

```
Master → Slave 推数据：
┌──────────────────────┬──────────────┬─────────────────┐
│ phyOffset (8B)       │ bodySize (4B)│ body (变长)      │
└──────────────────────┴──────────────┴─────────────────┘
  这一批数据起始 offset    数据长度        CommitLog 原始字节

Slave → Master 报告进度：
┌──────────────────────┐
│ slaveAckOffset (8B)  │
└──────────────────────┘
  Slave 已写到哪个 offset
```

### 2.3 WriteSocketService（Master → Slave）

```java
class WriteSocketService extends ServiceThread {
    private long nextTransferFromWhere = -1;  // 下次要发的 offset
    
    @Override
    public void run() {
        while (!isStopped()) {
            // ① 第一次初始化
            if (nextTransferFromWhere == -1) {
                // 从 Master 当前最大 offset 减去最后一个 mappedFile 的开头开始
                long masterOffset = commitLog.getMaxOffset();
                masterOffset = masterOffset - (masterOffset % mappedFileSize);
                nextTransferFromWhere = Math.max(0, masterOffset);
            }
            
            // ② 找到对应的 MappedFile
            SelectMappedBufferResult selectResult = commitLog.getCommitLogData(nextTransferFromWhere);
            if (selectResult == null) {
                waitForRunning(100);  // 没新数据，等 100ms
                continue;
            }
            
            // ③ 构造协议头 + 推送
            int size = selectResult.getSize();
            this.byteBufferHeader.position(0);
            this.byteBufferHeader.limit(12);
            this.byteBufferHeader.putLong(nextTransferFromWhere);  // offset
            this.byteBufferHeader.putInt(size);                     // size
            this.byteBufferHeader.flip();
            
            // ④ 通过 socket 推送（用 transferTo 零拷贝）
            transferData();
            
            // ⑤ 推进 offset
            nextTransferFromWhere += size;
        }
    }
}
```

### 2.4 ReadSocketService（Slave → Master）

```java
class ReadSocketService extends ServiceThread {
    @Override
    public void run() {
        while (!isStopped()) {
            // ① 从 socket 读 Slave 的 ACK
            int readSize = socketChannel.read(byteBufferRead);
            if (readSize > 0) {
                // ② 解析 ACK
                long slaveAckOffset = byteBufferRead.getLong();
                
                // ③ 更新连接维护的 slaveAckOffset
                this.slaveAckOffset = slaveAckOffset;
                
                // ④ 通知 GroupTransferService（SYNC_MASTER 用）
                HAService.this.notifyTransferSome(slaveAckOffset);
            }
        }
    }
}
```

---

## 三、HAClient（Slave 端）

### 3.1 工作流程

```java
class HAClient extends ServiceThread {
    @Override
    public void run() {
        while (!isStopped()) {
            // ① 连接 Master（如果未连接）
            if (this.connectMaster()) {
                
                // ② 定时报告自己的 offset
                if (now - lastWriteTimestamp > heartbeatInterval) {
                    reportSlaveMaxOffset(commitLog.getMaxOffset());
                }
                
                // ③ 读 Master 推送过来的数据
                processReadEvent();
                
                // ④ 写到本地 CommitLog
                dispatchReadRequest();
            }
        }
    }
    
    private void dispatchReadRequest() {
        while (true) {
            // 解析协议头
            int dispatchPosition = byteBufferRead.position();
            int diff = dispatchPosition - readSocketPos;
            if (diff < 12) break;  // 不够一个完整协议头
            
            long masterPhyOffset = byteBufferRead.getLong(0);
            int bodySize = byteBufferRead.getInt(8);
            
            if (diff < 12 + bodySize) break;  // 数据还没到齐
            
            // 写到本地 CommitLog
            byte[] bodyData = new byte[bodySize];
            byteBufferRead.position(12);
            byteBufferRead.get(bodyData);
            
            // ★ 这里直接调 commitLog.appendData 写到本地 MappedFile
            commitLog.appendData(masterPhyOffset, bodyData);
            
            readSocketPos = dispatchPosition;
            
            // 立即报告进度
            reportSlaveMaxOffset(commitLog.getMaxOffset());
        }
    }
}
```

### 3.2 初次同步

```
Slave 启动时：
  本地可能完全空（新 Slave）
  也可能落后 Master 很多（重启后）

  报告 slaveOffset = localMaxOffset
  Master 收到后从 slaveOffset 开始推送
  → 一直推到追上 Master 最新

→ 不需要全量同步快照，因为 CommitLog 本身就是日志
```

---

## 四、SYNC_MASTER 实现

### 4.1 关键流程

```
Producer.send() → Master
        │
        ▼
Master 写 PageCache（或 force 到磁盘）
        │
        ▼
提交 GroupCommitRequest
  expectedOffset = 当前消息的 nextOffset
        │
        ▼
GroupTransferService 监听 slaveAckOffset
        │
        │ 等 slaveAckOffset >= expectedOffset
        │ 或 timeout (5 秒)
        ▼
返回 PutMessageStatus.PUT_OK 或 FLUSH_SLAVE_TIMEOUT
```

### 4.2 GroupTransferService 实现

```java
class GroupTransferService extends ServiceThread {
    private List<CommitLog.GroupCommitRequest> requestsWrite = new ArrayList<>();
    private List<CommitLog.GroupCommitRequest> requestsRead = new ArrayList<>();
    
    public void putRequest(GroupCommitRequest req) {
        synchronized (requestsWrite) {
            requestsWrite.add(req);
        }
        wakeup();
    }
    
    public void notifyTransferSome() {
        wakeup();  // Slave 报告新 ACK 时被调用
    }
    
    private void doWaitTransfer() {
        synchronized (requestsRead) {
            if (!requestsRead.isEmpty()) {
                for (GroupCommitRequest req : requestsRead) {
                    // 检查 Slave 是否追上
                    boolean transferOK = HAService.this.push2SlaveMaxOffset.get() 
                                       >= req.getNextOffset();
                    
                    long deadline = req.getDeadLine();
                    while (!transferOK && System.currentTimeMillis() < deadline) {
                        // 等待 1 秒（被 notifyTransferSome 唤醒）
                        this.notifyTransferObject.waitForRunning(1000);
                        transferOK = HAService.this.push2SlaveMaxOffset.get() 
                                   >= req.getNextOffset();
                    }
                    
                    req.wakeupCustomer(transferOK 
                        ? PutMessageStatus.PUT_OK 
                        : PutMessageStatus.FLUSH_SLAVE_TIMEOUT);
                }
                requestsRead.clear();
            }
        }
    }
    
    @Override
    public void run() {
        while (!isStopped()) {
            waitForRunning(10);
            swapRequests();
            doWaitTransfer();
        }
    }
}
```

### 4.3 半同步语义

```
SYNC_MASTER 实际是"半同步"：
  ★ 只要任意一个 Slave 追上就 ACK
  ★ 不需要所有 Slave 都追上

例：1 Master + 2 Slave
  Master 写完 → Slave-1 同步完成 → 立即 ACK
  Slave-2 慢一些，异步追赶
  
对比 DLedger：
  必须 > N/2 节点（含自己）都确认才 ACK
```

---

## 五、ASYNC_MASTER（默认）

```
Producer.send() → Master
        │
        ▼
Master 写 PageCache
        │
        ▼
立即返回 SUCCESS（不等 Slave）
        │
        │ Slave 持续异步追赶
        ▼
Slave 通过 HAClient 主动拉取
```

**优点**：性能最高（不等 Slave）
**缺点**：Master 整机故障可能丢数据

---

## 六、Master 切换（人工）

### 6.1 4.x 传统流程

```
1. Master 整机故障
2. 运维介入：
   a. 修改 Slave 的 broker.conf：
      brokerRole=ASYNC_MASTER 或 SYNC_MASTER
      brokerId=0
   b. 重启 Slave 进程
3. Slave 升级为 Master
4. 修复后的老 Master 作为 Slave 重新加入

→ 需要人工，停服几分钟到几十分钟
```

### 6.2 RocketMQ 4.5+ 改进：Controller 模式

```
启用 Controller 后：
  Controller 集群（基于 DLedger）负责选主
  Broker 的角色由 Controller 动态分配
  
Master 挂了 → Controller 检测 → 自动提升 Slave → 自动切换 BrokerId

→ 不需要人工，几秒内完成
→ 不需要 CommitLog 走 Raft（只有元数据走 Raft）
→ 性能不损失，又获得了自动 failover
```

---

## 七、HAService 配置参数

```properties
# 主从角色
brokerRole=ASYNC_MASTER       # 异步主
       | SYNC_MASTER          # 同步主
       | SLAVE                # 从节点

# 主从同步端口
haListenPort=10912

# 主节点 IP（Slave 端配置）
haMasterAddress=192.168.1.10:10912

# 同步超时
haSendHeartbeatInterval=5000

# Slave 落后多少 MB 时不接受 Master 角色（防止刚追上的 Slave 被升主）
haSlaveFallbehindMax=256MB

# 同步刷盘 + 同步主从超时
syncFlushTimeout=5000
```

---

## 八、监控关键指标

```
Master 端：
  • push2SlaveMaxOffset：已推送给 Slave 的最大 offset
  • masterMaxOffset：Master 当前最大 offset
  • 差值 = Slave 落后量（应 < 256MB）

Slave 端：
  • haClientLastReadTimestamp：上次从 Master 读到数据的时间
  • commitLogMaxOffset：本地 CommitLog 进度
  • slaveBehindMaster：落后 Master 的字节数

异常告警：
  ① 主从断连（haClient 重连频繁）
  ② Slave 持续落后（> 100MB 持续 5 分钟）
  ③ SYNC_MASTER 频繁超时（FLUSH_SLAVE_TIMEOUT）
```

---

## 九、HAService vs DLedger 对比

| 维度 | HAService (4.x 默认) | DLedger |
|---|---|---|
| **副本数** | 1 主 + N 从 | 通常 3 节点 |
| **一致性** | 半同步（任一 Slave 追上即 ACK） | 强一致（多数派） |
| **故障切换** | 人工 + Controller 模式 | 自动选举 |
| **协议复杂度** | 简单（自定义协议） | 复杂（Raft） |
| **性能** | 50W TPS | 30W TPS |
| **资源** | 1 + 1 = 2 节点起步 | 3 节点起步 |
| **数据安全** | 可能丢已 ACK 数据（异步） | 不丢已 commit 数据 |
| **适用** | 高吞吐、可容忍人工切换 | 强一致、要求自动 failover |

---

## 十、HAService 的痛点（DLedger 的动机）

### 10.1 痛点 1：Slave 不能自动升主

```
Master 挂了 → 需要人工改配置 + 重启 → 业务中断
```

### 10.2 痛点 2：双主问题

```
人工切换过程中：
  老 Master 网络恢复但还没下线
  新 Master 已经在工作
  → 同一 BrokerName 有两个 BrokerId=0
  → Producer 路由表错乱
```

### 10.3 痛点 3：异步丢数据

```
ASYNC_MASTER：
  Master 写完 ACK → 立即返回
  Slave 还没同步到 → Master 整机故障 → 数据丢
  
SYNC_MASTER：
  解决了丢数据，但性能下降 50%
```

### 10.4 DLedger 一次性解决

```
✓ 自动选主（无需人工）
✓ 多数派强一致（不丢数据）
✓ 协议层防止双主（同 term 只能有一个 Leader）
```

---

## 十一、一句话记住核心

> **HAService = Master/Slave 长连接 + Slave 主动拉 + 半同步 ACK。**
>
> 协议简单：Master 推 (offset, size, data)，Slave 报 (slaveAckOffset)。
>
> SYNC_MASTER 半同步：任一 Slave 追上即可（不是多数派）。
>
> 痛点：Master 挂了不能自动切换，需要 Controller 或 DLedger 解决。
>
> 4.x 高吞吐场景仍主流；强一致 + 自动 failover 用 DLedger。
