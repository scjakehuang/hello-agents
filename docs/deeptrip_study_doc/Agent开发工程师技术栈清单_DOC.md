# Agent 开发工程师技术栈与知识点清单

## 文档信息

- 作者：徐凯旋
- 邮箱：azouever@gmail.com
- 更新时间：2026-04-14

---

## 一、核心技能图谱

```
+------------------------------------------------------------------+
|                    Agent 开发工程师技能树                         |
+------------------------------------------------------------------+
|                                                                   |
|  +----------------------+    +----------------------+             |
|  |    AI/LLM 基础       |    |    Agent 架构设计     |             |
|  |  - 大模型原理        |    |  - ReAct 循环         |             |
|  |  - Prompt Engineering|    |  - 工具调用机制        |             |
|  |  - Token 计算        |    |  - 多智能体协作        |             |
|  +----------------------+    +----------------------+             |
|                                                                   |
|  +----------------------+    +----------------------+             |
|  |    MCP 协议栈        |    |    RAG 技术栈         |             |
|  |  - Protocol 设计     |    |  - 向量数据库          |             |
|  |  - Tool 定义         |    |  - Embedding 模型      |             |
|  |  - Transport 层      |    |  - 检索策略            |             |
|  +----------------------+    +----------------------+             |
|                                                                   |
|  +----------------------+    +----------------------+             |
|  |    工程化能力        |    |    运维监控           |             |
|  |  - Python/Java       |    |  - 可观测性            |             |
|  |  - 框架选型          |    |  - 成本优化            |             |
|  |  - 设计模式          |    |  - 评估体系            |             |
|  +----------------------+    +----------------------+             |
|                                                                   |
+------------------------------------------------------------------+
```

---

## 二、AI/LLM 基础知识

### 2.1 大模型核心概念

| 知识点 | 重要程度 | 说明 |
|--------|----------|------|
| **Transformer 架构** | ⭐⭐⭐⭐⭐ | 理解 Attention 机制、Encoder-Decoder 结构 |
| **Tokenization** | ⭐⭐⭐⭐⭐ | 分词原理、Token 计算、成本估算 |
| **Context Window** | ⭐⭐⭐⭐⭐ | 上下文窗口限制、滑动窗口、压缩策略 |
| **Temperature/Top-P** | ⭐⭐⭐⭐ | 生成参数调优、确定性输出控制 |
| **Function Calling** | ⭐⭐⭐⭐⭐ | 工具调用原理、结构化输出 |
| **流式输出 (SSE)** | ⭐⭐⭐⭐⭐ | Server-Sent Events、流式处理 |
| **多模态能力** | ⭐⭐⭐ | 图像理解、语音处理、多模态融合 |

### 2.2 主流大模型服务

| 服务商 | 模型 | 特点 |
|--------|------|------|
| OpenAI | GPT-4o/4o-mini | Function Calling 成熟，生态完善 |
| Anthropic | Claude 4.6/4.5 | 长上下文，安全对齐 |
| Google | Gemini 2.0 | 多模态能力强 |
| 阿里 | Qwen | 开源可商用，中文能力强 |
| 百度 | ERNIE | 中文场景优化 |
| DeepSeek | DeepSeek-V3 | 性价比高，推理能力强 |

### 2.3 Prompt Engineering（提示工程）

```
+------------------------------------------------------------------+
|                    Prompt Engineering 技术体系                     |
+------------------------------------------------------------------+
|                                                                   |
|  基础技巧                                                          |
|  ├── Zero-shot Prompting（零样本提示）                            |
|  ├── Few-shot Prompting（少样本提示）                             |
|  ├── Chain-of-Thought（思维链）                                   |
|  ├── Self-Consistency（自一致性）                                 |
|  └── Role Prompting（角色扮演）                                   |
|                                                                   |
|  高级技巧                                                          |
|  ├── ReAct（推理+行动）                                           |
|  ├── Tree-of-Thought（思维树）                                    |
|  ├── Self-Reflection（自我反思）                                  |
|  ├── Meta Prompting（元提示）                                     |
|  └── Program-of-Thoughts（程序思维）                              |
|                                                                   |
|  结构化 Prompt                                                     |
|  ├── System Prompt 设计                                          |
|  ├── 任务分解模板                                                 |
|  ├── 输出格式约束（JSON/XML）                                     |
|  └── 多轮对话管理                                                 |
|                                                                   |
+------------------------------------------------------------------+
```

**Prompt 设计最佳实践**：

