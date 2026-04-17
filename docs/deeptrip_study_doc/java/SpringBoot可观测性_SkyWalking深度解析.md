# Spring Boot 项目可观测性实践：SkyWalking 深度解析

> **作者**: 技术团队
> **更新时间**: 2026-04-16
> **关键词**: Spring Boot, 可观测性, SkyWalking, APM, 链路追踪

---

## 一、可观测性概述

### 1.1 什么是可观测性

可观测性（Observability）是指通过系统外部输出（日志、指标、链路）来推断系统内部状态的能力。与传统的监控不同，可观测性强调的是"主动发现问题"而非"被动告警"。

**可观测性三支柱**：

```
┌─────────────────────────────────────────────────────────────┐
│                      可观测性三支柱                           │
├─────────────┬─────────────┬─────────────────────────────────┤
│   Metrics   │   Logs      │        Traces                   │
│   指标      │   日志       │        链路追踪                  │
├─────────────┼─────────────┼─────────────────────────────────┤
│ 聚合数值    │ 离散事件     │ 请求完整调用链                   │
│ QPS/延迟    │ 错误日志     │ 跨服务调用关系                   │
│ 资源使用率  │ 业务日志     │ 性能瓶颈定位                     │
│ Grafana     │ ELK/Loki    │ SkyWalking/Jaeger              │
└─────────────┴─────────────┴─────────────────────────────────┘
```

### 1.2 为什么需要 APM

传统监控的局限性：

| 问题 | 传统监控 | APM 解决方案 |
|------|----------|--------------|
| 服务调用关系不清晰 | 只能看单点 | 全链路拓扑图 |
| 性能瓶颈难定位 | 只知道慢，不知道哪慢 | 方法级耗时分析 |
| 异常根因难追溯 | 日志分散 | TraceID 关联全链路 |
| 跨语言异构系统 | 各自独立 | 统一观测平台 |

---

## 二、SkyWalking 简介

### 2.1 SkyWalking 架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SkyWalking 架构                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐       │
│  │ Service A │───▶│ Service B │───▶│   DB     │    │  Cache   │       │
│  └────┬─────┘    └────┬─────┘    └──────────┘    └──────────┘       │
│       │               │                                             │
│       ▼               ▼                                             │
│  ┌────────────────────────┐                                         │
│  │   SkyWalking Agent     │  (Java Agent / .NET Agent / Go Agent)  │
│  │   字节码增强无侵入       │                                         │
│  └───────────┬────────────┘                                         │
│              │ gRPC / HTTP                                          │
│              ▼                                                       │
│  ┌────────────────────────┐                                         │
│  │   OAP Server           │  (Observability Analysis Platform)      │
│  │   数据聚合 / 分析        │                                         │
│  └───────────┬────────────┘                                         │
│              │                                                       │
│              ▼                                                       │
│  ┌────────────────────────┐                                         │
│  │   Storage              │  (ES / MySQL / TiDB / H2)               │
│  └────────────────────────┘                                         │
│              │                                                       │
│              ▼                                                       │
│  ┌────────────────────────┐                                         │
│  │   SkyWalking UI        │  (可视化界面)                            │
│  └────────────────────────┘                                         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心组件

| 组件 | 作用 | 说明 |
|------|------|------|
| **Agent** | 数据采集 | 基于字节码增强，无侵入式埋点 |
| **OAP Server** | 数据处理 | 接收 Agent 数据，聚合分析，存储 |
| **Storage** | 数据存储 | 支持 ES、MySQL、TiDB、H2 等 |
| **UI** | 可视化 | 服务拓扑、调用链、性能指标展示 |

### 2.3 SkyWalking vs 其他 APM

| 特性 | SkyWalking | Jaeger | Zipkin | Pinpoint |
|------|------------|--------|--------|----------|
| 语言支持 | 多语言 | 多语言 | 多语言 | Java |
| 埋点方式 | 无侵入 | 手动/自动 | 手动/自动 | 无侵入 |
| 存储 | ES/MySQL/TiDB | ES/Cassandra | ES/MySQL | HBase |
| UI 丰富度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| 告警能力 | 强 | 弱 | 弱 | 中 |
| 社区活跃度 | 高 | 高 | 中 | 中 |
| 国内使用度 | 高 | 中 | 低 | 中 |

---

## 三、Spring Boot 集成 SkyWalking

### 3.1 环境准备

**下载 SkyWalking**：

