# 第 1 章：项目概览

## 1.1 这是什么项目

`scenic-wxapp` 是景区票务系统的 **C 端微信小程序**，一套代码支撑 6+ 个独立小程序上线运行：

| 小程序简称 | AppID | 产品名称 |
|-----------|-------|---------|
| **TC** | `wx1c34a90cf27decb6` | 呀诺达雨林（锦鲤小店） |
| **TC2** | `wx0bb689f8ccb553db` | AR 视界 |
| **TC3** | `wx40c3f94edf8410d7` | 燕园 |
| **YY** | `wxd10ed8f0fbe33f57` | 燕园 |
| **ZYHL** | `wx5ec782655a791494` | 智游红旅 |
| **ZC** | `wxddf5b920a65e3a23` | 中传 |
| **Dev** | `wx6f0ebd124611fced` | 开发/测试环境 |

> 核心思路：**一套代码 + 多套配置 → 多个独立小程序**。各小程序的页面、TabBar、主题色、后端地址等差异化内容通过 `config/` 下的配置文件区分。

## 1.2 与后端服务的关系

```
微信小程序（scenic-wxapp）
        │
        ▼
┌──────────────────────────────────────┐
│  arsenal-componented-gateway-jq      │  ← 统一网关
│  arsenalgw.qa.ly.com/jq-customer/1   │  ← C 端网关路由
│  arsenalgw.qa.ly.com/jq-gw/1/shop-gw │  ← 通用网关（部分接口）
└──────────────────────────────────────┘
        │
        ├──→ arsenal-service-jq (saas-customer-jq)   ← C 端业务
        ├──→ arsenal-service-product-jq              ← 商品/价格/库存
        ├──→ arsenal-service-order-customer-jq       ← 订单/票务
        ├──→ arsenal-service-marketing-jq            ← 营销/优惠券
        └──→ arsenal-service-member-jq              ← 会员
```

小程序主要走网关的 `jq-customer` 路由（C 端），部分商城/小店类接口走 `shop-gw` 网关。

## 1.3 多小程序差异化体系

同一套代码怎么生出 6 个不同的小程序？靠三层配置叠加：

```
config/
├── app.base.json        ← 第 1 层：公共页面/分包/TabBar/组件注册
├── app.tc.json          ← 第 2 层：TC 特有页面/分包覆盖
├── app.tc2.json         ←        TC2 特有
├── ...
├── tc.js                ← 第 3 层：TC 环境变量（后端地址/主题色/AppID）
└── tc2.js               ←        TC2 环境变量
```

`build.js` 读取参数 `mp=TC`，把 base + TC 独有配置合并，生成最终的 `app.json` 和 `config/index.js`。

## 1.4 功能模块一览

| 模块 | 分包 | 核心功能 |
|------|------|---------|
| 首页 | 主包 | DIY/CMS 动态首页、搜索、推荐 |
| 商品详情 | `detail` | 景区/票型/SKU 详情、下单入口 |
| 订单 | `order` / `ticket` | 订单列表、详情、支付、售后 |
| 商城 | `mall` | 实物商品、物流、评价 |
| 礼包 | `gift` | 卡密兑换、礼包发送/领取 |
| 营销 | `marketing` | 优惠券中心、营销弹窗 |
| 溪降挑战 | `canyoning` | 挑战报名、扫码打卡、排行榜、兑奖 |
| 用户 | `jqUser` | 个人中心、会员、积分、地址 |
| 日历房 | `calendarRoom` | 酒店/日历房预订 |
| 心愿墙 | `wishesMatch` | 年会心愿墙、匹配 |

## 1.5 关键认知

作为后端开发者，理解这些映射可以快速建立 mental model：

- 小程序的**页面 = 后端的 Controller 接口**（但页面只管展示和交互，数据走 API）
- **`api/` 目录 = 后端的 Feign Client**（封装 HTTP 请求）
- **`service/` 目录 = 后端的 Service 层**（业务逻辑编排）
- **`constants/request.js` = 后端的拦截器**（统一附加 token/business/header）
- **`store/index.js` = 后端的 `static ConcurrentHashMap`**（全局共享状态）
- **路由配置在 `config/app.base.json`**，相当于后端的 `@RequestMapping`
- **小程序有严格的包体积限制**（主包 ≤ 2MB），所以用分包机制拆分代码
