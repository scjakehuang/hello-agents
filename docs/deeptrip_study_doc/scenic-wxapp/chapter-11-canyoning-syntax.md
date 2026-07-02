# 第 11 章：零基础语法入门（以溪降挑战为例逐行讲解）

> 假定你没写过任何小程序代码，但有一门后端语言基础（Java/Go/Python 均可）。
> 本章用 `pages/canyoning/` 模块的真实代码，逐行解释小程序语法。

## 11.1 先跑起来：一个最小页面

### 文件结构

每个页面由 4 个同名文件组成，微信框架自动把它们关联在一起：

```
pages/myPage/
├── index.js      ← 页面逻辑（你的代码在这里）
├── index.wxml    ← 页面结构（类似 HTML）
├── index.wxss    ← 页面样式（类似 CSS）
└── index.json    ← 页面配置
```

### 最简 js 文件

```javascript
// index.js
// 1️⃣ Page({}) 是微信框架提供的函数，传入一个对象，就注册了一个页面
//    相当于后端的 @RestController + @RequestMapping 合在一起
Page({

    // 2️⃣ data 是页面的"响应式数据"，模板里可以直接用 {{}} 读取
    //    相当于 Vue 的 data，或 React 的 state
    data: {
        message: "你好，小程序",   // 初始值
        count: 0
    },

    // 3️⃣ onLoad 是生命周期函数，页面第一次加载时自动被框架调用
    //    options 参数里是 URL 问号后面的参数，比如 ?id=123 → options.id === "123"
    onLoad(options) {
        console.log("页面加载了，收到的参数：", options);
        // 可以用 this.setData 更新 data，更新后模板会自动重新渲染
    },

    // 4️⃣ 自定义方法，可以在模板里绑定到按钮点击事件
    handleTap() {
        // this.setData() 用来更新 data 里的值
        // 参数是一个对象，key 是要更新的字段，value 是新值
        // 框架会自动 diff，只更新变化的部分
        this.setData({
            count: this.data.count + 1   // ⚠️ 注意：读旧值用 this.data.xxx
        });
    }
});
```

### 最简 wxml 文件

```xml
<!-- index.wxml -->
<!-- WXML 是微信自己的模板语言，长得像 HTML 但不是 HTML -->

<!-- {{}} 双花括号是"插值表达式"，会把 js data 里的值填入这里 -->
<view class="container">           <!-- <view> 等于 HTML 的 <div> -->
    <text>{{message}}</text>       <!-- <text> 等于 HTML 的 <span> -->
    <text>计数: {{count}}</text>

    <!-- bindtap 是事件绑定，"handleTap" 对应 js 里的 handleTap 方法 -->
    <button bindtap="handleTap">点我 +1</button>
</view>
```

### 最简 json 文件

```json
{
    "usingComponents": {}    // 页面引用的组件列表，空对象 = 不引用外部组件
}
```

> 四个文件写完，把页面路径加到 `app.json` 的 `pages` 数组里就可以运行了。

---

## 11.2 核心语法逐个拆解

下面用溪降模块 `challengeDetail/index.js` 的真实代码逐行讲解。

### 11.2.1 导入与依赖

```javascript
// ① import 语法（ES Module）
//    从其他 js 文件导入函数/变量，相当于 Java 的 import com.xxx.XxxService
//    import { 解构导入 } from "路径"
import router from "../../../utils/router";      // 导入默认导出（export default）
import util from "../../../utils/util";          // 同上
import { showCanyoningToast } from "../utils/toast";  // 解构导入：只取文件导出的 showCanyoningToast 这一个函数
import {                                             // 解构导入多个
    assertCanyoningApiSuccess,
    getCanyoningChallengeDetail,
    getCanyoningApiErrorMessage,
} from "../api/index";

// ② require 语法（CommonJS 模块）
//    功能和 import 一样，但是另一个模块规范。小程序同时支持两种
//    解构赋值写法：从 require 返回的对象里取出 postRequest
const { postRequest } = require("../../../constants/api");

// ③ getApp() 是微信框架提供的全局函数
//    返回全局唯一的 App 实例（app.js 里 App({}) 定义的那个对象）
//    用来读取全局数据：app.globalData.xxx
const app = getApp();
```

### 11.2.2 常量和纯函数（页面外定义）

```javascript
// ④ 常量定义：页面文件顶部、Page({}) 之外
//    这些值在整个模块生命周期内不变，放在外面避免每次渲染都重新创建
const CHECKPOINT_ID_KEYS = ["checkpointId", "pointId"];

const CHALLENGE_VISUAL = {
    bgImage: "https://m.elongstatic.com/mall-v2/scenic-wxapp/xxx.png",
    // ...更多 CDN 图片 URL
};

// ⑤ 纯函数（不依赖 this，不操作 data）
//    负责数据格式转换，输入 → 输出，无副作用
//    相当于后端的 Converter / Mapper / Util 静态方法

function safeDecode(value) {
    // === 是严格相等，!== 是严格不等（Java 的 equals + 类型检查）
    // undefined 和 null 是两个不同的值：
    //   undefined = 变量声明了但没赋值
    //   null       = 明确的"空"
    if (value === undefined || value === null) {
        return "";
    }
    // String(value) 把任意值转成字符串（Java 的 String.valueOf()）
    const rawValue = String(value);
    // try/catch 和 Java 一样，但 JavaScript 不强制声明异常类型
    try {
        // decodeURIComponent 是 JS 内置函数，把 URL 编码的字符串解码
        // "%E6%BA%AA" → "溪"
        return decodeURIComponent(rawValue);
    } catch (error) {
        // URL 解码失败（比如字符串不是合法编码），返回原值
        return rawValue;
    }
}

function parseJson(value) {
    // typeof 运算符返回变量类型字符串: "string", "number", "object" ...
    // !value 判断 falsy 值：null / undefined / "" / 0 / NaN / false 都是 falsy
    if (!value || typeof value !== "string") {
        return null;
    }
    try {
        return JSON.parse(value);  // JS 内置 JSON 解析，等于 Java 的 Jackson/Gson
    } catch (error) {
        return null;
    }
}
```

