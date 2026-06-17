/**
 * 学习行为雷达图组件
 * 以六边形雷达图直观展示用户 6 个维度的学习状态 0-10 评分
 *
 * 六大维度: 学科均衡度、学习自律度、主动学习意愿、刷题巩固强度、复习复盘习惯、听课专注度
 * 所有分值基于近 30 天平台行为统计, 每日凌晨更新
 */

import { useMemo } from 'react'
import {
  Radar,
  RadarChart as ReRadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import { Card, Typography, Spin, Empty, Tag, Space } from 'antd'
import {
  ThunderboltOutlined,
  ClockCircleOutlined,
  SyncOutlined,
  PieChartOutlined,
  FormOutlined,
  EyeOutlined,
  RadarChartOutlined,
} from '@ant-design/icons'
import type { RadarDimension } from '../../types'

const { Text, Title } = Typography

/** 维度 key → 图标映射 */
const ICON_MAP: Record<string, React.ReactNode> = {
  subject_balance: <PieChartOutlined />,
  learning_discipline: <ClockCircleOutlined />,
  active_learning: <ThunderboltOutlined />,
  practice_intensity: <FormOutlined />,
  review_habit: <SyncOutlined />,
  focus_level: <EyeOutlined />,
}

interface RadarChartProps {
  /** 雷达图维度数据 */
  dimensions: RadarDimension[]
  /** 综合平均分 */
  overallScore: number
  /** 是否加载中 */
  loading?: boolean
  /** 更新时间 */
  updatedAt?: string
}

/**
 * 将维度数据转为 recharts 需要的格式
 */
function toChartData(dimensions: RadarDimension[]) {
  return dimensions.map((d) => ({
    subject: d.label,
    score: d.score,
    fullMark: 10,
    key: d.key,
    tooltip: d.tooltip,
  }))
}

/**
 * 综合分对应的颜色和评级
 */
function scoreLevel(score: number): { color: string; level: string } {
  if (score >= 8) return { color: '#52c41a', level: '优秀' }
  if (score >= 6) return { color: '#1677ff', level: '良好' }
  if (score >= 4) return { color: '#faad14', level: '一般' }
  return { color: '#ff4d4f', level: '需提升' }
}

export default function RadarChart({
  dimensions,
  overallScore,
  loading = false,
  updatedAt,
}: RadarChartProps) {
  const chartData = useMemo(() => toChartData(dimensions), [dimensions])
  const { color, level } = scoreLevel(overallScore)

  if (loading) {
    return (
      <Card
        title={
          <Space>
            <RadarChartOutlined />
            <span>学习行为雷达图</span>
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin tip="分析学习行为..." />
        </div>
      </Card>
    )
  }

  if (!dimensions || dimensions.length === 0) {
    return (
      <Card
        title={
          <Space>
            <RadarChartOutlined />
            <span>学习行为雷达图</span>
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        <Empty
          description="暂无学习行为数据, 上传课件或开始 AI 对话后将自动生成雷达图"
          style={{ padding: 20 }}
        />
      </Card>
    )
  }

  return (
    <Card
      title={
        <Space>
          <RadarChartOutlined />
          <span>学习行为雷达图</span>
        </Space>
      }
      extra={
        <Space>
          <Tag color={color} style={{ fontSize: 13, fontWeight: 600 }}>
            {level} · {overallScore.toFixed(1)}
          </Tag>
          {updatedAt && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              更新于 {new Date(updatedAt).toLocaleString('zh-CN')}
            </Text>
          )}
        </Space>
      }
      style={{ marginBottom: 24 }}
    >
      {/* 维度说明标签 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          marginBottom: 16,
          justifyContent: 'center',
        }}
      >
        {dimensions.map((dim) => (
          <Tag
            key={dim.key}
            icon={ICON_MAP[dim.key]}
            color={dim.score >= 7 ? 'green' : dim.score >= 4 ? 'blue' : 'orange'}
            style={{ fontSize: 12 }}
          >
            {dim.label}: {dim.score.toFixed(1)}
          </Tag>
        ))}
      </div>

      {/* 雷达图 */}
      <div style={{ width: '100%', height: 420 }}>
        <ResponsiveContainer>
          <ReRadarChart data={chartData} cx="50%" cy="50%" outerRadius="75%">
            <PolarGrid stroke="#e8e8e8" />
            <PolarAngleAxis
              dataKey="subject"
              tick={{ fontSize: 13, fill: '#333' }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 10]}
              tick={{ fontSize: 11, fill: '#999' }}
              tickCount={6}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length > 0) {
                  const data = payload[0].payload
                  return (
                    <div
                      style={{
                        background: '#fff',
                        padding: '10px 14px',
                        border: '1px solid #e8e8e8',
                        borderRadius: 8,
                        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                        maxWidth: 260,
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        {data.subject}
                      </div>
                      <div style={{ color: '#1677ff', fontWeight: 700, fontSize: 18 }}>
                        {data.score.toFixed(1)} / 10
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: '#666',
                          marginTop: 4,
                          lineHeight: 1.5,
                        }}
                      >
                        {data.tooltip}
                      </div>
                    </div>
                  )
                }
                return null
              }}
            />
            <Radar
              name="学习行为"
              dataKey="score"
              stroke="#1677ff"
              fill="#1677ff"
              fillOpacity={0.25}
              strokeWidth={2}
            />
          </ReRadarChart>
        </ResponsiveContainer>
      </div>

      {/* 综合评估 */}
      <div
        style={{
          textAlign: 'center',
          marginTop: 16,
          padding: '12px 16px',
          background: '#fafafa',
          borderRadius: 8,
        }}
      >
        <Text type="secondary" style={{ fontSize: 13 }}>
          综合评分 <strong style={{ color, fontSize: 18 }}>{overallScore.toFixed(1)}</strong> / 10
          {' · '}
          <Tag color={color}>{level}</Tag>
          {' · '}
          基于近 30 天学习行为自动计算
        </Text>
      </div>
    </Card>
  )
}
