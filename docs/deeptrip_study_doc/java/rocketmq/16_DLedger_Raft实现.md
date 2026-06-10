# DLedger 与 Raft 实现（Broker 高可用集群）

DLedger 是 RocketMQ 4.5+ 引入的基于 **Raft 协议**的多副本一致性组件，解决了传统 Master/Slave 模式的"Master 挂了无法自动切换"问题。

---

## 一、为什么需要 DLedger？

### 1.1 传统 Master/Slave 痛点

```
Master/Slave 模式（4.5 之前）：
  Master (192.168.1.10) ── HA 同步 ── Slave (192.168.1.11)
        ↓ Master 挂了
        ✗ Slave 不能自动提升为 Master
        ✗ 需要人工修改 broker.conf 重启 Slave
        ✗ 期间 Producer 无法写入

→ "高可靠" 但不"高可用"
```

### 1.2 DLedger 解决方案

```
DLedger 集群（3 节点为例）：
  Node-0 (Leader)  ──┐
  Node-1 (Follower) ─┼── Raft 多数派写入
  Node-2 (Follower) ─┘
        ↓ Leader 挂了
        ✓ 剩余节点自动选举新 Leader
        ✓ Producer 自动切到新 Leader
        ✓ 整个过程 5~10 秒，无人工介入
```

---

## 二、Raft 协议核心三件套

DLedger 严格实现 Raft 算法，三大子问题：

```
① Leader 选举（Leader Election）
② 日志复制（Log Replication）
③ 安全性保证（Safety）
```

---

## 三、Leader 选举

### 3.1 三种角色

```
Follower（默认）
    │
    │ 选举超时
    ▼
Candidate
    │
    │ 得到多数票
    ▼
Leader
    │
    │ 发现更高 term 的 Leader
    ▼
Follower
```

### 3.2 选举触发条件

```
每个 Follower 维护 electionTimeout（随机 150~300ms）

如果 electionTimeout 期间没收到 Leader 心跳：
  → 转为 Candidate
  → term++（当前任期号 +1）
  → 投票给自己
  → 向其他节点发送 RequestVote RPC
```

### 3.3 投票规则

```java
// 其他节点收到 RequestVote 后判断：
boolean grantVote(VoteRequest req) {
    // ① term 必须比自己大或相等
    if (req.term < currentTerm) return false;
    
    // ② 本任期还没投过票（或投给了同一个 candidate）
    if (votedFor != null && votedFor != req.candidateId) return false;
    
    // ③ Candidate 的日志至少和我一样新
    //    (lastLogTerm 大或 term 同但 lastLogIndex 大于等于)
    if (!isCandidateLogUpToDate(req.lastLogTerm, req.lastLogIndex)) {
        return false;
    }
    
    return true;
}
```

### 3.4 选举完成

```
Candidate 收集投票：
  收到 > N/2 票 → 成为 Leader
  收到 Leader 心跳 → 退回 Follower
  electionTimeout 又超时 → 重新选举（term++）

→ 随机 electionTimeout 是关键
→ 防止所有节点同时发起选举导致永远选不出来
```

### 3.5 选举过程时序

```
T0    Node-0 Leader 挂掉
T0+50ms  Node-1 没收到心跳，启动 electionTimeout (随机 180ms)
T0+30ms  Node-2 没收到心跳，启动 electionTimeout (随机 220ms)

T0+230ms Node-1 超时 → 转 Candidate → term=2 → 投自己
         → 向 Node-2 发 RequestVote(term=2)
         → Node-2 收到：term 大，未投过票，日志匹配 → 同意
T0+240ms Node-1 收到 1 票 + 自己 1 票 = 2 票（多数）→ 成为 Leader
T0+250ms Node-1 发心跳：term=2, leaderId=1
         Node-2 收到 → 重置选举定时器，成为 Follower
```

---

## 四、日志复制

### 4.1 写流程

```
Producer.send() → Leader
    │
    ▼
Leader 写本地 CommitLog
    │
    ▼
并行 AppendEntries → Follower-1, Follower-2
    │                      │
    │                      ▼
    │                Follower 写本地 CommitLog
    │                      │
    │                      ▼
    │                返回 ACK
    │
    │ 收到 > N/2 ACK（含自己）
    ▼
Leader 推进 commitIndex
    │
    ▼
返回 SUCCESS 给 Producer
```

### 4.2 AppendEntries RPC

