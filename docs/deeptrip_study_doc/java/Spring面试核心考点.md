# Spring 面试核心考点

> **更新时间**: 2026-04-16

---

## 一、IoC 容器

### 1.1 IoC 核心概念

```
传统方式                          IoC 方式
┌────────────┐                  ┌────────────┐
│ 对象自己创建 │                  │ 容器创建注入 │
│ 依赖         │                  │ 依赖         │
│              │                  │              │
│ A a = new A();│                │ @Autowired   │
│ B b = new B();│                │ 容器管理生命周期│
└────────────┘                  └────────────┘
   主动获取                          被动接收

IoC = Inversion of Control，控制反转
DI = Dependency Injection，依赖注入（IoC 的实现方式）
```

### 1.2 Bean 生命周期

```
┌───────────────────────────────────────────────────────────┐
│                    Bean 完整生命周期                         │
├───────────────────────────────────────────────────────────┤
│                                                            │
│  1. 实例化（Instantiation）                                 │
│     └─ 反射调用构造方法创建对象                               │
│                                                            │
│  2. 属性赋值（Populate）                                    │
│     └─ @Autowired / @Value 注入依赖                         │
│                                                            │
│  3. Aware 回调                                             │
│     ├── BeanNameAware.setBeanName()                        │
│     ├── BeanFactoryAware.setBeanFactory()                  │
│     └── ApplicationContextAware.setApplicationContext()    │
│                                                            │
│  4. 前置处理 BeanPostProcessor.postProcessBeforeInitializ..│
│                                                            │
│  5. 初始化（Initialization）                                │
│     ├── @PostConstruct                                     │
│     ├── InitializingBean.afterPropertiesSet()              │
│     └── @Bean(initMethod)                                  │
│                                                            │
│  6. 后置处理 BeanPostProcessor.postProcessAfterInitializ..│
│     └─ AOP 代理在此生成                                     │
│                                                            │
│  7. 使用中                                                  │
│                                                            │
│  8. 销毁（Destruction）                                     │
│     ├── @PreDestroy                                        │
│     ├── DisposableBean.destroy()                           │
│     └── @Bean(destroyMethod)                               │
│                                                            │
└───────────────────────────────────────────────────────────┘
```

**面试题：Bean 生命周期中哪些扩展点最重要？**

| 扩展点 | 作用 | 典型应用 |
|--------|------|----------|
| BeanPostProcessor | 对所有 Bean 做前后处理 | AOP 代理生成、@Autowired 注入 |
| BeanFactoryPostProcessor | 修改 BeanDefinition | PropertyPlaceholderConfigurer |
| Aware 接口 | 获取容器基础设施 | 获取 BeanName、ApplicationContext |
| InitializingBean | 初始化回调 | 资源加载、校验 |

### 1.3 循环依赖

```
┌─────────────────────────────────────────────────────────┐
│               三级缓存解决循环依赖                         │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  场景：A 依赖 B，B 依赖 A                                 │
│                                                          │
│  一级缓存 singletonObjects（完整Bean）                     │
│  二级缓存 earlySingletonObjects（早期引用，可能代理）       │
│  三级缓存 singletonFactories（ObjectFactory，延迟创建）    │
│                                                          │
│  流程：                                                   │
│  1. 创建 A，实例化后放入三级缓存（ObjectFactory）          │
│  2. A 属性注入 B，触发 B 创建                              │
│  3. 创建 B，实例化后放入三级缓存                            │
│  4. B 属性注入 A，从三级缓存获取 A 的 ObjectFactory       │
│  5. 调用 ObjectFactory.getObject() → 如需代理则提前创建    │
│  6. A 的早期引用放入二级缓存                                │
│  7. B 完成初始化，放入一级缓存                              │
│  8. A 继续初始化，放入一级缓存                              │
│                                                          │
│  为什么需要三级缓存？                                      │
│  → 保证 AOP 代理只创建一次，且在真正需要时才提前创建        │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**面试题：哪些情况循环依赖无法解决？**

| 情况 | 原因 |
|------|------|
| 构造器注入的循环依赖 | 实例化阶段就需依赖，还没进入三级缓存 |
| @Async 标注的 Bean 循环依赖 | @Async 代理在后期创建，与三级缓存提前代理冲突 |
| Prototype 作用域的循环依赖 | Prototype 不走缓存 |

### 1.4 作用域

| 作用域 | 说明 | 线程安全 |
|--------|------|----------|
| singleton | 默认，容器中只有一个实例 | 否（需自行保证） |
| prototype | 每次获取创建新实例 | 是（每次新对象） |
| request | HTTP 请求内有效 | 是 |
| session | HTTP Session 内有效 | 是 |
| application | ServletContext 内有效 | 否 |

---

## 二、AOP

### 2.1 核心概念

```
┌──────────────────────────────────────────────────────────┐
│                     AOP 核心术语                           │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  切面（Aspect）     ：横切关注点的模块化（如日志切面）       │
│  连接点（JoinPoint） ：可被增强的点（方法调用、异常抛出）    │
│  切入点（Pointcut）  ：匹配连接点的表达式                   │
│  通知（Advice）      ：在切入点执行的动作                   │
│  织入（Weaving）     ：将切面应用到目标对象的过程            │
│                                                           │
│  通知类型：                                               │
│  ├── @Before        前置通知                               │
│  ├── @After         后置通知（无论是否异常）                │
│  ├── @AfterReturning 返回通知                               │
│  ├── @AfterThrowing  异常通知                               │
│  └── @Around        环绕通知（最强大）                      │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

