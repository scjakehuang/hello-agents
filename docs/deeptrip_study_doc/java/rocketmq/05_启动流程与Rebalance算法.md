# Producer / Consumer 启动流程 + Rebalance 算法详解

把 Producer 和 Consumer 的启动流程拆到「线程级 + 数据结构级」，并把 Rebalance 算法的几种实现讲透。

---

## 一、Producer 启动流程（DefaultMQProducer）

### 1.1 启动时序图

```
应用代码                      DefaultMQProducer        MQClientInstance         NameServer        Broker
   │                                │                         │                     │                │
   │ new DefaultMQProducer("PG-1")  │                         │                     │                │
   ├───────────────────────────────▶│                         │                     │                │
   │                                │ ① 校验 ProducerGroup    │                     │                │
   │                                │   (不能为空/不能用保留名)│                    │                │
   │                                │                         │                     │                │
   │ setNamesrvAddr("ns1:9876;ns2") │                         │                     │                │
   ├───────────────────────────────▶│                         │                     │                │
   │                                │                         │                     │                │
   │ producer.start()               │                         │                     │                │
   ├───────────────────────────────▶│                         │                     │                │
   │                                │ ② changeInstanceName     │                     │                │
   │                                │   ToPID()  避免冲突       │                     │                │
   │                                │   instanceName=PID@ip   │                     │                │
   │                                │                         │                     │                │
   │                                │ ③ 获取 MQClientInstance  │                     │                │
   │                                │   (单例，按 clientId 缓存)│                    │                │
   │                                ├────────────────────────▶│                     │                │
   │                                │                         │                     │                │
   │                                │ ④ registerProducer       │                     │                │
   │                                │   producerTable.put(    │                     │                │
   │                                │     "PG-1", this)       │                     │                │
   │                                ├────────────────────────▶│                     │                │
   │                                │                         │                     │                │
   │                                │ ⑤ mQClientInstance      │                     │                │
   │                                │   .start()              │                     │                │
   │                                ├────────────────────────▶│                     │                │
   │                                │                         │                     │                │
   │                                │                         │ ⑥ 启动定时任务（见下）│                │
   │                                │                         │                     │                │
   │                                │                         │ ⑦ 拉一次路由（默认 Topic）│            │
   │                                │                         ├────────────────────▶│                │
   │                                │                         │                     │                │
   │                                │                         │ ⑧ 启动 Pull 线程    │                │
   │                                │                         │   (Producer 不用，   │                │
   │                                │                         │    但 MQClient 共享) │                │
   │                                │                         │                     │                │
   │                                │                         │ ⑨ 启动 RebalanceImpl │                │
   │                                │                         │   (Producer 也不用)  │                │
   │                                │                         │                     │                │
   │                                │ ⑩ sendHeartbeatToAll-   │                     │                │
   │                                │    Broker (心跳告知活着) │                     │                │
   │                                ├────────────────────────────────────────────────────────────────▶│
   │                                │                         │                     │                │
   │ start() return                 │                         │                     │                │
   │◀───────────────────────────────┤                         │                     │                │
```

### 1.2 启动后跑起来的 5 个定时任务

| 任务 | 周期 | 作用 |
|---|---|---|
| `fetchNameServerAddr` | 2 min | 当用域名方式配 NS 时，定期解析 |
| `updateTopicRouteInfoFromNameServer` | **30s** | 刷新本地 Topic 路由缓存 |
| `cleanOfflineBroker + sendHeartbeat` | **30s** | 清理离线 Broker + 向所有 Broker 发心跳 |
| `persistAllConsumerOffset` | 5s | （Consumer 用，Producer 共享线程池） |
| `adjustThreadPool` | 1 min | （Push Consumer 用） |

### 1.3 关键数据结构

```java
// MQClientInstance 内
ConcurrentMap<String/*group*/, MQProducerInner>     producerTable;
ConcurrentMap<String/*topic*/, TopicRouteData>      topicRouteTable;
ConcurrentMap<String/*topic*/, TopicPublishInfo>    topicPublishInfoTable; // ★ Producer 真正发消息靠这个
ConcurrentMap<String/*brokerName*/, HashMap<Long/*brokerId*/, String/*addr*/>> brokerAddrTable;
```

`TopicPublishInfo` 就是发消息时**选 MessageQueue 的依据**：

