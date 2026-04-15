# arsenal-service-ai-dataset 服务架构与调用链路分析

## 文档信息

- 作者：徐凯旋
- 邮箱：azouever@gmail.com
- 更新时间：2026-04-14

---

## 一、服务概述

`arsenal-service-ai-dataset` 是 DeepTrip 项目中的 **AI 业务数据集服务**，负责：

1. **多源数据聚合**：从各业务方获取数据，进行处理和清洗
2. **数据存储管理**：支持 MySQL、MongoDB、ElasticSearch、向量数据库等多种存储
3. **统一 API 服务**：为 Agent（如 agent-b101）和其他上游业务提供数据查询接口
4. **工具能力封装**：提供地图、天气等第三方 API 的统一封装

### 核心职责

| 职责 | 说明 |
|------|------|
| **酒店数据** | 国内/国际酒店查询、详情、价格等 |
| **机票数据** | 国内/国际航班查询、航线数据 |
| **火车票数据** | 火车班次、中转方案、站点信息 |
| **景区数据** | POI 搜索、景区详情、游玩攻略 |
| **地图工具** | 百度地图、高德地图、Google Maps API 封装 |
| **天气服务** | 和风天气 API 封装 |
| **苏心游数据** | 江苏省景区实时数据、客流、天气等 |
| **小红书数据** | 内容数据存储与检索 |

### 技术栈

| 技术 | 版本 |
|------|------|
| JDK | 17 |
| Spring Boot | 3.4.4 |
| MyBatis | 3.x |
| MongoDB | Spring Data MongoDB |
| ElasticSearch | 8.x |
| 向量数据库 | TencentVDB / Milvus |

---

## 二、服务架构图

### 2.1 整体架构图

