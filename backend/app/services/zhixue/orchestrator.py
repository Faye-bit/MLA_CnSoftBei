"""
学习导引师向南 (orchestrator) — 顶层协调器
职责:
  1. 接收用户请求 → 读 Registry → 验证 Agent 可用性
  2. 启动 Graph (未来 Phase 2-3) / 直接调用 Agent (Phase 1)
  3. 异常兜底 → 决策"重试/降级/报错"
  4. 状态查询

Phase 1: 直接调用 Agent (快速验证管线)
Phase 2: 接入 LangGraph StateGraph + SSE 流式输出
Phase 3: Checkpointer 持久化 + 完整条件路由
"""

import uuid
from typing import AsyncGenerator, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.zhixue.registry.registry import (
    AgentRegistry,
    get_registry,
)
from app.services.zhixue.agents.yuzhi import analyze_profile
from app.services.zhixue.session_service import (
    create_zhixue_session,
    get_zhixue_session,
)
from app.services.zhixue.state import ZhiXueState
from app.services.zhixue.graph import build_zhixue_graph, resume_graph
from app.services.zhixue.utils import build_profile_text
from app.services.zhixue.resource_generators import (
    generate_handout,
    generate_mindmap,
    generate_exercise,
    generate_reading,
    generate_coding_practice,
    generate_video_script,
)
from app.services.config_service import get_config_value
from langgraph.graph.state import CompiledStateGraph
from loguru import logger


