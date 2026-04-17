# Java 基础面试核心考点（容器、锁等）

> **更新时间**: 2026-04-16

---

## 一、集合容器

### 1.1 集合体系总览

```
┌──────────────────────────────────────────────────────────────┐
│                    Java 集合体系                              │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Collection                                                   │
│  ├── List（有序可重复）                                       │
│  │   ├── ArrayList    数组实现，查询快，增删慢                │
│  │   ├── LinkedList   双向链表，增删快，查询慢                │
│  │   └── Vector       线程安全的 ArrayList（已过时）          │
│  │                                                           │
│  ├── Set（无序不可重复）                                      │
│  │   ├── HashSet      HashMap 实现，无序                     │
│  │   ├── LinkedHashSet 保留插入顺序                          │
│  │   └── TreeSet      红黑树，自然排序                       │
│  │                                                           │
│  └── Queue（队列）                                            │
│      ├── PriorityQueue  堆实现，优先级排序                   │
│      ├── ArrayDeque     数组实现双端队列                      │
│      └── LinkedList     同时实现 List 和 Deque               │
│                                                               │
│  Map（键值对）                                                │
│  ├── HashMap        数组+链表+红黑树，无序                   │
│  ├── LinkedHashMap  HashMap + 双向链表，保留插入/访问顺序     │
│  ├── TreeMap        红黑树，按 Key 排序                      │
│  ├── Hashtable      线程安全，全表锁（已过时）               │
│  └── ConcurrentHashMap  线程安全，分段锁/CAS+synchronized     │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 HashMap 核心考点

```
┌──────────────────────────────────────────────────────────┐
│                  HashMap 底层原理                          │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  数据结构：数组 + 链表 + 红黑树（JDK 8+）                 │
│                                                           │
│  ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┐      │
│  │  0  │  1  │  2  │  3  │  4  │  5  │  6  │  7  │      │
│  └──┬──┴─────┴──┬──┴─────┴──┬──┴─────┴─────┴─────┘      │
│     │          │          │                               │
│     ▼          ▼          ▼                               │
│   [Node]    [Node]─▶[Node]   链表（长度 < 8）             │
│                                                         │
│     ▼                                                    │
│   [TreeNode]─▶[TreeNode]─▶[TreeNode]  红黑树（长度 ≥ 8） │
│                                                         │
│  关键参数：                                               │
│  ├── 初始容量：16（默认）                                 │
│  ├── 负载因子：0.75（默认）                               │
│  ├── 扩容阈值：容量 × 负载因子 = 12                      │
│  ├── 树化阈值：链表长度 ≥ 8 且数组长度 ≥ 64 → 红黑树      │
│  └── 退化阈值：红黑树节点 ≤ 6 → 链表                     │
│                                                           │
│  hash 计算：                                              │
│  hash = (h = key.hashCode()) ^ (h >>> 16)                │
│  → 高16位与低16位异或，减少碰撞                           │
│                                                           │
│  定位桶：index = (n - 1) & hash                           │
│  → 等价于 hash % n（n 为 2 的幂次时）                     │
│                                                           │
│  JDK 7 头插法 → JDK 8 尾插法                              │
│  原因：头插法多线程扩容时链表成环 → 死循环                 │
│  注意：HashMap 仍然不是线程安全的！                        │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

**面试题：HashMap 为什么用红黑树不用 B+ 树 / AVL 树？**

| 树类型 | 说明 |
|--------|------|
| 红黑树 | 插入/删除最多 3 次旋转，查询 O(logN)，平衡维护成本低 |
| AVL 树 | 严格平衡，查询略快，但插入/删除旋转次数多 |
| B+ 树 | 适合磁盘IO场景（节点大减少IO），内存中红黑树更优 |

### 1.3 ArrayList vs LinkedList

| 特性 | ArrayList | LinkedList |
|------|-----------|------------|
| 底层 | Object[] 数组 | 双向链表 |
| 随机访问 | O(1) | O(N) |
| 头部插入 | O(N)（移动元素） | O(1) |
| 中间插入 | O(N) | O(N)（需遍历到位置） |
| 内存 | 紧凑，缓存友好 | 每个节点额外指针开销 |
| 默认容量 | 10 | — |
| 扩容 | 1.5 倍（Arrays.copyOf） | 不需要 |

**面试题：ArrayList 扩容机制？**
1. 默认初始容量 10
2. 添加元素时检查容量不足
3. 新容量 = oldCapacity + (oldCapacity >> 1) = 1.5 倍
4. Arrays.copyOf 复制到新数组

### 1.4 容器线程安全方案

| 方案 | 原理 | 适用 |
|------|------|------|
| ConcurrentHashMap | CAS + synchronized | 高并发 Map |
| CopyOnWriteArrayList | 写时复制数组 | 读多写少 |
| CopyOnWriteArraySet | 写时复制数组 | 读多写少 |
| Collections.synchronizedXxx | 全局锁包装 | 低并发 |
| Vector / Hashtable | 方法级 synchronized | 已过时 |

