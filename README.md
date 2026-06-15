# MLA — 多学助手

面向高校专业课程的个性化学习资源生成与智能辅导平台。系统通过对话式交互构建学生画像，基于课程知识库和多智能体协同机制，为学生生成个性化、多模态学习资源、学习路径、练习题与答疑内容。

> 中国软件杯大学生软件设计大赛参赛项目

---

## 开发进度

| 阶段 | 内容 | 状态 |
|------|------|------|
| 第一阶段 | 基础框架与课程知识库 | ✅ 已完成 |
| 第二阶段 | 画像与对话 | ✅ 已完成 |
| 第三阶段 | 多智能体资源生成 | 🚧 进行中 |
| 第四阶段 | 学习路径与智能辅导 | 📋 待开始 |
| 第五阶段 | 评估、安全与展示优化 | 📋 待开始 |

### 已实现功能

- **用户系统**：注册/登录/退出、密码重置、邮箱验证、JWT Token 自动刷新
- **课程管理**：课程/章节 CRUD，知识点树形分类展示
- **文档知识库**：多格式文档上传（PDF/DOCX/PPTX/MD/TXT）、自动解析切片、向量化索引
- **AI 知识点提取**：LLM 自动识别知识点，分批处理，人工复核编辑，去重后批量创建
- **知识点详情弹窗**：点击知识点弹出卡片，展示关联页面与结构化内容
- **RAG 语义检索**：关键词 + 向量混合检索，结果高亮、去重归并、内容增强
- **AI 对话**：基于知识库的智能问答，输出关联引用来源，Markdown/HTML 混合渲染
- **学生画像**：对话式信息收集，自动抽取画像维度，可视化展示与编辑
- **仪表盘**：真实数据统计（切片数、知识点数等）

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

### 7. 关闭项目

| 服务          | 关闭方式                               |
|-------------|------------------------------------|
| 后端（unicorn） | 终端按`Ctrl+C`                        |
| 前端（Vite）    | 终端按`Ctrl+C`                        |
| PostgreSQL  | `brew services stop postgresql@17` |
| Redis       | `brew services stop redis`          |

前端和后端是前台进程，直接 Ctrl+C 就停了。
PostgreSQL 和 Redis 是后台服务，即使关掉终端也不会停，需要用 `brew services stop` 或 `brew services stop --all` 一次性停掉所有后台服务。

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
| Markdown 渲染 | react-markdown + remark-gfm + rehype-highlight | 代码高亮、表格、公式支持 |
| 认证 | JWT + bcrypt | Token 认证 + 自动刷新 |

---

## 项目结构

