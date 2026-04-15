# arsenal-service-ai-mcp 服务架构与 DeepTrip MCP 调用链路分析

## 文档信息

- 作者：徐凯旋
- 邮箱：azouever@gmail.com
- 更新时间：2026-04-14

---

## 一、服务概述

`arsenal-service-ai-mcp` 是 DeepTrip 项目中的 **MCP（Model Context Protocol）统一管理服务**，负责：

1. **MCP Server 管理**：注册、激活、配置 MCP 服务
2. **Tool 管理**：加载、缓存、调用 MCP 工具
3. **协议适配**：支持 Stdio/SSE/HTTP 三种传输协议
4. **统一入口**：为 Agent（如 agent-b101）提供 HTTP API 调用 MCP 能力

### 技术栈

| 技术 | 版本 |
|------|------|
| JDK | 17 |
| Spring Boot | 3.4.4 |
| LangChain4j | 1.0.0-beta2 |
| Spring AI | 1.1.2 |

---

## 二、服务架构图

### 2.1 重要说明

**`arsenal-service-ai-mcp` 的角色是 MCP 客户端代理服务，而非 MCP Server。**

| 模块 | 角色 | 说明 |
|------|------|------|
| `aj-mcp-server` | MCP Server 框架（独立库） | 提供注解方式注册 Tool/Prompt/Resource，**但当前项目未使用** |
| `aj-mcp-client` | MCP Client 框架（独立库） | 提供 Stdio/SSE 传输，连接外部 MCP Server |
| `arsenal-service-ai-mcp` | MCP 客户端代理服务 | 聚合多个外部 MCP Server，提供统一 HTTP API |
| Spring AI MCP | MCP Client（生产使用） | 项目实际使用的 MCP 客户端实现 |

> **注意**：`FeatureMgr.init()` 只在 `aj-mcp-server` 的测试代码中被调用，生产环境中 `arsenal-service-ai-mcp` 不依赖 `aj-mcp-server` 作为服务端。

### 2.2 实际架构图

```
+------------------------------------------------------------------+
|                    arsenal-service-ai-mcp                         |
|                    (MCP 客户端代理服务)                            |
+------------------------------------------------------------------+
|                                                                   |
|  +--------------------------------------------------------+      |
|  |                  arsenal-service-ai-mcp-api            |      |
|  |  +--------------------------------------------------+  |      |
|  |  |  Controller Layer                                |  |      |
|  |  |  - McpController      (工具列表、调用)            |  |      |
|  |  |  - McpManageController (服务/工具配置管理)         |  |      |
|  |  |  - ChatController     (对话接口)                  |  |      |
|  |  +--------------------------------------------------+  |      |
|  +--------------------------|-----------------------------+      |
|                             |                                    |
|  +--------------------------v-----------------------------+      |
|  |            arsenal-service-ai-mcp-application          |      |
|  |  +--------------------------------------------------+  |      |
|  |  |  Agent & Tools (本地 AI 能力)                     |  |      |
|  |  |  - StreamingAssistant                            |  |      |
|  |  |  - TicketBookingTools                            |  |      |
|  |  |  - WeatherTool / BaikeTool                       |  |      |
|  |  +--------------------------------------------------+  |      |
|  |  +--------------------------------------------------+  |      |
|  |  |  RAG (Retrieval Augmented Generation)            |  |      |
|  |  |  - CustomRetriever                               |  |      |
|  |  |  - TencentVDBBaseProcessor (向量数据库)           |  |      |
|  |  +--------------------------------------------------+  |      |
|  +--------------------------|-----------------------------+      |
|                             |                                    |
|  +--------------------------v-----------------------------+      |
|  |          MCP Client Layer (实际使用)                   |      |
|  |  +--------------------------------------------------+  |      |
|  |  |  Spring AI MCP Client                            |  |      |
|  |  |  - McpSyncClient (io.modelcontextprotocol)       |  |      |
|  |  |  - StdioClientTransport                          |  |      |
|  |  +--------------------------------------------------+  |      |
|  |  +--------------------------------------------------+  |      |
|  |  |  aj-mcp-client (备用客户端)                       |  |      |
|  |  |  - McpClient (com.ajaxjs.mcp.client)             |  |      |
|  |  |  - HttpMcpTransport (SSE 方式)                   |  |      |
|  |  +--------------------------------------------------+  |      |
|  +--------------------------|-----------------------------+      |
|                             |                                    |
|  +--------------------------v-----------------------------+      |
|  |               Infrastructure Layer                     |      |
|  |  - Redis (配置缓存: mcp:config)                        |      |
|  |  - MySQL (数据持久化)                                  |      |
|  +--------------------------------------------------------+      |
|                                                                   |
+------------------------------------------------------------------+
                              |
                              | HTTP / Stdio
                              v
+------------------------------------------------------------------+
|                   外部 MCP Server 集群                            |
+------------------------------------------------------------------+
|  +------------------+  +------------------+  +------------------+ |
|  | baidumap/mcp-    |  | 17usoftmcp/      |  | 其他 MCP Server  | |
|  | server-baidu-map |  | travel_short     |  |                  | |
|  | (百度地图)        |  | (旅行攻略)        |  |                  | |
|  +------------------+  +------------------+  +------------------+ |
+------------------------------------------------------------------+
```