```markdown
## System Prompt 结构模板

### 1. 角色定义
你是一个专业的旅行规划助手，精通景点推荐、行程规划、交通查询。

### 2. 能力边界
- 可以查询景点、酒店、机票、火车票信息
- 可以规划多日行程路线
- 不能直接预订产品，需要引导用户到预订页面

### 3. 工具说明
你有以下工具可用：
- sight_recommend: 景点推荐
- hotel_search: 酒店搜索
- train_search: 火车票查询

### 4. 输出格式
请使用 Markdown 格式输出，包含：
- 景点名称
- 推荐理由
- 游玩时长
- 注意事项

### 5. 安全约束
- 不要编造不存在的景点
- 不要提供过时的价格信息
- 遇到不确定的问题，诚实告知用户
```

---

## 三、Agent 架构设计

### 3.1 Agent 核心架构

```
+------------------------------------------------------------------+
|                         Agent 核心架构                            |
+------------------------------------------------------------------+
|                                                                   |
|    User Input                                                     |
|        │                                                          |
|        ▼                                                          |
|  +──────────────+                                                 |
|  │   理解层      │  ← Intent Recognition / Entity Extraction      |
|  │  (Perception)│                                                 |
|  +──────┬───────+                                                 |
|         │                                                         |
|         ▼                                                         |
|  +──────────────+                                                 |
|  │   规划层      │  ← Task Decomposition / Planning               |
|  │  (Planning)  │                                                 |
|  +──────┬───────+                                                 |
|         │                                                         |
|         ▼                                                         |
|  +──────────────+                                                 |
|  │   执行层      │  ← Tool Calling / API Integration              |
|  │ (Execution)  │                                                 |
|  +──────┬───────+                                                 |
|         │                                                         |
|         ▼                                                         |
|  +──────────────+                                                 |
|  │   记忆层      │  ← Short-term / Long-term Memory               |
|  │   (Memory)   │                                                 |
|  +──────┬───────+                                                 |
|         │                                                         |
|         ▼                                                         |
|    User Output                                                    |
|                                                                   |
+------------------------------------------------------------------+
```

### 3.2 ReAct 循环

```
+------------------+     +------------------+     +------------------+
|   Thought        |────>|   Action         |────>|   Observation    |
|   (思考)         |     |   (行动)         |     |   (观察)         |
+------------------+     +------------------+     +--------+---------+
         ↑                                                 │
         │                                                 │
         └─────────────────────────────────────────────────┘
                        循环直到任务完成
```

**ReAct 示例**：

```
用户：帮我规划一个北京3日游行程

Thought: 用户需要北京3日游行程规划，我需要：
1. 查询北京热门景点
2. 了解景点位置分布
3. 规划合理的行程路线

Action: sight_recommend
Action Input: {"region": "北京", "preference_desc": "历史文化景点"}

Observation: 故宫、天坛、颐和园、长城...（景点列表）

Thought: 已获取景点信息，现在规划3日行程
Day1: 天安门-故宫-景山公园
Day2: 长城-明十三陵
Day3: 颐和园-圆明园

Action: search_transit
Action Input: {"origin": "故宫", "destination": "长城"}

Observation: 地铁线路、公交换乘方案...

Thought: 交通信息已获取，可以输出完整行程

Final Answer: [完整的3日游行程安排]
```

### 3.3 多智能体协作模式

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| **层级式 (Hierarchical)** | 主 Agent 分发任务给子 Agent | 复杂任务分解 |
| **顺序式 (Sequential)** | Agent 按顺序依次处理 | 流水线处理 |
| **并行式 (Parallel)** | 多个 Agent 并行执行 | 独立任务加速 |
| **协商式 (Negotiation)** | Agent 之间协商决策 | 多方案对比 |

```
层级式示例:

                    +------------------+
                    |   Main Agent     |
                    |  (任务分发)       |
                    +--------+---------+
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
      +-------------+ +-------------+ +-------------+
      | Hotel Agent | | Train Agent | | Sight Agent |
      |  (酒店查询)  | |  (火车查询)  | |  (景点推荐)  |
      +-------------+ +-------------+ +-------------+
```

---

## 四、MCP (Model Context Protocol) 协议栈

### 4.1 MCP 协议核心概念