### 11.2.3 Page({}) 定义页面

```javascript
// ⑥ Page({}) 接受一个大对象，里面是 data + 生命周期 + 方法
Page({

    // ========== data 属性：响应式数据 ==========
    data: {
        // ⑦ 这些值在模板中用 {{}} 读取，修改用 this.setData()
        //    每个字段必须有初始值！否则模板里读取会是 undefined
        headerHeight: app.globalData.headerHeight,  // 导航栏高度，从全局数据取
        navTop: app.globalData.navTop,              // 状态栏高度
        loading: true,          // 是否正在加载（布尔值）
        hasFetch: false,        // 是否已完成过一次请求
        activityId: "",         // 活动 ID（字符串，空字符串 = 暂无）
        activityCode: "",       // 活动编码
        shopId: "",             // 店铺 ID
        challengeDetail: null,  // 挑战详情对象（null = 还没数据）
        timeParts: "",          // 格式化的计时字符串，如 "01:23:45"
    },

    // ========== 生命周期函数 ==========

    // ⑧ onLoad(options)
    //    页面第一次加载时调用，只执行一次
    //    options 是 URL 上的查询参数对象
    //    例：/pages/canyoning/challengeDetail/index?activityId=123&activityCode=ABC
    //    options = { activityId: "123", activityCode: "ABC" }
    onLoad(options = {}) {   // = {} 是默认参数：如果没传参数，用空对象兜底
        // ⑨ this.xxx = 是给页面实例挂属性（不是 data！）
        //    和 Java 的 this.xxx = 一样，实例变量
        //    这些属性不会触发渲染，也不会传到模板，纯粹用于保存内部状态
        this.activityId = options.activityId || "";
        // || 是"短路或"：取第一个 truthy 值
        // 如果 options.activityId 是 undefined/null/""，就用 "" 兜底
        this.activityCode = options.activityCode
            ? decodeURIComponent(options.activityCode)  // URL 传过来是编码的，先解码
            : "";                                       // 没有就空字符串
        this.challengeId = options.challengeId || "";
        this.shopId = options.shopId || options.fromShopId || "";
        // fromShopId 是另一个可能的参数名，兼容两种情况
        this.needRefreshOnShow = true;  // 标记：下次 onShow 要刷新数据
    },

    // ⑩ onShow()
    //    每次页面显示时都调用（比 onLoad 更频繁）
    //    触发场景：首次加载、从其他页面返回、从后台切回前台
    onShow() {
        // 拿到 App 实例
        const app = getApp();
        // pages 是 getCurrentPages() 获取的页面栈数组
        // 最后一个元素是当前页面
        const pages = getCurrentPages();
        const currentPage = pages[pages.length - 1];

        // 检查是否需要刷新数据
        // currentPage.needRefreshOnShow 是由其他页面设置的标记
        if (this.needRefreshOnShow) {
            this.needRefreshOnShow = false;
            this.init({ keepContent: true });  // 保留已在屏幕上的内容，静默刷新
        } else if (!this.hasLoaded) {
            // 首次加载走全量 init()
            this.init();
        }
    },

    // ⑪ onHide()
    //    页面被隐藏时调用（跳转到其他页面、按 Home 键回到微信）
    //    典型用途：停止计时器、暂停音频
    onHide() {
        this.stopTimer();  // 停止倒计时，避免后台空跑
    },

    // ⑫ onUnload()
    //    页面被销毁时调用（redirectTo、navigateBack、左上角返回）
    //    典型用途：清理定时器、移除事件监听、释放资源
    onUnload() {
        this.stopTimer();
        // 如果 onHide 和 onUnload 可能都触发，两个都写 stopTimer 保底
    },

    // ========== 自定义方法 ==========

    // ⑬ async 函数：异步函数，内部可以用 await 等待 Promise
    //    async function xxx() { await yyy(); }
    //    等于 Java 的 CompletableFuture + thenCompose
    async init(options = {}) {
        const keepContent = options.keepContent === true;
        // 三元表达式：条件 ? 真值 : 假值
        // 和 Java 完全一样

        if (!keepContent) {
            // 非 keepContent 模式：显示 loading 状态
            this.updatePageData({ loading: true });
            // updatePageData 是封装方法，其实就是 setData（见后文）
        }

        // await 等待 Promise 完成，拿到返回值
        // getCanyoningChallengeDetail 返回 Promise（axios 风格）
        await this.getChallengeDetail();
        // 这行代码会等上面异步操作完成后才执行
    },

    // ⑭ 异步获取数据
    async getChallengeDetail() {
        let toastMessage = "";  // let 声明可变变量（const 声明不可变变量）
        try {
            // 调用 API 层导出的函数，传入参数对象
            // { activityId: "123" } 是对象字面量，等于 Java 的 new HashMap<>(){{put(...)}}
            const res = await getCurrentCanyoningChallenge({
                activityId: this.activityId,
            });
            // 这行会暂停，等 HTTP 请求返回后才继续

            // assert 函数内部检查 res.code === "0"，不满足就 throw Error
            assertCanyoningApiSuccess(res, "挑战详情获取失败");

            // res.data 是后端返回的 data 字段内容
            const data = res.data || {};  // || {} 是兜底：如果 data 是 null/undefined，用空对象
            const detail = normalizeChallengeDetail(data);
            // 调用前面定义的纯函数，把后端原始格式转成模板需要的格式

            // setData 更新data数据
            this.setData({
                activityId: detail.activityId,
                activityCode: detail.activityCode,
                challengeDetail: detail,
                loading: false,      // 加载完成，关 loading
                hasFetch: true,      // 标记已完成一次请求
            });

        } catch (error) {
            // error.message 是 throw new Error("xxx") 时传入的字符串
            toastMessage = error.message || "网络异常，请稍后重试";
            this.setData({ loading: false });
            // 加载失败也要关 loading，否则用户会卡在 loading 界面
        }

        // toast 放 try/catch 之外，因为 catch 里 setData 之后模板已更新
        // 此时展示 toast 不会和 loading 冲突
        if (toastMessage) {
            showCanyoningToast(toastMessage);
        }
    },

    // ⑮ 启动实时计时器
    startTimer(elapsedSeconds) {
        // 1. 先清掉旧定时器（防止重复启动）
        this.stopTimer();

        // 2. 计算起始时间戳
        // Date.now() 返回从 1970-01-01 到现在的毫秒数（等于 Java 的 System.currentTimeMillis()）
        // elapsedSeconds 是从后端拿的"已经过了多少秒"
        // 反推出 startTime：现在 - 已经过的时间 = 开始时间
        const startTime = Date.now() - elapsedSeconds * 1000;

        // 3. setInterval 定时器：每隔 1000 毫秒执行一次回调
        //    返回一个 timerId，用于 clearInterval 清除
        //    等于 Java 的 ScheduledExecutorService.scheduleAtFixedRate
        this.timer = setInterval(() => {
            // 4. 计算已经过了多少毫秒
            const elapsed = Date.now() - startTime;

            // 5. 把毫秒转成 [时, 分, 秒] 数组
            const totalSeconds = Math.floor(elapsed / 1000);  // Math.floor = 向下取整
            const hour = Math.floor(totalSeconds / 3600);
            const minute = Math.floor((totalSeconds % 3600) / 60);  // % 取余运算符
            const second = totalSeconds % 60;

            // 6. 格式化成两位数 "01", "05", "32"
            // map() 是数组方法：对每个元素执行回调，返回新数组
            const parts = [hour, minute, second]
                .map(v => util.formatNumber(v))  // 箭头函数：v 是参数，=> 后面是返回值
                .join(":");                       // join(":") = 用冒号连接 → "01:05:32"

            // 7. ⚠️ 关键优化：值没变就不 setData
            //    setData 会触发渲染，频繁调用会卡顿
            //    === 是严格相等比较，值一样就直接跳过
            if (parts !== this.data.timeParts) {
                this.setData({ timeParts: parts });
            }
        }, 1000);
    },

    // ⑯ 停止计时器
    stopTimer() {
        if (this.timer) {
            clearInterval(this.timer);  // 清除 setInterval 的定时器
            this.timer = null;          // 置空，防止二次清除
        }
    },

    // ⑰ 事件处理：扫码按钮点击
    async handleScanTap() {
        // 1. 校验：挑战状态不对就不能扫码
        const { challengeDetail } = this.data;
        // 解构赋值：等价于 const challengeDetail = this.data.challengeDetail;

        if (!challengeDetail) {
            // 还没加载完
            showCanyoningToast("挑战数据加载中，请稍后");
            return;  // 提前返回，不执行后续代码
        }

        // 2. 申请相机权限（从 utils/camera.js 导入的函数）
        try {
            await ensureCameraPermission();
            // 权限通过，继续后面的逻辑...
        } catch {
            showCanyoningToast("需要摄像头权限才能扫码打卡");
            return;
        }

        // 3. 调起微信扫码
        // wx.scanCode 是微信框架的 API，打开摄像头扫描二维码
        // onlyFromCamera: true  只允许摄像头扫描，不允许从相册选图
        wx.scanCode({
            onlyFromCamera: true,
            success: (res) => {
                // 扫码成功的回调，res.result 是二维码内容
                // 接下来解析内容，跳转到 checkinConfirm 页面
                this.navigateToCheckin(res.result);
            },
            fail: (err) => {
                // 用户取消 / 扫码失败
                console.log("扫码取消", err);
            }
        });
    },

    // ⑱ 简单的 setData 封装
    //    项目惯例：每个页面都写这个方法，方便将来统一加日志/防抖
    updatePageData(data) {
        this.setData(data);
    },
});
```

