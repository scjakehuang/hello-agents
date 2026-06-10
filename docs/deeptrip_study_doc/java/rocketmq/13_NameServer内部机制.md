# NameServer 的内部机制（5 张路由表 + 心跳）

NameServer 是 RocketMQ 的"导航中心"。它不持久化，不复杂，但**整个集群的拓扑发现都依赖它**。

---

## 一、NameServer 的核心定位

```
┌─────────────────────────────────────────────────────────┐
│ NameServer 是什么：                                       │
│   • 极简注册中心（< 1 万行核心代码）                       │
│   • 无状态、内存存储（关机就丢，重启自动重建）              │
│   • 节点间互不通信（不像 ZK 要选主，不像 ETCD 要 Raft）    │
│   • 集群部署：多个 NameServer 互相独立，Broker 全部注册     │
└─────────────────────────────────────────────────────────┘
```

**为什么不用 ZooKeeper？**

```
ZK 痛点：
  ✗ 强一致 → 写性能差（每写一次要过半节点同意）
  ✗ 节点抖动会触发选主 → 短时不可用
  ✗ 维护复杂、依赖重

RocketMQ 的需求：
  ✓ 路由信息允许短时不一致（Broker 心跳 30s）
  ✓ 读多写少（Producer/Consumer 频繁查路由）
  ✓ 高可用（一个 NS 挂了不影响）

→ AP > CP，自研轻量 NameServer
```

---

## 二、五张核心路由表

NameServer 内存里维护 5 张表，互相关联：

```java
// RouteInfoManager.java
public class RouteInfoManager {
    
    // ① Topic 路由表：Topic → 这个 Topic 在哪些 Broker 上有 Queue
    private final HashMap<String /*topic*/, List<QueueData>> topicQueueTable;
    
    // ② Broker 地址表：BrokerName → Master/Slave 物理地址
    private final HashMap<String /*brokerName*/, BrokerData> brokerAddrTable;
    
    // ③ 集群表：ClusterName → 这个集群下的所有 BrokerName
    private final HashMap<String /*clusterName*/, Set<String /*brokerName*/>> clusterAddrTable;
    
    // ④ Broker 存活表：BrokerAddr → 最后一次心跳时间 + Channel
    private final HashMap<String /*brokerAddr*/, BrokerLiveInfo> brokerLiveTable;
    
    // ⑤ FilterServer 表：BrokerAddr → 这个 Broker 注册的过滤服务器列表
    private final HashMap<String /*brokerAddr*/, List<String> /*filterServer*/> filterServerTable;
}
```

### 2.1 topicQueueTable（最重要）

```
{
  "OrderTopic": [
    QueueData {
      brokerName: "broker-a",
      readQueueNums: 8,
      writeQueueNums: 8,
      perm: 6,  // 读写权限
      topicSynFlag: 0
    },
    QueueData {
      brokerName: "broker-b",
      readQueueNums: 8,
      writeQueueNums: 8,
      perm: 6,
      topicSynFlag: 0
    }
  ],
  "PayTopic": [
    ...
  ]
}
```

**Producer/Consumer 查路由就是查这张表**。

### 2.2 brokerAddrTable

```
{
  "broker-a": BrokerData {
    cluster: "DefaultCluster",
    brokerName: "broker-a",
    brokerAddrs: {
      0L: "192.168.1.10:10911",   // BrokerId=0 → Master
      1L: "192.168.1.11:10911",   // BrokerId=1 → Slave-1
      2L: "192.168.1.12:10911"    // BrokerId=2 → Slave-2
    }
  },
  "broker-b": BrokerData { ... }
}
```

**Producer 写 Master，Consumer 可以从 Master 或 Slave 读**——具体地址都从这查。

### 2.3 clusterAddrTable

```
{
  "DefaultCluster": ["broker-a", "broker-b", "broker-c"],
  "VipCluster": ["broker-vip-1", "broker-vip-2"]
}
```

**用途**：管理后台展示集群拓扑、按集群查询所有 Broker。

### 2.4 brokerLiveTable

```
{
  "192.168.1.10:10911": BrokerLiveInfo {
    lastUpdateTimestamp: 1717488000000,  // 最后心跳时间
    dataVersion: DataVersion {...},       // 数据版本号
    channel: NettyChannel,                // 长连接
    haServerAddr: "192.168.1.10:10912"    // HA 端口
  }
}
```

**核心作用**：判断 Broker 是否存活（120s 没心跳 → 剔除）。

### 2.5 filterServerTable

```
存放 Broker 注册的 FilterServer（SQL92 过滤服务器）地址
4.x 用得多，5.x 已经基本废弃
```