### 2.2 JDK 动态代理 vs CGLIB

| 特性 | JDK 动态代理 | CGLIB |
|------|-------------|-------|
| 原理 | 基于接口，InvocationHandler | 基于继承，MethodInterceptor |
| 要求 | 目标类必须实现接口 | 目标类不能是 final |
| 性能 | 生成快，调用稍慢 | 生成慢，调用快 |
| Spring 默认 | 有接口时用 JDK | 无接口时用 CGLIB |
| Spring Boot 默认 | — | 全部用 CGLIB（spring.aop.proxy-target-class=true） |

```java
// JDK 动态代理
public class JdkProxy implements InvocationHandler {
    private Object target;

    public Object createProxy(Object target) {
        this.target = target;
        return Proxy.newProxyInstance(
            target.getClass().getClassLoader(),
            target.getClass().getInterfaces(),
            this
        );
    }

    @Override
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        System.out.println("Before: " + method.getName());
        Object result = method.invoke(target, args);
        System.out.println("After: " + method.getName());
        return result;
    }
}

// CGLIB 代理
public class CglibProxy implements MethodInterceptor {
    public Object createProxy(Class<?> targetClass) {
        Enhancer enhancer = new Enhancer();
        enhancer.setSuperclass(targetClass);
        enhancer.setCallback(this);
        return enhancer.create();
    }

    @Override
    public Object intercept(Object obj, Method method, Object[] args, MethodProxy proxy) throws Throwable {
        System.out.println("Before: " + method.getName());
        Object result = proxy.invokeSuper(obj, args);
        System.out.println("After: " + method.getName());
        return result;
    }
}
```

### 2.3 AOP 失效场景

| 场景 | 原因 | 解决方案 |
|------|------|----------|
| 同类方法内部调用 | this 调用不走代理 | AopContext.currentProxy() / 注入自身 |
| 方法是 private | CGLIB 无法代理私有方法 | 改为 public/protected |
| 方法是 final | CGLIB 无法重写 final 方法 | 去掉 final |
| 方法是 static | 静态方法属于类不属于实例 | 改为实例方法 |
| 目标类未纳入 Spring 容器 | 不是 Spring Bean 则不代理 | 加 @Component |
| 异常被 catch 吞掉 | @AfterThrowing 捕获不到 | 重新抛出或手动处理 |

---

## 三、事务管理

### 3.1 @Transactional 核心属性

```java
@Transactional(
    propagation = Propagation.REQUIRED,     // 传播行为
    isolation = Isolation.DEFAULT,           // 隔离级别
    timeout = 30,                            // 超时时间（秒）
    readOnly = false,                        // 是否只读
    rollbackFor = Exception.class,           // 回滚条件
    noRollbackFor = BusinessException.class  // 不回滚条件
)
```

### 3.2 事务传播行为

```
┌──────────────────────────────────────────────────────────────┐
│                     事务传播行为                               │
├──────────────────┬───────────────────────────────────────────┤
│ REQUIRED         │ 有事务加入，无事务新建（默认）              │
│                  │                                           │
│ 外层 ──tx1──▶ 内层(加入tx1)                     │
│ 外层 ──无───▶ 内层(新建tx1)                     │
├──────────────────┼───────────────────────────────────────────┤
│ REQUIRES_NEW     │ 无论有无事务，都新建独立事务                │
│                  │                                           │
│ 外层 ──tx1──▶ 内层(suspend tx1, 新建tx2)      │
│                  │ 内层tx2提交/回滚不影响外层tx1               │
├──────────────────┼───────────────────────────────────────────┤
│ NESTED           │ 有事务则嵌套（savepoint），无事务同REQUIRED  │
│                  │                                           │
│ 外层 ──tx1──▶ 内层(savepoint, 回滚到savepoint)│
│                  │ 内层回滚不影响外层，外层回滚会影响内层        │
├──────────────────┼───────────────────────────────────────────┤
│ SUPPORTS         │ 有事务加入，无事务非事务执行                │
├──────────────────┼───────────────────────────────────────────┤
│ NOT_SUPPORTED    │ 非事务执行，挂起当前事务                    │
├──────────────────┼───────────────────────────────────────────┤
│ MANDATORY        │ 必须在事务中，否则抛异常                    │
├──────────────────┼───────────────────────────────────────────┤
│ NEVER            │ 必须非事务，否则抛异常                      │
├──────────────────┼───────────────────────────────────────────┤
│ NEVER            │ 必须非事务，否则抛异常                      │
└──────────────────┴───────────────────────────────────────────┘
```

