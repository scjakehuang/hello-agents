# ConsumeQueue 的物理结构（为什么能 O(1) 定位消息）

这块是 RocketMQ 存储设计最优雅的部分——用**定长索引**把"逻辑队列消费"和"物理顺序写入"完美解耦。

---

## 一、问题背景：RocketMQ 的存储困境

### 1.1 为什么不能像 Kafka 那样「一个 Topic-Partition 一个文件」？

```
Kafka 模型：每个 Partition 一个独立日志文件
  topic-A-partition-0.log
  topic-A-partition-1.log
  topic-B-partition-0.log
  ...

→ 100 个 Topic × 16 Partition = 1600 个文件
→ 同时写入 1600 个文件 = 1600 个磁盘随机点
→ 单机 Topic 数量上去后，IOPS 急剧下降
```

**Kafka 的取舍**：少 Topic、大 Partition、追求极致吞吐。
**RocketMQ 的需求**：海量 Topic（一个公司几千个）、灵活的业务订阅模型。

### 1.2 RocketMQ 的解法：所有 Topic 共用一个 CommitLog

```
所有消息（不管什么 Topic）都顺序追加写到同一个 CommitLog：

  CommitLog（1G 一个文件，文件名 = 起始物理 offset）
  ┌────────────────────────────────────────────────────────────┐
  │ msg(topicA,Q0) │ msg(topicB,Q3) │ msg(topicA,Q5) │ msg... │
  └────────────────────────────────────────────────────────────┘
  ▲ 顺序追加写，磁盘吞吐 600MB/s 不是问题

但问题来了：
  Consumer 要消费 Topic-A 的 Queue-5
  → 怎么从这堆"混杂"的消息里快速找到属于它的？
  → 不能扫全量 CommitLog（每次消费 O(N)，灾难）
```

### 1.3 ConsumeQueue 登场：消费侧的"二级索引"

```
                       CommitLog（物理存储）
  ┌──────────────────────────────────────────────────────────┐
  │ msg1(A,Q0,offset=0)                                       │
  │ msg2(B,Q3,offset=1024)                                    │
  │ msg3(A,Q5,offset=2048)        ★                           │
  │ msg4(A,Q0,offset=3072)                                    │
  │ msg5(A,Q5,offset=4096)        ★                           │
  │ msg6(B,Q3,offset=5120)                                    │
  │ msg7(A,Q5,offset=6144)        ★                           │
  └──────────────────────────────────────────────────────────┘
                         ▲
                         │ 异步分发（ReputMessageService）
                         │
  ┌──────────────────────┴───────────────────────────────────┐
  │           ConsumeQueue（按 Topic + Queue 分桶的索引）       │
  │                                                            │
  │  /store/consumequeue/topicA/0/00000000000000000000          │
  │  /store/consumequeue/topicA/5/00000000000000000000  ★      │
  │     ┌──────────────────────────────┐                       │
  │     │ [2048][msgSize][tagsHash]    │  ← 第 0 个 entry      │
  │     │ [4096][msgSize][tagsHash]    │  ← 第 1 个 entry      │
  │     │ [6144][msgSize][tagsHash]    │  ← 第 2 个 entry      │
  │     └──────────────────────────────┘                       │
  │                                                            │
  │  /store/consumequeue/topicB/3/...                          │
  └────────────────────────────────────────────────────────────┘

Consumer 拉 Topic-A/Q5 的逻辑 offset=1（第 2 条）：
  ① 直接定位 ConsumeQueue 文件第 1 个 entry → physOffset=4096
  ② 用 4096 直接 mmap 读 CommitLog → 拿到完整消息
  
  全程 O(1)
```

---

## 二、ConsumeQueue 文件结构

### 2.1 目录布局

