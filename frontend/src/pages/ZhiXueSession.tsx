/**
 * AI智学 会话页面 — 完整生命周期
 *
 * 复用 AI助学 的 ResourceTree + ResourceViewer 组件进行资源渲染。
 * 布局: 左侧资源目录树 + 右侧资源查看器。
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Layout, Spin, Typography, Button, Space, message } from 'antd'
import { ArrowLeftOutlined, ArrowRightOutlined, ExperimentOutlined, CheckCircleOutlined, MenuFoldOutlined, MenuUnfoldOutlined, TrophyOutlined } from '@ant-design/icons'
import confetti from 'canvas-confetti'
import { useZhiXueSSE } from '../hooks/useZhiXueSSE'
import ZhiXueProgress from '../components/zhixue/ZhiXueProgress'
import QuestionnaireModal from '../components/zhixue/QuestionnaireModal'
import FeedbackModal from '../components/zhixue/FeedbackModal'
import IndependentRemedialModal from '../components/zhixue/IndependentRemedialModal'
import StageSwitcher from '../components/zhixue/StageSwitcher'
import type { StageSummary } from '../components/zhixue/StageSwitcher'
import ResourceTree from '../components/learning/ResourceTree'
import ResourceViewer from '../components/learning/ResourceViewer'
import { submitZhiXueQuestionnaire, getZhiXueSessionDetail, submitZhiXueFeedback, submitZhiXueRemedial, getZhiXueStageResources, getZhiXueResourceDetail, cancelZhiXueSession, saveZhiXueExerciseProgress, scoreZhiXueExerciseAnswer, recordLearning } from '../services/api'
import type { ZhiXueQuestionnaire, ZhiXueQuestionAnswer } from '../types'
import type { GeneratedResource, GeneratedResourceDetail } from '../types'
import { blue, gray } from '../styles/tokens'

const { Content, Sider } = Layout
const { Title, Paragraph } = Typography

/** 从原始阶段数据构建 StageSummary 数组 */
function buildStageSummaries(
  stages: Array<Record<string, unknown>>,
  currentIndex: number,
): StageSummary[] {
  return stages.map((s, i) => ({
    title: (s.title as string) || (s.topic as string) || `阶段 ${i + 1}`,
    index: i,
    status: i < currentIndex ? 'completed'
      : i === currentIndex ? 'current'
        : 'pending',
  }))
}

