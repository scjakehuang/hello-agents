# Broker 启动与崩溃恢复（recover() + checkpoint）

Broker 异常重启时，CommitLog / ConsumeQueue / IndexFile 是否一致？怎么恢复？这一节讲清楚 Broker 启动的恢复流程，以及为什么 RocketMQ 不丢已写入的消息。

---

## 一、Broker 启动总流程

```
sh bin/mqbroker
    │
    ▼
BrokerStartup.main()
    │
    ├─ ① 加载配置（broker.conf）
    ├─ ② 初始化 MessageStore
    │   │
    │   ├─ load()      ← 恢复阶段（本节重点）
    │   ├─ start()     ← 启动各种线程
    │   └─ ...
    │
    ├─ ③ 注册 Processor（SendMessage/PullMessage/...）
    ├─ ④ 启动 Netty Server
    ├─ ⑤ 注册到 NameServer
    │
    └─ Broker is now ready to serve
```

---

## 二、checkpoint 文件

### 2.1 内容

```
$ROCKETMQ_HOME/store/checkpoint

固定 4KB 文件，记录三个时间戳：

  ┌──────────────────────────┐
  │ physicMsgTimestamp (8B)  │  ← CommitLog 最后刷盘时间
  │ logicsMsgTimestamp (8B)  │  ← ConsumeQueue 最后刷盘时间
  │ indexMsgTimestamp (8B)   │  ← IndexFile 最后刷盘时间
  │ (剩余字节填 0)            │
  └──────────────────────────┘
```

### 2.2 何时更新

```java
class StoreCheckpoint {
    public void flush() {
        mappedByteBuffer.putLong(0, physicMsgTimestamp);
        mappedByteBuffer.putLong(8, logicsMsgTimestamp);
        mappedByteBuffer.putLong(16, indexMsgTimestamp);
        mappedByteBuffer.force();  // 强制刷盘
    }
}

// 触发点：
// ① CommitLog 刷盘后
// ② ConsumeQueue 刷盘后
// ③ IndexFile 刷盘后
```

### 2.3 用途

```
重启恢复时：
  比较三个时间戳 → 判断 ConsumeQueue/IndexFile 是否落后于 CommitLog
  → 落后部分需要重建
```

---

## 三、abort 文件

### 3.1 作用

```
$ROCKETMQ_HOME/store/abort

正常启动 → 创建 abort 文件
正常关闭 → 删除 abort 文件

重启时检查：
  abort 存在 → 上次是异常退出 → 走"异常恢复"
  abort 不存在 → 上次正常关闭 → 走"正常恢复"
```

### 3.2 实现

```java
// 启动时
public void start() {
    File abortFile = new File(storePath + "/abort");
    if (!abortFile.exists()) {
        abortFile.createNewFile();  // 创建标记
    }
    // ... 启动其他服务
}

// JVM 关闭钩子
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    messageStore.shutdown();
    
    // 正常 shutdown 后删除 abort
    File abortFile = new File(storePath + "/abort");
    abortFile.delete();
}));
```

### 3.3 检测异常退出

```java
public boolean isTempFileExist() {
    File file = new File(storePath + "/abort");
    return file.exists();
}

// load() 时
public boolean load() {
    boolean lastExitOK = !this.isTempFileExist();
    
    log.info("last shutdown {}", lastExitOK ? "normally" : "abnormally");
    
    // 选择恢复策略
    if (lastExitOK) {
        recoverNormally();
    } else {
        recoverAbnormally();
    }
}
```

---

## 四、CommitLog 恢复

### 4.1 正常恢复

```java
public void recoverNormally() {
    List<MappedFile> mappedFiles = mappedFileQueue.getMappedFiles();
    
    if (!mappedFiles.isEmpty()) {
        // ★ 从倒数第 3 个文件开始扫
        int index = Math.max(0, mappedFiles.size() - 3);
        
        for (int i = index; i < mappedFiles.size(); i++) {
            MappedFile mf = mappedFiles.get(i);
            ByteBuffer byteBuffer = mf.sliceByteBuffer();
            
            long processOffset = mf.getFileFromOffset();
            int mappedFileOffset = 0;
            
            while (mappedFileOffset < mf.getFileSize()) {
                // ① 读 4 字节 TOTALSIZE
                int size = byteBuffer.getInt(mappedFileOffset);
                if (size <= 0) break;  // 没有消息了
                
                // ② 校验消息（CRC）
                DispatchRequest dispatchRequest = checkMessageAndReturnSize(
                    byteBuffer, mappedFileOffset);
                
                if (dispatchRequest.isSuccess()) {
                    mappedFileOffset += size;
                    processOffset = mf.getFileFromOffset() + mappedFileOffset;
                } else {
                    // ★ 校验失败 = 消息不完整，停止扫描
                    break;
                }
            }
        }
        
        // 设置全局位置
        commitLog.setConfirmOffset(processOffset);
        mappedFileQueue.setFlushedWhere(processOffset);
        mappedFileQueue.setCommittedWhere(processOffset);
    }
}
```