```
${ROCKETMQ_HOME}/store/
├── commitlog/
│   ├── 00000000000000000000          ← 1G 一个文件
│   ├── 00000000001073741824
│   └── 00000000002147483648
│
├── consumequeue/
│   ├── TopicA/
│   │   ├── 0/                        ← Queue-0 目录
│   │   │   ├── 00000000000000000000  ← ConsumeQueue 文件
│   │   │   └── 00000000000006000000
│   │   ├── 1/
│   │   ├── ...
│   │   └── 15/                       ← 16 个 Queue → 16 个目录
│   │
│   └── TopicB/
│       └── ...
│
├── index/                            ← IndexFile（按 MessageKey 检索）
│
├── config/                           ← Topic、订阅、消费进度等元数据
│   ├── topics.json
│   ├── consumerOffset.json
│   └── ...
│
└── checkpoint                        ← 三大文件刷盘进度
```

### 2.2 ConsumeQueue 文件格式（最关键的一段）

```
单个 ConsumeQueue 文件：固定 600 万字节（约 5.72 MB）
   = 30 万个 entry × 20 字节/entry

┌────────────────────────────────────────────────────────────────┐
│ Entry-0  │ Entry-1  │ Entry-2  │ ...  │ Entry-299999            │
│ (20B)    │ (20B)    │ (20B)    │      │ (20B)                  │
└────────────────────────────────────────────────────────────────┘

每个 Entry（20 字节，定长）：
┌──────────────────────┬──────────────┬──────────────────────┐
│ commitLogOffset (8B) │ msgSize (4B) │ tagsCode (8B)         │
└──────────────────────┴──────────────┴──────────────────────┘
   ↑                      ↑              ↑
   消息在 CommitLog       消息总长度     tag 的 hashCode
   的物理偏移量           （含 header）  （long，用于过滤）

文件名 = 起始的逻辑 offset × 20
   例：00000000000000000000  → 起始 entry index = 0
       00000000000006000000  → 起始 entry index = 300000
```

### 2.3 为什么是 20 字节定长？

定长是 O(1) 定位的**根本前提**：

```
要查 Topic-A/Q5 的逻辑 offset=N 的消息：
  ① 文件号 = N / 300000
  ② 文件内偏移 = (N % 300000) × 20
  
直接 mmap 读 20 字节 → 拿到 commitLogOffset
再 mmap CommitLog 的 commitLogOffset → 拿到完整消息

无需遍历，无需查找，纯算术运算
```

如果是变长（像 CommitLog 那样），就得从头扫描或维护额外索引——而 ConsumeQueue 本身就是索引，再套一层就成俄罗斯套娃了。

### 2.4 单文件大小为什么是 600 万字节，不是 1G？

```
设计权衡：
  CommitLog 1G：消息体大，文件少 → 减少文件切换
  ConsumeQueue 5.72MB：纯索引，文件本来就小
  
  300000 个 entry 是个工程经验值：
  • 太小 → 文件切换频繁
  • 太大 → 删除旧消息时回收粒度太粗
  
  按 1000 TPS 算：300000 / 1000 = 300 秒 = 5 分钟产生一个文件
  按 10000 TPS 算：30 秒产生一个文件
  
  → 删除/清理时按文件级粒度，足够灵活
```

---

## 三、O(1) 定位完整流程

### 3.1 Consumer 拉消息：5 步定位

