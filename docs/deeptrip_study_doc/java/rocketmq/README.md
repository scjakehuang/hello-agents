# RocketMQ 学习笔记

按主题拆分的 RocketMQ 深度学习文档。

## 一、入门与核心架构

| # | 主题 | 文件 |
|---|---|---|
| 01 | 整体架构（NameServer / Broker / Producer / Consumer + Topic/Queue/Tag + 部署形态） | [01_整体架构.md](./01_整体架构.md) |
| 02 | 事务消息（Half + 二次确认 + 状态回查） | [02_事务消息.md](./02_事务消息.md) |
| 03 | 顺序消息（分区有序的三个条件 + Queue 加锁） | [03_顺序消息.md](./03_顺序消息.md) |
| 04 | 主从同步与刷盘（SYNC/ASYNC × MASTER/FLUSH + DLedger） | [04_主从同步与刷盘.md](./04_主从同步与刷盘.md) |
| 05 | Producer/Consumer 启动流程 + Rebalance 五种算法详解 | [05_启动流程与Rebalance算法.md](./05_启动流程与Rebalance算法.md) |
| 06 | Broker 端长轮询 Hold 请求处理机制 | [06_长轮询机制.md](./06_长轮询机制.md) |
| 07 | ConsumeQueue 物理结构（为什么能 O(1) 定位消息） | [07_ConsumeQueue物理结构.md](./07_ConsumeQueue物理结构.md) |
| 08 | CommitLog 顺序写 + mmap + sendfile 零拷贝 | [08_CommitLog与零拷贝.md](./08_CommitLog与零拷贝.md) |

## 二、消息可靠性与高级特性

| # | 主题 | 文件 |
|---|---|---|
| 09 | 延迟消息实现原理（18 级 + SCHEDULE_TOPIC + 5.x TimerWheel） | [09_延迟消息实现原理.md](./09_延迟消息实现原理.md) |
| 10 | 消息重试与死信（%RETRY% Topic + 16 次后进 %DLQ%） | [10_消息重试与死信.md](./10_消息重试与死信.md) |
| 11 | 消息幂等 / 丢失 / 堆积（at-least-once + 三大场景排查） | [11_消息幂等丢失堆积.md](./11_消息幂等丢失堆积.md) |
| 12 | IndexFile 物理结构（420MB Hash 索引 + 链表） | [12_IndexFile物理结构.md](./12_IndexFile物理结构.md) |

## 三、Broker 与运行时机制

| # | 主题 | 文件 |
|---|---|---|
| 13 | NameServer 内部机制（5 张路由表 + 心跳 + 无 Master 设计） | [13_NameServer内部机制.md](./13_NameServer内部机制.md) |
| 14 | PageCache 与刷盘协作（GroupCommit + FlushRealTime + CommitRealTime） | [14_PageCache与刷盘协作.md](./14_PageCache与刷盘协作.md) |
| 15 | Consumer 流控三阈值（1000 条 / 100MB / 2000 offset 跨度） | [15_Consumer流控三阈值.md](./15_Consumer流控三阈值.md) |
| 16 | DLedger Raft 实现（选举 + 日志复制 + 安全性证明） | [16_DLedger_Raft实现.md](./16_DLedger_Raft实现.md) |
| 17 | HAService 主从复制（Master/Slave 长连接 + 半同步 ACK） | [17_HAService主从复制.md](./17_HAService主从复制.md) |
| 18 | 消息过滤 Tag vs SQL92（ConsumeQueue 两层过滤） | [18_消息过滤Tag与SQL92.md](./18_消息过滤Tag与SQL92.md) |

## 四、5.x 新架构

| # | 主题 | 文件 |
|---|---|---|
| 19 | RocketMQ 5.x Proxy 架构（存算分离 + gRPC + 无状态） | [19_RocketMQ_5x_Proxy架构.md](./19_RocketMQ_5x_Proxy架构.md) |
| 20 | Pop 消费 vs Pull 消费（共享订阅 + Invisible + REVIVE_LOG） | [20_Pop消费vs_Pull消费.md](./20_Pop消费vs_Pull消费.md) |

## 五、性能优化与底层

| # | 主题 | 文件 |
|---|---|---|
| 21 | 批量消息与压缩（吞吐优化两板斧） | [21_批量消息与压缩.md](./21_批量消息与压缩.md) |
| 22 | Netty 自定义协议（RemotingCommand 帧 + SYNC/ASYNC/ONEWAY 三种语义） | [22_Netty自定义协议.md](./22_Netty自定义协议.md) |
| 23 | MappedFile 与堆外内存池（TransientStorePool 双路径） | [23_MappedFile与堆外内存池.md](./23_MappedFile与堆外内存池.md) |

## 六、运维与生产实践

| # | 主题 | 文件 |
|---|---|---|
| 24 | 消息轨迹 Trace（全链路追踪 + Hook 机制） | [24_消息轨迹Trace.md](./24_消息轨迹Trace.md) |
| 25 | ACL 权限控制（签名鉴权 + Topic/Group 权限） | [25_ACL权限控制.md](./25_ACL权限控制.md) |
| 26 | Broker 启动与崩溃恢复（recover + checkpoint + abort） | [26_Broker启动与崩溃恢复.md](./26_Broker启动与崩溃恢复.md) |

## 七、选型对比

| # | 主题 | 文件 |
|---|---|---|
| 27 | RocketMQ vs Kafka vs Pulsar（消息中间件三巨头终极对比） | [27_RocketMQ_vs_Kafka_vs_Pulsar.md](./27_RocketMQ_vs_Kafka_vs_Pulsar.md) |

---

## 学习路径推荐

**新手入门**：01 → 02 → 03 → 11

**架构深入**：04 → 07 → 08 → 14 → 17

**5.x 新特性**：19 → 20 → 22（对比 gRPC）

**性能调优**：14 → 15 → 21 → 23

**运维必读**：13 → 25 → 26 → 24

**选型决策**：01 + 27
