# 第 10 章：后端开发者快速上手

## 10.1 核心概念映射速查表

| 后端（Spring Boot） | 小程序前端 |
|--------------------|----------|
| `@RestController` | `pages/xxx/xxx.js` 中的 `Page({})` |
| `@RequestMapping("/api/xxx")` | `app.json` 中 `pages` / `subpackages` 数组 |
| `@Service` | `service/` 目录 |
| `Feign Client` | `api/` 目录中的函数 |
| `@Autowired` | `import { xxx } from "@/api/xxx"` |
| `application.yml` | `config/{mp}.js` |
| `application-qa.yml` | `config/{mp}.js` → `NetURL.Test` |
| `Result<T>` | `{ code: "0", data: T, msg: "" }` |
| `PageHelper.startPage()` | `pageNum` / `pageSize` 参数 + `onReachBottom` |
| `Interceptor` | `constants/request.js` (Http.requestAll) |
| `ThreadLocal` | `globalData` (app.js) |
| `static Map<String, Object>` | Minax Store (`store/index.js`) |
| Maven `mvn package` | `node build.js mp=TC` |
| `target/` | 微信开发者工具上传 |
| `pom.xml` | `package.json` |

## 10.2 改一个功能的完整流程（后端思维）

假设你要给溪降挑战模块加一个"分享排行榜"的功能：

### Step 1：找到页面

有两种方式：
- 看 `config/app.base.json` 的 `subpackages` → 找 `canyoning` 分包 → 找 `leaderboard/index`
- 直接搜目录：`ls pages/canyoning/leaderboard/`

### Step 2：看页面代码

打开 `pages/canyoning/leaderboard/index.js`，理解现有逻辑：数据怎么来的、怎么展示的、有哪些事件处理。

### Step 3：找到对应的 API 调用

```bash
# 搜排行榜相关接口
grep -r "leaderboard" pages/canyoning/api/
```

输出：
```javascript
// pages/canyoning/api/index.js
export function getCanyoningLeaderboardList(params) {
    return http.postRequest(LEADERBOARD_LIST_PATH, withCanyoningCommonParams(params));
}
```

### Step 4：如果是新接口，在 api 层加新函数

```javascript
// pages/canyoning/api/index.js
const SHARE_LEADERBOARD_PATH = "/canyoning/customer/leaderboard/share";

export function shareCanyoningLeaderboard(params) {
    return http.postRequest(SHARE_LEADERBOARD_PATH, withCanyoningCommonParams(params));
}
```

### Step 5：在页面加分享入口

```xml
<!-- pages/canyoning/leaderboard/index.wxml -->
<van-button bind:tap="handleShare">分享排行榜</van-button>
```

```javascript
// pages/canyoning/leaderboard/index.js
async handleShare() {
    const res = await shareCanyoningLeaderboard({ activityId: this.activityId });
    if (res.code === "0") {
        // 拿到分享图片 URL，调起微信分享
        wx.showShareImageMenu({ path: res.data.shareImage });
    }
}
```

### Step 6：构建并预览

```bash
node build.js mp=TC
# 在微信开发者工具中打开项目 → 编译 → 预览
```

### Step 7：提交代码

```bash
git add .
git commit -m "feat: 溪降挑战排行榜增加分享功能"
```

## 10.3 代码查找技巧

### 反查：给定后端接口 URL，找前端调用处

```bash
# 搜索接口路径
grep -r "canyoning/customer/challenge/current" pages/ api/ constants/
```

### 反查：给定页面功能，找对应后端接口

打开页面对应的 API 文件（`pages/{模块}/api/index.js` 或 `api/{域}.js`），看 import 了哪些 endpoint。

### 反查：给定菜单/按钮名，找前端页面

```bash
grep -r "排行榜" pages/ --include="*.wxml" --include="*.js"
```

## 10.4 常见陷阱

### 1. 改了环境配置没重新 build

`config/{mp}.js` 中的变量在 `build.js` 构建时写入 `config/index.js`，改了配置必须重新 `node build.js`。

### 2. setData 后立即读 data

```javascript
// ❌ 错误：setData 是异步的
this.setData({ count: 1 });
console.log(this.data.count);  // 可能是旧值

// ✅ 正确：用回调
this.setData({ count: 1 }, () => {
    console.log(this.data.count);  // "1"
});
```

### 3. setData 传大数据

```javascript
// ❌ 错误：把整个列表重新 setData
this.setData({ list: hugeList });  // 性能问题

// ✅ 正确：只 set 变化的部分
this.setData({ [`list[${index}].status`]: 'done' });
```

### 4. 忘记 loading / error 状态

```xml
<!-- ❌ 页面直接渲染 -->
<view>{{detail.name}}</view>

<!-- ✅ 处理加载和错误 -->
<mall-loading wx:if="{{loading}}" />
<view wx:elif="{{error}}" class="error">加载失败</view>
<view wx:else>{{detail.name}}</view>
```

### 5. 在模板里做复杂逻辑

```xml
<!-- ❌ 错误：WXML 里嵌套三元运算 -->
<view>{{a ? (b ? c : d) : (e ? f : g)}}</view>

<!-- ✅ 正确：在 JS 里算好再 setData -->
this.setData({ display: computeDisplay(a, b, c, d, e, f, g) });
```

### 6. 本地未"构建 npm"

新装依赖后，忘记在微信开发者工具中"工具 → 构建 npm"，导致 `@vant/weapp` 组件全部报错找不到。

### 7. 页面栈溢出（> 10 层）

微信限制页面栈最多 10 层，超过后会静默失败。如果发现某个页面 `navigateTo` 不生效，检查是否有反复跳转不返回的逻辑。使用 `utils/router.js` 的 `navigateTo` 方法会自动降级为 `redirectTo`。

## 10.5 关键文件索引

| 要做什么 | 看哪个文件 |
|---------|----------|
| 了解有哪些页面 | `config/app.base.json` → `pages` + `subpackages` |
| 了解小程序差异 | `config/{mp}.js` |
| 了解后端地址 | `config/{mp}.js` → `NetURL.{env}` |
| 了解请求怎么发的 | `constants/request.js` |
| 了解所有接口端点 | `constants/api.js` |
| 了解登录/认证 | `service/user.js` |
| 了解初始化流程 | `service/index.js` → `initPromise` |
| 了解全局状态 | `store/index.js` |
| 了解全局变量 | `constants/index.js` → `globalData` |
| 了解公共组件 | `components/` |
| 了解构建流程 | `build.js` |
| 了解项目说明 | `README.md`、`AGENTS.md` |

## 10.6 进一步学习

- 找一个简单页面（如 `pages/jqUser/jqUser.js`），从头到尾读懂其文件链
- 从零仿写一个功能模块：列表页面 + 下拉刷新 + 上拉加载更多
- 看 `constants/request.js` 的 `requestAll` 方法，理解 Session Token 自动刷新的队列机制
- 看 `minax.js` 理解状态管理如何劫持 `App/Page/Component` 注入 `$store`
- 用微信开发者工具打开项目，在 Network 面板观察请求链路