```
+------------------------------------------------------------------+
|                 arsenal-service-ai-dataset                        |
|                    (AI 业务数据集服务)                              |
+------------------------------------------------------------------+
|                                                                   |
|  +--------------------------------------------------------+      |
|  |            arsenal-service-ai-dataset-api              |      |
|  |  +--------------------------------------------------+  |      |
|  |  |  Controller Layer                                |  |      |
|  |  |  +--------------------------------------------+  |  |      |
|  |  |  | agent/deeptrip/                             |  |  |      |
|  |  |  | - DeeptripHotelController     (酒店查询)   |  |  |      |
|  |  |  | - DeeptripSiteController      (景区查询)   |  |  |      |
|  |  |  | - DeeptripPoiController       (POI搜索)    |  |  |      |
|  |  |  | - DeeptripSxyController       (苏心游)     |  |  |      |
|  |  |  | - DeeptripTransportationController (交通)  |  |  |      |
|  |  |  +--------------------------------------------+  |  |      |
|  |  |  +--------------------------------------------+  |  |      |
|  |  |  | tool/                                       |  |  |      |
|  |  |  | - ToolBaiduMapController    (百度地图)     |  |  |      |
|  |  |  | - ToolGaoDeMapController    (高德地图)     |  |  |      |
|  |  |  | - ToolGoogleMapController   (谷歌地图)     |  |  |      |
|  |  |  | - ToolWeatherController     (天气服务)     |  |  |      |
|  |  |  +--------------------------------------------+  |  |      |
|  |  +--------------------------------------------------+  |      |
|  +--------------------------|-----------------------------+      |
|                             |                                    |
|  +--------------------------v-----------------------------+      |
|  |         arsenal-service-ai-dataset-application         |      |
|  |  +--------------------------------------------------+  |      |
|  |  |  dt/ (DeepTrip 核心业务服务)                       |  |      |
|  |  |  - DeepTripHotelService         (酒店业务)        |  |      |
|  |  |  - DeepTripSiteSupportService  (景区支持)         |  |      |
|  |  |  - DeeptripFlightService        (航班业务)        |  |      |
|  |  |  - DeeptripTrainService         (火车票业务)      |  |      |
|  |  |  - DeeptripTransportationService (交通业务)       |  |      |
|  |  +--------------------------------------------------+  |      |
|  |  +--------------------------------------------------+  |      |
|  |  |  bound/ (外部服务绑定层)                          |  |      |
|  |  |  - InvokeEsBoundService        (ES 操作)         |  |      |
|  |  |  - OneAiLlmService            (LLM 调用)         |  |      |
|  |  |  - QWeatherBoundService       (和风天气)         |  |      |
|  |  |  - SxyBoundService            (苏心游 API)       |  |      |
|  |  +--------------------------------------------------+  |      |
|  |  +--------------------------------------------------+  |      |
|  |  |  vdb/ (向量数据库)                               |  |      |
|  |  |  - TencentVDBBaseProcessor    (腾讯向量库)       |  |      |
|  |  |  - VectorDBExampleWithSparseVector              |  |      |
|  |  +--------------------------------------------------+  |      |
|  +--------------------------|-----------------------------+      |
|                             |                                    |
|  +--------------------------v-----------------------------+      |
|  |        arsenal-service-ai-dataset-infrastructure       |      |
|  |  - database/ (MySQL/MongoDB Mapper)                    |      |
|  |  - external/ (外部服务客户端)                          |      |
|  +--------------------------------------------------------+      |
|                                                                   |
|  +--------------------------------------------------------+      |
|  |          arsenal-service-ai-dataset-domain             |      |
|  |  - request/   (请求 DTO)                               |      |
|  |  - response/  (响应 DTO)                               |      |
|  |  - dto/       (数据传输对象)                           |      |
|  |  - dbobject/  (数据库实体)                             |      |
|  |  - mongo/     (MongoDB 文档)                           |      |
|  +--------------------------------------------------------+      |
|                                                                   |
|  +--------------------------------------------------------+      |
|  |          arsenal-service-ai-dataset-common             |      |
|  |  - enums/     (枚举定义)                               |      |
|  |  - util/      (工具类)                                 |      |
|  |  - constants/ (常量定义)                               |      |
|  +--------------------------------------------------------+      |
|                                                                   |
+------------------------------------------------------------------+
                              |
                              | HTTP / RPC
                              v
+------------------------------------------------------------------+
|                     外部数据源与存储                              |
+------------------------------------------------------------------+
|  +-------------+  +-------------+  +-------------+  +-----------+ |
|  | MySQL       |  | MongoDB     |  | ElasticSearch| | Redis    | |
|  | (结构化数据) |  | (文档存储)   |  | (全文检索)   | | (缓存)   | |
|  +-------------+  +-------------+  +-------------+  +-----------+ |
|  +-------------+  +-------------+  +-------------+              |
|  | TencentVDB  |  | 百度地图 API |  | 和风天气 API |              |
|  | (向量数据库) |  |              |  |             |              |
|  +-------------+  +-------------+  +-------------+              |
|  +-------------+  +-------------+  +-------------+              |
|  | 高德地图 API |  | Google Maps |  | 内部业务 API |              |
|  |             |  |             |  | (酒店/机票)  |              |
|  +-------------+  +-------------+  +-------------+              |
+------------------------------------------------------------------+
```

### 2.2 模块职责说明

```
arsenal-service-ai-dataset (parent)
├── arsenal-service-ai-dataset-api          # API 层（HTTP 入口）
│   └── restful/
│       ├── agent/deeptrip/                 # DeepTrip Agent API
│       ├── agent/train_assistant/          # 火车助手 API
│       ├── agent/air_assistant/            # 航班助手 API
│       ├── tool/                           # 工具类 API（地图、天气）
│       └── doc/                            # API 文档服务
├── arsenal-service-ai-dataset-application  # 应用层（业务逻辑）
│   ├── dt/                                 # DeepTrip 核心业务
│   ├── bound/                              # 外部服务绑定
│   ├── vdb/                                # 向量数据库
│   ├── http/                               # HTTP 客户端
│   └── feign/                              # Feign 客户端
├── arsenal-service-ai-dataset-domain       # 领域层（DTO/Entity）
│   ├── request/                            # 请求对象
│   ├── response/                           # 响应对象
│   ├── dto/                                # 数据传输对象
│   └── mongo/                              # MongoDB 文档
├── arsenal-service-ai-dataset-infrastructure # 基础设施层
│   ├── database/                           # 数据库访问
│   └── external/                           # 外部服务
├── arsenal-service-ai-dataset-common       # 公共模块
│   ├── enums/                              # 枚举
│   └── util/                               # 工具类
└── arsenal-framework                       # 框架基础能力
    ├── es/                                 # ElasticSearch 工具
    ├── redis/                              # Redis 工具
    └── util/                               # 通用工具
```

