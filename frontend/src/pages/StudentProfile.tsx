/**
 * 学生画像展示与编辑页 (描述式)
 * 展示从对话中自动积累和合成的 6 个维度学习画像
 * 每个维度为自然语言描述文本, 支持在线编辑
 *
 * 设计规范 (MLA Brand v2.0):
 * - 使用品牌 token 替代硬编码色值
 */

import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Typography, Button, Space, Spin, message, Popconfirm } from 'antd'
import {
  ReloadOutlined,
  DeleteOutlined,
  ArrowLeftOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import ProfileDimensionCard from '../components/profile/ProfileDimensionCard'
import RadarChart from '../components/profile/RadarChart'
import DimensionDetail from '../components/profile/DimensionDetail'
import {
  getStudentProfile,
  updateStudentProfile,
  deleteProfile,
  rebuildProfile,
  getRadarData,
} from '../services/api'
import type { StudentProfile as StudentProfileType, RadarDimension } from '../types'
import { blue, gray, semantic } from '../styles/tokens'

const { Title, Text, Paragraph } = Typography

/** 6 个画像维度的名称映射 */
const DIMENSION_LABELS: Record<string, string> = {
  academic_background: '专业背景',
  knowledge_basis: '知识基础',
  learning_goals: '学习目标',
  learning_preferences: '学习偏好',
  weak_areas: '薄弱知识点',
  interests: '兴趣方向',
}

export default function StudentProfile() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState<StudentProfileType | null>(null)
  const [loading, setLoading] = useState(true)
  const [rebuilding, setRebuilding] = useState(false)
  const [radarDimensions, setRadarDimensions] = useState<RadarDimension[]>([])
  const [radarOverall, setRadarOverall] = useState(0)
  const [radarUpdatedAt, setRadarUpdatedAt] = useState('')
  const [radarLoading, setRadarLoading] = useState(true)
  const [selectedDimension, setSelectedDimension] = useState('practice_intensity')

  const loadProfile = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getStudentProfile()
      setProfile(data)
    } catch (err) {
      message.error('加载画像失败: ' + (err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadRadar = useCallback(async () => {
    setRadarLoading(true)
    try {
      const data = await getRadarData()
      setRadarDimensions(data.dimensions || [])
      setRadarOverall(data.overall_score || 0)
      setRadarUpdatedAt(data.updated_at || '')
    } catch (err) {
      console.error('雷达图加载失败:', err)
      const msg = (err as Error).message || String(err)
      if (msg && !msg.includes('401')) {
        message.warning('雷达图加载失败: ' + msg)
      }
    } finally {
      setRadarLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProfile()
    loadRadar()
  }, [loadProfile, loadRadar])

  const handleSaveDimension = useCallback(async (dimKey: string, text: string) => {
    try {
      const updated = await updateStudentProfile({
        profile_data: { [dimKey]: text },
      })
      setProfile(updated)
      message.success(`${DIMENSION_LABELS[dimKey] || dimKey} 已更新`)
    } catch (err) {
      message.error('更新失败: ' + (err as Error).message)
    }
  }, [])

  const handleRebuild = useCallback(async () => {
    setRebuilding(true)
    try {
      await rebuildProfile()
      message.success('画像已重建')
      await loadProfile()
    } catch (err) {
      message.error('重建失败: ' + (err as Error).message)
    } finally {
      setRebuilding(false)
    }
  }, [loadProfile])

  const handleResetProfile = useCallback(async () => {
    try {
      await deleteProfile()
      message.success('画像已重置')
      await loadProfile()
    } catch (err) {
      message.error('重置失败: ' + (err as Error).message)
    }
  }, [loadProfile])

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" tip="加载画像中..." />
      </div>
    )
  }

  return (
    <div style={{ margin: '-12px -12px 0 -12px' }}>
      {/* 顶部导航 */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} type="text">
            返回
          </Button>
          <Title level={3} style={{ margin: 0 }}>
            我的学习画像
          </Title>
        </Space>
        <Space>
          <Button icon={<ThunderboltOutlined />} onClick={handleRebuild} loading={rebuilding}>
            重建画像
          </Button>
          <Button icon={<ReloadOutlined />} onClick={loadProfile}>
            刷新
          </Button>
          <Popconfirm
            title="确定要重置画像吗? 所有画像数据将被删除。"
            onConfirm={handleResetProfile}
            okText="确定"
            cancelText="取消"
          >
            <Button danger icon={<DeleteOutlined />}>
              重置画像
            </Button>
          </Popconfirm>
        </Space>
      </div>

      {/* 画像摘要 */}
      {profile?.summary && (
        <Paragraph
          style={{
            marginBottom: 24,
            padding: '12px 16px',
            background: semantic.successBg,
            borderRadius: 6,
            border: '1px solid #BBF7D0',
          }}
        >
          <Text strong>画像摘要: </Text>
          {profile.summary}
        </Paragraph>
      )}

      {/* 学习行为雷达图 (左) + 维度追踪卡片 (右) */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24, minHeight: 400 }}>
        <div style={{ flex: '0 0 420px' }}>
          <RadarChart
            dimensions={radarDimensions}
            overallScore={radarOverall}
            loading={radarLoading}
            updatedAt={radarUpdatedAt}
            selectedKey={selectedDimension}
            onDimensionClick={setSelectedDimension}
          />
        </div>
        <div style={{ flex: 1, minWidth: 300 }}>
          <DimensionDetail dimensionKey={selectedDimension} />
        </div>
      </div>

      {/* 系统已了解的信息 (后台自动提取的记忆) */}
      {profile?.memories && profile.memories.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
            系统已了解的信息 ({profile.memories.length} 条)
          </Text>
          <div
            style={{
              padding: '12px 16px',
              background: blue[50],
              borderRadius: 6,
              border: `1px solid ${blue[100]}`,
              maxHeight: 200,
              overflow: 'auto',
            }}
          >
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.8 }}>
              {profile.memories.map((mem, idx) => (
                <li key={idx} style={{ color: gray[800] }}>{mem}</li>
              ))}
            </ul>
          </div>
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
            以上信息由系统在对话中自动提取和积累，点击「重建画像」可将其归类合成到各维度
          </Text>
        </div>
      )}

      {/* 缺失信息提示 */}
      {profile?.missing_fields && profile.missing_fields.length > 0 && (
        <Paragraph
          style={{
            marginBottom: 24,
            padding: '12px 16px',
            background: semantic.warningBg,
            borderRadius: 6,
            border: '1px solid #FDE68A',
            fontSize: 13,
          }}
        >
          还有 <strong>{profile.missing_fields.length}</strong> 个维度尚未收集到信息, 可通过 AI 对话或手动编辑补充。
        </Paragraph>
      )}

      {/* 6 个维度卡片 */}
      {profile && (
        <div>
          {Object.entries(DIMENSION_LABELS).map(([dimKey, label]) => (
            <ProfileDimensionCard
              key={dimKey}
              title={label}
              dimKey={dimKey}
              description={profile.profile_data[dimKey] || ''}
              isMissing={profile.missing_fields?.includes(dimKey)}
              onSave={handleSaveDimension}
            />
          ))}
        </div>
      )}
    </div>
  )
}
