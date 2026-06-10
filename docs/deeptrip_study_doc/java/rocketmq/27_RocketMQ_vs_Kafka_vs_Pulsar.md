# RocketMQ vs Kafka vs Pulsar（消息中间件三巨头终极对比）

选型时绕不开的灵魂三问：吞吐、可靠性、生态。本文从架构到运维全面对比，最后给一张选型决策表。

---

## 一、定位与设计哲学

| 维度 | RocketMQ | Kafka | Pulsar |
|---|---|---|---|
| **诞生背景** | 阿里淘宝大促 | LinkedIn 日志聚合 | Yahoo 多租户 |
| **设计目标** | 业务消息 + 高可靠 | 高吞吐流式数据 | 存算分离 + 多租户 |
| **典型流量** | 百万 TPS（业务消息） | 千万 TPS（日志流） | 百万 TPS（消息流） |
| **核心场景** | 订单/支付/事务 | 日志/数据管道/流计算 | 跨地域 + 弹性扩缩 |

---

## 二、架构对比

### 2.1 RocketMQ 4.x

```
┌────────────┐         ┌────────────┐         ┌────────────┐
│ Producer   │ ──────→ │ Broker     │ ←────── │ Consumer   │
│            │         │ (CommitLog │         │            │
│            │         │ +CQ+Index) │         │            │
└────────────┘         └────────────┘         └────────────┘
                            │
                            ▼
                       ┌────────────┐
                       │ NameServer │  (无状态 + AP)
                       └────────────┘
```

### 2.2 Kafka

```
┌────────────┐         ┌────────────┐         ┌────────────┐
│ Producer   │ ──────→ │ Broker     │ ←────── │ Consumer   │
│            │         │ (Partition │         │ Group      │
│            │         │  Log)      │         │            │
└────────────┘         └────────────┘         └────────────┘
                            │
                            ▼
                       ┌────────────┐
                       │ Zookeeper  │  (有状态 + CP，3.x 后用 KRaft)
                       └────────────┘
```

### 2.3 Pulsar

```
┌────────────┐         ┌────────────┐         ┌────────────┐
│ Producer   │ ──────→ │ Broker     │ ←────── │ Consumer   │
│            │         │ (无状态)    │         │            │
└────────────┘         └────────────┘         └────────────┘
                            │
                            ▼
                       ┌────────────┐
                       │ BookKeeper │  (存储层，Segment-based)
                       └────────────┘
                            │
                            ▼
                       ┌────────────┐
                       │ Zookeeper  │  (元数据，未来可换 etcd)
                       └────────────┘
```

### 2.4 三大架构对比

| 维度 | RocketMQ | Kafka | Pulsar |
|---|---|---|---|
| **协调服务** | NameServer（无状态） | Zookeeper / KRaft | Zookeeper |
| **存储模型** | CommitLog（大文件） | Partition Log（每分区独立） | BookKeeper Segment |
| **存算分离** | ✗（4.x），✓（5.x Proxy） | ✗ | ✓ |
| **副本机制** | 主从复制 / DLedger | ISR（多副本） | Bookkeeper Ensemble |
| **元数据** | 内存 + 文件 | Zookeeper / KRaft | Zookeeper |

---

## 三、存储模型对比

### 3.1 RocketMQ：CommitLog + ConsumeQueue

```
CommitLog（所有 Topic 共享）：
  ┌────────────────────────────────┐
  │ Topic A Msg | Topic B Msg | ...│
  └────────────────────────────────┘
            ↓ 异步分发
  ConsumeQueue/TopicA/0：[offset1, offset3, ...]
  ConsumeQueue/TopicA/1：[offset2, offset5, ...]
  ConsumeQueue/TopicB/0：[offset4, offset6, ...]

优点：
  ✓ 顺序写入磁盘极快
  ✓ Topic 数量无上限（仅多了 ConsumeQueue）
  
缺点：
  ✗ 不利于按 Topic 单独清理
  ✗ 单文件大（1GB）
```

### 3.2 Kafka：Partition Log

```
Topic-A：
  Partition 0：
    segment-0.log
    segment-1.log
  Partition 1：
    segment-0.log

Topic-B：
  Partition 0：
    segment-0.log

每个 Partition 独立文件，每个 Segment 1GB

优点：
  ✓ 每 Topic 独立存储，清理灵活
  ✓ 分区独立扩展
  
缺点：
  ✗ Topic 数量多时小文件多 → IO 抖动
  ✗ 不适合"很多个 Topic + 少量消息"场景
```

