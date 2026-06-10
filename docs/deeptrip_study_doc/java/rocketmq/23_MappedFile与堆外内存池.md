# MappedFile 与堆外内存池（TransientStorePool 双路径）

CommitLog 的极致写入性能来自两条互斥的写入路径：**直写 PageCache** vs **先写堆外内存池再异步刷**。理解这两条路径是排查"为什么 SYNC_FLUSH 突然变慢"的关键。

---

## 一、MappedFile 是什么

```
MappedFile = 一个固定大小的文件（默认 1GB）
           + 用 mmap 映射到进程虚拟地址
           
CommitLog 由多个 MappedFile 组成：
  00000000000000000000  ← 第 1 个文件，offset 0 ~ 1GB
  00000000001073741824  ← 第 2 个文件，offset 1GB ~ 2GB
  00000000002147483648  ← 第 3 个文件，offset 2GB ~ 3GB
  ...
  
文件名 = 起始 offset（20 位十进制，前面补 0）
```

### 1.1 为什么用 mmap

```
传统读写：
  read(fd, buffer, size)
  → 内核 buffer → 用户 buffer（拷贝 1 次）
  → CPU 介入

mmap：
  ptr = mmap(file, size, ...)
  → 直接操作虚拟地址 = 操作 PageCache
  → 无内核-用户拷贝
  → 缺页时按页加载（4KB）

→ 写入接近内存速度
→ OS 异步回写到磁盘（pdflush/kworker）
```

---

## 二、MappedFile 结构

### 2.1 关键字段

```java
public class MappedFile {
    // 文件相关
    private File file;
    private FileChannel fileChannel;
    private String fileName;
    private long fileFromOffset;       // 文件的起始 offset
    
    // mmap
    private MappedByteBuffer mappedByteBuffer;  // mmap 内存映射
    
    // 写入位置
    private AtomicInteger wrotePosition;        // 已写到的位置
    private AtomicInteger committedPosition;    // 已 commit（仅 transient 模式用）
    private AtomicInteger flushedPosition;      // 已刷盘的位置
    
    // 堆外内存（TransientStorePool 模式）
    private ByteBuffer writeBuffer;             // 堆外 buffer（来自 pool）
    private TransientStorePool transientStorePool;
}
```

### 2.2 三个位置的关系

```
wrotePosition >= committedPosition >= flushedPosition

普通模式（直接 mmap）：
  appendMessage → 写 mappedByteBuffer → wrotePosition++
                                         committedPosition = wrotePosition
  flushService → force() 到磁盘    → flushedPosition++

TransientStorePool 模式：
  appendMessage → 写 writeBuffer (堆外) → wrotePosition++
  commitService → 从 writeBuffer 复制到 mappedByteBuffer → committedPosition++
  flushService  → force() → flushedPosition++
```

---

## 三、普通模式（mmap 直写）

### 3.1 写入流程

```java
public AppendMessageResult appendMessage(MessageExtBrokerInner msg, ...) {
    int currentPos = wrotePosition.get();
    
    if (currentPos < fileSize) {
        // ① 在 mappedByteBuffer 上 slice 一段
        ByteBuffer byteBuffer = mappedByteBuffer.slice();
        byteBuffer.position(currentPos);
        
        // ② 把消息序列化写入（直接进 PageCache）
        AppendMessageResult result = appendMessageCallback.doAppend(
            fileFromOffset, byteBuffer, fileSize - currentPos, msg);
        
        // ③ 推进 wrotePosition
        wrotePosition.addAndGet(result.getWroteBytes());
        
        return result;
    }
    return new AppendMessageResult(AppendMessageStatus.UNKNOWN_ERROR);
}
```

### 3.2 优缺点

```
优点：
  ✓ 零拷贝（只有一次：业务 → PageCache）
  ✓ 简单，性能稳定
  
缺点：
  ✗ PageCache 抖动直接影响写入 RT
     • 内存紧张时缺页 → 慢
     • OS 回写时写入争用 → 慢
     • 大 RT 抖动从 1ms 到几十 ms
```

---

## 四、TransientStorePool 模式（堆外内存池）

### 4.1 为什么需要