### 3.3 事务失效场景

```
┌──────────────────────────────────────────────────────────────┐
│                    @Transactional 失效场景                     │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  1. 同类内部调用                                              │
│     methodA() 调用 this.methodB()                             │
│     → this 是原始对象不是代理对象，事务不生效                  │
│     → 解决：注入自身 / AopContext.currentProxy()              │
│                                                               │
│  2. 方法非 public                                            │
│     Spring AOP 只能代理 public 方法                            │
│     → private/protected/package 方法事务不生效                │
│                                                               │
│  3. 异常被吞掉                                               │
│     try-catch 吞掉异常，Spring 感知不到回滚                   │
│     → catch 后手动 TransactionAspectSupport.currentTransaction│
│        Status().setRollbackOnly()                            │
│                                                               │
│  4. rollbackFor 配置不对                                     │
│     默认只回滚 RuntimeException 和 Error                     │
│     → 检查异常(checked)不回滚，需显式配置 rollbackFor         │
│                                                               │
│  5. 数据库引擎不支持                                         │
│     MyISAM 不支持事务 → 用 InnoDB                             │
│                                                               │
│  6. 异常类型不匹配                                           │
│     抛出 checked Exception 但 rollbackFor 只配了 RuntimeException│
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 3.4 隔离级别

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | 说明 |
|----------|------|-----------|------|------|
| READ_UNCOMMITTED | ✓ | ✓ | ✓ | 最低，几乎不用 |
| READ_COMMITTED | ✗ | ✓ | ✓ | Oracle 默认 |
| REPEATABLE_READ | ✗ | ✗ | ✓ | MySQL 默认，MVCC + 间隙锁防幻读 |
| SERIALIZABLE | ✗ | ✗ | ✗ | 最高，性能差 |

---

## 四、Spring MVC

### 4.1 请求处理流程

```
Client Request
      │
      ▼
┌───────────┐
│ Dispatcher │  前端控制器
│ Servlet    │
└─────┬─────┘
      │
      ▼
┌───────────┐
│ Handler    │  查找 Handler
│ Mapping    │  (RequestMappingHandlerMapping)
└─────┬─────┘
      │
      ▼
┌───────────┐
│ Handler    │  执行拦截器前置
│ Adapter    │  执行 Handler（Controller 方法）
│            │  执行拦截器后置
└─────┬─────┘
      │
      ▼
┌───────────┐
│ View       │  视图解析（前后端分离可跳过）
│ Resolver   │
└───────────┘
      │
      ▼
  Response
```

### 4.2 拦截器 vs 过滤器

| 特性 | Filter | HandlerInterceptor |
|------|--------|-------------------|
| 规范 | Servlet 规范 | Spring 框架 |
| 作用范围 | 所有请求（含静态资源） | 只拦截 Handler |
| 执行时机 | DispatcherServlet 之前 | Handler 执行前后 |
| 获取 Bean | 需要特殊处理 | 可直接注入 |
| 典型场景 | 编码、跨域、压缩 | 鉴权、日志、限流 |

---

## 五、高频面试题

| 问题 | 核心答案 |
|------|----------|
| Spring Bean 是线程安全的吗？ | Singleton 不是线程安全的，多线程共享需自行同步或用 Prototype |
| @Component 和 @Bean 的区别？ | @Component 标注类自动扫描，@Bean 标注方法手动注册 |
| @Autowired 和 @Resource 的区别？ | @Autowired 按类型注入（Spring），@Resource 按名称注入（JSR-250） |
| Spring 的事务注解有哪些限制？ | 同类调用/非public/异常被吞/rollbackFor不对/非InnoDB |
| FactoryBean 和 BeanFactory 的区别？ | BeanFactory 是容器；FactoryBean 是创建复杂 Bean 的工厂 |
| ApplicationContext 和 BeanFactory 的区别？ | ApplicationContext 继承 BeanFactory，增加事件、国际化、AOP 等功能 |
| Spring 如何处理跨域？ | @CrossOrigin / WebMvcConfigurer.addCorsMappings / CorsFilter |
