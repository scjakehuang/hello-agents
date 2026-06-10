# agent-b101 /chat 接口完整调用流程

> 基于 `curl -X POST /chat -d '{"sid":"test123","q":"成都三日游"}'` 的 SSE 响应追踪分析

---

## 一、整体架构概览

```
┌──────────┐    POST /chat     ┌──────────────┐    SSE Stream    ┌──────────┐
│  Client  │ ─────────────────→│  FastAPI App  │ ──────────────→│  Client  │
│  (curl)  │    JSON body      │  (Uvicorn)   │  text/event-    │          │
└──────────┘                   └──────────────┘  stream          └──────────┘
                                      │
                                      ▼
                            DT_agent_loop_v2()
                                      │
                                      ▼
                            AgentLoop.run()
                            ┌─────────────────┐
                            │  State Machine  │
                            │  16 种状态流转   │
                            └─────────────────┘
```

---

## 二、请求入口

### 2.1 HTTP 层

```
POST /chat
Headers:
  Content-Type: application/json
  memberId: test_user       （必需，从 header 读取用户身份）
  platId: 0                 （平台 ID）
Body:
  {
    "sid": "test123",       （会话 ID）
    "q": "成都三日游"        （用户查询）
  }
```

路由注册：`app/main.py:127` → `app.include_router(api.router)`，`api.py:178` 定义 `/chat` 端点。

### 2.2 入口函数

```python
# api.py:178-181
@router.post('/chat')
async def chat(request: Request, params: HotelChatRequest):
    return await DT_agent_loop_v2(request, params)
```

`DT_agent_loop_v2()` 位于 `app/routers/agent_loop/DT_agent_loop_v2.py:4164`，是整个 Agent 系统的编排入口。

---

## 三、完整调用时序

### 阶段 1：请求解析与上下文初始化

```
Client                    FastAPI                    AgentLoop
  │                          │                          │
  │  POST /chat              │                          │
  │─────────────────────────→│                          │
  │                          │  DT_agent_loop_v2()      │
  │                          │─────────────────────────→│
  │                          │                          │
  │                          │          ┌───────────────────────────────┐
  │                          │          │ AgentLoop.__init__()          │
  │                          │          │   → pre_initialize()          │
  │                          │          │     → init_dt_context()       │
  │                          │          │       ├─ 解析 request headers │
  │                          │          │       ├─ 获取 memberId/platId │
  │                          │          │       ├─ 连接 Redis/ES/Milvus │
  │                          │          │       ├─ 加载用户画像          │
  │                          │          │       ├─ 加载对话历史          │
  │                          │          │       └─ 生成 message_id      │
  │                          │          │     → Message 创建并保存到 ES  │
  │                          │          └───────────────────────────────┘
```

**关键代码路径：**
- `DT_agent_loop_v2.py:161` — `self.pre_initialize()`
- `DT_agent_loop_v2.py:164-197` — `pre_initialize()` 方法
- `context/dt_context_init.py` — `init_dt_context()` 初始化上下文

---

### 阶段 2：初始化（initialize）

```
AgentLoop.run()
    │
    ▼
initialize()                                     DT_agent_loop_v2.py:199
    │
    ├── ItemRecs 初始化                            :241 （Redis 中的推荐物品管理器）
    ├── 已选线路/选项数据加载                       :247-311
    ├── _initialize_prompt_generators()            :314 （初始化 7 种 Prompt 生成器）
    ├── _sync_user_memory()                        :317 （Milvus 长期记忆同步）
    ├── _analyze_user_query()                      :321 （异步综合分析）
    │     └── analyze_query_comprehensive()        llm_functions/
    │           ├── 语言识别 → detected_language = "简体中文"
    │           ├── 意图识别 → intent_list = ["旅行规划-路线不明确"]
    │           ├── 路由分发 → route_manager_result = "travel_planning_agent"
    │           └── 对话关系分析
    └── _determine_hotel_agent_route()             :349
```

**对应 SSE 输出：**
```
data: {"type":"thinking","text":"### 分析用户需求\n#### 旅行规划路线不明确，语言简体中文\n"}
```

---

### 阶段 3：状态机驱动机制详解

