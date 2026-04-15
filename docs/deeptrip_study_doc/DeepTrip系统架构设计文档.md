# DeepTrip 系统架构设计文档

- 作者：jiakai.huang
- 更新时间：2026-04-10
- 适读人群：新成员、后端开发、架构评审

---

## 目录

1. [一、整体系统架构](#一整体系统架构)
2. [二、各服务职责与协作关系](#二各服务职责与协作关系)
3. [三、行程规划完整调用流程](#三行程规划完整调用流程)
4. [四、agent-b101 核心机制详解](#四agent-b101-核心机制详解)

---

## 一、整体系统架构

### 1.1 架构全景图

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                              客户端层 Client Layer                                │
│                                                                                  │
│   ┌──────────────────┐  ┌───────────────────┐  ┌────────────────────────────┐   │
│   │  deeptrip-applet │  │    ai-booking      │  │    第三方接入 (iopen/open)  │   │
│   │   （微信小程序）  │  │  （H5/PC Web端）   │  │ 企业微信/同程APP/外部合作商  │   │
│   └────────┬─────────┘  └────────┬──────────┘  └───────────────┬────────────┘   │
└────────────┼───────────────────────────────────┼───────────────┼────────────────┘
             │                     │             │               │
             └─────────────────────┴─────────────┘               │
                                   │ HTTPS/WebSocket              │ HMAC签名 / channel-token
                                   ▼                              ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                          流量接入层 Gateway Layer                                 │
│                                                                                  │
│   ┌──────────────────────────────────────────────────────────────────────────┐   │
│   │                  TEFE / OpenResty 统一网关                                │   │
│   │          dtgw.ly.com（外网）  /  arsenal-ai-deeptrip.17usoft.com（内网）  │   │
│   │              限流 · IP封禁 · 路径鉴权 · 全局风控前置                       │   │
│   └──────────────────────────────────┬───────────────────────────────────────┘   │
└─────────────────────────────────────┼────────────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                        主入口服务层 dt-main (arsenal-ai-deeptrip)                 │
│                                      Java/Spring Boot                            │
│                                                                                  │
│  ┌─────────────┐  ┌────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │  Auth认证   │  │  风控检测       │  │  Agent分发器      │  │  SSE流转发     │  │
│  │ mkcloud验token│ │ RiskCenter并行  │  │  ChatDispatcher  │  │  OkHttp流式   │  │
│  │  Redis缓存  │  │  Input/Output   │  │  路由策略        │  │  代理转发      │  │
│  └─────────────┘  └────────────────┘  └──────────────────┘  └────────────────┘  │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │  Filter 链：TraceId → RequestWrapper → 风控 → 路由 → 日志 → 发送响应         │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────┬──────────────────────────────────────────┘
                                        │ OkHttp / SSE
                    ┌───────────────────┼──────────────────┐
                    ▼                   ▼                   ▼
        ┌───────────────────┐  ┌───────────────┐  ┌──────────────────────┐
        │  chat-server      │  │ dt-marketing  │  │  chat-message-server  │
        │  SSE 流管理        │  │ 营销/活动/分享  │  │  断连续流/状态管理    │
        │  断连恢复调度      │  │ 优惠券/积分    │  │  Redis lastEventId   │
        └─────────┬─────────┘  └───────────────┘  └──────────────────────┘
                  │ HTTP / SSE 透传
                  ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                    核心 Agent 服务 agent-b101                                    │
│                           Python / FastAPI                                       │
│                                                                                  │
│  ┌───────────────┐  ┌──────────────────┐  ┌────────────────┐  ┌──────────────┐  │
│  │ AgentLoop 状  │  │  工具异步看板     │  │  多 Agent 编排  │  │  记忆系统    │  │
│  │ 态机（15+态） │  │ ToolAsyncBoard   │  │  多阶段思考     │  │  三层存储    │  │
│  └───────────────┘  └──────────────────┘  └────────────────┘  └──────────────┘  │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐   │
│  │  LLM 接入（OneAI Gateway）：deepseek-v3 / deepseek-r1 / qwen2.5          │   │
│  └───────────────────────────────────────────────────────────────────────────┘   │
└───────────┬──────────────────────────────────────────┬────────────────────────────┘
            │ HTTP REST                                 │ MCP 协议
            ▼                                           ▼
┌───────────────────────────┐            ┌──────────────────────────────────────────┐
│  arsenal-service-ai-dataset│            │        arsenal-service-ai-mcp            │
│      数据集服务             │            │           MCP 工具网关                    │
│                           │            │                                          │
│  - 景点/POI 搜索           │            │  - 工具注册与发现 (flight/train/hotel)    │
│  - 用户记忆向量存储         │            │  - Volcengine API 封装                   │
│  - 机场/酒店基础数据        │            │  - stdio/SSE Transport 支持              │
│  - Milvus 向量搜索         │            │  - 动态工具加载                           │
│  - Baidu Map / 天气        │            │                                          │
└───────────────────────────┘            └──────────────────────────────────────────┘
            │                                           │
            ▼                                           ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         外部业务数据源                                             │
│                                                                                  │
│  机票: inner-fly-search-api    火车票: servicegw.ly.com    酒店: open.elong.com   │
│  景点: ctripscenery.17usoft.com        天气: QWeather API                        │
│  地图: Baidu Map / AMap               用户标签: bds.17usoft.com(Furion)          │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 基础设施层

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                            基础设施 Infrastructure                                │
│                                                                                  │
│  ┌──────────────────┐  ┌────────────────┐  ┌──────────────────┐                 │
│  │  Redis           │  │  ElasticSearch │  │  MySQL/DCDB      │                 │
│  │  session缓存      │  │  对话历史检索   │  │  用户/业务数据    │                 │
│  │  token缓存        │  │  deeptrip-data │  │  TE_Arsenal_*    │                 │
│  │  实时流状态        │  │  全文+向量检索  │  │  订单/活动       │                 │
│  └──────────────────┘  └────────────────┘  └──────────────────┘                 │
│                                                                                  │
│  ┌──────────────────┐  ┌────────────────┐  ┌──────────────────┐                 │
│  │  Milvus          │  │  MongoDB       │  │  MQ              │                 │
│  │  用户记忆向量      │  │  风控审计日志   │  │  TurboMQ/Kafka   │                 │
│  │  2560维/COSINE   │  │  机场酒店基础   │  │  注册/分享/风控   │                 │
│  └──────────────────┘  └────────────────┘  └──────────────────┘                 │
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐    │
│  │  ConfigCenter (TcCenter)：URL配置 / 开关 / 限流规则 / 模型参数 / API Key  │    │
│  └──────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐    │
│  │  Langfuse：全链路可观测（LLM调用 / 工具调用 / agent链路追踪）             │    │
│  └──────────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 二、各服务职责与协作关系

### 2.1 服务一览表

| 服务名 | 技术栈 | 核心职责 | 对外端口/域名 |
|--------|--------|---------|--------------|
| **arsenal-ai-deeptrip** (dt-main) | Java/Spring Boot | 流量入口、身份认证、风控、Agent路由分发、SSE代理转发 | dtgw.ly.com/deeptrip |
| **agent-b101** | Python/FastAPI | AI Agent核心：LLM推理、工具调用、多Agent编排、记忆管理 | arsenal-ai-agent-deeptrip.17usoft.com |
| **arsenal-service-ai-dataset** | Java/Spring Boot | 业务数据集：景点/POI/地图/天气/用户记忆向量存储 | arsenal-ai-dataset.17usoft.com |
| **arsenal-service-ai-mcp** | Java/Spring Boot | MCP工具网关：机票/火车/酒店工具注册与执行 | arsenal-ai-service-mcp.17usoft.com |
| **arsenal-ai-deeptrip-marketing** | Java/Spring Boot | 营销能力：分享/图片生成/优惠券/积分 | arsenal-ai-deeptrip-marketing.17usoft.com |
| **chat-server** | - | SSE流管理、消息回放入口 | chatserver.17usoft.com |
| **chat-message-server** | - | SSE断连续流状态管理 | 内部 |
| **dt_dev_admin** (dt_robot) | Vue3/Java | 开发运营平台：文档、监控、外部应用管理 | 内部 |
| **ai-booking** | H5前端 | Web/H5用户界面 | 前端 |
| **deeptrip-applet** | 微信小程序 | 小程序用户界面 | 前端 |

### 2.2 服务间协作拓扑

```
                     ┌────────────────────────────────────────────┐
                     │              dt-main                        │
                     │                                            │
                     │  1. 验token → mkcloud                       │
                     │  2. 风控 → RiskCenter (并行三路检测)         │
                     │  3. ChatDispatcher 选Agent:                │
                     │     - CORE → agent-b101 /chat              │
                     │     - KE_FU → agent-b101 /kefu_chat        │
                     │     - HOTEL → agent-b101 /hotel_chat       │
                     │  4. OkHttp 代理转发，SSE逐行透传            │
                     │  5. 输出侧风控（实时扫描流式内容）           │
                     └──────────────────┬─────────────────────────┘
                                        │
                          ┌─────────────┴──────────────┐
                          │        agent-b101           │
                          │                            │
                          │  AgentLoop 状态机驱动:      │
                          │  ① OneAI LLM推理            │
                          │  ② 解析tool/agent指令       │
                          │  ③ 并发调用工具              │
                          │  ④ 注入工具结果到上下文      │
                          │  ⑤ 派发子Agent              │
                          │  ⑥ 流式生成最终答案          │
                          └──┬──────────┬──────────────┘
                             │          │
              ┌──────────────┘          └────────────────┐
              ▼                                          ▼
  ┌───────────────────────┐                ┌───────────────────────────┐
  │  arsenal-service-ai-  │                │   arsenal-service-ai-mcp  │
  │  dataset              │                │                           │
  │                       │                │  GET /api/mcp/local/tools │
  │  POST /deeptrip/poi_search            │  POST /api/mcp/tools/call  │
  │  POST /deeptrip/memory/search         │                           │
  │  POST /deeptrip/memory/insertWithEmb  │  ┌─────────────────────┐  │
  │  GET  /tool/baidu_map/*  │            │  │ Volcengine API       │  │
  │  GET  /tool/weather/*    │            │  │ 机票/火车/酒店实时数据 │  │
  └───────────────────────┘                │  └─────────────────────┘  │
                                           └───────────────────────────┘
```

### 2.3 Agent 路由分发机制（ChatDispatcher）

dt-main 中的 `ChatDispatcher` 按以下优先级选择 Agent：

```
收到请求
    │
    ├─ Header 显式指定 Agent？ ──→ 直接使用
    │
    ├─ Redis 中有 last_agent 记录？ ──→ 沿用上次
    │
    ├─ ES 中有历史 Agent 记录？ ──→ 继承历史
    │
    └─ 默认 → CORE Agent (agent-b101 /chat)


Agent 类型映射：
  CORE   → agent-b101 /chat         （通用旅行规划）
  KE_FU  → agent-b101 /kefu_chat    （客服/订单查询）
  HOTEL  → agent-b101 /hotel_chat   （酒店专项）
```

### 2.4 渠道流量分布

| 渠道标识 | 来源 | 占比 |
|---------|------|------|
| tcwxminiapp | 微信小程序 | 33.25% |
| tc_app | 同程旅行 App | 31.75% |
| iopenwechatpay_merchant | 微信支付商户 | 16.41% |
| openPRIVATEDOMAINWXASSISTANT | 私域微信助手 | 13.02% |
| 其他 | 各类渠道 | ~5% |

---

## 三、行程规划完整调用流程

> 场景：用户在小程序问「帮我规划一个北京 3 天 2 夜的行程，五一出发」

### 3.1 完整时序图

```
用户端               dt-main              agent-b101              外部服务/子系统
 │                     │                      │                       │
 │── POST /chat ──────►│                      │                       │
 │   (query, sid, token)│                     │                       │
 │                     │                      │                       │
 │             ①验证身份│                      │                       │
 │             mkcloud  │                      │                       │
 │             验token  │                      │                       │
 │                     │                      │                       │
 │             ②风控检测│                      │                       │
 │             RiskCenter                     │                       │
 │             三路并行  │                      │                       │
 │             (Input)  │                      │                       │
 │                     │                      │                       │
 │             ③路由分发│                      │                       │
 │             选CORE   │                      │                       │
 │             Agent    │                      │                       │
 │                     │                      │                       │
 │                     │── HTTP SSE ─────────►│                       │
 │                     │   /chat              │                       │
 │                     │                      │                       │
 │                     │              ④初始化 AgentCoreContext         │
 │                     │              - 解析渠道/位置/参数              │
 │                     │              - 加载工具列表 (NAME_2_TOOL)      │
 │                     │              - 初始化 Memory (NAME_2_MEM)     │
 │                     │              - 初始化 ToolAsyncBoard          │
 │                     │              - 初始化 Langfuse 追踪            │
 │                     │              - 保存用户消息到 Redis/ES         │
 │                     │                      │                       │
 │                     │              ⑤加载历史对话                    │
 │                     │              Redis → 近期对话                 │
 │                     │              ES → 长期历史检索                 │
 │                     │              Milvus → 用户记忆向量检索         │
 │                     │                      │                       │
 │                     │              ⑥意图分析 (LLM综合分析)           │
 │                     │              - analyze_query_comprehensive    │
 │                     │              - 识别：行程规划意图               │
 │                     │              - 识别：北京 3天2夜 五一出发       │
 │                     │              - 预测工具调用数量 (≥4)            │
 │                     │              - 路由管理器决策                  │
 │                     │                      │                       │
 │◄── SSE: 思考中 ──────│◄─── 流式输出开始 ───│                       │
 │                     │                      │                       │
 │                     │              ⑦ TRAVEL_PLAN_AGENT 分支         │
 │                     │                      │                       │
 │                     │              === 第一阶段：信息搜集 ===         │
 │                     │              update_tools_for_travel_plan     │
 │                     │              (hotel_web_search, traffic_      │
 │                     │               web_search, sight_web_search,   │
 │                     │               weather_info)                   │
 │                     │                      │                       │
 │                     │              ⑧ LLM推理 (LLM_INFERENCE)        │
 │                     │              模型生成工具调用指令:              │
 │                     │              <tool>sight_web_search北京景点</tool>
 │                     │              <tool>weather_info北京五一天气</tool>
 │                     │              <tool>hotel_web_search北京酒店</tool>
 │                     │              <tool>traffic_web_search北京交通</tool>
 │                     │                      │                       │
 │◄── SSE: 工具调用中 ──│◄─── 工具派发事件 ───│                       │
 │                     │                      │                       │
 │                     │              ⑨ ToolAsyncBoard 并发调度        │
 │                     │              max_concurrency=16               │
 │                     │              同时发起 4 路工具调用:             │
 │                     │                      │── sight_web_search ──►│ dt-dataset/POI
 │                     │                      │── weather_info ──────►│ QWeather API
 │                     │                      │── hotel_web_search ──►│ dt-dataset/酒店
 │                     │                      │── traffic_web_search─►│ 外部交通API
 │                     │                      │◄── 结果回流 ──────────│
 │                     │                      │                       │
 │                     │              ⑩ TOOL_INTEGRATION               │
 │                     │              结果写入 NAME_2_MEM:              │
 │                     │              NAME_2_MEM["sight_web_search"]   │
 │                     │                .append(params, 景点列表)       │
 │                     │              NAME_2_MEM["weather_info"]        │
 │                     │                .append(params, 天气数据)       │
 │                     │              NAME_2_MEM["hotel_web_search"]    │
 │                     │                .append(params, 酒店列表)       │
 │                     │                      │                       │
 │                     │              === 第二阶段：路线规划 ===          │
 │                     │              update_tools_for_route_state     │
 │                     │              (travel_web_search)              │
 │                     │                      │                       │
 │                     │              ⑪ LLM 推理生成路线框架             │
 │                     │              注入所有工具结果到 Prompt          │
 │                     │              生成: 三天游览路线骨架             │
 │                     │                      │                       │
 │                     │              === 第三阶段：产品落地 ===          │
 │                     │              PRODUCT_PLAN_AGENT               │
 │                     │              update_tools_for_product_plan    │
 │                     │              (hotel_search, search_transit)   │
 │                     │                      │                       │
 │                     │              ⑫ LLM 生成预订查询指令             │
 │                     │              <tool>search_hotel北京五一</tool>  │
 │                     │              <tool>search_transit机场→市区</tool>
 │                     │                      │                       │
 │                     │                      │── hotel_search ──────►│ MCP → Volcengine
 │                     │                      │── search_transit ────►│ MCP → Volcengine
 │                     │                      │◄── 实时价格/余量 ──────│
 │                     │                      │                       │
 │                     │              ⑬ ANSWER_PREPARATION             │
 │                     │              整合所有记忆构建最终 Prompt:        │
 │                     │              - 景点推荐 (NAME_2_MEM)           │
 │                     │              - 天气信息                       │
 │                     │              - 酒店选项 (含实时价格)             │
 │                     │              - 交通方案                       │
 │                     │              - 历史用户偏好                    │
 │                     │                      │                       │
 │                     │              ⑭ LLM 流式生成最终答案             │
 │                     │              (AgentStreamProcessor)           │
 │                     │              FSM 解析标签 → 分离思考/回答        │
 │                     │                      │                       │
 │◄── SSE: 行程内容流 ──│◄─── token by token─│                       │
 │    (天、景点、酒店、  │                      │                       │
 │     交通、Tips...)   │                      │                       │
 │                     │              ⑮ POST_PROCESSING                │
 │                     │              - 保存 assistant 消息到 Redis/ES  │
 │                     │              - 异步写入 Milvus 用户记忆          │
 │                     │              - 构建结构化推荐块 (ItemRecs)       │
 │                     │              - 发送 finish_block 到前端         │
 │                     │              - Langfuse 追踪记录               │
 │                     │                      │                       │
 │◄── SSE: [DONE] ─────│◄─── stream end ─────│                       │
 │                     │              ⑯ 输出风控扫描                    │
 │                     │              (Output 侧 RiskCenter)           │
```

### 3.2 关键状态转换

```
DEFAULT_STATE
    │
    ▼
LLM_INFERENCE ──────────────────────────────────────────────────────┐
    │                                                               │
    ├── 解析到 <tool> ──→ ToolAsyncBoard.dispatch_async()           │
    │                     │                                         │
    │                     ▼                                         │
    │              TOOL_INTEGRATION ──→ 写 NAME_2_MEM               │
    │                     │                                         │
    │                     └─────────────────────────────────────────┘
    │                                   (循环，最多 MAX_DEPTH=14 轮)
    │
    ├── 解析到 <agent:travel_plan> ──→ TRAVEL_PLAN_AGENT
    │                                   ├── search_state → LLM_INFERENCE（搜索工具）
    │                                   └── route_state → LLM_INFERENCE（路线生成）
    │
    ├── 解析到 <agent:product_plan> ──→ PRODUCT_PLAN_AGENT
    │                                   └── LLM_INFERENCE（查实时价格）
    │
    ├── 解析到 <agent:flight_agent> ──→ FLIGHT_AGENT → FlightLoop
    │
    ├── 解析到 <agent:train_agent> ──→ TRAIN_AGENT → TrainLoop
    │
    ├── 解析到 DEEP_THINK ──→ CHECK_THINK ──→ SUMMARY_THINK
    │
    └── 无工具/agent ──→ ANSWER_PREPARATION ──→ POST_PROCESSING
```

### 3.3 SSE 断连续流机制

```
Client ────── SSE连接断开 ──────────────────────────────────────┐
                                                                │
Client ────── 重连请求 (lastEventId) ──→ chat-message-server    │
                                           │                   │
                                  从 Redis 取对应              │
                                  lastEventId 之后的消息         │
                                           │                   │
Client ◄──── 续传剩余 SSE 流 ─────────────────────────────────────┘
```

---

## 四、agent-b101 核心机制详解

### 4.1 整体模块结构

```
agent-b101/
├── app/
│   ├── main.py                    # FastAPI 应用入口
│   ├── routers/
│   │   ├── api.py                 # 路由定义（/chat, /hotel_chat, /train_chat...）
│   │   ├── agent_loop/
│   │   │   ├── DT_agent_loop_v2.py  # 主循环控制器（核心，5000+行）
│   │   │   ├── flight_loop.py       # 机票专项循环
│   │   │   ├── train_loop.py        # 火车票专项循环
│   │   │   ├── travel_plan_loop.py  # 行程规划循环
│   │   │   ├── product_plan_loop.py # 产品规划循环
│   │   │   └── tool_async_board.py  # 异步工具看板
│   │   ├── context/
│   │   │   ├── core_context.py      # AgentCoreContext（全局状态对象）
│   │   │   ├── base_context.py      # BaseContext（基础字段）
│   │   │   ├── dt_context_init.py   # 上下文初始化逻辑
│   │   │   └── reasoning_step.py    # 推理步骤追踪
│   │   ├── tools_v2/               # 工具实现（20+个工具）
│   │   ├── subagents/
│   │   │   └── search_agent/        # 搜索子 Agent（RAG + 重排）
│   │   ├── prompt_lego_v2/          # Prompt 模板库（48个）
│   │   ├── agent_stream_processer/  # 流式处理器
│   │   ├── stream_fsm_tools_v2/     # 流式 FSM（XML 标签解析）
│   │   └── llm_functions/           # LLM 辅助函数
│   ├── entity/                      # 数据实体（Message）
│   ├── utils/                       # 工具函数（Redis/ES/持久化）
│   ├── service/                     # 业务服务层
│   └── config/                      # 配置（TcCenter / logger）
```

### 4.2 AgentCoreContext：全局上下文对象

`AgentCoreContext` 是整个 Agent 运行周期中的**唯一真相（Single Source of Truth）**。它在请求开始时创建，贯穿所有子 Agent 和工具调用，携带所有状态。

```
AgentCoreContext（一次对话请求的完整状态）
│
├── 会话标识
│   ├── session_id          # 会话 ID（用于 Redis/ES 隔离）
│   ├── memberId            # 用户 ID
│   ├── message_id          # 本次消息 ID
│   ├── user_msg_id         # 用户消息的存储 ID
│   └── ans_msg_id          # 回答消息的存储 ID
│
├── 请求信息
│   ├── query               # 当前处理的查询（可能被 context 注入修改）
│   ├── original_query      # 用户原始输入（不变）
│   ├── history             # 历史对话列表
│   ├── dt_channel          # 渠道（MAIN_MINI/TC_APP/H5/PC...）
│   ├── user_location       # 用户位置（IP 解析）
│   └── detected_language   # 用户语言识别结果
│
├── 工具与 Agent 注册表
│   ├── ALL_TOOLS           # 当前可用工具列表（按渠道动态加载）
│   ├── ALL_AGENTS          # 当前可用子 Agent 列表
│   ├── NAME_2_TOOL         # 工具名 → 工具实例 映射
│   └── NAME_2_AGENT        # Agent 名 → Agent 实例 映射
│
├── 记忆系统
│   ├── NAME_2_MEM          # 工具名 → Memory 实例（本轮工具结果记忆）
│   ├── NAME_2_MEM_PRE      # 预加载的工具结果记忆（如用户选中酒店）
│   └── search_rerank_context_text  # SearchAgent 重排后的文本
│
├── 循环状态
│   ├── loop_depth          # 当前循环深度（上限 MAX_DEPTH=14）
│   ├── loop_state          # 当前状态（LoopState 枚举值）
│   ├── infer_num           # 已推理轮数
│   ├── tool_result         # 最新工具调用结果
│   ├── tool_board          # ToolAsyncBoard 实例
│   └── deep/check/summary_think_content  # 多阶段思考结论
│
├── 用户交互状态
│   ├── selected_destination     # 用户选择的目的地
│   ├── selected_route_id        # 用户选择的路线 ID
│   ├── choiced_hotel            # 用户选中的酒店 ID 列表
│   ├── selected_option_ids      # 用户选中的选项 ID 列表
│   └── travel_commend           # 行程规划第一阶段小钩子内容
│
├── 可观测性
│   ├── langfuse            # Langfuse 追踪实例
│   └── reasoning_tracker   # 推理步骤记录器
│
└── 分析结果
    ├── intent_list         # 意图识别结果
    ├── route_manager_result     # 路由决策结果
    ├── tool_count_predict  # 工具数量预测
    └── query_insight       # 查询洞察分析
```

### 4.3 记忆系统（Memory System）

agent-b101 实现了三层记忆架构：

#### 层 1：in-request 即时记忆（NAME_2_MEM）

```python
# 每个工具对应一个 Memory 实例，会话内累积
NAME_2_MEM = {
    "sight_recommend": Memory("sight_recommend"),
    "hotel_search":    Memory("hotel_search"),
    "weather_info":    Memory("weather_info"),
    ...
}

# 工具执行后写入
NAME_2_MEM["hotel_search"].append(
    params="北京 五一 2晚",
    values=["酒店A 500元/晚", "酒店B 380元/晚", ...]
)

# 注入 Prompt 时读取
context_str = NAME_2_MEM["hotel_search"].get_string()
# 输出: 【【【工具调用参数为：北京 五一 2晚
#       以下是对应的结果: 酒店A 500元/晚 酒店B 380元/晚...】】】
```

```
Memory 内部结构：
┌─────────────────────────────────────────────────────┐
│  Memory("hotel_search")                             │
│                                                     │
│  params:  ["北京五一", "北京国庆", ...]              │
│  memory:  [                                         │
│    [(0, "酒店A"), (1, "酒店B"), ...],  # 第1次调用  │
│    [(5, "酒店C"), (6, "酒店D"), ...],  # 第2次调用  │
│  ]                                                  │
│  current_index: 7                                   │
│                                                     │
│  容量控制:                                           │
│  - 单次 append 超 120 条时截断为 6 条               │
│  - get_string() 时超 150 条随机淘汰                  │
│  - save(indexes) 按 index 精选保留                  │
└─────────────────────────────────────────────────────┘
```

#### 层 2：session 级缓存记忆（Redis）

```
Redis Key 结构：
  arsenal_ai_agent_deeptrip:{session_id}:latest_user_msg_id  → 最新用户消息ID
  arsenal_ai_agent_deeptrip:{session_id}:context             → 序列化上下文
  arsenal_ai_agent_deeptrip:{session_id}:chat_messages        → 消息列表(ZSET)
  arsenal_ai_agent_deeptrip:{session_id}:item_recs            → 结构化推荐块
  arsenal_ai_agent_deeptrip:{session_id}:agent_query          → Agent查询参数

  TTL: 14~30 天
  作用: 会话连续性 / 断连续流 / 多轮对话历史传递
```

#### 层 3：长期持久化记忆（ES + Milvus）

```
ElasticSearch (deeptrip-data*)：
  - 全量对话历史（用户消息 + 助手回答）
  - 支持全文检索 / 时间范围查询
  - 多轮对话摘要压缩后写入

Milvus（用户记忆向量库）：
  Collection: 按用户 ID 分区
  向量维度: 2560（COSINE 相似度）
  
  写入时机：POST_PROCESSING 阶段异步写入
  POST /deeptrip/memory/insertWithEmb
  {
    "userId": "...",
    "content": "用户喜欢亲子游，偏好3-4星酒店，忌辣..."
  }
  
  检索时机：context 初始化阶段
  POST /deeptrip/memory/search
  → 返回 Top-K 相似记忆片段
  → 注入到 Prompt 的用户偏好部分
```

### 4.4 工具调用机制（ToolAsyncBoard）

#### 工具调用完整流程

```
LLM 生成工具调用指令
<tool name="hotel_search">{"city":"北京","checkIn":"20250501"}</tool>
<tool name="sight_recommend">{"city":"北京","days":3}</tool>
         │
         ▼
1. 流式 FSM 解析（stream_fsm_tools_v2）
   - 识别 <tool> 标签
   - 提取 tool_name + params
   - 构建 ToolCallSpec 列表
         │
         ▼
2. ToolAsyncBoard.register_calls(specs)
   - 登记占位（状态: PENDING）
   - 非阻塞，立即返回
         │
         ▼
3. ToolAsyncBoard.dispatch_async(
       calls=specs,
       invoker=tool_invoker,    # 工具执行回调
       selection_enabled=True,  # 启用 Top-K 筛选
       selection_num=3,         # 保留前3条
   )
   │
   ├── asyncio.Semaphore(max_concurrency=16)  # 并发控制
   ├── 每个工具独立 Task，timeout=15s
   └── 结果写入 ToolResult 对象
         │
         ▼
4. 非阻塞事件流（AsyncIterator）
   - dispatched 事件 → 前端显示"正在查询酒店..."
   - result 事件    → 工具执行完成
   - error 事件     → 调用失败
   - summary 事件   → 摘要生成完成
         │
         ▼
5. TOOL_INTEGRATION 阶段
   await board.wait_for(round, min_completed=N)
   results = board.get_round_results(round)
   
   for result in results:
       NAME_2_MEM[result.tool_name].append(
           result.params,
           result.selected_output  # Top-K 精选后的结果
       )
         │
         ▼
6. 下一轮 LLM_INFERENCE
   Prompt 中注入所有 Memory 结果
   LLM 基于工具结果生成下一步决策
```

#### 工具列表（按渠道动态加载）

```
基础工具（所有渠道）：
  hotel_search_tool          酒店搜索（实时价格/余量）
  hotel_detail_tool          酒店详情（设施/评价）
  get_train_schedule         列车时刻表
  sight_recommend_tool       景点推荐
  search_transit_tool        交通路线查询
  poi_search_tool            POI/兴趣点搜索
  get_weather_info           天气查询（QWeather）
  web_search_tool            通用网页搜索
  scenic_crowd_tool          景区客流预测
  search_hot_spots_tool      热门打卡地搜索

渠道扩展工具：
  MAIN_MINI / TC_APP / PC 渠道追加:
    customer_service_agent   客服 Agent（订单查询/投诉）
  
  SU_ZHOU 渠道替换:
    suzhou_sight_recommend_tool  苏州专项景点推荐
    suzhou_activity_search_tool  苏州活动搜索

行程规划阶段专用工具（动态切换）：
  search_state: hotel_web_search / traffic_web_search /
                sight_web_search / news_web_search / weather_info
  route_state:  travel_web_search
  product_state: hotel_search / search_transit
```

### 4.5 多 Agent 协作机制

#### Agent 编排拓扑

```
                    ┌─────────────────────────────────┐
                    │         主循环 AgentLoop          │
                    │        DT_agent_loop_v2.py       │
                    │                                 │
                    │  LLM 推理 → 解析 <agent> 指令     │
                    └────────────────┬────────────────┘
                                     │
          ┌──────────────────────────┼──────────────────────────┐
          │                          │                          │
          ▼                          ▼                          ▼
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────────┐
│  FlightLoop      │      │  TrainLoop       │      │  TravelPlanLoop      │
│  flight_loop.py  │      │  train_loop.py   │      │  travel_plan_loop.py │
│                  │      │                  │      │                      │
│  机票查询专项     │      │  火车票查询专项   │      │  行程规划专项         │
│  - 出发/返程     │      │  - 时刻表查询    │      │  - 信息搜集阶段       │
│  - 价格对比      │      │  - 多路线对比    │      │  - 路线生成阶段       │
│  - 改签建议      │      │  - 余票提醒      │      │  - 产品落地阶段       │
└──────────────────┘      └──────────────────┘      └──────────────────────┘
          │                          │                          │
          │               ┌──────────────────┐                  │
          │               │  ProductPlanLoop  │                  │
          │               │  product_plan_    │                  │
          │               │  loop.py         │                  │
          │               │                  │                  │
          │               │  产品规划专项     │                  │
          │               │  - 酒店实时查询   │                  │
          │               │  - 交通方案落地   │                  │
          │               └──────────────────┘                  │
          │                                                      │
          └──────────────────────┬───────────────────────────────┘
                                 │
                    ┌────────────────────────┐
                    │     SearchAgent         │
                    │  subagents/search_agent │
                    │                        │
                    │  通用知识检索子 Agent    │
                    │  - Web搜索              │
                    │  - RAG 向量检索          │
                    │  - LLM 重排              │
                    └────────────────────────┘
```

#### Agent 间上下文传递机制

```
主循环 (AgentLoop)
│
├── 持有 AgentCoreContext（共享状态）
│
├── AGENT_DISPATCH 状态：
│   LLM 生成 Agent 调用指令：
│   <agent name="flight_agent">
│     {"from":"上海","to":"北京","date":"20250501"}
│   </agent>
│
├── AGENT_DELEGATION 状态：
│   从 NAME_2_AGENT 获取 Agent 实例
│   result = await agent.run(
│       context=self.context,   # 传递完整 context
│       request=self.request,
│       params=agent_params
│   )
│
│   子 Agent 拿到的 context 包含：
│   ✓ session_id（隔离 Redis/ES 数据）
│   ✓ memberId（用户信息）
│   ✓ history（完整对话历史）
│   ✓ NAME_2_MEM（已有工具结果记忆）
│   ✓ langfuse（追踪实例，子 Agent 结果上报到同一 trace）
│   ✓ query_insight（查询分析结论）
│   ✓ user_location（用户位置）
│
├── 子 Agent 执行完成：
│   agent_answer = result
│   context.agent_answer = agent_answer
│   
│   子 Agent 的工具结果写入父 context 的 NAME_2_MEM：
│   context.NAME_2_MEM["flight_result"].append(...)
│
└── 主循环继续：
    将 agent_answer 注入下一轮 Prompt
    合并子 Agent 的记忆结果
    继续 LLM 推理生成最终回答
```

#### 多 Agent 分工示例：机票+酒店组合查询

```
用户: "帮我查五一上海飞北京的机票，顺便推荐北京的酒店"

主循环 LLM 推理：
  → 识别需要 flight_agent + hotel_search 工具

AGENT_DISPATCH:
  <agent name="flight_agent">
    {"from":"上海","to":"北京","date":"20250501"}
  </agent>

FLIGHT_AGENT 分支：
  FlightLoop 独立运行
  └── LLM 推理 → flight_search_tool
  └── 调用 MCP → Volcengine 机票 API
  └── 解析结果 → 格式化航班信息
  └── 返回 agent_answer: "找到3班航班：..."
  └── 写入 context.NAME_2_MEM["flight_result"]

回到主循环：
  context.agent_answer = "找到3班航班..."
  
TOOL_INTEGRATION：
  ToolAsyncBoard 同步执行 hotel_search
  → MCP → Volcengine 酒店 API
  → NAME_2_MEM["hotel_search"].append(...)

ANSWER_PREPARATION：
  Prompt 包含：
  - flight_result（来自 FlightLoop）
  - hotel_search（来自主循环工具）
  - 历史对话
  - 用户偏好记忆

最终答案: "以下是为您推荐的机票和酒店..."
```

### 4.6 Prompt 构建机制（Prompt Lego）

```
PromptGenerator - 模块化 Prompt 组装器

48 个 Prompt 模块（位于 prompt_lego_v2/）:
  basic_prompt.py            基础角色设定（我是DeepTrip助手...）
  tool_prompt.py             工具描述（什么时候调用哪个工具）
  agent_prompt.py            Agent描述（什么时候分发哪个Agent）
  thinking_format_prompt.py  思考格式要求（<think>标签规范）
  user_history_prompt.py     历史对话注入
  tool_result_prompt.py      工具结果注入（NAME_2_MEM → 文本）
  user_memory_prompt.py      用户偏好记忆注入（Milvus检索结果）
  weather_prompt.py          天气信息注入
  user_location_prompt.py    用户位置注入
  basic_rule_prompt.py       行为规则约束
  ...

组装示例（行程规划场景）：
  first_prompt = PromptGenerator([
      "basic",           # 角色
      "tool_result",     # 工具结果
      "working_mechanism", # 工作机制
      "tool",            # 可用工具
      "ability",         # 能力边界
      "tool_rule",       # 工具使用规则
      "basic_rule",      # 基础规则
      "identity",        # 身份
      "user_memory",     # 用户记忆（Milvus检索结果）
      "weather",         # 天气信息
      "user_location",   # 用户位置
  ])

渠道差异化：
  苏州渠道：替换 sight_recommend 相关提示词
  企业渠道：调整工具列表描述
  H5 vs 小程序：调整输出格式引导
```

### 4.7 流式输出处理（AgentStreamProcessor + FSM）

```
LLM Token 流
│
▼
AgentStreamProcessor
│
├── ThinkingStreamParser（分离思考/答案内容）
│   <think>...</think> → thinking_content（内部使用，不输出）
│   其余内容 → answer_content（输出给用户）
│
├── stream_fsm_tools_v2（XML 标签 FSM）
│   识别并解析：
│   <tool name="...">...</tool>  → 触发工具调用
│   <agent name="...">...</agent> → 触发 Agent 分发
│   <finish>...</finish>         → 会话结束信号
│   <language>...</language>     → 语言切换信号
│
├── 输出适配
│   - 思考过程 polish（ThinkPolisher 润色）
│   - 多语言适配（detected_language_code）
│   - TTS 副发布（Redis → TTS 服务）
│
└── SSE 格式化
    data: {"type":"answer","content":"您好..."}
    data: {"type":"tool","name":"hotel_search","status":"running"}
    data: {"type":"finish","finish_blocks":[...]}
    data: [DONE]
```

### 4.8 可观测性（Langfuse）

```
一次用户请求 → 一个 Langfuse Trace
│
├── span: init_dt_context
├── span: load_history（Redis/ES）
├── span: analyze_query（意图分析 LLM）
├── span: llm_inference_round_1（主 LLM 推理）
│   └── 记录: model / prompt_tokens / completion_tokens / latency
├── span: tool_hotel_search（工具调用）
│   └── 记录: params / result / latency
├── span: tool_sight_recommend（工具调用）
├── span: agent_flight（子 Agent）
│   ├── span: flight_llm_inference
│   └── span: flight_search_tool
├── span: llm_inference_round_2
└── span: post_processing（存储/记忆写入）

查询方式：
  Langfuse Dashboard → Session 搜索 sid
  或通过 langfuse-session-query skill 查询
```

---

## 附录：关键配置项

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| MAX_DEPTH | 14 | Agent 最大推理轮数 |
| max_concurrency | 16 | 工具并发上限 |
| tool_timeout | 15s | 单个工具超时 |
| Redis TTL | 14~30天 | Session 缓存保留期 |
| Milvus 向量维度 | 2560 | 用户记忆向量维度 |
| Memory 单次容量 | 120条 | 超出截断为6条 |
| Memory 总容量 | 150条 | get_string 触发随机淘汰 |
| LLM 模型（默认） | deepseek-v3 | 主推理模型 |
| LLM 接入网关 | OneAI (17usoft) | 统一 LLM 网关 |

---

## 附录：本地开发启动顺序

```bash
# 1. 数据集服务
cd arsenal-service-ai-dataset && mvn spring-boot:run

# 2. MCP 工具网关
cd arsenal-service-ai-mcp && mvn spring-boot:run

# 3. Agent 核心服务
cd agent-b101
uvicorn app.main:app --port 8008 --reload

# 4. 主入口服务
cd arsenal-ai-deeptrip && mvn spring-boot:run

# 5. 运行冒烟测试
# 参考 doc/project/ChatE2eTestFramework_DOC.md
```

---

> 文档维护：有服务改动时请同步更新本文档。
> 详细联调链路参考：`doc/project/DeepTripOverview_DOC.md`
> SRE 视角参考：`doc/project/DeepTripSRE分享稿_关键业务流程与外部资源总览_DOC.md`