### 2.3 模块职责说明

```
arsenal-service-ai-mcp (parent)
├── arsenal-service-ai-mcp-api          # API 层（HTTP 入口）
│   └── 依赖: aj-mcp-client, Spring AI MCP
├── arsenal-service-ai-mcp-application  # 应用层（本地 AI 能力）
├── arsenal-service-ai-mcp-domain       # 领域层（DTO/Entity）
├── arsenal-service-ai-mcp-infrastructure # 基础设施层
├── arsenal-service-ai-mcp-common       # 公共模块
│
├── aj-mcp-client   # MCP 客户端库（SSE 方式备用）
├── aj-mcp-server   # MCP 服务端库（独立使用，当前项目未启用）
├── aj-mcp-common   # MCP 协议公共模块
└── arsenal-framework # 框架基础能力
```

---

## 三、核心逻辑流程图

### 3.1 MCP Server 配置管理流程

```
+-------------------+     +-------------------+     +-------------------+
|  Admin/运维       |     | McpManageController|    |      Redis        |
+---------+---------+     +---------+---------+     +---------+---------+
          |                         |                         |
          | 1. POST /api/mcp/config/server                   |
          |   {id, name, command, args, env}                 |
          |------------------------>|                         |
          |                         | 2. Save config          |
          |                         |------------------------>|
          |                         |   key: mcp:config       |
          |                         |                         |
          | 3. POST /api/mcp/config/server/activate          |
          |------------------------>|                         |
          |                         | 4. Update status=active |
          |                         |------------------------>|
          |                         |                         |
          | 5. POST /api/mcp/config/server/load-tools        |
          |------------------------>|                         |
          |                         |                         |
          |                         | 6. Create McpSyncClient |
          |                         |    (Spring AI or aj-mcp)|
          |                         |                         |
          |                         | 7. Connect to external  |
          |                         |    MCP Server           |
          |                         |                         |
          |                         | 8. listTools()          |
          |                         |                         |
          |                         | 9. Save tools to config |
          |                         |------------------------>|
          |                         |                         |
          | 10. Return tools list   |                         |
          |<------------------------|                         |
          |                         |                         |
```

### 3.2 MCP 工具调用流程（Stdio 方式 - 使用 Spring AI）

```
+-------------+     +---------------+     +-------------+     +----------------+
|   Client    |     |  McpController|     | McpSyncClient|    | MCP Server     |
|  (agent-b101|     |               |     | (Spring AI)  |    | (外部进程)      |
+------+------+     +-------+-------+     +------+------+     +-------+--------+
       |                    |                    |                    |
       | 1. POST /api/mcp/tools/call           |                    |
       |   serverId, toolId, params            |                    |
       |------------------->|                    |                    |
       |                    | 2. Get config from Redis              |
       |                    |   type=stdio        |                   |
       |                    |                     |                   |
       |                    | 3. Create StdioClientTransport       |
       |                    |    ServerParameters builder          |
       |                    |------------------------>|             |
       |                    |                     |                   |
       |                    |                     | 4. initialize()   |
       |                    |                     |  (启动外部进程)    |
       |                    |                     |------------------>|
       |                    |                     |                   |
       |                    |                     | 5. listTools()    |
       |                    |                     |------------------>|
       |                    |                     |                   |
       |                    |                     | 6. callTool()     |
       |                    |                     |   (JSON-RPC)      |
       |                    |                     |------------------>|
       |                    |                     |                   |
       |                    |                     |    +--------------+--------------+
       |                    |                     |    |  外部 MCP Server 进程         |
       |                    |                     |    |  (如 npx @baidumap/...)     |
       |                    |                     |    |  处理请求并返回结果           |
       |                    |                     |    +--------------+--------------+
       |                    |                     |                   |
       |                    |                     | 7. Result        |
       |                    |                     |<------------------|
       |                    | 8. Parse response  |                   |
       |                    |<--------------------|                  |
       | 9. JSON response   |                    |                   |
       |<-------------------|                    |                   |
       |                    |                    |                   |
```

### 3.3 MCP 工具调用流程（SSE 方式 - 使用 aj-mcp-client）

