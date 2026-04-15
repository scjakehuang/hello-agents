# arsenal-ai-deeptrip 服务架构与调用链路分析

## 文档信息

- 作者：徐凯旋
- 邮箱：azouever@gmail.com
- 更新时间：2026-04-14

---

## 一、服务概述

`arsenal-ai-deeptrip` 是 DeepTrip 项目的 **服务端总入口**，包含两个独立应用：

| 应用 | 职责 |
|------|------|
| `arsenal-ai-deeptrip-api` | 面向 C 端用户的 API 服务（主入口） |
| `arsenal-ai-deeptrip-merchant-api` | 面向公司内部管理的 API 服务 |

### 核心职责

1. **流量网关**：请求路由、鉴权、用户上下文解析
2. **Agent 分发**：将对话请求分发到下游 Agent 服务（agent-b101）
3. **首页配置**：首页 Banner、推荐问题、功能入口配置
4. **用户体系**：会员、登录、认证（微信/Apple/Google）
5. **会员服务**：用户权益、积分、邀请码
6. **营销活动**：红包、优惠券、活动配置
7. **客服系统**：对话转人工客服
8. **TTS 语音**：文本转语音流式服务

### 技术栈

| 技术 | 版本 |
|------|------|
| JDK | 1.8 |
| Spring Boot | 2.3.7.RELEASE |
| MyBatis Plus | 3.5.2 |

---

## 二、服务架构图

### 2.1 整体架构图

```
+------------------------------------------------------------------+
|                   arsenal-ai-deeptrip                             |
|                   (服务端总入口)                                    |
+------------------------------------------------------------------+
|                                                                   |
|  +------------------------+    +---------------------------+      |
|  | arsenal-ai-deeptrip-api|    | arsenal-ai-deeptrip-      |      |
|  | (C端用户API)           |    | merchant-api (管理API)    |      |
|  +------------------------+    +---------------------------+      |
|  |                        |    |                           |      |
|  |  restful/              |    |  restful/                 |      |
|  |  +------------------+  |    |  +---------------------+  |      |
|  |  | chat/            |  |    |  | arsenaladmin/       |  |      |
|  |  | - ChatRouteController   |  |  | - 后台管理首页       |  |      |
|  |  | (对话路由转发)   |  |    |  +---------------------+  |      |
|  |  +------------------+  |    |  +---------------------+  |      |
|  |  +------------------+  |    |  | claw/               |  |      |
|  |  | home/            |  |    |  | - API Key 管理       |  |      |
|  |  | - HomeController |  |    |  | - 调用量统计         |  |      |
|  |  | - HomeFeedController    |  |  | - 限流配置          |  |      |
|  |  | (首页配置)       |  |    |  +---------------------+  |      |
|  |  +------------------+  |    |  +---------------------+  |      |
|  |  +------------------+  |    |  | home/               |  |      |
|  |  | member/          |  |    |  | - 运营配置管理       |  |      |
|  |  | - TcMemberController    |  |  +---------------------+  |      |
|  |  | (会员服务)       |  |    |                           |      |
|  |  +------------------+  |    +---------------------------+      |
|  |  +------------------+  |                                        |
|  |  | iopen/           |  |                                        |
|  |  | - InnerOpenController    |                                        |
|  |  | (内部开放接口)   |  |                                        |
|  |  +------------------+  |                                        |
|  |  +------------------+  |                                        |
|  |  | websocket/       |  |                                        |
|  |  | - ChatWebSocketHandler  |                                        |
|  |  | - TtsWebSocketHandler   |                                        |
|  |  | (WebSocket服务)  |  |                                        |
|  |  +------------------+  |                                        |
|  +------------------------+                                        |
|                                                                   |
|  +--------------------------------------------------------+       |
|  |            arsenal-ai-deeptrip-application             |       |
|  |  +--------------------------------------------------+  |       |
|  |  |  agent_dispatch/ (Agent 分发)                     |  |       |
|  |  |  - ChatDispatcherSupportService                  |  |       |
|  |  |  - AgentEnum (CORE/KE_FU/FLIGHT/TRAIN)           |  |       |
|  |  +--------------------------------------------------+  |       |
|  |  +--------------------------------------------------+  |       |
|  |  |  bound/ (外部服务绑定)                            |  |       |
|  |  |  - ClawB101BoundService (调用 agent-b101)        |  |       |
|  |  |  - InvokeCoreAgentBoundService                   |  |       |
|  |  |  - TcMemberBoundService (会员服务)               |  |       |
|  |  +--------------------------------------------------+  |       |
|  |  +--------------------------------------------------+  |       |
|  |  |  home/ (首页业务)                                |  |       |
|  |  |  - HomeConfigService (首页配置)                  |  |       |
|  |  +--------------------------------------------------+  |       |
|  +--------------------------------------------------------+       |
|                                                                   |
+------------------------------------------------------------------+
                              |
                              | HTTP / SSE
                              v
+------------------------------------------------------------------+
|                        下游服务                                   |
+------------------------------------------------------------------+
|  +-------------+  +-------------+  +-------------+  +-----------+ |
|  | agent-b101  |  | arsenal-    |  | arsenal-    |  | 客服系统  | |
|  | (核心Agent) |  | service-ai- |  | service-ai- |  |           | |
|  |             |  | dataset     |  | mcp         |  |           | |
|  +-------------+  +-------------+  +-------------+  +-----------+ |
+------------------------------------------------------------------+
```

