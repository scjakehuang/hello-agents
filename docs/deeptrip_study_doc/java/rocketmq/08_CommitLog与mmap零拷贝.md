# CommitLog + mmap + 零拷贝（写入性能的灵魂）

为什么 RocketMQ 单机能扛 50W TPS、写入磁盘能跑到 600MB/s？答案在 **顺序写 + mmap + PageCache + transferTo** 这套组合拳。

---

## 一、CommitLog 的物理结构

### 1.1 文件布局

```
${ROCKETMQ_HOME}/store/commitlog/
├── 00000000000000000000          ← 文件名 = 起始物理 offset
├── 00000000001073741824          ← = 1073741824 = 1 GB
├── 00000000002147483648          ← = 2 GB
└── 00000000003221225472          ← = 3 GB

每个文件固定 1 GB（mappedFileSizeCommitLog）
所有 Topic 的所有消息混合追加写入
```

### 1.2 单条消息的存储格式（变长）

```
┌───────────────────────────────────────────────────────────────┐
│ TOTALSIZE      (4B)   ← 消息总长度（含 header）                  │
│ MAGICCODE      (4B)   ← 魔数 0xDAA320A7（区分文件结束符）        │
│ BODYCRC        (4B)   ← 消息体 CRC                              │
│ QUEUEID        (4B)   ← MessageQueue 编号                       │
│ FLAG           (4B)   ← 业务标志（用户自定义）                   │
│ QUEUEOFFSET    (8B)   ← 在 ConsumeQueue 的逻辑偏移              │
│ PHYSICALOFFSET (8B)   ← 在 CommitLog 的物理偏移                 │
│ SYSFLAG        (4B)   ← 事务/压缩/批量等系统标志                 │
│ BORNTIMESTAMP  (8B)   ← 客户端发送时间                          │
│ BORNHOST       (8B)   ← 客户端 IP+Port                         │
│ STORETIMESTAMP (8B)   ← Broker 落盘时间                         │
│ STOREHOSTADDR  (8B)   ← Broker IP+Port                         │
│ RECONSUMETIMES (4B)   ← 重试次数                               │
│ PREPARED_TRANS (8B)   ← 事务 prepared 偏移（事务消息用）         │
│ BODYLEN        (4B) │ BODY        (变长)  ← 消息体             │
│ TOPICLEN       (1B) │ TOPIC       (变长)  ← Topic 名           │
│ PROPERTIESLEN  (2B) │ PROPERTIES  (变长)  ← 自定义属性 + tag    │
└───────────────────────────────────────────────────────────────┘

关键点：
  • 变长设计 → 节省空间
  • 末尾不足 8B 时写入 BLANK 魔数 0xBBCCDDEE + size，防止跨文件读
```

### 1.3 文件名 = 起始 offset 的妙处

```java
// 给定物理 offset，定位文件 + 文件内偏移
long fileFromOffset = (offset / fileSize) * fileSize;
long pos            = offset % fileSize;

// 例：offset=2_500_000_000
//   fileFromOffset = 2_147_483_648
//   pos            = 352_516_352
//   → 打开文件 "00000000002147483648"
//   → mmap.position(352_516_352) 直接读

→ 文件名直接当索引用，O(1) 定位，无需任何元数据查询
```

---

## 二、mmap：内存映射文件

### 2.1 传统 IO vs mmap

```
传统 IO 读文件：
┌─────────────────────────────────────────────────────────┐
│ 用户态                                                    │
│   FileInputStream.read(buf)                              │
│              │                                            │
│              ▼  ── 用户态 → 内核态切换                    │
│   ┌───────── syscall ─────────┐                          │
│   │                             │                         │
│ 内核态                                                    │
│   read() → 从磁盘读到 PageCache → 拷贝到用户空间 buf      │
│                                  ↑                        │
│                          ★ 1 次内核→用户拷贝              │
└─────────────────────────────────────────────────────────┘

mmap 读文件：
┌─────────────────────────────────────────────────────────┐
│ 用户态                                                    │
│   ByteBuffer buf = channel.map(...)                      │
│              │                                            │
│              ▼  ── 一次性建立映射                         │
│ 内核态                                                    │
│   PageCache 的物理页 ↔ 用户进程虚拟地址空间               │
│              │                                            │
│              ▼                                            │
│   buf.get() → 直接读 PageCache，无拷贝                    │
│                                  ↑                        │
│                          ★ 0 次拷贝                       │
└─────────────────────────────────────────────────────────┘
```

