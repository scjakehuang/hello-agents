# DeepTrip 技术能力对标：美团 AI Agent 基建岗位

- 作者：jiakai.huang
- 更新时间：2026-04-10
- 用途：将 DeepTrip 的已有实现与美团 AI Agent 基建岗位要求逐项对标，辅助面试准备与技术视野对齐

---

## 目录

1. [岗位职责对标](#一岗位职责对标)
2. [基本需求对标](#二基本需求对标)
3. [优先项对标](#三优先项对标)
4. [能力差距与演进方向](#四能力差距与演进方向)

---

## 一、岗位职责对标

### 职责 1：核心 Agent 应用工程落地，AI 应用分层架构，A/B Test for Agent

> 探索AI应用分层架构，解耦算法与工程依赖，建设快速实验平台（A/B Test for Agent），支撑业务Agent快速迭代。

#### DeepTrip 的做法

**分层架构**

DeepTrip 已实现清晰的四层分离：

```
┌─────────────────────────────────────────────────────────────┐
│  接入层 (dt-main, Java/Spring Boot)                         │
│  认证 · 风控 · 路由 · SSE代理                               │
│  职责：纯工程——不碰算法逻辑，只做流量治理                     │
├─────────────────────────────────────────────────────────────┤
│  Agent 层 (agent-b101, Python/FastAPI)                      │
│  状态机编排 · LLM推理 · 工具调度 · 记忆管理                  │
│  职责：AI 核心——ReAct Loop + 多Agent协作                     │
├─────────────────────────────────────────────────────────────┤
│  工具层 (arsenal-service-ai-mcp, Java/Spring Boot)           │
│  MCP协议工具网关 · 工具注册/发现/执行                         │
│  职责：能力抽象——统一协议封装业务API                          │
├─────────────────────────────────────────────────────────────┤
│  数据层 (arsenal-service-ai-dataset, Java/Spring Boot)       │
│  业务数据集 · 向量存储 · 地图/天气                            │
│  职责：数据沉淀——离线+实时数据统一供给                        │
└─────────────────────────────────────────────────────────────┘
```

这种分层使得：
- **算法迭代**（换模型、改 Prompt）只动 agent-b101，不碰 Java 工程
- **工具扩展**（接入新 API）只动 MCP 层，Agent 通过协议自动发现
- **工程优化**（限流、风控、缓存）只动 dt-main，不影响 AI 逻辑

**A/B Test 实现**

dt-main 集成了公司 ABTest SDK，已有的实验：

| 实验 Key | 用途 | 实现位置 |
|---------|------|---------|
| `DT_2_0` / `TCAPP_DT_2_0` | Agent 架构 2.0 灰度 | `ABTestExpNoConstants.java` |
| `DT_THINKING_V2` | 思维链 V2 灰度 | `ABTestExpNoConstants.java` |
| `DT_JOIN_KEFU_AGENT` | 客服 Agent 接入灰度 | `ABTestExpNoConstants.java` |
| `DT_JOIN_HOTEL_AGENT` | 酒店 Agent 接入灰度 | `ABTestExpNoConstants.java` |
| `DT_USER_MEMORY_AB` | 用户记忆功能灰度 | `ABTestExpNoConstants.java` |
| `HOME_SUG_V1_FOR_ORDER_BIZ` | 首页推荐优化 | `ABTestExpNoConstants.java` |

工作流程：
```
① dt-main 通过 ABTester.getCommonResult(expNo, clientId) 获取分桶
② 将结果注入请求 Header: X-ABTest-{expNo}={version}
③ agent-b101 通过 Header 读取实验分组
④ 按分组走不同的 Prompt / 模型 / Agent 分支
```

此外 agent-b101 内部通过 **version + dt_channel** 组合做细粒度版本路由：
```python
# route_manager.py
if dt_channel in ["MAIN_MINI","APPLET","TC_APP"] and version >= "20260122":
    prompt = router_prompt  # 新版路由策略
```

**可改进方向（对标美团）**：
- DeepTrip 的 A/B 粒度是渠道+用户级，但缺少**自动化效果评估闭环**——实验结果需人工看 Langfuse 或 ES 数据判断
- 美团要求的"快速实验平台"更强调自动化指标采集 + 实验结论自动沉淀

---

### 职责 2：公司级 AI 应用基建——Tools 动态检索、执行隔离与上下文共享

> 设计Tools动态检索、执行隔离与上下文共享机制，解决多Agent协同作业时的工具准召提升，结合RAG优化、知识库融合等技能

#### DeepTrip 的做法

**Tools 动态检索与注册**

三级工具发现机制：

```
┌────────────────────────────────────────────────────────────────────────┐
│ 第一级：静态注册（编译时）                                              │
│                                                                        │
│ core_context.py → _initialize_tools_and_agents()                      │
│ 实例化所有工具 → NAME_2_TOOL = {tool.register_name: tool}              │
│ 按 dt_channel 动态增删（MAIN_MINI加客服, SU_ZHOU换景点工具）            │
├────────────────────────────────────────────────────────────────────────┤
│ 第二级：运行时动态切换（按 Agent 阶段）                                  │
│                                                                        │
│ update_tools_and_agents_for_travel_plan(state="search_state")         │
│   → 替换为: hotel_web_search, traffic_web_search, sight_web_search     │
│ update_tools_and_agents_for_travel_plan(state="route_state")          │
│   → 替换为: travel_web_search                                         │
│ update_tools_and_agents_for_product_plan()                            │
│   → 替换为: hotel_search, search_transit                               │
├────────────────────────────────────────────────────────────────────────┤
│ 第三级：MCP 协议动态发现（运行时）                                       │
│                                                                        │
│ mcp_tool.py → _detect_tool(server_id, tool_id)                        │
│   GET /api/mcp/local/tools → 获取所有已注册MCP工具                      │
│   按 serverId + toolId 匹配 → 动态加载工具描述和参数 schema              │
│                                                                        │
│ MCP管理API支持:                                                        │
│   POST /api/mcp/config/server → 注册新工具服务                          │
│   POST /api/mcp/config/server/load-tools → 从远端拉取工具列表           │
│   POST /api/mcp/config/tool/activate → 激活工具                         │
└────────────────────────────────────────────────────────────────────────┘
```

**执行隔离**

ToolAsyncBoard 实现了完整的工具执行隔离：

```
┌── ToolAsyncBoard（tool_async_board.py）──────────────────────────┐
│                                                                   │
│  并发控制: asyncio.Semaphore(max_concurrency=16)                 │
│           每个工具调用独占一个信号量槽                              │
│                                                                   │
│  超时隔离: asyncio.wait_for(invoker(spec), timeout=15s)          │
│           单个工具超时不影响其他工具                                │
│                                                                   │
│  错误隔离: try/except 包裹每个工具调用                             │
│           TimeoutError → FAILED (不影响其他)                      │
│           CancelledError → CANCELLED                              │
│           Exception → FAILED + 错误信息                           │
│                                                                   │
│  状态隔离: 每个调用有独立的 ToolResult 对象                        │
│           PENDING → RUNNING → SUCCEEDED/FAILED/CANCELLED          │
│                                                                   │
│  结果筛选: selection_enabled=True 时                              │
│           对工具结果做 Top-K 精选（减少 Prompt 长度）               │
│                                                                   │
│  事件队列: AsyncQueue 非阻塞事件流                                │
│           dispatched / result / error / cancelled                 │
│           前端可实时展示"正在查酒店..." "正在查机票..."              │
└───────────────────────────────────────────────────────────────────┘
```

此外，dt-main 中对外部 HTTP 调用也有隔离机制：
- **12 个专用线程池**：按 IO 类型分离（风控检测 / SSE输出 / 路由日志 / 文件上传 / API调用...）
- **Resilience4j 熔断器**：3 路风控检测各有独立熔断器（50% 失败率触发熔断，30s 等待恢复）

**上下文共享**

AgentCoreContext 作为全局状态对象，在所有 Agent 间共享：

```
主循环 AgentLoop
├── 持有 context: AgentCoreContext（唯一真相）
│
├── 调用 FlightLoop:
│   └── 传递 context + langfuse（同一条 trace）
│   └── 子 Agent 的工具结果写入 context.NAME_2_MEM
│   └── 返回 agent_answer → context.agent_answer
│
├── 调用 TravelPlanLoop:
│   └── 同样共享 context
│   └── 按阶段 update_tools_and_agents()
│   └── 工具结果累加到 NAME_2_MEM
│
└── 最终答案生成:
    └── 读取所有 NAME_2_MEM 的累积结果
    └── 合并 agent_answer
    └── 构建完整 Prompt
```

**RAG + 知识库融合**

```
SearchAgent (subagents/search_agent/)
│
├── Web搜索: 并发多源搜索（httpx.AsyncClient, limits=20并发）
│   └── 搜索结果文本提取
│
├── RAG检索: Milvus 向量库（2560维，COSINE）
│   └── 用户记忆检索: POST /deeptrip/memory/search
│   └── 知识库检索: ElasticSearch + TencentVDB
│
├── LLM 重排: 按 4 维偏好排序
│   ├── relevance（相关性）
│   ├── timeliness（时效性）
│   ├── authority（权威性）
│   └── diverse（多样性）
│   → 精选 Top-10 条 → search_rerank_context_text
│
└── 注入上下文: 重排结果写入 context.search_rerank_context_text
    → Prompt 中使用，辅助景点/路线/攻略等阶段的决策
```

---

### 职责 3：AgentBuilder / Eval / Data 体系

> 打造"日志-评测-训练"自动化闭环，推动Tools平台与沙箱的深度集成，实现工具调用行为的可回放、可验证

#### DeepTrip 的做法

**日志体系**

```
┌─────────────────────────────────────────────────────────────┐
│                    全链路可观测                               │
│                                                             │
│  ① Langfuse (langfuse_util.py → MyLangfuse)                │
│     - 每次请求 = 一个 Trace                                  │
│     - span: init / llm_inference / tool_call / agent_sub    │
│     - 记录: model / prompt / completion / tokens / latency  │
│     - 支持 session_id 关联多轮对话                           │
│     - 按环境区分: prod vs qa 分别上报                        │
│                                                             │
│  ② ReasoningTracker (reasoning_step.py)                     │
│     - 记录每一步推理的输入/输出/状态转换                      │
│     - 支持 get_summary() 和 print_steps()                   │
│     - 可用于推理过程回放                                     │
│                                                             │
│  ③ TimingTracker (timing_tracker.py)                        │
│     - 记录每个阶段的耗时                                     │
│     - start_timing("init") → end_timing("init")            │
│     - 用于性能瓶颈定位                                      │
│                                                             │
│  ④ ES 持久化 (chat_persist_util.py)                         │
│     - 全量对话内容写入 ElasticSearch                         │
│     - 含 user/assistant 消息、工具调用参数和结果              │
│     - 可按 session_id / 时间范围检索                         │
│                                                             │
│  ⑤ Redis 实时状态 (redis_es_bridge_util.py)                 │
│     - kv_save/kv_get: 工具调用参数和结果                     │
│     - 消息缓冲区: ZSET 按时间排序                            │
│     - 用于断连续流和状态恢复                                 │
└─────────────────────────────────────────────────────────────┘
```

**评测体系**

```
evaluation/ 目录：
│
├── batch_eval.py — 批量评测框架
│   - 多轮对话测试（加载 case 列表）
│   - 可配并发线程数
│   - 生成 HTML 报告（含耗时统计）
│
├── search_agent/eval_rerank.py — 搜索重排评测
│   - 异步并发执行 test cases
│   - 检测: 检索相关性、排序质量、响应延迟
│
└── E2E 测试框架（doc/project/ChatE2eTestFramework_DOC.md）
    - 冒烟测试 skill (chat-smoke-test)
    - 集成测试 skill (integration-test)
    - 本地端到端测试 skill (local-agent-e2e-test)
```

**可改进方向（对标美团）**：
- DeepTrip 的评测主要是**黑盒式**（发请求 → 看结果），缺少**工具调用行为级别的评测**——例如"对于这个 query，Agent 应该调用哪些工具、参数是否正确"
- 缺少"**日志 → 评测 → 训练**"的自动化闭环——当前日志在 Langfuse 中，评测是独立脚本，没有自动生成训练数据
- 缺少工具调用**沙箱回放**机制——无法把线上的工具调用 replay 在离线环境验证

---

### 职责 4：跨团队技术协同，工具接入标准

> 主导工具接入标准制定、开发者生态建设与业务方联动，通过统一协议实现Agent-工具-业务系统的高效对接

#### DeepTrip 的做法

**统一协议：MCP (Model Context Protocol)**

```
┌─────────────────────────────────────────────────────────────────┐
│  arsenal-service-ai-mcp 实现了完整的 MCP 工具平台                │
│                                                                 │
│  工具接入标准:                                                   │
│  ┌───────────────────────────────────────────────────────┐      │
│  │ 方式一：注解式接入（Java 内部工具）                     │      │
│  │                                                       │      │
│  │ @McpService                                           │      │
│  │ public class FlightTools {                            │      │
│  │     @McpTool(description = "国内机票实时查询")          │      │
│  │     public FlightResult search(                       │      │
│  │         @McpToolParam(description="出发城市") String from,│    │
│  │         @McpToolParam(description="到达城市") String to  │     │
│  │     ) { ... }                                         │      │
│  │ }                                                     │      │
│  │ → 通过包扫描自动注册到 FeatureMgr.TOOL_STORE           │      │
│  └───────────────────────────────────────────────────────┘      │
│                                                                 │
│  ┌───────────────────────────────────────────────────────┐      │
│  │ 方式二：远程 MCP Server 接入（外部工具）                │      │
│  │                                                       │      │
│  │ 1. POST /api/mcp/config/server  → 注册服务            │      │
│  │    { transport: "stdio/sse", command: "npx xxx" }     │      │
│  │ 2. POST /api/mcp/config/server/activate  → 激活       │      │
│  │ 3. POST /api/mcp/config/server/load-tools → 拉取工具  │      │
│  │    → 自动调用 MCP initialize + tools/list             │      │
│  │ 4. POST /api/mcp/config/tool/activate → 上线          │      │
│  │                                                       │      │
│  │ 支持传输协议: stdio / SSE / HTTP                       │      │
│  └───────────────────────────────────────────────────────┘      │
│                                                                 │
│  统一调用入口:                                                   │
│  POST /api/mcp/tools/call { serverId, toolId, arguments }       │
│  → agent-b101 通过 McpAdapter 调用                               │
│  → 统一 JSON Schema 参数校验                                     │
│  → 统一错误处理和超时控制                                        │
└─────────────────────────────────────────────────────────────────┘
```

**开放平台（业务方联动）**

dt-main 实现了两套开放平台接入标准：

| 类型 | 路径 | 使用方 | 鉴权方式 |
|------|------|--------|---------|
| iopen（内部） | `/iopen/**` | 企业微信/商旅/私域 | biz-channel + channel-token |
| open（外部） | `/open/**` | 外部合作商 | biz-channel + HMAC-SHA256 签名 |

签名校验流程（`RoutingFilterV0_1.java`）：
```
① 从 Header 读取 dtSource
② 从配置中心加载该渠道的 SignConfig（公钥、过期时间）
③ 校验时间戳（默认 3s 有效）
④ 验签：RSA-SHA1 或 HMAC-SHA256（双模式）
⑤ Redis 校验 nonce 防重放攻击
```

---

## 二、基本需求对标

### 需求 1：扎实的 Java 基础，多线程、并发、JVM

#### DeepTrip 中的体现

**多线程模型**

dt-main 维护 **12 个专用线程池**（`AsyncTaskCommonThreadPool.java`），按 IO 类型严格隔离：

| 线程池 | core | max | queue | 用途 |
|--------|------|-----|-------|------|
| async-task-common | 20 | 64 | 2000 | 通用异步 |
| pool4DtQDetect | 20 | 64 | 2000 | LLM风控检测 |
| pool4DtQDetect4RiskCenterApi | 20 | 64 | 2000 | 风控中心检测 |
| pool4DtQDetect4SecApi | 20 | 64 | 2000 | 安全API检测 |
| pool4OutputSseDetect | 10 | 64 | 2000 | SSE输出流检测 |
| ai_hj_execute_pool | 10 | 256 | 1000 | AI任务执行 |
| callApiResultCommonAsync | 20 | 256 | 1000 | API结果回调 |
| routeLogAsyncPool | 10 | 64 | 5000 | 路由日志 |

全部使用 `CallerRunsPolicy` 拒绝策略——队列满时由调用线程执行，保证请求不丢失。

**并发处理**

风控检测的三路并行设计（`DeepTripQueryDetectFilter.java`）：

```java
// 三路检测并行执行
List<CompletableFuture<Boolean>> futures = new ArrayList<>();
futures.add(CompletableFuture.supplyAsync(llmDetect, pool4DtQDetect));
futures.add(CompletableFuture.supplyAsync(riskCenterDetect, pool4RiskCenter));
futures.add(CompletableFuture.supplyAsync(secApiDetect, pool4SecApi));

// 等待全部完成
CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();
// 任一命中即拦截
```

agent-b101 (Python) 侧的并发管理（`asyncio_semaphore_util.py`）：

```python
# 按 IO 类型分级管理并发
IOType.REDIS:        prod=50, qa=20
IOType.EXTERNAL_API: prod=30, qa=15
IOType.ROUTE_API:    prod=20, qa=10
IOType.LLM_API:      prod=20, qa=10
IOType.GEOCODE_API:  prod=10, qa=5
```

---

### 需求 2：分布式架构，高并发后端系统

#### DeepTrip 中的体现

**RPC / 服务调用**

```
dt-main (Java) ──OkHttp SSE──→ chat-server ──→ agent-b101 (Python/FastAPI)
                                                    │
                                          ┌─────────┴─────────┐
                                     httpx/aiohttp         MCP Protocol
                                          │                    │
                                    dt-dataset            dt-mcp
```

**缓存（Redis）**

- **二级缓存**（`CacheSupport.java`）：L1 Caffeine 本地缓存（30min，50K容量）+ L2 Redis 集群
- **空值标记**：`ARSENAL_NULL_STR` 防穿透（空结果缓存1分钟）
- **分布式锁**：`LockUtils` 防缓存击穿

**限流**

- **滑动窗口**（`RedisRateLimiterUtil.java`）：Redis Lua 原子操作，`ZREMRANGEBYSCORE + ZCARD`
- **令牌桶**（`TokenBucketRateLimit.lua`）：Redis TIME 精确计算令牌补充
- **多层限流**：系统 → 渠道 → 用户 → 接口，逐级收紧
- **Lua SHA 缓存**：避免每次限流请求传输完整脚本

**熔断**

Resilience4j 配置（`ClawRiskDetectService.java`）：
- 3 个独立熔断器（risk-center / sec-api / llm）
- 50% 失败率触发 OPEN
- 30s 等待后 HALF_OPEN
- 3 次半开探测

**消息队列**

```
TurboMQ/RocketMQ:
  - 用户注册事件 → 营销活动触发
  - 分享点击事件 → 数据统计
  - 风控告警 → 企微 Webhook 通知

Kafka:
  - LLM 风控检测事件流
  - 异步日志上报
```

---

### 需求 3：技术规划和抽象能力

#### DeepTrip 中的抽象设计

| 抽象层面 | 设计 | 实现 |
|---------|------|------|
| 工具抽象 | BaseTool 统一接口 | 所有工具继承 `BaseTool`，提供 `register_name`、`execute()` 统一签名 |
| Agent 抽象 | 状态机模式 | `LoopState` 枚举驱动，15+ 状态统一编排 |
| Prompt 抽象 | Lego 模块化组装 | 48 个 Prompt 模块，`PromptGenerator` 按需组合 |
| 记忆抽象 | Memory 统一接口 | `NAME_2_MEM` 提供 `append/get_string/save` |
| 协议抽象 | MCP 统一协议 | `McpTransport` 抽象类，stdio/SSE/HTTP 三种实现 |
| 上下文抽象 | AgentCoreContext | 全局状态对象，子 Agent 通过引用共享 |
| 渠道抽象 | DtChannel 枚举 | 工具/Prompt/行为按渠道差异化配置 |

---

### 需求 4 & 5：业务理解能力 + 沟通协作

#### DeepTrip 中的体现

- **多渠道业务理解**：支持微信小程序/TC App/H5/PC/企业微信/开放平台等 6+ 渠道，每个渠道有独立的认证链路、工具集合、Prompt 配置
- **跨团队协作**：dt-main (Java) ↔ agent-b101 (Python) ↔ MCP (Java) ↔ 营销 (Java) ↔ 前端 (Vue/小程序) 五个技术栈团队协作
- **开放平台**：为内外部渠道制定了统一的接入标准（签名、鉴权、限流），并提供了完整文档

---

## 三、优先项对标

### 优先 1：ReAct 原理，LangChain/LangGraph，ReAct Loop 实践

#### DeepTrip 的实现：自研 ReAct Loop

agent-b101 没有使用 LangChain/LangGraph 框架，而是**自研了完整的 ReAct Loop**（`DT_agent_loop_v2.py`，5000+ 行），核心机制：

```
                       ┌──────────────────────────┐
                       │    用户输入 (Query)       │
                       └──────────┬───────────────┘
                                  ▼
                       ┌──────────────────────────┐
                       │  Reasoning (LLM推理)      │
                       │  模型分析 query            │
                       │  决定: 直答 / 调工具 / 分发 │◄─────────────────┐
                       └──────────┬───────────────┘                  │
                                  │                                   │
                    ┌─────────────┼──────────────────┐               │
                    ▼             ▼                    ▼              │
              ┌──────────┐ ┌──────────────┐ ┌─────────────────┐     │
              │ 直接回答  │ │ Action(工具) │ │ Agent 分发      │     │
              │          │ │ <tool>标签   │ │ <agent>标签     │     │
              └──────────┘ └─────┬────────┘ └───────┬─────────┘     │
                                 │                   │               │
                                 ▼                   ▼               │
                         ┌──────────────┐  ┌────────────────┐       │
                         │ Observation  │  │ Sub-Agent Loop │       │
                         │ 工具执行结果  │  │ (递归ReAct)     │       │
                         └──────┬───────┘  └───────┬────────┘       │
                                │                   │               │
                                └───────────────────┘               │
                                         │                          │
                                         ▼                          │
                                ┌─────────────────┐                 │
                                │ 写入 NAME_2_MEM │                 │
                                │ 判断: 继续? 终止? │─── 继续 ───────┘
                                └────────┬────────┘
                                         │ 终止（MAX_DEPTH=14 或 LLM 决定结束）
                                         ▼
                                ┌─────────────────┐
                                │  最终答案生成     │
                                └─────────────────┘
```

对比 LangChain 的 ReAct：

| 维度 | LangChain ReAct | DeepTrip 自研 |
|------|----------------|--------------|
| 状态管理 | 框架内置 AgentState | 自研 LoopState 枚举（15+ 状态） |
| 工具调用 | 框架统一 Tool 接口 | 自研 BaseTool + ToolAsyncBoard 并发 |
| 多 Agent | LangGraph 节点图 | 状态机 + Agent 分发（AGENT_DISPATCH → AGENT_DELEGATION） |
| Prompt | 框架模板 | 自研 PromptGenerator（Lego 模块化，48 个模块） |
| 流式输出 | 框架回调 | 自研 FSM 解析器（实时解析 XML 标签） |
| 灵活度 | 受限于框架抽象 | 完全自控（如深度思考三阶段、行程规划三阶段） |

**自研的优势**：可以做 LangChain 不方便做的事，比如：
- 行程规划的三阶段动态切换工具集
- 深度思考（DEEP_THINK → CHECK_THINK → SUMMARY_THINK）
- 流式输出同时解析工具指令

---

### 优先 2：模型上下文与记忆管理

#### DeepTrip 的实现

**多级记忆系统**（详见架构文档 §4.3）：

```
┌──────────────────────────────────────────────────────────┐
│  L1: in-request 即时记忆 (Memory 类, NAME_2_MEM)         │
│      生命周期: 单次请求                                    │
│      存储: Python 内存                                    │
│      容量控制: 单次 ≤120条，总量 ≤150条，超出随机淘汰       │
│      用途: 当前轮次的工具调用结果累积                       │
├──────────────────────────────────────────────────────────┤
│  L2: session 级记忆 (Redis)                               │
│      生命周期: 14~30 天                                    │
│      存储: Redis ZSET + KV                                │
│      用途: 多轮对话历史、断连续流、Agent 查询参数            │
├──────────────────────────────────────────────────────────┤
│  L3: 长期记忆 (ES + Milvus)                               │
│      生命周期: 永久                                        │
│      存储: ElasticSearch 全文 + Milvus 向量(2560维)        │
│      用途: 用户偏好、行为模式、历史对话检索                  │
│      写入: POST_PROCESSING 异步写入                        │
│      检索: 初始化阶段 Milvus similarity search             │
└──────────────────────────────────────────────────────────┘
```

**上下文压缩与卸载**

```python
# 1. 历史消息截断 (truncate_history, util.py)
#    - 当总长度 > 上下文窗口的 30% 时
#    - assistant 消息超 200 字截断
#    - 超 40 条消息时裁掉最早的

# 2. 历史摘要压缩 (summarize_history.py)
#    - 调用 qwen3-next-80b 对历史对话做摘要
#    - 压缩后每轮 ≤200 字
#    - 保留: 核心需求、关键决策、特殊要求
#    - 去除: 重复问答、工具调用细节

# 3. 工具记忆随机淘汰 (Memory.get_string())
#    - 总条目 > 150 时，随机删除超额条目
#    - 最多淘汰 10 轮

# 4. 工具结果 Top-K 精选 (ToolAsyncBoard)
#    - selection_enabled=True 时
#    - 对原始结果做 Top-K 筛选
#    - 只将精选结果注入 Prompt
```

**动态上下文注入**

```python
# Prompt Lego 动态注入（按需组合）:
PromptGenerator([
    "basic",           # 固定：角色设定
    "tool_result",     # 动态：当前已有的工具结果（NAME_2_MEM.get_string()）
    "user_memory",     # 动态：Milvus 检索的用户偏好
    "weather",         # 动态：天气数据（仅当有天气工具结果时注入）
    "user_location",   # 动态：用户位置（IP 解析）
    "history",         # 动态：截断/摘要后的历史对话
    "query_insight",   # 动态：意图分析结论
])
```

---

### 优先 3：智能体应用开发、Tools/Agent-Tools 平台

#### DeepTrip 的实现

**MCP 工具平台**（详见架构文档 §4.4 和本文职责 2 节）

工具接入全流程：

```
新业务方要接入"演唱会查询"工具
│
├── 方式 A：Java 注解式（推荐，内部工具）
│   ① 写一个 @McpService 类
│   ② 方法加 @McpTool + @McpToolParam 注解
│   ③ 部署到 MCP 服务 → 包扫描自动注册
│   ④ 通过管理 API activate
│
├── 方式 B：外部 MCP Server 接入
│   ① POST /api/mcp/config/server 注册
│   ② 激活 + load-tools 拉取工具列表
│   ③ 选择性 activate 需要的工具
│
└── Agent 侧自动发现
    agent-b101 通过 McpAdapter 调用
    GET /api/mcp/local/tools → 获取工具清单
    POST /api/mcp/tools/call → 执行工具
```

---

### 优先 5：企微生态开发经验

#### DeepTrip 的实现

```
已支持的企微场景:
│
├── iopenwechatpay_merchant — 微信支付商户（流量占比 16.4%）
│   通过 iopen 平台接入，channel-token 鉴权
│
├── openPRIVATEDOMAINWXASSISTANT — 私域微信助手（13.0%）
│   企业微信 → 开放平台 → dt-main → agent-b101
│
├── openPRIVATEDOMAINWXASSISTANT_LITE — 私域精简版（3.2%）
│
└── 风控告警推送
    企业微信 Webhook (qyapi.weixin.qq.com)
    风控命中时自动推送告警到群
```

---

### 优先 8：高并发系统优化，复杂架构分层设计

#### DeepTrip 的实现总结

```
高并发优化清单:
│
├── 接入层
│   ├── TEFE/OpenResty 网关限流 + IP 封禁
│   ├── Redis Lua 多层限流（滑动窗口 + 令牌桶）
│   └── OkHttp 连接池（5连接 / 5分钟 keep-alive）
│
├── 服务层
│   ├── 12 个专用线程池（按 IO 类型隔离，CallerRunsPolicy）
│   ├── 3 路风控并行（CompletableFuture.allOf）+ 独立熔断器
│   ├── SSE 流式输出风控（步进检测 + 自适应收紧）
│   └── 二级缓存（Caffeine L1 + Redis L2 + 空值防穿透 + 分布式锁防击穿）
│
├── Agent 层
│   ├── asyncio.Semaphore 按 IO 类型分级管理（Redis 50 / API 30 / LLM 20）
│   ├── ToolAsyncBoard 16 并发 + 15s 超时 + 错误隔离
│   ├── httpx.AsyncClient 连接池（20 并发 / 10 keep-alive）
│   └── aiohttp TCPConnector（可配限流 + keep-alive）
│
└── 数据层
    ├── Redis 14~30天 TTL 自动回收
    ├── ES 全文索引 + Milvus 向量索引 分离
    └── MongoDB 审计日志异步写入
```

---

## 四、能力差距与演进方向

基于岗位要求，DeepTrip 已有坚实基础但在以下方向存在差距：

| 维度 | DeepTrip 现状 | 美团岗位要求 | 差距 |
|------|-------------|-------------|------|
| **A/B Test** | 已有 ABTest SDK 集成，按实验分桶 | "快速实验平台"——自动化效果评估闭环 | 缺少实验结论自动化沉淀，指标采集靠人工 |
| **Eval 体系** | 批量测试脚本 + Langfuse 日志 | "日志-评测-训练"闭环 | 缺少工具调用级评测、无训练数据自动生成 |
| **沙箱回放** | 无 | 工具调用可回放、可验证 | 完全缺失 |
| **RLHF** | 无 | 数据合成、自动化评测、沙箱环境 | 完全缺失 |
| **工具语义检索** | MCP 按 name 精确匹配 | 工具动态语义检索（embedding-based） | 目前是枚举注册，非语义匹配 |
| **AgentBuilder** | 无可视化建设工具 | AgentBuilder 平台 | 仅有代码级编排，无低代码平台 |

**如果面试时被追问"未来怎么演进"，可以谈的方向**：

1. **工具语义检索**：对工具描述做 embedding，query 来了先检索最相关的 Top-K 工具注入 Prompt，而不是把所有工具都塞进去
2. **工具调用沙箱**：把 Langfuse 的 trace 数据导出，构建 replay 环境，离线验证工具调用的正确性
3. **自动化评测闭环**：从 ES 日志中抽取 (query, tool_calls, answer) 三元组，自动生成评测 case，定期回归
4. **数据飞轮**：好的对话 → 标注 → 微调训练数据 → 提升工具调用准确率 → 更好的对话

---

> 本文档基于 DeepTrip 截至 2026-04-10 的代码实现编写。
> 配套阅读：`doc/project/SystemArchitecture_DOC.md`（系统架构全景）
