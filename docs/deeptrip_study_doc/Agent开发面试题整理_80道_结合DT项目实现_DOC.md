# Agent 开发面试题 80 道 —— 结合 DeepTrip（DT）项目实现的回答

> 来源题目：`docs/deeptrip_study_doc/Agent开发面试题整理_80道_DOC.md`
> 回答方式：每题先说**DT 项目里怎么做的**（已实现 / 做得不好 / 未涉及），再给出**通用最佳实践 / 补全建议**。
> 整理时间：2026-04
>
> ### 标签说明
> - ✅ **DT 已实现**：DT 在生产里已经落地，可直接引用
> - ⚠️ **DT 做得不好**：DT 有，但能力弱 / 覆盖不全 / 阈值粗糙
> - ❌ **DT 未涉及**：DT 当前没做，需要从外部最佳实践补齐
>
> ### DT 仓库速查（多仓协作）
> - `arsenal-ai-deeptrip` (dt-main) — 服务端总入口、网关、路由转发、风控、限流、意图分发
> - `agent-b101` (dt-core-agent) — Agent 核心：编排、工具调用、Prompt
> - `chat-server` / `chat-message-server` — SSE 入口 + 流状态管理 + 断线续传
> - `arsenal-service-ai-dataset` (dt-dataset) — 工具数据中台（机酒火景地图）
> - `arsenal-service-ai-mcp` (dt-mcp) — MCP 统一工具协议
> - `arsenal-ai-deeptrip-marketing` (dt-marketing) — 营销活动、AI 生图、分享长图
> - 观测：Langfuse；告警：企微 webhook
>
> 业务总览参考：`dt_robot/doc/project/business/DeepTripSRE分享稿_关键业务流程与外部资源总览_DOC.md`

---

## 一、流式输出（13 题）

### 1. SSE vs WebSocket 选型逻辑？

✅ **DT 已实现**：DT 全链路用 **SSE**（`hotel_chat`、`flight_chat`、`train_chat` 等接口），客户端覆盖 H5 / 小程序 / App。
- 入口：`dt-main` → 灰度可切到 `chat-server`（配置 `deeptrip.requestForwardsChatServer.enable` + `chatServerUriList`）
- 选型理由：**单向推送 + 浏览器/小程序原生兼容 + HTTP 复用现有网关与鉴权**

**通用结论**：
| 维度 | SSE | WebSocket |
|---|---|---|
| 模式 | 单向 server→client | 双向全双工 |
| 协议 | HTTP，复用网关/鉴权/CDN | 独立 ws 协议，部分代理/小程序兼容差 |
| 断线重连 | 原生 + Last-Event-ID | 手写心跳 + 重连 |
| 适用 | LLM token 流、通知 | 协作编辑、IM、游戏 |

LLM 场景默认 SSE；只有"用户中途打断/补充上下文走同一连接"才考虑 WS。

---

### 2. 流式中断 / 重连后如何恢复上下文，避免重复 / 丢包？

✅ **DT 已实现**：DT 专门拆出了 `chat-server`（SSE 入口） + `chat-message-server`（流状态服务），就是为了解决这个问题。
- 链路文档：`dt_robot/doc/project/business/ChatSseReconnectFlow_DOC.md`
- 实现思路：
  1. `chat-server` 给每条 SSE 建立 `requestId/sessionId`，每个 chunk 带单调递增 `eventId/offset`
  2. 输出过程中把分片写入 `chat-message-server`（Redis `deeptrip` 实例）
  3. 客户端重连时带 `Last-Event-ID`（标准 SSE 头）或自定义 `lastEventId`/`offset`
  4. `chat-server` 向 `chat-message-server` 查询 `from lastEventId+1` 的缺失分片，先按顺序补发，再继续转发下游 Agent 的新分片
  5. 状态有 TTL，避免无界增长
- 排查抓手：`requestId`、`lastEventId`、补发条数 / 命中（hit/miss）/ 过期原因都打日志

**通用补充**：
- 服务端 `eventId` 必须**单调递增 + 可定位**，不能用纯时间戳（并发会撞）
- LLM 是不可重放的（同样 prompt 不保证相同输出），所以必须**缓存 chunk**而不是"重放推理"
- 客户端去重：以 `eventId` 为幂等键

---

### 3. 用户点击"停止生成"，后端如何立即终止 LLM 推理、释放资源？

⚠️ **DT 做得不好**：DT 走的是 OneAI（`oneai.17usoft.com/v1/chat/completions`）这种**远端模型 API**，不是自建 GPU 推理服务，所以没有"GPU 资源释放"这层概念，只能：
- 关闭对下游 LLM 的 HTTP 流，OneAI 侧自己回收
- 关闭 SSE 写入端（`chat-server` 主动 close）
- 把 `chat-message-server` 中该 session 标记 `failed/cancelled`

❌ **DT 未涉及**：自建 vLLM/TGI 场景下的 **request-level abort**（vLLM `AsyncLLMEngine.abort(request_id)`）、KV cache 回收、占用 GPU slot 的释放。

**最佳实践**：
- 客户端 → 网关 `/cancel?sessionId=xxx` → 写 Redis cancel 标记
- LLM 调用循环每生成一个 token 检查 cancel 标记（或在网络读循环上挂 CancellationToken）
- vLLM：`engine.abort(request_id)`；TGI：关闭 HTTP/2 stream；本地 PyTorch：`torch.cuda.empty_cache()` + 终止线程
- **关键陷阱**：不要直接 `kill` 推理进程，会拖垮整个 batch；必须 request-level abort

---

### 4. 流式中插入非文本事件（工具调用、思考、错误、分段），不影响前端渲染？

✅ **DT 已实现**：DT 用**SSE event 类型**区分。从 `ChatDispatcher` 流程看，已有的事件类型至少包括：
- `token`（普通文本 chunk）
- `tool_call` / `tool_result`（工具调用 + 结果）
- `dispatch`（Agent 间二次分发事件，比如 Core → 客服 / 酒店 Agent）
- `error` / `risk_hit`（风控命中）
- `end`（流结束）

事件用 SSE 标准的 `event: xxx\ndata: {json}\n\n` 形式，前端按 `event` 路由渲染。

