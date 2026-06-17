/**
 * AI 助学入口页 — 卡片网格布局
 * 第一张卡片始终为 "+" 新建卡片，后续卡片为已有学习会话
 * 每行 3-4 张卡片，卡片底部有收藏/下载/删除三个操作按钮
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Card, Select, Button, Typography, Progress, Tag, Spin,
  Empty, message, Popconfirm, Modal, Divider,
} from 'antd'
import {
  PlusOutlined, BookOutlined, StarOutlined, StarFilled,
  DeleteOutlined, DownloadOutlined, ExperimentOutlined,
  RocketOutlined,
} from '@ant-design/icons'
import {
  getCourses, createOrResumeSession, getLearningSessions,
  toggleFavorite, deleteLearningSession, getDownloadUrl,
} from '../services/api'
import { useAuthStore } from '../store'
import type { Course, LearningSessionListItem } from '../types'

const { Title, Text, Paragraph } = Typography

/** 卡片固定宽度 */
const CARD_WIDTH = 280

export default function LearningHub() {
  const navigate = useNavigate()
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<LearningSessionListItem[]>([])
  const [loadingCourses, setLoadingCourses] = useState(true)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [starting, setStarting] = useState(false)
  /** 新建课程 Modal 是否打开 */
  const [newModalOpen, setNewModalOpen] = useState(false)

  /** 加载课程列表 */
  async function loadCourses() {
    try {
      const data = await getCourses()
      setCourses(data.items || [])
      if (data.items && data.items.length > 0) {
        setSelectedCourseId(data.items[0].id)
      }
    } catch (err) {
      message.error('加载课程列表失败: ' + (err as Error).message)
    } finally {
      setLoadingCourses(false)
    }
  }

  /** 加载已有学习会话 */
  async function loadSessions() {
    try {
      const data = await getLearningSessions({ page_size: 50 })
      setSessions(data?.items || [])
    } catch {
      // 静默失败
    } finally {
      setLoadingSessions(false)
    }
  }

  useEffect(() => {
    loadCourses()
    loadSessions()
  }, [])

  /** 开始学习 (创建或恢复会话, 然后跳转) */
  async function handleStartLearning() {
    if (!selectedCourseId) {
      message.warning('请先选择课程')
      return
    }
    setStarting(true)
    try {
      const session = await createOrResumeSession(selectedCourseId)
      const stages = session.learning_path?.stages
      const isNew = !stages || stages.length === 0

      setNewModalOpen(false)
      if (isNew) {
        navigate(`/learning/${session.id}?new=true`)
      } else {
        navigate(`/learning/${session.id}`)
      }
    } catch (err) {
      message.error('启动学习失败: ' + (err as Error).message)
    } finally {
      setStarting(false)
    }
  }

  /** 点击已有会话卡片进入学习 */
  function handleResumeSession(sessionId: string) {
    navigate(`/learning/${sessionId}`)
  }

  /** 切换收藏 */
  async function handleToggleFavorite(sessionId: string, e: React.MouseEvent) {
    e.stopPropagation()
    try {
      const result = await toggleFavorite(sessionId)
      message.success(result.is_favorited ? '已收藏' : '已取消收藏')
      loadSessions()
    } catch (err) {
      message.error('操作失败: ' + (err as Error).message)
    }
  }

  /** 下载会话全部资源 */
  async function handleDownload(sessionId: string, e: React.MouseEvent) {
    e.stopPropagation()
    const url = getDownloadUrl(sessionId)
    const token = useAuthStore.getState().token
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) { message.error('下载失败'); return }
      const blob = await response.blob()
      const downloadUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
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

  /** 删除会话 */
  async function handleDelete(sessionId: string, e: React.MouseEvent | undefined) {
    e?.stopPropagation()
    try {
      await deleteLearningSession(sessionId)
      message.success('已删除')
      loadSessions()
    } catch (err) {
      message.error('删除失败: ' + (err as Error).message)
    }
  }

  /** 获取状态标签 */
  function getStatusTag(status: string) {
    switch (status) {
      case 'active': return <Tag color="blue" style={{ margin: 0 }}>进行中</Tag>
      case 'completed': return <Tag color="green" style={{ margin: 0 }}>已完成</Tag>
      case 'paused': return <Tag color="orange" style={{ margin: 0 }}>已暂停</Tag>
      default: return <Tag style={{ margin: 0 }}>{status}</Tag>
    }
  }

  const loading = loadingCourses || loadingSessions

  return (
    <div style={{ padding: '32px', height: '100%', overflow: 'auto' }}>
      {/* 页面标题 */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ExperimentOutlined style={{ fontSize: 28, color: '#1677ff' }} />
          <Title level={4} style={{ margin: 0 }}>AI 智能助学</Title>
        </div>
        <Text type="secondary" style={{ marginTop: 4, display: 'block' }}>
          多智能体协同生成个性化学习路径，覆盖讲义、思维导图、练习题等6种学习资源
        </Text>
      </div>

      {/* 卡片网格 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <Spin size="large" />
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_WIDTH}px, 1fr))`,
            gap: 20,
          }}
        >
          {/* ================================================================ */}
          {/* 第一张: "+ 开始新课程" 卡片 */}
          {/* ================================================================ */}
          <Card
            hoverable
            onClick={() => setNewModalOpen(true)}
            style={{
              width: CARD_WIDTH, height: 240, borderRadius: 12,
              border: '2px dashed #d9d9d9', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s',
            }}
            styles={{
              body: {
                width: '100%', height: '100%',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 8,
              },
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLElement
              el.style.borderColor = '#1677ff'
              el.style.boxShadow = '0 4px 16px rgba(22,119,255,0.12)'
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLElement
              el.style.borderColor = '#d9d9d9'
              el.style.boxShadow = 'none'
            }}
          >
            <PlusOutlined style={{ fontSize: 40, color: '#1677ff' }} />
            <Text strong style={{ fontSize: 15, color: '#1677ff' }}>
              开始新课程
            </Text>
          </Card>

          {/* ================================================================ */}
          {/* 已有学习会话卡片 */}
          {/* ================================================================ */}
          {sessions.map((session) => (
            <Card
              key={session.id}
              hoverable
              onClick={() => handleResumeSession(session.id)}
              style={{
                width: CARD_WIDTH, borderRadius: 12,
                overflow: 'hidden',
                border: '1px solid #f0f0f0',
                transition: 'all 0.2s',
              }}
              styles={{ body: { padding: '16px 20px' } }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement
                el.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)'
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement
                el.style.boxShadow = '0 1px 2px rgba(0,0,0,0.06)'
              }}
            >
              {/* 顶部: 图标 + 课程名 + 状态 */}
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                marginBottom: 12,
              }}>
                {session.is_favorited ? (
                  <StarFilled style={{ fontSize: 18, color: '#faad14', marginTop: 2, flexShrink: 0 }} />
                ) : (
                  <BookOutlined style={{ fontSize: 18, color: '#1677ff', marginTop: 2, flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    strong
                    style={{ fontSize: 14, display: 'block' }}
                    ellipsis={{ tooltip: session.course_name || '未知课程' }}
                  >
                    {session.course_name || '未知课程'}
                  </Text>
                  <div style={{ marginTop: 4 }}>
                    {getStatusTag(session.status)}
                  </div>
                </div>
              </div>

              {/* 中部: 进度条 + 阶段统计 */}
              <div style={{ marginBottom: 16 }}>
                <Progress
                  percent={session.progress_percent}
                  size="small"
                  strokeColor={session.status === 'completed' ? '#52c41a' : '#1677ff'}
                  style={{ marginBottom: 4 }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {session.completed_stages}/{session.total_stages} 阶段
                  </Text>
                  {session.status === 'completed' && (
                    <Text type="secondary" style={{ fontSize: 11, color: '#52c41a' }}>
                      全部完成
                    </Text>
                  )}
                </div>
              </div>

              {/* 底部操作栏 */}
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  display: 'flex', justifyContent: 'space-around',
                  paddingTop: 10, borderTop: '1px solid #f5f5f5',
                }}
              >
                <Button
                  type="text"
                  size="small"
                  icon={session.is_favorited
                    ? <StarFilled style={{ color: '#faad14' }} />
                    : <StarOutlined />
                  }
                  onClick={(e) => handleToggleFavorite(session.id, e)}
                  style={{ color: session.is_favorited ? '#faad14' : undefined }}
                >
                  {session.is_favorited ? '已收藏' : '收藏'}
                </Button>

                <Divider type="vertical" style={{ margin: 0 }} />

                <Button
                  type="text"
                  size="small"
                  icon={<DownloadOutlined />}
                  onClick={(e) => handleDownload(session.id, e)}
                >
                  下载
                </Button>

                <Divider type="vertical" style={{ margin: 0 }} />

                <Popconfirm
                  title="确定删除？"
                  description="所有阶段和资源将无法恢复"
                  onConfirm={(e) => handleDelete(session.id, e as React.MouseEvent)}
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                >
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                  >
                    删除
                  </Button>
                </Popconfirm>
              </div>
            </Card>
          ))}

          {/* 空状态: 仅当没有任何会话时显示 */}
          {sessions.length === 0 && !loadingSessions && (
            <div style={{
              gridColumn: '1 / -1',
              padding: 40, textAlign: 'center',
            }}>
              <Empty
                description="暂无进行中的学习，点击左侧「+」卡片开始新课程"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* 新建课程 Modal */}
      {/* ================================================================ */}
      <Modal
        title={
          <span>
            <RocketOutlined style={{ marginRight: 8, color: '#1677ff' }} />
            开始新课程
          </span>
        }
        open={newModalOpen}
        onCancel={() => setNewModalOpen(false)}
        footer={null}
        width={440}
        centered
      >
        <div style={{ padding: '8px 0' }}>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            选择要学习的课程
          </Text>
          <Select
            showSearch
            value={selectedCourseId}
            onChange={setSelectedCourseId}
            placeholder="请选择一门课程"
            style={{ width: '100%', marginBottom: 20 }}
            optionFilterProp="label"
            size="large"
            options={courses.map(c => ({
              value: c.id,
              label: c.name,
            }))}
            notFoundContent={loadingCourses ? <Spin size="small" /> : <Empty description="暂无课程" />}
          />

          <Button
            type="primary"
            size="large"
            block
            icon={<RocketOutlined />}
            loading={starting}
            onClick={handleStartLearning}
            disabled={!selectedCourseId}
            style={{ height: 44, borderRadius: 8 }}
          >
            {starting ? '正在初始化...' : '开始学习'}
          </Button>

          <Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12, marginBottom: 0 }}>
            MLA将调用多智能体编排系统，为你规划个性化学习路线并生成学习资源。生成过程约需1-3分钟。
          </Paragraph>
        </div>
      </Modal>
    </div>
  )
}
