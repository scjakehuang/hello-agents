# Claude Code 2.1.307：工具结果减载与 microcompaction 实际算法

本说明以 `/Users/tcuser/Downloads/claude-code-rea-20261022/readable/` 下真实发行包提取代码为依据，仅静态阅读，未执行目标程序、未请求模型。以下函数名是压缩后发行包里的真实名字，解释性名称不是恢复的 TypeScript 符号。源码行号基于现有 Prettier 格式化文件。

## 1. 不能把四种机制混成一个“压缩算法”

|机制|执行者|触发/预算|做什么|
|---|---|---|---|
|单次工具结果截断/落盘|客户端 `Rle → Q → H9`|工具 `maxResultSizeChars` 与远程配置、ceiling|大文本写文件，以路径和短预览代替|
|同一 assistant message 的工具结果总预算|客户端 `f1s → ae`|feature gate 开启且同组总字符超过 200,000|优先把最大的新结果写文件，保留先前已见结果|
|context_hint 拒绝后的 microcompact|客户端 `KKs`|候选历史工具结果估算至少 20,000 tokens，保留最近 5 次适用工具调用|历史结果改为文件引用，无法保存则清除占位|
|idle 后 server context edit|客户端计划，服务端执行|闲置严格大于 3,900 秒，至少相应数量的可清理结果，keep=12，clear_at_least=20,000|发 `context_management.edits`，服务端清理；客户端读取报告|

它们不生成语义摘要。大摘要流程由其他模块另行完成。也不能从这些常量推断所有用户都会启用：多个路径有 feature gate、模型/beta 支持和 querySource 限制。

## 2. 单次工具结果：按字符阈值落盘，以预览替换

源 `chunk-jk32x8c1.js:34` `Ale`：

1. `maxResultSizeChars` 不是有限数时直接返回，不会被默认 ceiling 限制。
2. `skipAggregateToolResultBudget === true` 时取 `min(maxResultSizeChars, ceiling)`。
3. 否则读取 `tengu_velvet_ibis[toolName]`，有正有限数字即采用；否则取上述 min。
4. ceiling 参数缺省为 `FD=50,000` 字符（`chunk-sxqwc5gp.js:36`）；注意配置 override 分支直接返回值，不再 min。

`Rle:204` 调 `Q:231`，`Q` 空结果先变成 `(ToolName completed with no output)`；`NIo:313` 仅在没有 image/document 且文本总 `length > threshold` 时落盘。`Q` 收到的阈值缺省 `IZs=400,000`；从 Rle 正常传入时还要考虑工具阈值和 ceiling，不能把 400,000 写成所有工具的默认值。

`H9:66` 支持字符串或纯 text-block 数组（数组 JSON pretty 序列化）；含非文本块则返回错误。文件名由 toolUseId 编码后加 `.txt`/`.json`，路径放 session `tool-results/`；路径生成见 `chunk-rdqbpapj.js:1828-1843`。diskless 会话路径可能为 null，支持专用 artifact store 或 storageV5 sidecar；普通文件写入为 exclusive，遇到已存在文件检查 symlink、regular file、nlink，避免复用危险目标。单结果保存上限 `OZs=1,073,741,824` 字节，专用 store 还取 `min(defaultCap, store.maxBytes)`。

替换字符串由 `gMe:153` 生成：

```text
<persisted-output>
Output too large (...). Full output saved to: .../tool-results/toolu_123.txt

Preview (first ...):
[前 2000 字符附近的内容]
...
</persisted-output>
```

`Kmt:275`：总长度不超过 2000 则全留；否则在前 2000 字符中找最后换行，仅当换行位置 `>1000` 才截在换行处，否则截在 2000。这里主要计算 JS 字符串 length，埋点字段虽叫 Bytes，不可当作 UTF-8 实测字节数。

落盘失败有两种行为（`Q:242`）：专用 artifact store 启用时 `uHr` 给出受预算约束的 `<truncated-output>` 并明确其余已丢弃；普通存储路径失败则原样返回整个结果，避免静默丢失。

## 3. 同组工具结果：200,000 字符贪心算法

源 `chunk-jk32x8c1.js:348-485`；调用点 `chunk-hkcbd84t.js:6973`，发生在 `P.autocompact` 之前。

### 3.1 分组不是按“最近 N 轮”

`j:348` 按消息时间顺序扫描：遇 user 消息提取 tool_result；遇到新的 assistant `message.id` 时 flush 当前组；同一个 assistant message 的流式碎片不会重复 flush。组通常对应同一模型回复发出的那一批工具结果。

`te:339` 排除没有 content、已是 persisted/old-cleared 标记、含 image/document 的结果。`p1s:412` 进一步收集 `maxResultSizeChars` 非有限、或 `skipAggregateToolResultBudget=true` 的工具名及别名，这些工具不计聚合预算。

### 3.2 稳定替换状态

`eKn:285` 返回 `{seenIds: Set, replacements: Map}`。

