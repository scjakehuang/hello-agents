# 第 8 章：组件体系

## 8.1 组件层级

```
┌──────────────────────────────────────────────┐
│  antd v5 (基础组件)                           │
│  Button / Table / Form / Modal / Input ...   │
├──────────────────────────────────────────────┤
│  @ant-design/pro-components (高级组件)        │
│  ProTable / ProForm / ProLayout / ProCard    │
├──────────────────────────────────────────────┤
│  @okapi/ui (项目共享组件库)                    │
│  packages/okapiUI/src/                       │
├──────────────────────────────────────────────┤
│  src/components/ (项目级公共组件)              │
│  table / form / upload / filter / ...        │
├──────────────────────────────────────────────┤
│  pages/Xxx/components/ (页面级组件)            │
│  只在当前模块内用                              │
└──────────────────────────────────────────────┘
```

## 8.2 antd 5 基础组件

antd 5 是蚂蚁金服的 React UI 组件库。后端开发者重点熟悉这些：

| 组件 | 用途 | 相当于后端的 |
|------|------|------------|
| `Table` | 数据表格 | 列表接口输出 |
| `Form` + `Form.Item` | 表单 | 请求 DTO |
| `Modal` | 弹窗 | 独立页面（新增/编辑） |
| `Button` | 按钮 | — |
| `Input` / `Select` / `DatePicker` | 输入控件 | 请求字段 |
| `message` | 轻量提示 | `Result` 的 msg 展示 |
| `notification` | 通知 | 错误通知 |
| `Menu` | 菜单 | 路由导航 |

## 8.3 ProComponents 高级组件

这是项目中使用频率最高的组件库，提供"开箱即用"的 CRUD 页面方案。

### ProTable — 带搜索 + 分页 + 工具栏的表格

```typescript
<ProTable
  columns={columns}              // 列定义
  request={async (params) => {   // 自动管理分页+排序+筛选
    const res = await apiFunc(params);
    return { data: res.data, total: res.total, success: true };
  }}
  rowKey="id"
  search={{ labelWidth: 'auto' }} // 搜索栏
  pagination={{ pageSize: 10 }}   // 分页
  toolBarRender={() => [          // 工具栏按钮
    <Button onClick={handleAdd}>新增</Button>,
  ]}
/>
```

一个 ProTable 就搞定了**搜索表单 + 数据表格 + 分页 + 工具栏 + 加载状态**，后端风格的标准 CRUD。

### ProForm — 表单

```typescript
<ProForm onFinish={handleSubmit}>
  <ProFormText name="name" label="名称" rules={[{ required: true }]} />
  <ProFormSelect name="status" label="状态" options={[...]} />
  <ProFormDatePicker name="date" label="日期" />
</ProForm>
```

### PageContainer — 页面容器

```typescript
<PageContainer>
  {/* 自动带有面包屑、页面标题，内容区 */}
</PageContainer>
```

## 8.4 项目级公共组件

位于 `src/components/`，都是对 antd 组件的二次封装：

| 目录 | 用途 |
|------|------|
| `table/` | 表格相关封装（OkpTable 等） |
| `form/` | 表单相关封装 |
| `upload/` | 图片/文件上传组件 |
| `filter/` | 搜索筛选器组件 |
| `input/` | 输入框封装 |
| `RichTextEditor/` | 富文本编辑器（基于 Quill） |
| `IDReader/` | 身份证读卡器组件（窗口售票） |
| `gather/` | 组件聚合导出 |

## 8.5 页面组装模式

一个典型的列表页组装：

```typescript
// pages/xxx/XxxManage.tsx
const XxxManage: React.FC = () => {
  // 状态：弹窗是否显示
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string>();

  // ProTable 的 ref（用于手动刷新）
  const tableRef = useRef<ProTableRef>();

  const columns = [
    { title: '名称', dataIndex: 'name' },
    { title: '状态', dataIndex: 'status', render: (_, r) => <Badge status={r.status} /> },
    {
      title: '操作',
      render: (_, record) => (
        <Button onClick={() => { setEditingId(record.id); setModalVisible(true); }}>
          编辑
        </Button>
      ),
    },
  ];

  return (
    <PageContainer>
      <ProTable
        actionRef={tableRef}
        columns={columns}
        request={async (params) => {
          const res = await getXxxList({ ...params, ...params.searchParams });
          return { data: res.data, total: res.total, success: true };
        }}
      />
      {modalVisible && (
        <XxxFormModal
          id={editingId}
          onClose={() => setModalVisible(false)}
          onSuccess={() => { tableRef.current?.reload(); setModalVisible(false); }}
        />
      )}
    </PageContainer>
  );
};
```

## 8.6 嵌套路由与 KeepAlive

项目使用 Keep-Alive Tabs，切换到其他页面再回来时，列表状态（筛选条件、分页位置）会保留，不会重新加载。
