# Netty 自定义协议（RemotingCommand 帧 + 三种语义）

RocketMQ 4.x 客户端与 Broker 之间的通信走 **Netty + 自定义二进制协议**。理解这一层有助于排查超时、断连、序列化错误等问题。

---

## 一、为什么不用 HTTP？

```
HTTP/1.1：
  • 文本协议，header 冗余大
  • 无法多路复用（HTTP/2 才行）
  • 长连接管理粗糙
  
gRPC（5.x 用）：
  • 好用，但绑定 protobuf
  • 需要 HTTP/2 栈

RocketMQ 4.x 选择：
  Netty + 自定义二进制
  → 极致性能（单连接百万 TPS）
  → 完全可控
  → 但跨语言难
```

---

## 二、RemotingCommand 协议帧

### 2.1 整体结构

```
┌──────────────┬──────────────┬─────────────────┬──────────────┐
│ TotalLen(4B) │ HeaderLen(4B)│ HeaderData       │ BodyData      │
└──────────────┴──────────────┴─────────────────┴──────────────┘
   总长度          头长度+格式      JSON/RocketMQ 序列化   原始字节


HeaderLen 字段的高 8 位是序列化协议类型：
  0 = JSON
  1 = RocketMQ 私有协议（更紧凑）
低 24 位是 HeaderData 的实际长度
```

### 2.2 Header 内容

```java
public class RemotingCommand {
    // 协议字段
    private int code;                // 业务码（SEND_MESSAGE / PULL_MESSAGE / ...）
    private LanguageCode language;   // 客户端语言（JAVA/C++/...）
    private int version;             // 版本号
    private int opaque;              // 请求 ID（响应时返回，用于配对）
    private int flag;                // 标志位（0=request, 1=response, 2=oneway）
    private String remark;           // 备注（错误信息常放这里）
    
    // 业务自定义字段
    private HashMap<String, String> extFields;
    
    // body
    private transient byte[] body;
}
```

### 2.3 业务码（code）

```java
// RequestCode（请求）
public class RequestCode {
    public static final int SEND_MESSAGE = 10;
    public static final int PULL_MESSAGE = 11;
    public static final int QUERY_MESSAGE = 12;
    public static final int HEART_BEAT = 34;
    public static final int CONSUMER_SEND_MSG_BACK = 36;
    public static final int END_TRANSACTION = 37;
    // ...
}

// ResponseCode（响应）
public class ResponseCode {
    public static final int SUCCESS = 0;
    public static final int SYSTEM_ERROR = 1;
    public static final int SYSTEM_BUSY = 2;
    public static final int FLUSH_DISK_TIMEOUT = 10;
    public static final int SLAVE_NOT_AVAILABLE = 11;
    // ...
}
```

---

## 三、三种通信语义

### 3.1 SYNC（同步）

```java
// 客户端
RemotingCommand request = RemotingCommand.createRequestCommand(
    RequestCode.SEND_MESSAGE, header);
request.setBody(messageBody);

RemotingCommand response = remotingClient.invokeSync(addr, request, 3000);
// 阻塞等响应，最多等 3000ms
```

**实现机制**：

```java
public RemotingCommand invokeSync(String addr, RemotingCommand request, long timeoutMs) {
    int opaque = request.getOpaque();
    
    // ① 创建 ResponseFuture，放进表
    ResponseFuture future = new ResponseFuture(opaque, timeoutMs);
    responseTable.put(opaque, future);
    
    // ② 发送请求
    channel.writeAndFlush(request);
    
    // ③ 阻塞等待 future 完成
    RemotingCommand response = future.waitResponse(timeoutMs);
    
    // ④ 处理结果
    responseTable.remove(opaque);
    return response;
}

// 收到响应时
public void processResponseCommand(Channel ch, RemotingCommand cmd) {
    int opaque = cmd.getOpaque();
    ResponseFuture future = responseTable.remove(opaque);
    
    if (future != null) {
        future.setResponse(cmd);  // 唤醒等待的线程
    }
}
```