agent-b101 的核心是一个**双层嵌套状态机**。外层是 `AgentLoop` 的主循环状态机（18 种状态），内层是 `TravelPlanProcessor` 的子循环状态机（5 种状态）。状态的流转由 **LLM 推理输出内容** 驱动——每次 LLM 返回的 XML 标签决定了下一状态。

#### 3.1 双层状态机架构

```
┌─────────────────────────────────────────────────────────────┐
│                    AgentLoop (主循环)                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              18 种 LoopState                           │  │
│  │  DEFAULT_STATE / LLM_INFERENCE / TOOL_INTEGRATION      │  │
│  │  ANSWER_PREPARATION / POST_PROCESSING                  │  │
│  │  DEEP_THINK / CHECK_THINK / SUMMARY_THINK              │  │
│  │  TRAVEL_PLAN_AGENT / PRODUCT_PLAN_AGENT                │  │
│  │  FLIGHT_AGENT / HOTEL_AGENT / TRAIN_AGENT              │  │
│  │  AGENT_DISPATCH / AGENT_DELEGATION / DIRECT_ANSWER     │  │
│  │  SIGHT_DESTINATION_RECOMMENDATION                      │  │
│  │  ROUTE_RECOMMEND_DIRECT_ANSWER                         │  │
│  │  TRAVEL_GUIDE_RECOMMENDATION                           │  │
│  └───────────────────────────────────────────────────────┘  │
│                            │                                 │
│     route_manager_result == "travel_planning_agent"         │
│                            ▼                                 │
│  ┌───────────────────────────────────────────────────────┐  │
│  │           TravelPlanProcessor (子循环)                 │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │           5 种 LoopState                         │  │  │
│  │  │  ROUTE_STATE → SEARCH_STATE → ANSWER_PREPARATION │  │  │
│  │  │            ↓ LLM_INFERENCE ↓ POST_PROCESSING     │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

两层状态机各自独立维护 `while True` 主循环，互不干扰。主循环通过 `travel_plan_sub_loop.py` 的 `TravelPlanProcessor.run_travel_plan_loop()` 进入子循环，子循环完成后通过 `break` 退出回到主循环。

#### 3.2 初始状态的选择

`initialize()` 完成后，`run()` 方法根据 `route_manager_result` 选择初始状态。以下是**完整的初始状态决策树**（`DT_agent_loop_v2.py:2113-2261`）：

```
initialize() 完成后的 route_manager_result
    │
    ├── "reverse_travel" ──────────→ ANSWER_PREPARATION（活动场景，跳过工具调用）
    │
    ├── choiced_hotel 且工具已执行 → ANSWER_PREPARATION（已有酒店详情）
    │
    ├── hotel_agent_dispatch=True ─→ AGENT_DISPATCH（酒店业务方 agent）
    │
    ├── hotel_agent_enabled=True ──→ HOTEL_AGENT
    │
    ├── customer_service_agent ────→ AGENT_DISPATCH
    │
    ├── "route_recommend_agent" ───→ TRAVEL_GUIDE_RECOMMENDATION
    │
    ├── "destination_recommend_agent" → TRAVEL_GUIDE_RECOMMENDATION
    │
    ├── "travel_planning_agent" ───→ TRAVEL_PLAN_AGENT  ← 成都三日游走这条
    │
    ├── "product_planning_agent" ──→ PRODUCT_PLAN_AGENT
    │
    ├── "flight_agent" ────────────→ FLIGHT_AGENT 或 DEFAULT_STATE（AB 测试控制）
    │
    ├── "train_agent" ─────────────→ TRAIN_AGENT 或 DEFAULT_STATE（AB 测试控制）
    │
    ├── tool_count_predict == 0 ──→ DEFAULT_STATE
    │
    └── 其他 ─────────────────────→ DEFAULT_STATE（默认走 LLM 推理流程）
```

**关键代码**（`DT_agent_loop_v2.py:2113-2261`）：一连串 `if/elif` 判断，从上到下匹配，命中即设置 `self.current_state`。

#### 3.3 主循环 while True 的状态分发

主循环入口（`DT_agent_loop_v2.py:2265-2476`）：

```python
while True:
    if self.context.loop_depth > self.MAX_DEPTH:  # MAX_DEPTH = 7
        break  # 强制结束

    if self.current_state == LoopState.LLM_INFERENCE:
        async for chunk in self._handle_llm_inference_state():
            yield chunk
    elif self.current_state == LoopState.DEFAULT_STATE:
        await self._handle_default_state()
    elif self.current_state == LoopState.TOOL_INTEGRATION:
        await self._handle_tool_integration_state()
    elif self.current_state == LoopState.ANSWER_PREPARATION:
        await self._handle_answer_preparation_state()
    elif self.current_state == LoopState.TRAVEL_PLAN_AGENT:
        async for chunk in self._handle_travel_plan_agent_state():
            yield chunk
        break  # 子循环完成后退出
    # ... 其他状态类似
