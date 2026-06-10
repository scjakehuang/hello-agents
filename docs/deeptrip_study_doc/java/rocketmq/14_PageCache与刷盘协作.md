# PageCache 与刷盘协作（FlushService 内部机制）

PageCache 是 OS 提供的能力，但**怎么用 PageCache、什么时候刷盘**才是 RocketMQ 性能的关键。本篇深入 FlushCommitLogService 和 CommitRealTimeService 两个核心后台线程。

---

## 一、刷盘策略：SYNC vs ASYNC

```
flushDiskType = SYNC_FLUSH   ← 强一致，性能差
              | ASYNC_FLUSH  ← 默认，性能好
```

### 1.1 SYNC_FLUSH（GroupCommitService）

```
Producer.send()
    │
    ▼
mappedByteBuffer.put(data)     ← 写 PageCache
    │
    ▼
提交一个 GroupCommitRequest    ← 等待刷盘完成
    │
    ▼
GroupCommitService 异步线程
    │
    │ 每 10ms 一轮：
    │ 1. 收集所有等待中的 request
    │ 2. mappedByteBuffer.force()   ← 真正的 fsync 系统调用
    │ 3. 通知所有 request 完成
    ▼
Producer 收到刷盘完成 → 才返回 SUCCESS
```

**核心代码**：

```java
class GroupCommitService extends ServiceThread {
    private List<GroupCommitRequest> requestsWrite = new ArrayList<>();
    private List<GroupCommitRequest> requestsRead = new ArrayList<>();
    
    public void putRequest(GroupCommitRequest req) {
        synchronized (this.requestsWrite) {
            this.requestsWrite.add(req);
        }
        wakeup();  // 唤醒后台线程
    }
    
    private void doCommit() {
        // 双缓冲切换
        swapRequests();
        
        boolean flushOK = false;
        for (int i = 0; i < 2 && !flushOK; i++) {
            flushOK = CommitLog.this.mappedFileQueue.getFlushedWhere() 
                     >= req.getNextOffset();
            if (!flushOK) {
                CommitLog.this.mappedFileQueue.flush(0);  // ★ 真正刷盘
            }
        }
        
        // 通知所有等待的 request
        for (GroupCommitRequest req : requestsRead) {
            req.wakeupCustomer(flushOK);
        }
    }
    
    @Override
    public void run() {
        while (!isStopped()) {
            waitForRunning(10);  // 最多睡 10ms
            doCommit();
        }
    }
}
```

**为什么叫"GroupCommit"**：

```
多个 Producer 同时发消息：
  T+0ms  Producer-1 写入 → 加入队列
  T+2ms  Producer-2 写入 → 加入队列
  T+5ms  Producer-3 写入 → 加入队列
  T+10ms 后台线程统一 force() 一次
  → 一次刷盘服务 3 个请求
  → 大幅减少 fsync 调用次数
```

**性能数据**：

```
单条 force()：1~5ms
没有 GroupCommit：每条消息一次 force → TPS < 1000
有 GroupCommit：每 10ms 一次 force → TPS 1~5W
```

### 1.2 ASYNC_FLUSH（FlushRealTimeService）

```
Producer.send()
    │
    ▼
mappedByteBuffer.put(data)
    │
    ▼
立即返回 SUCCESS    ← ★ 不等刷盘
    │
后台
    │
FlushRealTimeService 线程
    │
    │ 默认每 500ms：
    │ 1. 检查未刷盘的字节数
    │ 2. 累积 >= 4 页（16KB）才 force()
    │ 3. 或每 10s 强制 force()
    ▼
PageCache → 磁盘
```

**核心代码**：

```java
class FlushRealTimeService extends ServiceThread {
    @Override
    public void run() {
        while (!isStopped()) {
            boolean flushCommitLogTimed = config.isFlushCommitLogTimed();
            int interval = config.getFlushIntervalCommitLog();  // 默认 500ms
            int leastPages = config.getFlushCommitLogLeastPages(); // 默认 4 页
            int thoroughInterval = config.getFlushCommitLogThoroughInterval(); // 10s
            
            // 距上次刷盘超过 thoroughInterval → 强制刷
            long currentTimeMillis = System.currentTimeMillis();
            if (currentTimeMillis >= lastFlushTimestamp + thoroughInterval) {
                lastFlushTimestamp = currentTimeMillis;
                leastPages = 0;  // 不管够不够 4 页，强制刷
            }
            
            try {
                if (flushCommitLogTimed) {
                    Thread.sleep(interval);  // 定时刷
                } else {
                    waitForRunning(interval);  // 可被唤醒
                }
                
                long begin = System.currentTimeMillis();
                CommitLog.this.mappedFileQueue.flush(leastPages);
                long past = System.currentTimeMillis() - begin;
                
                if (past > 500) {
                    log.info("Flush data to disk costs {} ms", past);
                }
            } catch (Throwable e) {
                ...
            }
        }
    }
}
```