```bash
# 下载最新版本
wget https://archive.apache.org/dist/skywalking/9.3.0/apache-skywalking-apm-9.3.0.tar.gz

# 解压
tar -zxvf apache-skywalking-apm-9.3.0.tar.gz

# 目录结构
apache-skywalking-apm-bin/
├── agent/              # Agent 目录
│   ├── skywalking-agent.jar
│   └── config/
│       └── agent.config
├── bin/                # 启动脚本
├── config/             # OAP 配置
├── oap-libs/           # OAP 依赖
└── webapp/             # UI
```

**启动 SkyWalking OAP 和 UI**：

```bash
cd apache-skywalking-apm-bin/bin

# 启动 OAP Server
./oapService.sh

# 启动 UI
./webappService.sh

# 访问 UI
# http://localhost:8080
```

### 3.2 Spring Boot 应用接入

**方式一：启动参数方式（推荐）**

```bash
# 启动 Spring Boot 应用
java -javaagent:/path/to/skywalking-agent.jar \
     -Dskywalking.agent.service_name=my-spring-boot-app \
     -Dskywalking.collector.backend_service=localhost:11800 \
     -jar your-application.jar
```

**方式二：配置 agent.config**

```properties
# agent/config/agent.config

# 服务名称
agent.service_name=${SW_AGENT_NAME:my-spring-boot-app}

# OAP Server 地址
collector.backend_service=${SW_AGENT_COLLECTOR_BACKEND_SERVICES:localhost:11800}

# 日志级别
logging.level=${SW_LOGGING_LEVEL:INFO}

# 采样率（默认全采样）
agent.sample_n_per_3_secs=${SW_AGENT_SAMPLE:-1}
```

**方式三：Docker/K8s 部署**

```yaml
# docker-compose.yml
version: '3.8'
services:
  app:
    image: my-spring-boot-app
    environment:
      - SW_AGENT_NAME=my-app
      - SW_AGENT_COLLECTOR_BACKEND_SERVICES=oap:11800
    volumes:
      - ./skywalking-agent:/skywalking-agent
    entrypoint:
      - java
      - -javaagent:/skywalking-agent/skywalking-agent.jar
      - -jar
      - /app.jar
    depends_on:
      - oap
      - ui

  oap:
    image: apache/skywalking-oap-server:9.3.0
    ports:
      - "11800:11800"
      - "12800:12800"

  ui:
    image: apache/skywalking-ui:9.3.0
    ports:
      - "8080:8080"
    environment:
      - SW_OAP_ADDRESS=http://oap:12800
```

### 3.3 Spring Boot 配置优化

**application.yml**：

```yaml
spring:
  application:
    name: my-spring-boot-app

# SkyWalking 日志集成
logging:
  pattern:
    level: "%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] [%tid] %-5level %logger{36} - %msg%n"

# 自定义配置
skywalking:
  agent:
    service-name: ${spring.application.name}
  collector:
    backend-service: localhost:11800
```

---

## 四、SkyWalking 核心功能详解

### 4.1 服务拓扑图

自动生成服务间调用关系图，直观展示：

```
┌──────────────────────────────────────────────────────────────┐
│                     服务拓扑示例                               │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│    ┌─────────┐      ┌─────────┐      ┌─────────┐            │
│    │ Gateway │─────▶│ Order   │─────▶│  User   │            │
│    │  :8080  │      │ Service │      │ Service │            │
│    └─────────┘      └────┬────┘      └─────────┘            │
│         │                │                                   │
│         │                ▼                                   │
│         │          ┌─────────┐                               │
│         │          │ Product │                               │
│         │          │ Service │                               │
│         │          └────┬────┘                               │
│         │               │                                    │
│         ▼               ▼                                    │
│    ┌─────────┐     ┌─────────┐                               │
│    │  MySQL  │     │  Redis  │                               │
│    │   DB    │     │ Cache   │                               │
│    └─────────┘     └─────────┘                               │
│                                                               │
│  颜色标识：                                                    │
│  🟢 健康  🟡 警告  🔴 异常                                     │
└──────────────────────────────────────────────────────────────┘
```

**拓扑图展示信息**：

| 指标 | 说明 |
|------|------|
| 调用频率 | 服务间调用次数 |
| 响应时间 | P99 / P95 / 平均延迟 |
| 错误率 | 调用失败百分比 |
| SLA | 服务可用性 |

### 4.2 链路追踪（Trace）

**Trace 数据结构**：