```
TopicPublishInfo
 ├── List<MessageQueue> messageQueueList   // 16 个 Queue 全在这里
 ├── ThreadLocal<Integer> sendWhichQueue   // 轮询游标（每线程独立）
 └── TopicRouteData topicRouteData
```

### 1.4 第一次发消息时的 Lazy 路由拉取

Producer 启动只拉了 `TBW102`（默认 Topic）的路由，**业务 Topic 是第一次 send 时才拉**：

```
send(msg, topic="order")
   │
   ▼
tryToFindTopicPublishInfo(topic)
   │
   ├─ 缓存有？→ 直接用
   │
   └─ 缓存没有？
        │
        ▼
        updateTopicRouteInfoFromNameServer("order")
        │
        ├─ NS 返回路由 → 写入缓存 → 用
        │
        └─ NS 没这个 Topic →
             │
             ├─ autoCreateTopicEnable=true（开发环境）
             │   → 拿 TBW102 路由当模板创建 → 用 → Broker 自动建 Topic
             │
             └─ autoCreateTopicEnable=false（生产环境，必须）
                 → 抛 MQClientException: No route info of this topic
```

> **生产铁律**：`autoCreateTopicEnable=false`。开自动建 Topic 后，Topic 的 Queue 数量取决于哪个 Producer 先发——不可控，必生产事故。

### 1.5 选 MessageQueue 的两种策略

```
默认（轮询 + 故障规避）
  │
  ▼
sendWhichQueue.getAndIncrement() % messageQueueList.size()
  │
  ├─ sendLatencyFaultEnable=false（默认）→ 纯轮询
  │
  └─ sendLatencyFaultEnable=true
        │
        └─ LatencyFaultTolerance：上次发往该 Broker 耗时 > 阈值
                                  → 拉黑 N 秒（按延迟梯度：
                                    50ms→0, 100ms→0, 550ms→30s,
                                    1s→60s, 2s→120s, 3s→180s, 15s→600s）
```

顺序消息走 `MessageQueueSelector`：

```java
producer.send(msg, (mqs, msg, arg) -> {
    int idx = Math.abs(arg.hashCode()) % mqs.size();
    return mqs.get(idx);
}, orderId);
```

---

## 二、Consumer 启动流程（DefaultMQPushConsumer）

Consumer 比 Producer 复杂得多，多了 **Rebalance + Pull + 消费线程池 + offset** 四块。

### 2.1 启动时序图

```
应用                  DefaultMQPushConsumer    MQClientInstance      RebalanceService    PullMessageService    Broker
 │                          │                        │                      │                    │              │
 │ new                      │                        │                      │                    │              │
 │ DefaultMQPushConsumer(   │                        │                      │                    │              │
 │   "CG-Pay")              │                        │                      │                    │              │
 ├─────────────────────────▶│                        │                      │                    │              │
 │                          │                        │                      │                    │              │
 │ subscribe("order","*")   │                        │                      │                    │              │
 ├─────────────────────────▶│                        │                      │                    │              │
 │                          │ ① 把订阅关系存到        │                      │                    │              │
 │                          │   RebalanceImpl.       │                      │                    │              │
 │                          │   subscriptionInner    │                      │                    │              │
 │                          │                        │                      │                    │              │
 │ registerMessageListener  │                        │                      │                    │              │
 │   (Concurrently/Orderly) │                        │                      │                    │              │
 ├─────────────────────────▶│                        │                      │                    │              │
 │                          │                        │                      │                    │              │
 │ start()                  │                        │                      │                    │              │
 ├─────────────────────────▶│                        │                      │                    │              │
 │                          │ ② 检查配置（Group/订阅/  │                      │                    │              │
 │                          │   消费模式/起始位点）     │                      │                    │              │
 │                          │                        │                      │                    │              │
 │                          │ ③ copySubscription:    │                      │                    │              │
 │                          │   把订阅 Topic 加上重试  │                      │                    │              │
 │                          │   Topic %RETRY%CG-Pay  │                      │                    │              │
 │                          │                        │                      │                    │              │
 │                          │ ④ 创建 RebalanceImpl    │                      │                    │              │
 │                          │   关联到 Consumer       │                      │                    │              │
 │                          │                        │                      │                    │              │
 │                          │ ⑤ OffsetStore 初始化    │                      │                    │              │
 │                          │   集群: RemoteBrokerOffsetStore │              │                    │              │
 │                          │   广播: LocalFileOffsetStore    │              │                    │              │
 │                          │                        │                      │                    │              │
 │                          │ ⑥ 启动 ConsumeMessage-  │                      │                    │              │
 │                          │   Service               │                      │                    │              │
 │                          │   (Concurrently/Orderly  │                      │                    │              │
 │                          │    决定线程池行为)       │                      │                    │              │
 │                          │                        │                      │                    │              │
 │                          │ ⑦ MQClientInstance.    │                      │                    │              │
 │                          │   registerConsumer +   │                      │                    │              │
 │                          │   start()              │                      │                    │              │
 │                          ├───────────────────────▶│                      │                    │              │
 │                          │                        │ ⑧ 启动定时任务         │                    │              │
 │                          │                        │                      │                    │              │
 │                          │                        │ ⑨ 启动 RebalanceSvc   │                    │              │
 │                          │                        ├─────────────────────▶│                    │              │
 │                          │                        │                      │                    │              │
 │                          │                        │ ⑩ 启动 PullMsgSvc     │                    │              │
 │                          │                        ├──────────────────────────────────────────▶│              │
 │                          │                        │                      │                    │              │
 │                          │ ⑪ 立刻触发一次          │                      │                    │              │
 │                          │   Rebalance（不等 20s）  │                      │                    │              │
 │                          ├──────────────────────────────────────────────▶│                    │              │
 │                          │                                              │                    │              │
 │                          │                                              │ ⑫ 拉路由 + 算分配 + │              │
 │                          │                                              │   生成 PullRequest │              │
 │                          │                                              ├───────────────────▶│              │
 │                          │                                              │                    │              │
 │                          │                                              │                    │ ⑬ pullMessage │
 │                          │                                              │                    ├─────────────▶│
 │                          │                                              │                    │              │
 │                          │                                              │                    │ ⑭ 长轮询返回   │
 │                          │                                              │                    │◀─────────────┤
 │                          │                                              │                    │              │
 │                          │                                              │                    │ ⑮ 提交到消费   │
 │                          │                                              │                    │   线程池      │
 │ start() return           │                                              │                    │              │
 │◀─────────────────────────┤                                              │                    │              │
```

