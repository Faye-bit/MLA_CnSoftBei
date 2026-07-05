# AI 个性化学习指导平台 — 依赖包 & 共享知识 (v2.1)

> 更新: 2026-07-01 — 移除 tavily-python, 移除 sse-starlette, 采风改用博查 Search API

---

## 1. 依赖包变更清单

### 1.1 新增依赖 (需添加)

```
aiosqlite>=0.20.0                # LangGraph async Checkpointer
pyyaml>=6.0.1                    # Phase 3 YAML Registry (显式声明)
```

### 1.2 已有依赖 (不做修改)

```
langgraph>=1.2.5                  # 已有 — StateGraph + Send API + Checkpointer
langchain-core>=0.3.0             # 已有 — LLM 抽象层
fastapi>=0.110.0                  # 已有 — Web 框架
uvicorn[standard]>=0.29.0         # 已有 — ASGI 服务器
pydantic>=2.7.0                   # 已有 — 数据模型
httpx>=0.27.0                     # 已有 — 博查 Search API 调用
```

### 1.3 不需要的依赖 (已确认排除)

```
❌ sse-starlette                  # FastAPI StreamingResponse 已满足需求
❌ tavily-python                  # 采风改用博查 Search API
```

---

## 2. 共享枚举定义 (`backend/app/schemas/zhixue.py`)

所有枚举集中在一个模块中, 避免循环引用:

```python
from enum import Enum

class MaterialType(str, Enum):
    """学习材料类型"""
    HANDOUT = "handout"           # 讲义
    MINDMAP = "mindmap"           # 思维导图
    EXERCISE = "exercise"         # 练习题
    READING = "reading"           # 拓展阅读
    ANIMATION = "animation"       # 动画演示
    CODE = "code"                 # 代码实操
    EXTERNAL_LINK = "external_link"  # 外部链接 (蔡丰产出)

class SessionStatus(str, Enum):
    """会话状态"""
    IDLE = "idle"
    QUESTIONNAIRE = "questionnaire"  # 等待用户填写问卷
    PLANNING = "planning"            # 李纲规划路径中
    GENERATING = "generating"        # 匠并行生成中
    REVIEWING = "reviewing"          # 简真审查中
    DELIVERING = "delivering"        # 李纲交付中
    FEEDBACK = "feedback"            # 等待用户反馈 (选填)
    COMPLETED = "completed"
    INTERRUPTED = "interrupted"
    FAILED = "failed"

class MasteryLevel(str, Enum):
    """掌握程度 (阶段反馈)"""
    MASTERED = "mastered"             # 已掌握
    PARTIALLY = "partially_mastered"  # 部分掌握 (默认)
    NOT_MASTERED = "not_mastered"     # 基本没掌握

class ReviewVerdict(str, Enum):
    """审查判定"""
    PASS = "PASS"
    FORMAT_FAIL = "FORMAT_FAIL"           # L1
    KNOWLEDGE_MISMATCH = "KNOWLEDGE_MISMATCH"  # L2 (宽松标记)
    LOGIC_FAIL = "LOGIC_FAIL"             # L3 (宽松标记)
    # CROSS_INCONSISTENCY 暂不实现 (L4)

class OverallVerdict(str, Enum):
    """整体审查判定"""
    ALL_PASS = "ALL_PASS"           # L1 全部通过
    RETRY_L1 = "RETRY_L1"           # L1 不通过, 重试 (count < 2)
    MAX_RETRY = "MAX_RETRY"         # L1 重试耗尽, fallback

class AgentStatus(str, Enum):
    """Agent 状态"""
    ACTIVE = "active"
    INACTIVE = "inactive"
    DEGRADED = "degraded"

class QuestionType(str, Enum):
    """问卷题目类型 (轻量: 单选/多选为主)"""
    SINGLE_CHOICE = "single_choice"
    MULTI_CHOICE = "multi_choice"
    OPEN_ENDED = "open_ended"       # 选填简答, 最多 1-2 道
```

---

## 3. 跨文件常量

| 常量 | 值 | 位置 | 说明 |
|------|-----|------|------|
| `MAX_STAGES` | 6 | `schemas/zhixue.py` | 学习计划最大阶段数 |
| `MIN_STAGES` | 3 | `schemas/zhixue.py` | 学习计划最小阶段数 |
| `MAX_REVIEW_RETRIES` | 2 | `agents/jianzhen.py` | L1 审查最多打回次数 |
| `MAX_STAGE_RETRIES` | 2 | `graph/edges.py` | 阶段重试最大次数 (用户说"没掌握") |
| `QUESTIONNAIRE_MAX_QUESTIONS` | 10 | `agents/yuzhi.py` | 问卷最多题目数 |
| `QUESTIONNAIRE_DEFAULT_COUNT` | 5 | `agents/yuzhi.py` | 问卷默认题目数 |
| `QUESTIONNAIRE_TIMEOUT_SECONDS` | 180 | `orchestrator.py` | 问卷超时自动跳过 |
| `RAG_SIMILARITY_THRESHOLD` | 0.75 | `agents/jianzhen.py` | L2 知识一致性阈值 |
| `DEFAULT_TIMEOUT_SECONDS` | 120 | `registry/models.py` | Agent 默认超时 |
| `KB_SOURCE_MARKER` | `"[KB-SOURCE]"` | `agents/jianzhen.py` | KB fallback 标记 |
| `CHECKPOINT_DB_PATH` | `"checkpoints.db"` | `graph/builder.py` | SQLite Checkpointer 路径 |
| `DIFFICULTY_ADJUSTMENT_STEP` | 0.1 | `orchestrator.py` | 每次反馈调整量 (已掌握 +0.1, 没掌握 -0.15) |

