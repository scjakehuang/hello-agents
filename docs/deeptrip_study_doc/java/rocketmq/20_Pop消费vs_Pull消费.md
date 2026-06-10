# Pop 消费 vs Pull 消费（5.x 共享订阅模式）

5.x 引入的 **Pop 消费** 解决了 Pull 模式的几个核心痛点：Rebalance 风暴、扩展性受限于 Queue 数。

---

## 一、Pull 模式的痛点

### 1.1 Queue 与 Consumer 实例绑定

```
4.x Pull 模式：
  Topic 有 16 个 Queue
  Consumer Group 部署 4 个实例
  → 每个实例分 4 个 Queue（独占）
  
扩到 32 个实例呢？
  → 16 个实例分到 1 Queue
  → 多余 16 个实例分不到 Queue（空跑）
  → 实例数 > Queue 数 = 资源浪费
```

### 1.2 Rebalance 频繁卡顿

```
Consumer 实例加入/退出 → 触发 Rebalance
  ① 所有实例停止拉取
  ② 重新分配 Queue
  ③ 提交老 Queue 的 offset
  ④ 从新 Queue 开始拉

期间消费暂停几秒到几十秒
扩缩容 = 性能抖动
```

### 1.3 单 Queue 串行消费

```
单 Queue 在同一时刻只能被一个 Consumer 实例消费
  → 单 Queue 的消费速度 = 单实例处理能力
  → 想加速只能增 Queue 数
  → 加 Queue 影响顺序消息、加 Queue 又要 Rebalance
```

---

## 二、Pop 模式：共享订阅

### 2.1 核心思路

```
Pop 模式：
  Queue 不再分配给特定 Consumer 实例
  任意 Consumer 都可以从任意 Queue Pop 消息
  → 消息被"占用"（Invisible）一段时间
  → 处理成功 ACK → 消息真正消费
  → 处理失败/超时 → 消息变回可见，被其他 Consumer 重新 Pop
```

```
                Consumer-1 ──┐
                              │
                Consumer-2 ──┼──── Pop ────▶ Queue-0
                              │             Queue-1
                Consumer-3 ──┼──── Pop ────▶ Queue-2
                              │             ...
                Consumer-N ──┘             Queue-15

→ N 可以远大于 Queue 数
→ 任意 Consumer 处理任意 Queue 的消息
```

### 2.2 类比：消息变成"任务"

```
Pull 模式：消息是流水线上的零件，每个工人负责一段
Pop 模式：消息是任务池，工人来一个领一个

类似 SQS、AMQP 的 push-pull 混合模型
```

---

## 三、Pop API 详解

### 3.1 三个核心 API

```
① Pop（拉取并占用）
   Request: topic, group, popTime, invisibleTime, batchSize
   Response: messages + extraInfo（包含 popTime + invisibleTime）

② Ack（确认消费）
   Request: topic, group, extraInfo, messageOffset
   Response: success/failure

③ ChangeInvisibleTime（延长占用时间）
   Request: topic, group, extraInfo, newInvisibleTime
   Response: success/failure
```

### 3.2 Invisible 机制

```
Consumer Pop 消息
        │
        ▼
Broker 返回消息 + 标记为 Invisible（默认 60 秒）
        │
        │ Invisible 期间：
        │  • 其他 Consumer 看不到这条消息
        │  • 当前 Consumer 处理业务
        │
        ▼
    ┌───┴───────────────────────┐
    │                            │
处理成功                       处理超时（> 60s）
ACK                            或处理失败
    │                            │
    ▼                            ▼
消息真正消费                   消息变回可见
（删除从队列）                 其他 Consumer 可以 Pop
```

### 3.3 完整流程示例

```
T0    Consumer-1 Pop(group=g1)
      Broker 返回 msg1 + extraInfo（invisible 60s）
      Broker 内部记录：msg1 被占用，到 T+60s 才能再被 Pop

T0+5s  Consumer-2 Pop(group=g1)
      Broker 跳过 msg1（仍 Invisible）
      返回 msg2

T0+30s Consumer-1 处理完成 → Ack(msg1, extraInfo)
      Broker 真正提交 msg1 的 offset

T0+50s Consumer-2 处理超时（卡住）
      不发 Ack 也不延长 Invisible

T0+60s Broker 后台检测：msg2 的 Invisible 到期
      → msg2 重新变可见

T0+65s Consumer-3 Pop(group=g1)
      → 拿到 msg2（重新被占用 60s）
      
→ 实现了"至少消费一次" + 自动重试
```

---

## 四、Pop 的实现机制

