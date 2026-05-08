from langchain.agents import create_agent


def get_weather(city: str) -> str:
    """获取指定城市的天气。"""
    return f"{city}总是阳光明媚！"

agent = create_agent(
    model="anthropic:claude-sonnet-4.5",
    tools=[get_weather],
    system_prompt="你是一个乐于助人的助手",
)

# 运行代理
result = agent.invoke(
    {"messages": [{"role": "user", "content": "旧金山的天气怎么样"}]}
)
print(result["messages"][-1].content)