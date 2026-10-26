# agent-b101 `/chat` 工具声明与注册机制

- 作者：黄家楷
- 邮箱：jiakai.huang@ly.com
- 创建时间：2026-10-22 16:28:49
- 更新时间：2026-10-22 16:28:49
- tags：行程, 工具声明, 原生工具, 源码分析
- 源码基线：`8b50b039715c63568242a6c8ec1efebb3f46721b`
- 本地源码：`/Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022`

[TOC]

## 目录

- [A. 声明在哪里、怎样传给模型](#mechanism)
- [B. 默认注册的完整工具清单](#defaults)
- [C. 渠道、状态与技能怎样改变工具集](#conditions)
- [D. 全量声明索引](#inventory)
- [E. 每项工具的完整声明](#declarations)
- [F. 覆盖范围与验证边界](#scope)

相关文档：[真实行程生成流程](chat接口完整行程生成流程_20261022真实调用_DOC.md)、[系统提示词快照](chat接口系统提示词_20261022真实调用_DOC.md)。

<a id="mechanism"></a>

## A. 声明在哪里、怎样传给模型

工具的声明一般位于具体工具类的 `__str__()` 中，包含 `function.name`、`description`、`parameters`。`execute()` 实现真正的查询或业务动作；声明 JSON 不包含 Python 执行代码。模型只能返回要调用的名称和参数，再由后端执行。

| 环节 | 代码入口 | 作用 |
|---|---|---|
| 定义声明 | `app/routers/tools_v2/smart_search_tool.py:141` 等，逐项见 E 节 | `__str__()` 返回工具能力与参数 JSON |
| 建立名称 | `app/routers/tools_v2/agent_base_tool.py:22` | 从声明读取 `function.name`，保存为 `register_name` |
| 默认注册 | `app/routers/context/core_context.py:348` | 创建工具实例，写入 `ALL_TOOLS/NAME_2_TOOL` |
| 技能注入 | `app/routers/agent_loop/DT_agent_loop_v2.py:2635` | 按会话加载技能工具，同名覆盖全局工具 |
| 转换 schema | `app/routers/agent_loop/tool_schema_adapter.py:38`、`:56` | `json.loads(str(tool))`，补 function 外层，清洗 `int → integer`，构造 tools 列表 |
| 交给模型 | `app/routers/agent_loop/DT_agent_loop_v2.py:6195` | 将 `tools`、`tool_choice="auto"` 与 messages 一起传给模型调用包装层 |
| 组装 HTTP body | `app/routers/llm.py:288`、`:356` | 创建 model/messages/stream，再 `data.update(kwargs)` 合入 tools 等顶层字段 |
| 执行调用 | `app/routers/agent_loop/DT_agent_loop_v2.py:6730` 附近 | 解析 tool_calls 的 arguments，在 NAME_2_TOOL 中按名称寻找并执行 |
| 回填结果 | `app/routers/agent_loop/DT_agent_loop_v2.py:7019` | 加入 role:tool 和 tool_call_id，让下一轮模型读取结果 |

请求结构示意（省略具体提示词与其他工具，不是历史 HTTP 原包）：

```json
{
  "model": "deepseek-v4.1-flash",
  "messages": [
    {"role": "system", "content": "系统提示词"},
    {"role": "user", "content": "用户需求"}
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "web_search",
        "description": "工具能力与限制，全文见 E 节",
        "parameters": {
          "type": "object",
          "properties": {"query": {"type": "string"}},
          "required": ["query"]
        }
      }
    }
  ],
  "tool_choice": "auto",
  "stream": true
}
```

**messages 是对话内容，tools 是工具声明，二者是模型请求的并列字段。** system 中关于何时搜索的规则不能替代 tools 的参数 schema。

<a id="defaults"></a>

## B. 默认注册的完整工具清单

以下 11 项来自 `AgentCoreContext._initialize_tools_and_agents()` 的默认 ALL_TOOLS，随后仍会经过渠道策略过滤。它是源码注册基线，不是声称这次 HTTP 请求恰好只发送了这 11 项；客服 Agent、会话技能、状态切换等还会改变实际列表。

| 序号 | 给模型的名称 | 实现类 | 声明位置 | 完整声明 |
|---|---|---|---|---|
| 1 | `search_hotel` | `hotel_search_tool` | [app/routers/tools_v2/hotel_search_tool.py:378](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/hotel_search_tool.py:378>) | [T01](#tool-01) |
| 2 | `search_hotel_detail_by_id` | `hotel_detail_tool` | [app/routers/tools_v2/hotel_detail_tool.py:105](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/hotel_detail_tool.py:105>) | [T02](#tool-02) |
| 3 | `get_train_schedule` | `get_train_schedule` | [app/routers/tools_v2/train_schedule_tool.py:161](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/train_schedule_tool.py:161>) | [T03](#tool-03) |
| 4 | `search_transit` | `search_transit_tool` | [app/routers/tools_v2/search_transit_tool.py:4216](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/search_transit_tool.py:4216>) | [T04](#tool-04) |
| 5 | `search_flight_card` | `FlightCardTool` | [app/routers/tools_v2/flight_card_tool.py:87](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/flight_card_tool.py:87>) | [T05](#tool-05) |
| 6 | `poi_search` | `poi_search_tool` | [app/routers/tools_v2/poi_search_tool.py:578](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/poi_search_tool.py:578>) | [T06](#tool-06) |
| 7 | `get_weather_info` | `get_weather_info` | [app/routers/tools_v2/weather_tool.py:276](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/weather_tool.py:276>) | [T07](#tool-07) |
| 8 | `web_search` | `smart_search_tool` | [app/routers/tools_v2/smart_search_tool.py:141](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/smart_search_tool.py:141>) | [T08](#tool-08) |
| 9 | `flight_dynamic` | `flight_dynamic_tool` | [app/routers/tools_v2/flight_dynamic_tool.py:513](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/flight_dynamic_tool.py:513>) | [T09](#tool-09) |
| 10 | `food_search` | `food_search_tool` | [app/routers/tools_v2/food_search_tool.py:452](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/food_search_tool.py:452>) | [T10](#tool-10) |
| 11 | `shopping_search` | `shopping_search_tool` | [app/routers/tools_v2/shopping_search_tool.py:2628](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/shopping_search_tool.py:2628>) | [T11](#tool-11) |

`hotel_search_tool` 经 `_singletons.get_hotel_search_tool()` 创建。默认 `web_search` 对应 `smart_search_tool.py`，不是同目录下另一个同名声明 `web_search_tool.py`。默认工具列表确实包含酒店、交通等工具，但本次真实请求只调用了 `web_search`；“可声明”与“本轮实际调用”不同。

<a id="conditions"></a>

## C. 渠道、状态与技能怎样改变工具集

| 条件或入口 | 源码行为 | 应怎样理解 |
|---|---|---|
| sub_channel 为 B15_FLIGHT_PAGE | `tool_allowed()` 过滤 `search_flight_card` | 声明存在但该渠道不可用 |
| MAIN_MINI/PRIVATE_DOMAIN_WX_ASSISTANT/TC_APP/APPLET/PC 等，且 available_agents 含 customer_agent | 加入 `customer_service_agent` | 不是所有会话都注册客服子 Agent |
| SU_ZHOU | 替换 sight_recommend，并追加 activity_search | 当前默认 ALL_TOOLS 没有 sight_recommend，不能据“替换语句”认定此分支一定发送它；activity_search 有明确追加 |
| inspiration 模式更新工具 | 列表改为 smart_search | 此状态不会保留完整默认 11 工具 |
| travel_plan_loop 的 search_state | hotel/traffic/sight/news 四类网页工具＋天气 | 专用状态列表，不等于这次 DEFAULT_STATE 流程 |
| travel_plan_loop 的 route_state | travel_web_search | 同上 |
| product_plan_loop | 酒店、综合交通、机票次卡三项，再做渠道过滤 | 同上 |
| 技能目录 tools/ | `_inject_skill_tools()` 加入当前 context；同名覆盖 | 只影响当前会话工具列表；技能未激活时不能称已发送 |
| 演唱会酒店技能，且历史已有 web_search | 主循环过滤后续 web_search | 不保证每一轮 tools 列表完全相同 |
| `_fast_final_answer` | 主循环令工具列表为空 | 该分支不继续提供原生工具选择 |
| 动态 McpTool | 从 MCP 注册信息读取名称、描述和 schema，再包装成 function | 运行时目录不属于本地静态枚举；模板见 E 节 |

同名声明不能混用：本文件分别记录 `web_search` 的 smart/旧网页实现、多个 `search_hotel`、多个 `get_train_schedule`、两个 `sight_recommend`，用“源码位置＋实现类”区分。

<a id="inventory"></a>

## D. 全量声明索引

本基线的工具实现与子 Agent 工具目录共找到 62 个具体类的 `__str__()` 声明入口（不数抽象 BaseTool）。索引列出全部入口，备份文件单独标识；不能把这些入口合起来称为本次发送给主模型的 tools 数量。

| 编号 | 声明的工具名称或动态类 | 范围 | 声明源码 | 完整内容 |
|---|---|---|---|---|
| T01 | `search_hotel` | 默认注册 | [app/routers/tools_v2/hotel_search_tool.py:378](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/hotel_search_tool.py:378>) | [展开](#tool-01) |
| T02 | `search_hotel_detail_by_id` | 默认注册 | [app/routers/tools_v2/hotel_detail_tool.py:105](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/hotel_detail_tool.py:105>) | [展开](#tool-02) |
| T03 | `get_train_schedule` | 默认注册 | [app/routers/tools_v2/train_schedule_tool.py:161](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/train_schedule_tool.py:161>) | [展开](#tool-03) |
| T04 | `search_transit` | 默认注册 | [app/routers/tools_v2/search_transit_tool.py:4216](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/search_transit_tool.py:4216>) | [展开](#tool-04) |
| T05 | `search_flight_card` | 默认注册 | [app/routers/tools_v2/flight_card_tool.py:87](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/flight_card_tool.py:87>) | [展开](#tool-05) |
| T06 | `poi_search` | 默认注册 | [app/routers/tools_v2/poi_search_tool.py:578](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/poi_search_tool.py:578>) | [展开](#tool-06) |
| T07 | `get_weather_info` | 默认注册 | [app/routers/tools_v2/weather_tool.py:276](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/weather_tool.py:276>) | [展开](#tool-07) |
| T08 | `web_search` | 默认注册 | [app/routers/tools_v2/smart_search_tool.py:141](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/smart_search_tool.py:141>) | [展开](#tool-08) |
| T09 | `flight_dynamic` | 默认注册 | [app/routers/tools_v2/flight_dynamic_tool.py:513](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/flight_dynamic_tool.py:513>) | [展开](#tool-09) |
| T10 | `food_search` | 默认注册 | [app/routers/tools_v2/food_search_tool.py:452](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/food_search_tool.py:452>) | [展开](#tool-10) |
| T11 | `shopping_search` | 默认注册 | [app/routers/tools_v2/shopping_search_tool.py:2628](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/shopping_search_tool.py:2628>) | [展开](#tool-11) |
| T12 | `web_search_fast` | 其他入口或条件注册 | [app/routers/tools_v2/baidu_web_search_tool.py:106](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/baidu_web_search_tool.py:106>) | [展开](#tool-12) |
| T13 | `search_concert` | 其他入口或条件注册 | [app/routers/tools_v2/concert_search_tool.py:189](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/concert_search_tool.py:189>) | [展开](#tool-13) |
| T14 | `customer_service_agent` | 其他入口或条件注册 | [app/routers/tools_v2/customer_service_agent.py:162](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/customer_service_agent.py:162>) | [展开](#tool-14) |
| T15 | `dest_recommend` | 其他入口或条件注册 | [app/routers/tools_v2/dest_recommend_tool.py:238](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/dest_recommend_tool.py:238>) | [展开](#tool-15) |
| T16 | `destination_recommend` | 其他入口或条件注册 | [app/routers/tools_v2/destination_recommend_tool.py:270](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/destination_recommend_tool.py:270>) | [展开](#tool-16) |
| T17 | `search_flight` | 其他入口或条件注册 | [app/routers/tools_v2/flight_search_tool.py:566](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/flight_search_tool.py:566>) | [展开](#tool-17) |
| T18 | `hotel_agent` | 其他入口或条件注册 | [app/routers/tools_v2/hotel_agent.py:51](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/hotel_agent.py:51>) | [展开](#tool-18) |
| T19 | `search` | 其他入口或条件注册 | [app/routers/tools_v2/hotel_fast_search_tool.py:117](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/hotel_fast_search_tool.py:117>) | [展开](#tool-19) |
| T20 | `hotel_search_web_info` | 其他入口或条件注册 | [app/routers/tools_v2/hotel_web_search_tool.py:60](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/hotel_web_search_tool.py:60>) | [展开](#tool-20) |
| T21 | `fetch_info` | 其他入口或条件注册 | [app/routers/tools_v2/info_fetch_tool.py:241](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/info_fetch_tool.py:241>) | [展开](#tool-21) |
| T22 | `local_activity_tool` | 其他入口或条件注册 | [app/routers/tools_v2/local_activity_tool.py:202](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/local_activity_tool.py:202>) | [展开](#tool-22) |
| T23 | `search_recent_activity` | 其他入口或条件注册 | [app/routers/tools_v2/new_year_tool.py:84](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/new_year_tool.py:84>) | [展开](#tool-23) |
| T24 | `news_search_web_info` | 其他入口或条件注册 | [app/routers/tools_v2/news_web_search_tool.py:76](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/news_web_search_tool.py:76>) | [展开](#tool-24) |
| T25 | `scenic_crowd_tool` | 其他入口或条件注册 | [app/routers/tools_v2/scenic_crowd_tool.py:291](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/scenic_crowd_tool.py:291>) | [展开](#tool-25) |
| T26 | `search_hot_spots` | 其他入口或条件注册 | [app/routers/tools_v2/search_hot_spots_tool.py:397](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/search_hot_spots_tool.py:397>) | [展开](#tool-26) |
| T27 | `search` | 其他入口或条件注册 | [app/routers/tools_v2/search_tool.py:124](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/search_tool.py:124>) | [展开](#tool-27) |
| T28 | `sight_recommend` | 其他入口或条件注册 | [app/routers/tools_v2/sight_recommend_tool.py:352](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/sight_recommend_tool.py:352>) | [展开](#tool-28) |
| T29 | `sight_search_web_info` | 其他入口或条件注册 | [app/routers/tools_v2/sight_web_search_tool.py:121](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/sight_web_search_tool.py:121>) | [展开](#tool-29) |
| T30 | `amap_transit_search` | 其他入口或条件注册 | [app/routers/tools_v2/small_transit/amap_transit_search_tool.py:301](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/small_transit/amap_transit_search_tool.py:301>) | [展开](#tool-30) |
| T31 | `bus_search_tool` | 其他入口或条件注册 | [app/routers/tools_v2/small_transit/bus_search_tool.py:746](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/small_transit/bus_search_tool.py:746>) | [展开](#tool-31) |
| T32 | `drive_search` | 其他入口或条件注册 | [app/routers/tools_v2/small_transit/drive_search_tool.py:574](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/small_transit/drive_search_tool.py:574>) | [展开](#tool-32) |
| T33 | `smart_search_flash` | 其他入口或条件注册 | [app/routers/tools_v2/smart_search_flash_tool.py:220](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/smart_search_flash_tool.py:220>) | [展开](#tool-33) |
| T34 | `sight_recommend` | 其他入口或条件注册 | [app/routers/tools_v2/suzhou_tool.py:159](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/suzhou_tool.py:159>) | [展开](#tool-34) |
| T35 | `activity_search` | 其他入口或条件注册 | [app/routers/tools_v2/suzhou_tool.py:352](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/suzhou_tool.py:352>) | [展开](#tool-35) |
| T36 | `traffic_search_web_info` | 其他入口或条件注册 | [app/routers/tools_v2/traffic_web_search_tool.py:64](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/traffic_web_search_tool.py:64>) | [展开](#tool-36) |
| T37 | `search_train` | 其他入口或条件注册 | [app/routers/tools_v2/train_search_tool.py:566](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/train_search_tool.py:566>) | [展开](#tool-37) |
| T38 | `search_transfer_plan` | 其他入口或条件注册 | [app/routers/tools_v2/transfer_plan_tool.py:214](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/transfer_plan_tool.py:214>) | [展开](#tool-38) |
| T39 | `travel_route_recommend` | 其他入口或条件注册 | [app/routers/tools_v2/travel_route_recommend_tool.py:499](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/travel_route_recommend_tool.py:499>) | [展开](#tool-39) |
| T40 | `search_travel_web_info` | 其他入口或条件注册 | [app/routers/tools_v2/travel_web_search_tool.py:45](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/travel_web_search_tool.py:45>) | [展开](#tool-40) |
| T41 | `deeptrip_memory_query` | 其他入口或条件注册 | [app/routers/tools_v2/user_all_features_tool.py:159](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/user_all_features_tool.py:159>) | [展开](#tool-41) |
| T42 | `user_profile` | 其他入口或条件注册 | [app/routers/tools_v2/user_profile_tool.py:236](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/user_profile_tool.py:236>) | [展开](#tool-42) |
| T43 | `web_knowledge_agent` | 其他入口或条件注册 | [app/routers/tools_v2/web_knowledge_agent.py:210](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/web_knowledge_agent.py:210>) | [展开](#tool-43) |
| T44 | `web_search_flash` | 其他入口或条件注册 | [app/routers/tools_v2/web_search_flash_tool.py:166](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/web_search_flash_tool.py:166>) | [展开](#tool-44) |
| T45 | `web_search` | 其他入口或条件注册 | [app/routers/tools_v2/web_search_tool.py:290](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/web_search_tool.py:290>) | [展开](#tool-45) |
| T46 | `query_user_benefits` | 技能扩展 | [app/routers/deeptrip_skills/benefit_search/tools/user_benefits_tool.py:42](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/deeptrip_skills/benefit_search/tools/user_benefits_tool.py:42>) | [展开](#tool-46) |
| T47 | `hotel_search_by_position_tool` | 子Agent内部工具 | [app/routers/subagents/hotel_agent/tools_v2/hotel_search_tools.py:1140](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/hotel_agent/tools_v2/hotel_search_tools.py:1140>) | [展开](#tool-47) |
| T48 | `search_hotel_by_lat_lng` | 子Agent内部工具 | [app/routers/subagents/hotel_agent/tools_v2/hotel_search_tools.py:1311](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/hotel_agent/tools_v2/hotel_search_tools.py:1311>) | [展开](#tool-48) |
| T49 | `hotel_recommend` | 子Agent内部工具 | [app/routers/subagents/hotel_agent/tools_v2/hotel_search_tools.py:1877](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/hotel_agent/tools_v2/hotel_search_tools.py:1877>) | [展开](#tool-49) |
| T50 | `amap_poi_search` | 子Agent内部工具 | [app/routers/subagents/traffic_agent/tools_v2/amap_poi_search_tool.py:167](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/amap_poi_search_tool.py:167>) | [展开](#tool-50) |
| T51 | `construct_transfer_tool` | 子Agent内部工具 | [app/routers/subagents/traffic_agent/tools_v2/construct_transfer_tool.py:631](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/construct_transfer_tool.py:631>) | [展开](#tool-51) |
| T52 | `flight_search_by_id_tool` | 子Agent内部工具 | [app/routers/subagents/traffic_agent/tools_v2/flight_search_by_id_tool.py:487](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/flight_search_by_id_tool.py:487>) | [展开](#tool-52) |
| T53 | `flight_search_tool` | 子Agent内部工具 | [app/routers/subagents/traffic_agent/tools_v2/flight_search_tool.py:1946](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/flight_search_tool.py:1946>) | [展开](#tool-53) |
| T54 | `google_poi_search` | 子Agent内部工具 | [app/routers/subagents/traffic_agent/tools_v2/google_poi_search_tool.py:155](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/google_poi_search_tool.py:155>) | [展开](#tool-54) |
| T55 | `route_search` | 子Agent内部工具 | [app/routers/subagents/traffic_agent/tools_v2/route_search_tool.py:627](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/route_search_tool.py:627>) | [展开](#tool-55) |
| T56 | `get_train_schedule` | 子Agent内部工具 | [app/routers/subagents/traffic_agent/tools_v2/train_schedule_tool.py:224](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/train_schedule_tool.py:224>) | [展开](#tool-56) |
| T57 | `train_search_tool` | 子Agent内部工具 | [app/routers/subagents/traffic_agent/tools_v2/train_search_tool.py:1706](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/train_search_tool.py:1706>) | [展开](#tool-57) |
| T58 | `transport_hub_search` | 子Agent内部工具 | [app/routers/subagents/traffic_agent/tools_v2/transport_hub_search_tool.py:814](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/transport_hub_search_tool.py:814>) | [展开](#tool-58) |
| T59 | `McpTool` | 动态MCP | [app/routers/tools_v2/mcp_tool.py:188](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/mcp_tool.py:188>) | [展开](#tool-59) |
| T60 | `search_hotel` | 备份文件 | [app/routers/tools_v2/hotel_search_tool_backup.py:813](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/hotel_search_tool_backup.py:813>) | [展开](#tool-60) |
| T61 | `search_transit` | 备份文件 | [app/routers/tools_v2/search_transit_tool_bak.py:1009](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/search_transit_tool_bak.py:1009>) | [展开](#tool-61) |
| T62 | `transport_hub_search` | 备份文件 | [app/routers/subagents/traffic_agent/tools_v2/transport_hub_search_tool copy.py:813](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/transport_hub_search_tool copy.py:813>) | [展开](#tool-62) |

<a id="declarations"></a>

## E. 每项工具的完整声明

以下 JSON 从声明方法静态提取，并按 tool_schema_adapter 的方式统一 function 外层及 type=int 字段；描述、参数说明、枚举、默认值和 required 均保留。此处不导入业务模块、不实例化工具，也不访问远程接口。不能静态还原的入口保留完整声明方法源码和原因。

<a id="tool-01"></a>

### T01 `search_hotel` — `hotel_search_tool`

- 分类：默认注册。
- 声明：[app/routers/tools_v2/hotel_search_tool.py:378](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/hotel_search_tool.py:378>)。
- 执行入口：[app/routers/tools_v2/hotel_search_tool.py:168](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/hotel_search_tool.py:168>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "search_hotel",
    "description": "酒店搜索工具，结构化输入。能力包括：城市范围搜索、位置关键词（如西湖、国贸）、价格与设施筛选（五星、免费wifi、泳池等）、入住离店日期、国内外酒店。至少提供 city/region 或 preference。",
    "parameters": {
      "type": "object",
      "properties": {
        "country": {
          "type": "string",
          "description": "必填参数，国家，默认中国"
        },
        "region": {
          "type": "string",
          "description": "必填参数，省/州/区域，如浙江省、北京市"
        },
        "city": {
          "type": "string",
          "description": "必填参数，城市名，如杭州、北京"
        },
        "checkInDate": {
          "type": "string",
          "description": "必填参数，入住日期，公历 YYYY-MM-DD。当 has_user_specific_date=true 时填用户明确给出的具体日期（「下周」「月底」等模糊表达需由你转换为具体日期），不传则默认明天；当 has_user_specific_date=false 时必须填空字符串，禁止填今天/明天/后天等任何推测日期"
        },
        "checkOutDate": {
          "type": "string",
          "description": "必填参数，离店日期，公历 YYYY-MM-DD。当 has_user_specific_date=true 时填用户明确给出的具体日期，不传则默认后天；当 has_user_specific_date=false 时必须填空字符串"
        },
        "positionKeyword": {
          "type": "string",
          "description": "必填参数，用户期望入住的酒店所在位置，如西湖、国贸、外滩、黄山山顶, 无则填空字符串"
        },
        "hotelNameKeyword": {
          "type": "string",
          "description": "选填参数，酒店名称、品牌或明确酒店类型关键词，如希尔顿、水屋；无则填空字符串"
        },
        "preference": {
          "type": "string",
          "description": "必填参数，任何住宿偏好描述都可以放在这里，如 看日出、靠近景区、海景、亲子、五星/豪华、免费wifi、度假、预算500以下、早饭好吃等"
        },
        "has_user_specific_date": {
          "type": "boolean",
          "description": "用户是否在输入中明确指定了入住日期或时间范围。判断规则：只要用户提到任何时间表达（具体日期「2026-07-15」、模糊时段「七月」「下周」「月底」「周末」「明天」「后天」等）就填 true；只有用户完全没有提及任何时间信息才填 false。选填参数，不填默认 true。当为 false 时 checkInDate/checkOutDate 必须填空字符串，后端会返回近期多日数据供参考"
        }
      },
      "required": [
        "country",
        "region",
        "city",
        "checkInDate",
        "checkOutDate",
        "positionKeyword",
        "preference"
      ]
    }
  }
}
```

</details>

<a id="tool-02"></a>

### T02 `search_hotel_detail_by_id` — `hotel_detail_tool`

- 分类：默认注册。
- 声明：[app/routers/tools_v2/hotel_detail_tool.py:105](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/hotel_detail_tool.py:105>)。
- 执行入口：[app/routers/tools_v2/hotel_detail_tool.py:41](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/hotel_detail_tool.py:41>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "search_hotel_detail_by_id",
    "description": "根据酒店id搜索一个酒店的详细信息,注意不要在对话文本中调用。如有搜索结果中已经有了酒店信息，没有必要再调用这个工具。",
    "parameters": {
      "type": "object",
      "properties": {
        "hotelIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "要查询的酒店ID列表，酒店ID是酒店的唯一标识，可以在酒店搜索结果中找到"
        }
      },
      "required": [
        "hotelIds"
      ]
    }
  }
}
```

</details>

<a id="tool-03"></a>

### T03 `get_train_schedule` — `get_train_schedule`

- 分类：默认注册。
- 声明：[app/routers/tools_v2/train_schedule_tool.py:161](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/train_schedule_tool.py:161>)。
- 执行入口：[app/routers/tools_v2/train_schedule_tool.py:112](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/train_schedule_tool.py:112>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "get_train_schedule",
    "description": "查询特定列车班次的详细时刻表，需同时提供班次号和出发日期，只有在用户想了解某个班次的时刻表的时候才调用，查交通不要调用这个工具",
    "parameters": {
      "type": "object",
      "properties": {
        "trainNo": {
          "type": "string",
          "description": "列车班次号（必须参数），例如G103/Z281/T109/D17"
        },
        "depDate": {
          "type": "string",
          "description": "列车出发日期（必须参数），格式yyyy-mm-dd，用于确定当日运行时刻表，如果用户没有指明具体时间，默认填写明天的时间"
        }
      },
      "required": [
        "trainNo",
        "depDate"
      ]
    }
  }
}
```

</details>

<a id="tool-04"></a>

### T04 `search_transit` — `search_transit_tool`

- 分类：默认注册。
- 声明：[app/routers/tools_v2/search_transit_tool.py:4216](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/search_transit_tool.py:4216>)。
- 执行入口：[app/routers/tools_v2/search_transit_tool.py:269](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/search_transit_tool.py:269>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "search_transit",
    "description": "单程交通路线和产品搜索工具，支持飞机、火车、大巴、自驾、公交地铁等交通方式；也支持查询指定车次在指定日期的时刻表、经停站、到站和发车时间。支持使用自然语言查询具体约束，包括出发地、目的地、日期、机场或车站、出发/到达时间、价格、直达/中转、舱位/席别、机型及服务设施等。请在 tool_query 中完整保留用户的查询条件和排序意图；用户明确指定排序方式时按其要求排序，未指定排序方式时优先按价格升序。往返行程需拆分为两个单程查询。",
    "parameters": {
      "type": "object",
      "properties": {
        "tool_query": {
          "type": "string",
          "description": "交通查询需求描述,以自然语言表达。如'下周三从北京去上海,看看机票和自驾方案'、'北京西单到东直门坐地铁'、'成都到重庆大巴'"
        },
        "has_user_specific_date": {
          "type": "boolean",
          "description": "用户是否在输入中明确指定了出行日期或时间范围（注意不是你自己的推理日期）。判断规则:只要用户提到任何时间表达(具体日期「2026-07-15」、模糊时段「七月」「下周」「月底」「周末」「明天」「后天」等)就填 true;只有用户完全没有提及任何时间信息才填 false。选填参数,不填默认 true。当为 false 时 date 必须填空字符串,后端会返回近期多日数据供参考"
        }
      },
      "required": [
        "tool_query"
      ]
    }
  }
}
```

</details>

<a id="tool-05"></a>

### T05 `search_flight_card` — `FlightCardTool`

- 分类：默认注册。
- 声明：[app/routers/tools_v2/flight_card_tool.py:87](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/flight_card_tool.py:87>)。
- 执行入口：[app/routers/tools_v2/flight_card_tool.py:109](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/flight_card_tool.py:109>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "search_flight_card",
    "description": "查询机票次卡产品、产品规则或当前用户订单。接收完整自然语言 query。",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "机票次卡查询需求"
        }
      },
      "required": [
        "query"
      ]
    }
  }
}
```

</details>

<a id="tool-06"></a>

### T06 `poi_search` — `poi_search_tool`

- 分类：默认注册。
- 声明：[app/routers/tools_v2/poi_search_tool.py:578](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/poi_search_tool.py:578>)。
- 执行入口：[app/routers/tools_v2/poi_search_tool.py:82](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/poi_search_tool.py:82>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "poi_search",
    "description": "实体商户/设施搜索工具，在指定城市的位置、经纬度搜索实体商户或公共设施，返回名称、地址、评分、距离等结构化列表。支持四大类POI：美食、购物、生活服务、交通设施。不适用于：景点/酒店/交通线路/货币兑换查询，以及无法用商户名称匹配的抽象概念（如攻略、玩法、机位等）",
    "parameters": {
      "type": "object",
      "properties": {
        "country": {
          "type": "string",
          "description": "国家，目标poi搜索所在国家名，如：中国、美国"
        },
        "city": {
          "type": "string",
          "description": "城市，目标poi搜索所在城市名，如：北京，纽约"
        },
        "location": {
          "type": "string",
          "description": "可选, 所在城市下的具体位置，格式为 区县/具体位置，（越详细越好，如：武侯区/火车南站），或经纬度（如：39.90872,116.39748）。多轮查询时应基于上一轮搜索结果，而不是用户位置"
        },
        "latitude": {
          "type": "number",
          "description": "可选，纬度（如：39.90872）。如果外部提供了经纬度，优先使用，跳过location地址解析。"
        },
        "longitude": {
          "type": "number",
          "description": "可选，经度（如：116.39748）。如果外部提供了经纬度，优先使用，跳过location地址解析。"
        },
        "coordinateType": {
          "type": "string",
          "enum": [
            "gcj02",
            "wgs84",
            "bd09ll"
          ],
          "description": "可选，经纬度的坐标系类型，默认gcj02。仅在使用latitude/longitude时有效"
        },
        "query": {
          "type": "string",
          "description": "POI搜索的自然语言描述，如'高端餐厅'、'便宜好吃的火锅'、'24小时便利店'、'地铁站'、'适合拍照的咖啡店'等，支持语义化搜索"
        }
      },
      "required": [
        "country",
        "city",
        "query"
      ]
    }
  }
}
```

</details>

<a id="tool-07"></a>

### T07 `get_weather_info` — `get_weather_info`

- 分类：默认注册。
- 声明：[app/routers/tools_v2/weather_tool.py:276](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/weather_tool.py:276>)。
- 执行入口：[app/routers/tools_v2/weather_tool.py:211](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/weather_tool.py:211>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "get_weather_info",
    "description": "查询天气信息，只有用户明确查询天气的时候才调用该工具，其他时候不要主动调用。",
    "parameters": {
      "type": "object",
      "properties": {
        "city": {
          "type": "string",
          "description": "城市名称（必填参数），此处填入用户查询天气时所指定的城市，如果用户没有指定城市，默认用户所在城市。"
        },
        "date": {
          "type": "string",
          "description": "日期（必填参数），格式yyyy-mm-dd，此处填入用户查询天气时所指定的日期，如果用户没有指定日期，默认明天。可以填入同时填入多个日期，不同日期之间用“/”分隔。"
        },
        "positionKeyword": {
          "type": "string",
          "description": "查询位置关键词（非必填参数），此处填入用户查询天气时所指定的地点。"
        }
      },
      "required": [
        "city",
        "date"
      ]
    }
  }
}
```

</details>

<a id="tool-08"></a>

### T08 `web_search` — `smart_search_tool`

- 分类：默认注册。
- 声明：[app/routers/tools_v2/smart_search_tool.py:141](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/smart_search_tool.py:141>)。
- 执行入口：[app/routers/tools_v2/smart_search_tool.py:32](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/smart_search_tool.py:32>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "web_search",
    "description": "智能搜索工具，支持联网搜索、旅行知识库、国内/海外地图文字搜索及同程景区权威详情查询。明确景区名称和城市时，可查询景区业务接口返回的地址、开放时间、营业状态、票种价格、可预订日期列表及近期动态；该来源优先于RAG中的景区POI。动态仅在接口实际返回时提供，营业时间须看适用日期；不支持景区泛推荐、指定日期余票或成交价验证、预订。可查旅游攻略、景点介绍、交通指南、城市内指定地点的名称和地址，或某地标周边餐厅、咖啡店、景点等候选。地图查询使用自然语言，需明确国家和城市；周边查询还需具体地标、分店名或文字地址，可从明确上下文补齐。支持类别、口味、亲子等文字偏好，但不保证严格筛选；评分、价格参考、营业时间仅在地图返回相关字段时提供。地图文字搜索不支持经纬度输入或生成、精确半径/距离过滤、保证最近或距离排序、路线导航、步行/驾车时长过滤、严格价格/评分筛选、实时营业验证。不支持实时酒店房价房态、机票/火车票库存、预订或指定列车时刻表，这些请使用专用工具；酒店知识库信息不是实时产品。例：查询中国苏州的苏州博物馆本馆周边咖啡店；查询法国巴黎卢浮宫的地址。缺少位置、地点有歧义或要求不支持时，会返回原因和具体修改建议；混合任务会保留成功结果并说明未完成部分。请按反馈补充信息或选择可接受的查询条件，不能猜测位置、自动放宽硬性要求或将未验证条件当成已满足。",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "自然语言搜索需求，可包含多个独立问题。景区业务查询需明确城市和景区名称，可提供已知同程景区resId。地图查询写明国家、城市、地点/类别；周边查询补充明确中心地标或文字地址。保留用户的硬性约束，不要自行转换成经纬度。"
        },
        "generate_answer": {
          "type": "boolean",
          "description": "是否返回统一回答。true时返回基于全部筛选结果生成的一份完整回答；false时按搜索结果逐条返回标题、摘要等分项内容。默认true",
          "default": true
        },
        "answer_reference_detail": {
          "type": "string",
          "description": "统一回答中参考资料的详细程度，资料编号与回答正文中的[资料N]一一对应。basic返回每条资料的标题、来源和链接；full在此基础上还返回经筛选后的正文内容（启用单条摘要时为摘要后的内容），便于核验或继续使用。仅在generate_answer为true时生效，默认full",
          "enum": [
            "basic",
            "full"
          ],
          "default": "full"
        }
      },
      "required": [
        "query"
      ]
    }
  }
}
```

</details>

<a id="tool-09"></a>

### T09 `flight_dynamic` — `flight_dynamic_tool`

- 分类：默认注册。
- 声明：[app/routers/tools_v2/flight_dynamic_tool.py:513](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/flight_dynamic_tool.py:513>)。
- 执行入口：[app/routers/tools_v2/flight_dynamic_tool.py:36](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/flight_dynamic_tool.py:36>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "flight_dynamic",
    "description": "查询指定航班的实时动态。用户询问航班状态、延误、是否起飞/落地、计划/预计/实际起降时间、航站楼、值机柜台、登机口、登机状态、行李转盘、免费行李额、手提/托运行李、天气或舒适度时必须调用。不要用 search_transit 替代。",
    "parameters": {
      "type": "object",
      "properties": {
        "flightNo": {
          "type": "string",
          "description": "航班号，必填，例如 MU5557。"
        },
        "flightDate": {
          "type": "string",
          "description": "航班日期，yyyy-MM-dd；仅当 has_user_specific_date=true 时填写。用户未明确提日期时必须填空字符串。"
        },
        "has_user_specific_date": {
          "type": "boolean",
          "description": "用户是否明确指定了航班日期或时间表达。用户给出具体日期、明天、下周等任何时间表达时为 true；完全未提时间时为 false。选填，未传默认 false。为 false 时 flightDate 必须填空字符串，工具会查询未来7天。"
        },
        "depPortCode": {
          "type": "string",
          "description": "出发机场三字码，可选，例如 PVG。"
        },
        "arrPortCode": {
          "type": "string",
          "description": "到达机场三字码，可选，例如 TFU。"
        },
        "orderSerialNo": {
          "type": "string",
          "description": "订单流水号，可选，仅在用户上下文已有时传入。"
        }
      },
      "required": [
        "flightNo"
      ]
    }
  }
}
```

</details>

<a id="tool-10"></a>

### T10 `food_search` — `food_search_tool`

- 分类：默认注册。
- 声明：[app/routers/tools_v2/food_search_tool.py:452](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/food_search_tool.py:452>)。
- 执行入口：[app/routers/tools_v2/food_search_tool.py:594](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/food_search_tool.py:594>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "food_search",
    "description": "网页证据优先的美食候选工具；网页不可用时才降级为LLM知识候选，不查询POI、地图或其它业务数据。以下情况应调用：用户明确询问某地美食、餐厅、菜品或用餐建议；生成完整日程或多日行程且需要具名餐饮候选；检查、替换或优化已有行程中的餐饮安排。纯交通、酒店、门票或景点详情且没有餐饮意图时不要调用；用户明确不要餐饮时不要调用；无法从当前请求和上下文确定城市或可理解的文本位置时不要调用，改为询问地点。food_search提供结构化餐厅候选，不替代web_search；不得因为已经调用food_search，就停止完成用户需求所需的网页搜索。美食泛推荐、攻略、街区吃法和行程中的餐饮需求，可以使用web_search补充当地吃法、特色菜、小吃街及有依据的餐厅；需要互补信息且查询条件已具备时，可与food_search同轮调用，不要求等待food_search完成。最终回答中的具名餐厅可来自当次food_search候选或当次web_search的有据结果，主Agent不得依靠自身知识补造。food_search失败、空结果或候选不足不代表没有合适餐厅：地点明确时允许网页补搜，地点不明时先澄清，两种工具都没有可用结果时再给一般用餐建议。已有信息足够回答具体门店问题时，不强制两种工具重复搜索。候选中的area_hint只能表述为待核实片区线索，并统一提示一次“餐厅及营业信息建议出行前核实”。poi_id是未来Provider提供的稳定来源ID，poi_id_namespace标识dianping、amap等ID命名空间；当前网页证据阶段二者仍必须为null，不得生成猜测ID，且不同Provider的ID不得视为等价。候选source只表示名称来自网页证据或LLM知识降级，不代表已取得真实点评、高德或实时POI数据。itinerary_context仅为后续能力预留，不支持顺路搜索，也不得据此调整候选或回答。候选rating和price_per_person固定为null，网页中的评分和价格线索不对外展示，也不做跨平台比较；返回结果为按现有字段逐行组织的候选文本，值为null的字段不展示；候选的clarifications为疑点提示数组，无提示时为空数组；不得补充营业时间、当前营业状态、精确地址、距离、耗时、联系方式、来源URL、导航或顺路结论；网页补搜结果不得冒充food_search已核实字段，其评分、人均等动态信息仍按本工具约束不对外展示；除web_search外，主Agent不得另行调用poi_search、SearchAgent、地图或其它业务Provider补充餐饮候选。",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "query": {
          "type": "string",
          "description": "用户本轮未经改写的原始餐饮或行程需求。"
        },
        "location": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "city": {
              "type": "string",
              "description": "候选城市硬边界，必填。"
            },
            "district": {
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ],
              "description": "用户明确提供的行政区，未指定时省略。"
            },
            "business_area": {
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ],
              "description": "用户明确提供的商圈，未指定时省略。"
            },
            "area_hint": {
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ],
              "description": "用户明确提供的地标、街区或附近位置等自由文本线索，未指定时省略。"
            },
            "latitude": {
              "anyOf": [
                {
                  "type": "number"
                },
                {
                  "type": "null"
                }
              ],
              "description": "预留坐标，本MVP不消费，未指定时省略。"
            },
            "longitude": {
              "anyOf": [
                {
                  "type": "number"
                },
                {
                  "type": "null"
                }
              ],
              "description": "预留坐标，本MVP不消费，未指定时省略。"
            }
          },
          "required": [
            "city"
          ]
        },
        "itinerary_context": {
          "anyOf": [
            {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "anchor_node": {
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ],
                  "description": "当前所在、刚结束或准备离开的行程节点，仅预留，未实现节点语义。"
                },
                "next_node": {
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ],
                  "description": "下一行程节点，仅预留，未实现节点语义。"
                }
              }
            },
            {
              "type": "null"
            }
          ],
          "description": "可选行程上下文，仅用于协议预留，不参与候选生成、过滤或排序。"
        },
        "constraints": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "category": {
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ],
              "description": "用户明确提出的自由文本品类原词，如本帮菜、火锅、小吃、甜品；未指定时省略或传null。"
            },
            "dish": {
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ],
              "description": "用户明确提出的菜品原词，未指定时省略或传null。"
            },
            "budget": {
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ],
              "description": "用户明确提出的预算原文，未指定时省略或传null。"
            },
            "dietary_restrictions": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "用户明确提出的饮食限制，未指定时传空数组。"
            }
          }
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10,
          "default": 5,
          "description": "候选数量，默认5，最大10。"
        }
      },
      "required": [
        "query",
        "location"
      ]
    }
  }
}
```

</details>

<a id="tool-11"></a>

### T11 `shopping_search` — `shopping_search_tool`

- 分类：默认注册。
- 声明：[app/routers/tools_v2/shopping_search_tool.py:2628](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/shopping_search_tool.py:2628>)。
- 执行入口：[app/routers/tools_v2/shopping_search_tool.py:509](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/shopping_search_tool.py:509>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "shopping_search",
    "description": "购物地点搜索工具，基于高德地图双路召回查询中国大陆的商场、商业街、品牌门店、食品特产店、市场、超市和便利店。本工具可与 web_search、poi_search 并行使用，不替代或屏蔽它们的能力。涉及指定地标附近分店、需要距离信息，或候选明显偏离目标区域时，可结合 poi_search 补充检索；候选列表不穷尽全部门店，未返回不代表不存在。其中扫街榜优先策略（strategy=1）仅表示召回排序偏好，不代表候选已上榜或有榜单名次。",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "用户完整购物需求，需保留原始表述中的城市、商圈、地标、品牌、商品、购物目的和限制条件，不要只提炼成一个品类词"
        },
        "country": {
          "type": "string",
          "description": "国家，目标购物搜索所在国家的中文名称，如：中国。当前仅支持中国"
        },
        "city": {
          "type": "string",
          "description": "目标城市，仅限中国大陆城市"
        },
        "latitude": {
          "type": "number",
          "description": "购物检索中心点纬度，GCJ-02坐标系。可选，必须和longitude同时提供；提供时以该点为中心按周边搜索，否则按城市范围搜索"
        },
        "longitude": {
          "type": "number",
          "description": "购物检索中心点经度，GCJ-02坐标系。可选，必须和latitude同时提供；提供时以该点为中心按周边搜索，否则按城市范围搜索"
        }
      },
      "required": [
        "query",
        "country",
        "city"
      ]
    }
  }
}
```

</details>

<a id="tool-12"></a>

### T12 `web_search_fast` — `baidu_web_search_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/baidu_web_search_tool.py:106](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/baidu_web_search_tool.py:106>)。
- 执行入口：[app/routers/tools_v2/baidu_web_search_tool.py:32](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/baidu_web_search_tool.py:32>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "web_search_fast",
    "description": "快速联网搜索工具。仅直接调用一次百度网页搜索，返回原始网页标题、摘要、来源和链接；不做查询改写、RAG、重排或大模型摘要。用于目的地攻略、景点开放信息和门票政策、活动演出、新闻动态、当地交通规则等需要公开网络信息的问题。禁止用于酒店、航班、火车、天气、POI 等已有专用实时工具覆盖的问题。",
    "parameters": {
      "type": "object",
      "required": [
        "search_keywords"
      ],
      "properties": {
        "search_keywords": {
          "type": "string",
          "description": "用于百度搜索的一条完整关键词，不要拆成多个查询。"
        },
        "count": {
          "type": "integer",
          "description": "返回结果数，默认 5，最大 10。",
          "default": 5
        },
        "freshness": {
          "type": "string",
          "enum": [
            "oneDay",
            "oneWeek",
            "oneMonth",
            "oneYear",
            "noLimit"
          ],
          "description": "网页时间范围，默认 noLimit。",
          "default": "noLimit"
        }
      }
    }
  }
}
```

</details>

<a id="tool-13"></a>

### T13 `search_concert` — `concert_search_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/concert_search_tool.py:189](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/concert_search_tool.py:189>)。
- 执行入口：[app/routers/tools_v2/concert_search_tool.py:43](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/concert_search_tool.py:43>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "search_concert",
    "description": "搜索演唱会信息，支持按艺人名称和演唱会名称进行搜索查询，搜索字段是 AND 的逻辑关系 ，这些字段是用es的全文检索进行搜索的 ，注意这个工具只能提供演唱会信息，不提供购票服务",
    "parameters": {
      "type": "object",
      "properties": {
        "starName": {
          "type": "string",
          "description": "艺人名称，支持单个艺人名称搜索，注意一定要用艺人的原名，如果是用户给的是艺人的昵称或别名，需要转换成艺人的原名"
        },
        "concertName": {
          "type": "string",
          "description": "演唱会名称，支持单个演唱会名称搜索"
        }
      },
      "required": []
    }
  }
}
```

</details>

<a id="tool-14"></a>

### T14 `customer_service_agent` — `customer_service_agent`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/customer_service_agent.py:162](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/customer_service_agent.py:162>)。
- 执行入口：[app/routers/tools_v2/customer_service_agent.py](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/customer_service_agent.py>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "customer_service_agent",
    "description": "智能客服代理，处理用户机票次卡业务以外所有的售后和订单相关问题。**凡是涉及订单问题、退款/多扣费、会员服务、发票物流、支付、人工客服、投诉等售后需求的，必须调用本 agent 转交处理——不要自己回答、不要给处理建议、不要提供客服电话/联系方式，直接转交给本 agent，由客服 agent 与用户多轮交互解决。** 不能处理：优惠券、deeptrip活动、机票次卡。",
    "parameters": {
      "type": "object",
      "required": [
        "task_desc",
        "type"
      ],
      "properties": {
        "task_desc": {
          "type": "string",
          "description": "用户具体的客服问题,需要基于上下文进行全面准确的描述,以用户第一人称描述"
        },
        "type": {
          "type": "string",
          "description": "用户具体的客服问题类型",
          "enum": [
            "订单问题",
            "订单查询",
            "订单咨询",
            "会员服务",
            "发票物流",
            "支付",
            "人工客服",
            "投诉",
            "其他"
          ]
        }
      }
    }
  }
}
```

</details>

<a id="tool-15"></a>

### T15 `dest_recommend` — `dest_recommend_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/dest_recommend_tool.py:238](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/dest_recommend_tool.py:238>)。
- 执行入口：[app/routers/tools_v2/dest_recommend_tool.py:84](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/dest_recommend_tool.py:84>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "dest_recommend",
    "description": "无目的地推荐工具，用户没有指定目的地，或者需要推荐目的地时使用，这个推荐的默认城市；用户希望海边城市、人文城市这种偏好时，该工具无法解决，请调用其他工具",
    "parameters": {
      "type": "object",
      "properties": {
        "originCitys": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "出发城市列表，如['成都']，1-3个之间"
        },
        "startDate": {
          "type": "string",
          "description": "开始日期，格式为YYYY-MM-DD，如'2025-10-25'"
        },
        "endDate": {
          "type": "string",
          "description": "结束日期，格式为YYYY-MM-DD，如'2025-11-14'"
        },
        "applyScenes": {
          "type": "string",
          "description": "应用场景，如'国内'、'国际'等，默认为'国内'"
        },
        "travelDays": {
          "type": "integer",
          "description": "旅行天数，默认为3天"
        },
        "travelType": {
          "type": "string",
          "description": "旅行类型，如'往返'、'单程'等，默认为'往返'"
        }
      },
      "required": [
        "originCitys",
        "startDate",
        "endDate"
      ]
    }
  }
}
```

</details>

<a id="tool-16"></a>

### T16 `destination_recommend` — `destination_recommend_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/destination_recommend_tool.py:270](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/destination_recommend_tool.py:270>)。
- 执行入口：[app/routers/tools_v2/destination_recommend_tool.py:169](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/destination_recommend_tool.py:169>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "destination_recommend",
    "description": "目的地推荐工具，根据用户查询和用户画像，推荐合适的景区和区域，包括POI列表和区域列表",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "rewrite之后的用户查询关键词或问题，如'四川有哪些景点'、'要山水'等"
        },
        "profile": {
          "type": "string",
          "description": "用户画像信息，用于个性化推荐（可选）"
        }
      },
      "required": [
        "query"
      ]
    }
  }
}
```

</details>

<a id="tool-17"></a>

### T17 `search_flight` — `flight_search_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/flight_search_tool.py:566](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/flight_search_tool.py:566>)。
- 执行入口：[app/routers/tools_v2/flight_search_tool.py:495](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/flight_search_tool.py:495>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "search_flight",
    "description": "查询飞机票信息的接口,尽量用startTime、endTime做更精确的查询。",
    "parameters": {
      "type": "object",
      "properties": {
        "fromCityName": {
          "type": "string",
          "description": "出发地城市名称，只能是城市级别，例如北京、上海、纽约、东京"
        },
        "toCityName": {
          "type": "string",
          "description": "到达城市名称，只能是城市级别，例如北京、上海、纽约、东京"
        },
        "depCountryZhName": {
          "type": "string",
          "description": "出发地国家名称，例如中国、美国"
        },
        "arrCountryZhName": {
          "type": "string",
          "description": "到达国家名称，例如英国、法国"
        },
        "depDate": {
          "type": "string",
          "description": "飞机出发日期，格式yyyy-mm-dd,如果没有确定就填写明天日期"
        },
        "startTime": {
          "type": "integer",
          "description": "出发时间范围起始点(范围0～24)，例如2 代表2:00以后出发的航班,只有startTime代表之选这个时间之后的航班,只有endTime代表之选这个时间之前的航班,两个参数都有代表查这个范围的航班"
        },
        "endTime": {
          "type": "integer",
          "description": "出发时间范围结束点(范围0～24)，例如18 代表18:00以前出发的航班"
        }
      },
      "required": [
        "fromCityName",
        "toCityName",
        "depDate"
      ]
    }
  }
}
```

</details>

<a id="tool-18"></a>

### T18 `hotel_agent` — `hotel_service_agent`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/hotel_agent.py:51](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/hotel_agent.py:51>)。
- 执行入口：[app/routers/tools_v2/hotel_agent.py](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/hotel_agent.py>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "hotel_agent",
    "description": "酒店专业agent，处理用户酒店相关的所有业务需求，包括：酒店推荐、酒店预定、酒店搜索、酒店详情询问。通过这个将用户需求dispatch给第三方酒店应用进行处理。",
    "parameters": {
      "type": "object",
      "required": [
        "task_desc"
      ],
      "properties": {
        "user_query": {
          "type": "string",
          "description": "用户当前的原始query"
        },
        "task_desc": {
          "type": "string",
          "description": "用户具体的酒店业务需求描述，需要基于对话历史进行全面客观的转述，以用户第一人称描述。例如：我想在北京预订一家4星级酒店，入住时间是2024-01-15，离店时间是2024-01-17。最好要有时间地点等参数条件，注意这个文本必须符合用户的原意，不可以进行任何猜测"
        }
      }
    }
  }
}
```

</details>

<a id="tool-19"></a>

### T19 `search` — `HotelFastSearchTool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/hotel_fast_search_tool.py:117](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/hotel_fast_search_tool.py:117>)。
- 执行入口：[app/routers/tools_v2/hotel_fast_search_tool.py:60](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/hotel_fast_search_tool.py:60>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "search",
    "description": "搜索酒店+web 信息。输入自然语言 query（如'福州海峡文化艺术中心附近可步行观演的酒店'），返回概要信息（地址解析、酒店分布）+ 按方向分组的酒店列表 + web 搜索结果摘要。当用户提到具体地标/场馆/景点或需要酒店推荐时调用。",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "自然语言搜索指令，应包含明确的地点（城市+地标/位置）和偏好（如步行可达、海景、性价比等）"
        }
      },
      "required": [
        "query"
      ]
    }
  }
}
```

</details>

<a id="tool-20"></a>

### T20 `hotel_search_web_info` — `hotel_web_search_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/hotel_web_search_tool.py:60](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/hotel_web_search_tool.py:60>)。
- 执行入口：[app/routers/tools_v2/hotel_web_search_tool.py:31](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/hotel_web_search_tool.py:31>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "hotel_search_web_info",
    "description": "该工具可以搜索目的地的推荐住宿区域",
    "parameters": {
      "type": "object",
      "properties": {
        "destination": {
          "type": "string",
          "description": "此处填写目的地名称。"
        },
        "freshness": {
          "type": "string",
          "description": "搜索结果的时间范围，可选值：oneDay（一天内）、oneWeek（一周内）、oneMonth（一个月内）、oneYear（一年内）、noLimit（不限制）。当用户询问近期政策、最新开业、近期推荐、当前热度等时效性高的信息时，按需选择合适的时间范围；否则使用默认noLimit。",
          "enum": [
            "oneDay",
            "oneWeek",
            "oneMonth",
            "oneYear",
            "noLimit"
          ],
          "default": "noLimit"
        }
      },
      "required": [
        "destination"
      ]
    }
  }
}
```

</details>

<a id="tool-21"></a>

### T21 `fetch_info` — `info_fetch_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/info_fetch_tool.py:241](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/info_fetch_tool.py:241>)。
- 执行入口：[app/routers/tools_v2/info_fetch_tool.py:119](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/info_fetch_tool.py:119>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "fetch_info",
    "description": "信息获取工具。需要根据“信息获取触发规则”调用该工具。首先要判断是什么信息类型，然后根据用户的需求填入触发的信息名称，注意信息名称只能是表格中已有的。",
    "parameters": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "description": "信息类型，目前支持以下两种：activity/knowledge，分别代表活动信息和知识信息。注意此处只能填其中一种。"
        },
        "name": {
          "type": "string",
          "description": "信息名称，此处填入用户需求触发的已有活动/知识名称，可以同时填多个，不同名称用“、”分隔。注意type为activity时此处只能填已有活动名称，type为knowledge时此处只能填已有知识名称。"
        }
      },
      "required": [
        "type",
        "name"
      ]
    }
  }
}
```

</details>

<a id="tool-22"></a>

### T22 `local_activity_tool` — `local_activity_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/local_activity_tool.py:202](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/local_activity_tool.py:202>)。
- 执行入口：[app/routers/tools_v2/local_activity_tool.py:149](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/local_activity_tool.py:149>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "local_activity_tool",
    "description": "查询城市近期的活动信息，包括灯会、展览、漫展、春节活动等。可以按城市查询近期活动，支持关键词搜索和时间范围筛选。",
    "parameters": {
      "type": "object",
      "properties": {
        "city": {
          "type": "string",
          "description": "城市名称（必填参数），如：珠海市、青岛市、合肥市等"
        },
        "keyword": {
          "type": "string",
          "description": "活动关键词（选填参数），用于搜索特定类型的活动，如：灯会、漫展、展览等"
        },
        "start_date": {
          "type": "string",
          "description": "查询开始日期（选填参数），格式为yyyy-MM-dd，如2026-02-06"
        },
        "end_date": {
          "type": "string",
          "description": "查询结束日期（选填参数），格式为yyyy-MM-dd，如2026-02-28"
        },
        "limit": {
          "type": "integer",
          "description": "返回结果条数上限（选填参数），默认20，建议6-10，上下文较长时传6"
        }
      },
      "required": [
        "city"
      ]
    }
  }
}
```

</details>

<a id="tool-23"></a>

### T23 `search_recent_activity` — `recent_activity_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/new_year_tool.py:84](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/new_year_tool.py:84>)。
- 执行入口：[app/routers/tools_v2/new_year_tool.py:63](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/new_year_tool.py:63>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "search_recent_activity",
    "description": "查询近期进行中的优惠活动信息，包括活动玩法、参与方式、可获得的福利等。当用户询问近期有什么活动、五一活动、优惠活动、促销活动时调用此工具",
    "parameters": {
      "type": "object",
      "properties": {},
      "required": []
    }
  }
}
```

</details>

<a id="tool-24"></a>

### T24 `news_search_web_info` — `news_web_search_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/news_web_search_tool.py:76](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/news_web_search_tool.py:76>)。
- 执行入口：[app/routers/tools_v2/news_web_search_tool.py:31](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/news_web_search_tool.py:31>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "news_search_web_info",
    "description": "该工具可以搜索目的地的新闻",
    "parameters": {
      "type": "object",
      "properties": {
        "destination": {
          "type": "string",
          "description": "此处填写目的地名称"
        },
        "date": {
          "type": "string",
          "description": "此处填写日期，格式为yyyy-mm-dd，可以填写多个日期，不同日期用/分隔，例如：2024-01-01/2024-01-02/2024-01-03"
        },
        "freshness": {
          "type": "string",
          "description": "搜索结果的时间范围，可选值：oneDay（一天内）、oneWeek（一周内）、oneMonth（一个月内）、oneYear（一年内）、noLimit（不限制）。新闻默认要求时效性优先，通常使用oneDay；如果用户询问较长时间范围内的新闻、事件回顾或历史动态，可按需选择oneWeek、oneMonth或oneYear。",
          "enum": [
            "oneDay",
            "oneWeek",
            "oneMonth",
            "oneYear",
            "noLimit"
          ],
          "default": "oneDay"
        }
      },
      "required": [
        "destination",
        "date"
      ]
    }
  }
}
```

</details>

<a id="tool-25"></a>

### T25 `scenic_crowd_tool` — `scenic_crowd_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/scenic_crowd_tool.py:291](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/scenic_crowd_tool.py:291>)。
- 执行入口：[app/routers/tools_v2/scenic_crowd_tool.py:225](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/scenic_crowd_tool.py:225>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "scenic_crowd_tool",
    "description": "查询景区的实时客流和舒适度信息，包括当前舒适度状态、历史记录、未来预测、实时天气和游玩建议。【重要限制】目前该工具仅支持查询苏州地区的景区，其他城市暂不支持。",
    "parameters": {
      "type": "object",
      "properties": {
        "scenery_name": {
          "type": "string",
          "description": "景点名称（必填参数），如：周庄古镇、拙政园、虎丘、同里古镇等"
        },
        "city": {
          "type": "string",
          "description": "城市名称（必填参数），景点所在的城市，目前仅支持苏州地区"
        },
        "record_date": {
          "type": "string",
          "description": "查询日期（选填参数），格式为yyyy-MM-dd，如2026-02-03。不传则默认查询当天数据"
        }
      },
      "required": [
        "scenery_name",
        "city"
      ]
    }
  }
}
```

</details>

<a id="tool-26"></a>

### T26 `search_hot_spots` — `search_hot_spots_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/search_hot_spots_tool.py:397](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/search_hot_spots_tool.py:397>)。
- 执行入口：[app/routers/tools_v2/search_hot_spots_tool.py:328](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/search_hot_spots_tool.py:328>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "search_hot_spots",
    "description": "按城市与同程区域、演出日期区间检索热点票务活动。必填：region（城市名，用于解析同程城市 ID）、start_date、end_date，格式均为 yyyy-mm-dd。可选：keyword、actors、activity_types（与后端枚举一致）、latitude+longitude（同时提供时用于距离排序）。对同一 region + start_date + end_date 仅调用本工具一次；多种活动类型合并传入 activity_types。注意不要在对话文本中调用。",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "region",
        "start_date",
        "end_date"
      ],
      "properties": {
        "region": {
          "type": "string",
          "description": "城市名称"
        },
        "start_date": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$",
          "description": "查询开始日期 yyyy-mm-dd"
        },
        "end_date": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$",
          "description": "查询结束日期 yyyy-mm-dd"
        },
        "keyword": {
          "type": "string",
          "description": "名称、艺人、场馆等关键词"
        },
        "actors": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "艺人/明星"
        },
        "activity_types": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "演唱会",
              "体育赛事",
              "戏曲艺术",
              "话剧歌剧",
              "舞蹈芭蕾",
              "音乐会",
              "亲子演出",
              "休闲展览",
              "音乐节",
              "电竞赛事",
              "游戏剧场",
              "脱口秀",
              "相声",
              "Livehouse"
            ]
          },
          "description": "活动类型，多项为并集过滤（与后端映射表一致的可填值）"
        },
        "latitude": {
          "type": "number",
          "description": "用户纬度，与 longitude 成对使用"
        },
        "longitude": {
          "type": "number",
          "description": "用户经度，与 latitude 成对使用"
        }
      }
    }
  }
}
```

</details>

<a id="tool-27"></a>

### T27 `search` — `SearchTool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/search_tool.py:124](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/search_tool.py:124>)。
- 执行入口：[app/routers/tools_v2/search_tool.py:62](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/search_tool.py:62>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "search",
    "description": "通用搜索工具，支持 web 和酒店搜索。mode=all（默认）同时搜 web 和酒店，返回概要+酒店列表+web 摘要；mode=web 仅搜网页信息（适合识别地标/活动地址/场馆名）；mode=hotel 仅搜酒店（已明确地标无需 web 辅助时）。当用户提到具体地标/场馆/景点或需要酒店推荐时调用。",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "自然语言搜索指令，应包含明确的地点（城市+地标/位置）和偏好（如步行可达、海景、性价比等）"
        },
        "mode": {
          "type": "string",
          "enum": [
            "all",
            "web",
            "hotel"
          ],
          "description": "搜索类型，默认 all。all=web+酒店；web=仅网页；hotel=仅酒店"
        }
      },
      "required": [
        "query"
      ]
    }
  }
}
```

</details>

<a id="tool-28"></a>

### T28 `sight_recommend` — `sight_recommend_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/sight_recommend_tool.py:352](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/sight_recommend_tool.py:352>)。
- 执行入口：[app/routers/tools_v2/sight_recommend_tool.py:80](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/sight_recommend_tool.py:80>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "sight_recommend",
    "description": "景点发现与筛选工具，返回景点列表及基础结构化信息（简介、近期动态、游玩时长、最佳季节、门票价格）。适用于用户不确定去哪、需要推荐或对比景点的场景。本工具不包含景点内部的深度体验内容。注意不支持餐饮美食等查询",
    "parameters": {
      "type": "object",
      "properties": {
        "region": {
          "type": "string",
          "description": "景区所在地区,可以是省份、城市、区、县，例如北京市, 海淀区, 纽约，只填写最细的行政级别地区，不要多级行政区（如：北京市海淀区、四川省/成都市）"
        },
        "short_trip": {
          "type": "string",
          "description": "是否是短途旅行，如果是两日内游玩、周末游玩、短途旅行、周边旅行，填写是，不然填否"
        },
        "preference_desc": {
          "type": "string",
          "description": "景区的主题描述，如果用户没有明确景区主题，可以根据节日或者当前季节或者地区特色等填写景区主题。填写简体中文。"
        },
        "requiredSceneryList": {
          "type": "string",
          "description": "已知待推荐景点列表, 景点间用逗号分隔, 没有则填空字符串"
        }
      },
      "required": [
        "region",
        "short_trip",
        "requiredSceneryList"
      ]
    }
  }
}
```

</details>

<a id="tool-29"></a>

### T29 `sight_search_web_info` — `sight_web_search_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/sight_web_search_tool.py:121](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/sight_web_search_tool.py:121>)。
- 执行入口：[app/routers/tools_v2/sight_web_search_tool.py:34](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/sight_web_search_tool.py:34>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "sight_search_web_info",
    "description": "该工具可以搜索具体的景点攻略",
    "parameters": {
      "type": "object",
      "properties": {
        "sight": {
          "type": "string",
          "description": "此处填写景点名称，可以填写多个景点名称，不同景点用/分隔，景点名称需要包含景点和所在城市，例如：北京天安门(北京)/故宫(北京)/颐和园(北京)"
        },
        "freshness": {
          "type": "string",
          "description": "搜索结果的时间范围，可选值：oneDay（一天内）、oneWeek（一周内）、oneMonth（一个月内）、oneYear（一年内）、noLimit（不限制）。当用户询问近期开放状态、最新限流/闭园、近期活动、当前游玩提醒等时效性高的信息时，按需选择合适的时间范围；否则使用默认noLimit。",
          "enum": [
            "oneDay",
            "oneWeek",
            "oneMonth",
            "oneYear",
            "noLimit"
          ],
          "default": "noLimit"
        }
      },
      "required": [
        "sight"
      ]
    }
  }
}
```

</details>

<a id="tool-30"></a>

### T30 `amap_transit_search` — `AmapTransitSearchTool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/small_transit/amap_transit_search_tool.py:301](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/small_transit/amap_transit_search_tool.py:301>)。
- 执行入口：[app/routers/tools_v2/small_transit/amap_transit_search_tool.py:271](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/small_transit/amap_transit_search_tool.py:271>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "amap_transit_search",
    "description": "高德公共交通路线规划工具，查询公交、地铁等公共交通方式的路线方案。支持同城和跨城公交换乘查询。",
    "parameters": {
      "type": "object",
      "properties": {
        "origin": {
          "type": "string",
          "description": "起点经纬度（必须参数），格式：经度,纬度，例如116.434307,39.90909"
        },
        "destination": {
          "type": "string",
          "description": "目的地经纬度（必须参数），格式：经度,纬度，例如116.434446,39.90816"
        },
        "city1": {
          "type": "string",
          "description": "起点城市代码（必须参数），例如010代表北京，citycode格式"
        },
        "city2": {
          "type": "string",
          "description": "目的地城市代码（必须参数），例如010代表北京，citycode格式"
        },
        "originpoi": {
          "type": "string",
          "description": "起点POI ID（可选参数），起点为POI时建议填充，可提升路线规划准确性"
        },
        "destinationpoi": {
          "type": "string",
          "description": "目的地POI ID（可选参数），目的地为POI时建议填充，可提升路线规划准确性"
        }
      },
      "required": [
        "origin",
        "destination",
        "city1",
        "city2"
      ]
    }
  }
}
```

</details>

<a id="tool-31"></a>

### T31 `bus_search_tool` — `BusSearchTool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/small_transit/bus_search_tool.py:746](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/small_transit/bus_search_tool.py:746>)。
- 执行入口：[app/routers/tools_v2/small_transit/bus_search_tool.py:725](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/small_transit/bus_search_tool.py:725>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "bus_search_tool",
    "description": "根据出发地和目的地搜索大巴线路信息，支持向量搜索和关键词搜索的复合检索策略",
    "parameters": {
      "type": "object",
      "properties": {
        "departure": {
          "type": "string",
          "description": "出发地名称，例如：'北京'、'成都'、'上海'"
        },
        "destination": {
          "type": "string",
          "description": "目的地名称，例如：'天津'、'简阳'、'苏州'"
        }
      },
      "required": [
        "departure",
        "destination"
      ]
    }
  }
}
```

</details>

<a id="tool-32"></a>

### T32 `drive_search` — `DriveSearchTool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/small_transit/drive_search_tool.py:574](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/small_transit/drive_search_tool.py:574>)。
- 执行入口：[app/routers/tools_v2/small_transit/drive_search_tool.py:554](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/small_transit/drive_search_tool.py:554>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "drive_search",
    "description": "中国境内自驾路线查询接口，支持从出发点到目的地的自驾路线规划",
    "parameters": {
      "type": "object",
      "properties": {
        "start_location": {
          "type": "string",
          "description": "出发点经纬度坐标，按照经度,纬度格式，例如116.40368,39.91489"
        },
        "end_location": {
          "type": "string",
          "description": "目的地经纬度坐标，按照经度,纬度格式，例如116.40368,39.91489"
        },
        "preference": {
          "type": "string",
          "description": "路线偏好，例如'高速优先'、'最短距离'等，可选"
        }
      },
      "required": [
        "start_location",
        "end_location"
      ]
    }
  }
}
```

</details>

<a id="tool-33"></a>

### T33 `smart_search_flash` — `smart_search_flash_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/smart_search_flash_tool.py:220](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/smart_search_flash_tool.py:220>)。
- 执行入口：[app/routers/tools_v2/smart_search_flash_tool.py:113](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/smart_search_flash_tool.py:113>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "smart_search_flash",
    "description": "智能搜索工具，面向开放性旅行信息查询，返回一份简洁、带参考资料的综合回答。适用于查询旅游攻略、景点信息、景区业务接口返回的开放时间、营业状态、门票价格和近期动态、目的地交通指南等公开信息；明确城市和景区名称时，优先使用同程景区业务详情；其权威时效字段优先于RAG中的景区POI。景区接口查询需要城市和具体景区名称，可选已知同程景区resId；不支持全城泛推荐、指定日期余票或成交价验证、预订；动态仅在实际返回时提供，营业时间须看适用日期。禁止用于指定列车时刻表、航班/机票或其他应由专用工具处理的实时票务查询。支持国内/海外地图文字搜索：写明国家、城市、地点名称或类别；查询周边还需明确地标/分店名或文字地址。地图文字搜索不接受经纬度，不支持精确半径/距离过滤、距离排序或保证最近、路线导航、步行/驾车时长、严格价格/评分筛选、实时营业验证、实时酒店房价房态。类别和偏好仅作文字匹配；评分、价格参考、营业时间以实际返回字段为准。缺少信息、地点有歧义或不支持时会返回原因及修改建议；部分失败时保留成功结果。根据反馈补充信息，不能猜测位置或自行放宽硬性要求。",
    "parameters": {
      "type": "object",
      "required": [
        "query"
      ],
      "properties": {
        "query": {
          "type": "string",
          "description": "搜索查询关键词"
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 40,
          "description": "统一回答参考资料的最多条数，默认6",
          "default": 6
        }
      }
    }
  }
}
```

</details>

<a id="tool-34"></a>

### T34 `sight_recommend` — `suzhou_sight_recommend_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/suzhou_tool.py:159](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/suzhou_tool.py:159>)。
- 执行入口：[app/routers/tools_v2/suzhou_tool.py:59](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/suzhou_tool.py:59>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "sight_recommend",
    "description": "苏州市景区查询工具，根据位置关键词和门票价格查询景区。",
    "parameters": {
      "type": "object",
      "properties": {
        "locationKeyword": {
          "type": "string",
          "description": "位置关键词。可以是景区所在的区域，例如姑苏区。也可以是具体的景点名称，例如拙政园。"
        },
        "highPrice": {
          "type": "integer",
          "description": "设置景区门票的最高价，单位元，不确定时不填写。如果用户明确希望推荐高价的景区门票时不填写,当用户想要便宜一些的景区门票时可以把这个值调低。"
        },
        "lowPrice": {
          "type": "integer",
          "description": "设置景区门票的最低价，单位元，不确定时不填写。如果用户明确希望推荐高性价比或者便宜的景区门票时不填写,当用户想要高价的景区门票时可以把这个值调高。"
        }
      },
      "required": [
        "locationKeyword"
      ]
    }
  }
}
```

</details>

<a id="tool-35"></a>

### T35 `activity_search` — `suzhou_activity_search_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/suzhou_tool.py:352](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/suzhou_tool.py:352>)。
- 执行入口：[app/routers/tools_v2/suzhou_tool.py:244](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/suzhou_tool.py:244>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "activity_search",
    "description": "活动查询工具",
    "parameters": {
      "type": "object",
      "properties": {
        "area": {
          "type": "string",
          "description": "活动所在地区，只能填写下面的一个地区：【张家港、常熟、太仓、昆山、吴江区、吴中区、相城区、姑苏区、工业园区、高新区】。"
        },
        "locationKeyword": {
          "type": "string",
          "description": "活动所在位置关键词，例如东太湖。"
        },
        "startDate": {
          "type": "string",
          "description": "活动开始日期，日期格式采用yyyy-MM-dd。"
        },
        "endDate": {
          "type": "string",
          "description": "活动结束日期，日期格式采用yyyy-MM-dd。"
        },
        "activityType": {
          "type": "string",
          "description": "活动类型，只能填写下面对应的一个活动类型：【景区、展览、演出、文化惠民、其他】。"
        }
      },
      "required": [
        "area"
      ]
    }
  }
}
```

</details>

<a id="tool-36"></a>

### T36 `traffic_search_web_info` — `traffic_web_search_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/traffic_web_search_tool.py:64](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/traffic_web_search_tool.py:64>)。
- 执行入口：[app/routers/tools_v2/traffic_web_search_tool.py:31](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/traffic_web_search_tool.py:31>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "traffic_search_web_info",
    "description": "该工具可以搜索某地到某地的推荐交通方式，一般只针对较远区域之间的交通，不支持市内交通的查询。",
    "parameters": {
      "type": "object",
      "properties": {
        "start": {
          "type": "string",
          "description": "此处填写出发地名称"
        },
        "end": {
          "type": "string",
          "description": "此处填写目的地名称"
        },
        "freshness": {
          "type": "string",
          "description": "搜索结果的时间范围，可选值：oneDay（一天内）、oneWeek（一周内）、oneMonth（一个月内）、oneYear（一年内）、noLimit（不限制）。当用户询问近期交通管制、最新运营变化、近期通行风险、当前交通政策等时效性高的信息时，按需选择合适的时间范围；否则使用默认noLimit。",
          "enum": [
            "oneDay",
            "oneWeek",
            "oneMonth",
            "oneYear",
            "noLimit"
          ],
          "default": "noLimit"
        }
      },
      "required": [
        "start",
        "end"
      ]
    }
  }
}
```

</details>

<a id="tool-37"></a>

### T37 `search_train` — `train_search_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/train_search_tool.py:566](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/train_search_tool.py:566>)。
- 执行入口：[app/routers/tools_v2/train_search_tool.py:510](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/train_search_tool.py:510>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "search_train",
    "description": "查询火车票信息的接口,尽量用startTime、endTime做更精确的查询,注意不支持大巴/包车等交通方式的查询。",
    "parameters": {
      "type": "object",
      "properties": {
        "fromCityName": {
          "type": "string",
          "description": "出发地城市名称,只能是城市级别，例如北京、上海"
        },
        "toCityName": {
          "type": "string",
          "description": "到达城市名称,只能是城市级别，例如北京、上海"
        },
        "depDate": {
          "type": "string",
          "description": "火车出发日期，格式yyyy-mm-dd,如果没有确定就填写明天日期"
        },
        "trainNo": {
          "type": "string",
          "description": "火车的班次号，例如T109,只有确认了才填写"
        },
        "trainTypeCode": {
          "type": "string",
          "enum": [
            "D",
            "Z",
            "C",
            "KT",
            "KKS",
            "KPK",
            "KPM",
            "KS",
            "PK",
            "PM",
            "GD",
            "XGZ"
          ],
          "description": "列车类型代码，可选值: D-动车组, Z-直达特快, C-城际高速, KT-空调特快, KKS-空调快速, KPK-空调普快, KPM-空调普慢, KS-快速, PK-普快, PM-普慢, GD-高速动车, XGZ-香港直通车 这个参数确定了才填写，没确定不要填写"
        },
        "startTime": {
          "type": "integer",
          "description": "出发时间范围起始点(范围0～24)，例如2 代表2:00以后出发的列车,只有startTime代表之选这个时间之后的车,只有endTime代表之选这个时间之前的车,两个参数都有代表查这个范围的车次"
        },
        "endTime": {
          "type": "integer",
          "description": "出发时间范围结束点(范围0～24)，例如18 代表18:00以前出发的列车"
        }
      },
      "required": [
        "fromCityName",
        "toCityName",
        "depDate"
      ]
    }
  }
}
```

</details>

<a id="tool-38"></a>

### T38 `search_transfer_plan` — `transfer_plan_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/transfer_plan_tool.py:214](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/transfer_plan_tool.py:214>)。
- 执行入口：[app/routers/tools_v2/transfer_plan_tool.py:147](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/transfer_plan_tool.py:147>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "search_transfer_plan",
    "description": "查询城市间中转方案的接口",
    "parameters": {
      "type": "object",
      "properties": {
        "fromCityName": {
          "type": "string",
          "description": "出发地城市名称,只能是城市级别，例如北京、上海"
        },
        "toCityName": {
          "type": "string",
          "description": "到达城市名称,只能是城市级别，例如北京、上海"
        },
        "depDate": {
          "type": "string",
          "description": "出发日期，格式yyyy-mm-dd,如果没有确定就填写明天日期"
        },
        "types": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "查询类型，例如['TF']表示查询中转方案"
        }
      },
      "required": [
        "fromCityName",
        "toCityName",
        "depDate"
      ]
    }
  }
}
```

</details>

<a id="tool-39"></a>

### T39 `travel_route_recommend` — `travel_route_recommend_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/travel_route_recommend_tool.py:499](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/travel_route_recommend_tool.py:499>)。
- 执行入口：[app/routers/tools_v2/travel_route_recommend_tool.py:315](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/travel_route_recommend_tool.py:315>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "travel_route_recommend",
    "description": "从公司内部线路库中，查询合适的旅行线路数据",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "旅行需求的查询query，这个query会用来向量化匹配线路库中的线路数据的描述文本来召回对应的数据"
        }
      },
      "required": [
        "query"
      ]
    }
  }
}
```

</details>

<a id="tool-40"></a>

### T40 `search_travel_web_info` — `travel_web_search_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/travel_web_search_tool.py:45](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/travel_web_search_tool.py:45>)。
- 执行入口：[app/routers/tools_v2/travel_web_search_tool.py:30](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/travel_web_search_tool.py:30>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "search_travel_web_info",
    "description": "该工具可以搜索目的地的主流玩法路线",
    "parameters": {
      "type": "object",
      "properties": {
        "destination": {
          "type": "string",
          "description": "目的地名称"
        }
      },
      "required": [
        "destination"
      ]
    }
  }
}
```

</details>

<a id="tool-41"></a>

### T41 `deeptrip_memory_query` — `user_all_features_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/user_all_features_tool.py:159](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/user_all_features_tool.py:159>)。
- 执行入口：[app/routers/tools_v2/user_all_features_tool.py:52](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/user_all_features_tool.py:52>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "deeptrip_memory_query",
    "description": "按 memberId 查询用户全方位特征，仅返回中文描述。",
    "parameters": {
      "type": "object",
      "properties": {
        "memberId": {
          "type": "string",
          "description": "成员ID，如 member-10001"
        }
      },
      "required": [
        "memberId"
      ]
    }
  }
}
```

</details>

<a id="tool-42"></a>

### T42 `user_profile` — `user_profile_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/user_profile_tool.py:236](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/user_profile_tool.py:236>)。
- 执行入口：[app/routers/tools_v2/user_profile_tool.py:116](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/user_profile_tool.py:116>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "user_profile",
    "description": "",
    "parameters": {}
  }
}
```

</details>

<a id="tool-43"></a>

### T43 `web_knowledge_agent` — `web_knowledge_agent`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/web_knowledge_agent.py:210](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/web_knowledge_agent.py:210>)。
- 执行入口：[app/routers/tools_v2/web_knowledge_agent.py](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/web_knowledge_agent.py>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "web_knowledge_agent",
    "description": "旅行知识和同程里程积分解答代理，解决用户旅行知识的疑问。无法解决投诉、发票、预定、订票、查经济舱等人工问题属于客服问题你不能解决。目前支持：1.乘火车知识：乘车注意事项、退改签规则等；2.乘飞机知识：行李规范、政策、值机、起飞时间等等；3.出国旅游知识：签证办理流程、出境手续、境外支付方式等。4.同程旅行里程积分的规则和疑问解答",
    "parameters": {
      "type": "object",
      "required": [
        "query",
        "type"
      ],
      "properties": {
        "query": {
          "type": "string",
          "description": "用户具体的旅行知识问题的描述，可以是任何语言，务必详细完整不要有歧义，如果设计里程积分要强调是同程旅行的里程积分"
        },
        "type": {
          "type": "string",
          "description": "用户旅行问题的类型，只支持下面这几种",
          "enum": [
            "乘火车知识",
            "乘火车知识-接站",
            "乘火车知识-送站",
            "乘飞机知识-其他",
            "乘飞机知识-接机",
            "乘飞机知识-送机",
            "乘飞机知识-值机选座-国内",
            "乘飞机知识-值机选座-国际",
            "出国旅游知识",
            "同程旅行里程积分"
          ]
        }
      }
    }
  }
}
```

