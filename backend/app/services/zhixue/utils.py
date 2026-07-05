"""
AI智学 共享工具函数
供 orchestrator 和 graph 共用的纯函数, 避免代码重复
"""


def build_profile_text(profile: dict) -> str:
    """
    从 LearningProfile 构建文本摘要 (供六匠生成时使用)

    将结构化的学习画像转换为自然语言摘要,
    作为 LLM 生成 prompt 中的「学习者画像」字段。

    :param profile: LearningProfile 字典, 可包含 study_pace, focus_area,
                    mastery_depth, learning_goals 等字段
    :return: 格式化的文本摘要 (多行), 无有效字段时返回 "通用"
    """
    parts: list[str] = []
    pace = profile.get("study_pace", "")
    if pace:
        pace_labels = {
            "steady": "每天坚持",
            "moderate": "正常节奏",
            "cram": "短期突击",
        }
        parts.append(f"学习节奏: {pace_labels.get(pace, pace)}")
    focus = profile.get("focus_area", "")
    if focus:
        parts.append(f"侧重点: {focus}")
    depth = profile.get("mastery_depth", "")
    if depth:
        parts.append(f"期望深度: {depth}")
    goals = profile.get("learning_goals", [])
    if goals:
        parts.append(f"目标: {', '.join(goals[:3])}")
    return "\n".join(parts) if parts else "通用"