---

## 三、路由信息怎么来：Broker 注册 + 心跳

### 3.1 Broker 启动时注册

```
Broker 启动
    │
    ▼
扫描本地 topics.json
    │
    │ 拿到所有 Topic 和 Queue 配置
    ▼
向所有 NameServer 发 RegisterBrokerRequest
    │
    │ 内容：
    │  • cluster name
    │  • broker name
    │  • broker addr
    │  • brokerId (0=Master, >0=Slave)
    │  • topicConfigSerializeWrapper（所有 Topic 配置）
    │  • filterServerList
    ▼
NameServer 收到后：
  ① 更新 brokerAddrTable
  ② 更新 clusterAddrTable
  ③ 遍历 topicConfig，更新 topicQueueTable
  ④ 创建 BrokerLiveInfo 加入 brokerLiveTable
```

### 3.2 Broker 持续心跳（30 秒一次）

```java
// BrokerOuterAPI.registerBrokerAll()
// Broker 端定时任务（默认 30s）
scheduledExecutorService.scheduleAtFixedRate(() -> {
    BrokerController.this.registerBrokerAll(
        true,   // checkOrderConfig
        false,  // oneway
        brokerConfig.isForceRegister()
    );
}, 10, 30, TimeUnit.SECONDS);
```

心跳的本质：**带 Topic 配置的全量注册**。

### 3.3 NameServer 端剔除挂掉的 Broker

```java
// RouteInfoManager.scanNotActiveBroker()
// NameServer 定时任务（每 10s 扫一次）
public void scanNotActiveBroker() {
    Iterator<Entry<String, BrokerLiveInfo>> it = brokerLiveTable.entrySet().iterator();
    
    while (it.hasNext()) {
        Entry<String, BrokerLiveInfo> next = it.next();
        long last = next.getValue().getLastUpdateTimestamp();
        
        // ★ 超过 120s 没心跳就剔除
        if (System.currentTimeMillis() - last > BROKER_CHANNEL_EXPIRED_TIME) {
            RemotingUtil.closeChannel(next.getValue().getChannel());
            it.remove();
            
            // 同时清理其他 4 张表
            this.onChannelDestroy(next.getKey(), next.getValue().getChannel());
        }
    }
}
```

**关键参数**：

```
心跳间隔：30s（Broker 端）
扫描间隔：10s（NameServer 端）
存活阈值：120s（4 次心跳没到）

→ Broker 挂了之后最多 2 分钟，NameServer 才会感知
→ 中间时间 Producer 可能仍尝试发到挂掉的 Broker（失败重试到其他 Broker）
```

---

## 四、Producer / Consumer 怎么用路由

### 4.1 启动时拉取路由

```java
// MQClientInstance.updateTopicRouteInfoFromNameServer()
public void updateTopicRouteInfoFromNameServer() {
    Set<String> topicList = getAllSubscribedTopic();
    
    for (String topic : topicList) {
        // 任选一个 NameServer 拉路由
        TopicRouteData routeData = mqClientAPI.getTopicRouteInfoFromNameServer(topic);
        
        // 转成 TopicPublishInfo（Producer 用）
        TopicPublishInfo info = topicRouteData2TopicPublishInfo(topic, routeData);
        producerTable.put(topic, info);
        
        // 转成 MessageQueue 集合（Consumer 用）
        Set<MessageQueue> mqs = topicRouteData2SubscribeInfo(topic, routeData);
        rebalanceImpl.setTopicSubscribeInfo(topic, mqs);
    }
}
```

### 4.2 定时刷新（30 秒一次）

```java
scheduledExecutorService.scheduleAtFixedRate(
    this::updateTopicRouteInfoFromNameServer,
    10, 30, TimeUnit.SECONDS
);
```

### 4.3 路由变更如何感知？

**惊讶事实**：**NameServer 不主动推送变更**！全靠客户端 30s 轮询。

```
为什么这么设计？
  ✓ NameServer 无状态，不维护客户端连接
  ✓ 客户端数量可能上万，主动推开销大
  ✗ 路由变更感知慢（最坏 30s）

→ 接受最终一致性，换简单 + 高可用
```

**怎么补偿延迟感知**：

```
场景：Producer 发到了刚下线的 Broker
处理：发送失败 → Producer 内置「故障规避」机制
       → 短期内把这个 Broker 标记为不可用
       → 选其他 Broker 重发

LatencyFaultTolerance：
  发送失败后，根据失败类型计算"规避时长"
  • 超时 30s → 规避 600s
  • 普通失败 → 规避 30s
  → 期间所有该 Broker 的请求自动跳过
```