### 3.2 ASYNC（异步）

```java
// 客户端
remotingClient.invokeAsync(addr, request, 3000, responseFuture -> {
    RemotingCommand response = responseFuture.getResponseCommand();
    // 处理响应（在 Netty IO 线程中）
});
```

**实现机制**：

```java
public void invokeAsync(String addr, RemotingCommand request, long timeoutMs,
                        InvokeCallback callback) {
    ResponseFuture future = new ResponseFuture(opaque, timeoutMs, callback, ...);
    responseTable.put(opaque, future);
    
    // ★ 信号量控制并发请求数
    semaphoreAsync.acquire();
    
    channel.writeAndFlush(request).addListener(f -> {
        if (!f.isSuccess()) {
            responseTable.remove(opaque);
            future.executeInvokeCallback();  // 失败立即回调
        }
    });
}

// 响应到达时
public void processResponseCommand(Channel ch, RemotingCommand cmd) {
    ResponseFuture future = responseTable.remove(cmd.getOpaque());
    
    if (future.getInvokeCallback() != null) {
        // 在 callbackExecutor 线程池执行回调
        callbackExecutor.execute(() -> future.executeInvokeCallback());
    }
}
```

### 3.3 ONEWAY（单向）

```java
// 客户端
remotingClient.invokeOneway(addr, request, 3000);
// 不等响应，发出去就 return
```

**实现机制**：

```java
public void invokeOneway(String addr, RemotingCommand request, long timeoutMs) {
    request.markOnewayRPC();  // 设置 flag = 2
    
    // 信号量限流
    semaphoreOneway.acquire();
    
    channel.writeAndFlush(request).addListener(f -> {
        semaphoreOneway.release();
    });
    
    // 不放进 responseTable，直接返回
}
```

**适用场景**：

```
✓ 心跳包（不关心 Broker 是否回复）
✓ 日志上报
✓ Consumer offset 提交（容错性高）

✗ 发消息（必须知道是否成功）
✗ 事务消息（必须知道结果）
```

---

## 四、NettyRemotingServer / Client

### 4.1 Pipeline

```
NettyRemotingServer 的 Pipeline：

  ┌───────────────────┐
  │ NettyEncoder      │  序列化 RemotingCommand → ByteBuf
  ├───────────────────┤
  │ NettyDecoder      │  反序列化 ByteBuf → RemotingCommand
  │   extends         │
  │   LengthField     │  按 TotalLen 切包，解决粘包/拆包
  │   FrameDecoder    │
  ├───────────────────┤
  │ IdleStateHandler  │  心跳检测（120s 无读写则断连）
  ├───────────────────┤
  │ ConnectionManage  │  连接生命周期事件
  │ Handler           │
  ├───────────────────┤
  │ NettyServer       │  业务处理入口
  │ Handler           │  → 根据 code 找对应的 Processor
  └───────────────────┘
```

### 4.2 LengthFieldBasedFrameDecoder

```java
// 解决 TCP 粘包/拆包
public class NettyDecoder extends LengthFieldBasedFrameDecoder {
    public NettyDecoder() {
        super(
            16777216,    // maxFrameLength = 16MB
            0,           // lengthFieldOffset
            4,           // lengthFieldLength = 4 字节（TotalLen）
            0,           // lengthAdjustment
            4            // initialBytesToStrip = 4（解码后跳过 TotalLen）
        );
    }
    
    @Override
    public Object decode(ChannelHandlerContext ctx, ByteBuf in) {
        ByteBuf frame = (ByteBuf) super.decode(ctx, in);
        if (frame == null) return null;
        
        // 拿到完整一帧
        return RemotingCommand.decode(frame);
    }
}
```

### 4.3 NettyServerHandler（业务分发）