```
痛点：mmap 写入受 PageCache 影响
  • 读多写多时争用
  • OS 回写策略影响业务

解决思路：
  ✓ 业务先写堆外内存（无 PageCache 影响）
  ✓ 后台线程异步从堆外 → mmap → 磁盘
  ✓ 读还是走 PageCache（不影响）
  
→ 写性能更稳定
```

### 4.2 启用配置

```properties
# broker.conf
transientStorePoolEnable=true
transientStorePoolSize=5         # 池大小：5 个 buffer
```

### 4.3 TransientStorePool 实现

```java
public class TransientStorePool {
    private final int poolSize;              // 池大小
    private final int fileSize;              // 每个 buffer = 1GB
    private final Deque<ByteBuffer> availableBuffers;  // 可用队列
    
    public void init() {
        for (int i = 0; i < poolSize; i++) {
            // 分配堆外内存
            ByteBuffer byteBuffer = ByteBuffer.allocateDirect(fileSize);
            
            // ★ 关键：mlock 锁定到物理内存，防止被换出
            final long address = ((DirectBuffer) byteBuffer).address();
            Pointer pointer = new Pointer(address);
            LibC.INSTANCE.mlock(pointer, new NativeLong(fileSize));
            
            availableBuffers.offer(byteBuffer);
        }
    }
    
    public ByteBuffer borrowBuffer() {
        ByteBuffer buffer = availableBuffers.pollFirst();
        // ... 检查池剩余
        return buffer;
    }
    
    public void returnBuffer(ByteBuffer buffer) {
        buffer.position(0);
        buffer.limit(fileSize);
        availableBuffers.offerFirst(buffer);
    }
}
```

### 4.4 双 Buffer 写入路径

```
Producer.send()
    │
    ▼
appendMessage(msg)
    │
    ├─ 普通模式：
    │   写 mappedByteBuffer → PageCache → 磁盘
    │
    └─ Transient 模式：
        写 writeBuffer (堆外、mlock)
              │
              ▼
        CommitRealTimeService（后台 200ms 一次）
              │
              ▼
        commit() → 从 writeBuffer 复制到 fileChannel（写入 PageCache）
              │
              ▼
        FlushRealTimeService → force() → 磁盘
```

### 4.5 CommitRealTimeService

```java
class CommitRealTimeService extends ServiceThread {
    @Override
    public void run() {
        while (!isStopped()) {
            // 配置：默认 200ms 一次，或累计 4 page (16KB) 触发
            int interval = config.getCommitIntervalCommitLog();         // 200ms
            int commitDataLeastPages = config.getCommitCommitLogLeastPages();  // 4
            int commitDataThoroughInterval = 200;
            
            long begin = System.currentTimeMillis();
            
            // ★ 调 mappedFileQueue.commit()
            boolean result = commitLog.getMappedFileQueue().commit(commitDataLeastPages);
            
            // 触发 FlushService
            flushCommitLogService.wakeup();
            
            waitForRunning(interval);
        }
    }
}
```

### 4.6 commit() 实现

```java
// MappedFile.commit()
public int commit(final int commitLeastPages) {
    if (writeBuffer == null) {
        // 普通模式，没有堆外 buffer，commit 是 no-op
        return wrotePosition.get();
    }
    
    if (isAbleToCommit(commitLeastPages)) {
        // ★ 从 writeBuffer 复制到 fileChannel
        commit0();
    }
    
    return committedPosition.get();
}

private void commit0() {
    int writePos = wrotePosition.get();
    int lastCommittedPosition = committedPosition.get();
    
    if (writePos - lastCommittedPosition > 0) {
        ByteBuffer byteBuffer = writeBuffer.slice();
        byteBuffer.position(lastCommittedPosition);
        byteBuffer.limit(writePos);
        
        // 写入 fileChannel（进入 PageCache）
        fileChannel.position(lastCommittedPosition);
        fileChannel.write(byteBuffer);
        
        committedPosition.set(writePos);
    }
}
```

### 4.7 性能对比

