# 上下文管理最佳实践与踩坑指南

## 文档信息

- 作者：徐凯旋
- 邮箱：azouever@gmail.com
- 更新时间：2026-04-14

---

## 目录

1. [概述：上下文窗口的本质](#一概述上下文窗口的本质)
2. [主流模型上下文窗口规格对比](#二主流模型上下文窗口规格对比)
3. [Token 计算](#三token-计算)
4. [四种上下文策略详解](#四四种上下文策略详解)
5. [ContextManager 完整实现](#五contextmanager-完整实现)
6. [System Prompt Token 优化技巧](#六system-prompt-token-优化技巧)
7. [工具 Token 消耗管理](#七工具-token-消耗管理)
8. [多轮对话的上下文构建策略](#八多轮对话的上下文构建策略)
9. [Prompt Caching](#九prompt-caching)
10. [监控与告警](#十监控与告警)
11. [常见踩坑](#十一常见踩坑)
12. [速查表](#十二速查表)

---

## 一、概述：上下文窗口的本质

### 1.1 什么是上下文窗口

上下文窗口（Context Window）是大语言模型一次推理能够"看到"的最大 Token 数量。超过这个限制，模型要么报错，要么截断早期内容——两者都会导致行为异常。

上下文窗口是一种**有限共享资源**。每一次 API 调用，System Prompt、工具定义、历史消息、当前输入、模型输出预留空间，全部都在竞争同一块空间。

### 1.2 Token 消耗构成分析

```
+-----------------------------------------------------------------------+
|                    上下文窗口 Token 消耗构成                           |
|                       (以 128K 窗口为例)                              |
+-----------------------------------------------------------------------+
|                                                                       |
|  [System Prompt]            ████████ 500 ~ 3000 Token                |
|  ├── 角色定义                                                          |
|  ├── 能力说明                                                          |
|  └── 输出格式约束                                                      |
|                                                                       |
|  [工具定义 / Tools]          ██████████████ 1000 ~ 8000 Token         |
|  ├── 每个工具的 name                                                   |
|  ├── description（最耗 Token 的部分）                                  |
|  └── parameters JSON Schema                                           |
|                                                                       |
|  [历史消息 / History]        ████████████████████████ 动态，可被压缩  |
|  ├── user 消息                                                         |
|  ├── assistant 消息                                                    |
|  └── tool_call / tool_result                                          |
|                                                                       |
|  [当前输入 / Current Input]  ████ 50 ~ 2000 Token                     |
|                                                                       |
|  [输出预留 / Output Reserve] ████████ 1000 ~ 8192 Token               |
|  └── max_tokens 参数决定上限                                           |
|                                                                       |
+-----------------------------------------------------------------------+
|  公式：                                                                |
|  可用历史 Token = 窗口总量 - System - Tools - 当前输入 - 输出预留      |
+-----------------------------------------------------------------------+
```

### 1.3 为什么上下文管理至关重要

| 问题 | 后果 |
|------|------|
| 不管理上下文直接追加 | 轻则 API 报错，重则模型截断早期关键信息 |
| System Prompt 过长 | 压缩历史消息的可用空间，每次调用都浪费大量 Token |
| 工具描述冗余 | 10 个工具 × 500 Token = 5000 Token 固定开销 |
| 不预留输出空间 | 模型回答被截断，输出不完整 |
| 忽略 tool_call/result 消耗 | Agent 多轮工具调用后上下文急速膨胀 |

---

## 二、主流模型上下文窗口规格对比

| 模型 | 上下文窗口 | 最大输出 Token | 备注 |
|------|-----------|--------------|------|
| GPT-4o | 128,000 | 16,384 | OpenAI 旗舰，支持 Prompt Cache |
| GPT-4o-mini | 128,000 | 16,384 | 低成本，适合高频调用 |
| GPT-4.1 | 1,047,576 | 32,768 | 百万 Token 窗口 |
| o3 / o4-mini | 200,000 | 100,000 | 推理模型，思维链消耗大 |
| Claude Sonnet 3.7 | 200,000 | 64,000 (extended thinking) | 支持 cache_control |
| Claude Sonnet 4 | 200,000 | 64,000 | 最新 Sonnet，支持 cache |
| Claude Opus 4 | 200,000 | 32,000 | 最强推理，成本最高 |
| Claude Haiku 3.5 | 200,000 | 8,096 | 低延迟、低成本 |
| Gemini 1.5 Pro | 2,000,000 | 8,192 | 200 万 Token 窗口 |
| Gemini 2.0 Flash | 1,048,576 | 8,192 | 快速，支持多模态 |
| Qwen-Long | 10,000,000 | 6,000 | 超长文本处理 |
| DeepSeek-V3 | 128,000 | 8,192 | 高性价比 |

> 注意：上下文窗口越大，单次调用成本越高（按 Token 计费）。大窗口 ≠ 不需要管理上下文。

---

## 三、Token 计算

### 3.1 tiktoken 基本用法

tiktoken 是 OpenAI 开源的分词库，支持 GPT 系列模型的精确 Token 计算。

```python
import tiktoken

def get_encoding(model: str) -> tiktoken.Encoding:
    """获取模型对应的编码器"""
    try:
        return tiktoken.encoding_for_model(model)
    except KeyError:
        # 未知模型，回退到 cl100k_base（GPT-4 系列通用编码）
        return tiktoken.get_encoding("cl100k_base")

def count_tokens(text: str, model: str = "gpt-4o") -> int:
    """计算文本的 Token 数量"""
    enc = get_encoding(model)
    return len(enc.encode(text))

def count_messages_tokens(messages: list[dict], model: str = "gpt-4o") -> int:
    """
    计算消息列表的 Token 数量（含消息结构开销）
    每条消息有 4 Token 的结构固定开销，回复有 3 Token 的额外开销
    参考：https://github.com/openai/openai-cookbook
    """
    enc = get_encoding(model)
    
    # 不同模型的消息开销略有差异
    tokens_per_message = 3   # GPT-4 系列
    tokens_per_name = 1
    
    total = 0
    for message in messages:
        total += tokens_per_message
        for key, value in message.items():
            if isinstance(value, str):
                total += len(enc.encode(value))
            elif isinstance(value, list):
                # tool_calls / content blocks
                total += len(enc.encode(str(value)))
            if key == "name":
                total += tokens_per_name
    
    total += 3  # 回复预启动 Token
    return total
```

### 3.2 不同模型的分词差异

不同模型使用不同的分词算法，同一段文本的 Token 数可能有 10%~30% 的差异：

```python
# GPT 系列使用 BPE (Byte-Pair Encoding)
# Claude 使用自家分词器，与 tiktoken 不完全一致
# Gemini 使用 SentencePiece

# 对 Claude 的 Token 估算（官方 API 提供 usage 字段，建议用实际值）
def estimate_claude_tokens(text: str) -> int:
    """
    Claude Token 估算（无官方 tiktoken）
    经验规则：中文约 1~1.5 字/Token，英文约 4 字符/Token
    建议：优先用 API 返回的 usage.input_tokens 做实际统计
    """
    # 粗略估算：用 cl100k_base 结果乘以修正系数
    enc = tiktoken.get_encoding("cl100k_base")
    base = len(enc.encode(text))
    
    # Claude 对中文更紧凑，英文接近 GPT-4
    chinese_ratio = sum(1 for c in text if '\u4e00' <= c <= '\u9fff') / max(len(text), 1)
    correction = 1.0 - 0.15 * chinese_ratio  # 中文比例越高，修正越大
    
    return int(base * correction)

# 使用 Anthropic SDK 获取精确 Token 数
import anthropic

def count_tokens_claude_api(
    messages: list[dict],
    system: str,
    tools: list[dict] | None = None,
    model: str = "claude-sonnet-4-5"
) -> int:
    """通过 Anthropic API 计算精确 Token 数（会产生少量费用）"""
    client = anthropic.Anthropic()
    
    kwargs = {
        "model": model,
        "messages": messages,
        "system": system,
        "max_tokens": 1,  # 最小化输出
    }
    if tools:
        kwargs["tools"] = tools
    
    response = client.messages.count_tokens(**kwargs)
    return response.input_tokens
```

### 3.3 常用 Token 计算函数

```python
from dataclasses import dataclass
from typing import Optional
import json

@dataclass
class TokenBudget:
    """Token 预算分析"""
    context_window: int
    system_tokens: int
    tools_tokens: int
    history_tokens: int
    current_input_tokens: int
    output_reserve: int
    
    @property
    def available_history_tokens(self) -> int:
        return (
            self.context_window
            - self.system_tokens
            - self.tools_tokens
            - self.current_input_tokens
            - self.output_reserve
        )
    
    @property
    def total_used(self) -> int:
        return (
            self.system_tokens
            + self.tools_tokens
            + self.history_tokens
            + self.current_input_tokens
        )
    
    @property
    def utilization_rate(self) -> float:
        return self.total_used / self.context_window
    
    def summary(self) -> str:
        return (
            f"Token 预算分析\n"
            f"  窗口总量:   {self.context_window:>8,}\n"
            f"  System:     {self.system_tokens:>8,}\n"
            f"  Tools:      {self.tools_tokens:>8,}\n"
            f"  历史消息:   {self.history_tokens:>8,}\n"
            f"  当前输入:   {self.current_input_tokens:>8,}\n"
            f"  输出预留:   {self.output_reserve:>8,}\n"
            f"  ─────────────────────────\n"
            f"  可用历史:   {self.available_history_tokens:>8,}\n"
            f"  使用率:     {self.utilization_rate:>7.1%}\n"
        )


def analyze_token_budget(
    system_prompt: str,
    tools: list[dict],
    messages: list[dict],
    current_query: str,
    model: str = "gpt-4o",
    output_reserve: int = 4096,
) -> TokenBudget:
    """分析 Token 预算"""
    context_windows = {
        "gpt-4o": 128_000,
        "gpt-4o-mini": 128_000,
        "gpt-4.1": 1_047_576,
        "claude-sonnet-4-5": 200_000,
        "claude-opus-4": 200_000,
        "claude-haiku-3-5": 200_000,
    }
    context_window = context_windows.get(model, 128_000)
    
    return TokenBudget(
        context_window=context_window,
        system_tokens=count_tokens(system_prompt, model),
        tools_tokens=count_tokens(json.dumps(tools, ensure_ascii=False), model),
        history_tokens=count_messages_tokens(messages, model),
        current_input_tokens=count_tokens(current_query, model),
        output_reserve=output_reserve,
    )
```

---

## 四、四种上下文策略详解

### 4.1 滑动窗口（Sliding Window）

**原理**：保留最近 N 轮对话，丢弃最早的消息。

```
对话历史（时间轴 →）
─────────────────────────────────────────────────────────
Turn 1  Turn 2  Turn 3  Turn 4  Turn 5  Turn 6  Turn 7
  [x]     [x]     [x]   [ 保 ]  [ 保 ]  [ 保 ]  [ 新 ]
          ↑ 丢弃区                      ↑ 滑动窗口 (N=4)
─────────────────────────────────────────────────────────
特点：实现简单 | 丢失早期信息 | 适合短对话
```

```python
from dataclasses import dataclass, field
from typing import Literal

@dataclass
class Message:
    role: Literal["system", "user", "assistant", "tool"]
    content: str
    tokens: int = 0


class SlidingWindowStrategy:
    """滑动窗口策略"""
    
    def __init__(self, max_tokens: int, min_keep_turns: int = 2):
        self.max_tokens = max_tokens
        self.min_keep_turns = min_keep_turns  # 最少保留最近 N 轮（无论 Token 多少）
    
    def select(self, messages: list[Message]) -> list[Message]:
        """从后往前选取消息，直到达到 Token 上限"""
        if not messages:
            return []
        
        selected: list[Message] = []
        used_tokens = 0
        
        # 确保最近 min_keep_turns 轮一定被保留
        # 一轮 = user + assistant，所以乘 2
        must_keep = messages[-self.min_keep_turns * 2:]
        
        for msg in reversed(messages):
            if used_tokens + msg.tokens > self.max_tokens:
                # 检查是否在强制保留区
                if msg not in must_keep:
                    break
            selected.insert(0, msg)
            used_tokens += msg.tokens
        
        return selected
```

### 4.2 摘要压缩（Summarization）

**原理**：当历史消息超出预算时，用 LLM 对旧消息生成摘要，以摘要替代原始内容。

```
原始历史（10 轮，8000 Token）
┌──────────────────────────────────────────────┐
│ Turn 1-6（过旧）  │  Turn 7-10（保留原文）   │
│  6000 Token      │     2000 Token            │
└──────────────────────────────────────────────┘
             ↓ 压缩 Turn 1-6
┌────────────────────┬─────────────────────────┐
│ [摘要] 400 Token   │  Turn 7-10  2000 Token  │
└────────────────────┴─────────────────────────┘
节省：6000 → 400 Token，压缩比 ~15x
```

```python
import asyncio

class SummarizationStrategy:
    """摘要压缩策略"""
    
    def __init__(
        self, 
        llm_client,
        max_tokens: int,
        summary_model: str = "gpt-4o-mini",  # 用小模型做摘要，降低成本
        keep_recent_turns: int = 3,           # 保留最近 N 轮原文
        summary_max_tokens: int = 400,
    ):
        self.llm = llm_client
        self.max_tokens = max_tokens
        self.summary_model = summary_model
        self.keep_recent_turns = keep_recent_turns
        self.summary_max_tokens = summary_max_tokens
    
    async def select(self, messages: list[Message]) -> list[Message]:
        """选择消息，必要时对旧消息摘要压缩"""
        if not messages:
            return []
        
        # 分离：保留区（最近 N 轮）和候选压缩区
        cutoff = -self.keep_recent_turns * 2
        recent = messages[cutoff:] if len(messages) > abs(cutoff) else messages
        old = messages[:cutoff] if len(messages) > abs(cutoff) else []
        
        # 计算当前总 Token
        recent_tokens = sum(m.tokens for m in recent)
        
        if not old or recent_tokens <= self.max_tokens:
            return recent
        
        # 需要压缩旧消息
        remaining_budget = self.max_tokens - recent_tokens
        
        if remaining_budget > 50:  # 摘要至少要有点空间
            summary_text = await self._summarize(old)
            summary_msg = Message(
                role="system",
                content=f"[早期对话摘要]\n{summary_text}",
                tokens=count_tokens(summary_text)
            )
            
            if summary_msg.tokens <= remaining_budget:
                return [summary_msg] + recent
        
        # 摘要也放不下，直接返回最近消息
        return recent
    
    async def _summarize(self, messages: list[Message]) -> str:
        """调用 LLM 生成摘要"""
        conversation = "\n".join(
            f"{m.role.upper()}: {m.content}" for m in messages
        )
        
        prompt = (
            "请将以下对话历史压缩成简洁的摘要（不超过300字），"
            "保留：用户目标、关键决策、已确认的事实、重要的数据或结论。"
            "忽略：寒暄、重复询问、过渡性内容。\n\n"
            f"对话历史：\n{conversation}"
        )
        
        response = await self.llm.invoke(
            prompt, 
            model=self.summary_model,
            max_tokens=self.summary_max_tokens
        )
        return response.content
```

### 4.3 重要性排序（Importance Ranking）

**原理**：对每条消息打分，优先保留重要的消息，而不是简单按时间顺序截断。

```
消息打分与选择
──────────────────────────────────────────────────────
消息                        重要性评分    是否保留
──────────────────────────────────────────────────────
Turn 1: 用户说明出行目标     ★★★★★ 0.95    ✓ 保留
Turn 2: 询问天气闲聊         ★☆☆☆☆ 0.15    ✗ 丢弃
Turn 3: 确认预算范围         ★★★★☆ 0.85    ✓ 保留
Turn 4: 工具调用结果         ★★★☆☆ 0.60    ✓ 保留（在预算内）
Turn 5: 用户修改需求         ★★★★★ 0.92    ✓ 保留
Turn 6: 重复确认某细节       ★★☆☆☆ 0.30    ✗ 丢弃
──────────────────────────────────────────────────────
```

```python
from enum import Enum

class MessageImportance(Enum):
    CRITICAL = 1.0   # 用户核心目标、最终确认
    HIGH     = 0.8   # 重要约束、关键决策
    MEDIUM   = 0.5   # 工具调用结果、中间步骤
    LOW      = 0.2   # 寒暄、确认性回复
    TRIVIAL  = 0.0   # 重复内容、无实质信息


class ImportanceRankingStrategy:
    """重要性排序策略"""
    
    def __init__(self, max_tokens: int):
        self.max_tokens = max_tokens
    
    def select(self, messages: list[Message]) -> list[Message]:
        """按重要性打分后选择消息"""
        if not messages:
            return []
        
        # 对所有消息打分
        scored = [(msg, self._score(msg, i, len(messages))) 
                  for i, msg in enumerate(messages)]
        
        # 按分数降序排列，选入预算
        scored.sort(key=lambda x: x[1], reverse=True)
        
        selected = []
        used_tokens = 0
        selected_indices = set()
        
        for msg, score in scored:
            if used_tokens + msg.tokens > self.max_tokens:
                continue
            if score < 0.1:  # 太不重要的不选
                continue
            selected.append(msg)
            used_tokens += msg.tokens
            selected_indices.add(id(msg))
        
        # 恢复时间顺序（重要！不能乱序给模型）
        return [msg for msg in messages if id(msg) in selected_indices]
    
    def _score(self, msg: Message, index: int, total: int) -> float:
        """
        综合评分：位置分 + 内容特征分
        越新的消息基础分越高
        """
        # 时间衰减：越新越重要
        recency_score = (index + 1) / total * 0.4
        
        # 内容特征
        content_score = self._content_importance(msg)
        
        # 角色权重
        role_weight = {
            "user": 1.0,
            "assistant": 0.9,
            "tool": 0.7,
            "system": 1.0,
        }.get(msg.role, 0.5)
        
        return (recency_score + content_score * 0.6) * role_weight
    
    def _content_importance(self, msg: Message) -> float:
        """基于内容关键词判断重要性"""
        high_importance_keywords = [
            "需要", "必须", "确认", "预算", "时间", "目标",
            "不能", "要求", "重要", "关键", "决定", "最终"
        ]
        low_importance_keywords = [
            "好的", "明白了", "谢谢", "好", "嗯", "没问题", "了解"
        ]
        
        content = msg.content.lower()
        
        high_count = sum(1 for kw in high_importance_keywords if kw in content)
        low_count = sum(1 for kw in low_importance_keywords if kw in content)
        
        if high_count > 2:
            return 0.9
        elif high_count > 0:
            return 0.6 + high_count * 0.1
        elif low_count > 0 and len(content) < 20:
            return 0.1  # 短且是低重要关键词，认为不重要
        else:
            return 0.5  # 中等
```

### 4.4 检索增强（Retrieval Augmented）

**原理**：将历史对话存入向量数据库，每次对话时根据当前问题检索语义最相关的历史片段注入上下文，而不是全量历史。

```
传统方案（全量历史）          检索增强方案（RAG History）
─────────────────────        ──────────────────────────────────
上下文窗口                    上下文窗口
┌───────────────────┐        ┌──────────────────────────────────┐
│ System Prompt     │        │ System Prompt                    │
│ Turn 1 (可能无关) │        │ [检索到的相关历史片段 Top-K]      │
│ Turn 2 (可能无关) │        │  - Turn 15 (相关度 0.92)         │
│ ...               │        │  - Turn 8  (相关度 0.87)         │
│ Turn N (全量)     │        │  - Turn 3  (相关度 0.81)         │
│                   │        │ 当前输入                          │
└───────────────────┘        └──────────────────────────────────┘
  消耗大，大量无关内容          消耗小，精准注入相关历史
```

```python
from dataclasses import dataclass
import numpy as np

@dataclass
class VectorizedMessage:
    message: Message
    embedding: list[float]
    session_id: str
    turn_index: int


class RetrievalAugmentedStrategy:
    """检索增强策略"""
    
    def __init__(
        self,
        embedding_client,           # 生成 embedding 的客户端
        vector_store,               # 向量存储（如 Chroma、Qdrant）
        max_tokens: int,
        top_k: int = 5,
        similarity_threshold: float = 0.75,
    ):
        self.embedding_client = embedding_client
        self.vector_store = vector_store
        self.max_tokens = max_tokens
        self.top_k = top_k
        self.similarity_threshold = similarity_threshold
    
    async def index_message(self, msg: Message, session_id: str, turn_index: int):
        """将消息存入向量库"""
        embedding = await self.embedding_client.embed(msg.content)
        
        self.vector_store.upsert(
            vectors=[{
                "id": f"{session_id}_{turn_index}",
                "values": embedding,
                "metadata": {
                    "content": msg.content,
                    "role": msg.role,
                    "session_id": session_id,
                    "turn_index": turn_index,
                    "tokens": msg.tokens,
                }
            }]
        )
    
    async def retrieve(
        self, 
        query: str, 
        session_id: str,
        recent_messages: list[Message],  # 最近 N 条原文（不走向量检索）
    ) -> list[Message]:
        """检索相关历史消息"""
        query_embedding = await self.embedding_client.embed(query)
        
        # 检索语义相关的历史
        results = self.vector_store.query(
            vector=query_embedding,
            top_k=self.top_k * 2,  # 多取一些，后面过滤
            filter={"session_id": session_id},
        )
        
        # 过滤低相似度结果
        relevant = [
            r for r in results 
            if r["score"] >= self.similarity_threshold
        ]
        
        # 按 Token 预算选取
        selected = []
        used_tokens = sum(m.tokens for m in recent_messages)
        
        for r in relevant[:self.top_k]:
            msg_tokens = r["metadata"]["tokens"]
            if used_tokens + msg_tokens > self.max_tokens:
                break
            selected.append(Message(
                role=r["metadata"]["role"],
                content=r["metadata"]["content"],
                tokens=msg_tokens,
            ))
            used_tokens += msg_tokens
        
        # 按 turn_index 排序，保持时间顺序
        selected.sort(key=lambda m: 0)  # 实际应存 turn_index
        
        return selected + recent_messages
```

---

## 五、ContextManager 完整实现

```python
import json
import logging
from dataclasses import dataclass, field
from typing import Literal, Optional, Callable
from enum import Enum

logger = logging.getLogger(__name__)


class ContextStrategy(Enum):
    SLIDING_WINDOW = "sliding_window"
    SUMMARIZATION  = "summarization"
    IMPORTANCE     = "importance_ranking"
    RETRIEVAL      = "retrieval_augmented"


MODEL_CONTEXT_WINDOWS = {
    "gpt-4o":             128_000,
    "gpt-4o-mini":        128_000,
    "gpt-4.1":          1_047_576,
    "o3":                200_000,
    "claude-opus-4-5":   200_000,
    "claude-sonnet-4-5": 200_000,
    "claude-haiku-3-5":  200_000,
    "gemini-1.5-pro":  2_000_000,
    "gemini-2.0-flash":1_048_576,
}

MODEL_MAX_OUTPUT = {
    "gpt-4o":             16_384,
    "gpt-4o-mini":        16_384,
    "claude-sonnet-4-5":  64_000,
    "claude-haiku-3-5":    8_096,
}


@dataclass
class ContextConfig:
    model: str = "gpt-4o"
    strategy: ContextStrategy = ContextStrategy.SLIDING_WINDOW
    safety_margin: int = 500
    output_reserve: int = 4_096
    min_keep_turns: int = 2
    summarize_fn: Optional[Callable] = None  # 摘要函数（用于 SUMMARIZATION 策略）


class ContextManager:
    """
    生产级上下文管理器
    支持四种策略，自动计算 Token 预算，内置监控日志
    """
    
    def __init__(self, config: ContextConfig):
        self.config = config
        self.context_window = MODEL_CONTEXT_WINDOWS.get(config.model, 128_000)
        self.max_output = MODEL_MAX_OUTPUT.get(config.model, config.output_reserve)
        
        # 实际输出预留取 config 和模型最大输出的较小值
        self.output_reserve = min(config.output_reserve, self.max_output)
    
    def build_context(
        self,
        system_prompt: str,
        messages: list[dict],
        tools: list[dict],
        query: str,
    ) -> list[dict]:
        """
        构建最终上下文
        返回适合直接传给 LLM API 的 messages 列表
        """
        # 1. 计算各组件 Token 消耗
        system_tokens  = self._count(system_prompt)
        tools_tokens   = self._count(json.dumps(tools, ensure_ascii=False))
        query_tokens   = self._count(query)
        
        fixed_overhead = (
            system_tokens
            + tools_tokens
            + query_tokens
            + self.output_reserve
            + self.config.safety_margin
        )
        
        available_for_history = self.context_window - fixed_overhead
        
        if available_for_history < 0:
            logger.warning(
                "固定开销已超出上下文窗口！"
                f"system={system_tokens}, tools={tools_tokens}, "
                f"query={query_tokens}, reserve={self.output_reserve}"
            )
            available_for_history = 0
        
        # 2. 将 dict 转 Message 对象（带 Token 计算）
        msg_objects = [
            Message(
                role=m["role"],
                content=m.get("content") or json.dumps(m, ensure_ascii=False),
                tokens=self._count(m.get("content") or json.dumps(m))
            )
            for m in messages
        ]
        
        # 3. 按策略选择历史消息
        selected = self._select_messages(msg_objects, available_for_history)
        
        # 4. 记录监控日志
        history_tokens = sum(m.tokens for m in selected)
        utilization = (fixed_overhead + history_tokens) / self.context_window
        
        logger.info(
            f"上下文构建完成 | 模型={self.config.model} | "
            f"策略={self.config.strategy.value} | "
            f"历史条数={len(selected)}/{len(messages)} | "
            f"Token 使用率={utilization:.1%}"
        )
        
        if utilization > 0.85:
            logger.warning(f"上下文使用率偏高: {utilization:.1%}")
        
        # 5. 组装最终上下文
        context: list[dict] = [{"role": "system", "content": system_prompt}]
        context.extend({"role": m.role, "content": m.content} for m in selected)
        context.append({"role": "user", "content": query})
        
        return context
    
    def _select_messages(
        self, 
        messages: list[Message], 
        max_tokens: int
    ) -> list[Message]:
        """根据策略选择历史消息"""
        strategy = self.config.strategy
        
        if strategy == ContextStrategy.SLIDING_WINDOW:
            return self._sliding_window(messages, max_tokens)
        elif strategy == ContextStrategy.SUMMARIZATION:
            return self._summarization(messages, max_tokens)
        elif strategy == ContextStrategy.IMPORTANCE:
            return self._importance_ranking(messages, max_tokens)
        else:
            # 默认滑动窗口
            return self._sliding_window(messages, max_tokens)
    
    def _sliding_window(
        self, 
        messages: list[Message], 
        max_tokens: int
    ) -> list[Message]:
        """滑动窗口：从最新消息开始，直到达到 Token 上限"""
        selected = []
        used = 0
        
        for msg in reversed(messages):
            if used + msg.tokens > max_tokens:
                break
            selected.insert(0, msg)
            used += msg.tokens
        
        # 边界情况：连最新一条都放不下，放摘要占位
        if not selected and messages:
            last_msg = messages[-1]
            truncated = last_msg.content[:200] + "...[截断]"
            selected = [Message(
                role=last_msg.role,
                content=truncated,
                tokens=self._count(truncated)
            )]
        
        return selected
    
    def _summarization(
        self, 
        messages: list[Message], 
        max_tokens: int
    ) -> list[Message]:
        """摘要压缩：保留最近 N 轮原文 + 对旧消息摘要"""
        if not messages:
            return []
        
        keep = self.config.min_keep_turns * 2
        recent  = messages[-keep:] if len(messages) > keep else messages
        old     = messages[:-keep] if len(messages) > keep else []
        
        recent_tokens = sum(m.tokens for m in recent)
        
        if not old or recent_tokens > max_tokens:
            # 无旧消息或预算已被最近消息占满
            return self._sliding_window(recent, max_tokens)
        
        remaining = max_tokens - recent_tokens
        
        if self.config.summarize_fn and old and remaining > 80:
            conversation = "\n".join(f"{m.role}: {m.content}" for m in old)
            summary_text = self.config.summarize_fn(conversation)
            summary_tokens = self._count(summary_text)
            
            if summary_tokens <= remaining:
                summary_msg = Message(
                    role="system",
                    content=f"[历史摘要]\n{summary_text}",
                    tokens=summary_tokens,
                )
                return [summary_msg] + recent
        
        return recent
    
    def _importance_ranking(
        self,
        messages: list[Message],
        max_tokens: int
    ) -> list[Message]:
        """重要性排序：按评分选择，恢复时间顺序"""
        if not messages:
            return []
        
        total = len(messages)
        scored = [
            (msg, self._score_message(msg, i, total))
            for i, msg in enumerate(messages)
        ]
        scored.sort(key=lambda x: x[1], reverse=True)
        
        selected_ids = set()
        used = 0
        
        for msg, score in scored:
            if score < 0.15:
                continue
            if used + msg.tokens > max_tokens:
                continue
            selected_ids.add(id(msg))
            used += msg.tokens
        
        # 恢复时间顺序
        return [m for m in messages if id(m) in selected_ids]
    
    def _score_message(self, msg: Message, index: int, total: int) -> float:
        """消息重要性评分 [0, 1]"""
        recency = (index + 1) / total
        
        keywords_high = ["需要", "必须", "确认", "预算", "截止", "目标", "不能", "要求"]
        keywords_low  = ["好的", "明白", "谢谢", "嗯", "好", "了解", "没问题"]
        content = msg.content
        
        high = sum(1 for kw in keywords_high if kw in content)
        low  = sum(1 for kw in keywords_low  if kw in content)
        
        content_score = min(0.3 + high * 0.15, 1.0) if high else max(0.3 - low * 0.1, 0.0)
        
        role_weight = {"user": 1.0, "assistant": 0.85, "tool": 0.7, "system": 1.0}.get(msg.role, 0.6)
        
        return (recency * 0.5 + content_score * 0.5) * role_weight
    
    def _count(self, text: str) -> int:
        """计算 Token 数"""
        return count_tokens(text, self.config.model)
```

---

## 六、System Prompt Token 优化技巧

### 6.1 精简技巧对比

| 技巧 | 说明 | Token 节省 |
|------|------|-----------|
| 删除重复说明 | 同一约束只写一次 | 10~30% |
| 用列表代替段落 | 结构化比叙述文字省 Token | 15~25% |
| 删除废话和客套 | "请注意…" "需要强调的是…" | 5~15% |
| 缩短示例 | Few-shot 示例精简或移入工具描述 | 20~50% |
| 模块化按需注入 | 只注入当前场景需要的模块 | 30~60% |

### 6.2 精简前后对比

```python
# ❌ 臃肿的 System Prompt（~800 Token）
BAD_SYSTEM = """
你是 DeepTrip 旅行规划助手，一个专业的旅行规划 AI 助手。
你拥有丰富的旅行知识，可以为用户提供全方位的旅行建议。

你的能力包括：
1. 景点推荐：你可以根据用户的兴趣爱好和目的地，为用户推荐最适合的景点。
   在推荐景点时，你需要考虑用户的偏好、时间限制、预算等因素。
2. 酒店搜索：你可以帮助用户搜索和比较不同的酒店选项...（继续100字）
3. 交通查询：你可以查询各种交通方式...（继续100字）

请注意以下重要事项：
- 你不能预订任何产品，只能提供建议
- 你不能提供实时价格信息，价格数据可能不准确
- 你需要礼貌、专业地回答每一个问题
...（还有300字）
"""

# ✅ 精简的 System Prompt（~120 Token）
GOOD_SYSTEM = """
你是 DeepTrip 旅行规划助手。

能力：景点推荐、酒店搜索、交通查询、行程规划
限制：不预订产品、不提供实时价格

输出：Markdown 格式，中文回复
"""
```

### 6.3 模块化 System Prompt

```python
from typing import Literal

PROMPT_MODULES = {
    "base": """你是 DeepTrip 旅行规划助手。能力：景点推荐、行程规划。不预订产品。""",
    
    "hotel_expert": """
当前对话涉及酒店预订，你额外具备：
- 酒店星级、设施对比分析
- 根据预算推荐性价比方案
""",
    
    "flight_expert": """
当前对话涉及机票查询，你额外具备：
- 中转方案对比
- 价格趋势分析
""",
    
    "output_format": """
输出要求：
- 用 Markdown 表格对比多个选项
- 推荐理由不超过 50 字/条
""",
}


def build_system_prompt(
    modules: list[Literal["base", "hotel_expert", "flight_expert", "output_format"]],
) -> str:
    """按需组合 System Prompt 模块"""
    return "\n".join(PROMPT_MODULES[m] for m in modules if m in PROMPT_MODULES)


# 使用：根据对话意图动态选择模块
def get_system_prompt(intent: str) -> str:
    modules = ["base", "output_format"]
    
    if "酒店" in intent or "住" in intent:
        modules.insert(1, "hotel_expert")
    if "机票" in intent or "飞机" in intent:
        modules.insert(1, "flight_expert")
    
    return build_system_prompt(modules)
```

---

## 七、工具 Token 消耗管理

### 7.1 工具 Token 消耗分析

```
工具定义 Token 消耗示意
──────────────────────────────────────────────────────────
工具名称 (name)           ~3 Token
description               ~50~500 Token ← 最大变量
parameters (JSON Schema)  ~30~200 Token
  └── 每个参数 description ~5~50 Token

10 个工具 × 平均 200 Token = 2000 Token 固定开销/每次调用
──────────────────────────────────────────────────────────
```

### 7.2 动态工具注入

```python
TOOL_REGISTRY = {
    "search_hotel": {
        "name": "search_hotel",
        "description": "搜索酒店。返回：名称、价格、评分、地址。",
        "parameters": {
            "type": "object",
            "properties": {
                "city":       {"type": "string", "description": "城市名，如「上海」"},
                "check_in":   {"type": "string", "description": "入住日期 YYYY-MM-DD"},
                "check_out":  {"type": "string", "description": "退房日期 YYYY-MM-DD"},
                "max_price":  {"type": "number", "description": "每晚最高价（元）"},
            },
            "required": ["city", "check_in", "check_out"],
        },
        "tags": ["hotel", "booking"],
    },
    "search_flight": {
        "name": "search_flight",
        "description": "搜索机票。返回：航班号、出发/到达时间、价格、剩余座位。",
        "parameters": {
            "type": "object",
            "properties": {
                "from_city":  {"type": "string", "description": "出发城市"},
                "to_city":    {"type": "string", "description": "目的城市"},
                "date":       {"type": "string", "description": "出发日期 YYYY-MM-DD"},
            },
            "required": ["from_city", "to_city", "date"],
        },
        "tags": ["flight"],
    },
    "get_weather": {
        "name": "get_weather",
        "description": "查询天气预报（未来7天）。",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {"type": "string", "description": "城市名"},
                "date": {"type": "string", "description": "日期 YYYY-MM-DD（可选）"},
            },
            "required": ["city"],
        },
        "tags": ["weather", "general"],
    },
}


def get_tools_for_intent(user_message: str) -> list[dict]:
    """根据用户意图动态选择工具，减少不必要的工具 Token 消耗"""
    needed_tags = set()
    
    # 简单规则匹配（生产环境可用意图分类模型）
    if any(kw in user_message for kw in ["酒店", "住", "民宿", "客栈"]):
        needed_tags.add("hotel")
    if any(kw in user_message for kw in ["机票", "飞机", "航班", "飞"]):
        needed_tags.add("flight")
    if any(kw in user_message for kw in ["天气", "气温", "下雨", "穿什么"]):
        needed_tags.add("weather")
    
    # 总是包含通用工具
    needed_tags.add("general")
    
    selected = []
    for tool_def in TOOL_REGISTRY.values():
        tool_tags = set(tool_def.get("tags", []))
        if tool_tags & needed_tags:
            # 去掉 tags 字段再传给 API
            selected.append({k: v for k, v in tool_def.items() if k != "tags"})
    
    return selected
```

### 7.3 工具描述精简策略

```python
def compress_tool_description(tool: dict, aggressive: bool = False) -> dict:
    """
    压缩工具描述的 Token 消耗
    aggressive=True 时去掉参数级别的 description
    """
    compressed = dict(tool)
    
    # 精简主 description
    desc = compressed.get("description", "")
    if len(desc) > 100:
        # 截断到第一个句号
        first_sentence = desc.split("。")[0] + "。"
        compressed["description"] = first_sentence
    
    if aggressive and "parameters" in compressed:
        params = compressed["parameters"].copy()
        if "properties" in params:
            props = {}
            for name, prop in params["properties"].items():
                # 只保留 type，去掉 description
                props[name] = {"type": prop.get("type", "string")}
            params["properties"] = props
        compressed["parameters"] = params
    
    return compressed
```

---

## 八、多轮对话的上下文构建策略

### 8.1 会话状态管理

```python
from uuid import uuid4
from datetime import datetime

@dataclass
class Session:
    session_id: str = field(default_factory=lambda: str(uuid4()))
    messages: list[Message] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)
    metadata: dict = field(default_factory=dict)
    
    def add_message(self, role: str, content: str):
        tokens = count_tokens(content)
        self.messages.append(Message(role=role, content=content, tokens=tokens))
    
    def total_tokens(self) -> int:
        return sum(m.tokens for m in self.messages)


class ConversationManager:
    """多轮对话管理器"""
    
    def __init__(
        self,
        context_manager: ContextManager,
        system_prompt_fn: Callable[[str], str],  # 动态生成 System Prompt
        tools_fn: Callable[[str], list[dict]],   # 动态选择工具
    ):
        self.ctx_mgr = context_manager
        self.system_prompt_fn = system_prompt_fn
        self.tools_fn = tools_fn
        self.sessions: dict[str, Session] = {}
    
    def get_or_create_session(self, session_id: str) -> Session:
        if session_id not in self.sessions:
            self.sessions[session_id] = Session(session_id=session_id)
        return self.sessions[session_id]
    
    async def chat(
        self,
        session_id: str,
        user_message: str,
        llm_client,
    ) -> str:
        session = self.get_or_create_session(session_id)
        
        # 动态构建 System Prompt 和工具列表
        system_prompt = self.system_prompt_fn(user_message)
        tools = self.tools_fn(user_message)
        
        # 构建上下文（自动 Token 管理）
        context = self.ctx_mgr.build_context(
            system_prompt=system_prompt,
            messages=[{"role": m.role, "content": m.content} for m in session.messages],
            tools=tools,
            query=user_message,
        )
        
        # 调用 LLM
        response = await llm_client.invoke(context, tools=tools)
        assistant_content = response.content
        
        # 持久化到会话历史
        session.add_message("user", user_message)
        session.add_message("assistant", assistant_content)
        
        return assistant_content
```

### 8.2 Tool Call 上下文管理

Agent 在使用工具时，`tool_call` 和 `tool_result` 也会消耗上下文空间，需要特别处理。

```python
def build_tool_call_context(
    tool_calls: list[dict],
    tool_results: list[dict],
    max_result_tokens: int = 500,
) -> list[dict]:
    """
    构建工具调用的上下文片段
    对过长的 tool_result 进行截断或摘要
    """
    context_pieces = []
    
    for tc, tr in zip(tool_calls, tool_results):
        # tool_call 消息（模型发出）
        context_pieces.append({
            "role": "assistant",
            "content": None,
            "tool_calls": [tc],
        })
        
        # tool_result 消息（工具返回）
        result_content = tr.get("content", "")
        result_tokens = count_tokens(str(result_content))
        
        if result_tokens > max_result_tokens:
            # 截断过长的工具结果
            if isinstance(result_content, str):
                truncated = result_content[:max_result_tokens * 3] + "\n...[结果过长，已截断]"
            elif isinstance(result_content, list):
                # 只保留前几条
                truncated = json.dumps(result_content[:5], ensure_ascii=False) + "\n...[共更多条，已截断]"
            else:
                truncated = str(result_content)[:max_result_tokens * 3] + "...[截断]"
            result_content = truncated
        
        context_pieces.append({
            "role": "tool",
            "tool_call_id": tc["id"],
            "content": str(result_content),
        })
    
    return context_pieces
```

---

## 九、Prompt Caching

Prompt Caching 可以显著降低重复 Token 的计费，适合 System Prompt 和工具定义等固定内容。

### 9.1 Claude 的 cache_control

Claude 支持在消息中标记 `cache_control`，被缓存的 Token 后续调用按更低价格计费（通常为 10% 左右）。

```python
import anthropic

client = anthropic.Anthropic()

# cache_control 标记在内容块的最后一个固定部分
system_with_cache = [
    {
        "type": "text",
        "text": "你是旅行规划助手，擅长行程规划和景点推荐。",
        "cache_control": {"type": "ephemeral"},  # 标记这段内容可缓存
    }
]

tools_with_cache = [
    {
        "name": "search_hotel",
        "description": "搜索酒店",
        "input_schema": {
            "type": "object",
            "properties": {
                "city": {"type": "string"},
            },
            "required": ["city"],
        },
        # 在最后一个工具上加 cache_control
        "cache_control": {"type": "ephemeral"},
    }
]

response = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    system=system_with_cache,
    tools=tools_with_cache,
    messages=[
        {"role": "user", "content": "帮我搜索上海的酒店"}
    ],
)

# 查看缓存命中情况
usage = response.usage
print(f"输入 Token:  {usage.input_tokens}")
print(f"缓存创建:   {usage.cache_creation_input_tokens}")   # 首次缓存
print(f"缓存命中:   {usage.cache_read_input_tokens}")       # 后续命中
```

### 9.2 Claude Prompt Cache 最佳实践

```python
class ClaudeContextBuilder:
    """针对 Claude 优化 Prompt Caching 的上下文构建器"""
    
    def __init__(self, model: str = "claude-sonnet-4-5"):
        self.model = model
        self.client = anthropic.Anthropic()
    
    def build_with_cache(
        self,
        static_system: str,       # 固定部分：角色定义
        dynamic_system: str,      # 动态部分：当前场景
        tools: list[dict],
        messages: list[dict],
        query: str,
    ) -> dict:
        """
        构建带缓存标记的请求
        缓存策略：
          - static_system + tools 设为可缓存（高频复用）
          - dynamic_system 不缓存（按场景变化）
          - 历史消息不缓存（每轮都变）
        """
        system = [
            {
                "type": "text",
                "text": static_system,
                "cache_control": {"type": "ephemeral"},  # 缓存固定 System
            },
            {
                "type": "text",
                "text": dynamic_system,
                # 不设置 cache_control，不缓存动态内容
            },
        ]
        
        # 给最后一个工具加缓存标记（Claude 缓存是前缀缓存）
        cached_tools = list(tools)
        if cached_tools:
            last = dict(cached_tools[-1])
            last["cache_control"] = {"type": "ephemeral"}
            cached_tools[-1] = last
        
        full_messages = list(messages) + [{"role": "user", "content": query}]
        
        return {
            "model": self.model,
            "system": system,
            "tools": cached_tools,
            "messages": full_messages,
        }
```

### 9.3 OpenAI 的 Prompt Cache

OpenAI 的 Prompt Cache（GPT-4o 和 GPT-4o-mini 支持）是自动生效的，无需额外标记，但需要注意构建规则。

```python
# OpenAI Prompt Cache 规则：
# 1. 缓存以 1024 Token 为粒度
# 2. 请求的前缀相同才能命中缓存
# 3. System Prompt 和工具定义放在前面，历史消息放在后面

def build_openai_cache_friendly_context(
    system_prompt: str,
    tools: list[dict],
    messages: list[dict],
    query: str,
) -> dict:
    """
    构建对 OpenAI Prompt Cache 友好的请求
    原则：固定内容在前，变化内容在后
    """
    # messages 的顺序：system 在前，user/assistant 历史在中，最新 user 在最后
    context_messages = [
        {"role": "system", "content": system_prompt},  # 固定，利于缓存
        *messages,                                      # 历史（每次可能变化）
        {"role": "user", "content": query},             # 最新输入
    ]
    
    return {
        "model": "gpt-4o",
        "messages": context_messages,
        "tools": tools,  # 工具定义固定，利于缓存
    }

# 查看缓存命中
def check_cache_stats(response) -> None:
    usage = response.usage
    if hasattr(usage, "prompt_tokens_details"):
        cached = usage.prompt_tokens_details.cached_tokens
        total = usage.prompt_tokens
        print(f"缓存命中率: {cached}/{total} = {cached/total:.1%}")
```

---

## 十、监控与告警

### 10.1 上下文使用率监控

```python
import time
from dataclasses import dataclass, field
from collections import deque
from threading import Lock

@dataclass
class ContextMetrics:
    session_id: str
    model: str
    total_tokens: int
    context_window: int
    strategy: str
    history_count_before: int
    history_count_after: int
    timestamp: float = field(default_factory=time.time)
    
    @property
    def utilization(self) -> float:
        return self.total_tokens / self.context_window
    
    @property
    def compression_ratio(self) -> float:
        if self.history_count_before == 0:
            return 1.0
        return self.history_count_after / self.history_count_before


class ContextMonitor:
    """上下文使用率监控"""
    
    # 阈值配置
    WARN_THRESHOLD  = 0.75   # 75% 触发警告
    ALERT_THRESHOLD = 0.90   # 90% 触发告警
    
    def __init__(self, window_size: int = 100):
        self._metrics: deque[ContextMetrics] = deque(maxlen=window_size)
        self._lock = Lock()
    
    def record(self, metrics: ContextMetrics) -> None:
        """记录一次上下文构建的指标"""
        with self._lock:
            self._metrics.append(metrics)
        
        self._check_thresholds(metrics)
    
    def _check_thresholds(self, metrics: ContextMetrics) -> None:
        u = metrics.utilization
        
        if u >= self.ALERT_THRESHOLD:
            logger.error(
                f"[ALERT] 上下文使用率危险! "
                f"session={metrics.session_id} "
                f"utilization={u:.1%} "
                f"tokens={metrics.total_tokens}/{metrics.context_window}"
            )
            # 生产环境：触发告警（钉钉/Slack/PagerDuty 等）
        elif u >= self.WARN_THRESHOLD:
            logger.warning(
                f"[WARN] 上下文使用率偏高 "
                f"session={metrics.session_id} "
                f"utilization={u:.1%}"
            )
    
    def stats(self) -> dict:
        """统计最近 N 次的使用率分布"""
        with self._lock:
            if not self._metrics:
                return {}
            
            utilizations = [m.utilization for m in self._metrics]
            return {
                "count":   len(utilizations),
                "mean":    sum(utilizations) / len(utilizations),
                "max":     max(utilizations),
                "min":     min(utilizations),
                "p90":     sorted(utilizations)[int(len(utilizations) * 0.9)],
                "over_75": sum(1 for u in utilizations if u >= 0.75),
                "over_90": sum(1 for u in utilizations if u >= 0.90),
            }
```

### 10.2 达到阈值时的降级策略

```python
from enum import Enum, auto

class DegradationLevel(Enum):
    NORMAL   = auto()   # < 75%：正常
    COMPRESS = auto()   # 75%~90%：切换到更激进的压缩策略
    EMERGENCY= auto()   # > 90%：紧急截断


def get_degradation_level(utilization: float) -> DegradationLevel:
    if utilization < 0.75:
        return DegradationLevel.NORMAL
    elif utilization < 0.90:
        return DegradationLevel.COMPRESS
    else:
        return DegradationLevel.EMERGENCY


class AdaptiveContextManager(ContextManager):
    """自适应上下文管理器（带降级策略）"""
    
    def build_context(self, system_prompt, messages, tools, query) -> list[dict]:
        context = super().build_context(system_prompt, messages, tools, query)
        
        # 计算当前使用率
        total = sum(count_tokens(m.get("content") or "", self.config.model) for m in context)
        utilization = total / self.context_window
        level = get_degradation_level(utilization)
        
        if level == DegradationLevel.COMPRESS:
            logger.warning(f"触发压缩降级 utilization={utilization:.1%}")
            # 切换为更激进的摘要压缩策略重新构建
            old_strategy = self.config.strategy
            self.config.strategy = ContextStrategy.SUMMARIZATION
            context = super().build_context(system_prompt, messages, tools, query)
            self.config.strategy = old_strategy
        
        elif level == DegradationLevel.EMERGENCY:
            logger.error(f"触发紧急截断降级 utilization={utilization:.1%}")
            # 只保留 system + 最新 user，丢弃所有历史
            context = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": query},
            ]
        
        return context
```

---

## 十一、常见踩坑

### 坑 1：超出上下文限制导致 API 报错

```python
# ❌ 错误：不检查 Token 数量，直接追加历史消息
def chat_bad(session: Session, query: str):
    messages = [{"role": m.role, "content": m.content} for m in session.messages]
    messages.append({"role": "user", "content": query})
    
    # 当 session 积累几十轮后，超出 128K，API 直接报错
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=messages,
    )
    return response.choices[0].message.content


# ✅ 正确：调用前检查 Token 数，超限则压缩
def chat_good(ctx_mgr: ContextManager, session: Session, query: str):
    messages = [{"role": m.role, "content": m.content} for m in session.messages]
    
    # ContextManager 自动管理 Token 预算
    context = ctx_mgr.build_context(
        system_prompt=SYSTEM_PROMPT,
        messages=messages,
        tools=TOOLS,
        query=query,
    )
    
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=context,
    )
    return response.choices[0].message.content
```

### 坑 2：忘记给输出预留 Token

```python
# ❌ 错误：没有预留输出 Token，模型回复被截断
def count_available_tokens_bad(context_window: int, used_tokens: int) -> int:
    return context_window - used_tokens  # 没有预留输出空间！


# ✅ 正确：预留足够的输出空间
def count_available_tokens_good(
    context_window: int,
    used_tokens: int,
    output_reserve: int = 4096,
    safety_margin: int = 500,
) -> int:
    return context_window - used_tokens - output_reserve - safety_margin

# 同时，API 调用时要对齐 max_tokens 参数
response = client.chat.completions.create(
    model="gpt-4o",
    messages=context,
    max_tokens=4096,  # 与 output_reserve 对齐，否则可能浪费预留的空间
)
```

### 坑 3：仅统计 content 字段，忽略 tool_call / tool_result

```python
# ❌ 错误：只统计 content，漏掉工具调用的 Token
def count_tokens_bad(messages: list[dict]) -> int:
    return sum(
        count_tokens(m.get("content", ""))  # tool_call 消息 content 为 None！
        for m in messages
    )


# ✅ 正确：完整处理所有字段
def count_tokens_good(messages: list[dict], model: str = "gpt-4o") -> int:
    total = 0
    for m in messages:
        content = m.get("content")
        if content is None:
            # tool_calls 消息：content 为 None，信息在 tool_calls 字段
            tool_calls = m.get("tool_calls", [])
            content = json.dumps(tool_calls, ensure_ascii=False)
        elif not isinstance(content, str):
            # content 可能是 list（多模态或 content blocks）
            content = json.dumps(content, ensure_ascii=False)
        
        total += count_tokens(content, model)
    return total
```

### 坑 4：消息顺序混乱导致模型行为异常

```python
# ❌ 错误：重要性排序后未恢复时间顺序，乱序给模型
def select_messages_bad(messages: list[Message], max_tokens: int) -> list[Message]:
    scored = sorted(messages, key=lambda m: score(m), reverse=True)
    selected = []
    used = 0
    for msg in scored:
        if used + msg.tokens > max_tokens:
            break
        selected.append(msg)
        used += msg.tokens
    return selected  # ❌ 返回的是按分数排序的，顺序混乱！


# ✅ 正确：选出后恢复时间顺序
def select_messages_good(messages: list[Message], max_tokens: int) -> list[Message]:
    scored = sorted(messages, key=lambda m: score(m), reverse=True)
    selected_ids = set()
    used = 0
    
    for msg in scored:
        if used + msg.tokens <= max_tokens:
            selected_ids.add(id(msg))
            used += msg.tokens
    
    # 按原始时间顺序返回
    return [m for m in messages if id(m) in selected_ids]
```

### 坑 5：System Prompt 中包含冗余换行和空格

```python
# ❌ 错误：大量空行和首行缩进浪费 Token
system_prompt_bad = """


    你是旅行助手。


    你的能力是：
        - 景点推荐
        - 酒店搜索


    限制：不预订产品。


"""
# 上面约 50 Token，等效内容只需 15 Token

# ✅ 正确：紧凑格式
system_prompt_good = (
    "你是旅行助手。\n"
    "能力：景点推荐、酒店搜索\n"
    "限制：不预订产品。"
)
# 约 18 Token，节省约 64%


def clean_system_prompt(prompt: str) -> str:
    """清理 System Prompt 中的冗余空白"""
    import re
    # 多个连续空行压缩为一个
    prompt = re.sub(r'\n{3,}', '\n\n', prompt)
    # 去掉行首多余缩进（用于模板字符串）
    prompt = "\n".join(line.strip() for line in prompt.splitlines())
    # 去掉首尾空白
    return prompt.strip()
```

### 坑 6：摘要调用使用高成本模型

```python
# ❌ 错误：摘要任务用 GPT-4o，成本浪费
async def summarize_bad(conversation: str) -> str:
    response = await openai_client.chat.completions.create(
        model="gpt-4o",          # 摘要用旗舰模型，大材小用
        messages=[{"role": "user", "content": f"摘要：{conversation}"}],
        max_tokens=400,
    )
    return response.choices[0].message.content


# ✅ 正确：摘要任务用小模型，节省约 10~20 倍成本
async def summarize_good(conversation: str) -> str:
    response = await openai_client.chat.completions.create(
        model="gpt-4o-mini",     # 摘要用小模型
        messages=[{
            "role": "user",
            "content": (
                "将以下对话压缩成200字以内的摘要，"
                "保留：用户目标、关键约束、已确认信息。\n\n"
                + conversation
            )
        }],
        max_tokens=300,
    )
    return response.choices[0].message.content
```

### 坑 7：不区分会话隔离，全局共享消息历史

```python
# ❌ 错误：全局列表存储所有会话消息，不同用户混用
global_messages: list[dict] = []   # 危险！所有用户共享

def add_message_bad(role: str, content: str):
    global_messages.append({"role": role, "content": content})

def get_context_bad() -> list[dict]:
    return global_messages  # 不同会话的消息全部混在一起


# ✅ 正确：按 session_id 隔离
sessions: dict[str, list[dict]] = {}

def add_message_good(session_id: str, role: str, content: str):
    if session_id not in sessions:
        sessions[session_id] = []
    sessions[session_id].append({"role": role, "content": content})

def get_context_good(session_id: str) -> list[dict]:
    return sessions.get(session_id, [])
```

---

## 十二、速查表

### Token 预算速查

| 模型 | 上下文窗口 | 建议输出预留 | 建议安全余量 | 推荐压缩阈值 |
|------|-----------|------------|------------|------------|
| GPT-4o | 128K | 4096 | 500 | 100K |
| GPT-4o-mini | 128K | 4096 | 500 | 100K |
| Claude Sonnet 4 | 200K | 8192 | 1000 | 160K |
| Claude Opus 4 | 200K | 8192 | 1000 | 160K |
| Claude Haiku 3.5 | 200K | 2048 | 500 | 160K |
| Gemini 1.5 Pro | 2M | 8192 | 2000 | 1.8M |

### 策略选型速查

| 场景 | 推荐策略 | 原因 |
|------|---------|------|
| 客服对话（< 20 轮） | 滑动窗口 | 简单稳定，早期信息影响不大 |
| 长任务规划（> 20 轮） | 摘要压缩 | 保留关键信息，大幅节省 Token |
| 复杂 Agent 任务 | 重要性排序 | 保留关键决策节点 |
| 知识密集问答 | 检索增强 | 精准注入相关历史 |
| 混合场景 | 重要性 + 滑动窗口 | 先排序，再从后往前截取 |

### tiktoken 编码器速查

| 模型系列 | 编码器名称 |
|---------|----------|
| GPT-4o、GPT-4、GPT-3.5-turbo | cl100k_base |
| GPT-4.1、o3、o4 | o200k_base |
| text-embedding-3-* | cl100k_base |
| Claude（估算用） | cl100k_base × 0.9 |

### 常用 Token 消耗经验值

| 内容类型 | 估算 |
|---------|------|
| 1 个汉字 | 约 1~2 Token |
| 1 个英文单词 | 约 1~2 Token |
| 1 个 JSON 字段（`"key": "value"`） | 约 6~10 Token |
| 典型 System Prompt | 100~500 Token |
| 一个工具定义 | 80~300 Token |
| 一轮对话（user + assistant） | 100~500 Token |
| 一条工具调用结果 | 50~2000 Token（取决于返回数据量） |

### Prompt Cache 适用条件速查

| 条件 | Claude | OpenAI |
|------|--------|--------|
| 触发方式 | 手动标记 `cache_control` | 自动（无需标记） |
| 最小缓存粒度 | 1024 Token | 1024 Token |
| 缓存有效期 | 5 分钟（ephemeral） | 通常几分钟到 1 小时 |
| 缓存计费 | 约输入价格的 10% | 约输入价格的 50% |
| 最适合缓存 | System Prompt + 工具定义 | System Prompt + 工具定义 |
| 不适合缓存 | 每次变化的历史消息 | 每次变化的历史消息 |
