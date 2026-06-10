# 消息轨迹（Trace）：一条消息的全链路追踪

线上排查时，"这条消息发送成功了吗？被哪个 Consumer 消费了？消费用了多久？" 这种问题靠 Trace 一次性回答。

---

## 一、Trace 解决什么问题

```
没有 Trace 时：
  Producer：我发了 100 条消息，10 条没收到回执
  Broker：我都收到了
  Consumer：我都处理了
  
  → 谁说的对？日志散落多处，无法关联
  
有 Trace 时：
  按 msgId 查 → 一张图看到：
    Producer 发送时间 / 状态
    Broker 接收 / 存储 时间
    Consumer 拉取时间
    Consumer 处理时间 / 结果
```

---

## 二、Trace 的架构

```
        Producer App                                    Consumer App
        ┌──────────────────┐                       ┌──────────────────┐
        │ SendMessageHook  │                       │ ConsumeMessageHook│
        │  ↓ 收集轨迹       │                       │  ↓ 收集轨迹       │
        │ AsyncTraceDispatcher│                    │ AsyncTraceDispatcher│
        └────────┬─────────┘                       └────────┬─────────┘
                 │ 后台批量发送                            │
                 ▼                                          ▼
        ┌───────────────────────────────────────────────────────┐
        │       RMQ_SYS_TRACE_TOPIC（专用 Trace Topic）         │
        │       一般 1 个 Queue（顺序无要求，并发即可）            │
        └───────────────────────┬───────────────────────────────┘
                                 │
                                 ▼
        ┌───────────────────────────────────────────────────────┐
        │  Trace Consumer（用户/官方实现）                       │
        │  消费 Trace 消息 → 写 ElasticSearch / 数据库            │
        └───────────────────────────────────────────────────────┘
                                 │
                                 ▼
        ┌───────────────────────────────────────────────────────┐
        │  Trace 查询 UI（按 msgId/topic/group/时间范围查询）    │
        └───────────────────────────────────────────────────────┘
```

---

## 三、Trace 数据内容

### 3.1 Producer 端轨迹

```
TraceBean:
  • traceType: Pub
  • topic
  • msgId
  • offsetMsgId（Broker 生成的物理 offset ID）
  • tags
  • keys
  • storeHost (Broker)
  • bodyLength
  • costTime（发送耗时）
  • msgType
  • timeStamp
  • success (true/false)
```

### 3.2 Consumer 端轨迹

```
TraceBean:
  • traceType: SubBefore / SubAfter
  • topic
  • msgId
  • group
  • clientHost (Consumer IP)
  • storeTime
  • retryTimes
  • costTime（消费耗时）
  • status: SUCCESS / FAILED / TIME_OUT
  • contextCode
```

---

## 四、启用 Trace

### 4.1 Producer 端

```java
// 方式 1：构造时启用
DefaultMQProducer producer = new DefaultMQProducer(
    "ProducerGroup", true);  // 第二个参数：enableMsgTrace
producer.setNamesrvAddr("localhost:9876");

// 方式 2：自定义 Trace Topic（默认是 RMQ_SYS_TRACE_TOPIC）
DefaultMQProducer producer = new DefaultMQProducer(
    "ProducerGroup", true, "MyCustomTraceTopic");
```

### 4.2 Consumer 端

```java
DefaultMQPushConsumer consumer = new DefaultMQPushConsumer(
    "ConsumerGroup", true);  // 启用 Trace
consumer.setNamesrvAddr("localhost:9876");
```

### 4.3 Broker 端创建 Topic

```bash
# 默认 Trace Topic
mqadmin updateTopic -n localhost:9876 -t RMQ_SYS_TRACE_TOPIC -c DefaultCluster -r 1 -w 1

# 配置说明：
#   • readQueueNums = 1（Trace 没有顺序要求，1 个 Queue 即可）
#   • writeQueueNums = 1
```

---

## 五、Hook 实现机制

### 5.1 Producer 的 SendMessageHook

