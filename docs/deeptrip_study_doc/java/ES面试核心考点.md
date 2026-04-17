# Elasticsearch 面试核心考点

> **更新时间**: 2026-04-16

---

## 一、核心概念

### 1.1 与关系型数据库类比

| MySQL | Elasticsearch | 说明 |
|-------|--------------|------|
| Database | Index | 索引 |
| Table | Type（7.x废弃）→ Index | 7.x 后一个 Index 只有一个 Type |
| Row | Document | 文档（JSON） |
| Column | Field | 字段 |
| Schema | Mapping | 映射（定义字段类型） |
| SQL | DSL | 查询语法 |
| Index | Inverted Index | 倒排索引 |

### 1.2 架构

```
┌──────────────────────────────────────────────────────────────┐
│                    ES 集群架构                                │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────┐        │
│  │                  Cluster                          │        │
│  │                                                    │        │
│  │  ┌──────────────┐  ┌──────────────┐              │        │
│  │  │   Node-1     │  │   Node-2     │              │        │
│  │  │ (Master-eligible)│(Data Node)   │              │        │
│  │  │              │  │              │              │        │
│  │  │ Index-A      │  │ Index-A      │              │        │
│  │  │  ├ Shard0(P) │  │  ├ Shard0(R) │              │        │
│  │  │  ├ Shard1(R) │  │  ├ Shard1(P) │              │        │
│  │  │  └ Shard2(P) │  │  └ Shard2(R) │              │        │
│  │  │              │  │              │              │        │
│  │  │ Index-B      │  │ Index-B      │              │        │
│  │  │  ├ Shard0(P) │  │  ├ Shard0(R) │              │        │
│  │  │  └ Shard1(R) │  │  └ Shard1(P) │              │        │
│  │  └──────────────┘  └──────────────┘              │        │
│  │                                                    │        │
│  │  P = Primary Shard（主分片）                       │        │
│  │  R = Replica Shard（副本分片）                     │        │
│  └──────────────────────────────────────────────────┘        │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

**节点角色**：

| 角色 | 说明 | 配置 |
|------|------|------|
| Master-eligible | 可被选为 Master，管理集群状态 | node.master: true |
| Data | 存储数据，执行 CRUD | node.data: true |
| Coordinating | 路由请求，合并结果 | node.master: false, node.data: false |
| Ingest | 预处理管道 | node.ingest: true |

---

## 二、倒排索引

```
┌──────────────────────────────────────────────────────────┐
│                    倒排索引原理                            │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  正排索引（文档 → 词）：                                   │
│  Doc1: "Elasticsearch is a search engine"                │
│  Doc2: "Elasticsearch is distributed"                    │
│  Doc3: "Search engine for big data"                      │
│                                                           │
│  分词后建立倒排索引（词 → 文档）：                         │
│  ┌────────────────┬──────────────────────┐               │
│  │ Term           │ Doc IDs              │               │
│  ├────────────────┼──────────────────────┤               │
│  │ elasticsearch  │ [1, 2]               │               │
│  │ search         │ [1, 3]               │               │
│  │ engine         │ [1, 3]               │               │
│  │ distributed    │ [2]                  │               │
│  │ big            │ [3]                  │               │
│  │ data           │ [3]                  │               │
│  └────────────────┴──────────────────────┘               │
│                                                           │
│  搜索 "search engine"：                                   │
│  1. 分词 → [search, engine]                               │
│  2. 查倒排索引 → search:[1,3], engine:[1,3]              │
│  3. 交集 → [1, 3]                                        │
│  4. 相关性评分排序 → 返回结果                              │
│                                                           │
│  为什么快？                                               │
│  → 直接通过词定位文档，不需要遍历所有文档                  │
│  → 时间复杂度 O(1) 查找                                   │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

---

## 三、分片与路由

### 3.1 分片策略