**关键参数**：

| 参数 | 默认值 | 说明 |
|---|---|---|
| `flushIntervalCommitLog` | 500ms | 刷盘扫描间隔 |
| `flushCommitLogLeastPages` | 4 (16KB) | 累积多少页才刷 |
| `flushCommitLogThoroughInterval` | 10000ms | 不管多少页强制刷 |

---

## 二、TransientStorePool 模式（异步双写）

### 2.1 默认 vs TransientStorePool

```
默认（直接 mmap）：
  Producer → mappedByteBuffer.put() → PageCache → 后台 fsync → 磁盘

TransientStorePool：
  Producer → writeBuffer.put() → DirectByteBuffer（堆外）
                                   │
                                   │ CommitRealTimeService 异步
                                   ▼
                                fileChannel.write() → PageCache
                                   │
                                   ▼
                              后台 fsync → 磁盘
```

### 2.2 CommitRealTimeService（堆外 → PageCache）

```java
class CommitRealTimeService extends ServiceThread {
    @Override
    public void run() {
        while (!isStopped()) {
            int interval = config.getCommitIntervalCommitLog();  // 默认 200ms
            int commitDataLeastPages = config.getCommitCommitLogLeastPages(); // 默认 4 页
            int commitDataThoroughInterval = config.getCommitCommitLogThoroughInterval(); // 200ms
            
            long begin = System.currentTimeMillis();
            if (begin >= lastCommitTimestamp + commitDataThoroughInterval) {
                lastCommitTimestamp = begin;
                commitDataLeastPages = 0;
            }
            
            try {
                // ★ 从 writeBuffer (DirectByteBuffer) commit 到 fileChannel
                boolean result = CommitLog.this.mappedFileQueue.commit(commitDataLeastPages);
                long end = System.currentTimeMillis();
                if (!result) {
                    lastCommitTimestamp = end;
                    flushCommitLogService.wakeup();  // 通知 flush 线程
                }
                
                waitForRunning(interval);
            } catch (Throwable e) {
                ...
            }
        }
    }
}
```

### 2.3 三阶段写入路径

```
TransientStorePool 开启时：

阶段 1：Producer 写堆外
  writeBuffer.put(data) → DirectByteBuffer
  立即返回（除非堆外满）

阶段 2：CommitRealTimeService（200ms 周期）
  DirectByteBuffer → fileChannel.write() → PageCache
  非阻塞 IO

阶段 3：FlushRealTimeService（500ms 周期）
  PageCache → 磁盘（force()）
```

### 2.4 TransientStorePool 的内存池

```java
// TransientStorePool
private final int poolSize;          // 默认 5
private final int fileSize;          // 1G
private final Deque<ByteBuffer> availableBuffers;

public void init() {
    for (int i = 0; i < poolSize; i++) {
        // 分配 5 个 1GB 的 DirectByteBuffer
        ByteBuffer buffer = ByteBuffer.allocateDirect(fileSize);
        
        // ★ 用 LibC 锁住内存，防止被 swap 出去
        final long address = ((DirectBuffer) buffer).address();
        Pointer pointer = new Pointer(address);
        LibC.INSTANCE.mlock(pointer, new NativeLong(fileSize));
        
        availableBuffers.offer(buffer);
    }
}

public ByteBuffer borrowBuffer() {
    return availableBuffers.pollFirst();  // 取一个
}

public void returnBuffer(ByteBuffer buf) {
    buf.position(0);
    buf.limit(fileSize);
    availableBuffers.offerFirst(buf);  // 回收
}
```

**配置**：

```properties
transientStorePoolEnable=true
transientStorePoolSize=5    # 池大小
```

---

## 三、PageCache 三个核心问题

### 3.1 写满了怎么办？

```
PageCache 满了的现象：
  • Linux 启动 pdflush 强制回刷
  • write() 系统调用阻塞
  • Producer 写入卡顿

应对：
  ① 增大物理内存
  ② 调 vm.dirty_background_ratio（默认 10%，可调小）
  ③ 开 TransientStorePool（堆外缓冲）
  ④ SSD 提升刷盘速度
```

### 3.2 失效了怎么办？

```
PageCache 失效的现象：
  • Consumer 拉冷消息（offset 落后很多）→ 缺页中断
  • 多 Topic 互相挤占 → 命中率下降
  • OS 内存压力 → PageCache 被回收

应对：
  ① 文件预热（warmMapedFileEnable=true）
  ② mlock 锁住关键页（ConsumeQueue 全部锁）
  ③ 隔离冷热 Consumer（冷消费独立部署，避免冲击热 Cache）
```

