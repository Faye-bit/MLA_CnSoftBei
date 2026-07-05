"""
AI智学 API 端点 (v2)
提供学习会话的创建、恢复、状态查询和 SSE 流式传输

与 v1 /api/v1/learning 完全隔离, 互不影响

Phase 1: 会话创建 + 问卷流程 (同步 API)
Phase 2+: SSE 流式端点 (LangGraph StateGraph)
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Body, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.api.deps import get_current_user
from app.services.zhixue.orchestrator import get_xiangnan, XiangNan
from app.services.zhixue.registry.registry import build_default_registry
from loguru import logger

router = APIRouter(prefix="/zhixue", tags=["AI智学"])


# ============================================================================
# 应用启动时注册所有 Agent
# ============================================================================

def _ensure_registry_initialized():
    """确保 Registry 已初始化 (首次调用时构建)"""
    try:
        from app.services.zhixue.registry.registry import _global_registry
        if _global_registry is None:
            build_default_registry()
            logger.info("AI智学 Registry 已初始化 (12 个 Agent 已注册)")
    except Exception as e:
        logger.warning(f"AI智学 Registry 初始化跳过: {e}")


# 模块导入时初始化
_ensure_registry_initialized()


# ============================================================================
# 辅助: 获取向南实例
# ============================================================================

async def _get_xiangnan() -> XiangNan:
    """依赖注入: 获取向南实例"""
    return get_xiangnan()


# ============================================================================
# 健康检查
# ============================================================================

@router.get("/health")
async def health_check():
    """
    AI智学 健康检查接口

    用于验证 v2 路由正确注册且服务可用。
    可查看 Registry 中所有 Agent 的状态。
    """
    try:
        from app.services.zhixue.registry.registry import get_registry
        registry = get_registry()
        agents_status = {
            "total": len(registry),
            "active": len(registry.list_active()),
            "list": [
                {"code": a.agent_code, "name": a.agent_name, "status": a.status}
                for a in registry.list_all()
            ],
        }
    except Exception:
        agents_status = {"total": 0, "active": 0, "list": []}

    return {
        "status": "healthy",
        "service": "AI智学",
        "version": "v2",
        "agents": agents_status,
    }


# ============================================================================
# 会话管理
# ============================================================================

@router.get("/sessions")
async def list_sessions(
    skip: int = Query(default=0, ge=0, description="跳过数量"),
    limit: int = Query(default=50, ge=1, le=100, description="返回数量"),
    course_id: Optional[str] = Query(default=None, description="按课程过滤"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    列出当前用户的智学会话列表

    按更新时间倒序排列, 支持按课程过滤和分页。
    """
    from sqlalchemy import select, func as sqla_func
    from app.models.zhixue import ZhiXueSession as ZXS

    base_stmt = select(ZXS).where(ZXS.user_id == user.id)
    if course_id:
        base_stmt = base_stmt.where(ZXS.course_id == uuid.UUID(course_id))

    count_stmt = select(sqla_func.count()).select_from(base_stmt.subquery())
    count_result = await db.execute(count_stmt)
    total = count_result.scalar() or 0

    stmt = (
        base_stmt
        .order_by(ZXS.updated_at.desc())
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(stmt)
    sessions = result.scalars().all()

    # 预加载课程名称
    course_ids = {s.course_id for s in sessions}
    course_names: dict[uuid.UUID, str] = {}
    if course_ids:
        from app.models.course import Course
        course_stmt = select(Course).where(Course.id.in_(course_ids))
        course_result = await db.execute(course_stmt)
        for c in course_result.scalars().all():
            course_names[c.id] = c.name

    items = []
    for s in sessions:
        plan = s.learning_path or {}
        items.append({
            "id": str(s.id),
            "course_id": str(s.course_id),
            "course_name": course_names.get(s.course_id, "未知课程"),
            "status": s.status,
            "current_stage_index": s.current_stage_index,
            "total_stages": len(plan.get("stages", [])),
            "is_favorited": getattr(s, "is_favorited", False),
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "updated_at": s.updated_at.isoformat() if s.updated_at else None,
        })

    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": items,
    }