---

## 三、核心业务模块

### 3.1 酒店 API (DeeptripHotelController)

```
+------------------+     +----------------------+     +------------------+
|   agent-b101     |     | DeeptripHotelController|    | 内部酒店服务 API  |
|    (调用方)      |     |   /deeptrip/          |    |                  |
+--------+---------+     +----------+-----------+     +--------+---------+
         |                          |                          |
         | 1. POST /deeptrip/v3/hotelDetail                   |
         |   {hotelIds, includePriceDetail}                   |
         |------------------------->|                          |
         |                          |                          |
         |                          | 2. DeepTripHotelService  |
         |                          |   .qryHotelDetailV3()    |
         |                          |                          |
         |                          | 3. 调用内部酒店服务        |
         |                          |------------------------->|
         |                          |                          |
         |                          | 4. 返回酒店详情数据        |
         |                          |<-------------------------|
         |                          |                          |
         |                          | 5. 组装响应               |
         |                          |   - 酒店基础信息          |
         |                          |   - 价格详情              |
         |                          |   - 设施信息              |
         |                          |                          |
         | 6. Response<Object>      |                          |
         |<-------------------------|                          |
         |                          |                          |
```

**主要接口**：
| 接口 | 说明 |
|------|------|
| `POST /deeptrip/v3/hotelDetail` | 国内酒店详情查询 (V3) |
| `POST /deeptrip/v2/hotelDetail` | 国内酒店详情查询 (V2) |
| `POST /deeptrip/hotel/search` | 酒店搜索 |

### 3.2 POI 搜索 API (DeeptripPoiController)

```
+------------------+     +----------------------+     +------------------+
|   agent-b101     |     | DeeptripPoiController |    | ctripscenery 服务 |
|    (调用方)      |     |   /deeptrip/          |    |                  |
+--------+---------+     +----------+-----------+     +--------+---------+
         |                          |                          |
         | 1. POST /deeptrip/poi_search                      |
         |   {poi_id / poi_name / area}                      |
         |------------------------->|                          |
         |                          |                          |
         |                          | 2. 参数校验              |
         |                          |   - poi_id 或 poi_name   |
         |                          |     或 area 必填其一     |
         |                          |                          |
         |                          | 3. 调用 ctripscenery API |
         |                          |   /poi_search            |
         |                          |------------------------->|
         |                          |                          |
         |                          | 4. 返回 POI 列表         |
         |                          |<-------------------------|
         |                          |                          |
         | 5. PoiSearchResp         |                          |
         |   - items[]              |                          |
         |     - poi_id             |                          |
         |     - poi_name           |                          |
         |     - area               |                          |
         |     - coordinates        |                          |
         |<-------------------------|                          |
         |                          |                          |
```

### 3.3 苏心游 API (DeeptripSxyController)

```
+------------------+     +----------------------+     +------------------+
|   agent-b101     |     | DeeptripSxyController |    | 苏心游平台 API   |
|    (调用方)      |     |   /deeptrip/          |    |                  |
+--------+---------+     +----------+-----------+     +--------+---------+
         |                          |                          |
         | 1. POST /deeptrip/sxy_data                       |
         |   {tcSceneryId, recordDate}                       |
         |------------------------->|                          |
         |                          |                          |
         |                          | 2. 参数填充              |
         |                          |   - caller 固定值        |
         |                          |   - recordDate 默认当天   |
         |                          |                          |
         |                          | 3. SxyBoundService       |
         |                          |   .querySxyData()        |
         |                          |------------------------->|
         |                          |                          |
         |                          | 4. 返回景区实时数据        |
         |                          |   - 客流指数             |
         |                          |   - 天气信息             |
         |                          |   - 舒适度指数           |
         |                          |<-------------------------|
         |                          |                          |
         |                          | 5. 数据处理 & 缓存        |
         |                          |   - MongoDB 持久化       |
         |                          |   - 内存缓存             |
         |                          |                          |
         | 6. SxyQueryResp          |                          |
         |<-------------------------|                          |
         |                          |                          |
```

