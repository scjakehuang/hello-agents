# Claude Code 2.1.307：上下文压缩触发、预算和计数算法

这是发行包提取代码的静态分析。所有函数名保留包内混淆名称；`readable/` 行号基于本次 Prettier 排版，不代表 Anthropic 原工程行号。未执行 Claude Code，没有读取用户 Claude 凭据，也没有发模型请求。底稿 SHA256：`5b113a7752119470f1da419cb0e608af3361cae25b614216b13022093958fb2a`。

## 1. 先纠正“达到 80% 就压缩”的简化说法

这里至少有三个不同阈值：**后台摘要预计算、前台压缩、请求阻断**。80% 仅是预计算的默认预算比例；预计算又受默认关闭的远端开关控制。普通自动窗口在本地可转响应式路径，未必在估算到阈值时立即摘要。

核心源码：[预算及状态函数](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-wvsyb4fb.js:71030)、[预计算触发](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-wvsyb4fb.js:71370)、[实际自动压缩入口](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-wvsyb4fb.js:109506)。

## 2. 确切公式与判断顺序

令：

- `C = facts.contextWindow`：实际模型上下文窗口，来自 `oc(model) -> Om(model,betas)`。
- `M = facts.maxOutputTokens`：来自 `Ebt(model)`，会读取 `CLAUDE_CODE_MAX_OUTPUT_TOKENS`，按模型上限校验。
- `O = min(M, 20000)`：预留输出额度上限 20,000。
- `W = mb(facts, autoCompactWindow).window`：按配置、服务端数据、默认值等选择的自动压缩窗口，通常不大于 `C`。
- `B = W - O`：有效输入预算，源码 `VX()`。
- `B_real = C - O`：真实模型输入预算，源码 `aTr()`。
- `p`：`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`，`parseFloat` 结果且 `0 < p <= 100` 才生效。
- `f`：后台预计算缓冲比例，默认 `0.2`，允许远端覆盖。

公式：

```text
T_compact = B - 13000
如果 p 有效：T_compact = min(floor(B * p / 100), B - 13000)
T_precompute = min(B - round(B * f), T_compact)
T_block = B_real - 3000
如果 CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE 是有效正数：T_block = 该覆盖值
```

函数对应：`QQ` 71030、`BYe` 71037、`HYe` 71040、`VX` 71295、`aTr` 71301、`kSe` 71336、`Az` 71346，均在 [chunk-wvsyb4fb.js](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-wvsyb4fb.js:71030)。

`HYe(used,B,options,B_real)` 的顺序不可交换：

```js
const compactThreshold = T_compact;
const displayBudget = autoCompactEnabled ? compactThreshold : B;
const warnThreshold = displayBudget - 20000;
const pctLeft = Math.max(0, Math.round((displayBudget-used)/displayBudget*100));
if (used >= T_block) return { level: "blocked", pctLeft };
if (autoCompactEnabled && used >= compactThreshold) return { level: "compact", pctLeft };
if (used >= warnThreshold) return { level: "warn", pctLeft };
return { level: "ok" };
```

以上是忠于分支的可读伪代码。关闭自动压缩后仍有 `warn/blocked`，不会得到 `compact`。压缩窗口与真实窗口不同，阻断基于 `C`，并不跟着用户设小的 `W` 一起缩小。`lme()` 若收到显式预计算阈值快照，则使用快照里的 `effectiveWindow/enabled/threshold`，并忽略环境测试覆盖；普通调用没有这个参数。

### 静态计算示例（不是运行测量）

假设开关已允许预计算、无远端比例覆盖、无测试覆盖：

| C | M | W | O | B | 后台预计算阈值 f=0.2 | 前台压缩阈值 | 阻断阈值 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 200,000 | 32,000 | 200,000 | 20,000 | 180,000 | 144,000 | 167,000 | 177,000 |
| 1,000,000 | 32,000 | 1,000,000 | 20,000 | 980,000 | 784,000 | 967,000 | 977,000 |
| 200,000 | 8,192 | 200,000 | 8,192 | 191,808 | 153,446 | 178,808 | 188,808 |
| 200,000 | 32,000 | 100,000 | 20,000 | 80,000 | 64,000* | 67,000 | 177,000 |

`*` 最后一行虽公式得到 64k，但 `I5t()` 对显式/默认推导出非 `auto` 来源的窗口，要求 `W >= 200000`，否则不启动估算预计算；不能将公式结果当实际一定会启动。第一行启用 `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=20` 后，前台阈值变为 `min(36000,167000)=36000`，后台阈值也降至 36,000。`p=100` 仍最多为 167,000，13,000 缓冲不会被覆盖掉。第一行 warning 从 147,000 开始，显示的 pctLeft 此时约 12%，这里的百分比分母为 167,000，并非 200,000。

