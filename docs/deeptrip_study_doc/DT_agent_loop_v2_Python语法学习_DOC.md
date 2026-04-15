[TOC]

# DT_agent_loop_v2 相关代码里的 Python 语法学习文档（Java 视角）

## 文档信息

- 作者：Claude
- 更新时间：2026-04-10
- 适用读者：有 Java 开发经验、几乎没有 Python 经验的开发者
- 学习目标：结合 `agent-b101` 里的真实生产代码，快速理解 `DT_agent_loop_v2.py` 及其相关引用文件中常见的 Python 语法与写法

## 目录

- [1. 先建立一个整体心智模型](#1-先建立一个整体心智模型)
- [2. 本文覆盖的代码文件](#2-本文覆盖的代码文件)
- [3. 从 Java 视角看 Python：先记住这几个大差异](#3-从-java-视角看-python先记住这几个大差异)
- [4. import 语法：Python 怎么导包](#4-import-语法python-怎么导包)
- [5. class 与 `__init__`：Python 类怎么写](#5-class-与-__init__python-类怎么写)
- [6. Enum：和 Java enum 很像，但写法更轻](#6-enum和-java-enum-很像但写法更轻)
- [7. 类型标注（type hints）：像“弱约束版 Java 类型”](#7-类型标注type-hints像弱约束版-java-类型)
- [8. `@dataclass`：像 Java 的“字段类 + 自动生成构造/方法”](#8-dataclass像-java-的字段类--自动生成构造方法)
- [9. `field(default_factory=list)`：为什么不是直接 `=[]`](#9-fielddefault_factorylist为什么不是直接-)
- [10. `__post_init__`：像构造后的补充初始化钩子](#10-__post_init__像构造后的补充初始化钩子)
- [11. 实例属性：Python 不需要先声明字段再赋值](#11-实例属性python-不需要先声明字段再赋值)
- [12. 条件、布尔表达式、成员判断](#12-条件布尔表达式成员判断)
- [13. 列表、字典、元组：Python 最常用的集合语法](#13-列表字典元组python-最常用的集合语法)
- [14. 列表推导式 / 字典推导式：Python 很常见的简写](#14-列表推导式--字典推导式python-很常见的简写)
- [15. 字符串格式化：重点看 f-string](#15-字符串格式化重点看-f-string)
- [16. 异常处理：`try/except` 对应 Java 的 `try/catch`](#16-异常处理tryexcept-对应-java-的-trycatch)
- [17. `async/await`：这是理解 Agent 主循环最关键的语法](#17-asyncawait这是理解-agent-主循环最关键的语法)
- [18. `asyncio` 并发原语：事件循环里的“协程版并发控制”](#18-asyncio-并发原语事件循环里的协程版并发控制)
- [19. `@property`：像 Java 的 getter，但调用方式像字段](#19-property像-java-的-getter但调用方式像字段)
- [20. 反射/动态能力：`hasattr`、`setattr`、`getattr`](#20-反射动态能力hasattrsetattrgetattr)
- [21. 常见内置函数与写法](#21-常见内置函数与写法)
- [22. `if __name__ == '__main__'`：Python 文件的入口写法](#22-if-__name__--__main__python-文件的入口写法)
- [23. 回到 DeepTrip：这几个文件分别在干什么](#23-回到-deeptrip这几个文件分别在干什么)
- [24. 建议你按这个顺序读源码](#24-建议你按这个顺序读源码)
- [25. 一页速记：Java 概念到 Python 语法映射](#25-一页速记java-概念到-python-语法映射)

## 1. 先建立一个整体心智模型

如果你是 Java 开发者，可以先把这几份代码理解成下面这套关系：

- `DT_agent_loop_v2.py`：主流程控制器，类似“Agent 编排主类 + 状态机”
- `core_context.py`：上下文对象，类似“超大的 Context DTO / Session Context”
- `tool_async_board.py`：异步工具调度板，类似“工具调用任务中心 + 状态追踪器”
- `agent_memory.py`：轻量记忆结构，类似“会话内工具结果缓存器”

也就是说，这不是一份“Python 语法教材”，而是一套真实业务代码。你学语法时，最好一直带着业务角色去理解，不要孤立背语法。

## 2. 本文覆盖的代码文件

本文主要结合以下代码：

- `agent-b101/app/routers/agent_loop/DT_agent_loop_v2.py`
- `agent-b101/app/routers/context/core_context.py`
- `agent-b101/app/routers/agent_loop/tool_async_board.py`
- `agent-b101/app/routers/agent_memory.py`

## 3. 从 Java 视角看 Python：先记住这几个大差异

先记 6 个结论，后面你读代码会轻松很多。

1. Python 用缩进表示代码块，不用大括号。
2. Python 变量默认没有强类型声明，类型标注主要是“提示”，不是 Java 那种强约束。
3. Python 对象可以很动态，运行时可以加属性、查属性。
4. Python 很喜欢“小对象 + 少模板代码”，所以 `@dataclass` 很常见。
5. Python 的异步主要是 `async/await + asyncio`，思路更接近“协程”，不是 Java 线程池那一套直接照搬。
6. Python 里很多写法都比 Java 短，比如列表推导式、字典推导式、f-string。

## 4. import 语法：Python 怎么导包

在 `DT_agent_loop_v2.py` 里，一开头就能看到很多导入：

```python
from typing import List, Dict, AsyncGenerator
import asyncio
from enum import Enum
from fastapi import Request
from fastapi.responses import StreamingResponse
```

你可以这样对应理解：

- `import asyncio`：类似 Java 里 `import xxx.asyncio;`，后面用全名 `asyncio.Semaphore`
- `from enum import Enum`：从模块里直接导入一个类，后面直接写 `Enum`
- `from typing import List, Dict`：导入类型标注相关类

Java 对照理解：

```java
import java.util.List;
import java.util.Map;
```

区别在于，Python 的 `from ... import ...` 更常见，而且一个文件里可能导很多工具函数、类、常量。

## 5. class 与 `__init__`：Python 类怎么写

`DT_agent_loop_v2.py` 里的主类：

```python
class AgentLoop:
    def __init__(self, request: Request, params: HotelChatRequest, thinking_channel=None):
        self.request = request
        self.params = params
        self.context = None
        self.item_recs = None
```

Java 对应大概是：

```java
public class AgentLoop {
    private Request request;
    private HotelChatRequest params;
    private Object context;

    public AgentLoop(Request request, HotelChatRequest params, Object thinkingChannel) {
        this.request = request;
        this.params = params;
        this.context = null;
    }
}
```

这里要注意 3 个点。

### 5.1 `self` 相当于 Java 里的 `this`

- `self.request = request` 就是 `this.request = request`
- Python 只是把它显式写在方法参数里

### 5.2 `__init__` 是构造方法

- 相当于 Java 构造器
- 但它本质上是普通方法，只是名字特殊

### 5.3 字段可以在构造里直接赋值

Python 不强制你在类最上面先把所有字段都声明一遍，直接在 `__init__` 里赋值就行。

## 6. Enum：和 Java enum 很像，但写法更轻

`DT_agent_loop_v2.py` 中有：

```python
class LoopState(Enum):
    DIRECT_ANSWER = "direct_answer"
    DEFAULT_STATE = "default_state"
    LLM_INFERENCE = "llm_inference"
    TOOL_INTEGRATION = "tool_integration"
```

这和 Java 的：

```java
public enum LoopState {
    DIRECT_ANSWER,
    DEFAULT_STATE,
    LLM_INFERENCE,
    TOOL_INTEGRATION
}
```

很像，但 Python 这里每个枚举值通常还会绑定一个字符串值。

在这个项目里，这么做的好处是：

- 更适合日志和状态传输
- 更适合和前端、流式输出、Prompt 里的字符串状态对齐

`tool_async_board.py` 里的 `ToolStatus(Enum)` 也是同类写法。

## 7. 类型标注（type hints）：像“弱约束版 Java 类型”

例如：

```python
from typing import List, Dict, AsyncGenerator
```

以及：

```python
available_agents: List[str] = field(default_factory=list)
selected_route_data: Optional[Dict[str, Any]] = None
```

Java 视角可以这么理解：

- `List[str]` ≈ `List<String>`
- `Dict[str, Any]` ≈ `Map<String, Object>`
- `Optional[str]` 更像“可能为 null 的 String”，不是 Java 8 的 `Optional<String>` 那个类本身

重点是：

Python 这里的类型标注，主要作用是：

- 方便人读代码
- 方便 IDE 补全
- 方便静态检查工具分析

它不会像 Java 编译器那样在大多数情况下强制拦住你。

## 8. `@dataclass`：像 Java 的“字段类 + 自动生成构造/方法”

`core_context.py` 里最关键的一段就是：

```python
from dataclasses import dataclass, field

@dataclass
class AgentCoreContext(AgentBaseContext):
    infer_num: int = 0
    available_agents: List[str] = field(default_factory=list)
    selected_destination: Optional[List[str]] = field(default_factory=list)
```

Java 开发者可以把它先类比成：

- 一个字段很多的 POJO / DTO
- 再加一点类似 Lombok `@Data`、`@Getter/@Setter`、`@AllArgsConstructor` 的减模板能力

但它又不完全等价，因为 Python `@dataclass` 更偏“简化数据对象定义”。

这个写法的价值是：

- 字段定义集中
- 默认值集中
- 少写大量模板代码
- 很适合上下文对象、配置对象、结果对象

在 `tool_async_board.py` 里，`ToolCallSpec`、`ToolResult`、`ToolEvent` 也都用了 `@dataclass`。

## 9. `field(default_factory=list)`：为什么不是直接 `=[]`

这是 Python 初学者非常容易踩坑的地方。

代码里能看到：

```python
available_agents: List[str] = field(default_factory=list)
button_commend_blocks: List[str] = field(default_factory=list)
```

你可能会想，为什么不直接写：

```python
available_agents: List[str] = []
```

因为可变对象如果直接写成默认值，多个实例可能共享同一个列表，后果会非常诡异。

Java 里你通常不会这样想，因为你习惯在构造器里 `new ArrayList<>()`。Python 的 `field(default_factory=list)`，本质上就是在告诉系统：

- 每次创建新对象时
- 都重新生成一个新的空列表

Java 类比：

```java
private List<String> availableAgents = new ArrayList<>();
```

## 10. `__post_init__`：像构造后的补充初始化钩子

`core_context.py` 里有：

```python
def __post_init__(self):
    super().__post_init__()
    self._initialize_tools_and_agents()
    self._initialize_langfuse()
    self._initialize_reasoning_tracker()
    self.tool_board = ToolAsyncBoard(
        session_id=self.session_id,
        generation_id=self.message_id if hasattr(self, 'message_id') else None,
        max_concurrency=16,
        default_timeout=15.0,
    )
```

如果你用 Java 理解，可以把它看成：

- `@dataclass` 自动帮你把字段初始化好了
- 然后 `__post_init__` 再做一轮补充逻辑

类似：

```java
public AgentCoreContext(...) {
    // 先完成字段赋值
    // 再执行额外初始化逻辑
    initTools();
    initLangfuse();
}
```

这个写法很适合：

- 字段初始化和业务初始化分离
- 构造上下文对象后立刻挂上工具板、埋点器、追踪器

## 11. 实例属性：Python 不需要先声明字段再赋值

在 `AgentLoop.__init__` 里会看到很多：

```python
self.context = None
self.item_recs = None
self.llm_model_name = "deepseek-v3"
self.current_state = None
self.MAX_DEPTH = 14
```

Python 允许你这样直接挂属性。Java 不行，Java 一般要先定义：

```java
private Context context;
private ItemRecs itemRecs;
private String llmModelName;
```

所以读 Python 代码时，一个很重要的习惯是：

- 先看 `__init__`
- 它基本就是“这个类有哪些核心成员”的总入口

## 12. 条件、布尔表达式、成员判断

在 `core_context.py` 和 `DT_agent_loop_v2.py` 里能看到很多这种写法：

```python
if self.choiced_hotel:
```

```python
if "customer_agent" in self.available_agents:
```

```python
if self.thinking_channel is not None and self.context is not None:
```

对应 Java 理解：

- `if self.choiced_hotel:`：判断对象是否“有值”
- `in`：判断集合里是否包含某个元素
- `is not None`：判断不是 `null`

### 12.1 Truthy / Falsy

Python 有“真值”概念：

下面这些通常会被当成假：

- `None`
- `""`
- `[]`
- `{}`
- `0`

所以：

```python
if travel_route_datas:
```

意思通常就是：

- 不为 `None`
- 而且不是空数据

Java 里你往往得写成：

```java
if (travelRouteDatas != null && !travelRouteDatas.isEmpty())
```

## 13. 列表、字典、元组：Python 最常用的集合语法

### 13.1 列表 list

`agent_memory.py` 里：

```python
self.memory = []
self.params = []
```

Java 对应：

```java
new ArrayList<>()
```

### 13.2 字典 dict

`tool_async_board.py` 里：

```python
self._calls: Dict[str, ToolCallSpec] = {}
self._results: Dict[str, ToolResult] = {}
```

Java 对应：

```java
new HashMap<String, ToolCallSpec>()
```

### 13.3 元组 tuple

`agent_memory.py` 里：

```python
id_value_pairs.append((self.current_index, value))
```

这里的 `(self.current_index, value)` 是元组。

Java 没有语言内建 tuple，一般要：

- 自己写 Pair 类
- 或用第三方 Pair

Python 里 tuple 很轻，临时存两个值特别常见。

## 14. 列表推导式 / 字典推导式：Python 很常见的简写

### 14.1 列表推导式

`agent_memory.py`：

```python
saved_memory.append([v for v in values if v[0] in indexs])
```

这相当于 Java：

```java
List<Object> filtered = values.stream()
    .filter(v -> indexs.contains(v.get(0)))
    .collect(Collectors.toList());
```

它的模式是：

```python
[表达式 for 变量 in 集合 if 条件]
```

### 14.2 字典推导式

`core_context.py`：

```python
self.NAME_2_TOOL = {tool.register_name: tool for tool in self.ALL_TOOLS}
self.NAME_2_AGENT = {agent.register_name: agent for agent in self.ALL_AGENTS}
self.NAME_2_MEM = {tool.register_name: Memory(f"{tool.register_name}") for tool in self.ALL_TOOLS}
```

Java 对应思路就是：

- 遍历列表
- 按某个字段做 key
- 收集成 Map

比如：

```java
Map<String, Tool> map = tools.stream()
    .collect(Collectors.toMap(Tool::getRegisterName, t -> t));
```

这是 Python 代码里非常常见、也非常值得熟悉的写法。

## 15. 字符串格式化：重点看 f-string

项目里大量使用 f-string，比如：

```python
logger.info(
    f"sid: {self.context.session_id}, dt_channel: {self.context.dt_channel}, headers: {self.request.headers}"
)
```

以及：

```python
self.query = f"(用户当前选择了这些酒店ID：{','.join(self.choiced_hotel)})" + self.query
```

Java 对照可以理解成：

- `String.format(...)`
- 或字符串拼接

但 Python 的 f-string 更直接：

```python
f"你好，{name}"
```

相当于：

```java
"你好，" + name
```

或者：

```java
String.format("你好，%s", name)
```

在 Python 项目里，f-string 是主流写法。

## 16. 异常处理：`try/except` 对应 Java 的 `try/catch`

例如：

```python
try:
    setattr(self.context, 'thinking_channel', self.thinking_channel)
except Exception:
    pass
```

以及：

```python
try:
    hotel_detail_result, _hotel_detail_result = self.context.NAME_2_TOOL["search_hotel_detail_by_id"](...)
except Exception as e:
    logger.error(...)
    pass
```

Java 对照：

```java
try {
    ...
} catch (Exception e) {
    ...
}
```

### 16.1 `except Exception as e`

就等于 Java 的：

```java
catch (Exception e)
```

### 16.2 `pass`

`pass` 的意思是“什么都不做”。

相当于：

```java
catch (Exception e) {
    // ignore
}
```

在真实业务代码里，看到 `pass` 要多留意：

- 这通常表示“容忍失败，流程继续”
- 不能简单理解成“没事”

## 17. `async/await`：这是理解 Agent 主循环最关键的语法

这一组语法是整个 `agent-b101` 里最关键的部分之一。

### 17.1 异步函数定义

`DT_agent_loop_v2.py` 里：

```python
async def initialize(self) -> bool:
```

`tool_async_board.py` 里：

```python
async def register_calls(self, calls: Iterable[ToolCallSpec]) -> None:
```

对应 Java 你可以先类比成：

- 这不是普通同步方法
- 它返回的是“可等待的异步任务”

虽然不完全等价，但你可以先拿 `CompletableFuture` 来建立直觉。

### 17.2 等待异步结果

```python
result = await asyncio.wait_for(invoker(spec), timeout=timeout)
```

这里的 `await` 大概等价于：

- 挂起当前协程
- 等这个异步任务返回
- 不一定阻塞整个线程

Java 粗略类比：

```java
Object result = future.get(timeout, TimeUnit.SECONDS);
```

但 Python `await` 更自然地融在语法里。

### 17.3 为什么这很重要

因为 DeepTrip 的 Agent 主循环不是“串行调用一个工具再调用下一个工具”，而是：

- LLM 推理
- 解析工具调用
- 工具异步派发
- 非阻塞读取事件
- 合并结果继续下一轮推理

所以你读这套代码时，`async/await` 不是点缀，而是主流程骨架。

## 18. `asyncio` 并发原语：事件循环里的“协程版并发控制”

`tool_async_board.py` 里这段很关键：

```python
self._semaphore = asyncio.Semaphore(max(1, max_concurrency))
self._lock = asyncio.Lock()
```

以及：

```python
task = asyncio.create_task(...)
```

```python
result = await asyncio.wait_for(invoker(spec), timeout=timeout)
```

```python
await asyncio.to_thread(_append_name2mem)
```

Java 对照理解：

### 18.1 `asyncio.Semaphore`

相当于 Java 的 `Semaphore`，用于限制并发数。

### 18.2 `asyncio.Lock`

相当于 `ReentrantLock` 的轻量协程版。

### 18.3 `asyncio.create_task`

相当于“把一个异步任务扔出去后台执行”。

可以类比：

- `CompletableFuture.supplyAsync(...)`
- 或线程池提交任务

但注意它运行在 Python 事件循环体系里。

### 18.4 `asyncio.wait_for`

给异步任务加超时控制。

### 18.5 `asyncio.to_thread`

把一个同步函数丢到线程里执行，避免阻塞事件循环。

这一点特别关键：

`tool_async_board.py` 明确在避免“同步逻辑卡住异步主流程”。

## 19. `@property`：像 Java 的 getter，但调用方式像字段

`tool_async_board.py` 中：

```python
@property
def duration(self) -> Optional[float]:
    if self.started_at and self.ended_at:
        return max(0.0, self.ended_at - self.started_at)
    return None
```

这相当于 Java 的：

```java
public Float getDuration() {
    if (startedAt != null && endedAt != null) {
        return Math.max(0.0f, endedAt - startedAt);
    }
    return null;
}
```

但 Python 使用时不是 `obj.getDuration()`，而是：

```python
obj.duration
```

所以你读 Python 代码时，看到像字段一样的访问，不一定真是字段，也可能是 `@property` 包装的方法。

## 20. 反射/动态能力：`hasattr`、`setattr`、`getattr`

这些在 Python 项目里很常见，尤其适合上下文对象这种动态结构。

### 20.1 `hasattr`

`core_context.py`：

```python
generation_id=self.message_id if hasattr(self, 'message_id') else None
```

意思是：

- 如果对象有 `message_id` 这个属性，就取它
- 否则给 `None`

### 20.2 `setattr`

`DT_agent_loop_v2.py`：

```python
setattr(self.context, 'thinking_channel', self.thinking_channel)
```

意思是动态给对象设置属性。

Java 类比就是反射，但 Python 写法轻很多。

### 20.3 `getattr`

虽然你这次重点代码里更多看到 `hasattr/setattr`，但 `getattr(obj, "x", default)` 也是同一类能力。

结论就是：

Python 对象比 Java 对象动态得多，这也是它写 Agent 框架很顺手的原因之一。

## 21. 常见内置函数与写法

### 21.1 `len()`

```python
if len(m) > 150/len(self.memory):
```

相当于 Java 的 `.size()` 或字符串 `.length()`。

### 21.2 `zip()`

`agent_memory.py`：

```python
for param, values in zip(self.params, self.memory):
```

表示把两个列表按位置配对遍历。

Java 里没有这么顺手的内置写法，通常要手动按索引循环。

### 21.3 `reversed()`

```python
for route in reversed(route_list):
```

表示倒序遍历。

### 21.4 `join()`

```python
','.join(self.choiced_hotel)
```

相当于 Java 的：

```java
String.join(",", choicedHotel)
```

### 21.5 切片 `[:6]`

`agent_memory.py`：

```python
values = values[:6]
```

意思是取前 6 个元素。

Java 对照大概是：

```java
values = values.subList(0, 6);
```

### 21.6 删除元素 `del`

```python
del m[random.randint(0,len(m)-1)]
```

表示按索引删除元素。

### 21.7 多变量接收返回值

```python
hotel_detail_result, _hotel_detail_result = ...
```

这表示右边返回了一个可拆包结构，Python 支持一次性解包多个值。

Java 通常得：

- 自定义返回对象
- 或 `Pair`
- 或数组

## 22. `if __name__ == '__main__'`：Python 文件的入口写法

`agent_memory.py` 最下面：

```python
if __name__ == '__main__':
    mem = Memory("test")
    ...
```

可以理解成：

- 这个文件如果是“直接运行”，就执行下面的测试代码
- 如果只是被别的文件 import，就不执行

Java 没有完全一样的语法，但你可以粗略类比成：

```java
public static void main(String[] args)
```

当然它不是类级静态入口，而是模块级入口判断。

## 23. 回到 DeepTrip：这几个文件分别在干什么

### 23.1 `DT_agent_loop_v2.py`

这是主循环控制器，重点语法有：

- `class`
- `__init__`
- `Enum`
- 类型标注
- `async def` / `await`
- `try/except`
- `setattr`
- f-string
- 列表/字典操作

你读这个文件时，要把它看成“状态机 + 编排器”。

### 23.2 `core_context.py`

这是超大的上下文对象，重点语法有：

- `@dataclass`
- `field(default_factory=...)`
- `Optional`
- `Dict[str, Any]`
- `__post_init__`
- 字典推导式
- 条件表达式

你读这个文件时，要把它看成“会话全局共享上下文”。

### 23.3 `tool_async_board.py`

这是异步工具调度中心，重点语法有：

- `@dataclass`
- `Enum`
- `@property`
- `asyncio.Semaphore`
- `asyncio.Lock`
- `asyncio.create_task`
- `asyncio.wait_for`
- `async with`

你读这个文件时，要把它看成“协程版任务调度器 + 结果板”。

### 23.4 `agent_memory.py`

这是最适合入门的文件，重点语法有：

- 列表
- 元组
- `for`
- `while`
- 切片
- `zip`
- `del`
- f-string
- `if __name__ == '__main__'`

你第一次上手 Python，建议先从这个文件读。

## 24. 建议你按这个顺序读源码

推荐顺序：

1. 先读 `agent_memory.py`
   - 代码短
   - 基础语法密集
   - 很适合熟悉 Python 的“手感”
2. 再读 `tool_async_board.py`
   - 开始进入 dataclass、property、asyncio
   - 适合理解 Python 异步模型
3. 再读 `core_context.py`
   - 理解 dataclass 在大型上下文对象中的用法
   - 理解 default_factory、__post_init__
4. 最后读 `DT_agent_loop_v2.py`
   - 这是综合应用
   - 前面语法理解了，再看主循环会轻松很多

## 25. 一页速记：Java 概念到 Python 语法映射

| Java 概念 | Python 对应写法 | 在本项目中的例子 |
|---|---|---|
| 类 | `class AgentLoop:` | `DT_agent_loop_v2.py` |
| 构造器 | `def __init__(self, ...)` | `AgentLoop.__init__` |
| `this` | `self` | `self.context = ...` |
| `enum` | `class X(Enum)` | `LoopState`, `ToolStatus` |
| `List<String>` | `List[str]` | `available_agents: List[str]` |
| `Map<String,Object>` | `Dict[str, Any]` | `selected_route_data` |
| POJO / DTO | `@dataclass` | `AgentCoreContext`, `ToolResult` |
| getter | `@property` | `duration` |
| `try/catch` | `try/except` | `initialize`, `_execute_call` |
| 线程池任务 | `asyncio.create_task(...)` | `dispatch_async` |
| 超时等待 | `await asyncio.wait_for(...)` | `_execute_call` |
| `new ArrayList<>()` 默认初始化 | `field(default_factory=list)` | `available_agents` |
| `String.format` / 拼接 | f-string | `f"sid: {self.context.session_id}"` |
| `main` 方法入口 | `if __name__ == '__main__'` | `agent_memory.py` |

## 结语

对 Java 开发者来说，这几份代码真正难的不是“语法本身”，而是两件事：

第一，接受 Python 的动态性。很多字段、属性、方法调用，不像 Java 那么“先定义得很完整再使用”，而是边初始化边挂载、边运行边组合。

第二，适应 `async/await` 的思维方式。`agent-b101` 这套核心逻辑，本质上是一个“流式输出 + 异步工具调度 + 状态机推进”的系统。你只要把 `asyncio` 这一层吃透，再回头看 `DT_agent_loop_v2.py`，主流程会清晰很多。

建议你读源码时，不要逐行死抠。先问自己三件事：

- 这个类扮演什么角色？
- 它维护了哪些核心状态？
- 它在同步做事，还是在异步编排？

这样读，会比只盯着语法有效得多。