```
CnSoftBei/
├── backend/
│   ├── app/
│   │   ├── main.py                       # FastAPI 入口
│   │   ├── core/
│   │   │   ├── config.py                 # 全局配置 (Pydantic Settings)
│   │   │   └── database.py               # 异步数据库引擎
│   │   ├── models/
│   │   │   ├── user.py                   # 用户模型
│   │   │   ├── course.py                 # 课程 / 章节 / 知识点模型
│   │   │   ├── document.py               # 文档 / 切片模型
│   │   │   ├── document_page.py          # 文档页面模型 (PDF/PPTX 页级索引)
│   │   │   ├── conversation.py           # 对话消息模型
│   │   │   ├── profile.py                # 学生画像模型
│   │   │   ├── audit_log.py              # 审计日志模型
│   │   │   ├── email_verification.py     # 邮箱验证模型
│   │   │   └── config.py                 # 系统配置模型 (API Key 存储)
│   │   ├── schemas/
│   │   │   ├── common.py                 # 分页 / 统一响应格式
│   │   │   ├── auth.py                   # 认证相关 Schema
│   │   │   ├── user.py                   # 用户相关 Schema
│   │   │   ├── course.py                 # 课程相关 Schema
│   │   │   ├── document.py               # 文档相关 Schema
│   │   │   ├── retrieval.py              # 检索相关 Schema
│   │   │   ├── conversation.py           # 对话相关 Schema
│   │   │   ├── profile.py                # 画像相关 Schema
│   │   │   └── audit_log.py              # 审计日志 Schema
│   │   ├── api/v1/
│   │   │   ├── router.py                 # 路由注册
│   │   │   ├── auth.py                   # 注册 / 登录 / Token 刷新
│   │   │   ├── users.py                  # 用户信息管理
│   │   │   ├── courses.py                # 课程 / 章节 / 知识点 CRUD
│   │   │   ├── documents.py              # 文档上传 / 提取知识点 / 切片关联
│   │   │   ├── retrieval.py              # RAG 语义检索
│   │   │   ├── chat.py                   # AI 对话 (流式 SSE)
│   │   │   ├── profile.py                # 学生画像构建与管理
│   │   │   ├── config.py                 # 运行时 API 配置
│   │   │   ├── stats.py                  # 仪表盘统计数据
│   │   │   └── audit_logs.py             # 审计日志查询
│   │   └── services/
│   │       ├── document_parser.py        # 多格式文档解析
│   │       ├── page_parser.py            # PDF/PPTX 页面级解析
│   │       ├── chunker.py                # 递归文本切片器
│   │       ├── embedder.py               # Embedding 嵌入生成 (动态配置)
│   │       ├── vector_store.py           # Chroma 向量存储
│   │       ├── retriever.py              # RAG 检索 + 文档处理流水线
│   │       ├── text_normalizer.py        # 文本规范化 (去页码/合并断行)
│   │       ├── content_enhancer.py       # LLM 内容增强 (二次加工)
│   │       ├── config_service.py         # 动态配置服务 (DB 缓存 + .env 回退)
│   │       ├── kp_extractor.py           # AI 知识点自动提取 (LLM)
│   │       ├── page_kp_service.py        # 页面级知识点关联服务
│   │       ├── chat_service.py           # AI 对话服务
│   │       ├── profile_service.py        # 学生画像服务
│   │       ├── audit_service.py          # 审计日志服务
│   │       └── email_service.py          # 邮件验证服务
│   ├── requirements.txt
│   ├── docker-compose.yml                # 开发环境 (备选)
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.tsx                       # 路由表
│   │   ├── main.tsx                      # 应用入口
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── AppLayout.tsx         # 主布局 (侧边栏 + 顶栏 + 内容区)
│   │   │   │   └── Sidebar.tsx           # 侧边导航栏
│   │   │   ├── auth/                     # 登录/注册/密码重置表单
│   │   │   ├── chat/                     # 对话消息组件
│   │   │   ├── profile/                  # 画像展示组件
│   │   │   ├── common/                   # 通用组件
│   │   │   ├── EnhancedResultCard.tsx    # 检索结果增强卡片
│   │   │   └── MarkdownRenderer.tsx      # Markdown/HTML 混合渲染器
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx             # 仪表盘
│   │   │   ├── Login.tsx                 # 登录页
│   │   │   ├── Register.tsx              # 注册页
│   │   │   ├── PasswordReset.tsx         # 密码重置页
│   │   │   ├── CourseList.tsx            # 课程管理
│   │   │   ├── CourseDetail.tsx          # 课程详情 (树形章节/知识点 + 弹窗卡片)
│   │   │   ├── DocumentList.tsx          # 文档列表 (详情 + 关联 + AI提取)
│   │   │   ├── KnowledgeSearch.tsx       # 知识检索 (高亮 + 增强卡片)
│   │   │   ├── Chat.tsx                  # AI 对话 (流式 SSE + 引用来源)
│   │   │   ├── Profile.tsx              # 画像构建对话页
│   │   │   ├── StudentProfile.tsx        # 学生画像展示与编辑
│   │   │   ├── ProfileCollection.tsx     # 画像维度可视化
│   │   │   ├── Settings.tsx              # 系统设置 (API 配置)
│   │   │   └── admin/                    # 管理后台页面
│   │   ├── services/
│   │   │   └── api.ts                    # 后端接口封装
│   │   ├── store/
│   │   │   ├── index.ts                  # 全局状态 (Zustand)
│   │   │   └── auth.ts                   # 认证状态管理
│   │   └── types/
│   │       └── index.ts                  # TypeScript 类型定义
│   ├── package.json
│   └── vite.config.ts
├── CLAUDE.md                             # 项目编码规范
├── Need.md                               # 详细需求文档
├── 赛题.md                               # 赛题说明
├── DataBase.md                           # 数据库结构文档
├── TODO.md                               # 待办任务清单
└── README.md                             # 本文件
```

---

## 测试账号

| 邮箱 | 密码 |
|------|------|
| 3285337942@qq.com | 20060605 |

---

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