**通用补充**：
- 不要全用 `event: message`，否则前端只能按 JSON 字段路由，扩展性差
- 错误事件必须**不破坏 SSE 协议**（继续 `event: error\ndata: {...}\n\n`，最后再 `event: end`）
- 思考过程（如 DeepSeek-R1 的 `<think>`）单独走 `event: thinking`，前端可选择折叠

---

### 5. 多轮对话 + 流式：消息不乱序、上下文不丢失？跨服务（Java/Go + Python）流式透传？

✅ **DT 已实现**：
- 上下文：`sid`（session id）+ ES 存对话历史 + Redis `dt_dispatcher_agent_{sid}_{memberId}` 记录上一轮命中的 Agent
- 顺序：单 sid 串行，`eventId` 单调递增
- 跨语言透传：Java `dt-main` → Python `agent-b101`（FastAPI）→ Python `dt-dataset` 都走 **HTTP SSE**，`dt-main` 用 OkHttp 流式转发（见 `DatasetRoutingFilter`），中间不缓冲，directly pipe body bytes

**通用补充**：
- **不要在中间节点做 JSON parse**，直接 byte 透传，避免乱序与延迟
- traceId 必须从入口贯穿（DT 用 `TraceIdFilter` 在 post 阶段透传）
- 多轮上下文压缩：超长时按"摘要 + 最近 N 轮"截断（DT 在 ES + Redis 各存一份对话历史）

---

### 6. 高并发（QPS ≥ 1000）SSE 长连接：连接复用、心跳、超时释放，避免 OOM？

⚠️ **DT 做得不好 / 部分实现**：
- ✅ 有的：HTTP/1.1 keep-alive、网关 dtgw 层超时控制、`chat-server` 独立部署避免拖垮 dt-main、Redis 状态 TTL
- ⚠️ 弱的：没有看到明确的**SSE 心跳设计**（`:keepalive` comment 帧）文档；连接数上限、ulimit、netty/undertow 调参不在公开文档里
- ❌ 未涉及：BackPressure / 反压（下游 LLM 比客户端快/慢时怎么办）；连接池的可观测指标（active/idle/wait）

**最佳实践**：
- Nginx：`proxy_buffering off; proxy_read_timeout 600s; chunked_transfer_encoding on`
- 心跳：每 15-30s 发 `: keepalive\n\n`（注释帧，不触发 onmessage）
- 服务端：Reactor / WebFlux / FastAPI async，**单线程承载千级长连接**，避免一连接一线程
- OOM 主因：**buffer 堆积** —— 严格限制每个 session 的 chunk 缓冲队列长度（如 256 个，超出丢弃旧 chunk 或直接 close）
- 监控：active SSE 连接数、平均 chunk 间隔、heap 占用

---

### 7. 流式输出实时内容安全截断（敏感词立即停流 + 清上下文）？

✅ **DT 已实现**：DT 有完整的**输入侧 + 输出侧风控**链路，文档：`dt_robot/doc/project/business/DeepTripSRE分享稿_..._DOC.md` 6.1 节
- 输入侧：`dt.riskCenter.detect.req_uri_list` + `dt.risk.detect.parallel.await_ms` 并行检测 + Sec API + OneAI 自研风险检测
- 输出侧：`dt.riskCenter.detect.output.enable` + `deeptrip.output.risk_detect.wait_timeout_ms` —— SSE 流式输出过程中**滑动窗口检测**，命中后**中断生成 + 改写返回**
- 域名白名单：`deeptrip.output.address.whitelist.trusted/untrusted` 防止恶意链接外泄
- 审计：MongoDB + Kafka 双写

**通用补充**：
- 检测粒度：通常按 32~128 token 滑窗，避免单 chunk 漏检（敏感词跨 chunk）
- 命中后：① 替换为安全话术 ② 写审计 ③ **不要清掉前面已经送给客户端的文本**（已发出去的回收不了），但要终止后续生成
- 注意：输出侧风控开启会增加延迟，DT 用 `parallel.await_ms` 并行检测来抵消

---

### 8. 流式精准 Token 计费？

⚠️ **DT 做得不好**：
- ✅ 有：OneAI 返回的 usage 信息可以收集；Langfuse 接入了 token 维度统计
- ⚠️ 弱：未见"按分段统计 + 实时累计 + 计费 ledger"的成熟方案；DT 当前定位是 C 端用户付费旅行产品而非按 token 计费的开放平台

❌ **DT 未涉及**：tier 计费（不同模型不同价位 × 输入/输出/缓存 token）、跨账号成本归集。

**最佳实践**：
- 完整 token = `prompt_tokens + completion_tokens`，流式时 OpenAI 协议下需要 `stream_options={"include_usage": true}` 才会在最后一个 chunk 返回 usage
- 兜底：用本地 tokenizer（tiktoken / qwen tokenizer）实时累加 chunk token 数
- 按"模型版本 + 用户 + 渠道"三维聚合，落 OLAP（ClickHouse / Doris）

---

### 9. 多端（小程序/APP/PC）流式兼容差异？

⚠️ **DT 做得不好 / 实际踩过坑**：
- 小程序：`wx.request` 不支持 SSE，必须用 `wx.connectSocket`（WS）或长轮询。DT 小程序通过 **chat-server 的特殊适配层**返回（猜测，文档未细化）
- 微信支付商户号场景：DT 写了 **Adapter 格式转换层**（`WxMerchantPayController`），把标准 SSE 转成微信商户协议
- iOS WKWebView：低版本对 SSE 缓冲严重，需要 `Cache-Control: no-cache, no-transform`

❌ **DT 未涉及**：渲染卡顿优化（chunk 聚合 / requestIdleCallback / 增量 diff）方面没有公开文档

**最佳实践**：
- 小程序：用 WebSocket 反代 SSE，或者拆成"短轮询 + 偏移量"
- 渲染卡顿：前端 batch 5-10 个 chunk 再更新 DOM；用虚拟列表展示历史

---

### 10. 流式中 LLM 报错 / 中途断连的兜底？

