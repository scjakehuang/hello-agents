# AgentScope 最佳实践与踩坑指南

> 作者：徐凯旋
> 邮箱：azouever@gmail.com
> 更新时间：2026-04-14

---

## 目录

1. [概述](#1-概述)
2. [核心概念](#2-核心概念)
3. [安装与初始化](#3-安装与初始化)
4. [内置 Agent 类型](#4-内置-agent-类型)
5. [消息规范](#5-消息规范)
6. [Pipeline 类型](#6-pipeline-类型)
7. [多智能体协作模式](#7-多智能体协作模式)
8. [分布式部署](#8-分布式部署)
9. [记忆管理](#9-记忆管理)
10. [工具集成](#10-工具集成)
11. [实战案例：旅行规划多智能体系统](#11-实战案例旅行规划多智能体系统)
12. [常见踩坑](#12-常见踩坑)
13. [速查表](#13-速查表)

---

## 1. 概述

### AgentScope 是什么

AgentScope 是阿里通义实验室开源的**企业级多智能体开发框架**，提供智能体编排、工具调用、分布式部署与评测等核心能力，并原生支持 Qwen 系列模型与智能体微调，助力开发者快速搭建生产级 Agent 系统。

GitHub：https://github.com/modelscope/agentscope（16k+ stars）

### 与主流框架对比

```
+----------------+-------------+-------------+-------------+--------------+
| 维度           | AgentScope  | LangChain   | AutoGen     | CrewAI       |
+----------------+-------------+-------------+-------------+--------------+
| 开发语言       | Python/Java | Python      | Python      | Python       |
| 分布式原生支持 | ✓ 内置 RPC  | 需手动搭建  | 部分支持    | 不支持       |
| 多模态         | ✓ 原生支持  | 插件方式    | 插件方式    | 有限支持     |
| 可视化工具     | AgentStudio | LangSmith   | AutoGen UI  | 无           |
| Qwen 原生支持  | ✓           | 需适配      | 需适配      | 需适配       |
| 工作流编排     | Pipeline    | LCEL/Chain  | Conversable | Crew/Task    |
| 企业级特性     | ✓ 沙箱/中断 | 有限        | 中等        | 有限         |
| 学习曲线       | 中等        | 较陡        | 中等        | 平缓         |
+----------------+-------------+-------------+-------------+--------------+
```

### 核心优势

- **分布式原生**：内置 RPC 机制，Agent 可跨机器部署，水平扩展无痛
- **企业级能力**：实时控制、中断处理、沙箱执行、全链路追踪
- **上下文工程友好**：标准化消息格式 + 分层记忆机制，控制 Token 膨胀
- **AgentStudio**：可视化调试工具，掌握智能体开发全生命周期
- **混合部署**：Python 写 AI 核心逻辑，可与 Java 服务层无缝对接

> 阿里商旅实战印证：从 workflow + 单智能体升级为 AgentScope 多智能体后，
> 事项收集准确率从 50% 提升至 90%+，历史顽固 Bug 100% 消除。

---

## 2. 核心概念

### Agent / Pipeline / Message / Memory 关系

```
┌─────────────────────────────────────────────────────────────┐
│                        AgentScope 运行时                    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Pipeline（编排层）                │   │
│  │                                                     │   │
│  │   ┌──────────┐    Msg    ┌──────────┐    Msg       │   │
│  │   │  Agent A │ ────────► │  Agent B │ ──────►      │   │
│  │   └──────────┘           └──────────┘              │   │
│  │        │                      │                     │   │
│  │        ▼                      ▼                     │   │
│  │   ┌─────────┐           ┌─────────┐                │   │
│  │   │ Memory  │           │ Memory  │                │   │
│  │   │ (独立)  │           │ (共享)  │                │   │
│  │   └─────────┘           └─────────┘                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  核心组成：                                                  │
│  ● Agent   — 智能体单元，持有 LLM + Memory + Tools          │
│  ● Pipeline — 编排多个 Agent 的执行顺序与逻辑               │
│  ● Msg     — 统一消息类型，Agent 间唯一通信载体              │
│  ● Memory  — Agent 上下文存储，可独立或共享                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 安装与初始化

### 安装

```bash
pip install agentscope

# 可选：安装分布式支持
pip install agentscope[distribute]

# 可选：安装全部扩展
pip install agentscope[full]
```

### 初始化与模型配置（model_configs）

AgentScope 使用 `model_configs` 列表统一管理所有模型连接配置，**初始化必须先做，所有 Agent 共享这份配置**。

```python
import agentscope

# 方式一：直接传入配置列表
agentscope.init(
    model_configs=[
        {
            "config_name": "qwen-max",          # 配置别名，Agent 引用此名
            "model_type": "dashscope_chat",      # 模型类型标识
            "model_name": "qwen-max",            # 实际模型名
            "api_key": "your-dashscope-api-key",
        },
        {
            "config_name": "qwen-turbo",
            "model_type": "dashscope_chat",
            "model_name": "qwen-turbo",
            "api_key": "your-dashscope-api-key",
        },
        {
            "config_name": "gpt-4o",
            "model_type": "openai_chat",
            "model_name": "gpt-4o",
            "api_key": "your-openai-api-key",
        },
    ]
)

# 方式二：从 JSON 文件加载
agentscope.init(model_configs="./model_configs.json")
```

`model_configs.json` 示例：

```json
[
  {
    "config_name": "qwen-max",
    "model_type": "dashscope_chat",
    "model_name": "qwen-max",
    "api_key": "${DASHSCOPE_API_KEY}"
  }
]
```

### 常用 model_type 枚举

```
dashscope_chat      — 阿里云灵积（Qwen 系列）
openai_chat         — OpenAI 兼容接口
litellm_chat        — LiteLLM 统一代理
ollama_chat         — 本地 Ollama
zhipuai_chat        — 智谱 GLM 系列
```

---

## 4. 内置 Agent 类型

```
+--------------------+--------------------------------------------+--------------------+
| Agent 类型         | 适用场景                                   | 输出格式           |
+--------------------+--------------------------------------------+--------------------+
| DialogAgent        | 通用对话，自由文本回答                     | Msg（text）        |
| DictDialogAgent    | 需要结构化 JSON 输出的专业 Agent           | Msg（dict/JSON）   |
| UserAgent          | 模拟用户输入，用于测试或人机混合流          | Msg（text）        |
| ReActAgent         | 工具调用 + 推理循环（Think-Act-Observe）   | Msg（最终答案）    |
| TextToImageAgent   | 文本生成图像                               | Msg（image）       |
| RpcAgent           | 分布式远程 Agent，通过 RPC 调用            | Msg（透传）        |
+--------------------+--------------------------------------------+--------------------+
```

### DialogAgent 示例

```python
from agentscope.agents import DialogAgent

travel_assistant = DialogAgent(
    name="travel_assistant",
    model_config_name="qwen-max",   # 引用 init 中配置的 config_name
    sys_prompt="你是一个专业的旅行规划助手，擅长制定行程、推荐景点和交通方案。",
)
```

### DictDialogAgent 示例（结构化输出）

```python
from agentscope.agents import DictDialogAgent

intent_agent = DictDialogAgent(
    name="intent_recognizer",
    model_config_name="qwen-max",
    sys_prompt="""识别用户意图并输出结构化结果。
    
    输出格式（严格 JSON）：
    {
        "intent": "hotel|flight|sight|plan|unknown",
        "confidence": 0.0-1.0,
        "entities": {"city": "...", "date": "..."}
    }
    """,
    parse_func=json.loads,          # 自动解析输出为 dict
)
```

### ReActAgent 示例（工具调用循环）

```python
from agentscope.agents import ReActAgent
from agentscope.service import ServiceToolkit

toolkit = ServiceToolkit()
toolkit.add(search_hotel)   # 注册自定义工具
toolkit.add(search_flight)

react_agent = ReActAgent(
    name="planner",
    model_config_name="qwen-max",
    sys_prompt="你是差旅规划助手，使用工具帮用户查询和规划行程。",
    service_toolkit=toolkit,
    max_iters=10,               # 最大推理轮次，防止死循环
)
```

---

## 5. 消息规范

### Msg 类型与统一格式

AgentScope 所有 Agent 间通信**只使用 `Msg` 类型**，禁止裸 dict 传递。

```python
from agentscope.message import Msg

# 基础文本消息
msg = Msg(
    name="user",        # 发送者名称
    content="我想规划北京三日游",
    role="user",        # user | assistant | system
)

# 带元数据的消息
msg_with_meta = Msg(
    name="planner",
    content="为您规划如下行程：...",
    role="assistant",
    metadata={
        "session_id": "sess_abc123",
        "intent": "plan",
        "confidence": 0.95,
    }
)

# 访问字段
print(msg.name)         # "user"
print(msg.content)      # "我想规划北京三日游"
print(msg.role)         # "user"
print(msg.timestamp)    # 自动填充的时间戳
```

### 多模态消息

```python
# 图片消息
image_msg = Msg(
    name="user",
    content=[
        {"type": "text", "text": "这张照片是哪里？"},
        {
            "type": "image",
            "url": "https://example.com/photo.jpg",
            # 或 base64
            # "base64": "data:image/jpeg;base64,..."
        }
    ],
    role="user",
)

# 工具调用消息（ReActAgent 内部格式）
tool_call_msg = Msg(
    name="planner",
    content=[
        {
            "type": "tool",
            "id": "call_001",
            "name": "search_hotel",
            "input": {"city": "北京", "check_in": "2026-05-01"}
        }
    ],
    role="assistant",
)

# 工具结果消息
tool_result_msg = Msg(
    name="tool",
    content=[
        {
            "type": "result",
            "id": "call_001",
            "name": "search_hotel",
            "output": [{"type": "text", "text": "找到 3 家推荐酒店：..."}]
        }
    ],
    role="tool",
)
```

---

## 6. Pipeline 类型

Pipeline 是 AgentScope 的编排核心，决定 Agent 的调用顺序和逻辑。

### Sequential（顺序流水线）

```python
from agentscope.pipelines import SequentialPipeline

pipeline = SequentialPipeline([
    intent_agent,       # 第1步：识别意图
    plan_agent,         # 第2步：制定计划
    summary_agent,      # 第3步：汇总输出
])

initial_msg = Msg(name="user", content="帮我规划上海两日游", role="user")
result = pipeline(initial_msg)
```

### Parallel（并行流水线）

```python
from agentscope.pipelines import ParallelPipeline

parallel = ParallelPipeline([
    hotel_agent,    # 并行查酒店
    flight_agent,   # 并行查机票
    sight_agent,    # 并行查景点
])

# 同一条消息广播给所有 Agent，收集所有结果列表
results = parallel(initial_msg)     # 返回 List[Msg]
```

### IfElse（条件分支）

```python
from agentscope.pipelines import IfElsePipeline

def is_complex_intent(msg: Msg) -> bool:
    """判断是否为复杂多意图请求"""
    return len(msg.content) > 50 or "和" in msg.content

ifelse_pipeline = IfElsePipeline(
    condition_func=is_complex_intent,
    if_body_operators=complex_intent_agent,     # 条件为真：走 LLM 分析
    else_body_operators=rule_router_agent,      # 条件为假：走规则快车道
)
```

> 阿里商旅实践：用 IfElse 实现"快慢车道"路由，固定意图走规则引擎直接跳过
> LLM 分析，显著降低延迟。

### WhileLoop（循环流水线）

```python
from agentscope.pipelines import WhileLoopPipeline

max_rounds = 5
round_counter = [0]

def should_continue(msg: Msg) -> bool:
    round_counter[0] += 1
    # 未达成共识且未超轮次，继续循环
    return (
        round_counter[0] < max_rounds
        and "达成共识" not in str(msg.content)
    )

debate_pipeline = WhileLoopPipeline(
    body_operators=SequentialPipeline([agent_a, agent_b]),
    condition_func=should_continue,
)
```

### ForLoop（固定次数循环）

```python
from agentscope.pipelines import ForLoopPipeline

# 固定执行 3 轮优化
refine_pipeline = ForLoopPipeline(
    body_operators=refine_agent,
    max_loop=3,
)
```

### 复合 Pipeline（嵌套示例）

```python
# 完整差旅规划流水线：
# 1. 意图识别（条件分支：快/慢车道）
# 2. 并行查询（酒店 + 机票 + 景点）
# 3. 顺序整合（汇总 + 输出）

full_pipeline = SequentialPipeline([
    IfElsePipeline(            # 快慢车道
        condition_func=is_complex_intent,
        if_body_operators=llm_intent_agent,
        else_body_operators=rule_intent_agent,
    ),
    ParallelPipeline([         # 并行查询
        hotel_agent,
        flight_agent,
        sight_agent,
    ]),
    summary_agent,             # 最终整合
])
```

---

## 7. 多智能体协作模式

### 路由模式（Routing）

```
                      ┌──────────────────┐
                      │   Router Agent   │
                      │  (意图识别/分发)  │
                      └────────┬─────────┘
                               │ 根据意图选路
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │  Hotel Agent │  │ Flight Agent │  │  Sight Agent │
    │  (酒店专家)  │  │  (机票专家)  │  │  (景点专家)  │
    └──────────────┘  └──────────────┘  └──────────────┘
```

```python
from agentscope.agents import DictDialogAgent
import json

# 路由 Agent：输出 {"expert": "agent_name"}
router = DictDialogAgent(
    name="router",
    model_config_name="qwen-max",
    sys_prompt="""根据用户问题，选择合适的专家。
    - 酒店/住宿相关 -> hotel_expert
    - 机票/航班相关 -> flight_expert
    - 景点/活动相关 -> sight_expert
    - 综合行程规划  -> plan_agent
    
    严格输出 JSON：{"expert": "<expert_name>"}
    """,
    parse_func=json.loads,
)

# 专家 Agent 注册表
expert_registry = {
    "hotel_expert":  hotel_agent,
    "flight_expert": flight_agent,
    "sight_expert":  sight_agent,
    "plan_agent":    plan_agent,
}

def route_and_handle(user_msg: Msg) -> Msg:
    routing_result = router(user_msg)
    expert_name = routing_result.content.get("expert", "plan_agent")
    target_agent = expert_registry.get(expert_name, plan_agent)
    return target_agent(user_msg)
```

### 并行模式（Parallel Fan-out/Fan-in）

```
  User Input
      │
      ▼
 ┌──────────┐
 │  Fanout  │ ── 广播给所有专家
 └──────────┘
      │
  ┌───┼───┐
  ▼   ▼   ▼
 [A] [B] [C]   并行执行（各自独立）
  │   │   │
  └───┼───┘
      ▼
 ┌──────────┐
 │  Fanin   │ ── 聚合所有结果
 │ Aggregator│
 └──────────┘
      │
      ▼
  Final Result
```

```python
from agentscope.pipelines import ParallelPipeline

# 并行查询三个数据源
parallel = ParallelPipeline([hotel_agent, flight_agent, sight_agent])
results = parallel(user_msg)     # List[Msg], 顺序与注册顺序一致

# 聚合 Agent 接收所有结果合并输出
combined_content = "\n".join(
    [f"[{r.name}] {r.content}" for r in results]
)
aggregate_msg = Msg(name="system", content=combined_content, role="system")
final_answer = summary_agent(aggregate_msg)
```

### 监督模式（Supervisor）

```
  ┌────────────────────────────────────────────────┐
  │              Supervisor Agent                  │
  │         (主规划智能体，协调者)                  │
  └──────────────────────┬─────────────────────────┘
                         │ 委派子任务
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
  ┌────────────┐ ┌────────────┐ ┌────────────┐
  │  Worker A  │ │  Worker B  │ │  Worker C  │
  │ (信息查询) │ │ (行程规划) │ │ (RAG知识库)│
  └────────────┘ └────────────┘ └────────────┘
         │               │               │
         └───────────────┼───────────────┘
                         ▼
              ┌────────────────────┐
              │   Supervisor 汇总  │
              │   验证 & 整合结果  │
              └────────────────────┘
```

```python
class SupervisorAgent(DialogAgent):
    """监督模式主 Agent"""

    def __init__(self, workers: dict, **kwargs):
        super().__init__(**kwargs)
        self.workers = workers          # {"worker_name": agent_instance}

    def reply(self, x: Msg) -> Msg:
        # 1. 分析任务，生成子任务分配计划
        plan_msg = self._plan_tasks(x)

        # 2. 按计划调度子 Agent
        worker_results = {}
        for task in plan_msg.content.get("tasks", []):
            worker_name = task["worker"]
            task_msg = Msg(
                name="supervisor",
                content=task["instruction"],
                role="user",
            )
            worker_results[worker_name] = self.workers[worker_name](task_msg)

        # 3. 汇总验证，生成最终回复
        return self._aggregate_results(x, worker_results)

    def _plan_tasks(self, user_msg: Msg) -> Msg:
        # 调用 LLM 生成任务分配 JSON
        ...

    def _aggregate_results(self, original: Msg, results: dict) -> Msg:
        # 汇总所有子 Agent 结果，生成最终答复
        ...
```

---

## 8. 分布式部署

### RpcAgentServer

AgentScope 通过 `RpcAgentServerLauncher` 将 Agent 作为独立服务部署。

```python
# server.py — 在远程机器上启动
from agentscope.server import RpcAgentServerLauncher
from agentscope.agents import DialogAgent, ReActAgent

launcher = RpcAgentServerLauncher(
    host="0.0.0.0",
    port=12345,
    agent_classes=[DialogAgent, ReActAgent],     # 注册可用的 Agent 类型
    custom_agent_classes=[SupervisorAgent],       # 注册自定义 Agent
)

launcher.launch()
launcher.wait()     # 阻塞直到服务停止
```

### 客户端连接远程 Agent

```python
# client.py — 在调用方连接远程服务
import agentscope
from agentscope.agents import DialogAgent

agentscope.init(model_configs=[...])

# to_dist=True 让 Agent 在远程服务上实例化并运行
remote_assistant = DialogAgent(
    name="remote_assistant",
    model_config_name="qwen-max",
    sys_prompt="你是旅行助手",
).to_dist(
    host="192.168.1.100",
    port=12345,
)

# 使用方式与本地 Agent 完全一致
response = remote_assistant(
    Msg(name="user", content="推荐杭州景点", role="user")
)
```

### 多机分布式架构

```
  主控节点（client）
       │
       ├──► Agent A 服务（机器 1:12345）
       │       └── DialogAgent（对话）
       │
       ├──► Agent B 服务（机器 2:12346）
       │       └── ReActAgent（工具调用）
       │
       └──► Agent C 服务（机器 3:12347）
               └── DictDialogAgent（结构化）
```

```python
# 构建分布式 Pipeline
pipeline = SequentialPipeline([
    DialogAgent(...).to_dist(host="10.0.0.1", port=12345),
    ReActAgent(...).to_dist(host="10.0.0.2", port=12346),
    DictDialogAgent(...).to_dist(host="10.0.0.3", port=12347),
])
```

---

## 9. 记忆管理

### TemporaryMemory（临时记忆）

默认 Agent 自带 `TemporaryMemory`，对话结束后不持久化。

```python
from agentscope.memory import TemporaryMemory

agent = DialogAgent(
    name="assistant",
    model_config_name="qwen-max",
    sys_prompt="...",
    memory=TemporaryMemory(
        config={"max_tokens": 4096}    # 控制记忆窗口上限
    )
)

# 手动操作记忆
agent.memory.add(Msg(name="user", content="记住我叫小明", role="user"))
agent.memory.get_memory()              # 获取所有记忆
agent.memory.clear()                   # 清空记忆
```

### 共享记忆

多 Agent 共享同一记忆实例，实现跨 Agent 上下文同步。

```python
from agentscope.memory import TemporaryMemory

# 创建共享记忆
shared_memory = TemporaryMemory()

# 多个 Agent 绑定同一实例
intent_agent = DialogAgent(
    name="intent", model_config_name="qwen-max",
    sys_prompt="...", memory=shared_memory
)
plan_agent = DialogAgent(
    name="planner", model_config_name="qwen-max",
    sys_prompt="...", memory=shared_memory
)
# intent_agent 的对话历史 plan_agent 可直接看到
```

> 注意：共享记忆会导致上下文快速膨胀。生产环境推荐按**最小权限原则**
> 只向相关 Agent 开放必要的上下文片段，而非全量共享。

### MemoryScope（分级记忆架构）

阿里商旅实践的分级记忆方案：

```python
class SessionMemoryManager:
    """
    分级记忆管理器：
    - L1 全局上下文：sessionId、用户信息、业务规则（所有 Agent 只读）
    - L2 会话记忆：本次对话历史（按 Agent 职责隔离）
    - L3 工作记忆：当前任务的临时状态（Agent 独立持有）
    """

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.global_context: dict = {}      # L1：全局只读
        self.session_memories: dict = {}    # L2：按 agent_name 隔离
        self.agent_stack: list = []         # 调用栈，维护层级关系

    def get_context_for_agent(
        self, agent_name: str, allowed_agents: list[str] = None
    ) -> list[Msg]:
        """
        按最小权限原则，向 agent_name 提供所需上下文：
        - 自身的 L2 记忆
        - allowed_agents 中指定的其他 Agent 记忆片段
        """
        ctx = []

        # 自身记忆
        ctx.extend(self.session_memories.get(agent_name, []))

        # 按需开放其他 Agent 上下文
        if allowed_agents:
            for other_agent in allowed_agents:
                ctx.extend(
                    self.session_memories.get(other_agent, [])[-5:]   # 最近 5 条
                )
        return ctx

    def push_agent(self, agent_name: str):
        """入栈：记录 Agent 调用层级"""
        self.agent_stack.append(agent_name)

    def pop_agent(self) -> str:
        """出栈：Agent 执行完毕"""
        return self.agent_stack.pop() if self.agent_stack else None
```

---

## 10. 工具集成

### Service 工具

AgentScope 提供 `ServiceToolkit` 统一管理工具，供 ReActAgent 调用。

```python
from agentscope.service import ServiceToolkit, service_func

# 方式一：使用 @service_func 装饰器定义工具
@service_func
def search_hotel(city: str, check_in: str, check_out: str) -> str:
    """
    搜索指定城市的酒店信息。
    
    Args:
        city: 城市名称，例如"北京"
        check_in: 入住日期，格式 YYYY-MM-DD
        check_out: 离店日期，格式 YYYY-MM-DD
    
    Returns:
        酒店搜索结果的文本描述
    """
    # 调用实际酒店 API
    results = hotel_api.search(city=city, check_in=check_in, check_out=check_out)
    return f"找到 {len(results)} 家酒店：\n" + "\n".join(
        [f"- {h['name']}，¥{h['price']}/晚" for h in results]
    )


@service_func
def search_flight(
    departure: str, destination: str, date: str
) -> str:
    """搜索机票信息"""
    ...


# 方式二：注册外部函数
toolkit = ServiceToolkit()
toolkit.add(search_hotel)
toolkit.add(search_flight)
toolkit.add(
    web_search,                     # 内置工具
    api_key="your-search-api-key",  # 工具初始化参数
)

# 绑定到 ReActAgent
react_agent = ReActAgent(
    name="travel_planner",
    model_config_name="qwen-max",
    sys_prompt="你是差旅规划助手，可以搜索酒店、机票等信息。",
    service_toolkit=toolkit,
    max_iters=8,
)
```

### 自定义工具（MCP 集成）

```python
from agentscope.service import ServiceToolkit

# AgentScope 支持直接接入 MCP 服务作为工具
toolkit = ServiceToolkit()

# 通过 MCP 协议注册工具
toolkit.add_mcp_servers(
    config={
        "mcpServers": {
            "travel-mcp": {
                "command": "npx",
                "args": ["-y", "travel-mcp-server"],
                "env": {"TRAVEL_API_KEY": "your-key"}
            }
        }
    }
)

agent = ReActAgent(
    name="mcp_agent",
    model_config_name="qwen-max",
    sys_prompt="使用可用工具回答差旅相关问题。",
    service_toolkit=toolkit,
)
```

---

## 11. 实战案例：旅行规划多智能体系统

本案例整合阿里商旅 AliGo 实战经验，构建完整的旅行规划多智能体系统。

### 系统架构

```
  用户输入
     │
     ▼
┌───────────────────────────────────────────────────┐
│                  Main Planner Agent               │
│  ┌─────────────────────────────────────────────┐  │
│  │  规则引擎 classify()                        │  │
│  │  简单意图 ──────────────────► 快车道路由    │  │
│  │  复杂意图 ──► Intent Agent ► 慢车道分析     │  │
│  └─────────────────────────────────────────────┘  │
└───────────────────────┬───────────────────────────┘
                        │ 调度子 Agent
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
  ┌────────────┐  ┌──────────┐  ┌──────────────┐
  │ Trip Plan  │  │   Info   │  │  RAG Query   │
  │   Agent    │  │  Agent   │  │    Agent     │
  │ (行程规划) │  │ (信息查询)│  │ (知识库检索) │
  └────────────┘  └──────────┘  └──────────────┘
         │              │              │
         └──────────────┼──────────────┘
                        ▼
              ┌──────────────────┐
              │  TaskCollector   │ ← 实时思考链收集
              │   SSE 流式输出   │
              └──────────────────┘
                        │
                        ▼
                    最终回复
```

### 完整实现

```python
import json
import agentscope
from agentscope.agents import DialogAgent, DictDialogAgent, ReActAgent
from agentscope.message import Msg
from agentscope.pipelines import SequentialPipeline, IfElsePipeline, ParallelPipeline
from agentscope.service import ServiceToolkit, service_func

# --- 初始化 ---
agentscope.init(
    model_configs=[
        {
            "config_name": "qwen-max",
            "model_type": "dashscope_chat",
            "model_name": "qwen-max",
            "api_key": "your-api-key",
        }
    ]
)


# --- 工具定义 ---
@service_func
def search_hotel(city: str, check_in: str, check_out: str) -> str:
    """搜索酒店，返回推荐列表"""
    return f"[模拟] {city} {check_in}~{check_out} 推荐酒店：维也纳酒店¥388/晚"


@service_func
def search_flight(departure: str, destination: str, date: str) -> str:
    """搜索机票，返回航班信息"""
    return f"[模拟] {departure}→{destination} {date} 最优航班：CA1234 ¥620"


@service_func
def query_knowledge_base(question: str) -> str:
    """查询差旅政策知识库"""
    return f"[模拟] 关于'{question}'的差旅政策：经济舱上限¥1500/段"


# --- 规则引擎（快车道） ---
SIMPLE_INTENT_PATTERNS = {
    "为我规划行程": "trip_plan",
    "开始规划":     "trip_plan",
    "查询机票":     "flight_query",
    "查询酒店":     "hotel_query",
}

def classify_simple_intent(content: str) -> str | None:
    for pattern, intent in SIMPLE_INTENT_PATTERNS.items():
        if pattern in content:
            return intent
    return None


# --- Agent 定义 ---
intent_agent = DictDialogAgent(
    name="intent_recognizer",
    model_config_name="qwen-max",
    sys_prompt="""分析用户意图，输出：
    {"intent": "trip_plan|flight_query|hotel_query|knowledge_query|unknown",
     "entities": {"city": "...", "date": "...", "destination": "..."},
     "reasoning": "推理过程"}
    """,
    parse_func=json.loads,
)

toolkit = ServiceToolkit()
toolkit.add(search_hotel)
toolkit.add(search_flight)
toolkit.add(query_knowledge_base)

trip_plan_agent = ReActAgent(
    name="trip_planner",
    model_config_name="qwen-max",
    sys_prompt="你是专业差旅规划师，使用工具为用户制定完整行程方案。",
    service_toolkit=toolkit,
    max_iters=6,
)

summary_agent = DialogAgent(
    name="summarizer",
    model_config_name="qwen-max",
    sys_prompt="将多个子 Agent 的查询结果整合为一份清晰、友好的旅行规划报告。",
)


# --- 主规划逻辑 ---
def handle_travel_request(user_input: str) -> str:
    user_msg = Msg(name="user", content=user_input, role="user")

    # 快车道：规则直接路由
    simple_intent = classify_simple_intent(user_input)
    if simple_intent:
        print(f"[快车道] 意图={simple_intent}，跳过 LLM 分析")
        final = trip_plan_agent(user_msg)
        return final.content

    # 慢车道：LLM 意图分析 + 动态路由
    intent_result = intent_agent(user_msg)
    intent = intent_result.content.get("intent", "unknown")
    print(f"[慢车道] 识别意图={intent}")

    if intent in ("trip_plan", "flight_query", "hotel_query"):
        final = trip_plan_agent(user_msg)
    else:
        final = summary_agent(user_msg)

    return final.content


# --- 运行示例 ---
if __name__ == "__main__":
    # 快车道示例
    result1 = handle_travel_request("为我规划行程：北京出发，杭州，5月1日3天")
    print(result1)

    # 慢车道示例
    result2 = handle_travel_request("下个月想带家人去西安玩几天，求推荐")
    print(result2)
```

### 关键经验（来自阿里商旅实战）

1. **单智能体 Token 膨胀**：业务规则全塞一个 Prompt 导致准确率骤降 → 拆分专职 Agent，每个 Agent 只关注自己的上下文
2. **快慢车道分离**：固定意图走规则引擎，复杂语义才走 LLM，平均延迟降低 40%+
3. **ReAct Hook 构建思考链**：在 `_acting` 方法暴露的 hook 上收集工具调用流，实时展示给用户，缓解等待焦虑
4. **动态 Prompt 状态机**：不同对话阶段注入不同 Prompt 片段（而非全量加载），模型注意力更聚焦

---

## 12. 常见踩坑

### 坑1：忘记先调用 agentscope.init()

**现象**：创建 Agent 时报 `ModelNotFoundError` 或模型配置为空。

```python
# ❌ 错误：直接创建 Agent，没有初始化
from agentscope.agents import DialogAgent

agent = DialogAgent(
    name="assistant",
    model_config_name="qwen-max",   # 报错：找不到 "qwen-max" 配置
    sys_prompt="..."
)

# ✅ 正确：先 init，再创建 Agent
import agentscope

agentscope.init(
    model_configs=[
        {
            "config_name": "qwen-max",
            "model_type": "dashscope_chat",
            "model_name": "qwen-max",
            "api_key": "your-key",
        }
    ]
)

agent = DialogAgent(
    name="assistant",
    model_config_name="qwen-max",   # 正常引用
    sys_prompt="..."
)
```

---

### 坑2：Agent 间直接传裸 dict，消息格式不统一

**现象**：`DictDialogAgent` 输出 dict，传入 `DialogAgent` 后 `content` 字段解析异常。

```python
# ❌ 错误：直接把 dict 当消息传递
result = intent_agent(user_msg)
raw_dict = result.content          # dict 类型
next_msg = raw_dict                # 传给下一个 Agent，类型不对

# ❌ 错误：手动构造非标准 dict
msg = {"role": "user", "text": "你好"}   # 缺少 name 字段，格式不符

# ✅ 正确：始终使用 Msg 类型包装
from agentscope.message import Msg

result = intent_agent(user_msg)           # result 是 Msg
# 若需要在消息中携带结构化数据，放在 metadata 里
structured_msg = Msg(
    name="intent_agent",
    content=f"意图识别结果：{result.content}",
    role="assistant",
    metadata=result.content,              # 结构化数据放 metadata
)
next_result = plan_agent(structured_msg)
```

---

### 坑3：多 Agent 共享记忆导致 Token 暴涨

**现象**：随着对话轮次增加，后期请求 Token 数达到上万，延迟极高，且模型注意力分散。

```python
# ❌ 错误：所有 Agent 共享同一个无限制的 TemporaryMemory
shared_memory = TemporaryMemory()   # 没有设上限

intent_agent  = DialogAgent(..., memory=shared_memory)
plan_agent    = DialogAgent(..., memory=shared_memory)
summary_agent = DialogAgent(..., memory=shared_memory)
# 10 轮后 shared_memory 里有 30 条消息，全量注入每个 Agent

# ✅ 正确：每个 Agent 独立记忆 + 按需传递关键上下文
intent_agent  = DialogAgent(..., memory=TemporaryMemory(config={"max_tokens": 2048}))
plan_agent    = DialogAgent(..., memory=TemporaryMemory(config={"max_tokens": 4096}))
summary_agent = DialogAgent(..., memory=TemporaryMemory(config={"max_tokens": 2048}))

# 需要共享时，只传递关键信息片段
def pass_key_context(source_agent, target_agent, last_n: int = 3):
    recent = source_agent.memory.get_memory()[-last_n:]
    for msg in recent:
        target_agent.memory.add(msg)
```

---

### 坑4：ReActAgent max_iters 未设置，进入无限循环

**现象**：Agent 在工具调用和推理之间死循环，接口永不返回，耗尽 API 配额。

```python
# ❌ 错误：未设置 max_iters（默认可能很大或不限制）
agent = ReActAgent(
    name="planner",
    model_config_name="qwen-max",
    sys_prompt="...",
    service_toolkit=toolkit,
    # max_iters 未设置，工具报错后 Agent 反复重试
)

# ✅ 正确：明确设置合理上限，并在工具中做好错误处理
agent = ReActAgent(
    name="planner",
    model_config_name="qwen-max",
    sys_prompt="若工具调用失败，请告知用户并给出替代建议，不要重复尝试。",
    service_toolkit=toolkit,
    max_iters=6,        # 业务流程最多 6 步，超出即停止
)

# 工具函数也要有防御
@service_func
def search_hotel(city: str, check_in: str, check_out: str) -> str:
    try:
        return hotel_api.search(...)
    except Exception as e:
        return f"酒店查询暂时失败（{e}），请稍后重试或手动查询。"
```

---

### 坑5：Pipeline 并行结果顺序依赖假设

**现象**：`ParallelPipeline` 执行后，错误地假设结果顺序与业务逻辑无关，导致数据混用。

```python
# ❌ 错误：按硬编码索引取结果，假设顺序固定
parallel = ParallelPipeline([hotel_agent, flight_agent, sight_agent])
results = parallel(user_msg)

hotel_result  = results[0]    # 危险！并发执行顺序不保证
flight_result = results[1]
sight_result  = results[2]

# ✅ 正确：按 Agent name 识别结果，不依赖顺序
results = parallel(user_msg)
result_map = {msg.name: msg for msg in results}

hotel_result  = result_map.get("hotel_expert")
flight_result = result_map.get("flight_expert")
sight_result  = result_map.get("sight_expert")

# 或者在聚合时遍历处理，不关心顺序
combined = "\n\n".join(
    [f"### {r.name}\n{r.content}" for r in results]
)
```

---

### 坑6：DictDialogAgent parse_func 未处理 LLM 输出不规范

**现象**：LLM 偶尔在 JSON 前后输出多余文字（Markdown 代码块、解释性语句），`json.loads` 直接抛出 `JSONDecodeError`。

```python
# ❌ 错误：直接用 json.loads，无容错
agent = DictDialogAgent(
    name="intent",
    model_config_name="qwen-max",
    sys_prompt="输出 JSON...",
    parse_func=json.loads,      # LLM 输出 ```json {...} ``` 时崩溃
)

# ✅ 正确：包一层容错 parse_func
import re, json

def robust_json_parse(text: str) -> dict:
    """容错解析：提取文本中第一个完整 JSON 对象"""
    # 去掉 Markdown 代码块包裹
    clean = re.sub(r"```(?:json)?\s*|\s*```", "", text).strip()
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        # 尝试正则提取 JSON 对象
        match = re.search(r"\{.*\}", clean, re.DOTALL)
        if match:
            return json.loads(match.group())
        return {"error": "parse_failed", "raw": text}

agent = DictDialogAgent(
    name="intent",
    model_config_name="qwen-max",
    sys_prompt="输出 JSON...",
    parse_func=robust_json_parse,   # 容错版
)
```

---

### 坑7：分布式部署后忘记 to_dist() 初始化顺序

**现象**：Client 调用远程 Agent 报连接拒绝，或 Agent 在远端初始化失败找不到模型配置。

```python
# ❌ 错误：client 端调用 to_dist() 前没有 agentscope.init()
agent = DialogAgent(
    name="remote_assistant",
    model_config_name="qwen-max",
    sys_prompt="...",
).to_dist(host="10.0.0.1", port=12345)
# 报错：remote server 无法找到 model_config

# ✅ 正确：server 端和 client 端都要独立 init
# --- server.py ---
agentscope.init(model_configs=[...])    # server 端初始化模型配置
launcher = RpcAgentServerLauncher(...)
launcher.launch()

# --- client.py ---
agentscope.init(model_configs=[...])    # client 端也需要 init（即使不直接用模型）
agent = DialogAgent(...).to_dist(host="10.0.0.1", port=12345)
```

---

## 13. 速查表

### 核心类速查

```
+------------------------------+----------------------------------------+
| 类/函数                      | 用途                                   |
+------------------------------+----------------------------------------+
| agentscope.init()            | 全局初始化，注册模型配置               |
| Msg(name, content, role)     | 统一消息类型，Agent 间唯一通信载体     |
| DialogAgent                  | 通用对话 Agent，自由文本输出           |
| DictDialogAgent              | 结构化 JSON 输出 Agent                 |
| UserAgent                    | 模拟用户输入 Agent                     |
| ReActAgent                   | 工具调用推理循环 Agent                 |
| SequentialPipeline           | 顺序执行多个 Agent                     |
| ParallelPipeline             | 并行执行多个 Agent                     |
| IfElsePipeline               | 条件分支 Pipeline                      |
| WhileLoopPipeline            | 条件循环 Pipeline                      |
| ForLoopPipeline              | 固定次数循环 Pipeline                  |
| TemporaryMemory              | Agent 临时记忆                         |
| ServiceToolkit               | 工具注册与管理                         |
| @service_func                | 将函数注册为 Agent 可调用工具          |
| RpcAgentServerLauncher       | 启动分布式 Agent 服务                  |
| agent.to_dist(host, port)    | 将 Agent 迁移到远程服务                |
+------------------------------+----------------------------------------+
```

### Pipeline 选型决策

```
需要 Agent 按顺序串行执行？
    └── YES → SequentialPipeline

需要同一任务并行分发给多个 Agent？
    └── YES → ParallelPipeline

需要根据条件走不同分支？
    └── YES → IfElsePipeline

需要循环直到满足条件？
    └── YES → WhileLoopPipeline

需要固定执行 N 次？
    └── YES → ForLoopPipeline

需要嵌套以上逻辑？
    └── 嵌套组合使用，SequentialPipeline 可包含任意 Pipeline
```

### model_type 速查

```
阿里云 DashScope  → dashscope_chat
OpenAI            → openai_chat
Azure OpenAI      → azure_openai_chat
Ollama（本地）    → ollama_chat
智谱 GLM          → zhipuai_chat
LiteLLM 代理      → litellm_chat
```

### 消息 role 规范

```
user       — 用户输入
assistant  — Agent 回复
system     — 系统级指令/上下文注入
tool       — 工具调用结果
```

### 生产最佳实践清单

```
[ ] agentscope.init() 在程序入口唯一调用一次
[ ] 所有 Agent 消息传递使用 Msg 类型，禁止裸 dict
[ ] TemporaryMemory 设置 max_tokens 防止 Token 暴涨
[ ] ReActAgent 设置合理 max_iters（通常 5~10）
[ ] DictDialogAgent 使用容错 parse_func
[ ] 按最小权限原则控制 Agent 间记忆共享范围
[ ] 复杂意图走 LLM，固定意图走规则引擎（快慢车道）
[ ] 分布式场景：server 和 client 端均独立调用 init()
[ ] ParallelPipeline 结果按 msg.name 识别，不按索引
[ ] 生产环境接入 Langfuse 进行全链路可观测
```