```
+-------------+     +---------------+     +-------------+     +----------------+
|   Client    |     |  McpController|     |  McpClient  |     |  MCP Server    |
|             |     |               |     |  (aj-mcp)   |     |  (HTTP/SSE)    |
+------+------+     +-------+-------+     +------+------+     +-------+--------+
       |                    |                    |                    |
       | 1. POST /api/mcp/tools/call           |                    |
       |   serverId, toolId, params            |                    |
       |------------------->|                    |                    |
       |                    | 2. Get config      |                    |
       |                    |   type=sse         |                    |
       |                    |   url=...          |                    |
       |                    |                    |                    |
       |                    | 3. HttpMcpTransport.builder()            |
       |                    |    .sseUrl(url)    |                    |
       |                    |-------------------->|                   |
       |                    |                    |                    |
       |                    |                    | 4. initialize()    |
       |                    |                    |   SSE connect      |
       |                    |                    |------------------->|
       |                    |                    |                    |
       |                    |                    | 5. callTool()      |
       |                    |                    |   POST /message    |
       |                    |                    |------------------->|
       |                    |                    |                    |
       |                    |                    |    +---------------+---------------+
       |                    |                    |    |  Remote MCP Server            |
       |                    |                    |    |  处理并返回 SSE 事件           |
       |                    |                    |    +---------------+---------------+
       |                    |                    |                    |
       |                    |                    | 6. SSE events      |
       |                    |                    |<-------------------|
       |                    | 7. Parse result    |                    |
       |                    |<--------------------|                   |
       | 8. Response        |                    |                    |
       |<-------------------|                    |                    |
       |                    |                    |                    |
```

---

## 五、agent-b101 中 MCP 工具的注册与调用机制

### 5.1 核心发现：MCP 工具是**嵌入式注册**，而非动态发现

**重要结论**：agent-b101 中的 MCP 工具**不是动态注册**的，而是**在具体工具类的构造函数中硬编码初始化**。

```
+-------------------+     +-------------------+     +-------------------+
|  sight_recommend  |     |    McpTool        |     | arsenal-service-  |
|     _tool         |     |                   |     |    ai-mcp         |
|  (业务工具类)      |     |  (MCP客户端封装)   |     |  (MCP代理服务)     |
+---------+---------+     +---------+---------+     +---------+---------+
          |                         |                         |
          | 1. __init__() 中创建    |                         |
          |    self.short_trip_tool |                         |
          |    = McpTool(...)       |                         |
          |------------------------>|                         |
          |                         |                         |
          |                         | 2. _detect_tool()       |
          |                         |    HTTP GET /api/mcp/   |
          |                         |    local/tools          |
          |                         |------------------------>|
          |                         |                         |
          |                         | 3. 返回工具元数据        |
          |                         |    (name, desc, schema) |
          |                         |<------------------------|
          |                         |                         |
          | 4. 工具实例就绪         |                         |
          |<------------------------|                         |
          |                         |                         |
```

### 5.2 详细注册流程

#### 步骤 1：业务工具类初始化时创建 McpTool 实例

```python
# agent-b101/app/routers/tools_v2/sight_recommend_tool.py

class sight_recommend_tool(BaseTool):

    def __init__(self):
        super().__init__()
        # ... 其他初始化 ...

        # 关键：在构造函数中创建 MCP 工具实例
        self.short_trip_tool = None
        try:
            self.short_trip_tool = McpTool(
                server_id="17usoftmcp/travel_short",      # MCP Server ID
                tool_id="get-short-trip",                  # Tool ID
                mcp_adapter=McpAdapter(
                    name="get_short_trip",
                    description="查询短期或短途游玩景点和攻略，如周末游玩、周边游玩",
                    custom_text=lambda data: data["travelPlan"]  # 自定义结果转换
                )
            )
        except Exception as e:
            logger.error(f"short_trip_tool register error: {e}")
```

#### 步骤 2：McpTool 初始化时从 arsenal-service-ai-mcp 拉取工具元数据

```python
# agent-b101/app/routers/tools_v2/mcp_tool.py

class McpTool(BaseTool):
    """MCP工具类基类，提供描述改写能力"""

    def __init__(self, server_id, tool_id, mcp_adapter=None):
        self.server_id = server_id
        self.tool_id = tool_id

        # 关键：从 arsenal-service-ai-mcp 检测工具信息
        self.tool_info = self._detect_tool(server_id, tool_id)
        if not self.tool_info:
            raise ValueError(f"Tool {server_id}/{tool_id} not found in MCP service")

        # 解析工具元数据
        self.func_name = self.tool_info["name"]
        self.func_desc = self.tool_info["description"]
        self.func_params = json.loads(self.tool_info["schema"])
        self.required = self.func_params['required']
        self.properties = self.func_params['properties']

        # 设置调用 URL
        self.product_url = f"http://arsenal-ai-service-mcp.17usoft.com/api/mcp/tools/call?serverId={server_id}&toolId={tool_id}"
        self.qa_url = f"http://arsenal-ai-service-mcp.qa.17usoft.com/api/mcp/tools/call?serverId={server_id}&toolId={tool_id}"

    def _detect_tool(self, server_id, tool_id):
        """从 arsenal-service-ai-mcp 获取工具信息"""
        # 根据环境选择 URL
        url = ("http://arsenal-ai-service-mcp.17usoft.com/api/mcp/local/tools"
               if self.env == "product"
               else "http://arsenal-ai-service-mcp.qa.17usoft.com/api/mcp/local/tools")

        # HTTP GET 请求获取工具列表
        response = requests.get(url, headers={"Authorization": "..."})
        result = response.json()

        # 从返回的工具列表中查找匹配的工具
        if result.get("code") == "0" and "data" in result:
            for tool in result["data"]:
                if tool.get("serverId") == server_id and tool.get("toolId") == tool_id:
                    return tool  # 返回工具元数据

        return None
```