⚠️ **DT 部分实现**：
- ✅ 有：OneAI 调用层有重试 + 备用模型切换（配置驱动）；输出侧风控异常会改写为安全话术
- ⚠️ 弱：在 SSE 中途断流时，DT 当前的兜底主要是"前端展示已收到部分 + 提示重试"，没有"中途切模型续写"

**最佳实践**：
- 短 prompt + 已生成内容 → 切备用模型续写（让备用模型基于"前缀"接着写）
- 兜底话术分级：①"网络问题，请重试" ②"换个问法" ③ 直接拿规则回复
- 关键：**已经发出去的 chunk 不能撤回**，只能"后续 chunk 用兜底覆盖"

---

### 11. 断点续打：用户刷新页面后恢复未完成的流式内容？

✅ **DT 已实现**：本质就是题 2 的延伸 —— `chat-message-server` 保存了所有 chunk + completion 状态。
- 用户刷新 → 拿 `sessionId/requestId` → 调 `chat-server` 重连 → 把所有历史 chunk 重发 + 续接未完成部分
- TTL 窗口内可用（业务上一般 5-10 分钟，DT 用配置控制）

**通用补充**：
- 持久化窗口要权衡：太短没体验，太长 Redis 占用爆炸
- 完成态的会话最终要落 ES（DT 已做）供历史查询

---

### 12. 跨服务流式透传的全链路日志埋点？

✅ **DT 已实现**：
- traceId 全链路：`TraceIdFilter`（dt-main）→ HTTP header `w-trace` → agent-b101 → dataset
- Langfuse 接入 agent-b101，记录 prompt / tool call / model 调用 / token
- ES 存对话历史
- 关键日志字段：`sid`、`reqId`、`memberId`、`dtSource`、`agentType`、`eventId`、`chunk_size`、`elapsed_ms`

⚠️ **做得不好**：跨 chat-server / chat-message-server / agent-b101 三层的**单条 chunk 端到端耗时统计**还需要手动拼，没有"一行链路"的成品 dashboard

**最佳实践**：OpenTelemetry trace + Langfuse 双写；span 命名规则统一（`llm.call`、`tool.call`、`risk.detect`）

---

### 13.（题目编号 12 已是最后一题，原文 13 缺）

> 原题表里"流式输出"只列到 12，按 13 题计算的话剩下 1 题归到补充：

补充常见考点 —— **如何做"流式输出的 A/B 实验"**：
- DT 已实现：`ChatDispatcher` + 配置中心驱动的灰度白名单（`chatServerUriList`、按 `dtSource` 分流）
- 实践要点：分流 key 用 `sid` 哈希（保证同会话同分组）；指标关注首 token 延迟、完成率、人均对话轮次

---

## 二、Agent 核心原理（20 题）

### 1. Plan→Act→Observe→Reflect 环路在生产中怎么落地？异常如何处理？

⚠️ **DT 做得不好 / 不是经典 PAOR**：DT 的 `agent-b101` 当前主流程偏向 **Prompt 驱动 + 显式 Tool Schema** 的"轻 Reflection"模式：
- Plan：靠 system prompt + 业务规则（旅行场景 SOP）+ ChatDispatcher 做粗分发（Core / 客服 / 酒店 / 商旅 Agent）
- Act：tool_calls（机票/酒店/火车/POI 工具）
- Observe：tool result 回灌
- Reflect：基本没有显式 Reflection 节点，靠多轮对话由用户驱动修正

❌ **DT 未涉及（或弱）**：自动 Reflection / Self-Critique；DT 在 `20260324_自主Agent系统` 迭代里有规划做这事，但还在演进。

**异常处理（业界做法）**：
- Act 失败：工具级重试 + 降级到 alternative tool + 兜底回复
- Observe 无结果：把"无结果"也作为有效 observation 喂回 LLM，让它换策略
- 死循环：步数上限 / token 上限 / 同工具重复调用熔断

---

### 2. ReAct 框架避免"思考与行动脱节"，优化 Reason 准确性？

⚠️ **DT 不直接是 ReAct**：DT 走的是 tool calling（function calling）模式，思考主要在 system prompt 里规则化。

**通用最佳实践**：
- Few-shot 示例覆盖典型 reason→action pair
- 强制结构化输出（JSON schema），把 "thought" 字段也校验
- Self-consistency：同一 reason 跑 N 次取多数（成本高，DT 不会做）
- 行动后强制写一句 "why this action"，提升一致性

---

### 3. Tool Schema 设计核心：让 LLM 正确选工具、传对参数？

✅ **DT 已实现**：DT 的工具 schema 在 dt-dataset / dt-mcp 都有规范：
- MCP 协议：`/api/mcp/local/tools` 发现 + `/api/mcp/tools/call?serverId&toolId` 调用
- 工具按"业务域 + 实时性"分类（机票实时 / 时刻表 / POI / 地图）
- 参数都有强类型（出发地、到达地、日期）+ 业务校验

**最佳实践**：
- name：动词 + 业务对象（`search_flight`、`query_train_schedule`）
- description：写明**什么时候用、什么时候不用**（最重要）
- parameters：JSON Schema + enum + required 显式标注 + 给 example
- 控制工具数：>30 时分组 / 按意图分阶段暴露，避免 LLM 选错

---

### 4. 多步工具依赖（查用户→查订单→查物流）：依赖管理、避免重复、死循环？

⚠️ **DT 部分实现**：
- DT 在客服 Agent / 业务订单查询 里有"先 memberId → 再订单 → 再详情"的顺序逻辑，但**主要靠 prompt 引导**，而不是显式 DAG
- 重复调用：DT 有 Redis 幂等键（题 12），同一 reqId 内重复 tool call 会被识别但当前未严格阻断
- 死循环防护：step 上限是基础策略

❌ **DT 未涉及**：显式 DAG / Workflow Engine（LangGraph 状态机那种）

**最佳实践**：
- 显式 DAG（LangGraph / dify workflow）描述依赖关系
- 每步结果写"短期记忆"，下次 tool call 前先查记忆
- 死循环：(toolName + paramHash) 出现 ≥ N 次直接终止 + 兜底

---

### 5. Reflection 机制：从失败中学习？

