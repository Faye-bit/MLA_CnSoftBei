# MLA — 多学助手

面向高校专业课程的个性化学习资源生成与智能辅导平台。系统以"人工智能导论"为切入点，通过对话式交互构建学生画像，基于课程知识库和多智能体协同机制，为学生生成个性化、多模态学习资源、学习路径、练习题与答疑内容。

> 中国软件杯大学生软件设计大赛参赛项目

---

## 环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Python | ≥ 3.11 | 后端运行环境 |
| Node.js | ≥ 20 | 前端构建工具链 |
| PostgreSQL | 17 | 业务数据库，需启用 pgvector 扩展 |
| Redis | ≥ 7 | 缓存服务，后续 Celery 任务队列复用 |
| Homebrew | — | macOS 包管理器，用于安装上述依赖 |
| pip | — | Python 包管理器 |

### LLM 与 Embedding API

系统需要两类大模型 API，可分别接入不同服务商：

| 用途 | Phase | 推荐方案 | 是否需要多模态 |
|------|-------|---------|---------------|
| **LLM** (对话、资源生成) | Phase 2+ | DeepSeek / 智谱 GLM / 通义千问 / OpenAI | 不需要 |
| **Embedding** (向量检索) | Phase 1 | OpenAI text-embedding-3-small / 本地 Ollama bge-m3 / 智谱 embedding-3 | 不需要 |

> 系统全程使用纯文本模型。所谓的"多模态资源"（PPT、思维导图、视频脚本等）均由大模型生成文本描述或代码，再通过 python-pptx、Mermaid、Manim 等工具渲染为最终文件。

---

## 快速启动

### 1. 安装基础服务

```bash
# 通过 Homebrew 安装 PostgreSQL 17、Redis 和 pgvector
brew install postgresql@17 redis pgvector

# 复制 pgvector 扩展到 PostgreSQL 目录
cp /opt/homebrew/opt/pgvector/share/postgresql@17/extension/* \
   /opt/homebrew/opt/postgresql@17/share/postgresql/extension/
cp /opt/homebrew/opt/pgvector/lib/postgresql@17/vector.dylib \
   /opt/homebrew/opt/postgresql@17/lib/postgresql/

# 启动服务
brew services start postgresql@17
brew services start redis
```

### 2. 创建数据库

```bash
/opt/homebrew/opt/postgresql@17/bin/psql -d postgres <<SQL
CREATE USER mla WITH PASSWORD 'mla123';
CREATE DATABASE mla_db OWNER mla;
\c mla_db
CREATE EXTENSION IF NOT EXISTS vector;
GRANT ALL PRIVILEGES ON DATABASE mla_db TO mla;
GRANT ALL ON SCHEMA public TO mla;
SQL
```

### 3. 配置环境变量

```bash
cd backend
cp .env.example .env
```

编辑 `backend/.env`，填入 API Key：

```env
# LLM 配置 (Phase 2+ 使用，可暂不填)
LLM_API_KEY=sk-your-deepseek-key
LLM_API_BASE=https://api.deepseek.com
LLM_MODEL=deepseek-chat

# Embedding 配置 (Phase 1 使用，必填)
EMBEDDING_API_KEY=sk-your-openai-key
EMBEDDING_API_BASE=https://api.openai.com/v1
EMBEDDING_MODEL=text-embedding-3-small
```

### 4. 启动后端

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

访问 `http://localhost:8000/docs` 查看 Swagger API 文档。

### 5. 启动前端

```bash
cd frontend
npm install
npm run dev
```

访问 `http://localhost:5173` 打开前端界面。

---

## 当前进度 (Phase 1 完成)

### 已完成

#### 后端

- 项目框架搭建（FastAPI + SQLAlchemy 2.0 异步 + Pydantic）
- 6 张数据库核心表：`users`, `courses`, `chapters`, `knowledge_points`, `documents`, `document_chunks`
- 文档处理流水线：上传 → 解析（PDF/DOCX/PPTX/MD/TXT）→ 递归切片 → Embedding 向量化 → Chroma 向量存储
- RAG 检索接口：语义搜索 → 返回关联切片 + 来源文档 + 相似度分数
- 课程/章节/知识点的完整 CRUD API
- 文档上传/列表/详情/删除 API
- Docker Compose 开发环境配置（备选）

#### 前端

- 项目框架搭建（React 19 + TypeScript + Vite + Ant Design 5 + Tailwind CSS）
- 6 个功能页面：
  - **仪表盘** — 课程/文档统计、系统状态概览
  - **课程管理** — 课程卡片列表、创建/删除
  - **课程详情** — 章节表格 + 知识点展开行，支持 CRUD
  - **文档上传** — 拖拽上传课程资料，自动触发解析流水线
  - **文档列表** — 显示解析状态，支持详情查看（含切片内容）
  - **知识检索** — 选择课程 → 输入查询 → 语义搜索 → 来源引用展示
