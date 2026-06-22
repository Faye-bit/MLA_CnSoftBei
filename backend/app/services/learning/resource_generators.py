"""
资源生成器模块
包含 6 种个性化学习资源的 LLM 生成函数
每种生成器接收知识点上下文和画像信息, 返回生成的内容字符串

资源类型:
- handout: 课程讲义 (Markdown)
- mindmap: 思维导图 (Mermaid 语法)
- exercise: 练习题 (JSON 格式)
- reading: 拓展阅读 (Markdown)
- coding_practice: 代码实操 (Markdown + 代码块)
- video_script: 交互动画 (自包含 HTML 动态页面)
"""

import json
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession
from app.services.config_service import get_config_value
from loguru import logger

# ============================================================================
# LLM 客户端创建 (复用现有模式)
# ============================================================================

def _create_llm_client() -> AsyncOpenAI:
    """
    创建 OpenAI 兼容的异步 LLM 客户端
    使用运行时配置中的 API key 和 base URL
    """
    api_key = get_config_value("llm_api_key")
    api_base = get_config_value("llm_api_base")
    return AsyncOpenAI(api_key=api_key, base_url=api_base)


# ============================================================================
# JSON 解析辅助函数 (复用现有模式)
# ============================================================================

def _parse_json_output(raw: str) -> dict | list:
    """
    鲁棒的 JSON 解析: 处理 markdown 代码块包裹和常见格式问题

    :param raw: LLM 原始输出字符串
    :return: 解析后的 dict 或 list
    """
    raw = raw.strip()
    # 去除 markdown 代码块包裹
    if raw.startswith("```json"):
        raw = raw[7:]
    elif raw.startswith("```"):
        raw = raw[3:]
    if raw.endswith("```"):
        raw = raw[:-3]
    raw = raw.strip()

    # 查找 JSON 数组或对象边界
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # 尝试提取 JSON 数组
        start = raw.find("[")
        end = raw.rfind("]")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(raw[start:end + 1])
            except json.JSONDecodeError:
                pass
        # 尝试提取 JSON 对象
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(raw[start:end + 1])
            except json.JSONDecodeError:
                pass
    logger.warning(f"JSON 解析失败, 返回空: {raw[:200]}")
    return {} if raw.strip().startswith("{") else []


# ============================================================================
# System Prompts
# ============================================================================

HANDOUT_SYSTEM_PROMPT = """你是一位资深的大学课程讲师, 擅长根据学生的知识水平和学习偏好, 编写个性化的课程讲义。

你的讲义应满足以下要求:
1. 使用 Markdown 格式编写, 结构清晰, 包含标题、段落、列表、代码块和引用
2. 根据学生的知识基础调整解释深度 — 基础薄弱时多用比喻和例子, 基础扎实时深入原理
3. 每个知识点包含: 概念定义、原理讲解、典型例子、常见误区和总结
4. 语言通俗易懂, 适合自学阅读
5. 在讲义末尾可以添加思考题或自学任务

请直接输出 Markdown 格式的讲义内容, 不要用 ```markdown ``` 包裹。"""


MINDMAP_SYSTEM_PROMPT = """你是一位知识图谱专家, 擅长将课程知识点整理成结构化的思维导图。

请根据提供的知识点和主题, 生成 Mermaid mindmap 语法的思维导图。即使没有详细参考资料, 也应基于你对主题的专业知识充分展开。

语法参考 (严格遵循此格式):
mindmap
  root((根节点主题))
    分类一
      子知识点 A
        细节 1
        细节 2
      子知识点 B
    分类二
      子知识点 C
      子知识点 D
    ))重点标记((
    )难点标记(

语法规则 (必须遵守):
1. 必须以 `mindmap` 关键字开头 (独占第一行, 没有缩进)
2. 根节点用 `root((主题名称))` 格式
3. 每层缩进 2 个空格 (不可省略缩进)
4. 节点名称只包含纯文本, 不含特殊字符 (如 # * [ ] { } 等)
5. 方形节点: `节点名` , 圆形节点: `((节点名))`, 云形节点: `)节点名(`
6. 至少展开 3 层, 总共至少 10 个节点 — 这是硬性要求, 必须满足
7. 不需要 ``` 包裹, 直接以 mindmap 开头输出
8. 根节点的直接子级至少要有 3 个分类维度, 不要只列一个子节点"""


