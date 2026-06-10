## Claude Code CLI Harness Engineering 实现分析

> 分析日期：2026-05-09 | 基于 `claude-code-analysis/src/` 源碼深入分析

---

### 一、什么是 Harness Engineering

**Harness（编排层）** 是 Claude Code 的核心基础设施，位于用户界面（CLI TUI / IDE / Agent SDK）与 Anthropic API 之间的编排与控制系统。

关键认知：**Claude Code 的价值核心不是 LLM 本身，而是这个 Harness 层。** 同一个 Harness 同时驱动 CLI、IDE 扩展、桌面应用、Web 应用和 Agent SDK。TypeScript SDK 直接打包原生二进制（`@anthropic-ai/claude-agent-sdk`），Python SDK 通过子进程协议通信。

---

### 二、整体进程架构

```
+------------------------------------------------------------------+
|                    Claude Code Process（单进程）                    |
|                                                                  |
|  +------------------+     +------------------+                   |
|  |   Terminal UI     |     |   Agent SDK      |                  |
|  |   (Ink/React TUI) |     |   (SDK library)  |                  |
|  +--------+---------+     +--------+---------+                   |
|           |                        |                             |
|           v                        v                             |
|  +----------------------------------------------------------+   |
|  |                   HARNESS LAYER                           |   |
|  |                                                          |   |
|  |  query.ts         ─ Agent Loop 主循环（1730行）            |   |
|  |  QueryEngine.ts   ─ SDK/Headless 包装器（1100+行）        |   |
|  |  Tool.ts          ─ 工具基类接口（695行）                  |   |
|  |  hooks.ts         ─ Hook 核心引擎（~5000行）               |   |
|  |  permissions.ts   ─ 权限检查管道                           |   |
|  |  MCP client.ts    ─ MCP 连接管理 + 工具发现                |   |
|  |  compact.ts       ─ 上下文压缩引擎                         |   |
|  |  sessionStorage   ─ JSONL 持久化                          |   |
|  |  LocalAgentTask   ─ 子代理生命周期                         |   |
|  +----------------------------------------------------------+   |
|           |                                                     |
|           v                                                     |
|  +----------------------------------------------------------+   |
|  |  Anthropic API Client（Messages API, streaming, caching）  |   |
|  +----------------------------------------------------------+   |
+------------------------------------------------------------------+
```

---

### 三、Agent Loop 深度分析

Agent Loop 是整个 Harness 的心脏，实现在 `query.ts` 的 `queryLoop()` 函数（line 241-1729）中，采用 `async function*` 生成器模式。

#### 3.1 核心数据结构

**QueryParams** (line 181-199)：
```typescript
type QueryParams = {
  messages: Message[];
  systemPrompt: string | string[];
  userContext: string | string[];
  systemContext: string | string[];
  canUseTool: CanUseTool;
  toolUseContext: ToolUseContext;
  fallbackModel?: Model;
  querySource: 'repl' | 'agent' | ...;
  maxOutputTokensOverride?: number;
  maxTurns?: number;
  skipCacheWrite?: boolean;
  taskBudget?: TaskBudget;
};
```

**State** (line 204-217) — 跨迭代可变状态：
```typescript
type State = {
  messages: Message[];
  toolUseContext: ToolUseContext;
  autoCompactTracking: AutoCompactTracking | undefined;
  maxOutputTokensRecoveryCount: number;
  hasAttemptedReactiveCompact: boolean;
  maxOutputTokensOverride?: number;
  pendingToolUseSummary: ToolUseSummary | undefined;
  stopHookActive: boolean;
  turnCount: number;
  transition?: Transition;
};
```

#### 3.2 主循环详细流程

`queryLoop()` 是一个 `while (true)` 循环（line 307），每次迭代分为 5 个阶段：

**阶段 1：消息准备与上下文检查** (lines 307-648)

1. **消息准备管道** (lines 365-447)，逐层应用 5 种处理：
   - `getMessagesAfterCompactBoundary()` — 截断压缩边界前的历史
   - `applyToolResultBudget()` — 对单条消息的工具结果大小施加预算限制
   - `snipCompactIfNeeded()` — 历史截断（HISTORY_SNIP 功能）
   - `microcompact()` — 缓存感知的消息压缩，减少重复内容
   - `applyCollapsesIfNeeded()` — 上下文折叠投影（CONTEXT_COLLAPSE）

2. **自动压缩** (line 453-543)：`deps.autocompact()` 检查 token 门槛，触发后产出 compact boundary 消息，重置跟踪状态

3. **硬限制检查** (line 628-648)：若未自动压缩且 token 超限，产出 `blocking_limit` 错误并终止

**阶段 2：API 流式调用** (lines 650-954)

1. **模型解析** (line 572-578)：`getRuntimeMainLoopModel()` 根据权限模式和上下文大小选择模型
2. **流式循环** (line 659-863)：`for await (const message of deps.callModel({...}))`
   - 检查是否为可恢复错误（prompt-too-long、max-output-tokens、media-size），暂扣不立即抛出
   - 解析 `tool_use` 块，设置 `needsFollowUp = true`
   - 将 tool_use 块喂给 `StreamingToolExecutor` 实现边流边执行
3. **Fallback 外层循环** (line 657-953)：API 失败时自动切换到 fallback 模型重试

