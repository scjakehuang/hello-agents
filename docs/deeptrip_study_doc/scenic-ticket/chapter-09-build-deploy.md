# 第 9 章：构建与部署

## 9.1 构建命令速查

```bash
# 在项目根目录

# 所有应用 QA 构建
pnpm build-qa

# 所有应用 Stage 构建
pnpm build-stage

# 所有应用生产构建
pnpm build-product

# 私有部署版本（带 :private 后缀）
pnpm build-qa:private
pnpm build-product:private

# 单个应用构建（进入 app 目录）
cd apps/ticket-pc
pnpm build-qa
```

构建产物：`apps/<app>/dist/`。

## 9.2 多环境配置体系

```
config/define/
├── config.define.development.ts      ← 开发（本地）
├── config.define.qa.ts              ← QA
├── config.define.stage.ts           ← Stage
├── config.define.product.ts         ← 生产
├── config.define.private.development.ts  ← 私有部署开发
├── config.define.private.qa.ts
├── config.define.private.stage.ts
└── config.define.private.product.ts
```

使用 `APP_ENV` 环境变量决定用哪套配置：
```bash
APP_ENV=qa max build     → 用 config.define.qa.ts
APP_ENV=product max build → 用 config.define.product.ts
```

## 9.3 Umi 构建配置（`config/config.ts`）

关键配置项：

| 配置 | 值 | 说明 |
|------|-----|------|
| `hash` | `true` | 文件名带 hash（缓存策略） |
| `publicPath` | `./`（生产）或 `/`（开发） | 静态资源路径 |
| `history.type` | `hash` | URL 模式（`#/path`） |
| `fastRefresh` | `true` | 开发热更新 |
| `mfsu` | `false` | 预编译缓存（已关闭，出问题时可开） |
| `esbuildMinifyIIFE` | `true` | 用 esbuild 压缩 |
| `dva` | `{}` | 启用 Dva 状态管理 |
| `mock.include` | `['src/pages/**/_mock.ts']` | Mock 文件位置 |

## 9.4 PM2 生产部署

项目根目录 `config/` 下有 4 套 PM2 配置：

```
config/
├── ecosystem.dev.config.js
├── ecosystem.qa.config.js
├── ecosystem.stage.config.js
└── ecosystem.product.config.js
```

PM2 负责：
1. 启动 `static-server`（NestJS，端口 8080）
2. 启动 `ticket-pc`（静态文件服务）
3. 启动 `ticket-window`（静态文件服务）

```bash
# 生产环境启动
pm2 start config/ecosystem.product.config.js

# 查看状态
pm2 status

# 查看日志
pm2 logs
```

## 9.5 Docker 部署

`docker/Dockerfile.base` 是基础镜像。Umi 构建产物是纯静态文件（`dist/`），Nginx 直接 serve。

## 9.6 Turbrepo 任务编排

`turbo.json` 定义了构建任务的依赖：

```json
{
  "tasks": {
    "build-qa": {
      "dependsOn": ["^build-qa"],    // 先构建依赖包
      "outputs": ["dist/**"]         // 缓存 dist 目录
    }
  }
}
```

## 9.7 后端开发者注意事项

### 构建产物是什么

`dist/` 是一堆 `.html` + `.js` + `.css` + 静态资源——就是可直接用 Nginx serve 的纯静态文件。

### 如何确定部署了哪个版本

1. 看构建日志里的 commit hash
2. 看 `dist/index.html` 里的 JS 文件名 hash

### 环境变量编译时注入

`define` 中的变量在**编译时**注入到代码，运行时不再读取环境变量。所以：
- 改了 `config.define.qa.ts` 必须重新 build
- 不像 Java 可以改 `application.yml` 重启生效
