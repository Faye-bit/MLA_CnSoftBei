"""
AI智学 主观题评分服务
对填空题和简答题的学生答案调用 LLM 进行智能评分
(从旧 learning/orchestrator_utils.py 迁移)
"""

from app.services.config_service import get_config_value
from app.services.llm_utils import create_llm_client, parse_json_output
from loguru import logger


# ============================================================================
# System Prompt
# ============================================================================

EXERCISE_SCORING_SYSTEM_PROMPT = """你是 MLA 智学引擎的 AI 评分教师, 负责对学生的填空题和简答题答案进行智能评分。

评分规则:
1. 满分 10 分, 最低 0 分
2. 评分标准:
   - 9-10分: 答案完全正确或接近完美, 核心要点全部命中
   - 7-8分: 答案基本正确, 覆盖了大部分核心要点, 可能有轻微遗漏
   - 5-6分: 答案部分正确, 抓住了部分要点, 但有明显遗漏或不准确
   - 3-4分: 答案有一些相关思路, 但不够准确或遗漏较多
   - 0-2分: 答案与参考答案差距较大或完全偏离主题
3. 对简答题侧重考察理解深度和要点覆盖度
4. 对填空题侧重考察关键概念/术语的准确性, 允许表述略有不同但语义一致
5. 评语 feedback 应包含:
   - 简短肯定 (如果有可取之处)
   - 指出不足或遗漏 (如有)
   - 建议改进方向 (1-2 句话)

输出格式 (严格 JSON):
{
  "score": 8,
  "feedback": "你的回答抓住了核心要点... 建议补充..."
}"""


# ============================================================================
# 评分函数
# ============================================================================

async def score_exercise_answer(
    question_id: str,
    question_type: str,
    question_text: str,
    user_answer: str,
    reference_answer: str,
    explanation: str | None = None,
) -> dict:
    """
    调用 LLM 对主观题答案进行智能评分

    :param question_id: 题目 ID
    :param question_type: 题目类型 (fill_blank / short_answer)
    :param question_text: 题目正文
    :param user_answer: 用户输入的答案
    :param reference_answer: 参考答案
    :param explanation: 题目解析 (可选)
    :return: {"question_id": str, "score": int, "feedback": str}
    """
    client = create_llm_client()
    model = get_config_value("llm_model")

    question_type_label = "填空题" if question_type == "fill_blank" else "简答题"

    user_prompt = f"""请为以下{question_type_label}的学生答案评分:

题目: {question_text}

参考答案: {reference_answer}
{f"题目解析: {explanation}" if explanation else ""}

学生答案: {user_answer}

请根据评分规则给出 0-10 的分数和评语。"""

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": EXERCISE_SCORING_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
            max_tokens=300,
        )
        raw = response.choices[0].message.content or ""
        result = parse_json_output(raw)

        score = result.get("score", 5)
        # 确保分数在 0-10 范围内
        if not isinstance(score, (int, float)) or score < 0:
            score = 5
        score = max(0, min(10, int(round(score))))

        feedback = result.get("feedback", "")
        if not feedback:
            feedback = f"评分: {score}/10"

        logger.info(
            f"AI 评分完成: question_id={question_id}, "
            f"type={question_type}, score={score}/10"
        )
        return {
            "question_id": question_id,
            "score": score,
            "feedback": feedback,
        }

    except Exception as e:
        logger.error(
            f"AI 评分失败 (降级为默认评分 5/10): "
            f"question_id={question_id}, error={type(e).__name__}: {str(e)[:200]}"
        )
        # 降级: 返回默认评分
        return {
            "question_id": question_id,
            "score": 5,
            "feedback": f"自动评分暂时不可用, 默认评分 5/10。请自行核对答案。",
        }
