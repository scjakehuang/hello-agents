# LlamaIndex 最佳实践与踩坑指南

## 文档信息

- 作者：徐凯旋
- 邮箱：azouever@gmail.com
- 更新时间：2026-04-14
- 标签：LlamaIndex, RAG, 向量检索, 知识库, Python

---

## 目录

1. [概述](#一概述)
2. [核心概念](#二核心概念)
3. [安装与配置](#三安装与配置)
4. [文档加载与解析](#四文档加载与解析最佳实践)
5. [索引类型与选择](#五索引类型与选择)
6. [Embedding 配置](#六embedding-配置)
7. [检索与 QueryEngine 配置](#七检索与-queryengine-配置)
8. [多文档路由](#八多文档路由)
9. [持久化与增量更新](#九持久化与增量更新)
10. [性能优化](#十性能优化)
11. [与 LangChain 集成](#十一与-langchain-集成)
12. [常见踩坑与解决方案](#十二常见踩坑与解决方案)
13. [速查表](#十三速查表)

---

## 一、概述

### 1.1 什么是 LlamaIndex

LlamaIndex（原名 GPT Index）是专为 LLM 应用设计的**数据框架**，核心聚焦在"如何把数据喂给 LLM"这个问题上。它提供了完整的数据摄取、索引管理、检索、查询的全链路能力。

**LlamaIndex 的核心价值主张：**

- **数据连接器（Data Connectors）**：内置 100+ 种数据源接入（PDF、数据库、API、Notion、Slack 等）
- **灵活的索引结构**：向量索引、关键词索引、知识图谱索引、摘要索引等多种策略
- **查询引擎（Query Engine）**：高层 API，一行代码完成问答
- **Agent 支持**：QueryEngine 可直接作为 Agent 工具使用
- **生产级持久化**：内置 StorageContext，支持多种向量数据库后端

### 1.2 LlamaIndex vs LangChain 对比

```
+------------------------------------------------------------------+
|               LlamaIndex vs LangChain 核心对比                    |
+------------------------------------------------------------------+
|                                                                   |
|  维度              LlamaIndex              LangChain             |
|  ---------------------------------------------------------------- |
|  核心定位          数据框架（RAG 专精）     通用 LLM 应用框架      |
|  设计哲学          以数据为中心             以链式编排为中心       |
|  RAG 能力          开箱即用，深度支持       需要组装，灵活但繁琐   |
|  Agent 支持        QueryEngineTool 集成     原生 Agent 更成熟      |
|  流程编排          有限（用 LangGraph 补）   LangGraph 强大         |
|  数据连接器        100+，开箱即用           社区提供，质量参差      |
|  索引类型          多种（向量/关键词/图谱）  主要是向量索引         |
|  学习曲线          中等                     较高                   |
|  社区生态          专注 RAG 领域            更广泛                 |
|  多模态支持        较好                     一般                   |
|                                                                   |
|  +------------------------------------------------------+         |
|  | 选型建议                                              |         |
|  | - 以 RAG/知识库为核心 → 优先 LlamaIndex              |         |
|  | - 需要复杂 Agent 编排/状态机 → 优先 LangChain/Graph   |         |
|  | - 最佳实践：LlamaIndex 做数据层 + LangChain 做编排层  |         |
|  +------------------------------------------------------+         |
|                                                                   |
+------------------------------------------------------------------+
```

### 1.3 适用场景

| 场景 | 推荐理由 | 典型用例 |
|------|----------|----------|
| **企业知识库问答** | 多格式文档支持好，索引管理完善 | 产品手册、规章制度查询 |
| **多文档智能检索** | RouterQueryEngine 天然支持路由 | 不同类型文档分库检索 |
| **结构化 + 非结构化混合查询** | PandasQueryEngine 支持表格 | 报告+数据混合分析 |
| **知识图谱构建** | KnowledgeGraphIndex 原生支持 | 实体关系提取与查询 |
| **本地部署 RAG** | 支持 Ollama、HuggingFace 本地模型 | 离线环境知识问答 |
| **增量知识库更新** | refresh_ref_docs 支持增量更新 | 实时更新的文档库 |

---

## 二、核心概念

### 2.1 核心对象体系

```
+------------------------------------------------------------------+
|                    LlamaIndex 核心对象层级                         |
+------------------------------------------------------------------+
|                                                                   |
|  Document（文档）                                                  |
|  ├── 原始文档单元，对应一个文件/页面/记录                           |
|  ├── 属性：text, metadata, doc_id, embedding                      |
|  └── 由 Reader/Loader 产生                                         |
|                                                                   |
|  Node（节点）                                                      |
|  ├── Document 被分块后的最小单元（也叫 TextNode）                  |
|  ├── 属性：text, metadata, node_id, relationships                  |
|  ├── 包含父子关系、前后关系（用于上下文扩展）                       |
|  └── 由 NodeParser/TextSplitter 产生                               |
|                                                                   |
|  Index（索引）                                                     |
|  ├── 对 Node 集合建立的检索结构                                     |
|  ├── 类型：VectorStoreIndex / SummaryIndex /                      |
|  │         KeywordTableIndex / KnowledgeGraphIndex                 |
|  └── 存储在 StorageContext 中（可持久化）                          |
|                                                                   |
|  Retriever（检索器）                                               |
|  ├── 从 Index 中按策略检索相关 Node                                |
|  ├── index.as_retriever(similarity_top_k=10)                      |
|  └── 返回 NodeWithScore 列表                                       |
|                                                                   |
|  Postprocessor（后处理器）                                         |
|  ├── 对检索结果进行过滤、重排、转换                                |
|  ├── 类型：SimilarityPostprocessor / SentenceTransformerRerank /  |
|  │         MetadataReplacementPostProcessor / LLMRerank           |
|  └── 嵌入 QueryEngine 的 node_postprocessors 参数                 |
|                                                                   |
|  QueryEngine（查询引擎）                                           |
|  ├── 高层 API：输入问题，输出带引用的答案                          |
|  ├── 内部流程：Retriever → Postprocessor → Synthesizer → 答案      |
|  └── index.as_query_engine(...)                                   |
|                                                                   |
|  ResponseSynthesizer（响应合成器）                                 |
|  ├── 将检索结果和问题传给 LLM 生成最终答案                         |
|  └── 模式：compact / tree_summarize / refine / simple_summarize   |
|                                                                   |
+------------------------------------------------------------------+
```

### 2.2 关键术语速查

| 术语 | 含义 | 使用位置 |
|------|------|----------|
| `Document` | 原始文档对象 | Reader 输出 |
| `TextNode` | 分块后的文本节点 | NodeParser 输出 |
| `NodeWithScore` | 带相似度分数的节点 | Retriever 输出 |
| `StorageContext` | 持久化上下文，管理存储后端 | Index 创建时 |
| `ServiceContext` | 旧版全局配置（已弃用，用 Settings） | v0.9 以前 |
| `Settings` | v0.10+ 全局配置（llm/embed_model 等） | 应用启动时 |
| `VectorStoreIndex` | 向量索引，最常用 | 语义检索场景 |
| `SummaryIndex` | 摘要索引，适合全文摘要 | 长文档摘要 |
| `ResponseMode` | 响应合成策略（compact/refine 等） | QueryEngine 参数 |
| `QueryBundle` | 包含原始查询和扩展查询的对象 | 高级检索 |

### 2.3 版本说明

```
+------------------------------------------------------------------+
|                    LlamaIndex 版本迁移重点                         |
+------------------------------------------------------------------+
|                                                                   |
|  v0.9.x（旧版）                                                   |
|  ├── 包名：llama_index                                            |
|  ├── 全局配置：ServiceContext                                     |
|  └── 安装：pip install llama-index                                |
|                                                                   |
|  v0.10.x+（当前主流）                                             |
|  ├── 包名：llama_index.core                                       |
|  ├── 全局配置：Settings（替代 ServiceContext）                    |
|  ├── 模块化安装：llama-index-core + 按需安装集成包                 |
|  └── 安装：pip install llama-index-core llama-index-llms-openai   |
|                                                                   |
|  注意：本文档基于 v0.10.x+，旧版 API 不兼容                       |
|                                                                   |
+------------------------------------------------------------------+
```

---

## 三、安装与配置

### 3.1 推荐安装方式

```python
# 核心包（必装）
pip install llama-index-core

# LLM 集成（按需）
pip install llama-index-llms-openai          # OpenAI GPT 系列
pip install llama-index-llms-anthropic       # Claude 系列
pip install llama-index-llms-ollama          # 本地 Ollama

# Embedding 集成（按需）
pip install llama-index-embeddings-openai    # OpenAI Embedding
pip install llama-index-embeddings-huggingface  # HuggingFace 本地模型

# 向量数据库（按需）
pip install llama-index-vector-stores-chroma    # Chroma（本地）
pip install llama-index-vector-stores-milvus    # Milvus
pip install llama-index-vector-stores-pinecone  # Pinecone

# 文档加载器（按需）
pip install llama-index-readers-file         # PDF/Word/Excel 等
pip install llama-index-readers-web          # 网页抓取

# Reranker
pip install llama-index-postprocessor-sentence-transformer-rerank
```

### 3.2 全局配置（Settings）

```python
from llama_index.core import Settings
from llama_index.llms.openai import OpenAI
from llama_index.embeddings.openai import OpenAIEmbedding

# ✅ 推荐：应用启动时统一配置，全局生效
Settings.llm = OpenAI(
    model="gpt-4o",
    temperature=0.1,
    max_tokens=2048,
    timeout=60,
)

Settings.embed_model = OpenAIEmbedding(
    model="text-embedding-3-small",
    embed_batch_size=100,   # 批量 embedding 大小
)

Settings.chunk_size = 512        # 全局分块大小
Settings.chunk_overlap = 50      # 分块重叠
Settings.num_output = 512        # LLM 输出 Token 限制
Settings.context_window = 4096   # 上下文窗口大小
```

### 3.3 使用本地模型（Ollama）

```python
from llama_index.llms.ollama import Ollama
from llama_index.embeddings.ollama import OllamaEmbedding

# 本地模型配置（离线/私有化场景）
Settings.llm = Ollama(
    model="llama3",
    base_url="http://localhost:11434",
    request_timeout=120.0,
)

Settings.embed_model = OllamaEmbedding(
    model_name="nomic-embed-text",
    base_url="http://localhost:11434",
    ollama_additional_kwargs={"mirostat": 0},
)
```

---

## 四、文档加载与解析最佳实践

### 4.1 多格式文档加载

```python
from llama_index.core import SimpleDirectoryReader
from llama_index.readers.file import PDFReader, DocxReader, CSVReader

# ✅ 方式一：SimpleDirectoryReader（最常用，自动识别格式）
documents = SimpleDirectoryReader(
    input_dir="./data",
    required_exts=[".pdf", ".md", ".txt", ".docx"],
    exclude=["*.tmp", "*.bak", ".*"],      # 排除临时文件和隐藏文件
    recursive=True,                        # 递归子目录
    filename_as_id=True,                   # 用文件名作为文档 ID（方便增量更新）
    num_workers=4,                         # 多线程加载
).load_data()

# ✅ 方式二：指定 Reader，精细控制
pdf_reader = PDFReader()
pdf_docs = pdf_reader.load_data(file=Path("./report.pdf"))

# ✅ 方式三：从 URL 加载
from llama_index.readers.web import SimpleWebPageReader
web_docs = SimpleWebPageReader(html_to_text=True).load_data(
    urls=["https://docs.example.com/api"]
)

# ✅ 方式四：从数据库加载
from llama_index.readers.database import DatabaseReader
db_reader = DatabaseReader(
    scheme="postgresql",
    host="localhost",
    port=5432,
    user="user",
    password="password",
    dbname="knowledge_db",
)
db_docs = db_reader.load_data(query="SELECT title, content FROM articles WHERE active = true")
```

### 4.2 分块策略选择

```
+------------------------------------------------------------------+
|                    分块策略对比                                    |
+------------------------------------------------------------------+
|                                                                   |
|  策略                  适用场景              chunk_size 建议       |
|  ---------------------------------------------------------------- |
|  SentenceSplitter      通用文本，最常用       512 / 1024           |
|  TokenTextSplitter     精确 Token 控制        256 / 512            |
|  SemanticSplitter      语义完整性要求高       动态（无需指定）      |
|  SentenceWindowSplit   需要上下文窗口扩展     128（窗口=3~5句）     |
|  HierarchicalNodeParse 层级关系查询           父512 / 子128        |
|  CodeSplitter          代码文档              1024（按函数分块）     |
|  MarkdownNodeParser    Markdown 文档          按标题自动分割        |
|                                                                   |
+------------------------------------------------------------------+
```

```python
from llama_index.core.node_parser import (
    SentenceSplitter,
    SemanticSplitterNodeParser,
    HierarchicalNodeParser,
    SentenceWindowNodeParser,
    MarkdownNodeParser,
)

# ✅ 通用场景：SentenceSplitter
splitter = SentenceSplitter(
    chunk_size=512,
    chunk_overlap=50,
    paragraph_separator="\n\n",  # 段落边界
    secondary_chunking_regex="[^,.;。！？]+[,.;。！？]?",  # 句子边界
)
nodes = splitter.get_nodes_from_documents(documents)

# ✅ 语义分块：需要 embedding 模型（自动按语义边界切分）
from llama_index.embeddings.openai import OpenAIEmbedding
semantic_splitter = SemanticSplitterNodeParser(
    embed_model=OpenAIEmbedding(),
    breakpoint_percentile_threshold=95,  # 语义相似度断点阈值
    buffer_size=1,                       # 每侧合并的句子数
)

# ✅ 层级分块（父子节点，用于 Small-to-Big 检索）
hierarchical_parser = HierarchicalNodeParser.from_defaults(
    chunk_sizes=[2048, 512, 128]  # 粗 → 中 → 细三层
)

# ✅ 句子窗口分块（小块检索，大块输入 LLM）
window_parser = SentenceWindowNodeParser.from_defaults(
    window_size=3,           # 每侧扩展 3 句
    window_metadata_key="window",
    original_text_metadata_key="original_text",
)

# ✅ Markdown 文档：按标题层级自动分割
md_parser = MarkdownNodeParser()
```

### 4.3 元数据注入

元数据对过滤、溯源、Rerank 都有重要作用，应在加载阶段系统性地注入。

```python
from datetime import datetime
from llama_index.core.schema import TextNode

# ✅ 方式一：在 Document 加载时注入元数据
documents = SimpleDirectoryReader(
    "./data",
    file_metadata=lambda file_path: {   # 按文件路径动态生成元数据
        "file_name": Path(file_path).name,
        "file_type": Path(file_path).suffix,
        "source": "internal_knowledge_base",
        "created_at": datetime.fromtimestamp(
            Path(file_path).stat().st_mtime
        ).isoformat(),
    }
).load_data()

# ✅ 方式二：分块后批量注入业务元数据
for node in nodes:
    # 保留文件来源信息
    node.metadata["file_name"] = node.metadata.get("file_name", "unknown")
    node.metadata["created_at"] = datetime.now().isoformat()
    node.metadata["version"] = "v2.0"
    node.metadata["domain"] = "travel"   # 业务领域标签，方便后续过滤

    # 控制哪些元数据字段参与 embedding（避免噪声）
    node.excluded_embed_metadata_keys = ["created_at", "file_name"]
    # 控制哪些元数据字段出现在 LLM prompt 里
    node.excluded_llm_metadata_keys = ["created_at"]

# ✅ 方式三：手动创建 Node 并注入
node = TextNode(
    text="北京故宫是中国最大的古代宫殿建筑群...",
    metadata={
        "source": "travel_guide",
        "city": "北京",
        "category": "景点",
        "rating": 4.9,
    },
    id_="attraction_001",
)
```

---

## 五、索引类型与选择

### 5.1 索引类型概览

```
+------------------------------------------------------------------+
|                    LlamaIndex 索引类型对比                         |
+------------------------------------------------------------------+
|                                                                   |
|  VectorStoreIndex（向量索引）                                      |
|  ├── 原理：Node → Embedding → 向量数据库 → 余弦相似度检索          |
|  ├── 适用：语义相似查询、知识库问答（最常用）                       |
|  └── 特点：速度快，支持大规模数据                                  |
|                                                                   |
|  SummaryIndex（摘要索引，旧称 ListIndex）                          |
|  ├── 原理：按顺序存储所有 Node，查询时遍历所有或摘要               |
|  ├── 适用：需要全文摘要、全文分析的场景                            |
|  └── 特点：召回率高，但 Token 消耗大，速度慢                       |
|                                                                   |
|  KeywordTableIndex（关键词索引）                                   |
|  ├── 原理：提取关键词 → 建立倒排索引                               |
|  ├── 适用：精确关键词查询，不依赖向量相似度                         |
|  └── 特点：不需要 Embedding，但语义理解弱                          |
|                                                                   |
|  KnowledgeGraphIndex（知识图谱索引）                               |
|  ├── 原理：LLM 抽取实体和关系 → 图数据库存储                       |
|  ├── 适用：多跳推理、实体关系查询                                  |
|  └── 特点：强关系推理能力，构建成本高                              |
|                                                                   |
|  PropertyGraphIndex（属性图索引，v0.10.3+）                       |
|  ├── 原理：结合向量 + 图结构                                       |
|  ├── 适用：复杂知识图谱 + 语义检索混合场景                         |
|  └── 特点：最强大，但构建复杂                                      |
|                                                                   |
+------------------------------------------------------------------+
```

### 5.2 VectorStoreIndex（最常用）

```python
from llama_index.core import VectorStoreIndex
from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.core import StorageContext
import chromadb

# ✅ 内存模式（开发/测试）
index = VectorStoreIndex(nodes, show_progress=True)

# ✅ 生产模式：使用持久化向量数据库
chroma_client = chromadb.PersistentClient(path="./chroma_db")
chroma_collection = chroma_client.get_or_create_collection("knowledge_base")
vector_store = ChromaVectorStore(chroma_collection=chroma_collection)
storage_context = StorageContext.from_defaults(vector_store=vector_store)

index = VectorStoreIndex(
    nodes,
    storage_context=storage_context,
    show_progress=True,
)

# ✅ Milvus 生产配置
from llama_index.vector_stores.milvus import MilvusVectorStore
vector_store = MilvusVectorStore(
    uri="http://localhost:19530",
    collection_name="travel_knowledge",
    dim=1536,           # text-embedding-3-small 维度
    overwrite=False,    # 不覆盖已有数据
)
```

### 5.3 SummaryIndex（全文摘要）

```python
from llama_index.core import SummaryIndex

# ✅ 适合对整篇文档做摘要/总结
summary_index = SummaryIndex(nodes)
summary_engine = summary_index.as_query_engine(
    response_mode="tree_summarize",  # 递归摘要，适合长文档
)
response = summary_engine.query("请总结这份报告的核心结论")
```

### 5.4 KnowledgeGraphIndex（知识图谱）

```python
from llama_index.core import KnowledgeGraphIndex
from llama_index.graph_stores.nebula import NebulaGraphStore

# ✅ 构建知识图谱索引（需要 LLM 抽取三元组）
kg_index = KnowledgeGraphIndex.from_documents(
    documents,
    max_triplets_per_chunk=10,    # 每块最多提取 10 个三元组
    include_embeddings=True,      # 同时保存向量（混合检索）
    show_progress=True,
)

# 查询（自动用图谱进行多跳推理）
kg_engine = kg_index.as_query_engine(
    include_text=True,
    retriever_mode="keyword",     # 用关键词在图中检索
    response_mode="tree_summarize",
)
response = kg_engine.query("北京有哪些与故宫相关的景点？")
```

---

## 六、Embedding 配置

### 6.1 全局统一配置（必须遵守）

```python
from llama_index.core import Settings
from llama_index.embeddings.openai import OpenAIEmbedding
from llama_index.embeddings.huggingface import HuggingFaceEmbedding

# ✅ 正确：应用启动时统一设置，索引和查询共享同一模型
Settings.embed_model = OpenAIEmbedding(
    model="text-embedding-3-small",
    embed_batch_size=100,
)

# 之后的所有 Index 创建和查询都自动使用这个配置
index = VectorStoreIndex(nodes)          # 使用 Settings.embed_model
query_engine = index.as_query_engine()   # 使用 Settings.embed_model
```

### 6.2 Embedding 模型选型

| 模型 | 维度 | 场景 | 成本 |
|------|------|------|------|
| `text-embedding-3-small` | 1536 | 通用，性价比最高 | 低 |
| `text-embedding-3-large` | 3072 | 高精度语义检索 | 中 |
| `text-embedding-ada-002` | 1536 | 旧版，不推荐新项目 | 低 |
| `BAAI/bge-large-zh-v1.5` | 1024 | 中文场景，本地部署 | 免费 |
| `BAAI/bge-m3` | 1024 | 多语言，离线 | 免费 |
| `nomic-embed-text` | 768 | 本地 Ollama，轻量 | 免费 |

```python
# ✅ 中文场景推荐：BGE 本地模型
from llama_index.embeddings.huggingface import HuggingFaceEmbedding

Settings.embed_model = HuggingFaceEmbedding(
    model_name="BAAI/bge-large-zh-v1.5",
    max_length=512,
    embed_batch_size=32,   # 本地 GPU 批量大小
)

# ✅ 离线/私有化：Ollama Embedding
from llama_index.embeddings.ollama import OllamaEmbedding
Settings.embed_model = OllamaEmbedding(model_name="nomic-embed-text")
```

### 6.3 自定义 Embedding 适配器

```python
from llama_index.core.embeddings import BaseEmbedding
from typing import List

class CustomEmbedding(BaseEmbedding):
    """接入自定义 / 内部 Embedding 服务"""

    api_url: str = "http://internal-embedding-service/v1/embed"
    api_key: str = ""

    def _get_query_embedding(self, query: str) -> List[float]:
        return self._call_api([query])[0]

    def _get_text_embedding(self, text: str) -> List[float]:
        return self._call_api([text])[0]

    def _get_text_embeddings(self, texts: List[str]) -> List[List[float]]:
        return self._call_api(texts)

    async def _aget_query_embedding(self, query: str) -> List[float]:
        # 异步版本
        return self._get_query_embedding(query)

    def _call_api(self, texts: List[str]) -> List[List[float]]:
        import httpx
        response = httpx.post(
            self.api_url,
            json={"texts": texts},
            headers={"Authorization": f"Bearer {self.api_key}"},
            timeout=30,
        )
        response.raise_for_status()
        return response.json()["embeddings"]

Settings.embed_model = CustomEmbedding(
    api_url="http://your-service/embed",
    api_key="your-key",
)
```

---

## 七、检索与 QueryEngine 配置

### 7.1 基础 QueryEngine 配置

```python
from llama_index.core.postprocessor import SentenceTransformerRerank, SimilarityPostprocessor

# ✅ 推荐的生产级 QueryEngine 配置
query_engine = index.as_query_engine(
    # 检索参数
    similarity_top_k=10,               # 初始召回 10 个节点
    # 后处理器（按顺序执行）
    node_postprocessors=[
        SimilarityPostprocessor(similarity_cutoff=0.7),   # 过滤低相似度
        SentenceTransformerRerank(
            model="BAAI/bge-reranker-base",
            top_n=5,                   # Rerank 后保留 5 个
        ),
    ],
    # 响应合成策略
    response_mode="compact",           # compact / refine / tree_summarize
    verbose=True,
)

response = query_engine.query("北京有哪些必去景点？")
print(response.response)              # 答案文本
print(response.source_nodes)         # 引用的原始节点
```

### 7.2 响应合成模式选择

```
+------------------------------------------------------------------+
|                    ResponseMode 对比                               |
+------------------------------------------------------------------+
|                                                                   |
|  模式                  说明                     适用场景          |
|  ---------------------------------------------------------------- |
|  compact（默认）        合并多个节点到一次 LLM   通用问答，省 Token |
|  refine               逐步精炼，多次 LLM        追求精确，成本高   |
|  tree_summarize        树状递归摘要              长文档总结         |
|  simple_summarize      简单拼接后 LLM            快速粗略回答       |
|  no_text              只返回节点不生成            纯检索场景         |
|  accumulate           每个节点独立回答再合并      对比类问题         |
|                                                                   |
+------------------------------------------------------------------+
```

### 7.3 Hybrid Search（混合检索）

```python
from llama_index.core.retrievers import VectorIndexRetriever, KeywordTableSimpleRetriever
from llama_index.core.query_engine import RetrieverQueryEngine
from llama_index.core.retrievers import QueryFusionRetriever

# ✅ 方式一：QueryFusionRetriever（推荐，内置 RRF 融合）
retriever = QueryFusionRetriever(
    retrievers=[
        VectorIndexRetriever(index=vector_index, similarity_top_k=10),
        # BM25 检索器（需要 llama-index-retrievers-bm25）
        BM25Retriever.from_defaults(index=vector_index, similarity_top_k=10),
    ],
    similarity_top_k=5,
    num_queries=4,                  # 生成 4 个查询变体（Query Expansion）
    mode="reciprocal_rerank",       # RRF 融合算法
    use_async=True,
    verbose=True,
)

hybrid_engine = RetrieverQueryEngine.from_args(
    retriever=retriever,
    node_postprocessors=[
        SentenceTransformerRerank(model="BAAI/bge-reranker-base", top_n=5)
    ],
)

# ✅ 方式二：元数据过滤 + 向量检索
from llama_index.core.vector_stores import MetadataFilter, MetadataFilters, FilterOperator

filters = MetadataFilters(filters=[
    MetadataFilter(key="city", value="北京"),
    MetadataFilter(key="category", value="景点"),
])

filtered_engine = index.as_query_engine(
    similarity_top_k=10,
    filters=filters,
)
```

### 7.4 自定义 Retriever

```python
from llama_index.core.retrievers import BaseRetriever
from llama_index.core.schema import NodeWithScore, QueryBundle

class CustomRetriever(BaseRetriever):
    """自定义检索器：向量检索 + 业务过滤"""

    def __init__(self, vector_retriever, keyword_retriever):
        self._vector_retriever = vector_retriever
        self._keyword_retriever = keyword_retriever
        super().__init__()

    def _retrieve(self, query_bundle: QueryBundle) -> list[NodeWithScore]:
        # 并行执行两路检索
        vector_nodes = self._vector_retriever.retrieve(query_bundle)
        keyword_nodes = self._keyword_retriever.retrieve(query_bundle)

        # 合并去重（按 node_id）
        all_nodes = {n.node.node_id: n for n in vector_nodes}
        for node in keyword_nodes:
            if node.node.node_id not in all_nodes:
                all_nodes[node.node.node_id] = node

        # 按分数排序
        return sorted(all_nodes.values(), key=lambda x: x.score or 0, reverse=True)
```

---

## 八、多文档路由

### 8.1 RouterQueryEngine

```python
from llama_index.core.query_engine import RouterQueryEngine
from llama_index.core.selectors import LLMSingleSelector, PydanticMultiSelector
from llama_index.core.tools import QueryEngineTool, ToolMetadata

# ✅ 为不同类型文档创建独立索引
product_index = VectorStoreIndex.from_documents(product_docs)
faq_index = VectorStoreIndex.from_documents(faq_docs)
api_index = VectorStoreIndex.from_documents(api_docs)

# 包装为工具
tools = [
    QueryEngineTool(
        query_engine=product_index.as_query_engine(similarity_top_k=5),
        metadata=ToolMetadata(
            name="product_search",
            description="搜索产品功能介绍、使用指南、产品规格说明。"
                        "当用户询问产品特性、功能、使用方法时使用此工具。"
        )
    ),
    QueryEngineTool(
        query_engine=faq_index.as_query_engine(similarity_top_k=5),
        metadata=ToolMetadata(
            name="faq_search",
            description="搜索常见问题与解答（FAQ）。"
                        "当用户遇到常见问题、故障排除时使用此工具。"
        )
    ),
    QueryEngineTool(
        query_engine=api_index.as_query_engine(similarity_top_k=5),
        metadata=ToolMetadata(
            name="api_search",
            description="搜索 API 文档、接口说明、开发指南。"
                        "当用户询问接口调用方式、参数说明时使用此工具。"
        )
    ),
]

# ✅ 单选路由（LLM 选择最合适的一个）
router_engine = RouterQueryEngine(
    selector=LLMSingleSelector.from_defaults(),
    query_engine_tools=tools,
    verbose=True,
)

# ✅ 多选路由（多个文档库同时查询后合并）
multi_router_engine = RouterQueryEngine(
    selector=PydanticMultiSelector.from_defaults(),
    query_engine_tools=tools,
    verbose=True,
)
```

### 8.2 SubQuestionQueryEngine（子问题分解）

```python
from llama_index.core.query_engine import SubQuestionQueryEngine

# ✅ 将复杂问题分解为子问题，分别检索后合并
sub_question_engine = SubQuestionQueryEngine.from_defaults(
    query_engine_tools=tools,
    use_async=True,      # 并行执行子问题
    verbose=True,
)

# 复杂问题：LLM 自动分解为多个子问题并行检索
response = sub_question_engine.query(
    "产品的 API 限流策略是什么？限流后的错误码应该怎么处理？"
)
```

### 8.3 工具化（用于 Agent）

```python
from llama_index.core.tools import QueryEngineTool
from llama_index.agent.openai import OpenAIAgent

# ✅ 将 QueryEngine 转为 Agent 可以调用的工具
knowledge_tool = QueryEngineTool.from_defaults(
    query_engine=router_engine,
    name="knowledge_base",
    description="查询内部知识库，包含产品文档、FAQ 和 API 文档",
)

# 构建带知识库的 Agent
agent = OpenAIAgent.from_tools(
    tools=[knowledge_tool, other_tool],
    llm=OpenAI(model="gpt-4o"),
    verbose=True,
    system_prompt="你是一个智能客服助手，可以查询内部知识库回答用户问题。",
)
```

---

## 九、持久化与增量更新

### 9.1 StorageContext 持久化

```python
from llama_index.core import StorageContext, load_index_from_storage

# ✅ 保存索引到本地
index.storage_context.persist(persist_dir="./storage")

# ✅ 从本地加载索引（无需重建）
storage_context = StorageContext.from_defaults(persist_dir="./storage")
index = load_index_from_storage(storage_context)

# 加载后直接使用
query_engine = index.as_query_engine(similarity_top_k=5)
```

### 9.2 使用向量数据库持久化（生产推荐）

```python
import chromadb
from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.core import StorageContext, VectorStoreIndex

# ✅ Chroma 持久化（轻量，本地）
chroma_client = chromadb.PersistentClient(path="./chroma_db")
chroma_collection = chroma_client.get_or_create_collection("my_knowledge")
vector_store = ChromaVectorStore(chroma_collection=chroma_collection)
storage_context = StorageContext.from_defaults(vector_store=vector_store)

# 首次构建
index = VectorStoreIndex(nodes, storage_context=storage_context)

# 后续加载（直接从向量库读取，不需要重建）
index = VectorStoreIndex.from_vector_store(
    vector_store=vector_store,
)
```

### 9.3 增量更新

```python
# ✅ 方式一：refresh_ref_docs（推荐，自动检测变更）
# 需要 filename_as_id=True 加载文档
new_documents = SimpleDirectoryReader(
    "./data",
    filename_as_id=True,
).load_data()

# 自动更新：新增文档加入，修改文档重建，删除文档保留（需手动清理）
refreshed_docs = index.refresh_ref_docs(
    new_documents,
    update_kwargs={"delete_kwargs": {"delete_from_docstore": True}},
)
print(f"更新情况: {refreshed_docs}")  # [True, False, True] 表示哪些文档被更新

# ✅ 方式二：手动增量插入新文档
from llama_index.core.node_parser import SentenceSplitter

new_doc = Document(text="新增内容...", metadata={"source": "update_2026"})
new_nodes = SentenceSplitter().get_nodes_from_documents([new_doc])
for node in new_nodes:
    index.insert_nodes([node])

# ✅ 方式三：删除特定文档
index.delete_ref_doc("document_id_to_delete", delete_from_docstore=True)
```

---

## 十、性能优化

### 10.1 批量 Embedding

```python
from llama_index.core import Settings
from llama_index.embeddings.openai import OpenAIEmbedding

# ✅ 配置批量 Embedding，减少 API 调用次数
Settings.embed_model = OpenAIEmbedding(
    model="text-embedding-3-small",
    embed_batch_size=100,    # 每批 100 个文本（OpenAI 支持最多 2048）
)

# ✅ 构建索引时开启进度显示
index = VectorStoreIndex(nodes, show_progress=True)
```

### 10.2 响应缓存

```python
from llama_index.core.query_engine import RetrieverQueryEngine
from llama_index.core.response_synthesizers import get_response_synthesizer
from llama_index.storage.kvstore.redis import RedisKVStore
from llama_index.core.storage.index_store import KeyValueIndexStore

# ✅ 使用 Redis 缓存 Embedding（避免重复计算）
from llama_index.embeddings.openai import OpenAIEmbedding
import hashlib

class CachedEmbedding(OpenAIEmbedding):
    """带 Redis 缓存的 Embedding"""

    def __init__(self, redis_client, **kwargs):
        super().__init__(**kwargs)
        self.cache = redis_client

    def _get_text_embedding(self, text: str) -> list[float]:
        cache_key = f"emb:{hashlib.md5(text.encode()).hexdigest()}"
        cached = self.cache.get(cache_key)
        if cached:
            import json
            return json.loads(cached)
        embedding = super()._get_text_embedding(text)
        self.cache.setex(cache_key, 86400, json.dumps(embedding))  # 缓存 24h
        return embedding

# ✅ 查询结果缓存
from functools import lru_cache

@lru_cache(maxsize=1000)
def cached_query(question: str) -> str:
    """缓存常见问题的答案"""
    response = query_engine.query(question)
    return str(response)
```

### 10.3 异步处理

```python
import asyncio
from llama_index.core import VectorStoreIndex

# ✅ 异步构建索引
async def build_index_async(documents):
    index = await VectorStoreIndex.from_documents(
        documents,
        use_async=True,      # 异步 Embedding
        show_progress=True,
    )
    return index

# ✅ 异步查询
async def query_async(index, questions: list[str]):
    query_engine = index.as_query_engine(use_async=True)

    # 并行执行多个查询
    tasks = [query_engine.aquery(q) for q in questions]
    responses = await asyncio.gather(*tasks)

    return [str(r) for r in responses]

# ✅ 流式输出
async def stream_query(index, question: str):
    query_engine = index.as_query_engine(streaming=True)
    streaming_response = query_engine.query(question)
    for text in streaming_response.response_gen:
        print(text, end="", flush=True)
```

### 10.4 性能调优清单

```
+------------------------------------------------------------------+
|                    LlamaIndex 性能调优清单                         |
+------------------------------------------------------------------+
|                                                                   |
|  Embedding 阶段                                                   |
|  ☑ embed_batch_size 设为 50-200（避免频繁 API 调用）              |
|  ☑ 本地模型启用 GPU（device="cuda"）                              |
|  ☑ 对相同文本缓存 Embedding 结果                                  |
|                                                                   |
|  索引构建阶段                                                     |
|  ☑ show_progress=True 监控进度                                    |
|  ☑ use_async=True 异步 Embedding                                  |
|  ☑ 大型知识库使用 Milvus/Pinecone，不用内存索引                   |
|                                                                   |
|  检索阶段                                                         |
|  ☑ similarity_top_k 不要超过 20（一般 5-10 够用）                 |
|  ☑ 先过滤（元数据/相似度阈值）再 Rerank                           |
|  ☑ 缓存高频查询结果                                               |
|                                                                   |
|  LLM 调用阶段                                                     |
|  ☑ response_mode="compact" 减少 LLM 调用次数                     |
|  ☑ num_output 按需设置，不要过大                                  |
|  ☑ 流式输出（streaming=True）改善用户体验                         |
|                                                                   |
+------------------------------------------------------------------+
```

---

## 十一、与 LangChain 集成

### 11.1 LlamaIndex → LangChain（LlamaIndex 作为 Retriever）

```python
from llama_index.core import VectorStoreIndex
from llama_index.core.langchain_helpers.text_splitter import LangChainNodeParser
from langchain.schema import Document as LangchainDocument

# ✅ 方式一：将 LlamaIndex Retriever 转为 LangChain Retriever
from llama_index.core.retrievers import VectorIndexRetriever

llama_retriever = VectorIndexRetriever(index=index, similarity_top_k=5)

# 包装为 LangChain 兼容接口
class LlamaIndexRetriever:
    """LlamaIndex Retriever 适配器，兼容 LangChain 接口"""

    def __init__(self, llama_retriever):
        self._retriever = llama_retriever

    def get_relevant_documents(self, query: str) -> list[LangchainDocument]:
        nodes = self._retriever.retrieve(query)
        return [
            LangchainDocument(
                page_content=node.get_content(),
                metadata=node.metadata,
            )
            for node in nodes
        ]

lc_retriever = LlamaIndexRetriever(llama_retriever)
```

### 11.2 LlamaIndex 原生 LangChain 适配器

```python
# ✅ 方式二：使用官方适配器（推荐）
# pip install llama-index-tools-langchain

from llama_index.tools.langchain import LangChainToolSpec
from langchain.tools import Tool

# 将 QueryEngine 包装为 LangChain Tool
query_tool = Tool(
    name="knowledge_base_query",
    func=lambda q: str(query_engine.query(q)),
    description="查询知识库，回答关于产品和服务的问题",
)

# 在 LangChain Agent 中使用
from langchain.agents import initialize_agent, AgentType
from langchain_openai import ChatOpenAI

lc_agent = initialize_agent(
    tools=[query_tool],
    llm=ChatOpenAI(model="gpt-4o"),
    agent=AgentType.OPENAI_FUNCTIONS,
    verbose=True,
)
```

### 11.3 LangChain TextSplitter → LlamaIndex Node

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter
from llama_index.core.langchain_helpers.text_splitter import LangChainNodeParser

# ✅ 使用 LangChain 的文本分割器，产出 LlamaIndex Node
lc_splitter = RecursiveCharacterTextSplitter(
    chunk_size=512,
    chunk_overlap=50,
)

node_parser = LangChainNodeParser(lc_splitter)
nodes = node_parser.get_nodes_from_documents(documents)
index = VectorStoreIndex(nodes)
```

---

## 十二、常见踩坑与解决方案

### 坑 1：索引未持久化，每次启动重建

```python
# ❌ 错误：每次启动都重建索引，耗时且浪费 API 调用
def get_index():
    documents = SimpleDirectoryReader("./data").load_data()
    index = VectorStoreIndex.from_documents(documents)  # 每次重建！
    return index

# ✅ 正确：检查本地存储，已存在则直接加载
import os
from llama_index.core import StorageContext, load_index_from_storage

PERSIST_DIR = "./storage"

def get_index():
    if os.path.exists(PERSIST_DIR):
        # 从磁盘加载
        storage_context = StorageContext.from_defaults(persist_dir=PERSIST_DIR)
        index = load_index_from_storage(storage_context)
    else:
        # 首次构建并持久化
        documents = SimpleDirectoryReader("./data").load_data()
        index = VectorStoreIndex.from_documents(documents, show_progress=True)
        index.storage_context.persist(persist_dir=PERSIST_DIR)
    return index
```

### 坑 2：Embedding 模型不一致导致结果错乱

```python
# ❌ 错误：建索引和查询用不同模型，向量空间不一致
# 建索引时
index = VectorStoreIndex(nodes, embed_model=OpenAIEmbedding(model="ada-002"))
# 查询时（Settings 没配置，或后来改了）
Settings.embed_model = OpenAIEmbedding(model="text-embedding-3-small")
query_engine = index.as_query_engine()  # 用了新模型！检索结果乱！

# ✅ 正确：应用启动时全局设置一次，锁定模型
# config.py
from llama_index.core import Settings
from llama_index.embeddings.openai import OpenAIEmbedding

Settings.embed_model = OpenAIEmbedding(model="text-embedding-3-small")

# 所有地方 import config 后使用，不要在各处单独指定 embed_model
```

### 坑 3：chunk_size 过大导致检索质量差

```python
# ❌ 错误：chunk_size 太大，每个 chunk 包含太多不相关信息
splitter = SentenceSplitter(chunk_size=4096)  # 太大！

# ✅ 正确：使用合理的 chunk_size，并配合 Rerank 提升精度
splitter = SentenceSplitter(
    chunk_size=512,     # 检索用小块
    chunk_overlap=50,   # 适当重叠保持上下文
)

# 如果需要更大的上下文窗口，用 SentenceWindowNodeParser
from llama_index.core.node_parser import SentenceWindowNodeParser
from llama_index.core.postprocessor import MetadataReplacementPostProcessor

window_parser = SentenceWindowNodeParser.from_defaults(window_size=3)
# 检索时用小块，生成时自动扩展为窗口文本
postprocessor = MetadataReplacementPostProcessor(target_metadata_key="window")
query_engine = index.as_query_engine(node_postprocessors=[postprocessor])
```

### 坑 4：similarity_top_k 设置不当

```python
# ❌ 错误：top_k 太小，漏掉相关文档
query_engine = index.as_query_engine(similarity_top_k=2)  # 太少，很可能漏掉

# ❌ 错误：top_k 太大，大量无关内容进入 LLM Context
query_engine = index.as_query_engine(similarity_top_k=50)  # 太多，Token 超限

# ✅ 正确：先大召回，再 Rerank 精筛
from llama_index.core.postprocessor import SentenceTransformerRerank

query_engine = index.as_query_engine(
    similarity_top_k=20,           # 向量检索先召回 20 个
    node_postprocessors=[
        SentenceTransformerRerank(
            model="BAAI/bge-reranker-base",
            top_n=5,               # Rerank 精筛至 5 个
        )
    ],
)
```

### 坑 5：未处理 Document 元数据导致无法溯源

```python
# ❌ 错误：未注入文件来源，无法追踪答案来源
documents = SimpleDirectoryReader("./data").load_data()
# 默认元数据可能不包含可读的 source 信息

# ✅ 正确：注入明确的来源元数据
documents = SimpleDirectoryReader(
    "./data",
    file_metadata=lambda path: {
        "source": str(path),
        "file_name": Path(path).name,
    }
).load_data()

# 查询时获取来源
response = query_engine.query("产品定价是多少？")
for node in response.source_nodes:
    print(f"来源：{node.metadata.get('file_name')} | 相似度：{node.score:.3f}")
    print(f"内容：{node.get_content()[:100]}...")
```

### 坑 6：ServiceContext 旧 API 不兼容

```python
# ❌ 错误：v0.10 之前的 ServiceContext 在新版已弃用
from llama_index import ServiceContext  # ImportError 或 DeprecationWarning

service_context = ServiceContext.from_defaults(
    llm=OpenAI(model="gpt-4"),
    embed_model=OpenAIEmbedding(),
)
index = VectorStoreIndex(nodes, service_context=service_context)

# ✅ 正确：使用 v0.10+ 的 Settings
from llama_index.core import Settings

Settings.llm = OpenAI(model="gpt-4o")
Settings.embed_model = OpenAIEmbedding(model="text-embedding-3-small")

index = VectorStoreIndex(nodes)  # 自动使用 Settings 配置
```

### 坑 7：RouterQueryEngine 路由描述不清晰

```python
# ❌ 错误：description 太简单，LLM 无法准确路由
tools = [
    QueryEngineTool(
        query_engine=product_engine,
        metadata=ToolMetadata(name="product", description="产品信息")  # 太模糊！
    ),
    QueryEngineTool(
        query_engine=faq_engine,
        metadata=ToolMetadata(name="faq", description="FAQ")          # 太模糊！
    ),
]

# ✅ 正确：description 要包含明确的使用场景和关键词
tools = [
    QueryEngineTool(
        query_engine=product_engine,
        metadata=ToolMetadata(
            name="product_docs",
            description=(
                "搜索产品文档，适用于：产品功能介绍、技术规格、版本更新、"
                "功能对比、产品路线图等问题。关键词：功能、特性、规格、版本。"
            )
        )
    ),
    QueryEngineTool(
        query_engine=faq_engine,
        metadata=ToolMetadata(
            name="faq_docs",
            description=(
                "搜索常见问题与解答，适用于：操作问题、故障排除、错误处理、"
                "账号问题、支付问题等。关键词：如何、怎么、为什么、错误、失败。"
            )
        )
    ),
]
```

### 坑 8：异步环境中使用同步 API

```python
# ❌ 错误：在 async 函数中调用同步 query，阻塞事件循环
async def handle_request(question: str):
    response = query_engine.query(question)  # 同步调用！阻塞 event loop
    return str(response)

# ✅ 正确：使用异步 API
async def handle_request(question: str):
    response = await query_engine.aquery(question)  # 异步调用
    return str(response)

# ✅ 如果必须在 async 中调用同步代码，用线程池
import asyncio
from concurrent.futures import ThreadPoolExecutor

executor = ThreadPoolExecutor(max_workers=4)

async def handle_request(question: str):
    loop = asyncio.get_event_loop()
    response = await loop.run_in_executor(
        executor,
        query_engine.query,
        question,
    )
    return str(response)
```

---

## 十三、速查表

### 13.1 常用 API 速查

```
+------------------------------------------------------------------+
|                    LlamaIndex 常用 API 速查                        |
+------------------------------------------------------------------+
|                                                                   |
|  文档加载                                                         |
|  SimpleDirectoryReader("./data").load_data()                      |
|  Document(text="...", metadata={...})                             |
|                                                                   |
|  分块                                                             |
|  SentenceSplitter(chunk_size=512, chunk_overlap=50)               |
|  splitter.get_nodes_from_documents(documents)                     |
|                                                                   |
|  全局配置                                                         |
|  Settings.llm = OpenAI(model="gpt-4o")                           |
|  Settings.embed_model = OpenAIEmbedding(model="text-emb-3-small") |
|  Settings.chunk_size = 512                                        |
|                                                                   |
|  索引构建                                                         |
|  VectorStoreIndex(nodes, show_progress=True)                      |
|  VectorStoreIndex.from_documents(docs)                            |
|                                                                   |
|  持久化                                                           |
|  index.storage_context.persist("./storage")                      |
|  load_index_from_storage(StorageContext.from_defaults("./store")) |
|                                                                   |
|  查询                                                             |
|  index.as_query_engine(similarity_top_k=10)                      |
|  index.as_retriever(similarity_top_k=10)                         |
|  query_engine.query("问题")                                       |
|  await query_engine.aquery("问题")    # 异步                      |
|                                                                   |
|  增量更新                                                         |
|  index.refresh_ref_docs(new_documents)                            |
|  index.insert_nodes([new_node])                                   |
|  index.delete_ref_doc("doc_id")                                   |
|                                                                   |
+------------------------------------------------------------------+
```

### 13.2 分块策略选型速查

| 场景 | 推荐分块器 | 推荐参数 |
|------|-----------|---------|
| 通用文本问答 | `SentenceSplitter` | `chunk_size=512, overlap=50` |
| Markdown 文档 | `MarkdownNodeParser` | 默认参数 |
| 代码库问答 | `CodeSplitter` | `chunk_lines=40` |
| 长文档摘要 | `SentenceSplitter` | `chunk_size=1024, overlap=100` |
| 高精度语义检索 | `SemanticSplitterNodeParser` | `breakpoint_percentile=95` |
| 上下文扩展 | `SentenceWindowNodeParser` | `window_size=3` |
| 多粒度检索 | `HierarchicalNodeParser` | `chunk_sizes=[2048,512,128]` |

### 13.3 索引选型速查

| 需求 | 推荐索引 | 说明 |
|------|---------|------|
| 语义相似查询 | `VectorStoreIndex` | 最常用，开箱即用 |
| 全文摘要 | `SummaryIndex` | tree_summarize 模式 |
| 精确关键词 | `KeywordTableIndex` | 不需要 Embedding |
| 实体关系查询 | `KnowledgeGraphIndex` | 多跳推理 |
| 混合查询 | `VectorStoreIndex` + `BM25Retriever` | QueryFusionRetriever 融合 |

### 13.4 Postprocessor 选型速查

| 用途 | Postprocessor | 说明 |
|------|--------------|------|
| 过滤低分节点 | `SimilarityPostprocessor` | `similarity_cutoff=0.7` |
| 精排提升精度 | `SentenceTransformerRerank` | BGE Reranker 模型 |
| LLM 重排序 | `LLMRerank` | 精度高，成本高 |
| 元数据替换 | `MetadataReplacementPostProcessor` | 配合 SentenceWindow 使用 |
| 关键词过滤 | `KeywordNodePostprocessor` | 必须包含/排除某关键词 |

### 13.5 完整 RAG Pipeline 模板

```python
import os
from datetime import datetime
from pathlib import Path

from llama_index.core import (
    Settings,
    SimpleDirectoryReader,
    StorageContext,
    VectorStoreIndex,
    load_index_from_storage,
)
from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.postprocessor import (
    SentenceTransformerRerank,
    SimilarityPostprocessor,
)
from llama_index.embeddings.openai import OpenAIEmbedding
from llama_index.llms.openai import OpenAI

# =========== 全局配置 ===========
Settings.llm = OpenAI(model="gpt-4o", temperature=0.1)
Settings.embed_model = OpenAIEmbedding(
    model="text-embedding-3-small",
    embed_batch_size=100,
)
Settings.chunk_size = 512
Settings.chunk_overlap = 50

PERSIST_DIR = "./storage"


def build_or_load_index() -> VectorStoreIndex:
    """构建或加载索引"""
    if os.path.exists(PERSIST_DIR):
        storage_context = StorageContext.from_defaults(persist_dir=PERSIST_DIR)
        return load_index_from_storage(storage_context)

    # 加载文档
    documents = SimpleDirectoryReader(
        "./data",
        required_exts=[".pdf", ".md", ".txt"],
        filename_as_id=True,
        file_metadata=lambda path: {
            "source": str(path),
            "file_name": Path(path).name,
            "created_at": datetime.now().isoformat(),
        },
    ).load_data()

    # 分块
    splitter = SentenceSplitter(chunk_size=512, chunk_overlap=50)
    nodes = splitter.get_nodes_from_documents(documents)

    # 注入业务元数据
    for node in nodes:
        node.excluded_embed_metadata_keys = ["created_at"]
        node.excluded_llm_metadata_keys = ["created_at"]

    # 构建索引并持久化
    index = VectorStoreIndex(nodes, show_progress=True)
    index.storage_context.persist(persist_dir=PERSIST_DIR)
    return index


def get_query_engine(index: VectorStoreIndex):
    """获取生产级 QueryEngine"""
    return index.as_query_engine(
        similarity_top_k=15,
        node_postprocessors=[
            SimilarityPostprocessor(similarity_cutoff=0.65),
            SentenceTransformerRerank(
                model="BAAI/bge-reranker-base",
                top_n=5,
            ),
        ],
        response_mode="compact",
        verbose=False,
    )


# 使用示例
if __name__ == "__main__":
    index = build_or_load_index()
    engine = get_query_engine(index)
    response = engine.query("你的问题")
    print(response.response)
    for node in response.source_nodes:
        print(f"  来源: {node.metadata.get('file_name')} ({node.score:.3f})")
```

---

## 参考资源

- [LlamaIndex 官方文档](https://docs.llamaindex.ai/)
- [LlamaIndex GitHub](https://github.com/run-llama/llama_index)
- [LlamaIndex Examples](https://github.com/run-llama/llama_index/tree/main/docs/docs/examples)
- [LlamaIndex Integrations](https://llamahub.ai/)
- 相关文档：`RAG最佳实践与踩坑指南_DOC.md`
- 相关文档：`LangChain最佳实践与踩坑指南_DOC.md`
- 相关文档：`Agent开发最佳实践与踩坑指南_DOC.md`
