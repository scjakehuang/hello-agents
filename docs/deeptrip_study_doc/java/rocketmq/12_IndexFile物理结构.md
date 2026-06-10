# IndexFile 的物理结构（按 MessageKey 哈希索引）

ConsumeQueue 解决"按队列消费"的索引问题，IndexFile 解决另一个完全不同的问题：**按业务 key 反查消息**。比如"订单 ORD123 关联的所有消息在哪里？"。

---

## 一、IndexFile 解决什么问题？

```
场景：用户投诉「订单 ORD12345 的支付通知没收到」
        │
        ▼
排查链路：要查出 ORD12345 关联的所有消息
        │
        ▼
不能扫全量 CommitLog（几百 GB）
不能查 ConsumeQueue（只索引了物理位置，没索引业务字段）
        │
        ▼
IndexFile 出场：
  按 MessageKey（业务键）做哈希索引
  → 输入 ORD12345 → 输出所有相关消息的物理 offset
```

---

## 二、Producer 怎么使用 MessageKey

```java
Message msg = new Message("OrderTopic", body);
msg.setKeys("ORD12345");              // 单个 key
msg.setKeys("ORD12345 USER789");     // 多个 key 用空格分隔
producer.send(msg);
```

Broker 收到后会**对每个 key 单独建索引**：

```
key="ORD12345" → IndexFile 一条索引
key="USER789"  → IndexFile 另一条索引
```

---

## 三、IndexFile 物理结构

### 3.1 文件命名与大小

```
${ROCKETMQ_HOME}/store/index/
├── 20260601100000000          ← 文件名 = 创建时的时间戳
├── 20260601150000000
└── 20260601200000000

单文件大小固定：约 420 MB
  = 40B Header + 5M × 4B Hash Slot + 20M × 20B Index Entry
```

### 3.2 文件内部布局

```
┌────────────────────────────────────────────────────────────┐
│ IndexHeader（40B）                                          │
│  ├─ beginTimestamp (8B)   ← 文件中第一条消息存储时间        │
│  ├─ endTimestamp   (8B)   ← 最后一条                       │
│  ├─ beginPhyOffset (8B)   ← 第一条消息的 CommitLog offset  │
│  ├─ endPhyOffset   (8B)   ← 最后一条                       │
│  ├─ hashSlotCount  (4B)   ← 已用 slot 数                   │
│  └─ indexCount     (4B)   ← 已用 entry 数                  │
├────────────────────────────────────────────────────────────┤
│ Hash Slot 区（500 万个 slot × 4B = 20 MB）                  │
│  ┌──────┬──────┬──────┬─────┬──────────┐                  │
│  │ slot0│ slot1│ slot2│ ... │ slot4999999│                │
│  │ (4B) │ (4B) │ (4B) │     │ (4B)      │                │
│  └──────┴──────┴──────┴─────┴──────────┘                  │
│  每个 slot 存：链表头的 index entry 编号（int）              │
├────────────────────────────────────────────────────────────┤
│ Index Entry 区（2000 万个 entry × 20B = 400 MB）             │
│  ┌────────────────────────────────────────────┐            │
│  │ Entry 0  │ Entry 1  │ Entry 2  │ ...        │            │
│  │ (20B)    │ (20B)    │ (20B)                  │           │
│  └────────────────────────────────────────────┘            │
│                                                              │
│  每个 Entry（20B）：                                          │
│  ┌──────────────────┬─────────────────┬────────────┬──────┐ │
│  │ keyHash (4B)     │ phyOffset (8B)  │ timeDiff(4B)│prev(4B)│
│  └──────────────────┴─────────────────┴────────────┴──────┘ │
│   ↑                  ↑                  ↑          ↑        │
│   key 的 hashCode    消息在CommitLog    与beginTime  上一个 │
│                      的物理偏移         的差值      同slot   │
│                                                     的entry │
└────────────────────────────────────────────────────────────┘
```

### 3.3 哈希冲突的解决：拉链法

```
key="ORD123"  → hash=1234567 → slot = 1234567 % 5000000 = 1234567
key="USER999" → hash=8888888 → slot = 8888888 % 5000000 = 3888888
key="ABC"     → hash=4234567 → slot = 4234567 % 5000000 = 1234567  ← 冲突！

冲突时：
  Hash Slot[1234567] 指向最新的 entry（链表头）
  
  Index Entry 区：
  Entry-N   (key=ABC, phy=999, prev=Entry-M)     ← slot 指向这里
                                ↓
  Entry-M   (key=ORD123, phy=666, prev=-1)       ← 链表尾

→ 同 slot 的所有 entry 形成「最新 → 最老」的链表
→ 查找时从 slot 拿到链表头，逐个比对 keyHash + timestamp
```