</details>

<a id="tool-44"></a>

### T44 `web_search_flash` — `web_search_flash_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/web_search_flash_tool.py:166](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/web_search_flash_tool.py:166>)。
- 执行入口：[app/routers/tools_v2/web_search_flash_tool.py:37](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/web_search_flash_tool.py:37>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "web_search_flash",
    "description": "快速网络搜索工具，通过 SearchAgent 获取互联网上的相关信息，返回标题、原始摘要、来源与链接。相比 web_search，本工具跳过意图校验、不做大模型排序与摘要，改用 reranker 排序并只返回最相关的前 topN（默认5）条，响应更快但可解释性与多样性较弱。**适用场景**：对速度敏感、对结果可解释性/多样性要求不高的开放性旅行信息检索，例如目的地介绍、游玩攻略、近期政策、当地油价、活动、新闻动态等开放性内容的快速查询。**不适用场景（禁止使用）**：禁止用于查询指定列车（含动车、高铁、城际等）班次的时刻表、经停站、途经站、到站/发车时间，这类信息应调用 get_train_schedule；禁止用于查询机票/航班信息或从出发地到到达地的交通方式方案（火车、飞机、大巴等）或票价对比，这类信息应调用 search_transit；若已调用 get_train_schedule 获取列车时刻表/经停结果，也不要再用本工具补充或校验，应以 get_train_schedule 的结果为准。当对结果质量、可解释性或多样性有较高要求时，应改用 web_search。",
    "parameters": {
      "type": "object",
      "required": [
        "search_keywords"
      ],
      "properties": {
        "search_keywords": {
          "type": "string",
          "description": "搜索关键词,如果是多个用空格隔开,一般情况不超过三个"
        },
        "count": {
          "type": "integer",
          "description": "返回结果数量（即 reranker 截断的 topN），默认5，最大40",
          "default": 5
        },
        "freshness": {
          "type": "string",
          "description": "搜索结果的时间范围，可选值：oneDay（一天内）、oneWeek（一周内）、oneMonth（一个月内）、oneYear（一年内），默认noLimit, 对于时效性高的场景，可根据情况选择合适的参数",
          "enum": [
            "oneDay",
            "oneWeek",
            "oneMonth",
            "oneYear",
            "noLimit"
          ],
          "default": "noLimit"
        }
      }
    }
  }
}
```

</details>

<a id="tool-45"></a>

### T45 `web_search` — `web_search_tool`

- 分类：其他入口或条件注册。
- 声明：[app/routers/tools_v2/web_search_tool.py:290](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/web_search_tool.py:290>)。
- 执行入口：[app/routers/tools_v2/web_search_tool.py:130](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/web_search_tool.py:130>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "web_search",
    "description": "通用网络搜索工具，通过 SearchAgent 获取互联网上的相关信息，返回标题、摘要、来源与链接。适用于需要从互联网获取开放性内容的场景，包括：对某个具体目的地或话题的深度介绍与攻略、时效性较强的信息（近期政策、活动、动态等）、查询演唱会/演出/音乐节/展览等活动的举办地点或周边住宿参考，以及其他专业工具无法覆盖的旅行相关查询。**注意**：禁止用于查询指定列车（含动车、高铁等）班次的时刻表、经停站、途经站、到站/发车时间，这类信息应调用 get_train_schedule；禁止用于查询机票/航班信息或从出发地到到达地的交通方式方案，这类信息应调用 search_transit。若已经调用 get_train_schedule 获取列车时刻表/经停结果，也不要再调用 web_search 补充或校验该信息，应以 get_train_schedule 的结果为准，如果 get_train_schedule 查询没有满意的结果那就可以认为确实没有。",
    "parameters": {
      "type": "object",
      "required": [
        "search_keywords"
      ],
      "properties": {
        "search_keywords": {
          "type": "string",
          "description": "搜索关键词,如果是多个用空格隔开,一般情况不超过三个"
        },
        "count": {
          "type": "integer",
          "description": "返回结果数量，默认10，最大40",
          "default": 10
        },
        "generate_answer": {
          "type": "boolean",
          "description": "是否返回统一回答。true时返回基于全部筛选结果生成的一份完整回答；false时按搜索结果逐条返回标题、摘要、来源和链接等分项内容。默认true",
          "default": true
        },
        "answer_reference_detail": {
          "type": "string",
          "description": "统一回答中参考资料的详细程度，资料编号与回答正文中的[资料N]一一对应。basic返回每条资料的标题、来源和链接；full在此基础上还返回经筛选后的正文内容（启用单条摘要时为摘要后的内容），便于核验或继续使用。仅在generate_answer为true时生效，默认full",
          "enum": [
            "basic",
            "full"
          ],
          "default": "full"
        },
        "freshness": {
          "type": "string",
          "description": "搜索结果的时间范围，可选值：oneDay（一天内）、oneWeek（一周内）、oneMonth（一个月内）、oneYear（一年内），默认noLimit, 对于时效性高的场景，可根据情况选择合适的参数",
          "enum": [
            "oneDay",
            "oneWeek",
            "oneMonth",
            "oneYear",
            "noLimit"
          ],
          "default": "noLimit"
        }
      }
    }
  }
}
```