❌ **DT 基本未涉及**：DT 目前没有显式的 Reflection 闭环，错误样本主要靠**人工拉 Langfuse 看 case + 修 prompt**。
- `20260324_自主Agent系统` 迭代在规划中

**业界做法**：
- Reflexion：失败后让 LLM 写"教训"存长期记忆，下次取出 prepend
- Self-RAG：检索 + 自我评估生成质量
- Offline：把 bad case 整理为 few-shot 补充 system prompt

---

### 6. 短期 / 长期记忆存储结构，平衡容量与速度？

✅ **DT 部分实现**：
- 短期：Redis（`arsenal_ai_agent_deeptrip` 实例）—— 当前 session 上下文、agent 轨迹、ChatDispatcher 状态（10min TTL）
- 长期：ES（`deeptrip-data-user-label-*`）—— 用户历史对话 + 标签；HBase（`asnaai:tcuservisithist`）—— 访问历史
- 用户画像：Furion 标签服务

⚠️ **弱**：没有"基于语义检索的长期记忆"（vector memory），用户偏好提取仍是规则 / 标签维度。

**最佳实践**：
- 短期：Redis + 滑动窗口 / 摘要压缩
- 长期：向量库（Milvus / Chroma） + 元数据过滤
- 速度优化：分层 —— 热数据 Redis，温 ES，冷 HBase

---

### 7. 高并发下任务排队、限流、优先级（付费用户优先）？

✅ **DT 已实现**：
- 配置中心驱动的 Web 限流：`RateLimitAspectCustomerHandler`（dt-main），算法支持滑动窗口 + 令牌桶，Redis + Lua 原子判断
- 总开关 `deeptrip.rate_limit.enable`，规则 `deeptrip.rate_limit.rules`（JSON 数组，热更新）
- 多维度：按接口、用户、渠道（`dtSource`）
- 开放平台限流：`dt_submit_task_rate_limit`（默认 60s 10 次）

⚠️ **弱**：未见明确的"付费 / VIP 用户优先"队列；目前更偏渠道粒度（私域 / App / 小程序）

**最佳实践**：
- 多级队列（VIP / 普通 / 灰度），各级独立令牌桶
- 任务投递到 MQ（DT 用 TurboMQ / Kafka），消费端按优先级 worker pool

---

### 8. 工具调用超时：重试、熔断、降级？

✅ **DT 已实现**：
- 重试：dt-dataset 各 BoundService 都有超时 + 重试（OkHttp + 业务封装）
- 熔断：依托公司 Hystrix / Sentinel 体系（公司基础设施）
- 降级：例如机票实时查询超时 → 回退到日历价格 / 缓存价格
- 兜底回复：DT 有专门话术池，按业务域配（"系统繁忙，已为您准备热门行程..."）

**通用补充**：兜底话术要**有信息量**（带具体推荐而不只是道歉），避免生硬

---

### 9. 沙箱执行 SQL / 代码：权限隔离、防注入？

❌ **DT 未涉及**：DT 是"工具调用 + 数据中台"模式，**Agent 不直接执行 SQL/代码**，所有数据访问都走 dt-dataset 的预定义接口，天然规避注入。Text2SQL 不是 DT 当前形态。

**业界做法（若要做 Text2SQL）**：
- 只读账号 + row level security
- SQL parser 白名单（只允许 SELECT、限制 join 数）
- Docker / firecracker 沙箱执行；超时 + 资源限额
- 表/列脱敏视图

---

### 10. LangChain vs LangGraph 选型？LangGraph 状态机适配复杂流程？

❌ **DT 未直接用 LangChain/LangGraph**：DT agent-b101 是**自研 Python 框架**，更轻量、更贴业务。

**结论**：
- 简单 ReAct / 单 Agent → LangChain 或自研
- 多 Agent 编排、显式状态转移、人审节点（审批、工单）→ LangGraph
- LangChain 生产坑：版本不稳、抽象层太厚、调试黑盒；建议只拿来做 POC

---

### 11. Agent 全链路可观测：思考 / 工具 / 耗时 / Token / 异常？

✅ **DT 已实现**：
- Langfuse 接入（agent-b101），覆盖每次 LLM call / tool call / 耗时 / token / 异常
- traceId 跨服务透传
- 内部有 `langfuse-session-query` skill，可通过 sid 查整条链路
- ES + MongoDB 双写审计

⚠️ **弱**：跨多个 Agent（Core/客服/酒店）的串联视图，需要手动用 sid 关联，不是开箱即用

---

### 12. 同一 Agent 任务被多用户/多次触发的幂等？

✅ **DT 已实现**：
- 请求级幂等：`agent_run_trace_{sid}_{reqId}` Redis key（5min TTL）
- 任务级幂等：开放平台 `submit_q_task` → `query_task_result`，taskId 全局唯一
- ChatDispatcher 用 `sid + memberId` 锁定 Agent 选择

---

### 13. Agent 安全传递用户身份，调用工具时防越权？

✅ **DT 已实现**：
- dt-main 入口 `TcMemberService.getLoginMemberInfoByInterface` 解 secsign/deviceId/unionId
- 转发到 dt-dataset 时由 `DatasetRequestWrapperFilter` 补 `Authorization` + `memberId`
- dt-dataset 用 `@CommonAuthCheck` 校验
- 工具调用时 memberId 透传到底层，无法越权查别人订单

**通用补充**：身份签名应短 TTL + 一次性 nonce 防重放

---

### 14. Agent 执行可回放、可打断、可人工接管（客服转人工）？

✅ **DT 已实现**：
- 回放：Langfuse trace + ES 对话历史 + sid 重放
- 打断：用户侧 cancel + chat-server 关流
- 人工接管：ChatDispatcher 支持 `KeFu` Agent 路由 —— 满足条件（如检测投诉意图 / 用户主动说"转人工"）会 dispatch 到客服 Agent，客服 Agent 与外部客服系统对接

---

### 15. 任务分解能力优化？

⚠️ **DT 部分实现 / 弱**：
- DT 的复杂任务（多日行程）目前主要靠 prompt + few-shot 引导，分解粒度由模型决定，没有显式 Planner 节点
- 行程生成是 DT 的核心场景，但实现上更多是"模板 + 检索 + 填槽"而不是"动态 plan"