### 2.2 RocketMQ 的 mmap 应用

```java
// MappedFile.java （简化）
public class MappedFile {
    private FileChannel    fileChannel;
    private MappedByteBuffer mappedByteBuffer;  // ← mmap 后的 buffer
    
    public MappedFile(String fileName, int fileSize) {
        this.file        = new File(fileName);
        this.fileChannel = new RandomAccessFile(file, "rw").getChannel();
        // ★ 关键调用：把 1G 文件映射到进程虚拟地址空间
        this.mappedByteBuffer = fileChannel.map(
            MapMode.READ_WRITE, 0, fileSize);
    }
    
    public boolean appendMessage(byte[] data) {
        int currentPos = wrotePosition.get();
        // 直接写 mmap，不调 write() 系统调用
        mappedByteBuffer.position(currentPos);
        mappedByteBuffer.put(data);
        wrotePosition.addAndGet(data.length);
        return true;
    }
}
```

**写入路径**：

```
producer.send()
    │
    ▼
mappedByteBuffer.put(data)
    │
    ▼
写入进程虚拟地址 → MMU 转换 → 物理 PageCache 页
    │
    │ （返回 ACK）
    │
    │ ← OS 后台 pdflush 异步刷盘
    │     （或 force() 主动 fsync）
    ▼
磁盘
```

### 2.3 mmap 的代价（必须知道的坑）

| 坑 | 说明 | 应对 |
|---|---|---|
| **缺页中断** | 第一次访问某页要从磁盘加载到 PageCache，会卡住 | 文件预热（warm up） |
| **内存压力** | mmap 占用进程虚拟地址，64-bit 系统不是问题，32-bit 致命 | 不支持 32-bit |
| **超时风险** | PageCache 不命中时 mmap 读会同步阻塞，可能 100ms+ | 分级告警 + SSD |
| **释放慢** | `MappedByteBuffer` 没显式 unmap API，靠 GC 触发 `Cleaner` | 反射调 `Cleaner.clean()` 主动释放 |

### 2.4 文件预热（Warm Up）

```java
// MappedFile.warmMappedFile()
public void warmMappedFile(FlushDiskType type, int pages) {
    ByteBuffer buf = mappedByteBuffer.slice();
    int flush = 0;
    
    // 每隔 4KB（一页）写一个字节，强制分配物理页
    for (int i = 0, j = 0; i < fileSize; i += OS_PAGE_SIZE, j++) {
        buf.put(i, (byte) 0);
        
        // 每写 1000 页主动 sleep 让出 CPU，避免影响业务
        if (j % 1000 == 0) {
            Thread.sleep(0);
        }
    }
    
    // mlock 锁住内存，防止被 swap 出去
    this.mlock();
}
```

**为什么要预热**：mmap 只是建立"映射"，并没有真正分配物理页。第一次写入新页时会触发缺页中断（Major Page Fault），耗时几百微秒到几毫秒。预热后第一次写就是纯内存操作。

---

## 三、PageCache：性能的真正秘密

### 3.1 什么是 PageCache？

```
                    用户进程
                       │
                       │ read/write/mmap
                       ▼
   ┌─────────────────────────────────────────────┐
   │         OS PageCache（内核页缓存）            │
   │   按 4KB 一页缓存最近访问过的文件内容          │
   │                                                │
   │   读：先查 PageCache，不命中才读磁盘           │
   │   写：先写 PageCache，pdflush 后台刷盘         │
   └─────────────────────────────────────────────┘
                       │
                       ▼
                     磁盘
```

### 3.2 RocketMQ 怎么榨干 PageCache？

```
设计选择：

① 顺序写 CommitLog
   → PageCache 命中率 100%（写入页都是热的）
   → 写盘几乎等于写内存

② 顺序读 CommitLog（消费时）
   → OS 预读机制（read-ahead）会自动加载后续页
   → 拉一条消息时，下一批已经在 PageCache 里了

③ ConsumeQueue 全部 mmap
   → 5.72MB/file，1 万条消息只占 ~200KB
   → 全部能塞进 PageCache，查索引 = 查内存

④ CommitLog 1G/file
   → 文件大但分块管理，按需加载
   → SSD 上随机读也很快
```

