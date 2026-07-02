# 第 3 章：项目结构详解

## 3.1 顶层目录

```
scenic-ticket/
├── apps/                  ← 子应用（每个是一个独立可部署单元）
│   ├── ticket-pc/         ← 票务后台（主应用）
│   ├── ticket-window/     ← 窗口售票
│   ├── micro-base/        ← 微前端基座（旧）
│   ├── static-server/     ← 静态资源服务器 (NestJS)
│   └── sub1/              ← 旧 Vue 子应用
├── packages/
│   └── okapiUI/           ← 共享 UI 组件库
├── config/                ← PM2 多环境启动配置
├── docker/                ← Dockerfile
├── scripts/               ← 辅助脚本
├── docs/                  ← 项目文档
├── pnpm-workspace.yaml    ← pnpm workspace 配置
├── turbo.json             ← Turborepo 任务编排
└── package.json           ← 根 package.json（全局脚本）
```

## 3.2 ticket-pc 内部结构

```
apps/ticket-pc/
├── config/                        ← Umi 配置（相当于 application.yml）
│   ├── config.ts                  ←   主配置（框架、插件、构建）
│   ├── config.routes.tsx          ←   路由配置（重要！相当于 Controller 映射）
│   ├── config.proxy.ts            ←   开发代理配置
│   ├── config.define.ts           ←   环境变量选择器
│   └── define/                    ←   各环境变量定义
│       ├── config.define.development.ts
│       ├── config.define.qa.ts
│       ├── config.define.stage.ts
│       └── config.define.product.ts
├── src/
│   ├── app.tsx                    ← 应用入口（Sentry、KeepAlive、渲染前钩子）
│   ├── access.ts                  ← 权限定义（前端权限控制）
│   ├── global.less                ← 全局样式
│   ├── type.d.ts                  ← 全局类型声明
│   │
│   ├── pages/                     ← 页面（业务模块，最重要！）
│   │   ├── Home/                  ←   首页
│   │   ├── login/                 ←   登录
│   │   ├── basicInfo/             ←   基础信息（景区、设备、打印）
│   │   ├── staff/                 ←   员工管理
│   │   ├── ticketsCenter/         ←   票务中心（票型、价格、渠道）
│   │   ├── orderCenter/           ←   订单中心
│   │   ├── aftersaleCenter/       ←   售后中心
│   │   ├── memberCenter/          ←   会员中心
│   │   ├── team/                  ←   团队管理（旅行社、导游）
│   │   ├── guide/                 ←   内导管理
│   │   ├── distribution/          ←   分销管理
│   │   ├── smsManage/             ←   短信管理
│   │   ├── reportCenter/          ←   报表中心
│   │   ├── dataCenter/            ←   数据中心
│   │   └── pageComponents/        ←   页面级通用组件
│   │
│   ├── services/                  ← API 请求层（每个文件 = 一组后端接口调用）
│   │   ├── common.ts              ←   通用接口
│   │   ├── auth/                  ←   认证
│   │   ├── scenic/                ←   景区
│   │   ├── ticketsCenter/         ←   票务
│   │   ├── orderCenter/           ←   订单
│   │   ├── team/                  ←   团队
│   │   ...（与 pages 一一对应）
│   │
│   ├── components/                ← 公共组件（跨页面复用）
│   │   ├── table/                 ←   表格相关
│   │   ├── form/                  ←   表单相关
│   │   ├── upload/                ←   上传
│   │   ├── filter/                ←   筛选器
│   │   └── ...
│   │
│   ├── models/                    ← Dva 全局状态
│   │   ├── global.ts              ←   全局信息（应用名、路径配置）
│   │   └── access.ts              ←   权限模型
│   │
│   ├── hooks/                     ← 自定义 Hooks（可复用的逻辑）
│   │   ├── common/                ←   通用 hooks（布局尺寸等）
│   │   └── scenic/                ←   景区相关 hooks
│   │
│   ├── utils/                     ← 工具函数
│   │   ├── request.ts             ←   HTTP 请求封装（核心文件！）
│   │   ├── storage.ts             ←   本地存储
│   │   ├── safeMath.ts            ←   安全运算（浮点数）
│   │   ├── excel.ts               ←   Excel 导出
│   │   ├── download.ts            ←   文件下载
│   │   ├── date.ts                ←   日期工具
│   │   └── sentry.ts              ←   错误监控初始化
│   │
│   ├── constants/                 ← 常量定义
│   ├── layout/                    ← 布局组件
│   │   ├── BasicLayout.tsx        ←   主布局（侧边栏 + 顶栏 + 内容区）
│   │   └── components/            ←   布局子组件（AppLayout、Authorized等）
│   │
│   ├── assets/                    ← 静态资源
│   ├── styles/                    ← 全局样式
│   └── types/                     ← TypeScript 类型定义
│       └── index.d.ts
└── package.json
```

## 3.3 ticket-window 内部结构

与 ticket-pc **完全一致的结构**，只是业务内容不同：

```
apps/ticket-window/
├── config/           ← 同上
└── src/
    ├── pages/        ← 窗口售票特有页面
    │   ├── ticketSale/      ← 售票
    │   ├── ticketPick/      ← 取票
    │   ├── ticketQuery/     ← 查票
    │   ├── ticketRefund/    ← 退票
    │   ├── ticketConfirm/   ← 确认单
    │   ├── innerGuiding/    ← 内导
    │   ├── statistics/      ← 统计
    │   └── order/           ← 订单
    └── ...            ← 其他结构相同
```

## 3.4 关键文件速查

| 你想... | 看这个文件 |
|---------|----------|
| 找一个页面 | `config/config.routes.tsx` → 找对应的 `component` 路径 |
| 找一个接口调用 | `src/services/<模块>/` 下对应的 `.ts` 文件 |
| 改环境变量/后端地址 | `config/define/config.define.{env}.ts` |
| 看请求头怎么加的 | `src/utils/request.ts` 的 request interceptor |
| 看权限怎么控制 | `src/access.ts` + 路由的 `pathkey` |
| 看布局怎么渲染 | `src/layout/BasicLayout.tsx` |

## 3.5 命名规范

| 类型 | 规则 | 示例 |
|------|------|------|
| 组件文件 | PascalCase | `ScenicManage.tsx` |
| 工具文件 | camelCase | `safeMath.ts` |
| 页面目录 | camelCase 或 短横线 | `basicInfo/`, `ticket-group/` |
| 路由路径 | **全小写 + 短横线**（重要！keep-alive tabs 限制） | `/ticket/ticket-group` ✅ `/ticket/ticketGroup` ❌ |
| 导入路径 | 绝对路径 `@/*` | `import { xxx } from '@/services/scenic'` |

> 为什么路由必须全小写？项目使用了 `@alita/plugins` 的 keep-alive tabs，插件会对路由做 `toLowerCase` 处理。驼峰路由会导致 tab 定位失败。比如 `/ticket/testCase` 会被变成 `/ticket/testcase`。
