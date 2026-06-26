/**
 * AI 助学入口页 — 卡片网格布局
 * 第一张卡片始终为 "+" 新建卡片，后续卡片为已有学习会话
 * 每行 3-4 张卡片，卡片底部有收藏/下载/删除三个操作按钮
 *
 * 设计规范 (MLA Brand v2.0):
 * - 使用品牌 token 替代硬编码色值
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Card, Select, Button, Typography, Progress, Tag, Spin,
  Empty, message, Popconfirm, Modal, Divider, Checkbox, Row, Col,
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
import { blue, gray, semantic } from '../styles/tokens'

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
  const [newModalOpen, setNewModalOpen] = useState(false)

  /**
   * 资源类型选择状态
   * 默认选中: 讲义(handout)、思维导图(mindmap)、练习题(exercise)
   * 可选: 拓展阅读(reading)、编程实操(coding_practice)、交互动画(video_script)
   */
  const RESOURCE_TYPE_CONFIG = [
    { type: 'handout',         label: '讲义',        desc: '核心学习材料', required: true },
    { type: 'mindmap',         label: '思维导图',    desc: '知识结构可视化', required: true },
    { type: 'exercise',        label: '练习题',      desc: '巩固知识要点', required: true },
    { type: 'reading',         label: '拓展阅读',    desc: '深化理解', required: false },
    { type: 'coding_practice', label: '编程实操',    desc: '动手实践', required: false },
    { type: 'video_script',    label: '交互动画',    desc: '直观演示', required: false },
  ]
  const [selectedResourceTypes, setSelectedResourceTypes] = useState<string[]>(
    RESOURCE_TYPE_CONFIG.filter(r => r.required).map(r => r.type)
  )

  function toggleResourceType(type: string, checked: boolean) {
    setSelectedResourceTypes(prev =>
      checked ? [...prev, type] : prev.filter(t => t !== type)
    )
  }

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

  async function handleStartLearning() {
    if (!selectedCourseId) {
      message.warning('请先选择课程')
      return
    }
    setStarting(true)
    try {
      const session = await createOrResumeSession(selectedCourseId, selectedResourceTypes)
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

  function handleResumeSession(sessionId: string) {
    navigate(`/learning/${sessionId}`)
  }

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
          <ExperimentOutlined style={{ fontSize: 28, color: blue[500] }} />
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
              border: `2px dashed ${gray[300]}`, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: `
                border-color 0.25s cubic-bezier(0.16, 1, 0.3, 1),
                box-shadow 0.25s cubic-bezier(0.16, 1, 0.3, 1),
                transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)
              `,
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
              el.style.borderColor = blue[500]
              el.style.boxShadow = `0 6px 20px rgba(59,130,246,0.15)`
              el.style.transform = 'translateY(-3px)'
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLElement
              el.style.borderColor = gray[300]
              el.style.boxShadow = 'none'
              el.style.transform = 'translateY(0)'
            }}
          >
            <div style={{
              width: 56, height: 56, borderRadius: 14,
              background: blue[50],
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'transform 0.25s ease',
            }}>
              <PlusOutlined style={{ fontSize: 26, color: blue[500] }} />
            </div>
            <Text strong style={{ fontSize: 15, color: blue[500] }}>
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
                border: `1px solid ${gray[200]}`,
                transition: `
                  box-shadow 0.25s cubic-bezier(0.16, 1, 0.3, 1),
                  transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)
                `,
              }}
              styles={{ body: { padding: '16px 20px' } }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement
                el.style.boxShadow = '0 6px 20px rgba(15,23,42,0.1)'
                el.style.transform = 'translateY(-2px)'
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement
                el.style.boxShadow = '0 1px 2px rgba(15,23,42,0.04)'
                el.style.transform = 'translateY(0)'
              }}
            >
              {/* 顶部: 图标 + 课程名 + 状态 */}
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                marginBottom: 12,
              }}>
                {session.is_favorited ? (
                  <StarFilled style={{ fontSize: 18, color: semantic.warning, marginTop: 2, flexShrink: 0 }} />
                ) : (
                  <BookOutlined style={{ fontSize: 18, color: blue[500], marginTop: 2, flexShrink: 0 }} />
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
                  strokeColor={session.status === 'completed' ? semantic.success : blue[500]}
                  style={{ marginBottom: 4 }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {session.completed_stages}/{session.total_stages} 阶段
                  </Text>
                  {session.status === 'completed' && (
                    <Text style={{ fontSize: 11, color: semantic.success }}>
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
                  paddingTop: 10, borderTop: `1px solid ${gray[100]}`,
                }}
              >
                <Button
                  type="text"
                  size="small"
                  icon={session.is_favorited
                    ? <StarFilled style={{ color: semantic.warning }} />
                    : <StarOutlined />
                  }
                  onClick={(e) => handleToggleFavorite(session.id, e)}
                  style={{ color: session.is_favorited ? semantic.warning : undefined }}
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

          {/* 空状态 */}
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

      {/* 新建课程 Modal */}
      <Modal
        title={
          <span>
            <RocketOutlined style={{ marginRight: 8, color: blue[500] }} />
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

          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8, marginTop: 16 }}>
            学习资源选择（可多选）
          </Text>
          <Row gutter={[8, 6]} style={{ marginBottom: 20 }}>
            {RESOURCE_TYPE_CONFIG.map(rt => (
              <Col span={12} key={rt.type}>
                <Checkbox
                  checked={selectedResourceTypes.includes(rt.type)}
                  disabled={rt.required}
                  onChange={e => toggleResourceType(rt.type, e.target.checked)}
                  style={{ fontSize: 13 }}
                >
                  <span style={{ fontWeight: rt.required ? 600 : 400 }}>
                    {rt.label}
                  </span>
                  {!rt.required && (
                    <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
                      {rt.desc}
                    </Text>
                  )}
                </Checkbox>
              </Col>
            ))}
          </Row>

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
            MLA将调用多智能体编排系统，为你规划个性化学习路线。
            当前选择 {selectedResourceTypes.length} 种资源类型，预计生成约需 {selectedResourceTypes.length <= 3 ? '30秒-1分钟' : selectedResourceTypes.length <= 4 ? '1-2分钟' : '2-4分钟'}。
          </Paragraph>
        </div>
      </Modal>
    </div>
  )
}
