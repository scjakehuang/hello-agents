# 第 6 章：API 请求与数据流

## 6.1 请求链路

```
页面 (pages/)
    │ 调用 api/ 中的函数
    ▼
API 层 (api/shop.js, api/order.js ...)
    │ import http from "@/constants/request"
    ▼
Http 实例 (constants/request.js)
    │ requestAll() 统一附加 token/business/appid
    ▼
HTTP 请求 → 网关 → 后端服务
    │ response handler: 处理 session 过期、错误上报
    ▼
页面拿到 Response → setData 更新 UI
```

## 6.2 请求核心：`constants/request.js`

项目封装了自定义 `Http` 类，**不是 axios，不是 fetch**。

### 构造函数

```javascript
class Http {
    constructor() {
        this._header = {
            "content-type": "application/json",
            token: consts.NetURL[consts.Env].token,
            actionFrom: consts.actionFrom,
            traceSource: consts.NetURL[consts.Env].traceSource,
            business: consts.NetURL[consts.Env].business,
            appid: consts.appId
        };
        this._baseUrl = consts.NetURL[consts.Env].serverURL;
    }
}
```

### 核心方法：`requestAll`

```javascript
requestAll(url, data, header, method = 'POST') {
    // 1. 读取缓存的 sessionToken 附加到 header
    // 2. 发送请求
    // 3. 响应处理：
    //    a. code === "0" → 正常返回
    //    b. code === "3000_0001" / "3000_0002" → Session 过期
    //       - 自动调用 getSessionToken() 刷新
    //       - 并发请求排队等待（subscribers 队列）
    //       - 拿到新 token 后批量重试
    //    c. 其他错误 → Sentry 上报
    // 4. 超时 35 秒
}
```

### 多 baseUrl 支持

```javascript
// 默认网关
http.postRequest("/order/newgate/order/page/customer", params);

// 神笔（营销活动）网关
http.magicbrushPostRequest("/shop/group/orderGroupInfo", params);

// 自定义营销接口
http.customPostRequest("/integral/newgate/c/integral/account/queryAccount", params);
```

三个 baseUrl 在 `config/{mp}.js` 中分别配置：
- `serverURL` → 默认网关（主接口）
- `serverURLGateWay` → 营销/神笔网关

## 6.3 API 层约定

### 目录结构

```
api/
├── shop.js        ← 店铺相关
├── goods.js       ← 商品相关
├── order.js       ← 订单相关
├── cart.js        ← 购物车
├── user.js        ← 用户相关
├── coupon.js      ← 优惠券
└── ...
```

### API 函数写法

```javascript
// api/shop.js
import http from "@/constants/request";

// 最常用：POST 请求
export const getCurShopSet = () =>
    http.postRequest("/merchant/newgate/shop/public/shopSetting/get/c");

export const getGeneralConf = (params) =>
    http.postRequest("/buyer/component/pageStyleShopSettingQry", params);

// GET 请求（较少用）
export const getShopInfo = (id) =>
    http.getRequest(`/merchant/shop/${id}`);
```

### 带业务逻辑的 API 封装（溪降挑战示例）

```javascript
// pages/canyoning/api/index.js
import http from "@/constants/request";

// 统一附加 shopId 参数
function withCanyoningCommonParams(params = {}) {
    return {
        ...params,
        shopId: params.shopId || getShopIdValue(),
    };
}

export function getCurrentCanyoningChallenge(params) {
    return http.postRequest(
        "/canyoning/customer/challenge/current",
        withCanyoningCommonParams(params)
    );
}

// 统一错误处理
export function assertCanyoningApiSuccess(response, fallback) {
    if (String(response.code) !== "0") {
        throw new Error(getCanyoningApiErrorMessage(response, fallback));
    }
}
```

## 6.4 页面中调用 API

### 基本模式

```javascript
// pages/home/home.js
import { getCurShopSet } from "@/api/shop";
import { getGoodsList } from "@/api/goods";

Page({
    data: {
        shopInfo: null,
        goodsList: [],
        loading: true
    },

    async onLoad() {
        await this.fetchShopInfo();
        await this.fetchGoodsList();
    },

    async fetchShopInfo() {
        try {
            const res = await getCurShopSet();
            if (res.code === "0") {
                this.setData({ shopInfo: res.data });
            }
        } catch (err) {
            wx.showToast({ title: "加载失败", icon: "none" });
        }
    },

    async fetchGoodsList() {
        const res = await getGoodsList({ pageNum: 1, pageSize: 10 });
        if (res.code === "0") {
            this.setData({
                goodsList: res.data.list || res.data,
                loading: false
            });
        }
    }
});
```

### 分页加载模式

```javascript
Page({
    data: {
        list: [],
        pageNum: 1,
        hasMore: true
    },

    async onLoad() {
        await this.loadData();
    },

    // 上拉加载更多
    async onReachBottom() {
        if (!this.data.hasMore) return;
        this.data.pageNum++;
        await this.loadData();
    },

    async loadData() {
        const res = await getOrderList({
            pageNum: this.data.pageNum,
            pageSize: 10
        });
        if (res.code === "0") {
            this.setData({
                list: this.data.list.concat(res.data.list),
                hasMore: res.data.list.length === 10
            });
        }
    }
});
```

## 6.5 与后端接口对接指南

### 1. 找接口 URL

所有接口 URL 定义在 `constants/api.js`（常量定义）和 `api/` 目录（函数封装）中：

```bash
# 搜索某个接口路径
grep -r "canyoning" api/ constants/
```

### 2. 看请求参数

前端通过 `Http.requestAll` 自动附加这些参数，**页面代码里不显式传**：
- `business` → 商户 ID
- `token` → Session Token
- `actionFrom` → 请求来源标识
- `appid` → 小程序 AppID
- `traceSource` → 链路追踪

### 3. 看响应格式

约定：后端返回 `{ code: "0", data: ..., msg: "" }`。

```javascript
const res = await someApi(params);
if (res.code === "0") {
    // 成功，使用 res.data
} else {
    // 失败，看 res.msg
}
```

### 4. Session Token 管理

Session 过期时 `Http` 类自动处理：

```
请求返回 3000_0001/3000_0002
  → 标记 isTokenRefreshing = true
  → 调用 wx.login 获取新 code
  → 调用后端注册接口换新 sessionToken
  → 写入 Storage
  → 重试失败请求 + 批量重试排队请求
```

页面代码**无需关心 token 过期**，`Http` 类全自动处理。

### 5. 上传文件

```javascript
wx.chooseImage({
    count: 1,
    success(res) {
        const tempFilePath = res.tempFilePaths[0];
        wx.uploadFile({
            url: baseUrl + '/goods/uploadImg',
            filePath: tempFilePath,
            name: 'file',
            header: { token: wx.getStorageSync('sessionToken') },
            success(uploadRes) {
                const data = JSON.parse(uploadRes.data);
                // data.code === "0" ...
            }
        });
    }
});
```

> 文件上传不走 `Http` 类，直接用 `wx.uploadFile`，需要手动拼 URL 和 header。