@router.post("/sessions")
async def start_session(
    course_id: str = Body(..., description="课程 ID"),
    selected_materials: list[str] = Body(
        default=["handout", "mindmap", "exercise"],
        description="用户选择的资源类型",
    ),
    scouting_enabled: bool = Body(
        default=True, description="是否开启采风网络搜索"
    ),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    xiangnan: XiangNan = Depends(_get_xiangnan),
):
    """
    创建智学会话 — Phase 1

    流程:
      1. Reggistry 验证 Agent 可用性
      2. 创建 ZhiXueSession
      3. 调俞知生成轻量问卷
      4. 返回问卷给前端

    返回: {session_id, status: "questionnaire", next_action: "fill_questionnaire", payload: {questionnaire}}
    """
    result = await xiangnan.start_session(
        course_id=course_id,
        user_id=str(user.id),
        selected_materials=selected_materials,
        scouting_enabled=scouting_enabled,
        db=db,
    )

    if result.get("error"):
        raise HTTPException(
            status_code=500,
            detail=result["error"],
        )

    return result


@router.post("/sessions/{session_id}/questionnaire")
async def submit_questionnaire(
    session_id: str,
    answers: list[dict] = Body(
        default_factory=list, description="问卷答案列表"
    ),
    skipped: bool = Body(default=False, description="是否跳过问卷"),
    skip_reason: str = Body(default="", description="跳过原因"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    xiangnan: XiangNan = Depends(_get_xiangnan),
):
    """
    提交问卷答案 (或跳过) — Phase 1

    流程:
      1. 获取会话
      2. 调俞知融合画像 (含跳过路径)
      3. 返回 LearningProfile

    返回: {session_id, status: "planning", next_action: "plan_path", payload: {learning_profile}}
    """
    questionnaire_response = {
        "answers": answers,
        "skipped": skipped,
        "skip_reason": skip_reason,
    }

    result = await xiangnan.process_questionnaire(
        session_id=session_id,
        questionnaire_response=questionnaire_response,
        db=db,
    )

    if result.get("error"):
        raise HTTPException(
            status_code=500,
            detail=result["error"],
        )

    return result


@router.post("/sessions/{session_id}/feedback")
async def submit_feedback(
    session_id: str,
    mastery: str = Body(..., description="mastered / partially_mastered / not_mastered"),
    remedial_selected: Optional[list[str]] = Body(default=None, description="补救资源勾选"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    xiangnan: XiangNan = Depends(_get_xiangnan),
):
    """
    提交阶段反馈, 推进到下一阶段

    流程:
      1. 更新 difficulty_adjustment
      2. current_stage_index += 1
      3. 返回新状态

    返回: {session_id, status, next_action, current_stage, total_stages}
    """
    result = await xiangnan.handle_feedback(
        session_id=session_id,
        mastery=mastery,
        remedial_selected=remedial_selected,
        db=db,
    )

    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])

    return result