#### 步骤 3：工具实例被注册到 Agent 的上下文中

```python
# agent-b101/app/routers/context/core_context.py

class AgentCoreContext(AgentBaseContext):

    def _initialize_tools_and_agents(self):
        """初始化工具和代理列表"""

        # 实例化工具（MCP 工具在 sight_recommend_tool 的 __init__ 中创建）
        hotel_search = hotel_search_tool()
        hotel_detail = hotel_detail_tool()
        sight_recommend = sight_recommend_tool()  # 内部创建了 McpTool 实例
        # ... 其他工具 ...

        # 注册到工具列表
        self.ALL_TOOLS = [hotel_search, hotel_detail, sight_recommend, ...]

        # 创建工具名 -> 工具实例的映射
        self.NAME_2_TOOL = {tool.register_name: tool for tool in self.ALL_TOOLS}

        # 创建工具记忆映射（用于存储工具调用结果）
        self.NAME_2_MEM = {tool.register_name: Memory(f"{tool.register_name}") for tool in self.ALL_TOOLS}
```

### 5.3 MCP 工具调用流程

```
+-------------+     +---------------+     +------------------+     +------------+
|    LLM      |     | AgentLoop     |     | sight_recommend  |     | McpTool    |
|  (大模型)   |     |               |     |     _tool        |     |            |
+------+------+     +-------+-------+     +--------+---------+     +-----+------+
       |                    |                      |                     |
       | 1. 决定调用        |                      |                     |
       |    sight_recommend |                      |                     |
       |------------------->|                      |                     |
       |                    |                      |                     |
       |                    | 2. 调用工具          |                     |
       |                    |   tool(request, params, headers, sid, tool_id)
       |                    |--------------------->|                     |
       |                    |                      |                     |
       |                    |                      | 3. 判断是否需要 MCP |
       |                    |                      |   if short_trip=='是'|
       |                    |                      |                     |
       |                    |                      | 4. 调用 McpTool     |
       |                    |                      |   self.short_trip_tool.execute()
       |                    |                      |-------------------->|
       |                    |                      |                     |
       |                    |                      |                     | 5. HTTP POST
       |                    |                      |                     |   /api/mcp/tools/call
       |                    |                      |                     |-----------------+
       |                    |                      |                     |                 |
       |                    |                      |                     |    +------------+------------+
       |                    |                      |                     |    | arsenal-service-ai-mcp  |
       |                    |                      |                     |    | 转发到外部 MCP Server   |
       |                    |                      |                     |    +------------+------------+
       |                    |                      |                     |                 |
       |                    |                      |                     | 6. 返回结果     |
       |                    |                      |                     |<----------------+
       |                    |                      |                     |
       |                    |                      | 7. 合并结果         |
       |                    |                      |<--------------------|
       |                    |                      |                     |
       |                    | 8. 返回工具结果      |                     |
       |                    |<---------------------|                     |
       |                    |                      |                     |
       | 9. 返回给大模型    |                      |                     |
       |<-------------------|                      |                     |
       |                    |                      |                     |
```

### 5.4 关键代码示例：MCP 工具的实际调用

```python
# agent-b101/app/routers/tools_v2/sight_recommend_tool.py

def execute(self, request, params: dict, headers: dict, sid: str, tool_id: str, debug=True, **kwargs):
    """执行景区推荐逻辑"""

    # ... 参数解析 ...

    res = []

    # 关键：根据条件决定是否调用 MCP 工具
    try:
        if short_trip == '是' and self.short_trip_tool:
            # 构造 MCP 工具参数
            short_trip_params = {"desc": " ".join([region, preference_desc])}

            # 调用 MCP 工具
            short_trip_text = self.short_trip_tool.execute(
                request, short_trip_params, headers, sid, tool_id, debug, **kwargs
            )[0]

            # 将结果添加到返回列表
            res.extend(short_trip_text)
    except Exception as e:
        logger.error(f'call short_trip_tool error: {e}')

    # ... 继续调用其他 API ...

    return res, json_data
```

### 5.5 McpAdapter 适配器模式

