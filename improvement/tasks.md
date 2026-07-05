# AI 个性化学习指导平台 — 任务列表 (v2.1)

> 架构范式: LangGraph StateGraph + 学习导引师向南 + Agent Registry
> 总任务数: 5 (线性依赖)
> 排序: 按实现依赖顺序
> 更新: 2026-07-01 — Agent 名称、审查策略、采风方案均已确认

---

## 任务总览

```
T01 ──► T02 ──► T03 ──► T04 ──► T05
 │        │        │        │        │
 基础设施  数据层   核心Agent  LangGraph  集成交付
 项目骨架  Schema   实现      工作流     路由+联调
```

---

## T01: 项目基础设施

| 属性 | 值 |
|------|-----|
| **ID** | T01 |
| **名称** | 项目基础设施建设 |
| **优先级** | P0 |
| **依赖** | 无 |

### 说明

搭建项目骨架: 依赖声明、目录结构、FastAPI v2 路由注册、Agent Registry 骨架 (Python 代码注册, YAML 留到 Phase 3)、共享服务封装。

### 涉及文件

```
backend/app/api/v2/__init__.py        # v2 API 包初始化
backend/app/api/v2/router.py          # v2 路由聚合 (prefix="/api/v2")
backend/app/api/v2/zhixue.py          # AI智学 端点 (初始仅 health-check)
backend/app/models/zhixue.py          # 数据库模型 (zhixue_sessions 等)
backend/app/schemas/zhixue.py         # Pydantic schemas (复用 improvement/schema.py 中的定义)
backend/app/services/zhixue/__init__.py
backend/app/services/zhixue/state.py  # ZhiXueState TypedDict
backend/app/services/zhixue/agents/__init__.py
backend/app/services/zhixue/agents/base.py  # AgentHandler Protocol
backend/app/services/zhixue/registry/__init__.py
backend/app/services/zhixue/registry/models.py   # AgentRecord Pydantic model
backend/app/services/zhixue/registry/registry.py  # AgentRegistry 类 (Python 代码注册)
backend/app/services/zhixue/registry/agents.yaml  # (Phase 3) YAML 声明
backend/app/services/zhixue/prompts.py  # Agent System Prompts
backend/app/services/zhixue/session_service.py  # 会话 CRUD待实现)

frontend/src/pages/ZhiXueHub.tsx      # 占位页面
frontend/src/pages/ZhiXueSession.tsx  # 占位页面
frontend/src/hooks/useZhiXueSSE.ts    # SSE hook 骨架
frontend/src/components/zhixue/       # 空目录占位
```

### 需修改的现有文件

```
backend/app/main.py                   # +2 行: import api_v2_router, app.include_router
frontend/src/App.tsx                  # +2 行: Route /zhixue, /zhixue/:id
frontend/src/components/layout/Sidebar.tsx  # +1 行: "AI智学 (Beta)" 菜单项
frontend/src/services/api.ts          # 文件底部: v2 API 函数 (初始仅 createZhiXueSession)
frontend/src/types/index.ts           # 文件底部: 新类型定义
```

### 关键产出

- `pyproject.toml` 不变, `requirements.txt` 不变 (新增 `aiosqlite`, 显式加 `pyyaml`)
- `AgentHandler` Protocol 定义完成
- `ZhiXueState` TypedDict 定义完成
- `AgentRegistry` 可用: `register()`, `get()`, `ensure_available()`
- FastAPI `/api/v2/zhixue/health` 可用, `/api/v1/learning` 不受影响
- 前端 `/zhixue` 占位页面可访问

---

## T02: 数据层 — Schema 定义 + 状态管理

| 属性 | 值 |
|------|-----|
| **ID** | T02 |
| **名称** | 数据层: Pydantic Schema + 状态管理 |
| **优先级** | P0 |
| **依赖** | T01 |

### 说明

将所有 Pydantic 数据模型落地为可导入的 Python 模块。从 `improvement/schema.py` 中提取定义, 适配实际项目结构。完善 `ZhiXueState` 的类型标注。

### 涉及文件

