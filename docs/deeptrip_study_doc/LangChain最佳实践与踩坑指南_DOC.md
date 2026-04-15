# LangChain 最佳实践与踩坑指南

## 文档信息

- 作者：徐凯旋
- 邮箱：azouever@gmail.com
- 更新时间：2026-04-14
- 标签：LangChain, LLM, Agent, Chain, Tool

---

## 目录

1. [概述](#一概述)
2. [核心概念](#二核心概念)
3. [项目结构设计](#三项目结构设计)
4. [LCEL 最佳实践](#四lcel-最佳实践)
5. [Chain 设计模式](#五chain-设计模式)
6. [Tool 开发规范](#六tool-开发规范)
7. [Agent 架构设计](#七agent-架构设计)
8. [Memory 管理](#八memory-管理)
9. [常见踩坑与解决方案](#九常见踩坑与解决方案)
10. [生产环境注意事项](#十生产环境注意事项)
11. [参考资源](#十一参考资源)

---

## 一、概述

### 1.1 什么是 LangChain

LangChain 是一个用于开发大语言模型（LLM）应用的框架，提供了一套完整的工具链：

- **模型 I/O**：统一的各种 LLM 接口封装
- **数据连接**：文档加载、向量存储、检索器
- **链式调用**：将多个组件串联成工作流
- **记忆管理**：对话历史、上下文管理
- **Agent**：让 LLM 自主决定调用哪些工具
- **回调系统**：日志、监控、流式输出

### 1.2 版本演进

```
+------------------------------------------------------------------+
|                    LangChain 版本演进                              |
+------------------------------------------------------------------+
|                                                                   |
|  v0.1.x (2023)                                                   |
|  ├── Chain 为核心（LLMChain, SequentialChain）                    |
|  ├── 硬编码的流程控制                                             |
|  └── 较为臃肿的 API                                               |
|                                                                   |
|  v0.2.x (2024 上半年)                                             |
|  ├── 引入 LCEL（LangChain Expression Language）                   |
|  ├── Runnable 协议统一接口                                        |
|  └── 更灵活的流式处理                                             |
|                                                                   |
|  v0.3.x (2024 下半年 - 当前)                                      |
|  ├── langchain-core 核心                                          |
|  ├── langchain-community 社区集成                                 |
|  ├── langchain-openai/anthropic 等官方集成                        |
|  ├── 完全拥抱 LCEL                                                |
|  └── LangGraph 状态机编排                                         |
|                                                                   |
+------------------------------------------------------------------+
```

### 1.3 核心组件架构

```
+------------------------------------------------------------------+
|                    LangChain 核心组件架构                          |
+------------------------------------------------------------------+
|                                                                   |
|  模型层 (Models)                                                  |
|  ├── Chat Models (ChatOpenAI, ChatAnthropic)                     |
|  ├── LLMs (OpenAI, HuggingFaceHub)                               |
|  └── Embeddings (OpenAIEmbeddings, HuggingFaceEmbeddings)        |
|                                                                   |
|  数据层 (Data)                                                    |
|  ├── Document Loaders (PDF, Web, Database)                       |
|  ├── Text Splitters (Recursive, Markdown, Code)                  |
|  ├── Vector Stores (Chroma, Milvus, Pinecone)                    |
|  └── Retrievers (VectorStoreRetriever, MultiQueryRetriever)      |
|                                                                   |
|  编排层 (Orchestration)                                           |
|  ├── LCEL (| operator, RunnableParallel, RunnablePassthrough)    |
|  ├── Chains (LLMChain, TransformChain)                           |
|  └── LangGraph (StateGraph, Node, Edge)                          |
|                                                                   |
|  智能层 (Intelligence)                                            |
|  ├── Tools (tool decorator, StructuredTool)                      |
|  ├── Agents (ReAct, OpenAI Functions, XML Agent)                 |
|  └── Memory (BufferMemory, VectorStoreMemory)                    |
|                                                                   |
|  集成层 (Integration)                                             |
|  ├── Callbacks (StdOutCallbackHandler)                           |
|  ├── Tracing (LangSmith, Langfuse)                               |
|  └── Streaming (astream, stream_events)                          |
|                                                                   |
+------------------------------------------------------------------+
```

---

## 二、核心概念

### 2.1 Runnable 协议

Runnable 是 LangChain v0.2+ 的核心抽象，所有组件都实现这个协议：

```python
from langchain_core.runnables import Runnable

class Runnable:
    # 同步调用
    def invoke(self, input: Input) -> Output: ...

    # 异步调用
    async def ainvoke(self, input: Input) -> Output: ...

    # 批量调用
    def batch(self, inputs: List[Input]) -> List[Output]: ...

    # 异步批量调用
    async def abatch(self, inputs: List[Input]) -> List[Output]: ...

    # 流式调用
    def stream(self, input: Input) -> Iterator[Output]: ...

    # 异步流式调用
    async def astream(self, input: Input) -> AsyncIterator[Output]: ...

    # 管道操作符
    def __or__(self, other: Runnable) -> Runnable: ...

    # 并行操作
    def __and__(self, other: Runnable) -> Runnable: ...
```

### 2.2 LCEL (LangChain Expression Language)

LCEL 是一种声明式语言，用于组合 Runnable 组件：

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_openai import ChatOpenAI

# 基础链式调用
prompt = ChatPromptTemplate.from_template("告诉我一个关于{topic}的笑话")
model = ChatOpenAI(model="gpt-4o")
output_parser = StrOutputParser()

chain = prompt | model | output_parser

# 调用
result = chain.invoke({"topic": "程序员"})

# 流式调用
async for chunk in chain.astream({"topic": "程序员"}):
    print(chunk, end="", flush=True)

# 批量调用
results = chain.batch([
    {"topic": "程序员"},
    {"topic": "产品经理"},
    {"topic": "设计师"}
])
```

### 2.3 关键类型

```python
from langchain_core.messages import (
    BaseMessage,
    HumanMessage,      # 用户消息
    AIMessage,         # AI 消息
    SystemMessage,     # 系统消息
    FunctionMessage,   # 函数调用结果
    ToolMessage,       # 工具调用结果
)
from langchain_core.documents import Document
from langchain_core.tools import BaseTool, tool
from langchain_core.prompts import (
    ChatPromptTemplate,
    MessagesPlaceholder,
    PromptTemplate,
)
```

---

## 三、项目结构设计

### 3.1 推荐的项目结构

```
project/
├── agents/                     # Agent 相关
│   ├── __init__.py
│   ├── base.py                # Agent 基类
│   ├── travel_agent.py        # 旅行 Agent
│   └── customer_service_agent.py
│
├── tools/                      # 工具定义
│   ├── __init__.py
│   ├── base.py                # 工具基类
│   ├── hotel_tool.py          # 酒店搜索工具
│   ├── flight_tool.py         # 机票搜索工具
│   ├── weather_tool.py        # 天气查询工具
│   └── knowledge_tool.py      # 知识库检索工具
│
├── chains/                     # 链式调用
│   ├── __init__.py
│   ├── rag_chain.py           # RAG 链
│   ├── summarize_chain.py     # 摘要链
│   └── classify_chain.py      # 分类链
│
├── retrievers/                 # 检索器
│   ├── __init__.py
│   ├── hybrid_retriever.py    # 混合检索器
│   └── contextual_retriever.py
│
├── memory/                     # 记忆管理
│   ├── __init__.py
│   ├── redis_memory.py        # Redis 记忆
│   └── conversation_memory.py
│
├── prompts/                    # Prompt 模板
│   ├── __init__.py
│   ├── system_prompts.py      # System Prompt
│   └── few_shot_examples.py   # Few-shot 示例
│
├── loaders/                    # 文档加载器
│   ├── __init__.py
│   ├── pdf_loader.py
│   └── web_loader.py
│
├── config/                     # 配置
│   ├── __init__.py
│   ├── settings.py            # 配置管理
│   └── logging.py             # 日志配置
│
├── utils/                      # 工具函数
│   ├── __init__.py
│   ├── token_counter.py       # Token 计数
│   └── cache.py               # 缓存
│
├── tests/                      # 测试
│   ├── test_agents/
│   ├── test_tools/
│   └── test_chains/
│
├── main.py                     # 入口
├── requirements.txt
└── README.md
```

### 3.2 配置管理

```python
# config/settings.py
from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    """应用配置"""

    # LLM 配置
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    openai_temperature: float = 0.7

    # 向量存储配置
    vector_store_type: str = "milvus"
    milvus_host: str = "localhost"
    milvus_port: int = 19530

    # Redis 配置
    redis_url: str = "redis://localhost:6379"

    # 记忆配置
    memory_max_tokens: int = 4000
    memory_ttl: int = 86400  # 24小时

    # 日志配置
    log_level: str = "INFO"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

@lru_cache()
def get_settings() -> Settings:
    """获取配置单例"""
    return Settings()

# 使用
settings = get_settings()
```

---

## 四、LCEL 最佳实践

### 4.1 基础模式

```python
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough, RunnableParallel
from langchain_openai import ChatOpenAI

# ========== 模式1：简单链 ==========

def simple_chain():
    """简单链式调用"""
    prompt = ChatPromptTemplate.from_template(
        "你是一个{role}，请回答：{question}"
    )
    model = ChatOpenAI(model="gpt-4o")
    parser = StrOutputParser()

    chain = prompt | model | parser

    return chain.invoke({
        "role": "旅行专家",
        "question": "推荐北京三日游行程"
    })


# ========== 模式2：带默认值 ==========

def chain_with_defaults():
    """带默认值的链"""
    prompt = ChatPromptTemplate.from_messages([
        ("system", "你是一个{role}。"),
        ("human", "{question}")
    ])

    model = ChatOpenAI(model="gpt-4o")
    parser = StrOutputParser()

    # 使用 RunnablePassthrough 设置默认值
    chain = (
        {
            "role": lambda x: x.get("role", "助手"),
            "question": RunnablePassthrough()
        }
        | prompt
        | model
        | parser
    )

    return chain.invoke({"question": "你好"})


# ========== 模式3：并行处理 ==========

def parallel_chain():
    """并行处理多个任务"""
    model = ChatOpenAI(model="gpt-4o")
    parser = StrOutputParser()

    # 摘要链
    summary_prompt = ChatPromptTemplate.from_template(
        "请用一句话总结以下内容：\n{text}"
    )
    summary_chain = summary_prompt | model | parser

    # 情感分析链
    sentiment_prompt = ChatPromptTemplate.from_template(
        "请分析以下内容的情感（积极/消极/中性）：\n{text}"
    )
    sentiment_chain = sentiment_prompt | model | parser

    # 关键词提取链
    keywords_prompt = ChatPromptTemplate.from_template(
        "请提取以下内容的关键词（逗号分隔）：\n{text}"
    )
    keywords_chain = keywords_prompt | model | parser

    # 并行执行
    parallel_chain = RunnableParallel(
        summary=summary_chain,
        sentiment=sentiment_chain,
        keywords=keywords_chain
    )

    text = "今天天气真好，阳光明媚，适合出去旅游..."
    return parallel_chain.invoke({"text": text})


# ========== 模式4：条件分支 ==========

from langchain_core.runnables import RunnableBranch

def conditional_chain():
    """条件分支链"""
    model = ChatOpenAI(model="gpt-4o")
    parser = StrOutputParser()

    # 分类链
    classify_prompt = ChatPromptTemplate.from_template(
        "请判断以下问题属于哪个类别（天气/旅游/其他）：\n{question}\n只输出类别名。"
    )
    classify_chain = classify_prompt | model | parser

    # 天气回答链
    weather_prompt = ChatPromptTemplate.from_template(
        "你是一个天气专家。请回答：{question}"
    )
    weather_chain = weather_prompt | model | parser

    # 旅游回答链
    travel_prompt = ChatPromptTemplate.from_template(
        "你是一个旅游专家。请回答：{question}"
    )
    travel_chain = travel_prompt | model | parser

    # 默认回答链
    default_prompt = ChatPromptTemplate.from_template(
        "请回答：{question}"
    )
    default_chain = default_prompt | model | parser

    # 条件分支
    branch_chain = RunnableBranch(
        (lambda x: "天气" in x["category"], weather_chain),
        (lambda x: "旅游" in x["category"], travel_chain),
        default_chain
    )

    # 组合
    full_chain = (
        {
            "category": classify_chain,
            "question": lambda x: x["question"]
        }
        | branch_chain
    )

    return full_chain.invoke({"question": "北京明天天气怎么样"})
```

### 4.2 流式处理

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from langchain_core.output_parsers import StrOutputParser

async def streaming_example():
    """流式处理示例"""

    prompt = ChatPromptTemplate.from_template(
        "请详细介绍{city}的旅游攻略"
    )
    model = ChatOpenAI(model="gpt-4o", streaming=True)
    parser = StrOutputParser()

    chain = prompt | model | parser

    # 方式1：async for
    async for chunk in chain.astream({"city": "北京"}):
        print(chunk, end="", flush=True)

    # 方式2：stream_events（获取更多元数据）
    async for event in chain.astream_events(
        {"city": "北京"},
        version="v2"
    ):
        if event["event"] == "on_chat_model_stream":
            print(event["data"]["chunk"].content, end="", flush=True)


# FastAPI 集成
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI()

@app.get("/chat/stream")
async def chat_stream(question: str):
    """SSE 流式响应"""

    async def generate():
        prompt = ChatPromptTemplate.from_template("{question}")
        model = ChatOpenAI(model="gpt-4o", streaming=True)
        parser = StrOutputParser()

        chain = prompt | model | parser

        async for chunk in chain.astream({"question": question}):
            yield f"data: {chunk}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream"
    )
```

### 4.3 错误处理与重试

```python
from langchain_core.runnables import RunnableRetry, RunnableLambda
from tenacity import retry, stop_after_attempt, wait_exponential
import logging

logger = logging.getLogger(__name__)

# ========== 方式1：RunnableRetry ==========

def with_retry():
    """使用 RunnableRetry"""
    model = ChatOpenAI(model="gpt-4o")

    # 配置重试
    chain_with_retry = (
        ChatPromptTemplate.from_template("{question}")
        | model
        | StrOutputParser()
    ).with_retry(
        stop_after_attempt=3,
        wait_exponential_jitter=True,
        retry_if_exception_type=(Exception,)
    )

    return chain_with_retry


# ========== 方式2：自定义错误处理 ==========

def with_error_handling():
    """带错误处理的链"""

    def handle_error(error, input_data):
        """错误处理函数"""
        logger.error(f"Chain error: {error}", exc_info=True)

        # 根据错误类型返回不同的降级响应
        if "rate_limit" in str(error).lower():
            return "服务繁忙，请稍后重试"
        elif "timeout" in str(error).lower():
            return "请求超时，请重试"
        else:
            return "抱歉，处理您的请求时出现错误"

    model = ChatOpenAI(model="gpt-4o")
    prompt = ChatPromptTemplate.from_template("{question}")

    chain = (
        prompt
        | model
        | StrOutputParser()
    ).with_fallbacks(
        [RunnableLambda(handle_error)],
        exceptions_to_handle=(Exception,)
    )

    return chain


# ========== 方式3：装饰器方式 ==========

def robust_invoke(func):
    """健壮的调用装饰器"""
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True
    )
    async def wrapper(*args, **kwargs):
        try:
            return await func(*args, **kwargs)
        except Exception as e:
            logger.error(f"Invoke failed: {e}")
            raise
    return wrapper


class RobustChain:
    """健壮的 Chain 封装"""

    def __init__(self, chain):
        self.chain = chain

    @robust_invoke
    async def ainvoke(self, input_data: dict):
        return await self.chain.ainvoke(input_data)

    @robust_invoke
    async def astream(self, input_data: dict):
        async for chunk in self.chain.astream(input_data):
            yield chunk
```

---

## 五、Chain 设计模式

### 5.1 RAG Chain

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough, RunnableParallel
from langchain_openai import ChatOpenAI
from langchain_community.vectorstores import Chroma
from langchain_openai import OpenAIEmbeddings

def create_rag_chain(vector_store):
    """创建 RAG 链"""

    # 检索器
    retriever = vector_store.as_retriever(
        search_type="similarity",
        search_kwargs={"k": 5}
    )

    # Prompt 模板
    prompt = ChatPromptTemplate.from_messages([
        ("system", """你是一个知识问答助手。请基于以下参考文档回答用户问题。

参考文档：
{context}

要求：
1. 只基于参考文档中的信息回答
2. 如果参考文档不足以回答问题，请诚实告知
3. 引用具体信息时，标注来源"""),
        ("human", "{question}")
    ])

    # LLM
    model = ChatOpenAI(model="gpt-4o", temperature=0)

    # 格式化文档
    def format_docs(docs):
        return "\n\n---\n\n".join(
            f"【文档{i+1}】\n来源：{doc.metadata.get('source', '未知')}\n内容：{doc.page_content}"
            for i, doc in enumerate(docs)
        )

    # 组装 RAG 链
    rag_chain = (
        {
            "context": retriever | format_docs,
            "question": RunnablePassthrough()
        }
        | prompt
        | model
        | StrOutputParser()
    )

    return rag_chain


# 使用示例
def rag_example():
    # 创建向量存储
    embeddings = OpenAIEmbeddings()
    vector_store = Chroma(
        embedding_function=embeddings,
        persist_directory="./chroma_db"
    )

    # 创建 RAG 链
    rag_chain = create_rag_chain(vector_store)

    # 查询
    answer = rag_chain.invoke("什么是 RAG？")
    print(answer)
```

### 5.2 对话链

```python
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough
from langchain_openai import ChatOpenAI
from langchain_core.chat_history import BaseChatMessageHistory
from langchain_community.chat_message_histories import RedisChatMessageHistory
from pydantic import BaseModel

class ConversationChain:
    """对话链"""

    def __init__(
        self,
        session_id: str,
        redis_url: str = "redis://localhost:6379",
        max_history_tokens: int = 4000
    ):
        self.session_id = session_id
        self.max_history_tokens = max_history_tokens

        # 记忆存储
        self.history = RedisChatMessageHistory(
            session_id=session_id,
            url=redis_url
        )

        # 创建链
        self.chain = self._create_chain()

    def _create_chain(self):
        """创建对话链"""
        prompt = ChatPromptTemplate.from_messages([
            ("system", "你是一个友好的助手。"),
            MessagesPlaceholder(variable_name="history"),
            ("human", "{input}")
        ])

        model = ChatOpenAI(model="gpt-4o")

        chain = (
            {
                "history": lambda x: self._get_history(),
                "input": RunnablePassthrough()
            }
            | prompt
            | model
            | StrOutputParser()
        )

        return chain

    def _get_history(self):
        """获取历史消息"""
        messages = self.history.messages

        # Token 限制
        total_tokens = 0
        limited_messages = []

        for msg in reversed(messages):
            msg_tokens = len(msg.content) // 4  # 粗略估计
            if total_tokens + msg_tokens > self.max_history_tokens:
                break
            limited_messages.insert(0, msg)
            total_tokens += msg_tokens

        return limited_messages

    def chat(self, user_input: str) -> str:
        """对话"""
        # 生成回复
        response = self.chain.invoke({"input": user_input})

        # 保存历史
        from langchain_core.messages import HumanMessage, AIMessage
        self.history.add_message(HumanMessage(content=user_input))
        self.history.add_message(AIMessage(content=response))

        return response

    def clear_history(self):
        """清除历史"""
        self.history.clear()
```

### 5.3 分类链

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field
from typing import List, Optional
from enum import Enum

# ========== 定义输出结构 ==========

class IntentCategory(str, Enum):
    """意图类别"""
    HOTEL_SEARCH = "hotel_search"
    FLIGHT_SEARCH = "flight_search"
    WEATHER_QUERY = "weather_query"
    ATTRACTION_RECOMMEND = "attraction_recommend"
    GENERAL_CHAT = "general_chat"
    COMPLAINT = "complaint"

class IntentResult(BaseModel):
    """意图识别结果"""
    category: IntentCategory = Field(description="意图类别")
    confidence: float = Field(description="置信度", ge=0, le=1)
    entities: dict = Field(description="提取的实体", default_factory=dict)
    sub_intents: List[str] = Field(description="子意图", default_factory=list)

class IntentClassifier:
    """意图分类器"""

    def __init__(self):
        self.chain = self._create_chain()

    def _create_chain(self):
        """创建分类链"""
        parser = PydanticOutputParser(pydantic_object=IntentResult)

        prompt = ChatPromptTemplate.from_messages([
            ("system", """你是一个意图识别专家。请分析用户输入，识别意图类别。

可用的意图类别：
- hotel_search: 酒店搜索
- flight_search: 机票搜索
- weather_query: 天气查询
- attraction_recommend: 景点推荐
- general_chat: 闲聊
- complaint: 投诉

{format_instructions}"""),
            ("human", "{input}")
        ])

        model = ChatOpenAI(
            model="gpt-4o",
            temperature=0
        )

        chain = (
            {
                "input": RunnablePassthrough(),
                "format_instructions": lambda x: parser.get_format_instructions()
            }
            | prompt
            | model
            | parser
        )

        return chain

    def classify(self, user_input: str) -> IntentResult:
        """分类"""
        return self.chain.invoke(user_input)


# 使用示例
def classify_example():
    classifier = IntentClassifier()

    result = classifier.classify("我想找北京明天入住的酒店")
    print(f"意图: {result.category}")
    print(f"置信度: {result.confidence}")
    print(f"实体: {result.entities}")
```

---

## 六、Tool 开发规范

### 6.1 工具定义规范

```python
from langchain_core.tools import tool, BaseTool, StructuredTool
from pydantic import BaseModel, Field
from typing import Optional, List, Type
from abc import abstractmethod
import httpx

# ========== 方式1：@tool 装饰器（推荐） ==========

class HotelSearchParams(BaseModel):
    """酒店搜索参数"""
    city: str = Field(description="城市名称，如：北京、上海")
    check_in: str = Field(description="入住日期，格式：YYYY-MM-DD")
    check_out: str = Field(description="离店日期，格式：YYYY-MM-DD")
    price_max: Optional[int] = Field(default=None, description="最高价格（元）")
    keywords: Optional[str] = Field(default=None, description="关键词，如：近地铁、有早餐")

@tool(args_schema=HotelSearchParams)
def search_hotel(
    city: str,
    check_in: str,
    check_out: str,
    price_max: Optional[int] = None,
    keywords: Optional[str] = None
) -> str:
    """
    搜索酒店信息。

    适用场景：
    - 用户询问酒店、住宿、宾馆相关问题时使用此工具
    - 需要查询酒店价格、位置、设施等信息

    参数说明：
    - city: 必填，城市名称
    - check_in/check_out: 必填，日期格式为 YYYY-MM-DD
    - price_max: 可选，用于过滤价格
    """
    # 实际实现（调用 API）
    result = f"在{city}找到了{check_in}到{check_out}期间"
    if price_max:
        result += f"价格低于{price_max}元的"
    result += "酒店信息..."

    return result


# ========== 方式2：继承 BaseTool ==========

class WeatherTool(BaseTool):
    """天气查询工具"""

    name: str = "query_weather"
    description: str = """查询天气信息。

适用场景：
- 用户询问天气、气温、降雨等情况
- 需要了解某地的天气状况

参数说明：
- city: 城市名称
- date: 日期（可选，默认今天）
"""

    class InputSchema(BaseModel):
        city: str = Field(description="城市名称")
        date: Optional[str] = Field(default=None, description="日期，格式：YYYY-MM-DD")

    args_schema: Type[BaseModel] = InputSchema

    def _run(
        self,
        city: str,
        date: Optional[str] = None
    ) -> str:
        """同步执行"""
        # 实际调用天气 API
        return f"{city}的天气信息：晴，温度 25°C"

    async def _arun(
        self,
        city: str,
        date: Optional[str] = None
    ) -> str:
        """异步执行"""
        async with httpx.AsyncClient() as client:
            # 调用天气 API
            response = await client.get(
                f"https://api.weather.com/v1/{city}",
                params={"date": date}
            )
            return response.json()


# ========== 方式3：StructuredTool ==========

def _search_flight(
    from_city: str,
    to_city: str,
    date: str,
    **kwargs
) -> str:
    """机票搜索实现"""
    return f"从{from_city}到{to_city}的机票信息..."


class FlightSearchParams(BaseModel):
    from_city: str = Field(description="出发城市")
    to_city: str = Field(description="到达城市")
    date: str = Field(description="出发日期，格式：YYYY-MM-DD")

search_flight_tool = StructuredTool(
    name="search_flight",
    description="""搜索机票信息。

适用场景：
- 用户询问机票、航班、飞机票相关问题时使用
- 需要查询航班时刻、价格等信息
""",
    func=_search_flight,
    args_schema=FlightSearchParams
)
```

### 6.2 工具管理器

```python
from typing import Dict, List, Optional
from langchain_core.tools import BaseTool
import logging

logger = logging.getLogger(__name__)

class ToolRegistry:
    """工具注册中心"""

    def __init__(self):
        self._tools: Dict[str, BaseTool] = {}
        self._categories: Dict[str, List[str]] = {}

    def register(
        self,
        tool: BaseTool,
        category: str = "general"
    ) -> None:
        """注册工具"""
        if tool.name in self._tools:
            logger.warning(f"Tool {tool.name} already registered, overwriting")

        self._tools[tool.name] = tool

        if category not in self._categories:
            self._categories[category] = []
        self._categories[category].append(tool.name)

        logger.info(f"Registered tool: {tool.name} in category: {category}")

    def get(self, name: str) -> Optional[BaseTool]:
        """获取工具"""
        return self._tools.get(name)

    def get_all(self) -> List[BaseTool]:
        """获取所有工具"""
        return list(self._tools.values())

    def get_by_category(self, category: str) -> List[BaseTool]:
        """按类别获取工具"""
        tool_names = self._categories.get(category, [])
        return [self._tools[name] for name in tool_names]

    def get_tool_descriptions(self) -> str:
        """获取所有工具描述"""
        descriptions = []

        for category, tool_names in self._categories.items():
            descriptions.append(f"\n## {category}")
            for name in tool_names:
                tool = self._tools[name]
                descriptions.append(f"- {name}: {tool.description.split(chr(10))[0]}")

        return "\n".join(descriptions)


# 全局注册中心
tool_registry = ToolRegistry()

# 注册工具
tool_registry.register(search_hotel, category="travel")
tool_registry.register(WeatherTool(), category="weather")
tool_registry.register(search_flight_tool, category="travel")
```

### 6.3 工具调用追踪

```python
from langchain_core.callbacks import BaseCallbackHandler
from typing import Any, Dict, List, Optional
from langchain_core.agents import AgentAction
import time
import json

class ToolCallTracer(BaseCallbackHandler):
    """工具调用追踪器"""

    def __init__(self):
        self.tool_calls: List[Dict] = []
        self.current_call: Optional[Dict] = None

    def on_tool_start(
        self,
        serialized: Dict[str, Any],
        input_str: str,
        **kwargs: Any
    ) -> None:
        """工具开始"""
        tool_name = serialized.get("name", "unknown")

        self.current_call = {
            "tool": tool_name,
            "input": input_str,
            "start_time": time.time(),
            "end_time": None,
            "output": None,
            "error": None,
            "duration_ms": None
        }

    def on_tool_end(
        self,
        output: str,
        **kwargs: Any
    ) -> None:
        """工具结束"""
        if self.current_call:
            self.current_call["end_time"] = time.time()
            self.current_call["output"] = output
            self.current_call["duration_ms"] = (
                self.current_call["end_time"] - self.current_call["start_time"]
            ) * 1000

            self.tool_calls.append(self.current_call)
            self.current_call = None

    def on_tool_error(
        self,
        error: Exception,
        **kwargs: Any
    ) -> None:
        """工具错误"""
        if self.current_call:
            self.current_call["end_time"] = time.time()
            self.current_call["error"] = str(error)
            self.current_call["duration_ms"] = (
                self.current_call["end_time"] - self.current_call["start_time"]
            ) * 1000

            self.tool_calls.append(self.current_call)
            self.current_call = None

    def get_summary(self) -> Dict:
        """获取调用摘要"""
        total_calls = len(self.tool_calls)
        total_duration = sum(
            call.get("duration_ms", 0) or 0
            for call in self.tool_calls
        )
        errors = sum(1 for call in self.tool_calls if call.get("error"))

        return {
            "total_calls": total_calls,
            "total_duration_ms": total_duration,
            "errors": errors,
            "tool_calls": self.tool_calls
        }


# 使用示例
def trace_tool_calls():
    tracer = ToolCallTracer()

    # 创建带追踪的链
    model = ChatOpenAI(model="gpt-4o")
    tools = [search_hotel, WeatherTool()]

    agent = create_tool_calling_agent(model, tools)
    agent_executor = AgentExecutor(
        agent=agent,
        tools=tools,
        callbacks=[tracer]
    )

    # 执行
    result = agent_executor.invoke({
        "input": "北京明天天气怎么样"
    })

    # 获取追踪结果
    summary = tracer.get_summary()
    print(json.dumps(summary, indent=2, ensure_ascii=False))
```

---

## 七、Agent 架构设计

### 7.1 ReAct Agent

```python
from langchain_openai import ChatOpenAI
from langchain.agents import create_react_agent, AgentExecutor
from langchain_core.prompts import PromptTemplate
from typing import List
from langchain_core.tools import BaseTool

def create_react_agent_system(
    tools: List[BaseTool],
    model_name: str = "gpt-4o"
) -> AgentExecutor:
    """创建 ReAct Agent"""

    # ReAct Prompt 模板
    template = """你是一个智能助手，可以使用工具来帮助用户解决问题。

你可以使用以下工具：
{tool_names}

工具详情：
{tools}

请使用以下格式回答：

Question: 用户的问题
Thought: 你应该思考要做什么
Action: 要使用的工具名称（必须是 [{tool_names}] 中的一个）
Action Input: 工具的输入参数（JSON 格式）
Observation: 工具的返回结果
... (Thought/Action/Action Input/Observation 可以重复多次)
Thought: 我现在知道最终答案了
Final Answer: 对用户问题的最终回答

开始！

Question: {input}
Thought: {agent_scratchpad}"""

    prompt = PromptTemplate.from_template(template)

    # 创建 LLM
    llm = ChatOpenAI(model=model_name, temperature=0)

    # 创建 Agent
    agent = create_react_agent(llm, tools, prompt)

    # 创建 Executor
    agent_executor = AgentExecutor(
        agent=agent,
        tools=tools,
        verbose=True,
        handle_parsing_errors=True,
        max_iterations=10
    )

    return agent_executor
```

### 7.2 Tool Calling Agent（推荐）

```python
from langchain_openai import ChatOpenAI
from langchain.agents import create_tool_calling_agent, AgentExecutor
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.tools import BaseTool
from typing import List

def create_tool_calling_agent_system(
    tools: List[BaseTool],
    system_prompt: str = None,
    model_name: str = "gpt-4o"
) -> AgentExecutor:
    """创建 Tool Calling Agent（OpenAI Functions）"""

    # System Prompt
    default_system = """你是一个智能助手，可以使用工具帮助用户解决问题。

## 工具使用指南
1. 根据用户问题选择合适的工具
2. 正确填写工具参数
3. 如果一个工具不够，可以连续调用多个工具
4. 综合工具返回的信息，给用户完整的回答

## 注意事项
- 不要编造不存在的工具
- 工具参数要准确，特别是日期格式
- 如果工具调用失败，向用户说明情况"""

    # Prompt 模板
    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt or default_system),
        MessagesPlaceholder(variable_name="chat_history", optional=True),
        ("human", "{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad"),
    ])

    # 创建 LLM
    llm = ChatOpenAI(model=model_name, temperature=0)

    # 创建 Agent
    agent = create_tool_calling_agent(llm, tools, prompt)

    # 创建 Executor
    agent_executor = AgentExecutor(
        agent=agent,
        tools=tools,
        verbose=True,
        handle_parsing_errors=True,
        max_iterations=10,
        return_intermediate_steps=True  # 返回中间步骤
    )

    return agent_executor


# 使用示例
def tool_calling_agent_example():
    from langchain_core.tools import tool

    @tool
    def get_weather(city: str) -> str:
        """获取城市天气"""
        return f"{city}今天晴天，温度25°C"

    @tool
    def search_hotel(city: str, date: str) -> str:
        """搜索酒店"""
        return f"{city}在{date}有10家酒店可选"

    tools = [get_weather, search_hotel]

    agent = create_tool_calling_agent_system(tools)

    result = agent.invoke({
        "input": "北京明天天气怎么样，帮我找个酒店"
    })

    print(result["output"])
    print("中间步骤:", result["intermediate_steps"])
```

### 7.3 自定义 Agent

```python
from langchain_core.agents import AgentAction, AgentFinish
from langchain_core.callbacks import CallbackManagerForToolRun
from langchain_openai import ChatOpenAI
from langchain_core.tools import BaseTool
from typing import List, Tuple, Any, Union
from abc import abstractmethod
import json

class CustomAgent:
    """自定义 Agent 基类"""

    def __init__(
        self,
        llm: ChatOpenAI,
        tools: List[BaseTool],
        max_iterations: int = 10
    ):
        self.llm = llm
        self.tools = {tool.name: tool for tool in tools}
        self.max_iterations = max_iterations

    def plan(
        self,
        input: str,
        intermediate_steps: List[Tuple[AgentAction, str]]
    ) -> Union[AgentAction, AgentFinish]:
        """规划下一步行动"""
        # 子类实现
        raise NotImplementedError

    def execute_tool(
        self,
        action: AgentAction,
        run_manager: CallbackManagerForToolRun = None
    ) -> str:
        """执行工具"""
        tool = self.tools.get(action.tool)

        if tool is None:
            return f"Error: Unknown tool {action.tool}"

        try:
            # 解析参数
            if isinstance(action.tool_input, str):
                tool_input = json.loads(action.tool_input)
            else:
                tool_input = action.tool_input

            # 执行工具
            return tool.invoke(tool_input)

        except Exception as e:
            return f"Error executing tool {action.tool}: {str(e)}"

    def run(self, input: str) -> str:
        """运行 Agent"""
        intermediate_steps = []

        for iteration in range(self.max_iterations):
            # 规划
            action = self.plan(input, intermediate_steps)

            # 检查是否结束
            if isinstance(action, AgentFinish):
                return action.return_values.get("output", "")

            # 执行工具
            observation = self.execute_tool(action)

            # 记录步骤
            intermediate_steps.append((action, observation))

        return "达到最大迭代次数，任务未完成"


class TravelAgent(CustomAgent):
    """旅行 Agent"""

    def __init__(self, llm: ChatOpenAI, tools: List[BaseTool]):
        super().__init__(llm, tools)

        self.system_prompt = """你是一个旅行助手，可以帮助用户规划旅行。
你可以使用以下工具：
{tool_descriptions}

请根据用户输入，决定使用哪个工具。"""

    def plan(
        self,
        input: str,
        intermediate_steps: List[Tuple[AgentAction, str]]
    ) -> Union[AgentAction, AgentFinish]:
        """规划下一步"""

        # 构建历史
        history = ""
        for action, observation in intermediate_steps:
            history += f"Action: {action.tool}\n"
            history += f"Action Input: {action.tool_input}\n"
            history += f"Observation: {observation}\n\n"

        # 构建 Prompt
        prompt = f"""{self.system_prompt}

用户输入：{input}

历史步骤：
{history}

请决定下一步：
1. 如果需要更多信息，选择一个工具调用
2. 如果已经有足够信息，返回最终答案

以 JSON 格式输出：
{{"thought": "思考过程", "action": "工具名或FINISH", "action_input": {{参数}}, "answer": "最终答案（如果action是FINISH）"}}"""

        # 调用 LLM
        response = self.llm.invoke(prompt)

        # 解析响应
        try:
            parsed = json.loads(response.content)

            if parsed["action"] == "FINISH":
                return AgentFinish(
                    return_values={"output": parsed["answer"]},
                    log=parsed["thought"]
                )
            else:
                return AgentAction(
                    tool=parsed["action"],
                    tool_input=parsed["action_input"],
                    log=parsed["thought"]
                )
        except:
            # 解析失败，返回错误
            return AgentFinish(
                return_values={"output": "抱歉，处理您的请求时出现问题"},
                log="解析失败"
            )
```

---

## 八、Memory 管理

### 8.1 Memory 类型

```
+------------------------------------------------------------------+
|                    LangChain Memory 类型                          |
+------------------------------------------------------------------+
|                                                                   |
|  短期记忆                                                         |
|  ├── ConversationBufferMemory        保存完整对话                |
|  ├── ConversationBufferWindowMemory  保存最近 N 轮对话           |
|  └── ConversationTokenBufferMemory   按 Token 限制保存           |
|                                                                   |
|  长期记忆                                                         |
|  ├── VectorStoreRetrieverMemory     向量检索历史                 |
|  └── ConversationKGMemory           知识图谱记忆                 |
|                                                                   |
|  压缩记忆                                                         |
|  ├── ConversationSummaryMemory      摘要压缩                     |
|  └── ConversationSummaryBufferMemory 摘要+最近对话               |
|                                                                   |
+------------------------------------------------------------------+
```

### 8.2 Redis Memory 实现

```python
from langchain_core.chat_history import BaseChatMessageHistory
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, messages_from_dict, messages_to_dict
from typing import List
import redis
import json
from datetime import datetime

class RedisChatMessageHistory(BaseChatMessageHistory):
    """Redis 对话历史"""

    def __init__(
        self,
        session_id: str,
        url: str = "redis://localhost:6379",
        ttl: int = 86400,  # 24小时
        key_prefix: str = "chat_history:"
    ):
        self.session_id = session_id
        self.ttl = ttl
        self.key_prefix = key_prefix

        # 连接 Redis
        self.redis = redis.from_url(url)
        self.key = f"{key_prefix}{session_id}"

    @property
    def messages(self) -> List[BaseMessage]:
        """获取所有消息"""
        data = self.redis.lrange(self.key, 0, -1)
        messages = []

        for item in data:
            msg_dict = json.loads(item)
            messages.append(messages_from_dict([msg_dict])[0])

        return messages

    def add_message(self, message: BaseMessage) -> None:
        """添加消息"""
        # 添加元数据
        msg_dict = messages_to_dict([message])[0]
        msg_dict["timestamp"] = datetime.now().isoformat()

        # 存储到 Redis
        self.redis.rpush(self.key, json.dumps(msg_dict, ensure_ascii=False))

        # 设置过期时间
        self.redis.expire(self.key, self.ttl)

    def clear(self) -> None:
        """清除历史"""
        self.redis.delete(self.key)

    def get_messages_by_time(
        self,
        start_time: datetime,
        end_time: datetime
    ) -> List[BaseMessage]:
        """按时间获取消息"""
        all_messages = self.messages
        filtered = []

        for msg in all_messages:
            # 获取时间戳（假设已存储在 additional_kwargs 中）
            timestamp_str = msg.additional_kwargs.get("timestamp")
            if timestamp_str:
                timestamp = datetime.fromisoformat(timestamp_str)
                if start_time <= timestamp <= end_time:
                    filtered.append(msg)

        return filtered

    def get_recent_messages(self, n: int = 10) -> List[BaseMessage]:
        """获取最近 N 条消息"""
        return self.messages[-n:] if self.messages else []
```

### 8.3 压缩 Memory

```python
from langchain_openai import ChatOpenAI
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from typing import List

class SummaryMemory:
    """摘要压缩记忆"""

    def __init__(
        self,
        llm: ChatOpenAI,
        max_tokens: int = 1000,
        keep_recent: int = 3
    ):
        self.llm = llm
        self.max_tokens = max_tokens
        self.keep_recent = keep_recent
        self.summary = ""
        self.recent_messages: List[BaseMessage] = []

    def add_message(self, message: BaseMessage) -> None:
        """添加消息"""
        self.recent_messages.append(message)

        # 如果超过保留数量，压缩旧消息
        if len(self.recent_messages) > self.keep_recent:
            old_messages = self.recent_messages[:-self.keep_recent]
            self.recent_messages = self.recent_messages[-self.keep_recent:]

            # 更新摘要
            self._update_summary(old_messages)

    def _update_summary(self, messages: List[BaseMessage]) -> None:
        """更新摘要"""
        # 构建摘要 Prompt
        history_text = "\n".join([
            f"{msg.type}: {msg.content}"
            for msg in messages
        ])

        prompt = f"""请将以下对话历史压缩成简短的摘要，保留关键信息：

当前摘要：
{self.summary}

新增对话：
{history_text}

请输出更新后的摘要（不超过200字）："""

        # 调用 LLM 生成摘要
        response = self.llm.invoke(prompt)
        self.summary = response.content

    def get_context(self) -> List[BaseMessage]:
        """获取上下文"""
        context = []

        # 添加摘要
        if self.summary:
            context.append(SystemMessage(
                content=f"[对话摘要] {self.summary}"
            ))

        # 添加最近消息
        context.extend(self.recent_messages)

        return context
```

---

## 九、常见踩坑与解决方案

### 9.1 版本兼容问题

#### 坑1：API 变更导致报错

```python
# ❌ 错误：使用旧版 API
from langchain.chains import LLMChain
chain = LLMChain(llm=llm, prompt=prompt)
result = chain.run("你好")  # 已弃用

# ✅ 正确：使用新版 LCEL
chain = prompt | llm | StrOutputParser()
result = chain.invoke({"input": "你好"})

# ✅ 错误处理：锁定版本
# requirements.txt
langchain==0.3.0
langchain-core==0.3.0
langchain-openai==0.2.0
langchain-community==0.3.0
```

#### 坑2：导入路径变更

```python
# ❌ 错误：旧导入路径
from langchain.embeddings import OpenAIEmbeddings  # 已弃用

# ✅ 正确：新导入路径
from langchain_openai import OpenAIEmbeddings

# ❌ 错误：旧导入路径
from langchain.vectorstores import Chroma  # 已弃用

# ✅ 正确：新导入路径
from langchain_community.vectorstores import Chroma
```

### 9.2 工具定义问题

#### 坑3：工具描述模糊

```python
# ❌ 错误：描述过于简单
@tool
def search(query: str) -> str:
    """搜索"""
    pass

# ✅ 正确：详细的描述
@tool
def search_train(
    from_station: str = Field(description="出发站名称，如：北京南"),
    to_station: str = Field(description="到达站名称，如：上海虹桥"),
    date: str = Field(description="出发日期，格式：YYYY-MM-DD")
) -> str:
    """
    查询火车票信息。

    适用场景：
    - 用户询问火车、高铁、动车票
    - 需要查询班次、票价、余票

    不适用：
    - 机票查询（请使用 search_flight）
    - 汽车票查询
    """
    pass
```

#### 坑4：工具参数类型错误

```python
# ❌ 错误：参数类型不明确
@tool
def search(date):  # 没有类型注解
    """搜索"""
    pass

# ✅ 正确：明确的参数类型
from typing import Optional
from pydantic import BaseModel, Field

class SearchParams(BaseModel):
    date: str = Field(description="日期，格式：YYYY-MM-DD")
    location: Optional[str] = Field(default=None, description="位置")

@tool(args_schema=SearchParams)
def search(date: str, location: Optional[str] = None) -> str:
    """搜索"""
    pass
```

### 9.3 性能问题

#### 坑5：同步阻塞异步

```python
# ❌ 错误：在异步函数中调用同步方法
async def agent_loop(query: str):
    result = llm.invoke(query)  # 阻塞！
    return result

# ✅ 正确：使用异步方法
async def agent_loop(query: str):
    result = await llm.ainvoke(query)  # 非阻塞
    return result

# ✅ 或使用 run_in_executor
from concurrent.futures import ThreadPoolExecutor
executor = ThreadPoolExecutor()

async def agent_loop(query: str):
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        executor,
        llm.invoke,
        query
    )
    return result
```

#### 坑6：未批量处理

```python
# ❌ 错误：逐个调用
results = []
for query in queries:
    result = chain.invoke(query)  # N 次调用
    results.append(result)

# ✅ 正确：批量调用
results = chain.batch(queries)  # 1 次批量调用

# ✅ 或使用异步批量
results = await chain.abatch(queries)
```

### 9.4 记忆管理问题

#### 坑7：记忆无限增长

```python
# ❌ 错误：不限制记忆大小
chat_history = []
chat_history.append({"role": "user", "content": query})
chat_history.append({"role": "assistant", "content": response})

# ✅ 正确：使用 Token 限制
from langchain.memory import ConversationTokenBufferMemory

memory = ConversationTokenBufferMemory(
    llm=llm,
    max_token_limit=4000
)

# ✅ 或使用窗口限制
from langchain.memory import ConversationBufferWindowMemory

memory = ConversationBufferWindowMemory(
    k=10  # 保留最近 10 轮
)
```

#### 坑8：记忆未持久化

```python
# ❌ 错误：内存存储，重启丢失
memory = ConversationBufferMemory()

# ✅ 正确：持久化到 Redis
from langchain_community.chat_message_histories import RedisChatMessageHistory

history = RedisChatMessageHistory(
    session_id="user_123",
    url="redis://localhost:6379"
)
```

---

## 十、生产环境注意事项

### 10.1 错误处理策略

```python
from langchain_core.runnables import RunnableLambda
from typing import Any, Dict
import logging

logger = logging.getLogger(__name__)

class ProductionChain:
    """生产级 Chain 封装"""

    def __init__(self, chain, fallback_chain=None):
        self.chain = chain
        self.fallback_chain = fallback_chain

    def invoke(self, input_data: Dict) -> str:
        """带错误处理的调用"""
        try:
            return self.chain.invoke(input_data)

        except Exception as e:
            logger.error(f"Chain invoke error: {e}", exc_info=True)

            # 尝试降级
            if self.fallback_chain:
                try:
                    return self.fallback_chain.invoke(input_data)
                except Exception as e2:
                    logger.error(f"Fallback chain error: {e2}")

            # 返回友好错误信息
            return self._get_user_friendly_error(e)

    def _get_user_friendly_error(self, error: Exception) -> str:
        """获取用户友好的错误信息"""
        error_type = type(error).__name__

        if "RateLimitError" in error_type or "rate" in str(error).lower():
            return "服务繁忙，请稍后重试"
        elif "Timeout" in error_type or "timeout" in str(error).lower():
            return "请求超时，请重试"
        else:
            return "抱歉，处理您的请求时出现问题"
```

### 10.2 监控指标

```python
from prometheus_client import Counter, Histogram, Gauge
from langchain_core.callbacks import BaseCallbackHandler
from typing import Any, Dict
import time

# Prometheus 指标
INVOKE_COUNT = Counter(
    'langchain_invoke_total',
    'Total invoke count',
    ['chain_name', 'status']
)

INVOKE_LATENCY = Histogram(
    'langchain_invoke_latency_seconds',
    'Invoke latency in seconds',
    ['chain_name']
)

TOOL_CALL_COUNT = Counter(
    'langchain_tool_call_total',
    'Total tool call count',
    ['tool_name', 'status']
)

class MetricsCallbackHandler(BaseCallbackHandler):
    """指标回调处理器"""

    def __init__(self, chain_name: str):
        self.chain_name = chain_name
        self.start_time = None

    def on_chain_start(
        self,
        serialized: Dict[str, Any],
        inputs: Dict[str, Any],
        **kwargs: Any
    ) -> None:
        self.start_time = time.time()

    def on_chain_end(
        self,
        outputs: Dict[str, Any],
        **kwargs: Any
    ) -> None:
        INVOKE_COUNT.labels(
            chain_name=self.chain_name,
            status='success'
        ).inc()

        if self.start_time:
            latency = time.time() - self.start_time
            INVOKE_LATENCY.labels(chain_name=self.chain_name).observe(latency)

    def on_chain_error(
        self,
        error: Exception,
        **kwargs: Any
    ) -> None:
        INVOKE_COUNT.labels(
            chain_name=self.chain_name,
            status='error'
        ).inc()

    def on_tool_start(
        self,
        serialized: Dict[str, Any],
        input_str: str,
        **kwargs: Any
    ) -> None:
        tool_name = serialized.get('name', 'unknown')
        self._current_tool = tool_name

    def on_tool_end(
        self,
        output: str,
        **kwargs: Any
    ) -> None:
        TOOL_CALL_COUNT.labels(
            tool_name=getattr(self, '_current_tool', 'unknown'),
            status='success'
        ).inc()
```

### 10.3 配置管理

```python
from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import Optional

class LangChainSettings(BaseSettings):
    """LangChain 配置"""

    # LLM 配置
    openai_api_key: str
    openai_base_url: Optional[str] = None
    openai_model: str = "gpt-4o"
    openai_temperature: float = 0.7
    openai_max_tokens: int = 4096

    # 重试配置
    max_retries: int = 3
    retry_delay: float = 1.0

    # 超时配置
    request_timeout: float = 60.0

    # 缓存配置
    enable_cache: bool = True
    cache_ttl: int = 3600

    class Config:
        env_file = ".env"
        env_prefix = "LANGCHAIN_"

@lru_cache()
def get_settings() -> LangChainSettings:
    return LangChainSettings()

def get_llm():
    """获取配置好的 LLM"""
    settings = get_settings()

    return ChatOpenAI(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
        model=settings.openai_model,
        temperature=settings.openai_temperature,
        max_tokens=settings.openai_max_tokens,
        request_timeout=settings.request_timeout,
        max_retries=settings.max_retries
    )
```

---

## 十一、参考资源

### 11.1 官方资源

| 资源 | 链接 |
|------|------|
| 官方文档 | https://python.langchain.com/docs/ |
| API 参考 | https://api.python.langchain.com/ |
| GitHub | https://github.com/langchain-ai/langchain |
| LangSmith | https://www.langchain.com/langsmith |

### 11.2 教程与示例

| 资源 | 说明 |
|------|------|
| LangChain Cookbook | 官方示例集合 |
| LangChain Templates | 预构建的模板 |
| LangServe | 部署 LangChain 应用 |

### 11.3 最佳实践

1. **优先使用 LCEL**：新版推荐使用管道语法
2. **使用 Pydantic 定义输入输出**：类型安全、自动校验
3. **实现异步接口**：生产环境使用异步
4. **添加错误处理和重试**：提高可靠性
5. **集成监控和追踪**：LangSmith、Langfuse
6. **版本锁定**：避免 API 变更导致问题

---

## 更新记录

| 日期 | 版本 | 更新内容 |
|------|------|----------|
| 2026-04-14 | v1.0 | 初始版本 |