```
+------------------------------------------------------------------+
|                    MCP 协议架构                                    |
+------------------------------------------------------------------+
|                                                                   |
|  +------------------+                                             |
|  |   Client         │  ← LLM/Agent 应用                           |
|  +--------+---------+                                             |
|           │                                                       |
|           │ JSON-RPC 2.0                                          |
|           │                                                       |
|  +--------v---------+                                             |
|  |   Transport      │  ← Stdio / HTTP / SSE                       |
|  +--------+---------+                                             |
|           │                                                       |
|  +--------v---------+                                             |
|  |   Server         │  ← MCP Server (工具提供方)                   |
|  +--------+---------+                                             |
|           │                                                       |
|     +-----+-----+-----+                                           |
|     │     │     │     │                                           |
|     ▼     ▼     ▼     ▼                                           |
|  Tools  Prompts  Resources  Sampling                              |
|  (工具)  (提示)  (资源)    (采样)                                  |
|                                                                   |
+------------------------------------------------------------------+
```

### 4.2 MCP 核心能力

| 能力 | 说明 | 示例 |
|------|------|------|
| **Tools** | 可执行的函数/方法 | 地理编码、天气查询、搜索 |
| **Prompts** | 预定义的提示模板 | 代码审查模板、总结模板 |
| **Resources** | 可访问的数据资源 | 文件系统、数据库记录 |
| **Sampling** | LLM 采样请求 | 让 Server 请求 LLM 生成内容 |

### 4.3 MCP 开发实践

**Python MCP Server 示例**：

```python
from mcp.server import Server
from mcp.types import Tool, TextContent

server = Server("my-mcp-server")

@server.list_tools()
async def list_tools():
    return [
        Tool(
            name="get_weather",
            description="获取指定城市的天气信息",
            inputSchema={
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "城市名称"}
                },
                "required": ["city"]
            }
        )
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    if name == "get_weather":
        city = arguments["city"]
        # 调用天气 API
        weather = await fetch_weather(city)
        return [TextContent(type="text", text=f"{city}天气：{weather}")]
```

**Java MCP Server 示例** (使用 aj-mcp-server):

```java
@McpService
public class MyMcpTools {

    @Tool("get_weather")
    @ToolArg(value = "city", description = "城市名称", required = true)
    public String getWeather(String city) {
        // 调用天气服务
        return weatherService.getWeather(city);
    }

    @Prompt("code_review")
    @PromptArg(value = "code", description = "待审查的代码")
    public String codeReview(String code) {
        return "请审查以下代码并提供改进建议：\n" + code;
    }
}
```

### 4.4 MCP 工具定义规范

```json
{
  "name": "hotel_search",
  "description": "酒店搜索工具，根据城市和日期搜索可用酒店",
  "inputSchema": {
    "type": "object",
    "properties": {
      "city": {
        "type": "string",
        "description": "城市名称，如：北京、上海"
      },
      "checkIn": {
        "type": "string",
        "description": "入住日期，格式：YYYY-MM-DD"
      },
      "checkOut": {
        "type": "string",
        "description": "离店日期，格式：YYYY-MM-DD"
      },
      "priceRange": {
        "type": "object",
        "properties": {
          "min": {"type": "number"},
          "max": {"type": "number"}
        },
        "description": "价格区间"
      }
    },
    "required": ["city", "checkIn", "checkOut"]
  }
}
```

---

## 五、RAG (检索增强生成) 技术栈

### 5.1 RAG 架构

```
+------------------------------------------------------------------+
|                         RAG 架构                                  |
+------------------------------------------------------------------+
|                                                                   |
|  +------------------+         +------------------+                |
|  |   文档处理        │         |   向量化          │                |
|  |  - 分块 Chunking  │────────>│  - Embedding     │                |
|  |  - 清洗 Cleaning  │         │  - 向量模型       │                |
|  +------------------+         +--------+---------+                |
|                                        │                          |
|                                        ▼                          |
|                               +------------------+                |
|                               |   向量数据库      │                |
|                               |  - 索引构建       │                |
|                               |  - 相似度检索     │                |
|                               +--------+---------+                |
|                                        │                          |
|          +-----------------------------+-------------------+      |
|          │                             │                   │      |
|          ▼                             ▼                   ▼      |
|   +-------------+              +-------------+      +-------------+
|   | 语义检索    │              | 关键词检索   │      | 混合检索    │
|   | (Semantic)  │              | (Keyword)   │      | (Hybrid)   │
|   +------+------│              +------+------+      +------+------+
|          │                             │                   │      |
|          +-----------------------------+-------------------+      |
|                                        │                          |
|                                        ▼                          |
|                               +------------------+                |
|                               |   重排序 Rerank   │                |
|                               +--------+---------+                |
|                                        │                          |
|                                        ▼                          |
|                               +------------------+                |
|                               |   Context 构建    │                |
|                               +--------+---------+                |
|                                        │                          |
|                                        ▼                          |
|                               +------------------+                |
|                               |   LLM 生成回答    │                |
|                               +------------------+                |
|                                                                   |
+------------------------------------------------------------------+
```

