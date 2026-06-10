# Consumer 流控三阈值（避免 OOM 与堆积反噬）

PushConsumer 内置了三个流控阈值，控制单个 Queue 在 Consumer 端的消息堆积量。这套机制是 Consumer 不会 OOM 的关键。

---

## 一、为什么需要 Consumer 端流控？

```
没有流控的灾难：
  Producer 高速发送 → 100W msg 堆积在 Broker
  Consumer 一开始拉取 → 默认每次拉 32 条
  本地处理慢 → 已拉的还没消费完，又继续拉
  ProcessQueue 越堆越大 → 内存爆掉 → OOM
```

**核心矛盾**：

```
Consumer 必须主动控制拉取速度
不能"Broker 有多少消息我就拉多少"
否则就是把 Broker 的堆积转移到 Consumer 内存
```

---

## 二、三个流控阈值

```java
// DefaultMQPushConsumer
public class DefaultMQPushConsumer {
    // ① 单 Queue 最大缓存消息数
    private int pullThresholdForQueue = 1000;
    
    // ② 单 Queue 最大缓存消息大小
    private int pullThresholdSizeForQueue = 100;  // MB
    
    // ③ 单 Queue 最大 offset 跨度
    private int consumeConcurrentlyMaxSpan = 2000;
}
```

### 2.1 阈值 1：消息条数（pullThresholdForQueue）

```
含义：单个 Queue 在 Consumer 本地 ProcessQueue 中
      未消费的消息数 > 1000 时，停止拉取

例：
  Queue-0 ProcessQueue 已缓存 1000 条
  PullMessageService 准备拉新批 → 检测到超阈值 → 暂停
  延迟 50ms 后重新检查
```

### 2.2 阈值 2：消息大小（pullThresholdSizeForQueue）

```
含义：单个 Queue 在本地的消息总字节数 > 100 MB 时停止

为什么不只用条数？
  消息大小差异大：
    1000 条 × 100B = 100KB（轻松）
    1000 条 × 10MB = 10GB（爆内存）
  
  → 双重保护，谁先达到都触发流控
```

### 2.3 阈值 3：offset 跨度（consumeConcurrentlyMaxSpan）

```
含义：本地未消费消息中
      最大 offset - 最小 offset > 2000 时停止

为什么需要这个？
  并发消费时消息无序处理：
    拉到 offset 1000~1100（100 条）
    消费完成 offset 1000~1098（98 条）
    offset 1099 卡住（业务慢）
  
  → ProcessQueue 中 offset 1099 一直堵着
  → 1100~3000 都消费完了，但 ack offset 卡在 1099
  → 一旦 Consumer 重启，从 1099 重拉 1999 条（已消费的全部重复）
  
  → 加跨度限制：1099 不消费就不要拉 3100 以后的
```

**核心 insight**：这个阈值防止"长尾消息"导致的潜在大规模重复消费。

---

## 三、流控触发后的行为

### 3.1 PullMessageService 检测

```java
// RebalancePushImpl.dispatchPullRequest()
// 把 PullRequest 提交给 PullMessageService 前先检查

@Override
public void dispatchPullRequest(List<PullRequest> requests) {
    for (PullRequest pullReq : requests) {
        // 流控检查
        long cachedMessageCount = processQueue.getMsgCount().get();
        long cachedMessageSize = processQueue.getMsgSize().get() / (1024 * 1024);
        
        // ① 条数超限
        if (cachedMessageCount > defaultMQPushConsumer.getPullThresholdForQueue()) {
            executePullRequestLater(pullReq, PULL_TIME_DELAY_MILLS_WHEN_FLOW_CONTROL);
            log.warn("queue flow control, msgCount={}", cachedMessageCount);
            return;
        }
        
        // ② 大小超限
        if (cachedMessageSize > defaultMQPushConsumer.getPullThresholdSizeForQueue()) {
            executePullRequestLater(pullReq, PULL_TIME_DELAY_MILLS_WHEN_FLOW_CONTROL);
            log.warn("queue flow control, msgSize={}MB", cachedMessageSize);
            return;
        }
        
        // ③ 跨度超限
        if (!consumeOrderly && processQueue.getMaxSpan() 
                > defaultMQPushConsumer.getConsumeConcurrentlyMaxSpan()) {
            executePullRequestLater(pullReq, PULL_TIME_DELAY_MILLS_WHEN_FLOW_CONTROL);
            log.warn("queue flow control, maxSpan={}", processQueue.getMaxSpan());
            return;
        }
        
        // 通过流控 → 入队
        pullMessageService.executePullRequestImmediately(pullReq);
    }
}
```

