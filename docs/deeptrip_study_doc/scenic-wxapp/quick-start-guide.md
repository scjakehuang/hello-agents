# 微信小程序零基础快速上手指南

> 写给后端开发者的最简入门。只要会一门编程语言，看完就能上手改代码。

## 一、先理解：小程序是什么

### 和网页有什么区别

```
网页（H5）                        微信小程序
──────────────────────────       ──────────────────────────
运行在浏览器里                    运行在微信里（自带 JS 引擎）
HTML + CSS + JS                  WXML + WXSS + JS（微信魔改版）
window / document 随便用         没有 window、没有 document
部署到服务器，浏览器访问           上传到微信后台，微信分发
不支持微信原生能力                 支持微信原生能力（扫码/支付/定位/...）
```

一句话：**小程序是用"微信的 HTML/CSS/JS"写的应用，跑在微信里，能调微信原生能力。**

### 原生框架 vs 跨端框架

```
原生框架（这个项目用的）:
  index.js  +  index.wxml  +  index.wxss  +  index.json
  (逻辑)       (结构)         (样式)         (配置)

跨端框架（Taro / uni-app / mpvue，这个项目没用到）:
  一份代码 → 编成多个平台的小程序/App
```

这个项目是原生框架，好处是直接、性能好，缺点是只能在小程序端跑。

## 二、开发环境：你需要什么

### 1. 微信开发者工具

官网下载：`developers.weixin.qq.com/miniprogram/dev/devtools/download.html`

安装后用微信扫码登录即可。

### 2. 在开发者工具中打开项目

```
1. 打开微信开发者工具
2. 点击 "导入项目" 或 "+"
3. 目录选择 scenic-wxapp 根目录
4. AppID 选正式 AppID（如 wx1c34a90cf27decb6）
5. 点击确定
```

### 3. 必做的本地设置

打开项目后 → 右上角"详情" → "本地设置"标签页：

- [x] **不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书**

    勾上这个，QA 环境的后端请求才不会被拦截。**正式发版不需要**，但本地开发必须勾。

### 4. 理解项目结构（只看核心）

```
scenic-wxapp/
├── app.js             ← 小程序入口（启动时就跑，只跑一次）
├── app.json           ← 全局配置（有哪些页面、底栏长什么样）
├── app.wxss           ← 全局样式
├── config/            ← 多环境配置（tc.js、tc2.js 等）
├── pages/             ← 所有页面在这里
│   ├── home/          ← 一个页面，4 个文件：
│   │   ├── home.js
│   │   ├── home.wxml
│   │   ├── home.wxss
│   │   └── home.json
│   └── canyoning/     ← 一个功能模块（分包）
│       ├── api/       ← 模块的接口层
│       ├── utils/     ← 模块的工具函数
│       ├── challengeDetail/  ← 子页面
│       └── ...
├── components/        ← 公共组件
├── service/           ← 登录/初始化等全局服务
├── utils/             ← 全局工具函数
├── store/             ← 全局状态管理（Minax，类 Vuex）
├── constants/         ← 全局常量（接口地址、请求封装）
└── images/            ← 图片资源
```

**你现在只需要关注**：`pages/` 下的页面 + `app.json` 的页面注册 + `config/index.js` 的环境配置。

## 三、第一个页面：5 分钟手写

我们写一个最简单的页面，展示"Hello 小程序"，点击按钮变数字。

### 第 1 步：创建 4 个文件

在 `pages/` 下新建目录 `demo/`，创建：

```
pages/demo/
├── index.js
├── index.wxml
├── index.wxss
└── index.json
```

### 第 2 步：写 index.json

```json
{
  "usingComponents": {}
}
```

### 第 3 步：写 index.js

```javascript
Page({
  data: {
    title: "Hello 小程序",
    count: 0
  },

  onLoad() {
    console.log("页面加载了");
  },

  handleTap() {
    this.setData({
      count: this.data.count + 1
    });
  }
});
```

### 第 4 步：写 index.wxml