---

## 11.3 WXML 模板语法逐行讲解

以 `checkinConfirm/index.wxml` 为例：

```xml
<!--
    WXML 基础：
    - <view>   = HTML 的 <div>，块级容器
    - <image>  = HTML 的 <img>，图片
    - <text>   = HTML 的 <span>，行内文本
    - <block>  = 虚拟容器，不渲染任何 DOM，只用于包裹 wx:if/wx:for
-->

<!-- 1️⃣ 内联样式用 style=""
     {{}} 里可以写表达式，但不能写复杂逻辑（不能调用函数、不能 || ! 运算符）
     --headerHeight 是 CSS 变量，在后文 WXSS 部分解释 -->
<view class="pageContainer" style="--headerHeight:{{headerHeight}}px;">

    <!-- 2️⃣ 图片组件
     src    = 图片地址（支持网络 URL 和本地路径）
     mode   = 图片裁剪/缩放模式（aspectFill = 填满容器，裁掉溢出部分） -->
    <image class="navFixedBgImage" mode="scaleToFill" src="{{checkinDetail.topBgImage}}" />

    <!-- 3️⃣ 引用自定义组件 <bar>
     组件在 index.json 的 usingComponents 里注册后才能用
     属性通过直接写在标签上传入
     isShow="{{true}}"     = 传入布尔值 true（注意要写 {{}}，直接写 true 会被当字符串 "true"）
     showBack="{{true}}"   = 显示返回按钮
     isTransparent="{{true}}" = 透明背景
     bind:triggerBack      = 绑定组件发出的 triggerBack 事件到本页面的 triggerBack 方法
     关于 bind: 前缀 → 见下方"组件事件"说明 -->
    <bar
        isShow="{{true}}"
        showBack="{{true}}"
        isTransparent="{{true}}"
        bind:triggerBack="triggerBack"
    />

    <!-- 4️⃣ wx:if 条件渲染
     等于 Java 的 if 语句
     wx:if    = if
     wx:elif  = else if
     wx:else  = else
     注意：三个必须紧挨着写，中间不能插其他标签 -->
    <view wx:if="{{!loading && fetchError}}" class="emptyWrap">
        <!-- 感叹号 ! 是逻辑非，注意 WXML 不支持 || 运算符，只能单用 ! -->
        <rb-empty title="{{fetchErrorTitle}}" />
    </view>

    <view wx:elif="{{!loading}}" class="contentWrap">
        <!-- 5️⃣ wx:for 列表渲染
         等于 Java 的 for (item : list)
         wx:for="{{checkinDetail.rows}}"  要遍历的数组
         wx:key="id"                      唯一键（和 React/Vue 的 key 一样，用于 diff 优化）
         wx:for-item="item"               循环变量名（默认就叫 item，可省略）
         wx:for-index="index"             索引变量名（默认就叫 index，可省略） -->
        <block wx:for="{{checkinDetail.rows}}" wx:key="id">
            <view class="infoRow">
                <!-- item 是当前循环的元素，item.label = 当前元素的 label 属性 -->
                <view class="infoLabel">{{item.label}}</view>

                <!-- 6️⃣ 动态 class
                 类名后面的 {{}} 部分会成为 CSS class 的一部分
                 item.type === 'warning' 为 true 时，class="infoValue infoValueWarning" -->
                <view class="infoValue {{item.type === 'warning' ? 'infoValueWarning' : ''}}">
                    {{item.value}}
                </view>
            </view>
        </block>
    </view>

    <!-- 7️⃣ wx:if 条件渲染底部按钮
     根据 footerAction 的值决定显示"下一步"还是"取消+确认" -->
    <view class="footerBar">
        <view class="buttonRow">
            <!-- block 不渲染 DOM，只做逻辑容器 -->
            <block wx:if="{{footerAction === 'next'}}">
                <view class="nextButton" bindtap="handleNextCheckpointTap">前往下一打卡点</view>
            </block>
            <block wx:else>
                <view class="cancelButton" bindtap="handleCancelTap">取消</view>
                <view class="confirmButton {{submitting ? 'confirmButtonDisabled' : ''}}" bindtap="handleConfirmTap">
                    {{submitting ? '提交中' : '确认打卡'}}
                </view>
            </block>
        </view>
    </view>
</view>
```