</details>

<a id="tool-46"></a>

### T46 `query_user_benefits` — `QueryUserBenefitsTool`

- 分类：技能扩展。
- 声明：[app/routers/deeptrip_skills/benefit_search/tools/user_benefits_tool.py:42](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/deeptrip_skills/benefit_search/tools/user_benefits_tool.py:42>)。
- 执行入口：[app/routers/deeptrip_skills/benefit_search/tools/user_benefits_tool.py:58](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/deeptrip_skills/benefit_search/tools/user_benefits_tool.py:58>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "query_user_benefits",
    "description": "查询当前用户在同程平台可参加的机票和火车票学生/家庭认证权益。无需也禁止传入用户标识。",
    "parameters": {
      "type": "object",
      "properties": {},
      "required": []
    }
  }
}
```

</details>

<a id="tool-47"></a>

### T47 `hotel_search_by_position_tool` — `hotel_search_by_position_tool`

- 分类：子Agent内部工具。
- 声明：[app/routers/subagents/hotel_agent/tools_v2/hotel_search_tools.py:1140](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/hotel_agent/tools_v2/hotel_search_tools.py:1140>)。
- 执行入口：[app/routers/subagents/hotel_agent/tools_v2/hotel_search_tools.py:1014](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/hotel_agent/tools_v2/hotel_search_tools.py:1014>)。

该方法无法通过本次静态提取还原为规范 JSON；下面保留完整声明方法，不擅改源码或声称运行时一定失败。

<details>
<summary>展开完整声明方法源码</summary>

````python
def __str__(self) -> str:
        """工具描述元数据。"""
        return '''
    {
        "type": "function",
        "function": {
            "name": "search_hotel_by_position",
            "description": "按城市/位置/酒店名搜索酒店。city 必填；positionKeyword 可选；name 或 hotelNameKeyword 若有则直接传入请求 body。住宿需求（看日出、靠近景区、海景、亲子等）请写在 preference 里。注意不要在对话文本中调用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "country": {"type": "string", "description": "必填，国家名称，如中国、美国、日本"},
                    "region": {"type": "string", "description": "必填，搜索区域，国内为省/自治区，海外为州/郡"},
                    "city": {"type": "string", "description": "必填，搜索酒店的城市，市/县级别"},
                    "positionKeyword": {"type": "string", "description": "可选。位置/景点关键词，不填则仅按 city 搜索"},
                    "preference": {"type": "string", "description": "住宿查询关键词，如：看日出、靠近景区、海景、亲子、五星/豪华、免费wifi、度假等，会映射为筛选项传给接口"},
                    "hotelNameKeyword": {"type": "string", "description": "酒店名或品牌关键词，会传入请求 body"},
                    "checkInDate": {"type": "string", "description": "入住日期，格式 yyyy-mm-dd"},
                    "checkOutDate": {"type": "string", "description": "离店日期，格式 yyyy-mm-dd"},
                },
                "required": ["country", "region", "city", "preference"]
            }
        }
    }'''
````

</details>

<a id="tool-48"></a>

### T48 `search_hotel_by_lat_lng` — `hotel_search_by_lat_lng_tool`

- 分类：子Agent内部工具。
- 声明：[app/routers/subagents/hotel_agent/tools_v2/hotel_search_tools.py:1311](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/hotel_agent/tools_v2/hotel_search_tools.py:1311>)。
- 执行入口：[app/routers/subagents/hotel_agent/tools_v2/hotel_search_tools.py:1187](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/hotel_agent/tools_v2/hotel_search_tools.py:1187>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "search_hotel_by_lat_lng",
    "description": "根据经纬度在指定城市周边搜索酒店。当用户提供了具体位置坐标（纬度、经度）时使用本工具，例如已知地图选点、GPS 坐标等。",
    "parameters": {
      "type": "object",
      "properties": {
        "country": {
          "type": "string",
          "description": "必填，国家名称，如中国、美国"
        },
        "region": {
          "type": "string",
          "description": "必填，省/州等上一级行政区"
        },
        "city": {
          "type": "string",
          "description": "必填，城市名"
        },
        "preference": {
          "type": "string",
          "description": "住宿查询关键词, 可以是住宿地点、酒店品牌、酒店类型、住宿需求、星级、动机、房型等各类关键词都可以写在这里"
        },
        "latitude": {
          "type": "number",
          "description": "必填，纬度，如 39.90872"
        },
        "longitude": {
          "type": "number",
          "description": "必填，经度，如 116.39748"
        },
        "checkInDate": {
          "type": "string",
          "description": "入住日期，格式 yyyy-mm-dd"
        },
        "checkOutDate": {
          "type": "string",
          "description": "离店日期，格式 yyyy-mm-dd"
        },
        "radius": {
          "type": "integer",
          "description": "搜索半径，单位米，默认 5000"
        },
        "coordinateType": {
          "type": "string",
          "description": "坐标类型，默认 gcj02"
        }
      },
      "required": [
        "country",
        "region",
        "city",
        "latitude",
        "longitude",
        "preference"
      ]
    }
  }
}
```

