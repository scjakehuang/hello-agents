# 第 7 章：状态管理

## 7.1 选型优先级

```
Page.data  >  Minax Store  >  globalData  >  Storage
（页面内部）  （跨页面共享）  （应用全局）    （持久化）
```

基本原则：**能放 Page.data 就不要放 Store**。微信小程序的 `setData` 有一定性能开销，只 set 当前页面需要的字段。

## 7.2 Page.data — 页面内部状态

最基础的状态管理，适用于当前页面组件自己的数据：

```javascript
Page({
    data: {
        modalVisible: false,     // 弹窗显示
        selectedId: null,        // 当前选中项
        formData: {},            // 表单数据
        loading: true            // 加载状态
    },

    showModal(id) {
        this.setData({
            modalVisible: true,
            selectedId: id
        });
    },

    hideModal() {
        this.setData({ modalVisible: false });
    }
});
```

> `this.setData()` 是**异步**的（微信底层做了批量合并），不要 `setData` 后立即读 `this.data.xxx`，应该在回调里处理：
> ```javascript
> this.setData({ count: 1 }, () => {
>     console.log(this.data.count);  // "1"，此时已生效
> });
> ```

## 7.3 Minax Store — 跨页面/组件共享

### 是什么

Minax 是项目自研的**轻量级 Vuex 风格状态管理库**（`minax.js`，约 200 行），提供：
- 全局单例 state
- `commit(type, payload)` 修改状态
- `mapState` 声明式订阅
- 自动 `setData` 同步
- 可选 localStorage 持久化

### Store 定义（`store/index.js`）

```javascript
const store = new Store({
    state: {
        themeStyle: '',           // CSS 变量字符串（--main-color: #xxx）
        themeStyleObj: {},        // 主题色对象 { mainColor, subColor }
        cartNum: 0,               // 购物车数量
        general: {},              // 通用店铺配置
        navConf: null,            // 底部导航配置
        tabIndex: 0,              // 当前 Tab 下标
        useShopId: null           // 当前店铺 ID
    }
});

export default store;
```

### 在页面/组件中使用

```javascript
// 页面中使用
Page({
    mapState: ["themeStyle", "cartNum"],  // 声明订阅的状态

    onLoad() {
        // this.data.themeStyle 自动同步
        // this.data.cartNum 自动同步
    },

    addToCart() {
        // 修改状态：调用 commit
        this.$store.commit("cartNum", this.data.cartNum + 1);
    }
});

// 组件中使用
Component({
    mapState: ["themeStyle", "tabIndex"],

    methods: {
        onTabChange(index) {
            this.$store.commit("tabIndex", index);
        }
    }
});
```

### 带持久化的 commit

```javascript
// store/index.js 中定义
{
    cartNum(state, payload) {
        state.cartNum = payload;
        // persistence: true → 自动写入 localStorage
    }
}
```

### Minax 工作原理（简化）

```
1. App/Page/Component 被 Minax.install() 包装
2. mapState 声明订阅 → 注册到 store.registerQueue
3. commit(type, payload) 被调用：
   a. 更新 state[type] = newValue
   b. 遍历 registerQueue[type] → 对每个订阅者调 setData({ themeStyle: newValue })
4. 所有订阅该字段的页面/组件自动更新
```

## 7.4 globalData — 应用全局数据

放在 `app.js` 的 `globalData` 中，从 `constants/index.js` 导入：

```javascript
// constants/index.js
export const globalData = {
    appid: '',
    userIsAuth: false,
    roleInfo: { buyer: false, owner: false, seller: false },
    shopInfo: { shopId: '', shopName: '', shopLogo: '' },
    fromShopId: '',
    shopSetting: {},
    historyShopList: [],
    diyData: null,
    shopCartData: [],
    subscribers: [],  // token 刷新请求队列
};
```

使用：

```javascript
const app = getApp();

// 读
const shopId = app.globalData.shopInfo.shopId;

// 写（注意：不会自动更新 UI，需要手动 setData）
app.globalData.shopCartData.push(newItem);
```

> `globalData` 不走 Minax 的响应式系统，修改后**不会自动更新 UI**。主要用于存储应用级常量（用户身份、初始化状态等），不频繁变更的数据。

## 7.5 Storage — 本地持久化

微信 `wx.setStorageSync` / `wx.getStorageSync`，用于需要跨会话保留的数据：

```javascript
// 写入（同步，慎用大数据）
wx.setStorageSync("sessionToken", token);
wx.setStorageSync("userRole", roleData);

// 读取（同步）
const token = wx.getStorageSync("sessionToken");
const role = wx.getStorageSync("userRole");

// 删除
wx.removeStorageSync("sessionToken");
```

> Storage 上限 10MB，同步读写会阻塞 JS 线程，大数据建议用异步版本 `wx.setStorage` / `wx.getStorage`。

## 7.6 状态存放决策树

```
这个状态...
│
├─ 只有当前页面用？
│   └─ → Page.data
│
├─ 多个页面/组件都需要，且要自动更新 UI？
│   └─ → Minax Store (mapState)
│
├─ 多个地方访问，但不需要自动更新 UI？
│   └─ → globalData
│
├─ 需要持久化（下次打开小程序还在）？
│   └─ → wx.setStorageSync
│
└─ 只在模板里格式化数据？
    └─ → WXS（模板层脚本）
```

## 7.7 后端开发者类比

| 后端概念 | 小程序对应 | 可见范围 | 自动更新 UI |
|----------|-----------|---------|------------|
| 方法局部变量 | `Page.data` | 当前页面 | `setData` 触发 |
| `ThreadLocal` | `globalData` | 整个应用 | ❌ 手动 |
| `static ConcurrentHashMap` | Minax Store | 任意页面/组件 | ✅ 自动 setData |
| Redis | `wx.Storage` | 任何会话 | ❌ 需重新读取 |
