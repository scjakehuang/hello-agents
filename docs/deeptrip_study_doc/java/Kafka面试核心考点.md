# Kafka 面试核心考点

> **更新时间**: 2026-04-16

---

## 一、核心架构

```
┌──────────────────────────────────────────────────────────────┐
│                    Kafka 集群架构                              │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Producer                                                     │
│     │                                                         │
│     ▼                                                         │
│  ┌──────────────────────────────────────────────────┐        │
│  │               Broker 集群 (Kafka Server)          │        │
│  │                                                    │        │
│  │  ┌─────────────┐  ┌─────────────┐                │        │
│  │  │  Broker 0   │  │  Broker 1   │  Broker 2     │        │
│  │  │ (Controller) │  │             │               │        │
│  │  │  P0-L  P1-F │  │  P0-F  P1-L│  P0-F  P1-F   │        │
│  │  └─────────────┘  └─────────────┘                │        │
│  │                                                    │        │
│  │  Topic: order-events (2 Partition, 2 Replica)     │        │
│  │  P0 = Partition 0, P1 = Partition 1               │        │
│  │  L = Leader, F = Follower                         │        │
│  └──────────────────────────────────────────────────┘        │
│     │                                                         │
│     ▼                                                         │
│  Consumer Group A        Consumer Group B                     │
│  ├── Consumer 1 (P0)    ├── Consumer 3 (P0, P1)             │
│  └── Consumer 2 (P1)    └── Consumer 4                      │
│                                                               │
│  ┌──────────────────────────────────────────────────┐        │
│  │            ZooKeeper / KRaft (元数据管理)          │        │
│  └──────────────────────────────────────────────────┘        │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 核心概念

| 概念 | 说明 |
|------|------|
| Broker | Kafka 服务节点 |
| Topic | 消息主题，逻辑分类 |
| Partition | 分区，Topic 的物理分片，有序 |
| Replica | 副本，分区的备份 |
| Leader/Follower | 副本角色，Leader 读写，Follower 同步 |
| Consumer Group | 消费者组，组内竞争，组间广播 |
| Offset | 消息在分区中的位置 |

---

## 二、高可用机制

### 2.1 副本同步

```
┌──────────────────────────────────────────────────────────┐
│                  ISR 机制                                  │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  ISR (In-Sync Replicas)：与 Leader 同步的副本集合         │
│  OSR (Out-of-Sync Replicas)：落后太多的副本               │
│  AR = ISR + OSR (All Replicas)                           │
│                                                           │
│  判断条件：                                               │
│  replica.lag.time.max.ms = 10000（默认10秒）             │
│  Follower 超过此时间未同步 → 移出 ISR                    │
│                                                           │
│  Leader 选举：                                            │
│  ├── 优先从 ISR 中选举                                    │
│  ├── ISR 为空时看 unclean.leader.election.enable         │
│  │   ├── true：允许非 ISR 副本当选（可能丢数据）         │
│  │   └── false：分区不可用（保证一致性）                  │
│  └── Controller 负责选举和分区分配                        │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

### 2.2 HW 与 LEO

```
┌──────────────────────────────────────────────────────────┐
│            HW (High Watermark) 与 LEO                     │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  LEO (Log End Offset)：每个副本的日志末尾偏移量           │
│  HW  (High Watermark) ：所有 ISR 副本中最小的 LEO        │
│                                                           │
│  消费者只能消费到 HW 之前的消息                            │
│                                                           │
│  Leader:     [0] [1] [2] [3] [4] [5] [6]    LEO=7       │
│                                ↑ HW=5                     │
│  Follower1:  [0] [1] [2] [3] [4]           LEO=5        │
│  Follower2:  [0] [1] [2] [3]               LEO=4  ← 最小│
│                                                           │
│  HW = min(LEO of all ISR replicas) = 4                  │
│                                                           │
│  数据一致性保证：                                          │
│  1. Producer 写入 Leader                                  │
│  2. Follower 拉取并写入本地                               │
│  3. Leader 更新 HW = min(所有 ISR LEO)                   │
│  4. Follower 更新自己的 HW                                │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

---

## 三、生产者

### 3.1 发送模式

| 模式 | 说明 | 场景 |
|------|------|------|
| sync | 等待 ACK | 重要数据，不丢 |
| async | 不等待 ACK | 日志，允许少量丢 |
| fire-and-forget | 发完不管 | 监控指标 |

### 3.2 分区策略

| 策略 | 说明 |
|------|------|
| 指定 Partition | 直接发送到指定分区 |
| 指定 Key | hash(key) % partition_num，相同 Key 进同一分区 |
| 无 Key | 轮询（Round Robin）或粘性分区（Sticky Partitioner） |
| 自定义 | 实现 Partitioner 接口 |

### 3.3 ACK 确认机制

```
acks=0    Producer 不等 Broker 确认，最高吞吐，可能丢数据
acks=1    等 Leader 确认，Leader 挂了可能丢
acks=all  等所有 ISR 确认，最安全，吞吐最低