### 3.4 为什么是 500 万 slot + 2000 万 entry？

```
设计权衡：
  slot 数太少 → 冲突太多 → 链表过长 → 查找慢
  slot 数太多 → 浪费内存 → 文件太大
  
  500 万 slot ÷ 2000 万 entry = 平均链表长度 4
  → 每次查找最多对比 4 个 entry，可接受
  → 文件大小 ≈ 420 MB，可以全部 mmap
```

---

## 四、读写流程

### 4.1 写入 IndexFile（Broker 异步分发时）

```java
// IndexFile.putKey()
public boolean putKey(String key, long phyOffset, long storeTimestamp) {
    if (indexCount >= maxIndexCount) return false;  // 文件满了
    
    // ① 算 hash + slot
    int keyHash = indexKeyHashMethod(key);  // 取绝对值
    int slotPos = keyHash % hashSlotNum;
    int slotOffset = INDEX_HEADER_SIZE + slotPos * HASH_SLOT_SIZE;
    
    // ② 读出 slot 当前值（旧链表头 entry 编号，可能为 0 表示空）
    int oldEntryIdx = mappedByteBuffer.getInt(slotOffset);
    
    // ③ 计算新 entry 的位置
    int newEntryIdx = indexCount;
    int entryOffset = INDEX_HEADER_SIZE 
                    + hashSlotNum * HASH_SLOT_SIZE 
                    + newEntryIdx * INDEX_SIZE;
    
    // ④ 写入新 entry（20B）
    long timeDiff = (storeTimestamp - beginTimestamp) / 1000;  // 秒
    mappedByteBuffer.putInt(entryOffset, keyHash);          // 4B
    mappedByteBuffer.putLong(entryOffset + 4, phyOffset);   // 8B
    mappedByteBuffer.putInt(entryOffset + 12, (int) timeDiff); // 4B
    mappedByteBuffer.putInt(entryOffset + 16, oldEntryIdx); // 4B (链表 next)
    
    // ⑤ 更新 slot 指向新 entry
    mappedByteBuffer.putInt(slotOffset, newEntryIdx);
    
    // ⑥ 更新 header 计数
    indexCount++;
    if (oldEntryIdx == 0) hashSlotCount++;
    
    return true;
}
```

### 4.2 查询 IndexFile

```java
// IndexFile.selectPhyOffset()
public void selectPhyOffset(List<Long> result, String key, 
                            int maxNum, long begin, long end) {
    // ① 算 hash + slot
    int keyHash = indexKeyHashMethod(key);
    int slotPos = keyHash % hashSlotNum;
    int slotOffset = INDEX_HEADER_SIZE + slotPos * HASH_SLOT_SIZE;
    
    // ② 读出链表头 entry 编号
    int entryIdx = mappedByteBuffer.getInt(slotOffset);
    if (entryIdx <= 0) return;  // 空 slot
    
    // ③ 遍历链表（最新 → 最老）
    int found = 0;
    while (entryIdx > 0 && found < maxNum) {
        int entryOffset = INDEX_HEADER_SIZE 
                        + hashSlotNum * HASH_SLOT_SIZE 
                        + entryIdx * INDEX_SIZE;
        
        int   storedHash  = mappedByteBuffer.getInt(entryOffset);
        long  phyOffset   = mappedByteBuffer.getLong(entryOffset + 4);
        int   timeDiff    = mappedByteBuffer.getInt(entryOffset + 12);
        int   prevEntryIdx= mappedByteBuffer.getInt(entryOffset + 16);
        
        long storeTime = beginTimestamp + timeDiff * 1000L;
        
        // ★ 三重过滤
        if (storedHash == keyHash                  // hash 相等
         && storeTime >= begin && storeTime <= end) {  // 时间范围
            result.add(phyOffset);
            found++;
        }
        
        entryIdx = prevEntryIdx;  // 继续看链表下一个
    }
}
```

### 4.3 完整查询链路

```
mqadmin queryMsgByKey -t OrderTopic -k ORD12345 -n nameserver:9876
        │
        ▼
Broker 收到 QueryMessage 请求
        │
        │ ① 找到时间范围内的所有 IndexFile（按时间倒序）
        ▼
逐个 IndexFile.selectPhyOffset(key=ORD12345)
        │
        │ ② 拿到一堆 phyOffset
        ▼
逐个 commitLog.lookMessageByOffset(phyOffset)
        │
        │ ③ 读出完整消息
        ▼
返回消息列表（同 key 的所有消息）
```