### 4.1 内部存储：CheckPoint 队列

```
Broker 维护内部 Topic：
  rmq_sys_REVIVE_LOG_{clusterName}

每次 Pop 时：
  ① 拉取消息
  ② 写一条 CheckPoint 到 REVIVE_LOG
     CheckPoint = {
       startOffset, count, popTime, invisibleTime,
       topic, group, queueId, extraInfo
     }
  ③ 启动 Invisible 计时

每次 Ack 时：
  ④ 写一条 AckMessage 到 REVIVE_LOG
     AckMessage = {
       targetCheckPointOffset, messageOffset
     }
```

### 4.2 PopReviveService（后台线程）

```java
class PopReviveService extends ServiceThread {
    @Override
    public void run() {
        while (!isStopped()) {
            // ① 扫描 REVIVE_LOG
            List<CheckPoint> checkpoints = scanRevivLog();
            
            for (CheckPoint cp : checkpoints) {
                // ② 找对应的 Ack
                List<Long> ackedOffsets = findAcks(cp);
                
                if (cp.popTime + cp.invisibleTime <= System.currentTimeMillis()) {
                    // ③ Invisible 到期
                    for (long offset = cp.startOffset; 
                             offset < cp.startOffset + cp.count; offset++) {
                        if (!ackedOffsets.contains(offset)) {
                            // ★ 没被 Ack 的消息：重新投递到 retry topic
                            republishToRetryTopic(cp.topic, cp.group, offset);
                        }
                    }
                    // ④ 删除已处理的 CheckPoint
                    removeCheckPoint(cp);
                }
            }
        }
    }
}
```

### 4.3 重新投递逻辑

```
未 Ack 的消息：
  → 投递到 %RETRY%{group} Topic
  → 走重试机制（见 10_消息重试与死信.md）
  → Consumer 通过订阅 %RETRY% 自动消费
  → 重试次数 ≥ 16 → 进死信
```

---

## 五、Pop vs Pull 对比

| 维度 | Pull (4.x) | Pop (5.x) |
|---|---|---|
| **Queue 绑定** | 一对一独占 | 共享，任意 Consumer 可拉 |
| **实例数限制** | ≤ Queue 数 | 无限制 |
| **Rebalance** | 频繁，影响消费 | 不需要 |
| **扩缩容** | 卡顿几秒 | 平滑无感 |
| **消费速度** | 受单 Queue 限制 | 可水平扩展 |
| **顺序保证** | 单 Queue 顺序 | 不保证 |
| **offset 管理** | 客户端 + Broker | 全由 Broker |
| **失败重试** | %RETRY% Topic | Invisible 超时 + %RETRY% |
| **复杂度** | 复杂 | 简单 |

---

## 六、Pop 的适用场景

### 6.1 推荐用 Pop

```
✓ 大并发消费（Consumer 实例数 > Queue 数）
✓ 无序业务（不依赖单队列顺序）
✓ 弹性消费（频繁扩缩容）
✓ 任务队列模式（每条消息独立处理）
✓ 跨语言客户端（gRPC 标准）
```

### 6.2 不推荐用 Pop

```
✗ 顺序消费（Pop 不保证顺序）
✗ 高吞吐流式（Pop 有 CheckPoint 开销）
✗ 老系统迁移（Pull 已经稳定运行）
```

### 6.3 典型场景对照

| 场景 | 推荐模式 |
|---|---|
| 订单状态变更通知 | Pop |
| 数据库变更同步（要顺序） | Pull |
| 日志采集 | Pull |
| 用户行为分析（无序） | Pop |
| 定时任务调度 | Pop |
| 实时风控告警 | Pop |

---

## 七、5.x SDK 使用

### 7.1 Pop Consumer（PushConsumer 默认走 Pop）

```java
// 5.x PushConsumer 内部用 Pop API
PushConsumer consumer = provider.newPushConsumerBuilder()
    .setClientConfiguration(...)
    .setConsumerGroup("order_consumer")
    .setSubscriptionExpressions(Collections.singletonMap("OrderTopic",
        new FilterExpression("*", FilterExpressionType.TAG)))
    .setMessageListener(msg -> {
        try {
            doBusiness(msg);
            return ConsumeResult.SUCCESS;   // → 触发 Ack
        } catch (Exception e) {
            return ConsumeResult.FAILURE;   // → 不 Ack，Invisible 到期重投
        }
    })
    .build();
```

### 7.2 SimpleConsumer（手动 Pop API）