### 2.2 Consumer 启动后的核心定时任务

| 任务 | 周期 | 作用 |
|---|---|---|
| `updateTopicRouteInfoFromNameServer` | 30s | 刷新 Topic 路由 |
| `sendHeartbeatToAllBroker` | 30s | 心跳告诉 Broker：我还活着 + 我订阅了什么 |
| `persistAllConsumerOffset` | **5s** | 集群消费时把 offset 上报 Broker |
| `RebalanceService.run` | **20s** | ★ 触发 Rebalance |
| `PullMessageService.run` | 持续 | 阻塞从 `pullRequestQueue` 取 PullRequest 拉消息 |

### 2.3 核心数据结构

```java
// RebalanceImpl
ConcurrentMap<String/*topic*/, Set<MessageQueue>>      topicSubscribeInfoTable; // NS 给的全集
ConcurrentMap<String/*topic*/, SubscriptionData>       subscriptionInner;       // 我订阅了什么
ConcurrentMap<MessageQueue, ProcessQueue>              processQueueTable;       // ★ 我当前持有的 Queue

// ProcessQueue（每个被分配到的 Queue 一个）
TreeMap<Long/*offset*/, MessageExt>  msgTreeMap;    // 已拉到本地、未消费完的消息
ReadWriteLock                        lockTreeMap;
AtomicLong                           msgCount;      // 流控：积压消息数
AtomicLong                           msgSize;       // 流控：积压消息大小
```

`ProcessQueue` 是**消费端"窗口"的核心**：
- 拉到的消息先进 `msgTreeMap`
- 提交线程池消费
- 消费完按 offset 移除
- 上报 offset = msgTreeMap 的最小 offset（保证不漏）

### 2.4 PullRequest 流转闭环

