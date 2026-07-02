# 第 5 章：路由与页面

## 5.1 路由配置

路由配置在 `config/config.routes.tsx`，是了解整个系统功能范围的最佳入口。

### 基本结构

```typescript
const pageRoutes = [
  {
    path: '/',                              // 根路径
    component: '@/layout/BasicLayout',      // 布局组件（侧边栏+顶栏）
    routes: [
      {
        name: '基础信息',                     // 菜单显示名
        path: '/basic',                      // URL 路径
        pathkey: 'ticket1000000',            // ACL 权限标识
        icon: 'basic',                       // 菜单图标
        routes: [                            // 子路由（二级菜单）
          {
            name: '景区管理',
            path: '/basic/scenic-manage',
            component: '@/pages/basicInfo/scenicManage/scenicManage.tsx',
          },
          {
            name: '景点详情',                 // 隐藏页面（不在菜单显示）
            path: '/basic/scenic-spot-detail',
            hideInMenu: true,
            component: '@/pages/basicInfo/scenicSpotManage/scenicSpotDetail.tsx',
            relativeAuthPath: '/basic/scenic-spot-manage',  // 继承某个页面的权限
          },
        ],
      },
    ],
  },
];
```

### 路由参数说明

| 字段 | 说明 |
|------|------|
| `path` | URL 路径，**必须全小写 + 短横线** |
| `name` | 菜单显示名称 |
| `component` | 页面组件路径，`@/pages/` 或 `./` 开头 |
| `pathkey` | ACL 权限标识（对应后端 `t_acl_func_res` 表的资源编码） |
| `icon` | 菜单图标名（项目自定义图标映射） |
| `hideInMenu` | 不在菜单中显示（如详情页） |
| `redirect` | 路由重定向 |
| `relativeAuthPath` | 继承指定页面的权限 |

## 5.2 ticket-pc 完整业务菜单

| 一级菜单 | pathkey | 核心页面 |
|----------|---------|---------|
| 首页 | — | Home |
| 基础信息 | `ticket1000000` | 分成/景区/景点/设备/通道/打印管理 |
| 员工管理 | `ticket2000000` | 员工/角色/系统角色 |
| 票务中心 | `ticket3000000` | 基础票/组合票/套票/渠道/规则/票型/价格/标签 |
| 订单中心 | `ticket5000000` | 散客订单/团队订单/门票/取票/强制退票/强制核销/追溯 |
| 售后中心 | `ticket6000000` | 散客售后/团队售后/售后审核 |
| 会员中心 | — | 游客管理 |
| 团队管理 | `ticket7000000` | 旅行社/导游/团队票/政策/预约/财务 |
| 冲红管理 | `ticket10000000` | 冲红审核 |
| 内导管理 | `ticket8000000` | 内导产品/分组/订单 |
| 分销管理 | `ticket9000000` | 分销商/充值/资金流水 |
| 短信管理 | `ticket11000000` | 模板/记录 |
| 报表中心 | `ticket12000000` | 销售/收银/财务/OTA/旅行社/团队/内导 等几十个报表 |
| 数据中心 | `ticket13000000` | 数据下载 |

## 5.3 页面开发模式

以"景区管理"为例，一个典型页面的文件结构：

```
pages/basicInfo/scenicManage/
├── scenicManage.tsx          ← 页面组件（列表页）
├── index.less                ← 页面样式
├── _mock.ts                  ← Mock 数据（开发时用，发布会剥离）
└── components/               ← 页面级子组件（可选）
    ├── scenicDetail.tsx      ←   详情弹窗
    └── scenicForm.tsx        ←   表单弹窗
```

### 列表页模板

```typescript
// pages/xxx/XxxManage.tsx
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { useRequest } from 'ahooks';
import { getXxxList } from '@/services/xxx';

const XxxManage: React.FC = () => {
  const { data, loading, run } = useRequest(getXxxList, { manual: true });

  return (
    <PageContainer>
      <ProTable
        columns={[
          { title: '名称', dataIndex: 'name' },
          { title: '状态', dataIndex: 'status' },
          // ...
        ]}
        request={async (params) => {
          const res = await getXxxList(params);
          return { data: res.data, success: true, total: res.total };
        }}
      />
    </PageContainer>
  );
};
```

## 5.4 路由与 ACL 权限

`pathkey`  →  后端 `t_acl_func_res` 表  →  用户角色拥有的资源权限 →  菜单是否显示

```
用户登录
  → 后端返回用户拥有的资源列表（resourceKey 集合）
  → 前端匹配路由中的 pathkey
  → 有权限的路由生成菜单
  → 无权限的路由被隐藏
```

**隐藏页面**（如详情页）用 `relativeAuthPath` 继承已有页面的权限，不需要单独配 `pathkey`。

### 权限检查位置

1. **菜单显示**：路由匹配时自动过滤（Umi access 机制）
2. **页面内按钮**：`<Access accessible={}>` 组件包裹
3. **接口调用**：后端 Controller 层做最终鉴权（前端仅 UI 控制）

## 5.5 路由特殊规则

### Keep-Alive Tabs

项目使用了 `@alita/plugins` 的 Keep-Alive Tabs 插件，页面切换时缓存状态。

- 全小写路由名（强制）
- 某些路径不缓存：`keepalive: [/^(?!\/basic$|\/staff$|\/ticket$|\/order$|\/basic\/print-manage$).*/]` （这些路径不缓存）

### Hash 路由

```typescript
history: { type: 'hash' }
```

所有 URL 都是 `http://localhost:8001/#/basic/scenic-manage` 格式（`#` 号模式），不是浏览器的 History API 模式。

### 跳转到详情页

```typescript
import { history } from '@umijs/max';

// 带参数的跳转
history.push(`/order/order-manager/detail?id=${orderId}`);
```

在详情页获取参数：
```typescript
import { useSearchParams } from '@umijs/max';
const [searchParams] = useSearchParams();
const id = searchParams.get('id');
```