```java
// 更底层的 API，业务自己控制 Pop / Ack
SimpleConsumer consumer = provider.newSimpleConsumerBuilder()
    .setClientConfiguration(...)
    .setConsumerGroup("g1")
    .setAwaitDuration(Duration.ofSeconds(30))  // 长轮询时间
    .setSubscriptionExpressions(...)
    .build();

while (true) {
    // ① Pop（最多 32 条，Invisible 60s）
    List<MessageView> messages = consumer.receive(32, Duration.ofSeconds(60));
    
    for (MessageView msg : messages) {
        try {
            doBusiness(msg);
            
            // ② Ack（业务成功后）
            consumer.ack(msg);
        } catch (Exception e) {
            // ③ 延长 Invisible（业务还在处理但需要更多时间）
            consumer.changeInvisibleDuration(msg, Duration.ofSeconds(120));
        }
    }
}
```

### 7.3 调优参数

```
invisibleTime：默认 60s
  • 业务 RT < 60s：保持默认
  • 业务 RT > 60s：延长，否则会重复消费

batchSize：Pop 一次最多多少条
  • 默认 32
  • 大消息可调小，小消息可调大

awaitDuration：长轮询最长时间
  • 默认 30s
  • 没消息时挂起，节省请求
```

---

## 八、Pop 的坑

### 8.1 不保证顺序

```
Pop 是共享订阅，多 Consumer 并发处理
  → 同 Queue 的消息可能被多个 Consumer 同时处理
  → 完全无序
  
→ 严格顺序需求请用 Pull + Orderly
```

### 8.2 invisibleTime 设置不当

```
设小了：业务还没处理完就到期 → 消息重复
设大了：处理超时后等很久才能重试 → 延迟高

最佳实践：invisibleTime = 业务 P99 RT × 2
```

### 8.3 Ack 失败

```
Ack 也可能失败（网络问题）
  → Broker 没收到 Ack → 当成超时 → 重新投递
  → 业务必须做幂等
```

### 8.4 REVIVE_LOG 堆积

```
高并发 Pop + 低 Ack 率 → REVIVE_LOG 堆积
  → PopReviveService 跟不上 → 重投延迟

监控指标：REVIVE_LOG 队列长度
```

---

## 九、Pop 的演进与对比

### 9.1 Pop 模式的设计参考

```
Pop 灵感来自：
  • Amazon SQS：标准消息队列模型
  • RabbitMQ Stream：现代消息处理模型
  • Pulsar Shared Subscription：共享订阅

RocketMQ Pop 的独创：
  ✓ 与现有 Pull 模式共存
  ✓ 同样的 CommitLog 存储
  ✓ 兼容 %RETRY% 和 %DLQ%
```

### 9.2 Pop vs Pulsar Shared 对比

| 维度 | RocketMQ Pop | Pulsar Shared |
|---|---|---|
| **底层存储** | CommitLog + ConsumeQueue | BookKeeper Segment |
| **占用机制** | Invisible 时间 | Negative Ack + Redelivery Delay |
| **顺序保证** | 不保证 | Key_Shared 模式可保证 |
| **客户端** | gRPC | 自定义协议 |

---

## 十、运维监控

### 10.1 关键指标

```
Pop 维度：
  • Pop QPS / RT
  • Pop 返回消息数量
  • Pop 命中率（Pop 到消息 vs 长轮询超时）

Ack 维度：
  • Ack QPS / RT
  • Ack 成功率

REVIVE_LOG 维度：
  • CheckPoint 数量
  • 重新投递的消息数
  • Ack 缺失率（说明业务处理超时多）
```

### 10.2 告警规则

```
① Pop 命中率 < 50% 持续 5 分钟
   → 长轮询大量超时，可能消息少或 Pop 配置不合理
   
② 重新投递率 > 5%
   → 业务处理超时或失败频繁
   → 调大 invisibleTime 或修业务

③ REVIVE_LOG 长度 > 10W
   → PopReviveService 跟不上
   → Broker 资源不足或 Pop QPS 突增
```

---

## 十一、一句话记住核心

> **Pop = 共享订阅模式：任意 Consumer 从任意 Queue Pop 消息，占用 60s 处理，超时未 Ack 自动重投。**
>
> 摆脱 4.x 的两大枷锁：Consumer 实例数 ≤ Queue 数 + Rebalance 频繁卡顿。
>
> 实现机制：REVIVE_LOG 维护 CheckPoint，PopReviveService 后台扫描超时未 Ack 的消息 → 重投 %RETRY% Topic。
>
> 共享订阅 + Invisible + 幂等业务 = 弹性、无锁、易扩展的现代消息消费模型。