class XiangNan:
    """
    学习导引师向南 — 顶层协调器

    Phase 1: 直接调用 Agent (快速验证管线)
    Phase 2: 接入 LangGraph StateGraph + SSE 流式输出
    """

    def __init__(self, registry: Optional[AgentRegistry] = None):
        self.registry = registry or get_registry()
        self._graph: CompiledStateGraph | None = None

    @property
    def graph(self) -> CompiledStateGraph:
        """懒加载 LangGraph 编译图"""
        if self._graph is None:
            self._graph = build_zhixue_graph()
        return self._graph

    # =========================================================================
    # Phase 1: 直接调用模式 (保留向后兼容)
    # =========================================================================

    async def start_session(
        self,
        course_id: str,
        user_id: str,
        selected_materials: list[str],
        scouting_enabled: bool,
        db: AsyncSession,
    ) -> dict:
        """
        启动学习会话 — 快速创建, 无 LLM 调用

        仅创建 DB 记录, 返回 session_id。
        问卷生成和路径规划全部在 SSE stream_session 中执行,
        用户通过进度面板实时看到每个 Agent 的工作动态。

        :return: {session_id, status, next_action}
        """
        # 1. 验证 Agent 可用性
        required = ["profile_analyst", "path_planner"]
        try:
            self.registry.ensure_available(required)
        except RuntimeError as e:
            logger.error(f"向南: Agent 不可用: {e}")
            return {
                "session_id": "",
                "status": "failed",
                "next_action": None,
                "error": {"code": "AGENT_UNAVAILABLE", "message": str(e)},
            }

        # 2. 创建会话 (快速, 仅 DB 写入)
        try:
            session = await create_zhixue_session(
                user_id=user_id,
                course_id=course_id,
                selected_materials=selected_materials,
                scouting_enabled=scouting_enabled,
                db=db,
            )
        except Exception as e:
            logger.error(f"向南: 创建会话失败: {e}")
            return {
                "session_id": "",
                "status": "failed",
                "next_action": None,
                "error": {"code": "SESSION_CREATE_FAILED", "message": str(e)},
            }

        session.status = "idle"
        session.checkpoint_thread_id = str(session.id)
        await db.commit()

        logger.info(f"向南: 会话 {session.id} 已创建 (idle), 等待 SSE 流接管")

        return {
            "session_id": str(session.id),
            "course_id": course_id,
            "status": "idle",
            "next_action": "connect_sse",
        }

    async def process_questionnaire(
        self,
        session_id: str,
        questionnaire_response: dict,
        db: AsyncSession,
    ) -> dict:
        """
        处理问卷提交 (或跳过) — 快速返回, 无 plan_path

        流程:
          1. 获取会话
          2. 调用俞知 → 融合画像 (含跳过路径)
          3. 设置 status="planning", 立即返回
          4. plan_path 在后续 SSE stream_session 中执行

        :return: {session_id, status, next_action, payload}
        """
        # 1. 获取会话
        session = await get_zhixue_session(session_id, db)
        if not session:
            return {
                "session_id": session_id,
                "status": "failed",
                "next_action": None,
                "error": {"code": "SESSION_NOT_FOUND", "message": "会话不存在"},
            }

        # 2. 保存原始问卷答案, 设置 status="planning"
        #    画像融合 (process_profile) 和路径规划 (plan_path) 均在 SSE 流中执行
        session.status = "planning"
        session.profile_snapshot = (
            session.profile_snapshot or {}
        ) | {"_raw_answers": questionnaire_response}
        session.session_metadata = {
            **(session.session_metadata or {}),
            "questionnaire_processed": True,
            "raw_answers_saved": True,
        }
        await db.commit()

        logger.info(
            f"向南: 会话 {session_id} 问卷已提交 (planning), "
            f"画像融合 + 路径规划将在 SSE 流中执行"
        )

        return {
            "session_id": session_id,
            "course_id": str(session.course_id),
            "status": "planning",
            "next_action": "connect_sse",
            "payload": {},
        }

    async def get_status(
        self,
        session_id: str,
        db: AsyncSession,
    ) -> dict:
        """查询会话状态"""
        session = await get_zhixue_session(session_id, db)
        if not session:
            return {
                "session_id": session_id,
                "status": "not_found",
            }

        stages = (session.learning_path or {}).get("stages", [])
        return {
            "session_id": str(session.id),
            "course_id": str(session.course_id),
            "status": session.status,
            "current_stage_index": session.current_stage_index,
            "total_stages": len(stages),
            "learning_path": session.learning_path,
            "study_pace": session.study_pace,
            "difficulty_adjustment": session.difficulty_adjustment,
            "selected_materials": session.selected_materials or [],
            "scouting_enabled": session.scouting_enabled
            if session.scouting_enabled is not None else True,
            "created_at": (
                session.created_at.isoformat()
                if session.created_at else None
            ),
            "is_favorited": getattr(session, "is_favorited", False),
        }

    # =========================================================================
    # Phase 3: 阶段反馈 + 补救
    # =========================================================================

    async def handle_feedback(
        self,
        session_id: str,
        mastery: str,
        remedial_selected: Optional[list[str]] = None,
        exercise_stats: Optional[dict] = None,
        db: AsyncSession | None = None,
    ) -> dict:
        """
        处理阶段反馈

        - mastered / partially_mastered: 推进 current_stage_index
        - not_mastered: 不推进阶段, 设置 remedial 标记
          (后续 stream_session 将在当前阶段生成补救资源)
        - 会话全部完成时: 调用 LLM 生成学习评价和百分制分数

        :param exercise_stats: 做题统计 {total_questions, correct_count,
            accuracy_rate, stage_details: [{title, total, correct, rate}]}
        """
        session = await get_zhixue_session(session_id, db)
        if not session:
            return {"error": "会话不存在"}

        # 调整难度
        if mastery == "mastered":
            session.difficulty_adjustment = min(
                1.0, session.difficulty_adjustment + 0.1
            )
        elif mastery == "not_mastered":
            session.difficulty_adjustment = max(
                0.0, session.difficulty_adjustment - 0.15
            )

        stages = (session.learning_path or {}).get("stages", [])

        # ── not_mastered: 不再自动触发补救 ──
        # 自 2026-07 起, 补救资源生成已独立为"解惑师霍然"负责的独立流程。
        # 用户选择"基本没掌握"后, 前端引导使用独立的"生成补救资源"按钮,
        # 通过 POST /sessions/{id}/remedial 端点触发霍然分析 + 六匠生成。
        # (旧 remedial_mode 分支在 stream_session 中保留以兼容已有会话)
        if mastery == "not_mastered":
            session.session_metadata = {
                **(session.session_metadata or {}),
                "last_feedback": mastery,
                "last_feedback_at": None,
            }
            await db.commit()
            logger.info(
                f"向南: 会话 {session_id} feedback=not_mastered, "
                f"等待用户使用独立补救按钮"
            )
            return {
                "session_id": session_id,
                "status": session.status or "delivering",
                "next_action": "use_independent_remedial",
                "current_stage_index": session.current_stage_index,
                "total_stages": len(stages),
                "difficulty_adjustment": session.difficulty_adjustment,
            }

        # ── mastered / partially_mastered: 推进阶段 ──
        session.current_stage_index += 1

        stages = (session.learning_path or {}).get("stages", [])
        if session.current_stage_index >= len(stages):
            session.status = "completed"
            # 调用 LLM 生成学习评价
            evaluation = await _generate_session_evaluation(
                session=session, exercise_stats=exercise_stats
            )
            session.session_metadata = {
                **(session.session_metadata or {}),
                "evaluation": evaluation,
            }
            await db.commit()
            logger.info(f"向南: 会话 {session_id} 全部阶段完成, 已生成学习评价")
            return {
                "session_id": session_id,
                "status": "completed",
                "next_action": "all_done",
                "current_stage_index": session.current_stage_index,
                "evaluation": evaluation,
            }

        session.status = "generating"
        session.session_metadata = {
            **(session.session_metadata or {}),
            "last_feedback": mastery,
            "last_feedback_at": None,  # TODO: timestamp
        }
        await db.commit()

        logger.info(
            f"向南: 会话 {session_id} feedback={mastery}, "
            f"advancing to stage {session.current_stage_index}"
        )

        return {
            "session_id": session_id,
            "status": "generating",
            "next_action": "next_stage",
            "current_stage_index": session.current_stage_index,
            "total_stages": len(stages),
            "difficulty_adjustment": session.difficulty_adjustment,
        }

    async def handle_remedial(
        self,
        session_id: str,
        confusion_text: str,
        resource_types: list[str],
        db: AsyncSession | None = None,
    ) -> dict:
        """
        处理独立补救资源请求 (与 handle_feedback 解耦)

        用户通过独立的"生成补救资源"按钮触发, 输入困惑描述文本,
        选择需要的资源类型。由解惑师霍然分析后协调六匠生成个性化补救资源。

        与旧 remedial_mode 的关键区别:
        - 旧流程: 选择"基本没掌握" → 自动低难度生成 (无用户困惑输入)
        - 新流程: 用户主动描述困惑 → 霍然分析 → 个性化生成指令 → 六匠执行

        :param session_id: 会话 ID
        :param confusion_text: 学生自由文本困惑描述
        :param resource_types: 需要的补救资源类型列表
        :param db: 数据库会话
        :return: {session_id, status, next_action, current_stage, total_stages}
        """
        session = await get_zhixue_session(session_id, db)
        if not session:
            return {"error": "会话不存在"}

        if not confusion_text or len(confusion_text.strip()) < 5:
            return {"error": "困惑描述至少需要 5 个字符"}

        valid_types = {"handout", "mindmap", "exercise", "reading", "animation", "code"}
        filtered_types = [t for t in resource_types if t in valid_types]
        if not filtered_types:
            return {"error": "至少需要选择一种有效的资源类型"}

        session.status = "generating"
        session.session_metadata = {
            **(session.session_metadata or {}),
            "independent_remedial_mode": True,
            "confusion_text": confusion_text.strip(),
            "remedial_resource_types": filtered_types,
        }
        await db.commit()

        stages = (session.learning_path or {}).get("stages", [])
        logger.info(
            f"向南: 会话 {session_id} 独立补救模式, "
            f"confusion='{confusion_text[:50]}...', types={filtered_types}"
        )

        return {
            "session_id": session_id,
            "status": "generating",
            "next_action": "generate_independent_remedial",
            "current_stage_index": session.current_stage_index,
            "total_stages": len(stages),
        }

    # =========================================================================
    # Phase 2: LangGraph StateGraph + SSE 流式
    # =========================================================================

    async def stream_session(
        self,
        session_id: str,
        db: AsyncSession,
    ) -> AsyncGenerator[str, None]:
        """
        SSE 流式编排 — 自定义 async generator, 精确控制每个 Agent 的进度事件

        不使用 graph.astream_events (LangGraph 事件格式与 SSE 协议不匹配)。
        改为直接调用 Agent 函数, 在步骤间精确 yield SSE 事件,
        保证前端实时看到每个 Agent 的「开始→工作中→完成」状态。

        流程:
          1. 恢复会话状态
          2. idle/questionnaire → 等待用户填写问卷
          3. planning → 李纲规划路径 (SSE 实时进度)
          4. 阶段循环: 蔡丰 → 匠并行 (实时 resource_ready) → 简真 → 交付
          5. 等待用户反馈
        """
        import asyncio as _asyncio
        import json as _json
        from app.services.llm_utils import sse_event
        from app.services.zhixue.agents.ligang import plan_path, deliver_stage
        from app.services.zhixue.agents.caifeng import scout_resources
        from app.services.zhixue.agents.crafter_base import craft_material
        from app.services.zhixue.agents.jianzhen import review_materials, fallback_materials
        from app.services.zhixue.resource_generators import (
            generate_handout, generate_mindmap, generate_exercise,
            generate_reading, generate_coding_practice, generate_video_script,
        )

        # ═══════════════════════════════════════════════════════════════
        # 1. 恢复会话
        # ═══════════════════════════════════════════════════════════════
        session = await get_zhixue_session(session_id, db)
        if not session:
            yield sse_event("error", {"message": "会话不存在"})
            return

        course_id = str(session.course_id)
        user_id = str(session.user_id)

        # 获取课程名称
        from app.models.course import Course
        course = await db.get(Course, course_id)
        course_name = course.name if course else "未知课程"

        yield sse_event("session_init", {
            "session_id": session_id,
            "course_name": course_name,
            "status": session.status,
            "selected_materials": session.selected_materials or [
                "handout", "mindmap", "exercise"
            ],
            "scouting_enabled": session.scouting_enabled
            if session.scouting_enabled is not None else True,
        })

        # 构建运行时 state
        state: dict = {
            "session_id": session_id,
            "course_id": course_id,
            "user_id": user_id,
            "selected_materials": session.selected_materials or [
                "handout", "mindmap", "exercise"
            ],
            "scouting_enabled": session.scouting_enabled,
            "difficulty_adjustment": session.difficulty_adjustment,
            "study_pace": session.study_pace or "moderate",
            "status": session.status or "idle",
            "current_stage": session.current_stage_index,
            "remedial_triggered": False,
            "review_retry_count": 0,
            "materials": {},
        }

        if session.profile_snapshot:
            state["learning_profile"] = session.profile_snapshot
            state["study_pace"] = (
                session.profile_snapshot.get("study_pace", session.study_pace)
            )

        # ═══════════════════════════════════════════════════════════════
        # 2. idle → 俞知生成问卷 (在 SSE 流中, 进度面板可见)
        #    questionnaire → 加载已有问卷, 等待用户填写
        # ═══════════════════════════════════════════════════════════════
        current_status = session.status

        if current_status == "idle":
            # 向南 + 俞知在 SSE 流中生成问卷, 进度面板实时可见
            yield sse_event("agent_start", {
                "agent": "学习导引师向南",
                "message": "正在初始化学习环境...",
            })

            yield sse_event("agent_start", {
                "agent": "学情诊断师俞知",
                "message": "正在分析课程结构, 生成课前问卷...",
            })

            try:
                state_for_q = {
                    "session_id": session_id,
                    "course_id": course_id,
                    "user_id": user_id,
                    "selected_materials": state.get("selected_materials", []),
                }
                q_result = await analyze_profile(
                    state_for_q, db=db, course_id=course_id, user_id=user_id,
                )
            except Exception as e:
                logger.error(f"俞知 问卷生成失败: {e}")
                yield sse_event("error", {"message": f"问卷生成失败: {e}"})
                return

            questionnaire = q_result.get("questionnaire")
            if questionnaire:
                from app.models.zhixue import ZhiXueQuestionnaire
                q_record = ZhiXueQuestionnaire(
                    id=uuid.uuid4(),
                    session_id=session.id,
                    questionnaire_type="initial",
                    questions=questionnaire.get("questions", []),
                    answers=None, skipped=False,
                )
                db.add(q_record)

            session.status = "questionnaire"
            await db.commit()

            yield sse_event("agent_done", {
                "agent": "学习导引师向南",
                "result_summary": "环境初始化完成",
            })
            yield sse_event("agent_done", {
                "agent": "学情诊断师俞知",
                "result_summary": f"生成了 {len(questionnaire.get('questions', []))} 道课前问卷",
            })

            q_data = {
                "questionnaire_id": str(questionnaire.get("questionnaire_id", "")),
                "session_id": session_id,
                "title": questionnaire.get("title", "课前学习调研"),
                "description": questionnaire.get("description", "请花 1 分钟回答几个问题"),
                "questions": questionnaire.get("questions", []),
                "timeout_seconds": 180,
            }
            yield sse_event("questionnaire_ready", {
                "session_id": session_id,
                "message": "请先填写课前问卷",
                "questionnaire": q_data,
            })
            yield sse_event("session_complete", {
                "session_id": session_id,
                "message": "等待用户填写问卷",
            })
            return

        if current_status == "questionnaire":
            # 已有问卷, 加载并等待用户填写
            q_data = None
            try:
                from sqlalchemy import select
                from app.models.zhixue import ZhiXueQuestionnaire
                q_stmt = (
                    select(ZhiXueQuestionnaire)
                    .where(
                        ZhiXueQuestionnaire.session_id == session.id,
                        ZhiXueQuestionnaire.questionnaire_type == "initial",
                    )
                    .order_by(ZhiXueQuestionnaire.created_at.desc())
                    .limit(1)
                )
                q_result = await db.execute(q_stmt)
                q_record = q_result.scalar_one_or_none()
                if q_record and q_record.questions:
                    q_data = {
                        "questionnaire_id": str(q_record.id),
                        "session_id": session_id,
                        "title": "课前学习调研",
                        "description": "为了给你提供更精准的学习方案, 请花 1 分钟回答几个问题",
                        "questions": q_record.questions,
                        "timeout_seconds": 180,
                    }
            except Exception as e:
                logger.warning(f"加载问卷失败: {e}")

            yield sse_event("questionnaire_ready", {
                "session_id": session_id,
                "message": "请先填写课前问卷",
                "questionnaire": q_data,
            })
            yield sse_event("session_complete", {
                "session_id": session_id,
                "message": "等待用户填写问卷",
            })
            return

        # ═══════════════════════════════════════════════════════════════
        # 2b. 独立补救模式: 解惑师霍然分析困惑 → 六匠生成 → 简真L1审查
        # ═══════════════════════════════════════════════════════════════
        meta = session.session_metadata or {}
        if meta.get("independent_remedial_mode"):
            confusion_text = meta.get("confusion_text", "")
            remedial_resource_types = meta.get("remedial_resource_types", ["handout", "exercise"])

            logger.info(
                f"独立补救模式: session={session_id}, "
                f"confusion='{confusion_text[:60]}...', types={remedial_resource_types}"
            )

            # 获取当前阶段信息
            plan = session.learning_path or {}
            stages = plan.get("stages", [])
            current_stage = session.current_stage_index
            total_stages = len(stages)

            if current_stage >= total_stages:
                yield sse_event("session_complete", {
                    "session_id": session_id,
                    "message": "全部阶段已完成",
                })
                return

            stage = stages[current_stage]
            stage_title = stage.get("title", stage.get("topic", ""))
            stage_kps = stage.get("knowledge_points", [])

            yield sse_event("stage_start", {
                "stage_index": current_stage,
                "stage_title": f"{stage_title} (独立补救)",
                "total_stages": total_stages,
            })

            # ── Step 1: 解惑师霍然 分析困惑 ──
            yield sse_event("agent_start", {
                "agent": "解惑师霍然",
                "message": "正在分析你的困惑描述...",
            })

            profile = state.get("learning_profile", {})
            state["confusion_text"] = confusion_text

            huoran_result = {}
            try:
                from app.services.zhixue.agents.huoran import analyze_confusion
                huoran_result = await analyze_confusion(state, db=db)
                state["huoran_diagnosis"] = huoran_result

                diagnosis = huoran_result.get("diagnosis", {})
                gap_analysis = diagnosis.get("gap_analysis", "")

                yield sse_event("agent_progress", {
                    "agent": "解惑师霍然",
                    "message": f"诊断: {gap_analysis[:80]}",
                })
                yield sse_event("agent_done", {
                    "agent": "解惑师霍然",
                    "result_summary": (
                        f"分析了 {len(diagnosis.get('confused_concepts', []))} 个薄弱概念"
                    ),
                })
                yield sse_event("diagnosis_ready", {
                    "diagnosis": diagnosis,
                    "summary": huoran_result.get("summary", ""),
                })
            except Exception as e:
                logger.warning(f"霍然 分析异常 (非致命): {e}")
                yield sse_event("agent_done", {
                    "agent": "解惑师霍然",
                    "result_summary": "分析跳过, 使用通用补救策略",
                })

            # ── Step 2: 匠生成补救资源 ──
            profile_summary = build_profile_text(profile)
            remedial_difficulty = max(0.0, session.difficulty_adjustment - 0.15)

            # RAG 检索 (补救用较少结果)
            knowledge_context = await _rag_retrieve_knowledge(
                stage_title, stage_kps, session.course_id, db,
                top_k=5, context_label="独立补救 RAG",
            )

            # 获取霍然的个性化生成指令
            craft_instructions = huoran_result.get("craft_instructions", {})

            craft_order = [
                mt for mt in remedial_resource_types
                if mt in ("handout", "mindmap", "exercise", "reading", "animation", "code")
            ]

            for mt in craft_order:
                agent_name = _CRAFT_AGENT_NAMES.get(mt, mt)
                craft_inst = craft_instructions.get(mt, "")
                msg = f"正在生成补救{_CRAFT_LABELS.get(mt, mt)}..."
                if craft_inst:
                    msg = f"正在根据你的困惑定制{_CRAFT_LABELS.get(mt, mt)}..."
                yield sse_event("agent_start", {
                    "agent": agent_name,
                    "message": msg,
                })

            # 并发生成 (传入霍然的个性化指令)
            # 从霍然分析结果中提取诊断数据, 构建聚焦指令
            diagnosis = huoran_result.get("diagnosis", {})
            confused_concepts = diagnosis.get("confused_concepts", [])
            gap_analysis = diagnosis.get("gap_analysis", "")

            async def _generate_remedial_single(mt: str) -> dict | None:
                """单匠补救生成, 附带霍然的个性化指令"""
                craft_inst = craft_instructions.get(mt, "")
                remedial_strategy = huoran_result.get("remedial_strategy", {})
                suggested_analogies = remedial_strategy.get("suggested_analogies", [])
                terms_to_simplify = remedial_strategy.get("terms_to_simplify", [])

                # ── 构建聚焦指令, 确保生成器针对用户困惑生成专项内容 ──
                remedial_instruction_parts = [
                    "【专项补救 — 请聚焦回答以下困惑, 而非泛讲解整个主题】",
                    "",
                    f"学生困惑: {confusion_text}",
                    "",
                    f"诊断分析: {gap_analysis}",
                    "",
                    f"薄弱知识点: {', '.join(confused_concepts) if confused_concepts else stage_title}",
                ]
                if suggested_analogies:
                    remedial_instruction_parts.append(
                        f"推荐比喻方向: {', '.join(suggested_analogies)}"
                    )
                if terms_to_simplify:
                    remedial_instruction_parts.append(
                        f"需要简化的术语: {', '.join(terms_to_simplify)}"
                    )
                if craft_inst:
                    remedial_instruction_parts.append(f"本资源生成重点: {craft_inst}")

                remedial_instruction_parts.append(
                    "请务必专门针对上述薄弱知识点进行深入讲解, 用通俗语言和具体例子帮助理解, "
                    "不要简单重复整个阶段的通用内容。"
                )
                remedial_instruction = "\n".join(remedial_instruction_parts)

                result = await _generate_single(
                    mt, stage_title,
                    stage_kps, profile_summary, knowledge_context,
                    remedial_difficulty, is_remedial=True,
                    course_id=str(session.course_id), db=db,
                    remedial_instruction=remedial_instruction,
                )
                # 将霍然的指令写入 metadata, 供前端了解补救上下文
                if result and craft_inst:
                    meta_data = result.get("resource_metadata", {}) or {}
                    meta_data["huoran_instruction"] = craft_inst[:500]
                    result["resource_metadata"] = meta_data
                return result

            tasks = [_generate_remedial_single(mt) for mt in craft_order]
            results = await _asyncio.gather(*tasks)

            materials = {}
            for i, mt in enumerate(craft_order):
                result = results[i]
                if result:
                    materials[mt] = result
                    agent_name = _CRAFT_AGENT_NAMES.get(mt, mt)
                    yield sse_event("resource_ready", {
                        "resource_type": mt,
                        "title": result.get("title", ""),
                        "stage_index": current_stage,
                        "is_remedial": True,
                    })
                    yield sse_event("agent_done", {
                        "agent": agent_name,
                        "result_summary": f"补救{_CRAFT_LABELS.get(mt, mt)}已生成",
                    })
                    # 匠重试耗尽 → 前端展示警告
                    r_meta = result.get("resource_metadata", {}) or {}
                    if r_meta.get("retries_exhausted"):
                        yield sse_event("craft_failed", {
                            "agent": agent_name,
                            "resource_type": mt,
                            "error": r_meta.get("last_error", "重试耗尽"),
                            "retry_attempts": r_meta.get("retry_attempts", 0),
                        })

            # ── Step 3: 简真 L1 审查 (仅格式审查, 跳过 L2/L3) ──
            yield sse_event("agent_start", {
                "agent": "质量审核师简真",
                "message": "正在进行补救资源格式审查...",
            })

            l1_failures = []
            try:
                from app.services.zhixue.agents.jianzhen import review_materials
                state["materials"] = materials
                review_result = await review_materials(state, db=db)
                review_report = review_result.get("review_report", {})
                per_material = review_report.get("per_material", {})

                for mt, r in per_material.items():
                    if not r.get("l1_passed", True):
                        l1_failures.append(mt)
                        logger.warning(f"简真 L1 (独立补救): {mt} 格式校验失败")

                if l1_failures:
                    # L1 重试: 重新生成失败的材料
                    yield sse_event("agent_progress", {
                        "agent": "质量审核师简真",
                        "message": f"补救资源格式修正中: {', '.join(l1_failures)}",
                    })
                    for mt in l1_failures:
                        agent_name = _CRAFT_AGENT_NAMES.get(mt, mt)
                        yield sse_event("agent_start", {
                            "agent": agent_name,
                            "message": f"重新生成补救{_CRAFT_LABELS.get(mt, mt)} (L1修正)...",
                        })
                        new_result = await _generate_remedial_single(mt)
                        if new_result:
                            materials[mt] = new_result
                            yield sse_event("resource_ready", {
                                "resource_type": mt,
                                "title": new_result.get("title", ""),
                                "stage_index": current_stage,
                                "is_remedial": True,
                            })
                        yield sse_event("agent_done", {
                            "agent": agent_name,
                            "result_summary": (
                                f"已修正: {new_result.get('title', mt)}"
                                if new_result else "修正失败"
                            ),
                        })

                yield sse_event("agent_done", {
                    "agent": "质量审核师简真",
                    "result_summary": (
                        "L1审查通过 ✓"
                        if not l1_failures
                        else f"已修正 {len(l1_failures)} 项格式问题"
                    ),
                })
            except Exception as e:
                logger.warning(f"简真 L1 (独立补救) 审查异常 (非致命): {e}")
                yield sse_event("agent_done", {
                    "agent": "质量审核师简真",
                    "result_summary": "格式审查跳过",
                })

            # ── Step 4: 持久化 (追加模式, 不覆盖原有资源) ──
            try:
                await _persist_stage_resources(
                    db, session, stage, current_stage, materials,
                    append_only=True,
                )
                session.status = "delivering"
                session.session_metadata = {
                    **(session.session_metadata or {}),
                    "independent_remedial_mode": False,
                    "independent_remedial_done": True,
                }
                await db.commit()
            except Exception as e:
                logger.error(f"独立补救资源持久化失败: {e}")

            yield sse_event("stage_complete", {
                "stage_index": current_stage,
                "resources": [
                    {
                        "resource_type": mt,
                        "title": m.get("title", ""),
                        "is_remedial": True,
                    }
                    for mt, m in materials.items()
                ],
            })
            yield sse_event("remedial_ready", {
                "stage_index": current_stage,
                "message": "个性化补救资源已生成, 请继续学习后提交阶段反馈",
            })
            yield sse_event("session_complete", {
                "session_id": session_id,
                "message": "补救资源已生成",
            })
            return

        # ═══════════════════════════════════════════════════════════════
        # 2c. [兼容] 旧补救模式: "基本没掌握" → 不推进阶段, 生成补救资源
        #      自 2026-07 起, 新会话通过独立补救流程处理,
        #      此分支仅兼容已有 remedial_mode=True 的旧会话
        # ═══════════════════════════════════════════════════════════════
        if meta.get("remedial_mode"):
            remedial_types = meta.get("remedial_types", ["handout", "exercise"])
            logger.info(
                f"补救模式: session={session_id}, "
                f"stage={session.current_stage_index}, types={remedial_types}"
            )

            # 获取当前阶段信息
            plan = session.learning_path or {}
            stages = plan.get("stages", [])
            current_stage = session.current_stage_index
            total_stages = len(stages)

            if current_stage >= total_stages:
                yield sse_event("session_complete", {
                    "session_id": session_id,
                    "message": "全部阶段已完成",
                })
                return

            stage = stages[current_stage]
            stage_title = stage.get("title", stage.get("topic", ""))

            yield sse_event("stage_start", {
                "stage_index": current_stage,
                "stage_title": f"{stage_title} (补救)",
                "total_stages": total_stages,
            })

            # 补救资源: 仅生成讲义 + 习题 (用户勾选的), 难度降低
            profile = state.get("learning_profile", {})
            profile_summary = build_profile_text(profile)
            remedial_difficulty = session.difficulty_adjustment

            stage_kps = stage.get("knowledge_points", [])
            knowledge_context = await _rag_retrieve_knowledge(
                stage_title, stage_kps, session.course_id, db,
                top_k=5, context_label="补救 RAG",
            )

            # 生成补救资源 (并行)
            craft_order = [mt for mt in remedial_types if mt in ("handout", "exercise")]

            for mt in craft_order:
                agent_name = _CRAFT_AGENT_NAMES.get(mt, mt)
                yield sse_event("agent_start", {
                    "agent": agent_name,
                    "message": f"正在生成补救{_CRAFT_LABELS.get(mt, mt)}...",
                })

            tasks = [
                _generate_single(
                    mt, f"{stage_title} (巩固补充)",
                    stage_kps, profile_summary, knowledge_context,
                    remedial_difficulty, is_remedial=True,
                    course_id=str(session.course_id), db=db,
                )
                for mt in craft_order
            ]
            results = await _asyncio.gather(*tasks)

            materials = {}
            for i, mt in enumerate(craft_order):
                result = results[i]
                if result:
                    materials[mt] = result
                    agent_name = _CRAFT_AGENT_NAMES.get(mt, mt)
                    yield sse_event("resource_ready", {
                        "resource_type": mt,
                        "title": result.get("title", ""),
                        "stage_index": current_stage,
                        "is_remedial": True,
                    })
                    yield sse_event("agent_done", {
                        "agent": agent_name,
                        "result_summary": f"补救{_CRAFT_LABELS.get(mt, mt)}已生成",
                    })
                    # 匠重试耗尽 → 前端展示警告
                    meta = result.get("resource_metadata", {}) or {}
                    if meta.get("retries_exhausted"):
                        yield sse_event("craft_failed", {
                            "agent": agent_name,
                            "resource_type": mt,
                            "error": meta.get("last_error", "重试耗尽"),
                            "retry_attempts": meta.get("retry_attempts", 0),
                        })

            # 持久化补救资源到当前阶段 (追加模式, 不覆盖原有资源)
            try:
                await _persist_stage_resources(
                    db, session, stage, current_stage, materials,
                    append_only=True,
                )
                session.status = "delivering"
                session.session_metadata = {
                    **(session.session_metadata or {}),
                    "remedial_mode": False,
                    "remedial_done": True,
                }
                await db.commit()
            except Exception as e:
                logger.error(f"补救资源持久化失败: {e}")

            yield sse_event("stage_complete", {
                "stage_index": current_stage,
                "resources": [
                    {"resource_type": mt, "title": m.get("title", ""), "is_remedial": True}
                    for mt, m in materials.items()
                ],
            })
            yield sse_event("remedial_ready", {
                "stage_index": current_stage,
                "message": "补救资源已生成, 请继续学习后点击'我已完成本阶段学习'",
            })
            yield sse_event("session_complete", {
                "session_id": session_id,
                "message": "补救资源已生成",
            })
            return

        # ═══════════════════════════════════════════════════════════════
        # 3. planning → 俞知融合画像 + 李纲规划路径 (均在 SSE 流中执行, 进度面板可见)
        # ═══════════════════════════════════════════════════════════════
        # 3a. 首先检查是否需要俞知融合画像
        profile = state.get("learning_profile") or session.profile_snapshot
        if isinstance(profile, dict) and profile.get("_raw_answers"):
            yield sse_event("agent_start", {
                "agent": "学情诊断师俞知",
                "message": "正在分析你的学习需求, 融合画像...",
            })
            try:
                from app.services.zhixue.agents.yuzhi import process_profile
                raw_answers = profile.get("_raw_answers", {})
                fusion_state = {
                    "session_id": session_id,
                    "course_id": str(session.course_id),
                    "user_id": str(session.user_id),
                    "selected_materials": session.selected_materials or [],
                    "questionnaire_response": raw_answers,
                }
                profile_result = await process_profile(
                    fusion_state, db=db, user_id=str(session.user_id),
                )
                learning_profile = profile_result.get("learning_profile", {})
                session.profile_snapshot = learning_profile
                session.study_pace = profile_result.get("study_pace", "moderate")
                session.difficulty_adjustment = profile_result.get("difficulty_adjustment", 0.5)
                state["learning_profile"] = learning_profile
                state["study_pace"] = session.study_pace
                state["difficulty_adjustment"] = session.difficulty_adjustment
                await db.commit()

                yield sse_event("agent_done", {
                    "agent": "学情诊断师俞知",
                    "result_summary": f"画像融合完成 (pace={session.study_pace})",
                })
                logger.info(f"俞知 SSE: 画像融合完成, pace={session.study_pace}")
            except Exception as e:
                logger.warning(f"俞知 SSE 画像融合失败 (非致命): {e}")
                yield sse_event("agent_done", {
                    "agent": "学情诊断师俞知",
                    "result_summary": "画像融合跳过, 使用默认值",
                })

        # 3b. 李纲路径规划
        if not session.learning_path:
            yield sse_event("agent_start", {
                "agent": "教纲设计专家李纲",
                "message": "正在分析学生画像, 规划个性化学习路径...",
            })

            try:
                plan_result = await plan_path(state, db=db, course_id=course_id)
            except Exception as e:
                logger.error(f"李纲 规划失败: {e}")
                yield sse_event("error", {"message": f"路径规划失败: {e}"})
                return

            learning_plan = plan_result.get("learning_plan", {})
            total = plan_result.get("total_stages", 0)

            # 护栏: 阶段数上限 = min(知识点总数, 12)
            # 跳过问卷时 study_pace=moderate，LLM 可能返回过多阶段
            chapters = state.get("chapters", [])
            kp_count = sum(len(ch.get("knowledge_points", [])) for ch in chapters) if chapters else 0
            if kp_count > 0 and total > kp_count:
                total = min(kp_count, 12)
                if len(learning_plan.get("stages", [])) > total:
                    learning_plan["stages"] = learning_plan["stages"][:total]
                plan_result["total_stages"] = total
                logger.warning(f"李纲: 阶段数从 {plan_result.get('total_stages', total)} 裁剪到 {total} (知识点={kp_count})")

            state.update(plan_result)

            session.learning_path = learning_plan
            session.status = "generating"
            session.session_metadata = {
                **(session.session_metadata or {}),
                "learning_plan_generated": True,
            }
            await db.commit()

            yield sse_event("agent_progress", {
                "agent": "教纲设计专家李纲",
                "message": f"根据 {state.get('study_pace', 'moderate')} 学习节奏, 规划了 {total} 个阶段",
            })
            yield sse_event("agent_done", {
                "agent": "教纲设计专家李纲",
                "result_summary": f"规划了 {total} 个阶段",
            })
            yield sse_event("path_update", {
                "learning_path": learning_plan,
                "total_stages": total,
            })
        else:
            state["learning_plan"] = session.learning_path
            state["total_stages"] = len(
                session.learning_path.get("stages", [])
            )

        # ═══════════════════════════════════════════════════════════════
        # 4. 阶段循环: current_stage → 采风 → 匠并行 → 简真 → 交付
        # ═══════════════════════════════════════════════════════════════
        stages = state.get("learning_plan", {}).get("stages", [])
        total_stages = len(stages)
        current_stage = state.get("current_stage", 0)

        if current_stage >= total_stages:
            session.status = "completed"
            await db.commit()
            yield sse_event("session_complete", {
                "session_id": session_id,
                "message": "全部阶段已完成",
            })
            return

        # 幂等性: 如果当前阶段已有资源, 跳过生成直接到反馈
        try:
            from app.models.zhixue import ZhiXueStage, ZhiXueResource
            from sqlalchemy import select as _sel
            stage_stmt = (
                _sel(ZhiXueStage)
                .where(
                    ZhiXueStage.session_id == session.id,
                    ZhiXueStage.order_index == current_stage,
                )
                .order_by(ZhiXueStage.created_at.desc())
                .limit(1)
            )
            stage_result = await db.execute(stage_stmt)
            existing_stage = stage_result.scalar_one_or_none()
            if existing_stage:
                res_stmt = (
                    _sel(ZhiXueResource)
                    .where(ZhiXueResource.stage_id == existing_stage.id)
                )
                res_result = await db.execute(res_stmt)
                existing_resources = res_result.scalars().all()
                if existing_resources:
                    logger.info(
                        f"阶段 {current_stage} 已有 {len(existing_resources)} 个资源, 跳过生成"
                    )
                    yield sse_event("stage_start", {
                        "stage_index": current_stage,
                        "stage_title": existing_stage.title,
                        "total_stages": total_stages,
                    })
                    for r in existing_resources:
                        yield sse_event("resource_ready", {
                            "resource_type": r.resource_type,
                            "resource_id": str(r.id),
                            "title": r.title,
                            "stage_index": current_stage,
                            "is_remedial": r.is_remedial,
                        })
                    yield sse_event("stage_complete", {
                        "stage_index": current_stage,
                        "resources": [
                            {"resource_type": r.resource_type, "title": r.title}
                            for r in existing_resources
                        ],
                    })
                    yield sse_event("feedback_ready", {
                        "stage_index": current_stage,
                        "stage_title": existing_stage.title,
                        "message": "请反馈你的掌握情况",
                    })
                    return
        except Exception as e:
            logger.warning(f"幂等性检查失败 (非致命): {e}")

        stage = stages[current_stage]
        stage_title = stage.get("title", stage.get("topic", ""))
        stage_kps = stage.get("knowledge_points", [])

        # 更新会话状态
        session.status = "generating"
        await db.commit()

        yield sse_event("stage_start", {
            "stage_index": current_stage,
            "stage_title": stage_title,
            "total_stages": total_stages,
        })

        # ── 4a. 李纲: 提取画像文本 ──
        profile = state.get("learning_profile", {})
        profile_summary = build_profile_text(profile)
        difficulty = state.get("difficulty_adjustment", 0.5)

        # ── 4b. RAG 检索 ──
        knowledge_context = await _rag_retrieve_knowledge(
            stage_title, stage_kps, session.course_id, db,
            top_k=8, context_label="RAG",
        )

        # ── 4c. 蔡丰: 网络调研 ──
        # 检查 session 级别 + 全局配置, 任一关闭则跳过
        # 注意: state.get("scouting_enabled", True) 在值为 None 时返回 None (非 True)
        # 因此需要显式处理 None → 默认开启
        session_scout = state.get("scouting_enabled")
        session_scout_enabled = True if session_scout is None else bool(session_scout)
        global_scout_enabled = get_config_value("scouting_enabled")
        scout_enabled = session_scout_enabled and (
            not global_scout_enabled or global_scout_enabled.lower() != "false"
        )
        if scout_enabled:
            yield sse_event("agent_start", {
                "agent": "资源采集师蔡丰",
                "message": "正在搜索外部学习资源...",
            })
            try:
                scout_result = await scout_resources(
                    state, db=db, course_id=course_id,
                )
                state.update(scout_result)
                if scout_result.get("research_report"):
                    yield sse_event("agent_done", {
                        "agent": "资源采集师蔡丰",
                        "result_summary": "网络调研完成",
                    })
                else:
                    yield sse_event("agent_done", {
                        "agent": "资源采集师蔡丰",
                        "result_summary": "跳过网络搜索 (未配置或无结果)",
                    })
            except Exception as e:
                logger.warning(f"蔡丰 搜索失败 (非致命): {e}")
                yield sse_event("agent_done", {
                    "agent": "资源采集师蔡丰",
                    "result_summary": "搜索跳过",
                })

        # ── 4c-bis. 将蔡丰搜索结果注入 knowledge_context ──
        # 六匠全部通过 knowledge_context 接收参考资料, 将蔡丰的调研报告
        # 合并到 knowledge_context 中, 使网络搜索结果随 RAG 内容一起注入 LLM prompt。
        # 拓展阅读可直接引用外部链接, 讲义/练习题/代码实操可参考网络中的内容。
        scout_context = _format_scout_context(state.get("research_report"))
        if scout_context:
            knowledge_context.extend(scout_context)
            logger.info(
                f"蔡丰: 已将 {len(scout_context)} 条搜索结果注入 knowledge_context "
                f"(摘要+链接+关键概念)"
            )

        # ── 4d. 6 匠并行生成 (实时 resource_ready) ──
        selected = state.get("selected_materials", ["handout", "mindmap", "exercise"])
        craft_order = [
            mt for mt in
            ["handout", "mindmap", "exercise", "reading", "animation", "code"]
            if mt in selected
        ]

        # 启动所有匠
        for mt in craft_order:
            agent_name = _CRAFT_AGENT_NAMES.get(mt, mt)
            yield sse_event("agent_start", {
                "agent": agent_name,
                "message": _CRAFT_MSGS.get(mt, "正在生成..."),
            })

        # 并行生成: asyncio.gather 并发 6 匠, 完成后逐个推送 resource_ready
        materials = {}
        tasks = [
            _generate_single(
                mt, stage_title, stage_kps, profile_summary,
                knowledge_context, difficulty, False, course_id, db,
            )
            for mt in craft_order
        ]
        results = await _asyncio.gather(*tasks)

        for i, mt in enumerate(craft_order):
            result = results[i]
            if result:
                materials[mt] = result
                yield sse_event("resource_ready", {
                    "resource_type": mt,
                    "title": result.get("title", ""),
                    "stage_index": current_stage,
                    "is_remedial": False,
                })
                agent_name = _CRAFT_AGENT_NAMES.get(mt, mt)
                yield sse_event("agent_done", {
                    "agent": agent_name,
                    "result_summary": f"已生成: {result.get('title', mt)}",
                })
                # 匠重试耗尽 → 前端展示警告
                meta = result.get("resource_metadata", {}) or {}
                if meta.get("retries_exhausted"):
                    yield sse_event("craft_failed", {
                        "agent": agent_name,
                        "resource_type": mt,
                        "error": meta.get("last_error", "重试耗尽"),
                        "retry_attempts": meta.get("retry_attempts", 0),
                    })

        state["materials"] = materials

        # ── 将蔡丰调研链接注入 reading 资源的 metadata ──
        # 前端 ReadingViewer 通过 resource_metadata.research_links 获取
        # 蔡丰的网络搜索结果, 渲染为可点击的外部资源跳转链接。
        if "reading" in materials:
            research = state.get("research_report", {}) or {}
            external_links = research.get("external_links", [])
            if external_links:
                reading_meta = dict(materials["reading"].get("resource_metadata", {}) or {})
                reading_meta["research_links"] = external_links
                materials["reading"]["resource_metadata"] = reading_meta
                logger.info(
                    f"蔡丰: 已将 {len(external_links)} 条外部链接"
                    f"注入 reading 资源 metadata"
                )

        # ── 4e. 简真: 质量审查 (含 L1 重试/降级) ──
        # 审查不通过时会自动重新生成失败材料 (最多 2 轮),
        # 全部耗尽后应用模板化降级内容, 确保学生不会看到损坏的资源
        yield sse_event("agent_start", {
            "agent": "质量审核师简真",
            "message": "正在进行质量审查...",
        })

        review_round = 0
        MAX_REVIEW_ROUNDS = 3  # 初始审查 + 最多 2 次重审
        overall = "ALL_PASS"
        per_material = {}

        while review_round < MAX_REVIEW_ROUNDS:
            try:
                review_result = await review_materials(state, db=db)
                state.update(review_result)
                review_report = review_result.get("review_report", {})
                overall = review_report.get("overall_verdict", "ALL_PASS")
                per_material = review_report.get("per_material", {})
            except Exception as e:
                logger.warning(f"简真 审查失败 (非致命, 跳过审查): {e}")
                overall = "ALL_PASS"
                break

            if overall == "ALL_PASS":
                break  # 全部通过, 无需重试

            # ── RETRY_L1: 重新生成 L1 失败的材料 ──
            if overall == "RETRY_L1" and review_round < MAX_REVIEW_ROUNDS - 1:
                failed_types = [
                    mt for mt, r in per_material.items()
                    if not r.get("l1_passed", True)
                ]
                if not failed_types:
                    break  # 安全守卫: 无失败材料则跳出

                logger.warning(
                    f"简真 L1: 第 {review_round + 1} 轮审查不通过, "
                    f"重生成 {failed_types}"
                )
                yield sse_event("agent_progress", {
                    "agent": "质量审核师简真",
                    "message": (
                        f"审查发现问题, 正在修正: "
                        f"{', '.join(failed_types)}"
                    ),
                })

                for mt in failed_types:
                    agent_name = _CRAFT_AGENT_NAMES.get(mt, mt)
                    yield sse_event("agent_start", {
                        "agent": agent_name,
                        "message": (
                            f"正在重新生成{_CRAFT_LABELS.get(mt, mt)}"
                            f" (L1 修正)..."
                        ),
                    })
                    new_result = await _generate_single(
                        mt, stage_title, stage_kps, profile_summary,
                        knowledge_context, difficulty, False, course_id, db,
                    )
                    if new_result:
                        materials[mt] = new_result
                        state["materials"] = materials
                        yield sse_event("resource_ready", {
                            "resource_type": mt,
                            "title": new_result.get("title", ""),
                            "stage_index": current_stage,
                            "is_remedial": False,
                        })
                    yield sse_event("agent_done", {
                        "agent": agent_name,
                        "result_summary": (
                            f"已重新生成: {new_result.get('title', mt)}"
                            if new_result else f"重新生成失败 ({mt})"
                        ),
                    })
                    # 匠重试耗尽 → 前端展示警告
                    if new_result:
                        meta = new_result.get("resource_metadata", {}) or {}
                        if meta.get("retries_exhausted"):
                            yield sse_event("craft_failed", {
                                "agent": agent_name,
                                "resource_type": mt,
                                "error": meta.get("last_error", "重试耗尽"),
                                "retry_attempts": meta.get("retry_attempts", 0),
                            })

                review_round += 1
                continue

            # ── MAX_RETRY 或已达最大轮次 → 降级替换 ──
            logger.warning(
                f"简真 L1: {review_round + 1} 轮审查后仍不通过, "
                f"应用降级内容"
            )
            fallback_result = await fallback_materials(state)
            state.update(fallback_result)
            materials = dict(state.get("materials", {}))
            break

        # ── 审查结果汇总 SSE ──
        if overall == "ALL_PASS":
            yield sse_event("agent_done", {
                "agent": "质量审核师简真",
                "result_summary": "审查通过 ✓",
            })
        else:
            yield sse_event("agent_done", {
                "agent": "质量审核师简真",
                "result_summary": (
                    "审查完成 (已修正)" if review_round > 0
                    else "审查完成 (已应用降级内容)"
                ),
            })
        yield sse_event("review_result", {
            "overall_verdict": overall,
            "per_material": per_material,
        })

        # ── 4f. 李纲: 交付 ──
        yield sse_event("agent_start", {
            "agent": "教纲设计专家李纲",
            "message": "正在汇总交付...",
        })
        delivery = await deliver_stage(state)
        state.update(delivery)
        yield sse_event("agent_done", {
            "agent": "教纲设计专家李纲",
            "result_summary": "阶段已交付",
        })

        # ── 4g. 持久化 ──
        # 持久化前再次确保蔡丰调研链接已注入 reading 资源
        # (审查阶段的 L1 重试/降级可能已替换 reading 材料)
        if "reading" in materials:
            research = state.get("research_report", {}) or {}
            external_links = research.get("external_links", [])
            if external_links:
                reading_meta = dict(materials["reading"].get("resource_metadata", {}) or {})
                if not reading_meta.get("research_links"):
                    reading_meta["research_links"] = external_links
                    materials["reading"]["resource_metadata"] = reading_meta

        try:
            await _persist_stage_resources(
                db, session, stage, current_stage, materials,
            )
            session.status = "delivering"
            await db.commit()
        except Exception as e:
            logger.error(f"持久化失败: {e}")

        yield sse_event("stage_complete", {
            "stage_index": current_stage,
            "resources": [
                {"resource_type": mt, "title": m.get("title", "")}
                for mt, m in materials.items()
            ],
        })

        # ═══════════════════════════════════════════════════════════════
        # 5. 等待反馈
        # ═══════════════════════════════════════════════════════════════
        yield sse_event("feedback_ready", {
            "stage_index": current_stage,
            "stage_title": stage_title,
            "message": "请反馈你的掌握情况",
        })
        yield sse_event("session_complete", {
            "session_id": session_id,
            "message": "阶段已交付, 等待用户反馈",
        })

    async def resume_graph(
        self,
        session_id: str,
        resume_data: dict,
        db: AsyncSession,
    ) -> dict:
        """
        恢复中断的 LangGraph 图执行 (委托给 graph.resume_graph)

        :param session_id: 会话 ID
        :param resume_data: 恢复数据 (问卷答案 / 阶段反馈)
        :param db: 数据库会话
        :return: 执行结果
        """
        return await resume_graph(self.graph, session_id, resume_data, db)


