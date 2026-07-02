# 第 4 章：开发环境搭建

## 4.1 前置条件

| 工具 | 版本要求 | 安装方式 |
|------|---------|---------|
| 微信开发者工具 | 最新稳定版 | [官网下载](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html) |
| Node.js | 任意版本 | `brew install node` 或 nvm |

> 微信开发者工具是**必须**的，没有替代品——只能在官方 IDE 里预览、调试、上传小程序。

## 4.2 下载项目

```bash
git clone <仓库地址> /Users/tcuser/Documents/ideaproject/scenic-wxapp
cd /Users/tcuser/Documents/ideaproject/scenic-wxapp
```

## 4.3 安装依赖

```bash
npm install
```

> 依赖很少（`@vant/weapp`、`dayjs`、`big.js` 等），安装很快。
>
> npm install 后会触发 `postinstall` 脚本，把 `mall-ui` 组件从 `node_modules` 复制到 `miniprogram_npm/mall-ui/`。

## 4.4 构建 npm 包

微信小程序使用 npm 包需要先"构建 npm"：

1. 打开微信开发者工具
2. 导入项目（选择 `scenic-wxapp` 目录）
3. 菜单：**工具 → 构建 npm**
4. 构建产物在 `miniprogram_npm/` 目录

## 4.5 构建指定小程序

```bash
# 构建 TC 小程序（QA 环境，默认）
node build.js mp=TC

# 构建 TC 小程序生产环境
node build.js mp=TC prod=1

# 构建其他小程序
node build.js mp=TC2
node build.js mp=TC3
node build.js mp=YY
```

`build.js` 做两件事：
1. **合并 `app.json`**：读取 `config/app.base.json` + `config/app.{mp}.json`，合并分包/TabBar，写入 `app.json`
2. **生成 `config/index.js`**：读取 `config/{mp}.js` 的环境配置，写入 `config/index.js`

构建完成后，在微信开发者工具中就能看到正确的页面和配置。

## 4.6 环境切换

环境通过 `prod` 参数控制：

| 命令 | 环境 |
|------|------|
| `node build.js mp=TC` | QA 测试环境（默认） |
| `node build.js mp=TC prod=1` | 生产环境 |
| `node build.js mp=TC prod=stage` | Stage 预发布（如果有） |

环境配置在 `config/{mp}.js` 的 `NetURL` 中定义：

```javascript
// config/tc.js
NetURL: {
    Test: {
        serverURL: "http://arsenalgw.qa.ly.com/jq-customer/1",
        serverURLGateWay: "http://arsenalgw.qa.ly.com/jq-gw/1/shop-gw",
        business: "600025",
        defaultMainColor: "#01A862"
    },
    Stage: { ... },
    Prod: { ... }
}
```

## 4.7 在微信开发者工具中预览

1. 打开微信开发者工具
2. 扫码登录
3. 导入项目目录 `scenic-wxapp`
4. 设置 AppID 为 `wx6f0ebd124611fced`（开发版 AppID）
5. 点击"预览"生成二维码，手机微信扫码即可真机预览

> 开发版 AppID（`wx6f0ebd124611fced`）是公共测试号，需要在微信后台添加开发者权限后才能扫码预览。

## 4.8 后端开发者常见问题

### Q: 改了代码没生效？

A: 微信开发者工具默认有热重载。如果不生效，点击"编译"按钮手动刷新。

### Q: 小程序白屏/报错？

A: 打开微信开发者工具的"调试器"（Console 面板），看报错信息。常见原因：
- 没执行 `node build.js mp=TC`（`app.json` 还是旧的）
- 没执行"构建 npm"（`@vant/weapp` 组件找不到）
- `config/index.js` 未生成（`build.js` 没跑完）

### Q: 如何连 QA 不同子环境？

A: 修改 `config/{mp}.js` 中 `NetURL.Test.serverURL`，把 `/jq-customer/1` 改成 `/jq-customer/2`（对应 qa1/qa2 等子环境），然后重新 `node build.js mp=TC`。

### Q: 怎么看我当前连的后端地址？

A: 看 `config/index.js`（build.js 生成），里面有 `NetURL.Test.serverURL`。也可以在微信开发者工具 Network 面板看实际请求 URL。