---

## 二、锁

### 2.1 锁分类全景

```
┌──────────────────────────────────────────────────────────────┐
│                       锁分类                                 │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  悲观锁 vs 乐观锁                                            │
│  ├── 悲观锁：先加锁再操作（synchronized, ReentrantLock）     │
│  └── 乐观锁：先操作再检查（CAS, 版本号）                     │
│                                                               │
│  公平锁 vs 非公平锁                                          │
│  ├── 公平锁：按等待顺序获取（new ReentrantLock(true)）       │
│  └── 非公平锁：允许插队（synchronized, 默认 ReentrantLock）  │
│                                                               │
│  独占锁 vs 共享锁                                            │
│  ├── 独占锁：同一时刻只能一个线程持有                        │
│  └── 共享锁：可被多个线程同时持有（ReadWriteLock 读锁）      │
│                                                               │
│  可重入锁 vs 不可重入锁                                      │
│  ├── 可重入锁：同一线程可重复获取（synchronized, Reentrant）  │
│  └── 不可重入锁：同一线程再次获取会死锁                      │
│                                                               │
│  自旋锁 vs 阻塞锁                                            │
│  ├── 自旋锁：CAS 循环等待（短等待高效）                     │
│  └── 阻塞锁：线程挂起等待（长等待省CPU）                    │
│                                                               │
│  偏向锁 → 轻量级锁 → 重量级锁（synchronized 锁升级）        │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 CAS

```java
// CAS = Compare And Swap（比较并交换）
// 原子操作：如果当前值 == 期望值，则更新为新值

// Unsafe 类 native 方法
boolean compareAndSwapInt(Object o, long offset, int expected, int new)

// AtomicInteger 实现
public final int incrementAndGet() {
    return unsafe.getAndAddInt(this, valueOffset, 1) + 1;
}

// getAndAddInt 内部自旋
public final int getAndAddInt(Object var1, long var2, int var4) {
    int var5;
    do {
        var5 = this.getIntVolatile(var1, var2);  // 读取当前值
    } while (!this.compareAndSwapInt(var1, var2, var5, var5 + var4));
    // CAS 失败则自旋重试
    return var5;
}
```

**CAS 的 ABA 问题**：

```
┌──────────────────────────────────────────────────────────┐
│                    ABA 问题                               │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  线程1: 读 A → [挂起] → CAS(A→C) 成功                    │
│  线程2: 读 A → 改B → 改A →  [线程1醒来]                  │
│                                                           │
│  线程1 CAS 成功，但中间值已经变化过                       │
│                                                           │
│  解决方案：                                               │
│  1. AtomicStampedReference（版本号/时间戳）               │
│     CAS 时同时比较值和版本号                               │
│                                                           │
│  2. AtomicMarkableReference（布尔标记）                   │
│     只关心是否被修改过                                     │
│                                                           │
│  实际场景中 ABA 的影响：                                   │
│  ├── 无锁栈/队列：ABA 会导致链表断裂                      │
│  └── 简单计数：ABA 通常无影响                              │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

### 2.3 ReadWriteLock

```java
ReentrantReadWriteLock rwLock = new ReentrantReadWriteLock();
ReentrantReadWriteLock.ReadLock readLock = rwLock.readLock();
ReentrantReadWriteLock.WriteLock writeLock = rwLock.writeLock();

// 读读不互斥，读写互斥，写写互斥
readLock.lock();
try {
    // 多线程可同时读
} finally {
    readLock.unlock();
}

writeLock.lock();
try {
    // 独占写
} finally {
    writeLock.unlock();
}

// 锁降级：写锁 → 读锁（允许）
writeLock.lock();
try {
    // 修改数据
    readLock.lock();  // 获取读锁
} finally {
    writeLock.unlock();  // 释放写锁，降级为读锁
}
try {
    // 读取数据（保证可见性）
} finally {
    readLock.unlock();
}

// 锁升级：读锁 → 写锁（不允许，会死锁）
```

### 2.4 StampedLock（JDK 8+）

```java
// StampedLock：乐观读，比 ReadWriteLock 性能更好
StampedLock lock = new StampedLock();

// 乐观读（不加锁，性能最好）
long stamp = lock.tryOptimisticRead();   // 获取戳
// ... 读取数据 ...
if (!lock.validate(stamp)) {             // 验证戳是否有效
    // 乐观读失败，升级为悲观读锁
    stamp = lock.readLock();
    try {
        // ... 重新读取数据 ...
    } finally {
        lock.unlockRead(stamp);
    }
}

// 悲观读锁
long stamp = lock.readLock();

// 写锁
long stamp = lock.writeLock();
```

---

## 三、Java 基础

### 3.1 == 和 equals

| 比较 | == | equals |
|------|-----|--------|
| 基本类型 | 比较值 | — |
| 引用类型 | 比较地址 | 默认比较地址，可重写比较内容 |

