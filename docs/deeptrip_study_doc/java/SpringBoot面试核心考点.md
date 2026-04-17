# Spring Boot 面试核心考点

> **更新时间**: 2026-04-16

---

## 一、自动配置原理

### 1.1 @SpringBootApplication 注解拆解

```
@SpringBootApplication
    ├── @SpringBootConfiguration    → 本质是 @Configuration
    ├── @EnableAutoConfiguration    → 开启自动配置（核心）
    └── @ComponentScan              → 组件扫描（扫描启动类同包及子包）
```

### 1.2 自动配置流程

```
┌──────────────────────────────────────────────────────────────┐
│                  Spring Boot 自动配置流程                      │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  1. @EnableAutoConfiguration                                  │
│     └─▶ @Import(AutoConfigurationImportSelector.class)        │
│                                                               │
│  2. AutoConfigurationImportSelector                           │
│     └─▶ SpringFactoriesLoader.loadFactoryNames()              │
│         读取 META-INF/spring.factories 中                     │
│         EnableAutoConfiguration 对应的全限类名列表              │
│                                                               │
│  3. Spring Boot 2.7+ / 3.x                                   │
│     └─▶ 优先读取 META-INF/spring/org.springframework.boot     │
│         .autoconfigure.AutoConfiguration.imports               │
│                                                               │
│  4. 加载候选自动配置类                                        │
│     └─▶ 根据 @Conditional 系列注解过滤                        │
│         ├── @ConditionalOnClass        类路径是否存在          │
│         ├── @ConditionalOnBean         容器中是否有指定 Bean    │
│         ├── @ConditionalOnMissingBean  容器中是否没有指定 Bean  │
│         ├── @ConditionalOnProperty     配置属性是否满足        │
│         └── @ConditionalOnWebApplication 是否 Web 应用        │
│                                                               │
│  5. 满足条件的自动配置类生效，向容器注册 Bean                  │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

**以 Redis 自动配置为例**：

```java
@AutoConfiguration
@ConditionalOnClass(RedisOperations.class)
@EnableConfigurationProperties(RedisProperties.class)
public class RedisAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean(name = "redisTemplate")
    public RedisTemplate<Object, Object> redisTemplate(
            RedisConnectionFactory redisConnectionFactory) {
        RedisTemplate<Object, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(redisConnectionFactory);
        return template;
    }
}

// 条件：
// 1. classpath 有 spring-data-redis → @ConditionalOnClass
// 2. 用户没有自定义 redisTemplate → @ConditionalOnMissingBean
// 3. spring.redis.* 配置属性 → @EnableConfigurationProperties
```

### 1.3 starter 开发

```
自定义 starter 命名规范：
  官方：spring-boot-starter-xxx
  第三方：xxx-spring-boot-starter

starter 结构：
my-spring-boot-starter/
├── my-spring-boot-starter/              │
│   └── src/main/resources/
│       └── META-INF/
│           └── spring/
│               └── org.springframework.boot
│                   .autoconfigure.AutoConfiguration.imports
│                       # 写入自动配置类的全限名
│                       com.example.MyAutoConfiguration
│
└── my-spring-boot-starter-autoconfigure/
    └── src/main/java/
        └── com/example/
            ├── MyAutoConfiguration.java
            ├── MyProperties.java
            └── MyService.java
```

---

## 二、配置管理

### 2.1 配置文件加载优先级

```
优先级从高到低：

1. 命令行参数          --server.port=8081
2. JNDI 属性
3. Java 系统属性       -Dserver.port=8081
4. OS 环境变量         SERVER_PORT=8081
5. 外部配置文件
   ├── config/application.yml  （jar 包同级 config 目录）
   ├── application.yml         （jar 包同级目录）
   ├── classpath:config/application.yml
   └── classpath:application.yml
6. @PropertySource 引入的配置
7. 默认属性

高优先级覆盖低优先级，相同属性取高优先级的值
```

### 2.2 Profile 机制

```yaml
# application.yml
spring:
  profiles:
    active: dev  # 激活 dev 环境

---
# application-dev.yml
server:
  port: 8080
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/dev_db

---
# application-prod.yml
server:
  port: 80
spring:
  datasource:
    url: jdbc:mysql://prod-mysql:3306/prod_db
```

### 2.3 配置属性绑定

```java
// 方式一：@ConfigurationProperties（推荐）
@ConfigurationProperties(prefix = "app.order")
@Component
public class OrderProperties {
    private Integer timeout = 30;      // app.order.timeout
    private Integer maxRetry = 3;      // app.order.max-retry
    private List<String> channels;     // app.order.channels[0]
    // getter/setter
}

// 方式二：@Value
@Value("${app.order.timeout:30}")
private Integer timeout;

// 区别：
// @ConfigurationProperties：支持松散绑定、JSR303校验、复杂类型
// @Value：不支持松散绑定，适合单个值注入，支持 SpEL
```

---

## 三、内嵌容器

### 3.1 三大容器对比

| 特性 | Tomcat | Undertow | Jetty |
|------|--------|----------|-------|
| 默认 | Spring Boot 默认 | — | — |
| 性能 | 中 | 高（IO密集） | 中 |
| 内存 | 中 | 低 | 中 |
| WebSocket | 支持 | 支持 | 支持 |
| 适用 | 通用场景 | 高并发IO | 长连接/异步 |

```xml
<!-- 切换为 Undertow -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
    <exclusions>
        <exclusion>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-tomcat</artifactId>
        </exclusion>
    </exclusions>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-undertow</artifactId>
