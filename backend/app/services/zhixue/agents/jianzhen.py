"""
质量审核师简真 (quality_reviewer) 实现
职责:
  L1 格式校验 (严格): 导图层级/JSON有效性/HTML闭合 → 不通过触发重生成
  L2 知识一致性 (宽松): RAG 相似度计算 → 标记不阻塞
  L3 逻辑审查 (宽松): LLM 快速扫描明显问题 → 标记不阻塞

遵循 AgentHandler Protocol
"""

import json
import math
import re
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.config_service import get_config_value
from app.services.embedder import embedder as _embedder
from app.services.llm_utils import create_llm_client, parse_json_output
from app.services.zhixue.prompts import JIANZHEN_REVIEW_SYSTEM_PROMPT
from loguru import logger


async def review_materials(
    state: dict,
    *,
    db: AsyncSession | None = None,
) -> dict:
    """
    简真 — 材料审查

    对当前阶段生成的所有材料执行 L1/L2/L3 审查。

    :param state: 当前 ZhiXueState (含 materials, knowledge_context 等)
    :param db: 数据库会话 (L2 RAG 检索用, 可选)
    :return: 部分 State 字典, 含 review_report
    """
    materials = state.get("materials", {})
    if not materials:
        logger.warning("简真: 无可审查材料")
        return {
            "review_report": {
                "report_id": str(uuid.uuid4()),
                "overall_verdict": "ALL_PASS",
                "per_material": {},
                "retry_count": 0,
            }
        }

    per_material = {}
    has_l1_failure = False

    # ── 逐材料审查 ──
    for mt, material in materials.items():
        result = {
            "material_type": mt,
            "l1_passed": True,
            "l1_errors": [],
            "l2_score": None,
            "l2_warning": None,
            "l3_warning": None,
        }

        # L1: 格式校验 (严格)
        l1_result = _validate_format(mt, material)
        if not l1_result["passed"]:
            result["l1_passed"] = False
            result["l1_errors"] = l1_result["errors"]
            has_l1_failure = True
            logger.warning(
                f"简真 L1: {mt} 格式校验失败 — {l1_result['errors']}"
            )
        else:
            logger.debug(f"简真 L1: {mt} 格式校验通过")

        # L2: 知识一致性 (宽松, 仅标记)
        if result["l1_passed"]:
            l2_result = await _check_knowledge_consistency(mt, material, state)
            if l2_result["warning"]:
                result["l2_score"] = l2_result["score"]
                result["l2_warning"] = l2_result["warning"]
                logger.info(f"简真 L2: {mt} 知识一致性标记 — {l2_result['warning']}")

        per_material[mt] = result

    # L3: 逻辑审查 (宽松, 异步并行, 仅标记)
    if not has_l1_failure:
        try:
            await _check_logic_all(per_material, materials, state)
        except Exception as e:
            logger.warning(f"简真 L3: 逻辑审查异常 (非致命): {e}")

    # ── 汇总判定 ──
    retry_count = state.get("review_retry_count", 0)
    if has_l1_failure and retry_count < 2:
        overall = "RETRY_L1"
    elif has_l1_failure:
        overall = "MAX_RETRY"
    else:
        overall = "ALL_PASS"

    review_report = {
        "report_id": str(uuid.uuid4()),
        "session_id": state.get("session_id", ""),
        "stage_number": state.get("current_stage", 0),
        "per_material": per_material,
        "overall_verdict": overall,
        "retry_count": retry_count + (1 if has_l1_failure else 0),
    }

    logger.info(
        f"简真: 审查完成 — verdict={overall}, "
        f"L1_failures={sum(1 for v in per_material.values() if not v['l1_passed'])}"
    )

    return {"review_report": review_report}


# ============================================================================
# L1: 格式校验 (严格, 纯规则)
# ============================================================================