```xml
<view class="container">
  <text class="title">{{title}}</text>
  <text class="count">点击了 {{count}} 次</text>
  <button bindtap="handleTap">点我</button>
</view>
```

### 第 5 步：写 index.wxss

```css
.container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 200rpx;
}
.title {
  font-size: 48rpx;
  font-weight: bold;
  color: #333;
}
.count {
  font-size: 32rpx;
  color: #999;
  margin: 40rpx 0;
}
```

### 第 6 步：在 app.json 中注册页面

打开 `app.json`，在 `pages` 数组最前面加一行：

```json
{
  "pages": [
    "pages/demo/index",    ← 加这行
    "pages/index/index",
    ...
  ]
}
```

> `pages` 数组的第一项是小程序启动时默认显示的页面。

### 第 7 步：编译看效果

微信开发者工具中，点击编译按钮。左侧模拟器应该显示你的页面。

**你刚刚学会了**：Page 定义、data 响应式数据、setData 更新 UI、WXML 模板绑定、事件响应、WXSS 样式。这就是小程序开发的全部基础。

## 四、核心概念逐个击破

### 1. 页面是怎么跑起来的

```
1. 用户打开小程序 / 点击跳转
2. 微信框架读取 app.json 找到页面对应的 4 个文件
3. 执行 index.js 里的 Page({})
4. 把 data 里的值和 index.wxml 模板合并，渲染成界面
5. 触发 onLoad → onShow 生命周期
6. 用户操作触发事件 → 调用 Page 里的方法
7. 方法里 this.setData() → 界面自动更新
```

### 2. data：页面数据的"唯一源头"

```javascript
data: {
  name: "张三",       // 字符串
  age: 25,            // 数字
  isVip: false,       // 布尔
  list: [],           // 数组
  detail: null        // 对象（初始空用 null）
}
```

规则：
- `data` 里的值才能在 WXML 中用 `{{}}` 读取
- 改 `data` **必须**用 `this.setData({ key: newValue })`，直接 `this.data.xxx = yyy` 不会更新界面
- 读当前值用 `this.data.xxx`

### 3. setData：更新界面的唯一方式

```javascript
// 更新单个字段
this.setData({ loading: false });

// 同时更新多个字段
this.setData({ loading: false, list: newList });

// 更新嵌套字段（用字符串路径）
this.setData({ "user.name": "李四" });
this.setData({ "list[0].status": "done" });
// 路径语法和 JSONPath 差不多
```

**注意事项**：
- setData 是异步的，想拿到最新值用回调：
  ```javascript
  this.setData({ count: 1 }, () => {
    console.log(this.data.count); // "1"，保证是最新的
  });
  ```
- setData 传大数据会卡，尽量只传变化的部分
- setData 每次调用大小限制 256KB

### 4. WXML：不是 HTML，是模板语言

```xml
<!-- 基础标签对照 -->
<view>    →  <div>      块级容器
<text>    →  <span>     行内文本
<image>   →  <img>      图片
<button>  →  <button>   按钮
<block>   →  虚拟容器，不渲染实际 DOM

<!-- 数据绑定：{{}} -->
<text>{{name}}</text>                    → 输出 data.name 的值
<image src="{{avatarUrl}}" />            → 属性也可以用 {{}}
<view class="static {{dynamic}}"/>       → 拼接 class

<!-- 条件渲染：wx:if / wx:elif / wx:else -->
<view wx:if="{{loading}}">加载中...</view>
<view wx:elif="{{error}}">出错了</view>
<view wx:else>内容正常显示</view>

<!-- 列表渲染：wx:for -->
<view wx:for="{{list}}" wx:key="id">
  {{index}}  ← 当前索引（默认名 index）
  {{item}}   ← 当前元素（默认名 item）
</view>

<!-- 事件绑定：bind事件名 / bind:事件名 -->
<button bindtap="handleTap">点我</button>
<!-- 等于 <button onclick="handleTap">，但 js 方法在 Page 里 -->
```

### 5. 事件处理