</details>

<a id="tool-49"></a>

### T49 `hotel_recommend` — `HotelRecommendTool`

- 分类：子Agent内部工具。
- 声明：[app/routers/subagents/hotel_agent/tools_v2/hotel_search_tools.py:1877](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/hotel_agent/tools_v2/hotel_search_tools.py:1877>)。
- 执行入口：[app/routers/subagents/hotel_agent/tools_v2/hotel_search_tools.py:1403](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/hotel_agent/tools_v2/hotel_search_tools.py:1403>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "hotel_recommend",
    "description": "根据区域、城市、国家、入住离店日期、位置关键词、自然语言偏好等 7 字段参数调用业务 API 推荐酒店。",
    "parameters": {
      "type": "object",
      "properties": {
        "region": {
          "type": "string",
          "description": "必填, 搜索区域，省/州等"
        },
        "city": {
          "type": "string",
          "description": "必填, 城市名"
        },
        "country": {
          "type": "string",
          "description": "国家"
        },
        "checkInDate": {
          "type": "string",
          "description": "入住日期 yyyy-mm-dd"
        },
        "checkOutDate": {
          "type": "string",
          "description": "离店日期 yyyy-mm-dd"
        },
        "positionKeyword": {
          "type": "string",
          "description": "位置关键词"
        },
        "preference": {
          "type": "string",
          "description": "自然语言偏好，如带泳池、五星、海景等"
        }
      },
      "required": [
        "region",
        "city",
        "country",
        "checkInDate",
        "checkOutDate"
      ]
    }
  }
}
```

</details>

<a id="tool-50"></a>

### T50 `amap_poi_search` — `AmapPoiSearchTool`

- 分类：子Agent内部工具。
- 声明：[app/routers/subagents/traffic_agent/tools_v2/amap_poi_search_tool.py:167](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/amap_poi_search_tool.py:167>)。
- 执行入口：[app/routers/subagents/traffic_agent/tools_v2/amap_poi_search_tool.py:144](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/amap_poi_search_tool.py:144>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "amap_poi_search",
    "description": "高德POI查询接口（仅适用于中国大陆地区），查询国内地点的详细位置信息（包括经纬度、地址、citycode等）。返回的经纬度坐标为GCJ-02坐标系（国测局坐标/火星坐标）。当用户查询国内地点（如北京站、国家大剧院、三里屯等）需要确定其准确位置和经纬度时调用此工具。注意：海外地点请使用google_poi_search工具。",
    "parameters": {
      "type": "object",
      "properties": {
        "query_keyword": {
          "type": "string",
          "description": "搜索关键字（必须参数），可以是国内POI名称、地址或地标，例如'北京站'、'国家大剧院'、'三里屯'"
        },
        "region": {
          "type": "string",
          "description": "搜索区域（必须参数），指定国内城市名称或行政区划，例如'北京'、'上海'、'杭州'，用于限定搜索范围"
        },
        "method": {
          "type": "string",
          "description": "搜索方法（可选参数），默认为'district'（区域搜索）",
          "enum": [
            "district"
          ]
        }
      },
      "required": [
        "query_keyword",
        "region"
      ]
    }
  }
}
```