def _validate_format(material_type: str, material: dict) -> dict:
    """
    L1 格式校验 — 确保内容能够被前端正常渲染

    校验内容:
      - 思维导图: Markdown 标题层级 (根节点 + 深度 + 节点数)
      - 练习题: JSON 有效性 + questions 字段非空
      - 动画: HTML 完整性 (DOCTYPE + 闭合标签)
      - 讲义/阅读/代码: 仅检查内容非空

    :return: {"passed": bool, "errors": [str]}
    """
    content = material.get("content", "")
    errors = []

    if material_type == "mindmap":
        # 思维导图: 标题层级校验 (复用现有 resource_generators 中的逻辑)
        heading_lines = [
            l.strip() for l in content.split("\n")
            if l.strip().startswith("#")
        ]
        node_count = len(heading_lines)

        has_root = any(
            l.startswith("# ") and not l.startswith("## ")
            for l in heading_lines
        )
        depths = set()
        for line in heading_lines:
            level = 0
            for ch in line:
                if ch == '#':
                    level += 1
                else:
                    break
            depths.add(level)

        if not has_root:
            errors.append("缺少根节点 (一级标题 #)")
        if len(depths) < 3:
            errors.append(f"标题深度不足 (当前 {len(depths)} 级, 需要至少 3 级)")
        if node_count < 10:
            errors.append(f"标题节点数不足 ({node_count}, 至少 10 个)")

    elif material_type == "exercise":
        # 练习题: JSON 有效性校验
        if not content.strip():
            errors.append("习题内容为空")
        else:
            try:
                parsed = json.loads(content)
                questions = parsed.get("questions", [])
                if not questions:
                    errors.append("questions 字段为空或缺失")
            except json.JSONDecodeError as e:
                errors.append(f"JSON 解析失败: {e}")

    elif material_type == "animation":
        # 动画: HTML 完整性校验
        has_doctype = content.strip().startswith("<!DOCTYPE")
        has_closing_html = content.rstrip().endswith("</html>")
        has_closing_script = "</script>" in content if "<script" in content.lower() else True

        if not has_doctype:
            errors.append("缺少 DOCTYPE 声明")
        if not has_closing_html:
            errors.append("缺少 </html> 闭合标签")
        if not has_closing_script:
            errors.append("缺少 </script> 闭合标签")

    else:
        # 讲义/阅读/代码: 仅检查非空
        if not content or len(content.strip()) < 50:
            errors.append(f"内容过短 ({len(content)} 字符, 至少 50)")

    return {
        "passed": len(errors) == 0,
        "errors": errors,
    }


# ============================================================================
# L2: 知识一致性 (嵌入相似度)
# ============================================================================

# L2 相似度阈值: 低于此值标记知识一致性警告
_L2_SIMILARITY_THRESHOLD = 0.65

# 知识上下文参考文本的最大字符数 (避免嵌入 API token 溢出)
_L2_MAX_CONTEXT_LENGTH = 2000

# 材料内容采样最大字符数 (讲义等长文本取首尾各一半)
_L2_MAX_CONTENT_LENGTH = 3000


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """
    计算两个向量的余弦相似度

    余弦相似度 = dot(A,B) / (||A|| * ||B||)
    取值范围 [-1, 1], 值越接近 1 表示语义越相似

    :param a: 向量 a
    :param b: 向量 b
    :return: 余弦相似度
    """
    if len(a) != len(b):
        raise ValueError(f"向量维度不匹配: {len(a)} vs {len(b)}")
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