### 3.2 延迟重试机制

```java
private static final long PULL_TIME_DELAY_MILLS_WHEN_FLOW_CONTROL = 50;

// 流控触发 → 50ms 后重新检查
public void executePullRequestLater(PullRequest req, long delay) {
    scheduledExecutorService.schedule(() -> {
        pullMessageService.executePullRequestImmediately(req);
    }, delay, TimeUnit.MILLISECONDS);
}
```

**为什么是 50ms**：

```
太短 → 短时间内反复检查浪费 CPU
太长 → Consumer 消费完了，但拉取没及时跟上 → 吞吐降低

50ms 是个工程经验值：
  对应 20 次/秒的检查频率
  既不浪费 CPU，又能及时响应消费速度变化
```

### 3.3 流控日志告警

```
WARN  c.a.r.c.i.RebalancePushImpl - the queue's messages, count exceeds 
       the threshold 1000, so do flow control, minOffset=998, maxOffset=2000

→ 出现这种日志 = Consumer 跟不上 Producer
→ 需要扩 Consumer 实例数或优化消费逻辑
```

---

## 四、ProcessQueue 的内部结构

```java
public class ProcessQueue {
    // TreeMap：key=offset, value=Message
    // 用 TreeMap 因为需要 firstKey/lastKey 快速取最小/最大 offset
    private final TreeMap<Long, MessageExt> msgTreeMap = new TreeMap<>();
    private final AtomicLong msgCount = new AtomicLong();
    private final AtomicLong msgSize = new AtomicLong();
    private final ReadWriteLock lockTreeMap = new ReentrantReadWriteLock();
    
    // 顺序消费用的"消费中"映射
    private final TreeMap<Long, MessageExt> consumingMsgOrderlyTreeMap = new TreeMap<>();
    
    public long getMaxSpan() {
        try {
            lockTreeMap.readLock().lockInterruptibly();
            try {
                if (!msgTreeMap.isEmpty()) {
                    return msgTreeMap.lastKey() - msgTreeMap.firstKey();
                }
            } finally {
                lockTreeMap.readLock().unlock();
            }
        } catch (Exception e) {}
        return 0;
    }
    
    // 添加消息（从 Broker 拉到后）
    public boolean putMessage(List<MessageExt> msgs) {
        try {
            lockTreeMap.writeLock().lockInterruptibly();
            try {
                int validMsgCnt = 0;
                for (MessageExt msg : msgs) {
                    MessageExt old = msgTreeMap.put(msg.getQueueOffset(), msg);
                    if (old == null) {
                        validMsgCnt++;
                        msgSize.addAndGet(msg.getBody().length);
                    }
                }
                msgCount.addAndGet(validMsgCnt);
                return !msgTreeMap.isEmpty();
            } finally {
                lockTreeMap.writeLock().unlock();
            }
        } catch (Exception e) {}
        return false;
    }
    
    // 移除已消费消息（消费成功后）
    public long removeMessage(List<MessageExt> msgs) {
        try {
            lockTreeMap.writeLock().lockInterruptibly();
            try {
                long result = -1;
                if (!msgTreeMap.isEmpty()) {
                    result = queueOffsetMax + 1;
                    int removed = 0;
                    for (MessageExt msg : msgs) {
                        MessageExt prev = msgTreeMap.remove(msg.getQueueOffset());
                        if (prev != null) {
                            removed++;
                            msgSize.addAndGet(0 - msg.getBody().length);
                        }
                    }
                    msgCount.addAndGet(0 - removed);
                    
                    // ★ 拿剩余消息中最小的 offset 作为新的 ack offset
                    if (!msgTreeMap.isEmpty()) {
                        result = msgTreeMap.firstKey();
                    }
                }
                return result;
            } finally {
                lockTreeMap.writeLock().unlock();
            }
        } catch (Exception e) {}
        return -1;
    }
}
```

### 4.1 ack offset 推进算法

```
关键代码：result = msgTreeMap.firstKey()

含义：消费成功后，offset 只能推进到 ProcessQueue 中最小的 offset
     而不是消费成功消息的 offset

例：
  ProcessQueue 当前有 [1000, 1001, 1002, 1003, 1004]
  消费成功 1002, 1003, 1004（并发消费完成顺序）
  
  移除后剩 [1000, 1001]
  msgTreeMap.firstKey() = 1000
  → ack offset 提交到 1000（不是 1004！）
  
  原因：1000、1001 还没消费完
       如果提交 1004，Consumer 崩溃后 1000、1001 就丢了
  
  → 这就是 consumeConcurrentlyMaxSpan 阈值存在的原因
```