**阶段 3：无 Tool Call 时的恢复路径** (lines 998-1358)

仅在 `needsFollowUp === false` 时进入，处理 5 种恢复场景：
1. **Prompt-too-long 恢复**：collapse drain → reactive compact 逐级尝试
2. **Max output tokens 恢复**：升级 max tokens（8K→64K）→ 多轮恢复（最多 3 次，注入续写元消息）
3. **Stop hooks**：`yield* handleStopHooks()` 运行 PostSampling/Stop/TeammateIdle/TaskCompleted hooks
4. **Token budget 检查**：基于收益递减模型决定继续（注入 nudging 消息）还是停止

**阶段 4：工具执行** (lines 1360-1409)

`needsFollowUp === true` 时进入：
- `streamingToolExecutor.getRemainingResults()` 获取流式执行剩余结果
- 或 `runTools()` 批量模式
- 每个 tool result 产出给消费者，收集到 `toolResults` 数组
- 更新 `toolUseContext`（工具调用追踪 + 文件状态缓存）

**阶段 5：继续下一轮** (lines 1411-1728)

1. **Tool use summary** (line 1412-1482)：fire-and-forget 用 Haiku 生成摘要
2. **Abort 处理** (line 1485-1516)
3. **命令队列排水** (line 1547-1643)：`getCommandsByMaxPriority()` 产出优先级最高的挂起命令
4. **Memory prefetch** (line 1599-1614)：消费预取结果
5. **MCP tool refresh** (line 1660-1671)：刷新新连接的 MCP 服务器工具
6. **Max turns 检查** (line 1705-1712)
7. **构造新 State** (line 1714-1727)：
```typescript
state = {
  messages: [...messagesForQuery, ...assistantMessages, ...toolResults],
  transition: { reason: 'next_turn' },
  // ... 其他字段
};
continue;
```

#### 3.3 QueryEngine：SDK 包装器

`QueryEngine.ts` (line 184+) 是对 `query()` 的 SDK 级封装，核心是 `submitMessage()` 方法 (line 209-1100+)：

1. **权限包装** (line 244-271)：包裹 `canUseTool` 追踪 `permissionDenials`
2. **系统 prompt 组装** (line 284-325)：`fetchSystemPromptParts()` 获取 default/user/system context、CUSTOM_SYSTEM_PROMPT、MEMORY_MECHANICS_PROMPT
3. **用户输入处理** (line 335-428)：调用 `processUserInput()` 处理斜杠命令、附件生成、工具 allowlisting
4. **转录持久化** (line 450-463)：用户消息写入 JSONL
5. **System init message** (line 540-551)：产出 `buildSystemInitMessage()` 含 tools/mcp/model/permission/commands/agents/skills
6. **Query loop** (line 675-1049)：`for await (const message of query({...}))` 消费生成器，归一化为 `SDKMessage`，追踪使用量、预算和重试
7. **Result** (line 1058+)：`isResultSuccessful()` 验证后产出 `result` 消息，含 duration/cost/usage/permissionDenials

#### 3.4 关键架构模式

| 模式 | 说明 |
|------|------|
| **生成器流式模式** | `query()` 和 `submitMessage()` 都是 `async function*`，让 REPL/SDK 增量渲染而非缓冲完整响应 |
| **continue site 状态机** | `while(true)` 用显式 `state = next; continue` 而非递归，每个 continue 记录 `transition.reason`（next_turn/reactive_compact_retry/max_output_tokens_recovery 等） |
| **错误暂扣模式** | 可恢复错误在流式期间暂扣，恢复路径穷尽后才产出，防止 SDK 消费者在瞬态错误上终止 |
| **依赖注入** | `QueryDeps` 注入 `callModel`/`microcompact`/`autocompact`/`uuid`，支持测试 mock |
| **Feature flags** | 通过 `bun:bundle` 做死代码消除，门控代码（HISTORY_SNIP/CONTEXT_COLLAPSE/TOKEN_BUDGET/KAIROS）在外部构建中编译掉 |
| **流式工具执行** | `StreamingToolExecutor` 让工具在 tool_use 块到达立即开始执行，并发安全工具并行运行，非并发工具串行化 |

---

### 四、Tool Registry 深度分析

#### 4.1 工具基类接口

实现在 `Tool.ts` (line 362-695)，每个工具必须实现 `Tool<Input, Output, P>` 接口：

```typescript
type Tool<Input, Output, P> = {
  name: string;
  aliases?: string[];
  searchHint?: string;
  call(args, context, canUseTool, parentMessage, onProgress?): Promise<ToolResult<Output>>;
  description(input, options): Promise<string>;
  inputSchema: Input;
  inputJSONSchema?: ToolInputJSONSchema;
  outputSchema?: z.ZodType;
  isEnabled(): boolean;
  isConcurrencySafe(input): boolean;   // fail-closed: 默认 false
  isReadOnly(input): boolean;          // fail-closed: 默认 false
  isDestructive?(input): boolean;
  checkPermissions(input, context): Promise<PermissionResult>;
  validateInput?(input, context): Promise<ValidationResult>;
  prompt(options): Promise<string>;          // 工具在系统 prompt 中的描述
  userFacingName(input): string;             // 用户可见的工具动作描述
  maxResultSizeChars: number;
  mcpInfo?: { serverName: string; toolName: string };
  isMcp?: boolean;
  shouldDefer?: boolean;
  alwaysLoad?: boolean;
  // + 渲染方法: renderToolUse, renderToolResult, renderToolErrorMessage 等
};
```

