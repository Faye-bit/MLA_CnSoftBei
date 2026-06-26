/**
 * 学习会话页面 — Phase 3 核心页面
 * 布局: 顶部路线图抽屉(含阶段完成操作) + 左侧资源目录树 + 右侧资源查看器
 *
 * 两种模式:
 * 1. 新会话 (URL 带 ?new=true): 先显示 SSE 生成进度, 完成后加载资源
 * 2. 已有会话: 直接加载已生成的资源
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { Layout, Spin, Typography, message, Button, Space, Popconfirm, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import {
  ArrowLeftOutlined, ReloadOutlined, StarOutlined, StarFilled,
  DeleteOutlined, DownloadOutlined, MoreOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined,
} from '@ant-design/icons'
import {
  getLearningSessionDetail, getResourceDetail,
  toggleFavorite, deleteLearningSession, getDownloadUrl,
} from '../services/api'
import { useAuthStore } from '../store'
import { useLearningSSE } from '../hooks/useLearningSSE'
import { gray } from '../styles/tokens'
import LearningPathDrawer from '../components/learning/LearningPathDrawer'
import ResourceTree from '../components/learning/ResourceTree'
import ResourceViewer from '../components/learning/ResourceViewer'

import GenerationProgress from '../components/learning/GenerationProgress'
import type {
  LearningSessionDetail, GeneratedResource, GeneratedResourceDetail,
  LearningPathStage,
} from '../types'

const { Content, Sider } = Layout
const { Text, Title } = Typography

/** Agent 流水线顺序 */
const PIPELINE_ORDER = [
  'coordinator', 'profile', 'retrieval',
  'teaching_design', 'resource_generation',
  'fact_check', 'summary',
]