# ============================================================================
# 全局单例
# ============================================================================

_xiangnan: XiangNan | None = None


def get_xiangnan() -> XiangNan:
    """获取向南单例 (供 FastAPI 依赖注入使用)"""
    global _xiangnan
    if _xiangnan is None:
        _xiangnan = XiangNan()
    return _xiangnan


# ============================================================================
# SSE 事件辅助映射
# ============================================================================

# 资源类型 → 匠 Agent 名称
_CRAFT_AGENT_NAMES: dict[str, str] = {
    "handout": "讲义编写师张义",
    "mindmap": "导图设计师屠思",
    "exercise": "习题设计师习真",
    "reading": "阅读推荐师岳读",
    "animation": "动画制作师董华",
    "code": "代码实操师戴码",
}

_CRAFT_MSGS: dict[str, str] = {
    "handout": "正在编写课程讲义...",
    "mindmap": "正在设计思维导图...",
    "exercise": "正在编写练习题...",
    "reading": "正在整理拓展阅读...",
    "animation": "正在制作交互动画...",
    "code": "正在编写编程实操...",
}

_CRAFT_LABELS: dict[str, str] = {
    "handout": "讲义",
    "mindmap": "思维导图",
    "exercise": "练习",
    "reading": "阅读",
    "animation": "动画",
    "code": "代码",
}