### 3.3 Pulsar：Segment + BookKeeper

```
Topic：
  Ledger-1 (Segment) → BookKeeper Bookie-1, Bookie-2, Bookie-3
  Ledger-2 (Segment) → BookKeeper Bookie-2, Bookie-3, Bookie-4
  Ledger-3 (Segment) → BookKeeper Bookie-1, Bookie-3, Bookie-4

每个 Ledger 是不可变的 Segment
Broker 仅记录"哪些 Ledger 属于哪个 Topic"

优点：
  ✓ 真正的存算分离
  ✓ Broker 故障转移秒级
  ✓ 存储节点独立扩展
  
缺点：
  ✗ 架构复杂（多了 BookKeeper 一层）
  ✗ 部署运维成本高
```

---

## 四、消费模型对比

### 4.1 RocketMQ

```
Consumer Group + Queue：
  • Pull 模式：Consumer 与 Queue 一对一独占
  • Pop 模式（5.x）：共享订阅，多 Consumer 抢 Queue

特点：
  ✓ 支持 Tag / SQL92 服务端过滤
  ✓ 支持顺序消息（同 Queue 顺序）
  ✓ 支持广播 + 集群消费
  ✓ 支持事务消息
```

### 4.2 Kafka

```
Consumer Group + Partition：
  • 一个 Partition 同一时刻只能被 Group 内一个 Consumer 消费
  • Group 内通过 Rebalance 分配 Partition

特点：
  ✗ 不支持服务端过滤
  ✓ 单分区顺序保证
  ✗ 不支持广播（需要不同 Group）
  ✗ 4.x 才支持事务消息（且功能有限）
```

### 4.3 Pulsar

```
四种订阅模式：
  • Exclusive（独占）：仅一个 Consumer
  • Shared（共享）：多 Consumer 轮询（无序）
  • Failover（故障转移）：主备
  • Key_Shared：按 Key Hash 到固定 Consumer（有序 + 共享）

特点：
  ✓ 灵活的订阅模式
  ✓ Consumer 数 > Partition 数也能并行（Shared 模式）
  ✗ 没有原生 Tag/SQL 过滤
```

---

## 五、可靠性对比

| 维度 | RocketMQ | Kafka | Pulsar |
|---|---|---|---|
| **同步刷盘** | ✓ SYNC_FLUSH | ✗（依赖 OS） | ✓（journal） |
| **副本同步** | SYNC_MASTER / DLedger | acks=all + min.insync.replicas | ack-quorum |
| **故障切换** | 手动 / Controller / DLedger | 自动（Leader 选举） | 自动 |
| **不丢消息组合** | SYNC_FLUSH + SYNC_MASTER | acks=all + min.insync.replicas≥2 | persistent + ack-quorum |
| **顺序消息** | ✓ | ✓ | ✓ Key_Shared |
| **事务消息** | ✓ 两阶段提交 + 回查 | ✓ Producer 事务 | ✓ |

### 5.1 极端场景

```
Master 整机故障：
  • RocketMQ ASYNC_MASTER：可能丢未同步到 Slave 的消息
  • RocketMQ DLedger：不丢（多数派）
  • Kafka acks=all：不丢（ISR 多数）
  • Pulsar：不丢（Bookie 多数）

机房整体故障：
  • 所有方案都要跨机房部署才能不丢
  • Pulsar 跨地域复制（Geo-replication）原生支持
  • RocketMQ / Kafka 需要 MirrorMaker 或自研同步
```

---

## 六、性能对比

### 6.1 单机吞吐（参考数据）

| 场景 | RocketMQ | Kafka | Pulsar |
|---|---|---|---|
| **1KB 消息** | 100W TPS | 200W TPS | 80W TPS |
| **10KB 消息** | 30W TPS | 50W TPS | 20W TPS |
| **100KB 消息** | 5W TPS | 10W TPS | 3W TPS |
| **延迟 P99** | 5ms | 2ms | 10ms |
| **延迟 P999** | 50ms | 20ms | 100ms |

> 注：实际数据受硬件、配置、消息大小、副本数影响极大，仅供参考。

### 6.2 为什么 Kafka 吞吐最高

```
✓ Producer 端 batch（默认 16KB）
✓ Consumer 端 batch 拉取
✓ Page cache + sendfile 零拷贝
✓ Partition 独立文件 → 多盘并行
✓ 没有 Broker 端过滤开销
✓ ASYNC 写盘 + ISR 副本（性能最优）
```