**TOOL_DEFAULTS** (line 793-)：
```typescript
const TOOL_DEFAULTS = {
  isEnabled: () => true,
  isConcurrencySafe: () => false,   // 工具默认不可并发
  isReadOnly: () => false,          // 工具默认可写
  checkPermissions: () => Promise.resolve({ behavior: 'allow' }),
};
```

所有工具通过 `buildTool(def)` 工厂创建，合并 `TOOL_DEFAULTS` 和自定义定义。

#### 4.2 工具注册表

`tools.ts` 中 `getAllBaseTools()` (line 193-251) 返回全量工具列表：
- **始终可用**：AgentTool, BashTool, FileReadTool, FileEditTool, FileWriteTool, WebFetchTool, WebSearchTool, SkillTool 等
- **feature gate 条件加载**：REPLTool (ant-only), SleepTool (PROACTIVE/KAIROS), cronTools (AGENT_TRIGGERS), RemoteTriggerTool, MonitorTool, PowerShellTool, WorkflowTool 等

`assembleToolPool(permissionContext, mcpTools)` (line 345-367) 将内置工具与 MCP 工具合并，内置工具优先（重名时内置工具胜出），排序以保证 prompt-cache 稳定性。

#### 4.3 工具执行管道

```
API 返回 tool_use 块
        │
        v
Step A: 输入验证 tool.validateInput(input, context)
        → 失败：拒绝并返回错误消息给模型
        │
        v
Step B: 权限检查 hasPermissionsToUseTool() （详见第六节）
        │
        v
Step C: PreToolUse Hooks → executePreToolHooks()
        → 可阻止、修改输入（updatedInput）、注入上下文
        │
        v
Step D: 工具执行 tool.call(args, context, ...)
        → ToolResult = { data, newMessages, contextModifier, mcpMeta }
        │
        v
Step E: PostToolUse/PostToolUseFailure Hooks → executePostToolHooks()
        → 可修改 MCP 工具输出（updatedMCPToolOutput）
        │
        v
Step F: 结果格式化 → tool.mapToolResultToToolResultBlockParam()
        → 超大结果（>maxResultSizeChars）持久化到磁盘，仅返回预览
```

#### 4.4 ToolUseContext

`ToolUseContext` 为工具提供完整的执行环境：
- `abortController: AbortController` — 中断信号
- `fileStateCache: FileStateCache` — 所有 Read/Write/Edit 操作维护的跟踪状态
- `getAppState() / setAppState()` — AppState store 访问器
- `messages: Message[]` — 当前会话的所有消息
- `toolUseID: string` — 触发工具的 tool_use id
- hook 基础设施 — PreToolUse/PostToolUse 回调

---

### 五、MCP 集成深度分析

#### 5.1 服务器连接层

实现在 `services/mcp/client.ts`，支持 8 种传输类型：

| Transport | 类型 | 连接机制 |
|-----------|------|----------|
| **stdio** | 默认 | `StdioClientTransport` — 子进程 spawn，环境变量合并（`subprocessEnv()`） |
| **SSE** | `"sse"` | `SSEClientTransport` — HTTP 长连接事件流，EventSource 独立 fetch |
| **HTTP** | `"http"` | `StreamableHTTPClientTransport` — MCP Streamable HTTP |
| **SSE-IDE** | `"sse-ide"` | IDE 扩展桥接 |
| **WebSocket-IDE** | `"ws-ide"` | IDE 扩展桥接 |
| **WebSocket** | `"ws"` | Bun/Node ws 客户端，TLS/代理支持 |
| **SDK** | `"sdk"` | 进程内 SDK 控制传输 |
| **claudeai-proxy** | `"claudeai-proxy"` | 通过 Anthropic 代理路由，OAuth bearer token |

**内联传输（In-Process Transport）**：`InProcessTransport.ts` 中 `createLinkedTransportPair()` 创建两个互相连接的传输对，`send()` 通过 `queueMicrotask` 投递到对方的 `onmessage`。用于 Chrome MCP 和 Computer Use MCP 避免 ~325MB 的子进程开销。

#### 5.2 连接初始化流程

**`connectToServer()`** (line 595)，核心 memoized 函数：

1. **创建 Auth Provider** (`ClaudeAuthProvider`，见 5.3)
2. **构建传输**：
   - SSE：`ClaudeAuthProvider` → 获取合并 headers → fetch 超时包装 → SSEClientTransport
   - HTTP：同样 auth 流程，OAuth 令牌后决定是否附加 session ingress token
   - stdio：StdioClientTransport + subprocessEnv() + 服务器自定义 env
3. **创建 MCP Client** (line 985)：
```typescript
new Client(
  { name: 'claude-code', title: 'Claude Code', version: MACRO.VERSION },
  { capabilities: { roots: {}, elicitation: {} } }
)
```
4. **注册 roots handler** (line 1009)：返回 `file://${getOriginalCwd()}`
5. **超时连接** (line 1048)：`Promise.race([client.connect(transport), timeoutPromise])`，默认 30s
6. **错误处理**：`UnauthorizedError` → `type: 'needs-auth'`；其他 → `type: 'failed'`