### 2.2 模块职责说明

```
arsenal-ai-deeptrip (parent)
├── arsenal-ai-deeptrip-api          # C 端用户 API
│   └── restful/
│       ├── chat/                    # 对话路由（转发到 agent-b101）
│       ├── home/                    # 首页配置、Feed 流
│       ├── member/                  # 会员登录、认证
│       ├── iopen/                   # 内部开放接口
│       ├── websocket/               # WebSocket（对话、TTS）
│       ├── dataset/                 # 数据集接口（转发）
│       ├── tts/                     # TTS 语音服务
│       └── doc/                     # API 文档服务
├── arsenal-ai-deeptrip-merchant-api # 管理端 API
│   └── restful/
│       ├── arsenaladmin/            # 后台管理首页
│       ├── claw/                    # API Key、限流、统计
│       ├── home/                    # 运营配置管理
│       └── auth/                    # 授权管理
├── arsenal-ai-deeptrip-application  # 应用层（业务逻辑）
│   ├── agent_dispatch/              # Agent 分发
│   ├── bound/                       # 外部服务绑定
│   ├── home/                        # 首页业务
│   ├── auth/                        # 认证业务
│   └── user/                        # 用户业务
├── arsenal-ai-deeptrip-domain       # 领域层（DTO/Entity）
├── arsenal-ai-deeptrip-infrastructure # 基础设施层
└── arsenal-ai-deeptrip-common       # 公共模块
```

---

## 三、核心业务模块

### 3.1 对话路由转发 (ChatRouteController)

**职责**：作为 C 端对话请求的统一入口，负责解析用户上下文并转发到 agent-b101。

```
+------------------+     +----------------------+     +------------------+
|   C端用户        |     | ChatRouteController  |     |   agent-b101     |
|   (H5/小程序)    |     |   /chat/**           |     |   (Python)       |
+--------+---------+     +----------+-----------+     +--------+---------+
         |                          |                          |
         | 1. POST /chat/hotel_chat |                          |
         |   Headers:               |                          |
         |   - cookie: sec_sign     |                          |
         |   - dtSource             |                          |
         |   - deviceId             |                          |
         |   - unionId              |                          |
         |------------------------->|                          |
         |                          |                          |
         |                          | 2. 解析请求上下文         |
         |                          |   - token 鉴权           |
         |                          |   - 用户信息获取          |
         |                          |   - 设备信息解析          |
         |                          |                          |
         |                          | 3. RouteRunner 执行过滤链 |
         |                          |                          |
         |                          | 4. 判断 SSE/普通请求      |
         |                          |                          |
         |                          | 5. HTTP 转发到 agent-b101|
         |                          |   POST /chat             |
         |                          |------------------------->|
         |                          |                          |
         |                          | 6. SSE 流式响应          |
         |                          |<-------------------------|
         |                          |                          |
         | 7. SSE 流式返回          |                          |
         |<-------------------------|                          |
         |                          |                          |
```

**核心代码**：

```java
// ChatRouteController.java
@ResponseBody
@RequestMapping(value = "/**")
public void execute(HttpServletRequest req, HttpServletResponse resp) throws Exception {
    String uri = req.getRequestURI();
    log.info("deeptrip开始转发agent层,url:{}", uri);

    // 初始化上下文
    eatRunner.init(req, resp);
    eatRunner.setChatUri(uri);

    // 解析用户上下文
    String token = RequestParamUtils.getSecSignFromCookie(req);
    String deviceId = RequestParamUtils.getDeviceIdFromHeader(req);
    String unionId = RequestParamUtils.getUnionIdFromHeader(req);
    // ... 其他参数

    // 判断是否 SSE 请求
    if (isSseRequest(uri, acceptHeader)) {
        // SSE 流式响应
        routeRunner.executeSse();
    } else {
        // 普通响应
        routeRunner.execute();
    }
}
```

### 3.2 Agent 分发服务 (ChatDispatcherSupportService)

**职责**：根据问题内容和历史对话，智能分发到不同的 Agent。

