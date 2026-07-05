/**
 * 学习进度概览组件
 * 展示学习会话的活跃/完成/暂停数量 + 平均进度
 *
 * 设计规范 (MLA Brand v2.0):
 * - 环形进度指示 + 数字统计
 * - blue-500 / semantic.success 区分状态
 * - 1px gray-200 边框, 8px 圆角
 *
 * @see branding/MLA_BRAND_GUIDELINES.md
 */

import { useEffect, useState } from 'react'
import { Progress, Skeleton } from 'antd'
import {
  ThunderboltOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import { getZhiXueSessions } from '../../services/api'
import { useNavigate } from 'react-router-dom'
import { gray, blue, semantic, radius } from '../../styles/tokens'

/** 学习进度统计 */
interface ProgressStats {
  /** 活跃中会话数 */
  active: number
  /** 已完成会话数 */
  completed: number
  /** 平均进度百分比 */
  avgProgress: number
  /** 最近学习的课程名 */
  recentCourse: string | null
  /** 最近学习的会话 ID */
  recentSessionId: string | null
}

/** 状态卡片样式 (品牌规范) */
const STAT_CARD_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 14px',
  borderRadius: radius.md,
  border: `1px solid ${gray[200]}`,
  backgroundColor: '#FFFFFF',
  transition: 'border-color 0.2s ease',
  cursor: 'default',
}

/** 数值文字样式 */
const STAT_VALUE_STYLE: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  lineHeight: 1.2,
  color: gray[900],
  fontVariantNumeric: 'tabular-nums',
}

/** 标签文字样式 */
const STAT_LABEL_STYLE: React.CSSProperties = {
  fontSize: 12,
  color: gray[500],
}

export default function LearningProgress() {
  const [stats, setStats] = useState<ProgressStats | null>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    getZhiXueSessions({ limit: 100 })
      .then((res) => {
        const sessions = res.items || []
        // ZhiXue status: idle/questionnaire/planning/generating/delivering = active,
        // completed = done, failed = paused
        const active = sessions.filter((s) =>
          !['completed', 'failed'].includes(s.status)
        ).length
        const completed = sessions.filter((s) => s.status === 'completed').length
        const total = sessions.length
        const avgProgress = total > 0
          ? Math.round(
              sessions.reduce((sum, s) => {
                const pct = s.total_stages && s.total_stages > 0
                  ? Math.round((s.current_stage_index / s.total_stages) * 100)
                  : s.status === 'completed' ? 100 : 0
                return sum + pct
              }, 0) / total
            )
          : 0

        /** 找到最近更新的会话 */
        const sorted = [...sessions].sort((a, b) => {
          const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0
          const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0
          return tb - ta
        })
        const recent = sorted[0] || null

        setStats({
          active,
          completed,
          avgProgress,
          recentCourse: recent?.course_name ?? null,
          recentSessionId: recent?.id ?? null,
        })
      })
      .catch(() => {
        setStats({ active: 0, completed: 0, avgProgress: 0, recentCourse: null, recentSessionId: null })
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div style={{ padding: '20px 24px' }}>
        <Skeleton active paragraph={{ rows: 3 }} />
      </div>
    )
  }

  if (!stats) return null

  /** 状态卡片配置 */
  const statusItems = [
    {
      icon: <ThunderboltOutlined />,
      value: stats.active,
      label: '进行中',
      color: blue[500],
      bgColor: blue[50],
    },
    {
      icon: <CheckCircleOutlined />,
      value: stats.completed,
      label: '已完成',
      color: semantic.success,
      bgColor: semantic.successBg,
    },
  ]

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* 标题行 + 环形进度 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: gray[800] }}>学习进度</div>
          <div style={{ fontSize: 12, color: gray[500], marginTop: 2 }}>
            {stats.recentCourse ? `最近在学: ${stats.recentCourse}` : '暂无学习记录'}
          </div>
        </div>
        {/* 环形进度 — 品牌蓝到成功绿渐变 */}
        <Progress
          type="circle"
          percent={stats.avgProgress}
          size={64}
          strokeColor={{ '0%': blue[500], '100%': semantic.success }}
          trailColor={gray[100]}
          format={(p) => (
            <span style={{ fontSize: 16, fontWeight: 700, color: gray[800] }}>
              {p}%
            </span>
          )}
        />
      </div>

      {/* 状态卡片 */}
      <div style={{ display: 'flex', gap: 10 }}>
        {statusItems.map((item) => (
          <div
            key={item.label}
            style={{ ...STAT_CARD_STYLE, flex: 1 }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = item.color }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = gray[200] }}
          >
            {/* 图标容器 */}
            <div style={{
              width: 32,
              height: 32,
              borderRadius: radius.md,
              backgroundColor: item.bgColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              color: item.color,
              flexShrink: 0,
            }}>
              {item.icon}
            </div>
            <div>
              <div style={STAT_VALUE_STYLE}>{item.value}</div>
              <div style={STAT_LABEL_STYLE}>{item.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 查看全部链接 */}
      {stats.active > 0 && (
        <div
          style={{
            marginTop: 14,
            fontSize: 13,
            color: blue[500],
            cursor: 'pointer',
            textAlign: 'right',
          }}
          onClick={() => navigate('/zhixue')}
        >
          查看全部学习会话 →
        </div>
      )}
    </div>
  )
}