```

每个状态 handler 的职责是：**准备数据 → 设置下一个状态 → 返回**。状态 handler 本身不阻塞等待，而是将 `self.current_state` 设为下一状态后立即返回，让 `while True` 下一轮迭代进入新状态。

**关键设计模式**：状态 handler 不直接调用下一状态，而是**声明式地设置 `self.current_state`**。这样 `while True` 循环统一负责状态路由，每个 handler 只关注自身的准备逻辑。

#### 3.4 LLM_INFERENCE 内的状态转换逻辑（核心）

`_handle_llm_inference_state()` 是最复杂的状态 handler。它调用 LLM 获取流式输出，流式输出结束后，根据 **reason_content 中的 XML 标签** 决定下一状态。

**完整的转换决策逻辑**（`DT_agent_loop_v2.py:2930-3018`）：

```
LLM 流式输出完成
    │
    ├── loop_depth >= MAX_DEPTH (7)
    │     ├── 行程规划场景 ──→ DEEP_THINK
    │     └── 其他场景 ────→ ANSWER_PREPARATION
    │
    ├── reason_content 中有 "<tool>" ──→ TOOL_INTEGRATION
    │     （LLM 决定需要调用工具获取数据）
    │
    ├── ans_content 长度 > 2 ──→ POST_PROCESSING
    │     （LLM 已经输出了回答内容，直接后处理）
    │
    ├── reason_content 中有 "<agent>" ──→ AGENT_DELEGATION
    │     （LLM 决定委派给其他内部 agent）
    │
    ├── reason_content 中有 "<finish>" ──→ DEEP_THINK 或 ANSWER_PREPARATION
    │     （LLM 完成了本轮任务规划）
    │
    ├── last_agent_state == DEEP_THINK ──→ CHECK_THINK
    │     （深入思考完成，进入检查阶段）
    │
    ├── last_agent_state == CHECK_THINK ──→ SUMMARY_THINK
    │     （检查思考完成，进入总结阶段）
    │
    ├── last_agent_state == SUMMARY_THINK ──→ ANSWER_PREPARATION
    │     （总结思考完成，准备生成最终回答）
    │
    ├── "<re_recommend>" ──→ ROUTE_RECOMMEND_DIRECT_ANSWER
    │
    ├── "<abandon_recommend>" ──→ DEFAULT_STATE
    │     （放弃当前推荐策略，回退重试）
    │
    └── 默认 ──→ ANSWER_PREPARATION
```

这个决策逻辑体现了 **LLM 主导的控制流**：状态机不是在代码里硬编码流转顺序，而是**每一轮都询问 LLM 下一步该做什么**。LLM 通过输出不同的 XML 标签（`<tool>`、`<finish>`、`<agent>` 等）来"驱动"状态机。

#### 3.5 TravelPlanProcessor 子循环状态机

对于"成都三日游"这种行程规划场景，主循环进入 `TRAVEL_PLAN_AGENT` 后，创建 `TravelPlanProcessor` 实例进入子循环。子循环有自己的 **5 种状态**（`travel_plan_sub_loop.py:36-42`）：

```
ROUTE_STATE → SEARCH_STATE → ANSWER_PREPARATION → POST_PROCESSING
     │              │                │
     └──────────────┴────────────────┘
                     │
               LLM_INFERENCE（中间状态，每次 LLM 调用后回到业务状态）
