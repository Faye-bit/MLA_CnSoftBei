/**
 * 学习画像雷达图概览 (Dashboard 迷你版)
 * 展示六维学习行为评分的迷你雷达图 + 综合评分 + 最强/最弱维度
 *
 * 设计规范 (MLA Brand v2.0):
 * - 紧凑布局, 适合 Bento Grid 卡片
 * - 品牌蓝主色调 + 语义灰辅助
 * - 数据不可用时显示引导文案
 *
 * @see branding/MLA_BRAND_GUIDELINES.md
 */

import { useEffect, useState, useMemo } from 'react'
import { Skeleton } from 'antd'
import {
  Radar,
  RadarChart as ReRadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts'
import { RadarChartOutlined } from '@ant-design/icons'
import { getRadarData } from '../../services/api'
import { useNavigate } from 'react-router-dom'
import type { RadarDimension } from '../../types'
import { gray, blue, semantic, radius } from '../../styles/tokens'

export default function RadarOverview() {
  const [dimensions, setDimensions] = useState<RadarDimension[]>([])
  const [overallScore, setOverallScore] = useState(0)
  const [dataAvailable, setDataAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    getRadarData()
      .then((res) => {
        setDimensions(res.dimensions || [])
        setOverallScore(res.overall_score || 0)
        setDataAvailable(res.data_available)
      })
      .catch(() => {
        setDataAvailable(false)
      })
      .finally(() => setLoading(false))
  }, [])

  /** 转换为 Recharts 数据格式 */
  const chartData = useMemo(() => {
    return dimensions.map((d) => ({
      subject: d.label,
      score: d.score,
      fullMark: 10,
    }))
  }, [dimensions])

  /** 找出最强和最弱维度 */
  const { strongest, weakest } = useMemo(() => {
    if (dimensions.length === 0) return { strongest: null, weakest: null }
    const sorted = [...dimensions].sort((a, b) => b.score - a.score)
    return { strongest: sorted[0], weakest: sorted[sorted.length - 1] }
  }, [dimensions])

  if (loading) {
    return (
      <div style={{ padding: '20px 24px' }}>
        <Skeleton active paragraph={{ rows: 3 }} />
      </div>
    )
  }

  /** 数据不可用时显示引导 */
  if (!dataAvailable || dimensions.length === 0) {
    return (
      <div style={{
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 200,
        textAlign: 'center',
      }}>
        <RadarChartOutlined style={{ fontSize: 36, color: gray[300], marginBottom: 12 }} />
        <div style={{ fontSize: 14, color: gray[500], marginBottom: 8 }}>
          学习画像数据不足
        </div>
        <div style={{ fontSize: 12, color: gray[400], marginBottom: 14 }}>
          使用 AI 助学功能后自动生成
        </div>
        <div
          style={{ fontSize: 13, color: blue[500], cursor: 'pointer' }}
          onClick={() => navigate('/learning')}
        >
          开始学习 →
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* 标题行 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: gray[800] }}>学习画像</div>
        <div
          style={{ fontSize: 13, color: blue[500], cursor: 'pointer' }}
          onClick={() => navigate('/student-profile')}
        >
          详情 →
        </div>
      </div>

      {/* 综合评分 + 雷达图 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {/* 综合评分 */}
        <div style={{ textAlign: 'center', minWidth: 64 }}>
          <div style={{
            fontSize: 32,
            fontWeight: 700,
            color: blue[500],
            lineHeight: 1.1,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {overallScore.toFixed(1)}
          </div>
          <div style={{ fontSize: 11, color: gray[500], marginTop: 4 }}>综合评分</div>
        </div>

        {/* 迷你雷达图 */}
        <div style={{ flex: 1, height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ReRadarChart data={chartData} cx="50%" cy="50%" outerRadius="70%">
              <PolarGrid stroke={gray[200]} />
              <PolarAngleAxis
                dataKey="subject"
                tick={{ fontSize: 10, fill: gray[500] }}
              />
              <PolarRadiusAxis
                angle={90}
                domain={[0, 10]}
                tick={false}
                axisLine={false}
              />
              <Radar
                dataKey="score"
                stroke={blue[500]}
                fill={blue[500]}
                fillOpacity={0.15}
                strokeWidth={2}
              />
            </ReRadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 最强 / 最弱维度 */}
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        {strongest && (
          <div style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: radius.md,
            backgroundColor: semantic.successBg,
            border: `1px solid #BBF7D0`,
            fontSize: 12,
          }}>
            <span style={{ color: semantic.success, fontWeight: 600 }}>最强</span>
            <span style={{ color: gray[500], marginLeft: 6 }}>{strongest.label}</span>
            <span style={{ color: semantic.success, fontWeight: 600, marginLeft: 'auto', float: 'right' }}>
              {strongest.score.toFixed(1)}
            </span>
          </div>
        )}
        {weakest && (
          <div style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: radius.md,
            backgroundColor: semantic.warningBg,
            border: `1px solid #FDE68A`,
            fontSize: 12,
          }}>
            <span style={{ color: semantic.warning, fontWeight: 600 }}>待提升</span>
            <span style={{ color: gray[500], marginLeft: 6 }}>{weakest.label}</span>
            <span style={{ color: semantic.warning, fontWeight: 600, marginLeft: 'auto', float: 'right' }}>
              {weakest.score.toFixed(1)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