`McpAdapter` 用于**定制 MCP 工具的描述和返回结果处理**：

```python
# agent-b101/app/routers/tools_v2/mcp_tool.py

class McpAdapter:
    def __init__(self, name=None, description=None, required=None, properties=None,
                 custom_text=None, custom_parse=None):
        self.name = name                    # 覆盖工具名称
        self.description = description      # 覆盖工具描述
        self.required = required            # 覆盖必填参数
        self.properties = properties        # 覆盖参数属性
        self.custom_text_helper = custom_text    # 自定义结果文本转换
        self.custom_parse_helper = custom_parse  # 自定义结果解析

    def custom_text(self, data):
        """将 MCP 返回数据转换为 LLM 输入文本"""
        if self.custom_text_helper:
            return self.custom_text_helper(data)
        return str(data)

    def custom_parse(self, data):
        """自定义解析 MCP 返回数据"""
        if self.custom_parse_helper:
            return self.custom_parse_helper(data)
        return data
```

**使用示例**：

```python
# 创建适配器，自定义工具描述和结果处理
adapter = McpAdapter(
    name="get_short_trip",
    description="查询短期或短途游玩景点和攻略，如周末游玩、周边游玩",
    custom_text=lambda data: data["travelPlan"]  # 从返回数据中提取 travelPlan 字段
)

# 创建 MCP 工具
tool = McpTool("17usoftmcp/travel_short", "get-short-trip", adapter)
```

### 5.6 注册流程总结图

```
+------------------------------------------------------------------+
|                    agent-b101 启动流程                            |
+------------------------------------------------------------------+
|                                                                   |
|  1. AgentCoreContext.__post_init__()                             |
|     |                                                             |
|     v                                                             |
|  2. _initialize_tools_and_agents()                               |
|     |                                                             |
|     v                                                             |
|  +--------------------------------------------------------+      |
|  |  3. 实例化工具类                                         |      |
|  |     sight_recommend = sight_recommend_tool()            |      |
|  |     |                                                   |      |
|  |     v                                                   |      |
|  |  +--------------------------------------------------+  |      |
|  |  |  sight_recommend_tool.__init__()                  |  |      |
|  |  |     |                                             |  |      |
|  |  |     v                                             |  |      |
|  |  |  +--------------------------------------------+   |  |      |
|  |  |  |  self.short_trip_tool = McpTool(           |   |  |      |
|  |  |  |      server_id="17usoftmcp/travel_short",  |   |  |      |
|  |  |  |      tool_id="get-short-trip",             |   |  |      |
|  |  |  |      mcp_adapter=McpAdapter(...)           |   |  |      |
|  |  |  |  )                                         |   |  |      |
|  |  |  +--------------------------------------------+   |  |      |
|  |  |     |                                             |  |      |
|  |  |     v                                             |  |      |
|  |  |  +--------------------------------------------+   |  |      |
|  |  |  |  McpTool.__init__()                         |   |  |      |
|  |  |  |     |                                       |   |  |      |
|  |  |  |     v                                       |   |  |      |
|  |  |  |  _detect_tool(server_id, tool_id)          |   |  |      |
|  |  |  |     |                                       |   |  |      |
|  |  |  |     | HTTP GET                              |   |  |      |
|  |  |  |     v                                       |   |  |      |
|  |  |  |  +--------------------------------------+   |   |  |      |
|  |  |  |  | arsenal-service-ai-mcp               |   |   |  |      |
|  |  |  |  | /api/mcp/local/tools                 |   |   |  |      |
|  |  |  |  | 返回工具元数据 (name, desc, schema)   |   |   |  |      |
|  |  |  |  +--------------------------------------+   |   |  |      |
|  |  |  +--------------------------------------------+   |  |      |
|  |  +--------------------------------------------------+  |      |
|  +--------------------------------------------------------+      |
|     |                                                             |
|     v                                                             |
|  4. 注册到 ALL_TOOLS 列表                                        |
|     self.ALL_TOOLS = [sight_recommend, ...]                      |
|     self.NAME_2_TOOL = {tool.register_name: tool, ...}           |
|                                                                   |
+------------------------------------------------------------------+
```

### 5.7 与动态注册的对比

| 特性 | 当前实现（嵌入式注册） | 动态注册（假设） |
|------|----------------------|-----------------|
| 注册时机 | 业务工具类初始化时 | 服务启动时或运行时 |
| 注册方式 | 在 `__init__` 中硬编码 | 自动发现并注册 |
| 灵活性 | 需要修改代码才能添加新工具 | 配置驱动，无需改代码 |
| 工具发现 | 从 arsenal-service-ai-mcp 获取元数据 | 从外部 MCP Server 动态发现 |
| 适用场景 | 工具数量固定、需要定制化处理 | 工具数量多、频繁变化 |

---

## 六、DeepTrip 项目中的 MCP 注册与调用链路