EXERCISE_SYSTEM_PROMPT = """你是一位大学课程助教, 负责编写高质量的练习题。

请根据提供的知识点和主题, 生成一套结构化的练习题。即使参考资料不够详细, 也应基于你对学科的专业知识出题。

输出格式要求 (严格的 JSON):
```json
{
  "questions": [
    {
      "id": "q1",
      "type": "single_choice",
      "difficulty": "easy",
      "points": ["关联知识点名称"],
      "question": "题目文字",
      "options": ["A. 选项1", "B. 选项2", "C. 选项3", "D. 选项4"],
      "answer": 0,
      "explanation": "详细解析, 解释为什么选这个答案, 以及其他选项为什么不正确"
    }
  ]
}
```

题目类型: single_choice (单选), multiple_choice (多选), true_false (判断), short_answer (简答), fill_blank (填空)
难度: easy (基础), medium (提升), hard (综合)
- answer 字段: 单选/判断填序号(0-based), 多选填序号数组如[0,2], 填空/简答填参考答案文本
- 每题必须包含 explanation (详细解析)
- **必须生成 6-10 道题**, 覆盖不少于 3 种题型, 难度按 30%基础+50%提升+20%综合 分配
- 即使参考资料为空, 也要基于主题专业知识出题, 严禁返回空 questions 数组"""


READING_SYSTEM_PROMPT = """你是一位学术研究助理, 擅长推荐和组织拓展阅读材料。

请根据提供的知识点和阶段主题, 生成拓展阅读材料推荐。

要求:
1. 使用 Markdown 格式
2. 按阅读难度分为: 入门级、进阶级、研究级
3. 每篇推荐包含: 标题、来源(教材/论文/博客/文档)、摘要、适用人群、预计阅读时间
4. 说明每篇材料与当前阶段知识点的关联
5. 如果有经典的教材章节或知名论文, 优先推荐

请直接输出 Markdown 格式, 不要用代码块包裹。"""


CODING_PRACTICE_SYSTEM_PROMPT = """你是一位编程实践导师, 擅长将任何课程知识点转化为可动手实操的编程练习。

请根据提供的知识点, 设计一个编程实操案例。

## 核心原则
- 任何理论知识都可以转化为代码实操, 不要跳过任何主题
- 理论性课程 (如操作系统、计算机网络、数据库原理等) 的常见代码实操方向:
  * 进程/线程调度算法模拟 (FCFS、SJF、RR、优先级调度等)
  * 内存管理算法 (页面置换 LRU/FIFO/OPT、内存分配 First Fit/Best Fit 等)
  * 文件系统模拟 (inode、目录树、磁盘调度 SCAN/C-SCAN 等)
  * 死锁检测与避免 (银行家算法、资源分配图)
  * 同步与互斥 (生产者-消费者、读者-写者、哲学家就餐)
  * 网络协议模拟 (TCP 三次握手、滑动窗口、路由算法)
  * 数据库操作 (SQL 查询模拟、B+树索引、事务并发控制)
- 即使是概念性知识, 也可以通过可视化模拟、状态机实现等方式转化为代码

## 输出要求
1. 使用 Markdown 格式, 代码部分使用代码块并标注语言
2. 包含: 任务背景、学习目标、环境要求、代码模板、实现步骤、测试样例、扩展思考
3. 代码应包含详细的注释, 便于学生理解
4. 难度适中, 既要有基础实现, 也要有提升空间
5. 如果涉及算法或数据结构, 提供可视化的思路说明
6. 优先使用 Python 作为实现语言 (简洁易懂), 除非知识点本身要求其他语言

请直接输出 Markdown 格式, 不要用代码块包裹整个输出。"""