```
分片数 = 主分片数（创建后不可修改） + 副本分片数（可动态调整）

主分片数规划：
├── 每个分片建议 10~50GB
├── 分片数 = 预估数据量 / 单分片大小
└── 不超过集群节点数 × 3

示例：
  数据量 500GB → 主分片 10~50 个
  副本数 1（每个主分片1个副本）

  总分片数 = 主分片 × (1 + 副本数) = 50 × 2 = 100
```

### 3.2 文档路由

```
shard = hash(routing) % number_of_primary_shards

routing 默认是文档 _id
自定义 routing 可以让相关文档落在同一分片

# 订单按用户路由
PUT /orders/_doc/order-1?routing=user-123
→ 同一用户的订单在同一分片，查询时只需查一个分片
```

---

## 四、搜索与评分

### 4.1 相关性评分

```
┌──────────────────────────────────────────────────────────┐
│                TF-IDF 与 BM25                             │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  TF-IDF（ES 5.x 之前默认）：                              │
│  ├── TF（词频）：词在文档中出现次数越多，权重越高          │
│  ├── IDF（逆文档频率）：词在所有文档中出现越多，权重越低   │
│  └── score = TF × IDF × fieldLength                      │
│                                                           │
│  BM25（ES 5.x 之后默认）：                                │
│  ├── 改进的 TF：词频达到一定程度后不再线性增长（饱和）     │
│  ├── 考虑文档长度归一化                                    │
│  └── 比 TF-IDF 更好地处理长文档                           │
│                                                           │
│  BM25 vs TF-IDF：                                         │
│  TF-IDF:  score ∝ tf（线性增长，无上限）                  │
│  BM25:    score ∝ tf/(tf + k1)（饱和曲线，有上限）        │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

### 4.2 查询类型

| 查询 | 说明 | 场景 |
|------|------|------|
| match | 分词后匹配 | 全文搜索 |
| term | 不分词精确匹配 | 关键字/枚举 |
| bool | 组合查询（must/should/must_not/filter） | 复杂条件 |
| range | 范围查询 | 时间/数值 |
| multi_match | 多字段匹配 | 标题+内容搜索 |
| fuzzy | 模糊匹配 | 容错搜索 |

**filter vs query**：

```
filter：不计算评分，结果可缓存，性能更好
query：计算相关性评分，结果不缓存

# 过滤条件用 filter，搜索条件用 must
GET /products/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "手机" } }       ← 计算评分
      ],
      "filter": [
        { "range": { "price": { "lte": 5000 } } },  ← 不计算评分
        { "term": { "status": "on_sale" } }         ← 不计算评分
      ]
    }
  }
}
```

---

## 五、聚合分析

```json
// 桶聚合 + 指标聚合
GET /orders/_search
{
  "size": 0,
  "aggs": {
    "by_category": {                          // 按分类分桶
      "terms": { "field": "category.keyword", "size": 10 },
      "aggs": {
        "avg_price": { "avg": { "field": "price" } },      // 平均价格
        "total_sales": { "sum": { "field": "sales" } },     // 总销量
        "date_histogram": {                                  // 按月分桶
          "date_histogram": { "field": "create_time", "calendar_interval": "month" }
        }
      }
    }
  }
}
```

**聚合类型**：

| 类型 | 说明 | 示例 |
|------|------|------|
| 桶聚合 (Bucket) | 按规则分桶 | terms / date_histogram / range |
| 指标聚合 (Metric) | 计算统计值 | avg / sum / max / cardinality |
| 管道聚合 (Pipeline) | 基于其他聚合结果 | moving_avg / derivative |

---

## 六、写入与读取

### 6.1 写入流程

```
┌──────────────────────────────────────────────────────────┐
│                  文档写入流程                              │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  1. 客户端发送写入请求到任意节点（Coordinating Node）      │
│                                                           │
│  2. Coordinating Node 根据 routing 计算目标分片           │
│     shard = hash(routing) % primary_shards                │
│                                                           │
│  3. 转发到主分片所在节点                                   │
│                                                           │
│  4. 主分片写入：                                          │
│     ├── 写入内存 Buffer                                   │
│     ├── 同时写入 Translog（事务日志，保证可靠性）          │
│     ├── refresh（默认1秒）→ Buffer → Segment → 可搜索     │
│     └── flush（默认30分钟或Translog 512MB）→              │
│         Segment fsync 到磁盘 + 清空 Translog              │
│                                                           │
│  5. 主分片写入成功后，并行写入副本分片                     │
│                                                           │
│  6. 所有副本确认后返回客户端                               │
│                                                           │
│  近实时搜索的原因：                                        │
│  → 文档写入 Buffer 后不能立即被搜索                        │
│  → 需等 refresh 操作将 Buffer 刷新为 Segment              │
│  → 默认 1 秒刷新一次，所以有约 1 秒延迟                   │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