### 3.3 PageCache 失效的灾难

```
正常情况（PageCache 命中）：
  Consumer 拉消息 RT < 1ms

PageCache 失效场景：
  ① 大量冷消息消费（offset 落后很多）
     → 要从磁盘读 CommitLog
     → RT 飙升到 50~500ms

  ② OS 内存压力大
     → PageCache 被回收
     → 后续读全部缺页

  ③ 多个 Topic 抢 PageCache（缓存抖动）
     → 命中率下降

排查指标：pageCacheRT、磁盘 IO util
应对：
  • SSD（NVMe 更佳）
  • 充足内存（msg 总量的 30%+）
  • 隔离冷热消费者
  • 开 transientStorePoolEnable（见下文）
```

---

## 四、零拷贝：transferTo 让消费侧也飞起来

### 4.1 传统消费链路（4 次拷贝 + 4 次切换）

```
Consumer 拉消息：

磁盘文件
   │ ① read 系统调用（用户态 → 内核态）
   ▼
PageCache
   │ ② 拷贝到用户态 buffer
   ▼
应用 buffer
   │ ③ write 到 socket buffer（用户态 → 内核态）
   ▼
Socket Buffer
   │ ④ DMA 拷贝到网卡
   ▼
网卡 → 网络

→ 4 次拷贝、4 次用户/内核态切换
```

### 4.2 sendfile / transferTo（2 次拷贝 + 2 次切换）

```java
// FileChannel.transferTo() → 底层调用 sendfile()
fileChannel.transferTo(position, count, socketChannel);
```

```
磁盘文件
   │ ① DMA 加载到 PageCache
   ▼
PageCache
   │ ② DMA gather copy 到网卡（不经用户态！）
   ▼
网卡 → 网络

→ 2 次 DMA 拷贝、2 次切换、CPU 不参与
```

### 4.3 RocketMQ 的零拷贝实现

```java
// SelectMappedBufferResult → Netty 的 FileRegion
public class ManyMessageTransfer extends AbstractReferenceCounted 
        implements FileRegion {
    
    private final ByteBuffer byteBufferHeader;
    private final SelectMappedBufferResult selectMappedBufferResult;
    
    @Override
    public long transferTo(WritableByteChannel target, long position) {
        // ★ 用 transferTo，不经用户态
        if (this.byteBufferHeader.hasRemaining()) {
            return target.write(this.byteBufferHeader);
        }
        ByteBuffer body = selectMappedBufferResult.getByteBuffer();
        if (body.hasRemaining()) {
            return target.write(body);
        }
        return 0;
    }
}
```

**Consumer 拉一批消息**：CommitLog mmap → 直接 transferTo Socket → CPU 完全不参与消息体的搬运。

### 4.4 为什么不用 mmap 直接传？

```
mmap 也能让数据进用户态后再 write 到 socket，但还是有：
  PageCache → 用户虚拟空间 → Socket buffer
  仍然有一次 CPU 拷贝

transferTo 是真正的零 CPU 拷贝：
  PageCache 内核空间 → 直接 → Socket buffer (DMA gather)
```

---

## 五、TransientStorePool：写入再加速

### 5.1 默认写入路径

```
producer.send()
    ↓
mappedByteBuffer.put()  ← 直接写 PageCache（mmap）
    ↓
PageCache
    ↓ (pdflush 异步)
磁盘
```

问题：如果消息写入速度 > pdflush 速度，PageCache 满了 → 业务线程被阻塞。

### 5.2 开启 TransientStorePool 后

```java
// broker.conf
transientStorePoolEnable=true
transientStorePoolSize=5  // 5 个 1G 的 DirectByteBuffer
```

```
producer.send()
    ↓
writeBuffer.put()       ← 写堆外 DirectByteBuffer（非 mmap）
    ↓
TransientStorePool（堆外内存池）
    ↓ (CommitRealTimeService 后台 commit)
fileChannel.write()     ← 写到 PageCache
    ↓
PageCache
    ↓ (pdflush 或 force)
磁盘
```

**好处**：