- `mustReapply`：已有 replacement，必须重新使用同一个引用字符串。
- `frozen`：已见过但没有 replacement，不能在后续任意重写。
- `fresh`：本次新出现的结果，允许挑选落盘。

`c1s:291` 只有 `tengu_hawthorn_steeple` gate 开启才创建状态；无状态时 `f1s:480` 原样返回。`pHr:486` 用已有工具 ID、历史 replacement 与额外 map 重建状态；`d1s:288` 拷贝 Set/Map。

### 3.3 精确伪代码

```js
for (group of groups) {
  {mustReapply, frozen, fresh} = classify(group, state)
  reapply(mustReapply)
  freshEligible = fresh.filter(toolNotExempt)
  frozenChars = sum(frozen eligible sizes)
  total = frozenChars + sum(freshEligible sizes)
  chosen = []
  for (result of freshEligible.sort(descendingSize)) {
    if (total <= 200000) break
    chosen.push(result)
    total -= result.size
  }
  // 未选 fresh 与其他已处理结果加入 seenIds
  // chosen 并发 H9；成功才存 replacements、替换消息 content、返回新增替换事件
}
```

这里从预算扣掉的是被移出的原始正文长度，不加回 replacement 字符串长度，所以不是严格保证“完整替换后消息 <=200,000”。如果 frozen 部分已超过预算，算法仍不能改写它们，也可能降不到预算；保存失败同样保持旧内容但标记已见，不能声称必然硬限流。

示例：frozen 60,000，新工具 A=90,000、B=70,000、C=30,000，总250,000。按降序先落盘 A，总计按原始正文降为160,000，B、C留在上下文。下一轮 A即使原始消息重新传进来也用同一个 replacement；B、C变成 frozen，减少对历史前缀的反复改写。这个稳定性由代码确认；关于确切缓存命中改善程度没有运行测量。

新增 replacement 形状为 `{kind:'tool-result', toolUseId, replacement}`。主循环调用 `Fme` 保存（`chunk-hkcbd84t.js:6977`），`chunk-wvsyb4fb.js:21225` 调 `insertContentReplacement`，用于会话恢复。

## 4. Microcompact：最近 5 次保护 + 20k tokens 起清

### 4.1 清哪些工具

`chunk-pxqq6s5v.js:4378` 中 `Et` 为：Read、Bash、PowerShell、Grep、Glob、WebSearch、WebFetch、Edit、Write。`El:4393` 只从 assistant content 的 `tool_use` 收集上述工具 ID，按出现顺序排列。不是任何 MCP 工具都默认进入客户端这条路径。

`JFo:4419`：`r=max(1, keepRecent)`；保留最后 r 个适用工具调用的 ID，其余作 clearSet。这里的 r 是工具调用数，不是用户消息、assistant turn 或结果字符数；受保护调用即使没有有效结果也占位置。只从 user content 提取 clearSet 内且尚未 persisted/cleared 的 tool_result 为 candidates。

`KKs:4453`：求 candidates 的估算 token 总和，`<20,000` 直接返回 null；达到阈值后全部候选参与清理，不按每条阈值筛选，也不是只清到20k就停。

token估算：`Qc:3750` 是 `Math.round(text.length/4)`；`wl:4381` 为字符串这样估算、文本数组求和，image固定2000，document走 `J9n`（text源依据后缀 json/jsonl/jsonc 取约 length/2，普通 length/4；其他文档固定2000）。不是 tokenizer 精确计算。

### 4.2 触发链：不是每轮必执行

`chunk-2zjx6xpn.js:485` 的 `G` 导出为 `createContextHintController`，要求 first-party beta 且 `querySource.startsWith('repl_main_thread')`。本地 gate `tengu_hazel_osprey` 默认 false。

`G.buildRequestParams:497`，如果预估可清 >=20k，添加：

```json
{"context_hint":{"enabled":true,"target_tokens_saved":75000}}
```

75000 是 gate `tengu_hazel_osprey_floor` 默认值，不是本地实际清除量，也不是模型总上下文阈值。beta header 取 i6o。

只有该 request 尝试后，HTTP 422/424 拒绝触发 `S → P → KKs`；`P:453` 把 `keepRecent=5` 传入。无 status、错误类型 `invalid_request_error` 的 streaming error 可在转 non-streaming fallback 时走同样逻辑。400不支持beta时禁用重试、返回原消息，不清；409/529会禁用控制器但不进行本地清理。该 controller 有一次性 `o` 状态，避免同次链中反复 fallback。

实际接线见 `chunk-wvsyb4fb.js:119647` 创建 controller、`:120407` buildRequestParams、`:122594` onRequestError 后 retry:context-hint、`:124213` onStreamFallback。

### 4.3 替换过程

`KKs` 对每个 candidate 依次 await persist。persist 使用 `H9` 保存结果，然后返回不带2000字预览的短引用（`chunk-2zjx6xpn.js:442`）：