```
backend/app/schemas/zhixue.py              # 统一 Schema 文件
  ├── 枚举: MaterialType, SessionStatus, MasteryLevel, ReviewVerdict, QuestionType
  ├── 画像: LearningProfile, KnowledgeLevel, StylePreference
  ├── 计划: LearningPlan, Stage, StageObjective
  ├── 材料: BaseMaterial + 7 种材料子类型
  ├── 审查: QualityReviewReport, PerMaterialReview, L1/L2/L3 检查结果
  ├── 问卷: Questionnaire, Question, QuestionnaireResponse
  ├── 反馈: StageFeedback
  ├── 采风: ResearchReport, ExternalLink, ResearchFinding
  ├── 交付: DeliveryPackage, MaterialSummary
  └── API: StartSessionRequest, SessionHandle, ErrorResponse
backend/app/models/zhixue.py               # DB 模型
  ├── ZhiXueSession, ZhiXueStage, ZhiXueResource
  ├── ZhiXueAgentTask, ZhiXueReview
  ├── ZhiXueQuestionnaire, ZhiXueSearchResult
backend/app/services/zhixue/state.py       # (修改) 使用 Schema 类型完善 State 标注
```

### 关键产出

- 所有 Schema 模块可独立导入, 无循环依赖
- DB 表通过 `Base.metadata.create_all` 与旧表共存创建
- `ZhiXueState` 与全部 Schema 对齐

---

## T03: 核心 Agent 实现

| 属性 | 值 |
|------|-----|
| **ID** | T03 |
| **名称** | 核心 Agent 实现 (11 个 Agent) |
| **优先级** | P0 |
| **依赖** | T02 |

### 说明

实现所有 Agent 的业务逻辑。6 个匠共享基类, 直接复用现有 `resource_generators.py` 中的生成函数。每个 Agent 遵循 `AgentHandler` Protocol。

### 涉及文件

```
backend/app/services/zhixue/agents/yuzhi.py          # 俞知: 问卷生成 + 画像融合
                                                       - 读取 StudentProfile
                                                       - LLM 生成 5-8 题轻量问卷
                                                       - 融合问卷响应 (+ 跳过/超时路径) → LearningProfile

backend/app/services/zhixue/agents/ligang.py          # 李纲: LearningPlan 生成 + DeliveryPackage 汇总
                                                       - 基于 study_pace 动态决定阶段数 (2~20)
                                                       - 复用现有 COORDINATOR_SYSTEM_PROMPT 模式
                                                       - 接受问卷反馈的 difficulty_adjustment
                                                       - 阶段数与粒度的动态调整 (cram: 少而重, steady: 多而轻)

backend/app/services/zhixue/agents/caifeng.py         # 蔡丰: 博查 Search API 网络调研
                                                       - 默认关闭, 用户可选开启
                                                       - 结果按 course 缓存
                                                       - API 不可用时优雅降级

backend/app/services/zhixue/agents/jianzhen.py        # 简真: L1 严格格式校验 + L2/L3 宽松标记
                                                       - L1: 纯规则 (复用 mindmap 标题验证, HTML 闭合检测)
                                                       - L2: RAG 相似度计算
                                                       - L3: LLM 快速逻辑扫描
                                                       - fallback 降级: L1 第3次失败 → 模板内容

backend/app/services/zhixue/agents/crafter_base.py    # 匠基类
backend/app/services/zhixue/agents/crafter_zhangyi.py # 张义: 讲义 (复用 generate_handout)
backend/app/services/zhixue/agents/crafter_tusi.py    # 屠思: 导图 (复用 generate_mindmap)
backend/app/services/zhixue/agents/crafter_xizhen.py  # 习真: 习题 (复用 generate_exercise)
backend/app/services/zhixue/agents/crafter_yuedu.py   # 岳读: 阅读 (复用 generate_reading)
backend/app/services/zhixue/agents/crafter_donghua.py # 董华: 动画 (复用 generate_video_script)
backend/app/services/zhixue/agents/crafter_daima.py   # 戴码: 代码 (复用 generate_coding_practice)
```

### 关键产出

- 俞知可生成 5-8 题轻量问卷 + 融合已有画像
- 李纲可基于 LearningProfile 生成 3~6 阶段的 LearningPlan
- 蔡丰可调用博查 Search API (默认关闭, 可降级)
- 简真完成 L1 严格校验 + L2/L3 宽松标记
- 6 个匠并行独立, 复用现有生成器函数

---

## T04: LangGraph 工作流组装

| 属性 | 值 |
|------|-----|
| **ID** | T04 |
| **名称** | LangGraph StateGraph 组装 |
| **优先级** | P0 |
| **依赖** | T03 |

