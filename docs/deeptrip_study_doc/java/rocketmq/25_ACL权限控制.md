# ACL 权限控制（签名鉴权 + Topic/Group 权限）

线上 RocketMQ 集群必须开 ACL，否则任何能连到 Broker 的人都能发消息、消费消息、删 Topic。本文讲清楚 ACL 的鉴权机制和权限模型。

---

## 一、为什么需要 ACL

```
没开 ACL：
  • 任何人知道 NameServer 地址就能发消息
  • 测试环境的 Consumer 不小心连了生产 → 消息错乱
  • 内部攻击 / 信息泄露无法防范

开了 ACL：
  • 客户端必须提供 AccessKey + 签名
  • Broker 验证签名后才接受请求
  • 不同账号有不同的 Topic / Group 操作权限
```

---

## 二、ACL 整体架构

```
       Client                                Broker
       ┌──────────────────┐                  ┌──────────────────┐
       │ AccessKey: rocket│                  │ /conf/plain_acl  │
       │ SecretKey: 12345 │                  │   .yml           │
       │                  │                  │                  │
       │ 构造请求         │                  │ accountConfig:    │
       │   ↓ 签名计算      │                  │  - accessKey:     │
       │ Signature = HMAC │                  │      rocket       │
       │  (SK, content)   │                  │    secretKey:     │
       │                  │                  │      12345        │
       └────────┬─────────┘                  │    topicPerms:    │
                │ 请求 + AK + Signature      │     OrderTopic=DENY│
                ▼                              │    groupPerms:    │
       ┌─────────────────────────────────────┤     g1=SUB        │
       │ Broker AclHook                       │                  │
       │  ① 取 accessKey 查 secretKey         │                  │
       │  ② 用 SK + 请求内容重新算签名         │                  │
       │  ③ 对比客户端的 Signature             │                  │
       │  ④ 检查 Topic/Group 权限              │                  │
       └─────────────────────────────────────┘
```

---

## 三、启用 ACL

### 3.1 Broker 端配置

```properties
# broker.conf
aclEnable=true
```

### 3.2 配置账号文件

```yaml
# /opt/rocketmq/conf/plain_acl.yml

# 全局白名单（这些 IP 不需要鉴权）
globalWhiteRemoteAddresses:
  - 10.10.103.*
  - 192.168.0.*

# 账号列表
accounts:
  - accessKey: RocketMQ
    secretKey: 12345678
    whiteRemoteAddress:           # 此账号的白名单
    admin: false                  # 是否管理员
    defaultTopicPerm: DENY        # 默认 Topic 权限
    defaultGroupPerm: SUB         # 默认 Group 权限
    topicPerms:
      - topicA=DENY
      - topicB=PUB|SUB
      - topicC=SUB
    groupPerms:
      - groupA=DENY
      - groupB=SUB
      - groupC=SUB

  - accessKey: rocketmq2
    secretKey: 87654321
    admin: true                   # 管理员，拥有所有权限
```

### 3.3 客户端配置

```java
// Producer
DefaultMQProducer producer = new DefaultMQProducer(
    "ProducerGroup", 
    new AclClientRPCHook(new SessionCredentials("RocketMQ", "12345678"))
);

// Consumer
DefaultMQPushConsumer consumer = new DefaultMQPushConsumer(
    "ConsumerGroup", 
    new AclClientRPCHook(new SessionCredentials("RocketMQ", "12345678")),
    new AllocateMessageQueueAveragely()
);
```

---

## 四、签名机制

### 4.1 客户端构造签名

```java
public class AclClientRPCHook implements RPCHook {
    private SessionCredentials credentials;
    
    @Override
    public void doBeforeRequest(String remoteAddr, RemotingCommand request) {
        // ① 添加签名相关 header
        byte[] body = request.getBody();
        Map<String, String> extFields = request.getExtFields();
        
        extFields.put("AccessKey", credentials.getAccessKey());
        extFields.put("SignedHeaders", getSignedHeaders());
        
        // ② 构造待签名内容
        String stringToSign = buildStringToSign(extFields, body);
        
        // ③ HMAC-SHA1 签名
        String signature = AclSigner.calSignature(stringToSign, credentials.getSecretKey());
        
        extFields.put("Signature", signature);
    }
    
    private String buildStringToSign(Map<String, String> fields, byte[] body) {
        // 把所有字段按 key 排序，拼起来
        StringBuilder sb = new StringBuilder();
        TreeMap<String, String> sorted = new TreeMap<>(fields);
        for (Map.Entry<String, String> e : sorted.entrySet()) {
            sb.append(e.getKey()).append(e.getValue());
        }
        // body 也参与签名
        if (body != null) {
            sb.append(new String(body, StandardCharsets.UTF_8));
        }
        return sb.toString();
    }
}
```

### 4.2 HMAC-SHA1 算法

```java
public class AclSigner {
    public static String calSignature(String data, String key) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA1");
        SecretKeySpec keySpec = new SecretKeySpec(
            key.getBytes(StandardCharsets.UTF_8), "HmacSHA1");
        mac.init(keySpec);
        byte[] signed = mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
        return Base64.getEncoder().encodeToString(signed);
    }
}
```

