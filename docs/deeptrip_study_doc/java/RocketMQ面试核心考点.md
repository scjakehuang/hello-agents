# RocketMQ 面试核心考点

> **更新时间**: 2026-04-16

---

## 一、核心架构

```
┌──────────────────────────────────────────────────────────────┐
│                    RocketMQ 集群架构                           │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────┐                                                  │
│  │ Producer │                                                  │
│  └────┬────┘                                                  │
│       │                                                       │
│       ▼                                                       │
│  ┌──────────────────────────────────────────────────┐        │
│  │              NameServer 集群（无状态）              │        │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐       │        │
│  │  │NameServer│  │NameServer│  │NameServer│       │        │
│  │  │   1      │  │   2      │  │   3      │       │        │
│  │  └──────────┘  └──────────┘  └──────────┘       │        │
│  │  各节点独立，不互相通信                             │        │
│  └──────────────────────────────────────────────────┘        │
│       │                                                       │
│       ▼                                                       │
│  ┌──────────────────────────────────────────────────┐        │
│  │              Broker 集群                           │        │
│  │  ┌─────────────────────┐                         │        │
│  │  │  Broker-A (Master)   │◀──▶ Broker-A (Slave)   │        │
│  │  │  Broker-B (Master)   │◀──▶ Broker-B (Slave)   │        │
│  │  └─────────────────────┘                         │        │
│  │  Master 读写，Slave 同步/异步复制                  │        │
│  └──────────────────────────────────────────────────┘        │
│       │                                                       │
│       ▼                                                       │
│  ┌─────────┐                                                  │
│  │Consumer │                                                  │
│  │ Group   │                                                  │
│  └─────────┘                                                  │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 核心概念对比

| 概念 | Kafka 对应 | 说明 |
|------|-----------|------|
| NameServer | ZooKeeper/KRaft | 路由注册与发现，轻量无状态 |
| Broker | Broker | 消息存储与服务 |
| Topic | Topic | 消息主题 |
| Queue | Partition | 分区，Topic 下多个 Queue |
| Consumer Group | Consumer Group | 消费者组 |
| Tag | 无 | 消息标签，同一 Topic 下二级分类 |

---

## 二、消息模型

### 2.1 消费模式

```
┌──────────────────────────────────────────────────────────┐
│                  两种消费模式                              │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  集群消费（Clustering，默认）                              │
│  ├── 同一 Consumer Group 下，每条消息只被一个消费者消费    │
│  ├── Queue 与 Consumer 尽量一一对应                       │
│  └── 适用：业务处理（订单、支付等）                        │
│                                                           │
│  Topic: order-events                                      │
│  Queue0 ──▶ Consumer-A                                    │
│  Queue1 ──▶ Consumer-B                                    │
│  Queue2 ──▶ Consumer-C                                    │
│                                                           │
│  广播消费（Broadcasting）                                  │
│  ├── 每条消息被 Group 下所有消费者消费                     │
│  ├── 各消费者独立 Offset                                   │
│  └── 适用：缓存刷新、配置推送                              │
│                                                           │
│  Topic: config-update                                     │
│  Queue0 ──▶ Consumer-A                                    │
│        ──▶ Consumer-B                                     │
│        ──▶ Consumer-C                                     │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

---

## 三、特色功能

### 3.1 事务消息

```
┌──────────────────────────────────────────────────────────┐
│                事务消息流程（与 Kafka 不同）               │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  1. Producer 发送半消息（Half Message）                    │
│     └─▶ Broker 存到内部 Topic，对 Consumer 不可见         │
│                                                           │
│  2. Broker 返回确认                                       │
│                                                           │
│  3. Producer 执行本地事务                                  │
│                                                           │
│  4. 根据本地事务结果发送二次确认                           │
│     ├── Commit  → 消息对 Consumer 可见                    │
│     └── Rollback → 删除半消息                             │
│                                                           │
│  5. 回查机制（Broker 未收到二次确认时）                    │
│     └─▶ Producer 实现 checkLocalTransaction()             │
│                                                           │
│  与 Kafka 事务的区别：                                     │
│  ├── Kafka 事务：跨分区原子写入（Exactly-Once 语义）      │
│  └── RocketMQ 事务：本地事务与消息发送的原子性            │
│      本质是解决分布式事务问题                              │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

### 3.2 延迟消息

```java
// RocketMQ 延迟消息（开源版支持固定级别）
Message msg = new Message("order-topic", "TagA", "order data".getBytes());
msg.setDelayTimeLevel(3);  // 10秒后投递

