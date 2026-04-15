# Langfuse 最佳实践与踩坑指南

## 文档信息

- 作者：徐凯旋
- 邮箱：azouever@gmail.com
- 更新时间：2026-04-14
- 标签：Langfuse, LLM Observability, 追踪, 评估, Prompt 管理, 数据集

---

## 目录

1. [概述](#一概述)
2. [核心概念](#二核心概念)
3. [安装与环境配置](#三安装与环境配置)
4. [基础集成](#四基础集成)
5. [装饰器用法（@observe）](#五装饰器用法observe)
6. [Trace 设计最佳实践](#六trace-设计最佳实践)
7. [Session 多轮对话追踪](#七session-多轮对话追踪)
8. [成本追踪](#八成本追踪)
9. [评分与评测](#九评分与评测)
10. [Prompt 管理](#十prompt-管理)
11. [数据集与批量评测](#十一数据集与批量评测)
12. [生产环境注意事项](#十二生产环境注意事项)
13. [常见踩坑与解决方案](#十三常见踩坑与解决方案)
14. [速查表](#十四速查表)

---

## 一、概述

### 1.1 Langfuse 是什么

Langfuse 是一个开源的 LLM 可观测性（Observability）平台，专为大语言模型应用设计。它提供完整的追踪、评估、Prompt 管理和数据集能力，帮助团队在开发和生产环境中监控 LLM 应用的质量、性能与成本。

**核心定位**：LLM 应用的"黑盒变白盒"工具。

**核心能力概览**：

| 能力 | 说明 |
|------|------|
| **追踪（Tracing）** | 记录每次 LLM 调用、工具调用、检索过程的完整链路 |
| **评估（Evaluation）** | 人工评分 + LLM-as-Judge 自动评分，量化回答质量 |
| **Prompt 管理** | 版本化管理 Prompt，支持 A/B 测试，与代码解耦 |
| **数据集（Datasets）** | 构建评测数据集，支持批量回归测试 |
| **成本追踪** | 按 Token 统计每次调用的费用，支持按用户/会话聚合 |
| **Dashboard** | 可视化展示 Trace、成本、延迟、评分趋势 |

### 1.2 与竞品对比

```
+------------------------------------------------------------------+
|               LLM Observability 工具对比                          |
+------------------------------------------------------------------+
|                                                                   |
|  维度              Langfuse        LangSmith       Helicone      |
|  ---------------------------------------------------------------- |
|  开源              ✓ 完全开源      ✗ 闭源          ✗ 闭源        |
|  Self-hosted       ✓ 支持          ✗ 不支持        ✗ 不支持      |
|  LangChain 集成    深度集成        官方出品        基础支持      |
|  Prompt 管理       ✓ 内置          ✓ 内置          ✗ 无          |
|  数据集            ✓ 内置          ✓ 内置          ✗ 无          |
|  LLM-as-Judge      ✓ 支持          ✓ 支持          ✗ 无          |
|  免费额度          慷慨            受限            受限          |
|  定价              开源免费        按量付费        按量付费      |
|  数据主权          ✓ 自托管可控    ✗ 数据在LangChain✗ 数据在云端  |
|                                                                   |
|  适用场景：                                                       |
|  - 数据隐私要求高 → Langfuse Self-hosted                         |
|  - LangSmith 生态 → LangSmith                                    |
|  - 快速上手无需运维 → Langfuse Cloud                             |
|                                                                   |
+------------------------------------------------------------------+
```

### 1.3 使用场景

| 场景 | 说明 |
|------|------|
| **开发调试** | 查看每次 LLM 调用的完整输入/输出，快速定位问题 |
| **质量监控** | 生产环境实时监控回答质量，发现回归 |
| **成本管控** | 追踪 Token 消耗和费用，优化高成本链路 |
| **Prompt 迭代** | 版本化管理 Prompt，对比不同版本效果 |
| **数据积累** | 将优质对话沉淀为评测数据集，持续迭代 |

---

## 二、核心概念

### 2.1 关键术语

| 术语 | 英文 | 说明 |
|------|------|------|
| **追踪** | Trace | 一次完整请求的顶层容器，对应一次用户交互 |
| **生成** | Generation | LLM 的一次推理调用，记录输入/输出/Token/成本 |
| **跨度** | Span | 任意自定义步骤（工具调用、检索、业务逻辑） |
| **评分** | Score | 对 Trace/Generation 的质量评分（人工或自动） |
| **会话** | Session | 关联多个 Trace 的多轮对话上下文 |
| **数据集** | Dataset | 用于批量评测的输入/期望输出集合 |
| **事件** | Event | 轻量级日志节点，不记录时长，用于标记关键事件 |
| **Prompt** | Prompt | Langfuse 中托管的提示词模板（支持版本化） |

### 2.2 核心对象关系图

```
+------------------------------------------------------------------+
|                    Langfuse 核心对象关系                          |
+------------------------------------------------------------------+
|                                                                   |
|  Session（会话，可跨多个 Trace）                                  |
|  ┌────────────────────────────────────────────────────┐          |
|  │  session_id: "chat_session_abc"                    │          |
|  │                                                    │          |
|  │  Trace（一次完整请求）                              │          |
|  │  ┌──────────────────────────────────────────────┐  │          |
|  │  │  trace_id: "trace_001"                       │  │          |
|  │  │  name: "agent_query"                         │  │          |
|  │  │  user_id: "user_123"                         │  │          |
|  │  │                                              │  │          |
|  │  │  ├── Span（工具调用 / 检索步骤）              │  │          |
|  │  │  │   ┌────────────────────────────────────┐ │  │          |
|  │  │  │   │ name: "search_hotel"               │ │  │          |
|  │  │  │   │ input: {city: "北京"}               │ │  │          |
|  │  │  │   │ output: {hotels: [...]}             │ │  │          |
|  │  │  │   └────────────────────────────────────┘ │  │          |
|  │  │  │                                          │  │          |
|  │  │  ├── Generation（LLM 推理调用）              │  │          |
|  │  │  │   ┌────────────────────────────────────┐ │  │          |
|  │  │  │   │ name: "llm_response"               │ │  │          |
|  │  │  │   │ model: "gpt-4o"                    │ │  │          |
|  │  │  │   │ input_tokens: 512                  │ │  │          |
|  │  │  │   │ output_tokens: 128                 │ │  │          |
|  │  │  │   │ cost: $0.002                       │ │  │          |
|  │  │  │   └────────────────────────────────────┘ │  │          |
|  │  │  │                                          │  │          |
|  │  │  └── Event（关键节点标记）                   │  │          |
|  │  │      ┌────────────────────────────────────┐ │  │          |
|  │  │      │ name: "cache_hit"                  │ │  │          |
|  │  │      │ metadata: {key: "hotel_bj"}        │ │  │          |
|  │  │      └────────────────────────────────────┘ │  │          |
|  │  │                                              │  │          |
|  │  │  Score（质量评分）                           │  │          |
|  │  │  ┌────────────────────────────────────────┐ │  │          |
|  │  │  │ name: "user_feedback"  value: 5        │ │  │          |
|  │  │  │ name: "faithfulness"   value: 0.9      │ │  │          |
|  │  │  └────────────────────────────────────────┘ │  │          |
|  │  └──────────────────────────────────────────────┘  │          |
|  │                                                    │          |
|  │  Trace（下一轮对话）                               │          |
|  │  ┌──────────────────────────────────────────────┐  │          |
|  │  │  trace_id: "trace_002"  (同一 session)       │  │          |
|  │  └──────────────────────────────────────────────┘  │          |
|  └────────────────────────────────────────────────────┘          |
|                                                                   |
+------------------------------------------------------------------+
```

### 2.3 数据流向

```
+------------------------------------------------------------------+
|                    Langfuse 数据流向                              |
+------------------------------------------------------------------+
|                                                                   |
|  应用代码                                                         |
|  ┌─────────────┐                                                  |
|  │  LLM 调用   │                                                  |
|  │  工具调用   │ ──→ Langfuse SDK ──→ 本地缓冲队列               |
|  │  检索过程   │          │                    │                  |
|  └─────────────┘          │              后台异步上报             |
|                           │                    │                  |
|                           │                    ↓                  |
|                           │         Langfuse Server               |
|                           │         ┌──────────────────┐          |
|                           └────────▶│  REST API        │          |
|                                     │  /api/public/...  │          |
|                                     └──────────────────┘          |
|                                              │                     |
|                                              ↓                     |
|                                     ┌──────────────────┐          |
|                                     │  PostgreSQL      │          |
|                                     │  (持久化存储)     │          |
|                                     └──────────────────┘          |
|                                              │                     |
|                                              ↓                     |
|                                     ┌──────────────────┐          |
|                                     │  Web Dashboard   │          |
|                                     │  (可视化分析)     │          |
|                                     └──────────────────┘          |
|                                                                   |
+------------------------------------------------------------------+
```

---

## 三、安装与环境配置

### 3.1 安装依赖

```python
# 安装 Langfuse SDK
pip install langfuse

# 与 LangChain 集成（需要额外安装）
pip install langfuse langchain langchain-openai

# 完整安装（含所有集成）
pip install langfuse[all]
```

### 3.2 Cloud 版本配置

Langfuse Cloud（https://cloud.langfuse.com）是官方托管版本，开箱即用。

```python
import os

# 方式一：环境变量配置（推荐，避免硬编码密钥）
os.environ["LANGFUSE_PUBLIC_KEY"] = "pk-lf-xxxxxxxx"
os.environ["LANGFUSE_SECRET_KEY"] = "sk-lf-xxxxxxxx"
os.environ["LANGFUSE_HOST"] = "https://cloud.langfuse.com"  # 默认值，可省略

# 方式二：.env 文件（配合 python-dotenv）
# .env 文件内容：
# LANGFUSE_PUBLIC_KEY=pk-lf-xxxxxxxx
# LANGFUSE_SECRET_KEY=sk-lf-xxxxxxxx
# LANGFUSE_HOST=https://cloud.langfuse.com

from dotenv import load_dotenv
load_dotenv()

from langfuse import Langfuse
langfuse = Langfuse()  # 自动读取环境变量

# 验证连接
langfuse.auth_check()  # 如果配置正确，返回 True
```

### 3.3 Self-hosted 版本配置

Self-hosted 方案适合对数据隐私有严格要求的场景（如金融、医疗、政务）。

```yaml
# docker-compose.yml（精简版，生产环境参考官方完整版）
version: "3"
services:
  langfuse:
    image: langfuse/langfuse:latest
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://postgres:password@db:5432/langfuse
      NEXTAUTH_SECRET: your-secret-key
      NEXTAUTH_URL: http://localhost:3000
      SALT: your-salt-string
    depends_on:
      - db

  db:
    image: postgres:15
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
      POSTGRES_DB: langfuse
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

```python
# Self-hosted 连接配置
from langfuse import Langfuse

langfuse = Langfuse(
    public_key="pk-lf-xxxxxxxx",
    secret_key="sk-lf-xxxxxxxx",
    host="http://your-langfuse-server:3000"  # 指向自部署地址
)
```

### 3.4 配置优先级

```
+------------------------------------------------------------------+
|                 Langfuse 配置优先级（从高到低）                   |
+------------------------------------------------------------------+
|                                                                   |
|  1. 代码中显式传参（最高优先级）                                  |
|     Langfuse(public_key="pk-xxx", secret_key="sk-xxx")           |
|                                                                   |
|  2. 环境变量                                                      |
|     LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_HOST       |
|                                                                   |
|  3. .env 文件（通过 python-dotenv 加载）                          |
|                                                                   |
|  4. SDK 默认值（host 默认 https://cloud.langfuse.com）            |
|                                                                   |
+------------------------------------------------------------------+
```

---

## 四、基础集成

### 4.1 LangChain Callback 集成

LangChain Callback 是最简单的集成方式，只需传入 `CallbackHandler`，无需修改业务逻辑。

```python
from langfuse.callback import CallbackHandler
from langchain_openai import ChatOpenAI
from langchain.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

# 初始化 CallbackHandler
langfuse_handler = CallbackHandler(
    public_key="pk-lf-xxxxxxxx",
    secret_key="sk-lf-xxxxxxxx",
    host="https://cloud.langfuse.com"
)

# 构建 LangChain 链
llm = ChatOpenAI(model="gpt-4o", temperature=0.7)
prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个旅游助手，专门帮用户规划行程。"),
    ("user", "{query}")
])
parser = StrOutputParser()

chain = prompt | llm | parser

# 传入 callback，自动追踪所有步骤
result = chain.invoke(
    {"query": "帮我规划一个北京三日游行程"},
    config={
        "callbacks": [langfuse_handler],
        # 也可以附加 metadata，在 UI 中便于过滤
        "metadata": {"user_id": "user_123", "channel": "wechat"}
    }
)
```

**CallbackHandler 自动追踪的内容**：
- 每个 Chain 的 invoke 调用（记录为 Span）
- 每次 LLM 调用（记录为 Generation，含 Token 数量）
- Prompt 模板渲染结果
- 每个工具（Tool）的输入输出

### 4.2 手动 SDK 追踪

当需要精细控制追踪粒度，或在非 LangChain 场景使用时，采用手动 SDK 方式。

```python
from langfuse import Langfuse
import time

langfuse = Langfuse()

def process_travel_query(user_id: str, session_id: str, query: str) -> str:
    """处理旅行查询，手动追踪完整链路"""

    # 1. 创建顶层 Trace
    trace = langfuse.trace(
        name="travel_agent_query",
        user_id=user_id,
        session_id=session_id,
        input={"query": query},
        metadata={
            "channel": "wechat",
            "app_version": "2.1.0",
            "env": "production"
        },
        tags=["travel", "agent", "production"]
    )

    try:
        # 2. 记录检索步骤（Span）
        retrieval_span = trace.span(
            name="knowledge_retrieval",
            input={"query": query, "top_k": 5}
        )
        retrieved_docs = search_knowledge_base(query)
        retrieval_span.end(
            output={"doc_count": len(retrieved_docs), "docs": retrieved_docs}
        )

        # 3. 记录 LLM 调用（Generation）
        generation = trace.generation(
            name="llm_response",
            model="gpt-4o",
            model_parameters={"temperature": 0.7, "max_tokens": 1024},
            input={
                "messages": [
                    {"role": "system", "content": "你是旅游助手"},
                    {"role": "user", "content": query}
                ]
            }
        )

        start_time = time.time()
        response = call_llm(query, retrieved_docs)
        latency_ms = int((time.time() - start_time) * 1000)

        generation.end(
            output={"content": response.content},
            usage={
                "input": response.usage.prompt_tokens,
                "output": response.usage.completion_tokens,
                "total": response.usage.total_tokens,
                "unit": "TOKENS"
            },
            metadata={"latency_ms": latency_ms}
        )

        # 4. 更新 Trace 输出
        trace.update(output={"response": response.content})

        return response.content

    except Exception as e:
        # 5. 记录异常信息
        trace.update(
            output={"error": str(e)},
            metadata={"error_type": type(e).__name__},
            level="ERROR"
        )
        raise
    finally:
        # 6. 确保数据上传
        langfuse.flush()
```

### 4.3 Event 轻量标记

Event 是比 Span 更轻量的节点，用于标记关键事件（如缓存命中、决策点）。

```python
# 在 Trace 中添加 Event
trace = langfuse.trace(name="agent_loop")

# 标记缓存命中事件
trace.event(
    name="cache_hit",
    metadata={"cache_key": "hotel_bj_2026", "ttl_remaining": 3600}
)

# 标记决策点
trace.event(
    name="route_decision",
    input={"intent": "hotel_search"},
    output={"selected_tool": "search_hotel_tool"}
)
```

---

## 五、装饰器用法（@observe）

### 5.1 基础用法

`@observe` 装饰器是最简洁的追踪方式，只需装饰函数即可自动追踪。

```python
from langfuse.decorators import observe, langfuse_context

@observe()
def search_hotels(city: str, checkin: str, checkout: str) -> list:
    """搜索酒店，自动追踪为 Span"""
    # 函数输入自动作为 Span 的 input
    results = hotel_api.search(city=city, checkin=checkin, checkout=checkout)
    # 函数返回值自动作为 Span 的 output
    return results

@observe()
def generate_itinerary(query: str, hotels: list) -> str:
    """生成行程，自动追踪为 Span"""
    # 在装饰函数内部，可以通过 langfuse_context 访问当前 Span
    langfuse_context.update_current_observation(
        metadata={"hotel_count": len(hotels)}
    )
    return llm.invoke(f"基于以下酒店列表生成行程：{hotels}")

@observe()  # 顶层函数自动成为 Trace 的根
def handle_user_request(user_id: str, query: str) -> str:
    """处理用户请求，整体追踪为一个 Trace"""
    # 为当前 Trace 设置 user_id 和 session_id
    langfuse_context.update_current_trace(
        user_id=user_id,
        session_id=f"session_{user_id}",
        tags=["production"]
    )

    hotels = search_hotels("北京", "2026-05-01", "2026-05-03")
    result = generate_itinerary(query, hotels)
    return result
```

### 5.2 追踪 LLM Generation

当在 `@observe` 装饰的函数中调用 LLM 时，可以明确标记为 Generation 类型以记录 Token 信息。

```python
from langfuse.decorators import observe, langfuse_context
from openai import OpenAI

client = OpenAI()

@observe(as_type="generation")  # 显式标记为 Generation
def call_llm(messages: list, model: str = "gpt-4o") -> str:
    """调用 LLM，追踪为 Generation"""
    # 更新 Generation 元信息
    langfuse_context.update_current_observation(
        model=model,
        model_parameters={"temperature": 0.7},
        input=messages  # 覆盖默认的函数参数作为 input
    )

    response = client.chat.completions.create(
        model=model,
        messages=messages
    )

    # 记录 Token 用量
    langfuse_context.update_current_observation(
        usage={
            "input": response.usage.prompt_tokens,
            "output": response.usage.completion_tokens,
            "total": response.usage.total_tokens,
            "unit": "TOKENS"
        },
        output=response.choices[0].message.content
    )

    return response.choices[0].message.content
```

### 5.3 嵌套追踪

`@observe` 支持函数嵌套，自动构建 Span 树。

```python
from langfuse.decorators import observe

@observe()
def retrieve_context(query: str) -> list:
    """检索上下文"""
    return vector_store.similarity_search(query, k=5)

@observe()
def rerank_results(query: str, docs: list) -> list:
    """重排序结果"""
    return reranker.rerank(query, docs)

@observe()
def build_prompt(query: str, context: list) -> list:
    """构建 Prompt"""
    context_text = "\n".join([d.page_content for d in context])
    return [
        {"role": "system", "content": f"参考资料：\n{context_text}"},
        {"role": "user", "content": query}
    ]

@observe()  # 根 Trace，包含完整嵌套树
def rag_pipeline(user_id: str, query: str) -> str:
    """RAG 完整流程，追踪结构如下：
    
    Trace: rag_pipeline
      └── Span: retrieve_context
      └── Span: rerank_results
      └── Span: build_prompt
      └── Generation: call_llm
    """
    docs = retrieve_context(query)
    reranked = rerank_results(query, docs)
    messages = build_prompt(query, reranked)
    return call_llm(messages)
```

### 5.4 异步函数支持

```python
from langfuse.decorators import observe
import asyncio

@observe()
async def async_search(query: str) -> list:
    """异步搜索，@observe 完整支持 async"""
    results = await async_search_api(query)
    return results

@observe()
async def async_agent(user_id: str, query: str) -> str:
    """异步 Agent"""
    results = await async_search(query)
    response = await async_llm_call(query, results)
    return response
```

---

## 六、Trace 设计最佳实践

### 6.1 命名规范

良好的命名规范是 Trace 可读性的基础，直接影响在 Langfuse UI 中的检索和过滤效率。

```
+------------------------------------------------------------------+
|                    Trace 命名规范                                 |
+------------------------------------------------------------------+
|                                                                   |
|  Trace 命名：{业务模块}_{操作}                                    |
|  示例：                                                          |
|    ✓  travel_agent_query                                         |
|    ✓  hotel_search_pipeline                                      |
|    ✓  itinerary_generation                                       |
|    ✗  query（太模糊）                                            |
|    ✗  trace_001（无意义编号）                                     |
|                                                                   |
|  Span 命名：{动作}_{对象}                                        |
|  示例：                                                          |
|    ✓  retrieve_hotel_docs                                        |
|    ✓  rerank_results                                             |
|    ✓  call_openai_gpt4o                                          |
|    ✗  span1, step2（无意义）                                     |
|                                                                   |
|  Generation 命名：{调用目的}_{模型简称}（可选）                   |
|  示例：                                                          |
|    ✓  generate_itinerary_gpt4o                                   |
|    ✓  intent_classification                                      |
|    ✓  slot_extraction                                            |
|                                                                   |
+------------------------------------------------------------------+
```

### 6.2 Trace ID 策略

```python
import uuid

# 策略一：业务 ID 作为 Trace ID（推荐，便于与业务系统关联）
def create_trace_with_business_id(order_id: str):
    trace = langfuse.trace(
        id=f"order_{order_id}",       # 可以追溯到具体业务记录
        name="order_process",
        metadata={"order_id": order_id}
    )
    return trace

# 策略二：请求 ID 透传（适合微服务链路追踪）
def create_trace_with_request_id(request_id: str):
    trace = langfuse.trace(
        id=request_id,                # 与上游请求 ID 对齐
        name="agent_query",
        metadata={"request_id": request_id}
    )
    return trace

# 策略三：UUID 生成（无业务 ID 时使用）
def create_trace_with_uuid():
    trace_id = str(uuid.uuid4())
    trace = langfuse.trace(
        id=trace_id,
        name="standalone_query"
    )
    return trace, trace_id  # 返回 ID 以便传递给下游

# 注意：同一个 Trace ID 写入多次是合并操作，不是新建
trace = langfuse.trace(id="fixed_id", name="first_call")  # 创建
trace = langfuse.trace(id="fixed_id", output={"result": "done"})  # 追加更新
```

### 6.3 Metadata 规范

```python
# 推荐的 metadata 结构
trace = langfuse.trace(
    name="agent_query",
    metadata={
        # 用户与渠道信息
        "user_id": "user_123",
        "channel": "wechat_miniprogram",   # wechat / app / web / api
        "app_version": "3.2.1",

        # 业务上下文
        "business_type": "hotel_search",    # 业务类型标记
        "city": "北京",
        "trip_type": "domestic",

        # 技术上下文
        "env": "production",               # dev / staging / production
        "model_version": "gpt-4o-2024-11-20",
        "pipeline_version": "v2",

        # 追踪关联
        "request_id": "req_abc123",        # 上游请求 ID
        "parent_trace_id": None,           # 父 Trace（如果有）
    },
    tags=["production", "hotel", "v2-pipeline"]  # 标签用于分组过滤
)
```

### 6.4 Level 标记

```python
# 使用 level 标记严重程度
from langfuse.model import ModelUsage

# 成功
trace.update(level="DEFAULT")    # 正常（默认）

# 调试信息
trace.update(level="DEBUG")

# 告警（如回退到备用模型）
trace.update(
    level="WARNING",
    metadata={"reason": "primary_model_timeout", "fallback": "gpt-4o-mini"}
)

# 错误（LLM 调用失败）
trace.update(
    level="ERROR",
    output={"error": "OpenAI API timeout"},
    metadata={"retry_count": 3}
)
```

---

## 七、Session 多轮对话追踪

### 7.1 Session 概念

Session 将多个 Trace 关联到同一个对话上下文，是多轮对话追踪的核心机制。

```
+------------------------------------------------------------------+
|                    Session 与 Trace 的关系                        |
+------------------------------------------------------------------+
|                                                                   |
|  用户 A 的对话（session_id: "chat_abc"）                          |
|                                                                   |
|  轮次 1                                                          |
|  Trace: trace_001 ──┐                                            |
|  input: "我想去北京" │                                            |
|  output: "好的，..."  │  session_id = "chat_abc"                 |
|                      │  (所有轮次共享同一 session_id)             |
|  轮次 2              │                                            |
|  Trace: trace_002 ──┤                                            |
|  input: "推荐酒店"   │                                            |
|  output: "推荐..."   │                                            |
|                      │                                            |
|  轮次 3              │                                            |
|  Trace: trace_003 ──┘                                            |
|  input: "预算 500"                                               |
|  output: "以下是..."                                             |
|                                                                   |
|  在 Langfuse UI 中，可以通过 session_id 查看完整对话链路           |
|                                                                   |
+------------------------------------------------------------------+
```

### 7.2 多轮对话追踪实现

```python
from langfuse import Langfuse
import uuid

langfuse = Langfuse()

class MultiTurnAgent:
    """支持 Langfuse Session 追踪的多轮对话 Agent"""

    def __init__(self, user_id: str):
        self.user_id = user_id
        self.session_id = f"session_{user_id}_{uuid.uuid4().hex[:8]}"
        self.turn_count = 0
        self.history = []
        self.langfuse = Langfuse()

    def chat(self, user_message: str) -> str:
        self.turn_count += 1

        # 每轮对话创建独立 Trace，但共享同一 session_id
        trace = self.langfuse.trace(
            name=f"chat_turn_{self.turn_count}",
            user_id=self.user_id,
            session_id=self.session_id,     # 关键：session_id 保持一致
            input={"user_message": user_message, "turn": self.turn_count},
            metadata={
                "history_length": len(self.history),
                "channel": "wechat"
            }
        )

        try:
            # 构建带历史的消息列表
            messages = self._build_messages(user_message)

            # 记录 LLM Generation
            generation = trace.generation(
                name="chat_generation",
                model="gpt-4o",
                input={"messages": messages}
            )

            response = self._call_llm(messages)

            generation.end(
                output={"content": response.content},
                usage={
                    "input": response.usage.prompt_tokens,
                    "output": response.usage.completion_tokens,
                    "unit": "TOKENS"
                }
            )

            # 更新历史
            self.history.append({"role": "user", "content": user_message})
            self.history.append({"role": "assistant", "content": response.content})

            trace.update(output={"response": response.content})
            return response.content

        except Exception as e:
            trace.update(level="ERROR", output={"error": str(e)})
            raise
        finally:
            self.langfuse.flush()

    def _build_messages(self, user_message: str) -> list:
        messages = [{"role": "system", "content": "你是旅游助手"}]
        messages.extend(self.history[-10:])  # 保留最近 5 轮
        messages.append({"role": "user", "content": user_message})
        return messages
```

### 7.3 Session ID 管理策略

```python
# 策略：与前端 session 打通
class SessionManager:
    """Session ID 管理，与前端会话对齐"""

    def get_or_create_session_id(self, user_id: str, frontend_session_id: str = None) -> str:
        """
        优先使用前端传入的 session_id，保证前后端 session 一致。
        前端未传则自动生成。
        """
        if frontend_session_id:
            return frontend_session_id  # 与前端 session 对齐
        return f"session_{user_id}_{int(time.time())}"

    def new_session(self, user_id: str) -> str:
        """用户主动开启新会话"""
        return f"session_{user_id}_{uuid.uuid4().hex}"
```

---

## 八、成本追踪

### 8.1 Token 计价原理

Langfuse 的成本计算依赖 Generation 中上报的 Token 数量和模型价格配置。

```
+------------------------------------------------------------------+
|                    Token 成本计算流程                             |
+------------------------------------------------------------------+
|                                                                   |
|  1. 代码上报 Token 数量                                           |
|     generation.end(usage={"input": 512, "output": 128})          |
|                                                                   |
|  2. Langfuse 查找模型价格表                                       |
|     (Settings → Models → 价格配置)                                |
|                                                                   |
|  3. 自动计算成本                                                  |
|     cost = input_tokens × input_price + output_tokens × output_price |
|                                                                   |
|  4. 聚合统计                                                      |
|     - 按 Trace / Session / User / 时间 聚合                      |
|     - Dashboard 中可视化成本趋势                                  |
|                                                                   |
+------------------------------------------------------------------+
```

### 8.2 主流模型价格表（2026-04 参考）

```python
# 主流模型价格参考（$/1M tokens，仅供参考，以官方最新为准）
MODEL_PRICES = {
    # OpenAI 系列
    "gpt-4o": {
        "input": 2.50,          # $2.50/1M input tokens
        "output": 10.00,        # $10.00/1M output tokens
        "cached_input": 1.25,   # 缓存命中价格
    },
    "gpt-4o-mini": {
        "input": 0.15,
        "output": 0.60,
        "cached_input": 0.075,
    },
    "gpt-4o-2024-11-20": {
        "input": 2.50,
        "output": 10.00,
        "cached_input": 1.25,
    },
    # Anthropic 系列
    "claude-sonnet-4-5": {
        "input": 3.00,
        "output": 15.00,
        "cached_input": 0.30,
    },
    "claude-haiku-3-5": {
        "input": 0.80,
        "output": 4.00,
        "cached_input": 0.08,
    },
    # 国内模型（阿里通义）
    "qwen-max": {
        "input": 0.56,         # ¥ 换算为 $，仅参考
        "output": 2.24,
    },
    "qwen-turbo": {
        "input": 0.056,
        "output": 0.224,
    },
}
```

### 8.3 成本追踪实现

```python
from langfuse import Langfuse

langfuse = Langfuse()

def tracked_llm_call(
    trace,
    messages: list,
    model: str = "gpt-4o",
    span_name: str = "llm_call"
) -> str:
    """带成本追踪的 LLM 调用封装"""

    generation = trace.generation(
        name=span_name,
        model=model,
        model_parameters={"temperature": 0.7},
        input={"messages": messages}
    )

    response = openai_client.chat.completions.create(
        model=model,
        messages=messages
    )

    # 关键：上报 Token 数量，Langfuse 自动计算成本
    generation.end(
        output={"content": response.choices[0].message.content},
        usage={
            "input": response.usage.prompt_tokens,
            "output": response.usage.completion_tokens,
            "total": response.usage.total_tokens,
            "unit": "TOKENS",
            # 如果有缓存命中，额外上报
            "input_cost": None,   # 留空则由 Langfuse 按价格表计算
        }
    )

    return response.choices[0].message.content


def calculate_and_score_cost(trace, model: str, input_tokens: int, output_tokens: int):
    """将成本以 Score 形式记录，便于按业务维度查询"""
    prices_per_1m = MODEL_PRICES.get(model, {"input": 0, "output": 0})
    cost_usd = (
        input_tokens * prices_per_1m["input"] +
        output_tokens * prices_per_1m["output"]
    ) / 1_000_000

    trace.score(
        name="cost_usd",
        value=round(cost_usd, 6),
        comment=f"model={model}, input_tokens={input_tokens}, output_tokens={output_tokens}"
    )

    return cost_usd
```

### 8.4 成本聚合查询

```python
from langfuse import Langfuse
from datetime import datetime, timedelta

langfuse = Langfuse()

# 查询近 7 天成本趋势
def get_cost_summary(days: int = 7):
    """获取成本汇总（通过 Langfuse API）"""
    # 注意：Langfuse Python SDK 的 fetch 接口，实际生产中建议直接用 Dashboard
    traces = langfuse.fetch_traces(
        from_timestamp=datetime.now() - timedelta(days=days),
        limit=500
    )

    total_cost = 0
    cost_by_user = {}

    for trace in traces.data:
        # 从 Score 中读取成本（如果已记录）
        for score in trace.scores or []:
            if score.name == "cost_usd":
                total_cost += score.value
                user_id = trace.user_id or "unknown"
                cost_by_user[user_id] = cost_by_user.get(user_id, 0) + score.value

    return {
        "total_cost_usd": round(total_cost, 4),
        "cost_by_user": cost_by_user,
        "period_days": days
    }
```

---

## 九、评分与评测

### 9.1 评分类型总览

```
+------------------------------------------------------------------+
|                    Langfuse 评分类型                              |
+------------------------------------------------------------------+
|                                                                   |
|  类型            触发方式        典型场景                          |
|  ---------------------------------------------------------------- |
|  人工评分        人工在 UI 打分  标注数据集、审核生产回答          |
|  用户反馈评分    用户点赞/踩踏   收集真实用户偏好                  |
|  LLM-as-Judge    LLM 自动打分   大规模自动化评测                  |
|  规则评分        代码逻辑判断   格式检查、关键词命中               |
|                                                                   |
|  Score 结构：                                                     |
|  - name: 评分维度（如 "faithfulness", "relevance"）               |
|  - value: 数值（0-1 或 1-5，自由定义）                            |
|  - comment: 说明（可选，LLM-as-Judge 填写判断依据）               |
|  - trace_id: 关联的 Trace                                        |
|  - observation_id: 关联的 Span/Generation（可选）                |
|                                                                   |
+------------------------------------------------------------------+
```

### 9.2 用户反馈评分

```python
from langfuse import Langfuse

langfuse = Langfuse()

def record_user_feedback(trace_id: str, rating: int, comment: str = None):
    """记录用户反馈评分（1-5 分制）"""
    langfuse.score(
        trace_id=trace_id,
        name="user_feedback",
        value=rating,           # 1（非常不满意）~ 5（非常满意）
        comment=comment
    )

def record_thumbs_feedback(trace_id: str, is_helpful: bool):
    """记录点赞/踩踏反馈"""
    langfuse.score(
        trace_id=trace_id,
        name="helpful",
        value=1.0 if is_helpful else 0.0,
        comment="thumbs_up" if is_helpful else "thumbs_down"
    )
```

### 9.3 LLM-as-Judge 自动评分

```python
from langfuse import Langfuse
from openai import OpenAI
import json

langfuse = Langfuse()
openai_client = OpenAI()

JUDGE_PROMPT = """你是一个专业的 LLM 回答质量评估专家。请根据以下标准对回答进行评分。

评分维度：
1. faithfulness（忠实度）：回答是否忠实于提供的参考资料，无虚构内容
2. relevance（相关性）：回答是否与用户问题直接相关
3. completeness（完整性）：回答是否覆盖了问题的主要方面
4. helpfulness（实用性）：回答是否对用户实际有帮助

用户问题：{question}
参考资料：{context}
AI 回答：{answer}

请输出 JSON 格式的评分结果：
{{
    "faithfulness": <0.0-1.0>,
    "relevance": <0.0-1.0>,
    "completeness": <0.0-1.0>,
    "helpfulness": <0.0-1.0>,
    "reasoning": "<简要说明评分依据>"
}}"""


def llm_judge_score(trace_id: str, question: str, context: str, answer: str):
    """使用 LLM-as-Judge 对回答进行自动评分"""

    judge_response = openai_client.chat.completions.create(
        model="gpt-4o",
        messages=[{
            "role": "user",
            "content": JUDGE_PROMPT.format(
                question=question,
                context=context,
                answer=answer
            )
        }],
        response_format={"type": "json_object"},
        temperature=0.0      # 评测时使用 0 温度，结果更稳定
    )

    scores = json.loads(judge_response.choices[0].message.content)
    reasoning = scores.pop("reasoning", "")

    # 将每个维度作为独立 Score 上报
    for metric_name, value in scores.items():
        langfuse.score(
            trace_id=trace_id,
            name=metric_name,
            value=float(value),
            comment=reasoning
        )

    return scores


# 在业务流程中接入自动评分
def agent_with_auto_scoring(user_id: str, query: str):
    trace = langfuse.trace(name="agent_query", user_id=user_id)

    context = retrieve_context(query)
    answer = generate_answer(query, context, trace)

    # 异步触发 LLM-as-Judge 评分（避免阻塞主流程）
    import threading
    threading.Thread(
        target=llm_judge_score,
        args=(trace.id, query, context, answer),
        daemon=True
    ).start()

    langfuse.flush()
    return answer
```

### 9.4 规则评分

```python
def rule_based_score(trace_id: str, response: str, expected_format: str = "json"):
    """基于规则的格式检查评分"""

    scores = {}

    # 检查响应长度是否合理
    length = len(response)
    scores["response_length_ok"] = 1.0 if 50 <= length <= 2000 else 0.0

    # 检查是否包含关键词
    keywords = ["推荐", "景点", "酒店", "交通"]
    keyword_hit = sum(1 for k in keywords if k in response) / len(keywords)
    scores["keyword_coverage"] = keyword_hit

    # 检查格式是否正确
    if expected_format == "json":
        try:
            json.loads(response)
            scores["format_valid"] = 1.0
        except json.JSONDecodeError:
            scores["format_valid"] = 0.0

    # 批量上报
    for name, value in scores.items():
        langfuse.score(trace_id=trace_id, name=name, value=value)

    return scores
```

---

## 十、Prompt 管理

### 10.1 Prompt 版本化

Langfuse 提供 Prompt 管理功能，将 Prompt 从代码中解耦，支持版本化管理和在线更新。

```
+------------------------------------------------------------------+
|                    Prompt 管理工作流                              |
+------------------------------------------------------------------+
|                                                                   |
|  开发者                Langfuse UI             应用代码            |
|  ┌─────────┐          ┌─────────────────┐     ┌─────────────┐    |
|  │ 编写    │          │ Prompt 仓库     │     │ 拉取        │    |
|  │ Prompt  │ ──push──▶│                 │     │ Prompt      │    |
|  │ 并测试  │          │ travel_system   │◀────│ (带版本号)   │    |
|  └─────────┘          │  v1 (production)│     └─────────────┘    |
|                        │  v2 (staging)   │                        |
|  测试人员              │  v3 (draft)     │                        |
|  ┌─────────┐          │                 │                        |
|  │ 在 UI   │          │ hotel_search    │                        |
|  │ 修改 &  │ ──save──▶│  v1 (production)│                        |
|  │ 发布    │          │  v2 (draft)     │                        |
|  └─────────┘          └─────────────────┘                        |
|                                                                   |
|  优势：                                                           |
|  - Prompt 更新无需重新部署代码                                    |
|  - 可回滚到历史版本                                               |
|  - A/B 测试不同版本效果                                           |
|                                                                   |
+------------------------------------------------------------------+
```

### 10.2 创建和拉取 Prompt

```python
from langfuse import Langfuse

langfuse = Langfuse()

# ── 创建/更新 Prompt（通常在 UI 操作，也可以用 SDK）──
langfuse.create_prompt(
    name="travel_system_prompt",
    prompt="你是 DeepTrip 的旅行助手，专注于帮助用户规划行程。"
           "你擅长：行程规划、酒店推荐、景点介绍、交通建议。"
           "当前日期：{{current_date}}，用户城市：{{user_city}}",
    config={
        "model": "gpt-4o",
        "temperature": 0.7,
    },
    labels=["production"]   # 标记为 production 版本
)

# ── 拉取 Prompt（应用代码运行时调用）──
def get_system_prompt(current_date: str, user_city: str) -> str:
    """从 Langfuse 拉取 Prompt 并填充变量"""
    prompt_obj = langfuse.get_prompt(
        name="travel_system_prompt",
        label="production",    # 拉取 production 标签的版本
        cache_ttl_seconds=300  # 本地缓存 5 分钟，避免频繁请求
    )

    # 编译 Prompt（填充变量）
    compiled = prompt_obj.compile(
        current_date=current_date,
        user_city=user_city
    )
    return compiled

# ── 在 LangChain 中使用 Langfuse Prompt ──
from langchain.prompts import ChatPromptTemplate

def build_chain_with_langfuse_prompt():
    prompt_obj = langfuse.get_prompt("travel_system_prompt", label="production")
    langchain_prompt = prompt_obj.get_langchain_prompt()  # 转为 LangChain 格式

    chain = langchain_prompt | llm | StrOutputParser()
    return chain
```

### 10.3 A/B 测试

```python
import random
from langfuse import Langfuse

langfuse = Langfuse()

def get_prompt_for_ab_test(user_id: str) -> tuple[str, str]:
    """A/B 测试：50% 用户用 v1，50% 用 v2"""
    # 基于 user_id 哈希分组，保证同一用户始终用同一版本
    variant = "v1" if int(user_id[-1], 16) < 8 else "v2"

    if variant == "v1":
        prompt_obj = langfuse.get_prompt("travel_prompt", version=1)
    else:
        prompt_obj = langfuse.get_prompt("travel_prompt", version=2)

    return prompt_obj.compile(), variant


def agent_with_ab_test(user_id: str, query: str):
    compiled_prompt, variant = get_prompt_for_ab_test(user_id)

    trace = langfuse.trace(
        name="agent_query",
        user_id=user_id,
        metadata={
            "ab_variant": variant,         # 记录 A/B 分组
            "prompt_version": variant
        },
        tags=[f"ab_{variant}"]             # 用 tag 方便在 UI 按组过滤
    )

    response = call_llm_with_prompt(compiled_prompt, query, trace)
    langfuse.flush()
    return response
```

---

## 十一、数据集与批量评测

### 11.1 数据集概念

```
+------------------------------------------------------------------+
|                    Langfuse 数据集结构                            |
+------------------------------------------------------------------+
|                                                                   |
|  Dataset（数据集）                                               |
|  ┌────────────────────────────────────────────────────────────┐  |
|  │  name: "travel_qa_benchmark"                               │  |
|  │  description: "旅行问答基准测试集"                          │  |
|  │                                                            │  |
|  │  DatasetItem（测试用例）                                   │  |
|  │  ┌──────────────────────────────────────────────────────┐  │  |
|  │  │  input: {"question": "北京故宫门票多少钱？"}          │  │  |
|  │  │  expected_output: {"answer": "旺季 60 元/人"}        │  │  |
|  │  │  metadata: {"category": "景点", "difficulty": "easy"} │  │  |
|  │  └──────────────────────────────────────────────────────┘  │  |
|  │                                                            │  |
|  │  DatasetItem 2 ... N                                      │  |
|  │                                                            │  |
|  │  DatasetRun（一次批量评测运行）                            │  |
|  │  ┌──────────────────────────────────────────────────────┐  │  |
|  │  │  name: "gpt4o_v2_pipeline_20260414"                  │  │  |
|  │  │  description: "测试 v2 pipeline 在基准集上的表现"     │  │  |
|  │  │  ├── RunItem (item_1 → trace_001, scores: {...})      │  │  |
|  │  │  ├── RunItem (item_2 → trace_002, scores: {...})      │  │  |
|  │  │  └── RunItem (item_N → trace_00N, scores: {...})      │  │  |
|  │  └──────────────────────────────────────────────────────┘  │  |
|  └────────────────────────────────────────────────────────────┘  |
|                                                                   |
+------------------------------------------------------------------+
```

### 11.2 创建数据集

```python
from langfuse import Langfuse

langfuse = Langfuse()

# 创建数据集
dataset = langfuse.create_dataset(
    name="travel_qa_benchmark",
    description="旅行问答基准测试集 v1"
)

# 添加测试用例
test_cases = [
    {
        "input": {"question": "北京故宫门票多少钱？"},
        "expected_output": {"answer": "旺季票价 60 元/人，淡季 40 元/人"},
        "metadata": {"category": "景点", "city": "北京", "difficulty": "easy"}
    },
    {
        "input": {"question": "上海到北京高铁最快多久？"},
        "expected_output": {"answer": "最快约 4.5 小时（G字头高铁）"},
        "metadata": {"category": "交通", "difficulty": "easy"}
    },
    {
        "input": {"question": "帮我规划一个 5 天 4 晚的云南行程，预算 5000 元"},
        "expected_output": None,   # 开放式问题，人工评分
        "metadata": {"category": "规划", "difficulty": "hard"}
    },
]

for case in test_cases:
    langfuse.create_dataset_item(
        dataset_name="travel_qa_benchmark",
        input=case["input"],
        expected_output=case["expected_output"],
        metadata=case["metadata"]
    )
```

### 11.3 批量评测运行

```python
from langfuse import Langfuse
from datetime import datetime

langfuse = Langfuse()

def run_benchmark(pipeline_name: str, pipeline_fn, dataset_name: str = "travel_qa_benchmark"):
    """批量评测 pipeline 在数据集上的表现"""

    run_name = f"{pipeline_name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    dataset = langfuse.get_dataset(dataset_name)

    print(f"开始评测 run: {run_name}，共 {len(dataset.items)} 条用例")

    for item in dataset.items:
        # 使用 item.observe() 自动关联 Run 和 Trace
        with item.observe(run_name=run_name) as trace_id:
            try:
                question = item.input["question"]

                # 运行被测 pipeline
                result = pipeline_fn(question)

                # 自动评分（与期望输出对比）
                if item.expected_output:
                    is_correct = check_answer(result, item.expected_output["answer"])
                    langfuse.score(
                        trace_id=trace_id,
                        name="exact_match",
                        value=1.0 if is_correct else 0.0
                    )

                # LLM-as-Judge 自动评分
                llm_judge_score(
                    trace_id=trace_id,
                    question=question,
                    context="",
                    answer=result
                )

            except Exception as e:
                langfuse.score(
                    trace_id=trace_id,
                    name="error",
                    value=0.0,
                    comment=str(e)
                )

    langfuse.flush()
    print(f"评测完成，可在 Langfuse UI 查看 run: {run_name}")
    return run_name


def check_answer(actual: str, expected: str) -> bool:
    """简单的答案匹配检查"""
    # 实际项目中可以用语义相似度替代字符串匹配
    key_parts = expected.split("，")
    return all(part.strip() in actual for part in key_parts if part.strip())
```

---

## 十二、生产环境注意事项

### 12.1 异步上报机制

```
+------------------------------------------------------------------+
|                    Langfuse 异步上报原理                          |
+------------------------------------------------------------------+
|                                                                   |
|  应用代码                                                         |
|  ┌────────────────┐                                              |
|  │  trace(...)    │──┐                                           |
|  │  generation()  │  │ 立即返回（不阻塞）                        |
|  │  span()        │  │                                           |
|  └────────────────┘  │                                           |
|                       ↓                                           |
|  ┌────────────────────────────────┐                              |
|  │  本地内存队列（BatchQueue）    │                              |
|  │  [event1, event2, event3, ...]  │                              |
|  └────────────────────────────────┘                              |
|                       │                                           |
|                   后台线程                                        |
|                   定时 flush                                      |
|                       │                                           |
|                       ↓                                           |
|  ┌────────────────────────────────┐                              |
|  │  Langfuse Server               │                              |
|  │  POST /api/public/ingestion    │                              |
|  └────────────────────────────────┘                              |
|                                                                   |
|  关键参数：                                                       |
|  - flush_interval: 后台 flush 间隔（默认 0.5s）                  |
|  - flush_at: 队列达到此大小时强制 flush（默认 15）               |
|  - max_retries: 上报失败重试次数（默认 3）                       |
|                                                                   |
+------------------------------------------------------------------+
```

### 12.2 flush 策略

```python
from langfuse import Langfuse

# 配置 flush 策略
langfuse = Langfuse(
    flush_interval=1.0,    # 每 1 秒自动 flush（默认 0.5s）
    flush_at=50,           # 队列满 50 条时立即 flush（默认 15）
)

# ── 场景一：短生命周期程序（脚本/任务）──
# 必须在程序退出前手动调用 flush，否则队列中的数据丢失
def batch_job():
    for item in data:
        trace = langfuse.trace(name="process_item")
        # ... 处理逻辑 ...

    langfuse.flush()  # 程序结束前强制上报所有数据


# ── 场景二：Web 服务（FastAPI）──
from fastapi import FastAPI
import atexit

app = FastAPI()
langfuse = Langfuse()

# 注册退出钩子，服务关闭时自动 flush
atexit.register(langfuse.flush)

@app.post("/chat")
async def chat(request: ChatRequest):
    trace = langfuse.trace(name="chat_api")
    # ... 业务逻辑 ...
    # 注意：这里不需要每次手动 flush，后台线程会定期处理
    return response


# ── 场景三：Lambda / Serverless ──
# Serverless 环境无后台线程，每次调用必须手动 flush
def lambda_handler(event, context):
    langfuse = Langfuse()
    trace = langfuse.trace(name="lambda_invocation")
    try:
        result = process(event)
        trace.update(output=result)
        return result
    finally:
        langfuse.flush()   # Serverless 必须手动 flush！
```

### 12.3 采样率控制

```python
import random
from functools import wraps

# 生产环境按比例采样追踪（降低成本和性能开销）
SAMPLE_RATE = 0.1   # 采样 10% 的请求

def sampled_trace(sample_rate: float = SAMPLE_RATE):
    """装饰器：按采样率决定是否追踪"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            if random.random() < sample_rate:
                # 追踪这次请求
                trace = langfuse.trace(name=func.__name__)
                try:
                    result = func(*args, **kwargs)
                    trace.update(output={"status": "success"})
                    return result
                except Exception as e:
                    trace.update(level="ERROR", output={"error": str(e)})
                    raise
                finally:
                    langfuse.flush()
            else:
                # 不追踪，直接执行
                return func(*args, **kwargs)
        return wrapper
    return decorator


@sampled_trace(sample_rate=0.1)
def handle_request(user_id: str, query: str):
    return process_query(user_id, query)


# 也可以基于条件采样（如只追踪错误或慢请求）
def conditional_trace(func):
    """条件采样：错误和慢请求 100% 追踪，其余 5% 采样"""
    @wraps(func)
    def wrapper(*args, **kwargs):
        trace = langfuse.trace(name=func.__name__)
        start = time.time()
        try:
            result = func(*args, **kwargs)
            elapsed = time.time() - start
            if elapsed > 5.0:  # 慢请求（>5s）强制记录
                trace.update(
                    output={"result": str(result)},
                    metadata={"slow_request": True, "elapsed_s": round(elapsed, 2)}
                )
                langfuse.flush()
            return result
        except Exception as e:
            trace.update(level="ERROR", output={"error": str(e)})
            langfuse.flush()  # 错误一定要 flush
            raise
    return wrapper
```

### 12.4 错误处理与容错

```python
from langfuse import Langfuse
import logging

logger = logging.getLogger(__name__)

class SafeLangfuse:
    """容错的 Langfuse 封装，追踪失败不影响主业务"""

    def __init__(self):
        try:
            self._langfuse = Langfuse()
            self._enabled = True
        except Exception as e:
            logger.warning(f"Langfuse 初始化失败，追踪已禁用: {e}")
            self._langfuse = None
            self._enabled = False

    def trace(self, **kwargs):
        if not self._enabled:
            return NullTrace()   # 空对象，所有方法都是 no-op
        try:
            return self._langfuse.trace(**kwargs)
        except Exception as e:
            logger.warning(f"创建 Trace 失败: {e}")
            return NullTrace()

    def flush(self):
        if self._enabled and self._langfuse:
            try:
                self._langfuse.flush()
            except Exception as e:
                logger.warning(f"Langfuse flush 失败: {e}")


class NullTrace:
    """空 Trace 对象，所有方法都是 no-op（Null Object Pattern）"""
    def span(self, **kwargs): return self
    def generation(self, **kwargs): return self
    def event(self, **kwargs): return self
    def score(self, **kwargs): return self
    def update(self, **kwargs): return self
    def end(self, **kwargs): return self
    @property
    def id(self): return "null_trace_id"
```

### 12.5 性能影响评估

```
+------------------------------------------------------------------+
|                    Langfuse 性能影响评估                          |
+------------------------------------------------------------------+
|                                                                   |
|  开销来源            影响              优化建议                   |
|  ---------------------------------------------------------------- |
|  SDK 本地操作        < 1ms（忽略）    无需优化                    |
|  后台 HTTP 上报      异步，不阻塞      保持默认即可               |
|  flush 操作          同步，可能阻塞    避免在热路径上频繁 flush    |
|  @observe 装饰器     < 0.1ms 额外开销 可用于所有函数             |
|  get_prompt          首次 ~50ms       配置 cache_ttl_seconds      |
|                                                                   |
|  推荐配置：                                                       |
|  - 生产环境开启 Prompt 缓存（cache_ttl_seconds=300）             |
|  - 避免在循环中调用 flush()                                      |
|  - 高并发场景考虑采样率控制（10%~50%）                           |
|  - Serverless 场景每次调用必须 flush                             |
|                                                                   |
+------------------------------------------------------------------+
```

---

## 十三、常见踩坑与解决方案

### 坑1：程序退出前未 flush，数据丢失

```python
# ❌ 错误：短生命周期程序不 flush
def main():
    langfuse = Langfuse()
    for query in queries:
        trace = langfuse.trace(name="batch_process")
        result = process(query)
        trace.update(output={"result": result})
    # 程序退出！队列中的事件全部丢失

# ✅ 正确：程序结束前调用 flush
def main():
    langfuse = Langfuse()
    try:
        for query in queries:
            trace = langfuse.trace(name="batch_process")
            result = process(query)
            trace.update(output={"result": result})
    finally:
        langfuse.flush()  # 确保所有数据上传
```

### 坑2：每轮对话创建新 Trace ID，无法关联多轮上下文

```python
# ❌ 错误：每次对话都生成新的随机 Trace，无法在 UI 中查看完整会话
class Agent:
    def chat(self, query: str):
        trace = langfuse.trace(name="chat")  # 每次都是全新 Trace！
        ...

# ✅ 正确：相同 session 内的 Trace 共享 session_id
class Agent:
    def __init__(self, user_id: str):
        self.session_id = f"session_{user_id}_{uuid.uuid4().hex[:8]}"

    def chat(self, query: str):
        trace = langfuse.trace(
            name="chat",
            session_id=self.session_id,   # 关键：每轮对话用相同 session_id
            user_id=self.user_id
        )
        ...
```

### 坑3：Trace 对象传递混乱，Span 挂在错误的 Trace 下

```python
# ❌ 错误：全局 trace 对象被多个并发请求共享
_global_trace = None

def handle_request(query: str):
    global _global_trace
    _global_trace = langfuse.trace(name="request")  # 并发时相互覆盖！
    result = call_tool(query)
    return result

def call_tool(query: str):
    span = _global_trace.span(name="tool")   # 可能指向错误的 trace！
    ...

# ✅ 正确：Trace 对象通过参数传递
def handle_request(query: str):
    trace = langfuse.trace(name="request")   # 局部变量
    result = call_tool(query, trace)         # 显式传递
    return result

def call_tool(query: str, trace):
    span = trace.span(name="tool")           # 正确绑定
    ...
```

### 坑4：在 Serverless / AWS Lambda 中忘记 flush

```python
# ❌ 错误：Lambda 函数不 flush，数据永远不会上报
def lambda_handler(event, context):
    langfuse = Langfuse()
    trace = langfuse.trace(name="lambda_call")
    result = process(event)
    trace.update(output=result)
    return result   # 函数结束，后台线程被杀死，数据丢失！

# ✅ 正确：Serverless 必须在函数结束前 flush
def lambda_handler(event, context):
    langfuse = Langfuse()
    trace = langfuse.trace(name="lambda_call")
    try:
        result = process(event)
        trace.update(output=result)
        return result
    finally:
        langfuse.flush()   # 同步等待上报完成
```

### 坑5：Prompt 变量未填充就直接使用

```python
# ❌ 错误：把 Prompt 模板原文传给 LLM，变量未替换
def build_prompt_wrong():
    prompt_obj = langfuse.get_prompt("travel_prompt")
    # 忘记调用 compile()，直接用模板文本
    return prompt_obj.prompt   # 包含 {{city}} 等未替换的占位符

# ✅ 正确：调用 compile() 填充变量后再使用
def build_prompt_correct(city: str, date: str):
    prompt_obj = langfuse.get_prompt("travel_prompt")
    compiled = prompt_obj.compile(city=city, date=date)  # 填充变量
    return compiled
```

### 坑6：LLM-as-Judge 评分温度设置过高，评分不稳定

```python
# ❌ 错误：高温度导致 Judge 每次评分结果不一致
def judge_wrong(question: str, answer: str):
    response = openai_client.chat.completions.create(
        model="gpt-4o",
        messages=[...],
        temperature=0.9   # 高温度，评分随机波动大
    )
    ...

# ✅ 正确：评测场景使用 temperature=0，结果可复现
def judge_correct(question: str, answer: str):
    response = openai_client.chat.completions.create(
        model="gpt-4o",
        messages=[...],
        temperature=0.0,   # 确保评分稳定可复现
        seed=42            # 进一步保证确定性（部分模型支持）
    )
    ...
```

### 坑7：Metadata 中放了超大对象，导致上报失败

```python
# ❌ 错误：把完整的文档列表放入 metadata，体积超限
def trace_wrong(query: str, docs: list):
    trace = langfuse.trace(
        name="rag_pipeline",
        metadata={
            "full_docs": docs,   # 可能有几百 KB，超过 Langfuse 单事件限制
        }
    )

# ✅ 正确：metadata 只放关键的摘要信息
def trace_correct(query: str, docs: list):
    trace = langfuse.trace(
        name="rag_pipeline",
        metadata={
            "doc_count": len(docs),
            "doc_ids": [d.id for d in docs[:10]],   # 只记录 ID
            "top_score": docs[0].score if docs else None
        }
    )
```

### 坑8：@observe 与手动 SDK 混用，造成 Span 树断裂

```python
# ❌ 错误：混用 @observe 和手动 SDK，手动创建的 Trace 与 @observe 的 Trace 不关联
@observe()
def outer_function():
    # @observe 已经创建了一个 Trace
    inner_result = inner_function()
    return inner_result

def inner_function():
    # 手动创建了新 Trace，与外层 @observe 的 Trace 完全无关！
    trace = langfuse.trace(name="inner")
    result = do_work()
    trace.update(output=result)
    langfuse.flush()
    return result

# ✅ 正确：在 @observe 函数内使用 langfuse_context 追加数据
from langfuse.decorators import observe, langfuse_context

@observe()
def outer_function():
    inner_result = inner_function()
    return inner_result

@observe()   # 内层函数也用 @observe，自动成为外层的子 Span
def inner_function():
    langfuse_context.update_current_observation(
        metadata={"custom_key": "custom_value"}
    )
    return do_work()
```

---

## 十四、速查表

### 14.1 核心 API 速查

```
+------------------------------------------------------------------+
|                    Langfuse Python SDK 速查                       |
+------------------------------------------------------------------+
|                                                                   |
|  初始化                                                           |
|  from langfuse import Langfuse                                   |
|  lf = Langfuse()                                                 |
|                                                                   |
|  Trace 操作                                                       |
|  trace = lf.trace(name, id, user_id, session_id,                 |
|                   input, output, metadata, tags, level)           |
|  trace.update(output, metadata, level)                           |
|                                                                   |
|  Span 操作                                                        |
|  span = trace.span(name, input, metadata)                        |
|  span.end(output, metadata, level)                               |
|                                                                   |
|  Generation 操作                                                  |
|  gen = trace.generation(name, model, model_parameters,           |
|                          input, usage)                            |
|  gen.end(output, usage, metadata)                                |
|                                                                   |
|  Event 操作                                                       |
|  trace.event(name, input, output, metadata)                      |
|                                                                   |
|  Score 操作                                                       |
|  lf.score(trace_id, name, value, comment, observation_id)        |
|  trace.score(name, value, comment)                               |
|                                                                   |
|  Prompt 操作                                                      |
|  p = lf.get_prompt(name, version, label, cache_ttl_seconds)      |
|  compiled = p.compile(**variables)                               |
|  lf.create_prompt(name, prompt, config, labels)                  |
|                                                                   |
|  数据集操作                                                       |
|  lf.create_dataset(name, description)                            |
|  lf.create_dataset_item(dataset_name, input, expected_output)    |
|  dataset = lf.get_dataset(name)                                  |
|  with item.observe(run_name) as trace_id: ...                    |
|                                                                   |
|  系统操作                                                         |
|  lf.flush()                    # 强制上报队列中所有数据           |
|  lf.auth_check()               # 验证连接                        |
|  lf.shutdown()                 # 关闭 SDK（含 flush）             |
|                                                                   |
+------------------------------------------------------------------+
```

### 14.2 @observe 装饰器速查

```
+------------------------------------------------------------------+
|                    @observe 装饰器速查                            |
+------------------------------------------------------------------+
|                                                                   |
|  from langfuse.decorators import observe, langfuse_context        |
|                                                                   |
|  @observe()                          # 默认追踪为 Span            |
|  @observe(as_type="generation")      # 追踪为 Generation          |
|  @observe(name="custom_name")        # 自定义节点名称             |
|  @observe(capture_input=False)       # 不记录函数参数             |
|  @observe(capture_output=False)      # 不记录返回值               |
|                                                                   |
|  在 @observe 函数内使用 langfuse_context：                        |
|  langfuse_context.update_current_observation(                    |
|      input=..., output=..., metadata=..., usage=...)             |
|  langfuse_context.update_current_trace(                          |
|      user_id=..., session_id=..., tags=...)                      |
|  langfuse_context.get_current_trace_id()                         |
|  langfuse_context.get_current_observation_id()                   |
|  langfuse_context.score_current_trace(name, value, comment)      |
|                                                                   |
+------------------------------------------------------------------+
```

### 14.3 LangChain 集成速查

```python
from langfuse.callback import CallbackHandler

# 全局 handler（适合单租户场景）
handler = CallbackHandler()

# 带用户/会话信息的 handler（适合多租户场景）
handler = CallbackHandler(
    user_id="user_123",
    session_id="session_abc",
    trace_name="my_chain",
    tags=["production"]
)

# 使用方式
chain.invoke(input, config={"callbacks": [handler]})
chain.stream(input, config={"callbacks": [handler]})
await chain.ainvoke(input, config={"callbacks": [handler]})

# 获取本次调用的 trace_id（用于后续评分）
trace_id = handler.get_trace_id()
```

### 14.4 生产环境检查清单

```
+------------------------------------------------------------------+
|                    生产环境上线检查清单                           |
+------------------------------------------------------------------+
|                                                                   |
|  配置检查                                                         |
|  [ ] 密钥通过环境变量注入，未硬编码在代码中                       |
|  [ ] LANGFUSE_HOST 配置正确（cloud 或 self-hosted）               |
|  [ ] 生产/测试环境使用不同的 Project（隔离数据）                  |
|                                                                   |
|  数据质量                                                         |
|  [ ] 所有 Trace 都有 user_id 和 session_id                       |
|  [ ] metadata 字段规范（channel, env, version 等必填）            |
|  [ ] 命名规范统一（trace/span/generation 命名规则一致）           |
|                                                                   |
|  可靠性                                                           |
|  [ ] 短生命周期程序在退出前调用 langfuse.flush()                 |
|  [ ] Serverless 函数每次调用后 flush                              |
|  [ ] Web 服务注册 atexit 钩子或 lifespan flush                    |
|  [ ] 追踪代码用 try/except 包裹，失败不影响主业务                 |
|                                                                   |
|  性能                                                             |
|  [ ] Prompt 管理开启 cache_ttl_seconds（推荐 300s）               |
|  [ ] 高并发场景考虑采样率（非全量追踪）                           |
|  [ ] metadata 中无超大对象（建议 < 10KB）                         |
|                                                                   |
|  评测                                                             |
|  [ ] 核心功能配置 LLM-as-Judge 自动评分                           |
|  [ ] 已创建基准数据集，定期跑回归评测                             |
|  [ ] Dashboard 配置告警（评分下降 / 成本异常）                    |
|                                                                   |
+------------------------------------------------------------------+
```

---

> 参考资料：
> - Langfuse 官方文档：https://langfuse.com/docs
> - Langfuse Python SDK：https://python.reference.langfuse.com
> - Langfuse GitHub：https://github.com/langfuse/langfuse
