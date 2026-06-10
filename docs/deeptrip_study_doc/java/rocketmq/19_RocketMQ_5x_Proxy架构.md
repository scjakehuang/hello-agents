# RocketMQ 5.x Proxy 架构（存算分离 + gRPC + Pop）

5.x 是 RocketMQ 自诞生以来最大的一次架构重构。核心理念：**Broker 只做存储，Proxy 做计算和协议适配**。

---

## 一、4.x 的痛点

### 1.1 客户端复杂

```
4.x 客户端必须做的事：
  • 维护 Topic 路由表
  • 选 MessageQueue（负载均衡）
  • Rebalance 分配
  • 长轮询管理
  • 故障规避
  • offset 提交

→ 客户端 SDK 几万行代码
→ 多语言 SDK 难以维护一致行为
```

### 1.2 协议绑定 Java

```
4.x 协议是 Netty 自定义二进制协议
  → Java SDK 完美支持
  → C++/Go/Python SDK 都是"努力翻译" Java 行为
  → 行为差异多，bug 多
```

### 1.3 云原生不友好

```
Broker 直接对外
  → K8s 中难以做"无状态扩缩容"
  → Broker 既要存储又要做客户端交互
  → 计算资源和存储资源耦合
```

---

## 二、5.x 整体架构

```
┌───────────────────────────────────────────────────────────┐
│                  Client（任意语言）                          │
│     gRPC 协议（标准 protobuf，跨语言友好）                    │
└───────────────────────┬───────────────────────────────────┘
                        │ gRPC over HTTP/2
                        ▼
┌───────────────────────────────────────────────────────────┐
│               Proxy（无状态计算层）                          │
│                                                            │
│   • gRPC ↔ Remoting 协议转换                                │
│   • 路由发现、负载均衡                                       │
│   • Pop 消费协调                                            │
│   • 事务消息回查                                            │
│   • 限流、鉴权                                              │
│                                                            │
│   特点：无状态 → 任意扩缩容 → 适合 K8s HPA                   │
└──────────┬──────────────────────────────┬──────────────────┘
           │ Remoting 协议                  │
           ▼                                ▼
┌─────────────────────┐         ┌─────────────────────────┐
│   NameServer        │         │   Broker（存储层）        │
│   • 路由信息          │         │   • CommitLog            │
│   • 集群元数据        │         │   • ConsumeQueue        │
│                     │         │   • IndexFile            │
│                     │         │   • Pop 消费支持         │
└─────────────────────┘         └─────────────────────────┘
```

---

## 三、两种部署模式

### 3.1 Local 模式（兼容 4.x）

```
Proxy 和 Broker 部署在同一进程
  → 内部 method call，无网络开销
  → 适合从 4.x 平滑升级
  → 客户端可以是 4.x SDK 或 5.x SDK

启动：
  sh bin/mqbroker --enable-proxy
```

### 3.2 Cluster 模式（推荐）

```
Proxy 集群 + Broker 集群独立部署
  → Proxy 无状态，K8s 自由扩缩
  → Broker 有状态，单独管理
  → 资源精细化

启动：
  Broker: sh bin/mqbroker
  Proxy:  sh bin/mqproxy
```

---

## 四、gRPC 协议优势

### 4.1 协议对比

| 维度 | 4.x Remoting | 5.x gRPC |
|---|---|---|
| **底层** | Netty TCP + 自定义二进制 | HTTP/2 + protobuf |
| **多语言** | 需要自己实现协议 | grpc-tools 自动生成 |
| **流式** | 自定义实现 | HTTP/2 原生支持 |
| **可观测性** | 自己造轮子 | grpc-trace 现成 |
| **网关友好** | Nginx/Envoy 难处理 | 主流网关都支持 |

### 4.2 IDL 定义示例

```proto
service MessagingService {
    // 发送消息
    rpc SendMessage(SendMessageRequest) returns (SendMessageResponse);
    
    // Pop 消费
    rpc ReceiveMessage(ReceiveMessageRequest) returns (stream ReceiveMessageResponse);
    
    // ACK
    rpc AckMessage(AckMessageRequest) returns (AckMessageResponse);
    
    // 事务结果上报
    rpc EndTransaction(EndTransactionRequest) returns (EndTransactionResponse);
    
    // 心跳
    rpc HeartBeat(HeartBeatRequest) returns (HeartBeatResponse);
}
```

