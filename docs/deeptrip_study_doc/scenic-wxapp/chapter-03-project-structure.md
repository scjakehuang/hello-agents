# 第 3 章：项目结构详解

## 3.1 顶层目录

```
scenic-wxapp/
├── app.js                    ← 小程序入口（App 注册、生命周期、全局数据）
├── app.wxss                  ← 全局样式
├── app.json                  ← 构建生成（不提交 git，由 build.js 生成）
├── package.json              ← 依赖与脚本
├── build.js                  ← 多小程序构建脚本（核心文件！）
├── project.config.base.json  ← 微信开发者工具项目配置（AppID、基础库版本）
│
├── config/                   ← 多小程序差异化配置
│   ├── app.base.json         ←   公共分包/页面/TabBar/组件注册
│   ├── app.tc.json           ←   TC 专属页面/分包（覆盖 base）
│   ├── app.tc2.json          ←   TC2 专属配置
│   ├── app.tc3.json          ←   TC3 专属配置
│   ├── tc.js                 ←   TC 环境变量（后端 URL、主题色、业务ID）
│   ├── tc2.js                ←   TC2 环境变量
│   └── ...                   ←   其他小程序环境配置
│
├── pages/                    ← 页面模块（业务核心！）
│   ├── index/                ←   入口页（权限授权、跳转分发）
│   ├── home/                 ←   首页（DIY/CMS 动态装修）
│   ├── jqUser/               ←   个人中心
│   ├── detail/               ←   商品/景区详情
│   ├── order/                ←   订单（列表、详情、支付、售后）
│   ├── ticket/               ←   票务（下单、支付、票详情）
│   ├── mall/                 ←   商城（实物商品、物流、评价）
│   ├── gift/                 ←   礼包（卡密兑换、发送领取）
│   ├── marketing/            ←   营销（优惠券、弹窗）
│   ├── canyoning/            ←   溪降挑战（活动、打卡、排行榜）
│   ├── calendarRoom/         ←   日历房预订
│   ├── webview/              ←   WebView 容器
│   ├── asyncComponents/      ←   懒加载公共组件分包
│   └── ...
│
├── components/               ← 全局公共组件
│   ├── header/               ←   导航栏
│   ├── modal/                ←   模态弹窗
│   ├── coupon/               ←   优惠券组件
│   ├── skeleton/             ←   骨架屏
│   ├── badge/                ←   角标
│   └── ...
│
├── api/                      ← API 请求层（每文件 = 一组后端接口封装）
│   ├── shop.js               ←   店铺
│   ├── goods.js              ←   商品
│   ├── order.js              ←   订单
│   ├── cart.js               ←   购物车
│   ├── user.js               ←   用户
│   ├── coupon.js             ←   优惠券
│   └── ...
│
├── service/                  ← 业务逻辑服务层
│   ├── index.js              ←   应用初始化（token/role/shop）
│   ├── user.js               ←   用户认证（登录/session/手机号）
│   ├── shop.js               ←   店铺管理
│   ├── order.js              ←   订单处理
│   └── ...
│
├── constants/                ← 常量与基础设施
│   ├── api.js                ←   API 端点定义（100+ 个接口路径）
│   ├── consts.js             ←   应用常量/枚举
│   ├── request.js            ←   HTTP 请求封装（核心文件！）
│   ├── index.js              ←   全局数据 globalData
│   └── config.js             ←   构建时生成的环境配置
│
├── store/                    ← 全局状态管理
│   └── index.js              ←   Minax Store 实例
│
├── minax.js                  ← Minax 状态管理库源码
│
├── utils/                    ← 工具函数
│   ├── util.js               ←   通用工具
│   ├── router.js             ←   导航封装
│   ├── event.js              ←   事件总线
│   ├── common.wxs            ←   WXS 辅助函数
│   └── ...
│
├── custom-tab-bar/           ← 自定义 TabBar 组件
│   ├── index.js
│   ├── index.wxml
│   └── index.wxss
│
├── images/                   ← 静态图片
├── lib/                      ← 第三方库（CryptoJS 等）
├── miniprogram_npm/          ← npm 构建产物
└── key/                      ← CI 上传密钥
```

## 3.2 页面模块内部结构

以 `pages/home/` 为例，一个典型页面的文件组织：

```
pages/home/
├── home.js                   ← 页面主逻辑（Page({}) 注册）
├── home.wxml                 ← 页面模板
├── home.wxss                 ← 页面样式
├── home.json                 ← 页面配置（标题、引用的组件）
├── home.wxs                  ← WXS 辅助函数（模板层数据格式化）
├── buriedPoint.js            ← 埋点逻辑
├── cms.wxs                   ← CMS 数据解析 WXS
├── _components/              ← 页面级私有组件
│   ├── topNav/               ←   顶部导航
│   ├── search/               ←   搜索组件
│   └── ...
├── carousel/                 ← 轮播图模块
├── goods/                    ← 商品列表模块
├── search/                   ← 搜索模块
└── diy/                      ← DIY 装修模块
```

> 页面内子模块（`carousel/`、`goods/` 等）用独立目录组织，每个目录包含各自的 `.js` / `.wxml` / `.wxss` / `.json`，是独立的微信小程序组件。

## 3.3 分包架构

由于微信限制**主包 ≤ 2MB**，项目采用分包机制拆分代码：

```
主包（pages/）
├── pages/index/index      ← 入口页
├── pages/home/home         ← 首页（TabBar）
└── pages/jqUser/jqUser     ← 个人中心（TabBar）

分包（按业务域拆分）
├── detail/                 ← 商品详情分包
├── order/                  ← 订单分包
├── ticket/                 ← 票务分包
├── mall/                   ← 商城分包
├── canyoning/              ← 溪降挑战分包
├── gift/                   ← 礼包分包
├── marketing/              ← 营销分包
├── calendarRoom/           ← 日历房分包
├── asyncComponents/        ← 公共懒加载组件分包
└── ...
```

游客进入小程序时只下载主包，访问到某个分包页面时才按需下载对应分包代码。

## 3.4 关键文件速查

| 你想... | 看这个文件 |
|---------|----------|
| 找有哪些页面 | `config/app.base.json` → `pages` + `subpackages` |
| 找一个接口调用 | `api/` 下对应域名的 `.js` 文件 |
| 改后端地址/主题色 | `config/{mp}.js` → `NetURL.{env}` |
| 看请求头怎么加的 | `constants/request.js` 的 `requestAll` 方法 |
| 看登录/Session 怎么管理 | `service/user.js` |
| 看全局状态有哪些 | `store/index.js` |
| 看初始化流程 | `service/index.js` 的 `initPromise` |
| 看构建怎么拼配置 | `build.js` |

## 3.5 命名规范

| 类型 | 规则 | 示例 |
|------|------|------|
| 页面目录 | camelCase 或单字 | `home/`, `jqUser/`, `calendarRoom/` |
| 组件目录 | 小写 | `header/`, `modal/`, `coupon/` |
| 文件名 | 与目录同名或语义化 | `home.js`, `buriedPoint.js` |
| API 模块 | 按业务域小写 | `shop.js`, `order.js` |
| 常量文件 | 语义化 | `api.js`, `consts.js`, `request.js` |
| 导入路径 | `@/` 别名或相对路径 | `import http from "@/constants/request"` |