```
Consumer 请求：PULL Topic-A, Queue-5, logicOffset=100050

Broker 侧：

┌──────────────────────────────────────────────────────────────┐
│ Step ①：定位 ConsumeQueue 文件                                │
│                                                                │
│   单文件 entry 数 = 300000                                     │
│   文件起始 entry index = (100050 / 300000) × 300000 = 0       │
│   文件名 = 0 × 20 = "00000000000000000000"                     │
│   →  /store/consumequeue/TopicA/5/00000000000000000000        │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│ Step ②：算文件内偏移                                           │
│                                                                │
│   entry 在文件内的位置 = (100050 % 300000) × 20               │
│                       = 100050 × 20                            │
│                       = 2001000  字节                          │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│ Step ③：mmap 读 20 字节                                        │
│                                                                │
│   ByteBuffer bb = mappedFile.selectMappedBuffer(2001000, 20); │
│   long  commitLogOffset = bb.getLong();    // 8B              │
│   int   msgSize         = bb.getInt();     // 4B              │
│   long  tagsCode        = bb.getLong();    // 8B              │
│                                                                │
│   假设结果：commitLogOffset=8589934592, msgSize=1024           │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│ Step ④（可选）：tag 过滤                                       │
│                                                                │
│   if (subscription 有 tag 过滤) {                              │
│     long expected = "pay".hashCode();                          │
│     if (tagsCode != expected) {                                │
│       skip → 读下一个 entry（offset+1）                        │
│       重新走 Step ③                                            │
│     }                                                          │
│   }                                                            │
│                                                                │
│   ★ 这里是 RocketMQ 比 Kafka 强的地方：                        │
│     在索引层就能过滤，不需要读消息体                            │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│ Step ⑤：用 commitLogOffset 读 CommitLog 拿消息体              │
│                                                                │
│   定位 CommitLog 文件：                                         │
│     fileFromOffset = 8589934592 - (8589934592 % 1G)           │
│                    = 8589934592 - 0                            │
│                    = 8589934592                                │
│     文件名 = "00000000008589934592"                            │
│                                                                │
│   文件内偏移 = 8589934592 % 1G = 0                             │
│                                                                │
│   ByteBuffer msg = commitLogMmap.select(0, msgSize);          │
│   → 拿到完整消息体                                              │
└──────────────────────────────────────────────────────────────┘

整个过程：2 次 mmap 读 + 几次算术运算 = O(1)
```

### 3.2 一次拉取多条的批量优化

```java
// 实际场景：Consumer 一次拉 32 条
// Broker 侧不是循环 32 次上面的流程，而是：

ByteBuffer cqBuffer = mappedConsumeQueue.select(startOffset, 20 * 32);

while (cqBuffer.hasRemaining()) {
    long commitLogOffset = cqBuffer.getLong();
    int  msgSize         = cqBuffer.getInt();
    long tagsCode        = cqBuffer.getLong();
    
    if (!tagMatch(tagsCode, subscription)) continue;
    
    // 累积这一批的物理 offset 范围
    if (firstOffset == -1) firstOffset = commitLogOffset;
    lastOffset = commitLogOffset + msgSize;
    
    // 控制单次拉取大小（防止超过 maxTransferBytes，默认 256KB）
    if (累积 size 超阈值) break;
}

// 一次性 mmap 读 CommitLog 这一段连续区间
ByteBuffer messages = commitLogMmap.select(firstOffset, lastOffset - firstOffset);

// → 一次系统调用返回所有消息（零拷贝 transferTo 到 socket）
```

**这就是 RocketMQ 拉取吞吐高的原因**：连续 entry 通常对应连续 CommitLog 区间（因为同 Queue 消息相邻写入概率高），可以一次 mmap 大块读出。

---

## 四、ConsumeQueue 怎么生成的？

### 4.1 ReputMessageService：异步分发

```
Producer ──▶ CommitLog 写入完成 ──ACK──▶ Producer
                  │
                  │（不等分发，直接 ACK）
                  ▼
        ┌─────────────────────────┐
        │ ReputMessageService      │
        │ 后台线程，每 1ms 循环    │
        └─────────────────────────┘
                  │
                  │ 从 reputFromOffset 开始
                  │ 读取 CommitLog 新增数据
                  ▼
        ┌─────────────────────────┐
        │ 解析消息 header          │
        │ 拿到：                    │
        │   topic, queueId,        │
        │   physicalOffset,        │
        │   msgSize, tagsCode,     │
        │   storeTimestamp, ...    │
        └─────────────────────────┘
                  │
        ┌─────────┴─────────┐
        ▼                    ▼
  ConsumeQueueDispatcher  IndexDispatcher
        │                    │
        │ 追加 20B entry      │ 按 MessageKey 写
        │ 到对应文件           │ Hash 索引（IndexFile）
        ▼                    ▼
  ConsumeQueue 文件       IndexFile
```