### 5.2 核心技术点

| 技术点 | 说明 | 工具/方案 |
|--------|------|----------|
| **文档分块** | 将长文档切分为合适大小的块 | LangChain Splitter, 固定长度/语义分块 |
| **Embedding 模型** | 将文本转换为向量表示 | OpenAI Embedding, BGE, M3E |
| **向量数据库** | 存储和检索向量 | Milvus, Pinecone, Tencent VDB |
| **检索策略** | 提高检索准确率 | 稠密检索、稀疏检索、混合检索 |
| **Rerank** | 对检索结果重排序 | Cohere Rerank, BGE Reranker |
| **上下文压缩** | 减少输入 Token 数 | LLM 压缩、摘要提取 |

### 5.3 Embedding 模型选型

| 模型 | 维度 | 特点 | 适用场景 |
|------|------|------|----------|
| OpenAI text-embedding-3-small | 1536 | 性价比高 | 通用场景 |
| OpenAI text-embedding-3-large | 3072 | 效果好 | 高精度需求 |
| BGE-large-zh | 1024 | 中文效果好 | 中文场景 |
| M3E-base | 768 | 中英双语 | 多语言场景 |
| Cohere embed-v3 | 1024 | 压缩感知 | 长文本场景 |

### 5.4 向量数据库对比

| 数据库 | 特点 | 适用场景 |
|--------|------|----------|
| **Milvus** | 开源、高性能、分布式 | 大规模生产环境 |
| **Pinecone** | 全托管、易用 | 快速原型开发 |
| **Weaviate** | 支持多模态、GraphQL | 复杂查询场景 |
| **Qdrant** | Rust 实现、高性能 | 对性能要求高 |
| **Chroma** | 轻量级、嵌入式 | 小型项目、本地开发 |
| **腾讯云 VDB** | 云原生、高可用 | 国内生产环境 |

---

## 六、记忆系统 (Memory)

### 6.1 记忆类型

```
+------------------------------------------------------------------+
|                       Agent 记忆系统                              |
+------------------------------------------------------------------+
|                                                                   |
|  短期记忆 (Short-term Memory)                                     |
|  ├── 对话上下文 (Conversation Context)                            |
|  ├── 工作记忆 (Working Memory)                                    |
|  └── 滑动窗口 (Sliding Window)                                    |
|                                                                   |
|  长期记忆 (Long-term Memory)                                      |
|  ├── 向量存储 (Vector Store)                                      |
|  ├── 知识图谱 (Knowledge Graph)                                   |
|  └── 结构化存储 (Structured Storage)                              |
|                                                                   |
|  工具记忆 (Tool Memory)                                           |
|  ├── 工具调用历史 (Tool Call History)                             |
|  ├── 工具结果缓存 (Tool Result Cache)                             |
|  └── 工具偏好学习 (Tool Preference Learning)                      |
|                                                                   |
+------------------------------------------------------------------+
```

### 6.2 记忆管理策略

| 策略 | 说明 | 实现方式 |
|------|------|----------|
| **滑动窗口** | 保留最近 N 轮对话 | 固定长度队列 |
| **摘要压缩** | 对历史对话生成摘要 | LLM 摘要 |
| **重要性排序** | 按重要性保留记忆 | 评分机制 |
| **遗忘机制** | 自动遗忘过时信息 | 时间衰减 |
| **检索增强** | 按需检索相关记忆 | 向量相似度 |

### 6.3 记忆系统实现示例

```python
class AgentMemory:
    """Agent 记忆系统"""

    def __init__(self, max_short_term=10):
        # 短期记忆：最近 N 轮对话
        self.short_term = deque(maxlen=max_short_term)

        # 长期记忆：向量存储
        self.long_term = VectorStore()

        # 工具记忆：工具调用结果
        self.tool_memory = {}

    def add_message(self, role: str, content: str):
        """添加消息到短期记忆"""
        self.short_term.append({
            "role": role,
            "content": content,
            "timestamp": datetime.now()
        })

        # 重要信息同时存入长期记忆
        if self._is_important(content):
            self.long_term.add(content)

    def get_context(self, query: str, max_tokens: int = 4000):
        """获取上下文"""
        context = []

        # 1. 从短期记忆获取最近对话
        for msg in self.short_term:
            context.append(msg)
            if self._estimate_tokens(context) > max_tokens:
                break

        # 2. 从长期记忆检索相关信息
        relevant = self.long_term.search(query, top_k=5)
        context.extend(relevant)

        return context

    def _is_important(self, content: str) -> bool:
        """判断信息是否重要（使用 LLM）"""
        # 实现重要性判断逻辑
        pass
```