### 说明

将所有 Agent 节点串联为 LangGraph StateGraph。关键: **从 Day 1 使用 Send API** 做 6 匠并行扇出, 不做 asyncio.gather 过渡。包含补救资源节点 (`craft_remedial`) 和反馈条件路由。

### 涉及文件

```
backend/app/services/zhixue/graph.py    # build_zhixue_graph(): StateGraph 构建 + 编译
                                          - 全节点注册 (含 craft_remedial)
                                          - Send API 并行扇出 (craft_router + remedial_router)
                                          - conditional_edges (stage_entry, review_router, feedback_router)
                                          - interrupt_before=["process_profile", "collect_feedback"]
                                          - aiosqlite Checkpointer 配置

backend/app/services/zhixue/edges.py    # router 函数
                                          - stage_router: has_more_stages? → scout / finalize
                                          - craft_router: Send API 分发 (仅选中材料)
                                          - remedial_router: 补救资源分发 (仅张义+习真, 用户勾选的类型)
                                          - review_router: L1 ALL_PASS → deliver / RETRY → 打回 / MAX_RETRY → fallback
                                          - feedback_router: mastered/partial/skip → next_stage; not_mastered → remedial/next
```

### 关键产出

- `build_zhixue_graph(checkpointer)` 返回编译后的 `CompiledGraph`
- 6 个匠通过 `Send` API 并行扇出, 审查打回时精确路由到失败材料
- 中断点: 问卷填写前 (`process_profile`), 阶段反馈前 (`collect_feedback`)
- 与 T03 的 Agent 函数集成测试

---

## T05: 集成层 — 向南 + FastAPI 路由 + 端到端联调

| 属性 | 值 |
|------|-----|
| **ID** | T05 |
| **名称** | 集成层: 学习导引师向南 + FastAPI 路由 + 端到端联调 |
| **优先级** | P1 |
| **依赖** | T04 |

### 说明

实现向南 (Orchestrator) 的完整逻辑: 入口路由、Registry 验证、Graph 启动/恢复、异常兜底。实现 FastAPI 全部 endpoints。前端完成: 问卷模态框、审查面板、阶段反馈模态框、补救资源选择模态框。

### 涉及文件

```
backend/app/services/zhixue/orchestrator.py    # 向南: Orchestrator 类
                                                 - start_session: 验证 Registry → 构建 State → ainvoke
                                                 - resume_session: Command(resume=...) → ainvoke
                                                 - get_status: aget_state
                                                 - _handle_error: 分类兜底

backend/app/api/v2/zhixue.py                   # 全部 endpoints
                                                 - POST /sessions (创建)
                                                 - POST /sessions/{id}/questionnaire (提交问卷)
                                                 - POST /sessions/{id}/feedback (提交阶段反馈)
                                                 - GET /sessions/{id}/status
                                                 - GET /sessions/{id}/stream (SSE)
                                                 - GET /resources/{id} (资源详情)

backend/app/api/v2/router.py                   # router 注册

frontend/src/pages/ZhiXueHub.tsx               # AI智学 会话列表
frontend/src/pages/ZhiXueSession.tsx           # AI智学 会话页面 (SSE + 资源)
frontend/src/hooks/useZhiXueSSE.ts             # SSE 状态机
frontend/src/components/zhixue/ZhiXueProgress.tsx    # 生成进度 (含问卷/审查/反馈状态)
frontend/src/components/zhixue/QuestionnaireModal.tsx # 问卷模态框 (5-8题, 可跳过)
frontend/src/components/zhixue/ReviewPanel.tsx       # 审查面板 (warning 标记展示)
frontend/src/components/zhixue/FeedbackModal.tsx     # 阶段反馈模态框 (选填)
frontend/src/components/zhixue/RemedialModal.tsx     # 补救资源选择模态框 (□补充讲义 □补充练习)
```

### 关键产出

- 全链路可用: 创建会话 → 问卷 (含 study_pace) → 路径规划 (动态阶段数) → 阶段生成 → 审查 → 交付 → 反馈 ("没掌握"→补救→继续) → 完成
- SSE 事件全覆盖 (含新增 remedial_ready 等事件)
- 异常场景覆盖: Agent 不可用、LLM 超时、蔡丰搜索失败、简真 L1 第3次打回降级
- 旧系统 `/api/v1/learning` 所有功能正常
