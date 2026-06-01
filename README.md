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

### LLM 与 Embedding API

系统需要两类大模型 API，可分别接入不同服务商：

| 用途 | Phase | 推荐方案 | 是否需要多模态 |
|------|-------|---------|---------------|
| **LLM** (对话、资源生成) | Phase 1+ | DeepSeek / 智谱 GLM / 通义千问 / OpenAI | 不需要 |
| **Embedding** (向量检索) | Phase 1 | GitHub Models (免费) / OpenAI / 智谱 | 不需要 |

> 系统全程使用纯文本模型。所谓的"多模态资源"（PPT、思维导图、视频脚本等）均由大模型生成文本描述或代码，再通过 python-pptx、Mermaid、Manim 等工具渲染为最终文件。

---

## 快速启动

### macOS

#### 1. 安装基础服务

```bash
brew install postgresql@17 redis pgvector

# 复制 pgvector 扩展文件到 PostgreSQL 目录
cp /opt/homebrew/opt/pgvector/share/postgresql@17/extension/* \
   /opt/homebrew/opt/postgresql@17/share/postgresql/extension/
cp /opt/homebrew/opt/pgvector/lib/postgresql@17/vector.dylib \
   /opt/homebrew/opt/postgresql@17/lib/postgresql/

brew services start postgresql@17
brew services start redis
```

#### 2. 创建数据库

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

### Windows

#### 1. 安装基础服务

**PostgreSQL 17 + pgvector**

1. 从 https://www.enterprisedb.com/downloads/postgres-postgresql-downloads 下载并安装 PostgreSQL 17
2. 安装过程中记录设置的 `postgres` 用户密码
3. 安装完成后，使用 Stack Builder 安装 pgvector 扩展：
   - 启动 Stack Builder → 选择 PostgreSQL 17 → 勾选 "pgvector"
4. 或者手动编译 pgvector（备选方案）：
   ```powershell
   git clone https://github.com/pgvector/pgvector.git
   cd pgvector
   set "PGROOT=C:\Program Files\PostgreSQL\17"
   nmake /F Makefile.win
   nmake /F Makefile.win install
   ```

**Redis**

Redis 官方不支持 Windows。推荐使用以下方案之一：

- **方案 A**：安装 Memurai（Redis Windows 兼容替代，免费开发版）
  https://www.memurai.com/get-memurai
- **方案 B**：使用 WSL（Windows Subsystem for Linux），在 WSL 中安装 Redis
- **方案 C**：用 Docker Desktop for Windows 运行 `docker run -d -p 6379:6379 redis:7-alpine`

#### 2. 创建数据库

打开 PostgreSQL 自带的 **SQL Shell (psql)**，以 postgres 用户连接后执行：

```sql
CREATE USER mla WITH PASSWORD 'mla123';
CREATE DATABASE mla_db OWNER mla;
\c mla_db
CREATE EXTENSION IF NOT EXISTS vector;
GRANT ALL PRIVILEGES ON DATABASE mla_db TO mla;
GRANT ALL ON SCHEMA public TO mla;
```

---

### 3. 安装 Python 依赖

**macOS & Windows 通用**：

```bash
cd backend
pip install -r requirements.txt
```

> 国内用户如遇 PyPI 下载慢，可添加清华镜像：
> ```bash
> pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
> ```

### 4. 配置 API Key

**方式一：通过前端页面配置（推荐）**

启动项目后，打开系统设置页面直接填入 API Key，保存后即时生效，无需重启。

**方式二：编辑 .env 文件**

```bash
cd backend
cp .env.example .env
```

编辑 `backend/.env`，填入 API Key。推荐使用 GitHub Models（免费）：

```env
# LLM 配置 (自动提取知识点、对话等)
LLM_API_KEY=ghp_xxxxxxxxxxxx       # GitHub Classic Token 或 DeepSeek/智谱 Key
LLM_API_BASE=https://api.deepseek.com
LLM_MODEL=deepseek-chat

# Embedding 配置 (文档向量化、知识检索)
EMBEDDING_API_KEY=ghp_xxxxxxxxxxxx  # GitHub Classic Token
EMBEDDING_API_BASE=https://models.inference.ai.azure.com
EMBEDDING_MODEL=text-embedding-3-small
```

> GitHub Models 免费额度获取：https://github.com/settings/tokens → 生成 Classic Token → 无需勾选任何权限

### 5. 启动后端

```bash
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

访问 `http://localhost:8000/docs` 查看 Swagger API 文档（国内用户如 CDN 被墙可改用 curl 测试）。

### 6. 启动前端

```bash
cd frontend
npm install
npm run dev
```

访问 `http://localhost:5173` 打开前端界面。

---

## Phase 1 完成清单

### 已实现功能

#### 后端

| 功能 | 说明 |
|------|------|
| 项目框架 | FastAPI + SQLAlchemy 2.0 异步 + Pydantic 校验 |
| 数据库 | 7 张表：users / courses / chapters / knowledge_points / documents / document_chunks / system_configs |
| 文档处理流水线 | 上传 → 解析 (PDF/DOCX/PPTX/MD/TXT) → 递归切片 → Embedding 向量化 → Chroma 存储 |
| RAG 检索 | 语义搜索 → 关联切片 + 来源文档 + 相似度分数 |
| 课程管理 API | 课程 / 章节 / 知识点的完整 CRUD |
| 文档管理 API | 上传 / 列表 / 详情 / 删除，切片关联知识点 |
| AI 自动提取知识点 | LLM 阅读文档切片 → 自动识别知识点 → 预览确认 → 批量创建并关联切片 |
| 动态配置 | API Key 运行时热替换，前端页面配置即时生效 |