### 4.3 多语言 SDK 现状

```
官方维护：
  ✓ Java
  ✓ Go
  ✓ C++
  ✓ Python
  ✓ Rust
  ✓ Node.js
  ✓ .NET

→ 第一次实现了"真正的多语言一致行为"
```

---

## 五、Proxy 的核心职责

### 5.1 协议转换

```
Client (gRPC SendMessage)
    │
    ▼
Proxy: 解 gRPC request → 构造 Remoting Request
    │
    ▼
Broker (Remoting Protocol)
    │
    ▼
Proxy: 解 Remoting Response → 构造 gRPC response
    │
    ▼
Client (gRPC SendMessageResponse)
```

### 5.2 路由屏蔽

```
4.x 客户端：
  自己查 NameServer → 算路由 → 选 Queue → 发到对应 Broker

5.x 客户端：
  只跟 Proxy 通信
  路由、负载均衡都在 Proxy 内部完成
  → 客户端"无状态"
```

### 5.3 Pop 消费协调

```
传统 Pull：
  Consumer 主动拉 → 维护 offset → Rebalance
  → 客户端复杂

Pop 消费：
  Consumer 调 Proxy.ReceiveMessage
  Proxy 从任意 Broker 拉 → 直接返回给 Consumer
  → 不需要客户端做 Rebalance
  → 见 20_Pop消费vs_Pull消费.md
```

### 5.4 事务消息回查

```
4.x：Broker 直接回查 Producer（Producer 必须保持服务可用）
5.x：Proxy 代理回查 → Producer 可以随时下线/重启
```

---

## 六、Broker 在 5.x 的变化

### 6.1 增强 Pop API

```
4.x Broker：
  GET_MIN_OFFSET / GET_MAX_OFFSET / PULL_MESSAGE
  
5.x Broker 新增：
  POP_MESSAGE：原子地拉取 + 临时占用消息
  ACK_MESSAGE：确认消费
  CHANGE_INVISIBLE_TIME：延长占用时间
  
→ 让 Proxy 能实现 Pop 语义
→ 见 20_Pop消费vs_Pull消费.md
```

### 6.2 TimerMessageStore

```
4.x：18 级固定延迟
5.x：基于时间轮的任意时间延迟
  → 见 09_延迟消息实现原理.md
```

### 6.3 元数据存储增强

```
5.x：Topic 配置可以存到外部存储（如 RocksDB）
→ 摆脱 topics.json 单文件限制
→ 支持百万级 Topic
```

---

## 七、5.x 的核心优势

### 7.1 K8s 友好

```
Proxy 无状态：
  • 任意水平扩缩
  • 滚动更新无影响
  • HPA 自动扩容（CPU/请求数触发）

Broker 有状态：
  • StatefulSet 部署
  • PVC 挂载持久化
  • 独立管理
```

### 7.2 真正的多租户

```
4.x：依赖 NameSrv 隔离，比较弱
5.x：Proxy 层做命名空间（namespace）隔离
  • 不同租户的 Topic/Group 完全隔离
  • 资源、配额、限流分租户管理
```

### 7.3 计算/存储独立扩展

```
场景：消费 RT 高，CPU 压力大
4.x：必须扩 Broker 整体 → 存储资源浪费
5.x：只扩 Proxy 节点 → 精准扩容
```

### 7.4 Serverless 雏形

```
Proxy 节点彻底无状态
  → 按请求数计费
  → 闲时缩容到 0
  → Cloud-native MQ 模式
```

---

## 八、迁移路径

### 8.1 从 4.x 到 5.x

```
阶段 1：Broker 升级到 5.x（兼容 4.x 客户端）
  → 旧 SDK 继续工作
  → 验证 Broker 稳定性

阶段 2：部署 Proxy 集群（Cluster 模式）
  → 新业务用 5.x SDK
  → 旧业务继续用 4.x SDK 直连 Broker

阶段 3：逐步迁移客户端到 5.x SDK
  → 通过 Proxy 统一接入
  → 享受多语言 + Pop 等新特性

阶段 4：关闭 Broker 对外端口
  → 强制全部走 Proxy
  → 完成架构升级
```

### 8.2 5.x SDK API 示例（Java）

