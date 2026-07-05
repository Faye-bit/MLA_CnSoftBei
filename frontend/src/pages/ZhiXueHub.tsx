/**
 * AI智学 入口页 — 卡片网格布局
 * 第一张卡片为 "+" 新建会话, 后续卡片为已有智学会话
 * 风格与 AI助学 (LearningHub) 保持一致
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Card, Select, Button, Typography, Tag, Spin,
  message, Modal, Checkbox, Space, Popconfirm,
} from 'antd'
import {
  PlusOutlined, BookOutlined, DeleteOutlined,
  ExperimentOutlined, RocketOutlined,
  StarOutlined, StarFilled, DownloadOutlined,
} from '@ant-design/icons'
import { getCourses, createZhiXueSession, getZhiXueSessions, deleteZhiXueSession, toggleZhiXueFavorite, getZhiXueDownloadUrl } from '../services/api'
import type { Course } from '../types'
import type { ZhiXueSessionItem } from '../services/api'
import { blue, gray } from '../styles/tokens'
import { getScoutingEnabled } from './Settings'

const { Title, Text, Paragraph } = Typography

const CARD_WIDTH = 280

const RESOURCE_TYPES = [
  { type: 'handout', label: '讲义', desc: '核心学习材料', required: true },
  { type: 'mindmap', label: '思维导图', desc: '知识结构可视化', required: true },
  { type: 'exercise', label: '练习题', desc: '巩固知识要点', required: true },
  { type: 'reading', label: '拓展阅读', desc: '深化理解', required: false },
  { type: 'animation', label: '交互动画', desc: '直观演示', required: false },
  { type: 'code', label: '编程实操', desc: '动手实践', required: false },
]

export default function ZhiXueHub() {
  const navigate = useNavigate()

  // ── 数据 ──
  const [courses, setCourses] = useState<Course[]>([])
  const [sessions, setSessions] = useState<ZhiXueSessionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)

  // ── 新建模态框 ──
  const [newModalOpen, setNewModalOpen] = useState(false)
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>(
    RESOURCE_TYPES.filter(r => r.required).map(r => r.type),
  )

  // ── 加载 ──
  function loadSessions() {
    getZhiXueSessions({ limit: 50 })
      .then(data => setSessions(data?.items || []))
      .catch(() => {})
  }

  useEffect(() => {
    Promise.all([
      getCourses()
        .then(data => {
          setCourses(data.items || [])
          if (data.items?.length) setSelectedCourseId(data.items[0].id)
        })
        .catch(() => {}),
      loadSessions(),
    ]).finally(() => setLoading(false))
  }, [])

  // ── 创建新会话 ──
  async function handleStartLearning() {
    if (!selectedCourseId) { message.warning('请选择课程'); return }
    if (selectedMaterials.length === 0) { message.warning('请至少选择一种资源'); return }

    setStarting(true)
    setNewModalOpen(false)  // 立即关闭模态框

    try {
      const result = await createZhiXueSession({
        course_id: selectedCourseId,
        selected_materials: selectedMaterials,
        scouting_enabled: getScoutingEnabled(),
      })
      if (result.error) {
        message.error((result.error as Record<string, string>)?.message || '创建失败')
        return
      }
      navigate(`/zhixue/${result.session_id}`)
    } catch (err) {
      message.error('创建失败: ' + (err as Error).message)
    } finally { setStarting(false) }
  }

  // ── 继续已有会话 ──
  function handleResumeSession(sessionId: string) {
    navigate(`/zhixue/${sessionId}`)
  }

  // ── 删除会话 ──
  async function handleDeleteConfirm(sessionId: string) {
    try {
      await deleteZhiXueSession(sessionId)
      message.success('已删除')
      loadSessions()
    } catch {
      message.error('删除失败')
    }
  }

  // ── 收藏/取消收藏 ──
  async function handleToggleFavorite(sessionId: string, e: React.MouseEvent) {
    e.stopPropagation()  // 阻止冒泡, 避免触发卡片点击进入会话
    try {
      const res = await toggleZhiXueFavorite(sessionId)
      // 更新本地状态, 避免重新拉取全部列表
      setSessions(prev => prev.map(s =>
        s.id === sessionId ? { ...s, is_favorited: res.is_favorited } : s
      ))
    } catch {
      message.error('操作失败')
    }
  }

  // ── 状态标签 ──
  function getStatusTag(status: string) {
    const map: Record<string, { color: string; text: string }> = {
      idle: { color: 'default', text: '待开始' },
      questionnaire: { color: 'orange', text: '等待问卷' },
      planning: { color: 'processing', text: '规划中' },
      generating: { color: 'processing', text: '生成中' },
      delivering: { color: 'blue', text: '学习中' },
      completed: { color: 'green', text: '已完成' },
      failed: { color: 'red', text: '失败' },
    }
    const info = map[status] || { color: 'default', text: status }
    return <Tag color={info.color} style={{ margin: 0 }}>{info.text}</Tag>
  }

  // ── 课程名缓存 ──
  function getCourseName(courseId: string) {
    return courses.find(c => c.id === courseId)?.name || courseId.slice(0, 8) + '...'
  }

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
  }

  return (
    <div style={{ padding: '32px', height: '100%', overflow: 'auto', margin: -24 }}>
      {/* 页面标题 */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ExperimentOutlined style={{ fontSize: 28, color: blue[500] }} />
          <Title level={4} style={{ margin: 0 }}>
            AI 智学中心
          </Title>
        </div>
        <Text type="secondary" style={{ marginTop: 4, display: 'block' }}>
          名师团队协同工作, 为你量身定制学习方案
        </Text>
      </div>

      {/* ── Agent 工作流展示 ── */}
      <AgentWorkflow />

      {/* 卡片网格 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
        {/* + 新建卡片 */}
        <Card
          hoverable
          style={{
            width: CARD_WIDTH, minHeight: 200,
            border: `2px dashed ${gray[300]}`,
            borderRadius: 14, textAlign: 'center',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          bodyStyle={{
            width: '100%', display: 'flex',
            flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', minHeight: 200,
            padding: '32px 20px',
          }}
          onClick={() => setNewModalOpen(true)}
        >
          <PlusOutlined style={{ fontSize: 36, color: gray[400], marginBottom: 12 }} />
          <Text type="secondary" style={{ fontSize: 14 }}>开始新的学习</Text>
        </Card>

        {/* 已有会话卡片 */}
        {sessions.map(s => (
          <Card
            key={s.id}
            style={{
              width: CARD_WIDTH, minHeight: 200,
              borderRadius: 14,
              cursor: 'default',
              border: `1px solid ${gray[200]}`,
            }}
            bodyStyle={{ padding: 0 }}
          >
            {/* 点击区域: 导航到会话 */}
            <div
              onClick={() => handleResumeSession(s.id)}
              style={{ padding: '20px 24px 12px', cursor: 'pointer', flex: 1 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <BookOutlined style={{ fontSize: 20, color: blue[500] }} />
                <Text strong style={{ fontSize: 14, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.course_name || getCourseName(s.course_id)}
                </Text>
              </div>
              <div style={{ marginBottom: 10 }}>
                {getStatusTag(s.status)}
              </div>
              <div style={{ fontSize: 12, color: gray[500] }}>
                阶段: {s.current_stage_index + 1}{s.total_stages ? ` / ${s.total_stages}` : ''}
              </div>
            </div>

            {/* 底部操作区 (不触发导航) */}
            <div style={{ padding: '0 16px 12px', display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
              {/* 下载按钮 (已生成资源的会话即可下载) */}
              {['delivering', 'completed'].includes(s.status) && (
                <Button
                  type="text"
                  size="small"
                  icon={<DownloadOutlined />}
                  onClick={(e) => {
                    e.stopPropagation()
                    window.open(getZhiXueDownloadUrl(s.id), '_blank')
                  }}
                  title="下载全部资源 (zip)"
                />
              )}
              {/* 收藏按钮 */}
              <Button
                type="text"
                size="small"
                icon={s.is_favorited
                  ? <StarFilled style={{ color: '#F59E0B' }} />
                  : <StarOutlined />
                }
                onClick={(e) => handleToggleFavorite(s.id, e)}
                title={s.is_favorited ? '取消收藏' : '收藏'}
              />
              {/* 删除按钮 */}
              <Popconfirm
                title="确认删除?"
                description="将删除此会话及所有关联的学习资源"
                onConfirm={() => handleDeleteConfirm(s.id)}
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </div>
          </Card>
        ))}
      </div>

      {/* 空状态 */}
      {sessions.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: 60, color: gray[400] }}>
          <Paragraph type="secondary">还没有学习会话, 点击上方卡片开始</Paragraph>
        </div>
      )}

      {/* ── 新建会话模态框 ── */}
      <Modal
        title={<Space><RocketOutlined style={{ color: blue[500] }} /> 开始 AI 智学</Space>}
        open={newModalOpen}
        onCancel={() => setNewModalOpen(false)}
        width={560}
        centered
        footer={
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => setNewModalOpen(false)}>取消</Button>
            <Button
              type="primary"
              icon={<RocketOutlined />}
              loading={starting}
              disabled={!selectedCourseId || selectedMaterials.length === 0}
              onClick={handleStartLearning}
              style={{ background: blue[500], border: 'none', borderRadius: 8 }}
            >
              开始 AI 智学
            </Button>
          </Space>
        }
      >
        <div style={{ padding: '8px 0' }}>
          {/* 课程选择 */}
          <div style={{ marginBottom: 24 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>📚 选择课程</Text>
            <Select
              style={{ width: '100%' }}
              placeholder="请选择要学习的课程"
              value={selectedCourseId}
              onChange={setSelectedCourseId}
              size="large"
              options={courses.map(c => ({
                value: c.id,
                label: `${c.name}${c.knowledge_point_count ? ` (${c.knowledge_point_count} 知识点)` : ''}`,
              }))}
            />
          </div>

          {/* 资源选择 */}
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>🎯 选择资源类型</Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {RESOURCE_TYPES.map(item => {
                const checked = selectedMaterials.includes(item.type)
                return (
                  <div
                    key={item.type}
                    onClick={() => {
                      if (item.required) return
                      setSelectedMaterials(prev =>
                        prev.includes(item.type)
                          ? prev.filter(t => t !== item.type)
                          : [...prev, item.type],
                      )
                    }}
                    style={{
                      border: `2px solid ${checked ? blue[500] : gray[200]}`,
                      borderRadius: 10,
                      padding: '10px 16px',
                      cursor: item.required ? 'default' : 'pointer',
                      background: checked ? '#f0f7ff' : '#fff',
                      opacity: item.required ? 0.85 : 1,
                      transition: 'all 0.2s',
                      userSelect: 'none',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {item.label}
                      {item.required && (
                        <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>必选</Text>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                      {item.desc}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ============================================================================
// Agent 陈列 — 12 位 Agent (第一行: 6位非匠, 第二行: 6匠)
// ============================================================================

/** 第一行非匠 Agent */
const ROW_A: { key: string; name: string; role: string }[] = [
  { key: 'XiangNan', name: '向南', role: '学习引导师' },
  { key: 'YuZhi', name: '俞知', role: '学情诊断师' },
  { key: 'LiGang', name: '李纲', role: '教纲设计师' },
  { key: 'CaiFeng', name: '蔡丰', role: '网络调研师' },
  { key: 'JianZheng', name: '简真', role: '质量审核师' },
  { key: 'HuoRan', name: '霍然', role: '解惑辅导师' },
]

/** 第二行六匠 */
const ROW_B: { key: string; name: string; role: string }[] = [
  { key: 'ZhangYi', name: '张义', role: '讲义编写专家' },
  { key: 'TuSi', name: '屠思', role: '导图设计专家' },
  { key: 'XiZheng', name: '习真', role: '习题设计专家' },
  { key: 'YueDu', name: '岳读', role: '阅读推荐专家' },
  { key: 'DongHua', name: '董华', role: '动画制作专家' },
  { key: 'DaiMa', name: '戴码', role: '代码实操专家' },
]

function AgentWorkflow() {
  return (
    <div style={{
      marginBottom: 28,
      padding: '20px 24px',
      background: '#FAFBFC',
      borderRadius: 14,
      border: `1px solid ${gray[200]}`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 14,
    }}>
      {/* 第一行: 非匠 Agent */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 28 }}>
        {ROW_A.map(a => (
          <div key={a.key} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 72,
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              border: `2px solid ${blue[200]}`, background: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
            }}>
              <img
                src={`/Agents/${a.key}.svg`}
                alt={a.name}
                style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover' }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            </div>
            <Text style={{ fontSize: 12, fontWeight: 600, color: gray[700], lineHeight: 1.2 }}>{a.name}</Text>
            <Text style={{ fontSize: 10, color: gray[500], lineHeight: 1 }}>{a.role}</Text>
          </div>
        ))}
      </div>

      {/* 分割线 */}
      <div style={{ width: '80%', height: 1, background: gray[200] }} />

      {/* 第二行: 六匠 */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 28 }}>
        {ROW_B.map(a => (
          <div key={a.key} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 72,
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              border: `2px solid #C4B5FD`, background: '#F5F3FF',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
            }}>
              <img
                src={`/Agents/${a.key}.svg`}
                alt={a.name}
                style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover' }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            </div>
            <Text style={{ fontSize: 12, fontWeight: 600, color: gray[700], lineHeight: 1.2 }}>{a.name}</Text>
            <Text style={{ fontSize: 10, color: gray[500], lineHeight: 1 }}>{a.role}</Text>
          </div>
        ))}
      </div>
    </div>
  )
}