**业界做法**：
- 拆为 Planner Agent + Executor Agent
- 显式输出 step list，逐步执行 + 状态汇报
- 用 hierarchical task network（HTN）

---

### 16. 开源框架（LangChain / AutoGen / MetaGPT）生产坑？

❌ **DT 选择自研规避**。

**踩坑总结（业界）**：
- LangChain：抽象层深，prompt 不可控，版本爆炸；只用 IO / Splitter / Tracing 子模块
- AutoGen：多 Agent 通信容易死循环、上下文爆炸
- MetaGPT：场景偏代码生成，业务定制困难
- 通用建议：**生产用极简自研框架 + 复用开源生态组件（tokenizer / retriever / tracer）**

---

### 17. Agent 与现有后端（Java/Go）对接的稳定性、一致性？

✅ **DT 已实现**：经典样本就是 dt-main(Java) ↔ agent-b101(Python) 这条链路：
- HTTP + JSON / SSE 通信
- traceId / memberId 标准 header
- 网关层超时 + 熔断
- 配置中心统一下发开关，灰度切流

---

### 18. 评估 Agent 任务完成率、成功率、错误率、步骤合理性？

⚠️ **DT 部分实现**：
- 有：基础指标（QPS、错误率、首 token 延迟）走公司监控
- 有：业务侧"对话完成率"、"跳转预订率"由 BI 统计
- 弱：**步骤合理性 / 工具调用准确率**这类 AI 专有指标没有自动评估，主要靠人工抽样 + Langfuse 看 case

**业界做法**：
- 离线集：标注的 task → 成功率 / 步骤数 / 平均工具数
- 在线集：用户行为反馈（点踩、重试、转人工率）作 proxy
- LLM-as-Judge：自动打分准确性 / 相关性 / 安全性

---

### 19-20.（原题缺）

补充常见 —— **Agent 上下文窗口溢出怎么办**：摘要压缩、滑动窗口、分段总结、retrieval-based memory（DT 主要靠摘要 + ES 检索历史）。

---

## 三、RAG 生产落地痛点（19 题）

> ⚠️ 总体说明：**DT 的 RAG 形态偏弱** —— DT 不是知识库问答产品，而是行程规划助手；它的"检索"主要是：
> - 结构化数据检索（机票/酒店/火车 真实库存）
> - POI 向量检索（`/llm/poi/rec` → BDS 向量服务）
> - 用户标签 / 历史检索（ES + HBase）
> 因此很多"百万级文档 RAG"的题目，DT 没有正面落地。下面会标注清楚。

### 1. 百万级文档 RAG，延迟 <200ms，索引/分片/缓存？

❌ **DT 未涉及**：DT 没有百万级"文档"。最接近的是 POI 向量检索（BDS / Milvus），但量级和形态都不同。

**最佳实践**：
- 向量库：Milvus / Qdrant，IVF_FLAT / HNSW 索引
- 分片：按业务 namespace / 时间分区
- 缓存：query embedding cache + result cache（Redis，5-30 min）
- 召回 → rerank → LLM 三段式
- 延迟拆分：embedding 50ms + 检索 30ms + rerank 50ms + LLM 首 token 100ms

---

### 2. 文档频繁更新 / 删除，向量库实时一致性，避免脏数据？

❌ **DT 未涉及**（同上）。

**做法**：
- 写时同步：业务库 update → 发 MQ → consumer 重新 embed + upsert 向量库（DT 在 dt-dataset 内部走类似模式）
- 删除：软删 + 后台合并；Milvus 用 partition + collection 重建
- 一致性：版本号字段 `doc_version`，检索时过滤最新

---

### 3. 检索结果缓存 vs 知识更新的矛盾？

⚠️ **DT 部分相关**：DT 对**工具结果**有缓存（机票低价、酒店列表），通过缓存 key 带"日期 + 城市 + 时间窗口"，时效短（分钟级）。

**做法**：
- 缓存 key = hash(query + filters + knowledge_version)
- 知识版本号变更触发 cache invalidate
- 短 TTL（1-5 min）+ stale-while-revalidate

---

### 4. 用户问题模糊：意图识别 + 查询改写 + 多路召回？

✅ **DT 已实现**：
- 意图识别：`ChatDispatcher` 多 Agent 分发（核心 / 客服 / 酒店 / 商旅）
- 查询改写：Prompt 里有"将用户口语改写为结构化查询"步骤
- 多路召回：POI 检索同时走（关键词 + 向量 + 标签偏好）

---

### 5. 表格 / 带格式 PDF / 图片文本 RAG，保留结构信息？

❌ **DT 未涉及**：DT 不是知识库产品。

**做法**：
- 表格：Markdown 表 / HTML 表保留行列；按行切块
- PDF：unstructured.io / PyMuPDF 提取 + 结构标签
- 图：OCR + VLM 描述 + 双向索引

---

### 6. 长文档（10w 字+）中间内容丢失，父子分块 / 分层 / rerank？

❌ **DT 未涉及**。

**做法**：
- Parent-child chunking（细块召回，父块返给 LLM）
- 分层检索：先检 doc → 再检 section → 再检 chunk
- Rerank：bge-reranker-v2 / Cohere rerank

---

### 7. 混合检索（稀疏 + 稠密）调参，平衡召回率与速度？

❌ **DT 未涉及（仅 POI 向量）**。

**做法**：
- BM25（稀疏，关键词命中强） + Dense（语义） RRF（Reciprocal Rank Fusion）合并
- 权重 `alpha` 网格搜索
- 速度：并行召回，rerank 限 top-k

---

### 8. RAG + 多轮对话：基于历史上下文自动检索，避免重复 / 无效检索？

⚠️ **DT 弱**：DT 对话历史有 ES，但"自动检索"主要靠用户当前 query，没有显式"判断是否需要检索"的环节。

**做法**：
- Query rewrite：把用户最新一句 + 最近 N 轮压缩成独立 query
- Retrieval Gate：LLM 先判断"需要检索吗"，避免每轮都检索

---

### 9. 避免 RAG 检索到大量无关片段，LLM 跑偏？

❌ **DT 未涉及**（无文档 RAG）。