```javascript
Page({
  handleTap(event) {
    // event.currentTarget.dataset 是标签上 data-xxx 属性的值
    // 例：<view data-id="123" data-name="hello" bindtap="handleTap">
    // event.currentTarget.dataset.id  → "123"
    // event.currentTarget.dataset.name → "hello"
    const { id, name } = event.currentTarget.dataset;
  }
});
```

### 6. WXSS：就是 CSS，但有几个差别

```css
/* ① rpx：响应式像素，最常用的单位 */
/* 设计师给 750px 宽的设计稿 → 直接把 px 换成 rpx */
/* iPhone 6: 1rpx = 0.5px */
/* iPhone 14 Pro Max: 1rpx ≈ 0.573px */
/* 750rpx 在任何手机上都等于屏幕宽度 */
.title { font-size: 48rpx; }

/* ② CSS 变量：从 WXML 的 style 属性传入 */
/* js 里: <view style="--headerHeight:{{headerHeight}}px;"
   css 里: */
.nav { height: var(--headerHeight); }

/* ③ 不支持某些 CSS 选择器（如 nth-child、属性选择器） */
/* ④ 不支持 !important（部分情况下） */
/* ⑤ 不支持 CSS 动画（用 wx.createAnimation 替代） */
```

### 7. 页面生命周期：你只需要记住三个

```javascript
Page({
  onLoad(options) {
    // 页面首次创建，只执行一次
    // options 是 URL 参数，如 ?id=123 → options.id = "123"
    // 在这里做：解析参数、发第一次请求
  },

  onShow() {
    // 每次页面显示时执行（从后台回来、从其他页面返回）
    // 在这里做：刷新数据、重新获取状态
  },

  onHide() {
    // 页面被隐藏时执行（跳转到别的页面、按 Home 键）
    // 在这里做：停止定时器、保存草稿
  }
});
```

### 8. 页面跳转

```javascript
// 打开新页面（保留当前页，可返回）。页面栈 +1，最多 10 层
wx.navigateTo({ url: "/pages/xxx/index?id=123" });

// 替换当前页面（关闭当前页，不可返回）
wx.redirectTo({ url: "/pages/xxx/index" });

// 返回上一页
wx.navigateBack({ delta: 1 });

// 跳转 tabBar 页面
wx.switchTab({ url: "/pages/home/home" });

// 本项目推荐用封装的 router：
import router from "../../utils/router";
router.navigateTo(url);    // 页面栈满了自动降级为 redirectTo
router.navigateBack();     // 栈空了自动跳首页
```

### 9. 发请求

```javascript
// 本项目用封装好的 http 工具（constants/request.js）
import { getRequest, postRequest } from "../../constants/api";

// GET 请求
const res = await getRequest("/xxx/query", { id: "123" });
// res = { code: "0", msg: "", data: { ... } }

// POST 请求
const res = await postRequest("/xxx/create", { name: "test" });

// code === "0" 表示成功
if (res.code === "0") {
  this.setData({ detail: res.data });
} else {
  wx.showToast({ title: res.msg || "请求失败", icon: "none" });
}
```

### 10. 全局数据：getApp()

```javascript
// app.js 里定义了 App 实例
App({
  globalData: {
    headerHeight: 88,   // 导航栏高度（在 onLaunch 里动态计算）
    navTop: 44,         // 状态栏高度
    roleInfo: {},       // 用户角色信息
    shopInfo: {},       // 店铺信息
  }
});

// 任意页面里取
const app = getApp();
const headerHeight = app.globalData.headerHeight;
```

## 五、调试技巧

### 1. Console 面板

和 Chrome DevTools 一样，`console.log()` 的输出在这里看。点击红框报错可以定位到出错的行。

### 2. Network 面板

看所有的 HTTP 请求，包括请求参数、返回数据、耗时。

### 3. AppData 面板

看看当前页面的 `data` 里都有什么值，实时刷新。调试 setData 必看。

### 4. 编译模式