### 6.1 整体调用链路

```
+----------------+     +-------------------+     +---------------------+     +------------+
|  agent-b101    |     | arsenal-service-  |     | arsenal-service-    |     | MCP Server |
|  (Python)      |     | ai-mcp            |     | ai-mcp              |     | (External) |
|                |     | (McpController)   |     | (McpClient)         |     |            |
+-------+--------+     +---------+---------+     +----------+----------+     +-----+------+
        |                        |                          |                    |
        | 1. HTTP POST           |                          |                    |
        |    /api/mcp/tools/call |                          |                    |
        |----------------------->|                          |                    |
        |                        |                          |                    |
        |                        | 2. Get ServerConfig      |                    |
        |                        |    from Redis            |                    |
        |                        |                          |                    |
        |                        | 3. Create McpSyncClient  |                    |
        |                        |    based on type:        |                    |
        |                        |    - stdio: StdioTransport                   |
        |                        |    - sse: HttpMcpTransport                   |
        |                        |------------------------->|                    |
        |                        |                          |                    |
        |                        |                          | 4. initialize()    |
        |                        |                          |   listTools()      |
        |                        |                          |   callTool()       |
        |                        |                          |------------------->|
        |                        |                          |                    |
        |                        |                          | 5. Execute tool    |
        |                        |                          |    return result   |
        |                        |                          |<-------------------|
        |                        |                          |                    |
        |                        | 6. Parse & convert       |                    |
        |                        |    response              |                    |
        |                        |<-------------------------|                    |
        |                        |                          |                    |
        | 7. Return JSON         |                          |                    |
        |<-----------------------|                          |                    |
        |                        |                          |                    |
```

---

## 六、MCP 协议核心概念

### 6.1 协议层

```
+--------------------------------------------------+
|              MCP Protocol Layer                  |
+--------------------------------------------------+
|                                                  |
|  +-------------+  +-------------+  +-----------+|
|  |   Tools     |  |   Prompts   |  | Resources ||
|  |  (工具调用)  |  |  (提示模板)  |  | (资源访问) ||
|  +-------------+  +-------------+  +-----------+|
|                                                  |
|  +--------------------------------------------+  |
|  |           Transport Layer                   |  |
|  |  - Stdio (标准输入输出)                     |  |
|  |  - HTTP (HTTP 请求/响应)                    |  |
|  |  - SSE (Server-Sent Events)                |  |
|  +--------------------------------------------+  |
|                                                  |
|  +--------------------------------------------+  |
|  |           Message Types                     |  |
|  |  - Request (请求)                          |  |
|  |  - Response (响应)                         |  |
|  |  - Notification (通知)                     |  |
|  +--------------------------------------------+  |
|                                                  |
+--------------------------------------------------+
```

### 6.2 核心方法

| 方法 | 说明 | 方向 |
|------|------|------|
| `initialize` | 初始化握手 | Client -> Server |
| `ping` | 心跳检测 | Client -> Server |
| `tools/list` | 获取工具列表 | Client -> Server |
| `tools/call` | 调用工具 | Client -> Server |
| `prompts/list` | 获取提示模板列表 | Client -> Server |
| `prompts/get` | 获取提示模板 | Client -> Server |
| `resources/list` | 获取资源列表 | Client -> Server |
| `resources/read` | 读取资源 | Client -> Server |

---

## 四、关键代码解析

### 4.1 McpController - 工具调用入口

```java
// arsenal-service-ai-mcp-api/src/main/java/.../McpController.java

@PostMapping("/tools/call")
public Response<Object> callTool(
        @RequestParam String serverId,
        @RequestParam String toolId,
        @RequestBody Map<String, Object> parameters) {

    // 1. 从 Redis 获取服务器配置
    Map<String, ServerConfig> serverConfigs = getServerConfigs();
    ServerConfig serverConfig = serverConfigs.get(serverId);

    // 2. 根据类型选择客户端
    if (serverConfig.getType().equals("stdio")) {
        // 使用 Spring AI McpSyncClient
        response = getResp4Stdio(serverId, toolId, parameters, serverConfig);
    }
    if (serverConfig.getType().equals("sse")) {
        // 使用 aj-mcp-client HttpMcpTransport
        response = getResp4Sse(serverId, toolId, parameters, serverConfig, toolConfig);
    }

    return Response.success(response);
}
```

### 4.2 Stdio 方式 - 使用 Spring AI