```
┌────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   PullMessageService                                                 │
│   ┌─────────────────────────────────┐                               │
│   │ LinkedBlockingQueue<PullRequest>│ ◀── Rebalance 首次填充       │
│   └────────────┬────────────────────┘    （每个 MQ 一个 PR）       │
│                │ take()                                              │
│                ▼                                                     │
│   pullMessage(PullRequest)                                          │
│      ├─ 流控检查（msgCount/msgSize/offset 跨度）                    │
│      │   超阈值 → executePullRequestLater(50ms 后重试)              │
│      ├─ 异步发 PULL_MESSAGE 给 Broker                                │
│      └─ 注册回调 PullCallback                                        │
│                                                                      │
│   PullCallback.onSuccess                                             │
│      ├─ FOUND       → 加入 ProcessQueue → 提交消费线程池 →           │
│      │                executePullRequestImmediately(下一轮)          │
│      ├─ NO_NEW_MSG  → 更新 offset → executePullRequestImmediately   │
│      ├─ NO_MATCHED  → 同上                                           │
│      └─ OFFSET_ILLEGAL → 修正 offset → 丢弃 ProcessQueue → 下轮 RB  │
│                                                                      │
└────────────────────────────────────────────────────────────────────┘
```

**这就是为什么说 RocketMQ 是 "伪 Push" —— 内部本质是个永不停歇的拉取循环。**

---

## 三、Rebalance 详细算法

### 3.1 触发时机（4 个）

| 时机 | 说明 |
|---|---|
| Consumer 启动 | start() 内主动触发一次 |
| 定时 20s | `RebalanceService` 周期触发 |
| Broker 通知 | 同 Group 有新 Consumer 注册/下线，Broker 主动通知所有客户端 |
| 客户端订阅变更 | 业务调 subscribe / unsubscribe |

### 3.2 Rebalance 总流程

```
RebalanceService.run() 每 20s 触发
  │
  ▼
foreach Topic in subscriptionInner（我订阅的所有 Topic）
  │
  ▼
rebalanceByTopic(topic, isOrder)
  │
  ├─ 广播模式 BROADCASTING
  │    │
  │    └─ 直接拿 Topic 全部 MessageQueue 当作"我的 Queue"
  │       不需要分配，每个 Consumer 都消费全部
  │
  └─ 集群模式 CLUSTERING ★ 重点
        │
        ├─ ① 拿 Queue 全集
        │    Set<MessageQueue> mqSet =
        │        topicSubscribeInfoTable.get(topic)
        │    // 来自 NameServer 路由，假设 16 个：[Q0..Q15]
        │
        ├─ ② 从 Broker 拿 ConsumerGroup 在线实例列表
        │    List<String> cidAll =
        │        findConsumerIdList(topic, consumerGroup)
        │    // 形如：["c1@host1", "c2@host2", "c3@host3", "c4@host4"]
        │
        ├─ ③ 排序（关键！保证一致性）
        │    Collections.sort(mqSet);
        │    Collections.sort(cidAll);
        │    // 所有 Consumer 看到同样顺序 → 算出同样结果 → 不冲突
        │
        ├─ ④ 调用 AllocateMessageQueueStrategy
        │    List<MessageQueue> allocated =
        │        strategy.allocate(group, currentCID, mqSet, cidAll);
        │    // 返回"属于我"的 Queue
        │
        └─ ⑤ updateProcessQueueTableInRebalance(allocated)
             │
             ├─ 新增：allocated 里有但 processQueueTable 没有
             │   → 创建 ProcessQueue
             │   → 从 OffsetStore 读初始 offset
             │   → 创建 PullRequest 投到 PullMessageService
             │
             └─ 移除：processQueueTable 有但 allocated 里没有
                 → ProcessQueue.setDropped(true)
                 → 持久化最后 offset 到 Broker
                 → 顺序消费时还要解锁 Broker 端的 Queue 锁
```

### 3.3 五种内置分配策略

#### ① AllocateMessageQueueAveragely（默认，平均连续分配）

```
16 个 Queue，4 个 Consumer：
  averageSize = 16 / 4 = 4
  c1 → Q0, Q1, Q2, Q3
  c2 → Q4, Q5, Q6, Q7
  c3 → Q8, Q9, Q10, Q11
  c4 → Q12, Q13, Q14, Q15

不能整除时（17 Queue，4 Consumer）：
  mod = 17 % 4 = 1
  前 1 个多分 1 个：
  c1 → 0,1,2,3,4   (5)
  c2 → 5,6,7,8     (4)
  c3 → 9,10,11,12  (4)
  c4 → 13,14,15,16 (4)
```

**算法核心**：

```java
int index    = cidAll.indexOf(currentCID);
int mod      = mqSet.size() % cidAll.size();
int avgSize  = mqSet.size() <= cidAll.size()
               ? 1
               : (mod > 0 && index < mod
                  ? mqSet.size() / cidAll.size() + 1
                  : mqSet.size() / cidAll.size());
int startIdx = mod > 0 && index < mod
               ? index * avgSize
               : index * avgSize + mod;
int range    = Math.min(avgSize, mqSet.size() - startIdx);

return mqSet.subList(startIdx, startIdx + range);
```