```
基准测试（500 byte 消息，1KW 条）：

普通模式：
  平均 TPS：80W
  RT P99：5ms
  RT 最大：300ms（PageCache 回写时）

Transient 模式：
  平均 TPS：100W
  RT P99：2ms
  RT 最大：50ms（更稳定）
  
但代价：
  ✗ 多占用 5GB 内存（5 个 1GB 堆外 buffer）
  ✗ 双倍内存拷贝（业务 → 堆外 → PageCache）
```

---

## 五、消息追加协议

### 5.1 MessageExtBrokerInner 序列化

```
存入 CommitLog 的消息格式：

┌──────────────┬─────────────────────────────────┐
│ TOTALSIZE(4) │ 整个消息总长度                    │
├──────────────┼─────────────────────────────────┤
│ MAGICCODE(4) │ 魔数 0xdaa320a7（普通） / 0xBB.. │
├──────────────┼─────────────────────────────────┤
│ BODYCRC(4)   │ body 的 CRC                      │
├──────────────┼─────────────────────────────────┤
│ QUEUEID(4)   │ Queue ID                         │
├──────────────┼─────────────────────────────────┤
│ FLAG(4)      │ 消息 flag                        │
├──────────────┼─────────────────────────────────┤
│ QUEUEOFFSET(8)│ 在 ConsumeQueue 的偏移           │
├──────────────┼─────────────────────────────────┤
│ PHYSICALOFFSET(8)│ 在 CommitLog 的物理偏移      │
├──────────────┼─────────────────────────────────┤
│ SYSFLAG(4)   │ 系统 flag（事务/压缩等）          │
├──────────────┼─────────────────────────────────┤
│ BORNTIMESTAMP(8)│ Producer 端时间戳            │
├──────────────┼─────────────────────────────────┤
│ BORNHOST(8)  │ Producer IP + Port               │
├──────────────┼─────────────────────────────────┤
│ STORETIMESTAMP(8)│ Broker 存储时间戳            │
├──────────────┼─────────────────────────────────┤
│ STOREHOSTADDR(8)│ Broker IP + Port             │
├──────────────┼─────────────────────────────────┤
│ RECONSUMETIMES(4)│ 重消费次数                    │
├──────────────┼─────────────────────────────────┤
│ Prepared Transaction Offset(8)│ 事务消息相关    │
├──────────────┼─────────────────────────────────┤
│ BODY(4 + bodyLen)│ 消息体                       │
├──────────────┼─────────────────────────────────┤
│ TOPIC(1 + topicLen)│ Topic 名                  │
├──────────────┼─────────────────────────────────┤
│ Properties(2 + propLen)│ 用户属性               │
└──────────────┴─────────────────────────────────┘
```

### 5.2 MagicCode 的作用

```
0xdaa320a7 = 普通消息
0xBBCCDDEE = 文件末尾标记（剩余空间不够装下一条消息时）

启动恢复时：
  ① 顺序扫描 MappedFile
  ② 读 TOTALSIZE
  ③ 读 MAGICCODE 判断
     ✓ 普通：解析这条消息，继续往后
     ✓ 结束：跳到下一个 MappedFile
  ④ 直到读到不合法数据 → 当前位置就是 wrotePosition
```

---

## 六、MappedFileQueue

### 6.1 管理一组 MappedFile

```java
public class MappedFileQueue {
    private List<MappedFile> mappedFiles;
    private long flushedWhere;        // 全局已刷盘位置
    private long committedWhere;       // 全局已 commit 位置
    
    public MappedFile getLastMappedFile() {
        if (mappedFiles.isEmpty()) return null;
        return mappedFiles.get(mappedFiles.size() - 1);
    }
    
    public MappedFile getLastMappedFile(long startOffset) {
        // 当前最后一个写满了，创建新的
        MappedFile lastFile = getLastMappedFile();
        if (lastFile == null || lastFile.isFull()) {
            createNextFile(startOffset);
        }
        return getLastMappedFile();
    }
    
    private MappedFile createNextFile(long startOffset) {
        // 计算下一个文件的 fileFromOffset
        long createOffset = ...;
        String newFileName = String.format("%020d", createOffset);
        return new MappedFile(newFileName, mappedFileSize);
    }
}
```

### 6.2 文件预热（warmup）