```java
// 使用 Spring AI 的 McpSyncClient
private JSONObject getResp4Stdio(String serverId, String toolId,
                                  Map<String, Object> parameters,
                                  ServerConfig serverConfig) throws Exception {
    // 1. 创建 McpSyncClient
    McpSyncClient client = getOrCreateClient(serverId, serverConfig);

    // 2. 调用工具
    McpSchema.CallToolResult result = client.callTool(
        new McpSchema.CallToolRequest(toolId, parameters));

    // 3. 解析返回结果
    JSONObject responseJson = new JSONObject();
    if (result != null && result.content() != null) {
        for (McpSchema.Content content : result.content()) {
            if (content instanceof McpSchema.TextContent) {
                // 处理文本内容
            }
        }
    }
    return responseJson;
}

// 创建客户端
public synchronized McpSyncClient getOrCreateClient(String serverId, ServerConfig serverConfig) {
    // 创建 Stdio 传输层
    ServerParameters params = ServerParameters.builder(serverConfig.getCommand())
            .args(serverConfig.getArgs().toArray(new String[0]))
            .env(serverConfig.getEnv())
            .build();

    McpClientTransport transport = new StdioClientTransport(params, McpJsonMapper.getDefault());

    // 构建同步客户端
    McpSyncClient client = McpClient.sync(transport)
            .requestTimeout(Duration.ofSeconds(20))
            .initializationTimeout(Duration.ofSeconds(20))
            .capabilities(McpSchema.ClientCapabilities.builder().roots(true).build())
            .build();

    // 初始化连接
    client.initialize();

    return client;
}
```

### 4.3 SSE 方式 - 使用 aj-mcp-client

```java
// 使用 aj-mcp-client 的 HttpMcpTransport
private Object getResp4Sse(String serverId, String toolId,
                           Map<String, Object> parameters,
                           ServerConfig serverConfig, ToolConfig toolConfig) {
    // 1. 创建 HTTP 传输层
    McpTransport transport = HttpMcpTransport.builder()
            .sseUrl(serverConfig.getUrl())
            .logRequests(true)
            .logResponses(true)
            .build();

    // 2. 构建 MCP 客户端
    com.ajaxjs.mcp.client.McpClient mcpClient =
        com.ajaxjs.mcp.client.McpClient.builder()
            .transport(transport)
            .build();

    // 3. 初始化
    mcpClient.initialize();

    // 4. 调用工具
    String result = mcpClient.callTool(toolConfig.getName(), JsonUtils.toJson(parameters));

    // 5. 解析返回结果
    JSONObject jsonObject = JSONUtil.parseObj(result, true);
    return convertResp(jsonObject, serverConfig, toolId);
}
```

### 4.4 aj-mcp-server 说明（独立库，当前项目未使用）

> **重要**：`aj-mcp-server` 是一个独立的 MCP Server 框架库，设计用于让其他 Java 项目可以作为 MCP Server 运行。
> 当前 `arsenal-service-ai-mcp` 项目**并未使用**此模块作为服务端，而是作为 MCP 客户端代理。

`aj-mcp-server` 的设计模式（供参考）：

```java
// 只有测试代码中调用 FeatureMgr.init()
// aj-mcp-server/src/test/java/.../TestStdioServerBase.java

static void callServer() {
    // 1. 扫描注解注册 Tool/Prompt/Resource
    FeatureMgr mgr = new FeatureMgr();
    mgr.init("com.ajaxjs.mcp.server.testcase");  // 扫描指定包

    // 2. 创建 MCP Server
    McpServer server = new McpServer();
    server.setTransport(new ServerStdio(server));

    // 3. 启动服务（通过 stdin/stdout 通信）
    server.start();
}
```

如果要在其他项目中使用 `aj-mcp-server`：

```java
// 1. 定义 MCP 服务类
@McpService
public class MyMcpTools {

    @Tool("greet")
    @ToolArg(value = "name", description = "用户名称", required = true)
    public String greet(String name) {
        return "Hello, " + name + "!";
    }

    @Prompt("welcome")
    public String welcome() {
        return "Welcome to my MCP service!";
    }
}

// 2. 启动服务
public static void main(String[] args) {
    FeatureMgr mgr = new FeatureMgr();
    mgr.init("com.example.mcp");  // 扫描包

    McpServer server = new McpServer();
    server.setTransport(new ServerStdio(server));
    server.start();  // 作为 MCP Server 运行
}
```

---

## 八、配置管理

### 8.1 ServerConfig 数据结构

```java
// arsenal-service-ai-mcp-domain/src/main/java/com/ly/arsenal/ai/mcp/domain/dto/ServerConfig.java

public class ServerConfig {
    private String id;           // 服务器 ID，如 "baidumap/mcp-server-baidu-map"
    private String name;         // 服务器名称
    private String description;  // 描述
    private String type;         // 类型: "stdio" 或 "sse"
    private String command;      // 启动命令，如 "npx"
    private List<String> args;   // 命令参数，如 ["-y", "@baidumap/mcp-server-baidu-map"]
    private Map<String, String> env;  // 环境变量
    private String url;          // SSE 模式的 URL
    private String status;       // 状态: "active" 或 "inactive"
    private List<ToolConfig> tools;   // 已加载的工具列表
    private Date createdAt;
    private Date updatedAt;
}
```

