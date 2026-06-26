# MLA (Multiple Learning Agent) — 智学引擎

面向高校专业课程的个性化学习资源生成与智能辅导平台。系统通过对话式交互构建多维度学生画像，依托课程知识库与多智能体协同机制，自动生成个性化、多模态学习资源，规划科学的学习路径，并提供即时智能答疑与学习效果评估。

> **中国软件杯大学生软件设计大赛** 参赛项目

---

## 目录

- [项目简介](#项目简介)
- [核心功能](#核心功能)
- [开发进度](#开发进度)
- [技术栈](#技术栈)
- [系统架构](#系统架构)
- [环境要求](#环境要求)
- [快速启动](#快速启动)
- [项目结构](#项目结构)
- [API 文档](#api-文档)
- [开源协议标注](#开源协议标注)

---

## 项目简介

MLA 智学引擎旨在解决高等教育中学生学习资源繁杂无序、难以精准匹配个性化需求的痛点。系统以具体高校专业课程（如操作系统、数据结构、人工智能导论等）为切入点，借助大模型技术、RAG（检索增强生成）、LangGraph 多智能体编排等前沿 AI 技术，为每位学生打造专属的个性化学习智能体。

### 项目价值

- **降低信息筛选成本**：自动从海量课程资料中提取、整理、关联知识点，学生不必手动翻阅大量文档
- **因材施教数字落地**：基于 6+ 维度动态学生画像，为不同基础、不同目标的学生生成差异化的学习内容
- **全流程学习闭环**：画像构建 → 资源生成 → 路径规划 → 学习追踪 → 评估反馈 → 画像更新，形成完整闭环
- **多模态资源覆盖**：讲义文档、思维导图、练习题库、拓展阅读、编程实操、视频动画脚本等至少 5 种资源类型
- **透明可追溯 AI**：所有 AI 生成内容附带课程知识库引用来源，有效降低"幻觉"风险

---

## 核心功能

### 1. 用户与权限系统
- 注册 / 登录 / 退出、密码重置、邮箱验证码
- JWT Token 认证 + 自动刷新

### 2. 对话式学生画像构建
- 通过自然语言对话取代传统表单，自动构建学生画像
- 至少 6 个画像维度：专业背景、知识基础、学习目标、认知风格、学习节奏、薄弱知识点、兴趣方向、资源偏好
- 画像置信度标注、缺失信息追问、随学习行为动态更新
- 可视化展示与手动编辑

### 3. 课程知识库
- 多格式文档上传：PDF、DOCX、PPTX、Markdown、TXT
- 智能文档解析：文本抽取 + 多模态视觉理解（PDF/PPT 逐页渲染）
- 递归文本切片 + Embedding 向量化索引
- LLM 自动知识点提取（分批处理、人工复核、去重）
- 关键词检索 + 向量检索混合召回 + 结果重排序
- 检索结果高亮、内容增强、来源引用展示
- 章节 ↔ 知识点树形结构展示，知识点详情弹窗卡片

### 4. 多智能体协同资源生成（核心）

系统设计了至少 9 种智能体角色协同工作：

| Agent | 职责 |
|-------|------|
| **Coordinator Agent** | 任务总控，拆解需求并分配子任务 |
| **Profile Agent** | 读取与维护学生画像 |
| **Retrieval Agent** | 从知识库检索相关章节、知识点和切片 |
| **Teaching Design Agent** | 设计阶段教学方案与资源生成策略 |
| **Document Agent** | 生成课程讲义文档 |
| **Mind Map Agent** | 生成知识点思维导图（Mermaid 语法） |
| **Exercise Agent** | 生成选择题、填空题、简答题、编程题及解析 |
| **Reading Agent** | 生成拓展阅读材料与文献推荐 |
| **Coding Practice Agent** | 生成实操案例、项目任务和代码模板 |
| **Video Script Agent** | 生成教学视频/动画脚本与分镜 |
| **Safety & Fact Check Agent** | 事实核查、安全过滤、引用校验 |

**编排流程（基于 LangGraph）**：
1. Coordinator Agent 接收学习目标
2. Profile Agent 读取学生画像
3. Retrieval Agent 检索相关资料
4. Teaching Design Agent 设计教学方案
5. 6 种资源并行生成（asyncio.gather）
6. Safety & Fact Check Agent 综合审查
7. Coordinator Agent 汇总结果

### 5. 个性化学习路径规划
- 基于画像和知识点依赖关系动态规划学习路径
- 分阶段（Stage）递进式学习，每阶段包含完整的资源包
- 学习路径可视化展示（抽屉式阶段路线图）
- 支持中断恢复：学习状态自动保存，下次进入无缝衔接
- 阶段完成自动触发下一阶段资源生成

### 6. AI 对话与智能辅导
- 基于课程知识库的 RAG 智能问答
- 流式 SSE 输出，Markdown / HTML 混合渲染
- 回答强制附带知识库引用来源
- 支持代码高亮、数学公式（KaTeX）、表格、Mermaid 图表
- 全局浮动 AI 虚拟形象（Live2D）+ 语音朗读（TTS）

### 7. 艾宾浩斯复习系统
- 基于遗忘曲线的智能复习调度
- 自动生成复习任务并推送提醒
- 去重机制避免重复复习

### 8. 仪表盘与分析
- 今日待办看板
- 本周学习情况统计（柱状图可视化）
- 收藏课程快速入口
- 真实数据统计（切片数、知识点数等）

### 9. 学习效果评估
- 知识点掌握度评估
- 练习正确率追踪
- 薄弱点变化分析
- 学习报告生成

---

## 技术栈

### 后端

| 技术 | 用途 |
|------|------|
| Python FastAPI | 主框架，异步非阻塞，原生 SSE 支持，自动生成 OpenAPI 文档 |
| SQLAlchemy 2.0 (async) | 异步 ORM，配合 asyncpg 驱动 |
| PostgreSQL 17 + pgvector | 业务数据库 + 向量检索 |
| Chroma | 向量数据库（本地持久化，轻量开发方案） |
| Redis 7+ | 缓存服务 |
| Celery | 异步任务队列 |
| LangGraph | 多智能体编排，定义 Agent 协作的有向图 |
| OpenAI / DeepSeek API | 大语言模型（对话、资源生成、画像抽取） |
| text-embedding-3-small | 文本 Embedding 模型（文档向量化） |
| PyMuPDF / python-docx / python-pptx | 多格式文档解析 |
| Pydantic + Pydantic Settings | 数据校验与配置管理 |
| JWT (python-jose) + bcrypt | 认证与安全 |
| Loguru | 日志 |

### 前端

| 技术 | 用途 |
|------|------|
| React 19 + TypeScript | 核心框架 |
| Vite 8 | 构建工具（极速 HMR） |
| Ant Design 6 | UI 组件库 |
| Tailwind CSS 4 | 原子化样式 |
| Zustand | 轻量级状态管理 |
| React Router 7 | 路由 |
| Axios | HTTP 请求 |
| react-markdown + remark-gfm | Markdown 渲染（含 GFM 表格、任务列表） |
| rehype-highlight | 代码语法高亮 |
| rehype-katex + remark-math | 数学公式渲染 |
| Recharts | 数据可视化图表 |
| Mermaid (l2d-widget) | 思维导图、流程图渲染 / Live2D 虚拟形象 |

### 基础设施

| 技术 | 用途 |
|------|------|
| Docker + Docker Compose | 开发环境容器化（PostgreSQL + Redis 一键拉起） |
| Uvicorn | ASGI 服务器 |

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      前端 SPA (React 19 + Vite)               │
│         Ant Design 6 + Tailwind CSS 4 + Zustand              │
│   Dashboard │ 课程管理 │ AI对话 │ 画像 │ 学习中心 │ 管理后台   │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTP/SSE
┌─────────────────────────┴───────────────────────────────────┐
│                  后端 API (FastAPI + Uvicorn)                  │
│                       /api/v1/* (REST + SSE)                 │
│  Auth │ Courses │ Documents │ Retrieval │ Chat │ Profile     │
│  Learning │ Todos │ TTS │ Review │ Stats │ Admin            │
└──────┬──────────────────────────────────────────────────────┘
       │
┌──────┴──────────────────────────────────────────────────────┐
│                  AI 编排服务 (LangGraph)                       │
│  Coordinator → Profile → Retrieval → TeachingDesign         │
│  → [Handout ∥ MindMap ∥ Exercise ∥ Reading ∥ Coding ∥ Video] │
│  → Safety&FactCheck → Summary                                │
└──────┬──────────────────────────────────────────────────────┘
       │
┌──────┴──────────────────────────────────────────────────────┐
│                      数据层                                   │
│  PostgreSQL 17     Chroma         Redis 7                    │
│  (业务数据+向量)    (向量存储)      (缓存/任务队列)              │
└─────────────────────────────────────────────────────────────┘
```

**数据流核心路径**：
1. 学生上传课程资料 → 文档解析 → 文本切片 → Embedding → Chroma 向量存储
2. 学生对话画像 → Profile Agent 抽取维度 → PostgreSQL 存储
3. 发起学习 → Coordinator 拆解任务 → Knowledge Retrieval 检索 → 各 Agent 并行生成资源 → SSE 推送进度
4. 学生学习、练习 → 行为数据采集 → Assessment Agent 评估 → 画像更新 → 下一阶段资源调整

---

## 环境要求

| 依赖 | 最低版本 | 说明 |
|------|---------|------|
| Python | 3.11+ | 后端运行环境 |
| Node.js | 20+ | 前端构建与开发 |
| PostgreSQL | 16+ (推荐 17) | 需启用 pgvector 扩展 |
| Redis | 7+ | 缓存与任务队列 |
| Git | 2.0+ | 代码版本管理 |

### LLM 与 Embedding API

系统需配置至少两类大模型 API：

| 用途 | 推荐方案 | 说明 |
|------|---------|------|
| **LLM**（对话、资源生成、画像） | DeepSeek / 智谱 GLM / 通义千问 / OpenAI | 支持 OpenAI 兼容接口即可 |
| **Embedding**（文档向量化、语义检索） | text-embedding-3-small / 智谱 Embedding | 支持 OpenAI 兼容接口即可 |
| **文档解析**（可选，PDF/PPTX 视觉理解） | gpt-4o-mini / qwen-vl-plus | 多模态模型，未配置时降级为传统解析 |

> **注**：配置项通过前端"系统设置"页面或 `backend/.env` 文件动态生效，无需重启服务。

---

## 快速启动

### macOS（推荐）

#### 1. 克隆项目

```bash
git clone https://github.com/Faye-bit/MLA_CnSoftBei.git
cd MLA_CnSoftBei
```

#### 2. 安装基础服务

```bash
# 安装 PostgreSQL、Redis、pgvector
brew install postgresql@17 redis pgvector

# 复制 pgvector 扩展到 PostgreSQL
cp /opt/homebrew/opt/pgvector/share/postgresql@17/extension/* \
   /opt/homebrew/opt/postgresql@17/share/postgresql/extension/
cp /opt/homebrew/opt/pgvector/lib/postgresql@17/vector.dylib \
   /opt/homebrew/opt/postgresql@17/lib/postgresql/

# 启动服务
brew services start postgresql@17
brew services start redis
```

#### 3. 创建数据库

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

#### 4. 安装 Python 依赖

```bash
cd backend
pip install -r requirements.txt

# 国内用户可添加清华镜像加速
# pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

#### 5. 配置 API Key

**方式一：通过前端页面配置（推荐）**
启动后访问 `http://localhost:5173/settings`，直接填入 API Key，即时生效。

**方式二：编辑 .env 文件**
```bash
cd backend
# 编辑 .env 文件，配置以下关键项：
# LLM_API_KEY=your-llm-api-key
# LLM_API_BASE=https://api.deepseek.com
# LLM_MODEL=deepseek-chat
# EMBEDDING_API_KEY=your-embedding-api-key
# EMBEDDING_API_BASE=https://api.openai.com/v1
# EMBEDDING_MODEL=text-embedding-3-small
```

#### 6. 一键启动

```bash
# 在项目根目录执行
./start.sh
```

启动后：
- 前端页面：http://localhost:5173
- API 文档 (Swagger)：http://localhost:8000/docs
- API 文档 (ReDoc)：http://localhost:8000/redoc
- 健康检查：http://localhost:8000/health

#### 7. 停止项目

```bash
./stop.sh
```

### Windows

#### 1. 安装基础服务

**PostgreSQL 17 + pgvector**

1. 从 [EnterpriseDB](https://www.enterprisedb.com/downloads/postgres-postgresql-downloads) 下载并安装 PostgreSQL 17
2. 安装过程中记录设置的 `postgres` 用户密码
3. 安装完成后，用 Stack Builder 安装 pgvector 扩展（勾选 "pgvector"）
4. 或手动编译 pgvector：
   ```powershell
   git clone https://github.com/pgvector/pgvector.git
   cd pgvector
   set "PGROOT=C:\Program Files\PostgreSQL\17"
   nmake /F Makefile.win
   nmake /F Makefile.win install
   ```

**Redis**

Redis 官方不直接支持 Windows。推荐以下方案：
- **方案 A**：安装 [Memurai](https://www.memurai.com/get-memurai)（Redis Windows 兼容替代）
- **方案 B**：在 WSL 中安装 Redis
- **方案 C**：使用 Docker Desktop 运行 `docker run -d -p 6379:6379 redis:7-alpine`

#### 2. 创建数据库

打开 **SQL Shell (psql)**，连接后执行：

```sql
CREATE USER mla WITH PASSWORD 'mla123';
CREATE DATABASE mla_db OWNER mla;
\c mla_db
CREATE EXTENSION IF NOT EXISTS vector;
GRANT ALL PRIVILEGES ON DATABASE mla_db TO mla;
GRANT ALL ON SCHEMA public TO mla;
```

#### 3. Python 依赖与配置

同上 macOS 的第 4、5 步。

#### 4. 启动后端

```bash
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

#### 5. 启动前端

```bash
cd frontend
npm install
npm run dev
```

### Docker（备选）

后端目录提供了 `docker-compose.yml`，可一键启动 PostgreSQL + Redis：

```bash
cd backend
docker-compose up -d
```

---

## 项目结构

```
CnSoftBei/
├── start.sh                                # 一键启动脚本
├── stop.sh                                 # 一键停止脚本
├── CLAUDE.md                               # 项目编码规范与 AI 辅助开发指南
├── 赛题.md                                  # 比赛赛题说明
├── branding/                               # 品牌素材 (Logo、品牌指南)
├── docs/
│   ├── Need.md                             # 详细需求文档
│   ├── DataBase.md                         # 数据库结构设计文档
│   └── schema.sql                          # 数据库初始化 SQL
│
├── backend/                                # 后端项目目录
│   ├── .env                                # 环境变量配置 (API Key 等)
│   ├── requirements.txt                    # Python 依赖清单
│   ├── docker-compose.yml                  # Docker 开发环境 (PostgreSQL + Redis)
│   ├── schema.sql                          # 数据库建表 SQL
│   ├── schema_rebuild.sql                  # 数据库重建 SQL
│   ├── expire_all_reviews.py               # 复习任务管理脚本
│   └── app/
│       ├── main.py                         # FastAPI 应用入口 + 生命周期管理
│       ├── core/
│       │   ├── config.py                   # 全局配置 (Pydantic Settings)
│       │   └── database.py                 # 异步数据库引擎 + 会话工厂
│       ├── models/                         # SQLAlchemy ORM 模型
│       │   ├── __init__.py                 # 模型注册
│       │   ├── user.py                     # 用户表 (User)
│       │   ├── course.py                   # 课程 / 章节 / 知识点 (Course/Chapter/KnowledgePoint)
│       │   ├── document.py                 # 文档 / 切片 (Document/DocumentChunk)
│       │   ├── document_page.py            # PDF/PPTX 页面级索引 (DocumentPage/PageKnowledgePoint)
│       │   ├── conversation.py             # 对话 / 消息 (Conversation/Message)
│       │   ├── profile.py                  # 学生画像 (StudentProfile)
│       │   ├── learning.py                 # 学习会话 / 阶段 / 资源 / Agent 任务 (4 张表)
│       │   ├── review.py                   # 学习记录 / 艾宾浩斯复习计划 (LearningRecord/ReviewSchedule)
│       │   ├── todo.py                     # 待办事项 (Todo)
│       │   ├── config.py                   # 系统配置 (API Key 等运行时配置)
│       │   ├── audit_log.py                # 审计日志 (AuditLog)
│       │   └── email_verification.py       # 邮箱验证 (EmailVerification)
│       ├── schemas/                        # Pydantic 请求/响应 Schema
│       │   ├── common.py                   # 分页 / 统一响应格式
│       │   ├── auth.py                     # 认证相关
│       │   ├── user.py                     # 用户相关
│       │   ├── course.py                   # 课程相关
│       │   ├── document.py                 # 文档相关
│       │   ├── retrieval.py                # 检索相关
│       │   ├── conversation.py             # 对话相关
│       │   ├── profile.py                  # 画像相关
│       │   ├── learning.py                 # 学习会话相关
│       │   ├── review.py                   # 复习相关
│       │   ├── audit_log.py                # 审计日志相关
│       │   └── todo.py                     # 待办相关
│       ├── api/v1/                         # REST API 接口 (v1)
│       │   ├── router.py                   # 路由聚合
│       │   ├── auth.py                     # POST /auth/register, /auth/login, /auth/refresh
│       │   ├── users.py                    # GET/PUT /users (用户管理)
│       │   ├── courses.py                  # CRUD /courses (课程/章节/知识点管理)
│       │   ├── documents.py                # POST /documents/upload (文档上传/解析/知识点提取)
│       │   ├── retrieval.py                # POST /retrieval (RAG 语义检索)
│       │   ├── chat.py                     # POST /chat/send (流式 SSE 对话)
│       │   ├── profile.py                  # POST/GET /profile (学生画像构建与管理)
│       │   ├── learning.py                 # POST/GET /learning (学习会话/阶段/资源生成)
│       │   ├── todos.py                    # CRUD /todos (待办事项)
│       │   ├── tts.py                      # POST /tts/synthesize (语音合成)
│       │   ├── review.py                   # GET/POST /review (艾宾浩斯复习)
│       │   ├── config.py                   # GET/PUT /config (运行时配置)
│       │   ├── stats.py                    # GET /stats (仪表盘统计数据)
│       │   └── audit_logs.py               # GET /audit-logs (审计日志)
│       └── services/                       # 业务服务层
│           ├── document_parser.py          # 多格式文档解析 (PDF/DOCX/PPTX/MD/TXT)
│           ├── page_parser.py              # PDF/PPTX 逐页渲染 + 多模态视觉理解
│           ├── chunker.py                  # 递归文本切片器
│           ├── embedder.py                 # Embedding 嵌入生成
│           ├── vector_store.py             # Chroma 向量存储管理
│           ├── retriever.py                # RAG 检索流水线 (混合召回 + 重排序)
│           ├── text_normalizer.py          # 文本规范化 (去页码/合并断行/空白规范化)
│           ├── content_enhancer.py         # LLM 内容增强 (二次加工/关键词标注/归并去重)
│           ├── config_service.py           # 动态配置服务 (DB 缓存 + .env 回退)
│           ├── kp_extractor.py             # AI 知识点自动提取 (LLM 分批 + 去重)
│           ├── page_kp_service.py          # 页面级知识点关联服务
│           ├── chat_service.py             # AI 对话服务 (RAG 上下文 + 流式输出)
│           ├── profile_service.py          # 学生画像服务 (抽取/补全/更新)
│           ├── audit_service.py            # 审计日志记录服务
│           ├── email_service.py            # 邮件验证码发送服务
│           ├── tts_service.py              # 语音合成服务 (火山引擎 seed-tts-2.0)
│           └── learning/                   # Phase 3 多智能体学习模块
│               ├── agent_orchestrator.py   # LangGraph 多智能体编排器 (7 步流水线)
│               └── resource_generators.py  # 6 种资源并行生成器
│
├── frontend/                               # 前端项目目录
│   ├── package.json                        # 依赖与脚本
│   ├── vite.config.ts                      # Vite 构建配置 + API 代理
│   ├── index.html                          # HTML 入口
│   ├── tsconfig.json                       # TypeScript 配置
│   ├── public/
│   │   ├── brand/                          # 品牌静态资源 (Logo SVG)
│   │   ├── models/                         # Live2D 模型文件 (Haru/Hiyori/Mao 等)
│   │   └── CubismSdkForWeb-5-r.5/         # Live2D SDK
│   └── src/
│       ├── App.tsx                         # 路由表 (React Router 7 + Lazy Loading)
│       ├── main.tsx                        # 应用入口
│       ├── components/
│       │   ├── layout/
│       │   │   ├── AppLayout.tsx           # 主布局 (侧边栏 + 顶栏 + 内容区)
│       │   │   └── Sidebar.tsx             # 侧边导航栏
│       │   ├── auth/                       # 登录 / 注册 / 密码重置表单组件
│       │   │   ├── ProtectedRoute.tsx      # 登录保护路由
│       │   │   ├── AdminRoute.tsx          # 管理员权限路由
│       │   │   └── GuestRoute.tsx          # 访客路由 (自动跳转)
│       │   ├── chat/                       # AI 对话消息组件 (流式渲染 + 引用展示)
│       │   ├── dashboard/                  # 仪表盘组件 (待办/统计/收藏)
│       │   ├── learning/                   # Phase 3 学习模块组件
│       │   │   └── GenerationProgress.tsx  # 资源生成进度组件
│       │   ├── profile/                    # 画像展示与编辑组件
│       │   ├── common/                     # 通用复用组件
│       │   └── avatar/                     # AI 虚拟形象组件 (Live2D)
│       ├── pages/
│       │   ├── Dashboard.tsx               # 首页仪表盘
│       │   ├── Login.tsx                   # 登录页
│       │   ├── Register.tsx                # 注册页
│       │   ├── PasswordReset.tsx           # 密码重置页
│       │   ├── CourseList.tsx              # 课程管理列表
│       │   ├── CourseDetail.tsx            # 课程详情 (树形章节/知识点 + 弹窗卡片)
│       │   ├── DocumentList.tsx            # 文档管理 (上传/解析/关联/AI提取)
│       │   ├── KnowledgeSearch.tsx         # 知识检索页 (高亮 + 增强卡片)
│       │   ├── Chat.tsx                    # AI 对话页 (流式 SSE + 引用来源)
│       │   ├── Profile.tsx                 # 画像构建对话页
│       │   ├── ProfileCollection.tsx       # 画像维度可视化
│       │   ├── StudentProfile.tsx          # 学生画像展示与编辑
│       │   ├── LearningHub.tsx             # 学习中心 (新建/继续课程学习)
│       │   ├── LearningSession.tsx         # 学习会话页 (资源浏览器 + 路线图抽屉)
│       │   ├── Settings.tsx                # 系统设置页 (API Key 等运行时配置)
│       │   └── admin/
│       │       ├── UserManagement.tsx      # 用户管理 (管理员)
│       │       └── AuditLogs.tsx           # 操作日志审计 (管理员)
│       ├── services/
│       │   └── api.ts                      # Axios 实例 + 所有后端接口封装
│       ├── store/
│       │   ├── index.ts                    # 全局状态 (Zustand Store)
│       │   └── auth.ts                     # 认证状态管理
│       ├── types/
│       │   └── index.ts                    # TypeScript 公共类型定义
│       ├── utils/                          # 工具函数
│       ├── styles/                         # 全局样式
│       └── assets/                         # 静态资源导入
```

---

## API 文档

启动后端后，访问以下地址查看交互式 API 文档：

| 文档 | 地址 |
|------|------|
| Swagger UI | http://localhost:8000/docs |
| ReDoc | http://localhost:8000/redoc |

### API 路由总览

所有 API 均以 `/api/v1` 为前缀，主要路由模块：

| 路由组 | 路径前缀 | 说明 |
|--------|---------|------|
| 认证 | `/api/v1/auth` | 注册、登录、Token 刷新、密码重置 |
| 用户 | `/api/v1/users` | 用户信息查询与修改 |
| 课程 | `/api/v1/courses` | 课程/章节/知识点 CRUD |
| 文档 | `/api/v1/documents` | 文档上传、解析、知识点提取 |
| 检索 | `/api/v1/retrieval` | RAG 语义检索 |
| 对话 | `/api/v1/chat` | AI 对话（流式 SSE） |
| 画像 | `/api/v1/profile` | 学生画像构建与管理 |
| 学习 | `/api/v1/learning` | 学习会话/阶段/资源生成 |
| 待办 | `/api/v1/todos` | 待办事项管理 |
| 语音 | `/api/v1/tts` | TTS 语音合成 |
| 复习 | `/api/v1/review` | 艾宾浩斯复习计划 |
| 配置 | `/api/v1/config` | 运行时系统配置 |
| 统计 | `/api/v1/stats` | 仪表盘统计数据 |
| 审计 | `/api/v1/audit-logs` | 操作日志查询（管理员） |

---

## 开源协议标注

| 依赖 | License | 用途 |
|------|---------|------|
| React | MIT | 前端框架 |
| Vite | MIT | 前端构建工具 |
| FastAPI | MIT | 后端 Web 框架 |
| SQLAlchemy | MIT | 数据库 ORM |
| Pydantic | MIT | 数据校验 |
| LangChain / LangGraph | MIT | AI Agent 编排 |
| Chroma | Apache-2.0 | 向量数据库 |
| Ant Design | MIT | UI 组件库 |
| Mermaid | MIT | 图表渲染 |
| Tailwind CSS | MIT | 原子化 CSS |
| ECharts / Recharts | Apache-2.0 / MIT | 数据可视化 |
| Zustand | MIT | 状态管理 |
| python-jose | MIT | JWT 处理 |
| Redis-py | MIT | Redis 客户端 |
| Loguru | MIT | 日志 |
| PyMuPDF | AGPL / 商用许可 | PDF 文档解析 |
| python-docx | MIT | DOCX 文档解析 |
| python-pptx | MIT | PPTX 文档解析 |

> 本项目使用的大模型服务：DeepSeek（对话生成 / 画像抽取）、OpenAI（Embedding 向量化）、火山引擎（TTS 语音合成）。