```java
class NettyServerHandler extends SimpleChannelInboundHandler<RemotingCommand> {
    @Override
    protected void channelRead0(ChannelHandlerContext ctx, RemotingCommand cmd) {
        if (cmd.getType() == RemotingCommandType.REQUEST_COMMAND) {
            processRequestCommand(ctx, cmd);
        } else {
            processResponseCommand(ctx, cmd);
        }
    }
    
    private void processRequestCommand(ChannelHandlerContext ctx, RemotingCommand cmd) {
        // ① 根据 code 找 Processor
        Pair<NettyRequestProcessor, ExecutorService> pair = 
            processorTable.get(cmd.getCode());
        
        // ② 提交到对应的线程池
        pair.getValue().execute(() -> {
            try {
                RemotingCommand response = pair.getKey().processRequest(ctx, cmd);
                
                // ③ 写回响应（除非是 oneway）
                if (!cmd.isOnewayRPC() && response != null) {
                    response.setOpaque(cmd.getOpaque());
                    response.markResponseType();
                    ctx.writeAndFlush(response);
                }
            } catch (Throwable e) {
                // 错误处理
            }
        });
    }
}
```

### 4.4 Processor 注册

```java
// Broker 启动时
public void registerProcessor() {
    // 发消息
    remotingServer.registerProcessor(
        RequestCode.SEND_MESSAGE, 
        new SendMessageProcessor(this), 
        sendMessageExecutor);
    
    // 拉消息
    remotingServer.registerProcessor(
        RequestCode.PULL_MESSAGE, 
        new PullMessageProcessor(this), 
        pullMessageExecutor);
    
    // 查询消息
    remotingServer.registerProcessor(
        RequestCode.QUERY_MESSAGE, 
        new QueryMessageProcessor(this), 
        queryMessageExecutor);
    
    // ...
}
```

---

## 五、长连接管理

### 5.1 心跳机制

```java
// IdleStateHandler 配置
pipeline.addLast(new IdleStateHandler(0, 0, 120));  // 120s 全空闲触发

// 触发后
class ConnectionManageHandler extends ChannelDuplexHandler {
    @Override
    public void userEventTriggered(ChannelHandlerContext ctx, Object evt) {
        if (evt instanceof IdleStateEvent) {
            // 关闭连接
            ctx.channel().close();
        }
    }
}
```

### 5.2 重连

```java
// 客户端发现连接断开
class NettyClientHandler extends SimpleChannelInboundHandler<RemotingCommand> {
    @Override
    public void channelInactive(ChannelHandlerContext ctx) {
        String addr = parseChannelRemoteAddr(ctx.channel());
        
        // 移除 channel 表
        channelTables.remove(addr);
        
        // 下次需要时按需重连（不主动）
    }
}

// 发请求时：
public RemotingCommand invokeSync(addr, ...) {
    Channel channel = getAndCreateChannel(addr);  // 按需建立
    if (!channel.isActive()) {
        closeChannel(addr, channel);
        throw new ConnectException();
    }
    // ...
}
```

### 5.3 连接池策略

```
RocketMQ 客户端策略：
  • 每个 Broker 地址只维护 1 个 TCP 连接
  • 复用连接发所有请求（多路复用通过 opaque 区分）
  
对比 HTTP：
  • HTTP/1.1 一个连接同时只能处理一个请求
  • RocketMQ 一个连接可以同时有几千个 in-flight 请求
  
→ 单连接百万 TPS 可达
```

---

## 六、序列化方式

### 6.1 JSON（默认）

```
优点：可读性好，易调试
缺点：体积大，CPU 开销大

例：SendMessageRequestHeader 序列化后约 200 字节
```

### 6.2 RocketMQ 私有协议

```
更紧凑的二进制：
  • 字段名用 short 编号代替字符串
  • 数据类型紧凑编码

例：同样的 header 约 80 字节（节省 60%）

启用：
  在 RemotingCommand 序列化时指定 SerializeType.ROCKETMQ
```

### 6.3 自定义序列化对比

