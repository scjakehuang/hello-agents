# 消息过滤：Tag vs SQL92（服务端过滤的两种姿势）

RocketMQ 比 Kafka 强大的一点：**消息过滤在 Broker 端做，Consumer 拉到的就是过滤后的结果**。这能极大减少网络流量和 Consumer 处理量。

---

## 一、为什么需要服务端过滤？

```
Topic：OrderTopic（订单事件，所有类型混在一起）
  • 下单事件 (tag=create)
  • 支付事件 (tag=pay)
  • 退款事件 (tag=refund)
  • 取消事件 (tag=cancel)

需求：「报表 Consumer」只关心 pay 和 refund

方案 1：客户端过滤
  Consumer 订阅 OrderTopic + "*"（所有）
  拉到 100 万条 → 客户端过滤掉 70 万条 create/cancel
  → 浪费 70 万条的网络流量 + 反序列化 + 内存

方案 2：服务端过滤（RocketMQ 支持）
  Consumer 订阅 OrderTopic + "pay || refund"
  Broker 在 ConsumeQueue 层就过滤掉无关消息
  → Consumer 只拉到 30 万条
  → 网络、CPU、内存都省
```

---

## 二、Tag 过滤（最常用）

### 2.1 Producer 端

```java
Message msg = new Message(
    "OrderTopic",          // Topic
    "pay",                 // Tag（单个）
    "ORD12345".getBytes()  // body
);
producer.send(msg);
```

**Tag 限制**：

```
• 每条消息只能有一个 Tag
• Tag 长度建议 < 64 字符
• Tag 不能为空（""）
```

### 2.2 Consumer 端

```java
DefaultMQPushConsumer consumer = new DefaultMQPushConsumer("group1");

// 单 Tag
consumer.subscribe("OrderTopic", "pay");

// 多 Tag（OR 关系）
consumer.subscribe("OrderTopic", "pay || refund");

// 所有 Tag
consumer.subscribe("OrderTopic", "*");

consumer.registerMessageListener(new MessageListenerConcurrently() {
    @Override
    public ConsumeConcurrentlyStatus consumeMessage(
            List<MessageExt> msgs, ConsumeConcurrentlyContext ctx) {
        // 这里拿到的都是 pay 或 refund 的消息
        return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
    }
});
```

### 2.3 Tag 过滤的实现原理

**关键 insight**：Tag 过滤利用了 ConsumeQueue 中的 `tagsCode` 字段（消息 tag 的 hashCode）。

```
ConsumeQueue Entry（20 字节）：
┌──────────────────────┬──────────────┬──────────────────────┐
│ commitLogOffset (8B) │ msgSize (4B) │ tagsCode (8B)         │
└──────────────────────┴──────────────┴──────────────────────┘
                                              ↑
                                       存的是 tag.hashCode()
```

**Broker 端过滤流程**：

```java
// 拉消息时：
public GetMessageResult getMessage(String group, String topic, int queueId,
                                    long offset, int maxMsgNums,
                                    MessageFilter filter) {
    SelectMappedBufferResult cqBuf = consumeQueue.getIndexBuffer(offset);
    
    while (cqBuf.hasRemaining() && count < maxMsgNums) {
        long commitLogOffset = cqBuf.getLong();
        int  msgSize         = cqBuf.getInt();
        long tagsCode        = cqBuf.getLong();
        
        // ★ 第一层过滤：仅看 ConsumeQueue 的 tagsCode
        // 用 Consumer 订阅的 tag 列表的 hashCode 集合做匹配
        if (filter != null && !filter.isMatchedByConsumeQueue(tagsCode)) {
            continue;  // 跳过，不读 CommitLog
        }
        
        // 通过第一层过滤 → 读 CommitLog 拿完整消息
        SelectMappedBufferResult msgBuf = commitLog.select(commitLogOffset, msgSize);
        
        // 第二层过滤：再确认 tag 字符串（防止 hash 冲突）
        if (filter != null && !filter.isMatchedByCommitLog(...)) {
            continue;
        }
        
        // 返回给 Consumer
        result.add(msgBuf);
    }
}
```

### 2.4 两层过滤的设计

