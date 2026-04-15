# agent-b101 服务架构与调用链路分析

## 文档信息

- 作者：徐凯旋
- 邮箱：azouever@gmail.com
- 更新时间：2026-04-14

---

## 一、服务概述

`agent-b101` 是 DeepTrip 项目的 **核心 Agent 服务**，负责：

1. **对话主循环**：状态机驱动的多阶段推理
2. **工具调度**：调用酒店、机票、景区、地图等工具
3. **LLM 编排**：与多种大语言模型交互
4. **子 Agent 协作**：机票 Agent、火车票 Agent、行程规划 Agent
5. **流式输出**：SSE 双阶段输出（thinking + final）

### 技术栈

| 技术 | 版本 |
|------|------|
| Python | 3.10+ |
| FastAPI | 0.100+ |
| Redis | 客户端 |
| ElasticSearch | 客户端 |

---

## 二、服务架构图

### 2.1 整体架构图

```
+------------------------------------------------------------------+
|                        agent-b101                                 |
|                    (核心 Agent 服务)                               |
+------------------------------------------------------------------+
|                                                                   |
|  +--------------------------------------------------------+      |
|  |                    app/routers/                         |      |
|  |  +--------------------------------------------------+  |      |
|  |  |  agent_loop/ (核心循环)                           |  |      |
|  |  |  +--------------------------------------------+  |  |      |
|  |  |  | DT_agent_loop_v2.py (主循环 v2)             |  |  |      |
|  |  |  | - LoopState 状态机                          |  |  |      |
|  |  |  | - AgentLoop 类                             |  |  |      |
|  |  |  +--------------------------------------------+  |  |      |
|  |  |  +--------------------------------------------+  |  |      |
|  |  |  | flight_loop.py (机票 Agent)                 |  |  |      |
|  |  |  | flight_sub_loop.py (机票子循环)             |  |  |      |
|  |  |  +--------------------------------------------+  |  |      |
|  |  |  +--------------------------------------------+  |  |      |
|  |  |  | train_loop.py (火车 Agent)                  |  |  |      |
|  |  |  | train_sub_loop.py (火车子循环)              |  |  |      |
|  |  |  +--------------------------------------------+  |  |      |
|  |  +--------------------------------------------------+  |      |
|  |  +--------------------------------------------------+  |      |
|  |  |  tools_v2/ (工具集)                             |  |      |
|  |  |  +--------------------------------------------+  |  |      |
|  |  |  | hotel_search_tool.py (酒店搜索)             |  |  |      |
|  |  |  | flight_search_tool.py (机票搜索)            |  |  |      |
|  |  |  | sight_recommend_tool.py (景区推荐)          |  |  |      |
|  |  |  | mcp_tool.py (MCP 工具封装)                  |  |  |      |
|  |  |  | poi_search_tool.py (POI 搜索)               |  |  |      |
|  |  |  +--------------------------------------------+  |  |      |
|  |  +--------------------------------------------------+  |      |
|  |  +--------------------------------------------------+  |      |
|  |  |  context/ (上下文)                              |  |      |
|  |  |  +--------------------------------------------+  |  |      |
|  |  |  | core_context.py (核心上下文)                |  |  |      |
|  |  |  | dt_context_init.py (上下文初始化)           |  |  |      |
|  |  |  | flight_core_context.py (机票上下文)         |  |  |      |
|  |  |  +--------------------------------------------+  |  |      |
|  |  +--------------------------------------------------+  |      |
|  +--------------------------------------------------------+      |
|                                                                   |
|  +--------------------------------------------------------+      |
|  |                    app/service/                         |      |
|  |  +--------------------------------------------------+  |      |
|  |  |  chat_service.py (对话服务)                      |  |      |
|  |  |  trip_itinerary_extract_service.py (行程抽取)    |  |      |
|  |  |  recommend_chat_service.py (推荐服务)            |  |      |
|  |  +--------------------------------------------------+  |      |
|  +--------------------------------------------------------+      |
|                                                                   |
|  +--------------------------------------------------------+      |
|  |                    app/utils/                           |      |
|  |  - redis_es_bridge_util.py (Redis/ES 桥)               |      |
|  |  - chat_persist_util.py (对话持久化)                   |      |
|  |  - i18n_util.py (国际化)                              |      |
|  +--------------------------------------------------------+      |
|                                                                   |
+------------------------------------------------------------------+
                              |
                              | HTTP / SSE
                              v
+------------------------------------------------------------------+
|                        外部服务                                   |
+------------------------------------------------------------------+
|  +-------------+  +-------------+  +-------------+  +-----------+ |
|  | arsenal-    |  | arsenal-    |  | LLM 服务    |  | Redis/ES  | |
|  | service-ai- |  | service-ai- |  | (DeepSeek/  |  |           | |
|  | dataset     |  | mcp         |  |  Claude)    |  |           | |
|  +-------------+  +-------------+  +-------------+  +-----------+ |
+------------------------------------------------------------------+
```