### 4.3 Broker 验签

```java
public class AclHook implements RPCHook {
    private final PlainAccessValidator validator;
    
    @Override
    public void doBeforeRequest(String remoteAddr, RemotingCommand request) {
        // ① 解析请求中的 AccessKey
        Map<String, String> fields = request.getExtFields();
        String accessKey = fields.get("AccessKey");
        String signature = fields.get("Signature");
        
        // ② 查 secretKey
        PlainAccessConfig accessConfig = configMap.get(accessKey);
        if (accessConfig == null) {
            throw new AclException("AccessKey not found: " + accessKey);
        }
        
        // ③ 重算签名
        String stringToSign = buildStringToSign(fields, request.getBody());
        String expectedSignature = AclSigner.calSignature(
            stringToSign, accessConfig.getSecretKey());
        
        // ④ 对比
        if (!expectedSignature.equals(signature)) {
            throw new AclException("Signature mismatch");
        }
        
        // ⑤ 检查权限（下一节）
        validator.validate(accessConfig, request);
    }
}
```

---

## 五、权限模型

### 5.1 三种权限

```
DENY  = 禁止
PUB   = 仅发送
SUB   = 仅订阅
PUB|SUB = 发送 + 订阅
```

### 5.2 默认权限

```yaml
defaultTopicPerm: DENY    # 默认所有 Topic 都禁止
defaultGroupPerm: SUB     # 默认所有 Group 都可订阅

topicPerms:
  - OrderTopic=PUB|SUB    # 覆盖默认
  - PayTopic=SUB
```

### 5.3 权限检查时机

```
SendMessage 请求：
  → 检查 Producer 对 Topic 的权限
  → 必须有 PUB 权限

PullMessage 请求：
  → 检查 Consumer 对 Topic 的权限（SUB）
  → 也检查对 Group 的权限（SUB）

CreateTopic / DeleteTopic：
  → 必须是 admin 账号
```

### 5.4 检查逻辑

```java
public void validate(PlainAccessConfig config, RemotingCommand request) {
    // ① admin 直接通过
    if (config.isAdmin()) return;
    
    // ② 按 RequestCode 判断需要哪种权限
    int code = request.getCode();
    String topic = request.getExtFields().get("topic");
    String group = request.getExtFields().get("consumerGroup");
    
    switch (code) {
        case RequestCode.SEND_MESSAGE:
            // 需要 PUB 权限
            if (!hasTopicPerm(config, topic, Permission.PUB)) {
                throw new AclException("No PUB perm for topic: " + topic);
            }
            break;
            
        case RequestCode.PULL_MESSAGE:
            // 需要 SUB 权限（Topic + Group）
            if (!hasTopicPerm(config, topic, Permission.SUB)) {
                throw new AclException("No SUB perm for topic: " + topic);
            }
            if (!hasGroupPerm(config, group, Permission.SUB)) {
                throw new AclException("No SUB perm for group: " + group);
            }
            break;
            
        case RequestCode.UPDATE_AND_CREATE_TOPIC:
        case RequestCode.DELETE_TOPIC_IN_BROKER:
            // 仅 admin（已在上面 return）
            throw new AclException("Admin required");
    }
}
```

---

## 六、配置文件热加载

### 6.1 自动监听

```java
public class PlainPermissionManager {
    private final FileWatchService watchService;
    
    public PlainPermissionManager() {
        watchService = new FileWatchService(
            new String[] { aclConfigFile },
            new FileWatchService.Listener() {
                @Override
                public void onChanged(String path) {
                    log.info("acl config file changed: {}", path);
                    reload();  // 重新加载
                }
            }
        );
        watchService.start();
    }
    
    private void reload() {
        // 解析 yml → 更新 configMap
        Map<String, PlainAccessConfig> newMap = parseYaml(aclConfigFile);
        configMap = newMap;
    }
}
```

### 6.2 通过 API 修改

```bash
# 新增账号
mqadmin updateAclConfig -n localhost:9876 \
  -b 192.168.1.10:10911 \
  -a NewAccessKey -s NewSecret \
  -t "topic1=PUB|SUB;topic2=SUB" \
  -g "group1=SUB"

# 删除账号
mqadmin deleteAccessConfig -n localhost:9876 \
  -b 192.168.1.10:10911 \
  -a NewAccessKey
```

---

## 七、白名单机制

### 7.1 全局白名单

```yaml
globalWhiteRemoteAddresses:
  - 10.10.103.*       # 整个网段
  - 192.168.1.100     # 单 IP
  - 172.16.*.*        # 多级通配
```

```
匹配规则：
  • 通配符 * 匹配任意
  • 段位用 . 分隔
  • IPv6 也支持
```

### 7.2 账号级白名单

```yaml
accounts:
  - accessKey: RocketMQ
    secretKey: 12345678
    whiteRemoteAddress: 10.10.103.*   # 此账号仅允许这些 IP
    topicPerms:
      - topicA=PUB|SUB
```