### WXML 表达式能力边界

```xml
<!-- ✅ 可以做的事情 -->
<view>{{a + b}}</view>                    <!-- 加减乘除 -->
<view>{{a ? b : c}}</view>               <!-- 三元表达式 -->
<view>{{a === b}}</view>                  <!-- 比较运算 -->
<view>{{obj.key}}</view>                  <!-- 取对象属性 -->
<view>{{arr[0]}}</view>                   <!-- 取数组元素 -->
<view class="static {{dynamic}}"></view> <!-- 拼接 class -->

<!-- ❌ 不能做的事情 -->
<view>{{a || b}}</view>       <!-- 逻辑或：不支持 -->
<view>{{a && b}}</view>       <!-- 逻辑与：不支持 -->
<view>{{fn(a)}}</view>        <!-- 调用函数：不支持 -->
<view>{{a.b.c().d}}</view>    <!-- 方法调用链：不支持 -->
<view>{{new Date()}}</view>   <!-- new 构造：不支持 -->

<!-- 💡 解决方案：在 js 里算好，用 setData 传到 data 里 -->
```

---

## 11.4 WXSS 样式语法讲解

以 `challengeDetail/index.wxss` 为例：

```css
/* ====== ① rpx：响应式像素 ====== */
/* 小程序特有单位，750rpx = 屏幕宽度（任何手机都一样） */
/* iPhone 6: 375px 物理宽 = 750rpx，所以 1rpx = 0.5px */
/* iPhone 14 Pro Max: 430px 物理宽 = 750rpx，所以 1rpx ≈ 0.573px */
/* 设计师给 750px 宽的设计稿，你直接照抄数值单位换成 rpx 就行 */
.pageContainer {
    width: 750rpx;          /* 总是等于屏幕宽度 */
    min-height: 100vh;      /* vh = 视口高度百分比，100vh = 全屏高度 */
    background-color: #f5f5f5;
    overflow-x: hidden;     /* 隐藏横向溢出 */
}

/* ====== ② CSS 变量（通过 style 属性传入动态值） ====== */
/* js 中: <view style="--headerHeight:{{headerHeight}}px;">
   css 中: var(--headerHeight) 来读取 */
.navFixedBg {
    position: fixed;        /* 固定定位，不随滚动 */
    top: 0;
    left: 0;
    width: 100%;
    height: var(--headerHeight);  /* 从 style 属性动态传入 */
    z-index: 100;           /* 层级，保证在最上面 */
}

/* ====== ③ position 定位 ====== */
/* position 和 CSS 完全一样 */
/* fixed  = 固定定位，相对于屏幕窗口 */
/* absolute = 绝对定位，相对于最近的定位祖先 */
/* relative = 相对定位 */
.navFixedBgImage {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
}

/* ====== ④ flex 布局 ====== */
.timeBox {
    display: flex;              /* 弹性布局 */
    flex-direction: column;     /* 纵向排列 */
    align-items: center;        /* 交叉轴居中（横向居中） */
    justify-content: center;    /* 主轴居中（纵向居中） */
}

/* ====== ⑤ safe-area-inset-bottom：iPhone 底部安全区 ====== */
/* iPhone X 及以后的机型底部有一个横条（Home Indicator），需要留白 */
.footerBar {
    position: fixed;
    bottom: 0;
    padding-bottom: constant(safe-area-inset-bottom); /* iOS 11.0-11.1 兼容 */
    padding-bottom: env(safe-area-inset-bottom);       /* iOS 11.2+ 标准写法 */
}
/* 非 iPhone X 机型上这个值是 0，不影响正常显示 */

/* ====== ⑥ 不同状态的颜色 ====== */
/* 已打卡：绿色（#01a862 是项目主色调） */
.tagChecked {
    background-color: #01a862;
    color: #fff;
}
/* 前往中：橙色 */
.tagGoing {
    background-color: #ff9a26;
    color: #fff;
}
/* 待打卡：灰色 */
.tagPending {
    background-color: #f5f5f5;
    color: #999999;
}

/* ====== ⑦ 选择器与 HTML/CSS 完全一致 ====== */
/* 类选择器: .className */
/* ID 选择器: #idName */
/* 后代选择器: .parent .child */
/* 直接子元素: .parent > .child */
/* 伪元素: ::before, ::after */
```