```java
public class SendMessageTraceHookImpl implements SendMessageHook {
    private final AsyncTraceDispatcher dispatcher;
    
    @Override
    public void sendMessageBefore(SendMessageContext ctx) {
        if (ctx == null || ctx.getMessage().getTopic().startsWith(MixAll.RMQ_SYS)) {
            return;  // 内部 Topic 跳过
        }
        
        // 构造 TraceBean
        TraceBean traceBean = new TraceBean();
        traceBean.setTopic(ctx.getMessage().getTopic());
        traceBean.setTags(ctx.getMessage().getTags());
        traceBean.setKeys(ctx.getMessage().getKeys());
        traceBean.setMsgType(ctx.getMsgType());
        traceBean.setBodyLength(ctx.getMessage().getBody().length);
        
        TraceContext traceContext = new TraceContext();
        traceContext.setTraceType(TraceType.Pub);
        traceContext.setTraceBeans(Collections.singletonList(traceBean));
        traceContext.setTimeStamp(System.currentTimeMillis());
        ctx.setMqTraceContext(traceContext);
    }
    
    @Override
    public void sendMessageAfter(SendMessageContext ctx) {
        if (ctx == null || ctx.getMqTraceContext() == null) return;
        
        TraceContext tc = (TraceContext) ctx.getMqTraceContext();
        TraceBean bean = tc.getTraceBeans().get(0);
        bean.setMsgId(ctx.getSendResult().getMsgId());
        bean.setOffsetMsgId(ctx.getSendResult().getOffsetMsgId());
        bean.setStoreHost(ctx.getBrokerAddr());
        bean.setCostTime(System.currentTimeMillis() - tc.getTimeStamp());
        bean.setSuccess(ctx.getSendResult().getSendStatus() == SendStatus.SEND_OK);
        
        // 提交到 Dispatcher（异步发送 Trace 消息）
        dispatcher.append(tc);
    }
}
```

### 5.2 Consumer 的 ConsumeMessageHook

```java
public class ConsumeMessageTraceHookImpl implements ConsumeMessageHook {
    @Override
    public void consumeMessageBefore(ConsumeMessageContext ctx) {
        TraceContext tc = new TraceContext();
        tc.setTraceType(TraceType.SubBefore);
        tc.setTimeStamp(System.currentTimeMillis());
        tc.setGroupName(ctx.getConsumerGroup());
        
        List<TraceBean> beans = new ArrayList<>();
        for (MessageExt msg : ctx.getMsgList()) {
            TraceBean bean = new TraceBean();
            bean.setMsgId(msg.getMsgId());
            bean.setTopic(msg.getTopic());
            bean.setKeys(msg.getKeys());
            bean.setStoreTime(msg.getStoreTimestamp());
            bean.setRetryTimes(msg.getReconsumeTimes());
            bean.setClientHost(/* Consumer IP */);
            beans.add(bean);
        }
        tc.setTraceBeans(beans);
        ctx.setMqTraceContext(tc);
        dispatcher.append(tc);  // 立即上报"开始消费"
    }
    
    @Override
    public void consumeMessageAfter(ConsumeMessageContext ctx) {
        TraceContext tc = (TraceContext) ctx.getMqTraceContext();
        TraceContext afterTc = new TraceContext();
        afterTc.setTraceType(TraceType.SubAfter);
        afterTc.setCostTime(System.currentTimeMillis() - tc.getTimeStamp());
        afterTc.setSuccess(ctx.isSuccess());
        afterTc.setStatus(ctx.getStatus());
        afterTc.setTraceBeans(tc.getTraceBeans());
        
        dispatcher.append(afterTc);  // 上报"消费完成"
    }
}
```

---

## 六、AsyncTraceDispatcher

### 6.1 异步发送原理

