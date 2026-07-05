"""
Agent Registry — Python 代码注册实现
Phase 1-2 使用 Python 代码注册 Agent, Phase 3 增加 YAML 加载器

共用 AgentRecord schema, 迁移只需换 loader
"""

from app.services.zhixue.registry.models import AgentRecord


class AgentRegistry:
    """Agent 注册中心 — 管理所有 Agent 的生命周期和可用性"""

    def __init__(self):
        self._agents: dict[str, AgentRecord] = {}

    def register(self, record: AgentRecord) -> None:
        """注册一个 Agent"""
        self._agents[record.agent_code] = record

    def get(self, agent_code: str) -> AgentRecord:
        """
        按代号获取 Agent 注册信息

        :raises KeyError: Agent 未注册
        """
        if agent_code not in self._agents:
            raise KeyError(
                f"Agent '{agent_code}' 未在 Registry 中注册。"
                f" 已注册: {list(self._agents.keys())}"
            )
        return self._agents[agent_code]

    def list_all(self) -> list[AgentRecord]:
        """列出所有已注册的 Agent"""
        return list(self._agents.values())

    def list_by_tag(self, tag: str) -> list[AgentRecord]:
        """按标签筛选 Agent"""
        return [a for a in self._agents.values() if tag in a.tags]

    def list_active(self) -> list[AgentRecord]:
        """列出所有 active 状态的 Agent"""
        return [a for a in self._agents.values() if a.status == "active"]

    def ensure_available(self, agent_codes: list[str]) -> None:
        """
        确保所有必需的 Agent 处于 active 状态

        :raises RuntimeError: 存在不可用的 Agent
        """
        unavailable = []
        for code in agent_codes:
            agent = self.get(code)
            if agent.status != "active":
                unavailable.append(
                    f"{agent.agent_name}({code}): {agent.status}"
                )
        if unavailable:
            raise RuntimeError(
                f"以下 Agent 不可用: {'; '.join(unavailable)}"
            )

    def __len__(self) -> int:
        return len(self._agents)

    def __repr__(self) -> str:
        active_count = len(self.list_active())
        return (
            f"<AgentRegistry: {len(self._agents)} registered, "
            f"{active_count} active>"
        )


# ============================================================================
# 全局单例: 在应用启动时注册所有 Agent
# ============================================================================

_global_registry: AgentRegistry | None = None


def get_registry() -> AgentRegistry:
    """获取全局 AgentRegistry 单例"""
    global _global_registry
    if _global_registry is None:
        _global_registry = AgentRegistry()
    return _global_registry


def build_default_registry() -> AgentRegistry:
    """
    构建包含所有 11 个 Agent 的默认 Registry
    在应用启动时调用一次

    :return: 已注册全部 Agent 的 Registry 实例
    """
    registry = get_registry()
    registry._agents.clear()

    # 核心 Agent (6 个)
    registry.register(AgentRecord(
        agent_code="orchestrator",
        agent_name="学习导引师向南",
        version="1.0.0",
        description="总协调: 接收请求 → 读 Registry → 启动 Graph → 异常兜底",
        tags=["core"],
    ))
    registry.register(AgentRecord(
        agent_code="profile_analyst",
        agent_name="学情诊断师俞知",
        version="1.0.0",
        description="画像分析: 读取 StudentProfile → 生成轻量问卷 → 融合画像",
        tags=["core", "analysis"],
    ))
    registry.register(AgentRecord(
        agent_code="path_planner",
        agent_name="教纲设计专家李纲",
        version="1.0.0",
        description="路径规划: 基于画像动态生成阶段计划 + 汇总交付",
        tags=["core", "planning"],
    ))
    registry.register(AgentRecord(
        agent_code="resource_scout",
        agent_name="资源采集师蔡丰",
        version="1.0.0",
        description="网络调研: 博查 API 搜索 → ResearchReport + 外部链接",
        tags=["core", "search"],
    ))
    registry.register(AgentRecord(
        agent_code="quality_reviewer",
        agent_name="质量审核师简真",
        version="1.0.0",
        description="质量审查: L1 格式严格校验 + L2/L3 宽松标记",
        tags=["core", "review"],
    ))
    registry.register(AgentRecord(
        agent_code="remedial_guide",
        agent_name="解惑师霍然",
        version="1.0.0",
        description="解惑引导: 接收学生困惑描述 → 分析知识薄弱点 → 协调六匠生成个性化补救资源",
        tags=["core", "remedial"],
    ))

    # 6 个匠 (资源生成)
    crafters = [
        ("crafter_handout", "讲义编写师张义", "生成课程讲义 (Markdown)"),
        ("crafter_mindmap", "导图设计师屠思", "生成思维导图 (Markdown 标题层级)"),
        ("crafter_exercise", "习题设计师习真", "生成练习题 (JSON)"),
        ("crafter_reading", "阅读推荐师岳读", "生成拓展阅读 (Markdown)"),
        ("crafter_animation", "动画制作师董华", "生成交互动画 (HTML)"),
        ("crafter_code", "代码实操师戴码", "生成编程实操 (Markdown + 代码块)"),
    ]
    for code, name, desc in crafters:
        registry.register(AgentRecord(
            agent_code=code,
            agent_name=name,
            version="1.0.0",
            description=desc,
            tags=["material", "generation"],
        ))

    global _global_registry
    _global_registry = registry
    return registry