### 3.3 跨进程共享？

```
PageCache 是 OS 级别的，多进程共享：
  Broker 进程崩溃 → PageCache 不会丢
  Broker 重启 → 仍能从 PageCache 读到老数据
  
  → 这就是 mmap 比 write() 更安全的原因之一
  → 只有 OS 崩溃才会丢 PageCache 数据
```

---

## 四、刷盘策略组合矩阵

```
┌─────────────┬──────────────┬──────────────┬──────────────┐
│             │ TransientPool│ SYNC_FLUSH   │ ASYNC_FLUSH  │
├─────────────┼──────────────┼──────────────┼──────────────┤
│ 默认        │ 关           │ 选项 1       │ 选项 2       │
│ TransientOn │ 开           │ 不允许       │ 选项 3       │
└─────────────┴──────────────┴──────────────┴──────────────┘

选项 1：SYNC_FLUSH + 直接 mmap
  → 最强一致，最低吞吐（< 1W TPS）
  → 金融、对账场景

选项 2：ASYNC_FLUSH + 直接 mmap（默认）
  → 平衡，约 5W TPS
  → 大多数业务

选项 3：ASYNC_FLUSH + TransientStorePool
  → 最高吞吐（10W+ TPS）
  → 可能多丢一份"堆外未 commit"数据
  → 日志、埋点类业务
```

---

## 五、刷盘的可观察指标

### 5.1 关键 metrics

```
• putMessageTimeMs：写消息总耗时
• putMessageEnterTimeMs：消息从进入到写完 PageCache 的时间
• flushMessageTimeMs：flush 操作耗时
• pageCacheLockTimeMills：等 PageCache 锁的时间
• commitLogDirOffset：CommitLog 当前 offset
• flushedWhere：已刷盘到的 offset
• committedWhere：已 commit 到 PageCache 的 offset
```

### 5.2 健康度判断

```
正常情况：
  commitLogDirOffset ≈ committedWhere ≈ flushedWhere
  差值 < 几 MB

异常情况：
  commitLogDirOffset - committedWhere 持续增大
    → CommitRealTimeService 跟不上
  committedWhere - flushedWhere 持续增大
    → FlushRealTimeService 跟不上
    → 磁盘 IO 瓶颈
```

### 5.3 监控告警示例

```
告警规则：
  ① flushBehindBytes > 50MB（持续 1 分钟）
     → 刷盘严重落后，可能丢消息风险
  
  ② pageCacheLockTimeMills > 1000ms
     → PageCache 紧张，业务线程被阻塞
  
  ③ flushMessageTimeMs > 5000ms
     → 单次刷盘超 5 秒，磁盘异常
```

---

## 六、和 Master/Slave 同步的协作

```
完整写入链路（SYNC_MASTER + SYNC_FLUSH）：

Producer.send()
    │
    ▼
Master Broker：
    │
    ├─ ① 写 PageCache
    ├─ ② 提交 GroupCommitRequest（等刷盘）
    ├─ ③ 提交 GroupTransferRequest（等 Slave 同步）
    │
    ▼ 
等两个都完成
    │
    ▼
返回 SUCCESS

→ 见 17_HAService主从复制.md
```

---

## 七、运维参数大全

```properties
# 刷盘类型
flushDiskType=ASYNC_FLUSH

# ASYNC_FLUSH 参数
flushIntervalCommitLog=500
flushCommitLogLeastPages=4
flushCommitLogThoroughInterval=10000

# SYNC_FLUSH 参数
syncFlushTimeout=5000           # 同步刷盘超时

# TransientStorePool
transientStorePoolEnable=false
transientStorePoolSize=5

# Commit 参数（TransientStorePool 开启时生效）
commitIntervalCommitLog=200
commitCommitLogLeastPages=4
commitCommitLogThoroughInterval=200

# 文件预热
warmMapedFileEnable=true

# ConsumeQueue 刷盘
flushIntervalConsumeQueue=1000
flushConsumeQueueLeastPages=2
flushConsumeQueueThoroughInterval=60000
```

---

## 八、一句话记住核心

> **写入：业务线程 put() 到 PageCache（或堆外）→ 立即返回 → 后台线程异步 force()。**
>
> SYNC_FLUSH = GroupCommitService 等 force 完成才 ACK；ASYNC_FLUSH = FlushRealTimeService 后台 500ms 刷。
>
> TransientStorePool = 堆外 DirectByteBuffer 池 → CommitRealTimeService 异步 commit 到 PageCache → 再异步 force。
>
> 三个后台线程：CommitRealTimeService（堆外→PageCache）、FlushRealTimeService（PageCache→磁盘）、GroupCommitService（同步刷盘等待者）。
>
> 整条路径上业务线程几乎不阻塞，吞吐自然就高。