**主要接口**：
| 接口 | 说明 |
|------|------|
| `POST /deeptrip/sxy_data` | 苏心游景区数据查询 |
| `POST /deeptrip/sxy_realtime_overview` | 苏心游实时概览 |
| `POST /deeptrip/sxy_batch_warmup` | 批量预热缓存 |

---

## 四、工具类 API

### 4.1 百度地图工具 (ToolBaiduMapController)

```
+------------------+     +----------------------+     +------------------+
|   agent-b101     |     | ToolBaiduMapController|    |  百度地图 API    |
|    (调用方)      |     |   /tool/baidu_map/    |    |                  |
+--------+---------+     +----------+-----------+     +--------+---------+
         |                          |                          |
         | 1. POST /tool/baidu_map/direction/transit           |
         |   {origin, destination, ...}                        |
         |------------------------->|                          |
         |                          |                          |
         |                          | 2. validateAccess()      |
         |                          |   - 检查 biz-channel     |
         |                          |   - 检查 channel-token   |
         |                          |                          |
         |                          | 3. 调用百度地图 API       |
         |                          |   - 路线规划             |
         |                          |   - POI 检索             |
         |                          |   - 地理编码             |
         |                          |------------------------->|
         |                          |                          |
         |                          | 4. 返回结果              |
         |                          |<-------------------------|
         |                          |                          |
         | 5. JSONObject            |                          |
         |<-------------------------|                          |
         |                          |                          |
```

**主要接口**：
| 接口 | 说明 |
|------|------|
| `POST /tool/baidu_map/direction/transit` | 公共交通路线规划 |
| `POST /tool/baidu_map/place/search` | POI 搜索 |
| `POST /tool/baidu_map/geocoding` | 地理编码 |
| `POST /tool/baidu_map/reverse_geocoding` | 逆地理编码 |

### 4.2 天气工具 (ToolWeatherController)

```
+------------------+     +----------------------+     +------------------+
|   agent-b101     |     | ToolWeatherController |    |   和风天气 API   |
|    (调用方)      |     |   /tool/weather/      |    |                  |
+--------+---------+     +----------+-----------+     +--------+---------+
         |                          |                          |
         | 1. POST /tool/weather/now                        |
         |   {location}                                      |
         |------------------------->|                          |
         |                          |                          |
         |                          | 2. QWeatherBoundService  |
         |                          |   .getWeatherNow()       |
         |                          |------------------------->|
         |                          |                          |
         | 3. 天气数据              |                          |
         |<-------------------------|                          |
         |                          |                          |
```

---

## 五、数据存储架构

### 5.1 存储介质说明

```
+------------------------------------------------------------------+
|                        数据存储层                                  |
+------------------------------------------------------------------+
|                                                                   |
|  +-------------+     +-------------+     +-------------+          |
|  | MySQL       |     | MongoDB     |     | ElasticSearch|         |
|  | (DCDB/TiDB) |     |             |     |             |          |
|  +-------------+     +-------------+     +-------------+          |
|  |             |     |             |     |             |          |
|  | - 用户数据   |     | - 苏心游数据 |     | - 小红书内容 |          |
|  | - 订单关联   |     | - 日志记录   |     | - 查询记录   |          |
|  | - 配置数据   |     | - 缓存数据   |     | - 全文检索   |          |
|  |             |     |             |     |             |          |
|  +-------------+     +-------------+     +-------------+          |
|                                                                   |
|  +-------------+     +-------------+     +-------------+          |
|  | TencentVDB  |     | Redis       |     | Amazon S3   |          |
|  | (向量数据库) |     | (缓存)       |     | (对象存储)   |          |
|  +-------------+     +-------------+     +-------------+          |
|  |             |     |             |     |             |          |
|  | - 向量检索   |     | - 热点缓存   |     | - 文件存储   |          |
|  | - 语义搜索   |     | - 分布式锁   |     | - 图片/视频  |          |
|  |             |     |             |     |             |          |
|  +-------------+     +-------------+     +-------------+          |
|                                                                   |
+------------------------------------------------------------------+
```

### 5.2 ElasticSearch 使用

