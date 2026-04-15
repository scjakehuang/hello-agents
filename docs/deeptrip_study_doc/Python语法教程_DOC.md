# Python 语法教程（面向 Java/Go 后端工程师）

## 文档信息

- 作者：徐凯旋
- 邮箱：azouever@gmail.com
- 更新时间：2026-04-14
- 定位：有 Java/Go 经验、快速上手 Python，聚焦 Agent/AI 开发场景

---

## 目录

1. [Python 基础特性速览](#一python-基础特性速览)
2. [类型系统](#二类型系统)
3. [字符串处理](#三字符串处理)
4. [函数与作用域](#四函数与作用域)
5. [类与面向对象](#五类与面向对象)
6. [迭代器与生成器](#六迭代器与生成器)
7. [异常处理](#七异常处理)
8. [模块与包](#八模块与包)
9. [异步编程（重点）](#九异步编程重点)
10. [Pydantic（AI 开发必备）](#十pydanticai-开发必备)
11. [常用标准库速查](#十一常用标准库速查)
12. [环境与依赖管理](#十二环境与依赖管理)
13. [Python 性能陷阱与调优](#十三python-性能陷阱与调优)
14. [速查表](#十四速查表)

---

## 一、Python 基础特性速览

### 1.1 与 Java/Go 的关键差异对比表

| 维度 | Java | Go | Python |
|------|------|----|--------|
| 代码块分隔 | `{}` 花括号 | `{}` 花括号 | **缩进**（4 个空格） |
| 类型系统 | 静态强类型 | 静态强类型 | **动态类型**（可加类型注解） |
| 并发模型 | 多线程（JVM 管理） | goroutine（M:N） | **GIL 限制**，多线程 I/O 密集 / 多进程 CPU 密集 |
| 包管理 | Maven / Gradle | go mod | **pip / uv / conda** |
| 编译方式 | 编译为字节码（JVM） | 编译为原生二进制 | **解释执行**（.pyc 字节码缓存） |
| 空值 | `null` | `nil` | `None` |
| 布尔值 | `true/false` | `true/false` | `True/False`（首字母大写） |
| 字符串 | `String`（不可变） | `string`（不可变） | `str`（不可变） |
| 接口 | `interface` 显式实现 | `interface` 隐式实现 | **Duck Typing** / ABC |
| 错误处理 | 异常（try/catch） | 多返回值 | **异常**（try/except） |
| 分号 | 必须 | 可省略 | **不需要** |

### 1.2 运行方式

```python
# 方式 1：脚本执行
# $ python script.py

# 方式 2：交互式（REPL）
# $ python
# >>> print("hello")

# 方式 3：模块执行
# $ python -m module_name

# 方式 4：Jupyter Notebook（AI/数据场景常用）
# $ jupyter notebook

# 脚本入口惯例
if __name__ == "__main__":
    print("直接运行此脚本时执行")
    # 被 import 时不执行
```

### 1.3 缩进规则（新手必知）

```python
# 正确：用 4 个空格缩进（PEP 8 标准）
def greet(name: str) -> str:
    if name:
        return f"Hello, {name}"
    else:
        return "Hello, World"

# 错误示例：混用 tab 和空格会导致 IndentationError
# def bad():
#     pass  # 4 空格
#	  pass  # tab  <-- 报错
```

---

## 二、类型系统

### 2.1 内置基础类型

```python
# int：任意精度整数，不会溢出
a: int = 42
big: int = 10 ** 100  # Python 原生支持大数

# float：双精度浮点
pi: float = 3.14159

# str：不可变字符串
name: str = "deeptrip"

# bool：True / False（注意大写）
flag: bool = True
print(isinstance(True, int))  # True，bool 是 int 子类

# None：空值，类似 Java null
value = None
print(value is None)  # True，判断 None 用 is，不用 ==

# 类型转换
print(int("42"))        # 42
print(float("3.14"))    # 3.14
print(str(100))         # "100"
print(bool(0))          # False，bool(0/None/""/ []) 均为 False
print(bool("hello"))    # True
```

### 2.2 容器类型

```python
# ===== list：有序、可变 =====
nums: list[int] = [1, 2, 3, 4, 5]
nums.append(6)           # 追加
nums.insert(0, 0)        # 插入到指定位置
nums.pop()               # 删除并返回最后一个元素
nums.pop(0)              # 删除索引 0 的元素
print(nums[1:3])         # 切片：[2, 3]
print(nums[-1])          # 最后一个元素
print(len(nums))         # 长度

# ===== tuple：有序、不可变 =====
point: tuple[int, int] = (10, 20)
x, y = point            # 解包
print(x, y)             # 10 20
# point[0] = 1          # 报错！不可变

# ===== dict：键值对，有序（Python 3.7+）=====
user: dict[str, any] = {
    "name": "deeptrip",
    "age": 3,
    "active": True
}
user["email"] = "info@deeptrip.com"    # 新增/更新
user.get("phone", "N/A")              # 安全取值，默认 N/A
user.pop("active")                    # 删除键
print(user.keys())                    # dict_keys(...)
print(user.values())                  # dict_values(...)
print(user.items())                   # dict_items(...)

# ===== set：无序、唯一元素 =====
tags: set[str] = {"python", "agent", "ai", "python"}
print(tags)             # {"python", "agent", "ai"}，自动去重
tags.add("llm")
tags.discard("ai")      # 删除，不存在不报错
a = {1, 2, 3}
b = {2, 3, 4}
print(a & b)            # 交集：{2, 3}
print(a | b)            # 并集：{1, 2, 3, 4}
print(a - b)            # 差集：{1}

# ===== 容器对比速查 =====
# list   → 有序，可变，允许重复，按索引访问
# tuple  → 有序，不可变，允许重复，适合"多值返回"
# dict   → 键值对，键唯一，O(1) 查找
# set    → 无序，唯一，快速去重与集合运算
```

### 2.3 类型注解（Type Hints）

> **Agent/AI 开发必用**：Pydantic、FastAPI、LangChain 全面依赖类型注解

```python
from typing import Optional, Union, Any, Callable
from typing import TypedDict, Literal, ClassVar

# 变量注解
user_id: int = 1001
message: str = "hello"
items: list[str] = []

# 函数签名注解
def add(a: int, b: int) -> int:
    return a + b

# Optional：可以是 T 或 None
def greet(name: Optional[str] = None) -> str:
    return f"Hello, {name or 'World'}"

# Union：多种类型之一（Python 3.10+ 可写 int | str）
def process(value: Union[int, str]) -> str:
    return str(value)

# Python 3.10+ 新写法
def process_new(value: int | str) -> str:
    return str(value)

# List[T]、Dict[K, V]（Python 3.9+ 可直接用小写）
def get_names() -> list[str]:
    return ["alice", "bob"]

def get_scores() -> dict[str, int]:
    return {"alice": 95, "bob": 87}

# TypedDict：结构化 dict（类似 Go struct）
class UserInfo(TypedDict):
    name: str
    age: int
    email: Optional[str]

user: UserInfo = {"name": "alice", "age": 30, "email": None}

# Callable：可调用类型
def apply(func: Callable[[int, int], int], a: int, b: int) -> int:
    return func(a, b)

result = apply(add, 3, 4)  # 7

# Literal：限定具体值（类似枚举）
def set_level(level: Literal["debug", "info", "warn", "error"]) -> None:
    print(f"Log level: {level}")

# ClassVar：类变量注解
class Config:
    max_retries: ClassVar[int] = 3  # 类级别变量，不是实例变量

# Any：任意类型（谨慎使用）
def accept_anything(value: Any) -> None:
    print(value)
```

---

## 三、字符串处理

### 3.1 f-string（格式化字符串）

```python
name = "DeepTrip"
version = 3.14
items = ["flight", "hotel", "train"]

# 基本用法
print(f"Welcome to {name} v{version:.1f}")
# Welcome to DeepTrip v3.1

# 表达式计算
print(f"2 + 3 = {2 + 3}")
print(f"items count = {len(items)}")

# 嵌套引号（外单内双，或外双内单）
print(f"first item: {items[0]!r}")  # 带引号：'flight'

# 多行 f-string
prompt = (
    f"用户名：{name}\n"
    f"版本：{version}\n"
    f"共 {len(items)} 个服务"
)

# 格式化数字
price = 1234567.89
print(f"价格：{price:,.2f}")   # 1,234,567.89
print(f"进度：{0.756:.1%}")     # 75.6%
print(f"十六进制：{255:#x}")    # 0xff

# Python 3.12+ 调试语法
x = 42
print(f"{x = }")  # x = 42
```

### 3.2 常用字符串方法

```python
s = "  Hello, DeepTrip Agent!  "

# 去除空白
print(s.strip())        # "Hello, DeepTrip Agent!"
print(s.lstrip())       # 去左空白
print(s.rstrip())       # 去右空白

# 大小写
print(s.strip().lower())     # hello, deeptrip agent!
print(s.strip().upper())     # HELLO, DEEPTRIP AGENT!
print(s.strip().title())     # Hello, Deeptrip Agent!

# 分割与合并
csv = "flight,hotel,train,taxi"
parts = csv.split(",")       # ['flight', 'hotel', 'train', 'taxi']
joined = " | ".join(parts)   # "flight | hotel | train | taxi"

# 查找
text = "The agent processed the request"
print(text.find("agent"))      # 4（索引），找不到返回 -1
print(text.index("agent"))     # 4，找不到抛异常
print("agent" in text)         # True
print(text.startswith("The"))  # True
print(text.endswith("request"))# True
print(text.count("e"))         # 4

# 替换
print(text.replace("agent", "AI"))

# 检查内容
print("12345".isdigit())   # True
print("hello".isalpha())   # True
print("".strip() == "")    # True（空字符串检测）

# 对齐与填充
print("42".zfill(5))       # "00042"
print("hi".center(10, "-"))# "----hi----"

# 多行字符串（三引号）
prompt = """
你是一个旅行助手。
请根据用户需求推荐行程。
当前时间：{time}
""".strip()
```

### 3.3 正则表达式

```python
import re

text = "联系我：alice@deeptrip.com 或 bob123@example.org"

# 查找第一个匹配
match = re.search(r"[\w.]+@[\w.]+", text)
if match:
    print(match.group())  # alice@deeptrip.com

# 查找所有匹配
emails = re.findall(r"[\w.]+@[\w.]+", text)
print(emails)  # ['alice@deeptrip.com', 'bob123@example.org']

# 替换
masked = re.sub(r"[\w.]+@[\w.]+", "[email]", text)
print(masked)  # 联系我：[email] 或 [email]

# 分割
parts = re.split(r"\s+或\s+", "apple 或 banana")
print(parts)  # ['apple', 'banana']

# 编译复用（性能优化）
EMAIL_PATTERN = re.compile(r"[\w.+\-]+@[\w.\-]+\.\w+")
result = EMAIL_PATTERN.findall(text)

# 命名分组（Agent 中解析 LLM 输出常用）
response = "出发城市：北京，到达城市：上海，日期：2026-04-15"
pattern = re.compile(
    r"出发城市：(?P<from>\S+)，到达城市：(?P<to>\S+)，日期：(?P<date>\S+)"
)
m = pattern.search(response)
if m:
    print(m.group("from"))  # 北京
    print(m.group("to"))    # 上海
    print(m.group("date"))  # 2026-04-15
    print(m.groupdict())    # {'from': '北京', 'to': '上海', 'date': '2026-04-15'}
```

### 3.4 bytes 与 str 互转

```python
# str → bytes
s = "DeepTrip"
b = s.encode("utf-8")     # b'DeepTrip'
b2 = s.encode("gbk")      # GBK 编码

# bytes → str
s2 = b.decode("utf-8")    # "DeepTrip"

# 处理 API 响应时常见
import json
raw = b'{"name": "alice"}'
data = json.loads(raw.decode("utf-8"))
print(data["name"])  # alice

# 或直接传 bytes（json.loads 接受 bytes）
data2 = json.loads(raw)
```

---

## 四、函数与作用域

### 4.1 参数类型

```python
# 默认参数（注意：默认值在定义时求值一次，用不可变类型）
def connect(host: str, port: int = 8080, timeout: float = 30.0) -> str:
    return f"{host}:{port} (timeout={timeout}s)"

print(connect("localhost"))           # localhost:8080 (timeout=30.0s)
print(connect("prod.api.com", 443))   # prod.api.com:443 (timeout=30.0s)

# 默认参数陷阱：不要用可变对象作默认值！
# 错误写法
def bad_append(item, lst=[]):  # lst 在所有调用间共享！
    lst.append(item)
    return lst

# 正确写法
def good_append(item: str, lst: list | None = None) -> list:
    if lst is None:
        lst = []
    lst.append(item)
    return lst

# *args：接收任意数量位置参数
def sum_all(*args: int) -> int:
    return sum(args)

print(sum_all(1, 2, 3, 4))  # 10

# **kwargs：接收任意数量关键字参数
def log_event(event: str, **kwargs) -> None:
    print(f"[EVENT] {event}: {kwargs}")

log_event("user_login", user_id=42, ip="192.168.1.1")
# [EVENT] user_login: {'user_id': 42, 'ip': '192.168.1.1'}

# 混合使用（顺序：普通参数 → *args → 关键字参数 → **kwargs）
def mixed(a: int, b: int, *args: int, verbose: bool = False, **kwargs) -> None:
    print(a, b, args, verbose, kwargs)

mixed(1, 2, 3, 4, verbose=True, tag="test")
# 1 2 (3, 4) True {'tag': 'test'}
```

### 4.2 关键字参数与强制方式

```python
# 用 * 分隔：* 后面的参数必须用关键字传入
def create_agent(name: str, *, model: str, temperature: float = 0.7) -> dict:
    return {"name": name, "model": model, "temperature": temperature}

# create_agent("bot", "gpt-4", 0.5)   # 报错！model 必须是关键字参数
agent = create_agent("bot", model="gpt-4", temperature=0.5)

# / 前面的参数只能位置传入（Python 3.8+）
def strict_add(a: int, b: int, /) -> int:
    return a + b

# strict_add(a=1, b=2)  # 报错
result = strict_add(1, 2)   # 正确
```

### 4.3 闭包与 nonlocal

```python
# 闭包：内部函数引用外部函数的变量
def make_counter(start: int = 0):
    count = start

    def increment(step: int = 1) -> int:
        nonlocal count  # 声明修改外层变量
        count += step
        return count

    def reset() -> None:
        nonlocal count
        count = start

    return increment, reset

inc, rst = make_counter(10)
print(inc())    # 11
print(inc(5))   # 16
rst()
print(inc())    # 11
```

### 4.4 lambda 表达式

```python
# lambda：单行匿名函数
square = lambda x: x ** 2
print(square(5))  # 25

# 常见用途：排序 key
users = [
    {"name": "charlie", "age": 30},
    {"name": "alice", "age": 25},
    {"name": "bob", "age": 28},
]
users.sort(key=lambda u: u["age"])
print([u["name"] for u in users])  # ['alice', 'bob', 'charlie']

# 多级排序
users.sort(key=lambda u: (u["age"], u["name"]))
```

### 4.5 函数装饰器

```python
import time
import functools
from typing import Callable, TypeVar, ParamSpec

P = ParamSpec("P")
R = TypeVar("R")

# ===== 无参装饰器 =====
def timer(func: Callable[P, R]) -> Callable[P, R]:
    @functools.wraps(func)  # 保留原函数的 __name__、__doc__ 等
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        start = time.perf_counter()
        result = func(*args, **kwargs)
        elapsed = time.perf_counter() - start
        print(f"{func.__name__} 耗时 {elapsed:.3f}s")
        return result
    return wrapper

@timer
def slow_task() -> str:
    time.sleep(0.1)
    return "done"

slow_task()  # slow_task 耗时 0.100s

# ===== 有参装饰器（工厂模式）=====
def retry(max_attempts: int = 3, delay: float = 1.0):
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(1, max_attempts + 1):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    if attempt == max_attempts:
                        raise
                    print(f"第 {attempt} 次失败：{e}，{delay}s 后重试")
                    time.sleep(delay)
        return wrapper
    return decorator

@retry(max_attempts=3, delay=0.5)
def unstable_api() -> str:
    import random
    if random.random() < 0.7:
        raise ConnectionError("网络异常")
    return "成功"

# ===== 类装饰器 =====
class Singleton:
    """单例装饰器"""
    def __init__(self, cls):
        self._cls = cls
        self._instance = None
        functools.update_wrapper(self, cls)

    def __call__(self, *args, **kwargs):
        if self._instance is None:
            self._instance = self._cls(*args, **kwargs)
        return self._instance

@Singleton
class DatabasePool:
    def __init__(self):
        self.connections = []

db1 = DatabasePool()
db2 = DatabasePool()
print(db1 is db2)  # True
```

---

## 五、类与面向对象

### 5.1 基础类定义

```python
class Agent:
    # 类变量（所有实例共享）
    agent_count: int = 0

    def __init__(self, name: str, model: str = "gpt-4") -> None:
        # 实例变量
        self.name = name
        self.model = model
        self._messages: list[dict] = []  # 单下划线：约定为内部用
        self.__secret: str = "key"       # 双下划线：名称改写（name mangling）
        Agent.agent_count += 1

    def chat(self, user_input: str) -> str:
        self._messages.append({"role": "user", "content": user_input})
        response = f"[{self.name}] 处理: {user_input}"
        self._messages.append({"role": "assistant", "content": response})
        return response

    def __repr__(self) -> str:
        """调试用，repr(obj) 或直接在 REPL 中显示"""
        return f"Agent(name={self.name!r}, model={self.model!r})"

    def __str__(self) -> str:
        """str(obj) 或 print(obj)"""
        return f"Agent[{self.name}]"

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Agent):
            return NotImplemented
        return self.name == other.name

    def __hash__(self) -> int:
        return hash(self.name)

agent = Agent("TripBot")
print(repr(agent))   # Agent(name='TripBot', model='gpt-4')
print(str(agent))    # Agent[TripBot]
```

### 5.2 继承与 super()

```python
class BaseAgent:
    def __init__(self, name: str) -> None:
        self.name = name

    def describe(self) -> str:
        return f"我是 BaseAgent: {self.name}"

class TravelAgent(BaseAgent):
    def __init__(self, name: str, speciality: str) -> None:
        super().__init__(name)   # 调用父类 __init__
        self.speciality = speciality

    def describe(self) -> str:
        base = super().describe()  # 调用父类方法
        return f"{base}，专长：{self.speciality}"

agent = TravelAgent("TripBot", "机票预订")
print(agent.describe())
# 我是 BaseAgent: TripBot，专长：机票预订

# 多继承（Python 支持，MRO 按 C3 线性化）
class Loggable:
    def log(self, msg: str) -> None:
        print(f"[LOG] {msg}")

class SmartAgent(TravelAgent, Loggable):
    pass

smart = SmartAgent("SmartBot", "全能助手")
smart.log("初始化完成")
```

### 5.3 Property、classmethod、staticmethod

```python
class Temperature:
    def __init__(self, celsius: float) -> None:
        self._celsius = celsius

    @property
    def celsius(self) -> float:
        """getter：像访问属性一样调用"""
        return self._celsius

    @celsius.setter
    def celsius(self, value: float) -> None:
        """setter：赋值时验证"""
        if value < -273.15:
            raise ValueError("温度不能低于绝对零度")
        self._celsius = value

    @property
    def fahrenheit(self) -> float:
        """只读属性：摄氏转华氏"""
        return self._celsius * 9 / 5 + 32

    @classmethod
    def from_fahrenheit(cls, f: float) -> "Temperature":
        """类方法：替代构造函数"""
        return cls((f - 32) * 5 / 9)

    @staticmethod
    def is_boiling(temp_c: float) -> bool:
        """静态方法：与类相关但不依赖实例或类"""
        return temp_c >= 100.0

t = Temperature(100)
print(t.fahrenheit)                     # 212.0
t2 = Temperature.from_fahrenheit(212)
print(t2.celsius)                       # 100.0
print(Temperature.is_boiling(99))       # False
```

### 5.4 上下文管理器（__enter__ / __exit__）

```python
class DatabaseConnection:
    def __init__(self, url: str) -> None:
        self.url = url
        self.connection = None

    def __enter__(self):
        print(f"连接到 {self.url}")
        self.connection = {"url": self.url, "active": True}
        return self.connection  # with ... as conn 得到的对象

    def __exit__(self, exc_type, exc_val, exc_tb):
        print("关闭连接")
        if self.connection:
            self.connection["active"] = False
        # 返回 True 表示吞掉异常，False 或 None 则继续传播
        return False

with DatabaseConnection("postgres://localhost/db") as conn:
    print(f"使用连接：{conn}")
    # 离开 with 块自动调用 __exit__
```

### 5.5 dataclass

> **Agent/AI 开发高频使用**：快速定义数据结构

```python
from dataclasses import dataclass, field
from typing import Optional

@dataclass
class Message:
    role: str
    content: str
    tokens: int = 0                          # 带默认值
    metadata: dict = field(default_factory=dict)  # 可变默认值必须用 field
    _id: int = field(default=0, repr=False)  # repr=False：不显示在 repr 中

    def __post_init__(self):
        """初始化后的额外处理"""
        if self.role not in ("user", "assistant", "system"):
            raise ValueError(f"非法 role: {self.role}")

@dataclass(frozen=True)  # 不可变（可哈希，可作 dict key）
class ModelConfig:
    model: str
    temperature: float = 0.7
    max_tokens: int = 2048

msg = Message(role="user", content="订机票")
print(msg)  # Message(role='user', content='订机票', tokens=0, metadata={})

cfg = ModelConfig(model="gpt-4")
# cfg.model = "gpt-3.5"  # 报错！frozen=True
```

### 5.6 ABC 抽象类

```python
from abc import ABC, abstractmethod

class BaseTool(ABC):
    """Agent 工具基类"""

    @abstractmethod
    def name(self) -> str:
        """工具名称"""

    @abstractmethod
    def description(self) -> str:
        """工具描述（用于 LLM 决策）"""

    @abstractmethod
    def execute(self, **kwargs) -> str:
        """执行工具"""

    def validate_input(self, **kwargs) -> bool:
        """可选：提供默认实现"""
        return True

class FlightSearchTool(BaseTool):
    def name(self) -> str:
        return "flight_search"

    def description(self) -> str:
        return "搜索航班信息，需要出发城市、目的城市和日期"

    def execute(self, **kwargs) -> str:
        from_city = kwargs.get("from_city", "")
        to_city = kwargs.get("to_city", "")
        return f"搜索 {from_city} → {to_city} 的航班..."

tool = FlightSearchTool()
print(tool.name())  # flight_search
# BaseTool()  # 报错，不能实例化抽象类
```

---

## 六、迭代器与生成器

### 6.1 基础迭代

```python
items = ["flight", "hotel", "train"]

# for...in
for item in items:
    print(item)

# enumerate：带索引遍历
for i, item in enumerate(items, start=1):
    print(f"{i}. {item}")
# 1. flight
# 2. hotel
# 3. train

# zip：并行遍历
prices = [1200, 580, 320]
for item, price in zip(items, prices):
    print(f"{item}: ¥{price}")

# zip_longest（长度不一致时填充）
from itertools import zip_longest
for a, b in zip_longest([1, 2, 3], [4, 5], fillvalue=0):
    print(a, b)  # 3 行，最后一行：3 0

# range
for i in range(10):           # 0~9
    pass
for i in range(0, 10, 2):    # 0,2,4,6,8
    pass
for i in range(10, 0, -1):   # 倒序 10~1
    pass
```

### 6.2 推导式

```python
# 列表推导式
squares = [x ** 2 for x in range(10)]
# [0, 1, 4, 9, 16, 25, 36, 49, 64, 81]

# 带条件过滤
evens = [x for x in range(20) if x % 2 == 0]

# 嵌套（矩阵展平）
matrix = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
flat = [n for row in matrix for n in row]
# [1, 2, 3, 4, 5, 6, 7, 8, 9]

# 字典推导式
word_len = {word: len(word) for word in ["flight", "hotel", "train"]}
# {'flight': 6, 'hotel': 5, 'train': 5}

# 集合推导式
unique_lens = {len(word) for word in ["flight", "hotel", "train", "taxi"]}
# {3, 4, 5, 6}

# 生成器表达式（惰性求值，节省内存）
total = sum(x ** 2 for x in range(1000000))  # 不会创建列表
```

### 6.3 生成器函数（yield）

> **AI/Agent 场景**：流式输出（SSE）必用

```python
from typing import Generator

def fibonacci() -> Generator[int, None, None]:
    """无限斐波那契数列生成器"""
    a, b = 0, 1
    while True:
        yield a
        a, b = b, a + b

gen = fibonacci()
for _ in range(10):
    print(next(gen), end=" ")  # 0 1 1 2 3 5 8 13 21 34

# 生成器节省内存：逐行读大文件
def read_large_file(filepath: str) -> Generator[str, None, None]:
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            yield line.strip()

# 模拟 LLM 流式输出
def stream_response(prompt: str) -> Generator[str, None, None]:
    tokens = prompt.split()
    for token in tokens:
        yield token + " "

for chunk in stream_response("Hello World"):
    print(chunk, end="", flush=True)

# yield from：委托给子生成器
def chain(*iterables):
    for it in iterables:
        yield from it

list(chain([1, 2], [3, 4], [5]))  # [1, 2, 3, 4, 5]
```

### 6.4 itertools 常用函数

```python
import itertools

# islice：切片生成器
from itertools import islice
fib = fibonacci()
first_5 = list(islice(fib, 5))  # [0, 1, 1, 2, 3]

# chain：串联多个可迭代对象
combined = list(itertools.chain([1, 2], [3, 4], [5, 6]))
# [1, 2, 3, 4, 5, 6]

# groupby：分组（需先排序）
data = [
    {"type": "flight", "price": 1200},
    {"type": "hotel", "price": 580},
    {"type": "flight", "price": 900},
    {"type": "hotel", "price": 350},
]
sorted_data = sorted(data, key=lambda x: x["type"])
for key, group in itertools.groupby(sorted_data, key=lambda x: x["type"]):
    print(key, list(group))

# product：笛卡尔积
for city_pair in itertools.product(["北京", "上海"], ["广州", "深圳"]):
    print(city_pair)

# combinations / permutations
from itertools import combinations, permutations
print(list(combinations([1, 2, 3], 2)))  # [(1,2),(1,3),(2,3)]
print(list(permutations([1, 2, 3], 2)))  # [(1,2),(1,3),(2,1),...]
```

---

## 七、异常处理

### 7.1 try/except/else/finally

```python
def parse_price(s: str) -> float:
    try:
        result = float(s)
    except ValueError as e:
        print(f"格式错误：{e}")
        return 0.0
    except (TypeError, AttributeError) as e:
        print(f"类型错误：{e}")
        return 0.0
    else:
        # try 块无异常时执行
        print(f"解析成功：{result}")
        return result
    finally:
        # 无论如何都执行（常用于释放资源）
        print("parse_price 执行完毕")

parse_price("12.5")   # 成功
parse_price("abc")    # ValueError
parse_price(None)     # AttributeError
```

### 7.2 自定义异常

```python
class DeepTripError(Exception):
    """DeepTrip 基础异常"""
    def __init__(self, message: str, code: str = "UNKNOWN") -> None:
        super().__init__(message)
        self.code = code
        self.message = message

    def __str__(self) -> str:
        return f"[{self.code}] {self.message}"

class FlightNotFoundError(DeepTripError):
    """航班未找到"""
    def __init__(self, from_city: str, to_city: str, date: str) -> None:
        super().__init__(
            f"{from_city} → {to_city} 在 {date} 无可用航班",
            code="FLIGHT_NOT_FOUND"
        )
        self.from_city = from_city
        self.to_city = to_city

try:
    raise FlightNotFoundError("北京", "三亚", "2026-04-15")
except FlightNotFoundError as e:
    print(e)         # [FLIGHT_NOT_FOUND] 北京 → 三亚 在 2026-04-15 无可用航班
    print(e.code)    # FLIGHT_NOT_FOUND
```

### 7.3 raise from（异常链）

```python
def fetch_flight_data(flight_id: str) -> dict:
    try:
        # 模拟数据库操作
        raise ConnectionError("数据库连接失败")
    except ConnectionError as e:
        raise DeepTripError("获取航班数据失败", "DB_ERROR") from e
        # from e 保留原始异常，traceback 中可见原因链

try:
    fetch_flight_data("CA1234")
except DeepTripError as e:
    print(e)
    print(f"原因：{e.__cause__}")
```

### 7.4 with 语句与 contextlib

```python
from contextlib import contextmanager, asynccontextmanager

@contextmanager
def managed_resource(name: str):
    """用装饰器实现上下文管理器（简化版）"""
    print(f"获取资源：{name}")
    resource = {"name": name, "active": True}
    try:
        yield resource
    except Exception as e:
        print(f"资源 {name} 出错：{e}")
        raise
    finally:
        resource["active"] = False
        print(f"释放资源：{name}")

with managed_resource("flight-cache") as res:
    print(f"使用资源：{res['name']}")
```

---

## 八、模块与包

### 8.1 import 方式

```python
# 1. 导入整个模块
import os
import json
path = os.path.join("/home", "user")

# 2. 从模块导入特定名称
from os.path import join, exists
from typing import Optional, List

# 3. 带别名（长名称常用）
import numpy as np          # 科学计算惯例
import pandas as pd         # 数据分析惯例
from datetime import datetime as dt

# 4. 导入全部（不推荐，污染命名空间）
# from os.path import *

# 5. 条件导入（处理可选依赖）
try:
    import ujson as json    # 尝试用快速 JSON 库
except ImportError:
    import json             # 回退标准库
```

### 8.2 包结构与 __init__.py

```
# 典型 Agent 项目结构
my_agent/
├── __init__.py          # 标记为包，可空或导出公共 API
├── core/
│   ├── __init__.py
│   ├── agent.py
│   └── tools.py
├── utils/
│   ├── __init__.py
│   └── helpers.py
└── main.py
```

```python
# my_agent/__init__.py：控制包的公共接口
from .core.agent import Agent
from .core.tools import BaseTool

__version__ = "1.0.0"
__all__ = ["Agent", "BaseTool"]  # 控制 from my_agent import * 的内容

# 使用方
from my_agent import Agent  # 直接用，不需要 from my_agent.core.agent import Agent
```

### 8.3 相对导入 vs 绝对导入

```python
# 绝对导入（推荐）
from my_agent.core.agent import Agent
from my_agent.utils.helpers import format_date

# 相对导入（包内部使用）
# 在 my_agent/core/tools.py 中：
from .agent import Agent        # 同级
from ..utils.helpers import format_date  # 上一级的 utils

# __name__ == "__main__"：作为脚本执行时的保护
if __name__ == "__main__":
    # 只有直接运行 python main.py 时才执行
    # import 时不执行
    main()
```

---

## 九、异步编程（重点）

> **Agent/AI 开发核心**：LangChain、FastAPI、httpx 全面基于 asyncio

### 9.1 asyncio 基础概念

```
事件循环（Event Loop）工作原理：

  [任务队列]
  ┌──────────────────────────────────────┐
  │  coroutine A │ coroutine B │ ...    │
  └──────────────────────────────────────┘
           │ await I/O 时让出控制权
           ▼
  ┌─────────────────────────────────────┐
  │         Event Loop（单线程）        │
  │  取出任务 → 执行 → 遇 await 挂起   │
  │  → 切换到下一个就绪任务             │
  └─────────────────────────────────────┘
           │ I/O 完成后恢复
           ▼
  [任务继续执行，直到下一个 await]

关键点：
- 单线程，靠协作式调度
- await 是"让出点"，而非阻塞
- 适合 I/O 密集（网络、文件），不适合 CPU 密集
```

### 9.2 async def / await 基础

```python
import asyncio

# 定义协程函数
async def fetch_flight(from_city: str, to_city: str) -> dict:
    print(f"开始查询 {from_city} → {to_city}")
    await asyncio.sleep(1)  # 模拟 I/O 等待（不阻塞事件循环）
    return {"from": from_city, "to": to_city, "price": 1200}

async def main():
    result = await fetch_flight("北京", "上海")
    print(result)

# 运行事件循环
asyncio.run(main())
```

### 9.3 asyncio.gather（并发执行）

> **Agent 中最常用**：并发调用多个工具/API

```python
import asyncio
import time

async def call_tool(tool_name: str, delay: float) -> str:
    await asyncio.sleep(delay)
    return f"{tool_name} 结果"

async def run_tools_concurrently():
    start = time.perf_counter()

    # gather：并发执行，等待全部完成
    results = await asyncio.gather(
        call_tool("flight_search", 1.0),
        call_tool("hotel_search", 1.5),
        call_tool("weather_api", 0.5),
    )
    # 总耗时 ≈ 1.5s，而非 3s

    elapsed = time.perf_counter() - start
    print(f"耗时 {elapsed:.2f}s，结果: {results}")

asyncio.run(run_tools_concurrently())

# gather 错误处理：return_exceptions=True 不让一个失败影响全部
async def safe_gather():
    results = await asyncio.gather(
        call_tool("tool_a", 1.0),
        asyncio.sleep(0/0),  # 故意抛错
        call_tool("tool_c", 0.5),
        return_exceptions=True,  # 异常作为结果返回，不抛出
    )
    for r in results:
        if isinstance(r, Exception):
            print(f"工具失败：{r}")
        else:
            print(f"工具成功：{r}")
```

### 9.4 asyncio.create_task

```python
import asyncio

async def background_monitor(interval: float) -> None:
    """后台监控任务"""
    while True:
        print("[Monitor] 系统正常")
        await asyncio.sleep(interval)

async def main():
    # create_task：立即调度，不等待结果
    monitor_task = asyncio.create_task(background_monitor(2.0))

    # 主流程继续执行
    await asyncio.sleep(5)

    # 取消后台任务
    monitor_task.cancel()
    try:
        await monitor_task
    except asyncio.CancelledError:
        print("监控任务已停止")

asyncio.run(main())
```

### 9.5 异步上下文管理器（async with）

```python
import asyncio

class AsyncHttpClient:
    async def __aenter__(self):
        print("建立 HTTP 连接")
        self.session = {"active": True}
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        print("关闭 HTTP 连接")
        self.session["active"] = False

    async def get(self, url: str) -> dict:
        await asyncio.sleep(0.1)  # 模拟网络请求
        return {"url": url, "status": 200}

async def main():
    async with AsyncHttpClient() as client:
        result = await client.get("https://api.deeptrip.com/flights")
        print(result)

asyncio.run(main())
```

### 9.6 异步迭代器（async for）

```python
import asyncio
from typing import AsyncGenerator

# 模拟 LLM 流式输出（SSE）
async def stream_llm_response(prompt: str) -> AsyncGenerator[str, None]:
    words = prompt.split()
    for word in words:
        await asyncio.sleep(0.1)  # 模拟流式延迟
        yield word + " "

async def main():
    print("LLM 回复：", end="")
    async for chunk in stream_llm_response("今天天气怎么样"):
        print(chunk, end="", flush=True)
    print()

asyncio.run(main())
```

### 9.7 同步代码在异步环境中运行

```python
import asyncio
from concurrent.futures import ThreadPoolExecutor
import time

def cpu_intensive_task(n: int) -> int:
    """CPU 密集型同步函数（会阻塞事件循环）"""
    return sum(i * i for i in range(n))

def blocking_io_task(seconds: float) -> str:
    """阻塞 I/O（如同步数据库驱动）"""
    time.sleep(seconds)
    return "io完成"

async def main():
    loop = asyncio.get_event_loop()

    # run_in_executor：在线程池中运行同步代码，不阻塞事件循环
    result = await loop.run_in_executor(
        None,                     # None = 默认线程池
        blocking_io_task,
        1.0
    )
    print(result)

    # CPU 密集型：用 ProcessPoolExecutor
    with ThreadPoolExecutor(max_workers=4) as pool:
        result = await loop.run_in_executor(pool, cpu_intensive_task, 1000000)
        print(f"计算结果：{result}")

asyncio.run(main())
```

### 9.8 常见错误

```python
# ===== 错误 1：在同步函数中 await =====
# def bad_sync():
#     result = await fetch_data()  # SyntaxError: 'await' outside async function

# ===== 错误 2：在同步上下文中直接调用协程 =====
# result = fetch_flight("北京", "上海")  # 返回协程对象，不执行！
# 正确：
# asyncio.run(fetch_flight("北京", "上海"))

# ===== 错误 3：在已有事件循环中调用 asyncio.run() =====
# Jupyter 中常见，因为 Jupyter 自带事件循环
# asyncio.run(main())  # RuntimeError: This event loop is already running
# 解决：用 nest_asyncio 或 await main()

# 在 Jupyter / 已有事件循环的环境中：
# import nest_asyncio
# nest_asyncio.apply()

# ===== 错误 4：忘记 await 协程 =====
async def process():
    result = fetch_flight("北京", "上海")  # 忘记 await！
    # result 是协程对象，不是 dict
    print(result)  # <coroutine object fetch_flight at 0x...>

# ===== 错误 5：阻塞事件循环 =====
async def bad():
    import time
    time.sleep(5)  # 阻塞！整个事件循环都卡住
    # 应该用：await asyncio.sleep(5)
```

---

## 十、Pydantic（AI 开发必备）

> **LangChain、FastAPI、AI Agent 框架全面依赖 Pydantic**

### 10.1 BaseModel 基础

```python
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

class FlightInfo(BaseModel):
    flight_no: str
    from_city: str
    to_city: str
    departure_time: datetime
    price: float
    available_seats: int = 0
    tags: List[str] = []

# 自动验证
flight = FlightInfo(
    flight_no="CA1234",
    from_city="北京",
    to_city="上海",
    departure_time="2026-04-15T08:30:00",  # 自动解析字符串
    price=1299.0,
)
print(flight.model_dump())  # 转为 dict

# 类型错误时抛出 ValidationError
# FlightInfo(flight_no=123, ...)  # ValidationError
```

### 10.2 Field 进阶

```python
from pydantic import BaseModel, Field

class SearchRequest(BaseModel):
    from_city: str = Field(..., description="出发城市", min_length=2)
    to_city: str = Field(..., description="到达城市", min_length=2)
    date: str = Field(..., description="出发日期", pattern=r"\d{4}-\d{2}-\d{2}")
    passengers: int = Field(default=1, ge=1, le=9, description="乘客数量")
    # alias：接受不同命名的输入字段
    api_key: str = Field(..., alias="apiKey")

    model_config = {"populate_by_name": True}  # v2：允许同时用 alias 和字段名

req = SearchRequest(
    from_city="北京",
    to_city="上海",
    date="2026-04-15",
    apiKey="sk-xxx",  # 用 alias
)
print(req.api_key)  # sk-xxx
```

### 10.3 validator

```python
from pydantic import BaseModel, field_validator, model_validator
from typing import Self

class BookingRequest(BaseModel):
    from_city: str
    to_city: str
    depart_date: str
    return_date: Optional[str] = None

    @field_validator("depart_date", "return_date", mode="before")
    @classmethod
    def normalize_date(cls, v: str | None) -> str | None:
        """字段级验证：标准化日期格式"""
        if v is None:
            return v
        # 将 20260415 → 2026-04-15
        if len(v) == 8 and v.isdigit():
            return f"{v[:4]}-{v[4:6]}-{v[6:]}"
        return v

    @model_validator(mode="after")
    def validate_dates(self) -> Self:
        """模型级验证：跨字段逻辑"""
        if self.from_city == self.to_city:
            raise ValueError("出发城市和到达城市不能相同")
        if self.return_date and self.return_date < self.depart_date:
            raise ValueError("返回日期不能早于出发日期")
        return self

req = BookingRequest(
    from_city="北京",
    to_city="上海",
    depart_date="20260415",   # 自动标准化
    return_date="2026-04-20"
)
print(req.depart_date)  # 2026-04-15
```

### 10.4 嵌套模型

```python
from pydantic import BaseModel
from typing import List

class Passenger(BaseModel):
    name: str
    id_type: str = "身份证"
    id_number: str

class FlightBooking(BaseModel):
    flight_no: str
    passengers: List[Passenger]
    contact_phone: str
    total_price: float = 0.0

    def calculate_price(self, per_ticket: float) -> None:
        self.total_price = per_ticket * len(self.passengers)

booking = FlightBooking(
    flight_no="CA1234",
    passengers=[
        {"name": "张三", "id_number": "110101199001011234"},
        {"name": "李四", "id_number": "110101199501011234"},
    ],
    contact_phone="13800138000",
)
booking.calculate_price(1299.0)
print(booking.total_price)  # 2598.0
```

### 10.5 model_dump / model_validate

```python
from pydantic import BaseModel
import json

class AgentState(BaseModel):
    session_id: str
    messages: list[dict] = []
    tool_calls: int = 0

state = AgentState(session_id="abc123", tool_calls=5)

# 序列化
d = state.model_dump()                          # → dict
d_exclude = state.model_dump(exclude={"tool_calls"})  # 排除字段
j = state.model_dump_json()                     # → JSON 字符串

# 反序列化
state2 = AgentState.model_validate(d)           # dict → model
state3 = AgentState.model_validate_json(j)      # JSON → model

# 更新（不可变风险：直接赋值不触发验证，用 model_copy）
new_state = state.model_copy(update={"tool_calls": 10})
```

### 10.6 Pydantic v1 vs v2 迁移

| 特性 | v1 | v2 |
|------|----|----|
| 导出 dict | `.dict()` | `.model_dump()` |
| 从 dict 构造 | `.parse_obj()` | `.model_validate()` |
| 从 JSON 构造 | `.parse_raw()` | `.model_validate_json()` |
| JSON Schema | `.schema()` | `.model_json_schema()` |
| 字段验证器 | `@validator` | `@field_validator` |
| 模型级验证 | `@root_validator` | `@model_validator` |
| 配置类 | `class Config` | `model_config = {}` |
| 速度 | 基准 | **5-50x 更快**（Rust 核心） |

```python
# v2 兼容 v1（过渡期使用）
# pip install pydantic[v1]
# from pydantic.v1 import BaseModel  # 使用 v1 API
```

---

## 十一、常用标准库速查

### 11.1 pathlib（文件路径）

```python
from pathlib import Path

# 构造路径（跨平台，不用手拼字符串）
base = Path("/Users/deeptrip")
config_dir = base / "config"       # 路径拼接
log_file = config_dir / "app.log"

# 基本操作
print(log_file.name)           # app.log
print(log_file.stem)           # app
print(log_file.suffix)         # .log
print(log_file.parent)         # /Users/deeptrip/config

# 文件操作
config_dir.mkdir(parents=True, exist_ok=True)  # 创建目录（含父目录）
log_file.write_text("日志内容", encoding="utf-8")
content = log_file.read_text(encoding="utf-8")
log_file.unlink()  # 删除文件

# 遍历
for f in base.glob("**/*.json"):   # 递归查找
    print(f)
for f in base.iterdir():           # 当前目录
    if f.is_file():
        print(f.name)

# 检查
print(config_dir.exists())
print(config_dir.is_dir())
```

### 11.2 json

```python
import json
from datetime import datetime

# 基本操作
data = {"name": "DeepTrip", "version": 3, "active": True}
j = json.dumps(data, ensure_ascii=False, indent=2)
d = json.loads(j)

# 读写文件
with open("config.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

with open("config.json", "r", encoding="utf-8") as f:
    loaded = json.load(f)

# 处理 datetime（标准库 json 不支持，需自定义）
class DateTimeEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        return super().default(obj)

event = {"time": datetime.now(), "action": "booking"}
j = json.dumps(event, cls=DateTimeEncoder)

# 或用 default 参数（简洁）
j = json.dumps(event, default=str)  # datetime → str
```

### 11.3 datetime

```python
from datetime import datetime, date, timedelta, timezone

# 当前时间
now = datetime.now()              # 本地时间（无时区信息）
utc_now = datetime.now(timezone.utc)  # UTC 时间（有时区）

# 格式化
print(now.strftime("%Y-%m-%d %H:%M:%S"))  # 2026-04-14 10:30:00
print(now.isoformat())                     # 2026-04-14T10:30:00.000000

# 解析
dt = datetime.strptime("2026-04-15 08:30", "%Y-%m-%d %H:%M")
dt2 = datetime.fromisoformat("2026-04-15T08:30:00")

# 时间计算
tomorrow = now + timedelta(days=1)
three_hours_later = now + timedelta(hours=3)
diff = tomorrow - now
print(diff.days, diff.seconds)

# 时区处理（推荐用 zoneinfo，Python 3.9+）
from zoneinfo import ZoneInfo
china_tz = ZoneInfo("Asia/Shanghai")
cn_now = datetime.now(china_tz)
```

### 11.4 collections

```python
from collections import defaultdict, Counter, deque, OrderedDict

# defaultdict：访问不存在的 key 时自动创建默认值
city_flights: defaultdict[str, list] = defaultdict(list)
city_flights["北京"].append("CA1234")  # 不会 KeyError
city_flights["北京"].append("MU5678")

# Counter：计数器
words = ["apple", "banana", "apple", "cherry", "banana", "apple"]
counter = Counter(words)
print(counter.most_common(2))  # [('apple', 3), ('banana', 2)]

# deque：双端队列（O(1) 两端操作，比 list.insert(0) 快）
queue: deque[str] = deque(maxlen=100)  # 最大长度，自动丢弃旧元素
queue.append("right")      # 右侧追加
queue.appendleft("left")   # 左侧追加
queue.pop()                # 右侧弹出
queue.popleft()            # 左侧弹出

# OrderedDict（Python 3.7+ 普通 dict 已保序，OrderedDict 用于需要 move_to_end 时）
od = OrderedDict([("a", 1), ("b", 2), ("c", 3)])
od.move_to_end("a")  # 移到末尾
```

### 11.5 functools

```python
import functools

# lru_cache：缓存函数结果（AI 中缓存 embedding 等昂贵操作）
@functools.lru_cache(maxsize=128)
def get_embedding(text: str) -> list[float]:
    print(f"计算 embedding: {text}")  # 实际调用时才打印
    return [0.1, 0.2, 0.3]  # 模拟

get_embedding("hello")   # 计算
get_embedding("hello")   # 命中缓存，不再计算
print(get_embedding.cache_info())  # CacheInfo(hits=1, misses=1, ...)

# partial：固定部分参数
def api_call(base_url: str, endpoint: str, timeout: int = 30) -> str:
    return f"GET {base_url}{endpoint} (timeout={timeout}s)"

deeptrip_api = functools.partial(api_call, "https://api.deeptrip.com")
print(deeptrip_api("/flights"))      # 复用 base_url

# reduce：累积计算
from functools import reduce
total = reduce(lambda acc, x: acc + x, [1, 2, 3, 4, 5], 0)  # 15
```

### 11.6 contextlib

```python
from contextlib import contextmanager, asynccontextmanager, suppress

# contextmanager：简化上下文管理器
@contextmanager
def temp_directory():
    import tempfile, shutil
    tmpdir = tempfile.mkdtemp()
    try:
        yield tmpdir
    finally:
        shutil.rmtree(tmpdir)

with temp_directory() as tmpdir:
    print(f"使用临时目录：{tmpdir}")

# asynccontextmanager：异步版本（AI 开发中常用）
@asynccontextmanager
async def async_db_session():
    session = {"active": True}
    try:
        yield session
    finally:
        session["active"] = False

# suppress：忽略特定异常（代替 try/except pass）
from contextlib import suppress
with suppress(FileNotFoundError):
    import os
    os.remove("nonexistent.txt")  # 不存在时静默忽略
```

### 11.7 logging

```python
import logging
import sys

# 基础配置
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("app.log", encoding="utf-8"),
    ]
)

# 获取 logger（推荐按模块命名）
logger = logging.getLogger(__name__)

logger.debug("调试信息")
logger.info("普通信息")
logger.warning("警告")
logger.error("错误")
logger.critical("严重错误")

# 记录异常（自动附带 traceback）
try:
    1 / 0
except ZeroDivisionError:
    logger.exception("计算错误")  # 等价于 logger.error(..., exc_info=True)

# 子 logger 继承父 logger 配置
child_logger = logging.getLogger("my_agent.tools")
child_logger.info("工具日志")

# 生产环境：用 structlog 或 loguru 获得结构化日志
```

### 11.8 os / sys / subprocess

```python
import os
import sys
import subprocess

# os：操作系统接口
cwd = os.getcwd()                    # 当前目录
os.environ.get("HOME", "/tmp")       # 环境变量（推荐用 .get 避免 KeyError）
os.makedirs("/tmp/test", exist_ok=True)

# sys：Python 解释器接口
print(sys.version)                   # Python 版本
print(sys.platform)                  # 'darwin' / 'linux' / 'win32'
print(sys.argv)                      # 命令行参数列表
sys.exit(0)                          # 退出程序

# subprocess：执行外部命令
result = subprocess.run(
    ["git", "log", "--oneline", "-5"],
    capture_output=True,    # 捕获 stdout/stderr
    text=True,              # 返回字符串而非 bytes
    check=True,             # 非零返回码抛异常
)
print(result.stdout)

# 简单场景
output = subprocess.check_output(["ls", "-la"], text=True)
```

---

## 十二、环境与依赖管理

### 12.1 工具对比

```
工具对比：

  venv（标准库）
  ├── 轻量，无需安装
  ├── python -m venv .venv
  └── 适合：小项目、CI/CD

  conda
  ├── 管理 Python 版本 + 包
  ├── 适合数据科学（numpy/torch 二进制）
  └── 适合：ML 项目，需要多 Python 版本

  uv（推荐，2024+ 新主流）
  ├── Rust 实现，极速（比 pip 快 10-100x）
  ├── 统一替代 pip + venv + pip-tools
  └── 适合：新项目，Agent/AI 开发
```

```bash
# venv
python -m venv .venv
source .venv/bin/activate     # macOS/Linux
.venv\Scripts\activate         # Windows
deactivate

# uv（推荐）
pip install uv
uv init my_project            # 新建项目
uv add langchain pydantic     # 添加依赖（自动更新 pyproject.toml）
uv run python main.py         # 在虚拟环境中运行
uv sync                       # 同步依赖
```

### 12.2 依赖文件

```toml
# pyproject.toml（现代标准，推荐）
[project]
name = "my-agent"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "langchain>=0.2.0",
    "pydantic>=2.0",
    "httpx>=0.27.0",
    "openai>=1.0.0",
]

[project.optional-dependencies]
dev = ["pytest", "ruff", "mypy"]
```

```
# requirements.txt（传统格式）
langchain>=0.2.0
pydantic>=2.0
httpx>=0.27.0
openai>=1.0.0
```

```bash
# pip 常用命令
pip install package              # 安装
pip install package==1.0.0      # 指定版本
pip install -r requirements.txt  # 从文件安装
pip uninstall package            # 卸载
pip list                         # 列出已安装
pip freeze > requirements.txt    # 导出依赖（含版本锁定）
pip show package                 # 查看包信息
pip install --upgrade package    # 升级
```

---

## 十三、Python 性能陷阱与调优

### 13.1 GIL 对并发的影响

```
GIL（Global Interpreter Lock）影响矩阵：

  任务类型    多线程效果   推荐方案
  ─────────────────────────────────────────
  I/O 密集   ✅ 有效       threading / asyncio
  CPU 密集   ❌ 几乎无效   multiprocessing / C 扩展
  AI 推理    ✅ 有效       asyncio（I/O 瓶颈）

  asyncio vs threading vs multiprocessing：
  ┌──────────────────┬────────────────┬──────────────────┐
  │ asyncio          │ threading      │ multiprocessing  │
  ├──────────────────┼────────────────┼──────────────────┤
  │ 单线程           │ 多线程         │ 多进程           │
  │ 协作式调度       │ 抢占式调度     │ 独立 GIL         │
  │ I/O 密集         │ I/O 密集       │ CPU 密集         │
  │ 内存占用最小     │ 中等           │ 最大             │
  │ LangChain/httpx  │ 遗留同步代码   │ 数据处理/训练    │
  └──────────────────┴────────────────┴──────────────────┘
```

### 13.2 常见性能陷阱

```python
import timeit

# ===== 陷阱 1：循环中字符串拼接 =====
# 慢：str 不可变，每次创建新对象
def slow_join(items: list[str]) -> str:
    result = ""
    for item in items:
        result += item  # O(n²)
    return result

# 快：join 一次分配内存
def fast_join(items: list[str]) -> str:
    return "".join(items)  # O(n)

# ===== 陷阱 2：在循环中访问属性/方法 =====
# 慢
def slow_process(data: list) -> list:
    result = []
    for item in data:
        result.append(item * 2)  # 每次查找 append
    return result

# 快：提前缓存方法引用
def fast_process(data: list) -> list:
    result = []
    append = result.append   # 缓存方法
    for item in data:
        append(item * 2)
    return result

# 更快：列表推导式（内部优化）
def fastest_process(data: list) -> list:
    return [item * 2 for item in data]

# ===== 陷阱 3：重复计算 len =====
# 慢
def slow_loop(data: list) -> None:
    for i in range(len(data)):   # len(data) 每次调用
        pass

# 快：提前计算
def fast_loop(data: list) -> None:
    n = len(data)
    for i in range(n):
        pass

# ===== 陷阱 4：不必要的列表创建 =====
# 慢：创建完整列表再 sum
total = sum([x ** 2 for x in range(1000000)])

# 快：生成器表达式，不占额外内存
total = sum(x ** 2 for x in range(1000000))
```

### 13.3 lru_cache 缓存

```python
from functools import lru_cache
import time

# 缓存昂贵的计算（AI 中缓存 embedding、tokenize 等）
@lru_cache(maxsize=512)
def expensive_nlp(text: str) -> list[float]:
    time.sleep(0.1)  # 模拟昂贵操作
    return [hash(text) % 100 / 100.0]  # 模拟向量

# 第一次调用：慢
start = time.perf_counter()
expensive_nlp("hello world")
print(f"首次：{time.perf_counter() - start:.3f}s")  # ~0.1s

# 第二次：命中缓存，极快
start = time.perf_counter()
expensive_nlp("hello world")
print(f"缓存：{time.perf_counter() - start:.6f}s")  # ~0.000001s

# 清除缓存
expensive_nlp.cache_clear()
```

### 13.4 选型决策树

```
需要并发/并行？
    │
    ├─ 主要是 I/O（网络、数据库、文件）？
    │      └─ 首选 asyncio
    │         （已有同步代码：run_in_executor）
    │
    ├─ 主要是 CPU 计算？
    │      └─ multiprocessing
    │         或 C 扩展（numpy/torch）
    │
    └─ 遗留同步代码，改造成本高？
           └─ threading（I/O 密集场景仍有提升）
```

---

## 十四、速查表

### 14.1 内置函数速查

| 函数 | 说明 | 示例 |
|------|------|------|
| `len(x)` | 长度 | `len([1,2,3])` → `3` |
| `type(x)` | 类型 | `type(42)` → `<class 'int'>` |
| `isinstance(x, T)` | 类型检查 | `isinstance(42, int)` → `True` |
| `print(*args)` | 打印 | `print("a", "b", sep="-")` |
| `input(prompt)` | 读取输入 | `name = input("名字: ")` |
| `range(n)` | 整数序列 | `list(range(3))` → `[0,1,2]` |
| `enumerate(it)` | 带索引迭代 | `for i, v in enumerate(lst)` |
| `zip(*its)` | 并行迭代 | `zip([1,2], ["a","b"])` |
| `map(f, it)` | 映射 | `list(map(str, [1,2,3]))` |
| `filter(f, it)` | 过滤 | `list(filter(None, [0,1,2]))` |
| `sorted(it)` | 排序（新列表） | `sorted([3,1,2])` → `[1,2,3]` |
| `reversed(it)` | 反转（惰性） | `list(reversed([1,2,3]))` |
| `sum(it)` | 求和 | `sum([1,2,3])` → `6` |
| `max(it)` | 最大值 | `max([1,3,2])` → `3` |
| `min(it)` | 最小值 | `min([1,3,2])` → `1` |
| `abs(x)` | 绝对值 | `abs(-5)` → `5` |
| `round(x, n)` | 四舍五入 | `round(3.14159, 2)` → `3.14` |
| `any(it)` | 任一为真 | `any([0, 1, 0])` → `True` |
| `all(it)` | 全部为真 | `all([1, 1, 0])` → `False` |
| `open(f, mode)` | 打开文件 | `open("a.txt", "r", encoding="utf-8")` |
| `hash(x)` | 哈希值 | `hash("hello")` |
| `id(x)` | 对象 ID | `id(obj)` |
| `dir(x)` | 属性列表 | `dir([])` |
| `vars(x)` | __dict__ | `vars(obj)` |
| `repr(x)` | 调试字符串 | `repr([1, "a"])` |
| `getattr(o,n,d)` | 动态获取属性 | `getattr(obj, "name", None)` |
| `setattr(o,n,v)` | 动态设置属性 | `setattr(obj, "name", "x")` |
| `hasattr(o,n)` | 属性是否存在 | `hasattr(obj, "run")` |
| `callable(x)` | 是否可调用 | `callable(print)` → `True` |
| `eval(s)` | 执行表达式字符串 | `eval("1+2")` → `3` |

### 14.2 常用标准库速查

| 模块 | 用途 | 常用 API |
|------|------|----------|
| `os` | 系统操作 | `getcwd`, `environ`, `makedirs`, `listdir` |
| `sys` | 解释器 | `argv`, `path`, `exit`, `version` |
| `pathlib` | 文件路径 | `Path`, `glob`, `read_text`, `write_text` |
| `json` | JSON | `loads`, `dumps`, `load`, `dump` |
| `datetime` | 日期时间 | `datetime.now()`, `strptime`, `timedelta` |
| `time` | 时间 | `sleep`, `perf_counter`, `time` |
| `re` | 正则 | `search`, `findall`, `sub`, `compile` |
| `collections` | 容器扩展 | `defaultdict`, `Counter`, `deque` |
| `functools` | 函数工具 | `lru_cache`, `partial`, `wraps`, `reduce` |
| `itertools` | 迭代工具 | `chain`, `islice`, `groupby`, `product` |
| `contextlib` | 上下文管理 | `contextmanager`, `asynccontextmanager` |
| `logging` | 日志 | `getLogger`, `basicConfig`, `handlers` |
| `subprocess` | 子进程 | `run`, `check_output` |
| `threading` | 多线程 | `Thread`, `Lock`, `Event` |
| `multiprocessing` | 多进程 | `Process`, `Pool`, `Queue` |
| `asyncio` | 异步 | `run`, `gather`, `create_task`, `sleep` |
| `typing` | 类型注解 | `Optional`, `Union`, `List`, `Dict`, `Any` |
| `dataclasses` | 数据类 | `dataclass`, `field` |
| `abc` | 抽象类 | `ABC`, `abstractmethod` |
| `enum` | 枚举 | `Enum`, `IntEnum`, `auto` |
| `copy` | 复制 | `copy`, `deepcopy` |
| `hashlib` | 哈希 | `md5`, `sha256` |
| `base64` | 编码 | `b64encode`, `b64decode` |
| `uuid` | UUID | `uuid4`, `uuid1` |
| `random` | 随机 | `random`, `choice`, `shuffle`, `randint` |
| `math` | 数学 | `ceil`, `floor`, `sqrt`, `log`, `inf` |
| `io` | I/O 流 | `StringIO`, `BytesIO` |
| `tempfile` | 临时文件 | `mkdtemp`, `NamedTemporaryFile` |
| `shutil` | 高级文件操作 | `copy`, `move`, `rmtree` |
| `urllib` | URL | `parse.urlencode`, `parse.urlparse` |

### 14.3 与 Java 语法对照表

| 功能 | Java | Python |
|------|------|--------|
| 打印 | `System.out.println(x)` | `print(x)` |
| 变量声明 | `String name = "hi"` | `name = "hi"` 或 `name: str = "hi"` |
| 条件 | `if (x > 0) { }` | `if x > 0:` |
| 循环 | `for (int i=0; i<10; i++)` | `for i in range(10):` |
| for-each | `for (String s : list)` | `for s in lst:` |
| while | `while (flag) { }` | `while flag:` |
| 三元 | `x > 0 ? "pos" : "neg"` | `"pos" if x > 0 else "neg"` |
| null 判断 | `obj == null` | `obj is None` |
| 字符串格式化 | `String.format("%s: %d", k, v)` | `f"{k}: {v}"` |
| 数组/列表 | `List<String> list = new ArrayList<>()` | `lst: list[str] = []` |
| 字典/Map | `Map<String, Integer> map = new HashMap<>()` | `d: dict[str, int] = {}` |
| 类定义 | `public class Foo { }` | `class Foo:` |
| 构造函数 | `public Foo(String x) { this.x = x; }` | `def __init__(self, x: str): self.x = x` |
| 继承 | `class B extends A` | `class B(A):` |
| 接口 | `interface Tool { }` | `class Tool(ABC):` |
| 方法重写 | `@Override` | 直接重写（`super()` 调用父类） |
| 静态方法 | `static void foo()` | `@staticmethod def foo():` |
| 访问控制 | `private`, `public`, `protected` | 无关键字：`_name`（惯例私有），`__name`（name mangling） |
| 异常捕获 | `try { } catch (Ex e) { }` | `try: ... except Ex as e:` |
| 抛出异常 | `throw new RuntimeException("msg")` | `raise RuntimeError("msg")` |
| 导入 | `import com.example.Foo` | `from com.example import Foo` |
| 泛型 | `List<T>` | `list[T]`（类型注解，运行时不强制） |
| Lambda | `(x) -> x * 2` | `lambda x: x * 2` |
| Stream map | `list.stream().map(f)` | `[f(x) for x in lst]` |
| Stream filter | `list.stream().filter(f)` | `[x for x in lst if f(x)]` |
| Optional | `Optional.ofNullable(x)` | `x if x is not None else default` |
| 枚举 | `enum Color { RED, GREEN }` | `from enum import Enum; class Color(Enum): RED=1` |
| 注解/装饰 | `@Annotation` | `@decorator` |
| 接口默认方法 | `default void foo()` | 直接在类中实现（ABC 可有默认实现） |
| synchronized | `synchronized(lock) { }` | `with lock:` (`threading.Lock`) |
| try-with-resource | `try (Res r = new Res()) { }` | `with Res() as r:` |

---

> **最后提示**：Python 在 Agent/AI 开发中的核心链路是：
>
> `Pydantic 建模` → `async/await 并发调用` → `生成器处理流式输出` → `类型注解保障可维护性`
>
> 优先掌握第九章（异步编程）和第十章（Pydantic），其余章节按需查阅。