```
+------------------+     +---------------------------+     +------------------+
| ChatRouteController|   | ChatDispatcherSupport     |     |   下游 Agent     |
|                  |     | Service                   |     |                  |
+--------+---------+     +----------+----------------+     +--------+---------+
         |                          |                          |
         | 1. dispatch(q, sid, memberId)                      |
         |------------------------->|                          |
         |                          |                          |
         |                          | 2. computeExecuteAgent()  |
         |                          |   - 分析问题意图          |
         |                          |   - 查询历史对话          |
         |                          |   - 决定目标 Agent        |
         |                          |                          |
         |                          | 3. 返回 AgentEnum         |
         |                          |   - CORE (主 Agent)       |
         |                          |   - KE_FU (客服)          |
         |                          |   - FLIGHT (机票)         |
         |                          |   - TRAIN (火车)          |
         |                          |                          |
         |                          | 4. 调用对应下游服务        |
         |                          |------------------------->|
         |                          |                          |
```

**Agent 分发枚举**：

```java
public enum AgentEnum {
    CORE,       // 核心 Agent (agent-b101)
    KE_FU,      // 客服系统
    FLIGHT,     // 机票 Agent
    TRAIN       // 火车票 Agent
}
```

### 3.3 首页配置 (HomeController)

**职责**：提供首页配置数据，包括 Banner、推荐问题、功能入口等。

```
+------------------+     +----------------------+     +------------------+
|   C端用户        |     | HomeController       |     |   配置中心/DB    |
|   (H5/小程序)    |     |   /home/**           |     |                  |
+--------+---------+     +----------+-----------+     +--------+---------+
         |                          |                          |
         | 1. GET /home/config      |                          |
         |   ?home_config_id=xxx    |                          |
         |------------------------->|                          |
         |                          |                          |
         |                          | 2. 加载配置               |
         |                          |   - 配置中心默认值        |
         |                          |   - 运营后台配置          |
         |                          |   - ABTest 信息           |
         |                          |------------------------->|
         |                          |                          |
         |                          | 3. 组装响应               |
         |                          |   - Banner 列表           |
         |                          |   - 推荐问题              |
         |                          |   - 功能入口              |
         |                          |                          |
         | 4. Response<JSONObject>  |                          |
         |<-------------------------|                          |
         |                          |                          |
```

### 3.4 会员服务 (TcMemberController)

**职责**：用户登录、认证、会员信息管理。

**主要接口**：

| 接口 | 说明 |
|------|------|
| `POST /member/login` | 用户登录 |
| `POST /member/info` | 获取会员信息 |
| `POST /member/bindPhone` | 绑定手机号 |

---

## 四、WebSocket 服务

### 4.1 对话 WebSocket (ChatWebSocketHandler)

```
+------------------+     +----------------------+     +------------------+
|   C端用户        |     | ChatWebSocketHandler |     |   agent-b101     |
|   (H5/小程序)    |     |   /ws/chat           |     |                  |
+--------+---------+     +----------+-----------+     +--------+---------+
         |                          |                          |
         | 1. WebSocket 连接        |                          |
         |   ws://xxx/ws/chat       |                          |
         |------------------------->|                          |
         |                          |                          |
         | 2. 发送消息              |                          |
         |   {"action":"chat",      |                          |
         |    "content":"推荐酒店"}  |                          |
         |------------------------->|                          |
         |                          |                          |
         |                          | 3. 转发到 agent-b101      |
         |                          |------------------------->|
         |                          |                          |
         | 4. 接收流式响应          |                          |
         |   {"type":"thinking",    |                          |
         |    "content":"..."}      |                          |
         |<-------------------------|                          |
         |                          |                          |
```

### 4.2 TTS WebSocket (TtsWebSocketHandler)

**职责**：文本转语音流式服务，支持实时语音合成。

---

## 五、管理端 API (merchant-api)

### 5.1 Claw 管理 (API Key、限流、统计)

```
+------------------+     +----------------------+     +------------------+
|   运营后台       |     | ClawManageController |     |   MySQL/Redis    |
|   (管理员)       |     |   /claw/...          |     |                  |
+--------+---------+     +----------+-----------+     +--------+---------+
         |                          |                          |
         | 1. 创建 API Key          |                          |
         |   POST /claw/key/create  |                          |
         |------------------------->|                          |
         |                          |                          |
         | 2. 配置限流规则          |                          |
         |   POST /claw/ratelimit   |                          |
         |------------------------->|                          |
         |                          |                          |
         | 3. 查看调用量统计        |                          |
         |   GET /claw/stat         |                          |
         |------------------------->|                          |
         |                          |                          |
```

**主要接口**：

| 接口 | 说明 |
|------|------|
| `POST /claw/key/create` | 创建 API Key |
| `GET /claw/key/list` | 查询 API Key 列表 |
| `POST /claw/ratelimit/set` | 设置限流规则 |
| `GET /claw/stat/overview` | 调用量统计概览 |

---

## 六、与下游服务的调用链路