```
Trace (一次完整请求)
│
├── Span A (Gateway接收请求)
│   │
│   ├── Span B (Order Service 创建订单)
│   │   │
│   │   ├── Span C (User Service 查询用户)
│   │   │   └── Span D (MySQL 查询)
│   │   │
│   │   ├── Span E (Product Service 查库存)
│   │   │   └── Span F (Redis 缓存查询)
│   │   │
│   │   └── Span G (MySQL 写入订单)
│   │
│   └── Span H (返回响应)
```

**Span 核心字段**：

```json
{
  "traceId": "d9f3b7a2c1e4f5a6",
  "spanId": 3,
  "parentSpanId": 2,
  "serviceCode": "order-service",
  "startTime": 1713123456789,
  "endTime": 1713123456890,
  "component": "SpringMVC",
  "operationName": "/api/orders",
  "tags": {
    "http.method": "POST",
    "http.url": "/api/orders",
    "http.status_code": "200"
  },
  "logs": [
    {
      "time": 1713123456800,
      "event": "info",
      "message": "Order created successfully"
    }
  ]
}
```

### 4.3 性能指标分析

**服务维度指标**：

```
┌─────────────────────────────────────────────────────────────┐
│                    Order Service 性能指标                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  服务可用性 (SLA):  99.95%                                    │
│                                                              │
│  响应时间:                                                    │
│  ├── 平均:  45ms                                             │
│  ├── P95:   120ms                                            │
│  └── P99:   250ms                                            │
│                                                              │
│  吞吐量:                                                      │
│  ├── 每分钟请求数:  12,000                                    │
│  └── 每秒请求数:    200                                       │
│                                                              │
│  错误率:  0.05%                                               │
│                                                              │
│  ┌─────────────────────────────────────────────────┐        │
│  │           响应时间分布 (最近 1 小时)               │        │
│  │  600ms ┤                                         │        │
│  │  500ms ┤     ▓▓                                  │        │
│  │  400ms ┤     ▓▓▓                                 │        │
│  │  300ms ┤    ▓▓▓▓▓                                │        │
│  │  200ms ┤   ▓▓▓▓▓▓▓▓                             │        │
│  │  100ms ┤ ▓▓▓▓▓▓▓▓▓▓▓▓▓                          │        │
│  │   50ms ┤▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓                        │        │
│  │    0ms └─────────────────────────────────────────┘        │
│  └─────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────┘
```

### 4.4 端点分析

**端点性能排行**：

| 端点 | 调用次数 | 平均延迟 | P99 延迟 | 错误率 |
|------|----------|----------|----------|--------|
| POST /api/orders | 50,000 | 45ms | 250ms | 0.1% |
| GET /api/users/{id} | 120,000 | 12ms | 80ms | 0.02% |
| GET /api/products | 80,000 | 35ms | 150ms | 0.05% |
| POST /api/payments | 30,000 | 180ms | 500ms | 1.2% ⚠️ |

**慢调用分析**：

```
┌─────────────────────────────────────────────────────────────┐
│               POST /api/payments 慢调用分析                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  总耗时: 500ms                                                │
│                                                              │
│  ├── Gateway 路由:           5ms  (1%)                       │
│  ├── Payment Service 处理:  50ms  (10%)                      │
│  ├── 第三方支付接口调用:    400ms  (80%)  ⬅️ 性能瓶颈        │
│  ├── 数据库写入:            30ms  (6%)                       │
│  └── 消息队列通知:          15ms  (3%)                       │
│                                                              │
│  优化建议:                                                    │
│  1. 第三方支付接口超时设置优化                                 │
│  2. 考虑异步化处理支付结果回调                                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 五、高级特性与最佳实践

### 5.1 自定义链路埋点

**使用 @Trace 注解**：

```java
import org.apache.skywalking.apm.toolkit.trace.Trace;
import org.apache.skywalking.apm.toolkit.trace.TraceContext;
import org.apache.skywalking.apm.toolkit.trace.TraceId;

@Service
public class OrderService {

    @Trace(operationName = "create_order")
    @Tags({
        @Tag(key = "order.type", value = "arg[0].type"),
        @Tag(key = "order.amount", value = "returnedObj.amount")
    })
    public Order createOrder(OrderRequest request) {
        // 获取 TraceId 用于日志关联
        TraceId traceId = TraceContext.traceId();
        log.info("TraceId: {}, Creating order for user: {}", traceId, request.getUserId());

        // 业务逻辑...
        Order order = doCreateOrder(request);

        return order;
    }
}
```

**手动创建 Span**：

```java
import org.apache.skywalking.apm.toolkit.trace.ActiveSpan;
import org.apache.skywalking.apm.toolkit.trace.TraceContext;