```java
String s1 = new String("hello");
String s2 = new String("hello");
String s3 = "hello";
String s4 = "hello";

s1 == s2       // false（不同对象，地址不同）
s1.equals(s2)  // true（String 重写了 equals，比较内容）
s3 == s4       // true（字符串常量池，同一引用）
s1 == s3       // false（堆 vs 常量池）
s1.intern() == s3  // true（intern 返回常量池引用）
```

### 3.2 String / StringBuilder / StringBuffer

| 特性 | String | StringBuilder | StringBuffer |
|------|--------|--------------|--------------|
| 可变性 | 不可变（final char[]） | 可变 | 可变 |
| 线程安全 | 是（不可变即安全） | 否 | 是（synchronized） |
| 性能 | 拼接慢（创建新对象） | 快 | 中 |
| 场景 | 少量操作 | 单线程拼接 | 多线程拼接 |

### 3.3 异常体系

```
┌────────────────────────────────────────────────────────┐
│                    异常体系                              │
├────────────────────────────────────────────────────────┤
│                                                         │
│  Throwable                                              │
│  ├── Error（不应被捕获）                                │
│  │   ├── OutOfMemoryError                              │
│  │   ├── StackOverflowError                            │
│  │   └── NoClassDefFoundError                          │
│  │                                                      │
│  └── Exception                                          │
│      ├── 受检异常（Checked，必须处理）                   │
│      │   ├── IOException                               │
│      │   ├── SQLException                              │
│      │   └── ClassNotFoundException                     │
│      │                                                  │
│      └── 非受检异常（Unchecked/RuntimeException）        │
│          ├── NullPointerException                       │
│          ├── ArrayIndexOutOfBoundsException             │
│          └── ClassCastException                         │
│                                                         │
│  面试点：                                                │
│  ├── 受检异常必须 try-catch 或 throws 声明              │
│  ├── 非受检异常可以不处理                                │
│  └── Spring @Transactional 默认只回滚 RuntimeException   │
│                                                         │
└────────────────────────────────────────────────────────┘
```

### 3.4 泛型

```
┌────────────────────────────────────────────────────────┐
│                  泛型核心考点                            │
├────────────────────────────────────────────────────────┤
│                                                         │
│  类型擦除：                                              │
│  ├── 编译后泛型信息被擦除，替换为上限类型（Object 或边界）│
│  ├── List<String> 和 List<Integer> 运行时都是 List      │
│  └── 不能 new T()、不能 instanceof T、不能 new T[]      │
│                                                         │
│  通配符：                                                │
│  ├── <?>        无界通配符                               │
│  ├── <? extends T>  上界通配符（只读，不能写入）         │
│  │   List<? extends Number> 可接受 List<Integer>        │
│  │   但不能 add(Integer)，只能 get(Number)               │
│  │                                                      │
│  └── <? super T>    下界通配符（只写，读取为 Object）     │
│      List<? super Integer> 可接受 List<Number>          │
│      可以 add(Integer)，但 get() 是 Object               │
│                                                         │
│  PECS 原则：Producer Extends, Consumer Super            │
│  ├── 频繁读取 → <? extends T>                           │
│  └── 频繁插入 → <? super T>                             │
│                                                         │
└────────────────────────────────────────────────────────┘
```

### 3.5 反射

```java
// 获取 Class 对象的三种方式
Class<?> clazz1 = User.class;
Class<?> clazz2 = new User().getClass();
Class<?> clazz3 = Class.forName("com.example.User");

// 反射创建实例
User user = (User) clazz.getDeclaredConstructor().newInstance();

// 反射调用方法
Method method = clazz.getDeclaredMethod("setName", String.class);
method.setAccessible(true);  // 突破 private 限制
method.invoke(user, "张三");

// 反射修改字段
Field field = clazz.getDeclaredField("name");
field.setAccessible(true);
field.set(user, "李四");

// 反射的应用场景：
// Spring IoC（Bean 动态创建）
// AOP（代理生成）
// 注解处理（@Autowired 注入）
// ORM（实体映射）
```

---

## 四、高频面试题

| 问题 | 核心答案 |
|------|----------|
| HashMap 的底层实现？ | 数组+链表+红黑树；hash定位桶，链表解决冲突，长度≥8树化 |
| HashMap 线程安全吗？ | 不安全；多线程用 ConcurrentHashMap |
| ConcurrentHashMap 怎么保证线程安全？ | JDK7 Segment分段锁；JDK8 CAS+synchronized |
| CAS 有什么问题？ | ABA问题（AtomicStampedReference解决）、自旋开销、只能单变量 |
| volatile 和 synchronized 的区别？ | volatile 保证可见性+禁止重排序；synchronized 保证原子性+可见性+有序性 |
| 公平锁和非公平锁的区别？ | 公平锁按等待顺序；非公平锁允许插队，吞吐更高 |
| String 为什么不可变？ | final类 + final char[]（JDK9 byte[]）+ 无修改方法；可hash缓存、字符串常量池、线程安全 |
