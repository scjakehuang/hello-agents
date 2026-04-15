# MCP 最佳实践与踩坑指南

## 文档信息

- 作者：徐凯旋
- 邮箱：azouever@gmail.com
- 更新时间：2026-04-14
- 标签：MCP, Model Context Protocol, Tool, Resource, Prompt, Python SDK

---

## 目录

1. [概述](#一概述)
2. [核心概念](#二核心概念)
3. [服务器实现（Python SDK 完整示例）](#三服务器实现python-sdk-完整示例)
4. [Tool 定义规范](#四tool-定义规范)
5. [Resource 实现](#五resource-实现)
6. [Prompt 模板实现](#六prompt-模板实现)
7. [客户端连接配置](#七客户端连接配置)
8. [错误处理规范](#八错误处理规范)
9. [日志与可观测性](#九日志与可观测性)
10. [安全注意事项](#十安全注意事项)
11. [性能优化](#十一性能优化)
12. [与 LangChain 集成](#十二与-langchain-集成)
13. [部署方案](#十三部署方案)
14. [常见踩坑](#十四常见踩坑)
15. [速查表](#十五速查表)

---

## 一、概述

### 1.1 什么是 MCP

MCP（Model Context Protocol）是 Anthropic 于 2024 年底发布的开放标准协议，旨在为 LLM 与外部数据源、工具之间的交互提供统一接口。

**核心价值：**
- **标准化**：统一工具调用协议，消除各 LLM 厂商的碎片化集成
- **可复用**：一套 MCP Server 可被多种 AI 客户端（Claude Desktop、Cursor、自研 Agent）共用
- **解耦**：AI 应用层与数据/服务层完全解耦，各自独立演进
- **安全边界**：明确的 Client/Server 边界，权限可控

### 1.2 架构说明（Client / Server / Host）

```
+------------------------------------------------------------------+
|                       MCP 架构全景                                |
+------------------------------------------------------------------+
|                                                                   |
|  +-----------------------+                                        |
|  |      MCP Host         |  <- 宿主应用（Claude Desktop / IDE）   |
|  |                       |                                        |
|  |  +----------------+   |                                        |
|  |  |  MCP Client A  |----+-------> MCP Server 1 (stdio)          |
|  |  +----------------+   |         (本地文件系统工具)              |
|  |                       |                                        |
|  |  +----------------+   |                                        |
|  |  |  MCP Client B  |----+-------> MCP Server 2 (SSE/HTTP)       |
|  |  +----------------+   |         (远程 REST API 工具)            |
|  |                       |                                        |
|  |  +----------------+   |                                        |
|  |  |  MCP Client C  |----+-------> MCP Server 3 (stdio)          |
|  |  +----------------+   |         (数据库查询工具)                |
|  +-----------------------+                                        |
|                                                                   |
|  角色说明：                                                       |
|  Host    = 持有 LLM，管理多个 Client                             |
|  Client  = 与单个 Server 维持一对一 Session                      |
|  Server  = 暴露 Tool / Resource / Prompt 能力                    |
|                                                                   |
+------------------------------------------------------------------+
```

### 1.3 MCP vs 直接 API 调用

```
+------------------------------------------------------------------+
|              直接 API 调用  vs  MCP 调用 对比                    |
+------------------------------------------------------------------+
|                                                                   |
|  直接 API 调用                                                    |
|                                                                   |
|  Agent -----> 自定义 Tool 包装 -----> HTTP REST API               |
|    |             |                                                |
|    |         每个 Agent 自己写      每套环境重复实现               |
|    |         参数格式不统一         认证逻辑散乱                   |
|                                                                   |
|  MCP 调用                                                         |
|                                                                   |
|  Agent A ---+                                                     |
|             |                                                     |
|  Agent B ---+----> MCP Client ----> MCP Server ----> 后端服务    |
|             |           |                |                       |
|  Agent C ---+      标准协议          统一注册                     |
|                    一次实现          多端复用                     |
|                                                                   |
|  关键差异：                                                       |
|  ┌─────────────────┬────────────────┬────────────────┐           |
|  │ 维度            │ 直接 API 调用  │ MCP 调用        │           |
|  ├─────────────────┼────────────────┼────────────────┤           |
|  │ 接口标准化      │ 无             │ 有（统一协议）  │           |
|  │ 多 Agent 复用   │ 难             │ 天然支持        │           |
|  │ 工具发现        │ 硬编码         │ 动态列表        │           |
|  │ 传输方式        │ HTTP only      │ stdio / SSE     │           |
|  │ 上下文传递      │ 自行实现       │ 协议内置        │           |
|  └─────────────────┴────────────────┴────────────────┘           |
|                                                                   |
+------------------------------------------------------------------+
```

---

## 二、核心概念

### 2.1 三类能力

MCP Server 可以向客户端暴露三类能力：

```
+------------------------------------------------------------------+
|                    MCP 三类能力                                   |
+------------------------------------------------------------------+
|                                                                   |
|  Tool（工具）                                                     |
|  ├── 定义：LLM 可主动调用的函数                                   |
|  ├── 特点：有输入 Schema，有返回结果                              |
|  ├── 典型场景：搜索酒店、查询天气、发送邮件                       |
|  └── 对应协议：tools/list + tools/call                            |
|                                                                   |
|  Resource（资源）                                                 |
|  ├── 定义：LLM 可读取的数据源（文件、数据库记录等）               |
|  ├── 特点：通过 URI 标识，支持 MIME 类型                          |
|  ├── 典型场景：读取日志文件、获取配置、查询数据库                 |
|  └── 对应协议：resources/list + resources/read                    |
|                                                                   |
|  Prompt（提示模板）                                               |
|  ├── 定义：预定义的、可参数化的提示词模板                         |
|  ├── 特点：带参数，Server 端集中维护                              |
|  ├── 典型场景：行程总结模板、酒店推荐话术                        |
|  └── 对应协议：prompts/list + prompts/get                         |
|                                                                   |
+------------------------------------------------------------------+
```

### 2.2 传输协议

MCP 支持两种传输方式：

**stdio（标准输入输出）**
- 适用于：本地进程间通信
- 原理：Client 启动 Server 进程，通过 stdin/stdout 交换 JSON-RPC 消息
- 优势：简单、无网络开销、安全（进程隔离）
- 劣势：只能本地使用，不适合远程部署

**SSE（Server-Sent Events）**
- 适用于：远程 HTTP 服务
- 原理：Client 通过 HTTP POST 发送请求，Server 通过 SSE 流式返回
- 优势：可远程部署，多 Client 共享
- 劣势：需要网络，需要处理连接保活

```
+------------------------------------------------------------------+
|               传输协议选型决策树                                  |
+------------------------------------------------------------------+
|                                                                   |
|  需要远程访问？                                                   |
|  │                                                                |
|  ├── NO  --> 用 stdio                                             |
|  │          ├── 启动方式：subprocess + pipes                      |
|  │          └── 配置：command + args                              |
|  │                                                                |
|  └── YES --> 用 SSE                                               |
|             ├── 启动方式：HTTP Server（FastAPI/Uvicorn）          |
|             └── 配置：url（http://host:port/sse）                 |
|                                                                   |
+------------------------------------------------------------------+
```

---

## 三、服务器实现（Python SDK 完整示例）

### 3.1 安装依赖

```bash
pip install mcp fastapi uvicorn httpx structlog
```

### 3.2 完整 Server 骨架（含 Tool / Resource / Prompt）

```python
"""
travel_mcp_server.py
完整的旅行类 MCP Server 示例
"""
import asyncio
import time
import uuid
from typing import Any

import structlog
from mcp.server import Server
from mcp.types import (
    Tool,
    TextContent,
    ImageContent,
    Resource,
    Prompt,
    PromptMessage,
    PromptArgument,
    GetPromptResult,
)

# -------------------------------------------------------
# 初始化
# -------------------------------------------------------
logger = structlog.get_logger()
server = Server("travel-mcp-server")


# -------------------------------------------------------
# Tool：工具列表注册
# -------------------------------------------------------
@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="search_hotel",
            description=(
                "搜索酒店信息。当用户询问酒店、住宿、宾馆相关问题时使用此工具。"
                "返回符合条件的酒店列表，包含名称、价格、评分和地址。"
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "城市名称，如：北京、上海、杭州",
                    },
                    "check_in": {
                        "type": "string",
                        "description": "入住日期，格式：YYYY-MM-DD，如：2024-01-15",
                    },
                    "check_out": {
                        "type": "string",
                        "description": "离店日期，格式：YYYY-MM-DD，如：2024-01-18",
                    },
                    "price_range": {
                        "type": "object",
                        "properties": {
                            "min": {"type": "number", "description": "最低价格（元/晚）"},
                            "max": {"type": "number", "description": "最高价格（元/晚）"},
                        },
                        "description": "价格区间，可选",
                    },
                    "star_level": {
                        "type": "integer",
                        "enum": [1, 2, 3, 4, 5],
                        "description": "酒店星级，1-5，可选",
                    },
                },
                "required": ["city", "check_in", "check_out"],
            },
        ),
        Tool(
            name="search_flight",
            description=(
                "搜索航班信息。当用户需要查询机票、航班时间、价格时使用此工具。"
                "支持单程和往返查询。"
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "origin": {
                        "type": "string",
                        "description": "出发城市或机场三字码，如：北京 / PEK",
                    },
                    "destination": {
                        "type": "string",
                        "description": "目的城市或机场三字码，如：上海 / SHA",
                    },
                    "departure_date": {
                        "type": "string",
                        "description": "出发日期，格式：YYYY-MM-DD",
                    },
                    "return_date": {
                        "type": "string",
                        "description": "返程日期，格式：YYYY-MM-DD，往返时必填",
                    },
                    "cabin_class": {
                        "type": "string",
                        "enum": ["economy", "business", "first"],
                        "description": "舱位等级，默认 economy",
                    },
                },
                "required": ["origin", "destination", "departure_date"],
            },
        ),
    ]


# -------------------------------------------------------
# Tool：工具调用分发
# -------------------------------------------------------
@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent | ImageContent]:
    trace_id = arguments.pop("_trace_id", str(uuid.uuid4()))
    log = logger.bind(tool_name=name, trace_id=trace_id)
    log.info("tool_call_start", arguments=arguments)
    start_time = time.time()

    try:
        result = await _dispatch_tool(name, arguments)
        duration_ms = (time.time() - start_time) * 1000
        log.info("tool_call_success", duration_ms=round(duration_ms, 2))
        return result
    except ValueError as e:
        duration_ms = (time.time() - start_time) * 1000
        log.warning("tool_call_validation_error", error=str(e), duration_ms=round(duration_ms, 2))
        return [TextContent(type="text", text=f"参数错误：{e}")]
    except TimeoutError:
        duration_ms = (time.time() - start_time) * 1000
        log.error("tool_call_timeout", duration_ms=round(duration_ms, 2))
        return [TextContent(type="text", text="工具调用超时，请稍后重试")]
    except Exception as e:
        duration_ms = (time.time() - start_time) * 1000
        log.error("tool_call_error", error=str(e), duration_ms=round(duration_ms, 2), exc_info=True)
        return [TextContent(type="text", text=f"工具执行失败，请联系管理员")]


async def _dispatch_tool(name: str, arguments: dict) -> list[TextContent | ImageContent]:
    """工具调用分发，集中管理路由逻辑"""
    if name == "search_hotel":
        return await _handle_search_hotel(arguments)
    if name == "search_flight":
        return await _handle_search_flight(arguments)
    raise ValueError(f"未知工具：{name}")


async def _handle_search_hotel(args: dict) -> list[TextContent]:
    city = args.get("city")
    check_in = args.get("check_in")
    check_out = args.get("check_out")

    if not city:
        raise ValueError("缺少必填参数：city（城市名称）")
    if not check_in:
        raise ValueError("缺少必填参数：check_in（入住日期）")
    if not check_out:
        raise ValueError("缺少必填参数：check_out（离店日期）")

    # 调用实际服务（示例）
    result = await hotel_service.search(city=city, check_in=check_in, check_out=check_out)
    return [TextContent(type="text", text=result)]


async def _handle_search_flight(args: dict) -> list[TextContent]:
    origin = args.get("origin")
    destination = args.get("destination")
    departure_date = args.get("departure_date")

    if not all([origin, destination, departure_date]):
        raise ValueError("缺少必填参数：origin、destination、departure_date")

    result = await flight_service.search(
        origin=origin,
        destination=destination,
        departure_date=departure_date,
        return_date=args.get("return_date"),
        cabin_class=args.get("cabin_class", "economy"),
    )
    return [TextContent(type="text", text=result)]


# -------------------------------------------------------
# 启动：stdio 模式
# -------------------------------------------------------
async def main():
    from mcp.server.stdio import stdio_server

    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream)


if __name__ == "__main__":
    asyncio.run(main())
```

### 3.3 SSE 模式启动（FastAPI）

```python
"""
travel_mcp_server_sse.py
SSE 传输模式，适用于远程部署场景
"""
from mcp.server.sse import SseServerTransport
from starlette.applications import Starlette
from starlette.routing import Mount, Route
import uvicorn

# 复用上面定义的 server 对象
sse_transport = SseServerTransport("/messages")


async def handle_sse(request):
    async with sse_transport.connect_sse(
        request.scope, request.receive, request._send
    ) as streams:
        await server.run(streams[0], streams[1])


async def handle_messages(request):
    await sse_transport.handle_post_message(request.scope, request.receive, request._send)


app = Starlette(
    routes=[
        Route("/sse", endpoint=handle_sse),
        Mount("/messages", app=sse_transport.handle_post_message),
    ]
)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

---

## 四、Tool 定义规范

### 4.1 命名规范

```
+------------------------------------------------------------------+
|                    Tool 命名规范                                  |
+------------------------------------------------------------------+
|                                                                   |
|  格式：{动词}_{名词}  （全小写，下划线分隔）                      |
|                                                                   |
|  动词分类（按操作意图）：                                         |
|  ├── 查询类：search_ / get_ / list_ / query_                     |
|  ├── 创建类：create_ / add_ / register_                          |
|  ├── 修改类：update_ / edit_ / patch_                            |
|  ├── 删除类：delete_ / remove_ / cancel_                         |
|  └── 执行类：send_ / calculate_ / execute_                       |
|                                                                   |
|  示例：                                                           |
|  ✅ search_hotel         查询酒店                                 |
|  ✅ get_flight_status    获取航班状态                              |
|  ✅ list_attractions     列出景点                                 |
|  ✅ create_order         创建订单                                 |
|  ✅ calculate_route      计算路线                                 |
|                                                                   |
|  ❌ hotel                太简略，无动词                           |
|  ❌ doHotelSearch        驼峰命名                                 |
|  ❌ hotel_search_v2      带版本号，应通过 Server 版本管理          |
|  ❌ HotelSearchTool      首字母大写                               |
|                                                                   |
+------------------------------------------------------------------+
```

### 4.2 description 写法模板

description 是 LLM 决定是否调用该工具的核心依据，直接影响工具调用准确率。

**模板结构：**
```
{工具的核心功能一句话描述}。{触发条件（用户说了什么时用）}。{返回内容简述}。
```

**示例对比：**

```python
# ❌ 过于简短，LLM 无法判断何时调用
"description": "搜索酒店"

# ❌ 过于冗长，干扰 LLM 判断
"description": "这个工具可以通过调用后端服务的 hotel-service 模块，
               使用 Elasticsearch 检索引擎，在数据库中查找符合条件的酒店信息，
               支持按城市、日期、价格、星级等多维度过滤..."

# ✅ 结构清晰，触发条件明确，返回内容清楚
"description": (
    "搜索酒店信息。"
    "当用户询问酒店、住宿、宾馆、客栈相关问题时使用此工具。"
    "返回酒店名称、价格（元/晚）、评分（0-5星）和地址。"
)
```

### 4.3 inputSchema 设计原则

**原则一：description 必须包含格式示例**

```python
# ❌ 无格式说明，LLM 可能传入错误格式
"check_in": {
    "type": "string",
    "description": "入住日期"
}

# ✅ 包含格式和示例
"check_in": {
    "type": "string",
    "description": "入住日期，格式：YYYY-MM-DD，如：2024-01-15"
}
```

**原则二：可选参数必须与必填参数明确区分**

```python
inputSchema={
    "type": "object",
    "properties": {
        # 必填参数
        "city": {
            "type": "string",
            "description": "城市名称（必填），如：北京、上海"
        },
        # 可选参数在 description 中注明
        "star_level": {
            "type": "integer",
            "enum": [1, 2, 3, 4, 5],
            "description": "酒店星级（可选），1-5，不传则返回所有星级"
        }
    },
    # required 只列必填字段
    "required": ["city", "check_in", "check_out"]
}
```

**原则三：枚举值优先于自由文本**

```python
# ❌ 自由文本，LLM 可能传入"商务舱"、"头等"、"Business Class"等变体
"cabin_class": {
    "type": "string",
    "description": "舱位等级"
}

# ✅ 枚举约束，确保 LLM 只传合法值
"cabin_class": {
    "type": "string",
    "enum": ["economy", "business", "first"],
    "description": "舱位等级：economy（经济舱）/ business（商务舱）/ first（头等舱），默认 economy"
}
```

**原则四：嵌套对象要有整体 description**

```python
"price_range": {
    "type": "object",
    "description": "价格区间（可选），单位：元/晚。仅当用户明确指定价格范围时才传入",
    "properties": {
        "min": {"type": "number", "description": "最低价格（元/晚）"},
        "max": {"type": "number", "description": "最高价格（元/晚）"}
    }
}
```

---

## 五、Resource 实现

Resource 允许 LLM 读取服务端的数据，适合只读的上下文信息（配置、日志、文档等）。

```python
from mcp.types import Resource, ResourceContents, TextResourceContents
import json

# 注册资源列表
@server.list_resources()
async def list_resources() -> list[Resource]:
    return [
        Resource(
            uri="config://travel/hotcities",
            name="热门旅游城市列表",
            description="当前支持搜索的热门旅游城市及对应的城市代码",
            mimeType="application/json",
        ),
        Resource(
            uri="log://travel/recent-errors",
            name="最近错误日志",
            description="最近 1 小时内的工具调用错误日志，用于排障",
            mimeType="text/plain",
        ),
    ]


# 读取资源内容
@server.read_resource()
async def read_resource(uri: str) -> list[ResourceContents]:
    if uri == "config://travel/hotcities":
        hot_cities = {
            "cities": [
                {"name": "北京", "code": "BJS", "airports": ["PEK", "PKX"]},
                {"name": "上海", "code": "SHA", "airports": ["PVG", "SHA"]},
                {"name": "杭州", "code": "HGH", "airports": ["HGH"]},
                {"name": "成都", "code": "CTU", "airports": ["CTU", "TFU"]},
            ]
        }
        return [
            TextResourceContents(
                uri=uri,
                mimeType="application/json",
                text=json.dumps(hot_cities, ensure_ascii=False, indent=2),
            )
        ]

    if uri == "log://travel/recent-errors":
        # 从实际日志系统读取
        logs = await log_service.get_recent_errors(minutes=60)
        return [
            TextResourceContents(
                uri=uri,
                mimeType="text/plain",
                text=logs,
            )
        ]

    raise ValueError(f"未知资源 URI：{uri}")
```

---

## 六、Prompt 模板实现

Prompt 模板适合将业务话术集中在 Server 端管理，避免在每个 Agent 中重复硬编码。

```python
from mcp.types import Prompt, PromptArgument, GetPromptResult, PromptMessage

# 注册 Prompt 列表
@server.list_prompts()
async def list_prompts() -> list[Prompt]:
    return [
        Prompt(
            name="trip_summary",
            description="生成行程总结报告。用于将用户的行程安排整理成结构化的总结文字。",
            arguments=[
                PromptArgument(
                    name="destination",
                    description="目的地城市，如：杭州",
                    required=True,
                ),
                PromptArgument(
                    name="duration_days",
                    description="行程天数，如：3",
                    required=True,
                ),
                PromptArgument(
                    name="travel_style",
                    description="旅行风格：休闲 / 深度游 / 商务，可选",
                    required=False,
                ),
            ],
        ),
        Prompt(
            name="hotel_recommendation",
            description="生成酒店推荐话术。",
            arguments=[
                PromptArgument(name="hotel_name", description="酒店名称", required=True),
                PromptArgument(name="price", description="价格（元/晚）", required=True),
                PromptArgument(name="highlights", description="酒店亮点（逗号分隔）", required=False),
            ],
        ),
    ]


# 获取 Prompt 内容
@server.get_prompt()
async def get_prompt(name: str, arguments: dict | None) -> GetPromptResult:
    args = arguments or {}

    if name == "trip_summary":
        destination = args.get("destination", "目的地")
        duration = args.get("duration_days", "N")
        style = args.get("travel_style", "休闲")

        return GetPromptResult(
            description=f"{destination} {duration} 日行程总结",
            messages=[
                PromptMessage(
                    role="user",
                    content=TextContent(
                        type="text",
                        text=(
                            f"请帮我整理一份 {destination} {duration} 日 {style} 风格的行程总结报告，"
                            f"包含：行程亮点、住宿安排、交通方式、预算估算、注意事项。"
                            f"格式要清晰，便于分享给朋友。"
                        ),
                    ),
                )
            ],
        )

    if name == "hotel_recommendation":
        hotel_name = args.get("hotel_name", "")
        price = args.get("price", "")
        highlights = args.get("highlights", "位置便利，服务优质")

        return GetPromptResult(
            description=f"{hotel_name} 推荐话术",
            messages=[
                PromptMessage(
                    role="user",
                    content=TextContent(
                        type="text",
                        text=(
                            f"请为 {hotel_name}（{price}元/晚）生成一段简洁有吸引力的推荐语，"
                            f"突出以下亮点：{highlights}。字数控制在 100 字以内。"
                        ),
                    ),
                )
            ],
        )

    raise ValueError(f"未知 Prompt：{name}")
```

---

## 七、客户端连接配置

### 7.1 Claude Desktop 配置

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "travel-mcp": {
      "command": "python",
      "args": ["/path/to/travel_mcp_server.py"],
      "env": {
        "HOTEL_API_KEY": "your-api-key",
        "LOG_LEVEL": "INFO"
      }
    },
    "travel-mcp-remote": {
      "url": "http://localhost:8000/sse",
      "headers": {
        "Authorization": "Bearer your-token"
      }
    }
  }
}
```

### 7.2 MCP Inspector 调试

MCP Inspector 是官方提供的 Server 调试工具，无需接入 Claude Desktop 即可测试 Server。

```bash
# 安装
npm install -g @modelcontextprotocol/inspector

# 调试 stdio Server
mcp-inspector python travel_mcp_server.py

# 调试 SSE Server（先启动 Server，再连接）
mcp-inspector --url http://localhost:8000/sse
```

Inspector 提供的能力：
- 查看 Tool / Resource / Prompt 列表
- 手动触发工具调用并查看返回
- 查看 JSON-RPC 原始报文
- 实时调试 Schema 和参数

### 7.3 Python 代码中作为客户端

```python
import asyncio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def use_mcp_tool():
    server_params = StdioServerParameters(
        command="python",
        args=["travel_mcp_server.py"],
        env={"LOG_LEVEL": "INFO"},
    )

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            # 初始化
            await session.initialize()

            # 列出工具
            tools = await session.list_tools()
            print("可用工具：", [t.name for t in tools.tools])

            # 调用工具
            result = await session.call_tool(
                "search_hotel",
                {"city": "杭州", "check_in": "2024-05-01", "check_out": "2024-05-03"},
            )
            print("调用结果：", result.content)


asyncio.run(use_mcp_tool())
```

---

## 八、错误处理规范

### 8.1 错误分类与处理策略

```
+------------------------------------------------------------------+
|                    错误分类处理策略                               |
+------------------------------------------------------------------+
|                                                                   |
|  错误类型          触发场景              返回策略                 |
|  ─────────────────────────────────────────────────────           |
|  参数缺失          必填参数未传          返回明确提示，不抛异常   |
|  参数格式错误      日期格式/类型错误     返回格式说明，不抛异常   |
|  超时              下游服务无响应        返回重试建议，记录日志   |
|  下游服务异常      API 报错/限流         返回脱敏错误信息         |
|  未知工具          name 不在列表中       返回提示，记录 Warning   |
|  未预期异常        程序 Bug              返回通用错误，记录 Error  |
|                                                                   |
+------------------------------------------------------------------+
```

### 8.2 完整错误处理示例

```python
import re
from datetime import datetime


def validate_date(date_str: str, field_name: str) -> None:
    """校验日期格式，不合法则抛出 ValueError"""
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        raise ValueError(f"{field_name} 格式错误，应为 YYYY-MM-DD，实际传入：{date_str!r}")
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        raise ValueError(f"{field_name} 日期不存在：{date_str}")


def validate_city(city: str) -> None:
    """校验城市名"""
    if not city or not city.strip():
        raise ValueError("city 不能为空字符串")
    if len(city) > 20:
        raise ValueError(f"city 过长（最大 20 字符），实际：{len(city)}")


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    try:
        # 第一层：参数校验（业务逻辑前置）
        _validate_arguments(name, arguments)

        # 第二层：执行工具（带超时）
        result = await asyncio.wait_for(
            _dispatch_tool(name, arguments),
            timeout=10.0,  # 10 秒超时
        )
        return result

    except ValueError as e:
        # 参数错误：直接返回给 LLM，LLM 可修正重试
        return [TextContent(type="text", text=f"参数错误：{e}")]

    except asyncio.TimeoutError:
        logger.error("tool_timeout", tool=name)
        return [TextContent(type="text", text="查询超时（10s），请稍后重试或简化查询条件")]

    except ExternalAPIError as e:
        # 下游 API 错误：脱敏后返回
        logger.error("external_api_error", tool=name, status_code=e.status_code)
        return [TextContent(type="text", text=f"外部服务暂时不可用（错误码：{e.status_code}），请稍后重试")]

    except Exception as e:
        # 未预期错误：不暴露内部细节
        logger.error("unexpected_error", tool=name, error=str(e), exc_info=True)
        return [TextContent(type="text", text="工具执行遇到内部错误，已记录日志，请联系管理员")]


def _validate_arguments(name: str, arguments: dict) -> None:
    """集中参数校验"""
    if name == "search_hotel":
        validate_city(arguments.get("city", ""))
        validate_date(arguments.get("check_in", ""), "check_in")
        validate_date(arguments.get("check_out", ""), "check_out")
    elif name == "search_flight":
        if not arguments.get("origin"):
            raise ValueError("缺少必填参数：origin（出发城市）")
        if not arguments.get("destination"):
            raise ValueError("缺少必填参数：destination（目的城市）")
        validate_date(arguments.get("departure_date", ""), "departure_date")
```

---

## 九、日志与可观测性

### 9.1 structlog 配置

```python
import structlog
import logging

def configure_logging(log_level: str = "INFO") -> None:
    """配置结构化日志"""
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.add_log_level,
            structlog.stdlib.add_logger_name,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),  # 输出 JSON，便于日志平台解析
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
    )
    logging.basicConfig(level=getattr(logging, log_level.upper()))
```

### 9.2 trace_id 透传

trace_id 应贯穿整个调用链：Agent -> MCP Client -> MCP Server -> 下游服务。

```python
import contextvars

# 通过 contextvars 存储当前请求的 trace_id
current_trace_id: contextvars.ContextVar[str] = contextvars.ContextVar(
    "trace_id", default="unknown"
)


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    # 从参数中提取 trace_id（约定字段），不影响业务逻辑
    trace_id = arguments.pop("_trace_id", str(uuid.uuid4()))
    current_trace_id.set(trace_id)

    # 绑定到 structlog 上下文，后续所有日志自动携带
    structlog.contextvars.bind_contextvars(trace_id=trace_id, tool_name=name)

    log = structlog.get_logger()
    log.info("tool_call_start", arguments_keys=list(arguments.keys()))

    start_time = time.perf_counter()
    try:
        result = await _dispatch_tool(name, arguments)
        elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
        log.info("tool_call_success", elapsed_ms=elapsed_ms)
        return result
    except Exception as e:
        elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
        log.error("tool_call_error", elapsed_ms=elapsed_ms, error=str(e))
        raise
    finally:
        # 清理上下文，避免污染其他请求
        structlog.contextvars.clear_contextvars()
```

### 9.3 耗时分层记录

```python
import contextlib
from typing import AsyncIterator


@contextlib.asynccontextmanager
async def timed_operation(operation_name: str) -> AsyncIterator[None]:
    """耗时记录上下文管理器，用于细粒度性能分析"""
    log = structlog.get_logger()
    start = time.perf_counter()
    try:
        yield
    finally:
        elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
        log.info("operation_timing", operation=operation_name, elapsed_ms=elapsed_ms)


# 使用示例
async def _handle_search_hotel(args: dict) -> list[TextContent]:
    async with timed_operation("param_validation"):
        validate_city(args["city"])
        validate_date(args["check_in"], "check_in")

    async with timed_operation("hotel_api_call"):
        result = await hotel_service.search(**args)

    async with timed_operation("result_formatting"):
        text = format_hotel_results(result)

    return [TextContent(type="text", text=text)]
```

---

## 十、安全注意事项

### 10.1 输入验证

```python
import html
import re


# SQL 注入防护：禁止使用字符串拼接构造查询
# ❌ 危险
async def search_db_wrong(city: str):
    query = f"SELECT * FROM hotels WHERE city = '{city}'"  # SQL 注入！
    return await db.execute(query)


# ✅ 安全：使用参数化查询
async def search_db_safe(city: str):
    query = "SELECT * FROM hotels WHERE city = :city"
    return await db.execute(query, {"city": city})


# 命令注入防护：禁止将用户输入拼入 shell 命令
# ❌ 危险
import subprocess
async def run_report_wrong(city: str):
    subprocess.run(f"python report.py --city {city}", shell=True)  # 命令注入！


# ✅ 安全：使用参数列表
async def run_report_safe(city: str):
    # 先白名单校验
    if not re.match(r"^[\u4e00-\u9fff a-zA-Z]+$", city):
        raise ValueError(f"city 包含非法字符：{city!r}")
    subprocess.run(["python", "report.py", "--city", city])


# 长度与字符白名单校验
def sanitize_city_input(city: str) -> str:
    """对城市名做清洗，只保留中文、字母、空格"""
    city = city.strip()
    if not city:
        raise ValueError("city 不能为空")
    if len(city) > 50:
        raise ValueError(f"city 超长（最大 50 字符）")
    if not re.match(r"^[\u4e00-\u9fff a-zA-Z\-·]+$", city):
        raise ValueError(f"city 包含不支持的字符：{city!r}")
    return city
```

### 10.2 敏感信息脱敏

```python
SENSITIVE_KEYS = {"api_key", "token", "password", "secret", "authorization"}


def mask_sensitive(data: dict) -> dict:
    """对日志输出中的敏感字段进行脱敏"""
    return {
        k: "***" if k.lower() in SENSITIVE_KEYS else v
        for k, v in data.items()
    }


# 日志中使用
log.info("tool_call_start", arguments=mask_sensitive(arguments))
```

### 10.3 速率限制

```python
from collections import defaultdict
from asyncio import Lock
import time

class RateLimiter:
    """简单的令牌桶速率限制器"""

    def __init__(self, max_calls: int, period_seconds: float):
        self.max_calls = max_calls
        self.period = period_seconds
        self._calls: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    async def check(self, key: str) -> bool:
        async with self._lock:
            now = time.time()
            calls = self._calls[key]
            # 清理过期记录
            self._calls[key] = [t for t in calls if now - t < self.period]
            if len(self._calls[key]) >= self.max_calls:
                return False
            self._calls[key].append(now)
            return True


rate_limiter = RateLimiter(max_calls=60, period_seconds=60.0)  # 每分钟 60 次


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    client_id = arguments.pop("_client_id", "default")
    if not await rate_limiter.check(client_id):
        return [TextContent(type="text", text="请求过于频繁，请稍后重试（限制：60次/分钟）")]
    # ... 正常处理
```

---

## 十一、性能优化

### 11.1 连接池

```python
import httpx

# 全局单例连接池，避免每次请求新建连接
_http_client: httpx.AsyncClient | None = None


def get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=3.0, read=10.0, write=5.0, pool=1.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _http_client


# Server 关闭时释放资源
async def cleanup():
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()
```

### 11.2 并发调用

```python
import asyncio

async def search_trip_package(city: str, check_in: str, check_out: str) -> dict:
    """同时并发查询酒店和航班，缩短响应时间"""
    hotel_task = asyncio.create_task(
        hotel_service.search(city=city, check_in=check_in, check_out=check_out)
    )
    flight_task = asyncio.create_task(
        flight_service.search_roundtrip(destination=city, date=check_in, return_date=check_out)
    )

    # 并发等待，任意一个失败不影响另一个
    hotel_result, flight_result = await asyncio.gather(
        hotel_task, flight_task, return_exceptions=True
    )

    return {
        "hotels": hotel_result if not isinstance(hotel_result, Exception) else [],
        "flights": flight_result if not isinstance(flight_result, Exception) else [],
        "has_hotel_error": isinstance(hotel_result, Exception),
        "has_flight_error": isinstance(flight_result, Exception),
    }
```

### 11.3 结果缓存

```python
import functools
import hashlib
import json
from typing import Callable, TypeVar, Any

# 简单内存缓存（生产环境建议用 Redis）
_cache: dict[str, tuple[Any, float]] = {}
_CACHE_TTL_SECONDS = 300  # 5 分钟


def cache_result(ttl: float = _CACHE_TTL_SECONDS):
    """工具结果缓存装饰器"""
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            # 生成缓存 key
            cache_key = hashlib.md5(
                json.dumps({"args": args, "kwargs": kwargs}, sort_keys=True, ensure_ascii=False).encode()
            ).hexdigest()

            now = time.time()
            if cache_key in _cache:
                result, expire_at = _cache[cache_key]
                if now < expire_at:
                    logger.debug("cache_hit", key=cache_key[:8])
                    return result

            result = await func(*args, **kwargs)
            _cache[cache_key] = (result, now + ttl)
            return result
        return wrapper
    return decorator


# 使用示例
@cache_result(ttl=300)
async def search_hotel_cached(city: str, check_in: str, check_out: str):
    return await hotel_service.search(city=city, check_in=check_in, check_out=check_out)
```

---

## 十二、与 LangChain 集成

### 12.1 安装

```bash
pip install langchain-mcp-adapters langchain-openai langgraph
```

### 12.2 集成 stdio MCP Server

```python
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI


async def create_travel_agent():
    """创建带 MCP 工具的旅行 Agent"""
    async with MultiServerMCPClient(
        {
            "travel": {
                "command": "python",
                "args": ["travel_mcp_server.py"],
                "transport": "stdio",
                "env": {"LOG_LEVEL": "INFO"},
            }
        }
    ) as client:
        # 获取 MCP 工具，自动转换为 LangChain Tool 格式
        tools = await client.get_tools()
        print(f"加载了 {len(tools)} 个工具：{[t.name for t in tools]}")

        llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
        agent = create_react_agent(llm, tools)

        result = await agent.ainvoke({
            "messages": [{"role": "user", "content": "帮我搜索杭州5月1日到5月3日的酒店"}]
        })
        return result
```

### 12.3 集成 SSE MCP Server

```python
async def create_travel_agent_sse():
    """连接远程 SSE MCP Server"""
    async with MultiServerMCPClient(
        {
            "travel-remote": {
                "url": "http://localhost:8000/sse",
                "transport": "sse",
                "headers": {"Authorization": "Bearer your-token"},
            }
        }
    ) as client:
        tools = await client.get_tools()
        # ... 同上
```

### 12.4 手动转换 Tool（不使用 MultiServerMCPClient）

```python
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from langchain_mcp_adapters.tools import load_mcp_tools


async def load_tools_manually():
    """手动控制连接生命周期"""
    server_params = StdioServerParameters(
        command="python",
        args=["travel_mcp_server.py"],
    )

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await load_mcp_tools(session)
            return tools
```

---

## 十三、部署方案

### 13.1 本地 stdio（开发/Claude Desktop）

```
+------------------------------------------------------------------+
|                    本地 stdio 部署                                |
+------------------------------------------------------------------+
|                                                                   |
|  Claude Desktop                                                   |
|       |                                                           |
|       | fork + pipe                                               |
|       v                                                           |
|  python travel_mcp_server.py  (本地进程)                         |
|       |                                                           |
|       | 直接调用                                                  |
|       v                                                           |
|  本地文件系统 / 本地数据库                                        |
|                                                                   |
|  优势：简单、无网络、进程隔离                                     |
|  劣势：只能单机使用                                               |
|                                                                   |
+------------------------------------------------------------------+
```

**Claude Desktop 配置（开发环境）：**

```json
{
  "mcpServers": {
    "travel-dev": {
      "command": "python",
      "args": ["/Users/dev/projects/travel_mcp_server.py"],
      "env": {
        "LOG_LEVEL": "DEBUG",
        "HOTEL_API_KEY": "dev-key"
      }
    }
  }
}
```

### 13.2 HTTP SSE 服务（团队共享 / 生产）

```bash
# 直接运行
python travel_mcp_server_sse.py

# 使用 Gunicorn + Uvicorn Worker（生产推荐）
pip install gunicorn
gunicorn travel_mcp_server_sse:app \
    -w 4 \
    -k uvicorn.workers.UvicornWorker \
    --bind 0.0.0.0:8000 \
    --timeout 60 \
    --access-logfile - \
    --error-logfile -
```

### 13.3 Docker 部署

```dockerfile
# Dockerfile
FROM python:3.11-slim

WORKDIR /app

# 安装依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制代码
COPY . .

# 暴露 SSE 端口
EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# 启动命令
CMD ["uvicorn", "travel_mcp_server_sse:app", "--host", "0.0.0.0", "--port", "8000"]
```

```yaml
# docker-compose.yml
version: "3.9"

services:
  travel-mcp:
    build: .
    ports:
      - "8000:8000"
    environment:
      - LOG_LEVEL=INFO
      - HOTEL_API_KEY=${HOTEL_API_KEY}
      - FLIGHT_API_KEY=${FLIGHT_API_KEY}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

```
+------------------------------------------------------------------+
|                    Docker 部署架构                                |
+------------------------------------------------------------------+
|                                                                   |
|  Claude Desktop / Agent                                           |
|       |                                                           |
|       | HTTP SSE (port 8000)                                      |
|       v                                                           |
|  +---------------------------+                                    |
|  |  Docker Container         |                                    |
|  |  travel-mcp-server:latest |                                    |
|  |  Uvicorn + FastAPI        |                                    |
|  +---------------------------+                                    |
|       |                                                           |
|       | 内部调用                                                  |
|       v                                                           |
|  +---------------+  +------------------+                         |
|  | Hotel API     |  | Flight API       |                         |
|  | (外部服务)    |  | (外部服务)       |                         |
|  +---------------+  +------------------+                         |
|                                                                   |
+------------------------------------------------------------------+
```

---

## 十四、常见踩坑

### 坑 1：返回格式不规范

```python
# ❌ 直接返回字符串，MCP 协议不认识
@server.call_tool()
async def call_tool(name: str, arguments: dict):
    return "搜索结果：北京有 10 家酒店"  # TypeError！

# ❌ 返回裸字典
@server.call_tool()
async def call_tool(name: str, arguments: dict):
    return {"result": "北京有 10 家酒店"}  # 格式错误！

# ✅ 必须返回 Content 对象列表
@server.call_tool()
async def call_tool(name: str, arguments: dict):
    return [TextContent(type="text", text="搜索结果：北京有 10 家酒店")]

# ✅ 多内容块（文字 + 图片）
@server.call_tool()
async def call_tool(name: str, arguments: dict):
    return [
        TextContent(type="text", text="酒店分布如下："),
        ImageContent(type="image", data=base64_map_data, mimeType="image/png"),
    ]
```

### 坑 2：在异步函数中使用同步 HTTP 调用

```python
# ❌ requests 是同步库，会阻塞整个事件循环
# 导致所有并发请求卡住
import requests

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    resp = requests.get("https://api.example.com/hotels")  # 阻塞！
    return [TextContent(type="text", text=resp.text)]

# ✅ 使用 httpx.AsyncClient（异步 HTTP 库）
import httpx

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get("https://api.example.com/hotels")
        resp.raise_for_status()
    return [TextContent(type="text", text=resp.text)]
```

### 坑 3：Tool description 过短导致 LLM 召回率低

```python
# ❌ description 太简短，LLM 不知道该什么时候调用
Tool(
    name="search_hotel",
    description="搜索酒店",  # LLM 调用率会很低
    ...
)

# ❌ description 全是技术实现细节，LLM 不关心
Tool(
    name="search_hotel",
    description="调用 hotel-service HTTP API，走 Elasticsearch 全文检索引擎，支持 city/check_in/check_out 三个字段",
    ...
)

# ✅ 面向 LLM 的决策说明：触发时机 + 功能描述 + 返回内容
Tool(
    name="search_hotel",
    description=(
        "搜索酒店信息。"
        "当用户询问酒店、住宿、宾馆、客栈时使用此工具。"
        "返回符合条件的酒店列表，包含名称、价格（元/晚）、评分和地址。"
    ),
    ...
)
```

### 坑 4：required 字段与实际逻辑不一致

```python
# ❌ required 里列了 price_range，但实际上是可选的
# LLM 会尝试强行构造这个字段，导致传入奇怪的值
inputSchema={
    "type": "object",
    "properties": {
        "city": {"type": "string"},
        "price_range": {"type": "object", "description": "价格区间（可选）"},
    },
    "required": ["city", "price_range"],  # ❌ price_range 不应在 required 里
}

# ❌ required 里缺了必填字段，导致 LLM 不传，运行时 KeyError
inputSchema={
    "type": "object",
    "properties": {
        "city": {"type": "string"},
        "check_in": {"type": "string"},
    },
    "required": ["city"],  # ❌ check_in 也是必填，漏了！
}

# ✅ required 与实际业务逻辑严格对齐
inputSchema={
    "type": "object",
    "properties": {
        "city": {"type": "string", "description": "城市名称（必填）"},
        "check_in": {"type": "string", "description": "入住日期（必填），格式 YYYY-MM-DD"},
        "price_range": {"type": "object", "description": "价格区间（可选）"},
    },
    "required": ["city", "check_in"],  # ✅ 只列真正必填的字段
}
```

### 坑 5：Server 启动后未正确清理资源

```python
# ❌ 程序退出时数据库连接池/HTTP 连接未释放
async def main():
    from mcp.server.stdio import stdio_server
    async with stdio_server() as (read, write):
        await server.run(read, write)
    # 程序到这里就退出了，连接池没有关闭！

# ✅ 使用 contextlib.asynccontextmanager 或 lifespan 管理资源
import contextlib

@contextlib.asynccontextmanager
async def lifespan():
    """Server 生命周期管理"""
    # 启动时初始化
    await db_pool.initialize()
    http_client = httpx.AsyncClient(limits=httpx.Limits(max_connections=20))
    app_state["http_client"] = http_client
    logger.info("server_started")

    try:
        yield
    finally:
        # 退出时清理
        await http_client.aclose()
        await db_pool.close()
        logger.info("server_stopped")


async def main():
    from mcp.server.stdio import stdio_server
    async with lifespan():
        async with stdio_server() as (read, write):
            await server.run(read, write)
```

### 坑 6：不处理 asyncio.gather 中的部分失败

```python
# ❌ 一个子任务失败会导致整个 gather 抛异常，另一个任务结果丢失
async def search_all(city: str, date: str):
    hotel_result, flight_result = await asyncio.gather(
        hotel_service.search(city, date),
        flight_service.search(city, date),
    )
    return hotel_result, flight_result

# ✅ 使用 return_exceptions=True，单独处理每个结果
async def search_all(city: str, date: str) -> dict:
    hotel_result, flight_result = await asyncio.gather(
        hotel_service.search(city, date),
        flight_service.search(city, date),
        return_exceptions=True,
    )

    response = {}
    if isinstance(hotel_result, Exception):
        logger.warning("hotel_search_failed", error=str(hotel_result))
        response["hotels"] = []
        response["hotel_error"] = "酒店查询暂时不可用"
    else:
        response["hotels"] = hotel_result

    if isinstance(flight_result, Exception):
        logger.warning("flight_search_failed", error=str(flight_result))
        response["flights"] = []
        response["flight_error"] = "航班查询暂时不可用"
    else:
        response["flights"] = flight_result

    return response
```

### 坑 7：SSE 连接保活问题

```python
# ❌ 长时间无数据推送时，SSE 连接可能被代理/防火墙断开
# 没有心跳机制，客户端会静默失去连接

# ✅ 在 SSE Server 中定期发送注释（keep-alive ping）
# FastAPI/Starlette SSE 实现示例
import asyncio
from sse_starlette.sse import EventSourceResponse


async def event_generator(request):
    while True:
        if await request.is_disconnected():
            break

        # 业务数据推送
        data = await get_next_event()
        if data:
            yield {"data": data}
        else:
            # 发送 keep-alive 注释，防止连接超时
            yield {"comment": "keep-alive"}
            await asyncio.sleep(15)


# 注意：mcp 官方 SSE 实现已内置 keep-alive，
# 但部署在 Nginx 后面时需配置：
# proxy_read_timeout 3600;
# proxy_send_timeout 3600;
```

---

## 十五、速查表

### 15.1 MCP SDK 核心 API

```
+------------------------------------------------------------------+
|                    MCP Python SDK 速查                            |
+------------------------------------------------------------------+
|                                                                   |
|  Server 注册装饰器                                               |
|  ├── @server.list_tools()       注册工具列表处理器               |
|  ├── @server.call_tool()        注册工具调用处理器               |
|  ├── @server.list_resources()   注册资源列表处理器               |
|  ├── @server.read_resource()    注册资源读取处理器               |
|  ├── @server.list_prompts()     注册 Prompt 列表处理器           |
|  └── @server.get_prompt()       注册 Prompt 获取处理器           |
|                                                                   |
|  Content 类型                                                     |
|  ├── TextContent(type="text", text=str)                           |
|  ├── ImageContent(type="image", data=b64str, mimeType=str)        |
|  └── EmbeddedResource(type="resource", resource=...)              |
|                                                                   |
|  启动方式                                                         |
|  ├── stdio: from mcp.server.stdio import stdio_server             |
|  └── SSE:   from mcp.server.sse import SseServerTransport         |
|                                                                   |
+------------------------------------------------------------------+
```

### 15.2 Tool 定义检查清单

```
+------------------------------------------------------------------+
|                    Tool 定义自查清单                              |
+------------------------------------------------------------------+
|                                                                   |
|  name                                                             |
|  [ ] 全小写 + 下划线分隔                                          |
|  [ ] 动词_名词格式                                                |
|  [ ] 无版本号、无 "Tool" 后缀                                     |
|                                                                   |
|  description                                                      |
|  [ ] 有"何时使用"的触发条件说明                                   |
|  [ ] 说明了返回内容的结构/格式                                    |
|  [ ] 不包含技术实现细节（URL、框架名等）                          |
|                                                                   |
|  inputSchema                                                      |
|  [ ] 每个字段都有 description                                     |
|  [ ] 字符串参数有格式示例（尤其日期）                             |
|  [ ] 有限集合用 enum 约束                                         |
|  [ ] required 与实际业务逻辑一致                                  |
|  [ ] 可选参数的 description 中注明"可选"                          |
|                                                                   |
+------------------------------------------------------------------+
```

### 15.3 错误处理速查

| 错误类型 | 捕获异常 | 处理方式 |
|----------|----------|----------|
| 参数缺失/格式错误 | `ValueError` | 返回明确提示，不暴露内部信息 |
| 调用超时 | `asyncio.TimeoutError` | 返回重试建议 |
| 下游 HTTP 错误 | `httpx.HTTPStatusError` | 脱敏后返回状态码 |
| 网络不可达 | `httpx.ConnectError` | 返回服务不可用提示 |
| 未知工具 | 手动 `raise ValueError` | 返回未知工具提示 |
| 未预期异常 | `Exception` | 返回通用错误，记录完整堆栈 |

### 15.4 传输方式选型

| 场景 | 推荐方式 | 理由 |
|------|----------|------|
| Claude Desktop 本地工具 | stdio | 简单，零网络开销 |
| 团队共享工具服务 | SSE（Docker） | 统一部署，多人共用 |
| CI/CD 集成测试 | stdio | 进程隔离，无端口冲突 |
| Agent 远程调用 | SSE + Bearer Token | 安全可控 |
| 开发调试 | stdio + MCP Inspector | 快速验证 Schema |

### 15.5 常用命令速查

```bash
# 安装 Python MCP SDK
pip install mcp

# 安装 MCP Inspector
npm install -g @modelcontextprotocol/inspector

# 启动 Inspector 调试 stdio Server
mcp-inspector python travel_mcp_server.py

# 启动 Inspector 调试 SSE Server
mcp-inspector --url http://localhost:8000/sse

# 安装 LangChain MCP 适配器
pip install langchain-mcp-adapters

# Docker 部署
docker build -t travel-mcp .
docker run -p 8000:8000 -e HOTEL_API_KEY=xxx travel-mcp
```

---

> 更多 MCP 官方资料：
> - 官方文档：https://modelcontextprotocol.io
> - Python SDK：https://github.com/modelcontextprotocol/python-sdk
> - MCP Inspector：https://github.com/modelcontextprotocol/inspector