</dependency>
```

### 3.2 容器调优

```yaml
server:
  tomcat:
    threads:
      max: 500           # 最大工作线程数
      min-spare: 20      # 最小空闲线程数
    max-connections: 10000  # 最大连接数
    accept-count: 200       # 等待队列长度
    max-swallow-size: -1    # 请求体最大大小
  undertow:
    threads:
      io: 8               # IO 线程数（默认CPU核数）
      worker: 200         # 工作线程数
    buffer-size: 1024     # 缓冲区大小
```

---

## 四、Actuator 监控

### 4.1 常用端点

| 端点 | 说明 | 默认开启 |
|------|------|----------|
| /actuator/health | 健康检查 | ✓ |
| /actuator/info | 应用信息 | ✗ |
| /actuator/metrics | 指标信息 | ✓ |
| /actuator/env | 环境变量 | ✗ |
| /actuator/beans | Bean 列表 | ✗ |
| /actuator/mappings | 请求映射 | ✗ |
| /actuator/loggers | 日志级别 | ✗ |
| /actuator/threaddump | 线程堆栈 | ✗ |

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  endpoint:
    health:
      show-details: always
  metrics:
    export:
      prometheus:
        enabled: true
```

### 4.2 自定义健康检查

```java
@Component
public class RedisHealthIndicator extends AbstractHealthIndicator {

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    @Override
    protected void doHealthCheck(Health.Builder builder) throws Exception {
        try {
            redisTemplate.ping();
            builder.up().withDetail("redis", "连接正常");
        } catch (Exception e) {
            builder.down().withDetail("redis", "连接失败: " + e.getMessage());
        }
    }
}
```

---

## 五、启动流程

```
┌──────────────────────────────────────────────────────────────┐
│                  Spring Boot 启动流程                         │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  new SpringApplication()                                      │
│  ├── 推断应用类型（SERVLET/REACTIVE/NONE）                    │
│  ├── 加载 ApplicationContextInitializer                       │
│  └── 加载 ApplicationListener                                │
│                                                               │
│  SpringApplication.run()                                      │
│  ├── 1. 创建并启动 StopWatch                                 │
│  ├── 2. 获取 SpringApplicationRunListeners                   │
│  │      └─▶ starting() 回调                                   │
│  ├── 3. 准备环境 ConfigurableEnvironment                      │
│  │      └─▶ environmentPrepared() 回调                        │
│  ├── 4. 创建 ApplicationContext                               │
│  ├── 5. 准备上下文                                           │
│  │      ├── 加载 BeanDefinition                               │
│  │      └─▶ contextPrepared() / contextLoaded() 回调          │
│  ├── 6. 刷新上下文（核心）                                    │
│  │      └─▶ AbstractApplicationContext.refresh()              │
│  │          ├── BeanDefinition 注册                           │
│  │          ├── BeanPostProcessor 注册                        │
│  │          ├── 自动配置类解析                                 │
│  │          └── 单例 Bean 实例化                               │
│  ├── 7. 执行 afterRefresh()                                   │
│  ├── 8. CallRunners                                           │
│  │      ├── ApplicationRunner                                 │
│  │      └── CommandLineRunner                                 │
│  └── 9. started() 回调 → 返回 ApplicationContext              │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 六、条件注解总结

| 注解 | 条件 |
|------|------|
| @ConditionalOnClass | classpath 中存在指定类 |
| @ConditionalOnMissingClass | classpath 中不存在指定类 |
| @ConditionalOnBean | 容器中存在指定 Bean |
| @ConditionalOnMissingBean | 容器中不存在指定 Bean |
| @ConditionalOnProperty | 配置属性满足指定值 |
| @ConditionalOnWebApplication | 当前是 Web 应用 |
| @ConditionalOnNotWebApplication | 当前不是 Web 应用 |
| @ConditionalOnExpression | SpEL 表达式为 true |
| @ConditionalOnJava | Java 版本匹配 |
| @ConditionalOnResource | classpath 中存在指定资源 |

---

## 七、高频面试题

| 问题 | 核心答案 |
|------|----------|
| Spring Boot 自动配置原理？ | @EnableAutoConfiguration → spring.factories → @Conditional 过滤 → 满足条件则注册 Bean |
| starter 的原理？ | 引入依赖 + 自动配置类 + @Conditional 条件判断 + spring.factories 注册 |
| 配置文件加载顺序？ | 命令行 > 系统属性 > 环境变量 > 外部config/ > 外部根目录 > classpath:config/ > classpath:/ |
| @ConfigurationProperties 和 @Value 的区别？ | 前者支持松散绑定/校验/复杂类型，后者支持 SpEL 适合单值 |
| Spring Boot 如何切换容器？ | 排除默认 tomcat 依赖，引入 undertow/jetty starter |
| Actuator 是什么？ | 生产级监控端点，健康检查、指标、线程堆栈、配置查看等 |
| Spring Boot 打包方式？ | spring-boot-maven-plugin 打成可执行 fat jar，内嵌容器 |