---

## 11.5 组件使用详解

### 11.5.1 使用自定义 `<bar>` 组件

**第 1 步：页面 json 中注册**

```json
// checkinConfirm/index.json
{
    "navigationStyle": "custom",    // 隐藏系统导航栏，用自己的
    "usingComponents": {
        "bar": "/components/bar/bar",       // 标签名: "组件路径"
        "rb-empty": "/components/rbEmpty/index"
    }
    // 注册后，本页面 wxml 就能写 <bar ...> <rb-empty ...> 了
}
```

**第 2 步：wxml 中使用**

```xml
<!-- 属性传值：直接写="值" 或 ="{{变量}}" -->
<bar
    isShow="{{true}}"            <!-- 传布尔 true -->
    isShowBorder="{{0}}"         <!-- 传数字 0 -->
    title=""                     <!-- 传空字符串 -->
    showBack="{{true}}"          <!-- 显示返回按钮 -->
    isTransparent="{{true}}"     <!-- 透明背景 -->
    isNotNavigeteBack="{{true}}" <!-- 禁用默认返回行为 -->

    <!-- ⚠️ 重点：bind:事件名="本页面方法名"
     bind:triggerBack="triggerBack" 的含义：
       组件内部 this.triggerEvent('triggerBack') 触发事件
       本页面的 triggerBack 方法被调用 -->
    bind:triggerBack="triggerBack"
/>
```

**第 3 步：js 中实现事件处理方法**

```javascript
Page({
    triggerBack() {
        router.navigateBack();  // 自定义返回逻辑
    }
});
```

### 11.5.2 组件 `<bar>` 的内部实现（简写）

```javascript
// components/bar/bar.js
Component({
    // ① properties：组件对外暴露的属性（等于 React 的 props）
    properties: {
        title: { type: String, value: "" },           // 字符串，默认 ""
        isShow: { type: Boolean, value: true },        // 布尔，默认 true
        showBack: { type: Boolean, value: false },
        isTransparent: { type: Boolean, value: false },
        isNotNavigeteBack: { type: Boolean, value: false },
    },

    // ② methods：组件的内部方法
    methods: {
        goback() {
            if (this.data.isNotNavigeteBack) {
                // triggerEvent 向父页面发射事件
                // 父页面用 bind:triggerBack="xxx" 来接收
                this.triggerEvent("triggerBack");
            } else {
                wx.navigateBack();  // 默认行为：直接返回
            }
        }
    }
});
```

### 11.5.3 `<camera>` 扫码组件

```xml
<!-- scan/index.wxml -->
<!-- camera 是微信原生组件，不需要注册，直接使用 -->
<camera
    class="scanCamera"
    mode="scanCode"              <!-- mode="scanCode" = 扫码模式，微信内置识别引擎 -->
    device-position="back"       <!-- 后置摄像头 -->
    flash="off"                  <!-- 闪光灯关闭 -->
    bindscancode="handleScanCode" <!-- 识别到二维码时的回调 -->
    binderror="handleCameraError" <!-- 摄像头出错时的回调 -->
/>
```

