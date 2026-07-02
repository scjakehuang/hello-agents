# 第 10 章：后端开发者快速上手

## 10.1 核心概念映射速查表

| 后端（Spring Boot） | 前端（Umi 4 + React） |
|--------------------|----------------------|
| `@RestController` | `config/config.routes.tsx` 路由配置 |
| `@RequestMapping("/api/xxx")` | `path: '/basic/scenic-manage'` |
| `@Service` | `src/services/xxx/index.ts` 中的函数 |
| `@Autowired` | `import { xxx } from '@/services/xxx'` |
| `application.yml` | `config/config.ts` |
| `application-qa.yml` | `config/define/config.define.qa.ts` |
| `Result<T>` | `{ code: "0", data: T, msg: "" }` |
| `PageHelper.startPage()` | ProTable 的 `request` 函数 |
| `@Transactional` | 不需要（前端没有事务） |
| `BeanUtils.copyProperties()` | 直接展开 `{ ...oldObj, ...newValues }` |
| `ThreadLocal` | React Context |
| `static Map<String, Object>` | Dva Model |
| Maven `mvn package` | `pnpm build-qa` |
| `target/` | `dist/` |
| `@PreAuthorize` | `src/access.ts` + 路由 `pathkey` |
| `pom.xml` | `package.json` |
| Maven reactor | Turborepo |

## 10.2 改一个功能的完整流程（后端思维）

假设你要给"景区管理"页面加一个导出功能：

### Step 1：找到页面

看 `config/config.routes.tsx`：
```typescript
{ name: '景区管理', path: '/basic/scenic-manage',
  component: '@/pages/basicInfo/scenicManage/scenicManage.tsx' }
```

### Step 2：看页面代码

打开 `src/pages/basicInfo/scenicManage/scenicManage.tsx`，找到 `toolBarRender`（工具栏按钮位置）。

### Step 3：找到对应的后端接口

看 `src/services/scenic/index.ts`，找到 `getScenicList`（列表查询接口）。导出功能如果要走已有接口，直接在这里加新函数：

```typescript
export async function exportScenicList(params: any) {
  return request('/scenic/export', {
    params,
    responseType: 'blob',          // 下载用 blob
  });
}
```

### Step 4：在页面加导出按钮

```typescript
// toolBarRender 里加
<Button onClick={handleExport}>导出</Button>

// handleExport 函数
const handleExport = async () => {
  const res = await exportScenicList(searchParams);
  // res.blob 是文件内容，res.meta.filename 是文件名
  downloadBlob(res.blob, res.meta.filename);
};
```

### Step 5：启动看效果

```bash
cd apps/ticket-pc && pnpm start
# → http://localhost:8001/#/basic/scenic-manage
```

### Step 6：提交代码

```bash
git add .
git commit -m "feat: 景区管理页面增加导出功能"
```

## 10.3 代码查找技巧

### 反查：给定后端接口 URL，找前端调用处

```bash
# 搜索接口路径
grep -r "/scenic/list" apps/ticket-pc/src/services/
```

### 反查：给定菜单名，找前端页面

直接看 `config/config.routes.tsx`，搜索菜单名称（如"景区管理"）。

### 反查：给定前端页面，找后端接口

打开页面对应的 `services/` 目录，看里面 import 了哪些 API 函数。

## 10.4 常见陷阱

### 1. 改了环境变量没重新 build

`config/define/*.ts` 中的变量是**编译时注入**的，改了必须重新 `pnpm start`（开发）或 `pnpm build-xxx`（部署）。

### 2. 路由用了驼峰

```
/basic/scenicSpotDetail  ❌  会被 toLowerCase 变成 /basic/scenicspotdetail
/basic/scenic-spot-detail ✅  正确
```

### 3. 在 render 里调用 API

```typescript
// ❌ 绝不要这样写——每次渲染都会发请求
const data = await getScenicList();

// ✅ 用 useRequest 或 useEffect + useState
const { data } = useRequest(getScenicList);
```

### 4. 忘记 loading 状态

后端不需要考虑"正在加载"，但前端必须处理：
```typescript
if (loading) return <Spin />;
if (error) return <ErrorPage />;
return <Table dataSource={data} />;
```

### 5. 使用 `==` 而不是 `===`

项目强制全等判断：
```typescript
// ❌
if (res.code == "0") {}
if (value == null) {}

// ✅
if (res.code === "0") {}
if (value === null || value === undefined) {}
```

### 6. 导入用了相对路径

```typescript
// ❌
import { xxx } from '../../../services/scenic';

// ✅
import { xxx } from '@/services/scenic';
```

## 10.5 进一步学习

- 阅读 `.cursor/rules/` 下的所有规范文件（全局 + 按任务类型）
- 找一个简单的列表页（如"分销商管理"），从头到尾读懂其文件链
- 从零仿写一个页面：列表 + 新增弹窗 + 编辑弹窗
- 看看 `src/utils/request.ts` 的拦截器，理解请求是怎么自动加 header 的
- clone 项目后在本地跑起来，用浏览器 DevTools Network 标签观察请求链路

## 10.6 关键文件索引（打印出来贴显示器旁边）

| 要做什么 | 看哪个文件 |
|---------|----------|
| 了解有哪些页面 | `config/config.routes.tsx` |
| 了解权限怎么配置 | `config/config.routes.tsx` 中 `pathkey` 字段 |
| 了解后端地址 | `config/define/config.define.{env}.ts` |
| 了解请求怎么发的 | `src/utils/request.ts` |
| 了解登录/认证 | `src/services/auth/` + `src/pages/login/` |
| 了解布局结构 | `src/layout/BasicLayout.tsx` |
| 了解全局状态 | `src/models/` |
| 了解公共组件 | `src/components/` |
| 了解编码规范 | `.cursor/rules/00-global.md` |