</details>

<a id="tool-51"></a>

### T51 `construct_transfer_tool` — `ConstructTransferTool`

- 分类：子Agent内部工具。
- 声明：[app/routers/subagents/traffic_agent/tools_v2/construct_transfer_tool.py:631](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/construct_transfer_tool.py:631>)。
- 执行入口：[app/routers/subagents/traffic_agent/tools_v2/construct_transfer_tool.py:426](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/construct_transfer_tool.py:426>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "construct_transfer_tool",
    "description": "查询飞机/火车中转方案的工具，需同时提供出发日期和行程段列表，行程段列表中每个行程段包含出发地和目的地信息，以及期望的交通类型",
    "parameters": {
      "type": "object",
      "properties": {
        "depDate": {
          "type": "string",
          "description": "出发日期，格式yyyy-mm-dd"
        },
        "transfer_segments": {
          "type": "array",
          "description": "行程段列表（按顺序排列），每个行程段是一个字典，包含origin_country(出发国家)、origin_city(出发城市)、origin_station(出发站点，可选)、destination_country(目的国家)、destination_city(目的城市)、destination_station(目的站点，可选)、type(交通类型：train或flight)。例如：[{\"origin_country\":\"中国\",\"origin_city\":\"北京\",\"origin_station\":\"\",\"destination_country\":\"中国\",\"destination_city\":\"上海\",\"destination_station\":\"上海虹桥站\", \"type\":\"train\"}, {\"origin_country\":\"中国\",\"origin_city\":\"上海\",\"origin_station\":\"上海虹桥机场\",\"destination_country\":\"中国\",\"destination_city\":\"广州\",\"destination_station\":\"\", \"type\":\"flight\"}]，表示乘坐火车从北京到上海虹桥站，然后从上海虹桥机场坐飞机到广州",
          "items": {
            "type": "object",
            "properties": {
              "origin_country": {
                "type": "string",
                "description": "出发国家"
              },
              "origin_city": {
                "type": "string",
                "description": "出发城市"
              },
              "origin_station": {
                "type": "string",
                "description": "出发站点（可选，火车站或机场名称）"
              },
              "destination_country": {
                "type": "string",
                "description": "目的国家"
              },
              "destination_city": {
                "type": "string",
                "description": "目的城市"
              },
              "destination_station": {
                "type": "string",
                "description": "目的站点（可选，火车站或机场名称）"
              },
              "type": {
                "type": "string",
                "description": "交通类型",
                "enum": [
                  "train",
                  "flight"
                ]
              }
            },
            "required": [
              "origin_country",
              "origin_city",
              "destination_country",
              "destination_city",
              "type"
            ]
          }
        },
        "sort_type": {
          "type": "string",
          "description": "排序方式，单选，便宜返回\"cheap\", 贵返回\"expensive\", 最快/最短返回\"fast\", 最慢/最长返回\"slow\", 最晚出发返回\"dep_latest\", 最早出发返回\"dep_earliest\", 最晚到达返回\"arr_latest\", 最早到达返回\"arr_earliest\"",
          "enum": [
            "cheap",
            "expensive",
            "fast",
            "slow",
            "dep_latest",
            "dep_earliest",
            "arr_latest",
            "arr_earliest"
          ]
        }
      },
      "required": [
        "depDate",
        "transfer_segments",
        "sort_type"
      ]
    }
  }
}
```

</details>

<a id="tool-52"></a>

### T52 `flight_search_by_id_tool` — `FlightSearchByIdTool`

- 分类：子Agent内部工具。
- 声明：[app/routers/subagents/traffic_agent/tools_v2/flight_search_by_id_tool.py:487](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/flight_search_by_id_tool.py:487>)。
- 执行入口：[app/routers/subagents/traffic_agent/tools_v2/flight_search_by_id_tool.py:457](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/flight_search_by_id_tool.py:457>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "flight_search_by_id_tool",
    "description": "根据航班ID查询航班详细信息",
    "parameters": {
      "type": "object",
      "properties": {
        "flightId": {
          "type": "string",
          "description": "航班ID，如 'MU2157'"
        },
        "depDate": {
          "type": "string",
          "description": "可选，出发日期，格式yyyy-mm-dd，如果不填写则默认查询未来7天该航班号的航班信息"
        }
      },
      "required": [
        "flightId"
      ]
    }
  }
}
```

