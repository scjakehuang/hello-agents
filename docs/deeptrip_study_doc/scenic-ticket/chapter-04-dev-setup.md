# 第 4 章：开发环境搭建

## 4.1 前置条件

| 工具 | 版本要求 | 安装命令 |
|------|---------|---------|
| Node.js | >= 18 | `brew install node@18` |
| pnpm | 8.15.x | `npm install -g pnpm@8.15.5` |

检查版本：
```bash
node -v   # >= v18.0.0
pnpm -v   # 8.15.x
```

## 4.2 安装依赖

```bash
cd /Users/tcuser/Documents/ideaproject/scenic-ticket
pnpm install
```

> 这是一个 Monorepo，`pnpm install` 会同时安装 `apps/*` 和 `packages/*` 的所有依赖。

## 4.3 启动开发

### 票务后台（ticket-pc）

```bash
cd apps/ticket-pc
pnpm start
# → 访问 http://localhost:8001
```

### 窗口售票（ticket-window）

```bash
cd apps/ticket-window
pnpm start
# → 访问 http://localhost:8002
```

### 同时启动所有应用（PM2 方式）

```bash
# 回到项目根目录
cd /Users/tcuser/Documents/ideaproject/scenic-ticket

# 开发环境
pm2 start config/ecosystem.dev.config.js

# QA 环境
pm2 start config/ecosystem.qa.config.js

# 查看日志
pm2 logs
```

## 4.4 环境切换

项目有 4 套环境配置：

| 环境 | APP_ENV | 说明 |
|------|---------|------|
| 开发 | development | 本地开发 |
| QA | qa | 测试环境 |
| Stage | stage | 预发布 |
| 生产 | product | 正式环境 |

环境变量通过 `config/define/` 目录下的文件管理：

```
config/define/
├── config.define.development.ts   ← 本地开发环境变量
├── config.define.qa.ts           ← QA 环境变量
├── config.define.stage.ts        ← Stage 环境变量
└── config.define.product.ts      ← 生产环境变量
```

每个文件内容示例（QA 环境）：
```typescript
export default {
  APP_BASE_SERVICE_URL: 'http://saas-merchant-jq1.qa.17usoft.com',
  APP_GW_SERVICE_URL: 'http://arsenalgw.qa.ly.com/jq-gw/1/shop-gw',
  APP_PRODUCT_SERVICE_URL: 'http://arsenalgw.qa.ly.com/jq-gw/1/shop-gw/productb',
  APP_USER_SERVICE_URL: 'http://arsenalgw.qa.ly.com/jq-gw/1/shop-gw/user',
  APP_BUSINESS_ID: '600000',
  // ...
};
```

### 切换 QA 子环境

针对 QA 有多套子环境（qa0 ~ qa7），可以在根目录运行：

```bash
node ticketEnv.cjs qa_1   # 切换到 qa1
node ticketEnv.cjs qa_2   # 切换到 qa2
```

这个脚本会把对应子环境的 URL 写入 `config.define.development.ts` 和 `config.define.qa.ts`。

### 私有部署

```bash
# 本地开发
pnpm start:private          # 使用 APP_DEPLOY_TYPE=private

# 构建
pnpm build-qa:private       # qa 私有部署构建
pnpm build-stage:private    # stage 私有部署构建
pnpm build-product:private  # 生产私有部署构建
```

## 4.5 构建

```bash
# 在应用目录下
cd apps/ticket-pc

# 构建 QA 环境
pnpm build-qa

# 构建 Stage 环境
pnpm build-stage

# 构建生产环境
pnpm build-product
```

构建产物在 `apps/ticket-pc/dist/`。

## 4.6 IntelliJ IDEA 配置

如果你用 IntelliJ IDEA 打开项目：

1. 确保安装了 "JavaScript and TypeScript" 插件（Ultimate 自带）
2. 设置 TypeScript 版本为项目内置版本：`Preferences → Languages → TypeScript → TypeScript: 选择 node_modules/typescript/lib`
3. 设置 ESLint：`Preferences → Languages → ESLint → Automatic ESLint configuration`
4. 确认 Prettier 为格式化工具：`Preferences → Prettier → 开启 "Run on save"`

## 4.7 后端开发者常见问题

### Q: 改了代码没生效？

A: Umi 4 有 Fast Refresh（快速刷新），改了 src 下的文件应该自动热更新。如果不生效，试试 `Ctrl+C` 停止再 `pnpm start`。

### Q: 如何连本地后端？

A: 修改 `config/define/config.define.development.ts`，把 `APP_BASE_SERVICE_URL` 改成 `http://localhost:8080`。或者用 Whistle/Charles 代理。

### Q: pnpm install 报错？

A: 检查 Node.js 版本 >= 18，pnpm 版本 8.15.x。清缓存 `pnpm store prune`，删 `node_modules` 重新装。
