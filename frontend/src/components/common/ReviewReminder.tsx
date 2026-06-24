/**
 * 艾宾浩斯复习提醒弹窗
 * 用户登录后自动检测待复习项, 超过 1 条时弹窗提醒
 */
import { useEffect, useState } from 'react'
import { Modal, List, Tag, Button, Space, Typography, message, Badge } from 'antd'
import { BellOutlined, CheckCircleOutlined, ClockCircleOutlined, BookOutlined } from '@ant-design/icons'
import { getPendingReviews, markReviewComplete, markAllReviewsComplete } from '../../services/api'
import type { ReviewItem } from '../../services/api'

const { Text, Title } = Typography

/** 内容类型 → 图标/标签颜色 */
function contentTypeInfo(type: string) {
  switch (type) {
    case 'course_view': return { icon: <BookOutlined />, color: 'blue', label: '课程' }
    case 'chapter_view': return { icon: <BookOutlined />, color: 'cyan', label: '章节' }
    case 'kp_view': return { icon: <BookOutlined />, color: 'green', label: '知识点' }
    case 'chat': return { icon: <BookOutlined />, color: 'purple', label: 'AI对话' }
    case 'exercise': return { icon: <BookOutlined />, color: 'orange', label: '练习' }
    default: return { icon: <BookOutlined />, color: 'default', label: '学习' }
  }
}

export default function ReviewReminder() {
  const [visible, setVisible] = useState(false)
  const [pending, setPending] = useState<ReviewItem[]>([])
  const [upcoming, setUpcoming] = useState<ReviewItem[]>([])
  const [checked, setChecked] = useState(false)

  /** 页面加载 2 秒后检测待复习项 */
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const data = await getPendingReviews()
        if (data.total_pending > 0) {
          setPending(data.pending)
          setUpcoming(data.upcoming)
          setVisible(true)
        }
      } catch { /* 静默 */ }
      setChecked(true)
    }, 2000)
    return () => clearTimeout(timer)
  }, [])

  /** 标记单条完成 */
  async function handleComplete(id: string) {
    try {
      await markReviewComplete(id)
      setPending((prev) => prev.filter((r) => r.id !== id))
    } catch {
      message.error('操作失败')
    }
  }

  /** 一键完成所有 */
  async function handleCompleteAll() {
    try {
      await markAllReviewsComplete()
      setPending([])
      message.success('全部标记完成')
      setVisible(false)
    } catch {
      message.error('操作失败')
    }
  }

  if (!checked || pending.length === 0) return null

  return (
    <Modal
      title={
        <Space>
          <BellOutlined style={{ color: '#faad14', fontSize: 18 }} />
          <span>艾宾浩斯复习提醒</span>
          <Badge count={pending.length} />
        </Space>
      }
      open={visible}
      onCancel={() => setVisible(false)}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button onClick={() => setVisible(false)}>稍后提醒</Button>
          <Space>
            <Button type="primary" icon={<CheckCircleOutlined />} onClick={handleCompleteAll}>
              一键完成 ({pending.length})
            </Button>
          </Space>
        </div>
      }
      width={520}
    >
      <div style={{ marginBottom: 12 }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          根据艾宾浩斯遗忘曲线, 以下内容到了最佳复习时间:
        </Text>
      </div>

      <List
        dataSource={pending}
        renderItem={(item) => {
          const info = contentTypeInfo(item.content_type)
          return (
            <List.Item
              actions={[
                <Button
                  key="done"
                  type="link"
                  size="small"
                  icon={<CheckCircleOutlined />}
                  onClick={() => handleComplete(item.id)}
                >
                  已完成
                </Button>,
              ]}
              style={{ padding: '8px 0' }}
            >
              <List.Item.Meta
                avatar={<Tag color={info.color}>{info.label}</Tag>}
                title={<Text style={{ fontSize: 13 }}>{item.content_title}</Text>}
                description={
                  <Space size={4}>
                    <ClockCircleOutlined style={{ fontSize: 11, color: '#faad14' }} />
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      应于 {item.interval_days} 天前复习 (第 {item.interval_index + 1} 次)
                    </Text>
                  </Space>
                }
              />
            </List.Item>
          )
        }}
        style={{ maxHeight: 300, overflow: 'auto' }}
      />

      {upcoming.length > 0 && (
        <div style={{ marginTop: 8, padding: '8px 12px', background: '#f6ffed', borderRadius: 6 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            即将到期: {upcoming.slice(0, 3).map((r) => r.content_title).join('、')}
          </Text>
        </div>
      )}
    </Modal>
  )
}