</details>

<a id="tool-53"></a>

### T53 `flight_search_tool` — `FlightSearchTool`

- 分类：子Agent内部工具。
- 声明：[app/routers/subagents/traffic_agent/tools_v2/flight_search_tool.py:1946](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/flight_search_tool.py:1946>)。
- 执行入口：[app/routers/subagents/traffic_agent/tools_v2/flight_search_tool.py:1565](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/flight_search_tool.py:1565>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "flight_search_tool",
    "description": "查询飞机票信息的接口,尽量用startTime、endTime做更精确的查询。",
    "parameters": {
      "type": "object",
      "properties": {
        "fromCityName": {
          "type": "string",
          "description": "出发地城市名称，只能是城市级别，例如北京、上海、纽约、东京"
        },
        "toCityName": {
          "type": "string",
          "description": "到达城市名称，只能是城市级别，例如北京、上海、纽约、东京"
        },
        "depCountryZhName": {
          "type": "string",
          "description": "出发地国家名称，例如中国、美国"
        },
        "arrCountryZhName": {
          "type": "string",
          "description": "到达国家名称，例如英国、法国"
        },
        "depDate": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "飞机出发日期,数组格式。[start_date, end_date] 表示区间查询(最多采样7天),[date] 表示单日查询,[] 表示无明确日期。日期格式 yyyy-mm-dd。如果没有确定就填写 [明天日期]"
        },
        "need_transfer": {
          "type": "boolean",
          "description": "是否强制查询中转方案。用户明确要求中转、无直达或比较直达和中转时为true；否则为false，直达结果不超过4条时仍会自动补充中转。"
        },
        "depAirportName": {
          "type": "string",
          "description": "出发机场名称（只在用户明确指定时填写，否则设为null），例如首都国际机场、浦东国际机场。核心原则：除非用户明确说了具体机场（如'从首都机场出发'），否则设为null，按城市搜索更全面"
        },
        "arrAirportName": {
          "type": "string",
          "description": "到达机场名称（只在用户明确指定时填写，否则设为null），例如虹桥国际机场、大兴国际机场。核心原则：除非用户明确说了具体机场（如'到浦东机场'），否则设为null，按城市搜索更全面"
        }
      },
      "required": [
        "fromCityName",
        "toCityName",
        "depDate",
        "depCountryZhName",
        "arrCountryZhName"
      ]
    }
  }
}
```

</details>

<a id="tool-54"></a>

### T54 `google_poi_search` — `GooglePoiSearchTool`

- 分类：子Agent内部工具。
- 声明：[app/routers/subagents/traffic_agent/tools_v2/google_poi_search_tool.py:155](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/google_poi_search_tool.py:155>)。
- 执行入口：[app/routers/subagents/traffic_agent/tools_v2/google_poi_search_tool.py:133](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/google_poi_search_tool.py:133>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "google_poi_search",
    "description": "Google海外POI查询接口（仅适用于中国大陆以外的地区），查询海外地点的详细位置信息。返回的经纬度坐标为WGS-84坐标系（GPS国际标准坐标）。当用户查询国外地点（如东京、巴黎、纽约等）的位置信息时调用此工具。注意：中国大陆地区请使用amap_poi_search工具。",
    "parameters": {
      "type": "object",
      "properties": {
        "query_keyword": {
          "type": "string",
          "description": "搜索关键字（必须参数），可以是海外POI名称、地址或地标，例如'东京塔'、'埃菲尔铁塔'、'纽约时代广场'、'Sydney Opera House'"
        },
        "method": {
          "type": "string",
          "description": "搜索方法（可选参数），默认为'text'（文本搜索），可选'nearby'（附近搜索，需提供location参数）",
          "enum": [
            "text",
            "nearby"
          ]
        },
        "location": {
          "type": "string",
          "description": "中心点位置（nearby方法时必须），格式为'纬度,经度'，坐标系为WGS-84，例如'35.6585805,139.7454329'"
        },
        "radius": {
          "type": "integer",
          "description": "搜索半径（nearby方法时可选），单位为米，默认500米"
        }
      },
      "required": [
        "query_keyword"
      ]
    }
  }
}
```