### 4.2 异常恢复

```java
public void recoverAbnormally() {
    List<MappedFile> mappedFiles = mappedFileQueue.getMappedFiles();
    
    if (!mappedFiles.isEmpty()) {
        // ★ 从最后一个文件往前找"有效的起点"
        int index = mappedFiles.size() - 1;
        MappedFile mf = mappedFiles.get(index);
        
        while (index >= 0) {
            mf = mappedFiles.get(index);
            
            // 看文件第一条消息的 STORETIMESTAMP
            // 如果 > checkpoint.physicMsgTimestamp → 数据在 checkpoint 之后写的 → 可能不可靠
            if (isMappedFileMatchedRecover(mf)) {
                // 找到了起点
                break;
            }
            index--;
        }
        
        if (index < 0) {
            index = 0;
            mf = mappedFiles.get(0);
        }
        
        // ★ 从起点开始扫描，重建数据
        long processOffset = mf.getFileFromOffset();
        int mappedFileOffset = 0;
        
        while (true) {
            int size = byteBuffer.getInt(mappedFileOffset);
            DispatchRequest dispatchRequest = checkMessageAndReturnSize(
                byteBuffer, mappedFileOffset);
            
            if (dispatchRequest.isSuccess()) {
                if (size > 0) {
                    // ★ 同时重建 ConsumeQueue 和 IndexFile
                    defaultMessageStore.doDispatch(dispatchRequest);
                }
                mappedFileOffset += size;
                processOffset = mf.getFileFromOffset() + mappedFileOffset;
            } else {
                // 校验失败 = 损坏点 = 截断
                break;
            }
        }
        
        // 截断损坏文件
        mappedFileQueue.truncateDirtyFiles(processOffset);
    }
}
```

### 4.3 单条消息校验

```java
public DispatchRequest checkMessageAndReturnSize(ByteBuffer byteBuffer, int offset) {
    int totalSize = byteBuffer.getInt(offset);
    int magicCode = byteBuffer.getInt(offset + 4);
    
    switch (magicCode) {
        case MESSAGE_MAGIC_CODE:
            // 正常消息，继续解析
            break;
        case BLANK_MAGIC_CODE:
            // 文件末尾标记
            return new DispatchRequest(0, true);
        default:
            // 未知 magic = 损坏
            return new DispatchRequest(-1, false);
    }
    
    int bodyCRC = byteBuffer.getInt(offset + 8);
    // ... 读其他字段
    byte[] body = new byte[bodyLen];
    byteBuffer.get(body);
    
    // ★ CRC 校验
    int calCRC = UtilAll.crc32(body);
    if (calCRC != bodyCRC) {
        log.warn("CRC check failed at offset {}", offset);
        return new DispatchRequest(-1, false);
    }
    
    return new DispatchRequest(...success...);
}
```

---

## 五、ConsumeQueue 恢复

### 5.1 恢复策略

```java
public void recover() {
    for (Map<Integer, ConsumeQueue> queues : consumeQueueTable.values()) {
        for (ConsumeQueue cq : queues.values()) {
            cq.recover();
        }
    }
}

class ConsumeQueue {
    public void recover() {
        List<MappedFile> mappedFiles = mappedFileQueue.getMappedFiles();
        if (!mappedFiles.isEmpty()) {
            int index = Math.max(0, mappedFiles.size() - 3);
            
            for (int i = index; i < mappedFiles.size(); i++) {
                MappedFile mf = mappedFiles.get(i);
                ByteBuffer buffer = mf.sliceByteBuffer();
                int mappedFileOffset = 0;
                
                while (mappedFileOffset < CQ_STORE_UNIT_SIZE * (fileSize / CQ_STORE_UNIT_SIZE)) {
                    long commitLogOffset = buffer.getLong();
                    int msgSize = buffer.getInt();
                    long tagsCode = buffer.getLong();
                    
                    // ★ 校验：entry 必须指向真实的 CommitLog 位置
                    if (commitLogOffset >= 0 && msgSize > 0) {
                        mappedFileOffset += CQ_STORE_UNIT_SIZE;
                        // 推进 maxPhysicOffset
                        this.maxPhysicOffset = commitLogOffset + msgSize;
                    } else {
                        // 损坏，截断
                        break;
                    }
                }
            }
        }
    }
}
```