```

**子循环的流转逻辑**（`travel_plan_sub_loop.py:1141-1218`）：

```
run_travel_plan_loop()
    │
    while True:
    ├── ROUTE_STATE:
    │     ├── update_tools_and_agents_for_travel_plan_loop("route_state")
    │     ├── _build_messages_for_route_state()
    │     ├── llm_model_name = "qwen3-next-80b-a3b-instruct"
    │     ├── _last_state_before_inference = ROUTE_STATE
    │     └── current_state → LLM_INFERENCE
    │
    ├── SEARCH_STATE:
    │     ├── update_tools_and_agents_for_travel_plan_loop("search_state")
    │     ├── _build_messages_for_search_state()
    │     ├── llm_model_name = "qwen3-next-80b-a3b-instruct"
    │     ├── _last_state_before_inference = SEARCH_STATE
    │     └── current_state → LLM_INFERENCE
    │
    ├── ANSWER_PREPARATION:
    │     ├── tool_board.wait_for() 等待工具完成
    │     ├── _build_messages_for_answer_preparation()
    │     ├── llm_model_name = "qwen3-next-80b-a3b-instruct"
    │     ├── context.loop_is_last = True  ← 标记为最终回答
    │     ├── _last_state_before_inference = ANSWER_PREPARATION
    │     └── current_state → LLM_INFERENCE
    │
    ├── LLM_INFERENCE:
    │     ├── call_model_async_stream() + AgentStreamProcessor
    │     ├── 提取 <format> 标签 → context.route_plan
    │     ├── _transition_to_next_state()
    │     └── yield chunks（thinking + answer SSE）
    │
    ├── POST_PROCESSING:
    │     ├── sight 判断 → SSE
    │     ├── 保存到 ES
    │     ├── 行程提取
    │     └── finsh SSE → break 退出
```

**子循环内的 LLM_INFERENCE → 下一状态的转换**（`travel_plan_sub_loop.py:1114-1139`）：

```python
def _transition_to_next_state(self):
    if not hasattr(self, '_last_state_before_inference'):
        self.current_state = LoopState.SEARCH_STATE       # 首次推理后进入搜索
    elif self._last_state_before_inference == LoopState.ROUTE_STATE:
        self.current_state = LoopState.SEARCH_STATE       # 路线规划后 → 搜索
    elif self._last_state_before_inference == LoopState.SEARCH_STATE:
        self.current_state = LoopState.ANSWER_PREPARATION # 搜索后 → 准备回答
    elif self._last_state_before_inference == LoopState.ANSWER_PREPARATION:
        self.current_state = LoopState.POST_PROCESSING    # 回答后 → 后处理
```

注意：子循环的状态转换比主循环简单——它是**线性硬编码**的（ROUTE → SEARCH → ANSWER → POST），不依赖 LLM 输出标签判断。因为子循环的 LLM 调用时 `only_thinking=False`（非最终轮）或 `loop_is_last=True`（最终轮），其 thinking/answer 分界由 LLM 输出的 reasoning_content/content 切换自然完成。

#### 3.6 工具调用的驱动机制

当主循环或子循环的 LLM 输出中包含 `<tool>` 标签时，Thinking FSM 的 `ToolState` 会触发工具调度：

```
LLM reasoning_content（流式输入）
    │
    ▼
ThinkingFSMProcessor.eat(chunk)
    │
    ├── buffer 中匹配到 "<tool>" 开始标签
    ├── 切换到 ToolState → process() 提取工具名和参数
    ├── 解析 "</tool>" 结束标签
    │
    ├── 触发 _dispatch() 异步创建任务:
    │     create_task(tool_executor(...))
    │        │
    │        ├── 异步并发调用多个工具
    │        ├── register_calls() → ToolBoard（注册调用记录）
    │        └── 结果写入 NAME_2_MEM（供后续 prompt 使用）
    │
    └── 输出工具卡片 HTML（给用户看的调用提示）