**做法**：
- 召回数限制 + 相似度阈值过滤
- Rerank top-3 ~ top-5
- LLM 提示词加"仅基于上下文，找不到答案就说不知道"
- 加 citation，强制引用，能减少幻觉

---

### 10. 自动化评估 RAG（召回率、MRR、Answer Relevancy）？

❌ **DT 未涉及（RAG 维度）**：DT 业务侧有评估（转化率、跳转率），但 RAG 维度的离线评估没做。

**做法**：
- Ragas / TruLens：context_relevancy、faithfulness、answer_relevancy
- 标注集 ≥ 100 条 + LLM-as-Judge
- CI 流水线跑 baseline 对比

---

### 11. Embedding 模型选型，中英混合？

⚠️ **DT 涉及但简单**：POI 向量用 BDS 内部统一 embedding（具体模型公司内部封装）。

**通用建议**：
- 中英混合 → bge-m3、e5-mistral、Qwen3-Embedding、OpenAI text-embedding-3-large
- 中文为主 → bge-large-zh-v1.5
- 效果 / 速度 trade-off：m3 强但慢，bge-small 快但弱

---

### 12. 余弦 / 点积 / 欧氏距离差异？

**通用回答**：
- Cosine：方向相似，向量归一化后等价点积 —— **默认选这个**
- Dot product：未归一化时受向量长度影响（Faiss IP 高效）
- Euclidean：物理空间距离，文本检索很少用

---

### 13. Rerank 模型选型与速度？

❌ **DT 未涉及**。

**做法**：bge-reranker-v2-m3 / Cohere rerank-3 / Jina；速度：rerank 只对 top-30 做，<50ms；可上 ONNX / TensorRT

---

### 14. 增量更新机制，避免全量重 embedding？

❌ **DT 未涉及**。

**做法**：业务库 binlog → CDC → Kafka → embed worker → 向量库 upsert；删除走 tombstone。

---

### 15. 噪声 / 重复文档过滤？

❌ **DT 未涉及**。

**做法**：SimHash / MinHash 去重；空白 / 短文 / 乱码过滤；语言识别过滤。

---

### 16. RAG 高并发负载均衡、水平扩展？

⚠️ **DT 部分相关**：dt-dataset / BDS 有水平扩展能力，但场景不是 RAG 而是结构化检索。

**做法**：向量库分片 + 副本；Embedding 服务无状态；网关层 sticky session 不需要。

---

### 17. RAG vs Fine-tuning 选型？

**通用回答**：
- RAG：知识时效性强、可解释、成本低 → 默认首选
- Fine-tuning：风格 / 格式 / 私有专有任务 / 降低推理 token
- 组合：FT 改风格 + RAG 注知识 = 最佳

---

### 18. 检索滞后问题？

❌ **DT 未涉及（无文档 RAG）**。

**做法**：CDC + 实时 embed 流水线；最大滞后监控 + 告警；关键文档优先级队列。

---

### 19.（原题缺）

补充 —— **RAG 引用与可解释**：每条回答附引用 doc_id + chunk_text + score，DT 在工具结果展示侧做了类似（机票来源、酒店来源透出），但语义检索维度没做。

---

## 四、LLM 工程化与高并发、稳定性（17 题）

### 1. 峰值 QPS 100+ LLM 接口：排队、削峰、批推理、优先级？

⚠️ **DT 部分实现**：
- DT 用 OneAI 远端 API，不是自建推理，所以 batch / vLLM 这层是 OneAI 内部
- DT 这边做的是：限流（题 2.7）+ 异步任务队列（开放平台 `submit_q_task`）+ ChatDispatcher 灰度

❌ **未涉及**：vLLM continuous batching / 优先级抢占

**业界做法**：vLLM `--max-num-seqs` + PagedAttention + 优先级队列；削峰用 MQ 缓冲。

---

### 2. vLLM / TGI / TensorRT-LLM 原理与选型？

❌ **DT 未直接涉及**（用 OneAI 托管）。

**对比**：
- vLLM：PagedAttention + continuous batching，吞吐 SOTA，社区活跃 → 默认
- TGI：HuggingFace 出品，量化支持好
- TensorRT-LLM：极致单卡延迟，部署复杂
- 选型：吞吐优先 vLLM，延迟优先 TRT-LLM

---

### 3. 量化（INT8/INT4/FP8）原理与坑？

❌ **DT 未涉及**。

**要点**：GPTQ / AWQ / SmoothQuant；INT4 速度提升 2x 但部分任务（数学/代码）精度掉点；先评测后上线。

---

### 4. 模型 API 报错 / 限流 / 宕机，熔断 + 切备用模型，用户无感？

✅ **DT 已实现**：OneAI 调用层有 fallback 模型链（主模型挂 → 切备用），配置中心驱动；输出侧风控异常也有兜底话术。

**通用补充**：
- 备用模型必须**预热**（避免首次冷启动）
- fallback chain：DeepSeek → Qwen → GPT-3.5 不同厂商分散风险

---

### 5. 防恶意构造超长上下文 / 高频刷 token？

✅ **DT 已实现**：
- 输入长度限制：`dt.input.max.length`
- 限流：`RateLimitAspectCustomerHandler`（按用户 / 渠道 / 接口）
- 风控：输入侧 Sec API + RiskCenter
- 异常用户：MongoDB 审计 + Kafka 告警

---

### 6. 多模型调度（小模型简单任务、大模型复杂推理）？

⚠️ **DT 部分实现**：DT 不同 Agent（Core / 客服 / 酒店）可配不同模型，意图分发本身就是粗粒度模型路由。但没有"按 query 难度动态选模型"的细粒度策略。

**业界做法**：
- LLM Router（小模型先判断难度）→ 路由到对应模型
- 简单 FAQ → 7B；复杂规划 → 70B
- Semantic cache 命中直接出，跳过 LLM

---

### 7. GPU 资源隔离、队列优先级、超时抢占？

❌ **DT 未涉及**（OneAI 托管）。

**业界**：MIG（NVIDIA Multi-Instance GPU）、cgroup、k8s GPU sharing；vLLM priority scheduling（v0.6+）

---

### 8. 异步 Agent 任务（>10s）：状态管理、重试、通知、落库？