---

## 五、为什么 NameServer 多节点互不通信？

### 5.1 设计选择

```
ZooKeeper / ETCD：
  节点间互相通信（选主、同步状态）
  → CP，强一致
  
NameServer：
  节点间完全独立，不通信
  → AP，最终一致
  
Broker 端：
  把数据全量注册到每个 NameServer
  → 每个 NS 都有完整数据（冗余存储）
```

### 5.2 一致性怎么保证？

```
Broker 写：往所有 NameServer 同时注册
  → 短时可能不一致（一个 NS 收到，另一个没收到）
  → 30s 心跳会重新对齐

客户端读：随机选一个 NameServer 拉路由
  → 拿到的数据可能略有差异
  → 30s 重拉时会自我修正
```

**业务能容忍这种最终一致性**——Broker 拓扑变化本来就不频繁（不像服务发现微服务每秒变化）。

### 5.3 NameServer 集群部署

```
                Client
                  │
                  │ ① 随机选一个 NS 发请求
       ┌──────────┼──────────┐
       ▼          ▼          ▼
    NS-1       NS-2       NS-3   ← 3 个独立节点，互不通信
       ▲          ▲          ▲
       │          │          │
       └──────────┼──────────┘
                  │
        ② 所有 Broker 把信息推到每个 NS
                  │
              Broker-A
              Broker-B
              Broker-C
```

**故障容忍**：3 个 NS 挂 2 个，剩 1 个仍可服务。

---

## 六、客户端怎么知道 NameServer 地址？

### 6.1 三种配置方式

```java
// 方式 1：直接指定地址列表
producer.setNamesrvAddr("192.168.1.10:9876;192.168.1.11:9876");

// 方式 2：环境变量
export NAMESRV_ADDR=192.168.1.10:9876;192.168.1.11:9876

// 方式 3：URL 动态获取（HTTP 接口）
producer.setNamesrvAddr("http://config.server/getNamesrv");
// 每 2 分钟拉一次，支持动态扩缩容
```

### 6.2 客户端选择 NameServer 策略

```
TopAddressing（HTTP 方式）：
  从 URL 拉到地址列表 → 按 hash 选一个固定 NS
  失败时 fallback 到下一个

直接指定列表：
  启动时随机打散 → 按顺序尝试
  连接断开 → 切换下一个
```

---

## 七、运维与监控

### 7.1 NameServer 启动

```bash
# 启动单个 NameServer
nohup mqnamesrv > namesrv.log 2>&1 &

# 默认端口 9876，可在 -c 配置文件改
```

### 7.2 查看 NS 状态

```bash
# 看注册的 Topic
mqadmin topicList -n 192.168.1.10:9876

# 看注册的 Broker
mqadmin clusterList -n 192.168.1.10:9876

# 看具体 Topic 的路由
mqadmin topicRoute -n 192.168.1.10:9876 -t OrderTopic
```

### 7.3 常见问题

| 问题 | 排查 |
|---|---|
| Producer 报 `No route info of this topic` | ① NS 未启动 ② Topic 未创建 ③ Broker 未心跳到 NS |
| Producer 发送一直失败 | ① Broker 下线但 NS 还没剔除（等 2 分钟）② 网络分区 |
| NameServer 内存涨大 | ① 注册的 Topic 数过多 ② Broker 数过多 |
| NameServer 重启路由全丢 | 等 Broker 心跳重新注册（最长 30s） |

### 7.4 NameServer 资源消耗

```
内存：500MB ~ 2GB（取决于 Topic 数量）
CPU：单核 < 30%（请求量不大）
网络：每 Broker 心跳约 100KB（Topic 多时更大）

→ 用最小的机器都够（2C4G 绰绰有余）
```

---

## 八、5.x 的变化

```
5.x 仍然保留 NameServer
但同时新增了 Controller 模式（用于 Master/Slave 自动切换）
  
Controller：
  基于 DLedger（Raft）
  负责 Broker 角色管理（Master 挂了自动提升 Slave）
  NameServer 不参与选主
  
→ NameServer 仍然是"路由中心"
→ Controller 是新增的"高可用控制器"
→ 两者职责清晰分离
```

---

## 九、一句话记住核心

> **NameServer = 5 张内存路由表 + Broker 心跳剔除 + 客户端 30s 轮询。**
>
> 无状态、无选主、节点互不通信。AP 而非 CP，换来极简 + 高可用。
>
> 数据丢了？等 Broker 30s 心跳自动重建——纯派生数据，本来就该这么轻。
>
> 这是 RocketMQ 最被低估的设计——大道至简，比 ZK 优雅 10 倍。
