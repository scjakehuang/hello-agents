# Netty / 网络编程面试核心考点

> **更新时间**: 2026-04-16

---

## 一、网络基础

### 1.1 IO 模型

```
┌──────────────────────────────────────────────────────────────┐
│                    五种 IO 模型                               │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  1. 阻塞 IO（BIO）                                           │
│     ┌─────┐                                                   │
│     │ App │──recv──▶ [内核等待数据] ──▶ [拷贝数据] ──▶ 返回  │
│     └─────┘     阻塞         阻塞                              │
│     一个连接一个线程，线程大部分时间在等待                     │
│                                                               │
│  2. 非阻塞 IO（NIO）                                         │
│     ┌─────┐                                                   │
│     │ App │──recv──▶ EAGAIN ──recv──▶ EAGAIN ──recv──▶ 数据  │
│     └─────┘     不阻塞但需轮询       不阻塞轮询               │
│     轮询消耗 CPU                                              │
│                                                               │
│  3. IO 多路复用（select/poll/epoll）                          │
│     ┌─────┐                                                   │
│     │ App │──epoll_wait──▶ [有数据了] ──▶ recv ──▶ 数据      │
│     └─────┘     阻塞在epoll上     就绪后非阻塞               │
│     一个线程管理多个连接                                      │
│                                                               │
│  4. 信号驱动 IO（SIGIO）                                     │
│     内核数据就绪后发信号通知                                  │
│                                                               │
│  5. 异步 IO（AIO）                                           │
│     ┌─────┐                                                   │
│     │ App │──aio_read──▶ [不阻塞，内核完成后通知] ──▶ 处理   │
│     └─────┘     立即返回         内核拷贝完成                 │
│     真正的异步，Linux 支持不完善                              │
│                                                               │
│  面试重点：IO 多路复用（epoll）                               │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 select / poll / epoll

| 特性 | select | poll | epoll |
|------|--------|------|-------|
| 最大连接数 | 1024（FD_SETSIZE） | 无限制 | 无限制 |
| 数据结构 | bitmap | 链表 | 红黑树 + 就绪链表 |
| 内核态→用户态 | 每次全量拷贝 | 每次全量拷贝 | 只拷贝就绪的 FD |
| 时间复杂度 | O(n) 遍历 | O(n) 遍历 | O(1) 事件通知 |
| 触发方式 | 水平触发 | 水平触发 | 水平触发(LT) + 边缘触发(ET) |

```
┌──────────────────────────────────────────────────────────┐
│                  epoll 工作模式                            │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  LT（Level Triggered，水平触发，默认）：                   │
│  ├── 缓冲区有数据就一直通知                               │
│  └── 编程简单，但可能频繁唤醒                             │
│                                                           │
│  ET（Edge Triggered，边缘触发）：                          │
│  ├── 缓冲区从空到有数据时通知一次                         │
│  ├── 必须一次性读完所有数据（循环 read 直到 EAGAIN）       │
│  └── 效率更高，但编程复杂                                 │
│                                                           │
│  Netty 使用的是 epoll LT 模式                             │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

---

## 二、Netty 架构

### 2.1 Reactor 模型