```
作用：
  • 即使签名正确，IP 不在白名单也拒绝
  • 防止 AccessKey 泄露
```

---

## 八、Producer / Consumer 实际请求

### 8.1 请求中的 Header

```
SendMessage 请求 ExtFields：
  • topic: OrderTopic
  • producerGroup: ProducerGroup
  • queueId: 0
  • ...业务字段...
  • AccessKey: RocketMQ              ← ACL 新增
  • SignedHeaders: ...                ← ACL 新增
  • Signature: xxx                    ← ACL 新增
  • SecurityToken: yyy                ← STS Token（可选）
```

### 8.2 STS 临时凭证

```java
// 用临时 token 而非长期 SecretKey
SessionCredentials creds = new SessionCredentials(
    "AccessKey",
    "SecretKey",
    "SecurityToken"     // 由 STS 服务签发，有效期 1 小时
);
```

```
适用：
  ✓ 移动 App / 边缘设备
  ✓ 不希望长期密钥下发
  ✓ 灵活的权限控制
```

---

## 九、性能影响

### 9.1 鉴权开销

```
每次请求：
  ① 客户端构造签名（HMAC-SHA1）：~10us
  ② Broker 重算 + 对比：~10us
  ③ 权限检查（Map 查询）：~1us
  
合计：~20us 额外开销

对 SendMessage 整体 RT（~1ms）影响 < 2%
→ 开启 ACL 几乎无感
```

### 9.2 优化

```java
// 客户端复用 Mac 实例（避免每次创建）
private static final ThreadLocal<Mac> macThreadLocal = ...;

// Broker 端：accessKey → PlainAccessConfig 用 ConcurrentHashMap
private ConcurrentMap<String, PlainAccessConfig> configMap;
```

---

## 十、最佳实践

### 10.1 账号设计

```
按业务域划分账号：
  • order-app    → 仅订单相关 Topic
  • pay-app      → 仅支付相关 Topic
  • monitor-app  → 全 Topic 的 SUB

不要：
  ✗ 一个账号管所有
  ✗ 共享账号
  ✗ AccessKey 写死在代码（用配置中心）
```

### 10.2 SecretKey 管理

```
✓ 用 KMS / Vault 等密钥服务
✓ 定期轮换（如每 90 天）
✓ 不同环境用不同密钥
✓ CI/CD 注入

✗ 提交到 git
✗ 邮件传递
✗ 钉钉 / 微信发
```

### 10.3 管理员账号

```
✓ admin 账号严格控制（仅运维）
✓ admin 操作走审计日志
✓ admin 账号配 IP 白名单
```

### 10.4 灰度开启

```
新集群直接开 ACL

老集群启用 ACL：
  ① 先配置账号（暂不强制）
  ② 通知所有业务方接入 SDK + 配置 AccessKey
  ③ 观察一周（监控 ACL 拒绝数）
  ④ 强制 aclEnable=true
```

---

## 十一、和 Kafka SASL 对比

| 维度 | RocketMQ ACL | Kafka SASL/SCRAM |
|---|---|---|
| **协议** | HMAC-SHA1 签名 | SASL SCRAM-SHA-256 |
| **配置** | yaml 文件 / API | Zookeeper / KRaft |
| **权限粒度** | Topic / Group | Topic / Group / Cluster |
| **热加载** | ✓ 文件监听 | ✓ API 更新 |
| **STS** | ✓ | ✗（需要 OAuth2） |
| **管理** | mqadmin | kafka-acls.sh |

---

## 十二、坑

### 12.1 时间不同步

```
签名不校验时间戳（HMAC 没用 timestamp）：
  → 重放攻击风险
  
但实际：
  • 5.x 增加了 RequestTime 字段
  • Broker 检查时间偏差 < 5 分钟
  
→ 客户端和 Broker 时钟必须同步（NTP）
```

### 12.2 Body 修改导致签名失败

```
代理层（如 Envoy）修改了请求 body：
  → 签名校验失败 → ACL 拒绝
  
→ ACL 与代理层不兼容
→ 5.x gRPC 用 metadata 传 token 缓解
```

### 12.3 默认权限设置错误

```
defaultTopicPerm: PUB|SUB   ← 默认所有 Topic 都允许 ← 危险！

正确：
  defaultTopicPerm: DENY    ← 默认禁止，按需 allowlist
```

### 12.4 NameServer 也需要 ACL

```
4.x：NameServer 不支持 ACL（任意人可查路由）
5.x：5.1+ NameServer 也支持 ACL

如果 NameServer 暴露公网 → 必须升级到 5.x
```

---

## 十三、一句话记住核心

> **签名鉴权**：客户端用 SecretKey 做 HMAC-SHA1 → 服务端用同样的 SK 重算 + 对比。
>
> **权限模型**：账号 → Topic/Group 权限（DENY/PUB/SUB/PUB|SUB）+ admin 标志 + IP 白名单。
>
> **配置**：plain_acl.yml（文件热加载）或 mqadmin API。
>
> **铁律**：生产环境必开；defaultTopicPerm 必须 DENY；SecretKey 走 KMS 不能进代码。
