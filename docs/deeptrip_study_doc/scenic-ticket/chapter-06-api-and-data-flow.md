# 第 6 章：API 请求与数据流

## 6.1 请求链路

```
页面组件 (pages/)
    │ 调用 useRequest / 手动调用
    ▼
Service 层 (services/)
    │ import request from '@/utils/request'
    ▼
Request 实例 (utils/request.ts)
    │ request interceptor: 附加 token/business/actionFrom
    ▼
HTTP 请求 → 网关 → 后端服务
    │ response interceptor: 处理 session 过期、blob 下载
    ▼
页面拿到 Response → 更新 UI
```

## 6.2 请求库：umi-request

**不用 axios，不用 fetch**，统一用项目封装的 `umi-request`。

### 核心配置（`src/utils/request.ts`）

```typescript
const request = extend({
  prefix: `${BASE_API_URL}`,      // 默认请求前缀
  errorHandler,                    // 全局错误处理
  credentials: 'omit',
});
```

### 请求拦截器：自动附加通用参数

```typescript
request.interceptors.request.use((url, { data, params, headers, ...restOptions }) => {
  const userToken = GetSessionToken();
  const commonBusinessId = GetAppLocalStorageItem('business') || AppBusinessId;

  // 自动合并通用请求参数
  const reqData = {
    templateId: 0,
    business: commonBusinessId,
    actionFrom: AppActionFrom,
    ...data,                          // 页面传入的数据
    pageNumber: undefined,            // 统一分页参数处理
    pageNum: pageNumber,
  };

  return {
    url: ...,
    options: {
      ...restOptions,
      data: { ...reqData },
      headers: {
        userToken: userToken || '',          // 用户 token
        'access-token': userToken || '',     // 兼容老接口
        business: commonBusinessId,          // 商户 ID
        actionFrom: AppActionFrom,           // 请求来源
        Authorization: 'Bearer ' + ...,      // OAuth token（部分接口）
        ...headers,
      },
    },
  };
});
```

这意味着 **页面调用 API 时不需要手动传 business / pageNumber / userToken**，拦截器自动处理。

### 响应拦截器：自动处理登录过期

```typescript
const SESSIONTOKEN_EXPIRED_CODES = [
  '4000_0401', '4000_0483', '1000_0012', '3000_0001',
  '1000_0003', '1000_0002', 'BIZ_401', 'USER_NOT_IN_WHITE_LIST', '401',
];

request.interceptors.response.use(async (response) => {
  const data = await response.clone().json();
  if (SESSIONTOKEN_EXPIRED_CODES.includes(data.code)) {
    redirectLogin();  // 清除 token + 跳到登录页
  }
  return response;
});
```

## 6.3 Service 层约定

### 目录结构

```
src/services/
├── common.ts              ← 通用接口（无模块归属）
├── auth/                  ← 登录/认证
│   └── index.ts
├── scenic/                ← 景区相关
│   └── index.ts
├── ticketsCenter/         ← 票务相关
│   └── index.ts
└── ...
```

### API 函数写法

```typescript
// services/scenic/index.ts
import request from '@/utils/request';

// GET 请求
export async function getScenicInfo(id: string) {
  return request(`/scenic/info`, { params: { id } });
}

// POST 请求（默认）
export async function createScenic(data: any) {
  return request('/scenic/create', { method: 'POST', data });
}

// 文件上传
export async function uploadScenicImage(formData: FormData) {
  return request('/scenic/upload', { method: 'POST', data: formData });
}

// 导出/下载
export async function exportScenicReport(params: any) {
  return request('/scenic/export', {
    params,
    responseType: 'blob',         // 关键：让拦截器走 blob 处理分支
  });
}
```

## 6.4 页面中调用 API

### 方式一：ahooks useRequest（推荐）

```typescript
import { useRequest } from 'ahooks';
import { getScenicList } from '@/services/scenic';

const ScenicPage = () => {
  const { data, loading, error, run } = useRequest(getScenicList, {
    manual: true,    // 手动触发（不自动执行）
  });

  useEffect(() => { run({ page: 1 }); }, []);

  return <Table dataSource={data?.list} loading={loading} />;
};
```

### 方式二：ProTable 内置 request

```typescript
<ProTable
  request={async (params) => {
    const res = await getScenicList(params);
    return { data: res.data, success: true, total: res.total };
  }}
/>
```

### 方式三：手动 async/await

```typescript
const handleCreate = async (values) => {
  try {
    await createScenic(values);
    message.success('创建成功');
    refresh();
  } catch (err) {
    message.error('创建失败');
  }
};
```

## 6.5 与后端接口对接指南

作为后端开发者，看前端代码时关注点：

### 1. 找接口 URL

在 `services/` 目录下搜索。比如要找"景区列表"：
```bash
grep -r "scenic" apps/ticket-pc/src/services/
```

### 2. 看请求参数

前端通过拦截器自动附加：`business`、`pageNumber`、`userToken`、`actionFrom`。这些参数在你的 Controller 里不会显式出现在前端代码中，但请求时会自动带上。

### 3. 看响应格式

前端的 response interceptor 不做 `code` 统一判断（只判断登录过期），所以 `data.code` 的处理在各个页面的业务代码里：
```typescript
if (res.code === '0') {  // 成功
```

约定：后端返回 `{ code: "0", data: ..., msg: "" }`。

### 4. 分页约定

前端自动映射：
- `pageNumber`（前端传） → Controller 参数 `pageNum`
- 后端返回：`{ data: [...], total: 100 }`

### 5. 导出/下载约定

- 前端设 `responseType: 'blob'`
- 拦截器自动处理 `Content-Disposition` 拿文件名
- 返回 `{ blob, meta: { filename } }` 给页面使用