- API 服务层封装（axios）+ 全局状态管理（Zustand）

### 待完成

| Phase | 内容 |
|-------|------|
| Phase 2 | 对话式画像构建：Profile Agent + 对话信息抽取 + 画像可视化 |
| Phase 3 | 多智能体资源生成：Coordinator + 5 种资源 Agent + 生成进度追踪 |
| Phase 4 | 学习路径规划 + 智能辅导（RAG 答疑） |
| Phase 5 | 学习评估 + 内容安全过滤 + 事实校验 + UI 优化 |

---

## 技术栈

| 层面 | 技术 | 说明 |
|------|------|------|
| 后端框架 | Python FastAPI | 异步支持，适合 AI 服务 |
| ORM | SQLAlchemy 2.0 (async) | 异步数据库操作 |
| 数据库 | PostgreSQL 17 + pgvector | 业务数据 + 向量检索 |
| 向量数据库 | Chroma (本地持久化) | 开发阶段轻量化方案 |
| 缓存 | Redis 8 | 后续 Celery 任务队列复用 |
| 文档解析 | PyMuPDF / python-docx / python-pptx | PDF/DOCX/PPTX/MD/TXT 全覆盖 |
| 前端框架 | React 19 + TypeScript + Vite | 现代前端方案 |
| UI 组件 | Ant Design 5 + Tailwind CSS | 中文生态好，快速开发 |
| 状态管理 | Zustand | 轻量级 |
| 嵌入模型 | OpenAI text-embedding-3-small | 可切换为本地 Ollama 模型 |

---

## 项目结构

```
CnSoftBei/
├── backend/                        # 后端服务
│   ├── app/
│   │   ├── main.py                 # FastAPI 入口
│   │   ├── core/
│   │   │   ├── config.py           # 全局配置 (Pydantic Settings)
│   │   │   └── database.py         # 异步数据库引擎
│   │   ├── models/                 # SQLAlchemy ORM
│   │   │   ├── user.py             # 用户模型
│   │   │   ├── course.py           # 课程 / 章节 / 知识点模型
│   │   │   └── document.py         # 文档 / 切片模型
│   │   ├── schemas/                # Pydantic 请求/响应模型
│   │   │   ├── common.py           # 分页 / 统一响应格式
│   │   │   ├── course.py           # 课程相关 Schema
│   │   │   ├── document.py         # 文档相关 Schema
│   │   │   └── retrieval.py        # 检索相关 Schema
│   │   ├── api/v1/                 # API 路由
│   │   │   ├── courses.py          # 课程 / 章节 / 知识点 CRUD
│   │   │   ├── documents.py        # 文档上传 / 列表 / 删除
│   │   │   └── retrieval.py        # RAG 语义检索
│   │   └── services/               # 业务逻辑层
│   │       ├── document_parser.py  # 多格式文档解析
│   │       ├── chunker.py          # 递归文本切片器
│   │       ├── embedder.py         # Embedding 嵌入生成
│   │       ├── vector_store.py     # Chroma 向量存储
│   │       └── retriever.py        # RAG 检索 + 文档流水线
│   ├── requirements.txt
│   ├── docker-compose.yml          # 开发环境 (备选)
│   └── .env.example
├── frontend/                       # 前端应用
│   ├── src/
│   │   ├── App.tsx                 # 路由表
│   │   ├── main.tsx                # 应用入口
│   │   ├── components/
│   │   │   ├── layout/             # AppLayout + Sidebar
│   │   │   └── common/             # FileUpload 等通用组件
│   │   ├── pages/                  # 6 个功能页面
│   │   │   ├── Dashboard.tsx
│   │   │   ├── CourseList.tsx
│   │   │   ├── CourseDetail.tsx
│   │   │   ├── DocumentUpload.tsx
│   │   │   ├── DocumentList.tsx
│   │   │   └── KnowledgeSearch.tsx
│   │   ├── services/api.ts         # 后端接口封装
│   │   ├── store/index.ts          # 全局状态 (Zustand)
│   │   └── types/index.ts          # TypeScript 类型定义
│   ├── package.json
│   └── vite.config.ts
├── Need.md                         # 详细需求文档
├── 赛题.md                          # 赛题说明
└── README.md                       # 本文件
```

## 开源协议标注

| 依赖 | License |
|------|---------|
| React | MIT |
| Vite | MIT |
| FastAPI | MIT |
| SQLAlchemy | MIT |
| LangChain / LangGraph | MIT |
| LlamaIndex | MIT |
| Chroma | Apache-2.0 |
| Ant Design | MIT |
| ECharts | Apache-2.0 |
| Mermaid | MIT |
