from langchain.agents import create_agent
from langchain.agents.middleware import SummarizationMiddleware
from langgraph.checkpoint.memory import InMemorySaver
from langchain_core.runnables import RunnableConfig
from langchain.chat_models import init_chat_model

model = init_chat_model("anthropic:claude-sonnet-4.5")
checkpointer = InMemorySaver()

agent = create_agent(
    model,
    tools=[],
    middleware=[
        SummarizationMiddleware(
            model="anthropic:claude-sonnet-4.5",
            trigger=("tokens", 4000),
            keep=("messages", 20),
        )
    ],
    checkpointer=checkpointer,
)

config: RunnableConfig = {"configurable": {"thread_id": "1"}}
agent.invoke({"messages": "hi, my name is bob"}, config)
agent.invoke({"messages": "write a short poem about cats"}, config)
agent.invoke({"messages": "now do the same but for dogs"}, config)
final_response = agent.invoke({"messages": "what's my name?"}, config)

final_response["messages"][-1].pretty_print()
print(final_response["messages"][-1].content)
"""
================================== Ai Message ==================================

Your name is Bob!
"""