## 3. Token 不是全靠字符除以四

### 3.1 有 usage 时：真实计数作锚点，尾巴再估算

[chunk-wvsyb4fb.js `qf/PYe` 70603–70647](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-wvsyb4fb.js:70603)：

```text
若有最近一次有效 assistant API usage：
  anchorTokens = input + cacheCreationInput + cacheReadInput + output
  usedEstimate = anchorTokens + estimate(messages after anchor)
若没有有效 usage：
  usedEstimate = estimate(all messages)
若最近遇到 compact_boundary：
  anchorTokens=0，后续仅估算边界之后内容
```

同一 API message id 若被拆成多条 assistant 消息，`PYe()` 会向前扫描相同 id，把 anchorIndex 移到前面匹配项；随后 `qf()` 对该 anchorIndex 之后的消息做估算。这里记录实际索引处理，不把它擅自解释成一般意义的精确去重。`NH` 70500 左右过滤 synthetic model、isUnmetered 和指定 API 错误占位文本，不是任一 `usage` 都接受。

`_J()` 会规范化缺省项为 0；存在 `usage.iterations` 时，取最后一个非 `advisor_message/compaction`、且是有效 `message/fallback_message` 的迭代用量。`iO()` 再将输入三项加输出项求和。见 [chunk-pxqq6s5v.js 1717–1757](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-pxqq6s5v.js:1717)。这说明普通 API usage 也可能包含多迭代，不能直接对全局值机械累计。

实际 `_fr()` 触发前的计数为：

```text
used = qf(messages, facts.bytesPerToken)
       - snipTokensFreed
       + F1e(messages)
```

`F1e()` 从最新有效 assistant 的 `context_management.applied_edits` 累加 `clear_tool_uses_20250919.cleared_input_tokens`，遇到本地压缩边界返回 0；某些尚未结束、尚无 context_management 的响应会被跳过。源码 [70611](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-wvsyb4fb.js:70611)、[pxqq 1758](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-pxqq6s5v.js:1758)。这里明确为“加回”服务器清除的输入用量；不能误写成减号。主循环 blocker 使用 `qf-Pn`，后台估算 `Evo` 单独接收 `F1e`，不同检查点并非完全同一表达式。

### 3.2 无 usage/新增消息：廉价本地估算

[chunk-pxqq6s5v.js `Qc/s3/J9n` 3753–3810](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-pxqq6s5v.js:3753)：

- 普通字符串：`round(text.length / bytesPerToken)`。这里实际用 JavaScript UTF-16 `.length`，名字叫 bytesPerToken，并不是计算 UTF-8 字节，也不是运行 BPE tokenizer。
- `Bh(model)`：旧模型清单（Claude 3、Opus 至 4.6、Sonnet 至 4.6、Haiku 4.5 等）为 4，其他模型为 3；未给模型默认 4。见 [chunk-e853mz9g.js 16822–16847](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-e853mz9g.js:16822)。
- text document 若 title 后缀为 json/jsonl/jsonc 默认除以 2；其他文本文档默认 4。传入模型系数时采用 `min(modelFactor, extensionFactor)`。
- image 或不属于文本/内容形式的 document：每块固定估 2,000，不读取图片像素计算；嵌套 `tool_result.content` 递归。
- `tool_use`：`round((name + JSON.stringify(input ?? {})).length / factor)`。
- thinking/redacted_thinking：按正文/data 长度除系数；未知 block 按序列化后的整体估算。
- `Og/VLo` 遍历消息；attachment 先 `HGe()` 渲染为消息再估算，其他没有消息正文的类型可计 0。见 [wvsy 45651](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-wvsyb4fb.js:45651)。

另有 `XBe()` 使用真实 `beta.messages.countTokens` API，Bedrock 单独走 count API，某 gateway 501 情况再发 max_tokens=1 样本请求估计，见 [wvsy 45566](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-wvsyb4fb.js:45566)。但自动压缩 `_fr()->qf` 这条判定调用链用的是 usage+本地估算，**不能把 XBe 的存在写成每轮压缩都请求 countTokens**。

## 4. 窗口的来源、优先级和覆盖

`mb()` [71175](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-wvsyb4fb.js:71175) 的主优先级：

