# 第 1 章：项目概览

## 1.1 这是什么项目

`scenic-ticket` 是景区票务系统的 **PC 端前端大仓（Monorepo）**，包含两个核心应用：

| 应用 | 定位 | 用户 |
|------|------|------|
| **ticket-pc** | 票务系统管理后台 | 景区运营、商户管理、财务 |
| **ticket-window** | 窗口售票系统 | 景区窗口售票员、收银员 |

两个应用共享同一套技术栈，通过 Monorepo 管理，共用部分组件和配置。

## 1.2 与后端服务的关系

```
浏览器（ticket-pc / ticket-window）
        │
        ▼
┌──────────────────────────────────────┐
│  arsenal-componented-gateway-jq      │  ← 统一网关
│  arsenalgw.qa.ly.com/jq-gw/0/shop-gw│
└──────────────────────────────────────┘
        │
        ├──→ arsenal-service-jq (saas-merchant-jq)   ← PC 端业务
        ├──→ arsenal-service-product-jq              ← 商品/价格/库存
        ├──→ arsenal-service-order-customer-jq       ← 订单/票务
        ├──→ arsenal-jq-acl                          ← 权限/菜单
        └──→ arsenal-jq-user                         ← 用户/登录
```

前端不直连后端服务，统一走网关 `jq-gw` 或 `jq-merchant` 路由。

## 1.3 Monorepo 子应用一览

| 子应用 | 框架 | 端口 | 说明 |
|--------|------|------|------|
| `ticket-pc` | Umi 4 + antd 5 | 8001 | 后台管理系统（主应用） |
| `ticket-window` | Umi 4 + antd 5 | 8002 | 窗口售票系统 |
| `micro-base` | Umi 4 + antd 5 | 8001 | 微前端基座（旧，基本不用） |
| `static-server` | NestJS | 8080 | 静态资源服务器 |
| `sub1` | Vue 2 | 8002 | 旧 Vue 子应用（基本不维护） |

**日常开发只关注 `ticket-pc` 和 `ticket-window`。**

## 1.4 代码规模

| 应用 | TypeScript/TSX 文件数 | 页面模块数 |
|------|----------------------|-----------|
| ticket-pc | ~803 | 15 个业务模块 |
| ticket-window | ~364 | 14 个业务模块 |

## 1.5 关键认知

作为后端开发者，你需要知道：

- 前端的**页面 = 后端的 Controller 接口**（一对多：一个页面可能调多个接口）
- 前端的 **services/ = 后端的 Service 调用层**（封装 HTTP 请求）
- 前端的 **models/ = 后端的全局状态**（类似 Java 里的 static Map）
- 路由配置在 `config/config.routes.tsx`，相当于后端的 `@RequestMapping`
- 菜单权限通过 `pathkey` 字段关联 ACL 系统的菜单资源
