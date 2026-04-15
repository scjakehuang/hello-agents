# 记忆管理最佳实践与踩坑指南

## 文档信息

- 作者：徐凯旋
- 邮箱：azouever@gmail.com
- 更新时间：2026-04-14
- 标签：Memory Management, Agent, LangChain, LangGraph, Redis, 向量数据库

---

## 目录

1. [概述](#一概述)
2. [记忆分层架构](#二记忆分层架构)
3. [短期记忆实现](#三短期记忆实现)
4. [长期记忆实现](#四长期记忆实现)
5. [工作记忆实现](#五工作记忆实现)
6. [工具记忆实现](#六工具记忆实现)
7. [MemoryManager 统一管理器](#七memorymanager-统一管理器)
8. [记忆压缩策略](#八记忆压缩策略)
9. [多用户记忆隔离](#九多用户记忆隔离)
10. [与 LangChain / LangGraph 集成](#十与-langchain--langgraph-集成)
11. [Redis 生产配置](#十一redis-生产配置)
12. [记忆检索优化](#十二记忆检索优化)
13. [常见踩坑与解决方案](#十三常见踩坑与解决方案)
14. [速查表](#十四速查表)

---

## 一、概述

### 1.1 为什么 Agent 需要记忆系统

LLM 本身是无状态的——每次调用都是全新的开始，不记得上一次说了什么。但用户与 Agent 的交互是连续的、有上下文依赖的。没有记忆系统，Agent 就是一个"金鱼"：

- 用户刚说"我喜欢靠窗的座位"，Agent 下一句就忘了
- 相同的航班查询被重复调用三次，既浪费 Token 也拖慢响应
- 跨会话无法记住用户偏好，每次重新问一遍让人崩溃
- 长对话中，LLM 上下文窗口被旧对话撑满，真正重要的信息反而挤不进去

记忆系统解决的核心问题是：**在有限的上下文窗口内，把最相关、最有价值的信息呈现给 LLM**。

### 1.2 记忆的本质

记忆在 Agent 系统中本质上是**信息的选择与组织**：

```
原始信息流
    │
    ├── 哪些值得保留？（重要性判断）
    ├── 保留多久？（TTL 策略）
    ├── 怎么存？（存储介质选择）
    ├── 怎么取？（检索策略）
    └── 怎么用？（注入上下文的方式）
```

好的记忆系统不是"记得越多越好"，而是"在合适的时机，把合适的信息，以合适的方式提供给 LLM"。

### 1.3 记忆管理的核心挑战

| 挑战 | 说明 | 解决思路 |
|------|------|----------|
| **上下文窗口有限** | LLM 能接收的 Token 有上限 | 分层存储 + 动态检索 |
| **无关信息干扰** | 旧对话稀释当前任务的注意力 | 重要性评分 + 滑动窗口 |
| **信息丢失** | 服务重启导致记忆清空 | Redis 持久化 |
| **跨会话连贯性** | 用户下次登录不认得了 | 长期记忆 + 用户 ID 隔离 |
| **重复计算** | 同一个工具参数调用 N 次 | 工具结果缓存 |
| **多用户串扰** | A 的记忆漏给 B | 严格的命名空间隔离 |

---

## 二、记忆分层架构

### 2.1 四层记忆架构总览

```
+--------------------------------------------------------------------+
|                    Agent 记忆系统四层架构                           |
+--------------------------------------------------------------------+
|                                                                    |
|   用户输入 / 工具调用结果                                          |
|          │                                                         |
|          v                                                         |
|   +------+------+          +-------------+                        |
|   |  工作记忆    |          |   工具记忆   |                        |
|   | Working Mem |          | Tool Memory |                        |
|   +------+------+          +------+------+                        |
|          │                        │                               |
|          v                        v                               |
|   +------+------+          +------+------+                        |
|   |  短期记忆    |          |   短期缓存   |                        |
|   | Short-term  |          | (in-memory) |                        |
|   +------+------+          +------+------+                        |
|          │                        │                               |
|          v                        │                               |
|   +------+------+                 │                               |
|   |  长期记忆    | <---------------+  (重要信息沉淀)               |
|   | Long-term   |                                                  |
|   +------+------+                                                  |
|          │                                                         |
|          v                                                         |
|   LLM 上下文构建（按需检索注入）                                   |
|                                                                    |
+--------------------------------------------------------------------+
```

### 2.2 各层对比

```
+--------------------------------------------------------------------+
|  记忆层级    存储介质        TTL        典型内容        容量        |
+--------------------------------------------------------------------+
|  工作记忆   进程内存        任务级      推理状态        小（KB级）  |
|             (dict/object)   (单次运行)  中间结果                   |
|                                         待办列表                   |
|--------------------------------------------------------------------+
|  短期记忆   内存 + Redis   会话级       近 N 轮对话    中（MB级）  |
|             (deque)         (数小时)    当前上下文                  |
|                                         临时偏好                   |
|--------------------------------------------------------------------+
|  工具记忆   内存 + Redis   小时级       工具调用结果    中（MB级） |
|             (dict)          (可配置)    API 响应缓存                |
|                                         计算结果缓存               |
|--------------------------------------------------------------------+
|  长期记忆   向量数据库      永久         用户画像        大（GB级） |
|             (Milvus/        (手动清理)  历史偏好                   |
|              Chroma)                    知识积累                   |
|                                         重要事件                   |
+--------------------------------------------------------------------+
```

### 2.3 信息流向

```
                   新消息到来
                       │
         ┌─────────────┼─────────────┐
         v             v             v
    [工作记忆]     [短期记忆]    [工具记忆]
    实时更新       滑动窗口       结果缓存
         │             │
         └──── 重要性判断 ────┐
                              v
                         [长期记忆]
                         向量化存储
                              │
                    ┌─────────┘
                    v
               语义检索
                    │
                    v
             LLM 上下文构建
```

---

## 三、短期记忆实现

### 3.1 滑动窗口 deque

短期记忆的核心是"有界队列"。Python 的 `collections.deque` 天然支持 maxlen，旧数据自动淘汰：

```python
from collections import deque
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from datetime import datetime
import json

@dataclass
class Message:
    """单条对话消息"""
    role: str           # "user" | "assistant" | "system" | "tool"
    content: str
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    metadata: Dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "role": self.role,
            "content": self.content,
            "timestamp": self.timestamp,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Message":
        return cls(
            role=data["role"],
            content=data["content"],
            timestamp=data.get("timestamp", datetime.now().isoformat()),
            metadata=data.get("metadata", {}),
        )


class ShortTermMemory:
    """短期记忆：滑动窗口实现"""

    def __init__(self, max_turns: int = 20):
        # maxlen 按"轮次"算，user + assistant 各算一条
        # 20 轮 = 40 条消息
        self._buffer: deque[Message] = deque(maxlen=max_turns * 2)
        self.max_turns = max_turns

    def add(self, role: str, content: str, metadata: dict = None) -> Message:
        """追加一条消息"""
        msg = Message(role=role, content=content, metadata=metadata or {})
        self._buffer.append(msg)
        return msg

    def get_messages(self) -> List[Message]:
        """获取当前窗口内所有消息"""
        return list(self._buffer)

    def get_recent(self, n: int) -> List[Message]:
        """获取最近 n 条消息"""
        messages = list(self._buffer)
        return messages[-n:] if n < len(messages) else messages

    def clear(self):
        self._buffer.clear()

    def __len__(self):
        return len(self._buffer)
```

### 3.2 Redis 持久化

进程重启后，内存中的 deque 会丢失。生产环境必须把短期记忆持久化到 Redis：

```python
import redis
import json
from typing import List, Optional

class PersistentShortTermMemory:
    """Redis 持久化的短期记忆"""

    def __init__(
        self,
        session_id: str,
        redis_client: redis.Redis,
        max_turns: int = 20,
        ttl_seconds: int = 86400,  # 默认 24 小时过期
    ):
        self.session_id = session_id
        self.redis = redis_client
        self.max_turns = max_turns
        self.ttl_seconds = ttl_seconds
        self._key = f"stm:{session_id}"

    def add(self, role: str, content: str, metadata: dict = None) -> None:
        """追加消息，并维护最大条数"""
        msg = {
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat(),
            "metadata": metadata or {},
        }
        pipe = self.redis.pipeline()
        pipe.rpush(self._key, json.dumps(msg, ensure_ascii=False))
        # 超出限制时从左侧修剪（删除最旧的）
        pipe.ltrim(self._key, -(self.max_turns * 2), -1)
        # 每次写入刷新过期时间
        pipe.expire(self._key, self.ttl_seconds)
        pipe.execute()

    def get_messages(self) -> List[dict]:
        """读取全部消息"""
        raw = self.redis.lrange(self._key, 0, -1)
        return [json.loads(m) for m in raw]

    def get_recent(self, n: int) -> List[dict]:
        """读取最近 n 条"""
        raw = self.redis.lrange(self._key, -n, -1)
        return [json.loads(m) for m in raw]

    def clear(self) -> None:
        self.redis.delete(self._key)

    def refresh_ttl(self) -> None:
        """手动刷新过期时间（用于活跃会话保活）"""
        self.redis.expire(self._key, self.ttl_seconds)
```

### 3.3 过期策略设计

```
+--------------------------------------------------------------------+
|  短期记忆过期策略选择                                              |
+--------------------------------------------------------------------+
|                                                                    |
|  策略              适用场景              TTL 参考值                |
|  ------------------------------------------------------------------+
|  会话级过期        聊天对话              用户关闭页面 / 30 分钟无操作 |
|  固定时间过期      任务型 Agent          任务完成后 2-4 小时        |
|  活跃刷新过期      长期用户              每次交互重置 24 小时       |
|  永不过期          调试 / 测试环境       手动清理                   |
|                                                                    |
+--------------------------------------------------------------------+

建议：生产环境统一采用"活跃刷新"策略
- 初始 TTL：24 小时
- 每次 add() 调用后 expire() 重置
- 防止活跃会话突然失效
```

---

## 四、长期记忆实现

### 4.1 向量数据库存储

长期记忆需要"语义检索"能力，因此必须使用向量数据库。以 Chroma（本地轻量级）为例：

```python
from typing import List, Dict, Optional, Any
import chromadb
from chromadb.utils import embedding_functions
from datetime import datetime
import uuid

class LongTermMemory:
    """长期记忆：基于向量数据库的语义存储"""

    def __init__(
        self,
        user_id: str,
        collection_name: str = "long_term_memory",
        persist_directory: str = "./chroma_db",
    ):
        self.user_id = user_id
        # 使用 user_id 作为命名空间隔离不同用户
        self._collection_name = f"{collection_name}_{user_id}"

        self._client = chromadb.PersistentClient(path=persist_directory)
        self._embedding_fn = embedding_functions.OpenAIEmbeddingFunction(
            model_name="text-embedding-3-small"
        )
        self._collection = self._client.get_or_create_collection(
            name=self._collection_name,
            embedding_function=self._embedding_fn,
            metadata={"hnsw:space": "cosine"},
        )

    def add(
        self,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
        importance: float = 1.0,
    ) -> str:
        """存入一条长期记忆"""
        memory_id = str(uuid.uuid4())
        meta = {
            "user_id": self.user_id,
            "timestamp": datetime.now().isoformat(),
            "importance": importance,
            **(metadata or {}),
        }
        self._collection.add(
            ids=[memory_id],
            documents=[content],
            metadatas=[meta],
        )
        return memory_id

    def search(
        self,
        query: str,
        top_k: int = 5,
        min_score: float = 0.6,
        where: Optional[Dict] = None,
    ) -> List[Dict[str, Any]]:
        """语义检索相关记忆"""
        results = self._collection.query(
            query_texts=[query],
            n_results=top_k,
            where=where,
            include=["documents", "metadatas", "distances"],
        )

        memories = []
        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
        ):
            # Chroma 返回的 distance 是余弦距离（越小越相似）
            score = 1.0 - dist
            if score >= min_score:
                memories.append({
                    "content": doc,
                    "metadata": meta,
                    "score": round(score, 4),
                })

        return memories

    def delete(self, memory_id: str) -> None:
        self._collection.delete(ids=[memory_id])

    def update_importance(self, memory_id: str, importance: float) -> None:
        """更新记忆重要性分数（用于遗忘机制）"""
        self._collection.update(
            ids=[memory_id],
            metadatas=[{"importance": importance}],
        )
```

### 4.2 重要性判断

不是所有信息都值得进入长期记忆。重要性判断可以分三个层次：

```python
from enum import Enum

class ImportanceLevel(Enum):
    LOW = 0.3
    MEDIUM = 0.6
    HIGH = 0.9
    CRITICAL = 1.0


class ImportanceClassifier:
    """判断信息是否值得长期存储"""

    # 规则引擎：关键词匹配（快速、低成本）
    HIGH_IMPORTANCE_KEYWORDS = [
        "偏好", "喜欢", "讨厌", "不喜欢",
        "预算", "价格", "价位",
        "时间", "日期", "出发", "返回",
        "人数", "同行", "家人",
        "过敏", "忌口", "素食",
        "VIP", "会员", "常旅客",
    ]

    CRITICAL_KEYWORDS = [
        "绝对不要", "必须", "一定要",
        "身份证", "护照", "手机号",
    ]

    def classify(self, content: str) -> ImportanceLevel:
        """三级分类：规则优先，LLM 兜底"""
        content_lower = content.lower()

        # 第一级：关键词快速匹配
        if any(kw in content for kw in self.CRITICAL_KEYWORDS):
            return ImportanceLevel.CRITICAL

        if any(kw in content for kw in self.HIGH_IMPORTANCE_KEYWORDS):
            return ImportanceLevel.HIGH

        # 第二级：基于文本长度和结构
        # 较长的陈述句通常比短问句更值得记
        if len(content) > 50 and not content.endswith("?") and not content.endswith("？"):
            return ImportanceLevel.MEDIUM

        return ImportanceLevel.LOW

    def should_persist(self, content: str, threshold: float = 0.5) -> bool:
        level = self.classify(content)
        return level.value >= threshold
```

### 4.3 记忆遗忘机制

长期记忆需要清理机制，避免无限膨胀：

```python
import time
from typing import List

class MemoryForgetManager:
    """
    基于重要性 + 时间衰减的遗忘机制
    遗忘分数 = importance * decay_factor
    decay_factor = e^(-lambda * days_elapsed)
    """

    def __init__(self, decay_lambda: float = 0.1):
        self.decay_lambda = decay_lambda

    def compute_retention_score(
        self, importance: float, created_at: str
    ) -> float:
        """计算保留分数"""
        import math
        created = datetime.fromisoformat(created_at)
        days_elapsed = (datetime.now() - created).days
        decay = math.exp(-self.decay_lambda * days_elapsed)
        return importance * decay

    def should_forget(
        self, importance: float, created_at: str, threshold: float = 0.1
    ) -> bool:
        score = self.compute_retention_score(importance, created_at)
        return score < threshold
```

---

## 五、工作记忆实现

### 5.1 当前任务状态跟踪

工作记忆是 Agent 在单次任务执行过程中的"草稿纸"，存储推理状态和中间结果：

```python
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from enum import Enum
from datetime import datetime

class TaskStatus(Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    WAITING_TOOL = "waiting_tool"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class TaskContext:
    """单次任务的工作记忆"""
    task_id: str
    user_query: str
    status: TaskStatus = TaskStatus.PENDING
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())

    # 推理状态
    current_step: int = 0
    reasoning_trace: List[str] = field(default_factory=list)

    # 中间结果
    intermediate_results: Dict[str, Any] = field(default_factory=dict)

    # 待执行工具列表
    pending_tools: List[Dict] = field(default_factory=list)

    # 最终输出
    final_answer: Optional[str] = None
    error: Optional[str] = None

    def add_reasoning(self, thought: str) -> None:
        """记录推理步骤"""
        self.reasoning_trace.append(f"[Step {self.current_step}] {thought}")
        self.current_step += 1

    def store_result(self, key: str, value: Any) -> None:
        """存储中间结果"""
        self.intermediate_results[key] = {
            "value": value,
            "step": self.current_step,
            "timestamp": datetime.now().isoformat(),
        }

    def get_result(self, key: str) -> Optional[Any]:
        entry = self.intermediate_results.get(key)
        return entry["value"] if entry else None

    def complete(self, answer: str) -> None:
        self.final_answer = answer
        self.status = TaskStatus.COMPLETED

    def fail(self, error: str) -> None:
        self.error = error
        self.status = TaskStatus.FAILED


class WorkingMemory:
    """工作记忆管理器"""

    def __init__(self):
        self._tasks: Dict[str, TaskContext] = {}
        self._current_task_id: Optional[str] = None

    def new_task(self, task_id: str, user_query: str) -> TaskContext:
        ctx = TaskContext(task_id=task_id, user_query=user_query)
        self._tasks[task_id] = ctx
        self._current_task_id = task_id
        return ctx

    @property
    def current(self) -> Optional[TaskContext]:
        if self._current_task_id:
            return self._tasks.get(self._current_task_id)
        return None

    def get(self, task_id: str) -> Optional[TaskContext]:
        return self._tasks.get(task_id)

    def clear_completed(self) -> None:
        """清理已完成的任务，防止内存泄漏"""
        completed = [
            tid for tid, ctx in self._tasks.items()
            if ctx.status in (TaskStatus.COMPLETED, TaskStatus.FAILED)
        ]
        for tid in completed:
            del self._tasks[tid]
```

---

## 六、工具记忆实现

### 6.1 调用结果缓存

工具调用通常是 Agent 最慢、最贵的环节（涉及外部 API）。缓存相同参数的调用结果能显著降低延迟和成本：

```python
import hashlib
import json
import time
from typing import Any, Dict, Optional, Callable
from functools import wraps

class ToolMemory:
    """工具调用结果缓存"""

    def __init__(self, default_ttl: int = 3600):
        """
        default_ttl: 默认缓存有效期（秒）
        """
        self._cache: Dict[str, Dict] = {}
        self.default_ttl = default_ttl

    def _make_key(self, tool_name: str, params: dict) -> str:
        """生成确定性缓存键"""
        params_str = json.dumps(params, sort_keys=True, ensure_ascii=False)
        content = f"{tool_name}:{params_str}"
        return hashlib.sha256(content.encode()).hexdigest()[:16]

    def get(self, tool_name: str, params: dict) -> Optional[Any]:
        """取缓存，过期返回 None"""
        key = self._make_key(tool_name, params)
        entry = self._cache.get(key)
        if entry is None:
            return None

        if time.time() > entry["expires_at"]:
            del self._cache[key]
            return None

        return entry["result"]

    def set(
        self,
        tool_name: str,
        params: dict,
        result: Any,
        ttl: Optional[int] = None,
    ) -> None:
        """写入缓存"""
        key = self._make_key(tool_name, params)
        self._cache[key] = {
            "result": result,
            "tool_name": tool_name,
            "params": params,
            "created_at": time.time(),
            "expires_at": time.time() + (ttl or self.default_ttl),
        }

    def invalidate(self, tool_name: str, params: dict) -> None:
        """主动失效某条缓存"""
        key = self._make_key(tool_name, params)
        self._cache.pop(key, None)

    def clear_expired(self) -> int:
        """清理过期缓存，返回清理数量"""
        now = time.time()
        expired = [k for k, v in self._cache.items() if now > v["expires_at"]]
        for k in expired:
            del self._cache[k]
        return len(expired)

    def stats(self) -> Dict[str, int]:
        now = time.time()
        valid = sum(1 for v in self._cache.values() if now <= v["expires_at"])
        return {"total": len(self._cache), "valid": valid, "expired": len(self._cache) - valid}
```

### 6.2 TTL 设计原则

不同工具的数据时效性不同，TTL 应当针对工具类型单独配置：

```python
# TTL 配置表（单位：秒）
TOOL_TTL_CONFIG = {
    # 实时性要求高，TTL 短
    "search_flight": 300,          # 5 分钟（机票价格变化快）
    "get_weather": 600,            # 10 分钟
    "check_availability": 60,      # 1 分钟（库存实时性高）

    # 中等时效
    "search_hotel": 1800,          # 30 分钟
    "get_poi_info": 3600,          # 1 小时（POI 基本稳定）
    "search_train": 900,           # 15 分钟

    # 长期稳定，TTL 长
    "get_city_info": 86400,        # 1 天（城市介绍基本不变）
    "get_visa_info": 86400 * 7,    # 1 周
    "get_exchange_rate": 3600,     # 1 小时
}

def get_tool_ttl(tool_name: str, default: int = 3600) -> int:
    return TOOL_TTL_CONFIG.get(tool_name, default)
```

---

## 七、MemoryManager 统一管理器

### 7.1 完整实现

`MemoryManager` 是四层记忆的统一入口，负责协调短期、长期、工作、工具四种记忆的增删查和上下文构建：

```python
import time
import json
import tiktoken
from dataclasses import dataclass, field
from collections import deque
from typing import List, Dict, Optional, Any
from datetime import datetime


@dataclass
class MemoryConfig:
    """记忆管理器配置"""
    max_short_term_turns: int = 20          # 短期记忆最大轮次
    short_term_ttl: int = 86400             # 短期记忆 Redis TTL（秒）
    max_context_tokens: int = 8000          # 上下文最大 Token 数
    long_term_top_k: int = 3               # 长期记忆检索数量
    long_term_min_score: float = 0.65       # 长期记忆最低相似度
    tool_default_ttl: int = 3600            # 工具缓存默认 TTL
    importance_threshold: float = 0.5       # 自动存入长期记忆的阈值
    model_name: str = "gpt-4o"             # 用于 token 计数


class MemoryManager:
    """
    统一记忆管理器
    整合短期 / 长期 / 工作 / 工具四层记忆
    """

    def __init__(
        self,
        session_id: str,
        user_id: str,
        redis_client=None,
        vector_store=None,
        config: Optional[MemoryConfig] = None,
    ):
        self.session_id = session_id
        self.user_id = user_id
        self.config = config or MemoryConfig()

        # 短期记忆
        if redis_client:
            self._short_term = PersistentShortTermMemory(
                session_id=session_id,
                redis_client=redis_client,
                max_turns=self.config.max_short_term_turns,
                ttl_seconds=self.config.short_term_ttl,
            )
        else:
            # 降级到纯内存（开发/测试用）
            self._short_term_buffer: deque = deque(
                maxlen=self.config.max_short_term_turns * 2
            )

        # 长期记忆（懒加载）
        self._long_term_store = vector_store
        self._long_term: Optional[LongTermMemory] = None

        # 工作记忆
        self.working = WorkingMemory()

        # 工具记忆
        self.tools = ToolMemory(default_ttl=self.config.tool_default_ttl)

        # 重要性分类器
        self._importance_clf = ImportanceClassifier()

        # Token 计数器
        try:
            self._enc = tiktoken.encoding_for_model(self.config.model_name)
        except Exception:
            self._enc = tiktoken.get_encoding("cl100k_base")

    # ------------------------------------------------------------------
    # 短期记忆 API
    # ------------------------------------------------------------------

    def add_message(
        self,
        role: str,
        content: str,
        metadata: Optional[Dict] = None,
    ) -> None:
        """添加对话消息，自动判断是否存入长期记忆"""
        msg = {
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat(),
            "metadata": metadata or {},
        }

        # 写入短期记忆
        if hasattr(self, "_short_term"):
            self._short_term.add(role, content, metadata)
        else:
            self._short_term_buffer.append(msg)

        # 自动沉淀重要信息到长期记忆
        if self._importance_clf.should_persist(content, self.config.importance_threshold):
            self._persist_to_long_term(content, metadata)

    def get_short_term_messages(self) -> List[Dict]:
        """获取短期记忆中所有消息"""
        if hasattr(self, "_short_term"):
            return self._short_term.get_messages()
        return list(self._short_term_buffer)

    # ------------------------------------------------------------------
    # 长期记忆 API
    # ------------------------------------------------------------------

    @property
    def long_term(self) -> LongTermMemory:
        """懒加载长期记忆"""
        if self._long_term is None:
            self._long_term = LongTermMemory(user_id=self.user_id)
        return self._long_term

    def _persist_to_long_term(self, content: str, metadata: Optional[Dict]) -> None:
        """将重要信息沉淀到长期记忆"""
        level = self._importance_clf.classify(content)
        self.long_term.add(
            content=content,
            metadata={
                "session_id": self.session_id,
                **(metadata or {}),
            },
            importance=level.value,
        )

    def search_long_term(self, query: str) -> List[Dict[str, Any]]:
        """从长期记忆检索相关内容"""
        return self.long_term.search(
            query=query,
            top_k=self.config.long_term_top_k,
            min_score=self.config.long_term_min_score,
        )

    # ------------------------------------------------------------------
    # 工具记忆 API
    # ------------------------------------------------------------------

    def get_tool_cache(self, tool_name: str, params: dict) -> Optional[Any]:
        return self.tools.get(tool_name, params)

    def set_tool_cache(
        self,
        tool_name: str,
        params: dict,
        result: Any,
        ttl: Optional[int] = None,
    ) -> None:
        effective_ttl = ttl or get_tool_ttl(tool_name, self.config.tool_default_ttl)
        self.tools.set(tool_name, params, result, ttl=effective_ttl)

    # ------------------------------------------------------------------
    # 上下文构建
    # ------------------------------------------------------------------

    def build_context(self, current_query: str) -> List[Dict[str, str]]:
        """
        构建注入 LLM 的上下文消息列表
        顺序：长期记忆（system 注入）-> 短期记忆 -> 当前 query
        """
        context: List[Dict[str, str]] = []
        token_budget = self.config.max_context_tokens

        # 1. 从长期记忆检索相关信息（注入为 system 消息）
        long_term_items = self.search_long_term(current_query)
        if long_term_items:
            lt_content = "\n".join(
                f"- {item['content']}" for item in long_term_items
            )
            lt_msg = {
                "role": "system",
                "content": f"[用户历史偏好与记录]\n{lt_content}",
            }
            lt_tokens = self._count_tokens(lt_msg["content"])
            token_budget -= lt_tokens
            context.insert(0, lt_msg)

        # 2. 填充短期记忆（从最新向旧填充，直到 token 耗尽）
        short_term_msgs = self.get_short_term_messages()
        selected = []
        for msg in reversed(short_term_msgs):
            tokens = self._count_tokens(msg.get("content", ""))
            if token_budget - tokens < 500:   # 保留 500 token 给当前 query
                break
            selected.insert(0, {
                "role": msg["role"],
                "content": msg["content"],
            })
            token_budget -= tokens

        context.extend(selected)

        # 3. 追加当前 query
        context.append({"role": "user", "content": current_query})

        return context

    # ------------------------------------------------------------------
    # 序列化 / 反序列化
    # ------------------------------------------------------------------

    def export_session(self) -> Dict[str, Any]:
        """导出当前会话状态（用于持久化或调试）"""
        return {
            "session_id": self.session_id,
            "user_id": self.user_id,
            "short_term": self.get_short_term_messages(),
            "tool_cache_stats": self.tools.stats(),
            "exported_at": datetime.now().isoformat(),
        }

    def _count_tokens(self, text: str) -> int:
        try:
            return len(self._enc.encode(text))
        except Exception:
            # 粗略估算：每个字符约 0.5 个 token（中文略高）
            return len(text) // 2
```

---

## 八、记忆压缩策略

### 8.1 策略概览

```
+--------------------------------------------------------------------+
|  记忆压缩策略对比                                                  |
+--------------------------------------------------------------------+
|                                                                    |
|  策略              优点              缺点              适用场景     |
|  ------------------------------------------------------------------+
|  滑动窗口          简单稳定          丢失早期信息      短对话       |
|  摘要压缩          节省 Token        需要额外 LLM 调用 长对话       |
|  重要性排序        保留关键信息      评分成本          复杂任务      |
|  增量摘要          实时压缩          摘要积累误差      超长对话      |
|  混合策略          灵活             实现复杂          生产环境       |
|                                                                    |
+--------------------------------------------------------------------+
```

### 8.2 摘要压缩实现

```python
from typing import List, Dict, Optional
from dataclasses import dataclass

@dataclass
class CompressionResult:
    summary: str
    retained_messages: List[Dict]
    compressed_count: int
    original_tokens: int
    compressed_tokens: int


class SummaryCompressor:
    """
    摘要压缩：对旧对话生成摘要，保留最近 keep_recent 条原文
    适用于对话超过阈值时的主动压缩
    """

    SUMMARY_PROMPT = """
    请将以下对话历史压缩成简洁摘要（不超过 200 字），要求：
    1. 保留用户的核心意图和偏好
    2. 保留关键决策点（用户选择了什么、拒绝了什么）
    3. 保留时间、地点、人数等具体参数
    4. 去除寒暄、重复、无关内容

    对话历史：
    {history}
    """

    def __init__(self, llm, keep_recent: int = 6, compress_threshold: int = 20):
        """
        llm: LLM 调用接口
        keep_recent: 保留最近 N 条消息原文
        compress_threshold: 消息数超过此值才触发压缩
        """
        self.llm = llm
        self.keep_recent = keep_recent
        self.compress_threshold = compress_threshold

    def should_compress(self, messages: List[Dict]) -> bool:
        return len(messages) > self.compress_threshold

    def compress(self, messages: List[Dict]) -> CompressionResult:
        """执行摘要压缩"""
        if not self.should_compress(messages):
            return CompressionResult(
                summary="",
                retained_messages=messages,
                compressed_count=0,
                original_tokens=0,
                compressed_tokens=0,
            )

        to_compress = messages[:-self.keep_recent]
        to_retain = messages[-self.keep_recent:]

        # 格式化待压缩的历史
        history_text = "\n".join(
            f"{m['role'].upper()}: {m['content']}" for m in to_compress
        )

        # 调用 LLM 生成摘要
        summary = self.llm.invoke(
            self.SUMMARY_PROMPT.format(history=history_text),
            max_tokens=300,
        )

        # 摘要作为 system 消息插入最前
        summary_msg = {
            "role": "system",
            "content": f"[对话历史摘要]\n{summary}",
        }

        return CompressionResult(
            summary=summary,
            retained_messages=[summary_msg] + to_retain,
            compressed_count=len(to_compress),
            original_tokens=len(history_text) // 2,
            compressed_tokens=len(summary) // 2,
        )
```

### 8.3 重要性排序压缩

```python
class ImportanceRankingCompressor:
    """
    重要性排序压缩：给每条消息打分，保留高分消息
    适用于复杂任务场景，确保关键决策不丢失
    """

    # 重要性规则（越靠前权重越高）
    IMPORTANCE_RULES = [
        (["预算", "价格", "花费"], 0.9),
        (["日期", "时间", "几号", "几点"], 0.8),
        (["人数", "几个人", "同行"], 0.8),
        (["偏好", "喜欢", "不喜欢", "要求"], 0.85),
        (["确认", "好的", "就这个", "选这"], 0.7),
        (["取消", "不要", "换一个"], 0.75),
    ]

    def score_message(self, msg: Dict) -> float:
        """计算消息重要性分数 [0, 1]"""
        content = msg.get("content", "")
        score = 0.1   # 基础分

        for keywords, weight in self.IMPORTANCE_RULES:
            if any(kw in content for kw in keywords):
                score = max(score, weight)

        # assistant 回复通常比 user 消息重要性低一些
        if msg.get("role") == "assistant":
            score *= 0.8

        # 越新的消息重要性越高（加时间权重由外部处理）
        return min(score, 1.0)

    def compress(
        self,
        messages: List[Dict],
        token_budget: int,
        count_tokens_fn,
    ) -> List[Dict]:
        """在 token 预算内选出最重要的消息"""
        scored = [
            (msg, self.score_message(msg), idx)
            for idx, msg in enumerate(messages)
        ]

        # 按重要性降序排序
        scored.sort(key=lambda x: x[1], reverse=True)

        selected = []
        used_tokens = 0
        selected_indices = set()

        for msg, score, idx in scored:
            tokens = count_tokens_fn(msg.get("content", ""))
            if used_tokens + tokens > token_budget:
                continue
            selected.append((idx, msg))
            selected_indices.add(idx)
            used_tokens += tokens

        # 按原始顺序返回（保持时序）
        selected.sort(key=lambda x: x[0])
        return [msg for _, msg in selected]
```

---

## 九、多用户记忆隔离

### 9.1 隔离模型

生产环境中，多用户记忆隔离是安全红线，不能有任何串扰：

```
+--------------------------------------------------------------------+
|  多用户记忆隔离模型                                                |
+--------------------------------------------------------------------+
|                                                                    |
|  用户 A (user_id=U001)          用户 B (user_id=U002)             |
|  ┌─────────────────────┐        ┌─────────────────────┐           |
|  │  Redis Key Prefix   │        │  Redis Key Prefix   │           |
|  │  stm:U001:session1  │        │  stm:U002:session2  │           |
|  │  tm:U001:tool_cache │        │  tm:U002:tool_cache │           |
|  └─────────────────────┘        └─────────────────────┘           |
|                                                                    |
|  向量数据库 Collection          向量数据库 Collection              |
|  long_term_U001                 long_term_U002                     |
|                                                                    |
|  ┌────────────────────────────────────────────────────┐           |
|  │         工具记忆（部分全局共享，部分用户隔离）        │           |
|  │  全局共享：POI 信息、城市数据、汇率（与用户无关）    │           |
|  │  用户隔离：航班查询、酒店查询（含个人偏好参数）       │           |
|  └────────────────────────────────────────────────────┘           |
|                                                                    |
+--------------------------------------------------------------------+
```

### 9.2 隔离实现

```python
class IsolatedMemoryFactory:
    """
    记忆工厂：确保每个 (user_id, session_id) 获得完全隔离的记忆实例
    """

    def __init__(self, redis_client, config: Optional[MemoryConfig] = None):
        self._redis = redis_client
        self._config = config or MemoryConfig()
        self._instances: Dict[str, MemoryManager] = {}

    def get_or_create(self, user_id: str, session_id: str) -> MemoryManager:
        """
        获取或创建记忆管理器
        key = user_id + session_id，保证不同用户即使 session_id 相同也不冲突
        """
        # 注意：key 必须包含 user_id，否则不同用户共用同一 session_id 时会冲突
        instance_key = f"{user_id}:{session_id}"

        if instance_key not in self._instances:
            self._instances[instance_key] = MemoryManager(
                session_id=f"{user_id}_{session_id}",  # Redis key 内嵌 user_id
                user_id=user_id,
                redis_client=self._redis,
                config=self._config,
            )

        return self._instances[instance_key]

    def destroy(self, user_id: str, session_id: str) -> None:
        """清理指定会话的记忆"""
        instance_key = f"{user_id}:{session_id}"
        manager = self._instances.pop(instance_key, None)
        if manager:
            # 清除 Redis 中的短期记忆
            redis_key = f"stm:{user_id}_{session_id}"
            self._redis.delete(redis_key)
```

### 9.3 Redis Key 命名规范

```
# 命名规范：{类型}:{user_id}:{session_id}

# 短期记忆
stm:{user_id}:{session_id}

# 工具缓存（全局共享，不含 user_id）
tool:{tool_name}:{params_hash}

# 用户级工具缓存（包含用户偏好参数的工具）
tool_user:{user_id}:{tool_name}:{params_hash}

# 会话锁（防止并发写入）
lock:stm:{user_id}:{session_id}
```

---

## 十、与 LangChain / LangGraph 集成

### 10.1 LangChain Memory 集成

LangChain 提供了多种开箱即用的 Memory 实现，可以直接与 MemoryManager 对接：

```python
from langchain.memory import ConversationBufferWindowMemory, ConversationSummaryBufferMemory
from langchain_community.chat_message_histories import RedisChatMessageHistory
from langchain_core.messages import HumanMessage, AIMessage
from langchain_core.chat_history import BaseChatMessageHistory

class LangChainMemoryAdapter:
    """
    将自定义 MemoryManager 适配到 LangChain 接口
    """

    def __init__(self, memory_manager: MemoryManager):
        self.manager = memory_manager

    def to_langchain_history(self) -> BaseChatMessageHistory:
        """转换为 LangChain 兼容格式"""
        from langchain_community.chat_message_histories import ChatMessageHistory
        history = ChatMessageHistory()
        for msg in self.manager.get_short_term_messages():
            if msg["role"] == "user":
                history.add_user_message(msg["content"])
            elif msg["role"] == "assistant":
                history.add_ai_message(msg["content"])
        return history


def build_langchain_memory_with_redis(
    session_id: str,
    redis_url: str = "redis://localhost:6379",
    max_token_limit: int = 4000,
):
    """
    使用 Redis 持久化的 LangChain 摘要缓冲 Memory
    ConversationSummaryBufferMemory = 滑动窗口 + 自动摘要
    """
    message_history = RedisChatMessageHistory(
        session_id=session_id,
        url=redis_url,
        ttl=86400,
    )

    memory = ConversationSummaryBufferMemory(
        chat_memory=message_history,
        max_token_limit=max_token_limit,
        return_messages=True,
        memory_key="chat_history",
    )

    return memory
```

### 10.2 LangGraph 状态记忆集成

LangGraph 使用 State 对象管理工作流状态，记忆需要嵌入 State：

```python
from typing import TypedDict, Annotated, List
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.checkpoint.memory import MemorySaver

# 定义包含记忆的状态
class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], add_messages]
    # 工作记忆：当前任务上下文
    current_task: dict
    # 工具调用历史（本轮）
    tool_calls: List[dict]
    # 从长期记忆检索到的相关信息
    retrieved_context: str


def build_memory_aware_graph(memory_manager: MemoryManager):
    """构建携带记忆的 LangGraph 工作流"""

    def inject_memory(state: AgentState) -> AgentState:
        """节点：在调用 LLM 前注入记忆上下文"""
        last_human = next(
            (m for m in reversed(state["messages"]) if isinstance(m, HumanMessage)),
            None,
        )
        if last_human:
            items = memory_manager.search_long_term(last_human.content)
            if items:
                state["retrieved_context"] = "\n".join(
                    f"- {i['content']}" for i in items
                )
        return state

    def persist_to_memory(state: AgentState) -> AgentState:
        """节点：在 LLM 回复后持久化重要信息"""
        for msg in state["messages"]:
            if isinstance(msg, (HumanMessage, AIMessage)):
                memory_manager.add_message(
                    role="user" if isinstance(msg, HumanMessage) else "assistant",
                    content=msg.content,
                )
        return state

    # 构建图
    graph = StateGraph(AgentState)
    graph.add_node("inject_memory", inject_memory)
    graph.add_node("persist_memory", persist_to_memory)
    # ... 添加其他节点

    # 使用 MemorySaver 实现跨轮次 checkpoint
    checkpointer = MemorySaver()
    return graph.compile(checkpointer=checkpointer)
```

### 10.3 跨轮次持久化配置

```python
# LangGraph checkpoint 配置（使用 PostgreSQL 持久化）
from langgraph.checkpoint.postgres import PostgresSaver
import psycopg

def create_persistent_graph(connection_string: str):
    """使用 PostgreSQL 实现跨进程重启的记忆持久化"""
    conn = psycopg.connect(connection_string, autocommit=True)
    checkpointer = PostgresSaver(conn)
    checkpointer.setup()   # 初始化表结构

    # 调用时通过 config 指定 thread_id（对应 session_id）
    config = {"configurable": {"thread_id": "user_001_session_abc"}}

    return checkpointer, config
```

---

## 十一、Redis 生产配置

### 11.1 连接池配置

```python
import redis
from redis.connection import ConnectionPool

def create_redis_client(
    host: str = "localhost",
    port: int = 6379,
    password: Optional[str] = None,
    db: int = 0,
    max_connections: int = 50,
) -> redis.Redis:
    """
    生产级 Redis 连接池配置
    """
    pool = ConnectionPool(
        host=host,
        port=port,
        password=password,
        db=db,
        max_connections=max_connections,
        socket_timeout=5,           # 读超时（秒）
        socket_connect_timeout=3,   # 连接超时（秒）
        retry_on_timeout=True,
        health_check_interval=30,   # 心跳检查间隔
        decode_responses=True,      # 自动 bytes -> str
    )
    return redis.Redis(connection_pool=pool)
```

### 11.2 Redis 内存淘汰策略

```
# redis.conf 推荐配置（记忆系统专用实例）

# 最大内存限制
maxmemory 4gb

# 淘汰策略：优先淘汰带 TTL 的旧 key
# allkeys-lru  适合缓存场景（所有 key 都可能被淘汰）
# volatile-lru 适合记忆场景（只淘汰设了 TTL 的 key，保护永久数据）
maxmemory-policy volatile-lru

# 持久化：RDB + AOF 双重保障
save 900 1      # 900秒内至少1次写操作则快照
save 300 10
save 60 10000
appendonly yes
appendfsync everysec
```

### 11.3 Redis Cluster 多用户分片

```python
from redis.cluster import RedisCluster, ClusterNode

def create_redis_cluster(nodes: List[dict]) -> RedisCluster:
    """
    Redis Cluster 模式：水平扩展，适合大规模多用户场景
    每个用户的 key 会根据 hash slot 分散到不同节点
    """
    startup_nodes = [
        ClusterNode(n["host"], n["port"]) for n in nodes
    ]
    return RedisCluster(
        startup_nodes=startup_nodes,
        decode_responses=True,
        skip_full_coverage_check=True,
    )


# 使用 Hash Tag 确保同一用户的 key 落在同一 slot（避免跨节点事务）
# 格式：{user_id}.key_suffix
# 例如：{U001}.stm:session1  -> hash 只计算 {U001} 部分
def make_redis_key_with_hash_tag(user_id: str, key_suffix: str) -> str:
    return f"{{{user_id}}}.{key_suffix}"
```

---

## 十二、记忆检索优化

### 12.1 向量搜索 top-k 调优

top-k 不是越大越好，需要在"召回率"和"噪声"之间权衡：

```
+--------------------------------------------------------------------+
|  top-k 选择参考                                                    |
+--------------------------------------------------------------------+
|                                                                    |
|  场景              推荐 top-k    说明                              |
|  ------------------------------------------------------------------+
|  闲聊 / 寒暄       1-2          检索意义不大，浅尝即止            |
|  偏好查询          3-5          中等召回，控制噪声                 |
|  行程规划          5-8          需要更多历史信息参考               |
|  复杂决策          8-10         全面召回，LLM 自行筛选             |
|                                                                    |
|  注意：top-k 增大后 min_score 也要相应提高，否则噪声增多          |
|                                                                    |
+--------------------------------------------------------------------+
```

```python
class AdaptiveRetriever:
    """
    自适应检索器：根据查询类型动态调整 top-k 和阈值
    """

    RETRIEVAL_CONFIGS = {
        "preference": {"top_k": 5, "min_score": 0.7},
        "planning": {"top_k": 8, "min_score": 0.65},
        "decision": {"top_k": 10, "min_score": 0.6},
        "default": {"top_k": 3, "min_score": 0.65},
    }

    PLANNING_KEYWORDS = ["行程", "计划", "安排", "几天", "路线"]
    PREFERENCE_KEYWORDS = ["推荐", "喜欢", "偏好", "适合我"]
    DECISION_KEYWORDS = ["选择", "哪个更好", "对比", "建议"]

    def classify_query(self, query: str) -> str:
        if any(kw in query for kw in self.PLANNING_KEYWORDS):
            return "planning"
        if any(kw in query for kw in self.PREFERENCE_KEYWORDS):
            return "preference"
        if any(kw in query for kw in self.DECISION_KEYWORDS):
            return "decision"
        return "default"

    def retrieve(self, long_term: LongTermMemory, query: str) -> List[Dict]:
        query_type = self.classify_query(query)
        config = self.RETRIEVAL_CONFIGS[query_type]
        return long_term.search(query=query, **config)
```

### 12.2 时间衰减权重

检索结果应根据时间远近加权，越近的记忆通常越相关：

```python
import math
from datetime import datetime

def apply_time_decay(
    memories: List[Dict],
    decay_lambda: float = 0.05,
    recency_weight: float = 0.3,
) -> List[Dict]:
    """
    综合分 = semantic_score * (1 - recency_weight)
             + time_decay_score * recency_weight

    decay_lambda 越大，时间衰减越快
    recency_weight 越大，越强调时间因素
    """
    now = datetime.now()

    for mem in memories:
        created_at_str = mem["metadata"].get("timestamp", "")
        if created_at_str:
            try:
                created_at = datetime.fromisoformat(created_at_str)
                days_elapsed = (now - created_at).days
                time_score = math.exp(-decay_lambda * days_elapsed)
            except ValueError:
                time_score = 0.5
        else:
            time_score = 0.5

        semantic_score = mem.get("score", 0.5)
        mem["combined_score"] = (
            semantic_score * (1 - recency_weight)
            + time_score * recency_weight
        )

    # 按综合分重新排序
    memories.sort(key=lambda x: x["combined_score"], reverse=True)
    return memories
```

### 12.3 混合检索策略

在长期记忆中，单纯向量检索可能漏掉精确匹配（如具体日期、名字）。结合 BM25 关键词检索效果更好：

```python
from rank_bm25 import BM25Okapi
import jieba

class HybridMemoryRetriever:
    """混合检索：向量检索 + BM25 关键词检索"""

    def __init__(
        self,
        long_term: LongTermMemory,
        alpha: float = 0.7,   # 向量检索权重
    ):
        self.long_term = long_term
        self.alpha = alpha
        self._bm25 = None
        self._docs = []

    def build_bm25_index(self, documents: List[str]) -> None:
        """构建 BM25 索引（中文分词）"""
        self._docs = documents
        tokenized = [list(jieba.cut(doc)) for doc in documents]
        self._bm25 = BM25Okapi(tokenized)

    def retrieve(self, query: str, top_k: int = 5) -> List[Dict]:
        # 1. 向量检索
        vector_results = self.long_term.search(query, top_k=top_k * 2)

        # 2. BM25 检索（如果有索引）
        if self._bm25 and self._docs:
            query_tokens = list(jieba.cut(query))
            bm25_scores = self._bm25.get_scores(query_tokens)
            bm25_top_idx = sorted(
                range(len(bm25_scores)),
                key=lambda i: bm25_scores[i],
                reverse=True,
            )[:top_k * 2]
        else:
            bm25_top_idx = []

        # 3. RRF 融合（Reciprocal Rank Fusion）
        # RRF_score(d) = sum(1 / (k + rank(d)))，k=60 是经验值
        rrf_scores: Dict[str, float] = {}

        for rank, item in enumerate(vector_results):
            key = item["content"][:50]   # 用内容前缀作 key
            rrf_scores[key] = rrf_scores.get(key, 0) + 1 / (60 + rank)

        for rank, idx in enumerate(bm25_top_idx):
            key = self._docs[idx][:50]
            rrf_scores[key] = rrf_scores.get(key, 0) + 1 / (60 + rank)

        # 4. 取 top_k 结果
        sorted_keys = sorted(rrf_scores, key=rrf_scores.get, reverse=True)[:top_k]
        return [r for r in vector_results if r["content"][:50] in sorted_keys]
```

---

## 十三、常见踩坑与解决方案

### 坑 1：记忆无限增长导致上下文爆炸

```python
# ❌ 错误：不限制记忆大小，直接 append
class BadAgent:
    def __init__(self):
        self.history = []   # 无上限，随对话轮次线性膨胀

    def chat(self, query: str):
        self.history.append({"role": "user", "content": query})
        response = llm.invoke(self.history)   # 超过 128k 后直接报错
        self.history.append({"role": "assistant", "content": response})
        return response


# ✅ 正确：deque 滑动窗口 + 摘要压缩双保险
from collections import deque

class GoodAgent:
    def __init__(self):
        self.history: deque = deque(maxlen=40)  # 最多 20 轮（40 条消息）
        self.compressor = SummaryCompressor(llm=llm, keep_recent=6, compress_threshold=20)

    def chat(self, query: str):
        self.history.append({"role": "user", "content": query})

        messages = list(self.history)
        # 超过阈值时主动压缩
        if self.compressor.should_compress(messages):
            result = self.compressor.compress(messages)
            self.history.clear()
            for m in result.retained_messages:
                self.history.append(m)

        response = llm.invoke(list(self.history))
        self.history.append({"role": "assistant", "content": response})
        return response
```

### 坑 2：服务重启后记忆丢失

```python
# ❌ 错误：记忆存在进程内存，重启即失
class BadMemory:
    def __init__(self, session_id: str):
        self.messages = []   # 纯内存，部署重启后消失

    def add(self, role, content):
        self.messages.append({"role": role, "content": content})


# ✅ 正确：写入 Redis，每次写入刷新 TTL
class GoodMemory:
    def __init__(self, session_id: str, redis_client: redis.Redis):
        self.key = f"stm:{session_id}"
        self.r = redis_client

    def add(self, role: str, content: str):
        msg = json.dumps({"role": role, "content": content,
                          "ts": datetime.now().isoformat()})
        pipe = self.r.pipeline()
        pipe.rpush(self.key, msg)
        pipe.ltrim(self.key, -40, -1)       # 保留最近 40 条
        pipe.expire(self.key, 86400)         # 每次写入重置 TTL
        pipe.execute()

    def get_all(self) -> List[dict]:
        return [json.loads(m) for m in self.r.lrange(self.key, 0, -1)]
```

### 坑 3：工具结果重复调用浪费 Token 和时间

```python
# ❌ 错误：同轮次内同参数重复调用工具
def bad_plan_trip(query: str):
    hotels = search_hotel("北京", "2026-05-01")    # 第 1 次调用
    # 几个节点后又查了一次
    same_hotels = search_hotel("北京", "2026-05-01")  # 第 2 次调用！完全相同


# ✅ 正确：工具调用前先查缓存，结果写入缓存
def good_plan_trip(query: str, memory: MemoryManager):
    params = {"city": "北京", "date": "2026-05-01"}

    # 先查缓存
    cached = memory.get_tool_cache("search_hotel", params)
    if cached:
        hotels = cached
    else:
        hotels = search_hotel(**params)
        memory.set_tool_cache("search_hotel", params, hotels)

    return hotels
```

### 坑 4：多用户记忆 key 未隔离，导致数据串扰

```python
# ❌ 错误：key 只包含 session_id，不同用户可能碰撞
class BadIsolation:
    def __init__(self, session_id: str, redis_client):
        self.key = f"memory:{session_id}"   # 危险！只有 session_id
        self.r = redis_client


# ✅ 正确：key 必须包含 user_id
class GoodIsolation:
    def __init__(self, user_id: str, session_id: str, redis_client):
        # user_id 在前，绝对隔离不同用户
        self.key = f"stm:{user_id}:{session_id}"
        self.r = redis_client
```

### 坑 5：时间戳字段用字符串比较而非 datetime 对象

```python
# ❌ 错误：字符串比较时间顺序，跨日期时结果错乱
def bad_sort_by_time(messages: List[dict]) -> List[dict]:
    return sorted(messages, key=lambda m: m["timestamp"])
    # "2026-01-09" > "2026-01-10" 是错的！字符串比较按字典序


# ✅ 正确：先转 datetime 再比较
def good_sort_by_time(messages: List[dict]) -> List[dict]:
    def parse_ts(m):
        try:
            return datetime.fromisoformat(m["timestamp"])
        except (ValueError, KeyError):
            return datetime.min
    return sorted(messages, key=parse_ts)
```

### 坑 6：Token 计数忽略工具调用消息

```python
# ❌ 错误：只统计 user/assistant 消息的 Token
def bad_count_tokens(messages: List[dict]) -> int:
    return sum(
        len(m["content"])
        for m in messages
        if m["role"] in ("user", "assistant")
    )
    # 遗漏了 tool_call / tool_result 消息，实际 Token 被低估


# ✅ 正确：所有角色的消息都计入 Token 预算
def good_count_tokens(messages: List[dict], enc) -> int:
    total = 0
    for m in messages:
        content = m.get("content", "")
        if isinstance(content, list):
            # tool_call 的 content 可能是 list（含 text/image 块）
            content = " ".join(
                block.get("text", "") for block in content
                if isinstance(block, dict)
            )
        total += len(enc.encode(content))
    return total
```

### 坑 7：长期记忆向量库未指定 user_id 过滤，返回其他用户的记忆

```python
# ❌ 错误：检索时没有按 user_id 过滤，全库检索
def bad_search(collection, query: str) -> List:
    return collection.query(query_texts=[query], n_results=5)
    # 会返回所有用户的记忆！严重的数据隔离问题


# ✅ 正确：使用 where 子句过滤 user_id
def good_search(collection, query: str, user_id: str) -> List:
    return collection.query(
        query_texts=[query],
        n_results=5,
        where={"user_id": {"$eq": user_id}},   # Chroma 过滤语法
    )
```

---

## 十四、速查表

### 14.1 记忆类型选择

```
问题                               推荐方案
--------------------------------------------------------------
需要记住本轮对话？                 短期记忆（deque + Redis）
需要跨会话记住用户偏好？            长期记忆（向量数据库）
需要跟踪当前任务执行状态？          工作记忆（TaskContext）
相同工具参数不想重复调用？          工具记忆（ToolMemory）
对话太长超出上下文窗口？            摘要压缩 / 重要性排序压缩
需要精确匹配 + 语义检索？           混合检索（向量 + BM25 RRF 融合）
```

### 14.2 关键参数参考

| 参数 | 推荐值 | 说明 |
|------|--------|------|
| `max_short_term_turns` | 20 | 短期记忆保留轮次 |
| `short_term_ttl` | 86400 (24h) | 短期记忆 Redis 过期时间 |
| `long_term_top_k` | 3-8 | 长期记忆检索数量 |
| `long_term_min_score` | 0.65 | 长期记忆最低相似度阈值 |
| `compress_threshold` | 20 | 超过多少条消息触发摘要压缩 |
| `keep_recent` | 6 | 压缩后保留的最近消息条数 |
| `tool_default_ttl` | 3600 (1h) | 工具缓存默认有效期 |
| `max_context_tokens` | 8000 | 上下文最大 Token 数（保守值） |
| `importance_threshold` | 0.5 | 自动存入长期记忆的重要性阈值 |
| `decay_lambda` | 0.05-0.1 | 时间衰减系数（越大衰减越快） |

### 14.3 常用代码片段

```python
# 初始化完整记忆管理器
redis_client = create_redis_client(host="redis", port=6379)
memory = MemoryManager(
    session_id="session_abc",
    user_id="U001",
    redis_client=redis_client,
    config=MemoryConfig(max_short_term_turns=20, max_context_tokens=8000),
)

# 添加消息（自动判断是否沉淀长期记忆）
memory.add_message("user", "我喜欢靠窗的座位")
memory.add_message("assistant", "好的，我记住了，为您优先安排靠窗座位。")

# 构建 LLM 上下文
context = memory.build_context(current_query="帮我订明天北京到上海的机票")

# 工具缓存
cached = memory.get_tool_cache("search_flight", {"from": "BJS", "to": "SHA", "date": "2026-04-15"})
if not cached:
    result = search_flight(from_city="BJS", to_city="SHA", date="2026-04-15")
    memory.set_tool_cache("search_flight", {"from": "BJS", "to": "SHA", "date": "2026-04-15"}, result)

# 工作记忆：跟踪任务状态
task = memory.working.new_task("task_001", "规划北京三日游")
task.add_reasoning("用户预算 3000 元，偏好文化景点")
task.store_result("attractions", ["故宫", "颐和园", "798"])
```

### 14.4 调试检查清单

```
[ ] Redis 连接是否正常？redis.ping() 返回 True
[ ] 短期记忆 key 是否包含 user_id？避免多用户串扰
[ ] 工具缓存 TTL 是否合理？实时性数据不能缓存太长
[ ] 长期记忆检索是否加了 user_id 过滤条件？
[ ] Token 预算是否预留了 LLM 输出空间（至少 1000 Token）？
[ ] 摘要压缩是否会丢失关键参数（时间、人数、预算）？
[ ] 服务重启后，短期记忆能否从 Redis 恢复？
[ ] 向量数据库的 embedding 模型与写入时是否一致？
```