### 5.2 重建 ConsumeQueue

```
异常恢复时：
  ConsumeQueue 可能落后于 CommitLog
  
解决：
  recoverAbnormally() 扫 CommitLog 时
  对每条有效消息调 doDispatch()
  → ReputMessageService 重建对应的 ConsumeQueue entry
  → 一直追到 CommitLog 末尾
```

---

## 六、IndexFile 恢复

### 6.1 恢复策略

```java
public boolean load(boolean lastExitOK) {
    File dir = new File(storePath + "/index");
    File[] files = dir.listFiles();
    
    // 按文件名（时间戳）排序
    Arrays.sort(files);
    
    for (File file : files) {
        IndexFile indexFile = new IndexFile(file.getPath(), ...);
        indexFile.load();
        
        if (!lastExitOK) {
            // ★ 上次异常退出，最后一个 IndexFile 可能不可靠
            if (indexFile.getEndTimestamp() > storeCheckpoint.getIndexMsgTimestamp()) {
                indexFile.destroy(0);  // 删除
                continue;
            }
        }
        
        indexFileList.add(indexFile);
    }
}
```

### 6.2 重建 IndexFile

```
正常恢复：
  IndexFile 一般完整（即使不完整，也只是少量索引丢失，不影响功能）

异常恢复：
  ReputMessageService 扫 CommitLog 时
  对每条带 keys 的消息调 buildIndex()
  → 重新插入 IndexFile
```

---

## 七、ReputMessageService（重建分发）

### 7.1 作用

```
正常运行时：
  CommitLog 写入后 → 异步分发到 ConsumeQueue 和 IndexFile
  
重启恢复时：
  从 reputFromOffset 开始扫 CommitLog
  对每条消息生成 DispatchRequest
  → 触发 ConsumeQueue / IndexFile 写入
```

### 7.2 实现

```java
class ReputMessageService extends ServiceThread {
    private long reputFromOffset;  // 起始位置
    
    @Override
    public void run() {
        while (!isStopped()) {
            try {
                Thread.sleep(1);
                doReput();
            } catch (Exception e) { ... }
        }
    }
    
    private void doReput() {
        // ① 拿到 CommitLog 从 reputFromOffset 开始的数据
        SelectMappedBufferResult result = commitLog.getData(reputFromOffset);
        if (result == null) return;
        
        try {
            ByteBuffer buf = result.getByteBuffer();
            for (int readSize = 0; readSize < result.getSize(); ) {
                // ② 检查并解析消息
                DispatchRequest req = commitLog.checkMessageAndReturnSize(buf, ...);
                
                if (req.isSuccess() && req.getMsgSize() > 0) {
                    // ★ 关键：分发！
                    defaultMessageStore.doDispatch(req);
                    
                    reputFromOffset += req.getMsgSize();
                    readSize += req.getMsgSize();
                }
            }
        } finally {
            result.release();
        }
    }
}

// doDispatch
public void doDispatch(DispatchRequest req) {
    for (CommitLogDispatcher d : dispatcherList) {
        d.dispatch(req);
    }
}

// dispatcherList 包含：
// • CommitLogDispatcherBuildConsumeQueue → 写 ConsumeQueue
// • CommitLogDispatcherBuildIndex        → 写 IndexFile
```

### 7.3 恢复完成后

```
重启时：
  reputFromOffset = max(commitLog.minOffset, max(consumeQueue.allMaxPhysicOffset))
  
  → ReputMessageService 从 reputFromOffset 一直追到 CommitLog 末尾
  → ConsumeQueue / IndexFile 完全追齐
  → Broker 才开始对外提供服务
```

---

## 八、消息恢复流程总览

```
异常重启场景：
  CommitLog 最后 100MB 是新写入但 ConsumeQueue 还没追上
  
    ┌─────────────────────────────────────────────┐
    │ ① 检测到 abort 文件                          │
    │    → 走异常恢复                              │
    └─────────────────────────────────────────────┘
                       │
                       ▼
    ┌─────────────────────────────────────────────┐
    │ ② CommitLog.recoverAbnormally()              │
    │    a. 从最后文件往前找有效起点                 │
    │    b. 逐条扫描 + CRC 校验                    │
    │    c. 遇到损坏 → 截断                        │
    │    d. 同时调 doDispatch() 重建               │
    └─────────────────────────────────────────────┘
                       │
                       ▼
    ┌─────────────────────────────────────────────┐
    │ ③ ConsumeQueue.recover()                     │
    │    校验 entry 完整性，截断损坏部分            │
    └─────────────────────────────────────────────┘
                       │
                       ▼
    ┌─────────────────────────────────────────────┐
    │ ④ IndexFile.load()                           │
    │    根据 checkpoint 删除不可靠的 IndexFile     │
    └─────────────────────────────────────────────┘
                       │
                       ▼
    ┌─────────────────────────────────────────────┐
    │ ⑤ ReputMessageService 启动                   │
    │    从 reputFromOffset 追到 CommitLog 末尾    │
    │    重建 ConsumeQueue + IndexFile             │
    └─────────────────────────────────────────────┘
                       │
                       ▼
    ┌─────────────────────────────────────────────┐
    │ ⑥ 启动 Netty Server，注册 NameServer         │
    │    Broker ready                              │
    └─────────────────────────────────────────────┘
```