@router.post("/sessions/{session_id}/remedial")
async def request_independent_remedial(
    session_id: str,
    confusion_text: str = Body(..., description="学生困惑描述 (自由文本, 5-2000 字符)"),
    resource_types: list[str] = Body(
        default=["handout", "exercise"],
        description="需要的补救资源类型: handout / mindmap / exercise / reading / animation / code",
    ),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    xiangnan: XiangNan = Depends(_get_xiangnan),
):
    """
    提交独立补救资源请求 (与阶段反馈解耦)

    用户在阶段学习过程中遇到困难时, 通过独立的"生成补救资源"按钮触发,
    输入困惑描述文本和需要的资源类型, 由解惑师霍然分析后协调六匠生成个性化补救资源。

    与旧流程的区别:
    - 旧: 选择"基本没掌握" → 自动低难度生成 (无用户困惑输入, 无个性化)
    - 新: 用户主动描述困惑 → 霍然分析 → 个性化生成指令 → 六匠执行 → 简真L1审查

    流程:
      1. 设置会话为 independent_remedial_mode
      2. 返回状态, 前端连接 SSE 流获取生成进度
      3. SSE 流中: 霍然分析 → 六匠生成 → 简真L1审查 → 交付

    返回: {session_id, status, next_action, current_stage, total_stages}
    """
    if not confusion_text or len(confusion_text.strip()) < 5:
        raise HTTPException(
            status_code=400,
            detail="困惑描述至少需要 5 个字符",
        )

    valid_types = {"handout", "mindmap", "exercise", "reading", "animation", "code"}
    filtered_types = [t for t in resource_types if t in valid_types]
    if not filtered_types:
        raise HTTPException(
            status_code=400,
            detail=f"至少需要选择一种有效的资源类型。有效类型: {', '.join(sorted(valid_types))}",
        )

    result = await xiangnan.handle_remedial(
        session_id=session_id,
        confusion_text=confusion_text.strip(),
        resource_types=filtered_types,
        db=db,
    )

    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])

    return result


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    删除智学会话 (级联删除阶段、资源、审查、问卷等所有关联数据)
    """
    from app.models.zhixue import ZhiXueSession as ZXS

    session = await db.get(ZXS, uuid.UUID(session_id))
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    # 所有权校验
    if session.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权删除此会话")

    await db.delete(session)
    await db.commit()

    logger.info(f"智学会话已删除: {session_id}")
    return {"message": "已删除", "session_id": session_id}


@router.put("/sessions/{session_id}/favorite")
async def toggle_favorite(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    切换智学会话收藏状态

    无 Body 请求, 自动翻转 is_favorited 布尔值。
    返回: {session_id, is_favorited}
    """
    from app.models.zhixue import ZhiXueSession as ZXS

    session = await db.get(ZXS, uuid.UUID(session_id))
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    if session.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权操作此会话")

    # 翻转收藏状态
    current = getattr(session, "is_favorited", False)
    session.is_favorited = not current
    await db.commit()

    logger.info(
        f"智学会话收藏状态变更: {session_id} "
        f"is_favorited={session.is_favorited}"
    )
    return {
        "session_id": session_id,
        "is_favorited": session.is_favorited,
    }


@router.post("/sessions/{session_id}/cancel")
async def cancel_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    取消当前智学会话 (直接删除)

    interrupted 状态的会话无法继续, 留着只会产生垃圾数据。
    取消时直接删除会话及其所有关联数据 (阶段、资源、审查、问卷)。
    """
    from app.models.zhixue import ZhiXueSession as ZXS

    session = await db.get(ZXS, uuid.UUID(session_id))
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    if session.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权操作此会话")

    previous_status = session.status
    await db.delete(session)
    await db.commit()

    logger.info(f"智学会话已取消并删除: {session_id} (was: {previous_status})")
    return {
        "session_id": session_id,
        "status": "deleted",
        "previous_status": previous_status,
    }


# ============================================================================
# 资源管理
# ============================================================================

@router.get("/resources/{resource_id}")
async def get_resource_detail(
    resource_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    获取资源详情 (含完整 content)
    """
    from app.models.zhixue import ZhiXueResource as ZXR

    resource = await db.get(ZXR, uuid.UUID(resource_id))
    if not resource:
        raise HTTPException(status_code=404, detail="资源不存在")

    # 通过 stage → session 验证所有权
    from app.models.zhixue import ZhiXueStage as ZXS2
    from app.models.zhixue import ZhiXueSession as ZXS3
    stage = await db.get(ZXS2, resource.stage_id)
    if not stage:
        raise HTTPException(status_code=404, detail="资源关联的阶段不存在")
    session = await db.get(ZXS3, stage.session_id)
    if not session or session.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权访问此资源")

    # map animation → video_script 兼容旧前端 viewer
    rt = resource.resource_type
    if rt == "animation":
        rt = "video_script"

    return {
        "id": str(resource.id),
        "stage_id": str(resource.stage_id) if resource.stage_id else "",
        "resource_type": rt,
        "title": resource.title,
        "description": resource.description,
        "content": resource.content,
        "order_index": resource.order_index,
        "resource_metadata": resource.resource_metadata or {},
        "is_remedial": resource.is_remedial,
        "created_at": resource.created_at.isoformat() if resource.created_at else None,
    }


