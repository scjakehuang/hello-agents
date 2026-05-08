from langchain.agents import create_agent


def get_weather(city: str) -> str:
    """获取给定城市的天气。"""

    return f"It's always sunny in {city}!"

agent = create_agent(
    model="anthropic:claude-sonnet-4.5",
    tools=[get_weather],
)
for chunk in agent.stream(  # [!code highlight]
        {"messages": [{"role": "user", "content": "What is the weather in SF?"}]},
        stream_mode="updates",
):
    for step, data in chunk.items():
        print(f"step: {step}")
        print(f"content: {data['messages'][-1].content_blocks}")