```

ToolBoard 是工具调用的"看板"，负责：
- `register_calls(tool_name, params, round)` — 记录调用
- `wait_for(round)` — 等待指定轮次的工具完成
- 管理并发、超时、失败重试

工具结果存储在 `context.NAME_2_MEM[tool_name]` 中，后续的 `_build_tool_integration_messages()` 或 `_build_final_answer_messages()` 将此内存注入 prompt，供 LLM 参考。

#### 3.7 "成都三日游"完整的 18 步状态流转

将 SSE 输出与代码路径对应，还原出完整的状态变迁序列：

```
Step  状态                      触发条件                     模型/操作
──────────────────────────────────────────────────────────────────────────
 1   [主] pre_initialize       __init__()                  init_dt_context
 2   [主] initialize            run()                      ItemRecs/Prompt/Memory
 3   [主] analyze_user_query   initialize()                deepseek-v3(综合分析)
 4   [主] TRAVEL_PLAN_AGENT    route_manager_result判定    →进入子循环
 5   [子] ROUTE_STATE          初始状态                    构建路线规划prompt
 6   [子] LLM_INFERENCE        ROUTE_STATE→LLM_INFERENCE   qwen3-next-80b
       │  SSE: "分析用户需求\n旅行规划路线不明确"
       │  SSE: "搜索相关信息"
       │  SSE: "分析用户需求\n成都三日游，目标为经典景点"
 7   [子] SEARCH_STATE         _transition_to_next_state   更新工具列表
 8   [子] LLM_INFERENCE        SEARCH_STATE→LLM_INFERENCE  qwen3-next-80b
       │  SSE: "规划行程/搜索景点/查询酒店/查询交通"
       │  <tool> → sight_search, hotel_search, transit
 9   [子] ANSWER_PREPARATION   _transition_to_next_state   等待工具结果
10   [子] LLM_INFERENCE        ANSWER_PREP→LLM_INFERENCE   qwen3-next-80b (最终回答)
       │  SSE: "自由思考\n成都三日游，已获取景点住宿交通美食信息"
       │  SSE: "分析现有情况\n成都三日游信息完备"
       │  SSE: "规划旅行线路\n基于实时数据进行深度分析"
       │  SSE: "规划成都三日游\n包含住宿、景点、交通、餐饮"
       │  <finish> → 进入后处理
11   [子] POST_PROCESSING      _transition_to_next_state   sight SSE / ES存储
12   [子] POST_PROCESSING      生成finsh SSE               break退出子循环
13   [主] POST_PROCESSING      子循环break后回到主循环       主循环的post_processing
       │  SSE: sight / finsh (含 ans_msg_id, has_sight, has_hotel, is_trip等)
```

#### 3.8 状态驱动总结

| 维度 | 主循环 AgentLoop | 子循环 TravelPlanProcessor |
|------|-----------------|---------------------------|
| 状态数 | 18 种 | 5 种 |
| 下一状态决策 | **LLM 输出标签驱动**（`<tool>`, `<finish>`, `<agent>` 等） | **硬编码线性顺序**（ROUTE→SEARCH→ANSWER→POST） |
| 深度限制 | `MAX_DEPTH = 7` | `MAX_DEPTH = 14` |
| LLM 模型 | 多模型切换（deeptrip-qwen3/80b） | qwen3-next-80b（+ glm-5 非中文） |
| 退出方式 | 特殊状态后 `break`（TRAVEL_PLAN_AGENT / FLIGHT_AGENT 等） | POST_PROCESSING 后 `break` |
| only_thinking | 根据场景动态设置 | 非最终轮 `True`，最终轮 `False` |

**核心设计思想**：这是一个 **LLM-in-the-loop** 的状态机——不是传统意义上的硬编码状态转移图，而是每一轮循环都让 LLM 自主决定"我现在需要调用工具"还是"我已经可以回答了"。代码只是解析 LLM 的决策标签并执行对应的基础设施操作（调工具 / 构建 prompt / 保存结果）。这是 agent-b101 区别于传统对话系统的根本特征。

---

### 阶段 4：LLM 推理详解

每次进入 `LLM_INFERENCE` 状态时（`DT_agent_loop_v2.py:2749`）：

```
_handle_llm_inference_state()
    │
    ├── Token 检查与压缩（context_compressor）
    ├── 发送 language SSE（仅一次）
    ├── increment_loop_depth()
    ├── langfuse.model_input_trace() — 记录模型输入
    ├── call_model_async_stream() — 调用大模型（流式）
    │     ├── 首轮推理: deeptrip-qwen3-30b-a3b
    │     ├── 中间推理: deeptrip-qwen3-30b-a3b
    │     └── 最终回答: qwen3-next-80b-a3b-instruct
    │
    └── AgentStreamProcessor.process_stream()
          │
          ├── reasoning_content → ThinkingFSMProcessor
          │     │
          │     ├── 解析 XML 标签（<analyse>, <plan>, <tool>, ...）
          │     ├── 润色思考文本（qwen2.5-3b-think-sft）
          │     └── 输出 {"type":"thinking"} SSE
          │
          └── content → AnswerFSMProcessor
                │
                ├── 解析 XML 标签（<day>, <sight>, <hotel>, ...）
                ├── 生成卡片链接、HTML 标签
                └── 输出 {"type":"answer"} SSE
