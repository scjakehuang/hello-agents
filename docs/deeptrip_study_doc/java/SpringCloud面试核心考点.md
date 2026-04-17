# Spring Cloud 面试核心考点

> **更新时间**: 2026-04-16

---

## 一、微服务架构全景

```
┌──────────────────────────────────────────────────────────────┐
│                    Spring Cloud 生态全景                       │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐                    │
│  │ Gateway │   │  Auth   │   │  Admin  │                    │
│  │  网关    │   │  认证   │   │  管理   │                    │
│  └────┬────┘   └────┬────┘   └────┬────┘                    │
│       │             │             │                           │
│  ┌────┴─────────────┴─────────────┴────┐                    │
│  │          服务注册与发现 (Nacos)       │                    │
│  └────┬─────────────┬─────────────┬────┘                    │
│       │             │             │                           │
│  ┌────┴────┐  ┌────┴────┐  ┌────┴────┐                     │
│  │ Order   │  │ Payment │  │  User   │                     │
│  │ Service │  │ Service │  │ Service │                     │
│  └────┬────┘  └────┬────┘  └────┬────┘                     │
│       │             │             │                           │
│  ┌────┴─────────────┴─────────────┴────┐                    │
│  │        配置中心 (Nacos Config)       │                    │
│  └─────────────────────────────────────┘                    │
│                                                               │
│  横切关注点：                                                  │
│  ├── 服务调用：OpenFeign / RestTemplate + LoadBalancer        │
│  ├── 熔断降级：Sentinel / Resilience4j                       │
│  ├── 链路追踪：Sleuth + Zipkin / SkyWalking                  │
│  └── 消息总线：Spring Cloud Bus + RocketMQ                   │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 版本对应关系

| Spring Cloud | Spring Boot | 说明 |
|--------------|-------------|------|
| 2021.0.x (Jubilee) | 3.0.x | — |
| 2022.0.x (Kilburn) | 3.1.x | — |
| 2023.0.x (Leyton) | 3.2.x | 当前主流 |
| Spring Cloud Alibaba | 同上 | Nacos/Sentinel/Seata |

---

## 二、服务注册与发现

### 2.1 Nacos

```
┌──────────────────────────────────────────────────────────┐
│                   Nacos 核心概念                           │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  Namespace（命名空间）→ 环境隔离（dev/test/prod）          │
│  Group（分组）        → 业务隔离                           │
│  Service（服务）      → 一个应用                           │
│  Cluster（集群）      → 同服务不同实例分组                  │
│  Instance（实例）     → 一个进程                           │
│                                                           │
│  注册方式：                                               │
│  ├── 临时实例：客户端心跳保活，不健康自动剔除（默认）      │
│  └── 持久实例：服务端主动探测，永不剔除                    │
│                                                           │
│  AP vs CP：                                               │
│  ├── 临时实例 → AP 模式（Distro 协议）                    │
│  └── 持久实例 → CP 模式（Raft 协议）                      │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

**面试题：Nacos 和 Eureka 的区别？**

| 特性 | Nacos | Eureka |
|------|-------|--------|
| 一致性模型 | AP + CP 可切换 | 仅 AP |
| 配置中心 | 内置 | 无（需 Config） |
| 健康检查 | 客户端心跳 + 服务端探测 | 客户端心跳 |
| 实例类型 | 临时 + 持久 | 仅临时 |
| 自我保护 | 有（但更智能） | 有（进入后不剔除） |
| 雪崩保护 | 支持 | 不支持 |
| 社区活跃度 | 高（阿里维护） | 已停更（2.x） |

### 2.2 服务发现原理

```yaml
# 服务注册配置
spring:
  cloud:
    nacos:
      discovery:
        server-addr: localhost:8848
        namespace: dev
        group: DEFAULT_GROUP
        cluster-name: BJ       # 同机房优先
        weight: 1              # 权重
```

---

## 三、配置中心

### 3.1 Nacos Config

```yaml
# bootstrap.yml（Spring Cloud 2020+ 需引入 spring-cloud-starter-bootstrap）
spring:
  cloud:
    nacos:
      config:
        server-addr: localhost:8848
        namespace: dev
        group: DEFAULT_GROUP
        file-extension: yaml
        # dataId = ${prefix}-${profile}.${file-extension}
        # dataId = order-service-dev.yaml

        # 共享配置
        shared-configs:
          - data-id: common-db.yaml
            refresh: true
          - data-id: common-redis.yaml
            refresh: true

        # 扩展配置
        extension-configs:
          - data-id: custom.yaml
            refresh: true
```