---

## 4. Agent Handler 接口约定

所有 Agent 遵循统一签名:

```python
# services/zhixue/agents/base.py
from typing import Protocol, runtime_checkable

@runtime_checkable
class AgentHandler(Protocol):
    async def __call__(self, state: "ZhiXueState", **kwargs) -> dict:
        """
        参数:
            state: 完整的 LangGraph State (只读所需字段)
            **kwargs: 额外参数 (如 Send API 传递的 material_type)
        返回:
            dict: 仅包含该 Agent 负责更新的 State 字段
        抛出:
            AgentError: 可恢复错误 (触发重试)
            AgentFatalError: 不可恢复错误 (触发向南兜底)
        """
        ...
```

### Agent 异常层次

```python
class AgentError(Exception):
    """Agent 基类异常"""
    agent_code: str
    retryable: bool = True

class AgentTimeoutError(AgentError):
    """Agent 超时"""

class AgentFatalError(AgentError):
    """不可恢复错误"""
    retryable: bool = False

class AgentUnavailableError(AgentFatalError):
    """Agent 不可用 (Registry 中 status != active)"""
```

---

## 5. 外部服务 API 契约

### 5.1 知识库 API (复用现有)

```python
# 复用: backend/app/services/retriever.py::retrieve
async def rag_retrieve(
    query: str,
    course_id: uuid.UUID,
    db: AsyncSession,
    top_k: int = 5,
) -> list[RetrievedChunk]:
    """返回 RAG 检索结果"""
```

### 5.2 用户画像 API (复用现有)

```python
# 复用: backend/app/models/profile.py::StudentProfile
# 通过 SQLAlchemy 直接查询
stmt = select(StudentProfile).where(StudentProfile.user_id == user_id)
```

### 5.3 LLM 调用 (复用现有)

```python
# 复用: backend/app/services/llm_utils.py
client = create_llm_client()          # AsyncOpenAI 客户端
model = get_config_value("llm_model")  # 当前模型名
result = parse_json_output(raw)        # JSON 提取
event = sse_event("type", data)        # SSE 格式化
```

### 5.4 搜索 API (新建, 蔡丰专用)

```python
# backend/app/services/zhixue/search_service.py
async def web_search(
    query: str,
    max_results: int = 10,
    sources: list[str] | None = None,  # 限定搜索源域名
) -> list[SearchResult]:
    """
    博查 Search API 封装。
    
    可通过 sources 参数限定搜索域:
      - ["bilibili.com"] → B站教学视频
      - ["docs.python.org", "developer.mozilla.org"] → 官方文档
      - None → 通用搜索

    返回:
        [{title: str, url: str, content: str, score: float, source: str}]
    """
```

---

## 6. LLM 调用约定

- **统一入口**: 所有 Agent 通过 `create_llm_client()` 调用 LLM (复用现有)
- **模型配置**: 通过 `get_config_value("llm_model")` 读取
- **温度参数**:
  - 俞知/李纲/简真: `temperature=0.3` (分析/审查类)
  - 6 匠: `temperature=0.7` (生成类)
- **结构化输出**: 使用 `parse_json_output()` 确保输出符合 Schema (复用现有)
- **Token 预算**: 讲义 4096、导图 2048、习题 4096、阅读 3000、动画 8000、代码 4000

---

## 7. 日志约定 (复用现有 loguru)

```python
from loguru import logger

# 日志级别:
# DEBUG   - LangGraph 节点进入/退出、State 快照
# INFO    - 阶段切换、Agent 开始/完成
# WARNING - 审查 L2/L3 标记、蔡丰降级、重试
# ERROR   - Agent 异常、LLM 调用失败

# 格式沿用现有项目 loguru 配置
```

---

## 8. 测试策略

| 层级 | 范围 | 工具 |
|------|------|------|
| 单元测试 | 单个 Agent 函数、Schema 校验 | pytest + mock LLM |
| 集成测试 | Agent + Service 联动 | pytest-asyncio + mock 外部 API |
| Graph 测试 | LangGraph 路径覆盖 | pytest + 内存 Checkpointer |
| 共存测试 | 新旧系统同时可用 | pytest + 两端点并发请求 |
| E2E 测试 | 完整流程 | pytest + 真实 LLM (可选) |