```

---

### 阶段 5：Thinking 与 Answer SSE 流

#### 5.1 Thinking 流（推理过程）

| SSE 输出 | 对应的 Thinking 状态 | 说明 |
|----------|---------------------|------|
| `分析用户需求` | `AnalyseState` | `<analyse>` 标签解析 |
| `搜索相关信息` | `ObservationState` | `<observation>` 标签解析 |
| `规划行程` | `PlanState` | `<plan>` 标签解析 |
| `搜索景点` | `ToolState` | `<tool>` 标签解析 |
| `查询酒店信息` | `ToolState` | `<tool>` 标签解析 |
| `查询交通方式` | `TransportState` | `<transport>` 标签解析 |
| `自由思考` | `FreethinkState` | `<free_think>` 标签解析 |
| `分析现有情况` | `AssessState` | `<assess>` 标签解析 |
| `规划旅行线路` | `TravelState` | `<travel>` 标签解析 |
| `检查行程安排` | `CheckState` | `<check>` 标签解析 |
| `修改建议` | `SuggestState` | `<suggest>` 标签解析 |

**Thinking 润色流程：**
```
LLM reasoning_content chunk
    │
    ▼
ThinkingFSMProcessor.eat(chunk)
    │
    ├── 解析 XML 标签边界
    ├── 提取标签内文本
    ├── 文本进入 polish_buffer
    └── 触发刷新条件（句末标点/换行/200字符）
          │
          ▼
    polish_thinking_process()  ← qwen2.5-3b-think-sft 模型
          │
          ├── 输入: 原始推理文本
          ├── 输出: "标题+内容" 格式
          │
          ▼
    _format_thinking_summary()
          │
          └── 输出: "### 标题\n#### 内容\n"
                │
                ▼
          {"type":"thinking","text":"### 标题\n#### 内容\n"}
```

#### 5.2 Answer 流（最终回答）

Answer 内容是 LLM 最终输出的旅行规划方案。流式处理过程：

```
LLM content chunk
    │
    ▼
process_content()
    │
    ├── 累积 ans_content
    ├── fsm_processor.eat(chunk)
    │     ├── <day> → DayHeadState → 格式化日期标题
    │     ├── <sight> → SightState → 生成景点链接卡片
    │     ├── <hotel> → HotelState → 生成酒店链接卡片
    │     ├── <food> → FoodHeadState → 格式化餐饮项
    │     ├── <notes> → NotesHeadState → 格式化注意事项
    │     └── 纯文本 → 直接流式输出
    │
    └── 输出 {"type":"answer","text":"..."} SSE
```

---

### 阶段 6：工具调用详解

当 LLM reasoning 中包含 `<tool>` 标签时，触发工具调用流程：

```
reason_content 中的 <tool> 标签
    │
    ▼
ToolplanState / ToolState（FSM 解析）
    │
    ├── 提取工具名和参数
    ├── register_calls() → ToolBoard 注册
    │
    ▼
_dispatch()（异步并发）
    │
    ├── sight_search_tool      → 搜索成都景点（宽窄巷子、熊猫基地、武侯祠、都江堰）
    ├── hotel_search_tool      → 搜索成都酒店（5/12-5/14, 300-800元）
    ├── search_transit_tool    → 查询市内交通
    ├── weather_tool           → 查询天气
    └── ...其他工具
    │
    ▼
TOOL_INTEGRATION 状态
    │
    ├── tool_board.wait_for() — 等待工具结果
    ├── 结果写入 NAME_2_MEM（内存中供 prompt 使用）
    ├── _build_tool_integration_messages() — 构建含工具结果的 prompt
    └── → LLM_INFERENCE（下一轮推理）
```

---

### 阶段 7：后处理（POST_PROCESSING）

```
_handle_post_processing_state()                    DT_agent_loop_v2.py:3753
    │
    ├── 判断 has_sight → {"type":"sight","text":"1"}
    ├── 保存思考消息到 ES (insert_conversation_message)
    ├── 酒店/火车票/机票 重排 (fieldset_check)
    ├── 构建最终对话历史
    ├── 截断历史消息 (truncate_history)
    ├── 生成 answer message → 保存到 ES
    ├── call_extract_itinerary() → 提取行程信息
    ├── 发送消息通知到 MQ
    └── 输出 finsh SSE