1. `CLAUDE_CODE_AUTO_COMPACT_WINDOW` 有效时优先，得到 `min(C, envValue)`，即使 agent definition 有 ceiling，环境变量也豁免该 ceiling。
2. 传入的会话/agent 配置为数值，或合并对象中的按模型配置/全局配置；非 `auto` 才生效，并 `min(C,value)`。
3. `lbo()` 自动来源：clientData `rowan_thicket`/模型元数据覆盖；匹配实验；禁用 1M/特定长上下文状态的模型默认；编译时模型默认；实际模型窗口低于 API 声称窗口的默认；模型原生长窗口默认；未知模型保护；最后返回 `source="auto"`。

Agent ceiling 结构 `mb({ceiling,inner})` 先递归 inner；若 inner 是 env 或已小于 ceiling 则保持，否则 `window=min(C,ceiling)` 并视作 settings。不能直接理解为 agent 配置永远最高优先级。

`d0t()` [71065](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-wvsyb4fb.js:71065) 自低到高合并 settings。每层若定义顶层 `autoCompactWindow`，会**替换此前累计的 byModel map**，只留下当前层的 byModel；若只定义 byModel，则增量覆盖。不是“所有按模型项永远盖过所有顶层项”。来源顺序：[chunk-y5y3ag3w.js 190](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-y5y3ag3w.js:190) 为 `userSettings -> projectSettings -> localSettings -> flagSettings -> policySettings`，实际 `Io()` 会按 enabledSources 过滤，flag/policy 总加入；`spn()` 还有路径去重和注入层，`R5t()` 还可在 userSettings 位置加入会话恢复的 `internal.auto_compact_windows`。

`CLAUDE_CODE_AUTO_COMPACT_WINDOW` 环境值解析范围是 **100,000–1,000,000**。`hSe/S5t` [70918](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-wvsyb4fb.js:70918)、[常量 e5qzzp9v 46](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-e5qzzp9v.js:46)：

- 支持 `k/K/m/M`，环境数值裸 `200` 按 200 token 处理，低于下限后**钳成 100,000**，不会理解为 200k。
- `/autocompact` 的 `xen()` 使用 bareThousands=true，100–1000 的裸数会乘 1000；相同文本在交互命令与环境变量中可能含义不同。
- 环境低于下限钳到 100k，高于上限钳到 1M；不可用值忽略。交互命令越界不沿用钳制，而只接受 in_range。
- 最终始终受实际模型 `C` 限制，模型窗口比 100k 小时实际 `W` 仍可低于 100k。

`C` 也不是一个永久固定数：`oc()` [44904](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-wvsyb4fb.js:44886) 调 `Om()` [e853 17416](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-e853mz9g.js:17416)，涉及模型能力、供应商、1M opt-in、能力声明/覆盖和 `CLAUDE_CODE_MAX_CONTEXT_TOKENS`。`M` 也由模型能力/客户端覆盖/环境变量决定。上面数值表因此必须写“假设”，不能宣称所有用户都是 167k。

## 5. 什么时间真正执行，和默认开关

### 5.1 主循环接入点

[chunk-hkcbd84t.js 7056–7082](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-hkcbd84t.js:7056)：主请求开始前获取当前模型 facts，调用 `P.autocompact(H,context,facts,cacheSafeParams,querySource,tracking,Pn,kvo)`，生产依赖 `P.autocompact=exr` 见 5989。循环顶压缩成功会替换 H 并刷新相应上下文（摘要与替换由主报告详述）。随后 7180 调 `Evo()` 判断后台预计算；流式响应 usage 到达后 8760 再用真实 usage 判断一次，触发 armTrigger=`api_response` 并记录估算误差。

### 5.2 自动阈值和响应式并存

`_fr()` [109429](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-wvsyb4fb.js:109429) 首先拒绝 compact 自身、四类 auxiliary query、特殊 deferred fork、关闭自动压缩；随后：

```js
if (tN() && !ame(facts,windowOption) && !explicitFallbackModel) return false;
```

`ame()` 检查窗口 source 是否非 `auto`。本地 `tN()` 默认 true，故纯 `auto` 来源一般跳过循环顶估算触发，后续由服务器实际 prompt-too-long 触发响应式压缩。`source != auto` 达 compact/blocked 后且 tN true，`exr()` 会直接走 `CWn()` 响应式压缩实现，trigger=`threshold`，所以“响应式实现”不一定表示已请求失败一次。remote 环境 `tN()` 需 `tengu_reactive_compact_remote`，默认 false，首次读取后 session latch。

