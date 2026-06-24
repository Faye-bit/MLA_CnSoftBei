/**
 * 艾宾浩斯遗忘曲线复习卡片 (仪表盘用)
 * 固定高度与本周学习活动对齐, 内部独立滚动
 */
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Tag, Button, Typography, Skeleton, Empty, Space, Tooltip, message } from 'antd'
import { BellOutlined, ClockCircleOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { getPendingReviews, markReviewComplete } from '../../services/api'
import type { ReviewItem } from '../../services/api'
import { gray, blue } from '../../styles/tokens'

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

  async function load() {
    setLoading(true)
    try {
      const data = await getPendingReviews()
      setPending(data.pending)
      setUpcoming(data.upcoming)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  // 每次路由变化(切换页面回来)时重新加载
  useEffect(() => { load() }, [location.pathname])

  // ===== 加载态 =====
  if (loading) {
    return (
      <div style={{ padding: '12px 20px 16px' }}>
        <Skeleton active paragraph={{ rows: 4 }} title={false} />
      </div>
    )
  }

  // ===== 空态 =====
  if (pending.length === 0 && upcoming.length === 0) {
    return (
      <div style={{ padding: '40px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Empty description="暂无复习提醒" image={Empty.PRESENTED_IMAGE_SIMPLE}>
          <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
            浏览课程或开始AI对话后, 系统将自动生成艾宾浩斯复习计划
          </Text>
        </Empty>
      </div>
    )
  }

  // ===== 数据态 =====
  return (
    <div style={{
      padding: '12px 20px 16px',
    }}>
      {/* 统计摘要 */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 12, padding: '8px 12px',
        background: gray[50], borderRadius: 8, fontSize: 13, color: gray[600],
      }}>
        <Space size={4}>
          <BellOutlined style={{ color: '#faad14' }} />
          <span>到期复习 <b style={{ color: '#faad14' }}>{pending.length}</b> 项</span>
        </Space>
        {upcoming.length > 0 && (
          <Space size={4}>
            <ClockCircleOutlined style={{ color: blue[500] }} />
            <span>即将到期 <b style={{ color: blue[500] }}>{upcoming.length}</b> 项</span>
          </Space>
        )}
      </div>

      {/* 到期列表 */}
      {pending.length > 0 && (
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
          🔔 到期复习 ({pending.length} 项)
        </Text>
      )}
      {pending.map((item) => {
        const info = typeTag(item.content_type)
        return (
          <div
            key={item.id}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 10px', marginBottom: 6, borderRadius: 8,
              background: '#fff7e6', border: '1px solid #ffd591',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <Tag color={info.color} style={{ margin: 0, flexShrink: 0 }}>{info.label}</Tag>
              <div style={{ minWidth: 0 }}>
                <Text style={{ fontSize: 13, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.content_title}
                </Text>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  <ClockCircleOutlined style={{ marginRight: 4 }} />第{item.interval_index + 1}次复习 ({item.interval_days}天前)
                </Text>
              </div>
            </div>
            <Tooltip title="标记已完成">
              <Button type="link" size="small" icon={<CheckCircleOutlined />}
                onClick={async () => {
                  try {
                    await markReviewComplete(item.id)
                    setPending(prev => prev.filter(r => r.id !== item.id))
                    message.success('已标记完成')
                  } catch { message.error('操作失败') }
                }}
              />
            </Tooltip>
          </div>
        )
      })}

      {/* 即将到期列表 */}
      {upcoming.length > 0 && (
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8, marginBottom: 6 }}>
          📅 即将到期 ({upcoming.length} 项)
        </Text>
      )}
      {upcoming.map((item) => {
        const info = typeTag(item.content_type)
        return (
          <div
            key={item.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '5px 10px', marginBottom: 4, borderRadius: 6,
              background: '#f6ffed', border: '1px solid #d9f7be',
            }}
          >
            <Tag color={info.color} style={{ margin: 0, flexShrink: 0 }}>{info.label}</Tag>
            <div style={{ minWidth: 0, flex: 1 }}>
              <Text style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                {item.content_title}
              </Text>
            </div>
            <Text type="secondary" style={{ fontSize: 10, flexShrink: 0 }}>
              {item.interval_days}天后
            </Text>
          </div>
        )
      })}
    </div>
  )
}