async def _check_knowledge_consistency(
    material_type: str, material: dict, state: dict
) -> dict:
    """
    L2 知识一致性检查 — 嵌入向量余弦相似度 (宽松, 仅标记)

    将知识上下文 (RAG 检索结果) 与材料内容分别嵌入,
    计算余弦相似度。相似度过低时标记 warning, 但不阻塞流程。

    与 Phase 2 关键词匹配版相比:
      - 关键词匹配: O(n) 字符串扫描, 无法理解语义 (例如"进程调度"
        和"CPU 分配策略"指同一概念但关键词不重叠)
      - 嵌入相似度: 捕捉语义层面的对齐程度, 更准确地反映材料与知识
        库的一致性

    :param material_type: 材料类型 (handout/mindmap/...)
    :param material: 材料 dict (含 content 字段)
    :param state: 当前 ZhiXueState (含 knowledge_context)
    :return: {"score": float|None, "warning": str|None}
    """
    knowledge_context = state.get("knowledge_context", [])
    if not knowledge_context:
        return {"score": None, "warning": None}

    # ── 构造知识库参考文本 ──
    # 合并前 5 条 RAG 检索结果的 content 字段
    context_parts: list[str] = []
    for kc in knowledge_context[:5]:
        kc_content = (
            kc.get("content", kc.get("text", ""))
            if isinstance(kc, dict) else str(kc)
        )
        if kc_content.strip():
            context_parts.append(kc_content.strip())
    if not context_parts:
        return {"score": None, "warning": None}

    knowledge_text = "\n\n".join(context_parts)
    # 截断以避免嵌入 API token 限制
    if len(knowledge_text) > _L2_MAX_CONTEXT_LENGTH:
        knowledge_text = knowledge_text[:_L2_MAX_CONTEXT_LENGTH]

    # ── 采样材料内容 ──
    content = material.get("content", "")
    if not content or len(content.strip()) < 50:
        return {"score": 0.0, "warning": "材料内容过短, 无法评估知识一致性"}

    # 长文本取首尾各半 (讲义可能上万字)
    if len(content) > _L2_MAX_CONTENT_LENGTH:
        half = _L2_MAX_CONTENT_LENGTH // 2
        content = content[:half] + "\n...\n" + content[-half:]

    # ── 嵌入 + 相似度计算 ──
    try:
        embeddings = await _embedder.embed_texts([knowledge_text, content])
        knowledge_vec = embeddings[0]
        content_vec = embeddings[1]

        similarity = _cosine_similarity(knowledge_vec, content_vec)
        # 将 [-1,1] 映射到 [0,1] 区间作为 score
        score = (similarity + 1.0) / 2.0
        score = round(score, 4)

        if similarity < _L2_SIMILARITY_THRESHOLD:
            return {
                "score": score,
                "warning": (
                    f"知识一致性较低 (余弦相似度={similarity:.2f}, "
                    f"阈值={_L2_SIMILARITY_THRESHOLD})"
                ),
            }

        logger.debug(
            f"简真 L2: {material_type} 余弦相似度={similarity:.3f} (score={score})"
        )
        return {"score": score, "warning": None}

    except Exception as e:
        logger.warning(f"简真 L2: 嵌入相似度计算失败 (非致命, 降级为跳过): {e}")
        return {"score": None, "warning": None}


# ============================================================================
# L3: 逻辑审查 (宽松, LLM)
# ============================================================================

async def _check_logic_all(
    per_material: dict,
    materials: dict,
    state: dict,
):
    """
    L3 逻辑审查 — LLM 快速扫描 (宽松, 仅标记)

    对所有材料进行一次性 LLM 扫描, 检查明显的逻辑问题。
    L1 不通过的材料跳过 L3 审查。
    """
    # 筛选出 L1 通过且有内容的材料
    reviewable = {
        mt: material.get("content", "")[:1500]
        for mt, material in materials.items()
        if per_material.get(mt, {}).get("l1_passed", True)
        and material.get("content", "")
    }

    if not reviewable:
        return

    client = create_llm_client()
    model = get_config_value("llm_model")

    # 构建批量审查文本
    review_text = ""
    for mt, snippet in reviewable.items():
        review_text += (
            f"\n--- {mt} ---\n{snippet[:1000]}\n"
            f"[... 共 {len(materials.get(mt, {}).get('content', ''))} 字符]\n"
        )

    stage_title = ""
    plan = state.get("learning_plan", {})
    stages = plan.get("stages", [])
    current_stage = state.get("current_stage", 0)
    if current_stage < len(stages):
        stage_title = stages[current_stage].get("title", "")

    user_prompt = f"""请快速扫描以下学习资源, 检查是否有明显的逻辑问题:

阶段主题: {stage_title}

{review_text}

如果有明显问题, 请列出; 如果没有, 返回空 issues 数组。"""

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": JIANZHEN_REVIEW_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
            max_tokens=1000,
        )
        raw = response.choices[0].message.content or ""
        result = parse_json_output(raw)

        issues = result.get("issues", [])
        for issue in issues:
            mt = issue.get("material_type", "")
            if mt in per_material:
                per_material[mt]["l3_warning"] = issue.get("description", str(issue))

        if issues:
            logger.info(f"简真 L3: 发现 {len(issues)} 个潜在问题")

    except Exception as e:
        logger.warning(f"简真 L3: LLM 扫描异常 (非致命): {e}")


