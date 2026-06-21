/**
 * 统计概览卡片行
 * 展示课程总数、文档总数、知识切片、今日消息四个核心指标
 *
 * 设计规范 (MLA Brand v2.0) + Phase 4 视觉提升:
 * - 卡片 hover 时上浮 + 阴影 + 边框变色, 带平滑过渡
 * - 图标容器带微妙的发光内阴影
 * - 数字使用 tabular-nums 对齐
 *
 * @see branding/MLA_BRAND_GUIDELINES.md
 */

import { useEffect, useState, useRef } from 'react'
import { Row, Col, Skeleton } from 'antd'
import {
  BookOutlined,
  FileTextOutlined,
  DatabaseOutlined,
  MessageOutlined,
} from '@ant-design/icons'
import { getDashboardStats, getTodayStats } from '../../services/api'
import { gray, shadow, radius, typography, statCardColors } from '../../styles/tokens'

interface StatItem {
  icon: React.ReactNode
  value: number
  label: string
  color: string
  bgColor: string
}

// ── 样式常量 ──────────────────────────────────────────────

const CARD_STYLE: React.CSSProperties = {
  padding: '20px 24px',
  borderRadius: radius.lg,
  border: `1px solid ${gray[200]}`,
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  transition: `
    box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    border-color 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)
  `,
  cursor: 'default',
  background: '#FFFFFF',
  willChange: 'transform',
}

const iconWrapperStyle = (bgColor: string, color: string): React.CSSProperties => ({
  width: 48,
  height: 48,
  borderRadius: radius.md,
  backgroundColor: bgColor,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 22,
  color,
  flexShrink: 0,
  boxShadow: `inset 0 1px 2px rgba(255,255,255,0.6)`,
})

const VALUE_STYLE: React.CSSProperties = {
  fontSize: typography.statNumber.fontSize,
  fontWeight: typography.statNumber.fontWeight,
  lineHeight: typography.statNumber.lineHeight,
  letterSpacing: typography.statNumber.letterSpacing,
  color: gray[900],
  fontVariantNumeric: 'tabular-nums',
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: typography.bodyS.fontSize,
  lineHeight: typography.bodyS.lineHeight,
  color: gray[500],
  marginTop: 2,
}

// ── 数字滚动动画 hook ─────────────────────────────────────

/** 用 requestAnimationFrame 将数字从 0 渐进递增到目标值, 提供入场动画 */
function useAnimatedValue(target: number, duration: number = 600) {
  const [displayValue, setDisplayValue] = useState(0)
  const frameRef = useRef<number>(0)

  useEffect(() => {
    if (target === 0) { setDisplayValue(0); return }
    const start = performance.now()
    const from = 0
    const to = target

    const animate = (now: number) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      // easeOutExpo 缓动
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress)
      setDisplayValue(Math.round(from + (to - from) * eased))
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate)
      }
    }
    frameRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frameRef.current)
  }, [target, duration])

  return displayValue
}

// ── 组件 ──────────────────────────────────────────────────

export default function StatsOverview() {
  const [stats, setStats] = useState<{ course_count: number; document_count: number; chunk_count: number } | null>(null)
  const [todayMessages, setTodayMessages] = useState<number>(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      getDashboardStats(),
      getTodayStats().catch(() => ({ today_messages: 0, today_completed_stages: 0, items: [] })),
    ]).then(([sysStats, todayStats]) => {
      setStats(sysStats)
      setTodayMessages(todayStats.today_messages)
    }).finally(() => setLoading(false))
  }, [])

  // 入场动画后的最终值
  const animatedCourses = useAnimatedValue(stats?.course_count ?? 0)
  const animatedDocs = useAnimatedValue(stats?.document_count ?? 0)
  const animatedChunks = useAnimatedValue(stats?.chunk_count ?? 0)
  const animatedMsgs = useAnimatedValue(todayMessages)

  if (loading) {
    return (
      <Row gutter={[16, 16]}>
        {[0, 1, 2, 3].map((i) => (
          <Col xs={12} sm={12} md={6} key={i}>
            <div style={CARD_STYLE}>
              <Skeleton.Avatar active size={48} shape="square" />
              <div style={{ flex: 1 }}>
                <Skeleton.Input active size="small" style={{ width: 60, height: 28 }} block={false} />
                <Skeleton.Input active size="small" style={{ width: 80, height: 16, marginTop: 4 }} block={false} />
              </div>
            </div>
          </Col>
        ))}
      </Row>
    )
  }

  const items: StatItem[] = [
    { icon: <BookOutlined />,  value: animatedCourses, label: '课程总数', color: statCardColors[0].icon, bgColor: statCardColors[0].bg },
    { icon: <FileTextOutlined />, value: animatedDocs,    label: '文档总数', color: statCardColors[1].icon, bgColor: statCardColors[1].bg },
    { icon: <DatabaseOutlined />, value: animatedChunks,  label: '知识切片', color: statCardColors[2].icon, bgColor: statCardColors[2].bg },
    { icon: <MessageOutlined />,  value: animatedMsgs,    label: '今日消息', color: statCardColors[3].icon, bgColor: statCardColors[3].bg },
  ]

  return (
    <Row gutter={[16, 16]}>
      {items.map((item) => (
        <Col xs={12} sm={12} md={6} key={item.label}>
          <div
            style={CARD_STYLE}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = shadow.md
              e.currentTarget.style.borderColor = item.color
              e.currentTarget.style.transform = 'translateY(-2px)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = 'none'
              e.currentTarget.style.borderColor = gray[200]
              e.currentTarget.style.transform = 'translateY(0)'
            }}
          >
            <div style={iconWrapperStyle(item.bgColor, item.color)}>
              {item.icon}
            </div>
            <div>
              <div style={VALUE_STYLE}>{item.value.toLocaleString()}</div>
              <div style={LABEL_STYLE}>{item.label}</div>
            </div>
          </div>
        </Col>
      ))}
    </Row>
  )
}
