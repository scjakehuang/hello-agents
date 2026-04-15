# RAG 最佳实践与踩坑指南

## 文档信息

- 作者：徐凯旋
- 邮箱：azouever@gmail.com
- 更新时间：2026-04-14
- 标签：RAG, 向量检索, 知识库, LangChain, LlamaIndex

---

## 目录

1. [概述](#一概述)
2. [核心概念](#二核心概念)
3. [架构设计](#三架构设计)
4. [数据处理层最佳实践](#四数据处理层最佳实践)
5. [索引层最佳实践](#五索引层最佳实践)
6. [检索层最佳实践](#六检索层最佳实践)
7. [生成层最佳实践](#七生成层最佳实践)
8. [进阶技术](#八进阶技术)
9. [常见踩坑与解决方案](#九常见踩坑与解决方案)
10. [生产环境注意事项](#十生产环境注意事项)
11. [参考资源](#十一参考资源)

---

## 一、概述

### 1.1 什么是 RAG

RAG（Retrieval-Augmented Generation，检索增强生成）是一种结合信息检索和文本生成的技术架构。它通过检索外部知识库中的相关信息，增强 LLM 的生成能力，解决以下问题：

- **知识时效性**：LLM 训练数据有时效性，RAG 可以获取最新信息
- **领域专业性**：LLM 通用知识有限，RAG 可以注入专业知识
- **幻觉问题**：LLM 容易生成错误信息，RAG 提供事实依据
- **数据隐私**：敏感数据不需要放入模型训练，通过检索访问

### 1.2 RAG vs 微调

```
+------------------------------------------------------------------+
|                    RAG vs 微调 对比                                |
+------------------------------------------------------------------+
|                                                                   |
|  维度            RAG                    微调                      |
|  ---------------------------------------------------------------- |
|  知识更新        实时更新               需要重新训练              |
|  成本            低（检索开销）          高（训练成本）            |
|  可解释性        高（可追溯来源）        低（黑盒）                |
|  数据隐私        数据不出模型            数据进入模型              |
|  适用场景        知识密集型问答          特定任务风格迁移          |
|  实时性          高                     低                        |
|  专业深度        取决于知识库            取决于训练数据            |
|                                                                   |
|  +--------------------------------------------------------+       |
|  | 最佳实践：RAG + 微调 结合使用                           |       |
|  | - RAG：负责知识检索和事实查询                           |       |
|  | - 微调：负责领域语言风格和任务格式                       |       |
|  +--------------------------------------------------------+       |
|                                                                   |
+------------------------------------------------------------------+
```

### 1.3 RAG 应用场景

| 场景 | 说明 | 典型用例 |
|------|------|----------|
| **企业知识库** | 内部文档问答 | 产品手册、规章制度、技术文档 |
| **智能客服** | 自动回复用户问题 | 售后支持、常见问题解答 |
| **法律咨询** | 法律条文检索 | 合同审查、法律条文查询 |
| **医疗问答** | 医学知识检索 | 症状分析、用药指导 |
| **金融分析** | 研报、公告检索 | 投资研究、风险分析 |
| **代码助手** | 代码库检索 | API 查询、代码示例 |

---

## 二、核心概念

### 2.1 关键术语

| 术语 | 英文 | 说明 |
|------|------|------|
| **文档** | Document | 原始输入的文本单元 |
| **分块** | Chunk | 文档切分后的最小检索单元 |
| **向量** | Embedding | 文本的数值化表示 |
| **向量数据库** | Vector Store | 存储向量和文档的数据库 |
| **检索器** | Retriever | 从向量库中检索相关文档的组件 |
| **重排序** | Rerank | 对检索结果进行二次排序 |
| **召回** | Recall | 检索阶段获取候选文档 |
| **精确率** | Precision | 检索结果中相关文档的比例 |

### 2.2 核心流程

```
+------------------------------------------------------------------+
|                    RAG 核心流程                                    |
+------------------------------------------------------------------+
|                                                                   |
|  离线流程（构建知识库）                                            |
|  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐        |
|  │ 文档加载 │ -> │ 文档解析 │ -> │ 文档分块 │ -> │ 向量化  │        |
|  └─────────┘    └─────────┘    └─────────┘    └─────────┘        |
|                                                     │             |
|                                                     v             |
|                                              ┌─────────┐         |
|                                              │ 向量存储 │         |
|                                              └─────────┘         |
|                                                                   |
|  在线流程（查询回答）                                              |
|  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐        |
|  │ 用户查询 │ -> │ 查询向量化│ -> │ 相似检索 │ -> │ 重排序  │        |
|  └─────────┘    └─────────┘    └─────────┘    └─────────┘        |
|                                                     │             |
|                                                     v             |
|  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐        |
|  │ 最终回答 │ <- │ LLM 生成 │ <- │ 构建提示 │ <- │ 上下文  │        |
|  └─────────┘    └─────────┘    └─────────┘    └─────────┘        |
|                                                                   |
+------------------------------------------------------------------+
```

### 2.3 关键指标

```python
# RAG 系统关键指标定义

class RAGMetrics:
    """RAG 系统评估指标"""

    # 检索质量指标
    retrieval_metrics = {
        "recall@k": "前 K 个结果中相关文档的召回率",
        "precision@k": "前 K 个结果中相关文档的比例",
        "mrr": "Mean Reciprocal Rank，第一个相关文档的位置倒数",
        "ndcg": "Normalized Discounted Cumulative Gain，考虑排序的指标",
        "hit_rate": "是否检索到至少一个相关文档",
    }

    # 生成质量指标
    generation_metrics = {
        "faithfulness": "回答是否忠实于检索内容",
        "answer_relevance": "回答是否与问题相关",
        "context_precision": "检索内容是否精确相关",
        "context_recall": "是否检索到所有相关信息",
    }

    # 系统性能指标
    performance_metrics = {
        "latency_p50": "50% 请求的响应延迟",
        "latency_p99": "99% 请求的响应延迟",
        "throughput": "每秒处理的查询数",
        "token_efficiency": "有效信息占 Token 的比例",
    }
```

---

## 三、架构设计

### 3.1 生产级 RAG 架构

```
+------------------------------------------------------------------+
|                    生产级 RAG 架构                                 |
+------------------------------------------------------------------+
|                                                                   |
|  数据处理层                                                       |
|  ├── 文档加载器 (Multi-format Loader)                             |
|  │   ├── PDF Loader (pdfplumber, PyMuPDF)                         |
|  │   ├── Word Loader (python-docx)                                |
|  │   ├── HTML Loader (BeautifulSoup)                              |
|  │   ├── Markdown Loader                                          |
|  │   └── Database Loader (SQL, MongoDB)                           |
|  ├── 文档解析器 (Parser)                                          |
|  │   ├── 表格提取                                                 |
|  │   ├── 图片 OCR                                                 |
|  │   ├── 公式识别                                                 |
|  │   └── 结构化提取                                               |
|  ├── 文档清洗 (Cleaner)                                           |
|  │   ├── 去除噪声（页眉页脚、水印）                                |
|  │   ├── 格式统一                                                 |
|  │   └── 编码转换                                                 |
|  └── 文档分块 (Chunker)                                           |
|      ├── 固定长度分块                                             |
|      ├── 语义分块                                                 |
|      ├── 递归分块                                                 |
|      └── 自适应分块                                               |
|                                                                   |
|  索引层                                                          |
|  ├── 向量索引 (Dense Retrieval)                                   |
|  │   ├── Milvus                                                   |
|  │   ├── Pinecone                                                 |
|  │   ├── Weaviate                                                 |
|  │   └── Elasticsearch (dense)                                    |
|  ├── 关键词索引 (Sparse Retrieval)                                |
|  │   ├── BM25                                                     |
|  │   ├── TF-IDF                                                   |
|  │   └── Elasticsearch (sparse)                                   |
|  └── 混合索引 (Hybrid Index)                                      |
|      ├── 向量 + 关键词                                            |
|      └── 多模态索引                                               |
|                                                                   |
|  检索层                                                          |
|  ├── 多路召回 (Multi-path Retrieval)                              |
|  │   ├── 向量召回                                                 |
|  │   ├── 关键词召回                                               |
|  │   └── 知识图谱召回                                             |
|  ├── 重排序 (Rerank)                                              |
|  │   ├── Cross-Encoder Reranker                                   |
|  │   ├── LLM Reranker                                             |
|  │   └── 学习排序 (LTR)                                           |
|  └── 结果过滤 (Filtering)                                         |
|      ├── 元数据过滤                                               |
|      ├── 相似度阈值                                               |
|      └── 去重                                                     |
|                                                                   |
|  生成层                                                          |
|  ├── Context 构建                                                 |
|  │   ├── Token 预算管理                                           |
|  │   ├── 信息去重                                                 |
|  │   └── 格式优化                                                 |
|  ├── Prompt 组装                                                  |
|  │   ├── System Prompt                                            |
|  │   ├── Few-shot 示例                                            |
|  │   └── 用户问题                                                 |
|  └── LLM 生成                                                     |
|      ├── 流式输出                                                 |
|      ├── 多模型路由                                               |
|      └── 结果后处理                                               |
|                                                                   |
+------------------------------------------------------------------+
```

### 3.2 模块职责划分

```python
# RAG 系统模块设计

from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from dataclasses import dataclass

@dataclass
class Document:
    """文档数据结构"""
    id: str
    content: str
    metadata: Dict[str, Any]
    embedding: Optional[List[float]] = None

@dataclass
class Chunk:
    """分块数据结构"""
    id: str
    document_id: str
    content: str
    metadata: Dict[str, Any]
    embedding: Optional[List[float]] = None
    parent_chunk_id: Optional[str] = None

@dataclass
class RetrievalResult:
    """检索结果"""
    chunks: List[Chunk]
    scores: List[float]
    query: str
    metadata: Dict[str, Any]

# ============ 数据处理层 ============

class DocumentLoader(ABC):
    """文档加载器基类"""

    @abstractmethod
    def load(self, source: str) -> List[Document]:
        """加载文档"""
        pass

class DocumentParser(ABC):
    """文档解析器基类"""

    @abstractmethod
    def parse(self, document: Document) -> Document:
        """解析文档，提取结构化信息"""
        pass

class Chunker(ABC):
    """分块器基类"""

    @abstractmethod
    def chunk(self, document: Document) -> List[Chunk]:
        """将文档分块"""
        pass

# ============ 索引层 ============

class EmbeddingModel(ABC):
    """向量化模型基类"""

    @abstractmethod
    def embed(self, texts: List[str]) -> List[List[float]]:
        """将文本转换为向量"""
        pass

class VectorStore(ABC):
    """向量存储基类"""

    @abstractmethod
    def add(self, chunks: List[Chunk]) -> None:
        """添加向量"""
        pass

    @abstractmethod
    def search(self, query_vector: List[float], k: int) -> List[Chunk]:
        """搜索相似向量"""
        pass

# ============ 检索层 ============

class Retriever(ABC):
    """检索器基类"""

    @abstractmethod
    def retrieve(self, query: str, k: int) -> RetrievalResult:
        """检索相关文档"""
        pass

class Reranker(ABC):
    """重排序器基类"""

    @abstractmethod
    def rerank(self, query: str, chunks: List[Chunk]) -> List[Chunk]:
        """对检索结果重排序"""
        pass

# ============ 生成层 ============

class ContextBuilder:
    """上下文构建器"""

    def build(self, result: RetrievalResult, max_tokens: int) -> str:
        """构建上下文"""
        pass

class RAGPipeline:
    """RAG 流水线"""

    def __init__(
        self,
        retriever: Retriever,
        reranker: Optional[Reranker],
        context_builder: ContextBuilder,
        llm: Any
    ):
        self.retriever = retriever
        self.reranker = reranker
        self.context_builder = context_builder
        self.llm = llm

    def query(self, question: str) -> str:
        """执行 RAG 查询"""
        # 1. 检索
        result = self.retriever.retrieve(question, k=10)

        # 2. 重排序
        if self.reranker:
            result.chunks = self.reranker.rerank(question, result.chunks)

        # 3. 构建上下文
        context = self.context_builder.build(result, max_tokens=3000)

        # 4. 生成回答
        prompt = self._build_prompt(question, context)
        answer = self.llm.invoke(prompt)

        return answer
```

---

## 四、数据处理层最佳实践

### 4.1 文档加载

#### 多格式文档加载

```python
from langchain_community.document_loaders import (
    PyPDFLoader,
    Docx2txtLoader,
    UnstructuredMarkdownLoader,
    UnstructuredHTMLLoader,
    JSONLoader,
    CSVLoader,
    TextLoader
)
from typing import List, Dict
import os

class MultiFormatLoader:
    """多格式文档加载器"""

    LOADERS = {
        '.pdf': PyPDFLoader,
        '.docx': Docx2txtLoader,
        '.doc': Docx2txtLoader,
        '.md': UnstructuredMarkdownLoader,
        '.html': UnstructuredHTMLLoader,
        '.htm': UnstructuredHTMLLoader,
        '.json': JSONLoader,
        '.csv': CSVLoader,
        '.txt': TextLoader,
    }

    def __init__(self, encoding: str = 'utf-8'):
        self.encoding = encoding

    def load(self, file_path: str) -> List[Dict]:
        """根据文件扩展名自动选择加载器"""
        ext = os.path.splitext(file_path)[1].lower()

        if ext not in self.LOADERS:
            raise ValueError(f"Unsupported file format: {ext}")

        loader_class = self.LOADERS[ext]

        # 特殊处理 JSON
        if ext == '.json':
            loader = loader_class(
                file_path,
                jq_schema='.',
                text_content=False
            )
        else:
            loader = loader_class(file_path)

        documents = loader.load()

        # 添加元数据
        for doc in documents:
            doc.metadata['source'] = file_path
            doc.metadata['file_type'] = ext
            doc.metadata['loaded_at'] = datetime.now().isoformat()

        return documents

    def load_directory(
        self,
        directory: str,
        recursive: bool = True,
        exclude_patterns: List[str] = None
    ) -> List[Dict]:
        """加载目录下所有文档"""
        import glob

        documents = []
        exclude_patterns = exclude_patterns or ['*.tmp', '*.bak', '.*']

        for ext in self.LOADERS.keys():
            pattern = f"{'**/' if recursive else ''}*{ext}"
            files = glob.glob(os.path.join(directory, pattern), recursive=recursive)

            for file_path in files:
                # 检查排除模式
                if any(fnmatch.fnmatch(file_path, p) for p in exclude_patterns):
                    continue

                try:
                    docs = self.load(file_path)
                    documents.extend(docs)
                except Exception as e:
                    print(f"Error loading {file_path}: {e}")

        return documents
```

#### PDF 表格提取优化

```python
import pdfplumber
from typing import List, Dict
import pandas as pd

class PDFTableExtractor:
    """PDF 表格提取器"""

    def __init__(self, pdf_path: str):
        self.pdf_path = pdf_path

    def extract_tables(self) -> List[Dict]:
        """提取所有表格"""
        tables = []

        with pdfplumber.open(self.pdf_path) as pdf:
            for page_num, page in enumerate(pdf.pages):
                page_tables = page.extract_tables()

                for table_idx, table in enumerate(page_tables):
                    if not table or len(table) < 2:
                        continue

                    # 转换为 DataFrame
                    df = pd.DataFrame(table[1:], columns=table[0])

                    # 清理数据
                    df = df.dropna(how='all')
                    df = df.fillna('')

                    tables.append({
                        'page': page_num + 1,
                        'table_index': table_idx,
                        'data': df.to_dict('records'),
                        'markdown': df.to_markdown(index=False),
                        'content': self._table_to_text(df)
                    })

        return tables

    def _table_to_text(self, df: pd.DataFrame) -> str:
        """将表格转换为文本描述"""
        lines = []

        # 表头
        headers = df.columns.tolist()
        lines.append(f"表格包含字段：{', '.join(headers)}")

        # 数据行数
        lines.append(f"共 {len(df)} 条记录")

        # 数据预览（前5行）
        if len(df) > 0:
            lines.append("数据预览：")
            for idx, row in df.head(5).iterrows():
                row_text = " | ".join([f"{k}: {v}" for k, v in row.items()])
                lines.append(f"  - {row_text}")

        return "\n".join(lines)

    def extract_with_context(self) -> List[Dict]:
        """提取表格并保留上下文"""
        results = []

        with pdfplumber.open(self.pdf_path) as pdf:
            for page_num, page in enumerate(pdf.pages):
                # 提取页面文本
                text = page.extract_text() or ""

                # 提取表格
                tables = page.extract_tables()

                for table in tables:
                    if not table or len(table) < 2:
                        continue

                    df = pd.DataFrame(table[1:], columns=table[0])

                    results.append({
                        'page': page_num + 1,
                        'table_data': df.to_dict('records'),
                        'table_text': self._table_to_text(df),
                        'page_context': text[:500],  # 页面上下文
                    })

        return results
```

### 4.2 文档分块策略

#### 分块策略对比

```
+------------------------------------------------------------------+
|                    文档分块策略对比                                |
+------------------------------------------------------------------+
|                                                                   |
|  策略             优点              缺点              适用场景     |
|  ---------------------------------------------------------------- |
|  固定长度         简单高效          可能截断语义       通用文档     |
|  递归分块         保留语义结构      参数调优复杂       结构化文档   |
|  语义分块         语义完整          计算开销大         长文档       |
|  滑动窗口         上下文连贯        冗余多             需要上下文   |
|  父子分块         精确+完整         实现复杂           大文档检索   |
|  自适应分块       智能调整          需要规则定义       混合文档     |
|                                                                   |
+------------------------------------------------------------------+
```

#### 推荐的分块配置

```python
from langchain.text_splitter import (
    RecursiveCharacterTextSplitter,
    CharacterTextSplitter,
    MarkdownHeaderTextSplitter,
    HTMLHeaderTextSplitter,
    PythonCodeTextSplitter,
)
from typing import List, Dict, Optional
import re

class SmartChunker:
    """智能分块器"""

    def __init__(self):
        # 默认配置
        self.default_config = {
            'chunk_size': 500,
            'chunk_overlap': 50,
            'keep_separator': True,
        }

        # 不同文档类型的配置
        self.type_configs = {
            'technical': {  # 技术文档
                'chunk_size': 600,
                'chunk_overlap': 100,
                'separators': ["\n## ", "\n### ", "\n#### ", "\n\n", "\n", " ", ""]
            },
            'legal': {  # 法律文档
                'chunk_size': 1000,
                'chunk_overlap': 200,
                'separators': ["\n第.*条", "\n\n", "\n", " ", ""]
            },
            'faq': {  # FAQ 文档
                'chunk_size': 300,
                'chunk_overlap': 30,
                'separators': ["\n\nQ:", "\n\n", "\n", " ", ""]
            },
            'code': {  # 代码文档
                'chunk_size': 800,
                'chunk_overlap': 50,
                'separators': ["\nclass ", "\ndef ", "\n\n", "\n", " ", ""]
            },
        }

    def chunk(
        self,
        documents: List[Dict],
        doc_type: str = 'default'
    ) -> List[Dict]:
        """智能分块"""
        config = self.type_configs.get(doc_type, self.default_config)

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=config['chunk_size'],
            chunk_overlap=config['chunk_overlap'],
            separators=config.get('separators', ["\n\n", "\n", " ", ""]),
            length_function=len,
            keep_separator=config.get('keep_separator', True),
        )

        chunks = []
        for doc in documents:
            doc_chunks = splitter.split_documents([doc])

            for i, chunk in enumerate(doc_chunks):
                chunks.append({
                    'id': f"{doc.metadata.get('source', 'unknown')}_{i}",
                    'content': chunk.page_content,
                    'metadata': {
                        **doc.metadata,
                        'chunk_index': i,
                        'total_chunks': len(doc_chunks),
                        'chunk_size': len(chunk.page_content),
                        'doc_type': doc_type,
                    }
                })

        return chunks

    def chunk_markdown_with_headers(self, documents: List[Dict]) -> List[Dict]:
        """Markdown 按标题层级分块"""
        headers_to_split_on = [
            ("#", "header_1"),
            ("##", "header_2"),
            ("###", "header_3"),
        ]

        markdown_splitter = MarkdownHeaderTextSplitter(
            headers_to_split_on=headers_to_split_on,
            strip_headers=False
        )

        chunks = []
        for doc in documents:
            # 先按标题分割
            header_chunks = markdown_splitter.split_text(doc.page_content)

            # 再对每个块进行细粒度分割
            text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=500,
                chunk_overlap=50
            )

            for chunk in text_splitter.split_documents(header_chunks):
                chunks.append({
                    'id': f"{doc.metadata.get('source', 'unknown')}_{len(chunks)}",
                    'content': chunk.page_content,
                    'metadata': {
                        **doc.metadata,
                        **chunk.metadata,  # 包含 header 信息
                    }
                })

        return chunks

    def chunk_with_parent(self, documents: List[Dict]) -> Dict[str, List[Dict]]:
        """父子分块：小块用于检索，大块用于生成"""
        parent_splitter = RecursiveCharacterTextSplitter(
            chunk_size=2000,
            chunk_overlap=200,
        )

        child_splitter = RecursiveCharacterTextSplitter(
            chunk_size=200,
            chunk_overlap=20,
        )

        parent_chunks = []
        child_chunks = []

        for doc in documents:
            # 大块（父）
            parents = parent_splitter.split_documents([doc])
            for i, parent in enumerate(parents):
                parent_id = f"{doc.metadata.get('source', 'unknown')}_parent_{i}"
                parent_chunks.append({
                    'id': parent_id,
                    'content': parent.page_content,
                    'metadata': {
                        **doc.metadata,
                        'chunk_type': 'parent',
                    }
                })

                # 小块（子）
                children = child_splitter.split_documents([parent])
                for j, child in enumerate(children):
                    child_chunks.append({
                        'id': f"{parent_id}_child_{j}",
                        'content': child.page_content,
                        'parent_id': parent_id,
                        'metadata': {
                            **doc.metadata,
                            'chunk_type': 'child',
                            'parent_id': parent_id,
                        }
                    })

        return {
            'parents': parent_chunks,
            'children': child_chunks
        }
```

#### 分块质量评估

```python
class ChunkQualityEvaluator:
    """分块质量评估器"""

    def evaluate(self, chunks: List[Dict]) -> Dict:
        """评估分块质量"""
        import numpy as np

        # 统计指标
        sizes = [len(c['content']) for c in chunks]

        metrics = {
            'total_chunks': len(chunks),
            'avg_size': np.mean(sizes),
            'std_size': np.std(sizes),
            'min_size': min(sizes),
            'max_size': max(sizes),
            'size_distribution': self._size_distribution(sizes),
            'truncated_count': self._count_truncated(chunks),
            'incomplete_count': self._count_incomplete(chunks),
        }

        # 评分
        score = self._calculate_score(metrics)
        metrics['quality_score'] = score

        return metrics

    def _size_distribution(self, sizes: List[int]) -> Dict:
        """大小分布"""
        import numpy as np

        percentiles = [10, 25, 50, 75, 90]
        return {f'p{p}': np.percentile(sizes, p) for p in percentiles}

    def _count_truncated(self, chunks: List[Dict]) -> int:
        """统计被截断的块数"""
        truncated_endings = ['...', '等', '例如', '如：']
        count = 0

        for chunk in chunks:
            content = chunk['content'].strip()
            # 检查是否在句子中间截断
            if content and not content[-1] in '。！？.!?"\'）)》】':
                count += 1

        return count

    def _count_incomplete(self, chunks: List[Dict]) -> int:
        """统计不完整的块数"""
        incomplete_starters = ['和', '或', '但是', '然而', '因此']
        count = 0

        for chunk in chunks:
            content = chunk['content'].strip()
            if content and content[0] in incomplete_starters:
                count += 1

        return count

    def _calculate_score(self, metrics: Dict) -> float:
        """计算质量分数（0-100）"""
        score = 100

        # 惩罚大块过多
        if metrics['max_size'] > 2000:
            score -= 10

        # 惩罚小块过多
        if metrics['min_size'] < 50:
            score -= 10

        # 惩罚大小差异过大
        if metrics['std_size'] > metrics['avg_size'] * 0.5:
            score -= 15

        # 惩罚截断过多
        truncated_ratio = metrics['truncated_count'] / max(metrics['total_chunks'], 1)
        score -= truncated_ratio * 20

        return max(0, score)
```

---

## 五、索引层最佳实践

### 5.1 Embedding 模型选择

#### 中文场景推荐

```python
from langchain.embeddings import HuggingFaceEmbeddings, OpenAIEmbeddings
from typing import List
import os

class EmbeddingModelSelector:
    """Embedding 模型选择器"""

    # 模型对比
    MODELS = {
        # OpenAI 系列
        'text-embedding-3-small': {
            'provider': 'openai',
            'dimension': 1536,
            'max_tokens': 8191,
            'cost_per_1k': 0.00002,  # $
            'strength': '性价比高，英文效果好',
            'weakness': '中文效果一般',
        },
        'text-embedding-3-large': {
            'provider': 'openai',
            'dimension': 3072,
            'max_tokens': 8191,
            'cost_per_1k': 0.00013,
            'strength': '效果最好',
            'weakness': '成本高，维度大',
        },

        # 中文开源模型
        'bge-large-zh-v1.5': {
            'provider': 'huggingface',
            'dimension': 1024,
            'max_tokens': 512,
            'cost_per_1k': 0,  # 自部署免费
            'strength': '中文效果最好，免费',
            'weakness': '需要自部署，max_tokens 较小',
        },
        'bge-m3': {
            'provider': 'huggingface',
            'dimension': 1024,
            'max_tokens': 8192,
            'cost_per_1k': 0,
            'strength': '多语言，长文本支持好',
            'weakness': '模型较大',
        },
        'm3e-base': {
            'provider': 'huggingface',
            'dimension': 768,
            'max_tokens': 512,
            'cost_per_1k': 0,
            'strength': '轻量级，速度快',
            'weakness': '效果略逊于 BGE',
        },

        # 多语言模型
        'multilingual-e5-large': {
            'provider': 'huggingface',
            'dimension': 1024,
            'max_tokens': 512,
            'cost_per_1k': 0,
            'strength': '多语言支持好',
            'weakness': '中文专精不如 BGE',
        },
    }

    def __init__(self, model_name: str = 'bge-large-zh-v1.5', **kwargs):
        self.model_name = model_name
        self.model_info = self.MODELS.get(model_name, {})
        self.model = self._load_model(**kwargs)

    def _load_model(self, **kwargs):
        """加载模型"""
        if self.model_info.get('provider') == 'openai':
            return OpenAIEmbeddings(
                model=self.model_name,
                **kwargs
            )
        else:
            # HuggingFace 本地模型
            model_kwargs = kwargs.get('model_kwargs', {})
            model_kwargs.setdefault('device', 'cuda' if self._has_cuda() else 'cpu')

            encode_kwargs = kwargs.get('encode_kwargs', {})
            encode_kwargs.setdefault('normalize_embeddings', True)  # 重要：归一化

            return HuggingFaceEmbeddings(
                model_name=self._get_model_path(self.model_name),
                model_kwargs=model_kwargs,
                encode_kwargs=encode_kwargs,
            )

    def _has_cuda(self) -> bool:
        """检查是否有 GPU"""
        try:
            import torch
            return torch.cuda.is_available()
        except:
            return False

    def _get_model_path(self, model_name: str) -> str:
        """获取模型路径"""
        # 支持本地缓存
        local_paths = {
            'bge-large-zh-v1.5': '/models/BAAI/bge-large-zh-v1.5',
            'bge-m3': '/models/BAAI/bge-m3',
        }

        if model_name in local_paths and os.path.exists(local_paths[model_name]):
            return local_paths[model_name]

        # 从 HuggingFace 下载
        hf_paths = {
            'bge-large-zh-v1.5': 'BAAI/bge-large-zh-v1.5',
            'bge-m3': 'BAAI/bge-m3',
            'm3e-base': 'moka-ai/m3e-base',
            'multilingual-e5-large': 'intfloat/multilingual-e5-large',
        }

        return hf_paths.get(model_name, model_name)

    def embed(self, texts: List[str]) -> List[List[float]]:
        """生成向量"""
        return self.model.embed_documents(texts)

    def embed_query(self, query: str) -> List[float]:
        """生成查询向量"""
        return self.model.embed_query(query)

    def get_dimension(self) -> int:
        """获取向量维度"""
        return self.model_info.get('dimension', 768)
```

#### 批量向量化优化

```python
from concurrent.futures import ThreadPoolExecutor
from typing import List, Generator
import tqdm

class BatchEmbedder:
    """批量向量化器"""

    def __init__(
        self,
        embedding_model,
        batch_size: int = 100,
        max_workers: int = 4,
        show_progress: bool = True
    ):
        self.embedding_model = embedding_model
        self.batch_size = batch_size
        self.max_workers = max_workers
        self.show_progress = show_progress

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """批量向量化文本"""
        # 分批处理
        batches = self._make_batches(texts)

        # 并行处理
        all_embeddings = []

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = []

            for batch in batches:
                future = executor.submit(
                    self.embedding_model.embed_documents,
                    batch
                )
                futures.append(future)

            # 收集结果
            iterator = futures
            if self.show_progress:
                iterator = tqdm.tqdm(futures, desc="Embedding")

            for future in iterator:
                embeddings = future.result()
                all_embeddings.extend(embeddings)

        return all_embeddings

    def embed_chunks(
        self,
        chunks: List[Dict],
        text_key: str = 'content'
    ) -> List[Dict]:
        """为 chunks 添加向量"""
        texts = [chunk[text_key] for chunk in chunks]
        embeddings = self.embed_texts(texts)

        for chunk, embedding in zip(chunks, embeddings):
            chunk['embedding'] = embedding

        return chunks

    def _make_batches(self, items: List) -> Generator:
        """分批"""
        for i in range(0, len(items), self.batch_size):
            yield items[i:i + self.batch_size]
```

### 5.2 向量数据库选型

```python
from langchain_community.vectorstores import (
    Chroma,
    FAISS,
    Milvus,
    Pinecone,
    Weaviate,
    Qdrant,
)
from typing import List, Dict, Optional

class VectorStoreSelector:
    """向量数据库选择器"""

    # 数据库对比
    STORES = {
        'chroma': {
            'type': 'local',
            'pros': ['轻量级', '易于开发调试', '支持持久化'],
            'cons': ['不支持分布式', '性能有限'],
            'best_for': '开发测试、小规模应用',
        },
        'faiss': {
            'type': 'local',
            'pros': ['性能极高', '支持 GPU', 'Meta 出品'],
            'cons': ['功能简单', '不支持实时更新'],
            'best_for': '大规模离线检索',
        },
        'milvus': {
            'type': 'distributed',
            'pros': ['高性能分布式', '功能丰富', '开源'],
            'cons': ['部署复杂', '资源占用大'],
            'best_for': '生产环境大规模应用',
        },
        'pinecone': {
            'type': 'cloud',
            'pros': ['全托管', '无需运维', '性能好'],
            'cons': ['成本高', '数据在国外'],
            'best_for': '快速上线、国际化项目',
        },
        'qdrant': {
            'type': 'distributed',
            'pros': ['Rust 实现', '性能好', '功能丰富'],
            'cons': ['生态较新'],
            'best_for': '追求高性能的生产环境',
        },
        'weaviate': {
            'type': 'distributed',
            'pros': ['语义搜索强', 'GraphQL 支持', '模块化'],
            'cons': ['学习曲线陡'],
            'best_for': '复杂语义搜索场景',
        },
    }

    @staticmethod
    def get_store(store_type: str, **kwargs):
        """获取向量存储实例"""
        if store_type == 'chroma':
            return Chroma(
                persist_directory=kwargs.get('persist_directory', './chroma_db'),
                embedding_function=kwargs.get('embedding_function'),
                collection_name=kwargs.get('collection_name', 'default'),
            )

        elif store_type == 'milvus':
            return Milvus(
                embedding_function=kwargs.get('embedding_function'),
                collection_name=kwargs.get('collection_name', 'default'),
                connection_args={
                    "host": kwargs.get('host', 'localhost'),
                    "port": kwargs.get('port', '19530'),
                },
            )

        elif store_type == 'qdrant':
            return Qdrant(
                embedding=kwargs.get('embedding_function'),
                url=kwargs.get('url', 'http://localhost:6333'),
                collection_name=kwargs.get('collection_name', 'default'),
            )

        else:
            raise ValueError(f"Unsupported store type: {store_type}")
```

---

## 六、检索层最佳实践

### 6.1 混合检索策略

```python
from langchain.retrievers import EnsembleRetriever
from langchain_community.retrievers import BM25Retriever
from langchain_community.vectorstores import Chroma
from typing import List, Dict

class HybridRetriever:
    """混合检索器"""

    def __init__(
        self,
        vector_store,
        documents: List[Dict],
        bm25_weight: float = 0.4,
        vector_weight: float = 0.6,
        k: int = 10
    ):
        self.vector_store = vector_store
        self.documents = documents
        self.bm25_weight = bm25_weight
        self.vector_weight = vector_weight
        self.k = k

        # 初始化 BM25 检索器
        self.bm25_retriever = BM25Retriever.from_documents(documents)
        self.bm25_retriever.k = k

        # 初始化向量检索器
        self.vector_retriever = vector_store.as_retriever(
            search_type="similarity",
            search_kwargs={"k": k}
        )

        # 组合检索器
        self.ensemble_retriever = EnsembleRetriever(
            retrievers=[self.vector_retriever, self.bm25_retriever],
            weights=[vector_weight, bm25_weight]
        )

    def retrieve(self, query: str) -> List[Dict]:
        """执行混合检索"""
        # 获取结果
        docs = self.ensemble_retriever.invoke(query)

        # 去重（BM25 和向量可能召回相同文档）
        seen = set()
        unique_docs = []
        for doc in docs:
            doc_id = doc.metadata.get('id', doc.page_content[:50])
            if doc_id not in seen:
                seen.add(doc_id)
                unique_docs.append(doc)

        return unique_docs[:self.k]

    def retrieve_with_scores(self, query: str) -> List[tuple]:
        """带分数的检索"""
        # 向量检索带分数
        vector_results = self.vector_store.similarity_search_with_score(
            query, k=self.k
        )

        # BM25 检索
        bm25_results = self.bm25_retriever.invoke(query)

        # 合并分数（需要标准化）
        combined = {}
        for doc, score in vector_results:
            doc_id = doc.metadata.get('id', doc.page_content[:50])
            # 向量分数转换为 0-1 范围（距离越小越相似）
            normalized_score = 1 / (1 + score)
            combined[doc_id] = {
                'doc': doc,
                'vector_score': normalized_score,
                'bm25_score': 0,
            }

        for doc in bm25_results:
            doc_id = doc.metadata.get('id', doc.page_content[:50])
            if doc_id in combined:
                combined[doc_id]['bm25_score'] = 1  # BM25 命中
            else:
                combined[doc_id] = {
                    'doc': doc,
                    'vector_score': 0,
                    'bm25_score': 1,
                }

        # 计算综合分数
        results = []
        for doc_id, scores in combined.items():
            final_score = (
                scores['vector_score'] * self.vector_weight +
                scores['bm25_score'] * self.bm25_weight
            )
            results.append((scores['doc'], final_score))

        # 按分数排序
        results.sort(key=lambda x: x[1], reverse=True)

        return results[:self.k]
```

### 6.2 Rerank 重排序

```python
from sentence_transformers import CrossEncoder
from typing import List, Dict, Tuple
import numpy as np

class Reranker:
    """重排序器"""

    def __init__(
        self,
        model_name: str = 'BAAI/bge-reranker-large',
        top_k: int = 5
    ):
        self.model = CrossEncoder(model_name)
        self.top_k = top_k

    def rerank(
        self,
        query: str,
        documents: List[Dict],
        return_scores: bool = False
    ) -> List:
        """重排序文档"""
        if not documents:
            return [] if not return_scores else ([], [])

        # 构建输入对
        pairs = [(query, doc['content']) for doc in documents]

        # 计算相关性分数
        scores = self.model.predict(pairs)

        # 排序
        sorted_indices = np.argsort(scores)[::-1]
        top_indices = sorted_indices[:self.top_k]

        if return_scores:
            return (
                [documents[i] for i in top_indices],
                [scores[i] for i in top_indices]
            )
        else:
            return [documents[i] for i in top_indices]

    def rerank_with_threshold(
        self,
        query: str,
        documents: List[Dict],
        threshold: float = 0.5
    ) -> List[Dict]:
        """带阈值的重排序"""
        reranked_docs, scores = self.rerank(query, documents, return_scores=True)

        # 过滤低分文档
        filtered_docs = [
            doc for doc, score in zip(reranked_docs, scores)
            if score >= threshold
        ]

        return filtered_docs


class LLMReranker:
    """基于 LLM 的重排序器"""

    def __init__(self, llm, top_k: int = 5):
        self.llm = llm
        self.top_k = top_k

    def rerank(self, query: str, documents: List[Dict]) -> List[Dict]:
        """使用 LLM 进行重排序"""
        # 构建文档列表
        doc_list = "\n".join([
            f"[{i}] {doc['content'][:200]}..."
            for i, doc in enumerate(documents)
        ])

        prompt = f"""请根据用户问题，对以下文档片段按相关性排序。

用户问题：{query}

文档片段：
{doc_list}

请输出最相关的 {self.top_k} 个文档的编号，格式如：0,2,5
只输出编号，不要有其他内容。"""

        # 调用 LLM
        response = self.llm.invoke(prompt)

        # 解析结果
        try:
            indices = [int(x.strip()) for x in response.split(',')]
            indices = [i for i in indices if 0 <= i < len(documents)]
            return [documents[i] for i in indices[:self.top_k]]
        except:
            # 解析失败，返回原始顺序
            return documents[:self.top_k]
```

### 6.3 元数据过滤

```python
from typing import List, Dict, Any, Callable

class MetadataFilter:
    """元数据过滤器"""

    def __init__(self):
        self.filters: List[Callable] = []

    def add_filter(
        self,
        field: str,
        operator: str,
        value: Any
    ) -> 'MetadataFilter':
        """添加过滤条件"""
        def filter_func(doc: Dict) -> bool:
            doc_value = doc.get('metadata', {}).get(field)

            if operator == 'eq':
                return doc_value == value
            elif operator == 'ne':
                return doc_value != value
            elif operator == 'gt':
                return doc_value is not None and doc_value > value
            elif operator == 'lt':
                return doc_value is not None and doc_value < value
            elif operator == 'gte':
                return doc_value is not None and doc_value >= value
            elif operator == 'lte':
                return doc_value is not None and doc_value <= value
            elif operator == 'in':
                return doc_value in value
            elif operator == 'contains':
                return doc_value is not None and value in doc_value
            else:
                return True

        self.filters.append(filter_func)
        return self

    def apply(self, documents: List[Dict]) -> List[Dict]:
        """应用所有过滤条件"""
        result = documents
        for filter_func in self.filters:
            result = [doc for doc in result if filter_func(doc)]
        return result

    def clear(self):
        """清除所有过滤条件"""
        self.filters = []


# 使用示例
def filter_documents_example(documents: List[Dict]):
    """元数据过滤示例"""
    filter = MetadataFilter()

    # 过滤条件：source 为 'product_doc' 且 version 大于 'v1.0'
    filtered = filter \
        .add_filter('source', 'eq', 'product_doc') \
        .add_filter('version', 'gte', 'v2.0') \
        .add_filter('category', 'in', ['api', 'guide', 'tutorial']) \
        .apply(documents)

    return filtered
```

---

## 七、生成层最佳实践

### 7.1 Context 构建

```python
from typing import List, Dict
import tiktoken

class ContextBuilder:
    """上下文构建器"""

    def __init__(
        self,
        model: str = 'gpt-4o',
        max_context_tokens: int = 3000,
        include_metadata: bool = True,
        include_scores: bool = False
    ):
        self.model = model
        self.max_context_tokens = max_context_tokens
        self.include_metadata = include_metadata
        self.include_scores = include_scores

        # 初始化 tokenizer
        try:
            self.tokenizer = tiktoken.encoding_for_model(model)
        except:
            self.tokenizer = tiktoken.get_encoding("cl100k_base")

    def build(
        self,
        documents: List[Dict],
        scores: List[float] = None,
        format_template: str = None
    ) -> str:
        """构建上下文"""
        context_parts = []
        current_tokens = 0

        # 默认格式模板
        if format_template is None:
            format_template = """【文档 {index}】
来源：{source}
相关度：{score}
内容：{content}
---"""

        for i, doc in enumerate(documents):
            # 构建单个文档文本
            doc_text = self._format_document(
                doc,
                index=i + 1,
                score=scores[i] if scores else None,
                template=format_template
            )

            # 检查 Token 数
            doc_tokens = self._count_tokens(doc_text)

            if current_tokens + doc_tokens > self.max_context_tokens:
                # 尝试截断
                remaining_tokens = self.max_context_tokens - current_tokens
                if remaining_tokens > 100:  # 至少保留 100 tokens
                    truncated_text = self._truncate_text(doc_text, remaining_tokens)
                    context_parts.append(truncated_text)
                break

            context_parts.append(doc_text)
            current_tokens += doc_tokens

        return "\n\n".join(context_parts)

    def _format_document(
        self,
        doc: Dict,
        index: int,
        score: float,
        template: str
    ) -> str:
        """格式化单个文档"""
        metadata = doc.get('metadata', {})

        return template.format(
            index=index,
            source=metadata.get('source', '未知'),
            score=f"{score:.2f}" if score else "N/A",
            content=doc.get('content', '')
        )

    def _count_tokens(self, text: str) -> int:
        """计算 Token 数"""
        return len(self.tokenizer.encode(text))

    def _truncate_text(self, text: str, max_tokens: int) -> str:
        """截断文本到指定 Token 数"""
        tokens = self.tokenizer.encode(text)
        truncated_tokens = tokens[:max_tokens]
        return self.tokenizer.decode(truncated_tokens) + "..."


class SmartContextBuilder(ContextBuilder):
    """智能上下文构建器（考虑信息密度）"""

    def build_with_density(
        self,
        documents: List[Dict],
        query: str,
        scores: List[float] = None
    ) -> str:
        """考虑信息密度构建上下文"""
        # 计算每个文档的信息密度分数
        density_scores = []
        for doc in documents:
            density = self._calculate_density(doc, query)
            density_scores.append(density)

        # 综合排序（相关度 + 信息密度）
        combined_scores = []
        for i, doc in enumerate(documents):
            relevance = scores[i] if scores else 0.5
            density = density_scores[i]
            # 综合分数
            combined = 0.6 * relevance + 0.4 * density
            combined_scores.append(combined)

        # 按综合分数排序
        sorted_docs = sorted(
            zip(documents, combined_scores),
            key=lambda x: x[1],
            reverse=True
        )

        # 构建上下文
        sorted_documents = [doc for doc, _ in sorted_docs]
        sorted_scores = [score for _, score in sorted_docs]

        return self.build(sorted_documents, sorted_scores)

    def _calculate_density(self, doc: Dict, query: str) -> float:
        """计算信息密度"""
        content = doc.get('content', '')

        # 简单的信息密度指标
        # 1. 包含查询关键词
        query_terms = set(query.lower().split())
        content_terms = set(content.lower().split())
        keyword_overlap = len(query_terms & content_terms) / max(len(query_terms), 1)

        # 2. 包含数字/日期等实体信息
        has_numbers = any(c.isdigit() for c in content)

        # 3. 文本长度适中
        length_score = min(len(content) / 500, 1.0)  # 偏好 500 字符左右

        # 综合密度分数
        density = (
            keyword_overlap * 0.5 +
            (0.3 if has_numbers else 0) +
            length_score * 0.2
        )

        return density
```

### 7.2 Prompt 工程

```python
from typing import List, Dict, Optional

class RAGPromptBuilder:
    """RAG Prompt 构建器"""

    # System Prompt 模板
    SYSTEM_PROMPT_TEMPLATE = """你是一个专业的知识问答助手。请基于提供的参考文档回答用户问题。

## 回答原则
1. **忠实性**：只基于参考文档中的信息回答，不要编造内容
2. **准确性**：引用具体信息时，注明来源
3. **完整性**：如果参考文档不足以回答问题，诚实告知用户
4. **简洁性**：回答简洁明了，突出关键信息

## 输出格式
- 使用 Markdown 格式
- 重要信息使用加粗
- 如果有多个要点，使用编号列表
- 如果信息不确定，使用"根据文档..."等表述

## 当前时间
{current_time}

## 用户画像
{user_profile}
"""

    # Context 注入模板
    CONTEXT_TEMPLATE = """
## 参考文档

{context}

---
"""

    # 问答模板
    QA_TEMPLATE = """
## 用户问题

{question}

请基于参考文档回答用户问题。
"""

    def __init__(
        self,
        system_prompt: str = None,
        include_citations: bool = True,
        include_confidence: bool = False
    ):
        self.system_prompt = system_prompt or self.SYSTEM_PROMPT_TEMPLATE
        self.include_citations = include_citations
        self.include_confidence = include_confidence

    def build(
        self,
        question: str,
        context: str,
        user_profile: str = "",
        few_shot_examples: List[Dict] = None
    ) -> List[Dict]:
        """构建完整的 Prompt"""
        messages = []

        # 1. System Prompt
        from datetime import datetime
        system_prompt = self.system_prompt.format(
            current_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            user_profile=user_profile or "未提供"
        )
        messages.append({
            "role": "system",
            "content": system_prompt
        })

        # 2. Few-shot 示例
        if few_shot_examples:
            for example in few_shot_examples:
                messages.append({
                    "role": "user",
                    "content": example.get("question", "")
                })
                messages.append({
                    "role": "assistant",
                    "content": example.get("answer", "")
                })

        # 3. Context + Question
        user_message = self.CONTEXT_TEMPLATE.format(context=context)
        user_message += self.QA_TEMPLATE.format(question=question)

        # 4. 添加额外指令
        extra_instructions = []
        if self.include_citations:
            extra_instructions.append("请在回答中标注信息来源，格式为 [文档X]")
        if self.include_confidence:
            extra_instructions.append("请在回答末尾标注置信度（高/中/低）")

        if extra_instructions:
            user_message += "\n## 额外要求\n" + "\n".join(extra_instructions)

        messages.append({
            "role": "user",
            "content": user_message
        })

        return messages

    def build_with_history(
        self,
        question: str,
        context: str,
        history: List[Dict],
        max_history_turns: int = 5
    ) -> List[Dict]:
        """构建带历史的 Prompt"""
        messages = []

        # System Prompt
        messages.append({
            "role": "system",
            "content": self.system_prompt.format(
                current_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                user_profile=""
            )
        })

        # 历史对话（限制轮数）
        recent_history = history[-max_history_turns * 2:] if history else []
        messages.extend(recent_history)

        # Context + Question
        user_message = self.CONTEXT_TEMPLATE.format(context=context)
        user_message += self.QA_TEMPLATE.format(question=question)

        messages.append({
            "role": "user",
            "content": user_message
        })

        return messages
```

---

## 八、进阶技术

### 8.1 Query 理解与改写

```python
from typing import List, Dict, Tuple
import re

class QueryProcessor:
    """查询处理器"""

    def __init__(self, llm):
        self.llm = llm

    def process(self, query: str) -> Dict:
        """处理查询"""
        return {
            'original_query': query,
            'rewritten_queries': self.rewrite_query(query),
            'sub_queries': self.decompose_query(query),
            'keywords': self.extract_keywords(query),
            'intent': self.classify_intent(query),
        }

    def rewrite_query(self, query: str) -> List[str]:
        """查询改写"""
        prompt = f"""请将以下用户查询改写成多个语义相同但表述不同的版本，用于提高检索召回率。

原始查询：{query}

要求：
1. 改写 3 个版本
2. 保持语义一致
3. 使用不同的词汇和句式
4. 每行一个改写

改写结果："""

        response = self.llm.invoke(prompt)
        rewrites = [line.strip() for line in response.split('\n') if line.strip()]

        return rewrites[:3]

    def decompose_query(self, query: str) -> List[str]:
        """查询分解"""
        prompt = f"""请判断以下查询是否可以分解为多个子问题。如果可以，请分解；如果不需要，返回原问题。

查询：{query}

输出格式（每行一个子问题）：
1. ...
2. ...

分解结果："""

        response = self.llm.invoke(prompt)

        # 解析子问题
        sub_queries = []
        for line in response.split('\n'):
            # 匹配 "1. " "2. " 等格式
            match = re.match(r'\d+\.\s*(.+)', line.strip())
            if match:
                sub_queries.append(match.group(1))

        # 如果没有分解成功，返回原查询
        if not sub_queries:
            return [query]

        return sub_queries

    def extract_keywords(self, query: str) -> List[str]:
        """提取关键词"""
        # 简单的关键词提取（实际可用 NLP 工具）
        stop_words = {'的', '了', '是', '在', '有', '和', '与', '或', '吗', '呢', '啊'}

        # 分词（简化版，实际应使用 jieba 等）
        words = re.findall(r'[\u4e00-\u9fa5]+|[a-zA-Z]+|\d+', query)

        keywords = [
            word for word in words
            if word not in stop_words and len(word) > 1
        ]

        return keywords

    def classify_intent(self, query: str) -> str:
        """意图分类"""
        intents = {
            'search': ['查找', '搜索', '寻找', '有哪些', '是什么'],
            'compare': ['对比', '比较', '区别', '哪个好', '优劣'],
            'howto': ['怎么', '如何', '怎样', '方法', '步骤'],
            'explain': ['什么是', '解释', '介绍', '说明', '原理'],
            'recommend': ['推荐', '建议', '最好', '推荐一下'],
        }

        for intent, keywords in intents.items():
            if any(kw in query for kw in keywords):
                return intent

        return 'general'


class HyDE:
    """Hypothetical Document Embeddings（假设文档嵌入）"""

    def __init__(self, llm, embedding_model):
        self.llm = llm
        self.embedding_model = embedding_model

    def generate_hypothetical_document(self, query: str) -> str:
        """生成假设文档"""
        prompt = f"""请针对用户问题，生成一段可能包含答案的文档片段。

用户问题：{query}

要求：
1. 假设这是一个真实的文档片段
2. 长度约 200-300 字
3. 包含可能的答案信息
4. 使用专业、正式的语言

生成的文档片段："""

        return self.llm.invoke(prompt)

    def retrieve(self, query: str, vector_store, k: int = 5) -> List[Dict]:
        """使用 HyDE 进行检索"""
        # 1. 生成假设文档
        hypothetical_doc = self.generate_hypothetical_document(query)

        # 2. 对假设文档进行向量化
        doc_embedding = self.embedding_model.embed_query(hypothetical_doc)

        # 3. 用假设文档的向量进行检索
        results = vector_store.similarity_search_by_vector(doc_embedding, k=k)

        return results
```

### 8.2 多轮对话 RAG

```python
from typing import List, Dict, Optional
from dataclasses import dataclass, field
from datetime import datetime

@dataclass
class ConversationTurn:
    """对话轮次"""
    query: str
    answer: str
    retrieved_docs: List[Dict] = field(default_factory=list)
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())

class ConversationalRAG:
    """多轮对话 RAG"""

    def __init__(
        self,
        retriever,
        llm,
        context_builder,
        max_history_turns: int = 5
    ):
        self.retriever = retriever
        self.llm = llm
        self.context_builder = context_builder
        self.max_history_turns = max_history_turns
        self.history: List[ConversationTurn] = []

    def query(
        self,
        question: str,
        session_id: str = None
    ) -> str:
        """处理多轮对话查询"""
        # 1. 历史查询改写
        rewritten_query = self._rewrite_with_history(question)

        # 2. 检索
        docs = self.retriever.retrieve(rewritten_query)

        # 3. 构建上下文
        context = self.context_builder.build(docs)

        # 4. 构建带历史的 Prompt
        messages = self._build_messages(question, context)

        # 5. 生成回答
        answer = self.llm.invoke(messages)

        # 6. 记录历史
        turn = ConversationTurn(
            query=question,
            answer=answer,
            retrieved_docs=docs
        )
        self.history.append(turn)

        # 限制历史长度
        if len(self.history) > self.max_history_turns:
            self.history = self.history[-self.max_history_turns:]

        return answer

    def _rewrite_with_history(self, query: str) -> str:
        """根据历史改写查询"""
        if not self.history:
            return query

        # 获取最近的历史
        recent_queries = [turn.query for turn in self.history[-3:]]

        prompt = f"""请根据对话历史，改写用户的最新问题，使其成为一个独立的、完整的问题。

对话历史：
{chr(10).join([f'Q: {q}' for q in recent_queries])}

最新问题：{query}

改写后的完整问题："""

        rewritten = self.llm.invoke(prompt)
        return rewritten.strip()

    def _build_messages(
        self,
        question: str,
        context: str
    ) -> List[Dict]:
        """构建消息列表"""
        messages = []

        # System Prompt
        messages.append({
            "role": "system",
            "content": "你是一个专业的知识问答助手，擅长多轮对话。请结合对话历史和参考文档回答用户问题。"
        })

        # 历史对话
        for turn in self.history:
            messages.append({
                "role": "user",
                "content": turn.query
            })
            messages.append({
                "role": "assistant",
                "content": turn.answer
            })

        # 当前问题 + Context
        user_message = f"""参考文档：
{context}

用户问题：{question}"""

        messages.append({
            "role": "user",
            "content": user_message
        })

        return messages

    def get_history_summary(self) -> str:
        """获取历史摘要"""
        if not self.history:
            return "暂无对话历史"

        summary_parts = []
        for i, turn in enumerate(self.history, 1):
            summary_parts.append(f"第{i}轮：")
            summary_parts.append(f"  用户：{turn.query[:50]}...")
            summary_parts.append(f"  助手：{turn.answer[:50]}...")

        return "\n".join(summary_parts)
```

---

## 九、常见踩坑与解决方案

### 9.1 分块相关问题

#### 坑1：分块粒度不当

```
问题表现：
- chunk_size 太大（2000+）：检索不精确，噪音多
- chunk_size 太小（100-）：语义不完整，上下文断裂
- 没有 overlap：跨块信息丢失

解决方案：
┌─────────────────────────────────────────────────────────────┐
│  文档类型          推荐 chunk_size     推荐 overlap          │
│  ─────────────────────────────────────────────────────────  │
│  通用文档          300-600            30-60 (10%)           │
│  技术文档          500-800            50-80 (10%)           │
│  法律文档          保持条款完整性      条款间可 overlap       │
│  FAQ 文档          按问答对分割        无需 overlap          │
│  代码文档          按函数/类分割       可 overlap            │
└─────────────────────────────────────────────────────────────┘
```

```python
# 解决方案：自适应分块
class AdaptiveChunker:
    """自适应分块器"""

    def chunk(self, document: Dict) -> List[Dict]:
        """根据内容类型自适应分块"""
        content = document['content']

        # 检测内容类型
        if self._is_faq(content):
            return self._chunk_faq(document)
        elif self._is_code(content):
            return self._chunk_code(document)
        elif self._is_legal(content):
            return self._chunk_legal(document)
        else:
            return self._chunk_general(document)

    def _is_faq(self, content: str) -> bool:
        return 'Q:' in content or '问：' in content

    def _is_code(self, content: str) -> bool:
        return '```' in content or 'def ' in content

    def _is_legal(self, content: str) -> bool:
        return '第' in content and '条' in content

    def _chunk_faq(self, document: Dict) -> List[Dict]:
        """FAQ 分块：按问答对分割"""
        import re
        content = document['content']

        # 按 Q: 或 问： 分割
        qa_pairs = re.split(r'\n(?=Q:|问：)', content)

        return [
            {'content': qa, 'metadata': {**document.get('metadata', {})}}
            for qa in qa_pairs if qa.strip()
        ]

    def _chunk_legal(self, document: Dict) -> List[Dict]:
        """法律文档分块：按条款分割"""
        import re
        content = document['content']

        # 按 "第X条" 分割
        clauses = re.split(r'(?=第[一二三四五六七八九十百千]+条)', content)

        return [
            {'content': clause, 'metadata': {**document.get('metadata', {})}}
            for clause in clauses if clause.strip()
        ]
```

#### 坑2：元数据丢失

```python
# ❌ 错误：分块时丢失元数据
def bad_chunk(document):
    return [{'content': chunk} for chunk in split(document['content'])]

# ✅ 正确：保留并增强元数据
def good_chunk(document):
    chunks = split(document['content'])
    return [
        {
            'content': chunk,
            'metadata': {
                **document['metadata'],
                'chunk_index': i,
                'total_chunks': len(chunks),
                'char_start': document['content'].find(chunk),
                'char_end': document['content'].find(chunk) + len(chunk),
            }
        }
        for i, chunk in enumerate(chunks)
    ]
```

### 9.2 检索相关问题

#### 坑3：检索结果直接拼接

```python
# ❌ 错误：直接拼接所有检索结果
context = "\n".join([doc['content'] for doc in docs])
# 问题：超过上下文限制、噪音多、顺序不合理

# ✅ 正确：智能构建 Context
def build_context(docs: List[Dict], query: str, max_tokens: int = 3000) -> str:
    """智能构建上下文"""
    context_parts = []
    current_tokens = 0

    # 1. 按相关度排序
    sorted_docs = sorted(docs, key=lambda x: x.get('score', 0), reverse=True)

    # 2. Token 预算管理
    for doc in sorted_docs:
        doc_text = format_document(doc)
        doc_tokens = count_tokens(doc_text)

        if current_tokens + doc_tokens > max_tokens:
            # 尝试截断
            remaining = max_tokens - current_tokens
            if remaining > 100:
                truncated = truncate_text(doc_text, remaining)
                context_parts.append(truncated)
            break

        context_parts.append(doc_text)
        current_tokens += doc_tokens

    # 3. 添加来源说明
    context = "以下是检索到的相关文档：\n\n"
    context += "\n\n---\n\n".join(context_parts)

    return context
```

#### 坑4：未处理检索空结果

```python
# ❌ 错误：不处理空结果
docs = retriever.invoke(query)
# 如果 docs 为空，LLM 会产生幻觉

# ✅ 正确：优雅处理空结果
def safe_retrieve(query: str, retriever) -> Tuple[List[Dict], str]:
    """安全的检索"""
    docs = retriever.retrieve(query, k=10)

    if not docs:
        # 策略1：放宽检索条件
        docs = retriever.retrieve(query, k=20, threshold=0.3)

        if not docs:
            # 策略2：返回提示信息
            return [], "抱歉，知识库中未找到相关信息。"

    return docs, None

def rag_with_fallback(query: str, rag_pipeline, llm) -> str:
    """带降级的 RAG"""
    docs, error = safe_retrieve(query, rag_pipeline.retriever)

    if error:
        # 降级到普通 LLM 生成
        return llm.invoke(query)

    # 正常 RAG 流程
    return rag_pipeline.query(query, docs)
```

#### 坑5：向量维度不匹配

```python
# ❌ 错误：不同模型混用
embeddings1 = OpenAIEmbeddings()  # 1536 维
embeddings2 = HuggingFaceEmbeddings(model_name="xxx")  # 768 维
# 创建索引时用 embeddings1，检索时用 embeddings2 → 维度不匹配

# ✅ 正确：统一 Embedding 管理
class EmbeddingManager:
    """Embedding 单例管理"""
    _instance = None
    _embeddings = None

    def __new__(cls, model_name: str = 'text-embedding-3-small'):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            if 'openai' in model_name.lower():
                cls._embeddings = OpenAIEmbeddings(model=model_name)
            else:
                cls._embeddings = HuggingFaceEmbeddings(model_name=model_name)
        return cls._instance

    @property
    def embeddings(self):
        return self._embeddings

    def get_dimension(self) -> int:
        # 通过实际测试获取维度
        test_embedding = self._embeddings.embed_query("test")
        return len(test_embedding)

# 使用
embedding_manager = EmbeddingManager('bge-large-zh-v1.5')
vector_store = Chroma(embedding_function=embedding_manager.embeddings)
```

### 9.3 性能问题

#### 坑6：检索延迟过高

```python
# 问题分析
# - 向量检索慢：索引未优化、未使用 ANN
# - Rerank 慢：模型过大、未批处理
# - 网络 IO：远程调用多

# ✅ 解决方案

# 1. 使用 ANN 索引优化
from langchain_community.vectorstores import Milvus

# 配置 IVF 索引（倒排文件索引）
vector_store = Milvus(
    embedding_function=embeddings,
    collection_name="documents",
    index_params={
        "metric_type": "COSINE",
        "index_type": "IVF_FLAT",
        "params": {"nlist": 1024}
    }
)

# 2. 批量 Rerank
def batch_rerank(query: str, documents: List[Dict], batch_size: int = 32) -> List[Dict]:
    """批量重排序"""
    from sentence_transformers import CrossEncoder
    reranker = CrossEncoder('BAAI/bge-reranker-base')

    # 批量计算
    pairs = [(query, doc['content']) for doc in documents]
    scores = reranker.predict(pairs, batch_size=batch_size)

    # 排序
    scored_docs = list(zip(documents, scores))
    scored_docs.sort(key=lambda x: x[1], reverse=True)

    return [doc for doc, _ in scored_docs]

# 3. 缓存热门查询
from functools import lru_cache
import hashlib

class CachedRetriever:
    """带缓存的检索器"""

    def __init__(self, retriever, cache_size: int = 1000):
        self.retriever = retriever
        self.cache_size = cache_size

    @lru_cache(maxsize=1000)
    def _cache_key(self, query: str) -> str:
        return hashlib.md5(query.encode()).hexdigest()

    def retrieve(self, query: str, use_cache: bool = True) -> List[Dict]:
        if use_cache:
            cache_key = self._cache_key(query)
            # 检查缓存...（需要实现持久化缓存）
            pass

        return self.retriever.retrieve(query)
```

---

## 十、生产环境注意事项

### 10.1 部署架构

```
+------------------------------------------------------------------+
|                    生产环境 RAG 部署架构                           |
+------------------------------------------------------------------+
|                                                                   |
|  用户请求                                                         |
|     │                                                             |
|     v                                                             |
|  ┌─────────────┐                                                  |
|  │ 负载均衡    │                                                  |
|  └─────────────┘                                                  |
|     │                                                             |
|     v                                                             |
|  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐         |
|  │ RAG 服务 1  │     │ RAG 服务 2  │     │ RAG 服务 N  │         |
|  └─────────────┘     └─────────────┘     └─────────────┘         |
|     │                    │                    │                  |
|     └────────────────────┼────────────────────┘                  |
|                          │                                       |
|          ┌───────────────┼───────────────┐                       |
|          v               v               v                       |
|  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                 |
|  │   Redis     │ │  Milvus     │ │   MySQL     │                 |
|  │  (缓存)     │ │ (向量存储)   │ │  (元数据)   │                 |
|  └─────────────┘ └─────────────┘ └─────────────┘                 |
|                                                                   |
|  数据同步架构                                                     |
|  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐        |
|  │ 数据源   │ -> │ Kafka   │ -> │ ETL     │ -> │ Milvus  │        |
|  └─────────┘    └─────────┘    └─────────┘    └─────────┘        |
|                                                                   |
+------------------------------------------------------------------+
```

### 10.2 监控指标

```python
# 关键监控指标
RAG_METRICS = {
    # 检索质量
    'retrieval_latency_ms': '检索延迟（毫秒）',
    'retrieval_count': '检索请求总数',
    'retrieval_empty_rate': '空结果率',
    'retrieval_avg_docs': '平均返回文档数',

    # 生成质量
    'generation_latency_ms': '生成延迟（毫秒）',
    'generation_token_count': '生成 Token 数',
    'generation_error_rate': '生成错误率',

    # 系统健康
    'vector_store_health': '向量存储健康状态',
    'embedding_queue_size': '向量化队列大小',
    'cache_hit_rate': '缓存命中率',

    # 业务指标
    'user_satisfaction': '用户满意度评分',
    'answer_helpfulness': '回答有用性评分',
    'hallucination_rate': '幻觉率（抽样评估）',
}

# Prometheus 指标示例
from prometheus_client import Counter, Histogram, Gauge

retrieval_latency = Histogram(
    'rag_retrieval_latency_seconds',
    'Retrieval latency in seconds',
    ['collection', 'retriever_type']
)

retrieval_count = Counter(
    'rag_retrieval_total',
    'Total retrieval requests',
    ['status']  # success, empty, error
)

generation_latency = Histogram(
    'rag_generation_latency_seconds',
    'Generation latency in seconds',
    ['model']
)
```

### 10.3 数据更新策略

```python
from typing import List, Dict
from datetime import datetime
import hashlib

class IncrementalUpdater:
    """增量更新器"""

    def __init__(self, vector_store, embedding_model):
        self.vector_store = vector_store
        self.embedding_model = embedding_model

    def update_documents(
        self,
        documents: List[Dict],
        strategy: str = 'incremental'
    ) -> Dict:
        """更新文档"""
        if strategy == 'incremental':
            return self._incremental_update(documents)
        elif strategy == 'full':
            return self._full_update(documents)
        else:
            raise ValueError(f"Unknown strategy: {strategy}")

    def _incremental_update(self, documents: List[Dict]) -> Dict:
        """增量更新：只更新变化的文档"""
        updated = 0
        added = 0
        deleted = 0

        for doc in documents:
            doc_id = doc.get('id')
            content_hash = self._hash_content(doc['content'])

            # 检查是否已存在
            existing = self.vector_store.get(doc_id)

            if existing is None:
                # 新增
                self.vector_store.add([doc])
                added += 1
            elif existing.metadata.get('content_hash') != content_hash:
                # 更新
                self.vector_store.delete([doc_id])
                doc['metadata']['content_hash'] = content_hash
                self.vector_store.add([doc])
                updated += 1

        return {
            'added': added,
            'updated': updated,
            'deleted': deleted,
            'timestamp': datetime.now().isoformat()
        }

    def _full_update(self, documents: List[Dict]) -> Dict:
        """全量更新：删除旧数据，重新导入"""
        # 清空集合
        self.vector_store.delete_collection()
        self.vector_store.create_collection()

        # 批量导入
        batch_size = 100
        for i in range(0, len(documents), batch_size):
            batch = documents[i:i + batch_size]
            for doc in batch:
                doc['metadata']['content_hash'] = self._hash_content(doc['content'])
            self.vector_store.add(batch)

        return {
            'added': len(documents),
            'updated': 0,
            'deleted': 0,
            'timestamp': datetime.now().isoformat()
        }

    def _hash_content(self, content: str) -> str:
        """计算内容哈希"""
        return hashlib.md5(content.encode()).hexdigest()
```

---

## 十一、参考资源

### 11.1 开源项目

| 项目 | 说明 | 链接 |
|------|------|------|
| LangChain | LLM 应用开发框架 | https://github.com/langchain-ai/langchain |
| LlamaIndex | RAG 专用框架 | https://github.com/run-llama/llama_index |
| Haystack | NLP + RAG 框架 | https://github.com/deepset-ai/haystack |
| RAGFlow | 端到端 RAG 引擎 | https://github.com/infiniflow/ragflow |
| Quivr | 个人知识库 | https://github.com/QuivrHQ/quivr |

### 11.2 向量数据库

| 数据库 | 说明 | 链接 |
|--------|------|------|
| Milvus | 开源分布式向量数据库 | https://milvus.io/ |
| Pinecone | 云向量数据库 | https://www.pinecone.io/ |
| Weaviate | 语义搜索引擎 | https://weaviate.io/ |
| Qdrant | Rust 向量数据库 | https://qdrant.tech/ |
| Chroma | 轻量级向量数据库 | https://www.trychroma.com/ |

### 11.3 Embedding 模型

| 模型 | 说明 | 链接 |
|------|------|------|
| BGE | 中文最佳开源模型 | https://huggingface.co/BAAI/bge-large-zh-v1.5 |
| M3E | 多语言模型 | https://huggingface.co/moka-ai/m3e-base |
| E5 | 多语言文本嵌入 | https://huggingface.co/intfloat/multilingual-e5-large |

### 11.4 评测工具

| 工具 | 说明 | 链接 |
|------|------|------|
| RAGAS | RAG 评测框架 | https://github.com/explodinggradients/ragas |
| TruLens | LLM 应用评测 | https://github.com/truera/trulens |
| DeepEval | LLM 评测平台 | https://github.com/confident-ai/deepeval |

### 11.5 推荐阅读

1. **论文**
   - Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks (Facebook AI, 2020)
   - Dense Passage Retrieval for Open-Domain Question Answering (Facebook AI, 2020)
   - REALM: Retrieval-Augmented Language Model Pre-Training (Google, 2020)

2. **博客**
   - LangChain RAG 教程：https://python.langchain.com/docs/tutorials/rag/
   - LlamaIndex 官方文档：https://docs.llamaindex.ai/
   - Pinecone RAG 指南：https://www.pinecone.io/learn/retrieval-augmented-generation/

---

## 更新记录

| 日期 | 版本 | 更新内容 |
|------|------|----------|
| 2026-04-14 | v1.0 | 初始版本 |