VIDEO_SCRIPT_SYSTEM_PROMPT = """你是一位教学动画工程师, 擅长使用 HTML/CSS/JavaScript 创建交互式知识讲解动画。

你的任务是为一个【单独的重要知识点】生成一个完整的、可直接在浏览器中运行的交互式 HTML 动态页面。

## 核心原则
- 只讲一个知识点, 不要贪多
- 用动画直观展示该知识点的核心原理或变化过程
- 用户应能通过交互来理解, 而不是被动阅读

## 技术规范
1. 输出完整的 HTML5 文件: <!DOCTYPE html> 开头, 所有资源自包含 (不依赖任何外部 CDN、图片、字体)
2. 所有 CSS 写在 <style> 标签中, 所有 JS 写在 <script> 标签中
3. 使用 Canvas 或 SVG 做核心动画, 也可用 CSS Animation/Transition
4. 动画使用 requestAnimationFrame 或 CSS transition/animation, 保证流畅

## 页面结构
1. 顶部: 知识点标题 + 一句话简介
2. 中部: 交互动画主区域 (主体, 占 65%+ 可视面积)
3. 底部: 控制栏 (播放/暂停/重置/逐步演示 按钮) + 关键要点 (2-3 条)

## 交互要求
- 必须有"自动播放"和"逐步演示"两种模式
- 提供 播放/暂停、重置、上一步/下一步 按钮
- 动画过程中关键步骤要有文字标注或高亮

## 视觉风格
- 现代简约设计, 浅色背景 (#f8f9fa 或类似)
- 主色调使用 #4A90D9 (蓝), 辅色 #52c41a (绿)
- 字体系统优先使用系统默认字体栈
- 动画流畅优雅, 使用 ease-in-out 缓动

## 输出格式
直接输出完整的 HTML 代码, 不要用 ```html ``` 或任何 markdown 代码块包裹。
文件第一行必须是 <!DOCTYPE html>。"""


# ============================================================================
# 生成器函数
# ============================================================================

async def generate_handout(
    topic: str,
    profile_summary: str,
    knowledge_context: list[dict],
    db: AsyncSession = None,
) -> str:
    """
    生成课程讲义 (Markdown 格式)

    :param topic: 阶段主题
    :param profile_summary: 学生画像摘要
    :param knowledge_context: RAG 检索到的知识上下文
    :param db: 数据库会话
    :return: Markdown 格式的讲义内容
    """
    client = _create_llm_client()
    model = get_config_value("llm_model")

    # 构建知识上下文文本
    kp_text = _format_knowledge_context(knowledge_context)

    user_prompt = f"""请为以下学习阶段生成讲义:

阶段主题: {topic}

学生情况:
{profile_summary or "暂无画像信息, 按通用水平讲解"}

知识库参考资料:
{kp_text}

请生成一份适合该学生的个性化讲义。"""

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": HANDOUT_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=4000,
        )
        content = response.choices[0].message.content or ""
        logger.info(f"讲义生成完成: {topic} ({len(content)} 字符)")
        return content.strip()
    except Exception as e:
        logger.error(f"讲义生成失败: {e}")
        return f"# {topic}\n\n讲义生成失败: {str(e)}\n\n请稍后重试。"