async def _rag_retrieve_knowledge(
    stage_title: str,
    stage_kps: list[str],
    course_id: str,
    db: AsyncSession,
    top_k: int = 8,
    context_label: str = "RAG",
) -> list[dict]:
    """
    RAG 知识检索 → 构建 knowledge_context 列表

    从向量数据库检索与当前阶段主题最相关的文档片段,
    截断至 600 字符以控制后续 LLM 调用的上下文长度。

    :param stage_title: 阶段标题 (用于构造检索查询)
    :param stage_kps: 阶段知识点列表
    :param course_id: 课程 ID (UUID 字符串或 uuid.UUID)
    :param db: 数据库会话
    :param top_k: 检索结果数量 (主生成流程用 8, 补救流程用 5)
    :param context_label: 日志前缀 (区分调用来源)
    :return: knowledge_context 列表, 每项为 {"content", "document_filename", "score"}
    """
    knowledge_context: list[dict] = []
    try:
        from app.services.retriever import retrieve as rag_retrieve
        query = f"{stage_title} {' '.join(stage_kps[:5])}"
        results = await rag_retrieve(query, course_id, db, top_k=top_k)
        knowledge_context = [
            {
                "content": r.content[:600],
                "document_filename": r.document_filename,
                "score": r.score,
            }
            for r in results
        ]
        logger.debug(
            f"{context_label} 检索完成: top_k={top_k}, "
            f"query='{query[:60]}...' → {len(knowledge_context)} 条结果"
        )
    except Exception as e:
        logger.warning(f"{context_label} 检索失败 (非致命): {e}")
    return knowledge_context


