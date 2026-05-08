from langchain.chat_models import init_chat_model
from langchain.messages import HumanMessage, AIMessage, SystemMessage

model = init_chat_model("anthropic:claude-sonnet-4.5")

system_msg = SystemMessage("You are a helpful assistant.")
human_msg = HumanMessage("Hello, how are you?")

# 与聊天模型一起使用
messages = [system_msg, human_msg]
response = model.invoke(messages)  # 返回 AIMessage
print(response)
print(response.usage_metadata)