async def generate_mindmap(
    topic: str,
    knowledge_context: list[dict],
    db: AsyncSession = None,
) -> str:
    """
    生成思维导图 (Mermaid mindmap 语法)

    :param topic: 阶段主题
    :param knowledge_context: 知识上下文
    :param db: 数据库会话
    :return: Mermaid mindmap 语法字符串
    """
    client = _create_llm_client()
    model = get_config_value("llm_model")

    kp_text = _format_knowledge_context(knowledge_context)

    user_prompt = f"""请为以下主题生成一份详细的知识思维导图:

主题: {topic}

参考资料:
{kp_text}

要求:
1. 以 "{topic}" 为根节点 (使用 root(({topic})) 语法)
2. 从根节点分出至少 3 个主要分类维度 (如: 核心概念、关键机制、典型应用、发展历程等)
3. 每个分类下展开至少 2-3 层子节点
4. 总共至少 12 个节点 (根节点 + 至少 11 个子节点)
5. 使用 ))重点概念(( 和 )难点( 标记关键和困难的知识点
6. 直接输出 Mermaid mindmap 语法, 不要用 ``` 包裹"""

    last_error = None
    for attempt in range(3):
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": MINDMAP_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.5 if attempt > 0 else 0.3,
                max_tokens=4000,
            )
            content = response.choices[0].message.content or ""

            # 后处理: 去掉可能的 markdown 代码块包裹
            content = content.strip()
            if content.startswith("```"):
                lines = content.split("\n")
                # 去掉首尾的 ``` 行
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].startswith("```"):
                    lines = lines[:-1]
                content = "\n".join(lines).strip()

            # 验证: 统计节点数量 (每行一个节点)
            node_lines = [l for l in content.split("\n") if l.strip() and not l.strip().startswith("```")]
            node_count = len(node_lines)

            if node_count < 5 and attempt < 2:
                logger.warning(
                    f"思维导图节点过少 ({node_count} 个), 重试第 {attempt + 1} 次 "
                    f"(topic={topic})"
                )
                last_error = f"节点数不足 (仅 {node_count} 个)"
                user_prompt += f"\n\n【上次输出被拒绝】节点数只有 {node_count} 个，远不满足要求。请充分展开内容，确保至少 12 个节点。"
                continue

            logger.info(
                f"思维导图生成完成: {topic} "
                f"({len(content)} 字符, {node_count} 个节点)"
            )
            return content

        except Exception as e:
            last_error = str(e)
            logger.error(f"思维导图生成失败 (尝试 {attempt + 1}/3): {e}")
            if attempt >= 2:
                break

    logger.error(f"思维导图生成最终失败: {topic}, last_error={last_error}")
    return f"mindmap\n  root(({topic}))\n    生成失败: {last_error}"


async def generate_exercise(
    topic: str,
    profile_summary: str,
    knowledge_context: list[dict],
    difficulty: str = "medium",
    db: AsyncSession = None,
) -> dict:
    """
    生成练习题 (JSON 格式)

    :param topic: 阶段主题
    :param profile_summary: 学生画像摘要
    :param knowledge_context: 知识上下文
    :param difficulty: 难度偏好
    :param db: 数据库会话
    :return: 包含 questions 数组的 dict
    """
    client = _create_llm_client()
    model = get_config_value("llm_model")

    kp_text = _format_knowledge_context(knowledge_context)

    user_prompt = f"""请为以下学习内容生成练习题:

主题: {topic}
目标难度: {difficulty} (easy=基础题, medium=提升题, hard=综合题)

学生水平: {profile_summary or "中等"}

相关知识点:
{kp_text}

请生成 8-10 道练习题, 包含单选、多选、判断、填空和简答题, 难度搭配合理 (30% 基础, 50% 提升, 20% 综合)。"""

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": EXERCISE_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=4000,
        )
        raw = response.choices[0].message.content or ""
        result = _parse_json_output(raw)

        # 确保返回结果始终有 questions 字段
        if not isinstance(result, dict):
            logger.warning(f"练习题解析结果不是 dict: {type(result)}, 返回空列表")
            return {"questions": []}

        questions = result.get("questions", [])
        if not questions or len(questions) == 0:
            logger.warning(
                f"练习题生成为空 (topic={topic}, raw_len={len(raw)}), "
                f"原始响应: {raw[:300]}"
            )
            return {"questions": []}

        logger.info(f"练习题生成完成: {topic} ({len(questions)} 道题)")
        return result

    except Exception as e:
        logger.error(f"练习题生成失败: {e}")
        return {"questions": [], "error": str(e)}


async def generate_reading(
    topic: str,
    knowledge_context: list[dict],
    db: AsyncSession = None,
) -> str:
    """
    生成拓展阅读材料 (Markdown 格式)

    :param topic: 阶段主题
    :param knowledge_context: 知识上下文
    :param db: 数据库会话
    :return: Markdown 格式的阅读推荐
    """
    client = _create_llm_client()
    model = get_config_value("llm_model")

    kp_text = _format_knowledge_context(knowledge_context)

    user_prompt = f"""请为以下学习阶段推荐拓展阅读材料:

阶段主题: {topic}

相关知识点:
{kp_text}

请推荐 4-8 篇拓展阅读材料, 分级推荐。"""

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": READING_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=3000,
        )
        content = response.choices[0].message.content or ""
        logger.info(f"拓展阅读生成完成: {topic} ({len(content)} 字符)")
        return content.strip()
    except Exception as e:
        logger.error(f"拓展阅读生成失败: {e}")
        return f"# 拓展阅读\n\n生成失败: {str(e)}"