### 2.2 模块职责说明

```
agent-b101/
├── app/
│   ├── main.py                 # FastAPI 入口
│   ├── routers/                # 路由与核心逻辑
│   │   ├── api.py              # 主 API 入口
│   │   ├── agent_loop/         # Agent 循环（核心）
│   │   │   ├── DT_agent_loop_v2.py   # 主循环 v2
│   │   │   ├── flight_loop.py        # 机票 Agent
│   │   │   ├── train_loop.py         # 火车 Agent
│   │   │   └── tool_async_board.py   # 异步工具看板
│   │   ├── tools_v2/           # 工具实现
│   │   │   ├── hotel_search_tool.py
│   │   │   ├── flight_search_tool.py
│   │   │   ├── sight_recommend_tool.py
│   │   │   └── mcp_tool.py
│   │   ├── context/            # 上下文管理
│   │   │   ├── core_context.py
│   │   │   └── dt_context_init.py
│   │   ├── prompt_lego_v2/     # Prompt 模板
│   │   ├── llm_functions/      # LLM 函数调用
│   │   └── subagents/          # 子 Agent
│   ├── service/                # 业务服务
│   ├── utils/                  # 工具类
│   └── config/                 # 配置
├── tests/                      # 测试
└── evaluation/                 # 评估
```

---

## 三、核心业务模块

### 3.1 Agent 主循环 (DT_agent_loop_v2)

**职责**：状态机驱动的多阶段推理，是整个系统的核心。

#### 状态机枚举 (LoopState)

```python
class LoopState(Enum):
    """循环状态枚举"""
    DIRECT_ANSWER = "direct_answer"          # 直接回答
    DEFAULT_STATE = "default_state"          # 默认状态
    LLM_INFERENCE = "llm_inference"          # LLM 推理
    TOOL_INTEGRATION = "tool_integration"    # 工具整合
    AGENT_DISPATCH = "agent_dispatch"        # Agent 调度
    AGENT_DELEGATION = "agent_delegation"    # Agent 委派
    FLIGHT_AGENT = "flight_agent"            # 机票 Agent
    TRAIN_AGENT = "train_agent"              # 火车 Agent
    ANSWER_PREPARATION = "answer_preparation" # 答案准备
    POST_PROCESSING = "post_processing"      # 后处理
    SIGHT_DESTINATION_RECOMMENDATION = "sight_destination_recommendation"
    ROUTE_RECOMMEND_DIRECT_ANSWER = "route_recommend_direct_answer"
    TRAVEL_GUIDE_RECOMMENDATION = "travel_guide_recommendation"
    TRAVEL_PLAN_AGENT = "travel_plan_agent"
    PRODUCT_PLAN_AGENT = "product_plan_agent"
    DEEP_THINK = "deep_think"
    CHECK_THINK = "check_think"
    SUMMARY_THINK = "summary_think"
```

#### 状态转换流程图

```
+-------------------+
|  用户请求入口      |
+---------+---------+
          |
          v
+---------+---------+
| DEFAULT_STATE     |
| (初始化上下文)     |
+---------+---------+
          |
          v
+---------+---------+
| LLM_INFERENCE     |
| (调用 LLM 推理)    |
+---------+---------+
          |
          +------------------+------------------+
          |                  |                  |
          v                  v                  v
+---------+---------+ +------+-------+ +-------+--------+
| TOOL_INTEGRATION  | | FLIGHT_AGENT | | TRAIN_AGENT    |
| (工具执行整合)     | | (机票处理)    | | (火车处理)      |
+---------+---------+ +------+-------+ +-------+--------+
          |                  |                  |
          +------------------+------------------+
                             |
                             v
+---------+---------+
| ANSWER_PREPARATION|
| (答案准备)         |
+---------+---------+
          |
          v
+---------+---------+
| POST_PROCESSING   |
| (后处理持久化)     |
+---------+---------+
          |
          v
+---------+---------+
| 返回 SSE 流式响应  |
+-------------------+
```

