/**
 * 学习路线图抽屉组件
 * 顶部可折叠的横向时间线, 展示学习路径的所有阶段
 *
 * 设计规范 (MLA Brand v2.0):
 * - 使用品牌 token 替代硬编码色值
 */

import { Steps, Typography, Button } from 'antd'
import {
  CheckCircleOutlined, PlayCircleOutlined, LockOutlined,
  ClockCircleOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
  RocketOutlined, LoadingOutlined, CheckOutlined,
} from '@ant-design/icons'
import { useState } from 'react'
import type { LearningPathStage } from '../../types'
import { blue, gray, semantic } from '../../styles/tokens'

const { Text } = Typography

interface LearningPathDrawerProps {
  stages: LearningPathStage[]
  currentStageIndex: number
  totalStages: number
  isLastStage: boolean
  generating: boolean
  onComplete: () => void
  /** 点击已完成阶段时回调, 用于切换到该阶段查看/复习 */
  onNavigateStage?: (stageIndex: number) => void
}

function CompleteButton({ isLastStage, generating, onComplete }: {
  isLastStage: boolean; generating: boolean; onComplete: () => void
}) {
  if (!isLastStage) {
    return (
      <Button type="primary"
        icon={generating ? <LoadingOutlined /> : <RocketOutlined />}
        loading={generating}
        onClick={(e) => { e.stopPropagation(); onComplete() }}>
        {generating ? '正在生成下一阶段...' : '我已完成本阶段，生成下一阶段'}
      </Button>
    )
  }
  return (
    <Button type="primary" icon={<CheckOutlined />}
      onClick={(e) => { e.stopPropagation(); onComplete() }}
      style={{ background: semantic.success, borderColor: semantic.success }}>
      完成全部课程学习
    </Button>
  )
}

export default function LearningPathDrawer({
  stages, currentStageIndex, totalStages, isLastStage, generating, onComplete, onNavigateStage,
}: LearningPathDrawerProps) {
  const [collapsed, setCollapsed] = useState(false)

  const effectiveStages: LearningPathStage[] = (stages && stages.length > 0) ? stages : []

  const stepItems = effectiveStages.map((stage, index) => {
    const status = stage.status || 'pending'
    const isCurrent = index === currentStageIndex

    let stepStatus: 'wait' | 'process' | 'finish' | 'error' = 'wait'
    let icon: React.ReactNode = <LockOutlined />

    if (status === 'completed') {
      stepStatus = 'finish'
      icon = <CheckCircleOutlined style={{ color: semantic.success }} />
    } else if (status === 'active' || isCurrent) {
      stepStatus = 'process'
      icon = <PlayCircleOutlined style={{ color: blue[500] }} />
    } else {
      icon = <ClockCircleOutlined style={{ color: gray[300] }} />
    }

    const displayTitle = stage.title.length > 8 ? stage.title.slice(0, 8) + '…' : stage.title

    return {
      title: <span style={{ fontSize: 12, fontWeight: isCurrent ? 600 : 400, color: isCurrent ? blue[500] : undefined }}>{displayTitle}</span>,
      status: stepStatus,
      icon,
    }
  })

  const completedCount = effectiveStages.filter(s => s.status === 'completed').length
  const stageCountLabel = effectiveStages.length > 0
    ? `${completedCount} / ${effectiveStages.length} 阶段`
    : `阶段 ${currentStageIndex + 1} / ${totalStages}`

  return (
    <div style={{ background: '#FFFFFF', borderBottom: `1px solid ${gray[200]}`, boxShadow: `0 1px 4px rgba(15,23,42,0.04)` }}>
      {/* 标题栏 (始终可见) */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 20px', background: gray[50],
        borderBottom: collapsed ? 'none' : `1px solid ${gray[200]}`,
      }}>
        <div onClick={() => setCollapsed(!collapsed)} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
          {collapsed ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
          <Text strong style={{ fontSize: 13 }}>学习路线</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{stageCountLabel}</Text>
        </div>
        <CompleteButton isLastStage={isLastStage} generating={generating} onComplete={onComplete} />
      </div>

      {/* 展开: 水平 Steps (已完成阶段可点击回看) */}
      {!collapsed && effectiveStages.length > 0 && (
        <div style={{ padding: '16px 40px', overflowX: 'auto' }}>
          <Steps
            current={currentStageIndex}
            size="small"
            items={stepItems}
            onChange={(clickedIndex) => {
              // 允许点击已完成阶段、当前活跃阶段 (无法跳到未开始阶段)
              const status = effectiveStages[clickedIndex]?.status
              if (status === 'completed' || status === 'active' || status === 'process') {
                onNavigateStage?.(clickedIndex)
              }
            }}
            style={{ minWidth: effectiveStages.length * 120, cursor: 'pointer' }}
          />
        </div>
      )}
    </div>
  )
}