```

---

## 四、SSE 输出类型汇总

| type | 方向 | 说明 |
|------|------|------|
| `thinking` | 实时流 | Agent 推理过程（润色后），`### 标题\n#### 内容\n` 格式 |
| `language` | 首轮一次 | 语言检测结果，JSON 含 `best_match_lang` |
| `answer` | 实时流 | 最终回答文本片段，含 HTML 链接卡片 |
| `sight` | finsh 前 | `"1"` 或 `"0"`，是否有景点 |
| `finsh` | 流结束 | 完成信号，携带元数据 |

### finsh 元数据字段

```json
{
  "type": "finsh",
  "text": "",
  "ans_msg_id": "426c156e24274bdca05cd236c32afd66",
  "need_recommend": true,       // 是否需要后续推荐
  "need_itinerary": true,       // 是否需要提取行程
  "itinerary_info": {},         // 提取的行程信息
  "has_public_transport": false,// 是否有公共交通
  "has_spring_activate": true,  // 是否有春节活动
  "has_travel_plan": true,      // 是否有旅行规划
  "has_option": false,          // 是否有选项
  "has_hotel_intent": false,    // 是否有酒店意图
  "has_sight": true,            // 是否包含景点
  "has_hotel": true,            // 是否包含酒店
  "has_traffic": false,         // 是否包含交通
  "is_trip": true               // 是否为行程
}
```

---

## 五、关键组件一览

| 组件 | 文件位置 | 职责 |
|------|---------|------|
| `DT_agent_loop_v2` | `agent_loop/DT_agent_loop_v2.py:4164` | 主入口函数，创建 AgentLoop + ThinkingChannel |
| `AgentLoop` | `agent_loop/DT_agent_loop_v2.py:100` | 状态机主循环，16 种状态 |
| `init_dt_context` | `context/dt_context_init.py` | 初始化请求上下文（Redis/ES/Milvus/用户画像/历史） |
| `AgentStreamProcessor` | `agent_stream_processer/agent_stream_processor.py:124` | 流式输出处理，协调 thinking/answer FSM |
| `ThinkingFSMProcessor` | `stream_fsm_tools_v2/stream_fsm_processor.py` | 解析 reasoning 中的 XML 标签 |
| `AnswerFSMProcessor` | `stream_fsm_tools_v2/stream_fsm_processor.py` | 解析 answer 中的 XML 标签 |
| `polish_thinking_process` | `llm_functions/` | 用 qwen2.5-3b-think-sft 润色思考文本 |
| `analyze_query_comprehensive` | `llm_functions/` | 综合分析（语言+意图+路由） |
| `ToolBoard` | `stream_fsm_tools_v2/` | 异步工具调度与结果管理 |
| `ThinkingChannel` | `agent_loop/thinking_channel.py` | 外部思考注入通道 |
| `ItemRecs` | `agent_item_rec.py` | Redis 中的推荐物品管理器 |
| `context_compressor` | `agent_loop/context_compressor.py` | Token 检查与上下文压缩 |
| `call_model_async_stream` | `routers/llm.py` | 流式调用 LLM |
| `travel_plan_sub_loop` | `agent_loop/product_plan_sub_loop.py` | 行程规划子循环状态机 |

---

## 六、模型使用清单

| 阶段 | 模型 | 用途 |
|------|------|------|
| 综合分析 | deepseek-v3 (或其他) | 语言识别 + 意图分析 + 路由分发 |
| 首轮推理 | deeptrip-qwen3-30b-a3b | 分析需求，生成工具调用计划 |
| 中间推理 | deeptrip-qwen3-30b-a3b | 工具结果整合，继续推理 |
| 思考润色 | qwen2.5-3b-think-sft | 将原始推理文本润色为 "### 标题\n#### 内容" |
| 最终回答 | qwen3-next-80b-a3b-instruct | 生成最终旅行规划方案（流式） |
| 非中文场景 | glm-5 | 多语言用户的推理和回答 |

---

## 七、数据流向图

