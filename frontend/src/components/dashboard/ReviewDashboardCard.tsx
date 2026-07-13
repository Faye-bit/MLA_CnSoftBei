/**
 * 艾宾浩斯遗忘曲线复习卡片 (仪表盘用)
 * 点击知识点复习项 → 弹出 AI 解释知识卡片
 */
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Tag, Button, Typography, Skeleton, Empty, Space, Tooltip, Modal, Spin, message } from 'antd'
import { BellOutlined, ClockCircleOutlined, CheckCircleOutlined, BulbOutlined } from '@ant-design/icons'
import { getPendingReviews, markReviewComplete, getKPExplanation } from '../../services/api'
import type { ReviewItem } from '../../services/api'
import { gray, blue, semantic } from '../../styles/tokens'

const { Text } = Typography

function typeTag(type: string) {
  const map: Record<string, { color: string; label: string }> = {
    course_view: { color: 'blue', label: '课程' },
    chapter_view: { color: 'cyan', label: '章节' },
    kp_view: { color: 'green', label: '知识点' },
    chat: { color: 'purple', label: 'AI对话' },
    exercise: { color: 'orange', label: '练习' },
    resource: { color: 'magenta', label: '资源' },
  }
  return map[type] || { color: 'default', label: '学习' }
}

export default function ReviewDashboardCard() {
  const location = useLocation()
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<ReviewItem[]>([])
  const [upcoming, setUpcoming] = useState<ReviewItem[]>([])

  // 知识卡片弹窗状态
  const [cardItem, setCardItem] = useState<ReviewItem | null>(null)
  const [cardLoading, setCardLoading] = useState(false)
  const [cardContent, setCardContent] = useState<string | null>(null)
  const [cardError, setCardError] = useState('')

  async function load() {
    setLoading(true)
    try {
      const data = await getPendingReviews()
      setPending(data.pending)
      setUpcoming(data.upcoming)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [location.pathname])

  /** 点击知识点复习项 → 获取 AI 解释 */
  async function handleItemClick(item: ReviewItem) {
    if (item.content_type !== 'kp_view' || !item.knowledge_point_id) return
    setCardItem(item)
    setCardLoading(true)
    setCardContent(null)
    setCardError('')
    try {
      const data = await getKPExplanation(item.knowledge_point_id)
      if (data.ai_explanation) {
        setCardContent(data.ai_explanation)
      } else {
        setCardError('该知识点暂无 AI 解释。点击课程管理中知识点的"快问AI"按钮即可自动生成。')
      }
    } catch {
      setCardError('加载 AI 解释失败')
    } finally {
      setCardLoading(false)
    }
  }

  // ===== 加载态 =====
  if (loading) {
    return <div style={{ padding: '12px 20px 16px' }}><Skeleton active paragraph={{ rows: 4 }} title={false} /></div>
  }

  // ===== 空态 =====
  if (pending.length === 0 && upcoming.length === 0) {
    return (
      <div style={{ padding: '40px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Empty description="暂无复习提醒" image={Empty.PRESENTED_IMAGE_SIMPLE}>
          <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
            点击知识点中的"快问AI", 系统将自动生成复习计划和知识卡片
          </Text>
        </Empty>
      </div>
    )
  }

  // ===== 渲染项 =====
  function renderItem(item: ReviewItem, isPending: boolean) {
    const info = typeTag(item.content_type)
    const isKp = item.content_type === 'kp_view' && item.knowledge_point_id
    return (
      <div
        key={item.id}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 10px', marginBottom: 6, borderRadius: 8,
          background: isPending ? semantic.warningBg : semantic.successBg,
          border: isPending ? '1px solid #FCD34D' : '1px solid #BBF7D0',
          cursor: isKp ? 'pointer' : 'default',
          transition: 'box-shadow 0.15s',
        }}
        onClick={() => handleItemClick(item)}
        onMouseEnter={e => { if (isKp) e.currentTarget.style.boxShadow = '0 2px 6px rgba(217,119,6,0.15)' }}
        onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Tag color={info.color} style={{ margin: 0, flexShrink: 0 }}>{info.label}</Tag>
          <div style={{ minWidth: 0 }}>
            <Text style={{ fontSize: 13, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.content_title}
              {isKp && <BulbOutlined style={{ marginLeft: 6, color: blue[500], fontSize: 11 }} />}
            </Text>
            {isPending && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                <ClockCircleOutlined style={{ marginRight: 4 }} />第{item.interval_index + 1}次复习 ({item.interval_days}天前)
              </Text>
            )}
          </div>
        </div>
        <div style={{ flexShrink: 0, marginLeft: 8 }}>
          {isPending ? (
            <Tooltip title="标记已完成">
              <Button type="link" size="small" icon={<CheckCircleOutlined />}
                onClick={async (e) => {
                  e.stopPropagation()
                  try {
                    await markReviewComplete(item.id)
                    setPending(prev => prev.filter(r => r.id !== item.id))
                    message.success('已标记完成')
                  } catch { message.error('操作失败') }
                }}
              />
            </Tooltip>
          ) : (
            <Text type="secondary" style={{ fontSize: 10 }}>{item.interval_days}天后</Text>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '12px 20px 16px' }}>
      {/* 统计摘要 */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, padding: '8px 12px', background: gray[50], borderRadius: 8, fontSize: 13, color: gray[600] }}>
        <Space size={4}>
          <BellOutlined style={{ color: semantic.warning }} />
          <span>到期复习 <b style={{ color: semantic.warning }}>{pending.length}</b> 项</span>
        </Space>
        {upcoming.length > 0 && (
          <Space size={4}>
            <ClockCircleOutlined style={{ color: blue[500] }} />
            <span>即将到期 <b style={{ color: blue[500] }}>{upcoming.length}</b> 项</span>
          </Space>
        )}
      </div>

      {/* 到期列表 */}
      {pending.length > 0 && <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>到期复习 ({pending.length} 项)</Text>}
      {pending.map(item => renderItem(item, true))}

      {/* 即将到期列表 */}
      {upcoming.length > 0 && <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8, marginBottom: 6 }}>即将到期 ({upcoming.length} 项)</Text>}
      {upcoming.map(item => renderItem(item, false))}

      {/* 知识卡片弹窗 */}
      <Modal
        title={<Space><BulbOutlined style={{ color: blue[500] }} /><span>知识卡片</span><Tag color="blue">{cardItem?.content_title}</Tag></Space>}
        open={!!cardItem}
        onCancel={() => { setCardItem(null); setCardContent(null); setCardError('') }}
        footer={null}
        width={520}
      >
        {cardLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin tip="加载 AI 解释..." /></div>
        ) : cardError ? (
          <div style={{ textAlign: 'center', padding: 16, color: '#8c8c8c' }}>
            <Text type="secondary">{cardError}</Text>
          </div>
        ) : cardContent ? (
          <div style={{ padding: '16px 20px', background: blue[50], borderRadius: 8, border: `1px solid ${blue[100]}`, lineHeight: 1.8, fontSize: 14, whiteSpace: 'pre-wrap' }}>
            {cardContent}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
