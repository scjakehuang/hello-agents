# 第 8 章：组件体系

## 8.1 组件层级

```
┌──────────────────────────────────────────────┐
│  @vant/weapp v1.4.2 (第三方 UI 组件库)         │
│  van-button / van-popup / van-cell / ...      │
├──────────────────────────────────────────────┤
│  mall-ui (内部共享组件库)                       │
│  mall-btn / mall-popup / mall-cell / ...      │
├──────────────────────────────────────────────┤
│  components/ (项目级公共组件)                   │
│  header / modal / coupon / skeleton / badge   │
├──────────────────────────────────────────────┤
│  pages/Xxx/_components/ (页面级私有组件)        │
│  只在当前模块内使用                              │
└──────────────────────────────────────────────┘
```

## 8.2 Vant Weapp 组件

Vant Weapp 是有赞出品的小程序 UI 组件库，本项目使用 v1.4.2。常用组件：

| 组件 | 用途 | 相当于后端的 |
|------|------|------------|
| `van-cell` / `van-cell-group` | 列表单元格 | 列表接口的一条记录 |
| `van-popup` | 弹出层 | 新增/编辑弹窗 |
| `van-button` | 按钮 | — |
| `van-field` | 输入框 | 请求字段 |
| `van-icon` | 图标 | — |
| `van-dialog` | 对话框 | `Result` 的 msg 展示 |
| `van-tab` / `van-tabs` | 选项卡 | 页面内分类切换 |
| `van-stepper` | 步进器 | 数量选择 |
| `van-calendar` | 日历 | 日期选择 |
| `van-uploader` | 文件上传 | 文件上传 |
| `van-rate` | 评分 | 评价打分 |
| `van-checkbox` / `van-radio` | 选择框 | 筛选条件 |
| `van-swipe` | 轮播 | Banner 轮播 |

### 使用方式

**1. 在页面/组件 json 中注册**

```json
{
  "usingComponents": {
    "van-popup": "@vant/weapp/popup/index",
    "van-button": "@vant/weapp/button/index",
    "van-cell": "@vant/weapp/cell/index",
    "van-cell-group": "@vant/weapp/cell-group/index"
  }
}
```

**2. 在 wxml 中使用**

```xml
<van-cell-group>
    <van-cell title="订单编号" value="{{order.orderNo}}" />
    <van-cell title="订单金额" value="¥{{order.amount}}" />
</van-cell-group>

<van-popup show="{{showPopup}}" bind:close="onClose">
    <view>弹窗内容</view>
</van-popup>
```

**3. 在 js 中响应事件**

```javascript
Page({
    data: { showPopup: false },

    onClose() {
        this.setData({ showPopup: false });
    }
});
```

## 8.3 mall-ui 内部组件

`mall-ui` 是通过 git 引入的内部共享组件库，在 `app.json` 中全局注册（无需每个页面单独注册）：

```json
{
  "usingComponents": {
    "mall-btn": "mall-ui/Button/index",
    "mall-popup": "mall-ui/Popup/index",
    "mall-cell": "mall-ui/Cell/index",
    "mall-header": "mall-ui/Header/index",
    "mall-icon": "mall-ui/Icon/index",
    "mall-loading": "mall-ui/Loading/index",
    "mall-modal": "mall-ui/Modal/index"
  }
}
```

全局注册后，所有页面都可直接使用：

```xml
<mall-header title="订单详情" showBack="{{true}}" />
<mall-loading wx:if="{{loading}}" />
```

## 8.4 项目级公共组件

位于 `components/` 目录，跨页面复用：

| 组件 | 目录 | 用途 |
|------|------|------|
| Header | `components/header/` | 页面导航栏（标题、返回、首页） |
| Modal | `components/modal/` | 模态弹窗（支持绑定手机号） |
| Coupon | `components/coupon/` | 优惠券卡片 |
| Skeleton | `components/skeleton/` | 骨架屏（加载占位） |
| Badge | `components/badge/` | 角标（未读数等） |

### 组件开发模式

以 `header` 为例：