```text
<persisted-output>Tool result saved to: .../tool-results/toolu_old.txt

Use Read to view</persisted-output>
```

保存失败则换为 `[Old tool result content cleared]`；如果候选 content含 image/document，`Aun:4435` 即使存在文件引用也使用这个清除标记（H9 本身也拒绝非纯text数组）。已持久化结果不会再次清。其他 user/assistant 内容与 tool_use 块保留，tool_result 的 tool_use_id、is_error 等字段保留，只改变 content。

例：适用调用 t1..t9，最近 t5..t9保护；t1..t4正文各24,000字符，约24,000 tokens，总 >=20k，四条一起写文件并替换；若各12,000字符则合计约12k，完全不应用 microcompact。若 t3 已有 persisted marker，则它不再计候选。

`hint_clears` 事件把 ids/contentById 从 API层传回主循环，见 `chunk-wvsyb4fb.js:121933`。主循环 `chunk-hkcbd84t.js:8080` 删除被清理 Read 对应 `readFileState` 项，再用 Aun 更新 H 并 yield 事件，允许后续重新读取已被移出的文件内容。

## 5. Idle 服务端 context edit：65分钟、保留12个

源 `chunk-pxqq6s5v.js:4482-4808`。

配置 `Nn:4492`：

```js
{minIdleSeconds:3900, keepToolUses:12, clearAtLeastTokens:20000,
 triggerToolUsesBelowCount:3, minTriggerToolUses:27}
```

`qKs:4507` 检查远程实验模式 `tengu_jiggly_blossom`（off/shadow/on/unknown）、querySource、模型 beta 支持，调用 `mr` 规划，不直接改 tool_result 内容。

`mr:4544` 找最后一次闲置断点：已有具 apiBlockIndex 的 assistant 之后，下一有效用户消息与此前最新有效时间戳间隔严格 >3,900,000ms，或传入当前请求时间满足条件。辅助请求可只看 fork prefix。忽略 meta/ephemeral/virtual/transcript-only/compact-summary/被interrupt的user等时间戳（`Dn:4767`），避免假用户/系统事件制造闲置。

它扫描 idle之前已完成、工具名适用、文本至少64字符或image/document的结果；有 untrusted marker 的结果会按工具名排除。batchToolUses 对应工具、GetTask、Poll及非适用工具加入 exclude_tools；服务端可识别 `mcp__container__` 前缀，客户端 keep-recent 那条则无此前缀处理。

设可清结果数 Me，`pe=Me-3`；仅当 `pe>12` 且 `pe>=27` 才规划，因此正常至少 Me=30。粗估准备清理 `se.slice(0, pe+1-12)` 的tokens，但源码并没有在客户端检查这个粗估必须>=20k；20k作为服务端 `clear_at_least` 条件传入，最终是否应用由服务端决定。

发送指令：

```json
{"context_management":{"edits":[{
 "type":"clear_tool_uses_20250919",
 "trigger":{"type":"tool_uses","value":"Me - 3"},
 "keep":{"type":"tool_uses","value":12},
 "clear_at_least":{"type":"input_tokens","value":20000},
 "exclude_tools":["GetTask","Poll","其他被排除工具"]
}]}}
```

`Ol:4669` 还有全局最近活动时间判断和对同一 idle 决策记忆；auxiliary 只有同一return时间已有正数清除记录才启动；shadow只计划埋点不发真正 edit；已清理后续请求会参考历史 applied_edits 保持行为。这些约束意味着“超过65分钟必清”是不正确表述。

接线：`chunk-wvsyb4fb.js:119996` qKs；`:120395` i5t 打包 edits（含thinking时另有clear_thinking_20251015 keep:all，不能解释为删除全部thinking）；`:120549` 需要额外 gate 与 beta 才带context_management；`:123602` YKs读取server报告。

服务端回应 `context_management.applied_edits` 中 `cleared_tool_uses` 和 `cleared_input_tokens` 是确认清除数量的依据，`YKs:4632` 只做状态追踪/埋点。客户端没有实现服务器究竟怎样清token/cache的内部算法，不能从此推断API服务器源代码已被还原。

## 6. 可直接实现的核心，与不可宣称的结论

可以从当前客户端代码复现：按字符/估算token计量、单结果落盘/preview、按assistant-id分组、最大fresh结果优先持久化、冻结旧结果、最近5个工具调用保护、最低20k批量清理、按idle规划服务端edit、更新readFileState。

未在上述范围证实：语义重要性评分、embedding相似度去重、对工具结果调用LLM生成摘要、LZ/gzip压缩结果再给模型、客户端精确tokenizer用于这些微清理阈值、服务端clear内部实现、这些gate在用户账号上当前为on、实际缓存命中/费用变化。这些不应补写成已经确认的事实。


配套主文：[上下文压缩算法详解](上下文压缩算法详解.md)。发行函数摘录：[索引](源码摘录/README.md)。