@Service
public class PaymentService {

    public void processPayment(PaymentRequest request) {
        // 手动创建本地 Span
        ActiveSpan span = TraceContext.createLocalSpan("process_payment");

        try {
            // 添加标签
            span.tag("payment.method", request.getMethod());
            span.tag("payment.amount", String.valueOf(request.getAmount()));

            // 业务处理
            doPayment(request);

        } catch (Exception e) {
            // 记录异常
            span.errorOccurred().log(e);
            throw e;
        } finally {
            span.finish();
        }
    }
}
```

### 5.2 日志集成

**Logback 集成（推荐）**：

```xml
<!-- pom.xml -->
<dependency>
    <groupId>org.apache.skywalking</groupId>
    <artifactId>apm-toolkit-logback-1.x</artifactId>
    <version>9.3.0</version>
</dependency>
```

```xml
<!-- logback-spring.xml -->
<configuration>
    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder class="org.apache.skywalking.apm.toolkit.log.logback.v1.x.TraceIdPatternLogEncoder">
            <pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} [%tid] [%thread] %-5level %logger{36} - %msg%n</pattern>
        </encoder>
    </appender>

    <!-- gRPC 日志上报到 SkyWalking -->
    <appender name="GRPC_LOG" class="org.apache.skywalking.apm.toolkit.log.logback.v1.x.GRPCLogClientAppender">
        <encoder class="org.apache.skywalking.apm.toolkit.log.logback.v1.x.TraceIdPatternLogEncoder">
            <pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} [%tid] [%thread] %-5level %logger{36} - %msg%n</pattern>
        </encoder>
    </appender>

    <root level="INFO">
        <appender-ref ref="CONSOLE"/>
        <appender-ref ref="GRPC_LOG"/>
    </root>
</configuration>
```

**日志效果**：

```
2026-04-16 10:30:15.123 [T=d9f3b7a2c1e4f5a6] [http-nio-8080-exec-1] INFO  OrderService - Creating order for user: 12345
2026-04-16 10:30:15.145 [T=d9f3b7a2c1e4f5a6] [http-nio-8080-exec-1] INFO  PaymentService - Processing payment: $99.00
2026-04-16 10:30:15.234 [T=d9f3b7a2c1e4f5a6] [http-nio-8080-exec-1] INFO  OrderService - Order created: ORD-2026-001
```

### 5.3 告警配置

**alarm-settings.yml**：

```yaml
# 告警规则定义
rules:
  # 服务响应时间告警
  service_resp_time_rule:
    metrics-name: service_resp_time
    op: ">"
    threshold: 1000
    period: 10
    count: 3
    message: "服务 {name} 平均响应时间超过 1秒"

  # 服务成功率告警
  service_sla_rule:
    metrics-name: service_sla
    op: "<"
    threshold: 9500  # 95%
    period: 10
    count: 2
    message: "服务 {name} 成功率低于 95%"

  # 端点响应时间告警
  endpoint_resp_time_rule:
    metrics-name: endpoint_resp_time
    op: ">"
    threshold: 2000
    period: 10
    count: 3
    message: "端点 {name} 响应时间超过 2秒"

# 告警通知渠道
webhooks:
  - url: http://your-webhook/alert
    method: POST
    headers:
      Content-Type: application/json
    body: |
      {
        "title": "SkyWalking 告警",
        "message": "${message}",
        "service": "${service}",
        "time": "${time}"
      }

# 钉钉通知
dingtalks:
  - webhook-url: https://oapi.dingtalk.com/robot/send?access_token=xxx
    security-token: your-secret
```

### 5.4 数据库监控

**MySQL 慢查询监控**：

```java
// 自动采集 MySQL 调用
// 无需额外配置，Agent 自动拦截 JDBC 调用

@Service
public class UserRepository {

    // 自动生成 SQL Span
    @Autowired
    private JdbcTemplate jdbcTemplate;

    public User findById(Long id) {
        // SkyWalking 自动记录:
        // - SQL 语句
        // - 执行时间
        // - 慢查询标记
        return jdbcTemplate.queryForObject(
            "SELECT * FROM users WHERE id = ?",
            new Object[]{id},
            userRowMapper
        );
    }
}
```

**连接池监控**：

```yaml
# application.yml
spring:
  datasource:
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5
      # 慢查询阈值
      connection-timeout: 30000