```java
class AppendEntriesRequest {
    long term;              // Leader 当前任期
    String leaderId;
    long prevLogIndex;      // 新日志前一条的 index
    long prevLogTerm;       // 新日志前一条的 term
    List<LogEntry> entries; // 新日志（可为空，用于心跳）
    long leaderCommit;      // Leader 已提交的最大 index
}
```

### 4.3 一致性检查（关键）

```
Follower 收到 AppendEntries：
  ① 检查 prevLogIndex 处的 term 是否与 prevLogTerm 一致
  
  ② 如果不一致（日志冲突）：
     - 拒绝这次写入
     - 返回失败
     - Leader 会回退 prevLogIndex 重试
  
  ③ 如果一致：
     - 追加 entries 到本地 CommitLog
     - 更新 commitIndex = min(leaderCommit, lastNewLogIndex)
     - 返回成功

→ 这就是 Raft 的"Log Matching Property"
→ 保证 Leader 和 Follower 的日志最终完全一致
```

### 4.4 写入示例

```
初始状态（term=2）：
  Node-0 (Leader)：  [1] [2] [3]
  Node-1 (Follower)：[1] [2] [3]
  Node-2 (Follower)：[1] [2] [3]

新消息进来：
  Leader 写本地：    [1] [2] [3] [4]
  发 AppendEntries(prevIdx=3, prevTerm=2, entries=[(4,...)]) 给 Followers
  
  Node-1 收到：检查 idx=3 的 term=2 ✓ → 追加 [4]
  Node-2 收到：检查 idx=3 的 term=2 ✓ → 追加 [4]
  
  返回 ACK → Leader 收到 2 个 ACK（含自己 1 个）= 3 > N/2 ✓
  → Leader commitIndex = 4
  → 返回 SUCCESS 给 Producer
  → 下次 AppendEntries 时 leaderCommit=4 → Followers 也 commit
```

### 4.5 网络分区与冲突修复

```
场景：Leader 与 Node-2 网络分区

  Leader (Node-0)：  [1] [2] [3] [4] [5]   ← 新消息持续进来
  Follower (Node-1)：[1] [2] [3] [4] [5]
  Follower (Node-2)：[1] [2] [3]           ← 落后

  分区恢复后：
  Leader 发 AppendEntries(prevIdx=5, prevTerm=2, [(6,...)]) 给 Node-2
  Node-2 检查 idx=5 不存在 → 失败
  Leader 收到失败 → prevIdx 回退到 4 → 重试
  仍失败 → 继续回退到 3 → ✓
  → 一次性发 [(4,...), (5,...), (6,...)] 给 Node-2
  → Node-2 追上
```

---

## 五、安全性保证

### 5.1 Leader 完整性（Leader Completeness）

```
规则：新 Leader 必须包含所有已 commit 的日志

实现：
  RequestVote 时 Candidate 必须带上自己的 lastLogIndex 和 lastLogTerm
  其他节点只投票给"日志至少和我一样新"的 Candidate
  
  → 选出的 Leader 一定包含所有 > N/2 节点上已 commit 的日志
  → 已 commit 的日志永不丢失
```

### 5.2 日志匹配性（Log Matching）

```
规则：如果两个节点的某一日志条目 index 和 term 都相同
     那么它们之前的所有日志条目也都相同

实现：
  AppendEntries 的 prevLogIndex + prevLogTerm 一致性检查
  
  → 保证所有节点的日志最终完全一致
```

### 5.3 状态机安全（State Machine Safety）

```
规则：如果某 index 上的日志已 commit
     那所有节点最终都会在该 index 上应用相同的日志

实现：
  commitIndex 在节点间通过 leaderCommit 传播
  Follower 严格按 commitIndex 顺序 apply
  
  → 所有节点状态机最终一致
```

---

## 六、DLedger 在 RocketMQ 中的整合

### 6.1 配置开启

```properties
# broker.conf

# 启用 DLedger
enableDLegerCommitLog=true

# DLedger 组名
dLegerGroup=broker-a-group

# DLedger 节点列表（n0/n1/n2 是节点 ID）
dLegerPeers=n0-192.168.1.10:40911;n1-192.168.1.11:40911;n2-192.168.1.12:40911

# 本节点 ID
dLegerSelfId=n0

# 存储路径
storePathRootDir=/data/rocketmq/dledger
storePathCommitLog=/data/rocketmq/dledger/commitlog
```