```
┌──────────────────────────────────────────────────────────────┐
│                    三种 Reactor 模型                          │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  单 Reactor 单线程：                                          │
│  ┌───────────────────────────────────┐                       │
│  │ Reactor (accept + read + write)   │  ← 一个线程全干      │
│  └───────────────────────────────────┘                       │
│  缺点：一个线程处理所有事件，性能瓶颈                        │
│                                                               │
│  单 Reactor 多线程：                                          │
│  ┌────────────────┐                                           │
│  │ Reactor (accept)│  ← 一个线程负责连接                      │
│  └───────┬────────┘                                           │
│          │ dispatch                                           │
│  ┌───────┴────────────────────────┐                          │
│  │ Thread Pool (read + process + write)│ ← 多线程处理       │
│  └────────────────────────────────┘                          │
│  缺点：Reactor 单点                                          │
│                                                               │
│  主从 Reactor 多线程（Netty 采用）：                          │
│  ┌──────────────────────────────────────────────────┐        │
│  │                                                    │        │
│  │  Boss Group（主 Reactor）                          │        │
│  │  ┌──────────┐                                     │        │
│  │  │ BossLoop │ accept 新连接                        │        │
│  │  └────┬─────┘                                     │        │
│  │       │ 注册到 Worker                              │        │
│  │       ▼                                            │        │
│  │  Worker Group（从 Reactor）                        │        │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐        │        │
│  │  │WorkerLoop│  │WorkerLoop│  │WorkerLoop│        │        │
│  │  │read/write│  │read/write│  │read/write│        │        │
│  │  └──────────┘  └──────────┘  └──────────┘        │        │
│  │                                                    │        │
│  └──────────────────────────────────────────────────┘        │
│                                                               │
│  Boss Group 一般 1 个线程（只负责 accept）                    │
│  Worker Group 默认 CPU*2 个线程                               │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Netty 核心组件

| 组件 | 说明 |
|------|------|
| Bootstrap / ServerBootstrap | 启动引导类 |
| EventLoopGroup | 线程组（Boss/Worker） |
| EventLoop | 单线程事件循环（Selector + TaskQueue） |
| Channel | 网络连接抽象 |
| ChannelPipeline | 处理链（入站+出站） |
| ChannelHandler | 业务处理器 |
| ChannelHandlerContext | 处理器上下文 |
| ByteBuf | 字节缓冲区（JDK ByteBuffer 的增强版） |
| Future / Promise | 异步结果 |

### 2.3 ChannelPipeline

```
┌──────────────────────────────────────────────────────────┐
│                  ChannelPipeline 处理链                    │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  入站方向（Inbound）：网络 → 应用                          │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐                │
│  │Decode│→ │Auth  │→ │Logic │→ │Encode │                │
│  └──────┘  └──────┘  └──────┘  └──────┘                │
│                                                           │
│  出站方向（Outbound）：应用 → 网络                        │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐                │
│  │Decode│← │Auth  │← │Logic │← │Encode │                │
│  └──────┘  └──────┘  └──────┘  └──────┘                │
│                                                           │
│  HeadContext ←→ [Handler1 ↔ Handler2 ↔ ...] ←→ TailContext│
│                                                           │
│  注意：                                                   │
│  ├── InboundHandler 只处理入站事件                        │
│  ├── OutboundHandler 只处理出站事件                       │
│  └── DuplexHandler 同时处理入站和出站                     │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

---

## 三、ByteBuf

### 3.1 与 JDK ByteBuffer 的区别

| 特性 | JDK ByteBuffer | Netty ByteBuf |
|------|----------------|---------------|
| 容量 | 固定，不可扩容 | 动态扩容 |
| 读写切换 | 需 flip() | 读写指针独立，无需 flip |
| 内存类型 | 堆/直接 | 堆/直接/组合 |
| 引用计数 | 无 | 有（ReferenceCounted） |
| 池化 | 无 | 池化 PooledByteBufAllocator |

### 3.2 ByteBuf 结构

```
 +-------------------+------------------+------------------+
 | discardable bytes |  readable bytes  |  writable bytes  |
 |                   |     (CONTENT)    |                  |
 +-------------------+------------------+------------------+
 |                   |                  |                  |
 0      <=      readerIndex   <=   writerIndex    <=    capacity
                           │
                           ▼
                    读取后 discard
```

---

## 四、编解码

### 4.1 TCP 粘包/拆包