def _format_scout_context(research_report: dict | None) -> list[dict]:
    """
    将蔡丰网络调研报告转换为 knowledge_context 条目

    所有六匠都通过 knowledge_context 接收参考资料, 将 research_report
    转换为相同格式后追加合并, 使网络搜索结果随 RAG 内容一起注入 LLM prompt。

    :param research_report: 蔡丰的 research_report, 无结果时为 None
    :return: knowledge_context 条目列表 (可直接 extend 到现有列表)
    """
    if not research_report or not isinstance(research_report, dict):
        return []

    entries: list[dict] = []

    # 1. 执行摘要 — 所有匠人均可获取网络调研的核心结论
    summary = research_report.get("executive_summary", "")
    if summary:
        entries.append({
            "content": summary,
            "document_filename": "🔍 网络调研摘要 (蔡丰)",
        })

    # 2. 外部链接 — 每条链接作为独立条目, 拓展阅读可直接引用真实 URL
    links = research_report.get("external_links", [])
    if isinstance(links, list):
        for link in links[:8]:
            if not isinstance(link, dict):
                continue
            title = link.get("title", "")
            url = link.get("url", "")
            if title and url:
                entries.append({
                    "content": f"标题: {title}\n链接: {url}",
                    "document_filename": "🔍 网络资源 (蔡丰)",
                })

    # 3. 关键概念 — 讲义/导图可参考网络中的概念表述
    concepts = research_report.get("key_concepts", [])
    if isinstance(concepts, list) and concepts:
        entries.append({
            "content": "关键概念: " + ", ".join(str(c) for c in concepts if c),
            "document_filename": "🔍 网络调研关键概念 (蔡丰)",
        })

    return entries