### 6.2 替换 CommitLog 实现

```
传统 Broker：
  CommitLog → MappedFile（直接写本地）
  
DLedger Broker：
  DLedgerCommitLog → DLedgerServer → 通过 Raft 同步到多副本
                          │
                          ├── 本地 CommitLog（MappedFile）
                          └── 网络同步给 Follower
```

### 6.3 角色与 BrokerId 映射

```
DLedger 集群 (3 节点)：
  n0 (Leader)   → BrokerId=0 (Master)
  n1 (Follower) → BrokerId=1 (Slave)
  n2 (Follower) → BrokerId=2 (Slave)

Leader 切换后：
  n1 (Leader)   → BrokerId=0 (Master)
  n0 (Follower) → BrokerId=1 (Slave)
  
  → Broker 自动更新 BrokerId 注册到 NameServer
  → Producer 自动发现新 Master
```

---

## 七、性能与权衡

### 7.1 性能数据

```
传统 ASYNC_MASTER：单机 50W TPS
DLedger 3 节点：    单机 30W TPS（性能损失约 40%）
DLedger 5 节点：    单机 20W TPS

原因：每条写入要等 > N/2 节点 ACK
  3 节点 → 需要 2 ACK（含自己）→ 1 个网络往返
  5 节点 → 需要 3 ACK → 1 个网络往返但要更多并发
```

### 7.2 部署规模建议

```
✓ 3 节点：最常用，能容忍 1 节点故障
✗ 5 节点：能容忍 2 节点故障，但性能损失大
✗ 偶数节点：不推荐（同样故障容忍但写入路径长）

→ 99% 场景用 3 节点
```

### 7.3 适用场景

```
适合用 DLedger：
  ✓ 金融、订单、支付等强一致场景
  ✓ 不能容忍人工切换的核心业务
  ✓ 跨可用区部署

不适合用 DLedger：
  ✗ 极致吞吐需求（埋点、日志）
  ✗ 单机房部署，传统 SYNC_MASTER 足够
  ✗ 资源紧张（DLedger 需要至少 3 倍节点）
```

---

## 八、运维相关

### 8.1 查看集群状态

```bash
# 看 Leader 是谁
sh bin/mqadmin getBrokerEpoch -n localhost:9876 -c DefaultCluster

# 看 DLedger 状态（需要进 DLedger admin）
echo "ledger info" | nc localhost 40911
```

### 8.2 常见问题

| 现象 | 排查 |
|---|---|
| 选不出 Leader | 检查节点数 ≥ N/2+1，检查网络互通 |
| 写入超时 | 检查 Follower 是否健康，看是否在 catch up |
| 切换过程消息丢失 | 检查 Producer 重试配置 |
| Follower 长期落后 | 看网络带宽，看磁盘 IO |

### 8.3 故障演练

```
模拟 Leader 挂掉：
  ① kill -9 Leader 进程
  ② 观察 5~10 秒内新 Leader 选出
  ③ Producer 自动恢复发送（前提是重试配置正确）

模拟脑裂：
  ① iptables drop Leader 到部分节点的流量
  ② 看是否会有两个 Leader（不会，因为多数派要求）
```

---

## 九、和 Master/Slave 对比

| 维度 | Master/Slave | DLedger |
|---|---|---|
| **副本数** | 1 Master + N Slave | 通常 3 节点 |
| **写一致性** | SYNC/ASYNC 可选 | 强一致（Raft 多数派） |
| **Master 挂了** | 手动切换 | 自动选举（5~10s） |
| **数据安全** | 可能丢（ASYNC 模式） | 永不丢已 commit 数据 |
| **性能** | 高（50W TPS） | 中（30W TPS） |
| **复杂度** | 简单 | 复杂（要懂 Raft） |
| **适用场景** | 通用、高吞吐 | 强一致、自动 failover |

---

## 十、一句话记住核心

> **DLedger = Raft 协议 + RocketMQ CommitLog 的整合方案。**
>
> Leader 选举：electionTimeout 超时 → term++ → 收多数票成 Leader。
>
> 日志复制：每条消息要等 > N/2 节点 ACK 才 commit。
>
> 自动切换：Leader 挂了 5~10 秒内选出新 Leader，Producer 自动切换。
>
> 性能损失 30~40%，换来不依赖人工的高可用——金融场景首选。