```javascript
// scan/index.js
Page({
    // 扫码成功回调
    // event.detail 是摄像头识别到的结果对象，包含 result/path/rawData 等字段
    handleScanCode(event = {}) {
        if (this.data.scanning) return;  // 防重复触发

        this.setData({ scanning: true });

        // event.detail 的结构（微信官方文档定义）：
        // { result: "二维码内容字符串", scanType: "QR_CODE", charSet: "UTF-8" }
        this.handleScanSuccess(event.detail || event);
    },

    // 摄像头错误回调
    handleCameraError() {
        this.setData({ scanning: false });
        showCanyoningToast("摄像头不可用，请检查授权后重试");
    }
});
```

### 11.5.4 事件绑定速查

| WXML 写法 | 含义 | 使用场景 |
|-----------|------|----------|
| `bindtap="fn"` | 点击事件 | 按钮、view |
| `bind:tap="fn"` | 同上（冒号写法） | 同上 |
| `catchtap="fn"` | 点击 + 阻止冒泡 | 弹窗内部点击不穿透 |
| `bindscancode="fn"` | 扫码识别成功 | camera 组件 |
| `binderror="fn"` | 组件内部出错 | image/camera |
| `bind:close="fn"` | 弹窗关闭 | popup 组件 |
| `bind:refresh="fn"` | 下拉刷新回调 | rb-empty 组件 |
| `data-xxx="value"` | 传自定义数据 | 配合 event.currentTarget.dataset |

**自定义属性的读音**：`data-activity-id="123"` → `event.currentTarget.dataset.activityId`（连字符转驼峰）。

---

## 11.6 JavaScript 核心语法速成

### 变量声明：const vs let

```javascript
const name = "张三";    // 常量，声明后不可重新赋值（Java 的 final）
let age = 25;          // 变量，可重新赋值
age = 26;              // ✅ 可以
// name = "李四";      // ❌ 报错 Assignment to constant variable

// ⚠️ 永远不要用 var（函数作用域、变量提升，坑太多）
// ⚠️ 对象和数组用 const 声明仍然可以修改内部属性
const obj = { a: 1 };
obj.a = 2;             // ✅ 可以，const 只是不能把 obj 指向新对象
obj.b = 3;             // ✅ 可以
// obj = { c: 4 };     // ❌ 报错，不能重新赋值
```

### 解构赋值

```javascript
// 对象解构
const { loading, fetchError } = this.data;
// 等价于：
// const loading = this.data.loading;
// const fetchError = this.data.fetchError;

// 改名解构
const { activityId: id } = options;  // 取出 options.activityId，赋值给变量 id

// 数组解构
const [first, second] = someArray;  // first = someArray[0], second = someArray[1]

// 函数参数解构
function foo({ name, age } = {}) {
    // 直接从参数对象取出 name 和 age
    // = {} 是默认值，防止传 undefined 时报错
}
```

### 箭头函数

```javascript
// 传统函数
const add1 = function(a, b) {
    return a + b;
};

// 箭头函数（等价）
const add2 = (a, b) => {
    return a + b;
};

// 只有一个表达式时可以省略 {} 和 return
const add3 = (a, b) => a + b;

// 只有一个参数时可以省略 ()
const double = x => x * 2;

// ⚠️ 箭头函数的 this 和外层作用域一致（不创建自己的 this）
//    Page({}) 的方法用传统写法 function(){} 或用方法简写 xxx(){}
//    不要用箭头函数定义 Page 的方法，否则 this 不是页面实例
```

### Promise 和 async/await

```javascript
// Promise 就是"未来的值"，有三种状态：pending / fulfilled / rejected
// 等于 Java 的 CompletableFuture

// 创建 Promise
const promise = new Promise((resolve, reject) => {
    // 异步操作...
    if (ok) {
        resolve(result);   // 成功 → Promise 变为 fulfilled
    } else {
        reject(error);     // 失败 → Promise 变为 rejected
    }
});

// .then() 链式调用
someAsyncFn()
    .then(result => doSomething(result))
    .catch(error => handleError(error));    // 等于 Java 的 exceptionally()

// async/await 是 Promise 的语法糖
async function fetchData() {
    try {
        const result = await someAsyncFn();  // 等 Promise 完成，取值
        // 等价于 someAsyncFn().then(result => { ... })
        return result;
    } catch (error) {
        // 等价于 .catch(error => { ... })
    }
}
```

### 数组方法（最常用的几个）

```javascript
const arr = [1, 2, 3, 4, 5];

// map：对每个元素做变换，返回新数组
arr.map(x => x * 2);  // [2, 4, 6, 8, 10]

// filter：过滤，返回符合条件的元素组成的新数组
arr.filter(x => x > 2);  // [3, 4, 5]

// find：找到第一个符合条件的元素，找不到返回 undefined
arr.find(x => x > 3);  // 4

// some：有没有至少一个符合条件的元素
arr.some(x => x > 4);  // true

// forEach：遍历（不返回新数组）
arr.forEach((item, index) => { console.log(index, item); });

// reduce：归约
arr.reduce((acc, cur) => acc + cur, 0);  // 15（求和）

// concat：拼接数组
[1, 2].concat([3, 4]);  // [1, 2, 3, 4]

// 扩展运算符 ...
[0, ...arr, 6];  // [0, 1, 2, 3, 4, 5, 6]
```

### 对象与模板字符串

