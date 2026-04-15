# LangGraph 最佳实践与踩坑指南

## 文档信息

- 作者：徐凯旋
- 邮箱：azouever@gmail.com
- 更新时间：2026-04-14
- 标签：LangGraph, 状态机, Agent, 工作流, LangChain

---

## 目录

1. [概述](#一概述)
2. [核心概念](#二核心概念)
3. [状态管理](#三状态管理)
4. [图构建模式](#四图构建模式)
5. [节点设计](#五节点设计)
6. [条件路由](#六条件路由)
7. [持久化与恢复](#七持久化与恢复)
8. [人机协作](#八人机协作)
9. [常见踩坑与解决方案](#九常见踩坑与解决方案)
10. [生产环境注意事项](#十生产环境注意事项)
11. [参考资源](#十一参考资源)

---

## 一、概述

### 1.1 什么是 LangGraph

LangGraph 是 LangChain 团队推出的状态机编排框架，专门用于构建有状态的、多角色的 LLM 应用。相比传统的 Chain：

- **状态管理**：内置状态传递和更新机制
- **循环支持**：原生支持循环和分支
- **持久化**：支持 Checkpointer 保存状态
- **可视化**：图结构可视化调试
- **人机协作**：支持 Human-in-the-loop

### 1.2 LangGraph vs LangChain Chain

```
+------------------------------------------------------------------+
|                    LangGraph vs Chain 对比                        |
+------------------------------------------------------------------+
|                                                                   |
|  维度              Chain                    LangGraph             |
|  ---------------------------------------------------------------- |
|  流程控制          线性/DAG               任意图（含循环）         |
|  状态管理          手动传递               自动状态管理             |
|  持久化            需自己实现              内置 Checkpointer       |
|  循环              不支持                  原生支持               |
|  条件分支          RunnableBranch         条件边                  |
|  人机协作          困难                    原生支持               |
|  可视化            无                      Mermaid 图              |
|  调试              基础                    状态快照               |
|  适用场景          简单流程                复杂 Agent 工作流       |
|                                                                   |
+------------------------------------------------------------------+
```

### 1.3 核心架构

```
+------------------------------------------------------------------+
|                    LangGraph 核心架构                              |
+------------------------------------------------------------------+
|                                                                   |
|  StateGraph                                                      |
|  ├── State (TypedDict)          # 状态定义                        |
|  ├── Nodes                      # 节点函数                        |
|  ├── Edges                      # 边（普通边/条件边）              |
|  └── Checkpointer               # 状态持久化                      |
|                                                                   |
|  编译流程                                                        |
|  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    |
|  │ 定义状态  │ -> │ 添加节点  │ -> │ 添加边   │ -> │ 编译图   │    |
|  └──────────┘    └──────────┘    └──────────┘    └──────────┘    |
|                                                                   |
|  运行时                                                          |
|  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    |
|  │ invoke   │    │ stream   │    │ astream  │    │ get_state│    |
|  │ 同步调用  │    │ 流式调用  │    │ 异步流式  │    │ 获取状态  │    |
|  └──────────┘    └──────────┘    └──────────┘    └──────────┘    |
|                                                                   |
+------------------------------------------------------------------+
```

---

## 二、核心概念

### 2.1 State（状态）

状态是图运行过程中传递和更新的数据：

```python
from typing import TypedDict, Annotated, Sequence
from langchain_core.messages import BaseMessage
import operator

# 基础状态定义
class BasicState(TypedDict):
    messages: Sequence[BaseMessage]  # 消息列表
    next_step: str                    # 下一步

# 带累加器的状态
class AccumulatorState(TypedDict):
    # Annotated[list, operator.add] 表示更新时会累加而非覆盖
    messages: Annotated[Sequence[BaseMessage], operator.add]
    documents: Annotated[list, operator.add]
    current_step: str
    error_count: int
    metadata: dict
```

### 2.2 Node（节点）

节点是执行具体操作的函数：

```python
from typing import Dict, Any

def agent_node(state: BasicState) -> Dict[str, Any]:
    """
    节点函数接收 state，返回要更新的字段。

    返回值会与现有状态合并（对于 Annotated 字段会累加）。
    """
    messages = state["messages"]

    # 执行逻辑
    response = llm.invoke(messages)

    # 返回要更新的字段
    return {
        "messages": [response],  # 会追加到 messages
        "next_step": "tools"
    }

# 异步节点
async def async_agent_node(state: BasicState) -> Dict[str, Any]:
    """异步节点"""
    messages = state["messages"]
    response = await llm.ainvoke(messages)

    return {
        "messages": [response],
        "next_step": "tools"
    }
```

### 2.3 Edge（边）

边定义节点之间的连接关系：

```python
from langgraph.graph import StateGraph, END

# 普通边：固定连接
graph.add_edge("node_a", "node_b")

# 条件边：根据状态决定下一个节点
def route_condition(state: BasicState) -> str:
    """路由函数，返回下一个节点名称"""
    if state.get("next_step") == "end":
        return END
    return "tools"

graph.add_conditional_edges(
    "agent",              # 源节点
    route_condition,      # 路由函数
    {
        "tools": "tools",  # 路由结果 -> 目标节点
        END: END
    }
)
```

### 2.4 Checkpointer（检查点）

用于持久化图的状态：

```python
from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.checkpoint.postgres import PostgresSaver

# 内存检查点（开发/测试）
checkpointer = MemorySaver()

# SQLite 检查点
checkpointer = SqliteSaver.from_conn_string("checkpoints.db")

# PostgreSQL 检查点
checkpointer = PostgresSaver.from_conn_string(
    "postgresql://user:pass@localhost/db"
)
```

---

## 三、状态管理

### 3.1 状态定义最佳实践

```python
from typing import TypedDict, Annotated, Sequence, Optional, List
from langchain_core.messages import BaseMessage
from pydantic import BaseModel, Field
import operator

# ========== 方式1：TypedDict（推荐） ==========

class AgentState(TypedDict):
    """Agent 状态"""
    # 消息历史（累加）
    messages: Annotated[Sequence[BaseMessage], operator.add]

    # 当前步骤
    current_step: str

    # 错误计数
    error_count: int

    # 最大迭代次数
    max_iterations: int

    # 迭代计数
    iteration: int

    # 工具调用记录（累加）
    tool_calls: Annotated[List[dict], operator.add]

    # 用户信息
    user_id: str
    session_id: str

    # 元数据
    metadata: dict


# ========== 方式2：Pydantic（验证更严格） ==========

class StrictAgentState(BaseModel):
    """严格验证的 Agent 状态"""
    messages: List[BaseMessage] = Field(default_factory=list)
    current_step: str = Field(default="start")
    error_count: int = Field(default=0, ge=0)
    max_iterations: int = Field(default=10, ge=1, le=100)
    iteration: int = Field(default=0, ge=0)
    tool_calls: List[dict] = Field(default_factory=list)
    user_id: str
    session_id: str
    metadata: dict = Field(default_factory=dict)

    class Config:
        arbitrary_types_allowed = True  # 允许 BaseMessage 类型


# ========== 方式3：带默认值的状态 ==========

from typing import Required, NotRequired

class FlexibleState(TypedDict):
    """带可选字段的状态"""
    messages: Annotated[Sequence[BaseMessage], operator.add]
    query: Required[str]           # 必填
    answer: NotRequired[str]       # 可选
    confidence: NotRequired[float] # 可选
```

### 3.2 状态更新模式

```python
from typing import Dict, Any

# ========== 模式1：返回增量更新 ==========

def good_node(state: AgentState) -> Dict[str, Any]:
    """正确：返回增量更新"""
    response = llm.invoke(state["messages"])

    # 返回要更新的字段（会与现有状态合并）
    return {
        "messages": [response],      # 追加消息
        "current_step": "next",      # 更新步骤
        "iteration": state["iteration"] + 1  # 增加计数
    }


# ========== 模式2：错误示例 ==========

def bad_node(state: AgentState) -> Dict[str, Any]:
    """错误：直接修改状态"""
    state["messages"].append(response)  # 不要直接修改！
    state["current_step"] = "next"
    return state  # 不要返回整个状态


# ========== 模式3：条件更新 ==========

def conditional_node(state: AgentState) -> Dict[str, Any]:
    """条件更新"""
    updates = {}

    # 只在需要时更新
    if should_call_tool(state):
        updates["current_step"] = "tools"
    else:
        updates["current_step"] = "end"

    # 错误处理
    if state.get("error_count", 0) > 3:
        updates["current_step"] = "error_handler"

    return updates


# ========== 模式4：复杂状态更新 ==========

def complex_update_node(state: AgentState) -> Dict[str, Any]:
    """复杂状态更新"""
    # 获取当前值
    iteration = state.get("iteration", 0)
    error_count = state.get("error_count", 0)

    # 计算新值
    updates = {
        "iteration": iteration + 1,
    }

    # 添加消息
    if iteration % 5 == 0:
        # 每 5 次迭代添加一个检查点消息
        updates["messages"] = [
            SystemMessage(content=f"[检查点] 已完成 {iteration} 次迭代")
        ]

    return updates
```

### 3.3 状态访问工具

```python
from langgraph.graph import StateGraph
from typing import List, Dict

class StateAccessor:
    """状态访问工具类"""

    @staticmethod
    def get_messages(state: Dict) -> List:
        """安全获取消息"""
        return state.get("messages", [])

    @staticmethod
    def get_last_message(state: Dict):
        """获取最后一条消息"""
        messages = state.get("messages", [])
        return messages[-1] if messages else None

    @staticmethod
    def get_user_message(state: Dict) -> str:
        """获取用户输入"""
        messages = state.get("messages", [])
        for msg in reversed(messages):
            if msg.type == "human":
                return msg.content
        return ""

    @staticmethod
    def get_tool_calls(state: Dict) -> List[dict]:
        """获取工具调用"""
        return state.get("tool_calls", [])

    @staticmethod
    def get_iteration(state: Dict) -> int:
        """获取迭代次数"""
        return state.get("iteration", 0)

    @staticmethod
    def is_max_iterations(state: Dict) -> bool:
        """检查是否达到最大迭代"""
        iteration = state.get("iteration", 0)
        max_iter = state.get("max_iterations", 10)
        return iteration >= max_iter

    @staticmethod
    def get_error_count(state: Dict) -> int:
        """获取错误计数"""
        return state.get("error_count", 0)

    @staticmethod
    def increment_error(state: Dict) -> Dict:
        """增加错误计数"""
        return {
            "error_count": state.get("error_count", 0) + 1
        }
```

---

## 四、图构建模式

### 4.1 ReAct Agent 图

```python
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from typing import TypedDict, Annotated, Sequence, Dict, Any
import operator

# 状态定义
class ReActState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], operator.add]
    tool_calls: Annotated[List[dict], operator.add]
    iteration: int
    max_iterations: int

def create_react_graph(tools: List):
    """创建 ReAct Agent 图"""

    # 初始化 LLM
    llm = ChatOpenAI(model="gpt-4o")

    # 工具映射
    tool_map = {tool.name: tool for tool in tools}

    # ========== 节点定义 ==========

    def agent_node(state: ReActState) -> Dict[str, Any]:
        """Agent 节点：决定下一步行动"""
        messages = state["messages"]

        # 调用 LLM
        response = llm.invoke(messages)

        return {
            "messages": [response],
            "iteration": state.get("iteration", 0) + 1
        }

    def tools_node(state: ReActState) -> Dict[str, Any]:
        """工具节点：执行工具调用"""
        last_message = state["messages"][-1]
        tool_calls = getattr(last_message, "tool_calls", [])

        results = []
        for tool_call in tool_calls:
            tool_name = tool_call["name"]
            tool_args = tool_call["args"]

            if tool_name in tool_map:
                try:
                    result = tool_map[tool_name].invoke(tool_args)
                    results.append(ToolMessage(
                        content=str(result),
                        tool_call_id=tool_call["id"]
                    ))
                except Exception as e:
                    results.append(ToolMessage(
                        content=f"Error: {str(e)}",
                        tool_call_id=tool_call["id"]
                    ))

        return {
            "messages": results,
            "tool_calls": tool_calls
        }

    # ========== 路由函数 ==========

    def should_continue(state: ReActState) -> str:
        """决定是否继续"""
        # 检查迭代次数
        if state.get("iteration", 0) >= state.get("max_iterations", 10):
            return "end"

        # 检查是否有工具调用
        last_message = state["messages"][-1]
        if hasattr(last_message, "tool_calls") and last_message.tool_calls:
            return "tools"

        return "end"

    # ========== 构建图 ==========

    workflow = StateGraph(ReActState)

    # 添加节点
    workflow.add_node("agent", agent_node)
    workflow.add_node("tools", tools_node)

    # 设置入口
    workflow.set_entry_point("agent")

    # 添加边
    workflow.add_conditional_edges(
        "agent",
        should_continue,
        {
            "tools": "tools",
            "end": END
        }
    )
    workflow.add_edge("tools", "agent")

    return workflow.compile()
```

### 4.2 多 Agent 协作图

```python
from langgraph.graph import StateGraph, END
from typing import TypedDict, Annotated, List, Dict, Any, Literal
import operator

# 状态定义
class MultiAgentState(TypedDict):
    messages: Annotated[List, operator.add]
    next_agent: str
    task_completed: bool
    results: Dict[str, Any]

def create_multi_agent_graph():
    """创建多 Agent 协作图"""

    # ========== Agent 定义 ==========

    def supervisor_agent(state: MultiAgentState) -> Dict[str, Any]:
        """监督者 Agent：分配任务"""
        messages = state["messages"]

        # 分析任务，决定下一个 Agent
        prompt = f"""分析以下任务，决定应该由哪个 Agent 处理：

当前对话：{messages[-1].content}

可选 Agent：
- researcher: 搜索和检索信息
- analyst: 分析数据
- writer: 生成内容

只输出 Agent 名称。"""

        response = llm.invoke([SystemMessage(content=prompt)])
        next_agent = response.content.strip().lower()

        return {"next_agent": next_agent}

    def researcher_agent(state: MultiAgentState) -> Dict[str, Any]:
        """研究员 Agent：搜索信息"""
        query = state["messages"][-1].content

        # 执行搜索
        results = search_tool.invoke(query)

        return {
            "messages": [AIMessage(content=f"[Researcher] 搜索结果：{results}")],
            "next_agent": "analyst"
        }

    def analyst_agent(state: MultiAgentState) -> Dict[str, Any]:
        """分析师 Agent：分析数据"""
        # 分析数据
        analysis = "分析结果..."

        return {
            "messages": [AIMessage(content=f"[Analyst] {analysis}")],
            "next_agent": "writer"
        }

    def writer_agent(state: MultiAgentState) -> Dict[str, Any]:
        """写作 Agent：生成内容"""
        # 生成最终内容
        content = "最终内容..."

        return {
            "messages": [AIMessage(content=content)],
            "task_completed": True
        }

    # ========== 路由函数 ==========

    def route_agent(state: MultiAgentState) -> str:
        """路由到下一个 Agent"""
        if state.get("task_completed"):
            return END
        return state.get("next_agent", "supervisor")

    # ========== 构建图 ==========

    workflow = StateGraph(MultiAgentState)

    # 添加节点
    workflow.add_node("supervisor", supervisor_agent)
    workflow.add_node("researcher", researcher_agent)
    workflow.add_node("analyst", analyst_agent)
    workflow.add_node("writer", writer_agent)

    # 设置入口
    workflow.set_entry_point("supervisor")

    # 添加条件边
    workflow.add_conditional_edges(
        "supervisor",
        route_agent,
        {
            "researcher": "researcher",
            "analyst": "analyst",
            "writer": "writer",
            END: END
        }
    )

    workflow.add_conditional_edges("researcher", route_agent, {"analyst": "analyst", END: END})
    workflow.add_conditional_edges("analyst", route_agent, {"writer": "writer", END: END})
    workflow.add_conditional_edges("writer", route_agent, {END: END})

    return workflow.compile()
```

### 4.3 分层图（Subgraph）

```python
from langgraph.graph import StateGraph, END

def create_nested_graph():
    """创建嵌套图"""

    # ========== 子图：信息收集 ==========

    class InfoGatheringState(TypedDict):
        query: str
        search_results: List[str]
        analysis: str

    def search_node(state: InfoGatheringState) -> Dict[str, Any]:
        """搜索节点"""
        results = search_tool.invoke(state["query"])
        return {"search_results": results}

    def analyze_node(state: InfoGatheringState) -> Dict[str, Any]:
        """分析节点"""
        analysis = "分析结果..."
        return {"analysis": analysis}

    info_graph = StateGraph(InfoGatheringState)
    info_graph.add_node("search", search_node)
    info_graph.add_node("analyze", analyze_node)
    info_graph.set_entry_point("search")
    info_graph.add_edge("search", "analyze")
    info_graph.add_edge("analyze", END)
    info_subgraph = info_graph.compile()

    # ========== 主图 ==========

    class MainState(TypedDict):
        query: str
        info: Dict[str, Any]
        response: str

    def gather_info_node(state: MainState) -> Dict[str, Any]:
        """调用子图收集信息"""
        # 调用子图
        result = info_subgraph.invoke({"query": state["query"]})
        return {"info": result}

    def generate_response_node(state: MainState) -> Dict[str, Any]:
        """生成响应"""
        response = "最终响应..."
        return {"response": response}

    main_graph = StateGraph(MainState)
    main_graph.add_node("gather_info", gather_info_node)
    main_graph.add_node("generate_response", generate_response_node)
    main_graph.set_entry_point("gather_info")
    main_graph.add_edge("gather_info", "generate_response")
    main_graph.add_edge("generate_response", END)

    return main_graph.compile()
```

---

## 五、节点设计

### 5.1 节点设计原则

```python
from typing import Dict, Any
import logging

logger = logging.getLogger(__name__)

# ========== 原则1：单一职责 ==========

def good_single_responsibility_node(state: AgentState) -> Dict[str, Any]:
    """
    好的设计：每个节点只做一件事
    - 只负责调用 LLM
    - 不做其他逻辑
    """
    response = llm.invoke(state["messages"])
    return {"messages": [response]}

def bad_node(state: AgentState) -> Dict[str, Any]:
    """
    不好的设计：一个节点做多件事
    - 调用 LLM
    - 执行工具
    - 更新计数
    - 生成摘要
    """
    # 太多职责，难以维护
    pass


# ========== 原则2：幂等性 ==========

def idempotent_node(state: AgentState) -> Dict[str, Any]:
    """
    幂等节点：多次执行结果相同
    """
    # 检查是否已经处理过
    if state.get("processed"):
        return {}  # 不做任何更新

    # 执行处理
    result = process(state)

    return {
        "processed": True,
        "result": result
    }


# ========== 原则3：错误处理 ==========

def robust_node(state: AgentState) -> Dict[str, Any]:
    """健壮的节点：处理错误"""
    try:
        result = llm.invoke(state["messages"])
        return {
            "messages": [result],
            "error_count": 0  # 重置错误计数
        }
    except Exception as e:
        logger.error(f"Node error: {e}")

        return {
            "error_count": state.get("error_count", 0) + 1,
            "last_error": str(e)
        }


# ========== 原则4：可观测性 ==========

def observable_node(state: AgentState) -> Dict[str, Any]:
    """可观测的节点：记录日志和指标"""
    import time

    start_time = time.time()

    logger.info(f"Node started | state_keys: {list(state.keys())}")

    try:
        result = llm.invoke(state["messages"])

        duration = time.time() - start_time
        logger.info(f"Node completed | duration: {duration:.2f}s")

        return {"messages": [result]}

    except Exception as e:
        duration = time.time() - start_time
        logger.error(f"Node failed | duration: {duration:.2f}s | error: {e}")
        raise
```

### 5.2 特殊节点类型

```python
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode

# ========== 工具节点 ==========

def create_tool_node(tools: List):
    """创建工具节点"""
    # 使用预构建的 ToolNode
    tool_node = ToolNode(tools)
    return tool_node

# 或自定义工具节点
def custom_tool_node(state: AgentState) -> Dict[str, Any]:
    """自定义工具节点"""
    from langchain_core.messages import ToolMessage

    last_message = state["messages"][-1]
    tool_calls = getattr(last_message, "tool_calls", [])

    results = []
    for tool_call in tool_calls:
        # 执行工具
        result = execute_tool(
            tool_call["name"],
            tool_call["args"]
        )

        results.append(ToolMessage(
            content=result,
            tool_call_id=tool_call["id"]
        ))

    return {"messages": results}


# ========== 条件节点 ==========

def conditional_processing_node(state: AgentState) -> Dict[str, Any]:
    """条件处理节点"""
    intent = state.get("intent", "general")

    if intent == "search":
        return {"next_step": "search"}
    elif intent == "booking":
        return {"next_step": "booking"}
    else:
        return {"next_step": "general"}


# ========== 并行节点 ==========

async def parallel_node(state: AgentState) -> Dict[str, Any]:
    """并行执行多个任务"""
    import asyncio

    # 并行调用多个服务
    tasks = [
        search_hotels(state["query"]),
        search_flights(state["query"]),
        get_weather(state["location"])
    ]

    results = await asyncio.gather(*tasks)

    return {
        "hotels": results[0],
        "flights": results[1],
        "weather": results[2]
    }


# ========== 人机协作节点 ==========

def human_input_node(state: AgentState) -> Dict[str, Any]:
    """等待人工输入的节点"""
    # 这个节点不会自动执行
    # 需要人工审核后才能继续
    return {
        "waiting_for_human": True,
        "human_input": None
    }
```

---

## 六、条件路由

### 6.1 路由函数设计

```python
from langgraph.graph import END
from typing import Literal

# ========== 简单路由 ==========

def simple_router(state: AgentState) -> str:
    """简单路由：根据字段值决定"""
    next_step = state.get("next_step", "end")

    if next_step == "tools":
        return "tools"
    elif next_step == "agent":
        return "agent"
    else:
        return END


# ========== 多条件路由 ==========

def multi_condition_router(state: AgentState) -> str:
    """多条件路由"""
    # 条件1：错误过多
    if state.get("error_count", 0) >= 3:
        return "error_handler"

    # 条件2：达到最大迭代
    if state.get("iteration", 0) >= state.get("max_iterations", 10):
        return "max_iterations_handler"

    # 条件3：有工具调用
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"

    # 条件4：需要更多输入
    if state.get("need_more_input"):
        return "ask_user"

    # 默认：结束
    return END


# ========== 类型安全路由 ==========

def typed_router(state: AgentState) -> Literal["tools", "end", "error"]:
    """类型安全的路由"""
    last_message = state["messages"][-1]

    if state.get("error_count", 0) >= 3:
        return "error"

    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"

    return "end"


# ========== LLM 路由 ==========

def llm_router(state: AgentState) -> str:
    """使用 LLM 决定路由"""
    prompt = f"""分析以下对话，决定下一步应该做什么：

对话历史：{state["messages"][-1].content}

可选操作：
- search: 需要搜索信息
- book: 需要预订
- answer: 可以直接回答
- end: 对话结束

只输出操作名称。"""

    response = llm.invoke([HumanMessage(content=prompt)])
    action = response.content.strip().lower()

    return action
```

### 6.2 添加条件边

```python
from langgraph.graph import StateGraph, END

# ========== 基础用法 ==========

workflow = StateGraph(AgentState)

workflow.add_node("agent", agent_node)
workflow.add_node("tools", tools_node)
workflow.add_node("error", error_node)

workflow.set_entry_point("agent")

# 添加条件边
workflow.add_conditional_edges(
    "agent",           # 源节点
    multi_condition_router,  # 路由函数
    {
        "tools": "tools",     # 路由结果 -> 目标节点
        "error_handler": "error",
        END: END
    }
)

# ========== 多目标路由 ==========

workflow.add_conditional_edges(
    "agent",
    typed_router,
    {
        "tools": "tools",
        "end": END,
        "error": "error"
    }
)

# ========== 复杂路由图 ==========

def complex_router(state: AgentState) -> str:
    """复杂路由逻辑"""
    # 优先级路由
    if state.get("emergency"):
        return "emergency_handler"

    if state.get("blocked"):
        return "blocked_handler"

    # 正常路由
    return normal_router(state)

workflow.add_conditional_edges(
    "agent",
    complex_router,
    {
        "emergency_handler": "emergency",
        "blocked_handler": "blocked",
        "tools": "tools",
        "end": END
    }
)
```

---

## 七、持久化与恢复

### 7.1 Checkpointer 使用

```python
from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.checkpoint.postgres import PostgresSaver

# ========== 内存 Checkpointer（开发） ==========

def create_memory_checkpointer():
    """内存检查点"""
    checkpointer = MemorySaver()

    # 编译图时使用
    app = workflow.compile(checkpointer=checkpointer)

    return app

# ========== SQLite Checkpointer（单机生产） ==========

def create_sqlite_checkpointer(db_path: str = "checkpoints.db"):
    """SQLite 检查点"""
    checkpointer = SqliteSaver.from_conn_string(db_path)

    app = workflow.compile(checkpointer=checkpointer)

    return app

# ========== PostgreSQL Checkpointer（分布式生产） ==========

def create_postgres_checkpointer(conn_string: str):
    """PostgreSQL 检查点"""
    checkpointer = PostgresSaver.from_conn_string(conn_string)

    app = workflow.compile(checkpointer=checkpointer)

    return app


# ========== 使用示例 ==========

def checkpoint_example():
    """检查点使用示例"""
    # 创建带检查点的图
    checkpointer = SqliteSaver.from_conn_string("checkpoints.db")
    app = workflow.compile(checkpointer=checkpointer)

    # 配置：使用 thread_id 区分不同会话
    config = {
        "configurable": {
            "thread_id": "session_123"
        }
    }

    # 第一次调用
    result1 = app.invoke(
        {"messages": [HumanMessage(content="你好")]},
        config=config
    )

    # 第二次调用（会恢复之前的上下文）
    result2 = app.invoke(
        {"messages": [HumanMessage(content="我刚才问了什么")]},
        config=config
    )

    # 获取当前状态
    current_state = app.get_state(config)
    print(f"当前状态: {current_state}")

    # 获取历史状态
    history = list(app.get_state_history(config))
    print(f"历史状态数: {len(history)}")
```

### 7.2 状态恢复

```python
from langgraph.graph import StateGraph

def state_recovery_example():
    """状态恢复示例"""

    # 创建应用
    checkpointer = SqliteSaver.from_conn_string("checkpoints.db")
    app = workflow.compile(checkpointer=checkpointer)

    config = {"configurable": {"thread_id": "session_123"}}

    # 获取当前状态
    state = app.get_state(config)
    print(f"当前状态值: {state.values}")
    print(f"下一步: {state.next}")

    # 获取状态历史
    history = list(app.get_state_history(config))

    # 恢复到之前的状态
    if history:
        # 选择要恢复的状态（比如上一个）
        target_state = history[1] if len(history) > 1 else history[0]

        # 更新状态
        app.update_state(
            config,
            target_state.values,
            as_of=target_state.config
        )

    # 从恢复的状态继续执行
    result = app.invoke(None, config)
```

### 7.3 手动状态管理

```python
def manual_state_management():
    """手动状态管理"""

    checkpointer = SqliteSaver.from_conn_string("checkpoints.db")
    app = workflow.compile(checkpointer=checkpointer)

    config = {"configurable": {"thread_id": "session_123"}}

    # ========== 更新状态 ==========

    # 更新特定字段
    app.update_state(
        config,
        {"user_preference": "喜欢户外活动"}
    )

    # 获取更新后的状态
    state = app.get_state(config)

    # ========== 回滚状态 ==========

    # 获取历史
    history = list(app.get_state_history(config))

    # 回滚到上一个状态
    if len(history) > 1:
        previous_state = history[1]
        app.update_state(
            config,
            previous_state.values,
            as_of=previous_state.config
        )

    # ========== 清除状态 ==========

    # 清除当前会话状态
    # app.delete_state(config)  # 如果支持
```

---

## 八、人机协作

### 8.1 interrupt_before / interrupt_after

```python
from langgraph.graph import StateGraph, END

def create_human_in_loop_graph():
    """创建人机协作图"""

    def agent_node(state):
        response = llm.invoke(state["messages"])
        return {"messages": [response]}

    def human_review_node(state):
        """人工审核节点"""
        # 这个节点不会自动执行
        # 会等待人工输入
        return state

    workflow = StateGraph(AgentState)
    workflow.add_node("agent", agent_node)
    workflow.add_node("human_review", human_review_node)

    workflow.set_entry_point("agent")
    workflow.add_edge("agent", "human_review")
    workflow.add_edge("human_review", END)

    # 编译时指定中断点
    app = workflow.compile(
        checkpointer=MemorySaver(),
        interrupt_before=["human_review"]  # 在 human_review 前中断
    )

    return app


# ========== 使用示例 ==========

def human_in_loop_example():
    """人机协作示例"""
    app = create_human_in_loop_graph()

    config = {"configurable": {"thread_id": "test"}}

    # 第一次调用：会在 human_review 前中断
    result = app.invoke(
        {"messages": [HumanMessage(content="帮我预订酒店")]},
        config=config
    )

    # 检查是否等待人工
    state = app.get_state(config)
    if state.next == ("human_review",):
        print("等待人工审核...")

        # 人工审核后继续
        # 可以更新状态
        app.update_state(
            config,
            {"approved": True}
        )

        # 继续执行
        result = app.invoke(None, config=config)
```

### 8.2 审核模式

```python
def create_review_workflow():
    """创建审核工作流"""

    class ReviewState(TypedDict):
        messages: Annotated[List, operator.add]
        draft: str
        review_comments: List[str]
        approved: bool
        iteration: int

    def draft_node(state: ReviewState):
        """生成草稿"""
        response = llm.invoke(state["messages"])
        return {
            "draft": response.content,
            "iteration": state.get("iteration", 0) + 1
        }

    def review_node(state: ReviewState):
        """审核节点（人工）"""
        # 等待人工审核
        return state

    def revise_node(state: ReviewState):
        """修订草稿"""
        comments = state.get("review_comments", [])
        prompt = f"""根据审核意见修订草稿：

草稿：{state["draft"]}
审核意见：{comments}

请修订："""

        response = llm.invoke(prompt)
        return {"draft": response.content}

    workflow = StateGraph(ReviewState)
    workflow.add_node("draft", draft_node)
    workflow.add_node("review", review_node)
    workflow.add_node("revise", revise_node)

    workflow.set_entry_point("draft")
    workflow.add_edge("draft", "review")

    def review_router(state: ReviewState):
        if state.get("approved"):
            return "approved"
        if state.get("iteration", 0) >= 3:
            return "max_iterations"
        return "revise"

    workflow.add_conditional_edges(
        "review",
        review_router,
        {
            "approved": END,
            "revise": "revise",
            "max_iterations": END
        }
    )
    workflow.add_edge("revise", "review")

    # 在 review 节点前中断
    app = workflow.compile(
        checkpointer=MemorySaver(),
        interrupt_before=["review"]
    )

    return app
```

---

## 九、常见踩坑与解决方案

### 9.1 状态不可变性问题

#### 坑1：直接修改状态

```python
# ❌ 错误：直接修改状态
def bad_node(state: AgentState):
    state["messages"].append(new_message)  # 直接修改！
    state["iteration"] += 1
    return state

# ✅ 正确：返回增量更新
def good_node(state: AgentState):
    return {
        "messages": [new_message],  # 返回新增部分
        "iteration": state["iteration"] + 1
    }

# 说明：
# 对于 Annotated[list, operator.add] 的字段，
# 返回的列表会自动追加到现有列表中
```

### 9.2 循环问题

#### 坑2：无限循环

```python
# ❌ 错误：没有终止条件的循环
workflow.add_edge("agent", "tools")
workflow.add_edge("tools", "agent")  # 无限循环！

# ✅ 正确：添加终止条件
def should_continue(state: AgentState) -> str:
    # 检查迭代次数
    if state.get("iteration", 0) >= state.get("max_iterations", 10):
        return END

    # 检查是否有工具调用
    last_message = state["messages"][-1]
    if not hasattr(last_message, "tool_calls") or not last_message.tool_calls:
        return END

    return "tools"

workflow.add_conditional_edges(
    "agent",
    should_continue,
    {
        "tools": "tools",
        END: END
    }
)
workflow.add_edge("tools", "agent")
```

### 9.3 Checkpointer 问题

#### 坑3：内存泄漏

```python
# ❌ 问题：无限增长的 checkpoint
# 每个 session 都保留完整历史

# ✅ 解决方案1：定期清理
import sqlite3
from datetime import datetime, timedelta

def cleanup_old_checkpoints(
    db_path: str,
    keep_days: int = 7
):
    """清理旧的检查点"""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cutoff_date = datetime.now() - timedelta(days=keep_days)

    cursor.execute("""
        DELETE FROM checkpoints
        WHERE created_at < ?
    """, (cutoff_date.isoformat(),))

    conn.commit()
    conn.close()


# ✅ 解决方案2：限制历史长度
def get_state_with_limit(
    app,
    config,
    max_history: int = 10
):
    """获取限制长度的历史"""
    history = list(app.get_state_history(config))

    # 只保留最近 N 个状态
    if len(history) > max_history:
        # 删除旧状态
        for old_state in history[max_history:]:
            # 删除逻辑...
            pass

    return history[:max_history]
```

#### 坑4：Checkpointer 配置错误

```python
# ❌ 错误：忘记配置 thread_id
result = app.invoke({"messages": [...]})  # 没有持久化

# ✅ 正确：配置 thread_id
config = {"configurable": {"thread_id": "session_123"}}
result = app.invoke({"messages": [...]}, config=config)
```

### 9.4 节点返回值问题

#### 坑5：返回完整状态

```python
# ❌ 错误：返回完整状态
def bad_node(state: AgentState):
    state["messages"].append(response)
    return state  # 返回整个状态

# ✅ 正确：只返回更新
def good_node(state: AgentState):
    return {"messages": [response]}  # 只返回要更新的字段
```

#### 坑6：返回 None

```python
# ❌ 错误：节点返回 None
def bad_node(state: AgentState):
    result = process(state)
    # 没有 return 语句，返回 None

# ✅ 正确：始终返回字典
def good_node(state: AgentState):
    result = process(state)
    return {"result": result}  # 至少返回空字典 {}
```

---

## 十、生产环境注意事项

### 10.1 错误处理策略

```python
from langgraph.graph import StateGraph, END
import logging

logger = logging.getLogger(__name__)

def create_production_graph():
    """创建生产级图"""

    def robust_agent_node(state: AgentState):
        """健壮的 Agent 节点"""
        try:
            response = llm.invoke(state["messages"])
            return {
                "messages": [response],
                "error_count": 0
            }
        except Exception as e:
            logger.error(f"Agent error: {e}", exc_info=True)

            error_count = state.get("error_count", 0) + 1

            # 添加错误消息
            error_msg = AIMessage(
                content=f"抱歉，处理时出现错误。请重试。"
            )

            return {
                "messages": [error_msg],
                "error_count": error_count,
                "last_error": str(e)
            }

    def error_handler_node(state: AgentState):
        """错误处理节点"""
        error = state.get("last_error", "未知错误")

        # 记录错误
        logger.error(f"Entering error handler: {error}")

        # 生成友好消息
        return {
            "messages": [AIMessage(
                content="抱歉，系统出现异常。请稍后重试或联系客服。"
            )]
        }

    def should_handle_error(state: AgentState) -> str:
        """错误处理路由"""
        if state.get("error_count", 0) >= 3:
            return "error_handler"
        return "continue"

    workflow = StateGraph(AgentState)
    workflow.add_node("agent", robust_agent_node)
    workflow.add_node("error_handler", error_handler_node)

    workflow.set_entry_point("agent")

    workflow.add_conditional_edges(
        "agent",
        should_handle_error,
        {
            "error_handler": "error_handler",
            "continue": "agent"  # 或其他节点
        }
    )
    workflow.add_edge("error_handler", END)

    return workflow.compile()
```

### 10.2 监控指标

```python
from prometheus_client import Counter, Histogram
import time

# Prometheus 指标
GRAPH_EXECUTE_COUNT = Counter(
    'langgraph_execute_total',
    'Total graph execution count',
    ['graph_name', 'status']
)

GRAPH_EXECUTE_LATENCY = Histogram(
    'langgraph_execute_latency_seconds',
    'Graph execution latency',
    ['graph_name']
)

NODE_EXECUTE_COUNT = Counter(
    'langgraph_node_execute_total',
    'Total node execution count',
    ['graph_name', 'node_name', 'status']
)

class MetricsCallback:
    """指标回调"""

    def __init__(self, graph_name: str):
        self.graph_name = graph_name
        self.start_time = None

    def on_graph_start(self):
        self.start_time = time.time()

    def on_graph_end(self, status: str = 'success'):
        GRAPH_EXECUTE_COUNT.labels(
            graph_name=self.graph_name,
            status=status
        ).inc()

        if self.start_time:
            latency = time.time() - self.start_time
            GRAPH_EXECUTE_LATENCY.labels(
                graph_name=self.graph_name
            ).observe(latency)

    def on_node_end(self, node_name: str, status: str = 'success'):
        NODE_EXECUTE_COUNT.labels(
            graph_name=self.graph_name,
            node_name=node_name,
            status=status
        ).inc()
```

### 10.3 资源管理

```python
from contextlib import asynccontextmanager
from langgraph.checkpoint.sqlite import SqliteSaver

@asynccontextmanager
async def managed_graph(graph_name: str, db_path: str):
    """资源管理的图执行"""
    checkpointer = None

    try:
        # 初始化
        checkpointer = SqliteSaver.from_conn_string(db_path)
        app = workflow.compile(checkpointer=checkpointer)

        metrics = MetricsCallback(graph_name)
        metrics.on_graph_start()

        yield app, metrics

        metrics.on_graph_end('success')

    except Exception as e:
        if 'metrics' in dir():
            metrics.on_graph_end('error')
        raise

    finally:
        # 清理资源
        if checkpointer:
            # checkpointer.close()  # 如果需要
            pass
```

---

## 十一、参考资源

### 11.1 官方资源

| 资源 | 链接 |
|------|------|
| 官方文档 | https://langchain-ai.github.io/langgraph/ |
| GitHub | https://github.com/langchain-ai/langgraph |
| 示例 | https://langchain-ai.github.io/langgraph/tutorials/ |
| API 参考 | https://langchain-ai.github.io/langgraph/reference/ |

### 11.2 核心概念

| 概念 | 说明 |
|------|------|
| StateGraph | 状态图，核心构建类 |
| State | 状态，节点间传递的数据 |
| Node | 节点，执行具体操作 |
| Edge | 边，节点间的连接 |
| Checkpointer | 检查点，状态持久化 |

### 11.3 最佳实践总结

1. **状态设计**
   - 使用 Annotated + operator.add 处理列表累加
   - 状态字段要有明确的语义
   - 避免在状态中存储大对象

2. **节点设计**
   - 单一职责原则
   - 返回增量更新，不要直接修改状态
   - 做好错误处理

3. **循环控制**
   - 必须设置最大迭代次数
   - 使用条件边控制流程
   - 避免无限循环

4. **持久化**
   - 生产环境使用数据库 Checkpointer
   - 定期清理旧检查点
   - 正确配置 thread_id

---

## 更新记录

| 日期 | 版本 | 更新内容 |
|------|------|----------|
| 2026-04-14 | v1.0 | 初始版本 |
