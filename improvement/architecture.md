# AI 个性化学习指导平台 — 系统架构设计文档

> 版本：v2.2 (动态阶段划分 + 补救资源方案已确认)
> 架构范式：LangGraph StateGraph + 学习导引师（向南）+ Agent Registry
> 状态：方案已确认, 待实施

---

## 目录

1. [实现方案与框架选型](#1-实现方案与框架选型)
2. [Agent 命名与职能](#2-agent-命名与职能)
3. [LangGraph StateGraph 设计](#3-langgraph-stategraph-设计)
4. [学习导引师向南 协调机制](#4-学习导引师向南-协调机制)
5. [Agent Registry 设计](#5-agent-registry-设计)
6. [Agent 数据契约](#6-agent-数据契约)
7. [中断与恢复机制](#7-中断与恢复机制)
8. [审查体系](#8-审查体系)
9. [轻量问卷系统](#9-轻量问卷系统)
10. [采风网络搜索](#10-采风网络搜索)
11. [阶段反馈系统](#11-阶段反馈系统)
12. [FastAPI 集成](#12-fastapi-集成)
13. [与现有 AI助学 的共存方案](#13-与现有-ai助学-的共存方案)
14. [项目文件结构](#14-项目文件结构)

---

## 1. 实现方案与框架选型

### 1.1 核心技术选型

| 技术项 | 选择 | 版本 | 理由 |
|--------|------|------|------|
| 工作流引擎 | **LangGraph** | ≥1.2.5 (已有) | 原生支持 StateGraph + conditional_edges + Send API + Checkpointer 持久化 |
| 状态持久化 | **LangGraph Checkpointer (aiosqlite)** + PostgreSQL ORM | SQLite (运行时) / PostgreSQL (业务数据) | Checkpointer 管运行时状态, PostgreSQL 管持久化业务数据 |
| Web 框架 | **FastAPI** | 已有 | 异步原生支持, `StreamingResponse` + `AsyncGenerator` 实现 SSE, 无需额外依赖 |
| 数据校验 | **Pydantic** | v2.x | LangGraph State 的类型基础 |
| LLM 调用 | **OpenAI 兼容接口** | — | 复用现有 `create_llm_client()` / `parse_json_output()` |
| 向量数据库 | **已有模块** | — | 直接调用现有 RAG 接口 `rag_retrieve()` |
| 用户画像 | **已有模块** | — | 直接查询 `StudentProfile` 表 |
| 网络检索 | **博查 Search API 等** | — | 采风搜索后端, 可配置切换, 不限定单一服务 |
| 日志/追踪 | **Loguru** (已有) | — | 复用现有日志体系 |

### 1.2 设计原则

1. **StateGraph 驱动阶段内流转**：`conditional_edges` 实现 L1 审查打回路由, `Send` API 实现 6 匠并行扇出
2. **学习导引师向南 只管入口，不管步骤**：只做"启动哪个图、出错了怎么办"，不参与 `并行资源生成 → 资源审查 → 资源交付` 的内部调度
3. **Agent 即函数**：每个 Agent 是 `async def agent(state: State) -> dict` 的纯函数
4. **Registry 驱动扩展**：新增 Agent = 注册一条记录 + 加一个 Graph 节点, 向南自动感知
5. **向后兼容**：与旧 AI助学 代码完全隔离, SSE 事件类型增量扩展

---

## 2. Agent 命名与职能

格式: **职能 + 真实人名**, 谐音/近义关联便于记忆。

### 2.1 完整 Agent 列表 (11 个)

| 名称 | 英文 key | 角色 | 职责 |
|---|---|---|---|
| **学习导引师向南** | `orchestrator` | 总协调 | 接收请求 → 读 Registry → 启动 Graph → 异常兜底 → 状态查询 |
| **学情诊断师俞知** | `profile_analyst` | 画像分析 | 读取 StudentProfile → 生成轻量问卷 → 融合画像 → LearningProfile |
| **教纲设计专家李纲** | `path_planner` | 路径规划 | 基于 LearningProfile 生成阶段性 LearningPlan + 汇总交付 |
| **资源采集师蔡丰** | `resource_scout` | 网络调研 | 博查 API 搜索 → ResearchReport + 外部链接 (默认开启，可关闭) |
| **讲义编写师张义** | `crafter_handout` | 资源生成 | 生成课程讲义 (Markdown) |
| **导图设计师屠思** | `crafter_mindmap` | 资源生成 | 生成思维导图 (Markdown 标题层级) |
| **习题设计师习真** | `crafter_exercise` | 资源生成 | 生成练习题 (JSON) |
| **阅读推荐师岳读** | `crafter_reading` | 资源生成 | 生成拓展阅读 (Markdown) |
| **动画制作师董华** | `crafter_animation` | 资源生成 | 生成交互动画 (自包含 HTML)，默认不生成，可选生成 |
| **代码实操师戴码** | `crafter_code` | 资源生成 | 生成编程实操 (Markdown + 代码块)，默认不生成，可选生成 |
| **质量审核师简真** | `quality_reviewer` | 质量审查 | L1 格式严格校验 → L2/L3 内容宽松标记 |

### 2.2 命名映射 (与旧代号对照)

| 旧代号 | 新名称 |
|---|---|
| 司南 | 学习导引师向南 |
| 知渔 | 学情诊断师俞知 |
| 筑径 | 教纲设计专家李纲 |
| 采风 | 资源采集师蔡丰 |
| 匠·讲义 | 讲义编写师张义 |
| 匠·导图 | 导图设计师屠思 |
| 匠·习题 | 习题设计师习真 |
| 匠·阅读 | 阅读推荐师岳读 |
| 匠·动画 | 动画制作师董华 |
| 匠·代码 | 代码实操师戴码 |
| 鉴真 | 质量审核师简真 |

---

## 3. LangGraph StateGraph 设计

### 3.1 State 定义

```python
from typing import TypedDict, Annotated, Optional
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage

class ZhiXueState(TypedDict, total=False):
    # ── 会话标识 ──
    session_id: str
    course_id: str
    user_id: str

    # ── 消息历史 (LangGraph 内置消息管理) ──
    messages: Annotated[list[BaseMessage], add_messages]

    # ── 阶段控制 ──
    current_stage: int              # 当前阶段 (0-based)
    total_stages: int               # 总阶段数 (李纲动态决定, 上限=知识点数, 上限 20)
    stage_retry_count: int          # 当前阶段重试次数 (反馈"没掌握"触发)
    remedial_triggered: bool        # 当前阶段是否已触发过补救资源 (最多 1 次)

    # ── 俞知产出 ──
    questionnaire: Optional[dict]        # 生成的问卷 (5-8 题)
    questionnaire_response: Optional[dict]  # 用户填写结果 (可为空, 表示跳过)
    learning_profile: Optional[dict]     # 融合后的 LearningProfile (含 study_pace)

    # ── 李纲产出 ──
    learning_plan: Optional[dict]        # LearningPlan (阶段数动态, 2~20)
    delivery_package: Optional[dict]     # 阶段交付包

    # ── 蔡丰产出 ──
    research_report: Optional[dict]      # ResearchReport (用户开启时)
    scouting_enabled: bool               # 用户是否开启了采风

    # ── 6 匠产出 ──
    materials: dict[str, dict]           # {material_type: Material}

    # ── 简真产出 ──
    review_report: Optional[dict]        # QualityReviewReport
    review_retry_count: int              # L1 审查打回计数 (max 2)

    # ── 阶段反馈 ──
    stage_feedback: Optional[dict]       # 用户对当前阶段的反馈 (选填)
    remedial_request: Optional[list[str]] # 补救资源勾选 ["handout", "exercise"] 或空 (跳过)
    remedial_materials: dict[str, dict]   # 补救资源 {material_type: Material}

    # ── 中断控制 ──
    interrupt_at: Optional[str]          # 中断标记节点名
    status: str                          # idle → questionnaire → planning → generating → reviewing → delivering → completed → failed
    error: Optional[dict]                # {code, message, detail}

    # ── 用户配置 ──
    selected_materials: list[str]        # 用户勾选的材料类型
    difficulty_adjustment: float         # 基于反馈的动态难度系数 (0.0~1.0)
```

### 3.2 节点定义

| 节点名 | Agent | 职责 |
|---|---|---|
| `init_session` | — | 初始化会话、加载课程元信息 + KB 索引 |
| `analyze_profile` | 俞知 | 读取 StudentProfile → 生成轻量问卷 → 返回给前端 |
| `process_profile` | 俞知 | 融合问卷响应 (或跳过) + 已有画像 → LearningProfile |
| `plan_path` | 李纲 | 基于 LearningProfile 动态生成 LearningPlan (阶段数 2~20, 由 study_pace + 课程内容量决定) |
| `stage_entry` | — | 阶段入口检查: 是否还有阶段、是否中断恢复 |
| `scout_resources` | 蔡丰 | 博查 API 网络调研 → ResearchReport (用户未开启则跳过) |
| `craft_lecture` | 张义 | 生成讲义 |
| `craft_mindmap` | 屠思 | 生成思维导图 |
| `craft_exercise` | 习真 | 生成练习题 |
| `craft_reading` | 岳读 | 生成拓展阅读 |
| `craft_animation` | 董华 | 生成动画演示 |
| `craft_code` | 戴码 | 生成代码实操 |
| `review_materials` | 简真 | L1 格式严格校验 + L2/L3 宽松标记 |
| `fallback_materials` | 简真 | L1 第 3 次失败 → 降级内容替换 |
| `deliver_stage` | 李纲 | 汇总当前阶段 → DeliveryPackage |
| `collect_feedback` | 俞知 | 弹出阶段反馈 (选填) → 若"基本没掌握"则弹出补救选项 |
| `craft_remedial` | 张义 + 习真 | 补救资源并行生成 (仅用户勾选的类型: 讲义/练习, 最多 1 次) |
| `finalize` | — | 标记完成、持久化记录 |

### 3.3 StateGraph 编译 (条件路由)

```
[init_session] ──► 从已有知识库中选择课程，同时确定所需资源（是否需要生成代码实操和动画脚本演示）
     │
     ▼
[analyze_profile]  ──►  ⏸️ INTERRUPT: 用户填写问卷 (模态框, 可跳过)
     │
     ▼
[process_profile]  ←──  用户提交 / 跳过
     │
     ▼
[plan_path]
     │
     ▼
[stage_entry] ◄─────────────────────────────────────────────────┐
     │                                                          │
     │  conditional: has_more_stages?                           │
     │  ├── yes ──► [scout_resources] (蔡丰, 用户未开启则跳过)     │
     │  └── no  ──► [finalize]                                  │
     ▼                                                          │
[scout_resources]                                               │
     │                                                          │
     ▼                                                          │
[craft_router (Send API)] ──┬── [张义·讲义]                      │
                            ├── [屠思·导图]                      │
                            ├── [习真·习题]                      │
                            ├── [岳读·阅读]                      │
                            ├── [董华·动画]                      │
                            └── [戴码·代码]                      │
     │  🧲 sync barrier (全部完成)                               │
     ▼                                                          │
[review_materials] (简真)                                       │
     │                                                          │
     │  conditional: L1 审查结果?                                │
     ├── ALL_PASS ────────► [deliver_stage]                     │
     ├── RETRY (count<2) ─► 打回失败的匠节点 (Send API 精确路由)    │
     └── MAX_RETRY ───────► [fallback_materials] → [deliver]    │
     │                                                          │
     ▼                                                          │
[deliver_stage]                                                 │
     │                                                          │
     ▼                                                          │
用户学习阶段内容                                                   │
     │                                                          │
     ▼                                                          │
[collect_feedback] ⏸️ 阶段反馈 (模态框, 选填)                      │
     │                                                          │
     │  conditional: 反馈结果?                                    │
     │                                                          │
     ├── "已掌握" → difficulty +0.1 → current_stage++ → [stage_entry]
     ├── "部分掌握" → difficulty 不变 → current_stage++ → [stage_entry]
     ├── (不填) → difficulty 不变 → current_stage++ → [stage_entry]
     │                                                          │
     └── "基本没掌握" → difficulty -0.15                           │
           │                                                     │
           ├── remedial_triggered? ──► current_stage++ → [stage_entry]
           │    (已触发过 1 次, 不再提供补救)                         │
           │                                                     │
           └── 首次触发 → ⏸️ 弹出补救选项 (模态框)                     │
                 │                                               │
                 ├── 用户勾选资源 → [craft_remedial]               │
                 │     (Send API: 张义·补习讲义 + 习真·补习练习)      │
                 │     ├─ resource_ready (is_remedial: true)      │
                 │     ├─ remedial_ready                          │
                 │     └─ 用户点击 "继续" → remedial_triggered=true │
                 │         → current_stage++ → [stage_entry]      │
                 │                                               │
                 └── 用户跳过 → remedial_triggered=true            │
                       → current_stage++ → [stage_entry]          │
                                                                  │
[stage_entry] ◄──────────────────────────────────────────────────┘
     │
     │  conditional: has_more_stages?
     ├── yes → [scout_resources] (蔡丰, 进入下一阶段)
     └── no  → [finalize] → ✅ 完成
```

### 3.4 并行扇出实现 (Send API)

使用 LangGraph `Send` API, 从 Day 1 就用 (不做 asyncio.gather 过渡):

```python
from langgraph.graph import StateGraph, Send

def craft_router(state: ZhiXueState) -> list[Send]:
    """按用户选择的材料类型分发到对应匠节点"""
    material_to_node = {
        "handout":   "craft_lecture",
        "mindmap":   "craft_mindmap",
        "exercise":  "craft_exercise",
        "reading":   "craft_reading",
        "animation": "craft_animation",
        "code":      "craft_code",
    }
    sends = []
    for mt in state["selected_materials"]:
        if mt in material_to_node:
            sends.append(Send(material_to_node[mt], {"material_type": mt}))
    return sends

# 注册
graph.add_conditional_edges("scout_resources", craft_router,
    ["craft_lecture", "craft_mindmap", "craft_exercise",
     "craft_reading", "craft_animation", "craft_code"])

# 所有匠节点出口 → sync barrier
for node in ["craft_lecture", "craft_mindmap", "craft_exercise",
             "craft_reading", "craft_animation", "craft_code"]:
    graph.add_edge(node, "review_materials")
```

优势:
- 审查打回时可通过 Send API 精确路由到失败的材料
- 与 conditional_edges 天然集成
- 支持未来添加新匠类型 (只需加节点 + 更新 craft_router 映射)

---


### 3.5 动态阶段数设计

阶段数量不设固定上限, 由李纲根据用户画像中的 **学习节奏 (study_pace)** 和课程实际内容量动态决定。

#### 3.5.1 学习节奏 (从问卷收集)

| 节奏 | 每阶段学习量 | 阶段数公式 | 范围 |
|---|---|---|---|
| 突击 (cram) | 2~4 小时/阶段 | `total_hours / 2.5` | 2~5 阶段 |
| 正常 (moderate) | 1~2 小时/阶段 | `total_hours / 1.5` | 4~10 阶段 |
| 坚持 (steady) | 20~40 分钟/阶段 | `total_hours / 0.5` | 8~20 阶段 |

**举例**: 操作系统课程约 60 小时自学量——

| 学生类型 | 阶段数 | 每阶段预估时长 | 阶段粒度 |
|---|---|---|---|
| 突击备考 | 4 阶段 | ~3.5 小时 | 进程管理整章合并为一个阶段 |
| 正常学习 | 8 阶段 | ~1.5 小时 | 进程管理拆为 2 阶段 (概念 + 调度算法) |
| 每天坚持 | 15 阶段 | ~40 分钟 | 一个知识点一个阶段 |

#### 3.5.2 护栏机制

```
阶段数下限: 2 (最短课程至少 2 个阶段)
阶段数上限: min(知识点总数, 20)  (每个阶段至少覆盖 1 个知识点)
实际阶段数: 李纲 LLM 在上限和下限之间自由决定
```

上限设为 20 的原因: 每个阶段最多生成 6 种 LLM 资源, 20 阶段 = 最多 120 次 LLM 调用, 再高成本和延迟不可接受。

#### 3.5.3 各 pace 的影响范围

| 维度 | steady (坚持) | moderate (正常) | cram (突击) |
|---|---|---|---|
| 阶段数 | 多 (8~20) | 中 (4~10) | 少 (2~5) |
| 每阶段知识点 | 1~2 个 | 3~5 个 | 6~10 个 |
| 每阶段资源量 | 轻 (每资源更简短) | 中 | 重 (每资源更全面) |
| 讲义深度 | 聚焦单一概念 | 标准 | 综合覆盖 |
| 习题数 | 3~5 道/阶段 | 6~8 道/阶段 | 10~15 道/阶段 |
| 前端 Steps 组件 | 需支持滚动/折叠 | 正常 | 正常 |

#### 3.5.4 边界情况

- 用户选 "坚持" 但课程仅有 3 个知识点 → 阶段数 = min(3, LLM判定) = 3, 每个知识点为 1 个阶段
- 用户选 "突击" 但课程有 40 个知识点 → 阶段数 = min(LLM判定, 20) → 每个阶段覆盖 2 个知识点
- 知识点数量永远是阶段数的天然上限

## 4. 学习导引师向南 协调机制

### 4.1 向南的定位

**向南不参与 StateGraph 内部流转**。它的职责:

1. **接收用户请求** → 路由到正确的 Graph 入口
2. **读 Agent Registry** → 验证 Agent 可用性
3. **启动 Graph** → `graph.ainvoke(state, config)` 或 `graph.astream(state, config)`
4. **异常兜底** → 捕获 Graph 层的未处理异常, 决策"重试/降级/报错"
5. **状态查询** → 提供 `GET /sessions/{id}/status` 的响应

### 4.2 异常兜底策略

```
Graph 内部异常
  ├── Agent 超时 → 重试该节点 (max 1) → 失败则 status=failed
  ├── LLM 调用失败 → 根据 Agent 类型决定降级策略
  │     ├── 俞知/李纲 失败 → 使用已有画像/基础阶段划分
  │     ├── 蔡丰 失败 → 跳过网络搜索, 标记 warning
  │     ├── 匠 失败 → 降级内容 (模板化)
  │     └── 简真 失败 → 跳过审查, 标记 warning
  └── 不可恢复错误 → 持久化 state, 返回 error 给用户
```

### 4.3 向南代码骨架

```python
class XiangNan:
    """学习导引师向南 — 顶层协调器"""

    def __init__(self, registry: AgentRegistry, graph: CompiledGraph):
        self.registry = registry
        self.graph = graph

    async def start_session(
        self, course_id: str, user_id: str, selected_materials: list[str]
    ) -> dict:
        # 1. 验证 Agent 可用性
        required = ["profile_analyst", "path_planner", "quality_reviewer"]
        required += [f"crafter_{mt}" for mt in selected_materials]
        self.registry.ensure_available(required)

        # 2. 构建初始状态
        state = ZhiXueState(
            session_id=str(uuid4()),
            course_id=course_id, user_id=user_id,
            current_stage=0, selected_materials=selected_materials,
            status="questionnaire",
            materials={}, review_retry_count=0,
            scouting_enabled=False, difficulty_adjustment=0.5,
        )

        # 3. 启动 Graph
        try:
            result = await self.graph.ainvoke(
                state, {"configurable": {"thread_id": state["session_id"]}}
            )
            return result
        except Exception as e:
            return await self._handle_error(state, e)

    async def resume_session(self, session_id: str, user_input: dict) -> dict:
        """恢复中断的会话"""
        result = await self.graph.ainvoke(
            Command(resume=user_input),
            {"configurable": {"thread_id": session_id}},
        )
        return result

    async def get_status(self, session_id: str) -> dict:
        """查询会话状态"""
        state = await self.graph.aget_state(
            {"configurable": {"thread_id": session_id}}
        )
        return {
            "session_id": session_id,
            "status": state.values.get("status"),
            "current_stage": state.values.get("current_stage"),
        }
```

---

## 5. Agent Registry 设计

### 5.1 分阶段策略

| 阶段 | 注册方式 | 说明 |
|---|---|---|
| Phase 1-2 | **Python 代码注册** | 快速验证, Agent 接口可能变化 |
| Phase 3 | **YAML 声明式配置** | Agent 定型后, 换 loader 即可 |

### 5.2 Python 代码注册 (Phase 1-2)

```python
# registry/registry.py
class AgentRegistry:
    def __init__(self):
        self._agents: dict[str, AgentRecord] = {}

    def register(self, record: AgentRecord) -> None:
        self._agents[record.agent_code] = record

    def get(self, agent_code: str) -> AgentRecord: ...
    def ensure_available(self, agent_codes: list[str]) -> None: ...

# 注册所有 Agent
registry = AgentRegistry()
registry.register(AgentRecord(
    agent_code="profile_analyst", agent_name="学情诊断师俞知",
    version="1.0.0", module_path="services.zhixue.agents.yuzhi",
    handler_fn="run", status="active", tags=["core", "analysis"],
))
# ... 其余 Agent 同理
```

### 5.3 YAML 声明 (Phase 3, 共用同一 AgentRecord schema)

```yaml
# registry/agents.yaml
agents:
  - agent_code: "profile_analyst"
    agent_name: "学情诊断师俞知"
    version: "1.0.0"
    module_path: "services.zhixue.agents.yuzhi"
    handler_fn: "run"
    status: active
    tags: [core, analysis]
```

### 5.4 新增 Agent 的最小改动路径

```
① registry 注册: 加一个 AgentRecord (Python 代码或 YAML)
② graph.py 新增节点: builder.add_node("craft_tutor", craft_tutor_fn)
③ 更新 craft_router 映射表: material_to_node["tutor"] = "craft_tutor"
④ agents/ 目录新增 tutuor_crafter.py 实现 handler
⑤ 向南通过 Registry.get("tutor_crafter") 自动感知
```

---

## 6. Agent 数据契约

### 6.1 通用 Agent 接口

```python
class AgentHandler(Protocol):
    async def __call__(self, state: ZhiXueState, **kwargs) -> dict:
        """
        输入: 完整的 ZhiXueState (只读需要的字段)
        输出: dict, 包含该 Agent 负责更新的字段, LangGraph 自动合并
        """
        ...
```

**关键约束**:
- Agent 只读取自己需要的字段, 不修改其他字段
- 返回值是**部分 State 字典**, LangGraph 自动合并
- Agent 内部可调用: RAG API, User Profile API, LLM, 博查 Search API
- 异常向上抛, 由向南兜底

### 6.2 核心数据流契约

| 生产者 | 产出字段 | 消费者 | 契约约束 |
|--------|---------|--------|---------|
| 俞知 | `learning_profile` | 李纲、蔡丰、6匠 | 含 `knowledge_levels`, `style_preferences`, `goals` |
| 李纲 | `learning_plan` | 蔡丰、6匠、简真 | 每个 Stage 含 `topic`, `objectives`, `kb_refs` |
| 蔡丰 | `research_report` | 6匠 | 含 `key_concepts`, `external_links`, 可为空 |
| 6匠 | `materials[type]` | 简真、李纲 | 统一含 `content`, `metadata`, `source_refs` |
| 简真 | `review_report` | 李纲 | 含 `per_material` L1 结果 + L2/L3 标记 |
| 李纲 | `delivery_package` | 用户 | 含 `stage_number`, `materials`, `review_summary` |

---

## 7. 中断与恢复机制

### 7.1 中断策略

```
中断仅发生在需要用户输入的时刻:

  ⏸️ 中断点 ①: analyze_profile 完成后
     触发: 问卷已生成, 等待用户填写 (模态框)
     行为: 用户可填写提交 / 点击跳过 / 3min 超时自动跳过

  ⏸️ 中断点 ②: 用户完成阶段学习后
     触发: 弹出阶段反馈 (模态框, 选填)
     行为: 用户可选填掌握程度 / 直接关闭继续下一阶段
```

### 7.2 LangGraph 中断 API

```python
# 编译时声明中断点
graph = builder.compile(
    checkpointer=checkpointer,
    interrupt_before=["process_profile", "collect_feedback"],
)
```

### 7.3 恢复流程

```python
# 用户提交问卷后恢复 (或超时跳过)
await graph.ainvoke(
    Command(resume={"questionnaire_response": user_answers}),
    {"configurable": {"thread_id": session_id}},
)

# 用户提交阶段反馈后恢复 (或直接跳过)
await graph.ainvoke(
    Command(resume={"stage_feedback": {"mastery": "mastered"}}),
    {"configurable": {"thread_id": session_id}},
)
```

### 7.4 Checkpointer 与 PostgreSQL 的协调

```
┌──────────────────────────────────────┐
│  LangGraph Checkpointer (aiosqlite)  │
│  - 管理运行时 Graph 执行状态           │
│  - 每个 super-step 自动快照            │
│  - 通过 thread_id 恢复                │
└──────────────────────────────────────┘
              ↕ 同步
┌──────────────────────────────────────┐
│  PostgreSQL (zhixue_* 表)             │
│  - 管理持久化业务数据                  │
│  - 恢复时优先读 PostgreSQL 最新状态    │
│  - Checkpointer 做执行加速            │
└──────────────────────────────────────┘
```

恢复时逻辑:
1. 读 PostgreSQL `zhixue_sessions.status` 确认当前阶段
2. 用 `thread_id` 从 Checkpointer 加载运行时状态
3. 若 Checkpointer 状态丢失 (如服务重启), 从 PostgreSQL 重建初始状态, 从当前阶段重新执行

---

## 8. 审查体系

### 8.1 四层审查定义

| 层级 | 名称 | 严格度 | 实现方式 | 不通过行为 |
|---|---|---|---|---|
| L1 | 格式校验 | **严格** | 纯规则, 不调 LLM | 触发重生成 (最多 2 次), 第 3 次降级为 fallback |
| L2 | 知识一致性 | **宽松** | RAG 语义相似度 (阈值 0.75) | 标记 `knowledge_warning`, 不阻塞 |
| L3 | 逻辑审查 | **宽松** | LLM 快速扫描 | 标记 `logic_warning`, 不阻塞 |
| L4 | 跨材料一致性 | **暂不实现** | — | 等待 L2/L3 数据积累后评估 |

核心原则: **内容可以不完美, 但不能显示不出来。**

### 8.2 L1 格式校验细则

| 材料类型 | 校验项 | 不通过条件 |
|---|---|---|
| 讲义 (张义) | — | 仅检查内容非空 |
| 导图 (屠思) | Markdown 标题层级 | 缺少根节点 `#` / 深度不足 3 级 / 标题节点 < 10 |
| 习题 (习真) | JSON Schema | 非有效 JSON / `questions` 为空 / 缺少必填字段 |
| 阅读 (岳读) | — | 仅检查内容非空 |
| 动画 (董华) | HTML 完整性 | 不以 `<!DOCTYPE` 开头 / 缺少 `</html>` / 缺少 `</script>` |
| 代码 (戴码) | — | 仅检查内容非空 |

### 8.3 审查路由

```python
def review_router(state: ZhiXueState) -> str:
    report = state["review_report"]
    l1_failed = [k for k, v in report["per_material"].items() if v.get("l1_passed") == False]

    if not l1_failed:
        return "deliver"  # L1 全部通过 → 交付 (L2/L3 标记附在 metadata 中)
    elif state["review_retry_count"] < 2:
        # 仅打回 L1 失败的材料到对应匠节点
        return "retry_l1"
    else:
        return "fallback"  # 第 3 次仍失败 → 替换为降级内容
```

---

## 9. 轻量问卷系统

### 9.1 设计原则

- **轻量化**: 5-8 题, 单选/多选为主, 1-2 道选填简答
- **可跳过**: 点击"使用已有画像, 跳过问卷"直接继续
- **模态框展示**: 不跳转页面, SSE 流中弹出, 保持上下文

### 9.2 调研维度

以操作系统原理课程为例，调研应包括但不限于以下维度：

| 维度 | 题型 | 示例 |
|---|---|---|
| 重点知识 | 多选 | "你更希望重点学习哪些知识点: [同步与并发] [处理机调度] [内存管理]......" |
| 学习侧重点 | 单选 | "你更希望: [理论学习] [动手实操] [两者兼顾]" |
| 掌握深度 | 单选 | "你希望学到什么程度: [简单了解] [基本掌握] [完全精通]" |
| 已有基础 | 单选 | "操作系统编程多使用C语言或者Rust语言: [有C语言基础] [有Rust语言基础] [两者都不会]" |
| 学习安排 | 单选 | "你大概能投入多少时间: [每天坚持，细水长流] [每周集中几次，正常节奏] [短期突击，快速完成]" |
| 特殊需求 | 简答 选填 | "有没有特别想了解的方向?" |

### 9.3 画像融合

```
StudentProfile.profile_data (已有, 从 DB 读取)
        +
问卷答案 (若有) 或 默认值 (若跳过)
        ↓
俞知 LLM 融合
        ↓
LearningProfile {
  knowledge_levels: [...],
  style_preferences: [...],
  learning_goals: [...],
  study_pace: "steady" | "moderate" | "cram",  # ← 驱动李纲动态阶段数
  suggested_difficulty: 0.0~1.0,
  recommended_material_types: [...],
}
```

### 9.4 SSE 事件交互

```
服务端                               前端
  │                                   │
  ├─ questionnaire_ready ────────────►│ 弹出问卷模态框
  │  {questions: [...],               │
  │   timeout_seconds: 180}           │
  │                                   │
  │  ←── POST /questionnaire ────────┤ 用户提交 或 跳过
  │                                   │
  ├─ questionnaire_skipped ──────────►│ 关闭模态框
  │  {reason: "user_skipped"}│
  │                                   │
  ├─ agent_start {agent: "俞知"} ────►│ 继续 SSE 进度
```

---

## 10. 采风网络搜索

### 10.1 设计原则

- **默认开启**: 用户可选择关闭网络资源增强
- **按需服务**: 重点服务 `exercise` (考研原题) 和 `reading` (官方文档/B站视频)
- **优雅降级**: API 不可用时跳过, 标记 warning, 不影响主流程
- **结果缓存**: 按 course 级缓存, 不同用户复用

### 10.2 搜索源

| 源 | 用途 | 实现 |
|---|---|---|
| 博查 Search API | 通用搜索 (兜底) | `httpx` 异步调用 |
| 考研题库 API | 习题原题采集 | 按配置切换 |
| 官方文档站 | 阅读推荐引用 | 限定域名搜索 |

### 10.3 降级策略

```python
async def scout_resources(state: ZhiXueState) -> dict:
    if not state.get("scouting_enabled"):
        return {"research_report": None}  # 用户未开启

    try:
        results = await search_api.query(stage.topic)
        return {"research_report": synthesize(results)}
    except Exception as e:
        logger.warning(f"蔡丰 搜索失败 (非致命): {e}")
        return {"research_report": None}  # 降级: 跳过搜索
```

---

## 11. 阶段反馈系统

### 11.1 设计原则

- **选填**: 不阻塞下一阶段生成
- **用于调整**: 反馈结果影响后续阶段资源的 `difficulty_adjustment`
- **"基本没掌握"走补救流程**: 不重生成整个阶段, 而是提供可选补充资源

### 11.2 反馈内容

| 字段 | 类型 | 选项 |
|---|---|---|
| mastery | 单选 选填 | "已掌握" / "部分掌握" / "基本没掌握" |
| self_assessment | 选填文本 | 自由反馈 |

### 11.3 对后续阶段的影响

```
反馈: "基本没掌握" → difficulty_adjustment -= 0.15 → 进入补救流程 (见 11.4)
       "部分掌握"   → difficulty_adjustment 不变   → 进入下一阶段
       "已掌握"     → difficulty_adjustment += 0.1  → 进入下一阶段
       (不填)       → 默认"部分掌握", 不变          → 进入下一阶段

difficulty_adjustment 影响:
  - 俞知: 更新 learning_profile 中的 suggested_difficulty
  - 匠: 调整生成内容的深度和详细程度
  - 李纲: 更新后续阶段的 estimated_duration_minutes
```

### 11.4 补救资源流程 (「基本没掌握」专属)

#### 11.4.1 流程设计

```
用户选择 "基本没掌握 😞"
  │
  ▼
⏸️ 弹出补救选项 (模态框)
  "需要额外资料巩固一下吗？"
  □ 补充讲义 (重新梳理核心概念, 更多例子, 更低术语密度)
  □ 补充练习 (更多基础题, 强化易错点, 70%基础+30%提升)
  [直接继续下一阶段]  ← 跳过按钮
  │
  ├── 用户勾选资源 → [craft_remedial] 节点
  │     │  Send API 并行: 张义·补习讲义 + 习真·补习练习
  │     │  (仅生成用户勾选的类型, 非全部 6 匠)
  │     ├── SSE: agent_start {agent: "张义", message: "正在生成补充讲义..."}
  │     ├── SSE: agent_start {agent: "习真", message: "正在生成补充练习..."}
  │     ├── SSE: resource_ready {resource_type: "handout", is_remedial: true}
  │     ├── SSE: resource_ready {resource_type: "exercise", is_remedial: true}
  │     ├── SSE: remedial_ready {stage_index: N, resources: [...]}
  │     ├── 用户学习补充资料...
  │     └── 点击 "继续下一阶段" → remedial_triggered = true → 进入下一阶段
  │
  └── 用户跳过 → remedial_triggered = true → 进入下一阶段
```

#### 11.4.2 补救资源与常规资源的差异

| 维度 | 常规资源 | 补救资源 |
|---|---|---|
| 触发方式 | 阶段开始时自动生成 | 用户选择 "基本没掌握" 后手动勾选 |
| 生成 Agent | 全部 6 匠 (按用户选择) | 仅 张义 (讲义) + 习真 (习题) |
| 讲义 | 全面覆盖本阶段知识点 | 重新梳理核心概念, 更多通俗比喻, 降低术语密度 |
| 练习 | 30%基础 + 50%提升 + 20%综合 | 70%基础 + 30%提升, 强化易错点 |
| 标记 | `is_remedial: false` | `is_remedial: true` (在 resource_metadata 中) |
| 数量 | 按用户选择的 resource_types 决定 | 按用户勾选的补救类型决定 |

#### 11.4.3 护栏: 最多触发 1 次

```
remedial_triggered 状态:
  - 每个阶段初始为 false
  - 首次 "基本没掌握" → 弹出补救选项 → 无论用户选择与否 → 设为 true
  - 同一阶段再次 "基本没掌握" (如果用户通过某种方式回到反馈):
    → 跳过补救选项, 直接 difficulty -0.15 → 进入下一阶段
```

防止用户在一个阶段无限循环生成补救资源。

#### 11.4.4 补救资源对李纲的影响

`difficulty_adjustment` 的降低不仅影响后续阶段, 也作为张义生成补充讲义时的 Prompt 输入:
- `difficulty_adjustment < 0.3`: 讲义用更基础的比喻, 降低术语密度, 增加 `**重点**` 标注
- `difficulty_adjustment 0.3~0.7`: 正常补充, 侧重易混淆点
- `difficulty_adjustment > 0.7`: 侧重深度拓展

---

## 12. FastAPI 集成

### 12.1 核心 Endpoints (v2, 与 v1 共存)

```python
# backend/app/api/v2/zhixue.py
router = APIRouter(prefix="/api/v2/zhixue", tags=["AI智学"])

@router.post("/sessions")
async def start_session(
    course_id: str,
    user_id: str = Depends(get_current_user),
    selected_materials: list[str] = Body(...),
    scouting_enabled: bool = Body(default=False),
    xiangnan: XiangNan = Depends(get_xiangnan),
) -> dict:
    return await xiangnan.start_session(course_id, user_id, selected_materials)

@router.post("/sessions/{session_id}/questionnaire")
async def submit_questionnaire(
    session_id: str,
    response: QuestionnaireResponse,
    xiangnan: XiangNan = Depends(get_xiangnan),
) -> dict:
    return await xiangnan.resume_session(
        session_id, {"questionnaire_response": response.model_dump()}
    )

@router.post("/sessions/{session_id}/feedback")
async def submit_feedback(
    session_id: str,
    feedback: StageFeedback,
    xiangnan: XiangNan = Depends(get_xiangnan),
) -> dict:
    return await xiangnan.resume_session(
        session_id, {"stage_feedback": feedback.model_dump()}
    )

@router.get("/sessions/{session_id}/status")
async def get_status(
    session_id: str,
    xiangnan: XiangNan = Depends(get_xiangnan),
):
    return await xiangnan.get_status(session_id)

@router.get("/sessions/{session_id}/stream")
async def stream_events(
    session_id: str,
    xiangnan: XiangNan = Depends(get_xiangnan),
):
    """SSE 流式推送 Graph 事件"""
    async def generate():
        async for event in xiangnan.graph.astream_events(
            None, {"configurable": {"thread_id": session_id}}, version="v2",
        ):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
    return StreamingResponse(
        generate(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

### 12.2 与 v1 的共存

在 `backend/app/main.py` 中:

```python
from app.api.v1.router import api_v1_router
from app.api.v2.router import api_v2_router  # 新增

app.include_router(api_v1_router)  # 不动: /api/v1/learning
app.include_router(api_v2_router)  # 新增: /api/v2/zhixue
```

---

## 13. 与现有 AI助学 的共存方案

### 13.1 完全隔离策略

```
                    ┌─────────────────────────┐
                    │      PostgreSQL          │
                    │  learning_* (旧, 不动)    │
                    │  zhixue_*  (新, 独立)    │
                    └─────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
     ┌────────▼────────┐            ┌────────▼────────┐
     │  /api/v1/learning │           │ /api/v2/zhixue  │
     │  (AI助学, 不动)   │           │ (AI智学, 新建)   │
     └─────────────────┘            └─────────────────┘
              │                               │
     ┌────────▼────────┐            ┌────────▼────────┐
     │  services/       │            │  services/       │
     │  learning/ (不动) │            │  zhixue/  (新建)  │
     └─────────────────┘            └─────────────────┘
              │                               │
     ┌────────▼────────┐            ┌────────▼────────┐
     │  /learning       │            │  /zhixue         │
     │  (旧前端, 不动)   │            │  (新前端, 新建)   │
     └─────────────────┘            └─────────────────┘
```

### 13.2 对现有代码的修改 (仅 4 处, 最小化)

| 文件 | 修改 | 行数 |
|---|---|---|
| `backend/app/main.py` | 加 `import api_v2_router` + `app.include_router` | +2 行 |
| `frontend/src/App.tsx` | 加 2 个 Route (`/zhixue`, `/zhixue/:id`) | +2 行 |
| `frontend/src/components/layout/Sidebar.tsx` | 加 1 个菜单项 "AI智学 (Beta)" | +1 行 |
| `frontend/src/services/api.ts` | 文件底部追加 v2 API 函数 | +N 行 (新增) |
| `frontend/src/types/index.ts` | 文件底部追加新类型 | +N 行 (新增) |

### 13.3 复用的共享模块 (不修改)

| 模块 | 文件 | 复用方式 |
|---|---|---|
| LLM 客户端 | `backend/app/services/llm_utils.py` | 直接 import |
| RAG 检索 | `backend/app/services/retriever.py` | 直接 import |
| 配置服务 | `backend/app/services/config_service.py` | 直接 import |
| 6 个资源生成器 | `backend/app/services/learning/resource_generators.py` | 函数签名适配 |
| 用户画像模型 | `backend/app/models/profile.py` | 直接查询 |
| 数据库会话 | `backend/app/core/database.py` | 复用 `get_db` |
| 前端 SSE 引擎 | `frontend/src/services/api.ts:fetchSSEStream` | 直接调用 |

---

## 14. 项目文件结构

### 14.1 后端新增文件

```
backend/app/
├── api/v2/                              # [新建] v2 API
│   ├── __init__.py
│   ├── router.py                        # v2 路由聚合
│   └── zhixue.py                        # SSE + REST 端点
├── models/zhixue.py                     # [新建] AI智学 DB 模型
├── schemas/zhixue.py                    # [新建] AI智学 Pydantic schemas
└── services/zhixue/                     # [新建] AI智学 服务层
    ├── __init__.py
    ├── registry/
    │   ├── __init__.py
    │   ├── models.py                    # AgentRecord Pydantic model
    │   ├── registry.py                  # AgentRegistry 类 (Python 代码注册)
    │   └── agents.yaml                  # (Phase 3) YAML 声明
    ├── agents/
    │   ├── __init__.py
    │   ├── base.py                      # AgentHandler Protocol
    │   ├── yuzhi.py                     # 学情诊断师俞知
    │   ├── ligang.py                    # 教纲设计专家李纲
    │   ├── caifeng.py                   # 资源采集师蔡丰
    │   ├── crafter_zhangyi.py           # 讲义编写师张义
    │   ├── crafter_tusi.py              # 导图设计师屠思
    │   ├── crafter_xizhen.py            # 习题设计师习真
    │   ├── crafter_yuedu.py             # 阅读推荐师岳读
    │   ├── crafter_donghua.py           # 动画制作师董华
    │   ├── crafter_daima.py             # 代码实操师戴码
    │   └── jianzhen.py                  # 质量审核师简真
    ├── graph.py                         # StateGraph 组装 + 编译
    ├── state.py                         # ZhiXueState TypedDict
    ├── edges.py                         # router 函数
    ├── orchestrator.py                  # 向南
    ├── session_service.py               # 会话 CRUD
    └── prompts.py                       # 各 Agent System Prompt
```

### 14.2 前端新增文件

```
frontend/src/
├── pages/
│   ├── ZhiXueHub.tsx                    # [新建] AI智学 会话列表
│   └── ZhiXueSession.tsx                # [新建] AI智学 会话页面
├── hooks/
│   └── useZhiXueSSE.ts                  # [新建] SSE 状态机 (扩展版)
└── components/zhixue/
    ├── ZhiXueProgress.tsx               # [新建] 生成进度 (含问卷/审查/反馈)
    ├── QuestionnaireModal.tsx           # [新建] 轻量问卷模态框
    ├── ReviewPanel.tsx                  # [新建] 审查结果面板
    ├── FeedbackModal.tsx                # [新建] 阶段反馈模态框
    └── RemedialModal.tsx                # [新建] 补救资源选择模态框
```

---

## 附录 A: 与讨论前原设计的关键差异

| 项目 | 原设计 | 讨论后确认方案 |
|---|---|---|
| Agent 名称 | 司南/知渔/筑径/采风/匠/鉴真 | 向南/俞知/李纲/蔡丰/张义/屠思/习真/岳读/董华/戴码/简真 |
| 问卷 | 全题型, 阻塞流程 | 单选/多选为主, 5-8题, 模态框, 可跳过 |
| 审查 | 四层全部严格 | L1 严格, L2/L3 宽松不阻塞, L4 暂缓 |
| 采风 | Tavily, 默认开启 | 博查 Search API, 默认开启, 用户可选 |
| Registry | Phase 0 用 YAML | Phase 1-2 Python 代码, Phase 3 加 YAML |
| 并行生成 | asyncio.gather 过渡 | Send API 从 Day 1 就用 |
| 阶段反馈 | 二维 (已掌握/没掌握), 重生成 | 三维 (已掌握/部分掌握/没掌握), 选填; "没掌握"走补救流程 |
| "没掌握"处理 | 整个阶段重生成 | 可选补救讲义+练习 (张义+习真, 最多 1 次), 不阻塞下一阶段 |
| 阶段数 | 固定 3~6 | 动态 2~20, 李纲根据 study_pace 决定 |
| SSE 依赖 | sse-starlette | 不需要 |
| pyproject.toml | 替换 requirements.txt | 不替换 |

## 附录 B: 待定事项

| 事项 | 状态 | 计划 |
|---|---|---|
| 降级内容标准 (L1 第3次失败后的 fallback) | ⏸️ | Phase 3 实施时确定 |
| YAML Registry 加载器 | ⏸️ | Phase 3 实施 |
| 采风具体搜索源配置 | ⏸️ | Phase 2 实施时确定 |
| L4 跨材料一致性 | ⏸️ | 等待 L2/L3 数据积累 |