---

## 九、何时会丢消息

### 9.1 异步刷盘 + 单机故障

```
ASYNC_FLUSH：
  写 PageCache → 立即返回 SUCCESS
  → 还没调 force()
  → 整机断电 → PageCache 数据丢失
  → 已 ACK 的消息丢
  
→ 重要消息用 SYNC_FLUSH
```

### 9.2 ASYNC_MASTER + Master 故障

```
ASYNC_MASTER：
  Master 写完返回 SUCCESS（不等 Slave）
  → 数据还在 Master
  → Master 整机故障 → Slave 没追上的部分丢
  
→ 用 SYNC_MASTER 或 DLedger
```

### 9.3 都不丢的组合

```
SYNC_FLUSH + SYNC_MASTER：
  ✓ 必须刷盘 + 必须 Slave 同步
  ✗ 性能差（TPS 降 50%+）
  
DLedger：
  ✓ 多数派 commit
  ✓ Leader 故障自动选主
  ✗ TPS 比 ASYNC 低 30~50%
```

---

## 十、恢复时间

### 10.1 影响因素

```
正常恢复：
  • 扫描最后 3 个 MappedFile（3GB）
  • SSD：几秒
  • HDD：30 秒~1 分钟

异常恢复：
  • 可能需要扫描更多
  • 取决于 ConsumeQueue 落后量
  • 大量消息没分发：可能几分钟

→ 数据量大的 Broker 重启慢
```

### 10.2 优化

```
✓ 定期触发 checkpoint（默认 1 秒）
✓ 保证 ConsumeQueue / IndexFile 接近实时
✓ ReputMessageService 不要落后太多
✓ 升级 SSD
```

---

## 十一、Broker 关闭

### 11.1 优雅关闭

```bash
sh bin/mqshutdown broker

# 或发 SIGTERM
kill <pid>
```

### 11.2 关闭流程

```java
public void shutdown() {
    // ① 注销 NameServer
    brokerOuterAPI.unregisterBrokerAll(...);
    
    // ② 停止接收新请求
    nettyRemotingServer.shutdown();
    
    // ③ 等待正在处理的请求完成（max 60s）
    sendMessageExecutor.shutdown();
    sendMessageExecutor.awaitTermination(60, TimeUnit.SECONDS);
    
    // ④ 强制刷盘
    commitLog.shutdown();
    consumeQueue.shutdown();
    indexService.shutdown();
    
    // ⑤ 关闭 checkpoint
    storeCheckpoint.shutdown();
    
    // ⑥ 删除 abort 文件（标记正常关闭）
    new File(storePath + "/abort").delete();
}
```

### 11.3 kill -9 危害

```
强制杀进程：
  ✗ 不会执行 shutdown hook
  ✗ abort 文件不会删除
  ✗ 内存中的脏页可能丢失
  
重启后：
  → 走异常恢复（慢）
  → 可能丢 ASYNC_FLUSH 未刷盘的数据
  
→ 生产环境严禁 kill -9
```

---

## 十二、监控指标

```
恢复阶段：
  • recover 耗时
  • 截断的文件数
  • CRC 校验失败数

正常运行：
  • reputFromOffset 与 commitLog.maxOffset 的差
  • abort 文件存在？
  • 上次刷盘时间到现在的间隔
```

---

## 十三、一句话记住核心

> **恢复触发**：abort 文件存在 → 异常恢复；不存在 → 正常恢复。
>
> **CommitLog 恢复**：逐条扫描 + CRC 校验，遇到损坏截断；异常恢复时同时重建 ConsumeQueue/IndexFile。
>
> **checkpoint**：记录三个组件的最后刷盘时间，恢复时用来判断 ConsumeQueue/IndexFile 哪些可靠。
>
> **不丢消息组合**：SYNC_FLUSH + SYNC_MASTER 或 DLedger 多数派。
>
> **铁律**：生产 Broker 永远用 `mqshutdown` 优雅关闭，禁用 kill -9。