</details>

<a id="tool-55"></a>

### T55 `route_search` — `RouteSearchTool`

- 分类：子Agent内部工具。
- 声明：[app/routers/subagents/traffic_agent/tools_v2/route_search_tool.py:627](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/route_search_tool.py:627>)。
- 执行入口：[app/routers/subagents/traffic_agent/tools_v2/route_search_tool.py:430](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/route_search_tool.py:430>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "route_search",
    "description": "交通方式推荐工具。基于给定的起点和终点经纬度，计算两点之间的直线距离，并根据距离推荐合适的交通方式（如步行、公交、地铁、大巴、高铁、飞机等）。当推荐飞机时，会使用LLM检查起终点城市是否有民用机场，并提供附近有机场的城市信息。",
    "parameters": {
      "type": "object",
      "properties": {
        "origin_latitude": {
          "type": "number",
          "description": "起点纬度，必须提供。范围：-90到90"
        },
        "origin_longitude": {
          "type": "number",
          "description": "起点经度，必须提供。范围：-180到180"
        },
        "destination_latitude": {
          "type": "number",
          "description": "终点纬度，必须提供。范围：-90到90"
        },
        "destination_longitude": {
          "type": "number",
          "description": "终点经度，必须提供。范围：-180到180"
        },
        "origin_city": {
          "type": "string",
          "description": "起点城市名称（可选）。当距离需要推荐飞机时（>150公里），强烈建议提供此参数，用于机场检查"
        },
        "origin_country": {
          "type": "string",
          "description": "起点国家名称（可选）。当距离需要推荐飞机时（>150公里），强烈建议提供此参数，用于机场检查"
        },
        "destination_city": {
          "type": "string",
          "description": "终点城市名称（可选）。当距离需要推荐飞机时（>150公里），强烈建议提供此参数，用于机场检查"
        },
        "destination_country": {
          "type": "string",
          "description": "终点国家名称（可选）。当距离需要推荐飞机时（>150公里），强烈建议提供此参数，用于机场检查"
        }
      },
      "required": [
        "origin_latitude",
        "origin_longitude",
        "destination_latitude",
        "destination_longitude",
        "origin_city",
        "origin_country",
        "destination_city",
        "destination_country"
      ]
    }
  }
}
```

</details>

<a id="tool-56"></a>

### T56 `get_train_schedule` — `GetTrainScheduleTool`

- 分类：子Agent内部工具。
- 声明：[app/routers/subagents/traffic_agent/tools_v2/train_schedule_tool.py:224](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/train_schedule_tool.py:224>)。
- 执行入口：[app/routers/subagents/traffic_agent/tools_v2/train_schedule_tool.py:121](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/train_schedule_tool.py:121>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "get_train_schedule",
    "description": "查询特定列车班次的详细时刻表，需同时提供班次号和出发日期，只有在用户想了解某个班次的时刻表的时候才调用，查交通不要调用这个工具",
    "parameters": {
      "type": "object",
      "properties": {
        "trainNo": {
          "type": "string",
          "description": "列车班次号（必须参数），例如G103/Z281/T109/D17"
        },
        "depDate": {
          "type": "string",
          "description": "列车出发日期（必须参数），格式yyyy-mm-dd，用于确定当日运行时刻表，如果用户没有指明具体时间，默认填写明天的时间"
        }
      },
      "required": [
        "trainNo",
        "depDate"
      ]
    }
  }
}
```

</details>

<a id="tool-57"></a>

### T57 `train_search_tool` — `TrainSearchTool`