// 延迟级别：
// 1s  5s  10s  30s  1m  2m  3m  4m  5m  6m  7m  8m  9m  10m  20m  30m  1h  2h
//  1   2    3    4   5   6   7   8   9  10  11  12  13   14   15   16  17   18

// RocketMQ 5.x 支持任意延迟
msg.setDelayTimeSec(600);   // 任意秒数
msg.setDelayTimeMs(60000L); // 任意毫秒数
```

### 3.3 消息重试与死信

```
┌──────────────────────────────────────────────────────────┐
│              消费重试与死信队列                            │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  消费失败 → 重试（默认16次）                              │
│  重试间隔：10s 30s 1m 2m 3m 4m 5m 6m 7m 8m 9m 10m       │
│            20m 30m 1h 2h                                  │
│                                                           │
│  16次仍失败 → 进入死信队列（DLQ）                         │
│  ├── Topic: %DLQ%ConsumerGroup                           │
│  └── 需人工处理或补偿Job                                  │
│                                                           │
│  配置：                                                   │
│  maxReconsumeTimes = 16    // 最大重试次数                │
│  delayLevel = ...          // 自定义重试间隔              │
│                                                           │
│  代码：                                                   │
│  consumer.registerMessageListener((msgs, context) -> {    │
│      try {                                                │
│          process(msgs);                                   │
│          return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;│
│      } catch (Exception e) {                              │
│          return ConsumeConcurrentlyStatus.RECONSUME_LATER;│
│      }                                                    │
│  });                                                      │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

### 3.4 消息过滤

```java
// Tag 过滤（服务端过滤，高效）
consumer.subscribe("topic", "TagA || TagB");

// SQL92 过滤（服务端过滤，更灵活）
consumer.subscribe("topic",
    MessageSelector.bySql("age > 18 and region = 'BJ'"));

// 消息发送时设置属性
Message msg = new Message("topic", "TagA", "body".getBytes());
msg.putUserProperty("age", "25");
msg.putUserProperty("region", "BJ");
```

---

## 四、存储机制

### 4.1 CommitLog + ConsumeQueue

```
┌──────────────────────────────────────────────────────────┐
│              RocketMQ 存储设计                            │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  CommitLog（所有消息顺序写入一个文件）                     │
│  ┌──────────────────────────────────────────────────┐    │
│  │ Msg1 │ Msg2 │ Msg3 │ Msg4 │ Msg5 │ Msg6 │ ...  │    │
│  │(T1-Q0)│(T1-Q1)│(T2-Q0)│(T1-Q0)│(T2-Q1)│(T1-Q1)│    │
│  └──────────────────────────────────────────────────┘    │
│  顺序写，吞吐极高                                         │
│                                                           │
│  ConsumeQueue（消息索引，按 Topic+Queue 组织）            │
│  ┌─── Topic1-Queue0 ────────────────────┐               │
│  │ offset | size | tagsCode             │               │
│  │   0    |  128 |  hash(TagA)          │               │
│  │  128   |   96 |  hash(TagB)          │               │
│  │  224   |  112 |  hash(TagA)          │               │
│  └──────────────────────────────────────┘               │
│  → 指向 CommitLog 中的消息位置                            │
│  → 支持 Tag 过滤                                         │
│                                                           │
│  优势：                                                   │
│  1. CommitLog 顺序写 → 极高写入性能                      │
│  2. ConsumeQueue 随机读但数据量小 → OS 页缓存命中率高     │
│  3. 同一磁盘共享写入 → 减少磁头寻址                      │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

---

## 五、高频面试题

| 问题 | 核心答案 |
|------|----------|
| NameServer 和 ZooKeeper 的区别？ | NameServer 无状态不通信，部署简单；ZK 有状态强一致但重 |
| RocketMQ 为什么快？ | CommitLog 顺序写 + 零拷贝 + 页缓存 + 异步刷盘 |
| 同步刷盘和异步刷盘？ | 同步：消息写入磁盘才返回，不丢但慢；异步：写入 PageCache 就返回，快但可能丢 |
| 事务消息原理？ | 半消息+本地事务+二次确认+回查，解决分布式事务 |
| 延迟消息怎么实现？ | 开源版固定级别（TimerWheel）；5.x 支持任意延迟 |
| 如何保证消息顺序？ | MessageQueueSelector 发到同一 Queue，单线程消费 |
| RocketMQ vs Kafka？ | RocketMQ：事务消息/延迟消息/Tag过滤/可靠性更强；Kafka：吞吐更高/大数据生态更好 |