✅ **DT 已实现**：开放平台 `submit_q_task`（最多 10 题批量）+ `query_task_result`（PENDING/PROCESSING/COMPLETED/FAILED）+ DCDB 落库 + 配置驱动重试
- 文档：SRE 分享稿 6.3.4

---

### 9. 全链路压测？

⚠️ **DT 弱**：有公司内 Pi 压测平台支持，但**对话流量的真实回放**这条 DT 在 `20260420_DeepSeek生产环境流量回放` 迭代里在搞。

**业界**：JMeter / locust + SSE 协议适配；prompt 模板化造数据；按渠道权重回放。

---

### 10. AI 模块 + Java/Go 后端的分布式事务、最终一致性？

✅ **DT 已实现**：典型场景是"对话生成行程 → 跳转预订"，DT 用：
- 业务侧本地事务 + MQ（TurboMQ / Kafka）最终一致
- 幂等 key + 重试
- 关键节点（如发券、生成订单）走对账补偿

---

### 11. Agent 高可用部署：多实例、LB、灾备？

✅ **DT 已实现**：
- agent-b101 / dt-main 多实例 + UK 注册中心（同程基础设施）
- 配置中心热切灰度比例
- chat-server 独立部署，跟 agent-b101 故障隔离
- 资源依赖清单：`dt_robot/doc/project/DeepTrip依赖的资源清单_PROD_DOC.md`

---

### 12. LLM 结果 / Embedding / 检索结果缓存？

⚠️ **DT 部分实现**：
- 工具结果（机酒火）有缓存（短 TTL）
- POI 召回有结果缓存
- ⚠️ LLM 完整回答 cache 没做（也不适合做 —— 对话长尾，命中率低）

**业界**：semantic cache（query embedding 相似度 > 0.95 复用回答），适合 FAQ 场景。

---

### 13. 日志巨大（10KB+/轮）的存储、检索、审计、降冷？

✅ **DT 已实现**：
- 实时：ES（对话历史）
- 审计：MongoDB（风控事件）
- 观测：Langfuse
- 降冷：依托公司日志平台（按天归档到对象存储）
- ERROR 日志专门治理：`20260207_DeepTrip统计与监控`、`20260422_全链路ERROR日志自动采集与管控` 两个迭代

---

### 14. 权限控制（数据/工具/功能）？

✅ **DT 已实现**：
- 数据权限：memberId 透传到底层，dt-dataset `@CommonAuthCheck` 校验
- 工具权限：dt-mcp `serverId/toolId` 粒度，可白名单
- 功能权限：dt-main 有 dev-admin 后台 + AuthService，配合 dt_robot 的文档中心权限
- 渠道维度：`innerOpenSourceList` 决定哪些渠道能调哪些接口

---

### 15. Docker + K8s 部署 Agent/LLM：资源、健康检查、滚动？

✅ **DT 已实现**（依托同程基础设施 PBSS）：
- 资源 request/limit 按服务画像配
- 健康检查：`/health` + 业务探针
- 滚动更新：UK 注册中心摘流 → 滚动

**LLM 特殊**：GPU node selector + node taint；模型预热脚本 readiness 探针。

---

### 16. MLOps 在 Agent 系统：模型版本、实验、CI/CD？

⚠️ **DT 部分实现**：
- 模型版本：OneAI 侧负责
- prompt 版本：Langfuse prompts management（DT 接入）
- 实验：ABTest 平台（公司）+ 灰度
- CI/CD：编译 / 发布 / 回滚走 jean skill（DT 自动化工作流）

❌ **未完整**：prompt evaluation 自动化集成到 CI 还在演进

---

### 17.（原题缺）

补充 —— **冷启动**：模型预热（pin 模型到显存）、connection pool 预建、tokenizer 预加载。

---

## 五、安全、成本与架构设计（16 题）

### 1. Prompt Injection 攻击与防御？

⚠️ **DT 部分实现**：
- 输入侧：Sec API（`aisec.17usoft.com/prompt_security/api/v1/detect`）专门检测 prompt 注入
- 输入风控并行 + 超时阈值（`dt.risk.detect.parallel.await_ms`）
- 输出侧：内容审核 + 域名白名单防止外链注入

**通用补充**：
- 防御性 prompt：明确划分"系统指令 vs 用户数据"边界（`### USER INPUT ###` 包裹）
- 工具调用前二次确认敏感操作
- LLM-as-Detector：另一个轻量模型判断是否注入
- Spotlight / 数据签名（学术方案）

---

### 2. 防敏感信息进入 LLM（手机号/订单号）？

⚠️ **DT 部分实现**：
- 业务侧：DT 对话场景敏感信息不多（旅行偏好为主），订单号经过 memberId 鉴权后才能查
- 风控审计：MongoDB 落库时关键字段会脱敏
- ⚠️ **弱**：进入 LLM 前的 PII 自动脱敏不是显式步骤

**最佳实践**：
- 正则 + NER 检测 PII（手机/身份证/银行卡），替换为 token（`{{PHONE_1}}`）
- 出 LLM 后再 detokenize
- 严禁把全量 user PII 喂给外部模型 API

---

### 3. 控制 Token 消耗与模型成本？

✅ **DT 已实现**：
- 限流多维度
- 多模型分级（不同 Agent / 场景不同模型）
- 工具结果缓存
- 输入长度限制 `dt.input.max.length`
- 历史对话压缩（摘要 + 最近 N 轮）

**通用补充**：
- Prompt caching（OpenAI / Anthropic 都支持，DT 接 OneAI 视支持情况）
- 按渠道成本归集 + 月度对账

---

### 4. 私有部署 vs API 选型？

**通用回答**：
- API：快、稳、零运维、随时升级；成本不可控、数据合规风险
- 私有：可控、合规、长跑成本低；运维重、性能不如 API
- DT 选择：用公司内 OneAI（介于二者之间 —— 私有部署 + 统一网关）

---

### 5. Agent 行为可解释、可审计、可回溯？

✅ **DT 已实现**：Langfuse + ES 对话历史 + MongoDB 风控审计 + traceId + Redis trace key

---

### 6. 设计企业内部知识库问答 Agent（架构 + 性能优化）？