#### 5.3 MCP OAuth 认证

`services/mcp/auth.ts` (88KB)，实现 `ClaudeAuthProvider`：

- **`tokens()`**：从 macOS Keychain 读取，支持 XAA 静默交换、主动刷新（到期前 5 分钟）、Step-up 处理
- **`saveTokens()`**：持久化到 Keychain
- **`performMCPOAuthFlow()`**：完整 OAuth 2.0 交互流程（清除 token → 发现 auth server 元数据 → PKCE → 浏览器授权）
- **Token 存储**：Keychain 访问使用 `getSecureStorage()`，key 为 `{serverName}|{sha256(configJson).hex(16)}`

#### 5.4 工具发现与调用

**`fetchToolsForClient()`** (line 1743)，LRU memoized：

1. 调用 `client.request({ method: 'tools/list' }, ListToolsResultSchema)`
2. Unicode 净化：`recursivelySanitizeUnicode(result.tools)`
3. 每个 MCP 工具包装为 `Tool` 对象：
   - `name`: `mcp__<server>__<tool>`（完整前缀）或跳过前缀模式
   - `mcpInfo`: `{ serverName, toolName }`
   - `isMcp: true`
   - `isConcurrencySafe`: 从 `annotations.readOnlyHint` 推导
   - `isReadOnly` / `isDestructive`：从 annotations 推导
   - `inputJSONSchema`：原始 JSON Schema（非 Zod）
   - `call()` → `callMCPToolWithUrlElicitationRetry()`

**`callMCPTool()`** (line 3029)：
1. 30s 进度日志间隔
2. 超时设置（可配 `MCP_TOOL_TIMEOUT`，默认 ~27.8 小时）
3. `client.callTool({ name, arguments, _meta }, CallToolResultSchema, { signal, timeout, onprogress })`
4. 处理二进制内容（图片缩放/下采样）、`isError` 结果 → `McpToolCallError`
5. 401 → `McpAuthError`，session 过期 (404/-32001) → `McpSessionExpiredError`
6. URL elicitation 重试（最多 3 次，`UrlElicitationRequired` 错误 code -32042）

#### 5.5 断线恢复

`useManageMCPConnections.ts` (line 333)：
- SSE transport close → 检查是否服务器被禁用（跳过）或指数退避重连（最多 5 次，1s-30s）
- 关闭处理器注册 → 会话结束时清理所有 MCP 连接

---

### 六、权限系统深度分析

实现在 `utils/permissions/permissions.ts`。

#### 6.1 权限规则

```typescript
type PermissionRule = {
  source: PermissionRuleSource;
  ruleBehavior: 'allow' | 'deny' | 'ask';
  ruleValue: { toolName: string; ruleContent?: string };
};
```

规则按 source 分成 3 个 Map：`alwaysAllowRules`，`alwaysDenyRules`，`alwaysAskRules`。

MCP 工具匹配全限定名 `mcp__<server>__<tool>`。服务器级规则 `mcp__server1` 匹配该服务器的所有工具。

#### 6.2 完整检查流程

`hasPermissionsToUseToolInner()` (line 1158)：

**第一层：规则检查（不可绕过）**

```
Step 1a: getDenyRuleForTool() → 工具整体被 deny 规则匹配
        → 立即返回 deny

Step 1b: getAskRuleForTool() → 工具整体有 ask 规则
        → 返回 ask（Bash 沙箱自动排除）

Step 1c: tool.checkPermissions(parsedInput, context) → 工具自身的权限检查

Step 1d: 工具返回 deny → 立即返回 deny

Step 1e: tool.requiresUserInteraction 为 true 且当前行为是 ask
        → 返回 ask（免疫 bypass）

Step 1f: 内容相关的 ask 规则（如 "Bash(npm publish:*)"）
        → 返回 ask（免疫 bypass）

Step 1g: 安全检查（.git/.claude/.vscode/shell configs 操作）
        → 返回 ask（免疫 bypass）
```

**第二层：模式检查**

```
Step 2a: mode === 'bypassPermissions' 或 plan mode with bypass
        → 返回 allow

Step 2b: toolAlwaysAllowedRule() → 工具在 allow 列表
        → 返回 allow
```

**第三层：Fallthrough**

```
Step 3: passthrough 转为 ask → 返回 ask
```

#### 6.3 权限模式

| 模式 | 行为 |
|------|------|
| `default` | 标准：新工具需确认，已授权工具自动批准 |
| `acceptEdits` | 自动批准文件编辑和已有 allow 规则的工具 |
| `plan` | 只读：仅 Read/Grep/Glob 可用 |
| `dontAsk` | `ask` 转换为 `deny`+`DONT_ASK_REJECT_MESSAGE` |
| `auto` | TRANSCRIPT_CLASSIFIER：AI 分类器判定（fast-paths：acceptEdits 预检查 + 安全工具白名单） |
| `bypassPermissions` | 跳过所有检查 |

#### 6.4 Denial 限制

```typescript
const DENIAL_LIMITS = {
  maxConsecutive: 3,   // 连续拒绝上限
  maxTotal: 20,        // 会话总拒绝上限
};
```

超限后：交互模式 → 回退到询问用户；headless 模式 → 抛出 `AbortError`。

---

