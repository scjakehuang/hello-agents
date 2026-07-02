# 第 7 章：状态管理

## 7.1 选型优先级

```
useState  >  useRequest  >  React Context  >  Dva Model
（页面内部） （数据获取）   （跨组件共享）    （全局状态）
```

基本原则：**能不用 Model 就不用 Model**。

## 7.2 useState — 页面/组件内部状态

最简单的状态管理，适用于组件自己用的临时变量：

```typescript
const [modalVisible, setModalVisible] = useState(false);
const [selectedRows, setSelectedRows] = useState([]);
const [editingRecord, setEditingRecord] = useState(null);
```

## 7.3 useRequest — 服务端数据的状态管理

ahooks 的 `useRequest` 自动管理 loading / data / error 三种状态：

```typescript
const { data, loading, error, run, refresh } = useRequest(
  (id) => getOrderDetail(id),
  { manual: true }
);

// data → 请求成功后的数据
// loading → 请求进行中
// error → 请求失败
// run(id) → 手动触发
// refresh() → 用上次参数重新请求
```

相比手动 `useState + useEffect + try/catch`，代码量减少 60% 以上。

### 常用配置

```typescript
useRequest(apiFunc, {
  manual: true,           // 手动触发（默认自动）
  debounceWait: 300,      // 防抖（搜索场景）
  refreshDeps: [dep],     // 依赖变化自动刷新
  onSuccess: (data) => {},  // 成功回调
  onError: (error) => {},   // 错误回调
});
```

## 7.4 React Context — 跨组件共享

当一个状态需要被多个深层组件使用，但不需要全局可见时用 Context。

示例：票务详情页多个子组件需要共享票务信息：

```typescript
// TicketGroupDetailContext.tsx
const TicketGroupDetailContext = React.createContext<{
  ticketInfo: TicketInfo;
  refresh: () => void;
}>({ ticketInfo: {}, refresh: () => {} });

export const TicketGroupDetailProvider = ({ children }) => {
  const [ticketInfo, setTicketInfo] = useState({});
  const refresh = () => { /* 重新获取 */ };
  return (
    <TicketGroupDetailContext.Provider value={{ ticketInfo, refresh }}>
      {children}
    </TicketGroupDetailContext.Provider>
  );
};

export const useTicketGroupDetail = () => useContext(TicketGroupDetailContext);
```

## 7.5 Dva Model — 全局状态

只在 `src/models/` 下有两个 Model：

### global.ts — 全局配置

```typescript
const GlobalModel: DvaModel<GlobalModelState> = {
  namespace: 'global',
  state: {
    appInfo: { appName: '程程票' },
    pathConfigMap: {},           // 路径权限配置
  },
  reducers: {
    updatePathConfig(state, { payload }) {
      return { ...state, pathConfigMap: payload };
    },
  },
  effects: {},                   // 副作用（异步操作），本项目几乎不用
};
```

使用方式：
```typescript
// 读取
const appInfo = useSelector((state: any) => state.global.appInfo);

// 写入（dispatch）
const dispatch = useDispatch();
dispatch({ type: 'global/updatePathConfig', payload: config });
```

## 7.6 状态存放决策树

```
这个状态...
│
├─ 只有一个组件用？
│   └─ → useState
│
├─ 是服务端数据？
│   └─ → useRequest
│
├─ 需要在 2-5 个关联组件间共享？
│   └─ → React Context + Provider
│
├─ 需要整个应用都能访问？
│   └─ → Dva Model（仅用户信息、权限、全局配置）
│
└─ URL 参数？
    └─ → useSearchParams / useLocation
```

## 7.7 后端开发者类比

| 后端概念 | 前端对应 | 可见范围 |
|----------|---------|---------|
| 方法内部局部变量 | `useState` | 当前组件 |
| `@Service` 的缓存 | `useRequest` | 当前组件 |
| `ThreadLocal` | React Context | Provider 子树 |
| `static ConcurrentHashMap` | Dva Model | 整个应用 |
| 请求参数 | `useSearchParams` | URL 共享 |

> Dva Model 本质上是一个 **全局单例 Map**（key = namespace, value = state），通过 `useSelector` 读取（类似 `map.get()`），通过 `dispatch` 修改（类似 `map.put()`）。