### 6.1 完整对话请求链路

```
+-------------+     +-------------------+     +---------------------+     +-------------+
|  C端用户    |     | arsenal-ai-       |     | ChatDispatcher      |     | agent-b101  |
|  (H5/App)   |     | deeptrip          |     | SupportService      |     |             |
+------+------+     +---------+---------+     +----------+----------+     +-----+-------+
       |                      |                          |                    |
       | 1. POST /chat/hotel_chat                      |                    |
       |--------------------->|                          |                    |
       |                      |                          |                    |
       |                      | 2. ChatRouteController   |                    |
       |                      |    解析用户上下文         |                    |
       |                      |                          |                    |
       |                      | 3. dispatch()            |                    |
       |                      |------------------------->|                    |
       |                      |                          |                    |
       |                      |                          | 4. 分析意图         |
       |                      |                          |    决定 Agent       |
       |                      |                          |                    |
       |                      | 5. AgentEnum.CORE        |                    |
       |                      |<-------------------------|                    |
       |                      |                          |                    |
       |                      | 6. ClawB101BoundService  |                    |
       |                      |    HTTP POST /chat       |                    |
       |                      |--------------------------|------------------->|
       |                      |                          |                    |
       |                      |                          |                    | 7. DT_agent_loop_v2
       |                      |                          |                    |    执行 Agent 循环
       |                      |                          |                    |
       |                      | 8. SSE 流式响应          |                    |
       |                      |<-------------------------|--------------------|
       |                      |                          |                    |
       | 9. SSE 流式返回      |                          |                    |
       |<---------------------|                          |                    |
       |                      |                          |                    |
```

### 6.2 服务间调用关系

```
arsenal-ai-deeptrip
    |
    +---> agent-b101 (核心 Agent)
    |       POST /chat
    |       POST /flight_chat
    |       POST /train_chat
    |
    +---> arsenal-service-ai-dataset (数据查询)
    |       POST /deeptrip/hotel/search
    |       POST /tool/baidu_map/...
    |
    +---> arsenal-service-ai-mcp (MCP 工具)
    |       POST /api/mcp/tools/call
    |
    +---> 客服系统 (转人工)
            WebSocket /ws/kefu
```

---

## 七、认证与权限

### 7.1 用户认证流程

```
+------------------+     +----------------------+     +------------------+
|   C端用户        |     | TcMemberController   |     |   微信/Apple/Google|
|                  |     |                      |     |                  |
+--------+---------+     +----------+-----------+     +--------+---------+
         |                          |                          |
         | 1. 微信登录              |                          |
         |   POST /member/wx_login  |                          |
         |   {code, encryptedData}  |                          |
         |------------------------->|                          |
         |                          |                          |
         |                          | 2. 调用微信 API          |
         |                          |   获取 openid/unionid    |
         |                          |------------------------->|
         |                          |                          |
         |                          | 3. 创建/更新用户         |
         |                          |                          |
         | 4. 返回 token            |                          |
         |<-------------------------|                          |
         |                          |                          |
```

### 7.2 注解鉴权

```java
@DtUserDetect(mustHaveUser = true)  // 必须登录
@PostMapping("/member/info")
public Response<TcMemberInfo> getMemberInfo() {
    // 业务逻辑
}

@Tourist  // 游客可访问
@GetMapping("/home/config")
public Response<JSONObject> config() {
    // 业务逻辑
}
```

---

## 八、配置与环境

### 8.1 环境域名

| 环境 | 域名 |
|------|------|
| 生产 | `https://deeptrip.ly.com/` |
| QA | `https://dtgw.qa.ly.com/deeptrip/` |
| QA2 | `https://dtgw.qa.ly.com/deeptrip_qa2/` |

### 8.2 配置中心使用

```java
// 从配置中心获取配置
String config = ConfigCenterUtil.getValue("config_key", "default_value");
Integer intValue = ConfigCenterUtil.getInteger("int_key", 0);
```

---

## 九、总结

### 服务定位

`arsenal-ai-deeptrip` 是 DeepTrip 的 **服务端网关**：

1. **流量入口**：所有 C 端请求的统一入口
2. **路由分发**：智能分发到不同的 Agent 服务
3. **用户体系**：管理用户认证、会员信息
4. **运营支撑**：提供管理后台 API

### 调用方

| 调用方 | 调用场景 |
|--------|----------|
| H5 前端 | 用户对话、首页配置 |
| 小程序 | 用户对话、会员服务 |
| 管理后台 | 运营配置、API Key 管理 |

### 关键特性

- **SSE 流式响应**：支持实时对话流
- **WebSocket 长连接**：支持实时语音和对话
- **多端认证**：微信/Apple/Google 登录
- **ABTest 支持**：首页配置支持 AB 测试
- **API 限流**：支持按 API Key 限流