```

### 5.5 分布式追踪上下文传播

**跨线程传播 TraceContext**：

```java
import org.apache.skywalking.apm.toolkit.trace.TraceContext;
import org.apache.skywalking.apm.toolkit.trace.RunnableWrapper;

@Service
public class AsyncService {

    @Autowired
    private ThreadPoolTaskExecutor executor;

    public void asyncProcess(String data) {
        // 方式一：使用 RunnableWrapper 包装
        executor.execute(RunnableWrapper.of(() -> {
            // 自动继承 TraceContext
            processInBackground(data);
        }));

        // 方式二：手动传递
        TraceId traceId = TraceContext.traceId();
        executor.execute(() -> {
            // 在新线程中恢复上下文
            TraceContext.continueTrace(traceId);
            processInBackground(data);
        });
    }
}
```

**跨服务 HTTP 传播**：

```java
// SkyWalking Agent 自动处理 HTTP Header 传播
// 无需手动编码

// Header 格式:
// sw8: 1-MQ==-d9f3b7a2c1e4f5a6-xxx-xxx

// Feign 调用自动传播
@FeignClient(name = "user-service")
public interface UserClient {
    @GetMapping("/api/users/{id}")
    User getUser(@PathVariable Long id);
}

// RestTemplate 调用自动传播
@Autowired
private RestTemplate restTemplate;

public User getUser(Long id) {
    return restTemplate.getForObject("http://user-service/api/users/" + id, User.class);
}
```

---

## 六、生产环境最佳实践

### 6.1 性能调优

**Agent 配置优化**：

```properties
# agent/config/agent.config

# 采样率配置（生产环境建议采样）
agent.sample_n_per_3_secs=${SW_AGENT_SAMPLE:5}

# 缓冲区大小
buffer.channel_size=${SW_BUFFER_CHANNEL_SIZE:1000}
buffer.buffer_size=${SW_BUFFER_BUFFER_SIZE:300}

# 状态检查间隔
agent.cool_down_threshold=${SW_AGENT_COOL_DOWN:3000}

