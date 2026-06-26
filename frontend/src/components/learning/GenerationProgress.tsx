/**
 * 生成进度弹窗组件
 * 展示 LangGraph 智能体编排流水线的实时进度 — SSE 事件驱动
 *
 * 设计规范 (MLA Brand v2.0):
 * - 使用品牌 token 替代硬编码色值
 * - Agent 图标色映射到语义品牌色
 */

import { Modal, Steps, Typography, Progress, Tag, Button } from 'antd'
import {
  LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined,
  ClockCircleOutlined, DeploymentUnitOutlined, UserOutlined,
  SearchOutlined, ExperimentOutlined, ThunderboltOutlined,
  AuditOutlined, CheckOutlined, RocketOutlined,
} from '@ant-design/icons'
import type { AgentStatus } from '../../types'
import { blue, gray, semantic } from '../../styles/tokens'

const { Text, Paragraph } = Typography

/** Agent 显示配置 — 品牌语义色 */
const AGENT_CONFIG: Record<string, { icon: React.ReactNode, color: string, label: string }> = {
  coordinator: { icon: <DeploymentUnitOutlined />, color: blue[500], label: '协调者' },
  profile: { icon: <UserOutlined />, color: '#7C3AED', label: '画像' },
  retrieval: { icon: <SearchOutlined />, color: '#0891B2', label: '检索' },
  teaching_design: { icon: <ExperimentOutlined />, color: '#DB2777', label: '教学设计' },
  resource_generation: { icon: <ThunderboltOutlined />, color: semantic.warning, label: '资源生成' },
  fact_check: { icon: <AuditOutlined />, color: semantic.success, label: '综合审查' },
  summary: { icon: <CheckOutlined />, color: blue[600], label: '汇总' },
  // 子生成器
  handout: { icon: <ThunderboltOutlined />, color: semantic.warning, label: '讲义' },
  mindmap: { icon: <ThunderboltOutlined />, color: semantic.warning, label: '思维导图' },
  exercise: { icon: <ThunderboltOutlined />, color: semantic.warning, label: '练习题' },
  reading: { icon: <ThunderboltOutlined />, color: semantic.warning, label: '拓展阅读' },
  coding_practice: { icon: <ThunderboltOutlined />, color: semantic.warning, label: '编程练习' },
  video_script: { icon: <ThunderboltOutlined />, color: semantic.warning, label: '交互动画' },
}

const PIPELINE_ORDER = ['coordinator', 'profile', 'retrieval', 'teaching_design', 'resource_generation', 'fact_check', 'summary']

interface GenerationProgressProps {
  open: boolean
  agents: AgentStatus[]
  currentMessage: string
  overallProgress: number
  allReady: boolean
  readyResourceCount: number
  onCancel: () => void
  onStartLearning?: () => void
}

export default function GenerationProgress({
  open, agents, currentMessage, overallProgress, allReady, readyResourceCount,
  onCancel, onStartLearning,
}: GenerationProgressProps) {
  function renderStatusIcon(status: AgentStatus['status']) {
    switch (status) {
      case 'completed': return <CheckCircleOutlined style={{ color: semantic.success }} />
      case 'running': return <LoadingOutlined style={{ color: blue[500] }} />
      case 'failed': return <CloseCircleOutlined style={{ color: semantic.danger }} />
      default: return <ClockCircleOutlined style={{ color: gray[300] }} />
    }
  }

  function renderStepTitle(agentName: string, status: AgentStatus['status']) {
    const config = AGENT_CONFIG[agentName] || { icon: null, color: gray[600], label: agentName }
    const isActive = status === 'running'
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: isActive ? 600 : 400, color: isActive ? config.color : undefined }}>
        {config.icon}
        <span>{config.label}</span>
      </span>
    )
  }

  const stepItems = PIPELINE_ORDER.map((agentName) => {
    const agent = agents.find(a => a.name === agentName)
    const status = agent?.status || 'pending'
    return {
      title: renderStepTitle(agentName, status),
      status: (status === 'failed' ? 'error' : status === 'completed' ? 'finish' : status === 'running' ? 'process' : 'wait') as 'error' | 'finish' | 'process' | 'wait',
      icon: renderStatusIcon(status),
    }
  })

  const runningAgent = agents.find(a => a.status === 'running')
  const agentDisplay = runningAgent ? `${AGENT_CONFIG[runningAgent.name]?.label || runningAgent.name} Agent` : ''
  const isComplete = overallProgress >= 100 && allReady

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ThunderboltOutlined style={{ color: blue[500], fontSize: 18 }} />
          <span>正在生成个性化学习方案</span>
        </div>
      }
      open={open} footer={null} closable={isComplete} maskClosable={false}
      width={700} centered
    >
      <div style={{ padding: '16px 0' }}>
        <Steps direction="horizontal" size="small" current={-1} items={stepItems} style={{ marginBottom: 24 }} />

        <Progress percent={Math.round(overallProgress)}
          status={overallProgress >= 100 ? 'success' : 'active'}
          strokeColor={blue[500]} style={{ marginBottom: 16 }} />

        {runningAgent && (
          <div style={{ background: gray[50], borderRadius: 8, padding: '12px 16px', border: `1px solid ${gray[200]}`, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              {renderStatusIcon('running')}
              <Text strong>{agentDisplay}</Text>
            </div>
            <Paragraph type="secondary" style={{ margin: 0, fontSize: 13 }} ellipsis={{ rows: 2 }}>
              {runningAgent.message || currentMessage}
            </Paragraph>
          </div>
        )}

        {agents.filter(a => a.status === 'completed' && a.resultSummary).slice(-3).map(agent => (
          <div key={agent.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Tag color="success" style={{ margin: 0 }}>已完成</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {AGENT_CONFIG[agent.name]?.label || agent.name}: {agent.resultSummary}
            </Text>
          </div>
        ))}

        {isComplete && (
          <div style={{ textAlign: 'center', padding: '24px 0 8px' }}>
            <div style={{ color: semantic.success, fontSize: 16, fontWeight: 500, marginBottom: 20 }}>
              <CheckCircleOutlined style={{ marginRight: 8, fontSize: 18 }} />
              所有资源已准备就绪！
              {readyResourceCount > 0 && (
                <span style={{ fontSize: 13, color: gray[400], fontWeight: 400, marginLeft: 8 }}>
                  (共 {readyResourceCount} 项)
                </span>
              )}
            </div>
            <Button type="primary" size="large" icon={<RocketOutlined />}
              onClick={onStartLearning} style={{ minWidth: 180, height: 44, fontSize: 15 }}>
              开始学习
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