export default function ZhiXueSession() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  // ── Phase ──
  const [loading, setLoading] = useState(true)
  const [questionnaire, setQuestionnaire] = useState<ZhiXueQuestionnaire | null>(null)
  const [showQuestionnaire, setShowQuestionnaire] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [showIndependentRemedial, setShowIndependentRemedial] = useState(false)
  const [currentStageTitle, setCurrentStageTitle] = useState('')
  const [allDone, setAllDone] = useState(false)
  const [evaluation, setEvaluation] = useState<{ score?: number; title?: string; summary?: string; strengths?: string[]; suggestions?: string[] } | null>(null)
  const [siderCollapsed, setSiderCollapsed] = useState(false)

  // ── Stage navigation ──
  /** null = 跟随当前阶段; number = 正在回看历史阶段 */
  const [viewStageIndex, setViewStageIndex] = useState<number | null>(null)
  /** 所有阶段摘要 (供 StageSwitcher 使用) */
  const [stagesInfo, setStagesInfo] = useState<StageSummary[]>([])

  // ── Stage + resources ──
  const stageIndexRef = useRef(0)
  const totalStagesRef = useRef(0)
  const sseStartedRef = useRef(false)
  const generationDoneRef = useRef(false)
  /** 记录当前会话的 course_id, 用于 learn record 等统计 */
  const sessionCourseIdRef = useRef<string | null>(null)

  // Resource viewer state
  const [resources, setResources] = useState<GeneratedResource[]>([])
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null)
  const [selectedResource, setSelectedResource] = useState<GeneratedResourceDetail | null>(null)
  const [resourceLoading, setResourceLoading] = useState(false)

  // ── SSE Hook ──
  const sse = useZhiXueSSE({
    onSessionInit: () => setLoading(false),
    onQuestionnaireReady: (data) => {
      setLoading(false)
      if (data?.questionnaire) setQuestionnaire(data.questionnaire as ZhiXueQuestionnaire)
      setShowQuestionnaire(true)
    },
    onPathUpdate: (data) => {
      const lp = data.learning_path as Record<string, unknown> | undefined
      const stages = lp?.stages as unknown[] | undefined
      if (stages?.length) {
        totalStagesRef.current = stages.length
        const sIdx = typeof data.stage_index === 'number' ? data.stage_index : stageIndexRef.current
        setStagesInfo(buildStageSummaries(
          stages as Array<Record<string, unknown>>,
          sIdx,
        ))
      }
      if (typeof data.total_stages === 'number') totalStagesRef.current = data.total_stages
      if (typeof data.stage_index === 'number') stageIndexRef.current = data.stage_index
    },
    onStageStart: (data) => {
      if (typeof data.stage_index === 'number') stageIndexRef.current = data.stage_index
      if (typeof data.total_stages === 'number') totalStagesRef.current = data.total_stages
      // 新阶段开始时刷新 stagesInfo
      setStagesInfo(prev => prev.map(s => ({
        ...s,
        status: s.index < stageIndexRef.current ? 'completed'
          : s.index === stageIndexRef.current ? 'current'
            : 'pending',
      }) as StageSummary))
    },
    onStageComplete: () => setLoading(false),
    onFeedbackReady: async (data) => {
      generationDoneRef.current = true
      if (typeof data.stage_index === 'number') stageIndexRef.current = data.stage_index
      setCurrentStageTitle((data.stage_title as string) || '')
      // 如果用户正在回看历史阶段, 不自动跳转
      if (viewStageIndex !== null) return
      loadStageResources(stageIndexRef.current)
    },
    onRemedialReady: async (data) => {
      generationDoneRef.current = true
      if (typeof data.stage_index === 'number') stageIndexRef.current = data.stage_index
      if (viewStageIndex !== null) return
      loadStageResources(stageIndexRef.current)
    },
    onSessionComplete: () => setLoading(false),
    onError: (msg) => { message.error(msg); setLoading(false) },
  })

  // ── Load stage resources from backend ──
  async function loadStageResources(stageIdx: number) {
    if (!id) return
    try {
      const resList = await getZhiXueStageResources(id, stageIdx)
      setResources(resList)
      // Auto-select first resource
      if (resList.length > 0) {
        selectResource(resList[0])
      }
    } catch (err) {
      message.error('加载资源失败: ' + (err as Error).message)
    }
  }

  // ── Select and load a resource ──
  async function selectResource(res: GeneratedResource) {
    setSelectedResourceId(res.id)
    setResourceLoading(true)
    setSelectedResource(null)
    // 记录学习行为 (艾宾浩斯复习计划)
    recordLearning({
      content_type: 'resource',
      content_title: res.title,
      course_id: sessionCourseIdRef.current || undefined,
    }).catch(() => {})
    try {
      const detail = await getZhiXueResourceDetail(res.id)
      setSelectedResource(detail)
    } catch {
      message.error('加载资源详情失败')
    } finally {
      setResourceLoading(false)
    }
  }

  // ── Init ──
  // 先尝试加载已有资源, 有就直接展示; 没有才启动 SSE
  useEffect(() => {
    if (!id || sseStartedRef.current) return
    if (generationDoneRef.current) { setLoading(false); return }

    ;(async () => {
      try {
        // 检查当前阶段是否已有资源
        const session = await getZhiXueSessionDetail(id)
        sessionCourseIdRef.current = session.course_id || null
        if (!session || session.status === 'completed') {
          setLoading(false); setAllDone(true); return
        }

        const stageIdx = session.current_stage_index ?? 0
        const existingResources = await getZhiXueStageResources(id, stageIdx)
        if (existingResources.length > 0) {
          // 已有资源, 直接展示, 不启动 SSE
          setLoading(false)
          setResources(existingResources)
          const path = ((session as unknown) as Record<string, unknown>).learning_path as Record<string, unknown> | undefined
          const stages = (path?.stages as Array<Record<string, unknown>>) || []
          const stage = stages[stageIdx]
          setCurrentStageTitle((stage?.title as string) || (stage?.topic as string) || '')
          stageIndexRef.current = stageIdx
          totalStagesRef.current = stages.length
          // 存储阶段信息供 StageSwitcher 使用
          setStagesInfo(buildStageSummaries(stages, stageIdx))
          // 自动选中第一个资源
          if (existingResources.length > 0) {
            const detail = await getZhiXueResourceDetail(existingResources[0].id)
            setSelectedResource(detail)
            setSelectedResourceId(existingResources[0].id)
          }
          return
        }
      } catch {
        // 获取失败, 启动 SSE 兜底
      }

      // 无已有资源: 启动 SSE
      sseStartedRef.current = true
      setLoading(false)
      sse.startStream(id)
    })()
  }, [id])

  // ── Questionnaire ──
  const handleCancelQuestionnaire = useCallback(async () => {
    setShowQuestionnaire(false)
    if (id) {
      try { await cancelZhiXueSession(id) } catch { /* ignore */ }
    }
    navigate('/zhixue')
  }, [id, navigate])

  const handleQuestionnaireSubmit = async (answers: ZhiXueQuestionAnswer[]) => {
    setShowQuestionnaire(false)
    // 启动进度面板 (SSE 先行, 后端 process_questionnaire 完成后 SSE 流会自动进入 planning → generation)
    sseStartedRef.current = false; generationDoneRef.current = false; setResources([]); setSelectedResource(null)
    try {
      await submitZhiXueQuestionnaire(id!, { answers: answers.map(a => ({ question_id: a.question_id, selected_options: a.selected_options, open_text: a.open_text })), skipped: false })
    } catch (err) { message.error('提交失败: ' + (err as Error).message); setShowQuestionnaire(true); return }
    sseStartedRef.current = true
    sse.startStream(id!)
  }
  const handleQuestionnaireSkip = async () => {
    setShowQuestionnaire(false)
    sseStartedRef.current = false; generationDoneRef.current = false; setResources([]); setSelectedResource(null)
    try {
      await submitZhiXueQuestionnaire(id!, { answers: [], skipped: true, skip_reason: 'user_skipped' })
    } catch (err) { message.error('跳过失败: ' + (err as Error).message); setShowQuestionnaire(true); return }
    sseStartedRef.current = true
    sse.startStream(id!)
  }

  // ── Complete study → feedback ──
  const handleCompleteStudy = () => setShowFeedback(true)

  // ── Exercise progress: save + record learning activity ──
  const handleExerciseProgressSave = useCallback(async (
    resourceId: string,
    progress: {
      answers: Record<string, number | number[] | string>
      submitted: Record<string, boolean>
      current_index: number
      scores?: Record<string, { score: number; feedback: string }>
    }
  ) => {
    // 保存进度
    await saveZhiXueExerciseProgress(resourceId, progress)
    // 记录学习行为 (触发艾宾浩斯复习计划)
    const exerciseTitle = selectedResource?.title || `练习题 ${resourceId.slice(0, 8)}`
    recordLearning({
      content_type: 'exercise',
      content_title: exerciseTitle,
      course_id: sessionCourseIdRef.current || undefined,
    }).catch(() => {})
  }, [selectedResource])

  // ── Feedback ──
  const handleFeedback = useCallback(async (mastery: string, remedialSelected?: string[]) => {
    setShowFeedback(false)
    try {
      const result = await submitZhiXueFeedback(id!, { mastery, remedial_selected: remedialSelected }) as Record<string, unknown>
      if (result.status === 'completed') {
        setAllDone(true); setLoading(false)
        if (result.evaluation) setEvaluation(result.evaluation as typeof evaluation)
        return
      }
      // "基本没掌握" 不再自动触发补救, 前端引导用户使用独立按钮
      if (result.next_action === 'use_independent_remedial') {
        setLoading(false)
        return
      }
      // mastered / partially_mastered: 推进到下一阶段 via SSE
      setLoading(true)
      generationDoneRef.current = false; sseStartedRef.current = true
      setResources([]); setSelectedResource(null); setSelectedResourceId(null)
      sse.startStream(id!)
    } catch (err) { message.error('提交失败: ' + (err as Error).message); setLoading(false) }
  }, [id, sse])

  const handleFeedbackSelect = useCallback((mastery: string) => {
    if (mastery === 'not_mastered') {
      // 不再弹出 RemedialModal, 引导用户使用独立"生成补救资源"按钮
      message.info('建议点击"生成补救资源"按钮, 描述你的困惑, 获取针对性辅导 ✨')
      handleFeedback(mastery, [])
    } else {
      handleFeedback(mastery)
    }
  }, [handleFeedback])

  // ── Independent remedial ──
  const handleIndependentRemedial = useCallback(async (confusionText: string, resourceTypes: string[]) => {
    setShowIndependentRemedial(false)
    setLoading(true)
    try {
      await submitZhiXueRemedial(id!, { confusion_text: confusionText, resource_types: resourceTypes })
      generationDoneRef.current = false
      sseStartedRef.current = true
      setResources([])
      setSelectedResource(null)
      setSelectedResourceId(null)
      sse.startStream(id!)
    } catch (err) {
      message.error('补救资源请求失败: ' + (err as Error).message)
      setLoading(false)
    }
  }, [id, sse])

  // ── Stage navigation ──
  const effectiveStageIndex = viewStageIndex !== null ? viewStageIndex : stageIndexRef.current
  const isViewingPastStage = viewStageIndex !== null && viewStageIndex !== stageIndexRef.current

  const handleStageNavigate = useCallback(async (targetIndex: number) => {
    if (targetIndex === stageIndexRef.current) {
      // 回到当前阶段
      setViewStageIndex(null)
      setCurrentStageTitle(stagesInfo[targetIndex]?.title || currentStageTitle)
      loadStageResources(stageIndexRef.current)
      return
    }
    // 跳转到历史阶段
    setViewStageIndex(targetIndex)
    const targetStage = stagesInfo[targetIndex]
    if (targetStage) setCurrentStageTitle(targetStage.title)
    loadStageResources(targetIndex)
  }, [stageIndexRef, stagesInfo, currentStageTitle, id])

  /** 返回当前阶段 */
  const handleReturnToCurrent = useCallback(() => {
    setViewStageIndex(null)
    setCurrentStageTitle(stagesInfo[stageIndexRef.current]?.title || currentStageTitle)
    loadStageResources(stageIndexRef.current)
  }, [stageIndexRef, stagesInfo, currentStageTitle, id])

  // ====================================================================

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}><Spin size="large" /></div>

  if (allDone) return (
    <AllDonePage evaluation={evaluation} onBack={() => navigate('/zhixue')} />
  )

  // ── Has resources: show ResourceTree + ResourceViewer ──
  const hasResources = resources.length > 0

  return (
    <Layout style={{ height: '100vh', background: '#fff' }}>
      {/* Header */}
      <div style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', borderBottom: `1px solid ${gray[200]}`, flexShrink: 0, background: '#fff' }}>
        <Space>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/zhixue')} />
          {hasResources && (
            <Button type="text" icon={siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setSiderCollapsed(v => !v)} />
          )}
          <span style={{ fontWeight: 600, fontSize: 14, color: blue[500] }}>AI智学</span>
          {currentStageTitle && stagesInfo.length > 0 && (
            <StageSwitcher
              stages={stagesInfo}
              totalStages={totalStagesRef.current}
              currentStageIndex={stageIndexRef.current}
              currentStageTitle={currentStageTitle}
              onNavigate={handleStageNavigate}
            />
          )}
          {currentStageTitle && stagesInfo.length === 0 && (
            <span style={{ fontSize: 13, color: gray[500] }}>· {currentStageTitle} · 阶段 {stageIndexRef.current + 1}/{totalStagesRef.current}</span>
          )}
        </Space>
        {hasResources && !isViewingPastStage && (
          <Space>
            <Button
              icon={<span style={{ fontSize: 14 }}>💡</span>}
              onClick={() => setShowIndependentRemedial(true)}
              style={{ borderRadius: 8, fontWeight: 500, borderColor: blue[500], color: blue[500] }}
            >
              生成补救资源
            </Button>
            <Button type="primary" icon={<ArrowRightOutlined />} onClick={handleCompleteStudy}
              style={{ background: blue[500], border: 'none', borderRadius: 8, fontWeight: 600 }}>
              我已完成本阶段学习
            </Button>
          </Space>
        )}
        {hasResources && isViewingPastStage && (
          <Button
            type="primary"
            icon={<ArrowRightOutlined />}
            onClick={handleReturnToCurrent}
            style={{ background: blue[500], border: 'none', borderRadius: 8, fontWeight: 600 }}
          >
            返回当前阶段
          </Button>
        )}
      </div>

      {/* Past-stage banner */}
      {isViewingPastStage && (
        <div style={{
          height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#FFF7E6', borderBottom: `1px solid #FFE7BA`, flexShrink: 0,
          fontSize: 12, color: '#AD6800', gap: 8,
        }}>
          <span>📖</span>
          正在回看历史阶段 — 此处为已生成的学习资料, 操作按钮已隐藏
          <Button
            type="link"
            size="small"
            onClick={handleReturnToCurrent}
            style={{ fontSize: 12, padding: 0, color: blue[500] }}
          >
            返回当前阶段
          </Button>
        </div>
      )}

      <Layout style={{ flex: 1, minHeight: 0 }}>
        {/* Left: ResourceTree */}
        {hasResources && !siderCollapsed && (
          <Sider width={240} style={{ background: '#FAFBFC', borderRight: `1px solid ${gray[200]}`, overflow: 'auto' }}>
            <div style={{ padding: '8px 0' }}>
              <ResourceTree resources={resources} selectedResourceId={selectedResourceId} onSelect={selectResource} />
            </div>
          </Sider>
        )}
        {hasResources && siderCollapsed && (
          <div style={{ width: 40, borderRight: `1px solid ${gray[200]}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Button type="text" icon={<MenuUnfoldOutlined />} onClick={() => setSiderCollapsed(false)} />
          </div>
        )}

        {/* Right: ResourceViewer */}
        <Content style={{ overflow: 'auto', background: '#fff' }}>
          {hasResources ? (
            <ResourceViewer resource={selectedResource} loading={resourceLoading}
              onSaveExerciseProgress={handleExerciseProgressSave}
              onScoreExerciseAnswer={scoreZhiXueExerciseAnswer} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
              <Spin size="large" />
              <Paragraph type="secondary">AI 智能体正在为你准备学习方案...</Paragraph>
            </div>
          )}
        </Content>
      </Layout>

      {/* Overlays */}
      <ZhiXueProgress visible={sse.showProgress} cards={sse.agentCards}
        progressMessage={sse.progressMessage} currentStageTitle={sse.currentStageTitle}
        readyResourceCount={sse.readyResourceCount} generationDone={sse.generationDone}
        onStartLearning={sse.dismissProgress}
        onCancel={() => { sse.cancelStream(); navigate('/zhixue') }} />
      <QuestionnaireModal visible={showQuestionnaire} questionnaire={questionnaire}
        onSubmit={handleQuestionnaireSubmit} onSkip={handleQuestionnaireSkip} onCancel={handleCancelQuestionnaire} />
      <FeedbackModal visible={showFeedback} stageTitle={currentStageTitle} onSubmit={handleFeedbackSelect} onDismiss={() => setShowFeedback(false)} />
      <IndependentRemedialModal
        visible={showIndependentRemedial}
        stageTitle={currentStageTitle}
        stageIndex={stageIndexRef.current}
        onConfirm={handleIndependentRemedial}
        onCancel={() => setShowIndependentRemedial(false)}
      />
    </Layout>
  )
}

// ============================================================================
// 学习完成页 — 评价卡片 + 礼炮
// ============================================================================

interface AllDonePageProps {
  evaluation: {
    score?: number
    title?: string
    summary?: string
    strengths?: string[]
    suggestions?: string[]
  } | null
  onBack: () => void
}

function AllDonePage({ evaluation, onBack }: AllDonePageProps) {
  const confettiFired = useRef(false)

  useEffect(() => {
    if (confettiFired.current) return
    confettiFired.current = true

    // 左下角 → 右上方, 右下角 → 左上方
    const duration = 1000
    const end = Date.now() + duration

    const fire = () => {
      // 左下角向右上发射
      confetti({
        particleCount: 40,
        spread: 50,
        angle: 55,
        origin: { x: 0, y: 1 },
        colors: ['#3B82F6', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6'],
      })
      // 右下角向左上发射
      confetti({
        particleCount: 40,
        spread: 50,
        angle: 125,
        origin: { x: 1, y: 1 },
        colors: ['#3B82F6', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6'],
      })

      if (Date.now() < end) requestAnimationFrame(fire)
    }
    fire()
  }, [])

  const score = evaluation?.score
  const scoreColor = score != null
    ? score >= 90 ? '#10B981' : score >= 75 ? '#3B82F6' : score >= 60 ? '#F59E0B' : '#EF4444'
    : blue[500]

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      minHeight: '60vh', padding: 48,
    }}>
      {/* 分数大圆 */}
      <div style={{
        width: 160, height: 160, borderRadius: '50%',
        background: `conic-gradient(${scoreColor} ${score || 0}%, #f0f0f0 ${score || 0}%)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 28,
      }}>
        <div style={{
          width: 130, height: 130, borderRadius: '50%',
          background: '#FFFFFF',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
        }}>
          {score != null ? (
            <>
              <TrophyOutlined style={{ fontSize: 24, color: scoreColor, marginBottom: 4 }} />
              <span style={{ fontSize: 40, fontWeight: 700, color: scoreColor, lineHeight: 1 }}>
                {score}
              </span>
              <span style={{ fontSize: 12, color: gray[500] }}>分</span>
            </>
          ) : (
            <CheckCircleOutlined style={{ fontSize: 48, color: blue[500] }} />
          )}
        </div>
      </div>

      {/* 评价标题 */}
      <Title level={2} style={{ marginBottom: 8 }}>
        {evaluation?.title || '恭喜完成学习！'}
      </Title>

      {/* 评价摘要 */}
      <Paragraph
        type="secondary"
        style={{ maxWidth: 500, textAlign: 'center', fontSize: 14, lineHeight: 1.8, marginBottom: 24 }}
      >
        {evaluation?.summary || '你已经完成了本课程所有阶段的学习，这是一个了不起的成就。'}
      </Paragraph>

      {/* 亮点 + 建议 */}
      {(evaluation?.strengths?.length ?? 0) > 0 || (evaluation?.suggestions?.length ?? 0) > 0 ? (
        <div style={{ display: 'flex', gap: 24, maxWidth: 580, width: '100%', marginBottom: 28 }}>
          {evaluation?.strengths?.length ? (
            <div style={{ flex: 1, padding: '16px 20px', background: '#F0FDF4', borderRadius: 12, border: '1px solid #BBF7D0' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#166534', marginBottom: 8 }}>
                做得好的方面
              </div>
              {evaluation.strengths.map((s, i) => (
                <div key={i} style={{ fontSize: 13, color: '#166534', lineHeight: 1.7 }}>
                  {'✔'} {s}
                </div>
              ))}
            </div>
          ) : null}
          {evaluation?.suggestions?.length ? (
            <div style={{ flex: 1, padding: '16px 20px', background: '#FFF7ED', borderRadius: 12, border: '1px solid #FED7AA' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#9A3412', marginBottom: 8 }}>
                可以加强的方面
              </div>
              {evaluation.suggestions.map((s, i) => (
                <div key={i} style={{ fontSize: 13, color: '#9A3412', lineHeight: 1.7 }}>
                  {'→'} {s}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 返回按钮 */}
      <Button
        type="primary"
        size="large"
        onClick={onBack}
        icon={<ArrowRightOutlined />}
        style={{ background: blue[500], border: 'none', borderRadius: 10, padding: '6px 32px', height: 42 }}
      >
        返回 AI智学
      </Button>
    </div>
  )
}
