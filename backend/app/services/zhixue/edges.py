"""
LangGraph 条件路由函数 (conditional_edges)
每个 router 函数读取 state, 返回下一节点名
"""

from langgraph.types import Send


# ============================================================================
# 阶段入口路由
# ============================================================================

def stage_entry_router(state: dict) -> str:
    """
    阶段入口检查: 是否还有剩余阶段?

    :return: "scout" → 还有阶段, 进入资源采集 → 生成
             "finalize" → 全部完成
    """
    current = state.get("current_stage", 0)
    total = state.get("total_stages", 0)
    status = state.get("status", "")

    # 首次进入或继续下一阶段
    if status == "interrupted":
        # 恢复中断: 回到当前阶段继续
        return "scout"

    if current < total:
        return "scout"
    return "finalize"


# ============================================================================
# 6 匠并行扇出 (Send API)
# ============================================================================

def craft_router(state: dict) -> list[Send]:
    """
    按用户选择的材料类型分发到对应匠节点 (Send API 并行扇出)

    仅扇出用户在 selected_materials 中勾选的类型。
    蔡丰开启时额外扇出 external_link 材料。
    """
    material_to_node = {
        "handout": "craft_handout",
        "mindmap": "craft_mindmap",
        "exercise": "craft_exercise",
        "reading": "craft_reading",
        "animation": "craft_animation",
        "code": "craft_code",
    }

    selected = state.get("selected_materials", ["handout", "mindmap", "exercise"])
    sends = []

    for mt in selected:
        if mt in material_to_node:
            sends.append(Send(
                material_to_node[mt],
                {"material_type": mt},
            ))

    return sends if sends else [Send("craft_handout", {"material_type": "handout"})]


def remedial_router(state: dict) -> list[Send]:
    """
    补救资源路由: 仅扇出用户勾选的补救类型 (张义+习真)

    在用户选择"基本没掌握"并勾选补救选项后调用。
    仅扇出张义 (讲义) 和/或 习真 (习题), 不生成全部 6 种。
    """
    remedial_request = state.get("remedial_request", [])
    if not remedial_request:
        return []  # 用户跳过, 不生成

    material_to_node = {
        "handout": "craft_handout",
        "exercise": "craft_exercise",
    }

    sends = []
    for mt in remedial_request:
        if mt in material_to_node:
            sends.append(Send(
                material_to_node[mt],
                {"material_type": mt, "is_remedial": True},
            ))

    return sends


# ============================================================================
# 审查路由
# ============================================================================

def review_router(state: dict) -> str:
    """
    审查结果判定 — L1 格式校验后路由

    :return: "deliver" → L1 全部通过, 进入交付
             "retry" → L1 不通过且次数<2, 重生成失败材料
             "fallback" → L1 重试耗尽, 降级替换
    """
    review = state.get("review_report", {})
    overall = review.get("overall_verdict", "ALL_PASS")
    retry_count = review.get("retry_count", 0)

    if overall == "ALL_PASS":
        return "deliver"
    elif overall == "RETRY_L1":
        return "retry"
    else:
        return "fallback"


# ============================================================================
# 反馈路由
# ============================================================================

def feedback_router(state: dict) -> str:
    """
    阶段反馈判定

    :return: "next_stage" → 已掌握/部分掌握/跳过 → 下一阶段
             "remedial" → 基本没掌握且首次触发 → 补救选项
    """
    feedback = state.get("stage_feedback", {})
    mastery = feedback.get("mastery", "partially_mastered")
    remedial_triggered = state.get("remedial_triggered", False)

    if mastery == "not_mastered" and not remedial_triggered:
        return "remedial"

    # mastered / partially_mastered / 跳过 / 已触发过补救
    return "next_stage"


# ============================================================================
# 补救后路由
# ============================================================================

def after_remedial_router(state: dict) -> str:
    """
    补救资源生成后: 直接进入交付

    :return: 始终 "deliver" (补救资源也走审查)
    """
    return "deliver"