def _quick_validate_content(material_type: str, content) -> bool:
    """
    快速内容质量检查 — 生成后立即校验基本完整性

    所有 6 种资源的统一验证入口。原 mindmap 和 video_script 内层
    重试中的结构验证逻辑已合并至此, 由外层 _generate_single() 的重试
    循环统一驱动。

    :param material_type: 资源类型
    :param content:     生成的内容 (str)
    :return: True = 内容基本可用
    """
    if not content or not isinstance(content, str):
        return False
    stripped = content.strip()
    # 所有类型: 至少 30 字符 (排除空返回和极短错误消息)
    if len(stripped) < 30:
        return False
    # 练习题: JSON 必须可解析且 questions 非空
    if material_type == "exercise":
        import json as _json
        try:
            parsed = _json.loads(stripped)
            return isinstance(parsed.get("questions"), list) and len(parsed["questions"]) > 0
        except _json.JSONDecodeError:
            return False
    # 思维导图: Markdown 标题层级结构验证 (前端 markmap 渲染依赖)
    if material_type == "mindmap":
        heading_lines = [
            l.strip() for l in stripped.split("\n")
            if l.strip().startswith("#")
        ]
        # 根节点: 至少有一个一级标题 (# 开头且非 ##)
        has_root = any(
            l.startswith("# ") and not l.startswith("## ")
            for l in heading_lines
        )
        # 深度: 至少 3 级 (#, ##, ###)
        depths: set[int] = set()
        for line in heading_lines:
            level = 0
            for ch in line:
                if ch == '#':
                    level += 1
                else:
                    break
            depths.add(level)
        has_min_depth = len(depths) >= 3
        # 节点数: 至少 10 个标题节点
        has_min_nodes = len(heading_lines) >= 10
        if not has_root or not has_min_depth or not has_min_nodes:
            return False
    # 交互动画: HTML 完整性验证 (被截断的 HTML 缺少闭合标签)
    if material_type == "animation":
        if not stripped.startswith("<!DOCTYPE"):
            return False
        if not stripped.rstrip().endswith("</html>"):
            return False
        if "<script" in stripped.lower() and "</script>" not in stripped:
            return False
    return True