### 七、Hook System 深度分析

#### 7.1 核心文件架构

| 文件 | 职责 |
|------|------|
| `src/utils/hooks.ts` | **核心引擎** (~5000行)：执行、匹配、JSON 解析、退出码语义、所有 `execute*Hooks` 入口 |
| `src/types/hooks.ts` | 类型定义：Zod schema（`HookJSONOutput`, `SyncHookJSONOutput`, `AsyncHookJSONOutput`） |
| `src/utils/hooks/hooksConfigManager.ts` | 事件元数据：`getHookEventMetadata`（事件描述、matcher 字段、退出码语义） |
| `src/utils/hooks/hooksConfigSnapshot.ts` | 配置快照：`captureHooksConfigSnapshot` — 合并 user/project/local/policy 源 |
| `src/utils/hooks/hooksSettings.ts` | 配置读取：`getAllHooks`, `getHooksForEvent`, `sortMatchersByPriority` |
| `src/utils/hooks/sessionHooks.ts` | 会话作用域 hooks：`addSessionHook`, `addFunctionHook`, `clearSessionHooks` |
| `src/utils/hooks/execCommandHook.ts` | Shell 命令 hooks |
| `src/utils/hooks/execPromptHook.ts` | LLM prompt hooks（单轮 Haiku 调用，JSON schema 强制） |
| `src/utils/hooks/execAgentHook.ts` | LLM agent hooks（多轮 query loop + SyntheticOutputTool） |
| `src/utils/hooks/execHttpHook.ts` | HTTP POST hooks（SSRF guard，sandbox proxy 路由） |
| `src/services/tools/toolHooks.ts` | 工具 hook 集成：`runPreToolUseHooks`/`runPostToolUseHooks`/`resolveHookPermissionDecision` |
| `src/query/stopHooks.ts` | Stop hook 编排：`handleStopHooks` — 聚合 blocking errors + TeammateIdle/TaskCompleted |

#### 7.2 Hook 事件匹配

- **Matcher 过滤**：每个事件类型有 `matchQuery` 字段（PreToolUse → `tool_name`，SessionStart → `source`，Notification → `notification_type`，StopFailure → `error` type 等）
- **Pattern 匹配**：`matchesPattern(matchQuery, matcher.matcher)` — 管道分隔的 glob 模式（`"Bash|Write"`）
- **无 matcher 的 hooks** 总是触发（Stop, UserPromptSubmit 等）

#### 7.3 执行管道

```
Event Trigger → getMatchingHooks() → 配置合并 + matcher 过滤
        │
        v
executeHooks() ← async generator
        │
        ├── Guard checks: disableAllHooks / CLAUDE_CODE_SIMPLE / workspace trust
        ├── Fast path: 若全是 callback hooks → 同步批量执行
        │
        ├── 所有 hooks 并行执行 (all() combinator):
        │   ├── callback → executeHookCallback(timeout)
        │   ├── function → executeFunctionHook(messages)
        │   ├── prompt → execPromptHook() [Haiku + JSON schema]
        │   ├── agent → execAgentHook() [multi-turn query loop]
        │   ├── http → execHttpHook() [axios POST + SSRF guard]
        │   └── command → execCommandHook() [shell spawn]
        │       ├── 第一行 stdout = {"async":true} → executeInBackground()
        │       └── 同步路径: 等待退出
        │
        v
对每个 hook 结果:
  parseHookOutput() → stdout 以 { 开头 → JSON → 验证 → processHookJSONOutput()
                    → 纯文本 → 作为原始 sysmessage

  exit code 0  → 成功 (stdout → JSON 控制 或 纯文本 → sysmessage)
  exit code 2  → blocking error (stderr → 模型)
  exit code 1,3-255 → non-blocking error (stderr → 用户)

  JSON 字段映射:
    decision: "block"        → permissionBehavior: "deny" + blockingError
    decision: "approve"      → permissionBehavior: "allow"
    continue: false          → preventContinuation: true
    hookSpecificOutput.updatedInput         → 修改工具输入
    hookSpecificOutput.additionalContext    → 注入模型上下文
    hookSpecificOutput.permissionDecision   → deny > ask > allow 优先级
    hookSpecificOutput.initialUserMessage   → 替换首条用户消息 (SessionStart)
    hookSpecificOutput.watchPaths           → 注册文件监听 (SessionStart/CwdChanged)
    hookSpecificOutput.updatedMCPToolOutput → 替换 MCP 工具响应 (PostToolUse)
```

#### 7.4 退出码语义（事件相关）

| 事件 | exit 0 | exit 2 | 其他 |
|------|--------|--------|------|
| **PreToolUse** | 静默 | 阻塞工具 (stderr→模型) | stderr→用户，继续 |
| **PostToolUse** | stdout→transcript | stderr→模型 | stderr→用户 |
| **Stop** | 静默 | stderr→模型 + 继续对话 | stderr→用户 |
| **UserPromptSubmit** | stdout→Claude | 阻塞+擦除提示 (stderr→用户) | stderr→用户 |
| **PreCompact** | stdout→自定义 compact 指令 | 阻止压缩 | stderr→用户，继续 |
| **SessionStart** | stdout→Claude | 忽略阻塞错误 | stderr→用户 |
| **StopFailure** | fire-and-forget | fire-and-forget | fire-and-forget |