### 6.3 为什么 RocketMQ 排第二

```
✓ CommitLog 顺序写
✓ mmap + sendfile 零拷贝
✓ Producer 自动批量

✗ 服务端过滤额外开销
✗ Tag/SQL 检查
✗ 默认同步刷盘
```

### 6.4 Pulsar 性能短板

```
✗ Broker → BookKeeper 多一跳网络
✗ Journal 写 + Entry 写 两次磁盘 IO
✗ 元数据操作需要走 Zookeeper

但优势：
  ✓ 多租户 + 隔离性
  ✓ 跨地域复制
  ✓ 真正弹性扩缩
```

---

## 七、功能特性对比

| 特性 | RocketMQ | Kafka | Pulsar |
|---|---|---|---|
| **事务消息** | ✓ 两阶段 + 回查 | ✓ Producer 事务 | ✓ |
| **延迟消息** | ✓ 18 级 + 任意延迟（5.x） | ✗（需自研） | ✓ |
| **消息回溯** | ✓ 按 offset / 时间 | ✓ 按 offset | ✓ |
| **服务端过滤** | ✓ Tag + SQL92 | ✗ | ✗ |
| **广播模式** | ✓ | ✗（多 Group 模拟） | ✓ |
| **Schema 校验** | ✗ | ✓ Schema Registry | ✓ 内置 |
| **死信队列** | ✓ %DLQ% | ✗ | ✓ |
| **消息追溯（Trace）** | ✓ | ✗（需 OpenTelemetry） | ✓ |
| **Topic 数量** | 万级无压力 | 万级开始抖动 | 百万级无压力 |
| **跨地域复制** | ✗（需 MirrorMaker） | MirrorMaker | ✓ 内置 |
| **多租户** | 一般（Namespace） | 弱 | ✓ 原生 |

---

## 八、运维对比

### 8.1 部署复杂度

```
RocketMQ：
  组件：NameServer + Broker
  最小部署：2 + 2 = 4 节点
  K8s 友好度：4.x 一般，5.x（Proxy）很好
  
Kafka：
  组件：Zookeeper + Broker（4.x KRaft 后只需 Broker）
  最小部署：3 + 3 = 6 节点
  K8s 友好度：一般（StatefulSet + PV）
  
Pulsar：
  组件：Zookeeper + BookKeeper + Broker
  最小部署：3 + 3 + 3 = 9 节点
  K8s 友好度：最好（Broker 无状态）
```

### 8.2 扩缩容

```
RocketMQ：
  ✓ 增 Broker 简单（注册到 NameServer 即可）
  ✗ 减 Broker 复杂（要等数据迁移）
  ✗ Queue 数变化需要 Rebalance

Kafka：
  ✓ 增 Broker 简单
  ✗ 减 Broker 需要 partition 重分配
  ✓ Partition 数可以增加（不能减少）

Pulsar：
  ✓ Broker 弹性扩缩（无状态）
  ✓ BookKeeper 独立扩缩
  ✓ Topic Partition 动态扩展
```

### 8.3 监控生态

```
RocketMQ：
  ✓ Dashboard 自带
  ✓ Prometheus exporter
  
Kafka：
  ✓ Kafka Manager / CMAK
  ✓ Confluent Control Center（商业）
  ✓ Prometheus JMX exporter
  
Pulsar：
  ✓ Pulsar Manager
  ✓ Prometheus 原生集成
```

---

## 九、生态对比

### 9.1 流计算

```
Kafka：
  ✓ Kafka Streams（原生）
  ✓ Flink、Spark、Storm 一等支持
  
RocketMQ：
  ✓ Flink Connector
  ✗ 没有原生流处理框架
  
Pulsar：
  ✓ Pulsar Functions（原生）
  ✓ Flink、Spark 支持
```

### 9.2 数据管道

```
Kafka Connect：
  ✓ 几百个 Connector（DB、ES、HDFS、S3...）
  ✓ Debezium CDC 标配
  
RocketMQ Connect：
  ✗ Connector 较少
  
Pulsar IO：
  ✓ 较多 Connector
```

### 9.3 多语言客户端

```
RocketMQ：
  Java（最完整）/ Go / C++ / Python / Rust / .NET (5.x gRPC 标准)
  
Kafka：
  Java（最完整）/ Go / C / Python / Rust / .NET
  各语言客户端都很成熟
  
Pulsar：
  Java / Go / C++ / Python / .NET / Node.js
```