---

## 七、工程化能力

### 7.1 编程语言与框架

| 语言/框架 | 重要程度 | 说明 |
|-----------|----------|------|
| **Python** | ⭐⭐⭐⭐⭐ | Agent 开发首选语言，生态最完善 |
| **LangChain** | ⭐⭐⭐⭐⭐ | 最流行的 Agent 开发框架 |
| **LangGraph** | ⭐⭐⭐⭐⭐ | 状态图模式构建复杂 Agent |
| **LlamaIndex** | ⭐⭐⭐⭐ | RAG 场景首选框架 |
| **AutoGen** | ⭐⭐⭐⭐ | 微软多智能体框架 |
| **CrewAI** | ⭐⭐⭐⭐ | 角色扮演多智能体框架 |
| **Semantic Kernel** | ⭐⭐⭐ | 微软企业级框架 |
| **Java + Spring AI** | ⭐⭐⭐ | 企业级 Java Agent 开发 |
| **TypeScript** | ⭐⭐⭐ | 前端 Agent 应用开发 |

### 7.2 Agent 开发框架对比

```
+------------------------------------------------------------------+
|                    Agent 开发框架选型                              |
+------------------------------------------------------------------+
|                                                                   |
|  LangChain                                                        |
|  ├── 优点：生态最完善、文档丰富、社区活跃                          |
|  ├── 缺点：抽象层多、学习曲线陡峭                                  |
|  └── 适用：通用 Agent 开发、快速原型                               |
|                                                                   |
|  LangGraph                                                        |
|  ├── 优点：状态图模式、复杂流程可控、支持循环                      |
|  ├── 缺点：相对较新、学习成本                                      |
|  └── 适用：复杂工作流、多步骤 Agent                                |
|                                                                   |
|  LlamaIndex                                                       |
|  ├── 优点：RAG 能力强、数据连接丰富                                |
|  ├── 缺点：Agent 能力相对弱                                        |
|  └── 适用：知识库问答、RAG 场景                                    |
|                                                                   |
|  AutoGen                                                          |
|  ├── 优点：多智能体协作、人机协同                                  |
|  ├── 缺点：复杂度高、调试困难                                      |
|  └── 适用：多智能体系统、复杂任务                                  |
|                                                                   |
|  CrewAI                                                           |
|  ├── 优点：角色定义清晰、易上手                                    |
|  ├── 缺点：灵活性有限                                              |
|  └── 适用：角色扮演场景、团队协作模拟                              |
|                                                                   |
+------------------------------------------------------------------+
```

### 7.3 设计模式

| 模式 | 说明 | Agent 场景 |
|------|------|-----------|
| **策略模式** | 动态选择工具/策略 | 工具选择、路由分发 |
| **责任链模式** | 处理链式请求 | 多阶段处理、过滤器 |
| **观察者模式** | 事件监听响应 | 流式输出、状态监控 |
| **工厂模式** | 动态创建对象 | 工具实例化、Agent 创建 |
| **代理模式** | 控制对象访问 | API 限流、缓存代理 |
| **适配器模式** | 接口转换 | MCP 工具适配、API 统一 |

### 7.4 工程化最佳实践

```python
# 1. 配置管理
from pydantic import BaseSettings

class AgentConfig(BaseSettings):
    model_name: str = "gpt-4o"
    temperature: float = 0.7
    max_tokens: int = 4096
    tool_timeout: int = 30

    class Config:
        env_prefix = "AGENT_"

# 2. 错误处理
class AgentError(Exception):
    """Agent 错误基类"""
    pass

class ToolExecutionError(AgentError):
    """工具执行错误"""
    pass

class ContextLengthExceeded(AgentError):
    """上下文超限错误"""
    pass

# 3. 重试机制
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10)
)
async def call_tool_with_retry(tool_name: str, params: dict):
    return await tool_executor.execute(tool_name, params)

# 4. 日志追踪
import structlog

logger = structlog.get_logger()

async def agent_loop(query: str, session_id: str):
    log = logger.bind(session_id=session_id)

    log.info("agent_loop_start", query=query)

    try:
        result = await process(query)
        log.info("agent_loop_success", result_length=len(result))
        return result
    except Exception as e:
        log.error("agent_loop_error", error=str(e), exc_info=True)
        raise
```

