# 压缩专题的证据与复核

对象：Claude Code 2.1.307，官方 macOS arm64 原生发行文件。本文中的源码是发行包内嵌 JavaScript 的提取内容，不是 Anthropic 内部原始 TypeScript 工程。

二进制 SHA-256：`5b113a7752119470f1da419cb0e608af3361cae25b614216b13022093958fb2a`。

## 文件说明

| 文件 | 用途 |
|---|---|
| [交付源码映射.json](交付源码映射.json) | 所有交付摘录的原模块、SHA-256、模块字节起点、二进制文件偏移、交付路径和格式化副本摘要 |
| [compact-functions-manifest.json](compact-functions-manifest.json) | 第一批核心函数原始提取映射 |
| [compact-extra-functions-manifest.json](compact-extra-functions-manifest.json) | 后补阈值、计数、工具结果处理函数映射 |
| [compact-prompt-manifest.json](compact-prompt-manifest.json) | 摘要模板、常量和变体选择整段原文映射 |
| [compact-rea-summary.json](compact-rea-summary.json) | 实际 REA 分析摘要，保留选择范围、unknown、partial 和 truncation 状态 |
| [格式化AST校验.json](格式化AST校验.json) | 93 段原文与格式化副本的 AST 结构比较，忽略位置、注释和字面量 raw 拼写 |
| [校验结果.json](校验结果.json) | 本轮字节、SHA、链接和数字例子校验结果，不代表运行模型验证 |

## 复核方法

运行 [verify-compact-evidence.py](../脚本/verify-compact-evidence.py)：

```bash
python3 '/Users/tcuser/Documents/ideaproject/hello-agents/docs/deeptrip_study_doc/claude-code/脚本/verify-compact-evidence.py'
```

已核验 93 段摘录与 7 个原始模块、原始二进制对应位置相等；93 段格式化副本与原文 AST 结构相同。

它验证每段原始切片与 recovered 模块、原始二进制对应位置完全相等，并检查格式化副本 SHA、Markdown 本地链接和数字推演。需要保留 Downloads 下的原始分析目录；原始大二进制和全量模块没有重复复制到文档仓库。

仅大小写不同的 `qwe/Qwe`、`jln/Jln` 在交付文件名中添加唯一后缀，避免默认 macOS 文件系统覆盖。历史 manifest 保留原分析记录，查交付文件请以 `交付源码映射.json` 的 delivered 路径为准；首次 REA 的七个选定函数不涉及该名称冲突。

附带 AST 提取脚本在 `../脚本/`，接受原始分析根目录作为第一个参数。脚本依赖本机现有 Babel parser、Prettier 缓存路径；换机器需调整依赖位置。核心重提取脚本写到新的 compact-export 目录，避免改写已有 REA 输入身份。它们只解析代码文本，不 import/执行被分析代码。`extract-compact*.cjs` 是分析脚本，不是 Claude Code 自身源码。

## REA 自动分析覆盖

Parent Evidence：`ev_9a4eee306f63d5976d595ea04cf5bfc2e27cba9344f73f6d67cb5003c9626a3d`。

其目录身份 SHA-256：`468c6c2571a87b814cf913ea37402bc873b29ddecf3c4185a47e5a184c8bdc0c`。

本次明确选择 a2、edn、Fve、$ve、vur、H1、C4r 七个核心函数：2745 AST 节点，无解析失败、没有触发语义截断。摘要报告列出 51 个未选文件、1105 个 semantic unknown，application/semantic graph 均为 partial。后补 32 个函数及提示模板由人工静态核对，不能冒充同一次 REA 自动分析已覆盖。

完整 Evidence bundle 留在 [原始分析目录](/Users/tcuser/Downloads/claude-code-rea-20261022/evidence/rea-evidence-bundle.json)，避免把 100MB 以上分析中间产物加入学习文档。

以上能确认发行客户端怎样决定摘要范围、怎样调用模型、怎样重建历史，不能证明当前账号的实际开关、实测压缩率或服务端模型内部实现。