### 6.2 Segment 合并

```
Segment 不可变 → 频繁 refresh 产生大量小 Segment

后台 Merge 线程自动合并：
  [Seg1: 3doc] + [Seg2: 5doc] + [Seg3: 2doc]
  → [Seg4: 10doc]
  → 旧 Segment 标记删除，新 Segment 替换

好处：
├── 减少Segment数量，加快搜索
├── 清理已删除的文档（物理删除）
└── 减少文件句柄数

Force Merge API：
POST /index/_forcemerge?max_num_segments=1
→ 一般只在索引不再写入时使用（如日志按天索引）
```

---

## 七、调优

### 7.1 写入优化

| 优化项 | 配置 | 说明 |
|--------|------|------|
| 批量写入 | bulk API，5000~10000条/批 | 减少网络开销 |
| 增大 refresh 间隔 | refresh_interval=30s | 减少刷新频率 |
| 关闭副本先写入 | number_of_replicas=0 | 写完后再加副本 |
| 关闭 translog 异步刷盘 | durability=async | 可能丢数据 |
| 增大 Buffer | indices.memory.index_buffer_size=20% | 更多内存用于写入 |

### 7.2 查询优化

| 优化项 | 说明 |
|--------|------|
| filter 代替 query | 不计分可缓存 |
| 避免深分页 | 用 search_after 代替 from/size |
| 避免通配符开头 | "a*" 可以，"*a" 不走索引 |
| 路由查询 | 指定 routing 只查目标分片 |
| 索引预热 | index.warmup.enabled |

### 7.3 深分页问题

```
from + size 模式：
  查 from=10000, size=10
  → 每个分片取 10010 条给协调节点
  → 协调节点排序后取 10 条
  → 分片数 × 10010 条数据在内存中排序
  → 深分页时 OOM 风险

ES 限制：from + size <= 10000（index.max_result_window）

解决方案：
├── search_after：基于上一页最后一条的排序值，适合翻页
├── Scroll API：创建快照遍历，适合导出
└── Pit + search_after：ES 7.10+ 推荐
```

---

## 八、高频面试题

| 问题 | 核心答案 |
|------|----------|
| ES 为什么近实时？ | 写入 Buffer → refresh（1秒）→ Segment → 可搜索 |
| 倒排索引是什么？ | 词到文档的映射，O(1) 查找，是全文检索的核心 |
| 主分片数为什么不能修改？ | 路由公式 hash(routing)%shards，改了路由会变，文档找不到 |
| filter 和 query 的区别？ | filter 不计分可缓存性能好；query 计分用于相关性排序 |
| 深分页怎么解决？ | search_after（翻页）/ Scroll（导出）/ Pit（7.10+） |
| ES 和 MySQL 怎么选？ | 全文检索/模糊搜索/聚合分析用ES；事务/关联查询用MySQL |
| 如何保证 ES 和 MySQL 数据一致？ | 同步双写/异步MQ/Canal监听Binlog（推荐） |