# ============================================================================
# Fallback: 降级内容替换 (L1 第 3 次仍失败时)
# ============================================================================

async def fallback_materials(
    state: dict,
) -> dict:
    """
    简真 — 降级替换

    L1 审查重试耗尽 (第 3 次仍失败) 时,
    将失败的材料替换为模板化降级内容。

    :param state: 当前 ZhiXueState
    :return: 部分 State 字典, 含更新后的 materials
    """
    materials = dict(state.get("materials", {}))
    review = state.get("review_report", {})
    per_material = review.get("per_material", {})
    stages = state.get("learning_plan", {}).get("stages", [])
    current_stage = state.get("current_stage", 0)
    stage_title = (
        stages[current_stage].get("title", "")
        if current_stage < len(stages) else "当前阶段"
    )

    for mt, review_result in per_material.items():
        if not review_result.get("l1_passed", True):
            logger.warning(
                f"简真 fallback: {mt} 审查 3 次不通过, "
                f"替换为降级内容"
            )
            materials[mt] = _build_fallback_material(mt, stage_title, review_result)

    return {"materials": materials}


def _build_fallback_material(
    material_type: str, stage_title: str, review_result: dict
) -> dict:
    """构建降级内容 (模板化)"""
    errors = review_result.get("l1_errors", [])
    error_text = "; ".join(errors)

    if material_type == "mindmap":
        content = (
            f"# {stage_title}\n\n"
            f"## 核心概念\n"
            f"### 基本定义\n"
            f"### 关键特性\n"
            f"## 关键机制\n"
            f"### 工作原理\n"
            f"### 重要算法\n"
            f"## 应用实践\n"
            f"### 典型场景\n"
            f"### 常见误区\n"
            f"\n*[KB-SOURCE] 生成失败, 使用模板降级内容*"
        )
    elif material_type == "exercise":
        content = json.dumps({
            "questions": [
                {
                    "id": "q1",
                    "type": "single_choice",
                    "difficulty": "easy",
                    "question": f"关于{stage_title}的核心概念, 以下说法正确的是?",
                    "options": [
                        "A. 请参考讲义中的核心概念部分",
                        "B. 请参考讲义中的关键机制部分",
                        "C. 请参考讲义中的应用实践部分",
                        "D. 以上都可能正确",
                    ],
                    "answer": 0,
                    "explanation": "请先阅读讲义, 理解核心概念后再作答。",
                }
            ],
            "fallback": True,
            "fallback_reason": error_text,
        }, ensure_ascii=False)
    elif material_type == "animation":
        content = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>{stage_title}</title></head>
<body style="display:flex;align-items:center;justify-content:center;
height:100vh;font-family:sans-serif;background:#f8f9fa;">
<div style="text-align:center;color:#666;">
<h2>{stage_title}</h2>
<p>动画生成失败: {error_text}</p>
<p style="font-size:12px;">[KB-SOURCE] 请参考讲义学习本主题</p>
</div></body></html>"""
    else:
        # handout / reading / code: 文本降级
        content = (
            f"# {stage_title}\n\n"
            f"内容生成失败, 请参考以下知识点自行学习。\n\n"
            f"*[KB-SOURCE] 生成失败原因: {error_text}*"
        )

    return {
        "material_type": material_type,
        "title": f"{stage_title} ({material_type})",
        "content": content,
        "is_remedial": False,
        "resource_metadata": {
            "fallback": True,
            "fallback_reason": error_text,
            "source_marker": "[KB-SOURCE]",
        },
    }