```
                         ┌─────────────┐
                         │   Redis     │
                         │ 会话/用户画像 │
                         │ 推荐物品缓存  │
                         └──────┬──────┘
                                │
    ┌──────────┐         ┌──────▼──────┐         ┌──────────┐
    │   ES     │◄────────│  AgentLoop  │────────►│  Milvus  │
    │ 对话存储  │  写入    │  状态机     │  检索    │ 长期记忆  │
    │ KV 存储  │         └──────┬──────┘         │ 向量搜索  │
    └──────────┘                │                └──────────┘
                                │
                        ┌───────▼───────┐
                        │   LLM Proxy   │
                        │  (模型调用)    │
                        └───────┬───────┘
                                │
                ┌───────────────┼───────────────┐
                │               │               │
        ┌───────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
        │ sight_search │ │hotel_search │ │weather_tool │
        │   景点搜索    │ │  酒店搜索    │ │  天气查询    │
        └──────────────┘ └─────────────┘ └─────────────┘
                │               │               │
                └───────────────┼───────────────┘
                                │
                        ┌───────▼───────┐
                        │ arsenal-ai-   │
                        │ deeptrip 服务  │
                        │ (数据服务层)   │
                        └───────────────┘
```

---

## 八、状态机完整状态列表

```python
class LoopState(Enum):                              # DT_agent_loop_v2.py:68-89
    DIRECT_ANSWER = "direct_answer"                 # 直接回答
    DEFAULT_STATE = "default_state"                 # 默认状态 → LLM 推理
    LLM_INFERENCE = "llm_inference"                 # LLM 推理（流式调用模型）
    TOOL_INTEGRATION = "tool_integration"           # 工具结果整合
    AGENT_DISPATCH = "agent_dispatch"               # Agent 调度（业务方 agent）
    AGENT_DELEGATION = "agent_delegation"           # Agent 委派（内部工具 agent）
    FLIGHT_AGENT = "flight_agent"                   # 机票 Agent
    HOTEL_AGENT = "hotel_agent"                     # 酒店 Agent
    TRAIN_AGENT = "train_agent"                     # 火车票 Agent
    ANSWER_PREPARATION = "answer_preparation"       # 答案准备
    POST_PROCESSING = "post_processing"             # 后处理
    SIGHT_DESTINATION_RECOMMENDATION = "..."        # 景点目的地推荐
    ROUTE_RECOMMEND_DIRECT_ANSWER = "..."           # 线路推荐直接回答
    TRAVEL_GUIDE_RECOMMENDATION = "..."             # 旅行攻略推荐
    TRAVEL_PLAN_AGENT = "travel_plan_agent"         # 行程规划
    PRODUCT_PLAN_AGENT = "product_plan_agent"        # 产品规划
    DEEP_THINK = "deep_think"                       # 深入思考
    CHECK_THINK = "check_think"                     # 检查思考
    SUMMARY_THINK = "summary_think"                 # 总结思考
```

---

## 九、Thinking FSM 状态与 XML 标签映射

| FSM 状态类 | XML 标签 | Thinking 显示文案 |
|-----------|---------|-------------------|
| `LanguageState` | `<language>` | 语言识别 |
| `AnalyseState` | `<analyse>` | 分析用户需求 |
| `ObservationState` | `<observation>` | 搜索相关信息 |
| `PlanState` | `<plan>` | 规划行程 |
| `ToolplanState` | `<tool_plan>` | 工具调用计划 |
| `ToolState` | `<tool>` | 调用工具 |
| `TransportState` | `<transport>` | 查询交通方式 |
| `TravelState` | `<travel>` | 规划旅行线路 |
| `FreethinkState` | `<free_think>` | 自由思考 |
| `AssessState` | `<assess>` | 分析现有情况 |
| `CheckState` | `<check>` | 检查行程安排 |
| `SuggestState` | `<suggest>` | 修改建议 |
| `ReflectionState` | `<reflection>` | 反思 |
| `SummaryState` | `<summary>` | 总结 |
| `FinishState` | `<finish>` | 结束信号 |
| `DecisionState` | `<decision>` | 决策 |
| `ContemplationState` | `<contemplation>` | 深度思考 |
| `FormatState` | `<format>` | 格式化 |
| `NotesState` | `<notes>` | 注意事项 |
| `RoutetimelineState` | `<route_timeline>` | 路线时间线 |
| `TimelineState` | `<timeline>` | 时间线 |
| `AbandonState` | `<abandon_recommend>` | 放弃推荐 |