#### AgentLoop 类核心结构

```python
class AgentLoop:
    """Agent 循环处理类"""

    def __init__(self, request: Request, params: HotelChatRequest):
        self.request = request
        self.params = params
        self.context = None              # 核心上下文
        self.llm_model_name = "deepseek-v3"
        self.current_state = None        # 当前状态
        self.llm_inference_messages = [] # LLM 推理消息
        self.processor = None            # 流式处理器

    async def run(self):
        """主循环入口"""
        # 初始化上下文
        self.context = await init_dt_context(self.request, self.params)

        # 状态机循环
        while self.current_state != LoopState.POST_PROCESSING:
            if self.current_state == LoopState.LLM_INFERENCE:
                await self._llm_inference()
            elif self.current_state == LoopState.TOOL_INTEGRATION:
                await self._tool_integration()
            # ... 其他状态处理
```

### 3.2 工具调度 (tools_v2)

```
+-------------------+     +-------------------+     +-------------------+
|   AgentLoop       |     |   BaseTool        |     |   外部服务        |
|   (主循环)        |     |   (工具基类)       |     |                  |
+---------+---------+     +---------+---------+     +---------+---------+
          |                         |                         |
          | 1. 获取工具列表          |                         |
          |    context.ALL_TOOLS    |                         |
          |------------------------>|                         |
          |                         |                         |
          | 2. 执行工具              |                         |
          |    tool.execute()       |                         |
          |------------------------>|                         |
          |                         |                         |
          |                         | 3. HTTP 调用外部服务     |
          |                         |------------------------>|
          |                         |                         |
          |                         | 4. 返回结果              |
          |                         |<------------------------|
          |                         |                         |
          | 5. 返回工具结果          |                         |
          |<------------------------|                         |
          |                         |                         |
```

**主要工具列表**：

| 工具文件 | 工具名称 | 职责 |
|----------|----------|------|
| `hotel_search_tool.py` | hotel_search_tool | 酒店搜索 |
| `hotel_detail_tool.py` | hotel_detail_tool | 酒店详情 |
| `flight_search_tool.py` | flight_search_tool | 机票搜索 |
| `sight_recommend_tool.py` | sight_recommend_tool | 景区推荐 |
| `poi_search_tool.py` | poi_search_tool | POI 搜索 |
| `search_transit_tool.py` | search_transit_tool | 交通路线 |
| `mcp_tool.py` | McpTool | MCP 工具封装 |
| `scenic_crowd_tool.py` | scenic_crowd_tool | 景区客流 |

### 3.3 MCP 工具集成

```
+-------------------+     +-------------------+     +-------------------+
| sight_recommend   |     |   McpTool         |     | arsenal-service-  |
|     _tool         |     |                   |     |    ai-mcp         |
| (业务工具类)       |     | (MCP客户端封装)    |     |  (MCP代理服务)     |
+---------+---------+     +---------+---------+     +---------+---------+
          |                         |                         |
          | 1. __init__() 创建       |                         |
          |    self.short_trip_tool  |                         |
          |    = McpTool(...)        |                         |
          |------------------------>|                         |
          |                         |                         |
          |                         | 2. _detect_tool()       |
          |                         |    HTTP GET /api/mcp/   |
          |                         |    local/tools          |
          |                         |------------------------>|
          |                         |                         |
          |                         | 3. 返回工具元数据        |
          |                         |<------------------------|
          |                         |                         |
          | 4. 工具实例就绪          |                         |
          |<------------------------|                         |
          |                         |                         |
          | 5. execute() 执行        |                         |
          |------------------------>|                         |
          |                         | 6. POST /api/mcp/tools/call
          |                         |------------------------>|
          |                         |                         |
          | 7. 返回结果              |                         |
          |<------------------------|                         |
          |                         |                         |
```

---

## 四、LLM 调用层

### 4.1 LLM 调用流程