---

## 五、顺序消费的特殊处理

顺序消费（MessageListenerOrderly）不走流控逻辑（因为天然有序+阻塞，不会乱序消费导致跨度问题）：

```java
// 顺序消费不检查 maxSpan
if (!consumeOrderly && processQueue.getMaxSpan() > maxSpan) {
    // 流控
}
```

但仍然有自己的限流：

```java
// MessageListenerOrderly 走 ConsumeMessageOrderlyService
// 每次只取一批连续 offset 处理，处理完 ack 再取下一批
```

---

## 六、流控参数调优指南

### 6.1 高吞吐场景（消息小、消费快）

```java
consumer.setPullThresholdForQueue(5000);          // 提到 5000
consumer.setPullThresholdSizeForQueue(500);       // 500MB
consumer.setConsumeConcurrentlyMaxSpan(5000);     // 5000
consumer.setPullBatchSize(64);                     // 一次拉 64 条
consumer.setConsumeMessageBatchMaxSize(32);       // 一批消费 32 条
```

### 6.2 大消息场景（消息体大）

```java
consumer.setPullThresholdForQueue(100);           // 降到 100
consumer.setPullThresholdSizeForQueue(50);        // 50MB
consumer.setConsumeConcurrentlyMaxSpan(500);
consumer.setPullBatchSize(8);                      // 一次少拉
```

### 6.3 慢消费场景（业务逻辑慢、RT 高）

```java
consumer.setPullThresholdForQueue(200);
consumer.setConsumeConcurrentlyMaxSpan(500);      // 跨度收窄
consumer.setConsumeThreadMin(20);                  // 增加消费线程
consumer.setConsumeThreadMax(64);
```

### 6.4 顺序消费场景

```java
consumer.setPullThresholdForQueue(1000);          // 流控按条数
// maxSpan 不生效
// consumeMessageBatchMaxSize = 1（顺序）
```

---

## 七、监控与排查

### 7.1 关键日志

```
[WARN] queue flow control, msgCount=1000, minOffset=998, maxOffset=2998
[WARN] queue flow control, msgSize=105MB
[WARN] queue flow control, maxSpan=2001
```

### 7.2 监控指标

```
Consumer 端：
  • ProcessQueue.msgCount      → 应远小于阈值
  • ProcessQueue.msgSize       → 应远小于阈值
  • ProcessQueue.maxSpan       → 应远小于阈值
  • 消费 RT                    → 平均 < 100ms
  • 消费失败率                  → < 0.1%

Broker 端：
  • Consumer offset 推进速度
  • Consumer 拉取 TPS
  • 消费延迟时间（消息存储时间 - 消费时间）
```

### 7.3 流控频繁告警的根因

| 现象 | 根因 | 应对 |
|---|---|---|
| msgCount 频繁触发 | 消费慢、实例少 | 扩 Consumer 实例 / 优化业务 RT |
| msgSize 频繁触发 | 大消息 + 缓冲过多 | 调小 pullBatchSize |
| maxSpan 频繁触发 | 有"卡住"的消息 | 检查是否有 hung 的消费线程 |
| 三者都触发 | 整体跟不上 | 全面扩容 + 优化 |

---

## 八、和 Broker 端长轮询的协作

```
Consumer 端流控：    限制本地缓存大小
Broker 端长轮询：    没消息时挂起请求

两者结合：
  Consumer 拉到 1000 条 → 流控触发 → 暂停拉取
  本地消费 → 100 条消费完成 → 重新拉取
  Broker 此时可能有新消息直接返回，也可能挂起 30s

→ 两端互相配合，既不会 OOM 也不会空转
```

---

## 九、一句话记住核心

> **Consumer 流控三阈值：单 Queue 最多缓存 1000 条 / 100MB / offset 跨度 2000。**
>
> 任一超限 → 停止拉取 → 50ms 后重新检查。
>
> ProcessQueue 用 TreeMap 维护未消费消息，ack offset 只能推进到 firstKey（最小 offset）。
>
> 这套机制 + Broker 长轮询 = Consumer 既不会 OOM 又不会空转，是 RocketMQ Consumer 稳定性的基石。