#### ② AllocateMessageQueueAveragelyByCircle（轮询取模）

```
16 个 Queue，4 个 Consumer：
  c1 → Q0, Q4, Q8,  Q12
  c2 → Q1, Q5, Q9,  Q13
  c3 → Q2, Q6, Q10, Q14
  c4 → Q3, Q7, Q11, Q15

适用：Queue 之间数据量极不均匀时，让"热"和"冷"分散
```

#### ③ AllocateMessageQueueConsistentHash（一致性哈希）

```
   ┌─────── 哈希环 ──────┐
   │   c1                  │
   │      Q0               │
   │  Q15      Q1          │
   │              Q2       │
   │                  c2   │
   │                  Q3   │
   │                  ...  │
   └───────────────────────┘

每个 Queue 顺时针找最近的 Consumer。
扩缩容时只影响相邻区间，不像平均分配会全量重排。

适用：Consumer 数量变化频繁、希望减少"漂移"的场景
```

#### ④ AllocateMessageQueueByConfig（手工配置）

启动时通过参数指定每个 Consumer 拿哪些 Queue，**几乎不用**，调试场景。

#### ⑤ AllocateMessageQueueByMachineRoom（机房就近）

```
集群部署在 IDC-A 和 IDC-B 两个机房：
  Broker:    A 机房 brokerName=BrokerA-IDC-A
            B 机房 brokerName=BrokerB-IDC-B
  Consumer:  A 机房的优先消费 IDC-A 的 Queue

适用：跨机房部署，降低跨机房带宽成本
```

### 3.4 Rebalance 期间的"重复消费"问题

**Rebalance 不可避免地导致消息重复消费**，原因：

```
时序：
  T0  Consumer-A 拉到 Q5 的 offset=100~110，正在消费
  T1  Consumer-B 上线，触发 Rebalance
  T2  Q5 被分配给 Consumer-B
  T3  Consumer-A 收到 Q5 dropped，停止消费 + 上报 offset
       ↓ 此时 Consumer-A 消费到 105
       ↓ 上报 offset=105
  T4  Consumer-B 从 offset=105 开始拉
       但 Consumer-A 在 T3 还有 105~110 已经"在执行中"的消息
       这些消息会被 Consumer-B 重新拉到再消费一次
```

**所以业务方必须自己做幂等**——这是 RocketMQ 的"至少一次"语义本质。

### 3.5 顺序消费的 Rebalance 特殊处理

顺序消费在 Rebalance 时还要做一件事：**Broker 端 Queue 锁切换**。

```
Consumer-A 持有 Q5 时：
  ① 启动时向 Broker 发 LOCK_BATCH_MQ 获取 Q5 的锁（默认 60s）
  ② 每 20s 续锁
  ③ 消费时判断 ProcessQueue.locked，没锁不消费

Rebalance 把 Q5 分给 Consumer-B：
  ① Consumer-A：先 unlock Q5（向 Broker 发 UNLOCK_MQ）
  ② Consumer-B：lock Q5
  ③ 这中间有锁等待间隙 → 顺序消费短暂停顿（正常现象）

如果 Consumer-A 异常崩溃没 unlock：
  Consumer-B 必须等 Broker 端锁过期（60s）才能拿到 → 会卡 60s
```

> **顺序消费的代价**：扩缩容时业务会感知到"卡顿"。所以顺序消费的 Consumer 数量**尽量稳定**。

---

## 四、一张表对比 Producer / Consumer 启动差异

| 维度 | Producer | Consumer |
|---|---|---|
| 启动后定时任务数 | 5 个（共享线程池） | 5 个 + Rebalance + Pull |
| 路由首次拉取 | Lazy（首次 send） | Eager（start 立即拉所有订阅 Topic） |
| 心跳内容 | ProducerGroup | ConsumerGroup + 订阅关系 + 消费模式 |
| 启动后是否阻塞 | 否（start 完即返回） | 否（异步线程跑 Rebalance/Pull） |
| 关键内存结构 | `TopicPublishInfo` | `ProcessQueueTable` + `OffsetStore` |
| 异常恢复点 | 重发 + Broker 故障规避 | Rebalance + offset 持久化 |
| 关键铁律 | `autoCreateTopicEnable=false` | 业务必须幂等 |
