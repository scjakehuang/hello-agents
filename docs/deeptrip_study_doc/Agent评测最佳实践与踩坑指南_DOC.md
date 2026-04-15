# Agent 评测最佳实践与踩坑指南

## 文档信息

- 作者：徐凯旋
- 邮箱：azouever@gmail.com
- 更新时间：2026-04-14

---

## 目录

1. [概述：为什么 Agent 评测比传统软件测试难](#一概述为什么-agent-评测比传统软件测试难)
2. [评测维度全景](#二评测维度全景)
3. [测试数据集设计](#三测试数据集设计)
4. [规则化评测实现](#四规则化评测实现)
5. [LLM-as-Judge 完整实现](#五llm-as-judge-完整实现)
6. [自动化测试框架](#六自动化测试框架)
7. [Langfuse 集成做评测追踪](#七langfuse-集成做评测追踪)
8. [回归测试策略](#八回归测试策略)
9. [在线评测 vs 离线评测](#九在线评测-vs-离线评测)
10. [评测流水线设计](#十评测流水线设计)
11. [常见踩坑](#十一常见踩坑)
12. [速查表](#十二速查表)

---

## 一、概述：为什么 Agent 评测比传统软件测试难

### 1.1 核心挑战

传统软件测试面对的是确定性系统——给定相同输入，输出必然相同，因此断言（assert）非常简单。Agent 系统的本质是**概率性输出**，引入了 LLM 的不确定性、工具调用的动态路径，以及多轮对话的状态依赖。

```
传统软件测试：
  输入 A  →  [确定性逻辑]  →  输出 B（唯一）
  断言：assert output == "B"  ✅ 简单

Agent 评测：
  输入 A  →  [LLM 推理] → [工具选择] → [工具调用] → [结果整合] → 输出 B?/C?/D?
             ↑不确定         ↑多路径        ↑可能失败     ↑再次推理   ↑多种"正确"形式
  断言：??? 没有唯一正确答案，只有"更好"和"更差"
```

### 1.2 Agent 评测的六大难点

| 难点 | 具体表现 | 应对策略 |
|------|----------|----------|
| 非确定性 | 同一问题两次输出不同 | 多次采样 + 稳定性指标 |
| 多路径正确性 | "找酒店"有十种合法工具调用顺序 | 定义等价类，而非唯一路径 |
| 长链推理 | 5 步工具调用后才得到最终答案 | 中间步骤评测 + 轨迹分析 |
| 评测标准主观 | "回答有帮助"难以量化 | LLM-as-Judge + 人工校准 |
| 评测集污染 | Agent 训练数据可能包含评测集 | 动态生成 + 定期轮换 |
| 成本高 | 每个测试用例需要调用 LLM | 分层评测 + 采样策略 |

### 1.3 评测体系设计思路

好的 Agent 评测体系应当遵循以下原则：

1. **分层防御**：规则检查（快/廉价）→ LLM Judge（慢/贵）→ 人工审核（最慢/最准）
2. **全程可观测**：每个评测结果可追溯到具体的推理轨迹
3. **持续演进**：Bad case 自动沉淀进回归集，评测集随产品迭代成长
4. **成本可控**：不是所有测试都需要 LLM Judge，先用规则过滤
5. **关注轨迹，不只看结果**：答案正确但路径错误（如用错工具），也是问题

---

## 二、评测维度全景

### 2.1 完整评测维度 ASCII 图

```
+============================================================+
|                   Agent 评测维度全景                        |
+============================================================+
|                                                            |
|  [1] 功能性评测 (Functional Evaluation)                    |
|  ├── 任务完成率 (Task Completion Rate, TCR)                 |
|  │   ├── 定义：用户目标是否最终被满足                       |
|  │   ├── 衡量：成功任务数 / 总任务数                        |
|  │   └── 目标：>= 90% (生产级)                             |
|  │                                                         |
|  ├── 意图识别准确率 (Intent Accuracy)                      |
|  │   ├── 定义：Agent 是否正确理解用户意图类别               |
|  │   ├── 衡量：Top-1 准确率 / Top-3 召回率                  |
|  │   └── 目标：Top-1 >= 85%, Top-3 >= 95%                  |
|  │                                                         |
|  ├── 工具选择准确率 (Tool Selection Accuracy)               |
|  │   ├── 定义：是否选择了正确的工具（含顺序）               |
|  │   ├── 衡量：Exact Match + Set Match（不计顺序）          |
|  │   └── 目标：Exact >= 80%, Set >= 92%                    |
|  │                                                         |
|  └── 参数提取准确率 (Parameter Extraction Accuracy)        |
|      ├── 定义：工具参数是否正确填充                         |
|      ├── 衡量：字段级 F1（精确匹配 + 语义匹配）             |
|      └── 目标：必填字段 >= 95%, 可选字段 >= 80%             |
|                                                            |
|  [2] 质量性评测 (Quality Evaluation)                       |
|  ├── 相关性 (Relevance)                                    |
|  │   └── 回答是否针对用户问题，无跑题                       |
|  │                                                         |
|  ├── 准确性 (Accuracy)                                     |
|  │   └── 事实是否正确，无幻觉（Hallucination）              |
|  │                                                         |
|  ├── 完整性 (Completeness)                                 |
|  │   └── 关键信息是否覆盖，无遗漏要点                       |
|  │                                                         |
|  └── 流畅性 (Fluency)                                      |
|      └── 语言自然度，无语法错误，表达清晰                   |
|                                                            |
|  [3] 性能评测 (Performance Evaluation)                     |
|  ├── 首字延迟 (TTFT - Time To First Token)                 |
|  │   └── 用户发消息到第一个字符出现的时间                   |
|  │       目标：< 2s (P95)                                  |
|  │                                                         |
|  ├── 端到端延迟 (E2E Latency)                              |
|  │   └── 从发送到完整回答的总时间                           |
|  │       目标：< 10s (P95, 含工具调用)                      |
|  │                                                         |
|  └── Token 效率 (Token Efficiency)                         |
|      └── 完成任务所用 Token 数 / 理论最小 Token 数          |
|          目标：< 1.5x (不超过理论最小量的 1.5 倍)           |
|                                                            |
|  [4] 安全性评测 (Safety Evaluation)                        |
|  ├── 有害请求拒绝率 (Harmful Request Rejection Rate)       |
|  │   └── 对有害/违法内容的拒绝是否准确                      |
|  │       目标：拒绝率 >= 99%, 误拒率 < 1%                   |
|  │                                                         |
|  └── Prompt 注入抵抗 (Prompt Injection Resistance)        |
|      └── 对越权指令、角色扮演攻击的抵抗能力                 |
|          目标：抵抗率 >= 99%                               |
|                                                            |
+============================================================+
```

### 2.2 各维度权重建议

不同业务场景下，各维度权重应动态调整：

```python
# 旅游 Agent 场景权重配置示例
EVAL_WEIGHTS = {
    "functional": {
        "task_completion_rate": 0.30,
        "intent_accuracy": 0.20,
        "tool_selection_accuracy": 0.25,
        "parameter_extraction_accuracy": 0.25,
    },
    "quality": {
        "relevance": 0.30,
        "accuracy": 0.35,
        "completeness": 0.25,
        "fluency": 0.10,
    },
    "performance": {
        "ttft": 0.30,
        "e2e_latency": 0.50,
        "token_efficiency": 0.20,
    },
    "safety": {
        "harmful_rejection_rate": 0.60,
        "prompt_injection_resistance": 0.40,
    },
}

# 综合评分维度权重（业务导向）
DIMENSION_WEIGHTS = {
    "functional": 0.40,
    "quality": 0.30,
    "performance": 0.20,
    "safety": 0.10,
}
```

---

## 三、测试数据集设计

### 3.1 场景分类体系

```
测试数据集分类
├── 基础场景 (Basic)          占比 ~40%
│   ├── 单意图、单工具
│   ├── 完整信息输入
│   └── 标准表达方式
│
├── 边界场景 (Boundary)       占比 ~25%
│   ├── 信息不完整（缺少必要参数）
│   ├── 多语言/方言输入
│   ├── 极长/极短输入
│   └── 模糊意图
│
├── 异常场景 (Exception)      占比 ~20%
│   ├── 工具调用失败后的容错
│   ├── 矛盾信息（如日期冲突）
│   ├── 空输入/无效输入
│   └── 超出能力范围的请求
│
└── 复杂场景 (Complex)        占比 ~15%
    ├── 多意图并行
    ├── 多轮对话依赖
    ├── 跨工具协作
    └── 长上下文推理
```

### 3.2 Golden Set 构建规范

Golden Set 是评测的黄金标准数据集，质量直接决定评测的可信度。

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Any
from enum import Enum


class ScenarioCategory(Enum):
    BASIC = "basic"
    BOUNDARY = "boundary"
    EXCEPTION = "exception"
    COMPLEX = "complex"


class DifficultyLevel(Enum):
    EASY = 1
    MEDIUM = 2
    HARD = 3


@dataclass
class ToolCallSpec:
    """工具调用规格，支持 exact match 和 partial match"""
    tool_name: str
    required_params: Dict[str, Any]           # 必须匹配的参数
    optional_params: Dict[str, Any] = field(default_factory=dict)  # 可选参数
    order: Optional[int] = None               # None 表示顺序无关


@dataclass
class GoldenCase:
    """Golden Set 测试用例标准结构"""
    case_id: str
    query: str
    category: ScenarioCategory
    difficulty: DifficultyLevel

    # 期望结果
    expected_intents: List[str]
    expected_tool_calls: List[ToolCallSpec]
    expected_response_contains: List[str]     # 回答必须包含的关键词
    expected_response_excludes: List[str]     # 回答不能包含的词（如幻觉词）

    # 评测配置
    use_llm_judge: bool = True
    llm_judge_criteria: str = ""             # LLM Judge 的具体评估标准
    allow_tool_call_variations: bool = False  # 是否允许等价工具调用路径

    # 元信息
    created_by: str = ""
    created_at: str = ""
    tags: List[str] = field(default_factory=list)
    source: str = "manual"                   # manual / from_bad_case / synthetic


# 构建 Golden Set 示例
GOLDEN_SET: List[GoldenCase] = [
    # 基础场景：酒店搜索
    GoldenCase(
        case_id="hotel_basic_001",
        query="帮我找北京明天入住的酒店",
        category=ScenarioCategory.BASIC,
        difficulty=DifficultyLevel.EASY,
        expected_intents=["hotel_search"],
        expected_tool_calls=[
            ToolCallSpec(
                tool_name="search_hotel",
                required_params={"city": "北京"},
                optional_params={"check_in": "tomorrow"},
            )
        ],
        expected_response_contains=["北京", "酒店"],
        expected_response_excludes=["对不起，我无法"],
        llm_judge_criteria="回答应包含北京酒店的具体推荐，含名称和价格",
        tags=["hotel", "single_intent"],
        created_by="xukaixuan",
        created_at="2026-04-14",
    ),

    # 边界场景：缺少日期信息
    GoldenCase(
        case_id="hotel_boundary_001",
        query="北京酒店",
        category=ScenarioCategory.BOUNDARY,
        difficulty=DifficultyLevel.MEDIUM,
        expected_intents=["hotel_search"],
        expected_tool_calls=[],              # 应先追问日期，不应直接调用工具
        expected_response_contains=["入住", "日期"],
        expected_response_excludes=[],
        use_llm_judge=True,
        llm_judge_criteria="Agent 应该询问入住/退房日期，不应直接搜索",
        allow_tool_call_variations=False,
        tags=["hotel", "missing_param", "clarification"],
        created_by="xukaixuan",
        created_at="2026-04-14",
    ),

    # 复杂场景：机票+酒店联合搜索
    GoldenCase(
        case_id="flight_hotel_complex_001",
        query="我下周五从上海出发去北京玩三天，帮我把机票和酒店一起搞定",
        category=ScenarioCategory.COMPLEX,
        difficulty=DifficultyLevel.HARD,
        expected_intents=["flight_search", "hotel_search"],
        expected_tool_calls=[
            ToolCallSpec(
                tool_name="search_flight",
                required_params={"from": "上海", "to": "北京"},
                order=1,
            ),
            ToolCallSpec(
                tool_name="search_hotel",
                required_params={"city": "北京"},
                order=2,
            ),
        ],
        expected_response_contains=["机票", "酒店", "北京"],
        expected_response_excludes=["无法帮助"],
        use_llm_judge=True,
        llm_judge_criteria="回答应同时包含机票和酒店的推荐方案，逻辑连贯",
        allow_tool_call_variations=True,
        tags=["flight", "hotel", "multi_intent", "planning"],
        created_by="xukaixuan",
        created_at="2026-04-14",
    ),
]
```

### 3.3 数据集规模建议

```
Golden Set 规模参考（按 Agent 成熟度）：

  阶段一（MVP/Alpha）：
  ├── 基础场景：50 条
  ├── 边界场景：30 条
  ├── 异常场景：20 条
  └── 总计：~100 条

  阶段二（Beta/上线）：
  ├── 基础场景：200 条
  ├── 边界场景：120 条
  ├── 异常场景：80 条
  ├── 复杂场景：60 条
  └── 总计：~500 条

  阶段三（成熟产品）：
  ├── 基础场景：500+ 条
  ├── 边界场景：300+ 条
  ├── 异常场景：200+ 条
  ├── 复杂场景：150+ 条
  ├── Bad case 回归：持续增加
  └── 总计：1000+ 条（目标）
```

---

## 四、规则化评测实现

规则化评测是最快、最廉价的评测层，应作为第一道过滤器。

### 4.1 意图匹配评测

```python
from typing import List, Set
from dataclasses import dataclass


@dataclass
class IntentEvalResult:
    case_id: str
    query: str
    expected: List[str]
    actual: List[str]
    top1_correct: bool
    set_match: bool
    precision: float
    recall: float
    f1: float


def evaluate_intent(
    case_id: str,
    query: str,
    expected_intents: List[str],
    actual_intents: List[str],
) -> IntentEvalResult:
    """
    评测意图识别结果。
    - top1_correct：实际首位意图是否在期望集合内
    - set_match：实际意图集合是否与期望完全一致
    - precision/recall/f1：集合级别的精确率/召回率/F1
    """
    expected_set: Set[str] = set(expected_intents)
    actual_set: Set[str] = set(actual_intents)

    top1_correct = bool(actual_intents) and actual_intents[0] in expected_set

    intersection = expected_set & actual_set
    precision = len(intersection) / len(actual_set) if actual_set else 0.0
    recall = len(intersection) / len(expected_set) if expected_set else 0.0
    f1 = (
        2 * precision * recall / (precision + recall)
        if (precision + recall) > 0
        else 0.0
    )

    return IntentEvalResult(
        case_id=case_id,
        query=query,
        expected=expected_intents,
        actual=actual_intents,
        top1_correct=top1_correct,
        set_match=expected_set == actual_set,
        precision=precision,
        recall=recall,
        f1=f1,
    )
```

### 4.2 工具调用链验证

```python
from typing import Optional
import json


@dataclass
class ToolCall:
    tool_name: str
    params: dict
    order: int  # 实际调用顺序，从 1 开始


@dataclass
class ToolChainEvalResult:
    case_id: str
    exact_match: bool         # 工具名 + 参数 + 顺序完全一致
    name_set_match: bool      # 工具名集合一致（忽略顺序）
    order_correct: bool       # 有序工具的调用顺序是否正确
    param_f1: float           # 参数提取 F1
    missing_tools: List[str]  # 期望但未调用的工具
    extra_tools: List[str]    # 调用了但不期望的工具


def evaluate_tool_chain(
    case_id: str,
    expected_specs: List[ToolCallSpec],
    actual_calls: List[ToolCall],
) -> ToolChainEvalResult:
    """
    验证工具调用链。
    支持两种匹配模式：
    - Exact Match：工具名、参数、顺序全部一致
    - Set Match：工具名集合一致，顺序无关（allow_variations=True 时使用）
    """
    expected_names = [s.tool_name for s in expected_specs]
    actual_names = [c.tool_name for c in actual_calls]

    # 工具名集合匹配
    name_set_match = set(expected_names) == set(actual_names)
    missing_tools = [n for n in expected_names if n not in actual_names]
    extra_tools = [n for n in actual_names if n not in expected_names]

    # 顺序检查（仅检查 order 不为 None 的规格）
    ordered_specs = [s for s in expected_specs if s.order is not None]
    order_correct = True
    if ordered_specs:
        for spec in ordered_specs:
            actual_call = next(
                (c for c in actual_calls if c.tool_name == spec.tool_name), None
            )
            if actual_call is None or actual_call.order != spec.order:
                order_correct = False
                break

    # 参数 F1（针对每个匹配的工具计算必填参数命中率）
    param_scores = []
    for spec in expected_specs:
        actual_call = next(
            (c for c in actual_calls if c.tool_name == spec.tool_name), None
        )
        if actual_call is None:
            param_scores.append(0.0)
            continue
        required = set(spec.required_params.keys())
        matched = set(
            k for k in required
            if k in actual_call.params
            and _param_match(actual_call.params[k], spec.required_params[k])
        )
        score = len(matched) / len(required) if required else 1.0
        param_scores.append(score)

    param_f1 = sum(param_scores) / len(param_scores) if param_scores else 1.0

    exact_match = (
        name_set_match
        and order_correct
        and param_f1 == 1.0
    )

    return ToolChainEvalResult(
        case_id=case_id,
        exact_match=exact_match,
        name_set_match=name_set_match,
        order_correct=order_correct,
        param_f1=param_f1,
        missing_tools=missing_tools,
        extra_tools=extra_tools,
    )


def _param_match(actual_value: Any, expected_value: Any) -> bool:
    """参数匹配，支持精确匹配和类型宽容匹配"""
    if isinstance(expected_value, str) and isinstance(actual_value, str):
        # 字符串：忽略大小写和前后空格
        return actual_value.strip().lower() == expected_value.strip().lower()
    return actual_value == expected_value
```

### 4.3 关键词规则检查

```python
def rule_based_response_check(
    response: str,
    must_contain: List[str],
    must_exclude: List[str],
) -> dict:
    """
    对回答文本做规则检查。
    返回规则通过率和具体不通过的规则。
    """
    failed_must_contain = [kw for kw in must_contain if kw not in response]
    failed_must_exclude = [kw for kw in must_exclude if kw in response]

    total_rules = len(must_contain) + len(must_exclude)
    failed_count = len(failed_must_contain) + len(failed_must_exclude)
    pass_rate = (total_rules - failed_count) / total_rules if total_rules > 0 else 1.0

    return {
        "pass_rate": pass_rate,
        "passed": failed_count == 0,
        "failed_must_contain": failed_must_contain,
        "failed_must_exclude": failed_must_exclude,
    }
```

---

## 五、LLM-as-Judge 完整实现

### 5.1 Prompt 设计原则

LLM-as-Judge 的 Prompt 质量决定评测结果的可信度。核心原则：

1. **角色明确**：告知 Judge 其身份是"专业评测员"
2. **标准量化**：每个维度给出清晰的评分锚点（Score Rubric）
3. **结构化输出**：要求 JSON 输出，避免解析失败
4. **Chain-of-Thought**：要求先分析再打分，减少随机性
5. **双重盲评**：高风险场景使用两个不同模型交叉验证

### 5.2 完整 Judge 实现

```python
import json
import re
from typing import Optional
from openai import OpenAI
from dataclasses import dataclass


@dataclass
class JudgeScore:
    relevance: int           # 1-5
    accuracy: int            # 1-5
    completeness: int        # 1-5
    fluency: int             # 1-5
    helpfulness: int         # 1-5
    overall_score: float     # 加权综合分
    reasoning: str           # 推理过程
    issues: list             # 发现的问题列表
    confidence: float        # Judge 自身的置信度 0-1


JUDGE_SYSTEM_PROMPT = """你是一位专业的 AI Agent 评测专家，拥有丰富的对话系统评测经验。
你的任务是客观、严格地评估 Agent 回答的质量。
评测时需要先分析，再打分，不能仅凭直觉给分。"""


JUDGE_PROMPT_TEMPLATE = """
## 评测任务

请评估以下 Agent 回答的质量。

### 用户问题
{query}

### Agent 回答
{response}

### 对话上下文（如有）
{context}

### 评测标准（场景专属）
{criteria}

---

## 评分维度与锚点

请对以下维度逐一分析，每个维度给出 1-5 分：

**1. 相关性 (Relevance)**
- 5分：完全针对用户问题，无任何偏题
- 3分：基本相关，有轻微偏题
- 1分：严重偏题，答非所问

**2. 准确性 (Accuracy)**
- 5分：所有事实完全正确，无幻觉
- 3分：主要事实正确，有小错误
- 1分：存在明显事实错误或严重幻觉

**3. 完整性 (Completeness)**
- 5分：完整回答了问题的所有方面
- 3分：回答了主要方面，有轻微遗漏
- 1分：严重不完整，关键信息缺失

**4. 流畅性 (Fluency)**
- 5分：语言自然流畅，表达清晰
- 3分：基本通顺，偶有不自然
- 1分：语言生硬，难以理解

**5. 有用性 (Helpfulness)**
- 5分：对用户非常有帮助，能直接解决问题
- 3分：有一定帮助，但不够充分
- 1分：对用户帮助极少

---

## 输出格式

请严格按以下 JSON 格式输出，先写 reasoning，再写各项分数：

```json
{{
    "reasoning": "逐维度分析（先分析再打分）",
    "relevance": <1-5>,
    "accuracy": <1-5>,
    "completeness": <1-5>,
    "fluency": <1-5>,
    "helpfulness": <1-5>,
    "overall_score": <1.0-5.0，加权综合，相关性*0.2+准确性*0.3+完整性*0.25+流畅性*0.1+有用性*0.15>,
    "issues": ["问题1", "问题2"],
    "confidence": <0.0-1.0，你对本次评分的置信度>
}}
```
"""


class LLMJudge:
    def __init__(
        self,
        model: str = "gpt-4o",
        temperature: float = 0.1,  # 低温度提高稳定性
        retry_on_parse_error: int = 2,
    ):
        self.client = OpenAI()
        self.model = model
        self.temperature = temperature
        self.retry_on_parse_error = retry_on_parse_error

    def evaluate(
        self,
        query: str,
        response: str,
        criteria: str,
        context: str = "",
    ) -> JudgeScore:
        """
        调用 LLM 对 Agent 回答进行评测。
        内置重试机制，应对 JSON 解析失败。
        """
        prompt = JUDGE_PROMPT_TEMPLATE.format(
            query=query,
            response=response,
            context=context or "（无上下文）",
            criteria=criteria,
        )

        for attempt in range(self.retry_on_parse_error + 1):
            try:
                result = self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": JUDGE_SYSTEM_PROMPT},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=self.temperature,
                    response_format={"type": "json_object"},
                )
                raw = result.choices[0].message.content
                data = json.loads(raw)
                return self._parse_score(data)

            except (json.JSONDecodeError, KeyError) as e:
                if attempt < self.retry_on_parse_error:
                    # 追加修正指令重试
                    prompt += "\n\n[注意：上次输出 JSON 格式有误，请严格按格式重新输出]"
                    continue
                raise RuntimeError(f"LLM Judge 解析失败（{attempt+1}次重试后）: {e}")

    def _parse_score(self, data: dict) -> JudgeScore:
        """解析 LLM 返回的评分数据，做类型安全转换"""
        def safe_int(val, default=3) -> int:
            try:
                return max(1, min(5, int(val)))
            except (TypeError, ValueError):
                return default

        def safe_float(val, default=0.5) -> float:
            try:
                return max(0.0, min(1.0, float(val)))
            except (TypeError, ValueError):
                return default

        return JudgeScore(
            relevance=safe_int(data.get("relevance")),
            accuracy=safe_int(data.get("accuracy")),
            completeness=safe_int(data.get("completeness")),
            fluency=safe_int(data.get("fluency")),
            helpfulness=safe_int(data.get("helpfulness")),
            overall_score=round(
                safe_int(data.get("relevance")) * 0.20
                + safe_int(data.get("accuracy")) * 0.30
                + safe_int(data.get("completeness")) * 0.25
                + safe_int(data.get("fluency")) * 0.10
                + safe_int(data.get("helpfulness")) * 0.15,
                2,
            ),
            reasoning=str(data.get("reasoning", "")),
            issues=list(data.get("issues", [])),
            confidence=safe_float(data.get("confidence")),
        )

    def batch_evaluate(
        self,
        cases: List[dict],
        max_concurrency: int = 5,
    ) -> List[JudgeScore]:
        """
        批量评测。使用线程池控制并发，避免 API Rate Limit。
        每个 case 格式：{"query": ..., "response": ..., "criteria": ..., "context": ...}
        """
        import concurrent.futures

        results = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_concurrency) as executor:
            futures = {
                executor.submit(
                    self.evaluate,
                    case["query"],
                    case["response"],
                    case.get("criteria", ""),
                    case.get("context", ""),
                ): case
                for case in cases
            }
            for future in concurrent.futures.as_completed(futures):
                case = futures[future]
                try:
                    score = future.result()
                    results.append({"case": case, "score": score})
                except Exception as e:
                    results.append({"case": case, "error": str(e)})

        return results
```

### 5.3 Judge 稳定性校准

LLM Judge 存在随机性，建议对关键评测做稳定性校准：

```python
def calibrate_judge_stability(
    judge: LLMJudge,
    query: str,
    response: str,
    criteria: str,
    n_runs: int = 5,
) -> dict:
    """
    多次运行同一评测，计算分数方差，评估 Judge 稳定性。
    方差 < 0.5 认为稳定。
    """
    import statistics

    scores = []
    for _ in range(n_runs):
        result = judge.evaluate(query, response, criteria)
        scores.append(result.overall_score)

    return {
        "mean": statistics.mean(scores),
        "stdev": statistics.stdev(scores) if len(scores) > 1 else 0,
        "min": min(scores),
        "max": max(scores),
        "is_stable": statistics.stdev(scores) < 0.5 if len(scores) > 1 else True,
        "raw_scores": scores,
    }
```

---

## 六、自动化测试框架

### 6.1 pytest 集成

```python
# tests/conftest.py
import pytest
from your_agent import TravelAgent
from evaluator import LLMJudge, rule_based_response_check
from golden_set import GOLDEN_SET, GoldenCase


@pytest.fixture(scope="session")
def agent():
    """Agent 实例复用，避免每个测试重新初始化"""
    return TravelAgent()


@pytest.fixture(scope="session")
def judge():
    """LLM Judge 实例复用"""
    return LLMJudge(model="gpt-4o", temperature=0.1)


def pytest_configure(config):
    """注册自定义 marker"""
    config.addinivalue_line("markers", "basic: 基础场景测试")
    config.addinivalue_line("markers", "boundary: 边界场景测试")
    config.addinivalue_line("markers", "exception: 异常场景测试")
    config.addinivalue_line("markers", "complex: 复杂场景测试")
    config.addinivalue_line("markers", "slow: 需要 LLM Judge 的慢速测试")
```

```python
# tests/test_agent_golden.py
import pytest
from typing import List
from golden_set import GOLDEN_SET, GoldenCase, ScenarioCategory
from evaluator import evaluate_intent, evaluate_tool_chain, LLMJudge


def _case_to_params(category: ScenarioCategory):
    """按场景分类筛选测试用例"""
    return [c for c in GOLDEN_SET if c.category == category]


class TestAgentFunctional:
    """功能性评测：意图识别 + 工具调用链"""

    @pytest.mark.parametrize(
        "case",
        _case_to_params(ScenarioCategory.BASIC),
        ids=lambda c: c.case_id,
    )
    @pytest.mark.basic
    def test_basic_intent(self, agent, case: GoldenCase):
        """基础场景意图识别测试"""
        result = agent.process(case.query)

        intent_result = evaluate_intent(
            case_id=case.case_id,
            query=case.query,
            expected_intents=case.expected_intents,
            actual_intents=result.intents,
        )

        assert intent_result.top1_correct, (
            f"[{case.case_id}] 意图识别错误\n"
            f"  期望: {case.expected_intents}\n"
            f"  实际: {result.intents}"
        )

    @pytest.mark.parametrize(
        "case",
        [c for c in GOLDEN_SET if c.expected_tool_calls],
        ids=lambda c: c.case_id,
    )
    def test_tool_chain(self, agent, case: GoldenCase):
        """工具调用链验证"""
        result = agent.process(case.query)

        tool_result = evaluate_tool_chain(
            case_id=case.case_id,
            expected_specs=case.expected_tool_calls,
            actual_calls=result.tool_calls,
        )

        if case.allow_tool_call_variations:
            assert tool_result.name_set_match, (
                f"[{case.case_id}] 工具集合不匹配\n"
                f"  缺失: {tool_result.missing_tools}\n"
                f"  多余: {tool_result.extra_tools}"
            )
        else:
            assert tool_result.exact_match, (
                f"[{case.case_id}] 工具调用链不匹配\n"
                f"  param_f1: {tool_result.param_f1:.2f}\n"
                f"  缺失工具: {tool_result.missing_tools}"
            )


class TestAgentQuality:
    """质量性评测：使用 LLM-as-Judge"""

    @pytest.mark.parametrize(
        "case",
        [c for c in GOLDEN_SET if c.use_llm_judge],
        ids=lambda c: c.case_id,
    )
    @pytest.mark.slow
    def test_response_quality(self, agent, judge: LLMJudge, case: GoldenCase):
        """LLM Judge 质量评测，综合分 >= 3.5 通过"""
        result = agent.process(case.query)

        # 先做规则检查（快速）
        rule_result = rule_based_response_check(
            response=result.response,
            must_contain=case.expected_response_contains,
            must_exclude=case.expected_response_excludes,
        )
        assert rule_result["passed"], (
            f"[{case.case_id}] 规则检查失败\n"
            f"  缺少关键词: {rule_result['failed_must_contain']}\n"
            f"  包含禁用词: {rule_result['failed_must_exclude']}"
        )

        # LLM Judge 评分
        score = judge.evaluate(
            query=case.query,
            response=result.response,
            criteria=case.llm_judge_criteria,
        )

        assert score.overall_score >= 3.5, (
            f"[{case.case_id}] LLM Judge 综合分 {score.overall_score:.2f} < 3.5\n"
            f"  推理: {score.reasoning[:200]}\n"
            f"  问题: {score.issues}"
        )
```

### 6.2 参数化测试进阶

```python
# 支持从 YAML 文件加载测试用例（便于非工程师维护）
import yaml


def load_cases_from_yaml(yaml_path: str) -> List[GoldenCase]:
    """从 YAML 文件加载测试用例"""
    with open(yaml_path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)

    cases = []
    for item in raw.get("cases", []):
        case = GoldenCase(
            case_id=item["case_id"],
            query=item["query"],
            category=ScenarioCategory(item["category"]),
            difficulty=DifficultyLevel(item.get("difficulty", 1)),
            expected_intents=item.get("expected_intents", []),
            expected_tool_calls=[
                ToolCallSpec(**tc) for tc in item.get("expected_tool_calls", [])
            ],
            expected_response_contains=item.get("expected_response_contains", []),
            expected_response_excludes=item.get("expected_response_excludes", []),
            llm_judge_criteria=item.get("llm_judge_criteria", ""),
            use_llm_judge=item.get("use_llm_judge", True),
        )
        cases.append(case)
    return cases


# YAML 示例格式（golden_set.yaml）：
# cases:
#   - case_id: hotel_basic_001
#     query: "帮我找北京明天入住的酒店"
#     category: basic
#     difficulty: 1
#     expected_intents: ["hotel_search"]
#     expected_tool_calls:
#       - tool_name: search_hotel
#         required_params: {city: "北京"}
#     expected_response_contains: ["北京", "酒店"]
#     expected_response_excludes: ["对不起，我无法"]
#     llm_judge_criteria: "回答应包含北京酒店推荐，含名称和价格"
```

---

## 七、Langfuse 集成做评测追踪

### 7.1 为什么需要 Langfuse

规则检查和 LLM Judge 只告诉你"结果是好是坏"，Langfuse 让你看到"为什么好为什么坏"——完整的推理轨迹、工具调用链、Token 消耗、延迟分布，全部可追溯。

```
Langfuse 评测追踪架构：

  [评测脚本]
      |
      | 1. 发起评测，创建 Trace
      v
  [Agent 执行]  ─── span: intent_recognition ───► Langfuse
      |          ─── span: tool_selection     ───►
      |          ─── span: tool_call(N)       ───►
      |          ─── span: response_gen       ───►
      v
  [LLM Judge]  ─── score: quality_score      ───► Langfuse
      |          ─── score: rule_pass_rate    ───►
      v
  [结果汇总]  ◄─── query: trace + scores     ─── Langfuse
```

### 7.2 Langfuse 集成代码

```python
from langfuse import Langfuse
from langfuse.decorators import langfuse_context, observe
import os


# 初始化（从环境变量读取，不硬编码密钥）
langfuse = Langfuse(
    public_key=os.environ["LANGFUSE_PUBLIC_KEY"],
    secret_key=os.environ["LANGFUSE_SECRET_KEY"],
    host=os.environ.get("LANGFUSE_HOST", "https://cloud.langfuse.com"),
)


@observe(name="agent_eval_run")
def run_evaluation_with_tracing(
    case: GoldenCase,
    agent,
    judge: LLMJudge,
) -> dict:
    """
    带 Langfuse 追踪的完整评测流程。
    每个评测用例对应一个 Trace。
    """
    # 通过 decorator 自动创建 Trace，trace_id 自动注入上下文
    langfuse_context.update_current_trace(
        name=f"eval_{case.case_id}",
        metadata={
            "case_id": case.case_id,
            "category": case.category.value,
            "difficulty": case.difficulty.value,
        },
        tags=case.tags + ["evaluation"],
    )

    # 执行 Agent
    result = agent.process(case.query)

    # 规则评测结果上报
    rule_result = rule_based_response_check(
        response=result.response,
        must_contain=case.expected_response_contains,
        must_exclude=case.expected_response_excludes,
    )
    langfuse_context.score_current_trace(
        name="rule_pass_rate",
        value=rule_result["pass_rate"],
        comment=f"failed: {rule_result['failed_must_contain'] + rule_result['failed_must_exclude']}",
    )

    # LLM Judge 评测结果上报
    if case.use_llm_judge:
        score = judge.evaluate(
            query=case.query,
            response=result.response,
            criteria=case.llm_judge_criteria,
        )
        for dim in ["relevance", "accuracy", "completeness", "fluency", "helpfulness"]:
            langfuse_context.score_current_trace(
                name=f"quality_{dim}",
                value=getattr(score, dim),
            )
        langfuse_context.score_current_trace(
            name="overall_score",
            value=score.overall_score,
            comment=score.reasoning[:500],
        )

    return {
        "case_id": case.case_id,
        "rule_result": rule_result,
        "llm_score": score if case.use_llm_judge else None,
    }


def create_eval_dataset_in_langfuse(golden_set: List[GoldenCase]) -> str:
    """
    将 Golden Set 上传到 Langfuse Dataset，便于后续版本对比。
    返回 dataset_id。
    """
    dataset = langfuse.create_dataset(
        name=f"golden_set_v{len(golden_set)}",
        description=f"Golden Set，共 {len(golden_set)} 条用例",
    )

    for case in golden_set:
        langfuse.create_dataset_item(
            dataset_name=dataset.name,
            input={"query": case.query, "context": ""},
            expected_output={
                "intents": case.expected_intents,
                "tool_calls": [tc.tool_name for tc in case.expected_tool_calls],
                "must_contain": case.expected_response_contains,
            },
            metadata={
                "case_id": case.case_id,
                "category": case.category.value,
                "difficulty": case.difficulty.value,
                "tags": case.tags,
            },
        )

    return dataset.name
```

---

## 八、回归测试策略

### 8.1 Bad Case 沉淀机制

```
Bad Case 生命周期：

  [线上/测试发现问题]
        |
        v
  [Bad Case 收集]  ← 自动捕获（score < 阈值）
        |          ← 人工标注（用户反馈）
        v
  [分析 & 分类]
  ├── 意图识别错误 → 更新 Intent 分类器
  ├── 工具选择错误 → 检查工具描述/Few-shot
  ├── 参数提取错误 → 优化参数提取 Prompt
  └── 回答质量差   → 更新 System Prompt / RAG
        |
        v
  [写入回归集]  → GOLDEN_SET 追加 + 标注 source="from_bad_case"
        |
        v
  [修复验证]  → 运行回归集，确认修复后新用例通过
        |
        v
  [持续监控]  → 修复后的场景纳入每日回归
```

```python
import json
from datetime import datetime
from pathlib import Path


BAD_CASE_FILE = Path("tests/bad_cases.jsonl")


def capture_bad_case(
    case_id: str,
    query: str,
    response: str,
    score: float,
    threshold: float,
    reasoning: str,
    category: str,
) -> None:
    """
    自动捕获低分用例并写入 bad_cases.jsonl。
    score < threshold 时触发。
    """
    if score >= threshold:
        return

    record = {
        "timestamp": datetime.utcnow().isoformat(),
        "case_id": case_id,
        "query": query,
        "response": response,
        "score": score,
        "threshold": threshold,
        "reasoning": reasoning,
        "category": category,
        "status": "pending_analysis",  # pending_analysis / fixed / wont_fix
    }

    with open(BAD_CASE_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def load_bad_cases(status_filter: str = "pending_analysis") -> List[dict]:
    """加载待分析的 Bad Case"""
    if not BAD_CASE_FILE.exists():
        return []
    cases = []
    with open(BAD_CASE_FILE, "r", encoding="utf-8") as f:
        for line in f:
            record = json.loads(line.strip())
            if status_filter is None or record.get("status") == status_filter:
                cases.append(record)
    return cases
```

### 8.2 版本对比（A/B 评测）

```python
def compare_versions(
    golden_set: List[GoldenCase],
    agent_a,
    agent_b,
    judge: LLMJudge,
    version_a_name: str = "baseline",
    version_b_name: str = "candidate",
) -> dict:
    """
    对两个版本的 Agent 做对比评测。
    返回：胜负比例、平局比例、各维度差异。
    """
    wins_a = wins_b = ties = 0
    score_diffs = []

    for case in golden_set:
        result_a = agent_a.process(case.query)
        result_b = agent_b.process(case.query)

        score_a = judge.evaluate(case.query, result_a.response, case.llm_judge_criteria)
        score_b = judge.evaluate(case.query, result_b.response, case.llm_judge_criteria)

        diff = score_b.overall_score - score_a.overall_score
        score_diffs.append(diff)

        if diff > 0.3:
            wins_b += 1
        elif diff < -0.3:
            wins_a += 1
        else:
            ties += 1

    total = len(golden_set)
    return {
        "version_a": version_a_name,
        "version_b": version_b_name,
        "total_cases": total,
        f"wins_{version_a_name}": wins_a,
        f"wins_{version_b_name}": wins_b,
        "ties": ties,
        f"win_rate_{version_b_name}": wins_b / total,
        "avg_score_diff": sum(score_diffs) / len(score_diffs) if score_diffs else 0,
        "recommendation": (
            f"推荐部署 {version_b_name}"
            if wins_b / total > 0.6
            else f"维持 {version_a_name}"
            if wins_a / total > 0.6
            else "差距不显著，建议扩大评测集"
        ),
    }
```

---

## 九、在线评测 vs 离线评测

```
+------------------+---------------------------+---------------------------+
|   维度           | 离线评测 (Offline)         | 在线评测 (Online)          |
+------------------+---------------------------+---------------------------+
| 时机             | 发布前，CI/CD 流程中        | 发布后，生产流量上         |
| 数据来源         | 静态 Golden Set            | 真实用户请求               |
| 速度             | 快（可批量并行）            | 实时，延迟敏感             |
| 成本             | 固定，可预测               | 随流量增长                 |
| 覆盖度           | 受限于 Golden Set 设计      | 覆盖真实分布               |
| 发现边界问题能力 | 弱（需人工构造边界用例）     | 强（真实用户会触发边界）    |
| 安全性           | 高（不影响线上用户）         | 有风险（Bad case 被用户看到）|
| 典型工具         | pytest + LLM-as-Judge       | Langfuse + A/B Testing     |
+------------------+---------------------------+---------------------------+

推荐组合策略：
  离线评测 ──► 通过 ──► 发布到灰度 ──► 在线评测（抽样 10%）──► 全量发布
                                            |
                                            └──► Bad case 自动沉淀回离线集
```

### 在线评测指标采集

```python
from functools import wraps
import time


def online_eval_decorator(judge: LLMJudge, sample_rate: float = 0.1):
    """
    在线评测装饰器，按采样率对生产流量做 LLM Judge 评测。
    sample_rate=0.1 表示抽样 10%。
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            import random

            start_time = time.time()
            result = func(*args, **kwargs)
            e2e_latency = time.time() - start_time

            # 采样评测
            if random.random() < sample_rate:
                try:
                    query = kwargs.get("query") or (args[1] if len(args) > 1 else "")
                    score = judge.evaluate(
                        query=query,
                        response=result.response if hasattr(result, "response") else str(result),
                        criteria="旅游 Agent 通用质量标准",
                    )
                    # 上报到监控系统（Langfuse / Prometheus）
                    _report_online_metrics(
                        score=score.overall_score,
                        e2e_latency=e2e_latency,
                        query=query,
                    )
                    # 低分自动告警
                    if score.overall_score < 2.5:
                        capture_bad_case(
                            case_id=f"online_{int(time.time())}",
                            query=query,
                            response=str(result),
                            score=score.overall_score,
                            threshold=2.5,
                            reasoning=score.reasoning,
                            category="online_capture",
                        )
                except Exception:
                    pass  # 评测失败不影响主流程

            return result
        return wrapper
    return decorator


def _report_online_metrics(score: float, e2e_latency: float, query: str):
    """上报在线评测指标（接入实际监控系统时替换）"""
    langfuse.score(
        name="online_quality_score",
        value=score,
        comment=f"e2e_latency={e2e_latency:.2f}s",
    )
```

---

## 十、评测流水线设计

### 10.1 完整流水线 ASCII 图

```
+================================================================+
|                    Agent 评测流水线全景                          |
+================================================================+
|                                                                |
|  [触发入口]                                                    |
|  ├── CI/CD 触发（PR 合并后自动运行）                            |
|  ├── 定时触发（每日凌晨全量回归）                               |
|  └── 手动触发（指定用例子集）                                   |
|            |                                                   |
|            v                                                   |
|  [Stage 1: 快速规则检查]            ← Golden Set               |
|  ├── 意图识别 Top-1 准确率          耗时：~30s（100 用例）       |
|  ├── 工具调用链 Set Match           成本：极低                  |
|  └── 关键词规则 Pass Rate                                       |
|            |                                                   |
|      pass > 85%？                                              |
|      ├── NO  ──► [阻断] 生成规则评测报告，通知 oncall           |
|      └── YES ──► 进入 Stage 2                                  |
|            |                                                   |
|            v                                                   |
|  [Stage 2: LLM Judge 评测]          ← 规则通过的用例           |
|  ├── 质量维度评分（相关/准确/完整/流畅/有用）                   |
|  ├── 批量并发（max_concurrency=5）  耗时：~5min（100 用例）     |
|  └── Bad Case 捕获（score < 3.5）   成本：中等                 |
|            |                                                   |
|      overall_score >= 3.5？                                    |
|      ├── NO  ──► [警告] 生成 LLM 评测报告，可选阻断            |
|      └── YES ──► 进入 Stage 3                                  |
|            |                                                   |
|            v                                                   |
|  [Stage 3: 性能评测]                                           |
|  ├── TTFT P95 检查（< 2s）                                     |
|  ├── E2E Latency P95 检查（< 10s）  耗时：~2min               |
|  └── Token 效率检查（< 1.5x）       成本：低                   |
|            |                                                   |
|            v                                                   |
|  [Stage 4: 安全性评测]                                         |
|  ├── 有害请求拒绝率（>= 99%）       耗时：~1min               |
|  └── Prompt 注入抵抗（>= 99%）      成本：低                   |
|            |                                                   |
|            v                                                   |
|  [汇总报告]                                                    |
|  ├── 写入 Langfuse（完整 Trace）                               |
|  ├── 生成 HTML 报告                                            |
|  ├── 更新 Bad Case 回归集                                       |
|  └── 发送 Slack/钉钉通知                                        |
|                                                                |
+================================================================+
```

### 10.2 流水线入口脚本

```python
# scripts/run_eval_pipeline.py
import argparse
import json
from datetime import datetime
from pathlib import Path


def run_pipeline(
    golden_set_path: str = "tests/golden_set.yaml",
    stage: str = "all",  # all / rule / llm / perf / safety
    output_dir: str = "eval_results",
    fail_fast: bool = False,
) -> dict:
    """
    评测流水线入口。
    支持分阶段运行（便于 CI 按需选择）。
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    cases = load_cases_from_yaml(golden_set_path)
    agent = TravelAgent()
    judge = LLMJudge()

    report = {
        "run_id": datetime.utcnow().strftime("%Y%m%d_%H%M%S"),
        "total_cases": len(cases),
        "stages": {},
    }

    # Stage 1: 规则评测
    if stage in ("all", "rule"):
        rule_results = _run_rule_stage(cases, agent)
        report["stages"]["rule"] = rule_results
        if fail_fast and rule_results["pass_rate"] < 0.85:
            _notify_failure("规则评测阶段不通过", rule_results)
            return report

    # Stage 2: LLM Judge
    if stage in ("all", "llm"):
        llm_results = _run_llm_stage(cases, agent, judge)
        report["stages"]["llm"] = llm_results
        if fail_fast and llm_results["avg_score"] < 3.5:
            _notify_failure("LLM Judge 阶段不通过", llm_results)
            return report

    # Stage 3: 性能评测
    if stage in ("all", "perf"):
        perf_results = _run_perf_stage(cases, agent)
        report["stages"]["perf"] = perf_results

    # Stage 4: 安全性评测
    if stage in ("all", "safety"):
        safety_results = _run_safety_stage(agent)
        report["stages"]["safety"] = safety_results

    # 保存报告
    report_file = output_path / f"eval_report_{report['run_id']}.json"
    with open(report_file, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Agent 评测流水线")
    parser.add_argument("--stage", default="all", choices=["all", "rule", "llm", "perf", "safety"])
    parser.add_argument("--fail-fast", action="store_true")
    parser.add_argument("--golden-set", default="tests/golden_set.yaml")
    args = parser.parse_args()

    result = run_pipeline(
        golden_set_path=args.golden_set,
        stage=args.stage,
        fail_fast=args.fail_fast,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
```

---

## 十一、常见踩坑

### 坑 1：评测集与训练数据污染

**现象**：评测分数很高，但线上表现差。

```python
# ❌ 错误：用来训练/Fine-tune 的数据和评测集完全重叠
training_data = [
    {"query": "北京天气", "response": "北京今天晴，25度"},  # 同样的用例
]
eval_data = [
    {"query": "北京天气", "category": "basic"},             # 被污染了
]

# ✅ 正确：严格分离训练集和评测集，建立数据隔离机制
from sklearn.model_selection import train_test_split
import hashlib

def assign_split(case_id: str, eval_ratio: float = 0.2) -> str:
    """
    用 case_id 的哈希值确定性地分配 train/eval，
    保证同一用例永远在同一分组，不受顺序影响。
    """
    h = int(hashlib.md5(case_id.encode()).hexdigest(), 16)
    return "eval" if (h % 100) < int(eval_ratio * 100) else "train"

# 同时建立数据登记表，记录每条数据的用途
DATA_REGISTRY = {
    "hotel_basic_001": {"split": "eval", "used_in_training": False},
    "hotel_train_001": {"split": "train", "used_in_training": True},
}
```

---

### 坑 2：只看最终分数，忽略中间轨迹

**现象**：最终答案正确，但 Agent 走了错误路径（如先查航班再查酒店，但用例要求先查酒店），隐患未被发现。

```python
# ❌ 错误：只验证最终回答
def test_agent_wrong(agent, case):
    result = agent.process(case.query)
    assert "北京" in result.response  # 最终答案对了就算通过
    # 但 Agent 实际上没有调用任何工具，而是直接编造了答案！

# ✅ 正确：同时验证工具调用轨迹和最终回答
def test_agent_correct(agent, case):
    result = agent.process(case.query)

    # 1. 验证工具调用轨迹
    tool_result = evaluate_tool_chain(
        case_id=case.case_id,
        expected_specs=case.expected_tool_calls,
        actual_calls=result.tool_calls,  # 必须记录工具调用历史
    )
    assert tool_result.name_set_match, f"工具调用链错误: {tool_result}"

    # 2. 验证工具调用参数（防止"调了但参数错了"）
    assert tool_result.param_f1 >= 0.9, f"参数提取不准: F1={tool_result.param_f1}"

    # 3. 最后才验证最终回答
    rule_result = rule_based_response_check(
        response=result.response,
        must_contain=case.expected_response_contains,
        must_exclude=case.expected_response_excludes,
    )
    assert rule_result["passed"], f"关键词规则失败: {rule_result}"
```

---

### 坑 3：LLM Judge 与被评测模型相同

**现象**：用 GPT-4o 评测 GPT-4o 输出的内容，Judge 倾向于给高分（模型偏好自身风格）。

```python
# ❌ 错误：Judge 模型 == Agent 模型
agent_model = "gpt-4o"
judge_model = "gpt-4o"   # 评测失真，分数虚高

judge = LLMJudge(model=judge_model)
score = judge.evaluate(query, gpt4o_response, criteria)  # 几乎总是 4.5+

# ✅ 正确：方案一 —— 使用不同厂商的模型做 Judge
judge_with_different_model = LLMJudge(model="claude-3-5-sonnet-20241022")

# ✅ 正确：方案二 —— 双 Judge 交叉验证取平均
def dual_judge_evaluate(query: str, response: str, criteria: str) -> float:
    judge_a = LLMJudge(model="gpt-4o")
    judge_b = LLMJudge(model="claude-3-5-sonnet-20241022")

    score_a = judge_a.evaluate(query, response, criteria).overall_score
    score_b = judge_b.evaluate(query, response, criteria).overall_score

    # 两个分数差异过大时，触发人工审核
    if abs(score_a - score_b) > 1.0:
        _flag_for_human_review(query, response, score_a, score_b)

    return (score_a + score_b) / 2
```

---

### 坑 4：评测 Prompt 不稳定导致分数方差大

**现象**：同一个回答，运行两次 LLM Judge，分数相差超过 1 分。

```python
# ❌ 错误：Judge Prompt 模糊，没有评分锚点
bad_prompt = """
评估以下回答，给出 1-5 分。
问题：{query}
回答：{response}
"""
# 问题：没有说"5分是什么样的"，LLM 全靠感觉

# ✅ 正确：Prompt 包含详细的评分锚点 (Score Rubric)
good_prompt = """
评估以下回答的准确性，给出 1-5 分。

评分锚点：
- 5分：所有事实完全正确，来自工具调用的真实数据，无任何幻觉
- 4分：主要事实正确，有 1 处轻微错误（如日期格式问题）
- 3分：大部分正确，有 1-2 处事实错误，但不影响核心答案
- 2分：有明显事实错误，影响答案可信度
- 1分：主要内容错误或存在严重幻觉

问题：{query}
回答：{response}

请先分析，再给分。
"""

# ✅ 同时降低 temperature 减少随机性
judge = LLMJudge(model="gpt-4o", temperature=0.0)  # 或 0.1

# ✅ 验证稳定性
stability = calibrate_judge_stability(judge, query, response, criteria, n_runs=5)
if not stability["is_stable"]:
    print(f"WARNING: Judge 不稳定，stdev={stability['stdev']:.2f}")
```

---

### 坑 5：忽略工具调用失败的回退场景

**现象**：工具 API 超时或返回错误时，Agent 行为未被评测覆盖，上线后出现"静默失败"（回答看起来正常，但数据是编造的）。

```python
# ❌ 错误：评测时所有工具都正常返回，没有模拟故障
def test_hotel_search(agent, case):
    # mock 永远成功
    with mock.patch("tools.search_hotel", return_value={"hotels": [...]}):
        result = agent.process(case.query)
    assert "酒店" in result.response

# ✅ 正确：加入工具故障场景测试
import pytest
from unittest import mock

@pytest.mark.parametrize("failure_mode", [
    "timeout",
    "empty_result",
    "api_error_500",
])
def test_hotel_search_with_tool_failure(agent, failure_mode):
    """
    测试工具失败时 Agent 的回退行为：
    - 应该告知用户"暂时无法查询"
    - 不应该编造数据
    - 不应该崩溃
    """
    if failure_mode == "timeout":
        side_effect = TimeoutError("搜索超时")
    elif failure_mode == "empty_result":
        side_effect = None
        return_value = {"hotels": []}  # 空结果
    else:
        side_effect = Exception("API 返回 500")

    with mock.patch(
        "tools.search_hotel",
        side_effect=side_effect if failure_mode != "empty_result" else None,
        return_value={"hotels": []} if failure_mode == "empty_result" else None,
    ):
        result = agent.process("帮我找北京的酒店")

    # 关键断言：回答不能包含编造的酒店数据
    assert "如家" not in result.response or "无法" in result.response, (
        "工具失败时不应返回编造的酒店名"
    )
    # 应该包含错误提示
    error_indicators = ["暂时", "无法", "抱歉", "稍后", "重试"]
    assert any(indicator in result.response for indicator in error_indicators), (
        f"工具失败({failure_mode})时应提示用户，但回答: {result.response[:100]}"
    )
```

---

### 坑 6：评测成本失控

**现象**：每次 CI 运行 500 个用例 × LLM Judge，API 费用超预算。

```python
# ❌ 错误：所有用例都跑 LLM Judge，不分场合
def run_all_eval(cases):
    judge = LLMJudge()
    for case in cases:  # 500 个用例，每个都调 LLM Judge
        score = judge.evaluate(case.query, agent.process(case.query).response, criteria)

# ✅ 正确：分层评测，按需使用 LLM Judge
def run_tiered_eval(cases, mode="ci"):
    """
    mode="ci"：PR 合并时，只跑规则 + 高优先级 LLM Judge（约 50 个用例）
    mode="nightly"：每日全量，跑所有 LLM Judge
    mode="release"：发版前，全量 + 双 Judge 交叉验证
    """
    judge = LLMJudge()

    # 所有场景都跑规则评测（便宜）
    rule_results = [_run_rule_check(c, agent) for c in cases]

    # LLM Judge 按 mode 选择用例
    if mode == "ci":
        # 只评测：规则未通过的 + 难度 Hard 的 + 最近 7 天新增的
        llm_cases = [
            c for c, r in zip(cases, rule_results)
            if not r["passed"]
               or c.difficulty == DifficultyLevel.HARD
               or c.created_at >= "2026-04-07"
        ]
    elif mode in ("nightly", "release"):
        llm_cases = cases  # 全量

    llm_results = judge.batch_evaluate(
        [{"query": c.query, "response": agent.process(c.query).response,
          "criteria": c.llm_judge_criteria}
         for c in llm_cases]
    )

    return {"rule": rule_results, "llm": llm_results, "llm_coverage": len(llm_cases) / len(cases)}
```

---

## 十二、速查表

### 评测指标目标值

| 指标 | 目标值（生产级） | 告警阈值 |
|------|-----------------|---------|
| 任务完成率 (TCR) | >= 90% | < 85% |
| 意图 Top-1 准确率 | >= 85% | < 80% |
| 工具选择 Set Match | >= 92% | < 88% |
| 参数提取 F1（必填字段）| >= 95% | < 90% |
| LLM Judge 综合分 | >= 3.5 / 5.0 | < 3.0 |
| 规则检查通过率 | >= 95% | < 90% |
| TTFT P95 | < 2s | > 3s |
| E2E Latency P95 | < 10s | > 15s |
| Token 效率 | < 1.5x | > 2.0x |
| 有害请求拒绝率 | >= 99% | < 98% |
| Prompt 注入抵抗率 | >= 99% | < 98% |

### 评测工具选型

| 场景 | 推荐工具 | 备注 |
|------|----------|------|
| 规则化批量评测 | pytest + 自定义 fixture | 快速、可在 CI 跑 |
| LLM Judge | OpenAI / Anthropic API | 用与 Agent 不同的模型 |
| 轨迹追踪 | Langfuse | 开源可自部署 |
| 数据集管理 | Langfuse Dataset / YAML | 小规模用 YAML，大规模用 Langfuse |
| A/B 版本对比 | 自定义 compare_versions | 参考第八节实现 |
| 在线采样评测 | 装饰器 + Langfuse Score | 参考第九节实现 |
| 性能测试 | locust / k6 | 压测 API 端点 |

### 常用命令速查

```bash
# 只跑规则评测（CI 快速检查，< 1min）
pytest tests/ -m "basic" -k "not slow" --tb=short

# 跑所有 LLM Judge 测试（慢，需要 API 费用）
pytest tests/ -m "slow" --timeout=300

# 只跑指定场景分类
pytest tests/ -m "boundary" -v

# 生成 HTML 测试报告
pytest tests/ --html=eval_results/report.html --self-contained-html

# 运行评测流水线（仅规则阶段）
python scripts/run_eval_pipeline.py --stage rule --fail-fast

# 运行完整评测流水线
python scripts/run_eval_pipeline.py --stage all

# 查看 Bad Case 列表
python -c "from eval.bad_case import load_bad_cases; import json; print(json.dumps(load_bad_cases(), ensure_ascii=False, indent=2))"
```

### 评测体系建设路线图

```
第一阶段（上线前）：
  ☑ Golden Set >= 100 条（覆盖 4 种场景分类）
  ☑ 规则化评测跑通（意图 + 工具链 + 关键词）
  ☑ LLM Judge 基础实现（单维度 → 多维度）
  ☑ pytest 集成进 CI

第二阶段（稳定运营）：
  ☑ Langfuse 追踪接入
  ☑ Bad Case 自动捕获机制
  ☑ 在线采样评测（10% 流量）
  ☑ 每日回归报告自动推送

第三阶段（精细化）：
  ☑ Golden Set >= 500 条
  ☑ 双 Judge 交叉验证
  ☑ A/B 版本对比评测
  ☑ 评测成本分层管理
  ☑ 安全性评测专项
```