export default function LearningSessionPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const isNew = searchParams.get('new') === 'true'

  // 数据状态
  const [session, setSession] = useState<LearningSessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 资源选择状态
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null)
  const [selectedResource, setSelectedResource] = useState<GeneratedResourceDetail | null>(null)
  const [resourceLoading, setResourceLoading] = useState(false)

  // SSE 生成进度状态 — 使用 useLearningSSE hook
  const {
    agents,
    progressMessage,
    overallProgress,
    allResourcesReady,
    generatingNext,
    showProgress,
    readyResourceCount,
    startGeneration,
    completeStage: hookCompleteStage,
    cancelGeneration: hookCancelGeneration,
    dismissProgress,
  } = useLearningSSE(id || '', PIPELINE_ORDER, {
    onPathUpdate: (data) => {
      setSession(prev => prev ? {
        ...prev,
        learning_path: data.learning_path,
      } : null)
    },
    onSessionComplete: () => {
      generationDoneRef.current = true
      loadSession()
    },
    onError: (msg) => {
      message.error(msg)
    },
  })

  // 资源目录折叠状态
  const [siderCollapsed, setSiderCollapsed] = useState(false)
  // 用户选择的阶段索引 (可自由切换到已完成阶段复习, 独立于 session.current_stage_index)
  const [viewStageIndex, setViewStageIndex] = useState<number | null>(null)

  /** 标记: 已完成首次 SSE 生成, 防止 useEffect 重复触发 */
  const generationDoneRef = useRef(false)
  /** 标记: SSE 是否已启动 (防止 session 状态变化导致重复 connect) */
  const sseStartedRef = useRef(false)

  // ============================================================
  // 加载会话详情
  // ============================================================

  async function loadSession() {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const data = await getLearningSessionDetail(id)
      setSession(data)

      // 自动选择第一个可用资源
      const firstStage = data.stages?.find(s =>
        s.order_index === data.current_stage_index
      ) || data.stages?.[0]
      const firstResource = firstStage?.resources?.[0]
      if (firstResource) {
        setSelectedResourceId(firstResource.id)
        try {
          await loadResource(firstResource.id)
        } catch {
          // 首个资源加载失败不阻塞页面渲染, 静默降级
          setSelectedResourceId(null)
        }
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // ============================================================
  // 加载资源详情
  // ============================================================

  async function loadResource(resourceId: string) {
    setResourceLoading(true)
    try {
      const res = await getResourceDetail(resourceId)
      setSelectedResource(res)
    } finally {
      setResourceLoading(false)
    }
  }

  function handleResourceSelect(resource: GeneratedResource) {
    setSelectedResourceId(resource.id)
    loadResource(resource.id).catch(err => {
      message.error('加载资源失败: ' + (err as Error).message)
    })
  }

  /**
   * 讲义中动画链接点击回调
   * 当用户在讲义中点击 mla-resource://{id} 链接时触发,
   * 自动切换到对应的动画资源并加载
   */
  function handleNavigateToResource(resourceId: string) {
    setSelectedResourceId(resourceId)
    loadResource(resourceId).catch(err => {
      message.error('跳转到动画资源失败: ' + (err as Error).message)
    })
  }

  // ============================================================
  // SSE 生成进度处理 — 委托给 useLearningSSE hook
  // ============================================================

  /** 完成阶段 → 生成下一阶段 (组件层守卫, 委托 hook 执行 SSE) */
  const handleCompleteStage = useCallback(() => {
    if (!id || !session) return
    setViewStageIndex(null)
    const stages = session.learning_path?.stages || []
    const currentIndex = session.current_stage_index
    if (currentIndex >= stages.length) {
      message.success('全部阶段已完成!')
      return
    }
    generationDoneRef.current = false
    hookCompleteStage(currentIndex)
  }, [id, session, hookCompleteStage])

  /** 取消 SSE 连接 */
  const handleCancelGeneration = useCallback(() => {
    hookCancelGeneration()
    generationDoneRef.current = true
    loadSession()
  }, [hookCancelGeneration, loadSession])

  /** 用户点击"开始学习" — 关闭进度弹窗, 加载会话数据 */
  async function handleStartLearning() {
    generationDoneRef.current = true
    dismissProgress()
    await loadSession()
  }

  // ============================================================
  // 收藏 / 删除 / 下载
  // ============================================================

  async function handleToggleFavorite() {
    if (!id) return
    try {
      const result = await toggleFavorite(id)
      message.success(result.is_favorited ? '已收藏' : '已取消收藏')
      loadSession()
    } catch (err) {
      message.error('操作失败: ' + (err as Error).message)
    }
  }

  async function handleDelete() {
    if (!id) return
    try {
      await deleteLearningSession(id)
      message.success('已删除')
      navigate('/learning')
    } catch (err) {
      message.error('删除失败: ' + (err as Error).message)
    }
  }

  /** 下载当前阶段或全部阶段 */
  async function handleDownload(stageIndex?: number) {
    if (!id) return
    const url = getDownloadUrl(id, stageIndex)
    // 从 Zustand store 获取 token (与 axios interceptor 相同方式)
    const token = useAuthStore.getState().token
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        message.error('下载失败')
        return
      }
      const blob = await response.blob()
      const downloadUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      // 从 Content-Disposition 头或 URL 推断文件名
      const disposition = response.headers.get('Content-Disposition') || ''
      const filenameMatch = disposition.match(/filename\*?=(?:UTF-8'')?(.+)/)
      a.download = filenameMatch ? decodeURIComponent(filenameMatch[1]) : '学习资源.md'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(downloadUrl)
      message.success('下载已开始')
    } catch (err) {
      message.error('下载失败: ' + (err as Error).message)
    }
  }

  // ============================================================
  // 生命周期
  // ============================================================

  useEffect(() => {
    // 切换会话时重置所有 SSE 相关引用
    sseStartedRef.current = false
    generationDoneRef.current = false
    loadSession()
  }, [id])  // 当 session id 变化时重新加载 (如从 Hub 跳转到不同的会话)

  // SSE 启动 effect: 仅在新会话 + session 首次加载完成时触发一次
  // 不依赖 session 对象引用 (否则 SSE 内部 setSession 会形成重新连接循环)
  useEffect(() => {
    if (!isNew || !session || !id) return
    if (sseStartedRef.current || generationDoneRef.current) return

    const hasResources = session.stages?.some(
      s => s.resources && s.resources.length > 0
    )
    if (hasResources) {
      // 已有资源 (可能是断点恢复), 关闭进度弹窗
      dismissProgress()
      generationDoneRef.current = true
      return
    }

    // 标记已启动, 防止此 effect 或 session 更新导致重复连接
    sseStartedRef.current = true
    startGeneration()
  }, [isNew, id, session, dismissProgress, startGeneration])

  // SSE 清理由 hook 内部处理 (useEffect cleanup in useLearningSSE)

  // ============================================================
  // 渲染
  // ============================================================

  if (loading && !session) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" />
        <div style={{ marginTop: 16 }}>
          <Text type="secondary">加载学习会话...</Text>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Title level={4} type="danger">加载失败</Title>
        <Text type="secondary">{error}</Text>
        <div style={{ marginTop: 16 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/learning')}>
            返回 AI 助学
          </Button>
          <Button icon={<ReloadOutlined />} onClick={loadSession} style={{ marginLeft: 8 }}>
            重试
          </Button>
        </div>
      </div>
    )
  }

  if (!session) return null

  const stages: LearningPathStage[] = session.learning_path?.stages || []
  const dbCurrentIndex = session.current_stage_index
  const currentIndex = viewStageIndex !== null ? viewStageIndex : dbCurrentIndex
  const currentStage = session.stages?.find(s => s.order_index === currentIndex)
    || session.stages?.[0]
  const resources = currentStage?.resources || []

  return (
    <Layout style={{ height: 'calc(100vh - 56px)', margin: '-24px', background: '#FFFFFF' }}>
      {/* SSE 生成进度弹窗 */}
      <GenerationProgress
        open={showProgress}
        agents={agents}
        currentMessage={progressMessage}
        overallProgress={overallProgress}
        allReady={allResourcesReady}
        readyResourceCount={readyResourceCount}
        onCancel={handleCancelGeneration}
        onStartLearning={handleStartLearning}
      />

      {/* 顶部: 学习路线图抽屉 (含阶段完成操作) */}
      <LearningPathDrawer
        stages={stages.map((s, i) => ({
          ...s,
          status: i < dbCurrentIndex ? 'completed'
            : i === dbCurrentIndex ? 'active'
            : 'pending',
        }))}
        currentStageIndex={currentIndex}
        totalStages={stages.length || session.stages?.length || 1}
        isLastStage={currentIndex >= (stages.length || session.stages?.length || 1) - 1}
        generating={generatingNext}
        onComplete={handleCompleteStage}
        onNavigateStage={(stageIndex) => {
          // 切换到阶段查看 (不调后端, session.stages 已有全部数据)
          if (stageIndex === dbCurrentIndex) {
            setViewStageIndex(null)
          } else {
            setViewStageIndex(stageIndex)
          }
          // 消除前一个阶段的选中状态, 强制用户重新选择资源
          setSelectedResourceId(null)
          setSelectedResource(null)
        }}
      />

      {/* 主体: 左侧资源树 + 右侧资源查看器 */}
      <Layout style={{ background: '#FFFFFF', flex: 1, overflow: 'hidden' }}>
        {/* 左侧边栏: 资源目录 (可折叠) */}
        <Sider
          width={260}
          collapsedWidth={0}
          collapsible
          collapsed={siderCollapsed}
          onCollapse={setSiderCollapsed}
          trigger={null}
          style={{
            background: gray[50],
            borderRight: siderCollapsed ? 'none' : `1px solid ${gray[200]}`,
            overflow: 'auto',
          }}
        >
          {/* 返回按钮 + 折叠切换 */}
          <div style={{
            padding: '8px 16px', display: 'flex',
            justifyContent: 'space-between', alignItems: 'center',
            borderBottom: `1px solid ${gray[200]}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button
                type="text"
                icon={<ArrowLeftOutlined />}
                onClick={() => navigate('/learning')}
                style={{ padding: 0 }}
              >
                返回
              </Button>
              <Text strong style={{ fontSize: 13 }}>
                {session.course_name || '学习会话'}
              </Text>
            </div>
            <Button
              type="text"
              size="small"
              icon={siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setSiderCollapsed(!siderCollapsed)}
              title={siderCollapsed ? '展开资源目录' : '折叠资源目录'}
            />
          </div>

          <ResourceTree
            resources={resources}
            selectedResourceId={selectedResourceId}
            onSelect={handleResourceSelect}
          />
        </Sider>

        {/* 右侧: 资源查看器 */}
        <Content style={{
          overflow: 'hidden', background: '#FFFFFF', position: 'relative',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* 侧栏折叠时显示展开按钮 */}
          {siderCollapsed && (
            <div style={{
              position: 'absolute', top: 12, left: 12, zIndex: 10,
            }}>
              <Button
                size="small"
                icon={<MenuUnfoldOutlined />}
                onClick={() => setSiderCollapsed(false)}
                title="展开资源目录"
                style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
              >
                资源目录
              </Button>
            </div>
          )}
          <ResourceViewer
            resource={selectedResource}
            loading={resourceLoading}
            onNavigateToResource={handleNavigateToResource}
          />
        </Content>
      </Layout>
    </Layout>
  )
}