| 维度 | JSON | RocketMQ |
|---|---|---|
| 体积 | 大 | 小（节省 60%） |
| 速度 | 中等 | 快 2~3 倍 |
| 可读性 | 高 | 低（二进制） |
| 调试 | 容易 | 需要解码工具 |
| 默认 | ✓ | ✗（需手动开） |

---

## 七、SendMessage 完整流程

```
Producer.send(msg)
    │
    ▼
DefaultMQProducerImpl.sendKernelImpl()
    │
    ├─ 选 Queue
    ├─ 构造 SendMessageRequestHeader
    ├─ msg.body 进入 RemotingCommand.body
    └─ MQClientAPIImpl.sendMessage()
        │
        ▼
NettyRemotingClient.invokeSync(addr, request, timeout)
    │
    ├─ ① 复用或建立 Channel
    ├─ ② 注册 ResponseFuture
    ├─ ③ channel.writeAndFlush(request)
    │   │
    │   ├─ NettyEncoder：序列化为 ByteBuf
    │   └─ TCP 发送
    │
    │  ......
    │
    │  ④ Broker 处理完返回响应
    │     │
    │     └─ NettyDecoder：反序列化为 RemotingCommand
    │
    └─ ⑤ NettyClientHandler.processResponseCommand()
        │
        └─ 唤醒 ResponseFuture → 主线程继续
        │
        ▼
SendResult 返回业务
```

---

## 八、协议细节坑

### 8.1 invokeSync 超时

```
默认 timeout = 3000ms

超时不一定是 Broker 慢：
  ① 请求队列堆积（Processor 线程池满）
  ② Broker 写盘慢（SYNC_FLUSH）
  ③ 网络抖动
  ④ Producer 端线程池阻塞

排查：
  • 看 Broker 端 send 处理时间
  • 看 store 落盘时间
  • 看网络 RTT
```

### 8.2 信号量限流

```java
// 客户端默认信号量
semaphoreAsync = new Semaphore(65535);
semaphoreOneway = new Semaphore(65535);

// 满了之后
semaphoreAsync.tryAcquire(timeout);  // 等不到就报错
```

### 8.3 单连接的隐患

```
单连接复用 → 单点
  • 如果 Channel 异常关闭
  • 所有 in-flight 请求都失败

解决：
  • 客户端做重试
  • 选其他 Broker（路由表）
```

### 8.4 大消息

```
maxFrameLength = 16MB（默认）

发更大消息：
  → LengthFieldBasedFrameDecoder 抛 TooLongFrameException
  
拆包发送或调大限制
```

---

## 九、和 5.x gRPC 对比

| 维度 | 4.x Netty 协议 | 5.x gRPC |
|---|---|---|
| **性能** | 极致 | 略低（HTTP/2 开销） |
| **多语言** | 难 | 容易（grpc-tools） |
| **可观测性** | 自实现 | 丰富生态 |
| **运维友好** | 一般 | 好（标准网关支持） |
| **流式** | 自实现 | 原生支持 |
| **协议演进** | 业务字段加 extFields | proto 兼容 |

---

## 十、监控点

```
Netty 维度：
  • channel 数量
  • channel.writeAndFlush 耗时
  • channel.isWritable 状态
  • 入站/出站字节数

ResponseTable 维度：
  • 待响应请求数
  • 超时未响应数
  • 信号量等待数

Pipeline 维度：
  • 编解码耗时
  • IdleEvent 频率
```

---

## 十一、一句话记住核心

> **协议帧**：TotalLen(4) + HeaderLen+格式(4) + Header(JSON/RMQ) + Body。
>
> **三种语义**：SYNC（阻塞等响应）、ASYNC（callback）、ONEWAY（不等响应）。
>
> **核心设计**：单连接 + opaque ID 多路复用 → 百万 TPS。
>
> **协议本质**：自定义二进制 + Netty Pipeline + Processor 分发 = 4.x 高性能基石。