```javascript
// 对象简写
const name = "张三";
const user = { name };  // 等价于 { name: name }
const obj = {
    // 方法简写
    sayHello() { ... },  // 等价于 sayHello: function() { ... }
};

// 展开运算符
const a = { x: 1, y: 2 };
const b = { ...a, z: 3 };  // { x: 1, y: 2, z: 3 }
const c = { ...a, x: 99 }; // { x: 99, y: 2 } —— 后面的覆盖前面的

// 模板字符串（用反引号 ``）
const msg = `用户 ${name} 的分数是 ${score}`;
// 等于 "用户 " + name + " 的分数是 " + score
// 表达式的值自动填入 ${}
```

---

## 11.7 页面间跳转与传参

### 四种跳转方式

```javascript
// ① navigateTo：打开新页面（保留当前页面，可返回）
//    页面栈 +1。最多 10 层
wx.navigateTo({
    url: "/pages/canyoning/leaderboard/index?activityId=123&period=DAY"
});

// ② redirectTo：替换当前页面（关闭当前页面，不可返回）
//    页面栈层数不变
wx.redirectTo({
    url: "/pages/canyoning/challengeComplete/index?challengeId=456"
});

// ③ navigateBack：返回上一页
//    页面栈 -1
wx.navigateBack({ delta: 1 });  // delta = 返回层数，默认 1

// ④ switchTab：跳转到 tabBar 页面
//    关闭所有非 tabBar 页面
wx.switchTab({ url: "/pages/home/home" });
```

### 参数传递与接收

```javascript
// 发送方：参数拼在 URL 查询字符串上
const activityId = "123";
const activityCode = "ABC";
// encodeURIComponent 编码：防止中文/特殊字符导致 URL 解析出错
const url = `/pages/xxx/index?activityId=${encodeURIComponent(activityId)}&activityCode=${encodeURIComponent(activityCode)}`;
wx.navigateTo({ url });

// 接收方：onLoad 的 options 参数里取
Page({
    onLoad(options = {}) {
        // 框架自动把 URL 参数解析成对象
        const activityId = options.activityId || "";
        // URL 编码的会自动解码，所以这里值是 "123" 不是 "123"
        const activityCode = options.activityCode || "";  // "ABC"
    }
});
```

### 项目封装的 router.js

```javascript
import router from "../../../utils/router";

// 和 wx.xxx 功能一样，但加了智能降级
router.navigateTo(url);    // 页面栈 ≥ 10 时自动降级为 redirectTo
router.redirectTo(url);    // tabBar 页面自动降级为 switchTab
router.navigateBack();     // 栈为空时跳转到首页

// 内部实现：
function navigateTo(path) {
    if (checkIsTabBar(path)) return switchTab(path);  // tabBar 用 switchTab

    const pages = getCurrentPages().length;
    if (pages >= 10) {
        wx.redirectTo({ url: path });  // 满了用 redirectTo
    } else {
        wx.navigateTo({ url: path });
    }
}
```

---

## 11.8 Storage 本地存储

```javascript
// 存（同步）
wx.setStorageSync("key", "value");

// 取（同步）
const value = wx.getStorageSync("key");  // 不存在返回 ""

// 删（同步）
wx.removeStorageSync("key");

// ⚠️ Storage 有 10MB 上限
// ⚠️ Storage 是持久化的，除非用户清缓存/删小程序，否则一直存在
// ⚠️ getStorageSync 是同步阻塞操作，不要在循环/高频回调里用
// ⚠️ 不同的微信小程序之间 Storage 隔离，不能共享
```

### 溪降模块中的实际用法

```javascript
// ① 日级标记：当天有效，隔天自动过期
function setDailyFlag(key) {
    wx.setStorageSync(key, {
        value: true,
        expireAt: new Date(                            // new Date() 当前时间
            now.getFullYear(),                         // 2026
            now.getMonth(),                            // 5（6月，从0开始！）
            now.getDate() + 1                          // 明天
        ).getTime(),                                   // 转成时间戳
    });
}

// ② 活动上下文：跨页面共享参数
//    存时合并（新值覆盖，空值不覆盖），取时返回兜底对象
export function saveCanyoningActivityContext(context = {}) {
    const current = getCanyoningActivityContext();
    const next = {
        activityId: incoming.activityId || current.activityId,
        // 新值有就用新值，新值为空就用旧值
    };
    wx.setStorageSync(ACTIVITY_CONTEXT_KEY, next);
}
```

---

## 11.9 微信 API 速查（溪降模块用到的）

| API | 用途 | 关键参数 |
|-----|------|----------|
| `wx.scanCode({})` | 扫码 | `onlyFromCamera: true`, `success/fail` 回调 |
| `wx.getLocation({})` | 获取 GPS 位置 | `type: "gcj02"`, `isHighAccuracy: true` |
| `wx.showToast({})` | 轻提示 | `title, icon: "none"/"success"`, `duration` |
| `wx.showLoading({})` | 全屏加载 | `mask: true` 防止穿透点击 |
| `wx.hideLoading()` | 关闭全屏加载 | 无参数 |
| `wx.showModal({})` | 模态对话框 | `title, content, showCancel, success` |
| `wx.getSetting({})` | 查用户授权状态 | `success({ authSetting })` |
| `wx.authorize({})` | 请求权限 | `scope: "scope.camera"` |
| `wx.openSetting({})` | 打开权限设置页 | `success({ authSetting })` |
| `wx.setStorageSync(k,v)` | 存本地数据 | 同步，有性能成本 |
| `wx.getStorageSync(k)` | 取本地数据 | 同步，有性能成本 |
| `wx.downloadFile({})` | 下载文件 | `url, success: ({ tempFilePath })` |
| `wx.saveImageToPhotosAlbum({})` | 保存图片到相册 | `filePath` |
| `wx.showShareImageMenu({})` | 微信图片分享 | `path` |
| `wx.canvasToTempFilePath({})` | Canvas 导出图片 | `canvasId, width, height` |
| `wx.stopPullDownRefresh()` | 停止下拉刷新动画 | 无参数 |
| `getCurrentPages()` | 获取页面栈 | 返回数组，最后一个元素是当前页面 |