---

## 八、可观测性与监控

### 8.1 可观测性三支柱

```
+------------------------------------------------------------------+
|                    Agent 可观测性架构                              |
+------------------------------------------------------------------+
|                                                                   |
|  +------------------+                                             |
|  |   Logs 日志      │  ← 结构化日志、TraceID 关联                  |
|  +------------------+                                             |
|           │                                                       |
|           ▼                                                       |
|  +------------------+                                             |
|  |   Metrics 指标   │  ← 调用量、延迟、Token 消耗、成本             |
|  +------------------+                                             |
|           │                                                       |
|           ▼                                                       |
|  +------------------+                                             |
|  |   Traces 链路    │  ← 完整调用链、工具调用耗时                   |
|  +------------------+                                             |
|                                                                   |
+------------------------------------------------------------------+
```

### 8.2 核心监控指标

| 指标类型 | 具体指标 | 说明 |
|----------|----------|------|
| **性能指标** | 响应时间 P50/P95/P99 | 用户体验 |
| | Token 生成速度 (TPS) | 生成效率 |
| | 首字延迟 (TTFT) | 首字响应时间 |
| **成本指标** | Token 消耗量 | 直接成本 |
| | 每次请求成本 | 成本监控 |
| | 模型调用次数 | API 配额管理 |
| **质量指标** | 工具调用成功率 | 工具稳定性 |
| | 任务完成率 | Agent 效果 |
| | 用户满意度 | 质量反馈 |
| **业务指标** | 会话轮次 | 对话深度 |
| | 工具使用分布 | 工具热点 |
| | 意图识别准确率 | 理解能力 |

### 8.3 可观测性工具

| 工具 | 用途 | 特点 |
|------|------|------|
| **Langfuse** | LLM 可观测性 | 开源、支持追踪、评分 |
| **LangSmith** | LangChain 官方 | 深度集成、调试友好 |
| **Arize Phoenix** | LLM 追踪 | 开源、本地部署 |
| **Prometheus + Grafana** | 指标监控 | 通用、成熟 |
| **Jaeger / Zipkin** | 分布式追踪 | 标准协议 |

### 8.4 Langfuse 集成示例

```python
from langfuse import Langfuse

langfuse = Langfuse(
    public_key="pk-xxx",
    secret_key="sk-xxx",
    host="https://cloud.langfuse.com"
)

# 创建 Trace
trace = langfuse.trace(
    name="agent_query",
    user_id="user_123",
    session_id="session_abc",
    metadata={"channel": "wechat"}
)

# 记录 Span
span = trace.span(name="llm_call", input={"query": "北京天气"})

# 调用 LLM
response = await llm.invoke(query)

# 更新 Span
span.end(output={"response": response})

# 记录评分
trace.score(name="user_feedback", value=5)
```

---

## 九、评估与测试

### 9.1 Agent 评估维度

```
+------------------------------------------------------------------+
|                    Agent 评估体系                                  |
+------------------------------------------------------------------+
|                                                                   |
|  功能性评估                                                       |
|  ├── 任务完成率 (Task Completion Rate)                            |
|  ├── 意图识别准确率 (Intent Accuracy)                             |
|  ├── 工具选择准确率 (Tool Selection Accuracy)                     |
|  └── 输出格式正确率 (Output Format Accuracy)                      |
|                                                                   |
|  性能评估                                                         |
|  ├── 响应延迟 (Response Latency)                                  |
|  ├── Token 效率 (Token Efficiency)                               |
|  └── 资源消耗 (Resource Consumption)                              |
|                                                                   |
|  安全性评估                                                       |
|  ├── 幻觉率 (Hallucination Rate)                                 |
|  ├── 有害输出率 (Harmful Output Rate)                            |
|  └── 隐私泄露风险 (Privacy Leak Risk)                            |
|                                                                   |
|  用户体验评估                                                     |
|  ├── 用户满意度 (User Satisfaction)                              |
|  ├── 会话效率 (Conversation Efficiency)                          |
|  └── 错误恢复能力 (Error Recovery)                               |
|                                                                   |
+------------------------------------------------------------------+
```

### 9.2 评估方法