工具栏上的"普通编译"下拉 → "添加编译模式"：
- 设置启动页面（比如直接进入 canyoning 某页面）
- 设置启动参数（比如 `activityId=123&period=DAY`）
- 不用每次手动一步步点进去了

### 5. 真机调试

点击工具栏"真机调试" → 手机扫码 → 在真机上跑。真机和模拟器有差异（特别是 camera/扫码/定位这类硬件相关功能），最终验证必须过真机。

## 六、看代码的正确姿势（以溪降模块为例）

当你拿到一个不熟悉的页面，按这个顺序看：

```
第 1 步：打开 index.json（2 秒）
  → 看 navigationStyle（是否自定义导航栏）
  → 看 usingComponents（用了哪些组件）

第 2 步：打开 index.wxml（30 秒）
  → 快速扫一眼整体结构
  → 看有哪些 wx:if / wx:for / bindtap
  → 心里有数"这个页面分几块区域"

第 3 步：打开 index.js，看 Page 定义（1 分钟）
  → 看 data 里有哪些字段（了解页面状态）
  → 看 onLoad 做了什么（了解初始化和参数）
  → 抓主要方法看逻辑（handleXxxTap 之类）

第 4 步：如果需要调接口，打开 api/index.js
  → 搜函数名，看请求路径和参数

第 5 步：打开 index.wxss（按需）
  → 只有调样式时才看
```

**不要从头到尾逐行读！** 带着问题看，比如"这个按钮点了之后发什么请求"，直接搜 `bindtap` → 找到 js 方法 → 顺藤摸瓜。

## 七、改代码的标准流程

比如要改溪降排行榜的每页条数：

```
1. 确认要改的是哪个页面
   → leaderboard/index.js

2. 搜索关键字
   → 搜 "pageSize" 找到 const PAGE_SIZE = 10;

3. 改掉
   → const PAGE_SIZE = 20;

4. 编译看效果
   → 微信开发者工具点编译

5. 验证
   → 打开排行榜页面，看一页是不是 20 条
```

## 八、常见踩坑速查

| 现象 | 原因 | 解决思路 |
|------|------|----------|
| 页面白屏无报错 | WXML 语法错误（微信静默失败） | 检查标签闭合、wx:if 语法 |
| `TypeError: Cannot read property 'x' of undefined` | 对象链式访问断掉了 | 加兜底：`(obj && obj.x)` 或 `obj?.x` |
| `setData failed` | 传了 undefined 进去 | `res.data \|\| {}` 兜底空对象 |
| `navigateTo 不生效` | 页面栈超过 10 层 | 用 `router.navigateTo`，会自动降级 |
| `request:fail url not in domain list` | 域名没在白名单 | DevTools 勾选"不校验域名" |
| 扫码在模拟器不工作 | 模拟器不支持 camera | 用真机调试或选"从相册选择二维码" |
| 定时器页面返回后还在跑 | onUnload 里没清理 | `clearInterval` 写在 onHide 和 onUnload 里 |
| 图片不显示 | 路径/域名问题 | 检查 src 是否是完整 HTTPS URL |
| 修改 config/*.js 没生效 | 没重新 build | `node build.js mp=TC` 重新生成 config |

## 九、进一步学习的路径

1. **先逛一遍项目**：打开 `pages/home/home.js` 看看首页长什么样
2. **改一个简单页面**：比如把首页的某个文案改掉，编译看效果
3. **顺着请求链路走一遍**：某页面 → api 层 → constants/request.js → 看看 HTTP 请求怎么封装的头和 token
4. **看懂溪降挑战详情页**：配合 `chapter-11-canyoning-syntax.md` 逐行读一遍 `challengeDetail/index.js`
5. **写一个新页面**：参考 11.10 节的流程从零写一个页面

---

> 微信官方文档：`developers.weixin.qq.com/miniprogram/dev/framework/`
> 微信 API 文档：`developers.weixin.qq.com/miniprogram/dev/api/`
> 本项目详细文档：`chapter-01` 到 `chapter-11` 各章节