async def generate_coding_practice(
    topic: str,
    profile_summary: str,
    knowledge_context: list[dict],
    db: AsyncSession = None,
) -> str:
    """
    生成代码实操案例 (Markdown + 代码块)

    :param topic: 阶段主题
    :param profile_summary: 学生画像摘要
    :param knowledge_context: 知识上下文
    :param db: 数据库会话
    :return: Markdown 格式的编程练习
    """
    client = _create_llm_client()
    model = get_config_value("llm_model")

    kp_text = _format_knowledge_context(knowledge_context)

    user_prompt = f"""请为以下学习内容设计编程实操练习:

主题: {topic}

学生水平: {profile_summary or "中等"}

相关知识点:
{kp_text}

请设计一个完整的编程实操案例, 包含详细的代码和注释。"""

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": CODING_PRACTICE_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=4000,
        )
        content = response.choices[0].message.content or ""
        logger.info(f"编程练习生成完成: {topic} ({len(content)} 字符)")
        return content.strip()
    except Exception as e:
        logger.error(f"编程练习生成失败: {e}")
        return f"# 编程实操\n\n生成失败: {str(e)}"


async def generate_video_script(
    topic: str,
    knowledge_context: list[dict],
    db: AsyncSession = None,
) -> str:
    """
    生成交互式 HTML 动画教学页面
    针对单独的、重要的、难以理解的知识点, 生成可直接在浏览器中运行的
    自包含 HTML 动态网页, 通过 Canvas/SVG/CSS 动画直观展示知识点的核心原理

    :param topic: 阶段主题 (应聚焦于单个重要知识点)
    :param knowledge_context: RAG 检索到的知识上下文
    :param db: 数据库会话
    :return: 完整的 HTML 文档字符串 (<!DOCTYPE html> 开头)
    """
    client = _create_llm_client()
    model = get_config_value("llm_model")

    kp_text = _format_knowledge_context(knowledge_context)

    user_prompt = f"""请为以下知识点创建一个交互式 HTML 动画教学页面:

知识点主题: {topic}

参考资料:
{kp_text}

## 选择要讲解的知识点
从以上资料中选出【最核心、最难以直观理解的一个概念】, 例如:
- 一个动态过程 (如 TCP 握手、进程调度、梯度下降)
- 一个状态变化 (如状态机转换、编译器各阶段)
- 一个空间关系 (如数据结构操作、网络拓扑变化)
- 一个对比关系 (如两种算法效率对比)

## 动画设计建议
- 用动画直观展示这个概念的"变化过程"
- 让用户能通过按钮控制动画节奏
- 关键步骤用文字标注说明"现在发生了什么"
- 如果涉及多个步骤, 用"逐步演示"模式让用户逐步理解

请直接输出完整的 HTML 代码。"""

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": VIDEO_SCRIPT_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.4,
            max_tokens=20000,  # HTML 动画页面需要充足空间 (CSS + JS + 文本)
        )
        content = response.choices[0].message.content or ""
        # 清理可能残留的 markdown 代码块包裹
        content = content.strip()
        if content.startswith("```html"):
            content = content[7:]
        elif content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()

        # =====================================================================
        # 完整性验证: 确保 HTML 不是被截断的半成品
        # 被截断的 HTML 缺少 </script>, </body> 或 </html>, 在 iframe 中
        # 会导致 JS 不执行, 页面不响应交互
        # =====================================================================
        has_closing_html = content.rstrip().endswith("</html>")
        has_body = "</body>" in content
        has_script = "<script" in content.lower()
        has_closing_script = "</script>" in content if has_script else True

        is_complete = (
            content.startswith("<!DOCTYPE") and
            has_closing_html and
            has_body and
            has_closing_script
        )

        if is_complete:
            logger.info(f"HTML 动画页面生成完成: {topic} ({len(content)} 字符)")
            return content

        # 不完整: 记录详情并尝试重试 (温度调低以减少随机性)
        missing = []
        if not content.startswith("<!DOCTYPE"):
            missing.append("DOCTYPE")
        if not has_closing_html:
            missing.append("</html>")
        if not has_body:
            missing.append("</body>")
        if not has_closing_script:
            missing.append("</script>")

        logger.warning(
            f"HTML 动画不完整 ({len(content)} 字符, 缺少: {missing}), "
            f"正在重试..."
        )

        # 重试: 降低温度 + 更紧凑的要求
        retry_prompt = (
            f"{user_prompt}\n\n"
            f"⚠️ 重要: 上次生成被截断了 (缺失 {', '.join(missing)})。\n"
            f"请生成一个更紧凑但完整的页面。\n"
            f"1. 确保 </style>, </script>, </body>, </html> 全部闭合\n"
            f"2. JS 代码精简但功能完整\n"
            f"3. 总长度控制在 8000-15000 字符以内"
        )
        response2 = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": VIDEO_SCRIPT_SYSTEM_PROMPT},
                {"role": "user", "content": retry_prompt},
            ],
            temperature=0.25,
            max_tokens=20000,
        )
        content2 = response2.choices[0].message.content or ""
        content2 = content2.strip()
        if content2.startswith("```html"):
            content2 = content2[7:]
        elif content2.startswith("```"):
            content2 = content2[3:]
        if content2.endswith("```"):
            content2 = content2[:-3]
        content2 = content2.strip()

        has_closing_html_2 = content2.rstrip().endswith("</html>")
        if content2.startswith("<!DOCTYPE") and has_closing_html_2:
            logger.info(
                f"HTML 动画重试成功: {topic} ({len(content2)} 字符)"
            )
            return content2

        # 两次都不完整: 返回重试结果 (即使不完整也比原始截断的好)
        logger.warning(
            f"HTML 动画重试仍不完整: {topic} ({len(content2)} 字符, "
            f"has_html={has_closing_html_2})"
        )
        return content2

    except Exception as e:
        logger.error(f"HTML 动画页面生成失败: {e}")
        # 返回一个简单的错误提示 HTML 页面
        return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>生成失败</title></head>
