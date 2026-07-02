# 第 5 章：路由与页面

## 5.1 路由体系

微信小程序**没有 URL 路由**的概念，取而代之的是**页面栈 + 分包配置**。

页面注册在 `app.json` 中（由 `build.js` 从 `config/app.base.json` + `config/app.{mp}.json` 合并生成）：

```json
{
  "pages": [
    "pages/index/index",
    "pages/home/home",
    "pages/jqUser/jqUser"
  ],
  "subpackages": [
    { "root": "pages/detail/", "name": "detail", "pages": ["index"] },
    { "root": "pages/order/", "name": "order", "pages": ["list/index", "detail/index"] },
    { "root": "pages/canyoning/", "name": "canyoning", "pages": [
      "index", "detail/index", "scanCheckin/index", "leaderboard/index"
    ]}
  ]
}
```

### 主包 vs 分包

| | 主包 | 分包 |
|------|------|------|
| 加载时机 | 小程序启动时 | 用户首次访问时按需下载 |
| 大小限制 | ≤ 2MB | 每个分包 ≤ 2MB，总 ≤ 20MB |
| 包含内容 | TabBar 页面 + 公共组件 | 业务功能页面 |
| 配置位置 | `pages` 数组 | `subpackages` 数组 |

## 5.2 页面栈与导航

微信小程序有**页面栈**的概念（最多 10 层），导航方式由页面栈深度决定：

```javascript
// utils/router.js 核心逻辑
function navigateTo(path) {
    if (checkIsTabBar(path)) {
        return wx.switchTab({ url: path });       // TabBar 页用 switchTab
    }
    return getCurrentPages().length >= 10
        ? wx.redirectTo({ url: path })             // 栈满了用 redirectTo（替换当前页）
        : wx.navigateTo({ url: path });            // 正常跳转（压栈）
}
```

四种导航方法：

| 方法 | 说明 | 页面栈变化 | 使用场景 |
|------|------|-----------|---------|
| `wx.navigateTo` | 跳转到新页面 | 入栈 +1 | 列表 → 详情 |
| `wx.redirectTo` | 替换当前页面 | 栈不变 | 登录后跳主页（不让返回登录页） |
| `wx.switchTab` | 切换到 TabBar 页 | 清栈 + 打开 Tab | Tab 切换 |
| `wx.navigateBack` | 返回上一页 | 出栈 -1 | 返回按钮 |

> 推荐统一使用 `utils/router.js` 的 `navigateTo` 方法，它会自动判断跳 Tab 还是普通页面。

## 5.3 TabBar 配置

项目使用**自定义 TabBar**（`custom-tab-bar/` 目录），TabBar 配置在 `app.json`：

```json
{
  "tabBar": {
    "custom": true,
    "list": [
      { "pagePath": "pages/home/home", "text": "首页" },
      { "pagePath": "pages/mustDoList/index", "text": "项目" },
      { "pagePath": "pages/mapWelcome/index", "text": "地图" },
      { "pagePath": "pages/jqUser/jqUser", "text": "我的" }
    ]
  }
}
```

`custom: true` 表示使用自定义渲染（不走微信原生 TabBar），`custom-tab-bar/index.js` 负责实际的 TabBar 渲染和 Tab 切换逻辑。各小程序的 TabBar 项可能不同，通过 `config/app.{mp}.json` 覆盖。

## 5.4 页面生命周期

每个小程序页面有一套完整的生命周期：

```javascript
// pages/xxx/xxx.js
Page({
    // 页面加载（只执行一次，类似 componentDidMount）
    async onLoad(options) {
        // options 包含 URL 参数
        const { shopId, productId } = options;
        await this.initData();
    },

    // 页面显示（每次切换回该页面都会执行）
    onShow() {
        // 刷新数据、更新 TabBar 状态
    },

    // 页面隐藏（切换到其他页面时）
    onHide() {
        // 停止定时器、清理临时状态
    },

    // 页面卸载（redirectTo/navigateBack 时）
    onUnload() {
        // 清理资源
    },

    // 下拉刷新
    async onPullDownRefresh() {
        await this.refreshData();
        wx.stopPullDownRefresh();
    },

    // 上拉加载更多
    onReachBottom() {
        this.loadMore();
    },

    // 分享
    onShareAppMessage() {
        return {
            title: '分享标题',
            path: '/pages/index/index?fromShopId=xxx'
        };
    }
});
```

### 与 React 生命周期对比

| 微信小程序 | React 类组件 | 说明 |
|-----------|-------------|------|
| `onLoad` | `componentDidMount` | 页面首次加载 |
| `onShow` | `componentDidUpdate` + visibility change | 页面可见时 |
| `onHide` | 无直接对应 | 页面不可见时 |
| `onUnload` | `componentWillUnmount` | 页面销毁 |
| `onPullDownRefresh` | 无直接对应 | 下拉刷新 |

## 5.5 页面间参数传递

### 方式一：URL Query String

```javascript
// 跳转
wx.navigateTo({
    url: '/pages/detail/index?productId=123&shopId=456'
});

// 接收（在 onLoad 中）
onLoad(options) {
    const productId = options.productId;  // "123"
    const shopId = options.shopId;        // "456"
}
```

> URL 参数长度有限制，大数据用全局变量或缓存。

### 方式二：全局变量

```javascript
// 设置
const app = getApp();
app.globalData.currentProduct = { id: 123, name: 'xxx' };

// 读取
const app = getApp();
const product = app.globalData.currentProduct;
```

### 方式三：Event Bus

```javascript
import Events from '@/utils/event';

// 发布
app.events.emit('cartUpdated', { cartNum: 5 });

// 订阅
app.events.on('cartUpdated', ({ cartNum }) => {
    this.setData({ cartNum });
});
```

## 5.6 WXS — 模板层脚本

`.wxs` 文件是微信小程序的模板层脚本（类似但**不等于** JavaScript），在 WXML 渲染时直接执行，**不经过 JS 线程**，性能更好。

```xml
<!-- 引入 WXS -->
<wxs module="utils" src="./utils.wxs" />

<!-- 使用 WXS 函数格式化数据 -->
<view>{{utils.formatPrice(price)}}</view>
```

WXS 主要用于**数据格式化**（价格、日期等），避免在 `setData` 前手动格式化。