### 8.2 ToolConfig 数据结构

```java
// arsenal-service-ai-mcp-domain/src/main/java/com/ly/arsenal/ai/mcp/domain/dto/ToolConfig.java

public class ToolConfig {
    private String id;           // 工具 ID
    private String name;         // 工具名称
    private String description;  // 工具描述
    private String schema;       // 输入参数 schema (JSON)
    private String status;       // 状态: "active" 或 "inactive"
    private String customPrompt; // 自定义提示词
    private String convertRespJsonPath;  // 响应转换 JSONPath
    private Boolean respIsArray; // 响应是否为数组
    private Date createdAt;
    private Date updatedAt;
}
```

### 8.3 Redis 配置存储

```
Key: mcp:config
Value: {
  "baidumap/mcp-server-baidu-map": {
    "id": "baidumap/mcp-server-baidu-map",
    "name": "百度地图服务",
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@baidumap/mcp-server-baidu-map"],
    "env": {"BAIDU_MAP_API_KEY": "xxx"},
    "status": "active",
    "tools": [
      {
        "id": "uuid-xxx",
        "name": "map_geocode",
        "description": "地理编码",
        "schema": "{...}",
        "status": "active"
      }
    ]
  }
}
```

---

## 九、典型使用场景

### 9.1 添加新的 MCP Server

```bash
# 1. 创建服务器配置
curl -X POST "http://arsenal-ai-service-mcp.qa.17usoft.com/api/mcp/config/server" \
-H "Content-Type: application/json" \
--data '{
  "id": "baidumap/mcp-server-baidu-map",
  "name": "百度地图服务",
  "command": "npx",
  "args": ["-y", "@baidumap/mcp-server-baidu-map"],
  "env": {"BAIDU_MAP_API_KEY": "your-api-key"}
}'

# 2. 激活服务器
curl -X POST "http://arsenal-ai-service-mcp.qa.17usoft.com/api/mcp/config/server/activate?serverId=baidumap/mcp-server-baidu-map"

# 3. 加载工具列表
curl -X POST "http://arsenal-ai-service-mcp.qa.17usoft.com/api/mcp/config/server/load-tools?serverId=baidumap/mcp-server-baidu-map"

# 4. 获取工具列表
curl -X GET "http://arsenal-ai-service-mcp.qa.17usoft.com/api/mcp/local/tools"

# 5. 调用工具
curl -X POST "http://arsenal-ai-service-mcp.qa.17usoft.com/api/mcp/tools/call?serverId=baidumap/mcp-server-baidu-map&toolId=map_geocode" \
-H "Content-Type: application/json" \
--data '{"address":"上海市"}'
```

### 9.2 在 agent-b101 中使用 MCP 工具

```python
# 定义 MCP 工具适配器
class McpShortTripAdapter(McpAdapter):
    def __init__(self):
        super().__init__(
            name="short_trip_recommend",
            description="旅行攻略推荐工具，根据用户描述推荐短期出行方案",
            required=["desc"],
            properties={
                "desc": {
                    "type": "string",
                    "description": "用户完整描述的旅游地点、景点区域、主题、出行时间等"
                }
            }
        )

    def custom_text(self, data):
        """自定义返回文本格式"""
        return [d["travelPlan"] for d in data]

# 创建工具实例
tool = McpTool(
    server_id="17usoftmcp/travel_short",
    tool_id="get-short-trip",
    mcp_adapter=McpShortTripAdapter()
)

# 执行调用
result = tool.execute(
    request={},
    params={"desc": "北京6月周边游"},
    headers={"memberId": "123456"},
    sid="session-id",
    tool_id=""
)
```

---

## 十、总结

### 核心要点

1. **统一管理**：arsenal-service-ai-mcp 作为 DeepTrip 的 MCP 统一入口，管理所有 MCP Server 和 Tool

2. **协议适配**：支持 Stdio 和 SSE 两种传输协议，兼容不同类型的 MCP Server

3. **配置驱动**：所有配置存储在 Redis，支持动态更新和热加载

4. **注解驱动**：aj-mcp-server 提供注解方式快速定义 Tool/Prompt/Resource

5. **多语言支持**：Java 端通过 aj-mcp-client/server 实现，Python 端通过 HTTP API 调用

### 调用链路总结

```
Agent (Python/Java)
    ↓ HTTP POST
arsenal-service-ai-mcp (McpController)
    ↓ Redis 获取配置
    ↓ 创建 McpSyncClient (Stdio/SSE)
MCP Server (外部进程/远程服务)
    ↓ 执行工具
    ↓ 返回结果
Agent 获取响应
```

---

## 参考资料

- [MCP 官方文档](https://modelcontextprotocol.io/introduction)
- [Spring AI 文档](https://docs.spring.io/spring-ai/reference/)
- [LangChain4j 文档](https://docs.langchain4j.dev/)
