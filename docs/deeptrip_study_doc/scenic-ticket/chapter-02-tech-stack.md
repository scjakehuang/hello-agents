# 第 2 章：核心技术栈

## 2.1 技术栈全景图

```
┌─────────────────────────────────────────────────┐
│                    构建层                         │
│  pnpm (包管理) + TurboRepo (任务编排)             │
│  + Umi 4 (应用框架) + SWC (编译)                  │
├─────────────────────────────────────────────────┤
│                    框架层                         │
│  React 18 + TypeScript + Umi 4 (@umijs/max)     │
├─────────────────────────────────────────────────┤
│                    UI 层                          │
│  antd 5 + @ant-design/pro-components            │
│  + Less Modules + Tailwind CSS                  │
├─────────────────────────────────────────────────┤
│                   数据层                          │
│  umi-request (HTTP) + ahooks (数据获取 hooks)     │
│  + Dva (全局状态) + React Context (跨组件共享)    │
├─────────────────────────────────────────────────┤
│                   工具层                          │
│  dayjs (日期) + lodash (工具) + exceljs (导出)    │
│  + react-dnd (拖拽) + quill (富文本)             │
└─────────────────────────────────────────────────┘
```

## 2.2 核心依赖详解

### 框架：`@umijs/max` v4

Umi 4 是蚂蚁金服出品的 React 应用框架，类似 Java 生态的 Spring Boot——约定大于配置，开箱即用。

| 能力 | 对应 Java 概念 |
|------|--------------|
| 路由（约定式/配置式） | `@RequestMapping` |
| Mock 数据 | MockMvc / WireMock |
| Dva 状态管理 | static ConcurrentHashMap |
| 代理（proxy） | Nginx reverse proxy |
| 构建（max build） | Maven package |

### UI 组件库

| 包 | 用途 | 类比 |
|----|------|------|
| `antd` v5 | 基础组件（Button、Table、Form 等） | Element UI |
| `@ant-design/pro-components` | 高级组件（ProTable、ProForm、ProLayout） | 若依框架的通用组件 |
| `@ant-design/icons` | 图标库 | — |
| `@ant-design/cssinjs` | CSS-in-JS 方案 | — |

### HTTP 请求：`umi-request`

不是 axios！umi-request 是 Umi 内置的请求库，API 类似 fetch。

- 统一拦截器：在 `src/utils/request.ts` 中配置
- 自动附加 `userToken`、`business`、`actionFrom` 等请求头
- Session 过期自动跳登录页

### Hooks 工具库：`ahooks`

阿里巴巴出品的 React Hooks 库，最常用的：

| Hook | 用途 |
|------|------|
| `useRequest` | 自动管理 loading/data/error 状态 |
| `useAntdTable` | 与 antd Table 集成的分页查询 |
| `useDebounce` | 防抖 |
| `useUpdateEffect` | 跳过首次渲染的 useEffect |

### 状态管理：Dva

基于 Redux 的封装，但项目里**重度偏向 hooks**，Dva 只用于全局状态（用户信息、权限配置）。详见第 7 章。

## 2.3 开发工具链

| 工具 | 用途 |
|------|------|
| pnpm 8.15+ | 包管理（强制，不允许 npm/yarn） |
| TurboRepo v2 | Monorepo 任务编排（`turbo start`/`turbo build`） |
| ESLint 8 + Prettier 3 | 代码规范 |
| Husky + lint-staged | Git 提交前自动格式化 |
| Commitlint | 提交信息规范（conventional commits） |
| Changesets | 版本管理 |
| PM2 | 生产环境进程管理 |
| Sentry | 错误监控 |

## 2.4 Node.js 版本要求

- **Node.js >= 18**
- **包管理器：pnpm@8.15.5**

## 2.5 后端开发者速查对照表

| 后端概念 | 前端对应 |
|----------|---------|
| Spring Boot | @umijs/max (Umi 4) |
| pom.xml | package.json |
| Maven reactor | Turborepo |
| Controller | `src/pages/` + 路由配置 |
| Service | `src/services/` |
| MyBatis Mapper | `src/services/` 中的 API 函数 |
| application.yml | `config/config.ts` + `config/config.define.*.ts` |
| application-{env}.yml | `config/define/config.define.{env}.ts` |
| static Map | `src/models/` (Dva) |
| Spring Security ACL | `src/access.ts` |