```java
public class AsyncTraceDispatcher {
    private final ArrayBlockingQueue<TraceContext> traceContextQueue;
    private final TraceProducer producer;  // 内部专用 Producer
    private final ExecutorService worker;
    
    public void append(TraceContext ctx) {
        // 非阻塞放入队列；满了就丢
        boolean offered = traceContextQueue.offer(ctx);
        if (!offered) {
            log.warn("Trace queue full, drop trace");
        }
    }
    
    private void start() {
        worker.submit(() -> {
            List<TraceContext> contexts = new ArrayList<>(batchSize);
            
            while (!stopped) {
                // ① 攒一批
                TraceContext ctx = traceContextQueue.poll(maxWaitMs, TimeUnit.MILLISECONDS);
                if (ctx != null) {
                    contexts.add(ctx);
                }
                
                // ② 凑够 batchSize 或时间到了
                if (contexts.size() >= batchSize || timeUp()) {
                    sendBatch(contexts);  // 批量发送
                    contexts.clear();
                }
            }
        });
    }
    
    private void sendBatch(List<TraceContext> contexts) {
        // 编码为 Trace 消息体
        for (TraceContext ctx : contexts) {
            String traceData = TraceDataEncoder.encoderFromContextBean(ctx);
            Message msg = new Message(traceTopic, traceData.getBytes());
            msg.setKeys(ctx.getTraceBeans().get(0).getMsgId());
            
            // 用专用 Producer 发送（不影响业务）
            producer.send(msg);
        }
    }
}
```

### 6.2 性能保证

```
特点：
  ✓ 异步（不阻塞业务发送/消费）
  ✓ 批量（默认 100 条一批）
  ✓ 队列满了丢弃（不背 Trace 拖死业务）
  ✓ 独立 Producer（不复用业务 Producer 的资源）

代价：
  ✗ Trace 数据可能丢（队列满 / 网络错误）
  ✗ Trace Topic 数据量大（一条业务消息 = 3 条 Trace：Pub/SubBefore/SubAfter）
  ✗ Broker IO 翻倍（业务 + Trace）
```

---

## 七、Trace 数据编码格式

```
TraceData 是文本格式（| 分隔）：

Pub|1234567890|OrderTopic|MsgId001|OffsetMsgId001|BrokerHost|TagA|Key001|1024|15|TRUE
 │      │           │          │           │          │        │     │     │   │   │
 │      │           │          │           │          │        │     │     │   │   └─ success
 │      │           │          │           │          │        │     │     │   └───── costTime(ms)
 │      │           │          │           │          │        │     │     └───────── bodyLength
 │      │           │          │           │          │        │     └─────────────── keys
 │      │           │          │           │          │        └───────────────────── tags
 │      │           │          │           │          └─────────────────────────────── storeHost
 │      │           │          │           └────────────────────────────────────────── offsetMsgId
 │      │           │          └────────────────────────────────────────────────────── msgId
 │      │           └───────────────────────────────────────────────────────────────── topic
 │      └───────────────────────────────────────────────────────────────────────────── timestamp
 └──────────────────────────────────────────────────────────────────────────────────── traceType
```

---

## 八、Trace Consumer

### 8.1 自己实现 Trace Consumer

```java
DefaultMQPushConsumer consumer = new DefaultMQPushConsumer("TraceConsumerGroup");
consumer.subscribe("RMQ_SYS_TRACE_TOPIC", "*");

consumer.registerMessageListener((List<MessageExt> msgs, ctx) -> {
    for (MessageExt msg : msgs) {
        String traceData = new String(msg.getBody());
        
        // 按 | 分割解析
        TraceContext traceCtx = TraceDataEncoder.decoderFromTraceDataString(traceData);
        
        // 写入存储（ES / Cassandra / TiDB）
        traceStore.save(traceCtx);
    }
    return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
});
```

### 8.2 RocketMQ Dashboard 自带 Trace

```
官方提供 rocketmq-dashboard 项目：
  • 自动消费 Trace Topic
  • 写入内置存储
  • 提供 Web UI 查询

部署：
  docker run -d -p 8080:8080 apacherocketmq/rocketmq-dashboard

→ http://localhost:8080 → 消息轨迹
```

---

## 九、Trace 查询场景

### 9.1 按 msgId 查

