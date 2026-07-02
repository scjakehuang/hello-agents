# 第 2 章：核心技术栈

## 2.1 技术栈全景图

```
┌─────────────────────────────────────────────────┐
│                    平台层                         │
│  微信原生小程序框架 (WXML + WXSS + JS + WXS)       │
│  基础库版本 ≥ 2.22.0                              │
├─────────────────────────────────────────────────┤
│                    UI 层                          │
│  @vant/weapp 1.4.2 (Vant 小程序组件库)            │
│  + mall-ui (内部共享组件库)                       │
├─────────────────────────────────────────────────┤
│                   逻辑层                          │
│  Minax (自研 Vuex 风格状态管理)                   │
│  + Events (发布订阅事件总线)                      │
│  + dayjs (日期) + big.js (精确运算)              │
├─────────────────────────────────────────────────┤
│                   通信层                          │
│  Http 封装类 (constants/request.js)              │
│  + Session Token 自动刷新                        │
├─────────────────────────────────────────────────┤
│                   工具层                          │
│  Sentry (错误监控) + Tingyun/听云 (性能监控)      │
│  + PageSpy (远程调试) + 埋点 (统计分析)           │
│  + miniprogram-ci (构建上传 CI/CD)               │
└─────────────────────────────────────────────────┘
```

## 2.2 核心依赖详解

### 框架：微信原生小程序

项目采用**微信原生开发**，没有用 Taro / uni-app 等跨端框架。每个页面是 4 个文件：

| 文件 | 用途 | 类比 |
|------|------|------|
| `xxx.js` | 页面逻辑（数据、方法、生命周期） | React 组件逻辑部分 |
| `xxx.wxml` | 页面模板（类似 HTML） | JSX 模板部分 |
| `xxx.wxss` | 页面样式 | CSS / Less |
| `xxx.json` | 页面配置（标题、组件引用等） | 无直接对应 |

### UI 组件库：`@vant/weapp` v1.4

Vant Weapp 是有赞出品的微信小程序 UI 组件库，类似 Web 端的 antd：

| 组件 | 用途 |
|------|------|
| `van-button` | 按钮 |
| `van-popup` | 弹出层 |
| `van-cell` / `van-cell-group` | 单元格（列表项） |
| `van-field` | 输入框 |
| `van-icon` | 图标 |
| `van-dialog` | 对话框 |
| `van-tab` / `van-tabs` | 选项卡 |
| `van-stepper` | 步进器（数量选择） |
| `van-calendar` | 日历 |
| `van-uploader` | 文件上传 |

### 内部组件库：`mall-ui`

通过 git 引入的内部共享 UI 组件，在 `app.json` 全局注册：

```json
{
  "usingComponents": {
    "mall-btn": "mall-ui/Button/index",
    "mall-popup": "mall-ui/Popup/index",
    "mall-cell": "mall-ui/Cell/index",
    "mall-header": "mall-ui/Header/index",
    "mall-icon": "mall-ui/Icon/index",
    "mall-loading": "mall-ui/Loading/index"
  }
}
```

### HTTP 请求：自研 `Http` 类

`constants/request.js` 中的 `Http` 类，特点：

- 多 baseUrl 支持（主网关、神笔、自定义营销接口）
- Session Token 过期自动刷新，并发请求排队等待新 token
- 统一附加 `business`、`token`、`actionFrom`、`appid` 请求头
- Sentry 错误捕获
- 超时 35 秒

### 状态管理：`Minax`

自研的轻量级状态管理库，Vuex 风格 API，最核心的 3 个概念：

| 概念 | 说明 |
|------|------|
| `state` | 全局状态（单例） |
| `commit(type, payload)` | 修改状态（同步） |
| `mapState` | 页面/组件声明订阅的状态字段 |

详见第 7 章。

### 工具库

| 库 | 用途 |
|----|------|
| `dayjs` | 日期处理（代替 moment.js） |
| `big.js` | 精确浮点运算（金额计算） |
| `qs` | Query String 解析 |
| `wx-monitor` | 微信性能监控（听云） |
| `@huolala-tech/page-spy-wechat` | 远程调试工具 |

## 2.3 开发工具链

| 工具 | 用途 |
|------|------|
| 微信开发者工具 | 预览、调试、上传代码 |
| miniprogram-ci | 命令行上传/预览（CI/CD） |
| ESLint + Prettier | 代码规范 |
| Husky + lint-staged | Git 提交前自动格式化 |
| Commitlint | 提交信息规范 |

## 2.4 后端开发者速查对照表

| 后端概念 | 小程序对应 |
|----------|-----------|
| Spring Boot | 微信原生小程序框架 |
| `pom.xml` | `package.json` |
| Controller | `pages/xxx/xxx.js` |
| `@RequestMapping` | `app.json` 中 `pages` 数组 |
| Service | `service/` 目录 |
| Feign Client | `api/` 目录 |
| `application.yml` | `config/{mp}.js` |
| `application-{env}.yml` | `config/{mp}.js` 中 `NetURL.{env}` |
| `static ConcurrentHashMap` | `store/index.js` (Minax) |
| `Result<T>` | `{ code: "0", data: T, msg: "" }` |
| Interceptor | `constants/request.js` (Http.requestAll) |
| `ThreadLocal` | `globalData`（app.js 全局变量） |
| Maven `mvn package` | `node build.js mp=TC` |
| `target/` | 微信开发者工具上传到微信后台 |
