# 第 9 章：构建与部署

## 9.1 构建命令速查

```bash
# 在项目根目录

# 构建 TC 小程序（QA 环境，默认）
node build.js mp=TC

# 构建 TC 小程序生产环境
node build.js mp=TC prod=1

# 构建其他小程序
node build.js mp=TC2
node build.js mp=TC3
node build.js mp=YY

# Stage 环境（如果配置了）
node build.js mp=TC prod=stage
```

## 9.2 构建产物

`build.js` 生成两个文件：

| 产物 | 说明 |
|------|------|
| `app.json` | 合并后的分包/页面/TabBar 配置 |
| `config/index.js` | 导出环境变量（后端地址、AppID、主题色等） |

这两个文件**不提交 git**，在 `.gitignore` 中排除。

## 9.3 build.js 工作流程

```
┌─────────────────────────────────────────────────┐
│ 1. 解析命令行参数                                 │
│    mp=TC, prod=1, op=BUILD                      │
├─────────────────────────────────────────────────┤
│ 2. formatAppJSON()                              │
│    config/app.base.json                          │
│    + config/app.tc.json   → 合并 → app.json      │
├─────────────────────────────────────────────────┤
│ 3. formatCodeStr()                              │
│    config/tc.js                                  │
│    → NetURL[Env] 提取 → config/index.js           │
├─────────────────────────────────────────────────┤
│ 4. (可选) CI 上传                                │
│    op=PUSH  → miniprogram-ci 上传到微信后台       │
│    op=PREVIEW → miniprogram-ci 生成预览码         │
└─────────────────────────────────────────────────┘
```

## 9.4 多环境配置体系

```
config/
├── app.base.json            ← 公共页面/分包（所有小程序共享）
├── app.tc.json              ← TC 差异化（覆盖/追加 base）
├── app.tc2.json             ← TC2 差异化
│
├── tc.js                    ← TC 环境变量
│   └── NetURL: { Test, Stage, Prod }
├── tc2.js                   ← TC2 环境变量
│
└── index.js (build 生成)    ← 运行时读取。不提交 git
```

环境变量示例（`config/tc.js`）：

```javascript
export default {
    webJSON: {
        name: "呀诺达雨林",              // 小程序名称
        mp: "TC",                        // 简称
        appId: "wx1c34a90cf27decb6",     // 正式 AppID
        NetURL: {
            Test: {
                serverURL: "http://arsenalgw.qa.ly.com/jq-customer/1",
                serverURLGateWay: "http://arsenalgw.qa.ly.com/jq-gw/1/shop-gw",
                business: "600025",
                defaultMainColor: "#01A862",
                token: "...",
                traceSource: "..."
            },
            Stage: {
                serverURL: "https://arsenalgw.elong.com/jq-customer",
                // ...
            },
            Prod: {
                serverURL: "https://arsenalgw.elong.com/jq-customer",
                // ...
            }
        },
        msgTemplate: {
            // 微信订阅消息模板 ID（不同小程序不同）
            EXPRESS: "WLVTusb4e_oKGq7swBqtPI9r13o-...",
        }
    },
    featureJSON: {
        switchShop: true,        // 是否显示切换店铺
        giftCard: true,          // 是否显示礼包功能
        btnOpenStore: true,      // 是否显示开店入口
        subscribeMsg: true       // 是否开启订阅消息
    }
};
```

## 9.5 CI/CD 上传

```bash
# 上传代码到微信后台（QA 版本）
node build.js mp=TC op=PUSH

# 上传生产版本
node build.js mp=TC op=PUSH prod=1

# 生成预览二维码
node build.js mp=TC op=PREVIEW
```

上传依赖 `miniprogram-ci`（微信官方 CI 工具），密钥文件放在 `key/` 目录。

## 9.6 微信开发者工具上传（手动）

除了命令行，也可以在微信开发者工具中手动上传：

1. 执行 `node build.js mp=TC prod=1` 生成生产配置
2. 在微信开发者工具中点击"上传"
3. 填写版本号和项目备注
4. 上传后到 [mp.weixin.qq.com](https://mp.weixin.qq.com) 提交审核

## 9.7 后端开发者注意事项

### 构建产物不是静态文件

微信小程序的"构建"分为两步：
1. **项目 build**（`node build.js`）→ 生成配置
2. **微信上传**（miniprogram-ci 或开发者工具）→ 上传到微信后台，微信云端编译

最终用户看到的是微信云端编译后的产物，不是本地的 `miniprogram_npm/`。

### 改了配置必须重新 build

和 scenic-ticket 的 `config/define/*.ts` 一样，`config/{mp}.js` 中的变量是在构建时合并的，改了必须重新 `node build.js`。

### 小程序版本管理

微信小程序有版本生命周期：

```
开发版 → 体验版 → 审核中 → 审核通过 → 线上版
```

- 开发者工具"预览" → 开发版（仅开发者可看）
- 开发者工具"上传" → 体验版（需在后台设为体验版，体验者扫码可看）
- 后台提交审核 → 审核中 → 通过后发布 → 线上版（所有用户可看）

### 如何确定部署了哪个版本

- 看 `config/index.js` 中的 `serverURL` 指向哪个环境
- 在微信开发者工具 Network 面板看实际请求 URL
- 看小程序的版本号（在开发者工具上传时填写，后台可见）