- 分类：子Agent内部工具。
- 声明：[app/routers/subagents/traffic_agent/tools_v2/train_search_tool.py:1706](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/train_search_tool.py:1706>)。
- 执行入口：[app/routers/subagents/traffic_agent/tools_v2/train_search_tool.py:1508](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/train_search_tool.py:1508>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "train_search_tool",
    "description": "查询火车票信息的接口,注意不支持大巴/包车等交通方式的查询。",
    "parameters": {
      "type": "object",
      "properties": {
        "fromCityName": {
          "type": "string",
          "description": "出发地城市名称,只能是城市级别，例如北京、上海"
        },
        "toCityName": {
          "type": "string",
          "description": "到达城市名称,只能是城市级别，例如北京、上海"
        },
        "fromCountyName": {
          "type": "string",
          "description": "起始点所在县/区名称,为城市的下级行政区，例如昆山,开福区,如果出发点没有县/区，则返回null"
        },
        "toCountyName": {
          "type": "string",
          "description": "到达点所在县/区名称,为城市的下级行政区,例如昆山,浦东新区,如果出发点没有县/区，则返回null"
        },
        "depStationName": {
          "type": "string",
          "description": "出发车站名称,例如北京西站、上海虹桥站"
        },
        "arrStationName": {
          "type": "string",
          "description": "到达车站名称,例如北京西站、上海虹桥站"
        },
        "depDate": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "火车出发日期,数组格式。[start_date, end_date] 表示区间查询(最多采样7天),[date] 表示单日查询,[] 表示无明确日期。日期格式 yyyy-mm-dd。如果没有确定就填写 [明天日期]"
        },
        "need_transfer": {
          "type": "boolean",
          "description": "是否强制查询中转方案。用户明确要求中转、无直达或比较直达和中转时为true；否则为false，直达结果不超过4条时仍会自动补充中转。"
        }
      },
      "required": [
        "fromCityName",
        "toCityName",
        "depDate"
      ]
    }
  }
}
```

</details>

<a id="tool-58"></a>

### T58 `transport_hub_search` — `TransportHubSearchTool`

- 分类：子Agent内部工具。
- 声明：[app/routers/subagents/traffic_agent/tools_v2/transport_hub_search_tool.py:814](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/transport_hub_search_tool.py:814>)。
- 执行入口：[app/routers/subagents/traffic_agent/tools_v2/transport_hub_search_tool.py:719](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/transport_hub_search_tool.py:719>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "transport_hub_search",
    "description": "交通枢纽（机场/火车站）搜索工具。基于给定的经纬度坐标，搜索指定半径内有机场或火车站的附近城市。返回结果按城市分组，并清晰区分机场和火车站。适用于查找某个位置附近可以出发或到达的交通枢纽城市。",
    "parameters": {
      "type": "object",
      "properties": {
        "latitude": {
          "type": "number",
          "description": "纬度坐标，必须提供。范围：-90到90"
        },
        "longitude": {
          "type": "number",
          "description": "经度坐标，必须提供。范围：-180到180"
        },
        "hub_type": {
          "type": "string",
          "enum": [
            "airport",
            "train",
            "all"
          ],
          "description": "枢纽类型：airport=仅搜索机场，train=仅搜索火车站，all=同时搜索机场和火车站（默认all）",
          "default": "all"
        },
        "radius": {
          "type": "integer",
          "description": "搜索半径（公里）。不指定时，机场默认200公里，火车站默认100公里"
        },
        "limit": {
          "type": "integer",
          "description": "返回城市数量限制，默认5个",
          "default": 5
        },
        "city": {
          "type": "string",
          "description": "需要排除的城市名称（可选）。返回结果将不包含该城市的机场和火车站"
        },
        "country": {
          "type": "string",
          "description": "需要排除的国家名称（可选）。返回结果将不包含该国家的机场和火车站"
        }
      },
      "required": [
        "latitude",
        "longitude",
        "city",
        "country"
      ]
    }
  }
}
```

</details>

<a id="tool-59"></a>

### T59 `McpTool` — `McpTool`

- 分类：动态MCP。
- 声明：[app/routers/tools_v2/mcp_tool.py:188](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/mcp_tool.py:188>)。
- 执行入口：[app/routers/tools_v2/mcp_tool.py:155](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/mcp_tool.py:155>)。

MCP 的 name/description/properties/required 来自运行时注册数据，本地只能保留声明模板；未查询远端目录，不编造具体工具列表。

<details>
<summary>展开完整声明方法源码</summary>

````python
def __str__(self) -> str:
        """工具描述元数据（子类实现）"""
        meta_desc = {
            "type": "function",
            "function": {
                "name": self.func_name,
                "description": self.func_desc,
                "parameters": {
                    "type": "object",
                    "properties": self.properties,
                    "required": self.required
                }
            }
        }
        return json.dumps(meta_desc, ensure_ascii=False)
````

</details>

<a id="tool-60"></a>

### T60 `search_hotel` — `hotel_search_tool`

- 分类：备份文件。
- 声明：[app/routers/tools_v2/hotel_search_tool_backup.py:813](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/hotel_search_tool_backup.py:813>)。
- 执行入口：[app/routers/tools_v2/hotel_search_tool_backup.py:570](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/hotel_search_tool_backup.py:570>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "search_hotel",
    "description": "支持城市范围搜索和poi细粒度搜索：1）范围搜索指定城市和省份信息，2）poi搜索需在positionKeyword指定详细位置关键词或者景点名（如黄山光明顶，故宫,双流区九江街道），合理选择关键词和搜索条件选择酒店搜索方式,注意不要在对话文本中调用，filterTags中包含酒店的固定筛选项（这些筛选项也是这个接口的能力范围），可以将用户的需求映射成对应的筛选项，这些筛选是预定义的，如果不能满足需求你需要通过逻辑推理合适的位置或通过广撒网等技巧为用户筛选",
    "parameters": {
      "type": "object",
      "properties": {
        "region": {
          "type": "string",
          "description": "必填参数,搜索区域，城市的上一级行政区，国内为省、自治区，海外可以为州，郡"
        },
        "city": {
          "type": "string",
          "description": "必填参数, 需要搜索酒店的城市，用户直接告知或从上下文中获取，建议为市、县级别城市名，支持国内酒店和国际酒店，例如北京、上海、纽约、东京，更细的地理位置需要通过positionKeyword字段来补充"
        },
        "checkInDate": {
          "type": "string",
          "description": "入住日期， 格式yyyy-mm-dd，不确定时写今天日期"
        },
        "checkOutDate": {
          "type": "string",
          "description": "离店日期，格式yyyy-mm-dd，不确定时写明天日期"
        },
        "positionKeyword": {
          "type": "string",
          "description": "查询位置关键词，只能是简体中文，"
        },
        "hotelNameKeyword": {
          "type": "string",
          "description": "酒店名字关键词，全文检索酒店的名字或品牌名，用户提及了要去特定的酒店名或品牌名时需要填写"
        },
        "filterTags": {
          "type": "array",
          "items": {
            "type": "string",
            "description": "结合用户画像和偏好，筛选最合适的1-3个填写，不能超过3个，否则工具会调用失败",
            "enum": [
              "叫醒服务",
              "行李寄存",
              "代客泊车",
              "有棋牌室",
              "健身房",
              "SPA",
              "温泉",
              "儿童乐园",
              "免费停车",
              "免费wifi",
              "商务中心",
              "会议设施",
              "咖啡厅",
              "酒吧",
              "行政酒廊",
              "高尔夫球场",
              "穿梭机场班车",
              "传真/复印",
              "吸烟区",
              "停车场",
              "餐厅",
              "充电桩车位",
              "接待外宾",
              "洗衣房",
              "水上滑梯",
              "三星/舒适",
              "四星/高档",
              "二星及以下/经济",
              "大床",
              "双床",
              "圆床",
              "水床",
              "单份早餐",
              "双份早餐",
              "早餐",
              "五星/豪华",
              "单人床",
              "多张床",
              "榻榻米",
              "影音房",
              "江景房",
              "城景房",
              "山景房",
              "湖景房",
              "亲子房",
              "海景房",
              "电竞房",
              "套房",
              "情侣度假",
              "电竞酒店",
              "新装修",
              "新开业",
              "设计师酒店",
              "地铁周边",
              "亲子酒店",
              "上榜酒店",
              "情侣约会",
              "酒店套餐",
              "免费取消",
              "在线付款",
              "到店付款",
              "先住后付",
              "免担保金",
              "分期支付",
              "预约发票",
              "可开专票",
              "含礼包",
              "立即确认",
              "民宿",
              "公寓",
              "钟点房",
              "别墅",
              "家庭房",
              "艺龙严选",
              "度假酒店",
              "可供氧房",
              "提供发票",
              "可携带宠物",
              "艺龙会",
              "泳池",
              "情趣房",
              "三张床",
              "特大床",
              "露台",
              "布置服务",
              "公共海滩",
              "四合院",
              "浴缸",
              "旅馆",
              "接机服务",
              "咖啡机",
              "电热水壶",
              "花园/庭院",
              "迷人海景",
              "无障碍客房",
              "按摩浴缸",
              "动人夜景",
              "棋牌桌",
              "电脑",
              "迷人江景",
              "私人泳池",
              "田园景观",
              "阳台",
              "园林建筑",
              "拍照出片",
              "厨房",
              "智能马桶",
              "宜人山色",
              "空调",
              "冰箱",
              "洗衣机",
              "轰趴",
              "藏式风情",
              "美食酒店",
              "浪漫之旅",
              "宠物友好",
              "青年旅馆",
              "电子秤",
              "睡眠舱",
              "吹风机"
            ]
          }
        },
        "latitude": {
          "type": "float",
          "description": "仅在知道确切位置时填写，纬度，例如39.90872"
        },
        "longitude": {
          "type": "float",
          "description": "仅在知道确切位置时填写，经度，例如116.39748"
        },
        "radius": {
          "type": "integer",
          "description": "仅在知道确切位置时填写，搜索半径，单位米，默认2000米"
        },
        "coordinateType": {
          "type": "string",
          "description": "经纬度坐标类型，默认gcj02"
        }
      },
      "required": [
        "region",
        "city",
        "positionKeyword or (latitude and longitude) or hotelNameKeyword"
      ]
    }
  }
}
```

</details>

<a id="tool-61"></a>

### T61 `search_transit` — `search_transit_tool`

- 分类：备份文件。
- 声明：[app/routers/tools_v2/search_transit_tool_bak.py:1009](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/search_transit_tool_bak.py:1009>)。
- 执行入口：[app/routers/tools_v2/search_transit_tool_bak.py:281](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/tools_v2/search_transit_tool_bak.py:281>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "search_transit",
    "description": "查询直达或中转的单程长途交通路线（飞机/火车/大巴）和短途交通路线（公交车/地铁）。注意：1. 仅支持单程查询，往返/多日行程需拆分 2. 长途支持国际国内，短途仅限国内 3. 不支持班次查询 4.城市之间的交通需区分县级市 例如 中国/四川省/成都市/都江堰市 和 中国/四川省/成都市/崇州市 是不同的县级市，需要在origin_address和dest_address参数中体现",
    "parameters": {
      "type": "object",
      "properties": {
        "transit_type": {
          "type": "string",
          "description": "默认为'long'（长途跨城）。只有在提供同城具体poi点位时为'short'（短途同城），短途不支持飞机，火车，大巴。",
          "enum": [
            "long",
            "short"
          ]
        },
        "origin_address": {
          "type": "string",
          "description": "出发地地址，长途格式为：国家/行政区/城市, 短途查询格式为：国家/行政区/城市/门牌地址或者poi名称"
        },
        "dest_address": {
          "type": "string",
          "description": "目的地地址，长途格式为：国家/行政区/城市, 短途查询格式为：国家/行政区/城市/门牌地址或者poi名称"
        },
        "depDate": {
          "type": "string",
          "description": "出发日期，格式为：yyyy-mm-dd"
        },
        "desc": {
          "type": "string",
          "description": "需求补充描述，如：出发站点、到达站点、出发时间段（精确如'08:00-09:00'或模糊描述如'上午'）、交通方式偏好（飞机/火车/大巴/地铁/公交）、席位偏好（如'高铁二等座'）。"
        }
      },
      "required": [
        "transit_type",
        "origin_address",
        "dest_address",
        "departure_date",
        "desc"
      ]
    }
  }
}
```

</details>

<a id="tool-62"></a>

### T62 `transport_hub_search` — `TransportHubSearchTool`

- 分类：备份文件。
- 声明：[app/routers/subagents/traffic_agent/tools_v2/transport_hub_search_tool copy.py:813](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/transport_hub_search_tool copy.py:813>)。
- 执行入口：[app/routers/subagents/traffic_agent/tools_v2/transport_hub_search_tool copy.py:718](</Users/tcuser/Documents/ideaproject/agent-b101-trip-flow-20261022/app/routers/subagents/traffic_agent/tools_v2/transport_hub_search_tool copy.py:718>)。

<details>
<summary>展开完整工具声明 JSON</summary>

```json
{
  "type": "function",
  "function": {
    "name": "transport_hub_search",
    "description": "交通枢纽（机场/火车站）搜索工具。基于给定的经纬度坐标，搜索指定半径内有机场或火车站的附近城市。返回结果按城市分组，并清晰区分机场和火车站。适用于查找某个位置附近可以出发或到达的交通枢纽城市。",
    "parameters": {
      "type": "object",
      "properties": {
        "latitude": {
          "type": "number",
          "description": "纬度坐标，必须提供。范围：-90到90"
        },
        "longitude": {
          "type": "number",
          "description": "经度坐标，必须提供。范围：-180到180"
        },
        "hub_type": {
          "type": "string",
          "enum": [
            "airport",
            "train",
            "all"
          ],
          "description": "枢纽类型：airport=仅搜索机场，train=仅搜索火车站，all=同时搜索机场和火车站（默认all）",
          "default": "all"
        },
        "radius": {
          "type": "integer",
          "description": "搜索半径（公里）。不指定时，机场默认200公里，火车站默认100公里"
        },
        "limit": {
          "type": "integer",
          "description": "返回城市数量限制，默认5个",
          "default": 5
        },
        "city": {
          "type": "string",
          "description": "需要排除的城市名称（可选）。返回结果将不包含该城市的机场和火车站"
        },
        "country": {
          "type": "string",
          "description": "需要排除的国家名称（可选）。返回结果将不包含该国家的机场和火车站"
        }
      },
      "required": [
        "latitude",
        "longitude",
        "city",
        "country"
      ]
    }
  }
}
```

</details>

<a id="scope"></a>

## F. 覆盖范围与验证边界

- 本文件覆盖 `app/routers/tools_v2/`、`app/routers/subagents/`、`app/routers/deeptrip_skills/`、`app/routers/skill_engine/data/` 内具体工具类的 `__str__()` 声明入口；内部 HTTP 查询适配器如果没有对模型声明，不强行算成原生工具。
- 分布：默认注册 11 项；其他入口或条件注册 34 项；技能扩展 1 项；子Agent内部工具 12 项；动态MCP 1 项；备份文件 3 项。
- 共 60 项声明可静态还原 JSON，2 项保留声明方法源码；动态名称和有问题的字面量不通过猜测补全。
- JSON 描述中的“支持”“保证”等措辞是该版本工具原有声明，不表示本次逐项业务验收通过。
- 本次主循环 trace 只保留 messages，未取得每轮顶层 tools 的完整历史快照。因此本文件以源码基线说明注册与声明，不能冒充历史 HTTP 抓包。要确认某轮最终完整工具集，需要在 get_tools_for_api 返回后另行记录脱敏快照；本次没有增加业务日志或修改代码。
- 没有调用远程工具、查询用户资料或复制鉴权配置；没有提交和推送代码。