---

## 五、关键设计点

### 5.1 为什么不用 B+树？

```
B+树优势：范围查询、有序遍历
B+树劣势：随机写、维护成本高

IndexFile 场景：
  ✓ 只查"等值"（按 key 精确查）
  ✓ 写入频繁（高吞吐）
  ✗ 不需要范围查询（业务侧不查"ORD12000~ORD13000"）

→ 哈希表 + 拉链法完胜：写 O(1)、查 O(链表长度≈4)
```

### 5.2 为什么文件名是时间戳？

```
查询时通常带时间范围：
  "查 2026-06-01 ~ 2026-06-02 期间 ORD12345 的消息"

文件名 = 时间戳 → 按文件名就能筛选：
  20260601000000000.idx  ← 包含 06-01 那天的索引
  20260602000000000.idx  ← 包含 06-02 那天的索引
  
→ 时间范围查询能跳过无关文件，减少扫描量
```

### 5.3 timeDiff 为什么不存全量时间戳？

```
全量时间戳：8B
timeDiff（与 beginTimestamp 的差值）：4B
节省 4B/entry × 2000 万 entry = 80 MB/文件

代价：
  最大表示范围 = 2^32 秒 / 86400 / 365 ≈ 136 年
  对单个 IndexFile（最多覆盖几小时）绰绰有余
```

### 5.4 keyHash 用绝对值

```java
int keyHash = Math.abs(key.hashCode());
if (keyHash < 0) keyHash = 0;  // hashCode() 可能返回 Integer.MIN_VALUE

// 为什么？
//   slotPos = keyHash % hashSlotNum
//   负数 % 正数 = 负数 → 数组越界
```

---

## 六、和 ConsumeQueue 的对比

| 维度 | ConsumeQueue | IndexFile |
|---|---|---|
| **用途** | 按 Topic + Queue 顺序消费 | 按 MessageKey 反查 |
| **结构** | 定长 20B entry 数组 | Hash 槽 + 链表 |
| **查找** | O(1) 数组下标 | O(1) hash + O(链表长度) 链表 |
| **写入** | 顺序追加 | 哈希定位写 |
| **粒度** | 每个 (Topic, Queue) 一个目录 | 全局所有消息一个文件 |
| **单文件大小** | 5.72 MB | 420 MB |
| **使用方** | Consumer 拉消息 | 运维 / 管理后台查消息 |

---

## 七、运维相关

### 7.1 命令行查消息

```bash
# 按 MessageKey 查
mqadmin queryMsgByKey -n nameserver:9876 -t OrderTopic -k ORD12345

# 按 MessageId 查（不用 IndexFile，直接拿 offset 读 CommitLog）
mqadmin queryMsgById -n nameserver:9876 -i AC110001000001AABBCC

# 按 unique key 查
mqadmin queryMsgByUniqueKey -n nameserver:9876 -t OrderTopic -i UNIQUE_KEY_VALUE
```

### 7.2 IndexFile 损坏怎么办？

```
和 ConsumeQueue 一样，IndexFile 是 CommitLog 的派生物
→ 删了重启 Broker，ReputMessageService 会重建
→ 重建慢一些（按 CommitLog 全量扫一遍）

rm -rf /store/index/*
重启 Broker
```

### 7.3 性能瓶颈

```
写入：单 IndexFile 满了（2000 万 entry）后会创建新文件
       → 高峰期可能并发写多个文件

查询：
  ✓ PageCache 命中时极快（420MB 完全能塞进内存）
  ✗ PageCache 失效时随机读磁盘 → 几十毫秒
  
监控指标：
  • IndexFile 文件数
  • queryMsgByKey 平均 RT
```

### 7.4 关闭 IndexFile（极端场景）

```properties
# broker.conf
messageIndexEnable=false  # 默认 true
```

**适用场景**：纯吞吐流式业务，从不查历史消息。能省 1/10 的写入开销。

---

## 八、一句话记住核心

> **IndexFile = 哈希表 + 拉链法的消息反向索引。**
>
> 输入业务 key（如订单号），输出消息物理 offset 列表。
>
> 单文件 420MB（40B Header + 20MB Hash Slot + 400MB Entry），按时间戳命名。
>
> 写：hash → slot → 追加 entry → 更新链表头。
>
> 查：hash → slot → 遍历链表 → 过滤时间范围 → 输出 phyOffset。
>
> 用于：客服排查、消息追踪、问题定位——不参与正常的消费流程。