<body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;">
<div style="text-align:center;color:#666;">
<h2>😞 动画生成失败</h2>
<p>{topic}</p>
<p style="font-size:12px;">错误: {str(e)}</p>
<p style="font-size:12px;">请稍后重试或联系管理员</p>
</div>
</body>
</html>"""


# ============================================================================
# 辅助函数
# ============================================================================

def _format_knowledge_context(knowledge_context: list[dict]) -> str:
    """
    将 RAG 检索到的知识上下文格式化为 LLM 可读文本

    :param knowledge_context: 知识上下文列表
    :return: 格式化后的文本
    """
    if not knowledge_context:
        return "（知识库中暂无相关资料，请充分运用你对本主题的专业知识来生成内容，确保质量不打折扣）"

    parts = []
    for i, ctx in enumerate(knowledge_context):
        content = ctx.get("content", "")[:600]
        source = ctx.get("document_filename", "未知来源")
        parts.append(f"[参考{i + 1}] 来源: {source}\n{content}")

    return "\n\n---\n\n".join(parts)


# 资源类型到生成器函数的映射
RESOURCE_GENERATORS = {
    "handout": generate_handout,
    "mindmap": generate_mindmap,
    "exercise": generate_exercise,
    "reading": generate_reading,
    "coding_practice": generate_coding_practice,
    "video_script": generate_video_script,
}

# 资源类型的显示名称
RESOURCE_TYPE_LABELS = {
    "handout": "讲义",
    "mindmap": "思维导图",
    "exercise": "练习题",
    "reading": "拓展阅读",
    "coding_practice": "编程练习",
    "video_script": "交互动画",
}
