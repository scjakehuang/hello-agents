# FastAPI 最佳实践与踩坑指南

> 面向 AI Agent 服务构建 —— 结合 LangChain / LangGraph / SSE 流式输出场景
>
> 作者：徐凯旋
> 邮箱：azouever@gmail.com
> 更新时间：2026-04-14

---

## 目录

1. [概述](#一概述)
2. [项目结构](#二项目结构)
3. [路由与请求处理](#三路由与请求处理)
4. [Pydantic Schema 设计](#四pydantic-schema-设计)
5. [依赖注入系统](#五依赖注入系统)
6. [中间件](#六中间件)
7. [SSE 流式输出（AI 场景核心）](#七sse-流式输出ai-场景核心)
8. [WebSocket](#八websocket)
9. [认证与授权](#九认证与授权)
10. [数据库集成](#十数据库集成)
11. [后台任务与生命周期](#十一后台任务与生命周期)
12. [性能优化](#十二性能优化)
13. [日志与可观测性](#十三日志与可观测性)
14. [测试](#十四测试)
15. [部署](#十五部署)
16. [常见踩坑](#十六常见踩坑)
17. [速查表](#十七速查表)

---

## 一、概述

### 1.1 框架对比

```
+------------------+------------+------------+----------------+-------------------+
| 维度             | FastAPI    | Flask      | Django         | Spring Boot       |
+------------------+------------+------------+----------------+-------------------+
| 语言             | Python     | Python     | Python         | Java              |
| 异步支持         | 原生 async | 有限       | ASGI(3.1+)     | WebFlux(复杂)     |
| 性能(req/s)      | ~30k       | ~8k        | ~6k            | ~25k              |
| 自动文档         | 内置 OpenAPI| 需插件    | 需 DRF         | 需 Springdoc      |
| 类型安全         | Pydantic   | 无         | Serializer     | Bean Validation   |
| 学习曲线         | 低         | 极低       | 中高           | 高                |
| AI/流式友好度    | ★★★★★     | ★★☆☆☆     | ★★☆☆☆         | ★★★☆☆            |
| 适合 AI Agent    | 首选       | 简单场景   | 不推荐         | Java 生态用       |
+------------------+------------+------------+----------------+-------------------+
```

### 1.2 FastAPI 核心优势

**对 AI Agent 服务最关键的三点：**

1. **原生 async/await**：天然支持 LangChain `astream`、LangGraph 异步流，不需要 `run_in_executor` 绕行
2. **SSE / StreamingResponse**：内置支持，与 `sse-starlette` 搭配可做完整 AI 流式输出
3. **Pydantic v2**：高性能数据验证 + 自动生成 OpenAPI，与 LangChain 的 Pydantic 模型天然兼容

```python
# 最简 AI Agent 接口 —— 5 行代码
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI()

@app.post("/chat")
async def chat(query: str):
    # LangChain astream 直接 yield
    async def generator():
        async for chunk in chain.astream({"input": query}):
            yield f"data: {chunk.content}\n\n"
    return StreamingResponse(generator(), media_type="text/event-stream")
```

---

## 二、项目结构

### 2.1 推荐目录结构

```
my_agent_service/
│
├── app/
│   ├── __init__.py
│   ├── main.py                  # 应用入口，挂载 router，注册 middleware，lifespan
│   ├── config.py                # 配置管理（pydantic-settings）
│   │
│   ├── routers/                 # 路由层（只做参数解析 + 调用 service）
│   │   ├── __init__.py
│   │   ├── chat.py              # /chat 相关路由
│   │   ├── session.py           # /session 相关路由
│   │   └── health.py            # 健康检查
│   │
│   ├── services/                # 业务逻辑层（编排 Agent、调 DB、调外部 API）
│   │   ├── __init__.py
│   │   ├── chat_service.py
│   │   └── session_service.py
│   │
│   ├── schemas/                 # Pydantic 请求/响应模型
│   │   ├── __init__.py
│   │   ├── base.py              # BaseResponse[T]、分页等通用模型
│   │   ├── chat.py
│   │   └── session.py
│   │
│   ├── dependencies/            # 依赖注入（认证、DB session、分页参数等）
│   │   ├── __init__.py
│   │   ├── auth.py
│   │   ├── database.py
│   │   └── pagination.py
│   │
│   ├── middleware/              # 中间件（trace_id、耗时、异常捕获）
│   │   ├── __init__.py
│   │   ├── trace.py
│   │   └── timing.py
│   │
│   ├── models/                  # SQLAlchemy ORM 模型
│   │   ├── __init__.py
│   │   └── session.py
│   │
│   ├── repositories/            # 数据访问层（Repository 模式）
│   │   ├── __init__.py
│   │   └── session_repo.py
│   │
│   └── agent/                   # Agent 相关（chain、graph、tools 封装）
│       ├── __init__.py
│       ├── chains.py
│       └── graphs.py
│
├── tests/
│   ├── conftest.py
│   ├── test_chat.py
│   └── test_session.py
│
├── Dockerfile
├── pyproject.toml
└── .env
```

### 2.2 分层职责说明

| 层 | 职责 | 禁止做的事 |
|---|---|---|
| `routers/` | 解析 HTTP 参数，调用 service，返回响应 | 不写业务逻辑，不直接操作 DB |
| `services/` | 业务编排，调用 repository/agent | 不解析 HTTP 请求，不写 SQL |
| `schemas/` | 定义请求/响应数据结构 | 不写业务逻辑 |
| `dependencies/` | 提供可复用的注入对象（auth、session） | 不写业务逻辑 |
| `repositories/` | 封装 SQL 操作 | 不写业务逻辑，不依赖 HTTP |
| `agent/` | 封装 LangChain chain / LangGraph graph | 不依赖 FastAPI 对象 |

```python
# app/main.py —— 应用入口示例
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import chat, session, health
from app.middleware.trace import TraceMiddleware
from app.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动：初始化 DB 连接池、加载模型等
    print("Starting up...")
    yield
    # 关闭：释放资源
    print("Shutting down...")


app = FastAPI(
    title="AI Agent Service",
    version="1.0.0",
    lifespan=lifespan,
)

# 注册中间件
app.add_middleware(TraceMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(chat.router, prefix="/api/v1")
app.include_router(session.router, prefix="/api/v1")
app.include_router(health.router)
```

---

## 三、路由与请求处理

### 3.1 基础路由

```python
# app/routers/chat.py
from fastapi import APIRouter, Depends, Query, Path, Body, status
from app.schemas.chat import ChatRequest, ChatResponse
from app.schemas.base import BaseResponse
from app.services.chat_service import ChatService
from app.dependencies.auth import get_current_user

router = APIRouter(prefix="/chat", tags=["Chat"])


# GET：查询参数 + 路径参数
@router.get("/history/{session_id}", response_model=BaseResponse[list[ChatResponse]])
async def get_chat_history(
    session_id: str = Path(..., description="会话 ID"),  # 路径参数，必填
    page: int = Query(1, ge=1, description="页码"),       # 查询参数，有默认值
    page_size: int = Query(20, ge=1, le=100),
    current_user=Depends(get_current_user),              # 依赖注入：当前用户
):
    """查询会话历史消息"""
    data = await ChatService.get_history(session_id, page, page_size)
    return BaseResponse(data=data)


# POST：请求体（Pydantic model）
@router.post("/send", response_model=BaseResponse[ChatResponse], status_code=status.HTTP_201_CREATED)
async def send_message(
    request: ChatRequest = Body(...),  # 请求体
    current_user=Depends(get_current_user),
):
    """发送消息（非流式）"""
    result = await ChatService.send(request, user_id=current_user.id)
    return BaseResponse(data=result)


# PUT：更新资源
@router.put("/session/{session_id}/title", response_model=BaseResponse[None])
async def update_title(
    session_id: str = Path(...),
    title: str = Body(..., embed=True),  # embed=True: body 为 {"title": "xxx"}
):
    await ChatService.update_title(session_id, title)
    return BaseResponse(message="更新成功")


# DELETE：删除资源
@router.delete("/session/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(session_id: str = Path(...)):
    await ChatService.delete_session(session_id)
```

### 3.2 多个 Router 组织

```python
# app/routers/__init__.py —— 统一导出
from app.routers import chat, session, health

# 不同模块的路由挂载到不同 prefix
# chat.router   -> /api/v1/chat/...
# session.router -> /api/v1/session/...
# health.router  -> /health
```

### 3.3 路由分组与文档标签

```python
# 多层 prefix 嵌套
v1_router = APIRouter(prefix="/api/v1")
v1_router.include_router(chat.router)      # /api/v1/chat/...
v1_router.include_router(session.router)   # /api/v1/session/...

# 在 OpenAPI 文档中自定义 tag 排序
app = FastAPI(
    openapi_tags=[
        {"name": "Chat", "description": "聊天相关接口"},
        {"name": "Session", "description": "会话管理"},
        {"name": "Health", "description": "健康检查"},
    ]
)
```

---

## 四、Pydantic Schema 设计

### 4.1 请求/响应分离原则

```python
# app/schemas/chat.py
from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional, Literal
from datetime import datetime
import uuid


# 请求模型：只包含输入字段
class ChatRequest(BaseModel):
    session_id: Optional[str] = Field(None, description="会话 ID，为空时创建新会话")
    content: str = Field(..., min_length=1, max_length=4000, description="用户消息")
    model: Literal["gpt-4o", "gpt-4o-mini", "claude-3-5-sonnet"] = "gpt-4o-mini"
    stream: bool = Field(False, description="是否流式输出")

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("消息内容不能为空白字符")
        return v.strip()

    @field_validator("session_id")
    @classmethod
    def set_default_session_id(cls, v: Optional[str]) -> str:
        return v or str(uuid.uuid4())


# 响应模型：只包含输出字段，不暴露内部字段
class ChatResponse(BaseModel):
    message_id: str
    session_id: str
    content: str
    role: Literal["assistant"]
    created_at: datetime
    tokens_used: Optional[int] = None

    model_config = {"from_attributes": True}  # Pydantic v2：允许从 ORM 对象创建


# 流式响应的单个 chunk
class ChatStreamChunk(BaseModel):
    content: str
    done: bool = False
    session_id: Optional[str] = None
```

### 4.2 通用 BaseResponse[T]

```python
# app/schemas/base.py
from pydantic import BaseModel
from typing import Generic, TypeVar, Optional, Any
from datetime import datetime

T = TypeVar("T")


class BaseResponse(BaseModel, Generic[T]):
    """统一响应格式"""
    code: int = 200
    message: str = "success"
    data: Optional[T] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    trace_id: Optional[str] = None  # 由中间件注入


class PageInfo(BaseModel):
    """分页信息"""
    page: int
    page_size: int
    total: int
    total_pages: int


class PageResponse(BaseModel, Generic[T]):
    """分页响应格式"""
    items: list[T]
    page_info: PageInfo


# 错误响应
class ErrorResponse(BaseModel):
    code: int
    message: str
    detail: Optional[Any] = None
    trace_id: Optional[str] = None
```

### 4.3 复杂验证器

```python
# app/schemas/agent.py
from pydantic import BaseModel, Field, model_validator
from typing import Optional, Any


class AgentRunRequest(BaseModel):
    """Agent 执行请求，带跨字段验证"""
    task: str = Field(..., description="任务描述")
    context: Optional[dict[str, Any]] = None
    max_steps: int = Field(10, ge=1, le=50)
    timeout_seconds: int = Field(60, ge=5, le=600)
    tools: Optional[list[str]] = None

    @model_validator(mode="after")
    def validate_timeout_vs_steps(self) -> "AgentRunRequest":
        """每步平均不能少于 2 秒"""
        if self.timeout_seconds < self.max_steps * 2:
            raise ValueError(
                f"timeout_seconds({self.timeout_seconds}) 太短，"
                f"max_steps={self.max_steps} 时至少需要 {self.max_steps * 2} 秒"
            )
        return self
```

---

## 五、依赖注入系统

### 5.1 Depends 工作原理

```
请求进来
    │
    ▼
路由函数签名解析
    │
    ├── 普通参数 ──────────────────────► 从 query/path/body 提取
    │
    └── Depends(fn) ──────────────────► 调用 fn()
                                            │
                                            ├── fn 也可以有 Depends(sub_fn)
                                            │   └── 递归解析（依赖链）
                                            │
                                            ├── 同一请求内：相同依赖只执行一次（缓存）
                                            │
                                            └── yield 依赖：路由完成后自动执行 finally
```

### 5.2 认证依赖

```python
# app/dependencies/auth.py
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from app.config import settings

security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    """验证 JWT，返回当前用户信息"""
    token = credentials.credentials
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token 已过期")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token 无效")


# 可选认证（允许匿名访问）
async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(auto_error=False)),
) -> Optional[dict]:
    if credentials is None:
        return None
    return await get_current_user(credentials)
```

### 5.3 带 yield 的依赖（DB Session）

```python
# app/dependencies/database.py
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import async_session_factory
from typing import AsyncGenerator


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    带 yield 的依赖：
    - yield 前：建立资源（打开 session）
    - yield：将资源注入路由
    - yield 后：释放资源（关闭 session），即使路由抛出异常也会执行
    """
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()  # 路由成功则提交
        except Exception:
            await session.rollback()  # 路由异常则回滚
            raise
```

### 5.4 分页依赖

```python
# app/dependencies/pagination.py
from fastapi import Query
from dataclasses import dataclass


@dataclass
class Pagination:
    page: int
    page_size: int

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


def get_pagination(
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
) -> Pagination:
    return Pagination(page=page, page_size=page_size)
```

### 5.5 依赖链示例

```python
# 依赖链：get_admin_user -> get_current_user -> HTTPBearer
async def get_admin_user(current_user: dict = Depends(get_current_user)) -> dict:
    """在 get_current_user 基础上再验证是否是管理员"""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return current_user


# 路由同时使用多个依赖
@router.get("/admin/users")
async def list_users(
    pagination: Pagination = Depends(get_pagination),
    admin: dict = Depends(get_admin_user),     # 含认证链
    db: AsyncSession = Depends(get_db),         # DB session
):
    ...
```

---

## 六、中间件

### 6.1 trace_id 注入

```python
# app/middleware/trace.py
import uuid
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from app.context import trace_id_var  # contextvars.ContextVar


class TraceMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        # 优先使用上游传入的 trace_id（微服务链路追踪）
        trace_id = request.headers.get("X-Trace-Id") or str(uuid.uuid4())

        # 存入 contextvars（对整个请求生命周期可见，包括子协程）
        trace_id_var.set(trace_id)

        response = await call_next(request)

        # 透传给下游/前端
        response.headers["X-Trace-Id"] = trace_id
        return response
```

### 6.2 请求耗时统计

```python
# app/middleware/timing.py
import time
import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

logger = structlog.get_logger()


class TimingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - start) * 1000

        logger.info(
            "request_completed",
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=round(duration_ms, 2),
        )
        response.headers["X-Response-Time"] = f"{duration_ms:.2f}ms"
        return response
```

### 6.3 全局异常捕获 + 统一错误响应

```python
# app/main.py —— 注册异常处理器
from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from app.schemas.base import ErrorResponse
from app.context import trace_id_var


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Pydantic 验证失败 → 422"""
    return JSONResponse(
        status_code=422,
        content=ErrorResponse(
            code=422,
            message="请求参数校验失败",
            detail=exc.errors(),
            trace_id=trace_id_var.get(None),
        ).model_dump(mode="json"),
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """兜底异常 → 500"""
    logger.error("unhandled_exception", exc_info=exc, path=request.url.path)
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(
            code=500,
            message="服务内部错误",
            trace_id=trace_id_var.get(None),
        ).model_dump(mode="json"),
    )
```

### 6.4 CORS 配置

```python
# app/config.py
from pydantic_settings import BaseSettings
from typing import list


class Settings(BaseSettings):
    cors_origins: list[str] = ["http://localhost:3000", "https://your-frontend.com"]

    class Config:
        env_file = ".env"


settings = Settings()

# app/main.py
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,  # 不要用 ["*"]（除非是公开 API）
    allow_credentials=True,               # 允许 cookie/Authorization header
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Trace-Id", "X-Response-Time"],  # 暴露给前端读取的自定义 header
)
```

---

## 七、SSE 流式输出（AI 场景核心）

### 7.1 SSE 基础原理

```
客户端                             服务端
  │                                  │
  │── POST /chat/stream ────────────►│
  │                                  │ Content-Type: text/event-stream
  │◄──────────── HTTP 200 ───────────│ Connection: keep-alive
  │                                  │
  │◄── data: {"content":"你"} ───────│ yield chunk
  │◄── data: {"content":"好"} ───────│ yield chunk
  │◄── data: {"content":"！"} ───────│ yield chunk
  │◄── data: [DONE] ─────────────────│ 流结束
  │                                  │
  │ （连接自动关闭 或 等待下一次请求）  │
```

SSE 格式：
```
data: <内容>\n\n          # 单行数据
event: error\n            # 可选：自定义事件类型
data: <错误信息>\n\n
id: 123\n                 # 可选：事件 ID（断线重连用）
retry: 3000\n             # 可选：重连间隔（毫秒）
```

### 7.2 安装依赖

```bash
pip install sse-starlette langchain-openai langgraph
```

### 7.3 与 LangChain astream 集成

```python
# app/routers/chat.py
from fastapi import APIRouter, Depends, HTTPException
from sse_starlette.sse import EventSourceResponse
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage
import json
import asyncio

from app.schemas.chat import ChatRequest
from app.dependencies.auth import get_current_user
from app.context import trace_id_var

router = APIRouter(prefix="/chat", tags=["Chat"])

llm = ChatOpenAI(model="gpt-4o-mini", streaming=True)


@router.post("/stream")
async def chat_stream(
    request: ChatRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    LangChain astream 流式输出
    前端用 EventSource 或 fetch + ReadableStream 消费
    """

    async def event_generator():
        trace_id = trace_id_var.get(None)
        try:
            # astream 逐 token 输出
            async for chunk in llm.astream([HumanMessage(content=request.content)]):
                if chunk.content:
                    payload = json.dumps(
                        {"content": chunk.content, "done": False},
                        ensure_ascii=False,
                    )
                    yield {"data": payload}

            # 流结束标记
            yield {"data": json.dumps({"content": "", "done": True})}

        except asyncio.CancelledError:
            # 客户端断开连接，正常退出
            pass
        except Exception as e:
            # 推送错误事件（而不是让连接静默断开）
            yield {
                "event": "error",
                "data": json.dumps({"message": str(e), "trace_id": trace_id}),
            }

    return EventSourceResponse(event_generator())
```

### 7.4 与 LangGraph stream 集成

```python
# app/agent/graphs.py —— LangGraph 构建 Agent Graph
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from langchain_openai import ChatOpenAI
from typing import TypedDict, Annotated
import operator


class AgentState(TypedDict):
    messages: Annotated[list, operator.add]


def build_agent_graph(tools: list):
    """构建带工具调用的 Agent Graph"""
    model = ChatOpenAI(model="gpt-4o", streaming=True).bind_tools(tools)

    def call_model(state: AgentState):
        response = model.invoke(state["messages"])
        return {"messages": [response]}

    def should_continue(state: AgentState):
        last_message = state["messages"][-1]
        if last_message.tool_calls:
            return "tools"
        return END

    graph = StateGraph(AgentState)
    graph.add_node("agent", call_model)
    graph.add_node("tools", ToolNode(tools))
    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", should_continue)
    graph.add_edge("tools", "agent")

    return graph.compile()


# app/routers/agent.py —— 流式 Agent 接口
from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse
from langchain_core.messages import HumanMessage
from app.agent.graphs import build_agent_graph
from app.agent.tools import get_tools  # 你的工具列表
import json

router = APIRouter(prefix="/agent", tags=["Agent"])


@router.post("/run/stream")
async def run_agent_stream(task: str):
    """
    LangGraph stream 流式输出
    支持 token 级流（stream_mode="messages"）
    """
    graph = build_agent_graph(get_tools())

    async def event_generator():
        try:
            # stream_mode="messages" 逐 token 推送
            async for event in graph.astream(
                {"messages": [HumanMessage(content=task)]},
                stream_mode="messages",
            ):
                msg, metadata = event
                # 只推送 AI 的 token，跳过工具调用结果
                if hasattr(msg, "content") and msg.content:
                    payload = json.dumps(
                        {
                            "type": "token",
                            "content": msg.content,
                            "node": metadata.get("langgraph_node"),
                        },
                        ensure_ascii=False,
                    )
                    yield {"data": payload}

            yield {"data": json.dumps({"type": "done"})}

        except asyncio.CancelledError:
            pass
        except Exception as e:
            yield {"event": "error", "data": json.dumps({"message": str(e)})}

    return EventSourceResponse(event_generator())
```

### 7.5 完整 Chat SSE 接口示例（含 session 管理）

```python
# app/services/chat_service.py
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_openai import ChatOpenAI
from app.repositories.session_repo import SessionRepository
from typing import AsyncGenerator
import json

llm = ChatOpenAI(model="gpt-4o-mini", streaming=True)

SYSTEM_PROMPT = "你是 DeepTrip 智能旅行助手，帮助用户规划行程。"


class ChatService:
    @staticmethod
    async def stream_chat(
        session_id: str,
        user_message: str,
        db,
    ) -> AsyncGenerator[str, None]:
        """
        带历史记忆的流式 Chat
        """
        # 1. 加载历史消息
        history = await SessionRepository.get_messages(db, session_id)
        messages = [SystemMessage(content=SYSTEM_PROMPT)]
        for msg in history[-20:]:  # 只取最近 20 条，控制 context window
            cls = HumanMessage if msg.role == "user" else AIMessage
            messages.append(cls(content=msg.content))
        messages.append(HumanMessage(content=user_message))

        # 2. 保存用户消息
        await SessionRepository.save_message(db, session_id, "user", user_message)

        # 3. 流式生成
        full_response = []
        async for chunk in llm.astream(messages):
            if chunk.content:
                full_response.append(chunk.content)
                yield json.dumps({"content": chunk.content, "done": False}, ensure_ascii=False)

        # 4. 保存完整 AI 回复
        await SessionRepository.save_message(db, session_id, "assistant", "".join(full_response))
        yield json.dumps({"content": "", "done": True, "session_id": session_id})


# app/routers/chat.py —— 完整 SSE 路由
@router.post("/stream")
async def chat_stream_full(
    request: ChatRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    async def event_generator():
        try:
            async for data in ChatService.stream_chat(
                session_id=request.session_id,
                user_message=request.content,
                db=db,
            ):
                yield {"data": data}
        except asyncio.CancelledError:
            pass
        except Exception as e:
            yield {"event": "error", "data": json.dumps({"message": str(e)})}

    return EventSourceResponse(event_generator())
```

### 7.6 错误事件推送与断线重连

```python
# 服务端：推送带 retry 的错误事件
async def event_generator():
    yield {"retry": 3000}  # 通知客户端 3 秒后重连
    try:
        async for chunk in llm.astream(messages):
            yield {"id": str(uuid.uuid4()), "data": chunk.content}
    except Exception as e:
        yield {"event": "error", "data": json.dumps({"message": str(e)})}


# 客户端（JavaScript）：断线重连
const source = new EventSource('/api/v1/chat/stream');
source.addEventListener('error', (e) => {
    // EventSource 自动重连（使用服务端设定的 retry 间隔）
    console.log('Connection error, will retry...');
});
source.addEventListener('error-event', (e) => {
    // 自定义 error 事件（服务端业务错误）
    const err = JSON.parse(e.data);
    console.error('Stream error:', err.message);
    source.close();  // 业务错误不重连
});
```

---

## 八、WebSocket

### 8.1 ConnectionManager

```python
# app/websocket/manager.py
from fastapi import WebSocket
from typing import dict
import asyncio


class ConnectionManager:
    """WebSocket 连接管理器"""

    def __init__(self):
        # user_id -> WebSocket
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, user_id: str, websocket: WebSocket):
        await websocket.accept()
        # 踢掉同一用户的旧连接
        if user_id in self.active_connections:
            await self.disconnect(user_id)
        self.active_connections[user_id] = websocket

    async def disconnect(self, user_id: str):
        ws = self.active_connections.pop(user_id, None)
        if ws:
            try:
                await ws.close()
            except Exception:
                pass

    async def send_to(self, user_id: str, message: dict):
        """单播"""
        ws = self.active_connections.get(user_id)
        if ws:
            try:
                await ws.send_json(message)
            except Exception:
                await self.disconnect(user_id)

    async def broadcast(self, message: dict):
        """广播"""
        disconnected = []
        for user_id, ws in self.active_connections.items():
            try:
                await ws.send_json(message)
            except Exception:
                disconnected.append(user_id)
        for user_id in disconnected:
            await self.disconnect(user_id)


manager = ConnectionManager()
```

### 8.2 心跳保活与路由

```python
# app/routers/ws.py
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.websocket.manager import manager
import asyncio
import json

router = APIRouter()


@router.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    await manager.connect(user_id, websocket)

    # 心跳任务：每 30 秒 ping 一次
    async def heartbeat():
        while True:
            try:
                await asyncio.sleep(30)
                await websocket.send_json({"type": "ping"})
            except Exception:
                break

    heartbeat_task = asyncio.create_task(heartbeat())

    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)

            if msg.get("type") == "pong":
                continue  # 客户端回应心跳

            # 处理业务消息
            response = await handle_ws_message(user_id, msg)
            await manager.send_to(user_id, response)

    except WebSocketDisconnect:
        heartbeat_task.cancel()
        await manager.disconnect(user_id)
```

---

## 九、认证与授权

### 9.1 JWT 生成与验证

```python
# app/auth/jwt_handler.py
from datetime import datetime, timedelta
from typing import Optional
import jwt

SECRET_KEY = "your-secret-key-keep-it-secret"  # 实际应从 settings 读取
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 小时


def create_access_token(user_id: str, extra: Optional[dict] = None) -> str:
    """生成 JWT"""
    now = datetime.utcnow()
    payload = {
        "sub": user_id,          # Subject
        "iat": now,               # Issued At
        "exp": now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        **(extra or {}),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    """解码并验证 JWT，失败抛出异常"""
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
```

### 9.2 Bearer Token 依赖

```python
# app/dependencies/auth.py（完整版）
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.auth.jwt_handler import decode_access_token

security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    try:
        payload = decode_access_token(credentials.credentials)
        return {"user_id": payload["sub"], "role": payload.get("role", "user")}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token 已过期")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token 无效")
```

### 9.3 API Key 认证（机器人/内部服务场景）

```python
# app/dependencies/api_key.py
from fastapi import Security, HTTPException
from fastapi.security.api_key import APIKeyHeader
from app.config import settings

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def verify_api_key(api_key: str = Security(api_key_header)) -> str:
    if not api_key or api_key not in settings.valid_api_keys:
        raise HTTPException(status_code=403, detail="API Key 无效")
    return api_key


# 路由使用
@router.post("/internal/trigger")
async def trigger_task(
    task: str,
    _api_key: str = Depends(verify_api_key),  # 只验证不返回值时用 _ 前缀
):
    ...
```

---

## 十、数据库集成

### 10.1 SQLAlchemy 异步配置

```python
# app/database.py
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.config import settings


# 异步引擎（必须用 asyncpg 驱动）
engine = create_async_engine(
    settings.database_url,  # postgresql+asyncpg://user:pass@host/db
    pool_size=10,           # 连接池大小
    max_overflow=20,        # 超出 pool_size 时最多额外创建
    pool_timeout=30,        # 等待连接的超时秒数
    pool_recycle=3600,      # 连接复用最长时间（防止数据库断开）
    echo=settings.debug,    # DEBUG 模式输出 SQL
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,  # 提交后不过期，避免访问属性时触发额外查询
)


class Base(DeclarativeBase):
    pass
```

### 10.2 ORM 模型

```python
# app/models/session.py
from sqlalchemy import String, Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from app.database import Base
import uuid


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), default="新对话")
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    messages: Mapped[list["ChatMessage"]] = relationship("ChatMessage", back_populates="session", lazy="selectin")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id: Mapped[str] = mapped_column(ForeignKey("chat_sessions.id"), nullable=False)
    role: Mapped[str] = mapped_column(String(20))  # user / assistant / system
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())

    session: Mapped["ChatSession"] = relationship("ChatSession", back_populates="messages")
```

### 10.3 Repository 模式

```python
# app/repositories/session_repo.py
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from app.models.session import ChatSession, ChatMessage


class SessionRepository:
    @staticmethod
    async def get_by_id(db: AsyncSession, session_id: str) -> ChatSession | None:
        result = await db.execute(
            select(ChatSession).where(ChatSession.id == session_id)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def get_messages(db: AsyncSession, session_id: str, limit: int = 50) -> list[ChatMessage]:
        result = await db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.created_at.asc())
            .limit(limit)
        )
        return list(result.scalars())

    @staticmethod
    async def save_message(db: AsyncSession, session_id: str, role: str, content: str) -> ChatMessage:
        msg = ChatMessage(session_id=session_id, role=role, content=content)
        db.add(msg)
        await db.flush()  # 立即写入（不提交），获得 ID
        return msg
```

---

## 十一、后台任务与生命周期

### 11.1 BackgroundTasks（轻量异步任务）

```python
# app/routers/chat.py
from fastapi import BackgroundTasks


@router.post("/send")
async def send_message(
    request: ChatRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    发送消息，后台异步记录统计
    注意：BackgroundTasks 使用当前请求的 DB session
    路由返回后再执行，此时 session 可能已关闭 → 见踩坑章节
    """
    result = await ChatService.send(request)

    # 添加后台任务（路由返回后才执行）
    background_tasks.add_task(record_usage_stats, request.session_id, result.tokens_used)

    return BaseResponse(data=result)


async def record_usage_stats(session_id: str, tokens: int):
    """
    后台任务必须自己管理 DB session！
    不能复用路由的 session（已关闭）
    """
    async with async_session_factory() as db:
        await UsageRepository.record(db, session_id, tokens)
        await db.commit()
```

### 11.2 lifespan（推荐方式，取代 on_event）

```python
# app/main.py
from contextlib import asynccontextmanager
from fastapi import FastAPI
import asyncio


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ========== 启动阶段 ==========
    # 初始化 DB 连接池（验证连接）
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # 初始化 Redis 连接
    app.state.redis = await create_redis_pool()

    # 预热 LLM 连接（可选）
    await warmup_llm()

    print("Application started")
    yield  # 应用运行中
    # ========== 关闭阶段 ==========

    # 释放 Redis 连接
    await app.state.redis.close()

    # 等待后台任务完成（最多 30 秒）
    await asyncio.wait_for(drain_background_tasks(), timeout=30)

    await engine.dispose()
    print("Application shutdown complete")


app = FastAPI(lifespan=lifespan)
```

### 11.3 asyncio.create_task 注意点

```python
# 正确：保持 task 引用，防止被 GC 回收
background_tasks_set = set()

async def run_long_task(task_id: str):
    task = asyncio.create_task(do_heavy_work(task_id))
    background_tasks_set.add(task)          # 保持引用
    task.add_done_callback(background_tasks_set.discard)  # 完成后自动清除

# 错误：没有引用的 task 可能被 GC 提前取消
async def run_long_task_wrong(task_id: str):
    asyncio.create_task(do_heavy_work(task_id))  # 危险！
```

---

## 十二、性能优化

### 12.1 避免同步阻塞（最重要）

```python
import asyncio
from functools import partial

# 同步 IO 密集型操作 → 放 thread pool
async def read_large_file(path: str) -> str:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _sync_read, path)

def _sync_read(path: str) -> str:
    with open(path) as f:
        return f.read()

# CPU 密集型操作（如图片处理）→ 放 process pool
from concurrent.futures import ProcessPoolExecutor
executor = ProcessPoolExecutor(max_workers=4)

async def process_image(image_bytes: bytes) -> bytes:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, _sync_process_image, image_bytes)
```

### 12.2 GZipMiddleware

```python
from fastapi.middleware.gzip import GZipMiddleware

# 响应体 > 1KB 时自动 gzip 压缩
app.add_middleware(GZipMiddleware, minimum_size=1000)
```

### 12.3 Redis 缓存装饰器

```python
# app/cache.py
import json
import functools
import hashlib
from typing import Callable, Any
import redis.asyncio as aioredis

redis_client: aioredis.Redis = None  # 在 lifespan 中初始化


def cache(ttl: int = 300, key_prefix: str = ""):
    """
    异步缓存装饰器
    用法：@cache(ttl=60, key_prefix="chat")
    """
    def decorator(func: Callable):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            # 生成缓存 key
            raw_key = f"{key_prefix}:{func.__name__}:{args}:{sorted(kwargs.items())}"
            cache_key = hashlib.md5(raw_key.encode()).hexdigest()

            # 尝试命中缓存
            cached = await redis_client.get(cache_key)
            if cached:
                return json.loads(cached)

            # 执行函数
            result = await func(*args, **kwargs)

            # 写入缓存
            await redis_client.setex(cache_key, ttl, json.dumps(result, ensure_ascii=False))
            return result

        return wrapper
    return decorator


# 使用示例
@cache(ttl=300, key_prefix="attractions")
async def get_attraction_detail(attraction_id: str) -> dict:
    return await AttractionRepository.get_by_id(attraction_id)
```

### 12.4 连接池最佳配置

```python
# 根据服务器 CPU 核数调整
import os

cpu_count = os.cpu_count() or 4

# DB 连接池（asyncpg）
engine = create_async_engine(
    settings.database_url,
    pool_size=cpu_count * 2,       # 最小连接数
    max_overflow=cpu_count * 4,    # 最大额外连接
    pool_pre_ping=True,            # 每次取连接前 ping，检测连接是否存活
)

# Redis 连接池
redis_pool = aioredis.ConnectionPool.from_url(
    settings.redis_url,
    max_connections=cpu_count * 10,
    decode_responses=True,
)
```

---

## 十三、日志与可观测性

### 13.1 ContextVar 全链路 trace_id

```python
# app/context.py
from contextvars import ContextVar
from typing import Optional

# ContextVar 是协程安全的，每个请求有独立上下文
trace_id_var: ContextVar[Optional[str]] = ContextVar("trace_id", default=None)
user_id_var: ContextVar[Optional[str]] = ContextVar("user_id", default=None)
```

### 13.2 structlog 配置

```python
# app/logging_config.py
import structlog
import logging
from app.context import trace_id_var, user_id_var


def add_trace_context(logger, method, event_dict: dict) -> dict:
    """structlog processor：自动注入 trace_id 和 user_id"""
    event_dict["trace_id"] = trace_id_var.get(None)
    event_dict["user_id"] = user_id_var.get(None)
    return event_dict


def configure_logging(level: str = "INFO"):
    structlog.configure(
        processors=[
            structlog.stdlib.add_log_level,
            structlog.stdlib.add_logger_name,
            add_trace_context,                          # 注入 trace 上下文
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),        # 输出 JSON 格式日志
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
    )
    logging.basicConfig(level=getattr(logging, level))


# 使用
logger = structlog.get_logger(__name__)

async def some_service():
    logger.info("processing_request", session_id="xxx", tokens=100)
    # 输出：{"event": "processing_request", "trace_id": "abc-123", "user_id": "u1", ...}
```

### 13.3 与 Langfuse 集成

```python
# app/agent/langfuse_callback.py
from langfuse.callback import CallbackHandler
from app.context import trace_id_var, user_id_var
from app.config import settings


def get_langfuse_handler(session_id: str) -> CallbackHandler:
    """
    为每个请求创建独立的 Langfuse callback handler
    传入 trace_id 实现与业务日志的关联
    """
    return CallbackHandler(
        public_key=settings.langfuse_public_key,
        secret_key=settings.langfuse_secret_key,
        host=settings.langfuse_host,
        session_id=session_id,
        trace_id=trace_id_var.get(None),      # 与业务 trace_id 对齐
        user_id=user_id_var.get(None),
        metadata={"service": "deeptrip-agent"},
    )


# 在路由中使用
@router.post("/chat/stream")
async def chat_stream(request: ChatRequest, current_user=Depends(get_current_user)):
    langfuse_handler = get_langfuse_handler(request.session_id)
    user_id_var.set(current_user["user_id"])

    async def event_generator():
        async for chunk in llm.astream(
            messages,
            config={"callbacks": [langfuse_handler]},  # 注入 callback
        ):
            yield {"data": chunk.content}

    return EventSourceResponse(event_generator())
```

---

## 十四、测试

### 14.1 pytest + httpx AsyncClient 基础配置

```python
# tests/conftest.py
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.main import app
from app.database import Base, get_db
from app.auth.jwt_handler import create_access_token


# 使用内存 SQLite 做测试（隔离生产数据）
TEST_DB_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DB_URL)
test_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)


@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_database():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def db_session():
    async with test_session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def client(db_session: AsyncSession):
    """
    dependency_overrides：替换真实依赖（DB、认证）
    """
    async def override_get_db():
        yield db_session

    async def override_get_current_user():
        return {"user_id": "test-user-001", "role": "user"}

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c

    app.dependency_overrides.clear()


@pytest.fixture
def auth_headers():
    token = create_access_token("test-user-001")
    return {"Authorization": f"Bearer {token}"}
```

### 14.2 普通接口测试

```python
# tests/test_chat.py
import pytest


@pytest.mark.asyncio
async def test_send_message(client, auth_headers):
    response = await client.post(
        "/api/v1/chat/send",
        json={"content": "帮我规划北京三日游", "session_id": "test-session-001"},
        headers=auth_headers,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["code"] == 200
    assert data["data"]["role"] == "assistant"
    assert len(data["data"]["content"]) > 0


@pytest.mark.asyncio
async def test_send_empty_message(client, auth_headers):
    response = await client.post(
        "/api/v1/chat/send",
        json={"content": "   "},  # 空白消息
        headers=auth_headers,
    )
    assert response.status_code == 422
```

### 14.3 测试 SSE 接口

```python
# tests/test_chat_sse.py
import pytest
import json


@pytest.mark.asyncio
async def test_chat_stream(client, auth_headers):
    """测试 SSE 流式输出"""
    chunks = []

    async with client.stream(
        "POST",
        "/api/v1/chat/stream",
        json={"content": "你好", "session_id": "sse-test-001"},
        headers={**auth_headers, "Accept": "text/event-stream"},
    ) as response:
        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]

        async for line in response.aiter_lines():
            if line.startswith("data:"):
                data = json.loads(line[5:].strip())
                chunks.append(data)
                if data.get("done"):
                    break

    assert len(chunks) > 0
    assert chunks[-1]["done"] is True
```

---

## 十五、部署

### 15.1 uvicorn / gunicorn 配置

```python
# gunicorn.conf.py
import os

bind = f"0.0.0.0:{os.getenv('PORT', '8000')}"
workers = int(os.getenv("WORKERS", 4))
worker_class = "uvicorn.workers.UvicornWorker"  # 异步 worker
worker_connections = 1000
timeout = 120          # SSE 流式接口需要更长超时
graceful_timeout = 30  # 优雅关闭等待时间
keepalive = 5
max_requests = 1000    # 每个 worker 处理 1000 请求后重启（防内存泄漏）
max_requests_jitter = 100
preload_app = True     # 预加载应用（节省内存）
```

```bash
# 启动命令
gunicorn app.main:app -c gunicorn.conf.py
```

### 15.2 Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# 先安装依赖（利用 Docker layer 缓存）
COPY pyproject.toml .
RUN pip install --no-cache-dir -e ".[prod]"

# 再复制代码
COPY app/ ./app/

# 非 root 用户运行
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["gunicorn", "app.main:app", "-c", "gunicorn.conf.py"]
```

### 15.3 健康检查接口

```python
# app/routers/health.py
from fastapi import APIRouter
from app.database import engine
import time

router = APIRouter(tags=["Health"])

START_TIME = time.time()


@router.get("/health")
async def health_check():
    """基础健康检查（负载均衡器探测用）"""
    return {"status": "ok"}


@router.get("/health/detail")
async def health_check_detail():
    """详细健康检查（含依赖服务状态）"""
    checks = {}

    # 检查 DB 连接
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as e:
        checks["database"] = f"error: {e}"

    return {
        "status": "ok" if all(v == "ok" for v in checks.values()) else "degraded",
        "uptime_seconds": int(time.time() - START_TIME),
        "checks": checks,
    }
```

### 15.4 优雅关闭

```python
# 在 lifespan 的关闭阶段处理
@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # 优雅关闭：等待正在进行的 SSE 流完成（最多 30 秒）
    active_streams = app.state.active_streams  # 自行维护计数器
    deadline = time.time() + 30
    while active_streams.count > 0 and time.time() < deadline:
        await asyncio.sleep(0.5)
    # 清理所有连接池
    await engine.dispose()
```

---

## 十六、常见踩坑

### 坑 1：同步函数阻塞 async event loop

**问题**：在 async 路由中调用同步阻塞函数（如同步 requests、time.sleep），会阻塞整个 event loop，导致所有请求卡住。

```python
# ❌ 错误：同步 requests 阻塞 event loop
@router.get("/data")
async def get_data():
    result = requests.get("https://api.example.com/data")  # 阻塞！
    return result.json()

# ✅ 正确：使用 httpx 异步客户端
import httpx

@router.get("/data")
async def get_data():
    async with httpx.AsyncClient() as client:
        result = await client.get("https://api.example.com/data")
    return result.json()

# ✅ 正确：无法改造的同步代码用 run_in_executor
@router.get("/data")
async def get_data():
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, sync_requests_call)
    return result
```

**特别注意**：`def` 路由函数（非 `async def`）FastAPI 会自动放 thread pool 执行，是安全的。但 `async def` 里调用同步阻塞必须显式 `run_in_executor`。

---

### 坑 2：Pydantic v2 与 v1 的差异

```python
# ❌ Pydantic v1 的写法（FastAPI 0.100+ 使用 Pydantic v2）
class OldModel(BaseModel):
    class Config:
        orm_mode = True  # v1 用 orm_mode

    @validator("name")         # v1 用 @validator
    def validate_name(cls, v):
        return v.strip()

# ✅ Pydantic v2 的正确写法
class NewModel(BaseModel):
    model_config = {"from_attributes": True}  # v2 用 from_attributes

    @field_validator("name")   # v2 用 @field_validator
    @classmethod
    def validate_name(cls, v: str) -> str:
        return v.strip()

# ❌ v2 序列化方式也变了
old_dict = model.dict()          # v1
old_json = model.json()          # v1

# ✅ v2 正确
new_dict = model.model_dump()    # v2
new_json = model.model_dump_json()  # v2
# 注意：model_dump(mode="json") 处理 datetime 等类型的序列化
```

---

### 坑 3：CORS 配置导致 SSE 失败

```python
# ❌ 错误：allow_origins=["*"] 与 allow_credentials=True 同时使用
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # 错误！
    allow_credentials=True,       # 两者不能同时成立（浏览器会拒绝）
    allow_methods=["*"],
    allow_headers=["*"],
)

# ❌ 错误：SSE 的 headers 没有暴露给前端
# 浏览器读不到自定义 header（如 X-Trace-Id）

# ✅ 正确配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://your-frontend.com"],  # 明确指定域名
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Trace-Id"],
    expose_headers=["X-Trace-Id", "X-Response-Time"],  # 允许前端读取
)
```

---

### 坑 4：SSE 连接泄漏

```python
# ❌ 错误：没有处理客户端断开，generator 无限循环
async def event_generator():
    while True:
        data = await get_next_event()  # 客户端断了也还在运行！
        yield {"data": data}

# ✅ 正确：检测 CancelledError + 用 asyncio.wait_for 设超时
async def event_generator():
    try:
        async for chunk in llm.astream(messages):
            yield {"data": chunk.content}
    except asyncio.CancelledError:
        # 客户端主动断开，正常退出
        logger.info("SSE client disconnected")
        # 这里可以做清理工作（取消 LLM 调用等）
        raise  # 必须重新抛出！

# ✅ 正确：维护活跃流计数，监控泄漏
active_sse_count = 0

async def event_generator():
    global active_sse_count
    active_sse_count += 1
    try:
        async for chunk in llm.astream(messages):
            yield {"data": chunk.content}
    finally:
        active_sse_count -= 1  # finally 保证一定执行
```

---

### 坑 5：依赖注入 yield 异常处理不完整

```python
# ❌ 错误：异常时没有回滚，session 处于脏状态
async def get_db():
    session = async_session_factory()
    yield session
    await session.commit()   # 如果路由抛出异常，commit 会跳过，但 session 没关闭

# ✅ 正确：使用 try/except/finally
async def get_db():
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise   # 重要：重新抛出，让 FastAPI 的异常处理器接管
        # finally 由 async with 保证 session.close() 执行
```

---

### 坑 6：BackgroundTasks 复用请求 DB session

```python
# ❌ 错误：后台任务用了路由注入的 db（请求结束后 session 已关闭）
@router.post("/send")
async def send_message(
    request: ChatRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    result = await ChatService.send(request)
    # 危险！后台任务执行时，db session 已经在 get_db 的 finally 里关闭了
    background_tasks.add_task(log_to_db, db, result)
    return BaseResponse(data=result)

# ✅ 正确：后台任务自己管理 session
async def log_to_db(session_id: str, tokens: int):
    async with async_session_factory() as db:
        await UsageRepo.record(db, session_id, tokens)
        await db.commit()

@router.post("/send")
async def send_message(request: ChatRequest, background_tasks: BackgroundTasks):
    result = await ChatService.send(request)
    background_tasks.add_task(log_to_db, request.session_id, result.tokens_used)
    return BaseResponse(data=result)
```

---

### 坑 7：返回大量数据不分页导致 OOM

```python
# ❌ 错误：一次性加载所有历史消息
@router.get("/history/{session_id}")
async def get_history(session_id: str, db=Depends(get_db)):
    messages = await db.execute(
        select(ChatMessage).where(ChatMessage.session_id == session_id)
    )
    return messages.scalars().all()  # 可能是几万条！

# ✅ 正确：强制分页
@router.get("/history/{session_id}")
async def get_history(
    session_id: str,
    pagination: Pagination = Depends(get_pagination),
    db=Depends(get_db),
):
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .offset(pagination.offset)
        .limit(pagination.page_size)
    )
    return result.scalars().all()
```

---

### 坑 8：LangChain streaming=True 但用非流式接口

```python
# ❌ 错误：LLM 设了 streaming=True，但用 invoke 而不是 astream
llm = ChatOpenAI(model="gpt-4o", streaming=True)

@router.post("/chat")
async def chat(content: str):
    # invoke 会等全部 token 生成完才返回，streaming=True 在这里没效果
    result = await llm.ainvoke([HumanMessage(content=content)])
    return {"content": result.content}

# ✅ 正确：要流式就用 astream + SSE
@router.post("/chat/stream")
async def chat_stream(content: str):
    async def gen():
        async for chunk in llm.astream([HumanMessage(content=content)]):
            yield {"data": chunk.content}
    return EventSourceResponse(gen())

# ✅ 正确：不需要流式就去掉 streaming=True
llm = ChatOpenAI(model="gpt-4o")  # streaming 默认 False
@router.post("/chat")
async def chat(content: str):
    result = await llm.ainvoke([HumanMessage(content=content)])
    return {"content": result.content}
```

---

## 十七、速查表

### 17.1 常用装饰器

```
+-----------------------------+------------------------------------------+
| 装饰器/参数                  | 说明                                     |
+-----------------------------+------------------------------------------+
| @router.get("/")            | GET 路由                                 |
| @router.post("/", status=201)| POST 路由，指定成功状态码                |
| @router.put("/{id}")        | PUT 路由（全量更新）                     |
| @router.patch("/{id}")      | PATCH 路由（部分更新）                   |
| @router.delete("/{id}", 204)| DELETE 路由                              |
| Path(..., description="")   | 路径参数，...表示必填                    |
| Query(default, ge=1, le=100)| 查询参数，带范围验证                     |
| Body(..., embed=True)       | 请求体，embed=True 时包一层 key          |
| Depends(fn)                 | 依赖注入                                 |
| Security(fn)                | 安全相关依赖（出现在 OpenAPI 文档中）    |
| BackgroundTasks             | 轻量后台任务（路由返回后执行）           |
| response_model=Schema       | 指定响应模型（自动序列化+文档）          |
| response_class=Response     | 指定响应类（StreamingResponse等）        |
+-----------------------------+------------------------------------------+
```

### 17.2 HTTP 状态码规范

```
+------+-------------------------------+------------------------------------+
| 状态码| 场景                          | FastAPI 写法                       |
+------+-------------------------------+------------------------------------+
| 200  | GET/PUT/PATCH 成功            | 默认值，无需指定                   |
| 201  | POST 创建资源成功             | status_code=status.HTTP_201_CREATED|
| 204  | DELETE 成功（无响应体）        | status_code=status.HTTP_204_NO_CONTENT|
| 400  | 请求参数语义错误（业务校验）   | raise HTTPException(400)           |
| 401  | 未认证（token 缺失/无效）      | raise HTTPException(401)           |
| 403  | 已认证但无权限                | raise HTTPException(403)           |
| 404  | 资源不存在                    | raise HTTPException(404)           |
| 409  | 资源冲突（重复创建）           | raise HTTPException(409)           |
| 422  | 请求参数类型/格式错误          | FastAPI 自动处理（Pydantic 验证失败）|
| 429  | 请求频率超限                  | raise HTTPException(429)           |
| 500  | 服务内部错误                  | 全局异常处理器捕获                 |
+------+-------------------------------+------------------------------------+
```

### 17.3 部署检查清单

```
部署前检查：
  [ ] 环境变量全部通过 pydantic-settings 管理，无硬编码
  [ ] SECRET_KEY / JWT_SECRET 已设置强随机值
  [ ] CORS allow_origins 已配置为生产域名（非 *）
  [ ] DB / Redis 连接池大小根据服务器规格配置
  [ ] 日志级别生产为 INFO，不输出 SQL
  [ ] Dockerfile 使用非 root 用户运行
  [ ] 健康检查接口已实现（/health）
  [ ] SSE 接口超时时间已配置（gunicorn timeout >= 120）
  [ ] Langfuse / 监控 SDK 配置已验证
  [ ] 依赖库已固定版本（requirements.lock 或 pyproject.toml）

启动后验证：
  [ ] /health 返回 200
  [ ] /docs（OpenAPI）可访问（生产可关闭）
  [ ] SSE 流式接口测试（curl 或 EventSource）
  [ ] 日志中 trace_id 正常出现
  [ ] Langfuse 收到第一条 trace
  [ ] DB 连接池监控指标正常
```

### 17.4 AI Agent 服务快速启动模板

```bash
# 安装核心依赖
pip install fastapi uvicorn[standard] pydantic-settings \
    sse-starlette httpx python-jose[cryptography] \
    sqlalchemy[asyncio] asyncpg aiosqlite \
    langchain-openai langgraph langfuse \
    structlog redis pytest pytest-asyncio

# 启动开发服务器（热重载）
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# 运行测试
pytest tests/ -v --asyncio-mode=auto

# 生产启动
gunicorn app.main:app -c gunicorn.conf.py
```

---

> **文档维护说明**：本文档随 FastAPI / LangChain / LangGraph 版本演进持续更新。发现坑请补充到第十六章。
> 版本参考：FastAPI 0.115+，Pydantic v2，LangChain 0.3+，LangGraph 0.2+