**配置加载优先级**（高→低）：

```
1. order-service-dev.yaml     （带 profile）
2. order-service.yaml         （不带 profile）
3. extension-configs          （扩展配置，按数组顺序）
4. shared-configs             （共享配置，按数组顺序）
```

**动态刷新**：

```java
// @RefreshScope 方式
@RestController
@RefreshScope
public class OrderController {

    @Value("${order.timeout:30}")
    private Integer timeout;

    // Nacos 配置变更后自动刷新
}

// @ConfigurationProperties 方式（自动刷新，无需 @RefreshScope）
@ConfigurationProperties(prefix = "order")
@Component
public class OrderProperties {
    private Integer timeout;
}
```

---

## 四、服务调用

### 4.1 OpenFeign

```java
// 声明式调用
@FeignClient(
    name = "user-service",
    path = "/api/users",
    fallbackFactory = UserClientFallbackFactory.class
)
public interface UserClient {

    @GetMapping("/{id}")
    User getUser(@PathVariable Long id);

    @PostMapping
    User createUser(@RequestBody UserRequest request);
}

// Fallback 工厂（可获取异常信息）
@Component
public class UserClientFallbackFactory implements FallbackFactory<UserClient> {
    @Override
    public UserClient create(Throwable cause) {
        return new UserClient() {
            @Override
            public User getUser(Long id) {
                log.error("获取用户失败, id={}, cause={}", id, cause.getMessage());
                return new User().setId(id).setNickname("默认用户");
            }
            // ...
        };
    }
}
```

**Feign 调用流程**：

```
┌────────────────────────────────────────────────────────┐
│                 OpenFeign 调用链                        │
├────────────────────────────────────────────────────────┤
│                                                         │
│  Controller                                             │
│      │                                                  │
│      ▼                                                  │
│  UserClient.getUser()  ← 动态代理（JDK）                │
│      │                                                  │
│      ▼                                                  │
│  ReflectiveFeign.FeignInvocationHandler                 │
│      │                                                  │
│      ▼                                                  │
│  SynchronousMethodHandler                               │
│      ├── RequestTemplate 构建（编码、模板）              │
│      ├── LoadBalancer 选择实例                           │
│      │      └── Spring Cloud LoadBalancer               │
│      ├── 拦截器链 RequestInterceptor                     │
│      │      └── 传播认证头、TraceId 等                   │
│      ├── Client.execute() 发送 HTTP 请求                │
│      └── 解码响应 / 触发 Fallback                        │
│                                                         │
└────────────────────────────────────────────────────────┘
```

**Feign 配置优化**：

```yaml
# Feign 配置
feign:
  client:
    config:
      default:
        connectTimeout: 5000
        readTimeout: 10000
  httpclient:
    enabled: false           # 关闭默认 URLConnection
  okhttp:
    enabled: true            # 启用 OkHttp（连接池）
    max-connections: 200
    max-connections-per-route: 50

# 开启 Sentinel 整合
feign:
  sentinel:
    enabled: true
```

---

## 五、网关

### 5.1 Spring Cloud Gateway

```
┌──────────────────────────────────────────────────────────┐
│                Gateway 核心概念                           │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  Route（路由）     ：ID + URI + Predicate + Filter        │
│  Predicate（断言） ：匹配条件（Path/Header/Method等）      │
│  Filter（过滤器）  ：请求/响应处理                         │
│                                                           │
│  请求处理流程：                                           │
│                                                           │
│  Client Request                                           │
│       │                                                   │
│       ▼                                                   │
│  ┌─────────────┐                                          │
│  │ Route 匹配   │  Predicate 链匹配                       │
│  └──────┬──────┘                                          │
│         │                                                 │
│         ▼                                                 │
│  ┌─────────────┐                                          │
│  │ Filter 链    │                                          │
│  │  Pre 阶段    │  鉴权、限流、日志                        │
│  └──────┬──────┘                                          │
│         │                                                 │
│         ▼                                                 │
│  ┌─────────────┐                                          │
│  │ 代理转发     │  HttpClient 转发到下游服务               │
│  └──────┬──────┘                                          │
│         │                                                 │
│         ▼                                                 │
│  ┌─────────────┐                                          │
│  │ Filter 链    │                                          │
│  │  Post 阶段   │  响应修改、统计耗时                      │
│  └──────┬──────┘                                          │
│         │                                                 │
│         ▼                                                 │
│  Client Response                                          │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: order-service
          uri: lb://order-service          # lb:// 负载均衡
          predicates:
            - Path=/api/order/**
            - Method=GET,POST
            - Header=X-Token, \w+
          filters:
            - StripPrefix=1                # 去掉路径前缀
            - AddRequestHeader=X-Source, gateway
            - name: RequestRateLimiter     # 限流
              args:
                redis-rate-limiter.replenishRate: 100
                redis-rate-limiter.burstCapacity: 200
                key-resolver: "#{@ipKeyResolver}"
```

