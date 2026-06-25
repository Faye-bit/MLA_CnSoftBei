/**
 * 学习行为雷达图组件
 * 以六边形雷达图直观展示用户 6 个维度的学习状态 0-10 评分
 *
 * 设计规范 (MLA Brand v2.0):
 * - 使用品牌 token 替代硬编码色值
 * - 品牌蓝 + 语义色
 */

import { useMemo } from 'react'
import { Radar, RadarChart as ReRadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { Card, Typography, Spin, Empty, Tag, Space } from 'antd'
import { ThunderboltOutlined, ClockCircleOutlined, SyncOutlined, PieChartOutlined, FormOutlined, EyeOutlined, RadarChartOutlined } from '@ant-design/icons'
import type { RadarDimension } from '../../types'
import { blue, gray, semantic } from '../../styles/tokens'

const { Text } = Typography

const ICON_MAP: Record<string, React.ReactNode> = {
  subject_balance: <PieChartOutlined />,
  learning_discipline: <ClockCircleOutlined />,
  active_learning: <ThunderboltOutlined />,
  practice_intensity: <FormOutlined />,
  review_habit: <SyncOutlined />,
  focus_level: <EyeOutlined />,
}

interface RadarChartProps {
  dimensions: RadarDimension[]
  overallScore: number
  loading?: boolean
  updatedAt?: string
  selectedKey?: string
  onDimensionClick?: (key: string) => void
}

function toChartData(dimensions: RadarDimension[]) {
  return dimensions.map((d) => ({ subject: d.label, score: d.score, fullMark: 10, key: d.key, tooltip: d.tooltip }))
}

function scoreLevel(score: number): { color: string; level: string } {
  if (score >= 8) return { color: semantic.success, level: '优秀' }
  if (score >= 6) return { color: blue[500], level: '良好' }
  if (score >= 4) return { color: semantic.warning, level: '一般' }
  return { color: semantic.danger, level: '需提升' }
}

export default function RadarChart({ dimensions, overallScore, loading = false, updatedAt, selectedKey, onDimensionClick }: RadarChartProps) {
  const chartData = useMemo(() => toChartData(dimensions), [dimensions])
  const { color, level } = scoreLevel(overallScore)

  if (loading) {
    return (
      <Card title={<Space><RadarChartOutlined /><span>学习行为雷达图</span></Space>} style={{ marginBottom: 24 }}>
        <div style={{ textAlign: 'center', padding: 60 }}><Spin tip="分析学习行为..." /></div>
      </Card>
    )
  }

  if (!dimensions || dimensions.length === 0) {
    return (
      <Card title={<Space><RadarChartOutlined /><span>学习行为雷达图</span></Space>} style={{ marginBottom: 24 }}>
        <Empty description="暂无学习行为数据, 上传课件或开始 AI 对话后将自动生成雷达图" style={{ padding: 20 }} />
      </Card>
    )
  }

  return (
    <Card
      title={<Space><RadarChartOutlined /><span>学习行为雷达图</span></Space>}
      extra={
        <Space>
          <Tag color={color} style={{ fontSize: 13, fontWeight: 600 }}>{level} · {overallScore.toFixed(1)}</Tag>
          {updatedAt && <Text type="secondary" style={{ fontSize: 11 }}>更新于 {new Date(updatedAt).toLocaleString('zh-CN')}</Text>}
        </Space>
      }
      style={{ marginBottom: 24 }}>
      {/* 维度说明标签 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16, justifyContent: 'center' }}>
        {dimensions.map((dim) => (
          <Tag key={dim.key} icon={ICON_MAP[dim.key]}
            color={dim.score >= 7 ? 'green' : dim.score >= 4 ? 'blue' : 'orange'}
            style={{ fontSize: 12, cursor: 'pointer', fontWeight: dim.key === selectedKey ? 700 : 400 }}
            onClick={() => onDimensionClick?.(dim.key)}>
            {dim.label}: {dim.score.toFixed(1)}
          </Tag>
        ))}
      </div>

      {/* 雷达图 */}
      <div style={{ width: '100%', height: 420 }}>
        <ResponsiveContainer>
          <ReRadarChart data={chartData} cx="50%" cy="50%" outerRadius="75%">
            <PolarGrid stroke={gray[200]} />
            <PolarAngleAxis dataKey="subject" tick={{ fontSize: 13, fill: gray[800] }} />
            <PolarRadiusAxis angle={90} domain={[0, 10]} tick={{ fontSize: 11, fill: gray[400] }} tickCount={6} />
            <Tooltip content={({ active, payload }) => {
              if (active && payload && payload.length > 0) {
                const data = payload[0].payload
                return (
                  <div style={{ background: '#FFFFFF', padding: '10px 14px', border: `1px solid ${gray[200]}`, borderRadius: 8, boxShadow: `0 4px 12px rgba(15,23,42,0.08)`, maxWidth: 260 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{data.subject}</div>
                    <div style={{ color: blue[500], fontWeight: 700, fontSize: 18 }}>{data.score.toFixed(1)} / 10</div>
                    <div style={{ fontSize: 11, color: gray[600], marginTop: 4, lineHeight: 1.5 }}>{data.tooltip}</div>
                  </div>
                )
              }
              return null
            }} />
            <Radar name="学习行为" dataKey="score" stroke={blue[500]} fill={blue[500]} fillOpacity={0.25} strokeWidth={2} />
          </ReRadarChart>
        </ResponsiveContainer>
      </div>

      {/* 综合评估 */}
      <div style={{ textAlign: 'center', marginTop: 16, padding: '12px 16px', background: gray[50], borderRadius: 8 }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          综合评分 <strong style={{ color, fontSize: 18 }}>{overallScore.toFixed(1)}</strong> / 10 {' · '}
          <Tag color={color}>{level}</Tag> {' · '} 基于近 30 天学习行为自动计算
        </Text>
      </div>
    </Card>
  )
}