async def _generate_single(
    material_type: str,
    stage_title: str,
    kps: list[str],
    profile_summary: str,
    knowledge_context: list[dict],
    difficulty: float,
    is_remedial: bool,
    course_id: str,
    db: AsyncSession,
    remedial_instruction: str | None = None,
) -> dict | None:
    """
    生成单个材料 (被 stream_session 的并行生成调用)

    内置最多 2 次重试: API 瞬时故障 (限流/超时) 或内容验证失败
    时自动重试, 避免核心资源 (讲义/习题) 因单次抖动而显示错误信息。

    :param remedial_instruction: 独立补救模式下的聚焦指令 (含困惑描述、薄弱点、生成重点)。
        非空时, topic 会替换为包含该指令的富文本, 确保生成器针对用户具体困惑进行专项讲解。
    :return: material dict 或 None
    """
    import asyncio
    import json as _json
    import time as _time

    topic = stage_title
    if is_remedial:
        if remedial_instruction:
            # 独立补救模式: 将霍然的聚焦指令注入 topic,
            # 所有生成器都将 {topic} 嵌入 user_prompt, 指令会自动流入 LLM 调用
            topic = (
                f"{stage_title} (针对性补救)\n\n"
                f"{remedial_instruction}"
            )
        else:
            # 旧补救模式 (兼容): 仅追加后缀 + 降难度
            topic = f"{topic} (巩固补充)"
        difficulty = max(0.0, difficulty - 0.2)

    # ── 内部生成逻辑 (按类型分发到对应生成器) ──
    async def _call_generator():
        if material_type == "handout":
            return await generate_handout(topic, profile_summary, knowledge_context)
        elif material_type == "mindmap":
            return await generate_mindmap(topic, knowledge_context)
        elif material_type == "exercise":
            diff_label = (
                "easy" if is_remedial or difficulty < 0.4
                else "hard" if difficulty > 0.7 else "medium"
            )
            result = await generate_exercise(
                topic, profile_summary, knowledge_context, diff_label,
            )
            return _json.dumps(result, ensure_ascii=False)
        elif material_type == "reading":
            return await generate_reading(topic, knowledge_context)
        elif material_type == "animation":
            return await generate_video_script(topic, knowledge_context)
        elif material_type == "code":
            return await generate_coding_practice(
                topic, profile_summary, knowledge_context,
            )
        else:
            return None

    # ── 重试循环: 最多 2 次重试 = 3 次总尝试 ──
    MAX_RETRIES = 2
    last_error = None
    content = None
    t0 = _time.time()

    for attempt in range(MAX_RETRIES + 1):
        try:
            content = await _call_generator()
            if content is None:
                return None  # 不支持的类型, 直接返回

            # 快速内容质量验证
            if _quick_validate_content(material_type, content):
                elapsed = _time.time() - t0
                logger.info(
                    f"匠 {material_type}: {len(content)} 字符, {elapsed:.1f}s"
                    f"{f' (重试 {attempt} 次后成功)' if attempt > 0 else ''}"
                )
                return {
                    "material_type": material_type,
                    "title": f"{stage_title} {'(补充)' if is_remedial else ''}",
                    "content": content,
                    "is_remedial": is_remedial,
                    "resource_metadata": {
                        "generator": material_type,
                        "generation_time": elapsed,
                        "is_remedial": is_remedial,
                        "retry_attempts": attempt,
                    },
                }

            # 验证不通过 → 重试 (不打标记为 API 错误, 温度已在底层提升)
            if attempt < MAX_RETRIES:
                logger.warning(
                    f"匠 {material_type}: 内容验证失败 "
                    f"(len={len(content) if content else 0}), "
                    f"重试 {attempt + 1}/{MAX_RETRIES}"
                )
                continue

        except Exception as e:
            last_error = e
            if attempt < MAX_RETRIES:
                delay = 0.8 * (attempt + 1)  # 退避: 0.8s → 1.6s
                logger.warning(
                    f"匠 {material_type}: {type(e).__name__}, "
                    f"{delay:.1f}s 后重试 {attempt + 1}/{MAX_RETRIES}: {e}"
                )
                await asyncio.sleep(delay)
                continue

    # ── 全部重试耗尽 ──
    elapsed = _time.time() - t0
    logger.error(
        f"匠 {material_type}: {MAX_RETRIES} 次重试全部失败 "
        f"({elapsed:.1f}s), last_error={last_error}"
    )
    return {
        "material_type": material_type,
        "title": f"{stage_title} {'(补充)' if is_remedial else ''}",
        "content": (
            content
            if content and isinstance(content, str) and len(content.strip()) >= 10
            else f"# {stage_title}\n\n生成失败: {last_error}"
        ),
        "is_remedial": is_remedial,
        "resource_metadata": {
            "generator": material_type,
            "generation_time": elapsed,
            "is_remedial": is_remedial,
            "retries_exhausted": True,
            "last_error": str(last_error) if last_error else None,
        },
    }


