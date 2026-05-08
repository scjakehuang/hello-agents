from langchain.tools import tool
from langchain.chat_models import init_chat_model
from langchain.messages import AnyMessage, SystemMessage, HumanMessage, ToolMessage
from typing_extensions import TypedDict, Annotated
from typing import Literal
import operator
from langgraph.graph import StateGraph, START, END

model = init_chat_model("anthropic:claude-sonnet-4.5", temperature=0)

@tool
def multiply(a: int, b: int) -> int:
    """将 a 和 b 相乘。"""
    return a * b

@tool
def add(a: int, b: int) -> int:
    """将 a 和 b 相加。"""
    return a + b

@tool
def divide(a: int, b: int) -> float:
    """将 a 除以 b。"""
    return a / b

tools = [add, multiply, divide]
tools_by_name = {tool.name: tool for tool in tools}
model_with_tools = model.bind_tools(tools)

class MessagesState(TypedDict):
    messages: Annotated[list[AnyMessage], operator.add]
    llm_calls: int

def llm_call(state: dict):
    """LLM 决定是否调用工具"""
    return {
        "messages": [
            model_with_tools.invoke(
                [
                    SystemMessage(content="你是一个有用的助手，负责对一组输入执行算术运算。")
                ]
                + state["messages"]
            )
        ],
        "llm_calls": state.get("llm_calls", 0) + 1,
    }

def tool_node(state: dict):
    """执行工具调用"""
    result = []
    for tool_call in state["messages"][-1].tool_calls:
        tool = tools_by_name[tool_call["name"]]
        observation = tool.invoke(tool_call["args"])
        result.append(ToolMessage(content=observation, tool_call_id=tool_call["id"]))
    return {"messages": result}

def should_continue(state: MessagesState) -> Literal["tool_node", END]:
    """根据 LLM 是否进行了工具调用来决定路由"""
    last_message = state["messages"][-1]
    if last_message.tool_calls:
        return "tool_node"
    return END

agent_builder = StateGraph(MessagesState)
agent_builder.add_node("llm_call", llm_call)
agent_builder.add_node("tool_node", tool_node)
agent_builder.add_edge(START, "llm_call")
agent_builder.add_conditional_edges("llm_call", should_continue, ["tool_node", END])
agent_builder.add_edge("tool_node", "llm_call")
agent = agent_builder.compile()

messages = [HumanMessage(content="3 加 4 等于多少。")]
result = agent.invoke({"messages": messages})
for m in result["messages"]:
    m.pretty_print()