```
+-------------------+     +-------------------+     +-------------------+
|   AgentLoop       |     |   llm.py          |     |   LLM 服务        |
|   (主循环)        |     |   (LLM 封装)       |     | (DeepSeek/Claude) |
+---------+---------+     +---------+---------+     +---------+---------+
          |                         |                         |
          | 1. call_model_async_stream()                      |
          |    messages, model, stream=True                   |
          |------------------------>|                         |
          |                         |                         |
          |                         | 2. HTTP POST /v1/chat/completions
          |                         |------------------------>|
          |                         |                         |
          | 3. SSE 流式响应          |                         |
          |<------------------------|<------------------------|
          |                         |                         |
```

### 4.2 Prompt 组装 (PromptGenerator)

```python
# prompt_tools_v2.py
class PromptGenerator:
    """Prompt 生成器"""

    def __init__(self, context):
        self.context = context

    def build_first_prompt(self):
        """构建首轮 Prompt"""
        # 组装 system prompt + user prompt
        pass

    def build_in_loop_prompt(self):
        """构建循环中 Prompt"""
        # 组装工具结果 + 历史 + 当前问题
        pass

    def build_final_answer_prompt(self):
        """构建最终答案 Prompt"""
        pass
```

---

## 五、上下文管理

### 5.1 核心上下文 (core_context.py)

```python
class AgentCoreContext(AgentBaseContext):
    """Agent 核心上下文"""

    def __post_init__(self):
        self._initialize_tools_and_agents()
        self._initialize_memories()

    def _initialize_tools_and_agents(self):
        """初始化工具和 Agent 列表"""
        # 实例化工具
        hotel_search = hotel_search_tool()
        flight_search = flight_search_tool()
        sight_recommend = sight_recommend_tool()

        # 注册到工具列表
        self.ALL_TOOLS = [hotel_search, flight_search, sight_recommend, ...]

        # 创建工具名 -> 工具实例映射
        self.NAME_2_TOOL = {tool.register_name: tool for tool in self.ALL_TOOLS}
```

### 5.2 上下文初始化 (dt_context_init.py)

```python
async def init_dt_context(request: Request, params: HotelChatRequest):
    """初始化 DeepTrip 上下文"""
    context = AgentCoreContext(...)

    # 加载历史对话
    context.history = await load_history(params.sid)

    # 加载用户偏好
    context.user_preferences = await load_user_preferences(params.member_id)

    # 加载渠道配置
    context.channel_config = await load_channel_config(params.channel)

    return context
```

---

## 六、子 Agent 架构

### 6.1 机票 Agent (flight_loop.py)

```
+-------------------+     +-------------------+     +-------------------+
|   AgentLoop       |     |   FlightLoop      |     | arsenal-service-  |
|   (主循环)        |     |   (机票子循环)     |     | ai-dataset        |
+---------+---------+     +---------+---------+     +---------+---------+
          |                         |                         |
          | 1. FLIGHT_AGENT 状态    |                         |
          |------------------------>|                         |
          |                         |                         |
          |                         | 2. 调用机票工具          |
          |                         |    flight_search_tool   |
          |                         |------------------------>|
          |                         |                         |
          |                         | 3. 构建机票结论 Prompt   |
          |                         |                         |
          | 4. 返回机票结果          |                         |
          |<------------------------|                         |
          |                         |                         |
```

### 6.2 火车 Agent (train_loop.py)

类似机票 Agent，处理火车票查询场景。

---

## 七、流式输出

### 7.1 双阶段输出设计

```
+-------------------+     +-------------------+     +-------------------+
|   LLM 服务        |     | AgentStreamProcessor    |   C端用户        |
|                   |     | (流式处理器)       |     |                  |
+---------+---------+     +---------+---------+     +---------+---------+
          |                         |                         |
          | 1. SSE 流式输出          |                         |
          |    data: {"content":"..."}                        |
          |------------------------>|                         |
          |                         |                         |
          |                         | 2. 分类处理              |
          |                         |    - thinking 内容       |
          |                         |    - final 内容          |
          |                         |                         |
          |                         | 3. SSE 输出              |
          |                         |------------------------>|
          |                         |                         |
          |                         | event: thinking         |
          |                         | data: {"content":"正在思考..."}
          |                         |------------------------>|
          |                         |                         |
          |                         | event: final            |
          |                         | data: {"content":"推荐酒店..."}
          |                         |------------------------>|
          |                         |                         |
```

### 7.2 SSE 事件格式

```json
// Thinking 阶段
event: thinking
data: {"type": "thinking", "content": "正在分析您的需求..."}

// Tool 调用
event: tool_call
data: {"tool": "hotel_search", "params": {...}}

// Final 阶段
event: final
data: {"type": "final", "content": "为您推荐以下酒店..."}
```