#### 7.5 Stop Hook 自治循环实现

```
用户: /ralph-loop "完成任务 X" --max-iterations 50
  │
  v
Claude 执行任务 → 尝试退出
  │
  v
Stop Hook 触发:
  - 检查 Claude 是否输出 <promise>COMPLETE</promise>
  - 检查是否已达 max-iterations
  │
  +-- 是 → 允许退出，循环结束
  +-- 否 → exit code 2 → stderr → 模型看到阻塞消息 → 继续执行
```

#### 7.6 异步 Hook 生命周期

1. Hook 首行 stdout 输出 `{"async": true, "asyncTimeout": 15000}`
2. 进程进入后台 `executeInBackground()` → `registerPendingAsyncHook()`
3. `AsyncHookRegistry` 存储 hook（shell command + timeout + progress 间隔）
4. 周期性调用 `checkForAsyncHookResponses()` — 完成时解析 stdout 找同步 JSON 响应
5. 完成：`finalizeHook()` 发出响应事件，清理 shell command
6. `asyncRewake` 变体：绕过注册表，exit code 2 时入队 task-notification 唤醒模型

---

### 八、上下文窗口管理深度分析

#### 8.1 窗口分级

- **默认**：200,000 tokens（`MODEL_CONTEXT_WINDOW_DEFAULT`）
- **1M 上下文**：sonnet-4/opus-4-6 可通过 beta header 或实验 treatment 获得
- **覆盖**：`CLAUDE_CODE_MAX_CONTEXT_TOKENS` env var（ant-only）/ `CLAUDE_CODE_DISABLE_1M_CONTEXT`（HIPAA 合规）

#### 8.2 自动压缩引擎

`services/compact/autoCompact.ts`：

- **有效窗口** = context window - reserved output tokens（min 为模型引用输出和 20,000）
- **自动压缩阈值** = 有效窗口 - `AUTOCOMPACT_BUFFER_TOKENS`（13,000）
- **警告阈值** = 有效窗口 - 20,000
- **断路器**：`MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`

#### 8.3 压缩流程

`services/compact/compact.ts` 的 `compactConversation()`：

1. **PreCompact hooks** — 获取自定义 compact 指令
2. **Strip images** — 从消息中剥离图片后送摘要
3. **Forked agent** — `runForkedAgent` 生成摘要，复用主对话 prompt cache
4. **PTL retries** — 丢弃最旧 API-round 组后重试，最多 `MAX_PTL_RETRIES` (3) 次
5. **Post-compact 注入** — 重新注入 CLAUDE.md + skills + 工具搜索结果 + MCP 指令
6. **Token 预算**：`POST_COMPACT_TOKEN_BUDGET = 50,000`，`POST_COMPACT_MAX_TOKENS_PER_FILE = 5,000`，`POST_COMPACT_SKILLS_TOKEN_BUDGET = 25,000`

#### 8.4 输出 Token 管理

- 默认请求 max output：模型相关（32K sonnet-4-6，64K opus-4-6）
- **Capped 默认**：`CAPPED_DEFAULT_MAX_TOKENS = 8,000`（优化 slot-reservation）
- **Escalated**：`ESCALATED_MAX_TOKENS = 64,000`（命中上限后重试一次）

---

### 九、会话管理深度分析

#### 9.1 转录持久化

**存储位置**：`{claudeConfigHome}/projects/{sanitizedCwd}/{sessionId}.jsonl`
其中 `sanitizedCwd` = `-` + 绝对路径（`/` 替换为 `-`）

**JSONL Entry Types**（`types/logs.ts`）：

| Type | 内容 |
|------|------|
| `user` | 用户消息（`parentUuid` 链） |
| `assistant` | 助手响应（`parentUuid`, `message.content`） |
| `system` | 系统消息（compact boundary 等） |
| `attachment` | 文件附件 |
| `summary` | 会话摘要（用于压缩恢复） |
| `custom-title` | 会话标题 |
| `tag` | 会话 tag |
| `agent-name` / `agent-color` / `agent-setting` | Agent 元数据 |
| `mode` | 会话模式（coordinator/normal） |
| `worktree-state` | Worktree 状态 |
| `file-history-snapshot` | 文件历史快照 |
| `context-collapse-commit` / `context-collapse-snapshot` | 压缩恢复标记 |

**消息链**：`uuid` + `parentUuid` 形成树结构。`isTranscriptMessage()` 定义参与类型（user/assistant/attachment/system），progress messages 排除。

**写入**：`insertMessageChain()` 分配 UUID/parentUuid → `appendToTranscript()`（`fsAppendFile` 单行 JSON）

**读取** (`loadTranscriptFile`, line 3472)：
1. 大文件（> `SKIP_PRECOMPACT_THRESHOLD`）→ `readTranscriptForLoad()` 跳过压缩前内容
2. 恢复 pre-boundary 元数据（agent settings、modes、PR links）→ `scanPreBoundaryMetadata()`
3. `parseJSONL<Entry>()` 解析剩余内容
4. 返回 20+ 个 maps：messages/summaries/titles/tags/agent 信息/worktree 状态/snapshots 等

#### 9.2 会话恢复

`claude -c` 恢复最新，`claude -r <name>` 恢复命名，`claude --fork-session` 分支创建。

