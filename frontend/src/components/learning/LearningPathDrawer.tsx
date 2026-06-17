/**
 * 学习路线图抽屉组件
 * 顶部可折叠的横向时间线, 展示学习路径的所有阶段
 * 使用 Ant Design Steps 组件配合自定义样式实现水平时间线效果
 */

import { Collapse, Steps, Typography, Tag, Tooltip } from 'antd'
import {
  CheckCircleOutlined, PlayCircleOutlined, LockOutlined,
  ClockCircleOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
} from '@ant-design/icons'
import { useState } from 'react'
import type { LearningPathStage } from '../../types'

const { Text } = Typography

interface LearningPathDrawerProps {
  stages: LearningPathStage[]
  currentStageIndex: number
}

export default function LearningPathDrawer({
  stages, currentStageIndex,
}: LearningPathDrawerProps) {
  const [collapsed, setCollapsed] = useState(false)

  if (!stages || stages.length === 0) return null

  /** 渲染阶段的 Steps items */
  const stepItems = stages.map((stage, index) => {
    const status = stage.status || 'pending'
    const isCurrent = index === currentStageIndex

    let stepStatus: 'wait' | 'process' | 'finish' | 'error' = 'wait'
    let icon: React.ReactNode = <LockOutlined />

    if (status === 'completed') {
      stepStatus = 'finish'
      icon = <CheckCircleOutlined style={{ color: '#52c41a' }} />
    } else if (status === 'active' || isCurrent) {
      stepStatus = 'process'
      icon = <PlayCircleOutlined style={{ color: '#1677ff' }} />
    } else {
      icon = <ClockCircleOutlined style={{ color: '#d9d9d9' }} />
    }

    // 标题精炼: 后端已尽量控制在 8 字以内, 前端再兜底截断
    const displayTitle = stage.title.length > 8
      ? stage.title.slice(0, 8) + '…'
      : stage.title

    const title = (
      <Tooltip title={stage.description || stage.title}>
        <span style={{
          fontSize: 12,
          fontWeight: isCurrent ? 600 : 400,
          color: isCurrent ? '#1677ff' : undefined,
        }}>
          {displayTitle}
        </span>
      </Tooltip>
    )

    return {
      title,
      status: stepStatus,
      icon,
    }
  })

  return (
    <div style={{
      background: '#fff',
      borderBottom: '1px solid #f0f0f0',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      {/* 折叠标题栏 */}
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 20px', cursor: 'pointer',
          background: '#fafafa', borderBottom: collapsed ? 'none' : '1px solid #f0f0f0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {collapsed ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
          <Text strong style={{ fontSize: 13 }}>学习路线</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {stages.filter(s => s.status === 'completed').length} / {stages.length} 阶段
          </Text>
        </div>
      </div>

      {/* 水平 Steps */}
      {!collapsed && (
        <div style={{
          padding: '16px 40px',
          overflowX: 'auto',
        }}>
          <Steps
            current={currentStageIndex}
            size="small"
            items={stepItems}
            style={{ minWidth: stages.length * 120 }}
          />
        </div>
      )}
    </div>
  )
}