```javascript
// components/header/header.js
Component({
    properties: {
        title: { type: String, value: '' },
        showBack: { type: Boolean, value: false },
        showHome: { type: Boolean, value: false }
    },

    methods: {
        goback() {
            const pages = getCurrentPages();
            pages.length > 1 ? wx.navigateBack() : this.goHome();
        },

        goHome() {
            wx.switchTab({ url: '/pages/home/home' });
        }
    }
});
```

```xml
<!-- components/header/header.wxml -->
<view class="header" style="{{themeStyle}}">
    <view class="header-left" bindtap="goback" wx:if="{{showBack}}">
        <van-icon name="arrow-left" />
    </view>
    <view class="header-title">{{title}}</view>
    <view class="header-right" bindtap="goHome" wx:if="{{showHome}}">
        <van-icon name="wap-home" />
    </view>
</view>
```

### 使用组件

在页面 json 中注册：

```json
{
  "usingComponents": {
    "c-header": "/components/header/header"
  }
}
```

在 wxml 中使用：

```xml
<c-header title="订单详情" showBack="{{true}}" showHome="{{true}}" />
```

## 8.5 Custom TabBar

`custom-tab-bar/` 是特殊的微信原生组件，用于自定义底部导航：

```javascript
// custom-tab-bar/index.js
Component({
    mapState: ["themeStyle", "cartNum", "tabIndex", "navConf"],

    data: {
        list: [
            { pagePath: "/pages/home/home", text: "首页" },
            { pagePath: "/pages/jqUser/jqUser", text: "我的" }
        ]
    },

    methods: {
        switchTab(e) {
            const { path, index } = e.currentTarget.dataset;
            this.$store.commit("tabIndex", index);
            wx.switchTab({ url: path });
        }
    }
});
```

> Custom TabBar 的妙用：不同小程序可以有不同的 TabBar 项（通过 `config/app.{mp}.json` 覆盖），甚至可以从后端配置动态生成（`navConf` 状态）。

## 8.6 页面组装模式

以溪降挑战详情页为例：

```xml
<!-- pages/canyoning/detail/index.wxml -->
<view class="container" style="{{themeStyle}}">
    <c-header title="挑战详情" showBack="{{true}}" />

    <!-- 加载骨架屏 -->
    <skeleton wx:if="{{loading}}" />

    <block wx:else>
        <!-- 活动信息卡片 -->
        <van-cell-group>
            <van-cell title="活动名称" value="{{detail.activityName}}" />
            <van-cell title="剩余时间" value="{{timeParts}}" />
        </van-cell-group>

        <!-- 扫码打卡按钮 -->
        <van-button type="primary" bind:tap="handleScanTap">
            扫码打卡
        </van-button>

        <!-- 排行榜入口 -->
        <van-cell title="排行榜" is-link bind:tap="goLeaderboard" />

        <!-- 弹窗 -->
        <mall-modal
            show="{{showResult}}"
            bind:close="closeResult"
        />
    </block>
</view>
```

```javascript
// pages/canyoning/detail/index.js
Page({
    mapState: ["themeStyle"],

    data: {
        loading: true,
        detail: null,
        timeParts: '',
        showResult: false
    },

    async onLoad(options) {
        this.activityId = options.activityId;
        await this.getChallengeDetail();
    },

    async getChallengeDetail() {
        try {
            const res = await getCurrentCanyoningChallenge({
                activityId: this.activityId
            });
            if (res.code === "0") {
                this.setData({
                    detail: normalizeChallengeDetail(res.data),
                    timeParts: formatDuration(res.data.remainingTime),
                    loading: false
                });
            }
        } catch (err) {
            wx.showToast({ title: "加载失败", icon: "none" });
        }
    },

    async handleScanTap() {
        // 1. 检查相机权限
        // 2. 调起扫码
        // 3. 调用打卡接口
        // 4. 弹窗展示结果
    },

    goLeaderboard() {
        wx.navigateTo({
            url: `/pages/canyoning/leaderboard/index?activityId=${this.activityId}`
        });
    }
});
```