```
为什么要两层？

第一层（ConsumeQueue tagsCode）：
  • 优势：极快，只需查 20 字节索引
  • 缺陷：hashCode 可能冲突（不同 tag 可能同 hash）

第二层（CommitLog 实际 tag）：
  • 拿到完整消息后再对比真实 tag 字符串
  • 兜底防止 hash 冲突

→ 第一层快速排除大多数无关消息
→ 第二层保证准确性
```

### 2.5 Tag 过滤性能

```
ConsumeQueue 过滤 = 纯内存操作（PageCache 命中）
  → 微秒级
  
节省的开销：
  • 不需要从 CommitLog 读消息体
  • 不需要网络传输
  • Consumer 不需要反序列化

→ 高过滤率（99% 消息被过滤）时性能提升巨大
```

### 2.6 Tag 局限性

```
✗ 只能 OR 关系，不支持 AND
  例：想要 "tag=pay 且金额>1000" → Tag 做不到

✗ 只能匹配字符串，不支持复杂表达式

✗ 一条消息只能一个 Tag

→ 简单分类场景用 Tag
→ 复杂过滤用 SQL92
```

---

## 三、SQL92 过滤（高级场景）

### 3.1 Producer 端：用 Properties 传业务字段

```java
Message msg = new Message("OrderTopic", body);

msg.putUserProperty("region", "shanghai");
msg.putUserProperty("amount", "1500");
msg.putUserProperty("userLevel", "VIP");
msg.putUserProperty("isFirstOrder", "true");

producer.send(msg);
```

### 3.2 Consumer 端：用 SQL 表达式

```java
consumer.subscribe("OrderTopic", MessageSelector.bySql(
    "region = 'shanghai' AND amount > 1000 AND userLevel = 'VIP'"
));
```

### 3.3 支持的 SQL 语法

```sql
-- 数值比较
amount > 1000
amount BETWEEN 1000 AND 5000

-- 字符串
region = 'shanghai'
region IN ('shanghai', 'beijing')
name LIKE 'JOHN%'

-- 布尔
isFirstOrder = TRUE

-- 逻辑组合
(region = 'shanghai' OR region = 'beijing') AND amount > 1000

-- NULL 检查
coupon IS NULL

-- 函数（有限支持）
LENGTH(name) > 5
```

### 3.4 SQL92 的实现

```
SQL92 过滤无法在 ConsumeQueue 层完成（只有 tagsCode 没有 properties）
必须：
  ① 从 ConsumeQueue 拿到 commitLogOffset
  ② 读 CommitLog 拿到完整消息
  ③ 解析 properties
  ④ 执行 SQL 表达式判断
  ⑤ 不匹配则跳过

→ 性能比 Tag 过滤差（必须读 CommitLog）
→ 但仍然在 Broker 端做，减少网络传输
```

### 3.5 启用 SQL92

```properties
# broker.conf
enablePropertyFilter=true   # 默认 false，必须开启
```

### 3.6 SQL92 性能对比

| 场景 | Tag 过滤 | SQL92 过滤 |
|---|---|---|
| ConsumeQueue 命中 | ✓（微秒级） | ✗ |
| 需要读 CommitLog | 否（hash 过滤后跳过） | 是（每条都要读） |
| 过滤准确度 | 两层验证 | 一次性精确 |
| 单机过滤吞吐 | 50W+/s | 10W+/s |
| 复杂表达式 | 不支持 | 支持 |

---

## 四、过滤场景选型

### 4.1 用 Tag 的场景

```
✓ 简单分类（事件类型、业务模块）
✓ 高吞吐
✓ 过滤率高（90%+ 被过滤）

例：
  OrderTopic + Tag(create/pay/refund/cancel)
  LogTopic + Tag(info/warn/error)
```

### 4.2 用 SQL92 的场景

```
✓ 多条件组合
✓ 数值范围
✓ 字符串模糊匹配
✓ 业务字段过滤

例：
  报表 Consumer 只要金额 > 1000 的订单
  风控 Consumer 只要某些地区 + VIP 用户
```

### 4.3 同时用 Tag + SQL（不推荐）

```java
// 技术上可以，但语义混乱
consumer.subscribe("OrderTopic", "pay");

// 然后业务层再过滤 properties → 不优雅
```

→ 推荐：选一个，不要混用

---

## 五、和 Kafka 对比

