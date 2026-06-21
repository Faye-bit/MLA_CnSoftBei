/**
 * 本周学习情况看板
 * 使用 Recharts 柱状图展示本周每日消息数和完成阶段数
 * 双柱并排: 品牌蓝 = 消息数, 语义绿 = 完成阶段数
 *
 * 设计规范 (MLA Brand v2.0):
 * - 品牌色图表, 不用彩虹色
 * - Tooltip 使用品牌阴影和边框
 * - 图表元素使用 gray token
 *
 * @see branding/MLA_BRAND_GUIDELINES.md
 */

import { useEffect, useState, useCallback } from 'react'
import { Skeleton, Empty } from 'antd'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { getWeeklyStats } from '../../services/api'
import type { DailyActivity } from '../../types'
import { gray, blue, semantic } from '../../styles/tokens'

/**
 * Recharts 自定义 Tooltip 内容
 * 使用品牌设计 token 替代硬编码色值
 */
function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div
      style={{
        background: '#FFFFFF',
        border: `1px solid ${gray[200]}`,
        borderRadius: 8,
        padding: '10px 14px',
        boxShadow: `0 4px 12px rgba(15,23,42,0.08)`,
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6, color: gray[800] }}>{label}</div>
      {payload.map((entry) => (
        <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: 2,
              background: entry.color,
            }}
          />
          <span style={{ color: gray[600] }}>{entry.name}:</span>
          <span style={{ fontWeight: 600, color: entry.color }}>{entry.value}</span>
        </div>
      ))}
    </div>
  )
}

export default function WeeklyChart() {
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState<DailyActivity[]>([])
  const [totalMessages, setTotalMessages] = useState(0)
  const [totalStages, setTotalStages] = useState(0)

  /** 加载本周学习数据 */
  const loadData = useCallback(async () => {
    try {
      const data = await getWeeklyStats()
      setDays(data.days)
      setTotalMessages(data.week_total_messages)
      setTotalStages(data.week_total_stages)
    } catch {
      // 请求失败时保持空状态
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ---- 加载态 ----
  if (loading) {
    return (
      <div style={{ padding: '16px 24px 24px' }}>
        <Skeleton active paragraph={{ rows: 6 }} title={false} />
      </div>
    )
  }

  // ---- 空数据态 ----
  const hasData = totalMessages > 0 || totalStages > 0
  if (!hasData) {
    return (
      <div style={{ padding: '24px 0', textAlign: 'center' }}>
        <Empty description="本周暂无学习记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    )
  }

  // ---- 数据态 ----
  return (
    <div style={{ padding: '8px 24px 16px' }}>
      {/* 顶部汇总 */}
      <div
        style={{
          display: 'flex',
          gap: 24,
          marginBottom: 16,
          padding: '10px 16px',
          background: gray[50],
          borderRadius: 8,
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: blue[500], fontVariantNumeric: 'tabular-nums' }}>
            {totalMessages}
          </div>
          <div style={{ fontSize: 13, color: gray[500] }}>本周消息</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: semantic.success, fontVariantNumeric: 'tabular-nums' }}>
            {totalStages}
          </div>
          <div style={{ fontSize: 13, color: gray[500] }}>完成阶段</div>
        </div>
      </div>

      {/* 柱状图 */}
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>
          <BarChart
            data={days}
            margin={{ top: 4, right: 16, left: -10, bottom: 0 }}
            barCategoryGap="20%"
          >
            {/* 网格 — 使用 gray-100 */}
            <CartesianGrid strokeDasharray="3 3" stroke={gray[100]} />

            {/* X 轴: 周一~周日 */}
            <XAxis
              dataKey="day_name"
              tick={{ fontSize: 12, fill: gray[400] }}
              axisLine={{ stroke: gray[200] }}
              tickLine={false}
            />

            {/* Y 轴: 数量 */}
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 12, fill: gray[400] }}
              axisLine={false}
              tickLine={false}
            />

            {/* 悬浮提示 */}
            <Tooltip content={<CustomTooltip />} />

            {/* 图例 */}
            <Legend
              wrapperStyle={{ fontSize: 13, paddingTop: 8, color: gray[600] }}
            />

            {/* 品牌蓝柱: 消息数 */}
            <Bar
              dataKey="message_count"
              name="消息数"
              fill={blue[500]}
              radius={[4, 4, 0, 0]}
              maxBarSize={32}
            />

            {/* 语义绿柱: 完成阶段数 */}
            <Bar
              dataKey="stage_count"
              name="完成阶段"
              fill={semantic.success}
              radius={[4, 4, 0, 0]}
              maxBarSize={32}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
