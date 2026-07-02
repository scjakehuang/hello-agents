# React 语法精讲（以 systemRole 页面为教材）

> 目标读者：懂 Java/Spring Boot，但不太了解 React 的后端开发者。
> 讲解方式：每个语法点先给"后端类比"，再结合 systemRole 页面的真实代码讲解。

## 目录

1. [TSX/JSX 语法：HTML 写在 JS 里](#1-tsxjsx-语法html-写在-js-里)
2. [函数组件：React 的"类"](#2-函数组件react-的类)
3. [useState：组件内部变量](#3-usestate组件内部变量)
4. [useRef：不会被刷新掉的变量](#4-useref不会被刷新掉的变量)
5. [useEffect：构造方法 + 依赖监听](#5-useeffect构造方法--依赖监听)
6. [useMemo：缓存计算结果](#6-usememo缓存计算结果)
7. [Props：组件的"方法参数"](#7-props组件的方法参数)
8. [父子组件通信的三种模式](#8-父子组件通信的三种模式)
9. [forwardRef + useImperativeHandle：子组件暴露方法给父组件调用](#9-forwardref--useimperativehandle子组件暴露方法给父组件调用)
10. [ahooks 生态：useRequest 和 useAntdTable](#10-ahooks-生态userequest-和-useantdtable)

---

## 1. TSX/JSX 语法：HTML 写在 JS 里

### 后端类比

Java 里你在 Controller 返回一个 HTML 模板（Thymeleaf/JSP），React 是直接把 HTML 写在 TypeScript 函数里：

```java
// Java: 模板在单独文件
@GetMapping("/hello")
public String hello(Model model) {
    model.addAttribute("name", "张三");
    return "hello";  // 返回 hello.html 模板
}
```

```tsx
// React: HTML 和逻辑在同一个函数里
function HelloPage() {
  const name = "张三";
  return <div>你好，{name}</div>;  // {name} 是变量插值，类似 Thymeleaf 的 ${name}
}
```

### 关键语法规则

| 语法 | 含义 | 示例 |
|------|------|------|
| `{变量}` | 把 TS 变量的值嵌入 HTML | `<span>{userName}</span>` |
| `{条件 && <标签>}` | 条件渲染 | `{editVisible && <Modal>...</Modal>}` |
| `{条件 ? <A/> : <B/>}` | if-else 渲染 | `{state === 'ENABLE' ? '正常' : '禁用'}` |
| `className` | CSS class（JS 里 class 是保留字） | `<div className={styles.header}>` |
| `onClick` | 点击事件（驼峰命名） | `<Button onClick={handleClick}>` |
| `/* 注释 */` | JSX 里注释必须用花括号包 | `{/* 这是注释 */}` |

### systemRole 页面实例

```tsx
// index.tsx 的 return 语句（195-238 行）
return (
  <div className={styles.pageContainer}>      // ← className 不是 class
    <div className={styles.header}>
      <QueryFilter
        loading={tableLoading}                // ← {变量} 传值
        form={form}
        items={windowSaleFilterItems}
        onFilterChange={onFilterChange}       // ← 传回调函数
      />
    </div>

    <WindowSaleTable
      tableLoading={tableLoading}
      headerActions={headerActions}           // ← headerActions 是个数组
    />

    {editVisible && (                          // ← 条件渲染：editVisible=true 才渲染
      <WindowSaleEditModal
        visible={editVisible}
        editRecord={editTransferRecord}
        handleClose={handleCloseEditModal}
      />
    )}
  </div>
);
```

**核心理解：你在 `return` 里写的那些 `<XXX>` 标签，本质上是对 `React.createElement('XXX', props)` 的语法糖。** 最终都会变成浏览器里的真实 DOM 节点。

---

## 2. 函数组件：React 的"类"

### 后端类比

```java
// Java: 一个 Controller 类
@RestController
public class ScenicController {
    @GetMapping("/scenic/list")
    public Result listScenic() { ... }
}
```

```tsx
// React: 一个组件就是 一个函数
function WindowSaleIndex() {    // ← 函数名 = 组件名（PascalCase 首字母大写）
  // ... 状态、逻辑 ...
  return <div>...</div>;        // 返回要渲染的 HTML
}

export default WindowSaleIndex; // 导出给外部使用，类似 public class
```

### 关键规则

1. **组件名必须首字母大写**（`WindowSaleIndex` 不是 `windowSaleIndex`），React 靠大小写区分"组件"和"原生 HTML 标签"
2. **每个组件文件最多只有一个 `export default`**（主导出），可以有多余 `export`（命名导出，类似工具方法）
3. **return 的 HTML 必须被单一根节点包裹**（或者用空标签 `<>...</>` 包裹）

---

## 3. useState：组件内部变量

### 后端类比

```java
// Java: 方法里的局部变量
public void doSomething() {
    boolean modalVisible = false;   // 每次调用方法都会重新初始化为 false
    // ...
    modalVisible = true;            // 改了没用，下次调用还是 false
}
```

Java 的方法是无状态的——每次调用都是新的变量。React 组件需要**记住**变量在多次渲染之间的值。`useState` 就是做这件事的。

### 语法

```typescript
const [值, 设值函数] = useState(初始值);
//      ↑    ↑
//    读    写（改了会触发重新渲染）
```

### systemRole 页面实例

```typescript
// index.tsx 第 28-29 行
const [editVisible, setEditVisible] = useState<boolean>(false);
const [createVisible, setCreateVisible] = useState<boolean>(false);

// 读：直接当变量用
{editVisible && (                    // 第 220 行：editVisible === true 时渲染编辑弹窗
  <WindowSaleEditModal ... />
)}

// 写：调用 set 函数，会触发页面重新渲染
function handleOpenEditAccessTransfer() {
  setEditVisible(true);              // 第 145 行：设 true → 弹窗出现
}
function handleCloseEditModal() {
  setEditVisible(false);             // 第 149 行：设 false → 弹窗消失
  seteditTransferRecord(null);       // 同时清空编辑记录
}
```

### 核心理解

```
setEditVisible(true)
  → React 检测到状态变化
  → 重新执行整个 WindowSaleIndex 函数
  → 这次 editVisible 的值就是 true
  → return 里 {editVisible && <Modal>} 就会渲染 Modal
```

**就是说：你不用手动操作 DOM（show/hide），你只管改数据，React 根据数据自动决定 DOM 该怎么变。** 这是 React 最核心的思维方式——**数据驱动 UI**。

---

## 4. useRef：不会被刷新掉的变量

### 后端类比

```java
// Java: 类的成员变量，而不是方法局部变量
public class WindowSaleService {
    private Promise currentPromise;  // 存活周期 = 对象存活周期
    // 不像局部变量在方法结束后销毁
}
```

`useRef` 创建的变量：

- 存在一个 `.current` 属性里
- 改了 `.current` **不会触发重新渲染**（跟 useState 的区别）
- 重新渲染后 `.current` 的值**不会丢失**（跟普通局部变量的区别）

### systemRole 页面实例

```typescript
// index.tsx 第 24-25 行
const bindWindowModalRef = useRef<any>(null);
const bindLogModalRef = useRef<any>(null);

// 使用：bindWindowModalRef.current 是子组件暴露出来的对象
bindWindowModalRef.current?.open(record).then(() => {  // 第 124 行
  message.success('绑定成功');
  refresh();
});
```

这里 `useRef` 存的是**子组件通过 `useImperativeHandle` 暴露出来的方法的引用**——类似 Java 里拿到了另一个对象的引用。

### useRef vs useState

| | useState | useRef |
|------|----------|--------|
| 改值触发重渲染 | ✅ 会 | ❌ 不会 |
| 重渲染后值还在 | ✅ | ✅ |
| 典型场景 | UI 相关的变量（弹窗开关、表单数据） | DOM 引用、定时器 ID、子组件引用 |

```typescript
// WindowBindModal.tsx 第 38 行
const promiseRef = useRef<any>(null);

// 存一个 Promise 的 resolve 函数，之后在弹窗关闭时调用
promiseRef.current = { resolve };
// 用 useRef 而不用 useState，因为不需要触发重渲染
```

---

## 5. useEffect：构造方法 + 依赖监听

### 后端类比

```java
// Java: @PostConstruct 构造后执行 + 监听器模式
@PostConstruct              // 组件首次渲染后
public void init() { ... }

// 或者
@EventListener(value = SomeEvent.class)  // 某个值变化后执行
public void onDataChanged(SomeEvent event) { ... }
```

### 语法

```typescript
useEffect(() => {
  // 副作用代码
  return () => { /* 清理函数（可选）：组件卸载时执行 */ };
}, [依赖1, 依赖2]);  // 依赖数组：任一依赖变化就重新执行
```

### systemRole 页面实例

```typescript
// WindowSaleEditModal.tsx 第 162-169 行
const [currentRecord, setCurrentRecord] = useState<WindowSaleRecordType | null>(editRecord);

useEffect(() => {
  // 当 editRecord 变化时，同步更新 currentRecord
  if (editRecord) {
    setCurrentRecord({ ...editRecord });
  } else {
    setCurrentRecord(null);
  }
}, [editRecord]);  // ← 依赖项：只有 editRecord 变了才执行
```

这段代码的意思：父组件传进来的 `editRecord` 变了 → 子组件自己的 `currentRecord` 也跟着更新。

### 三种依赖数组形式

```typescript
useEffect(() => { ... });           // 没有依赖数组：每次渲染都执行（几乎不用）
useEffect(() => { ... }, []);       // 空数组：只在首次渲染后执行一次（类似 @PostConstruct）
useEffect(() => { ... }, [a, b]);   // 有依赖：a 或 b 变化才执行
```

---

## 6. useMemo：缓存计算结果

### 后端类比

```java
// Java: 缓存计算结果，依赖不变就不重新算
private Map<String, Object> cache;

public Object getHeavyComputationResult(String key) {
    if (cache.containsKey(key)) {
        return cache.get(key);      // 命中缓存，跳过计算
    }
    Object result = heavyComputation(key);
    cache.put(key, result);
    return result;
}
```

### systemRole 页面实例

```typescript
// WindowSaleTable.tsx 第 19-113 行
const tableColumns: ColumnsType<WindowSaleRecordType> = useMemo(
  () => [           // ← 箭头函数返回一个数组
    { title: '账号', key: 'account', dataIndex: 'account', width: 100 },
    { title: '手机号', key: 'phone', dataIndex: 'phone', width: 100 },
    // ... 更多列定义
  ],
  [],               // ← 空依赖数组 = 只算一次，永不重新计算
);
```

列定义在组件的整个生命周期里不会变，用 `useMemo` + 空依赖数组 `[]` 缓存起来，避免每次渲染都创建新数组。

```typescript
// 第 124-134 行：另一个 useMemo，依赖 columnConfig
const totalScrollx = useMemo(() => {
  let x = tableColumns.reduce((a, item) => {
    let itemConfig = columnConfig.find((i: any) => i.key === item.key);
    if (!itemConfig?.visible) return a;        // 隐藏的列不计算宽度
    return a + ((item.width || 150) as number);
  }, 0);
  return x;
}, [columnConfig]);     // ← columnConfig 变了才重新算 totalScrollx
```

用户可以在 OkpTable 里动态显示/隐藏列，`totalScrollx` 需要根据可见列重新计算。

---

## 7. Props：组件的"方法参数"

### 后端类比

```java
// Java: 方法参数
public void showModal(boolean visible, String title, Runnable onClose) {
    // visible → 控制显隐
    // title → 标题
    // onClose → 关闭时回调
}
```

```tsx
// React: Props 就是组件的参数列表
<WindowSaleCreateModal
  visible={createVisible}          // 参数1：是否可见
  handleClose={() => setCreateVisible(false)}  // 参数2：关闭回调
  onCreate={handleCreateWindowSale}            // 参数3：创建成功回调
/>
```

### Props 的类型定义（TypeScript 接口）

```typescript
// WindowSaleCreateModal.tsx 第 10-14 行
interface WindowSaleCreateModalProps {
  visible: boolean;                    // 接收一个 boolean
  handleClose: () => void;            // 接收一个无参无返回的函数
  onCreate: () => void;               // 接收一个无参无返回的函数
}

function WindowSaleCreateModal(props: WindowSaleCreateModalProps) {
  // props.visible / props.handleClose / props.onCreate
}

// 或者用解构语法（等价于上面）
function WindowSaleCreateModal({ visible, handleClose, onCreate }: WindowSaleCreateModalProps) {
  // 直接用 visible, handleClose, onCreate
}
```

### 核心理解

Props 是**单向数据流**——只能从父组件传给子组件，子组件不能修改 props。子组件要"改变"父组件的状态，只能调父组件传下来的**回调函数**。

```
interface 定义 = Java 的 DTO class
props 对象    = Java 的方法参数对象
回调函数      = Java 的 @EventListener / Consumer<T>
```

---

## 8. 父子组件通信的三种模式

systemRole 页面展示了三种 React 中父子通信的标准模式：

### 模式一：Props 传事件回调（父→子，子通知父）

```
父组件                                     子组件
  │                                          │
  │  onColumnAction={handleTableAction}  ──→ │ 调用 onColumnAction('edit', record)
  │  ← 父的 handleTableAction 被执行          │
```

```typescript
// 父 (index.tsx 第 103 行)
function onTableColumnAction(action: string, record: WindowSaleRecordType) {
  if (action === 'edit') { handleOpenEditAccessTransfer(record); }
  if (action === 'delete') { /* 删除逻辑 */ }
}

// 子 (WindowSaleTable.tsx 第 114-118 行)
const handleTableAction = (type: string, record: WindowSaleRecordType) => {
  onColumnAction?.(type, record);  // ← 调父组件传下来的函数
};
```

**适用场景：** 子组件只负责触发，具体逻辑由父组件决定。

### 模式二：useState 提升（状态在父，子通过 Props 控制）

```
父组件持有 visible 状态，子组件通过 props 接收只读值
  editVisible ──→ 子组件 visible prop（子只能读，不能改）
  子组件调用 prop.handleClose() → 父组件 setEditVisible(false)
```

```typescript
// 父 (index.tsx 第 28-29 行 + 220-226 行)
const [editVisible, setEditVisible] = useState(false);

{editVisible && (
  <WindowSaleEditModal
    visible={editVisible}                 // 子组件只能读
    handleClose={handleCloseEditModal}    // 子组件调这个来关闭
  />
)}

// 子 (WindowSaleEditModal.tsx)
// visible 和 handleClose 都是 props，子组件不能改 visible，只能调 handleClose
```

**适用场景：** Modal/Drawer 的开关、表单提交后通知父刷新。

### 模式三：forwardRef + useImperativeHandle（父直接调子的方法）

```
父组件                                     子组件
  │                                          │
  │  ref.current?.open(record)   ──────────→ │ open() 方法执行
  │  ← 返回 Promise，resolve 时父知道完成了   │   → 弹窗打开
  │                                          │   → 业务逻辑
  │  .then(() => { refresh(); })             │   → Promise resolve
```

这是三种模式中最复杂、但也最灵活的一种。下一节单独讲。

---

## 9. forwardRef + useImperativeHandle：子组件暴露方法给父组件调用

### 后端类比

```java
// Java: 你拿到了另一个 Service 的引用，直接调它的方法
@Service
public class WindowBindService {
    public CompletableFuture<Void> open(Record record) {
        // 打开弹窗、处理业务
        return future;
    }
}

// 别的地方直接用
@Autowired
WindowBindService bindService;
bindService.open(record).thenRun(() -> refresh());
```

React 默认父组件**不能**直接调子组件的方法。但通过 `forwardRef` + `useImperativeHandle`，可以暴露特定方法。

### 完整语法

**子组件（WindowBindModal.tsx）：**

```typescript
// 1. 定义暴露出去的方法类型（接口）
export interface WindowBindModalRef {
  open: (record?: any) => Promise<void>;    // 打开弹窗，返回 Promise
}

// 2. 用 forwardRef 包裹组件
const WindowBindModal = forwardRef<WindowBindModalRef, WindowBindModalProps>((props, ref) => {
  // 普通组件只有 props，forwardRef 多一个 ref 参数
  //                                   ↑      ↑          ↑
  //                          暴露的方法类型  接收的props  这是ref参数

  const [visible, setVisible] = useState(false);

  // 3. 用 useImperativeHandle 把方法绑定到 ref 上
  useImperativeHandle(ref, () => ({
    open: async (record?: any) => {
      // 打开弹窗、加载数据
      setVisible(true);
      // ...
      // 返回 Promise，父组件可以 await/.then
      return new Promise((resolve) => {
        promiseRef.current = { resolve };
      });
    },
  }));

  return <Modal open={visible}>...</Modal>;
});

// 4. 必须设置 displayName（调试用）
WindowBindModal.displayName = 'WindowBindModal';
```

**父组件（index.tsx）：**

```typescript
// 1. 创建 ref
const bindWindowModalRef = useRef<any>(null);

// 2. 把 ref 传给子组件
<WindowBindModal ref={bindWindowModalRef} />

// 3. 通过 ref.current 调子组件方法
bindWindowModalRef.current?.open(record).then(() => {
  message.success('绑定成功');
  refresh();                       // 弹窗关闭后刷新列表
});
```

### 关键理解

- `useRef` 创建了一个"盒子"，`{ current: null }`
- `ref={bindWindowModalRef}` 把盒子传给子组件
- 子组件用 `useImperativeHandle` 往盒子里装方法 `{ current: { open: fn } }`
- 父组件通过 `ref.current.open()` 调用

**内存模型：**

```
父组件                               子组件 WindowBindModal
  bindWindowModalRef ──────────────→ useImperativeHandle
  { current: { open: f1 } }           把 { open: f1 } 塞进 ref.current
```

---

## 10. ahooks 生态：useRequest 和 useAntdTable

ahooks 是阿里出品的一套 React Hooks 工具库。systemRole 页面用了两个核心 hook。

### useRequest：管理异步请求的状态

**不用 useRequest 时（裸写）：**

```typescript
const [loading, setLoading] = useState(false);
const [error, setError] = useState(null);

async function handleSubmit(values: any) {
  setLoading(true);
  try {
    const res = await RegisterWindowSale(values);
    if (res.code === '0') {
      message.success('创建成功');
      onCreate();
      handleClose();
    } else {
      message.error(res.msg);
    }
  } catch (err) {
    setError(err);
  } finally {
    setLoading(false);
  }
}
```

**用 useRequest 后（systemRole 的真实代码，第 20-35 行）：**

```typescript
const { loading, run } = useRequest(
  async (values: WindowSaleRecordType) => {
    return RegisterWindowSale(values);   // 实际执行的异步函数
  },
  {
    manual: true,                        // 手动触发（默认会首次自动执行）
    onSuccess: () => {                   // 成功后回调
      message.success('创建成功');
      onCreate();
      handleClose();
    },
    onError: (error) => {                // 失败后回调
      message.error(`创建失败: ${error.message}`);
    },
  },
);

// 调用：run(values) → 自动管理 loading/error 状态
<Button loading={loading} onClick={() => form.submit()}>保存</Button>
```

**`useRequest` 干了什么：**

| 你写 | useRequest 自动管理 |
|------|-------------------|
| `loading` 变量 + `setLoading(true/false)` | ✅ 自动 |
| `error` 变量 + `setError(err)` | ✅ 自动 |
| try/catch 包裹 | ✅ 自动 |
| 组件卸载时取消请求 | ✅ 自动（防止内存泄漏） |

### useAntdTable：管理分页表格的请求

这是 `useListDataTable` 的底层依赖（项目二次封装成了 `useListDataTable`）。

**不用 useAntdTable 时你需要管理：**

```typescript
// 需要手写所有这些
const [current, setCurrent] = useState(1);    // 当前页
const [pageSize, setPageSize] = useState(10); // 每页条数
const [list, setList] = useState([]);         // 数据
const [total, setTotal] = useState(0);        // 总数
const [loading, setLoading] = useState(false);

// 查第一页
async function goPage1(filters) { ... }
// 翻页
async function onChange(page, size) { ... }
// 搜索
async function onSearch(values) { ... }
// 重置
function onReset() { ... }
```

**用 useAntdTable（项目封装成 useListDataTable）后（index.tsx 第 30-39 行）：**

```typescript
const {
  loading: tableLoading,        // 加载中
  tableProps,                    // 表格所需的全部 props（dataSource/pagination/onChange）
  search,                        // { submit(), reset() } 搜索控制
  refresh,                       // 保持当前分页刷新
} = useListDataTable<WindowSaleRecordType>(
  ListWindowSale,                // 只传 API 函数
  {
    defaultPageSize: 10,        // 每页 10 条
    form,                        // 绑定的搜索表单
    formDataCallback: normlizeFilterValues,  // 请求前数据格式化
  }
);

// 使用：直接展开传给任何表格
<OkpTable
  loading={tableLoading}
  {...tableProps}           // 包含了 dataSource + pagination + onChange，全部帮你管好了
/>

// 搜索/重置
search.submit();            // 触发查询（第一页）
search.reset();             // 重置查询条件 + 回第一页
refresh();                  // 保持当前页重新查
```

**`useListDataTable` 还自动处理了：**

1. 后端返回格式适配（`data.list` 或 `data.data` 都兼容）
2. `code !== '0'` 时自动 `message.error` 提示
3. 删除最后一条后自动回跳到上一页（`smartRefresh`）

---

## 总结：Backend → React 概念速查表

| 后端概念 | React 对应 | 语法 |
|---------|-----------|------|
| 类成员变量 | `useState` | `const [x, setX] = useState(0)` |
| 不会被 GC 的变量引用 | `useRef` | `const ref = useRef(null); ref.current` |
| `@PostConstruct` | `useEffect(fn, [])` | 空依赖数组 = 只执行一次 |
| 缓存计算结果 | `useMemo` | `const v = useMemo(() => calc(), [dep])` |
| 方法参数 DTO | Props interface | `interface Props { name: string }` |
| 调另一个 Service 的方法 | `forwardRef` + `useImperativeHandle` | `ref.current.method()` |
| `Consumer<T>` 回调 | Props 传回调函数 | `onSuccess={() => ...}` |
| `@EventListener` | 事件回调 Props | `onColumnAction(action, record)` |
| try-catch + loading flag | `useRequest` | `const { loading, run } = useRequest(fn)` |
| PageHelper + 分页封装 | `useAntdTable` / `useListDataTable` | 一个 hook 搞定全部 |