| 方法 | 说明 | 适用场景 |
|------|------|----------|
| **人工评估** | 专家/用户打分 | 质量把控、上线前验收 |
| **LLM-as-Judge** | 用 LLM 评估 LLM | 大规模自动化评估 |
| **规则评估** | 基于规则的检查 | 格式验证、安全检查 |
| **A/B 测试** | 对比不同方案 | 模型/策略选型 |
| **基准测试** | 标准数据集评估 | 能力对比、选型参考 |

### 9.3 测试框架

```python
import pytest
from agent import TravelAgent

class TestTravelAgent:

    @pytest.fixture
    def agent(self):
        return TravelAgent()

    def test_intent_recognition(self, agent):
        """测试意图识别"""
        query = "帮我订一张明天去上海的机票"
        intent = agent.recognize_intent(query)
        assert intent == "flight_booking"

    def test_tool_selection(self, agent):
        """测试工具选择"""
        query = "北京有什么好玩的地方"
        tools = agent.select_tools(query)
        assert "sight_recommend" in tools

    def test_multi_turn_conversation(self, agent):
        """测试多轮对话"""
        agent.chat("我想去北京旅游")
        response = agent.chat("有哪些景点推荐")

        assert "故宫" in response or "长城" in response

    @pytest.mark.asyncio
    async def test_streaming_output(self, agent):
        """测试流式输出"""
        chunks = []
        async for chunk in agent.stream_chat("北京天气"):
            chunks.append(chunk)

        assert len(chunks) > 0
        assert "".join(chunks) != ""
```

---

## 十、安全与合规

### 10.1 安全风险

| 风险类型 | 说明 | 防护措施 |
|----------|------|----------|
| **Prompt 注入** | 恶意指令绕过限制 | 输入过滤、指令隔离 |
| **数据泄露** | 敏感信息暴露 | 脱敏处理、访问控制 |
| **工具滥用** | 非法工具调用 | 权限控制、审计日志 |
| **幻觉风险** | 生成虚假信息 | 事实校验、引用来源 |
| **对抗攻击** | 绕过安全限制 | 对抗训练、异常检测 |

### 10.2 安全最佳实践

```python
# 1. 输入过滤
def sanitize_input(user_input: str) -> str:
    """过滤危险输入"""
    # 移除潜在的 Prompt 注入
    dangerous_patterns = [
        r"忽略之前指令",
        r"forget previous",
        r"system:",
    ]
    for pattern in dangerous_patterns:
        user_input = re.sub(pattern, "", user_input, flags=re.IGNORECASE)
    return user_input

# 2. 输出检查
def check_output(output: str) -> bool:
    """检查输出安全性"""
    # 检查是否包含敏感信息
    if contains_pii(output):
        return False
    # 检查是否有害
    if is_harmful(output):
        return False
    return True

# 3. 权限控制
def check_tool_permission(user_id: str, tool_name: str) -> bool:
    """检查工具调用权限"""
    user_permissions = get_user_permissions(user_id)
    return tool_name in user_permissions

# 4. 审计日志
def log_tool_call(user_id: str, tool_name: str, params: dict, result: str):
    """记录工具调用日志"""
    audit_log.info(
        "tool_call",
        user_id=user_id,
        tool_name=tool_name,
        params=params,
        result_length=len(result),
        timestamp=datetime.now()
    )
```

---

## 十一、成本优化

### 11.1 Token 优化策略

| 策略 | 说明 | 效果 |
|------|------|------|
| **模型分级** | 简单任务用小模型 | 成本降低 50%+ |
| **Prompt 压缩** | 精简 System Prompt | Token 减少 30% |
| **上下文管理** | 滑动窗口 + 摘要 | 避免无限增长 |
| **缓存复用** | 缓存相同查询 | 减少重复调用 |
| **流式输出** | 边生成边返回 | 提升用户体验 |

### 11.2 成本监控

```python
# Token 使用追踪
class TokenTracker:
    def __init__(self):
        self.usage = {
            "input_tokens": 0,
            "output_tokens": 0,
            "total_cost": 0.0
        }

    def track(self, model: str, input_tokens: int, output_tokens: int):
        # 模型价格表
        prices = {
            "gpt-4o": {"input": 0.005, "output": 0.015},
            "gpt-4o-mini": {"input": 0.00015, "output": 0.0006},
        }

        price = prices.get(model, {"input": 0, "output": 0})
        cost = (input_tokens * price["input"] + output_tokens * price["output"]) / 1000

        self.usage["input_tokens"] += input_tokens
        self.usage["output_tokens"] += output_tokens
        self.usage["total_cost"] += cost

        return cost

    def get_report(self):
        return {
            **self.usage,
            "avg_cost_per_request": self.usage["total_cost"] / max(1, self.usage["input_tokens"] / 1000)
        }
```