```
输入：MsgId001

输出：
┌─────────────┬─────────────────────┬──────────┐
│ Type        │ Time                │ Host     │
├─────────────┼─────────────────────┼──────────┤
│ Pub         │ 2026-06-09 10:00:01 │ Producer │
│ SubBefore   │ 2026-06-09 10:00:01 │ Cons-1   │
│ SubAfter    │ 2026-06-09 10:00:03 │ Cons-1   │
│ SubBefore   │ 2026-06-09 10:00:05 │ Cons-1   │ ← 重试
│ SubAfter    │ 2026-06-09 10:00:08 │ Cons-1   │ ← 成功
└─────────────┴─────────────────────┴──────────┘
```

### 9.2 按业务 key 查

```
输入：OrderId=ORD12345

→ 找到所有相关消息（订单创建/支付/退款...）
→ 完整生命周期可视化
```

### 9.3 按 Group 查最近失败

```
输入：group = order_consumer, status = FAILED, last 1h

→ 列出最近 1 小时所有消费失败的消息
→ 看 retryTimes 分布
→ 看 costTime 分布
```

---

## 十、Trace 的坑

### 10.1 Trace Topic 不存在

```
Producer 启用 Trace 但 Broker 没创建 RMQ_SYS_TRACE_TOPIC：
  → Trace 发送失败 → 队列堆积 → 丢失

→ Broker 启动时一般自动创建（autoCreateTopicEnable=true）
→ 但生产环境禁用 autoCreateTopicEnable → 必须手动创建
```

### 10.2 性能影响

```
启用 Trace 后：
  • Producer 端：约 5%~10% CPU 增加（编码 + 异步发送）
  • Broker 端：Trace Topic 流量 ≈ 业务流量的 3 倍（Pub + Sub × 2）
  
→ 大流量场景慎用全量 Trace
→ 可考虑采样（仅记录 10% 消息的 Trace）
```

### 10.3 Trace 数据丢失

```
异步队列满 → 直接丢
Trace Producer 发送失败 → 重试几次后丢

→ Trace 是"尽力而为"，不是 100% 准确
→ 关键链路用主动埋点（如 Metrics）补充
```

### 10.4 Trace Topic 堆积

```
Trace 数据量大 → Trace Consumer 跟不上 → 堆积

→ 给 Trace Topic 多分配 Queue
→ Trace Consumer 多实例并发消费
→ 写存储用批量（如 ES bulk）
```

---

## 十一、采样策略

### 11.1 全量 vs 采样

```
全量 Trace：
  ✓ 排查时随便查
  ✗ 性能开销大、存储成本高

采样 Trace：
  按 hash(msgId) % 100 < 10 → 仅 10% 上报
  ✓ 开销低
  ✗ 想查的那条消息可能没采到
```

### 11.2 关键路径全采

```java
// Producer 端
Message msg = new Message("OrderTopic", body);

// 重要订单强制采样
if (isVipOrder) {
    msg.putUserProperty(MessageConst.PROPERTY_TRACE_SWITCH, "true");
}
```

---

## 十二、和 OpenTelemetry 对比

| 维度 | RocketMQ Trace | OpenTelemetry |
|---|---|---|
| **数据格式** | 自定义文本 | OTLP 标准 |
| **存储** | 自己选 | Jaeger/Tempo/... |
| **跨系统** | 仅 MQ 内 | 全链路（业务 + MQ + DB） |
| **采样** | 简单开关 | 多策略 |
| **适用** | MQ 局部 | 整个微服务体系 |

**最佳实践**：业务侧用 OpenTelemetry 接入全链路，RocketMQ Trace 作为消息维度的细节补充。

---

## 十三、一句话记住核心

> **Trace = SendMessageHook + ConsumeMessageHook 收集 → 异步批量发到 RMQ_SYS_TRACE_TOPIC → 自己消费写存储。**
>
> **三种 TraceType**：Pub（发送）/ SubBefore（开始消费）/ SubAfter（消费完成）。
>
> **性能权衡**：Trace 流量 ≈ 业务流量 × 3，大流量场景考虑采样。
>
> 排查"消息怎么了"的标配——比看日志强 10 倍，但启用前算清楚成本。
