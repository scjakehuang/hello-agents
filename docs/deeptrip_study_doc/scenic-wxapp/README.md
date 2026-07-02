# scenic-wxapp 微信小程序项目速通指南

> 目标读者：后端开发者，正在熟悉景区票务 C 端微信小程序项目。
> 整理时间：2026-06-16

## 阅读路线

| 你的状态 | 建议阅读顺序 |
|----------|-------------|
| 🆕 零基础，先跑起来 | **快速上手指南**（必读） |
| 30 分钟快速建立认知 | 快速上手指南 → 1 → 4 |
| 半天深入理解 | 快速上手指南 → 1-10 |
| 准备上手改代码 | 快速上手指南 → 1 → 3 → 5 → 6 → 8 |
| 学语法细节（逐行讲解） | 快速上手指南 → **11** |

## 章节索引

**[🆕 零基础快速上手指南](./quick-start-guide.md) — 5 分钟手写第一个页面，核心概念逐个击破，调试技巧，踩坑速查**（推荐先读）

1. [项目概览](./chapter-01-project-overview.md) — 这是什么项目，多小程序架构，与后端服务关系
2. [核心技术栈](./chapter-02-tech-stack.md) — 原生框架、Vant 组件库、工具链一览
3. [项目结构详解](./chapter-03-project-structure.md) — 目录树、文件命名、模块划分
4. [开发环境搭建](./chapter-04-dev-setup.md) — 微信开发者工具、依赖安装、环境切换
5. [路由与页面](./chapter-05-routing-pages.md) — 分包配置、页面开发模式、导航体系
6. [API请求与数据流](./chapter-06-api-and-data-flow.md) — HTTP封装、拦截器、Service层、与后端接口对接
7. [状态管理](./chapter-07-state-management.md) — Minax Store 全局状态管理
8. [组件体系](./chapter-08-components.md) — Vant Weapp + mall-ui + 自定义组件
9. [构建与部署](./chapter-09-build-deploy.md) — 多小程序构建、CI/CD 上传
10. [后端开发者快速上手](./chapter-10-backend-dev-guide.md) — 后端概念映射、改一个功能的完整流程、常见陷阱
11. [溪降挑战模块详解](./chapter-11-canyoning-syntax.md) — 以 canyoning 模块为素材，语法与实现深度剖析（9 页面 + 5 工具 + 8 大模式）
