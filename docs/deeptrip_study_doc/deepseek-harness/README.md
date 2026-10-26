# DeepSeek Harness 源码学习

- 分析日期：2026-10-22
- 作者：徐凯旋
- 官方仓库：<https://github.com/deepseek-ai/deepseek-harness>
- 本地源码：`/Users/tcuser/Documents/ideaproject/deepseek-harness`
- 分析版本：`0.2.1-rc.2`，`master` 分支
- 固定提交：`687f282e8625c6b8d11ff58211a90524be2e4317`，提交时间 `2026-10-17 15:22:43 +0800`
- 下载方式：`git clone --depth 1`，已下载该提交的完整工作树，不含完整历史。

## 阅读入口

1. [源码主流程分析](源码主流程分析.md)：启动、插件装配、用户输入、Agent 循环、模型调用、工具执行、会话持久化、取消和恢复。
2. [源码证据清单](源码证据清单.json)：源码文件的 SHA-256、分析提交和关键定位，便于复核版本。

## 项目定位

DeepSeek Harness 是以 TypeScript 为主的开源 Agent 运行框架，CLI 名称为 `dsh`。它提供 Web、headless、SDK、ACP 等使用入口，底层用 Cordis 将模型适配器、工具、会话存储、审批策略和默认 Agent 循环装配为插件。它不是模型权重仓库，也不是只有一个模型 HTTP 接口的示例项目。

主线可以先记成：**启动 profile → 装配插件 → 创建或恢复 Agent → 输入进入 inbox → 组装上下文 → 调用模型 → 执行工具 → 将结果加入会话 → 再次调用模型，直到本轮结束。**

## 本次分析范围

本次是基于固定提交的静态源码分析，核对了实际函数及调用位置；没有安装依赖、构建、启动服务、执行项目测试或发起真实模型调用。文档中的命令是后续运行入口，不是本次已经通过的运行验证。没有修改下载仓库的源码，也没有读取本机模型密钥或历史会话。

原始文档可对照阅读：

- [官方中文 README](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/README.zh.md)
- [官方架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/architecture.md)
- [默认 Agent 驱动说明](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/README.md)