@router.put("/resources/{resource_id}/progress")
async def save_exercise_progress(
    resource_id: str,
    body: dict = Body(..., description="练习进度: {answers, submitted, current_index, scores?}"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    保存练习题作答进度到 resource_metadata.exercise_progress

    v2 与 v1 共用 ExerciseViewer 组件, 此端点使 v2 资源也能像 v1 一样持久化练习状态。
    """
    from sqlalchemy.orm.attributes import flag_modified as _flag
    from app.models.zhixue import ZhiXueResource as ZXR
    from app.models.zhixue import ZhiXueStage as ZXSt
    from app.models.zhixue import ZhiXueSession as ZXS

    resource = await db.get(ZXR, uuid.UUID(resource_id))
    if not resource:
        raise HTTPException(status_code=404, detail="资源不存在")

    # 所有权验证: resource → stage → session → user
    stage = await db.get(ZXSt, resource.stage_id)
    if not stage:
        raise HTTPException(status_code=404, detail="资源关联的阶段不存在")
    session = await db.get(ZXS, stage.session_id)
    if not session or session.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权操作此资源")

    meta = dict(resource.resource_metadata or {})
    meta["exercise_progress"] = {
        "answers": body.get("answers", {}),
        "submitted": body.get("submitted", {}),
        "current_index": body.get("current_index", 0),
    }
    if body.get("scores"):
        meta["exercise_progress"]["scores"] = body["scores"]

    resource.resource_metadata = meta
    _flag(resource, "resource_metadata")  # JSONB 变更必须标记
    await db.commit()

    return {"status": "saved", "resource_id": resource_id}


@router.post("/resources/{resource_id}/score")
async def score_exercise_answer(
    resource_id: str,
    body: dict = Body(..., description="评分请求: {question_id, question_type, question_text, user_answer, reference_answer, explanation?}"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    AI 评分主观题 (填空/简答)

    调用 LLM 对比标准答案对用户作答进行 0-10 评分, 结果同时写入 resource_metadata.exercise_progress.scores。
    """
    from sqlalchemy.orm.attributes import flag_modified as _flag
    from app.models.zhixue import ZhiXueResource as ZXR
    from app.models.zhixue import ZhiXueStage as ZXSt
    from app.models.zhixue import ZhiXueSession as ZXS
    from app.services.zhixue.scoring import score_exercise_answer as _score

    resource = await db.get(ZXR, uuid.UUID(resource_id))
    if not resource:
        raise HTTPException(status_code=404, detail="资源不存在")

    # 所有权验证
    stage = await db.get(ZXSt, resource.stage_id)
    if not stage:
        raise HTTPException(status_code=404, detail="资源关联的阶段不存在")
    session = await db.get(ZXS, stage.session_id)
    if not session or session.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权操作此资源")

    # 调用 v1 的评分逻辑 (LLM)
    result = await _score(
        question_id=body["question_id"],
        question_type=body["question_type"],
        question_text=body["question_text"],
        user_answer=body["user_answer"],
        reference_answer=body.get("reference_answer", ""),
        explanation=body.get("explanation", ""),
    )

    # 将评分结果写入 resource_metadata.exercise_progress.scores
    meta = dict(resource.resource_metadata or {})
    ep = dict(meta.get("exercise_progress", {}))
    ep["scores"] = {
        **(ep.get("scores") or {}),
        body["question_id"]: result,
    }
    meta["exercise_progress"] = ep
    resource.resource_metadata = meta
    _flag(resource, "resource_metadata")
    await db.commit()

    return result


@router.get("/sessions/{session_id}/stages/{stage_index}/resources")
async def get_stage_resources(
    session_id: str,
    stage_index: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    获取指定阶段的所有资源列表 (不含 content, 供 ResourceTree 使用)
    """
    from sqlalchemy import select as _sel
    from app.models.zhixue import ZhiXueSession as ZXS
    from app.models.zhixue import ZhiXueStage as ZXSt
    from app.models.zhixue import ZhiXueResource as ZXR

    # 验证会话所有权
    session = await db.get(ZXS, uuid.UUID(session_id))
    if not session or session.user_id != user.id:
        raise HTTPException(status_code=404, detail="会话不存在")

    # 查找阶段
    stage_stmt = (
        _sel(ZXSt)
        .where(
            ZXSt.session_id == uuid.UUID(session_id),
            ZXSt.order_index == stage_index,
        )
        .order_by(ZXSt.created_at.desc())
        .limit(1)
    )
    stage_result = await db.execute(stage_stmt)
    stage = stage_result.scalar_one_or_none()
    if not stage:
        return {"resources": [], "stage_index": stage_index}

    # 查找资源
    res_stmt = (
        _sel(ZXR)
        .where(ZXR.stage_id == stage.id)
        .order_by(ZXR.order_index)
    )
    res_result = await db.execute(res_stmt)
    resources = res_result.scalars().all()

    import json as _json
    items = []
    for r in resources:
        # exercise → try parse JSON content; handout/animation → keep as-is
        rt = r.resource_type
        if rt == "animation":
            rt = "video_script"

        items.append({
            "id": str(r.id),
            "stage_id": str(r.stage_id),
            "resource_type": rt,
            "title": r.title,
            "description": r.description,
            "order_index": r.order_index,
            "resource_metadata": r.resource_metadata or {},
            "is_remedial": r.is_remedial,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })

    return {
        "stage_index": stage_index,
        "resources": items,
    }


@router.get("/sessions/{session_id}")
async def get_session_status(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    xiangnan: XiangNan = Depends(_get_xiangnan),
):
    """
    查询会话状态

    返回: {session_id, status, current_stage, study_pace, difficulty_adjustment}
    """
    result = await xiangnan.get_status(session_id=session_id, db=db)

    if result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="会话不存在")

    return result


# ============================================================================
# 资源下载
# ============================================================================

@router.get("/sessions/{session_id}/download")
async def download_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    token: Optional[str] = Query(default=None, description="JWT Token (兼容 window.open)"),
):
    """
    下载整个会话的学习资源 (zip 压缩包)

    通过 ?token=<jwt> 查询参数认证 (兼容 window.open / <a> 下载)。
    按阶段分目录, 每个资源一个独立文件。
    """
    import io
    import zipfile
    from app.models.zhixue import ZhiXueSession, ZhiXueStage, ZhiXueResource
    from app.models.course import Course
    from app.core.security import decode_access_token

    # 验证 JWT Token (查询参数方式, 兼容浏览器直接下载)
    if not token:
        raise HTTPException(status_code=401, detail="请先登录")
    try:
        payload = decode_access_token(token)
        user_id_str = payload.get("sub")
        if not user_id_str:
            raise HTTPException(status_code=401, detail="Token 无效")
        user_id = uuid.UUID(user_id_str)
    except Exception:
        raise HTTPException(status_code=401, detail="Token 无效或已过期")

    # 验证用户存在
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")

    # 获取会话并验证所有权
    from sqlalchemy import select as _sel
    session = await db.get(ZhiXueSession, uuid.UUID(session_id))
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权下载此会话")

    # 获取课程名
    course_name = "未知课程"
    course = await db.get(Course, session.course_id)
    if course:
        course_name = course.name

    # 获取所有阶段和资源
    stages_result = await db.execute(
        _sel(ZhiXueStage)
        .where(ZhiXueStage.session_id == session.id)
        .order_by(ZhiXueStage.order_index)
    )
    stages = stages_result.scalars().all()

    # 文件扩展名映射
    FILE_EXT: dict[str, str] = {
        "handout": "md",
        "mindmap": "md",
        "exercise": "json",
        "reading": "md",
        "coding_practice": "md",
        "animation": "html",
        "video_script": "html",
        "code": "md",
    }
    # 资源类型中文标签
    TYPE_LABELS: dict[str, str] = {
        "handout": "讲义", "mindmap": "思维导图", "exercise": "练习题",
        "reading": "拓展阅读", "coding_practice": "编程实操",
        "animation": "交互动画", "video_script": "交互动画",
        "code": "编程实操",
    }

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        base_dir = f"智学会话_{session_id[:8]}"

        # README.md — 会话概览
        plan = session.learning_path or {}
        total_stages = len(plan.get("stages", []))
        readme_lines = [
            f"# {course_name} — AI智学 学习资源包",
            "",
            f"- 会话 ID: {session_id}",
            f"- 状态: {session.status}",
            f"- 学习节奏: {session.study_pace or 'moderate'}",
            f"- 阶段总数: {total_stages}",
            f"- 导出时间: {session.updated_at.isoformat() if session.updated_at else 'N/A'}",
            "",
            "---",
            "",
            "## 目录",
        ]
        for s in stages:
            readme_lines.append(f"- {s.order_index + 1}. {s.title}")
        zf.writestr(f"{base_dir}/README.md", "\n".join(readme_lines))

        # 各阶段资源
        for stage in stages:
            stage_dir = f"{base_dir}/{stage.order_index + 1}_{_sanitize_filename(stage.title)}"
            stage_name = stage.title or f"阶段{stage.order_index + 1}"

            # 获取该阶段的资源
            res_result = await db.execute(
                _sel(ZhiXueResource)
                .where(ZhiXueResource.stage_id == stage.id)
                .order_by(ZhiXueResource.order_index)
            )
            resources = res_result.scalars().all()

            if not resources:
                # 空阶段: 至少写一个说明文件
                zf.writestr(
                    f"{stage_dir}/README.txt",
                    f"阶段 {stage.order_index + 1}: {stage_name}\n\n暂无生成资源",
                )
                continue

            used_filenames: set[str] = set()
            for res in resources:
                rt = res.resource_type or "unknown"
                ext = FILE_EXT.get(rt, "txt")
                label = TYPE_LABELS.get(rt, rt)
                base_name = _sanitize_filename(res.title or label)

                # 防止同名文件覆盖
                filename = f"{base_name}.{ext}"
                counter = 1
                while filename in used_filenames:
                    filename = f"{base_name}_{counter}.{ext}"
                    counter += 1
                used_filenames.add(filename)

                content = res.content or ""
                # exercise 类型: JSON 美化
                if rt in ("exercise",) and content.strip():
                    try:
                        import json as _json
                        parsed = _json.loads(content)
                        content = _json.dumps(parsed, ensure_ascii=False, indent=2)
                    except Exception:
                        pass

                zf.writestr(f"{stage_dir}/{filename}", content)

        # 如果没有任何资源, 添加说明
        if not stages:
            zf.writestr(f"{base_dir}/README.txt", "此会话暂无生成的学习资源。")

    buf.seek(0)
    # RFC 5987 编码中文文件名
    safe_name = _sanitize_filename(f"{course_name}_智学资源包.zip")
    from urllib.parse import quote
    encoded_name = quote(safe_name.encode("utf-8"))

    logger.info(
        f"下载会话: {session_id} 课程={course_name} "
        f"阶段数={len(stages)}"
    )

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_name}",
        },
    )


def _sanitize_filename(name: str) -> str:
    """清理文件名, 移除不安全的字符"""
    unsafe = '<>:"/\\|?*'
    for ch in unsafe:
        name = name.replace(ch, "_")
    # 截断过长文件名
    if len(name) > 80:
        name = name[:77] + "..."
    return name.strip()


# ============================================================================
# SSE 流式端点 (Phase 2 实现)
# ============================================================================

@router.get("/sessions/{session_id}/stream")
async def stream_events(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    xiangnan: XiangNan = Depends(_get_xiangnan),
):
    """
    SSE 流式推送 Graph 事件 — Phase 2

    从数据库恢复会话状态, 通过 LangGraph astream_events 流式输出
    所有 Agent 节点的执行进度和资源生成结果。
    """
    async def generate():
        async for sse_line in xiangnan.stream_session(
            session_id=session_id,
            db=db,
        ):
            yield sse_line

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