| 维度 | 默认 mmap 写 | TransientStorePool |
|---|---|---|
| 写入路径 | 直接 PageCache | 先堆外，再异步 commit 到 PageCache |
| 抗抖动 | PageCache 紧张时业务卡 | 堆外内存隔离，业务不卡 |
| 数据可靠性 | 同 OS 崩溃丢失 | 同 OS 崩溃丢失 + Broker 进程崩溃丢失 |
| 适用场景 | 一般场景 | 高吞吐 + SSD + 进程稳定 |

**代价**：堆外内存额外占用 + 一份"未刷"数据可能丢。所以 SYNC_MASTER 不要开 TransientStorePool。

---

## 六、写入流程全景

```
┌──────────────────────────────────────────────────────────────────┐
│                   producer.send(msg)                              │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
            CommitLog.putMessage()
                            │
                            │ ① 选活跃 MappedFile（最后一个 1G 文件）
                            ▼
            MappedFile.appendMessage()
                            │
            ┌───────────────┼───────────────┐
            │ 默认           │ 开 TransientStorePool
            ▼               ▼
        mappedByteBuffer.put()    writeBuffer.put()
            │                       │
            ▼                       ▼
        ★ PageCache             ★ DirectByteBuffer (堆外)
            │                       │
            │                       │ CommitRealTimeService
            │                       │ 异步提交
            │                       ▼
            │                   fileChannel.write()
            │                       │
            │                       ▼
            └─────────────────► ★ PageCache
                                    │
                                    │ ② 刷盘策略
                  ┌─────────────────┼─────────────────┐
                  ▼                                   ▼
            SYNC_FLUSH                         ASYNC_FLUSH
            mappedByteBuffer.force()           FlushRealTimeService
                  │                            每 500ms force()
                  │                                   │
                  └─────────────┬─────────────────────┘
                                ▼
                        ★ 磁盘 (CommitLog 1G/file)
                                │
                                │ ③ 异步分发
                                ▼
                        ReputMessageService
                                │
                  ┌─────────────┴─────────────┐
                  ▼                           ▼
           ConsumeQueue 索引            IndexFile 哈希索引
                  │                           │
                  ▼                           ▼
        ④ 唤醒长轮询的 Pull Request
                                │
                                ▼
                        Consumer 拉到消息
                                │
                                │ ⑤ 零拷贝发送
                                ▼
                        FileChannel.transferTo(socket)
                                │
                                ▼
                              网络
```

---

## 七、性能数字（经验值）

| 操作 | 单条 RT | 单机吞吐 |
|---|---|---|
| mmap 写 PageCache | < 1us | 100W TPS（理论） |
| ASYNC_FLUSH 落盘 | 10ms 级 | 50W TPS（实际） |
| SYNC_FLUSH 落盘 | 1~10ms | 1~5W TPS |
| transferTo 发送（命中 PageCache） | < 1ms | 受网卡限制 |
| transferTo 发送（PageCache 失效） | 50~500ms | 大幅下降 |

---

## 八、运维关键参数

```bash
# broker.conf

# CommitLog 单文件大小（默认 1G）
mapedFileSizeCommitLog=1073741824

# 刷盘策略
flushDiskType=ASYNC_FLUSH  # 或 SYNC_FLUSH

# 异步刷盘间隔（毫秒）
flushIntervalCommitLog=500
flushCommitLogLeastPages=4   # 累积 4 页（16KB）才刷
flushCommitLogThoroughInterval=10000  # 强制刷盘间隔 10s

# TransientStorePool
transientStorePoolEnable=false
transientStorePoolSize=5

# 文件预热
warmMapedFileEnable=true     # 4.x 默认 false，建议开

# OS 层面优化（系统参数）
vm.dirty_background_ratio=10  # 后台刷盘阈值
vm.dirty_ratio=40             # 强制同步刷盘阈值
vm.swappiness=1               # 尽量不 swap
```

---

## 九、一句话记住核心

> **CommitLog 顺序追加写 + mmap 写入 + PageCache 缓存 + transferTo 零拷贝发送 = 单机 50W TPS。**
>
> 写入：用户进程 `put()` → 内核 PageCache（无拷贝） → 后台 fsync 磁盘。
>
> 消费：磁盘 → PageCache（DMA） → 网卡（DMA gather，CPU 不参与）。
>
> 整条链路上，CPU 几乎不搬运消息体，只搬指针。这就是 RocketMQ 性能的根本。