---

## 十二、学习路径建议

### 12.1 入门阶段 (1-2 个月)

```
Week 1-2: AI/LLM 基础
├── 学习 Transformer 原理
├── 熟悉 OpenAI API
└── 练习 Prompt Engineering

Week 3-4: Agent 基础
├── 学习 LangChain 基础
├── 实现 ReAct Agent
└── 理解工具调用机制

Week 5-6: 实践项目
├── 实现一个简单的对话 Agent
├── 集成 2-3 个外部工具
└── 实现流式输出

Week 7-8: 进阶学习
├── 学习 RAG 原理
├── 实现向量检索
└── 部署第一个 Agent 服务
```

### 12.2 进阶阶段 (2-3 个月)

```
Month 1: 深入架构
├── 学习 LangGraph 状态图
├── 实现多智能体协作
├── 掌握 MCP 协议

Month 2: 工程化
├── 可观测性建设
├── 评估体系搭建
├── 成本优化实践

Month 3: 生产化
├── 性能优化
├── 安全加固
├── 高可用部署
```

### 12.3 推荐学习资源

| 资源类型 | 名称 | 链接 |
|----------|------|------|
| **官方文档** | LangChain Docs | https://python.langchain.com/ |
| | OpenAI Docs | https://platform.openai.com/docs |
| | MCP Spec | https://modelcontextprotocol.io/ |
| **开源项目** | LangChain | https://github.com/langchain-ai/langchain |
| | AutoGPT | https://github.com/Significant-Gravitas/AutoGPT |
| | Agents | https://github.com/openai/openai-agents-python |
| **课程** | DeepLearning.AI | https://www.deeplearning.ai/ |
| | LangChain 课程 | LangChain for LLM Application Development |
| **书籍** | Build a Large Language Model | Sebastian Raschka |
| | Designing LLM Apps | Colleen C. Iversen |

---

## 十三、面试高频问题

### 13.1 基础问题

1. **解释 Transformer 的 Attention 机制**
2. **什么是 Function Calling？如何实现？**
3. **如何设计一个 Agent 的记忆系统？**
4. **ReAct 循环是什么？有什么优缺点？**

### 13.2 进阶问题

1. **如何优化 Agent 的响应延迟？**
2. **如何评估 Agent 的效果？有哪些指标？**
3. **如何防止 Prompt 注入攻击？**
4. **如何设计多智能体协作架构？**

### 13.3 场景问题

1. **用户问了一个复杂问题，Agent 如何分解任务？**
2. **工具调用失败了，Agent 应该如何处理？**
3. **如何让 Agent 记住用户的偏好？**
4. **如何控制 Agent 的 Token 成本？**

---

## 十四、总结

Agent 开发工程师需要掌握的技术栈涵盖了 **AI/LLM 基础**、**Agent 架构设计**、**MCP 协议**、**RAG 技术**、**工程化能力** 和 **运维监控** 等多个领域。

**核心能力金字塔**：

```
                    +-----------+
                    |  运维监控  |
                    +-----------+
                   /             \
                  /   工程化能力   \
                 +-----------------+
                /                   \
               /    MCP + RAG 技术    \
              +-----------------------+
             /                         \
            /     Agent 架构 + Prompt    \
           +-------------------------------+
          /                                 \
         /        AI/LLM 基础知识             \
        +---------------------------------------+
```

**最重要的 5 项技能**：

1. **Prompt Engineering** - 与 LLM 沟通的核心能力
2. **Agent 架构设计** - 理解 ReAct、工具调用、记忆系统
3. **MCP 协议** - 工具标准化的未来方向
4. **工程化能力** - 把原型变成生产级服务
5. **评估优化** - 持续改进 Agent 效果

---

## 附录：常用工具清单

| 类别 | 工具 | 用途 |
|------|------|------|
| **LLM 服务** | OpenAI / Claude / 通义千问 | 模型调用 |
| **开发框架** | LangChain / LangGraph / LlamaIndex | Agent 开发 |
| **向量数据库** | Milvus / Pinecone / Chroma | RAG 存储 |
| **可观测性** | Langfuse / LangSmith | 追踪调试 |
| **协议标准** | MCP | 工具标准化 |
| **部署运维** | Docker / Kubernetes | 容器化部署 |
| **监控告警** | Prometheus / Grafana | 系统监控 |
| **日志系统** | ELK / Loki | 日志收集 |