```
┌──────────────────────────────────────────────────────────┐
│               TCP 粘包/拆包问题                           │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  粘包：多个小包合并为一个大包                              │
│  ┌──────┐┌──────┐┌──────┐     ┌──────────────────┐      │
│  │ Msg1 ││ Msg2 ││ Msg3 │ ──▶│    Msg1+Msg2+Msg3 │      │
│  └──────┘└──────┘└──────┘     └──────────────────┘      │
│                                                           │
│  拆包：一个大包拆分为多个小包                              │
│  ┌──────────────────┐     ┌──────────┐┌──────────┐      │
│  │     Big Msg      │ ──▶│  Big Msg1 ││  Big Msg2 │      │
│  └──────────────────┘     └──────────┘└──────────┘      │
│                                                           │
│  根本原因：TCP 是流式协议，无消息边界                      │
│                                                           │
│  解决方案（Netty 提供）：                                  │
│  ├── FixedLengthFrameDecoder    固定长度                  │
│  ├── LineBasedFrameDecoder     换行符分隔                │
│  ├── DelimiterBasedFrameDecoder 自定义分隔符              │
│  ├── LengthFieldBasedFrameDecoder 长度字段（最常用）      │
│  └── 自定义协议 + 编解码器                                │
│                                                           │
│  LengthField 协议示例：                                    │
│  ┌──────────┬──────────┬──────────────────────┐          │
│  │ 魔数(4B) │长度(4B)  │      消息体          │          │
│  │ 0xABCD   │  =N      │     N bytes          │          │
│  └──────────┴──────────┴──────────────────────┘          │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

### 4.2 自定义协议编解码

```java
// 编码器
public class MessageEncoder extends MessageToByteEncoder<Message> {
    @Override
    protected void encode(ChannelHandlerContext ctx, Message msg, ByteBuf out) {
        // 魔数
        out.writeInt(0xABCD);
        // 版本
        out.writeByte(msg.getVersion());
        // 消息类型
        out.writeByte(msg.getType());
        // 消息长度 + 消息体
        byte[] body = JSON.toJSONBytes(msg.getBody());
        out.writeInt(body.length);
        out.writeBytes(body);
    }
}

// 解码器（配合 LengthFieldBasedFrameDecoder）
public class MessageDecoder extends ByteToMessageDecoder {
    @Override
    protected void decode(ChannelHandlerContext ctx, ByteBuf in, List<Object> out) {
        int magic = in.readInt();
        if (magic != 0xABCD) {
            ctx.close();
            return;
        }
        byte version = in.readByte();
        byte type = in.readByte();
        int length = in.readInt();
        byte[] body = new byte[length];
        in.readBytes(body);

        out.add(new Message(version, type, JSON.parseObject(body)));
    }
}
```

---

## 五、Netty 高性能原因

```
┌──────────────────────────────────────────────────────────┐
│                Netty 高性能设计要点                        │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  1. Reactor 主从模型                                      │
│     Boss accept + Worker read/write                       │
│                                                           │
│  2. NIO 非阻塞 + epoll                                   │
│     一个线程管理多个连接                                   │
│                                                           │
│  3. 零拷贝                                                │
│     ├── ByteBuf 直接内存（堆外）                          │
│     ├── FileRegion 文件传输（transferTo）                  │
│     └── CompositeByteBuf 合并缓冲区（逻辑合并无拷贝）     │
│                                                           │
│  4. 内存池                                                │
│     PooledByteBufAllocator                                │
│     jemalloc 算法分配，减少 GC                            │
│                                                           │
│  5. 无锁设计                                              │
│     ├── EventLoop 单线程串行执行，无锁                    │
│     ├── NioEventLoop 内的 TaskQueue 无锁                  │
│     └── HashedWheelTimer 时间轮无锁                       │
│                                                           │
│  6. 高效序列化                                            │
│     对象池复用，减少对象创建                               │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

---

## 六、高频面试题

| 问题 | 核心答案 |
|------|----------|
| BIO / NIO / AIO 的区别？ | BIO 阻塞一对一；NIO 非阻塞多路复用；AIO 真正异步 |
| epoll 和 select 的区别？ | epoll 事件驱动O(1)，select 遍历O(n)；epoll 无连接数限制 |
| Netty 的线程模型？ | 主从 Reactor 多线程：Boss accept + Worker read/write |
| TCP 粘包怎么解决？ | LengthFieldBasedFrameDecoder 长度字段分割 |
| Netty 为什么快？ | Reactor模型 + 零拷贝 + 内存池 + 无锁串行 + epoll |
| ByteBuf 和 ByteBuffer 的区别？ | 动态扩容、读写独立指针、池化、引用计数 |
| Netty 如何实现心跳？ | IdleStateHandler 检测读写空闲 → userEventTriggered 处理 |