# 忽略特定路径
trace.ignore_path=${SW_IGNORE_PATH:/actuator/**,/health,/metrics/**}
```

**OAP Server 调优**：

```yaml
# config/application.yml

core:
  default:
    # 数据分片
    downsampling:
      - Hour
      - Day

    # 存储 TTL
    dataTTL: 7  # 天级数据保留 7 天

storage:
  elasticsearch:
    # 批量写入配置
    bulkActions: 5000
    bulkSize: 50
    flushInterval: 10

# JVM 参数
# -Xms4g -Xmx4g -XX:+UseG1GC
```

### 6.2 高可用部署

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SkyWalking 高可用部署架构                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐                         │
│  │ Service A │   │ Service B │   │ Service C │                        │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘                         │
│       │              │              │                                │
│       ▼              ▼              ▼                                │
│  ┌────────────────────────────────────────┐                         │
│  │           Load Balancer (Nginx)         │                        │
│  └───────────────────┬────────────────────┘                         │
│                      │                                               │
│          ┌───────────┼───────────┐                                  │
│          ▼           ▼           ▼                                  │
│    ┌──────────┐ ┌──────────┐ ┌──────────┐                          │
│    │  OAP-1   │ │  OAP-2   │ │  OAP-3   │   OAP 集群               │
│    │ (混询模式)│ │ (混询模式)│ │ (混询模式)│                          │
│    └────┬─────┘ └────┬─────┘ └────┬─────┘                          │
│         │            │            │                                 │
│         └────────────┼────────────┘                                 │
│                      │                                               │
│                      ▼                                               │
│         ┌────────────────────────┐                                   │
│         │   Elasticsearch 集群    │                                  │
│         │  (3 节点，分片 + 副本)   │                                  │
│         └────────────────────────┘                                   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**OAP 集群配置**：

```yaml
# config/application.yml

cluster:
  selector: ${SW_CLUSTER:zookeeper}

  zookeeper:
    hostPort: ${SW_CLUSTER_ZK_HOST_PORT:zk1:2181,zk2:2181,zk3:2181}
    sessionTimeout: ${SW_CLUSTER_ZK_SESSION_TIMEOUT:30000}
```

### 6.3 监控指标

**关键监控项**：

| 指标类型 | 指标名称 | 告警阈值 |
|----------|----------|----------|
| 服务可用性 | SLA | < 99.9% |
| 响应时间 | P99 延迟 | > 500ms |
| 错误率 | 错误百分比 | > 1% |
| 吞吐量 | QPS | 突降 50% |
| JVM | GC 时间占比 | > 10% |
| 数据库 | 慢查询比例 | > 5% |

**Grafana 集成**：

```yaml
# prometheus 配置采集 SkyWalking 指标
scrape_configs:
  - job_name: 'skywalking'
    static_configs:
      - targets: ['oap:1234']
```

---

## 七、常见问题排查

### 7.1 Agent 未正常工作

**检查清单**：

```bash
# 1. 确认 javaagent 参数正确
ps aux | grep javaagent

# 2. 检查 Agent 日志
tail -f logs/skywalking-agent.log

# 3. 验证 OAP 连通性
telnet oap-server 11800

# 4. 确认服务名配置
curl http://localhost:8080/actuator/health
```

**常见问题**：

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 无数据上报 | Agent 未加载 | 检查 -javaagent 参数位置（必须在 -jar 之前） |
| 服务名显示为 UNKNOWN | 未配置 service_name | 设置 -Dskywalking.agent.service_name |
| 数据丢失 | 采样率过低 | 调整 agent.sample_n_per_3_secs |
| 性能下降 | 采样率过高 | 生产环境建议采样率 5-10% |

### 7.2 链路断裂

**常见原因**：

```
┌─────────────────────────────────────────────────────────────┐
│                     链路断裂常见原因                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. 异步调用未传播 TraceContext                              │
│     └─▶ 使用 RunnableWrapper 或手动传递                      │
│                                                              │
│  2. 第三方服务未接入 SkyWalking                              │
│     └─▶ 使用 @Trace 手动埋点                                │
│                                                              │
│  3. 消息队列调用未关联                                        │
│     └─▶ 使用 SkyWalking MQ 插件                             │
│                                                              │
│  4. 自定义线程池未包装                                        │
│     └─▶ 使用 TraceableExecutorService                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**解决方案**：

```java
// 消息队列 Trace 传播
@Component
public class TraceMessageConverter implements MessageConverter {

    @Override
    public Message toMessage(Object object, MessageProperties messageProperties) {
        // 将 TraceContext 写入消息头
        TraceId traceId = TraceContext.traceId();
        messageProperties.setHeader("sw_trace_id", traceId.toString());
        return new Message(object.toString().getBytes(), messageProperties);
    }

    @Override
    public Object fromMessage(Message message) throws MessageConversionException {
        // 从消息头恢复 TraceContext
        String traceId = message.getMessageProperties().getHeader("sw_trace_id");
        if (traceId != null) {
            TraceContext.continueTrace(new TraceId(traceId));
        }
        return new String(message.getBody());
    }
}
```

---

## 八、总结

### 8.1 SkyWalking 核心优势

| 优势 | 说明 |
|------|------|
| **无侵入** | 基于 Java Agent 字节码增强，零代码修改 |
| **全链路** | 自动采集服务、数据库、消息队列调用 |
| **可视化** | 拓扑图、调用链、性能指标一目了然 |
| **告警完善** | 支持多种告警规则和通知渠道 |
| **生态丰富** | 支持 Spring Cloud、Dubbo、gRPC 等主流框架 |

### 8.2 接入建议

1. **开发环境**：全采样，快速定位问题
2. **测试环境**：全采样，验证性能瓶颈
3. **生产环境**：采样 1-5%，降低性能影响

### 8.3 参考资料

- [SkyWalking 官方文档](https://skywalking.apache.org/docs/)
- [Spring Boot 集成指南](https://skywalking.apache.org/docs/skywalking-java/zh/latest/setup/service-agent/java-agent/)
- [最佳实践 GitHub](https://github.com/apache/skywalking)

---

## 附录：常用配置速查

```properties
# Agent 核心配置
agent.service_name=${SW_AGENT_NAME:your-service}
collector.backend_service=${SW_AGENT_COLLECTOR_BACKEND_SERVICES:localhost:11800}
agent.sample_n_per_3_secs=${SW_AGENT_SAMPLE:5}

# 日志配置
logging.level=${SW_LOGGING_LEVEL:INFO}
logging.dir=${SW_LOGGING_DIR:}

# 忽略路径
trace.ignore_path=${SW_IGNORE_PATH:/actuator/**,/health}

# 插件配置
plugin.mount=${SW_MOUNT_PLUGINS:}
plugin.exclude=${SW_EXCLUDE_PLUGINS:}

# 状态检查
agent.cool_down_threshold=${SW_AGENT_COOL_DOWN:3000}
```