生产环境建议：acks=all + min.insync.replicas=2
```

---

## 四、消费者

### 4.1 Rebalance

```
┌──────────────────────────────────────────────────────────┐
│                  Rebalance 触发条件                        │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  1. 消费者组成员变化（加入/退出）                          │
│  2. 订阅 Topic 数量变化                                   │
│  3. 订阅 Topic 分区数变化                                 │
│                                                           │
│  分配策略：                                               │
│  ├── RangeAssignor        按分区范围均分                  │
│  ├── RoundRobinAssignor   轮询分配                        │
│  └── StickyAssignor       尽量保持原有分配（推荐）        │
│                                                           │
│  Rebalance 问题：                                         │
│  ├── STW：所有消费者暂停消费                              │
│  ├── 频繁 Rebalance 导致消费延迟                          │
│  └── 解决：                               │
│      ├── session.timeout.ms 调大（检测超时）              │
│      ├── heartbeat.interval.ms 调小（心跳频率）           │
│      ├── max.poll.interval.ms 调大（处理超时）            │
│      └── 避免消费者处理时间过长                           │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

### 4.2 Offset 管理

```yaml
# 自动提交（默认）
enable.auto.commit: true
auto.commit.interval.ms: 5000

# 手动提交（推荐）
enable.auto.commit: false

# 同步提交
consumer.commitSync();

# 异步提交
consumer.commitAsync();

# 最佳实践：异步 + 同步组合
try {
    while (true) {
        ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
        for (ConsumerRecord<String, String> record : records) {
            process(record);
        }
        consumer.commitAsync();  // 异步提交，性能好
    }
} finally {
    consumer.commitSync();      // 关闭前同步确保提交
}
```

---

## 五、消息可靠性

### 5.1 三端保证

```
┌──────────────────────────────────────────────────────────┐
│                消息可靠性三端保证                          │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  Producer 端（不丢）：                                     │
│  ├── acks=all                                             │
│  ├── retries > 0（配合幂等 Producer）                     │
│  ├── enable.idempotence=true（防重复）                    │
│  └── max.in.flight.requests.per.connection=5（幂等时）    │
│                                                           │
│  Broker 端（不丢）：                                       │
│  ├── min.insync.replicas=2                                │
│  ├── unclean.leader.election.enable=false                 │
│  └── replication.factor >= 3                              │
│                                                           │
│  Consumer 端（不丢/不重复）：                              │
│  ├── enable.auto.commit=false                             │
│  ├── 手动提交 Offset                                      │
│  └── 消费幂等（业务去重）                                 │
│                                                           │
│  Exactly-Once 语义：                                      │
│  ├── Producer 幂等（PID + Sequence Number）               │
│  ├── 事务（跨分区原子写入）                                │
│  └── Consumer 端需业务保证                                │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

---

## 六、高频面试题

| 问题 | 核心答案 |
|------|----------|
| Kafka 为什么快？ | 顺序写磁盘 + 零拷贝（sendfile） + 页缓存 + 批量压缩 |
| 分区数怎么定？ | 吞吐量目标 / 单分区吞吐量；一般不超过集群Broker数×2 |
| Kafka 如何保证消息有序？ | 单分区内有序；多分区全局无序。要全局有序只能单分区 |
| 消息积压怎么处理？ | 增加消费者 / 临时扩容分区 / 跳过非关键消息 |
| Kafka 和 RocketMQ 的区别？ | Kafka 吞吐高适合大数据；RocketMQ 事务消息+延迟消息适合业务 |
| 零拷贝原理？ | sendfile() 系统调用，数据直接从页缓存到网卡，不经过用户空间 |