```
InvokeEsBoundService
├── ES_INDEX_NAME = "arsenal-aidatasetxhs"        # 小红书内容索引
├── ES_COZE_REQ_INDEX_NAME = "arsenal-aidatasetcozeqry"  # 查询记录索引
└── ES_TC_USER_VISIT_HISTORY_INDEX_NAME = "arsenal-aitcuserhistory"  # 用户历史索引

主要方法：
- sync2es()           # 同步数据到 ES
- sync2es4XHS()       # 小红书数据同步
- sync2es4CozeReq()   # 查询记录同步
- qryContentPage()    # 分页查询内容
```

### 5.3 向量数据库使用

```
TencentVDBBaseProcessor
├── insert()          # 插入向量
├── search()          # 向量检索
├── hybridSearch()    # 混合检索（向量 + 关键词）
└── delete()          # 删除向量

使用场景：
- 语义相似度搜索
- 推荐系统
- RAG (Retrieval Augmented Generation)
```

---

## 六、agent-b101 调用 dataset 服务的链路

### 6.1 酒店查询调用链路

```
+-------------+     +-------------------+     +---------------------+     +-------------+
|  agent-b101 |     | arsenal-service-  |     | DeepTripHotelService|     | 内部酒店服务 |
|  (Python)   |     | ai-dataset        |     |                     |     |             |
+------+------+     +---------+---------+     +----------+----------+     +-----+-------+
       |                      |                          |                    |
       | 1. hotel_search_tool |                          |                    |
       |    POST /deeptrip/v3/hotelDetail                |                    |
       |--------------------->|                          |                    |
       |                      |                          |                    |
       |                      | 2. Controller 解析参数    |                    |
       |                      |    @CommonAuthCheck 校验  |                    |
       |                      |                          |                    |
       |                      | 3. Service 业务处理       |                    |
       |                      |------------------------->|                    |
       |                      |                          |                    |
       |                      |                          | 4. 调用内部 API     |
       |                      |                          |-------------------->|
       |                      |                          |                    |
       |                      |                          | 5. 酒店数据         |
       |                      |                          |<-------------------|
       |                      |                          |                    |
       |                      | 6. 数据组装与转换         |                    |
       |                      |<-------------------------|                    |
       |                      |                          |                    |
       | 7. Response<Hotel>   |                          |                    |
       |<---------------------|                          |                    |
       |                      |                          |                    |
```

### 6.2 地图工具调用链路

```
+-------------+     +-------------------+     +---------------------+     +-------------+
|  agent-b101 |     | arsenal-service-  |     | ToolBaiduMapController|    | 百度地图 API |
|  (Python)   |     | ai-dataset        |     |                     |     |             |
+------+------+     +---------+---------+     +----------+----------+     +-----+-------+
       |                      |                          |                    |
       | 1. baidu_map_tool    |                          |                    |
       |    POST /tool/baidu_map/direction/transit       |                    |
       |--------------------->|                          |                    |
       |                      |                          |                    |
       |                      | 2. validateAccess()      |                    |
       |                      |    - biz-channel 校验    |                    |
       |                      |    - channel-token 校验  |                    |
       |                      |                          |                    |
       |                      | 3. OkHttpClientUtil      |                    |
       |                      |    发起 HTTP 请求         |                    |
       |                      |------------------------->|                    |
       |                      |                          |                    |
       |                      |                          | 4. 调用百度 API     |
       |                      |                          |-------------------->|
       |                      |                          |                    |
       |                      |                          | 5. 路线规划结果     |
       |                      |                          |<-------------------|
       |                      |                          |                    |
       |                      | 6. 解析响应              |                    |
       |                      |<-------------------------|                    |
       |                      |                          |                    |
       | 7. JSONObject        |                          |                    |
       |<---------------------|                          |                    |
       |                      |                          |                    |
```

---

## 七、认证与权限控制

### 7.1 @CommonAuthCheck 注解

```java
// 用于 Controller 方法级别的权限校验
@PostMapping(value = "/v3/hotelDetail")
@CommonAuthCheck
public Response<Object> hotelDetailV3(@RequestBody DeeptripHotelDetailReq request) {
    // 业务逻辑
}
```

### 7.2 工具 API 访问控制