---

## 11.10 完整开发流程（从零开始一个页面）

```bash
# 假设要给溪降模块加一个"个人成绩"页面

# Step 1：创建目录和文件
mkdir -p pages/canyoning/myScore
touch pages/canyoning/myScore/index.js
touch pages/canyoning/myScore/index.wxml
touch pages/canyoning/myScore/index.wxss
touch pages/canyoning/myScore/index.json

# Step 2：在 app.json 注册（加到 canyoning 分包）
# "pages": [..., "myScore/index"]

# Step 3：如果调新接口，在 api/index.js 加请求函数

# Step 4：写代码（按顺序：json → js → wxml → wxss）
```

### json（第一步）

```json
{
    "navigationStyle": "custom",
    "usingComponents": {
        "bar": "/components/bar/bar",
        "rb-empty": "/components/rbEmpty/index"
    }
}
```

### js（第二步）

```javascript
const app = getApp();
import router from "../../../utils/router";
import { showCanyoningToast } from "../utils/toast";
import { assertCanyoningApiSuccess } from "../api/index";
import { getCanyoningActivityContext } from "../utils/storage";

Page({
    data: {
        headerHeight: app.globalData.headerHeight,
        navTop: app.globalData.navTop,
        loading: true,
        fetchError: false,
        activityId: "",
        score: null,
    },

    onLoad(options = {}) {
        const cachedContext = getCanyoningActivityContext();
        this.activityId = options.activityId || cachedContext.activityId;
        if (!this.activityId) {
            this.setData({ loading: false, fetchError: true });
            showCanyoningToast("活动参数缺失");
            return;
        }
        this.setData({ activityId: this.activityId });
        this.fetchMyScore();
    },

    async fetchMyScore() {
        wx.showLoading({ mask: true });
        let toastMessage = "";
        try {
            const res = await getCanyoningMyScore({ activityId: this.activityId });
            assertCanyoningApiSuccess(res, "成绩获取失败");
            this.setData({
                score: res.data,
                loading: false,
            });
        } catch (error) {
            toastMessage = error.message || "网络异常";
            this.setData({ loading: false, fetchError: true });
        } finally {
            wx.hideLoading();
        }
        if (toastMessage) showCanyoningToast(toastMessage);
    },

    updatePageData(data) {
        this.setData(data);
    },

    triggerBack() {
        router.navigateBack();
    },
});
```

### wxml（第三步）

```xml
<view class="pageContainer" style="--headerHeight:{{headerHeight}}px;">
    <bar isShow="{{true}}" showBack="{{true}}" isTransparent="{{true}}"
         isNotNavigeteBack="{{true}}" bind:triggerBack="triggerBack" />
    <view class="pageNavTitle"
          style="height:{{headerHeight}}px;padding-top:{{navTop}}px;">
        我的成绩
    </view>

    <view wx:if="{{fetchError}}" class="emptyWrap">
        <rb-empty title="成绩加载失败" showRefresh="{{true}}" bind:refresh="fetchMyScore" />
    </view>

    <view wx:elif="{{!loading && score}}" class="contentWrap">
        <text>总用时：{{score.totalTime}}</text>
        <text>排名：{{score.rank}}</text>
        <text>打卡数：{{score.checkinCount}}</text>
    </view>
</view>
```

### wxss（第四步）

```css
.pageContainer {
    min-height: 100vh;
    background-color: #f5f5f5;
}
.pageNavTitle {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    text-align: center;
    font-size: 32rpx;
    font-weight: 600;
    color: #333;
    z-index: 99;
}
.contentWrap {
    padding-top: calc(var(--headerHeight) + 20rpx);
    padding-left: 32rpx;
    padding-right: 32rpx;
}
.emptyWrap {
    padding-top: 300rpx;
}
```

---

## 11.11 💡 常见错误速查

| 报错/现象 | 原因 | 解决 |
|-----------|------|------|
| `thirdScriptError: a is not defined` | 变量未声明就使用 | 检查 import / const / let |
| `setData failed: undefined` | 给 data 设了 undefined | 用 `null` 代替 `undefined` |
| `TypeError: Cannot read property 'x' of undefined` | 读了一个没有的嵌套属性 | `(obj && obj.x)` 或 `obj?.x`（可选链） |
| `navigateTo 不生效` | 页面栈满 10 层 | 用 `router.navigateTo`（自动降级） |
| `switchTab 不生效` | URL 不是 tabBar 页面 | 检查 `app.json` 的 `tabBar.list` |
| 页面白屏无报错 | WXML 编译错误（静默失败） | 检查标签是否闭合、wx:if 语法 |
| `request:fail url not in domain list` | 请求域名未配置 | DevTools 勾选"不校验合法域名" |
| `插件未授权` | AppID 没有该插件权限 | 去掉未授权的插件，或换有权限的 AppID |

---

> 语法细节推荐配合 MDN 文档查阅：`developer.mozilla.org/zh-CN/docs/Web/JavaScript`。微信特有 API 查官方文档：`developers.weixin.qq.com/miniprogram/dev/api/`。