恢复流程 (`commands/resume/`)：
1. 列表 `{claudeConfigHome}/projects/{sanitizedCwd}/` 下的可用会话
2. 选择 → `switchSession(sessionId, projectDir)`
3. `loadTranscriptFile()` 重建消息链
4. `matchSessionMode()` 确保 coordinator/normal 模式对齐
5. `setCostStateForRestore()` 恢复成本状态
6. 读取 Agent `.meta.json` sidecar 恢复 agent type + worktree path

---

### 十、Subagent Architecture 深度分析

#### 10.1 Task 注册表

`tasks.ts` (line 22)：
```typescript
[LocalShellTask, LocalAgentTask, RemoteAgentTask, DreamTask]
// + LocalWorkflowTask (feature gated)
// + MonitorMcpTask (feature gated)
```

#### 10.2 LocalAgentTask 状态

```typescript
type LocalAgentTaskState = {
  type: 'local_agent';
  agentId: string;
  prompt: string;
  selectedAgent?: AgentDefinition;
  agentType: string;        // 'worker', 'general-purpose', etc.
  model?: string;
  abortController?: AbortController;
  result?: AgentToolResult;
  progress?: AgentProgress;
  messages?: Message[];
  isBackgrounded: boolean;
  pendingMessages: string[];  // SendMessage tool 队列
  retain: boolean;            // UI 保持
  diskLoaded: boolean;        // sidechain JSONL 加载完成
  evictAfter?: number;        // GC 截止时间
};
```

#### 10.3 子代理生命周期

1. **AgentTool 调用**：模型传入 `{ description, prompt, subagent_type, model? }`
2. **创建 LocalAgentTask**：唯一 `agentId` (UUID)
3. **`registerTask()`** → `AppState.tasks`
4. **执行**：同进程，使用 QueryEngine，但：
   - **隔离消息**：独自的 `agent-{agentId}.jsonl` 转录
   - **隔离元数据**：`agent-{agentId}.meta.json`（agentType, worktreePath, description）
   - **Progress 追踪**：`ProgressTracker` — 工具调用次数、token 用量、最近活动（max 5）
5. **通信**：
   - `SendMessageTool` → `pendingMessages` 队列 → 工具轮边界排水
   - `TaskStopTool` → 停止运行中的 agent
   - 完成/失败 → `<task-notification>` XML 注入用户角色消息

#### 10.4 隔离机制

- **上下文隔离**：工作子代理看不到父对话，prompt 必须是独立的
- **Worktree 隔离**：`isolation: "worktree"` → git worktree 运行，路径存 `AgentMetadata.worktreePath`
- **工具限制**：`ASYNC_AGENT_ALLOWED_TOOLS` - `INTERNAL_WORKER_TOOLS`（TeamCreate/TeamDelete/SendMessage/SyntheticOutput）
- **子代理转录**：`{projectDir}/{sessionId}/subagents/agent-{agentId}.jsonl`

#### 10.5 Coordinator Mode

`coordinator/coordinatorMode.ts`：
- 启用：`CLAUDE_CODE_COORDINATOR_MODE` 或 `--coordinator` flag
- `getCoordinatorSystemPrompt()` (line 111)：指导模型作为编排者 spawn worker 做研究/实现/验证
- `getCoordinatorUserContext()` (line 80)：注入 worker 工具能力 + MCP 访问权限
- `matchSessionMode()`：恢复时协调模式对齐

---

### 十一、初始化与 Bootstrap 流程

实现在 `main.tsx`，从模块级副作用到 `run()` → UI launch：

#### 11.1 模块加载前优化

1. `profileCheckpoint('main_tsx_entry')` — 追踪模块评估入口
2. **`startMdmRawRead()`** — 在并行导入同时启动 MDM 子进程（plutil/reg query）
3. **`startKeychainPrefetch()`** — 在并行导入同时启动 macOS keychain 读取（OAuth + legacy API key）
4. ~135ms 导入 → `profileCheckpoint('main_tsx_imports_loaded')`

#### 11.2 main() 函数

1. **`NoDefaultCurrentDirectoryInExePath`** (Windows 安全)
2. 初始化警告处理器 + SIGINT 注册 + `cc://` URL 重写
3. 处理 `claude assistant/ssh` 子命令
4. 确定交互/非交互模式（`-p`/`--print`/`--sdk-url`/`!stdout.isTTY`）
5. `eagerLoadSettings()` + `run()`

#### 11.3 run() 启动序列

```
1. Commander program（所有 CLI 选项注册）
2. preAction hook:
   - 等待 MDM settings + keychain prefetch 完成
   - init()（telemetry, auth, config, settings 加载）
   - 初始化 logging sinks
   - 处理 --plugin-dir 内联 plugins
   - runMigrations()
   - 加载 remote managed settings + policy limits

3. Default action handler:
   - 解析 CLI 选项（model, permissions, MCP configs, etc.）
   - 校验 session IDs, file downloads, fallback models
   - 设置 MCP configs（dynamic + file-based + enterprise policy）

   交互路径 (line 2218+):
     - 创建 Ink root（React Terminal UI）
     - showSetupScreens()（trust dialog, OAuth, onboarding, resume picker）
     - 初始化 LSP server manager（trust 之后）
     - 后台 prefetches（quota, fast mode, passes, bootstrap data）
     - 解析 MCP configs → launchRepl()

   非交互路径 (line 2826+):
     - runHeadless() for -p/--print
```