```java
// ToolBaiduMapController 中的访问校验
private void validateAccess() {
    // 1. 从请求头获取 biz-channel 和 channel-token
    String channel = request.getHeader("biz-channel");
    String authorization = request.getHeader("channel-token");

    // 2. 从配置中心获取允许的通道列表
    String datasetAccessControlList = ConfigCenterUtil.getValue("datasetAccessControlList", "...");

    // 3. 验证通道和 token 是否匹配
    // ...
}
```

---

## 八、访问记录与监控

### 8.1 BizWebAccessRecordService

每次 API 调用都会记录访问日志：

```java
BizWebAccessRecordDTO record = new BizWebAccessRecordDTO();
record.setBiz("Deeptrip");                    // 业务标识
record.setFeature("国内酒店业务详情查询(V3)"); // 功能名称
record.setApi("/deeptrip/v3/hotelDetail");    // API 路径
record.setKeyWord1(JSONUtil.toJsonStr(request.getHotelIds())); // 关键参数
record.setEnv(EnvHelper.getApplicationEnv()); // 环境标识
record.setTraceId(ApmTraceUtils.getTraceId()); // 链路追踪 ID
record.setCostTime(stopwatch.elapsed(TimeUnit.MILLISECONDS)); // 耗时

// 异步写入记录
AsyncTaskCommonThreadPool.submit(() -> bizWebAccessRecordService.record(record));
```

---

## 九、配置管理

### 9.1 配置中心使用

```java
// 从配置中心获取配置
String url = ConfigCenterUtil.getValue("deeptrip.poi.search.url", "http://ctripscenery.17usoft.com/poi_search");
String token = ConfigCenterUtil.getValue("deeptrip.poi.search.token", "default_token");
```

### 9.2 环境区分

| 环境 | 域名 |
|------|------|
| 生产 | `http://arsenal-ai-dataset.17usoft.com/` |
| QA | `http://arsenal-ai-dataset.qa.17usoft.com/` |
| QA1 | `http://arsenal-ai-dataset.qa1.17usoft.com/` |

---

## 十、与 DeepTrip 其他服务的协作关系

```
+-------------------+     +-------------------+     +-------------------+
|   agent-b101      |     | arsenal-service-  |     | arsenal-service-  |
|   (Agent 核心)    |     | ai-dataset        |     | ai-mcp            |
|                   |     | (数据集服务)       |     | (MCP 服务)        |
+---------+---------+     +---------+---------+     +---------+---------+
          |                         |                         |
          | 1. 业务数据查询          |                         |
          | POST /deeptrip/...      |                         |
          |------------------------>|                         |
          |                         |                         |
          | 2. 工具类调用            |                         |
          | POST /tool/baidu_map/...|                         |
          |------------------------>|                         |
          |                         |                         |
          | 3. MCP 工具调用          |                         |
          | POST /api/mcp/tools/call|                         |
          |----------------------------------------->|        |
          |                         |                         |
          |                         |                         |

职责划分：
- arsenal-service-ai-dataset: 提供"静态"数据查询（酒店、机票、景区等业务数据）
- arsenal-service-ai-mcp: 提供"动态"工具能力（MCP 协议封装的外部工具）
- agent-b101: 编排和调用上述两种服务
```

---

## 十一、总结

### 服务定位

`arsenal-service-ai-dataset` 是 DeepTrip 的 **数据底座**：

1. **数据聚合中心**：整合酒店、机票、火车、景区等多源数据
2. **工具封装层**：统一封装地图、天气等第三方 API
3. **存储管理**：管理 MySQL、MongoDB、ES、向量数据库等多种存储
4. **API 网关**：为 Agent 和上游业务提供标准化数据接口

### 调用方

| 调用方 | 调用场景 |
|--------|----------|
| agent-b101 | Agent 工具调用（酒店搜索、景区查询等） |
| arsenal-ai-deeptrip | 业务服务数据查询 |
| 内部管理系统 | 数据管理与维护 |

### 关键特性

- **多存储支持**：MySQL + MongoDB + ES + 向量数据库 + Redis
- **统一认证**：@CommonAuthCheck 注解 + channel-token 校验
- **访问记录**：全链路访问日志记录
- **配置中心**：动态配置管理
- **环境隔离**：生产/QA/QA1 环境独立部署