async def _persist_stage_resources(
    db: AsyncSession,
    session,
    stage: dict,
    stage_index: int,
    materials: dict,
    *,
    append_only: bool = False,
):
    """
    持久化阶段资源到数据库

    :param append_only: True=追加到已有资源 (补救资源), False=全量替换 (常规生成)
    """
    import uuid as _uuid
    from app.models.zhixue import ZhiXueStage, ZhiXueResource

    # 查找或创建 stage
    from sqlalchemy import select
    stmt = (
        select(ZhiXueStage)
        .where(
            ZhiXueStage.session_id == session.id,
            ZhiXueStage.order_index == stage_index,
        )
        .order_by(ZhiXueStage.created_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    stage_obj = result.scalars().first()

    if not stage_obj:
        stage_obj = ZhiXueStage(
            id=_uuid.uuid4(),
            session_id=session.id,
            title=stage.get("title", ""),
            description=stage.get("description", ""),
            order_index=stage_index,
            status="completed",
            knowledge_point_ids=stage.get("knowledge_points", []),
            stage_metadata={"total_resources": len(materials)},
        )
        db.add(stage_obj)
        await db.flush()

    if not append_only:
        # 常规模式: 先删旧资源再插入 (全量替换)
        from sqlalchemy import delete
        await db.execute(
            delete(ZhiXueResource).where(ZhiXueResource.stage_id == stage_obj.id)
        )

    # 后端 → 前端 resource_type 规范化映射
    # 后端内部使用 'code' / 'animation' 作为材料类型键名,
    # 前端 ResourceType 使用 'coding_practice' / 'video_script',
    # 持久化时统一转换为前端兼容名称, 避免 ResourceTree 过滤丢失。
    _TYPE_NORMALIZE: dict[str, str] = {
        "code": "coding_practice",
        "animation": "video_script",
    }

    for i, (mt, material) in enumerate(materials.items()):
        resource = ZhiXueResource(
            id=_uuid.uuid4(),
            stage_id=stage_obj.id,
            resource_type=_TYPE_NORMALIZE.get(mt, mt),
            title=material.get("title", ""),
            description=material.get("description", ""),
            content=material.get("content", ""),
            is_remedial=material.get("is_remedial", False),
            order_index=i,
            resource_metadata=material.get("resource_metadata", {}),
        )
        db.add(resource)


# ============================================================================
# 会话完成 — LLM 学习评价
# ============================================================================

async def _generate_session_evaluation(
    session,
    exercise_stats: Optional[dict] = None,
) -> Optional[dict]:
    """
    会话全部阶段完成后，调用 LLM 生成学习评价和百分制分数

    优先使用前端传来的 exercise_stats，若没有则从 DB 中的资源数据自行计算。

    :param session: ZhiXueSession ORM 实例
    :param exercise_stats: 前端提交的做题统计 (可选)
    :return: 评价 dict {score, title, summary, strengths, suggestions} 或 None
    """
    try:
        from app.services.config_service import get_config_value
        from app.services.llm_utils import create_llm_client, parse_json_output
        from app.services.zhixue.prompts import SESSION_EVALUATION_PROMPT
        from app.models.course import Course
        from app.models.zhixue import ZhiXueStage, ZhiXueResource
        from sqlalchemy import select

        client = create_llm_client()
        model = get_config_value("llm_model")

        # 课程名称
        course_name = "未命名课程"
        if hasattr(session, "course") and session.course:
            course_name = session.course.name
        elif session.course_id:
            course_name = str(session.course_id)[:8] + "..."

        # 学习路径阶段数
        stages = (session.learning_path or {}).get("stages", [])
        total_stages = len(stages)

        # 做题统计 — 从前端数据或自行计算
        stats = exercise_stats or {}
        total_questions = stats.get("total_questions", 0)
        correct_count = stats.get("correct_count", 0)
        stage_details_list = stats.get("stage_details", [])

        # 如果前端未传评测数据，尝试从 DB 中聚合
        if not total_questions and not stage_details_list:
            db = None
            # 尝试从 session 的 AsyncSession 获取 (如果存在)
            from sqlalchemy.orm import object_session
            db = object_session(session)
            if db:
                # 查询所有阶段
                stage_query = await db.execute(
                    select(ZhiXueStage).where(
                        ZhiXueStage.session_id == session.id
                    ).order_by(ZhiXueStage.order_index)
                )
                db_stages = stage_query.scalars().all()

                total_q = 0
                correct_q = 0
                computed_stage_details = []

                for st in db_stages:
                    res_query = await db.execute(
                        select(ZhiXueResource).where(
                            ZhiXueResource.stage_id == st.id,
                            ZhiXueResource.resource_type == "exercise",
                        )
                    )
                    exercise_resources = res_query.scalars().all()

                    stage_total = 0
                    stage_correct = 0

                    for res in exercise_resources:
                        meta = res.resource_metadata or {}
                        progress = meta.get("exercise_progress", {})
                        if isinstance(progress, str):
                            import json
                            try:
                                progress = json.loads(progress)
                            except (json.JSONDecodeError, TypeError):
                                continue

                        if not isinstance(progress, dict):
                            continue

                        submitted = progress.get("submitted", {}) or {}
                        scores = progress.get("scores", {}) or {}

                        # 统计客观题正确数 (submitted 中为 true 的)
                        for qid, is_submitted in (submitted.items() if isinstance(submitted, dict) else []):
                            if isinstance(is_submitted, bool):
                                stage_total += 1
                                if is_submitted:
                                    stage_correct += 1

                        # 统计主观题分数 (score >= 6 视为正确)
                        for qid, s_data in (scores.items() if isinstance(scores, dict) else []):
                            if isinstance(s_data, dict) and s_data.get("score", 0) >= 6:
                                stage_correct += 1
                                stage_total += 1
                            elif isinstance(s_data, dict):
                                stage_total += 1

                    if stage_total > 0:
                        stage_rate = round(stage_correct / stage_total * 100)
                        computed_stage_details.append({
                            "title": st.title or f"阶段{st.order_index + 1}",
                            "total": stage_total,
                            "correct": stage_correct,
                            "rate": stage_rate,
                        })
                        total_q += stage_total
                        correct_q += stage_correct

                total_questions = total_q
                correct_count = correct_q
                stage_details_list = computed_stage_details

        # 计算正确率
        accuracy_rate = (
            round(correct_count / total_questions * 100)
            if total_questions > 0 else 0
        )

        # 各阶段详情文本
        if stage_details_list:
            stage_lines = []
            for i, sd in enumerate(stage_details_list):
                stage_lines.append(
                    f"  阶段{i + 1}「{sd.get('title', '未知')}」: "
                    f"{sd.get('correct', 0)}/{sd.get('total', 0)} 正确 "
                    f"(正确率 {sd.get('rate', 0)}%)"
                )
            stage_details_text = "\n".join(stage_lines)
        else:
            stage_details_text = "  (无详细阶段做题数据)"

        # 资源类型
        selected_materials = ", ".join(session.selected_materials or []) or "未指定"

        prompt = SESSION_EVALUATION_PROMPT.format(
            course_name=course_name,
            total_stages=total_stages,
            selected_materials=selected_materials,
            total_questions=total_questions,
            correct_count=correct_count,
            accuracy_rate=accuracy_rate,
            stage_details=stage_details_text,
        )

        response = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.5,
            max_tokens=600,
        )
        raw = response.choices[0].message.content or ""
        evaluation = parse_json_output(raw)

        logger.info(
            f"会话评价: session={session.id}, "
            f"score={evaluation.get('score', 'N/A')}, "
            f"title='{evaluation.get('title', '')}'"
        )
        return evaluation

    except Exception as e:
        logger.warning(f"会话评价生成失败 (已忽略): {e}")
        # 降级: 返回一个默认评价
        return {
            "score": None,
            "title": "恭喜完成学习！",
            "summary": "你已经完成了本课程的全部学习阶段，这是一个了不起的成就。继续加油，保持学习的热情！",
            "strengths": ["完成了全部学习阶段"],
            "suggestions": ["可以针对薄弱环节进行复习"],
        }


# ============================================================================
# LangGraph 相关工具已迁移至 graph.py:
#   AGENT_NODE_NAMES, AGENT_START_MSGS,
#   get_current_stage_title, summarize_output,
#   resume_graph
# ============================================================================