---

### 十二、认证系统

#### 12.1 Claude.ai OAuth

`utils/auth.js`：
- `getClaudeAIOAuthTokens()` → 返回缓存 OAuth tokens（access + refresh）
- `checkAndRefreshOAuthTokenIfNeeded()` → 预刷新过期 token
- `handleOAuth401Error(sentToken)` → 强制刷新，仅在新 token 时返回 true

#### 12.2 历史系统

`history.ts`：
- 存储：`{claudeConfigHome}/history.jsonl`，全局跨项目
- Entry：`{ display, pastedContents, timestamp, project, sessionId }`
- **上限**：单项目 100 条
- 大粘贴内容 (>1024 chars) → hash 外部存储，仅在历史中存引用

---

### 十三、核心技术洞察

1. **生成器就是协议**：整个系统建立在 `async function*` 之上。`query()` 生成器同时服务于 REPL UI 和 Agent SDK，每个 `yield` 都是一次协议边界。这比 Observable/RxJS 更适合需要背压和逐步恢复的场景。

2. **继续站点状态机**：`queryLoop()` 不递归，用显式 `state = next; continue` 模式。每个继续站点记录 `transition` 字段（next_turn/reactive_compact_retry/max_output_tokens_recovery/stop_hook_blocking），让调用者能推理 Agent 行为。

3. **错误暂扣 > 即时抛出**：PROMPT_TOO_LONG 和 MAX_OUTPUT_TOKENS 从不立即返回给调用者——它们先走恢复路径（升降级/token 预算对话）。只有恢复路径耗尽，错误才浮出。

4. **Hook 是确定性骨架**：CLAUDE.md 是概率性的（LLM 解读），Hooks 是确定性的（exit code/JSON/stdout 保证语义）。当两者冲突，Hook 胜。正是这个确定层级让自治 Agent 循环可靠运行。

5. **权限是 deny-first 的**：规则匹配是 `deny > ask > allow` 优先级。deny 总是第一道关卡，意味着宽松 allow 规则不可能偶然覆盖安全关键 deny 规则。denial 限制是对不合作模型的二次防护。

6. **上下文窗口是经济约束**：自动压缩、子代理隔离、渐进式揭示、token 预算——这些不是"优化"，而是"在 200K token 稀缺资源内运作"的必要机制。压缩引擎用分叉 agent 复用缓存，连压缩成本都精打细算。

7. **MCP 是一等公民**：MCP 工具和内置工具在权限、Hook、上下文、prompt 中完全平等对待。工具注册表在 prompt-cache 稳定约束内合并排序两者。OAuth 认证管道甚至比内部认证更复杂（PKCE + step-up + XAA）。

8. **SDK ≠ API 包装**：SDK 暴露的是整个 Harness，不是薄 API 封装。`QueryEngine.submitMessage()` 驱动和 CLI 完全相同的 pipeline（`processUserInput` → `query()` → `for await`），同样的工具执行器、同样的 Hook 引擎、同样的压缩周期。CLI 和 SDK 只是同一 Harness 的两种不同消费模式。

9. **Prefetch 无处不在**：从 `startMdmRawRead()` / `startKeychainPrefetch()` 在导入阶段开始，到后台 prefetch（quota/fast-mode/bootstrap data）在 UI 初始化期间运行，再到内存 prefetch 结果异步消费——prefetch 不是优化技巧，而是从启动起就刻在架构里的设计模式。

10. **Feature flags 驱动可移植性**：`bun:bundle` 死代码消除使得同一份源码编译为内部构建（所有特性）和外部构建（精简特性）成为可能。这解释了为什么同一个产品能同时服务消费者 CLI 和企业部署。

---

### 参考资料

- `claude-code-analysis/src/query.ts` (1730行) — Agent Loop 主循环
- `claude-code-analysis/src/QueryEngine.ts` (1100+行) — SDK Headless 引擎
- `claude-code-analysis/src/Tool.ts` (695行) — 工具基类接口
- `claude-code-analysis/src/tools.ts` (450+行) — 工具注册表
- `claude-code-analysis/src/utils/hooks.ts` (~5000行) — Hook 核心引擎
- `claude-code-analysis/src/utils/permissions/permissions.ts` — 权限检查管道
- `claude-code-analysis/src/services/mcp/client.ts` — MCP 连接管理
- `claude-code-analysis/src/services/mcp/auth.ts` (88KB) — MCP OAuth 认证
- `claude-code-analysis/src/services/compact/autoCompact.ts` — 自动压缩引擎
- `claude-code-analysis/src/services/compact/compact.ts` — 压缩流程实现
- `claude-code-analysis/src/utils/sessionStorage.ts` — 会话 JSONL 持久化
- `claude-code-analysis/src/tasks/LocalAgentTask/LocalAgentTask.tsx` — 子代理生命周期
- `claude-code-analysis/src/main.tsx` — 入口与 Bootstrap
- `claude-code-analysis/src/coordinator/coordinatorMode.ts` — Coordinator 模式
- [Claude Code 官方文档](https://code.claude.com/docs/en/overview)
- [Claude Agent SDK 文档](https://code.claude.com/docs/en/agent-sdk/overview)