### 4.2 关键代码逻辑

```java
class CommitLogDispatcherBuildConsumeQueue implements CommitLogDispatcher {
    public void dispatch(DispatchRequest req) {
        // 跳过事务 Half/Rollback 消息（不该被消费看到）
        if (req.getTranType() == PREPARED || req.getTranType() == ROLLBACK) {
            return;
        }
        
        // 拿到对应的 ConsumeQueue
        ConsumeQueue cq = findConsumeQueue(req.getTopic(), req.getQueueId());
        
        // 追加 20 字节
        cq.putMessagePositionInfo(
            req.getCommitLogOffset(),  // 物理偏移
            req.getMsgSize(),           // 消息大小
            req.getTagsCode(),          // tag 哈希
            req.getConsumeQueueOffset() // 逻辑偏移（用于校验顺序）
        );
    }
}
```

### 4.3 异步分发的影响

| 维度 | 说明 |
|---|---|
| **时延** | 消息写 CommitLog → 可被消费有 1~10ms 延迟（绝大多数 < 1ms） |
| **崩溃恢复** | Broker 重启时 ReputMessageService 从 checkpoint 继续分发 |
| **顺序保证** | 同一 Queue 的 entry 顺序追加，单文件天然顺序 |
| **故障容忍** | ConsumeQueue 损坏可以从 CommitLog 全量重建（删了重启即可） |

---

## 五、为什么 ConsumeQueue 设计这么"简单"？

### 5.1 它是"消息位置摘要"，不是"消息本身"

```
ConsumeQueue 不存：
  ✗ 消息体（body）
  ✗ 完整 properties
  ✗ key
  ✗ 业务字段
  
ConsumeQueue 只存：
  ✓ 我在 CommitLog 哪个位置（commitLogOffset）
  ✓ 我多大（msgSize）
  ✓ 我的 tag hash（tagsCode，用于过滤）
  
→ 消息体始终只在 CommitLog 一份，不重复存储
→ ConsumeQueue 总大小 ≈ 消息条数 × 20B
```

举例：

```
1 亿条消息，每条 1KB
  CommitLog 大小  = 1 亿 × 1KB ≈ 100 GB
  ConsumeQueue 大小 = 1 亿 × 20B ≈ 2 GB（如果是单 Topic 单 Queue）
                    = 2 GB ÷ Queue 数量（实际分散到多个 Queue）
  
→ ConsumeQueue 可以全部 mmap 进内存（PageCache 命中率近 100%）
→ 查 ConsumeQueue 几乎等于查内存
```

### 5.2 "消息存一份，索引存多份"思想

```
                CommitLog（消息存一份）
                         │
          ┌──────────────┼──────────────┬────────────┐
          ▼              ▼              ▼            ▼
   ConsumeQueue     ConsumeQueue    IndexFile    （未来扩展）
    (TopicA/Q0)      (TopicA/Q5)   (按 MsgKey)
         ↑               ↑              ↑
   按队列消费       按队列消费     按业务 key 查询
```

**索引层可以加无数种**（按 tag、按 key、按时间戳…），都不影响 CommitLog 的写入性能。这是经典的"读写分离"思想。

---

## 六、和 Kafka 的对比

| 维度 | Kafka | RocketMQ |
|---|---|---|
| **存储模型** | 每 Partition 一个日志文件 | 所有消息共用 CommitLog + 每 Queue 一个 ConsumeQueue |
| **磁盘 IO** | 多 Topic 时随机 IO 严重 | 始终顺序 IO（写入只动 CommitLog） |
| **索引开销** | 每 Partition 自带稀疏索引 .index | 每 Queue 一个 ConsumeQueue（定长稠密索引） |
| **定位方式** | 二分查找 .index → 物理偏移 → 顺序扫描日志找精确位置 | O(1) 算术定位 ConsumeQueue → mmap 读 CommitLog |
| **Tag 过滤** | 不支持服务端过滤 | 支持（tagsCode 在索引层） |
| **海量 Topic** | 10000+ Topic 时性能崩溃 | 50000+ Topic 仍稳定 |
| **写吞吐** | 单机 100W TPS | 单机 50W TPS |
| **读吞吐** | 略高（直接读分区文件） | 略低（多一次索引跳转，但仍很快） |