❌ **DT 未涉及**（不是 DT 业务形态）。

**参考架构**：
```
用户 → 网关（鉴权/限流）
     → 意图识别 / 改写
     → 多路召回（BM25 + 向量 + 标签）
     → Rerank
     → LLM 生成 + 引用
     → 风控 + 输出
     ← 反馈（点赞/踩）→ 回流离线评估
```
优化点：
- 召回前 query cache
- 向量库分片
- Rerank 控 top-30
- LLM 输出 SSE 流式

---

### 7. Text2SQL Agent：注入、表识别、复杂查询？

❌ **DT 未涉及**。

**做法**：表 schema 检索（向量化 schema description）→ Few-shot SQL → 语法校验 → 只读账号执行 → 结果展示；防注入靠 parser AST 白名单。

---

### 8. 客服多 Agent：意图 + 知识库 + 工单 + 转人工无缝衔接？

✅ **DT 已实现（部分）**：
- 客服 Agent (`KeFuAgent`) 已存在
- ChatDispatcher 支持 Core ↔ 客服 二次分发（用户表达投诉/订单咨询时切换）
- 客服订单查询：`/user/order/kefu/qry`
- 工单：依托公司内部客服系统对接

⚠️ **弱**：没有显式的"人工实时坐席接管 SSE 流"，更多是"转客服系统 url"

---

### 9. 低延迟高并发 RAG（百万文档）？

❌ **DT 未涉及**。同题 3.1，略。

---

### 10. 多 Agent 协作（内容创作）：分工、通信、调度、冲突？

⚠️ **DT 部分相关**：DT 的 ChatDispatcher 多 Agent 是"分发"而非"协作"（同时只一个 Agent 服务用户）。
- 真正的协作场景在 dt-marketing：AI 生图 + Prompt 生成 + 文案，多步骤异步

**业界**：AutoGen / MetaGPT 经验 —— 角色定义清晰、共享 blackboard、上限步数、冲突时仲裁 Agent。

---

### 11. 从后端工程师角度搭可上线 Agent 平台？

✅ **DT 就是范本**。核心模块：
1. 入口网关 + 鉴权（dt-main）
2. 意图分发 + Agent 编排（ChatDispatcher + agent-b101）
3. 工具中台（dt-dataset + dt-mcp）
4. SSE 流式 + 断线续传（chat-server / chat-message-server）
5. 风控（输入 + 输出）
6. 限流 + 配置中心（热更）
7. 观测（Langfuse + ES + MongoDB + traceId）
8. 开放平台（iopen / open）
9. 营销 / 增长（dt-marketing）
10. 开发运营基建（dt_robot：文档中心 + 工作流 skill + 监控）

---

### 12. 输出内容审核 / 毒性？

✅ **DT 已实现**：输出侧风控 + 域名白名单 + 流式中断 + 改写话术（题 1.7）

---

### 13. 灾备：主模型/主服务挂了自动切换？

✅ **DT 已实现**：OneAI fallback 模型链 + chat-server 灰度回切 dt-main 直连 agent-b101 + 配置中心一键切流

---

### 14. 自动化运维 Agent（日志 / 定位 / 命令 / 告警）？

⚠️ **DT 部分相关**：这正是 `dt_robot` 这个仓库的核心定位！
- `system-maintenance` skill：异常修复闭环
- `audit-chain` skill：质量审核
- `langfuse-session-query` skill：sid 查链路
- 企微 webhook 告警
- ERROR 日志自动收集（`20260422_全链路ERROR日志自动采集与管控`）
- macOS 操作自动化（`20260417_macOS操作自动化`）

⚠️ 命令执行 / 自动修复目前还是**人辅助**模式，没到完全自主。

---

### 15. 多模型服务网格：动态切换、LB、健康检查？

⚠️ **DT 通过 OneAI 间接实现**。OneAI 本身就是模型网关。
- DT 侧配置驱动可切模型版本
- 健康检查由 OneAI 网关托管

---

### 16. 长尾任务（执行时间长、资源消耗大）？

✅ **DT 已实现**：
- 异步任务（开放平台 `submit_q_task`）+ 任务状态机
- 行程生成等耗时任务走异步 + 通知回调
- XXL-Job 调度后台任务（攻略导入等）
- 限流 + 优先级隔离避免长尾拖垮短任务

---

# 总结表（DT 实现度一览）

| 分类 | ✅ 已实现 | ⚠️ 做得不好 | ❌ 未涉及 |
|---|---|---|---|
| 流式输出（13） | SSE 选型、断线续传、流状态、风控截断、traceId、多事件类型、Langfuse | 高并发心跳/反压、token 精准计费、多端兼容、断流切模型 | 自建推理 abort、A/B 流式实验细节 |
| Agent 核心（20） | Schema、ChatDispatcher 分发、记忆分层、限流幂等、身份透传、Langfuse 可观测 | Plan/Reflect 弱、任务分解、AI 维度评估 | 显式 DAG/LangGraph、Reflexion 自学习、沙箱执行 |
| RAG（19） | 意图分发、POI 向量检索、工具结果缓存、用户标签检索 | RAG 自动评估、混合检索 | 百万文档 RAG、长文档父子分块、Rerank、嵌入选型、文档去重等大部分 |
| LLM 工程化（17） | 限流、熔断/fallback、异步任务、权限、观测、K8s 部署、日志 | 流量回放、prompt CI 评估、细粒度模型路由 | 自建 vLLM/TGI、量化、GPU 隔离 |
| 安全/成本/架构（16） | 风控双侧、限流、审计、开放平台、灾备、运维 Agent 雏形（dt_robot） | PII 自动脱敏、多 Agent 真正协作 | 企业知识库 RAG、Text2SQL、多模型服务网格自建 |

**一句话总结**：DT 是一个"**强工程化、强治理、弱通用 RAG、不自建推理**"的旅行垂直 Agent 系统，对面试中"多 Agent 编排 / SSE 流式 / 风控限流 / 多渠道开放 / 全链路观测 / 工具中台"类题目能答得很扎实；面对"百万文档 RAG / 自建 vLLM / Reflexion / Text2SQL"类题目需要补行业最佳实践。