| 维度 | RocketMQ | Kafka |
|---|---|---|
| **服务端过滤** | ✓ Tag + SQL92 | ✗ 不支持 |
| **客户端过滤** | 支持 | 必须用 |
| **Tag 实现** | ConsumeQueue tagsCode | 无原生概念 |
| **SQL 过滤** | SQL92 子集 | 需要用 Kafka Streams |
| **复杂场景** | 直接订阅+SQL | 多 Topic 或客户端过滤 |

**Kafka 的方案**：要么订阅整个 Topic 客户端过滤，要么按业务字段拆 Topic（10 个事件类型 = 10 个 Topic）。

**RocketMQ 优势**：一个 Topic + 多个 Tag/SQL 就能解决，运维简单。

---

## 六、过滤的坑

### 6.1 Tag 写错了拉不到消息

```
Producer: msg.setTags("Pay")    // 大写 P
Consumer: subscribe("...", "pay") // 小写 p

→ 完全不匹配，拉不到任何消息（Tag 大小写敏感）
```

### 6.2 SQL92 表达式错误

```java
// 错误：column 不存在时如何处理？
consumer.subscribe("OrderTopic", MessageSelector.bySql(
    "amount > 1000"
));
// 如果消息没有 amount property → 默认 false → 过滤掉
// 不会报错，但要注意业务侧 properties 必须设全
```

### 6.3 enablePropertyFilter 没开启

```
Consumer 用 bySql → Broker 没开启 → 报错：
  "The broker does not support consumer to filter message by SQL92"
```

### 6.4 多 Consumer 订阅冲突

```
Consumer-1: subscribe("OrderTopic", "pay || refund")
Consumer-2: subscribe("OrderTopic", "create")
       （同一 Consumer Group）

→ Rebalance 时会冲突：不同实例订阅的 Tag 不一致
→ 行为不可预期（可能拉到所有消息，可能拉不到）

→ 同 Consumer Group 必须订阅相同的 Topic + Tag
```

### 6.5 Tag 包含特殊字符

```
✗ Tag 不能包含 ||（OR 分隔符）
✗ Tag 不能包含空格
✗ Tag 不能为空字符串

最佳实践：用 [a-zA-Z0-9_] 简单字符
```

---

## 七、监控与排查

### 7.1 看实际拉到的消息

```bash
# 命令行消费指定 Tag
mqadmin consumeMessageDirectly -n localhost:9876 -g groupName \
  -c clusterName -i msgId

# 看 Consumer 实际订阅
mqadmin consumerProgress -n localhost:9876 -g groupName
```

### 7.2 过滤效率监控

```
关键指标：
  • Broker 拉取请求处理时间
  • 单次拉取返回的消息数 / 扫描的 ConsumeQueue entry 数
  
异常：
  ① 扫描 1000 条返回 1 条 → 过滤率 99.9%
     → Tag 设计合理；但 ConsumeQueue 扫描压力大
  ② SQL92 过滤后大量 CommitLog 读 → PageCache 失效风险
```

---

## 八、最佳实践

### 8.1 Tag 设计原则

```
✓ 用业务事件类型（如 create / pay / refund）
✓ 简短、清晰、稳定
✓ 不要超过 5~10 种（多了就重新拆 Topic）

✗ 不要把动态字段塞 Tag（如 用户ID、订单号）
✗ 不要用太长的 Tag（影响 hash 分布）
```

### 8.2 SQL92 设计原则

```
✓ 把高频过滤字段放 properties
✓ 表达式越简单越好（性能、可维护性）
✓ 数值字段用数值比较，不要 string 比

✗ 不要在 SQL 里写复杂业务逻辑
✗ 不要依赖默认值（缺字段就别设条件）
```

### 8.3 大流量场景

```
Tag 过滤优先
  → 减少 CommitLog 读 → 减少磁盘 IO
  → ConsumeQueue 全 PageCache → 微秒级响应

SQL92 仅用于：
  → 中低流量
  → 必须精细化过滤的报表 / 风控
```

---

## 九、一句话记住核心

> **Tag 过滤**：利用 ConsumeQueue 的 tagsCode 字段，hash 快速过滤 + CommitLog 二次验证，性能最高，但只支持简单 OR。
>
> **SQL92 过滤**：必须读 CommitLog 解析 properties，支持复杂表达式，性能略低但灵活。
>
> 高吞吐用 Tag，复杂条件用 SQL92——这是 RocketMQ 比 Kafka 强大的一个杀手锏。