---

## 六、熔断降级

### 6.1 Sentinel

```
┌──────────────────────────────────────────────────────────┐
│                Sentinel 核心概念                           │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  资源（Resource）  ：需要保护的方法/代码块                  │
│  规则（Rule）      ：限流/熔断/系统保护规则                 │
│                                                           │
│  限流模式：                                               │
│  ├── 直接限流：对资源本身限流                              │
│  ├── 关联限流：关联资源达阈值时限流自己                    │
│  └── 链路限流：只限指定入口的流量                          │
│                                                           │
│  流控效果：                                               │
│  ├── 快速失败：直接拒绝（默认）                            │
│  ├── Warm Up：预热，从阈值/3 逐渐升到阈值                  │
│  └── 排队等待：匀速通过（漏桶算法）                        │
│                                                           │
│  熔断策略：                                               │
│  ├── 慢调用比例：响应时间 > RT 的请求比例达阈值            │
│  ├── 异常比例：异常数 / 总请求数达阈值                     │
│  └── 异常数：异常数达阈值                                  │
│                                                           │
│  熔断状态机：                                             │
│  ┌──────────┐  超出阈值   ┌──────────┐                   │
│  │  CLOSED  │───────────▶│   OPEN   │                   │
│  │  (正常)   │◀───────────│  (熔断)   │                   │
│  └──────────┘  探测成功   └─────┬────┘                   │
│       ▲                     │                            │
│       │                     │ 超时后                     │
│       │                     ▼                            │
│       │               ┌──────────┐                       │
│       └───────────────│HALF-OPEN │                       │
│        探测成功        │ (半开)    │                       │
│                        └──────────┘                       │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

**代码使用**：

```java
// 方式一：@SentinelResource 注解
@Service
public class OrderService {

    @SentinelResource(
        value = "createOrder",
        blockHandler = "createOrderBlock",
        fallback = "createOrderFallback"
    )
    public Order createOrder(OrderRequest request) {
        // 业务逻辑
    }

    // 限流/熔断处理
    public Order createOrderBlock(OrderRequest request, BlockException e) {
        throw new ServiceException("系统繁忙，请稍后重试");
    }

    // 业务异常降级
    public Order createOrderFallback(OrderRequest request, Throwable t) {
        log.error("创建订单降级", t);
        return null;
    }
}

// 方式二：代码式
Entry entry = null;
try {
    entry = SphU.entry("createOrder");
    // 业务逻辑
} catch (BlockException e) {
    // 限流/熔断
} finally {
    if (entry != null) {
        entry.exit();
    }
}
```

---

## 七、高频面试题

| 问题 | 核心答案 |
|------|----------|
| Spring Cloud 和 Dubbo 的区别？ | Spring Cloud 是完整微服务方案(HTTP+REST)；Dubbo 是 RPC 框架(TCP+二进制)，生态需自建 |
| Nacos 的 AP 和 CP 怎么切换？ | 临时实例 AP（Distro），持久实例 CP（Raft），通过实例类型自动选择 |
| Gateway 和 Zuul 的区别？ | Gateway 基于 WebFlux 非阻塞，Zuul1.x 基于Servlet阻塞；Zuul2.x 非阻塞但未集成Spring Cloud |
| Feign 底层怎么实现的？ | JDK 动态代理 + RequestTemplate + LoadBalancer + Client（URLConnection/OkHttp） |
| Sentinel 和 Hystrix 的区别？ | Sentinel 支持更丰富的流控策略+热点限流+系统自适应，Hystrix 已停更；Sentinel 控制台更完善 |
| 微服务之间如何保证数据一致性？ | 强一致：TCC/Seata AT；最终一致：MQ事务消息/本地消息表/Saga |
| 分布式 ID 怎么生成？ | 雪花算法（Snowflake）：时间戳+机器ID+序列号，保证趋势递增且唯一 |