---

## 七、运维相关

### 7.1 ConsumeQueue 损坏怎么办？

```bash
# 1. 停 Broker
# 2. 删除整个 consumequeue 目录
rm -rf /store/consumequeue
# 3. 启动 Broker
# 4. ReputMessageService 会从 CommitLog 重建所有 ConsumeQueue
```

启动会慢一些（几分钟到几十分钟，看 CommitLog 总量），但数据不丢——**ConsumeQueue 是 CommitLog 的派生物**。

### 7.2 文件清理

```
默认配置：
  fileReservedTime=72   # CommitLog 保留 72 小时
  
清理时机：每天凌晨 4 点 + 磁盘超过阈值时
  ① 先删 CommitLog 过期文件
  ② ConsumeQueue 检测到对应 CommitLog 已删除 → 删自己对应的 entry/文件
  
注意：
  ConsumeQueue 自己不按时间删，而是按"对应的 CommitLog 是否还在"
  → 永远不会出现"索引指向已删消息"
```

### 7.3 监控关键指标

| 指标 | 含义 | 告警阈值 |
|---|---|---|
| `dispatchBehindBytes` | ReputMessageService 落后 CommitLog 的字节数 | > 100MB 告警（分发跟不上写入） |
| `pageCacheRT` | mmap 读 ConsumeQueue 的耗时 | > 50ms 告警（PageCache 失效） |
| `getMessageEntireTimeMax` | 拉一次消息总耗时 | > 1s 告警 |

---

## 八、一句话记住核心

> **ConsumeQueue = 定长 20 字节索引数组，按 (Topic, Queue) 分桶，逻辑 offset 直接当数组下标。**
>
> 消息体永远只在 CommitLog 顺序写一份；ConsumeQueue 只是"指针表"，让消费侧能 O(1) 找到消息物理位置。
>
> 这就是 RocketMQ 同时支持「海量 Topic」+「高吞吐」+「服务端 tag 过滤」的根本原因。

---

## 完整存储架构图

```
                          Producer
                              │
                              ▼
   ┌───────────────────────────────────────────────────────────┐
   │                    CommitLog (顺序追加写)                   │
   │  1G/file，所有 Topic 共用，磁盘吞吐拉满                      │
   │  ┌────┬────┬────┬────┬────┬────┬────┬────┬────┐           │
   │  │msg1│msg2│msg3│msg4│msg5│msg6│msg7│msg8│... │           │
   │  └────┴────┴────┴────┴────┴────┴────┴────┴────┘           │
   └─────────────────────┬─────────────────────────────────────┘
                          │
                          │ ReputMessageService 异步分发（1ms 循环）
                          │
        ┌─────────────────┼─────────────────────┐
        ▼                 ▼                     ▼
  ┌────────────┐    ┌────────────┐       ┌────────────┐
  │ConsumeQueue│    │ConsumeQueue│       │ IndexFile  │
  │TopicA/Q0   │    │TopicA/Q5   │       │ 按 MsgKey  │
  │            │    │            │       │ Hash 索引  │
  │ 20B*N entries  │ 20B*N      │       │            │
  │ [phyOffset,│    │ entries    │       │            │
  │  size,     │    │            │       │            │
  │  tagsCode] │    │            │       │            │
  └─────┬──────┘    └─────┬──────┘       └─────┬──────┘
        │                 │                     │
        │ Consumer 拉取    │                     │ 按 key 查
        │ logicOffset → entry → commitLogOffset │
        └────────┐  ┌─────┘                     │
                 ▼  ▼                            │
         回查 CommitLog 拿消息体 ◀───────────────┘
```