#### 前端

| 页面 | 功能 |
|------|------|
| 仪表盘 | 课程/文档统计、系统状态、快捷导航 |
| 课程管理 | 课程卡片列表、创建/删除 |
| 课程详情 | 工作流步骤引导、章节表格 + 知识点 CRUD |
| 文档上传 | 拖拽上传、格式标签提示、上传后操作引导 |
| 文档列表 | 解析状态展示、详情抽屉（切片查看 + 知识点关联 + AI 自动提取） |
| 知识检索 | 课程选择、语义搜索、结果引用展示 |
| 系统设置 | LLM + Embedding API 配置表单，修改即时生效 |

### 使用流程

```
系统设置（配置 API Key）
  → 创建课程
    → 创建章节
      → 上传对应章节文档
        → AI 自动提取知识点 或 手工创建知识点
          → 关联切片到知识点
            → 知识检索
```

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

---

## 项目结构

```
CnSoftBei/
├── backend/
│   ├── app/
│   │   ├── main.py                    # FastAPI 入口
│   │   ├── core/
│   │   │   ├── config.py              # 全局配置 (Pydantic Settings)
│   │   │   └── database.py            # 异步数据库引擎
│   │   ├── models/
│   │   │   ├── user.py                # 用户模型
│   │   │   ├── course.py              # 课程 / 章节 / 知识点模型
│   │   │   ├── document.py            # 文档 / 切片模型
│   │   │   └── config.py              # 系统配置模型 (API Key 存储)
│   │   ├── schemas/
│   │   │   ├── common.py              # 分页 / 统一响应格式
│   │   │   ├── course.py              # 课程相关 Schema
│   │   │   ├── document.py            # 文档相关 Schema
│   │   │   └── retrieval.py           # 检索相关 Schema
│   │   ├── api/v1/
│   │   │   ├── courses.py             # 课程 / 章节 / 知识点 CRUD
│   │   │   ├── documents.py           # 文档上传 / 提取知识点 / 切片关联
│   │   │   ├── retrieval.py           # RAG 语义检索
│   │   │   └── config.py              # 运行时 API 配置
│   │   └── services/
│   │       ├── document_parser.py     # 多格式文档解析
│   │       ├── chunker.py             # 递归文本切片器
│   │       ├── embedder.py            # Embedding 嵌入生成 (动态配置)
│   │       ├── vector_store.py        # Chroma 向量存储
│   │       ├── retriever.py           # RAG 检索 + 文档处理流水线
│   │       ├── config_service.py      # 动态配置服务 (DB 缓存 + .env 回退)
│   │       └── kp_extractor.py        # AI 知识点自动提取 (LLM)
│   ├── requirements.txt
│   ├── docker-compose.yml             # 开发环境 (备选)
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.tsx                    # 路由表
│   │   ├── main.tsx                   # 应用入口
│   │   ├── components/
│   │   │   ├── layout/                # AppLayout + Sidebar
│   │   │   └── common/                # FileUpload 等通用组件
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx          # 仪表盘
│   │   │   ├── CourseList.tsx         # 课程管理
│   │   │   ├── CourseDetail.tsx       # 课程详情 (工作流步骤 + 章节/知识点)
│   │   │   ├── DocumentUpload.tsx     # 文档上传 (格式标签 + 操作引导)
│   │   │   ├── DocumentList.tsx       # 文档列表 (详情 + 关联 + AI提取)
│   │   │   ├── KnowledgeSearch.tsx    # 知识检索
│   │   │   └── Settings.tsx           # 系统设置 (API 配置)
│   │   ├── services/api.ts            # 后端接口封装
│   │   ├── store/index.ts             # 全局状态 (Zustand)
│   │   └── types/index.ts             # TypeScript 类型定义
│   ├── package.json
│   └── vite.config.ts
├── Need.md                            # 详细需求文档
├── 赛题.md                            # 赛题说明
└── README.md                          # 本文件
```

## 后续阶段规划

| Phase | 内容 |
|-------|------|
| Phase 2 | 对话式画像构建：Profile Agent + 对话信息抽取 + 画像可视化；知识检索结果 LLM 加工优化 |
| Phase 3 | 多智能体资源生成：Coordinator + 5 种资源 Agent + 生成进度追踪 |
| Phase 4 | 学习路径规划 + 智能辅导（RAG 答疑） |
| Phase 5 | 学习评估 + 内容安全过滤 + 事实校验 + UI 优化 |

## 开源协议标注

| 依赖 | License |
|------|---------|
| React | MIT |
| Vite | MIT |
| FastAPI | MIT |
| SQLAlchemy | MIT |
| Chroma | Apache-2.0 |
| Ant Design | MIT |
| ECharts | Apache-2.0 |
| Mermaid | MIT |