```java
// Producer
ClientServiceProvider provider = ClientServiceProvider.loadService();
Producer producer = provider.newProducerBuilder()
    .setClientConfiguration(ClientConfiguration.newBuilder()
        .setEndpoints("proxy.example.com:8081")
        .build())
    .setTopics("OrderTopic")
    .build();

Message msg = provider.newMessageBuilder()
    .setTopic("OrderTopic")
    .setTag("pay")
    .setBody("Hello".getBytes())
    .build();

SendReceipt receipt = producer.send(msg);

// Consumer（Pop 模式）
PushConsumer consumer = provider.newPushConsumerBuilder()
    .setClientConfiguration(...)
    .setConsumerGroup("group1")
    .setSubscriptionExpressions(Collections.singletonMap("OrderTopic", 
        new FilterExpression("pay", FilterExpressionType.TAG)))
    .setMessageListener(msg -> {
        // 处理
        return ConsumeResult.SUCCESS;
    })
    .build();
```

---

## 九、性能权衡

```
4.x：客户端直连 Broker
  最低延迟、最高吞吐

5.x：客户端 → Proxy → Broker
  额外一跳网络（约 0.5~1ms RT 增加）
  但获得 K8s 友好、多语言、运维简单等收益

→ 取舍：吞吐稍降，但工程复杂度大幅降低
→ 大多数场景值得
```

### 9.1 性能数据

```
Local 模式（Proxy + Broker 同进程）：
  ≈ 4.x 性能（无额外网络）

Cluster 模式（Proxy 独立部署）：
  TPS：相比 4.x 下降 10~20%
  RT：增加 0.5~1ms
  → 一般业务可接受
```

---

## 十、Proxy 的内部组件

```
Proxy 进程内部：
┌─────────────────────────────────────────┐
│ gRPC Server (port 8081)                  │
│   ├─ MessagingServiceImpl                │
│   └─ AdminMessagingServiceImpl           │
├─────────────────────────────────────────┤
│ Activity 层（业务逻辑）                    │
│   ├─ ProducerActivity                    │
│   ├─ ReceiveMessageActivity              │
│   ├─ AckMessageActivity                  │
│   └─ TransactionActivity                 │
├─────────────────────────────────────────┤
│ Service 层                                │
│   ├─ TopicRouteService                   │
│   ├─ ProducerManager                     │
│   ├─ ConsumerManager                     │
│   └─ TransactionService                  │
├─────────────────────────────────────────┤
│ Remoting Client（连 Broker）              │
│   └─ NettyRemotingClient                 │
└─────────────────────────────────────────┘
```

---

## 十一、运维注意

### 11.1 Proxy 集群部署

```yaml
# K8s Deployment 示例
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rmq-proxy
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: proxy
        image: rocketmq:5.1.0
        command: ["sh", "bin/mqproxy"]
        env:
        - name: NAMESRV_ADDR
          value: "nameserver:9876"
        ports:
        - containerPort: 8081
```

### 11.2 客户端配置

```java
// 只需要配 Proxy 地址，不需要 NameServer
ClientConfiguration config = ClientConfiguration.newBuilder()
    .setEndpoints("rmq-proxy.example.com:8081")
    .build();
```

### 11.3 监控指标

```
Proxy 维度：
  • gRPC RT
  • gRPC QPS
  • Proxy → Broker RT
  • 协议转换错误率
  
Broker 维度（不变）：
  • 写入 TPS / RT
  • PageCache 命中率
  • 刷盘延迟
```

---

## 十二、和 Pulsar 对比

| 维度 | RocketMQ 5.x | Pulsar |
|---|---|---|
| **架构** | Proxy + Broker | Broker + BookKeeper |
| **存算分离** | Proxy 计算，Broker 存储 | Broker 计算，BookKeeper 存储 |
| **存储模型** | CommitLog 大文件 | Segment 分片 |
| **多语言** | gRPC 标准 SDK | 自定义协议 + 多语言客户端 |
| **K8s 友好** | ✓ 5.x 重点 | ✓ 原生设计 |
| **生态** | 阿里 + 国内强 | Apache + 国外强 |

---

## 十三、一句话记住核心

> **5.x = Broker 只管存储 + Proxy 做计算和协议适配 + gRPC 跨语言。**
>
> 客户端从重变轻：路由、负载、Rebalance 全交给 Proxy。
>
> 部署从单层变两层：Proxy 无状态 K8s 任意扩，Broker 有状态独立管。
>
> 这是 RocketMQ 走向云原生的关键一步——为下一代 Serverless MQ 铺路。