---

## 八、与外部服务的调用链路

### 8.1 完整请求链路

```
+-------------+     +-------------------+     +---------------------+     +-------------+
| arsenal-ai- |     | agent-b101        |     | arsenal-service-    |     | arsenal-    |
| deeptrip    |     |                   |     | ai-dataset          |     | service-ai- |
| (网关)      |     |                   |     |                     |     | mcp         |
+------+------+     +---------+---------+     +----------+----------+     +-----+-------+
       |                      |                          |                    |
       | 1. POST /chat        |                          |                    |
       |--------------------->|                          |                    |
       |                      |                          |                    |
       |                      | 2. DT_agent_loop_v2      |                    |
       |                      |    初始化上下文           |                    |
       |                      |                          |                    |
       |                      | 3. LLM_INFERENCE         |                    |
       |                      |    调用 LLM              |                    |
       |                      |                          |                    |
       |                      | 4. TOOL_INTEGRATION      |                    |
       |                      |    hotel_search_tool     |                    |
       |                      |------------------------->|                    |
       |                      |                          |                    |
       |                      | 5. 酒店数据              |                    |
       |                      |<-------------------------|                    |
       |                      |                          |                    |
       |                      | 6. McpTool 调用          |                    |
       |                      |--------------------------|------------------->|
       |                      |                          |                    |
       |                      | 7. MCP 结果              |                    |
       |                      |<-------------------------|--------------------|
       |                      |                          |                    |
       |                      | 8. ANSWER_PREPARATION    |                    |
       |                      |    构建最终答案           |                    |
       |                      |                          |                    |
       | 9. SSE 流式响应      |                          |                    |
       |<---------------------|                          |                    |
       |                      |                          |                    |
```

### 8.2 服务间调用关系

```
agent-b101
    |
    +---> arsenal-service-ai-dataset (数据查询)
    |       POST /deeptrip/hotel/search
    |       POST /deeptrip/v3/hotelDetail
    |       POST /tool/baidu_map/direction/transit
    |
    +---> arsenal-service-ai-mcp (MCP 工具)
    |       GET  /api/mcp/local/tools
    |       POST /api/mcp/tools/call
    |
    +---> LLM 服务 (大模型推理)
    |       POST /v1/chat/completions
    |
    +---> Redis/ES (状态存储)
            对话历史、用户偏好
```

---

## 九、关键设计决策

### 9.1 状态机驱动

**优势**：
- 状态转换逻辑清晰
- 易于调试和扩展
- 支持状态回退和重试

### 9.2 工具注册机制

```python
# 工具在上下文初始化时注册
self.ALL_TOOLS = [hotel_search, flight_search, ...]
self.NAME_2_TOOL = {tool.register_name: tool for tool in self.ALL_TOOLS}

# 运行时根据 LLM 输出选择工具
tool_name = llm_output.get("tool")
tool = self.NAME_2_TOOL.get(tool_name)
result = tool.execute(...)
```

### 9.3 MCP 工具嵌入式注册

```python
# 在业务工具类的构造函数中创建 MCP 工具实例
class sight_recommend_tool(BaseTool):
    def __init__(self):
        super().__init__()
        self.short_trip_tool = McpTool(
            server_id="17usoftmcp/travel_short",
            tool_id="get-short-trip",
            mcp_adapter=McpAdapter(
                name="get_short_trip",
                description="查询短期或短途游玩景点和攻略"
            )
        )
```

---

## 十、总结

### 服务定位

`agent-b101` 是 DeepTrip 的 **核心智能体**：

1. **推理引擎**：状态机驱动的多阶段推理
2. **工具编排**：调用各类数据服务和 MCP 工具
3. **LLM 交互**：与多种大语言模型交互
4. **流式输出**：双阶段 SSE 流式响应

### 调用方

| 调用方 | 调用场景 |
|--------|----------|
| arsenal-ai-deeptrip | 用户对话请求 |
| 测试/评估系统 | 效果评估 |

### 关键特性

- **10+ 状态机阶段**：精细控制推理流程
- **模块化工具**：可插拔的工具设计
- **MCP 协议支持**：标准化工具调用
- **双阶段输出**：thinking + final 分离
- **多 Agent 协作**：机票、火车、行程规划 Agent