主循环 blocker 还有绕行：`wi=ff()&&tN()`；`Mu=wi&&(!ame(...) || nBn(...))`，`Mu` 时不直接本地 blocked 返回，让请求进入实际 PTL 恢复。见 [hkcbd 7663](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-hkcbd84t.js:7663)。

### 5.3 关键默认值与来源

| 项 | 编译包默认 | 覆盖/条件 | 位置 |
|---|---|---|---|
| 自动压缩 | true | `DISABLE_COMPACT`、`DISABLE_AUTO_COMPACT` 禁用，或分层 `autoCompactEnabled` | ywba 2096–2102 |
| idleCompaction | true | 分层同名设置 | ywba 2103 |
| precomputeCompactionEnabled | true | 分层同名设置；这**不足以启用预计算** | ywba 2106 |
| `tengu_sepia_moth` | false | `k(flag,false)` 远端分配 | wvsy 110046 |
| 预计算启用总条件 | false（按后备值） | `ff && tN && sepia_moth && FIr()` | wvsy 110046–110051 |
| f=`tengu_amber_rokovoko` | 0.2 | 必须 finite 且 0<=f<1；无效回落0.2 | wvsy 71310 |
| 按窗口比例表 `tengu_amber_moleskin` | null | 精确窗口/默认行；分别 repl/sdk 比例，合法范围0<=x<1；表无效/无匹配回标量 | wvsy 71001–71029,71314–71333 |
| `tengu_reactive_compact_remote` | false | remote 特有，latch首值；本地无需此flag | ywba 2116–2132 |
| `tengu_woolly_forest` | true | 更大历史模型摘要尝试还要求 !H2 | ywba 2137 |
| `tengu_modular_seal` | false | prompt-too-long refusal 后追加压缩恢复分支开关 | hkcbd 4400,4494 |
| `tengu_tidy_origami` | false | 远端 side_question/extract_memories fork 可忽略测试百分比覆盖 | ywba 2166;wvsy 109446 |

`k()` 参数给的是打包默认/后备值，未读取当前用户服务端分配，因此不能断言所有用户 feature 实际值与后备值相同。`Ms()` [vxra354r 32](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-vxra354r.js:32) 按 enabled settings 从高到低取值，部分老配置项再退 legacy global config，最后使用传入默认。环境布尔变量由统一 env schema 解析，不能直接当作任意非空字符串一律生效。

## 6. 边界与不能压缩解决的情形

- `hfr()` [109393](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-wvsyb4fb.js:109393)：估计固定前缀 `max(0,lastInputUsage - snipFreed - Og(messages))`；超过压缩阈值说明系统提示/工具等固定前缀过大，会记录 `tengu_auto_compact_prefix_overflow`。这段**只记录**，没有直接 return，中断/后续失败由下游决定。
- `Al()` [hkcbd 4420](/Users/tcuser/Downloads/claude-code-rea-20261022/readable/chunk-hkcbd84t.js:4420) 可从 PTL 错误拿实际 total/limit，计算 `roomAfterPrefix = limit - (actual - messageEstimate)`；小于 20,000 判 futile，不追加该 refusal 恢复尝试。正则 `h8e` 只识别 `prompt is too long ... N tokens > M`，无法解析时 actual/limit 为 undefined。
- 自动压缩连续失败 3 次开会话熔断；连续 3 次在上次压缩后少于3轮又填满，则 rapid-refill breaker。见 wvsy `Ocn`109365、`lTr`71380；主循环 rapid-refill 返回用户错误，不无限摘要。
- 已有后台摘要并非不检查就替换：`kvo -> bvo -> C4r` 检查覆盖一致性及拟合大小，`Ncn()` 提供当前阈值、liveTokens、summary和sizeOf；不匹配/would_not_fit 可拒绝消费。

## 7. 仍应明确保留的未解点

1. 当前账号实际远端 flag、clientData、模型能力数据均未采样；以上是包内算法和后备值。
2. `C/M` 模型能力整个配置链较大，本笔记已追到 `Om/Ebt`，未为每个供应商/模型生成一张声称完整的数值表。
3. 字符估算与真实 tokenizer 差异取决于语言、代码和内容结构，本次没有模型请求，因此不存在实测误差率或实测压缩率。
4. 预计算/响应式不同恢复路径还有“如何选历史组、如何生成摘要、如何保留尾部与工具配对、失败递归”问题，需要与主报告的摘要算法章节合读；此笔记只负责触发与预算，不能取代完整压缩算法。


配套主文：[上下文压缩算法详解](上下文压缩算法详解.md)。发行函数摘录：[索引](源码摘录/README.md)。