---

## 十、社区与商业支持

| 维度 | RocketMQ | Kafka | Pulsar |
|---|---|---|---|
| **开源时间** | 2012 | 2011 | 2016 |
| **主要贡献者** | 阿里 / 国内 | LinkedIn / Confluent / 国际 | Yahoo / StreamNative |
| **商业公司** | 阿里云 | Confluent | StreamNative / Datastax |
| **GitHub Stars** | 21k | 28k | 14k |
| **国内使用** | 极广（淘宝/京东/字节...） | 广 | 一般 |
| **国外使用** | 一般 | 主流 | 增长中 |

---

## 十一、选型决策表

### 11.1 按场景

| 场景 | 推荐 | 原因 |
|---|---|---|
| **业务消息（订单/支付）** | RocketMQ | 事务消息 + 延迟消息 + Tag 过滤齐全 |
| **日志/埋点/流数据** | Kafka | 高吞吐 + 大数据生态最强 |
| **CDC（变更同步）** | Kafka | Connect/Debezium 生态成熟 |
| **金融级强一致** | Pulsar / RocketMQ DLedger | 多副本一致性强 |
| **多租户 SaaS** | Pulsar | 原生多租户 + 跨地域 |
| **大量 Topic（10W+）** | Pulsar | Segment 模型不怕多 Topic |
| **K8s 弹性扩缩** | Pulsar / RocketMQ 5.x | 无状态 Broker |
| **快速上手 + 国内** | RocketMQ | 中文社区 + 阿里云托管 |
| **微服务事件总线** | RocketMQ | Spring Cloud Stream 集成好 |
| **IoT / 海量小消息** | Kafka / EMQ | Kafka 高吞吐；EMQ 专门 IoT |

### 11.2 按关键诉求

```
最关心吞吐 → Kafka
最关心可靠性 → RocketMQ DLedger / Pulsar
最关心功能丰富 → RocketMQ（事务 + 延迟 + 过滤）
最关心运维简单 → RocketMQ（4.x 简单）
最关心弹性扩展 → Pulsar
最关心生态 → Kafka（流计算 + 数据管道）
最关心中文文档 → RocketMQ
```

### 11.3 反选型

```
✗ 不要用 Kafka 做事务消息（功能弱 + 复杂）
✗ 不要用 RocketMQ 做日志大数据（吞吐没优势）
✗ 不要用 Pulsar 做小规模业务（运维成本高不划算）
✗ 不要用任何 MQ 做请求-响应（用 RPC）
✗ 不要用任何 MQ 做强一致 DB 替代（用数据库）
```

---

## 十二、混合使用

### 12.1 常见组合

```
业务系统：
  • 订单/支付：RocketMQ（事务消息）
  • 用户行为采集：Kafka
  • 日志统一接收：Kafka
  • CDC 同步：Kafka + Debezium

互联网公司典型：
  • 在线业务用 RocketMQ
  • 离线/大数据用 Kafka
  
SaaS 多租户：
  • 全部用 Pulsar
```

### 12.2 桥接

```
RocketMQ ↔ Kafka：
  • 自研 connector
  • 或用 Flink 转

Kafka ↔ Pulsar：
  • Pulsar 内置 Kafka 协议兼容
  • Kafka 客户端可以直接连 Pulsar
```

---

## 十三、未来趋势

```
RocketMQ：
  • 5.x Proxy + gRPC 路线
  • 多语言 SDK 标准化
  • 云原生友好

Kafka：
  • KRaft 替换 Zookeeper（3.x +）
  • Tiered Storage（数据分层到 S3）
  • Confluent Cloud 商业化加速

Pulsar：
  • 持续优化 BookKeeper
  • 弹性 Functions
  • 已被多家云厂商集成
  
共同趋势：
  ✓ 存算分离
  ✓ K8s 原生
  ✓ 多语言一致体验
  ✓ Schema 演进
  ✓ 数据湖集成（Iceberg / Hudi）
```

---

## 十四、一句话记住核心

> **RocketMQ**：业务消息王者，事务/延迟/过滤齐全，国内首选，中等吞吐。
>
> **Kafka**：日志流数据王者，吞吐最高，大数据生态最强，国际主流。
>
> **Pulsar**：存算分离 + 多租户，运维复杂但弹性最好，新兴势力。
>
> **选型铁律**：业务消息选 RocketMQ，流数据选 Kafka，多租户+跨地域选 Pulsar——别用错锤子敲错钉子。