```java
public void warmMappedFile(FlushDiskType type, int pages) {
    long begin = System.currentTimeMillis();
    ByteBuffer byteBuffer = mappedByteBuffer.slice();
    int flush = 0;
    
    // ★ 每 4KB 写一个字节，触发缺页中断
    for (int i = 0, j = 0; i < fileSize; i += PAGE_SIZE, j++) {
        byteBuffer.put(i, (byte) 0);
        
        // 定期 force 一下
        if (type == FlushDiskType.SYNC_FLUSH && (i / PAGE_SIZE) - flush >= pages) {
            flush = i / PAGE_SIZE;
            mappedByteBuffer.force();
        }
    }
    
    // 最终 force
    if (type == FlushDiskType.SYNC_FLUSH) {
        mappedByteBuffer.force();
    }
    
    // ★ 调用 madvise 提示内核：这个区间会顺序访问
    LibC.INSTANCE.madvise(pointer, new NativeLong(fileSize), 
                          LibC.MADV_WILLNEED);
    
    // ★ mlock 锁定到物理内存
    LibC.INSTANCE.mlock(pointer, new NativeLong(fileSize));
}
```

```
为什么要预热？
  • mmap 初始映射时只是虚拟地址，没真实分配物理页
  • 第一次写每页都触发缺页中断 → 抖动
  • 预热相当于"提前分配"，写入时直接命中
```

---

## 七、读写分离路径总结

### 7.1 写路径

```
普通模式：
  业务 → MappedByteBuffer → PageCache → 磁盘
       (1 次拷贝)         (OS 异步)

Transient 模式：
  业务 → DirectByteBuffer (mlock) → MappedByteBuffer → PageCache → 磁盘
       (1 次拷贝)              (commit 拷贝)         (OS 异步)
```

### 7.2 读路径（都走 mmap）

```
Consumer 拉消息：
  请求 → Broker
       → SelectMappedBufferResult 从 mappedByteBuffer slice
       → 用 transferTo 走 sendfile 零拷贝
       → Consumer

→ 读永远走 PageCache，不进 Java 堆
```

---

## 八、监控点

```
MappedFile 维度：
  • mappedFiles.size()：当前文件数
  • wrotePosition：写入位置
  • flushedPosition：刷盘位置
  • commitPosition：commit 位置
  • 写入 RT 直方图

TransientStorePool 维度：
  • availableBuffers.size()：池剩余 buffer
  • borrowBuffer 失败次数

PageCache 维度：
  • free -h：MemFree / Buffers / Cached
  • vmstat 1：si/so（swap）、bi/bo（block IO）
```

---

## 九、坑与最佳实践

### 9.1 mlock 失败

```
LibC.INSTANCE.mlock 需要权限：
  • root 用户：无限制
  • 普通用户：受 RLIMIT_MEMLOCK 限制（默认 64KB）

→ /etc/security/limits.conf 配置：
  rocketmq soft memlock unlimited
  rocketmq hard memlock unlimited
```

### 9.2 Transient Pool 突然耗尽

```
现象：
  Producer 突然 RT 飙升

原因：
  CommitRealTimeService 卡住（磁盘满 / 异常）
  → 池里的 buffer 用完不还
  → 业务线程获取不到 buffer → 阻塞

排查：
  • 看磁盘空间
  • 看 commit RT
  • 看 mappedFile 是否阻塞
```

### 9.3 大文件分配卡顿

```
1GB MappedFile 第一次分配：
  ① 创建文件
  ② mmap
  ③ 预热（写每个 page）
  ④ mlock

→ 耗时几十秒（SSD）到分钟级（HDD）

优化：
  ✓ 提前预创建下一个文件（allocateNextFileService）
  ✓ 不等满了再创建
```

---

## 十、一句话记住核心

> **MappedFile = mmap 大文件 + 三个 position (write/commit/flush)。**
>
> **两条写路径**：
> - 普通：业务 → mappedByteBuffer → PageCache（简单稳定）
> - Transient：业务 → 堆外 mlock buffer → mappedByteBuffer → PageCache（性能更稳，多占内存）
>
> **核心优化**：mmap 零拷贝 + mlock 防换出 + 预热消除缺页 + 双 buffer 隔离 PageCache 抖动。
>
> CommitLog 单机 100W TPS 的秘密，都在这一层。
