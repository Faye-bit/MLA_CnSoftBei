/**
 * 生成进度弹窗组件
 * 展示 LangGraph 智能体编排流水线的实时进度
 * 通过 SSE 事件驱动, 可视化显示每个 Agent 的状态
 *
 * 阶段转换:
 *   progress < 100 → 显示流水线进度条
 *   progress >= 100 且 !allReady → 显示"正在保存..."
 *   progress >= 100 且 allReady → 显示"所有资源已准备就绪！"+ "开始学习"按钮
 */

import { Modal, Steps, Typography, Progress, Tag, Button } from 'antd'
import {
  LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined,
  ClockCircleOutlined, DeploymentUnitOutlined, UserOutlined,
  SearchOutlined, ExperimentOutlined, ThunderboltOutlined,
  SafetyCertificateOutlined, CheckOutlined, RocketOutlined,
} from '@ant-design/icons'
import type { AgentStatus } from '../../types'

const { Text, Paragraph } = Typography

/** Agent 显示配置: 图标 + 颜色 */
const AGENT_CONFIG: Record<string, { icon: React.ReactNode, color: string, label: string }> = {
  coordinator: { icon: <DeploymentUnitOutlined />, color: '#1677ff', label: '协调者' },
  profile: { icon: <UserOutlined />, color: '#722ed1', label: '画像' },
  retrieval: { icon: <SearchOutlined />, color: '#13c2c2', label: '检索' },
  teaching_design: { icon: <ExperimentOutlined />, color: '#eb2f96', label: '教学设计' },
  resource_generation: { icon: <ThunderboltOutlined />, color: '#fa8c16', label: '资源生成' },
  fact_check: { icon: <SafetyCertificateOutlined />, color: '#52c41a', label: '安全核查' },
  summary: { icon: <CheckOutlined />, color: '#2f54eb', label: '汇总' },
  // 子生成器
  handout: { icon: <ThunderboltOutlined />, color: '#fa8c16', label: '讲义' },
  mindmap: { icon: <ThunderboltOutlined />, color: '#fa8c16', label: '思维导图' },
  exercise: { icon: <ThunderboltOutlined />, color: '#fa8c16', label: '练习题' },
  reading: { icon: <ThunderboltOutlined />, color: '#fa8c16', label: '拓展阅读' },
  coding_practice: { icon: <ThunderboltOutlined />, color: '#fa8c16', label: '编程练习' },
  video_script: { icon: <ThunderboltOutlined />, color: '#fa8c16', label: '交互动画' },
}

/** 主流水线 Agent 顺序 */
const PIPELINE_ORDER = [
  'coordinator', 'profile', 'retrieval',
  'teaching_design', 'resource_generation',
  'fact_check', 'summary',
]

interface GenerationProgressProps {
  open: boolean
  agents: AgentStatus[]
  currentMessage: string
  overallProgress: number
  /** 所有资源已持久化到数据库, 可以开始学习 */
  allReady: boolean
  /** 已持久化的资源数量 */
  readyResourceCount: number
  onCancel: () => void
  /** 用户点击"开始学习"按钮 */
  onStartLearning?: () => void
}

export default function GenerationProgress({
  open, agents, currentMessage, overallProgress, allReady, readyResourceCount,
  onCancel, onStartLearning,
}: GenerationProgressProps) {
  /** 渲染单个 Agent 状态图标 */
  function renderStatusIcon(status: AgentStatus['status']) {
    switch (status) {
      case 'completed': return <CheckCircleOutlined style={{ color: '#52c41a' }} />
      case 'running': return <LoadingOutlined style={{ color: '#1677ff' }} />
      case 'failed': return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
      default: return <ClockCircleOutlined style={{ color: '#d9d9d9' }} />
    }
  }

  /** 获取 Step 的 title 渲染 */
  function renderStepTitle(agentName: string, status: AgentStatus['status']) {
    const config = AGENT_CONFIG[agentName] || { icon: null, color: '#666', label: agentName }
    const isActive = status === 'running'
    return (
      <span style={{
        display: 'flex', alignItems: 'center', gap: 4,
        fontWeight: isActive ? 600 : 400,
        color: isActive ? config.color : undefined,
      }}>
        {config.icon}
        <span>{config.label}</span>
      </span>
    )
  }

  /** 构建 Steps 的 items */
  const stepItems = PIPELINE_ORDER.map((agentName) => {
    const agent = agents.find(a => a.name === agentName)
    const status = agent?.status || 'pending'
    return {
      title: renderStepTitle(agentName, status),
      status: status === 'failed' ? 'error' as const
        : status === 'completed' ? 'finish' as const
        : status === 'running' ? 'process' as const
        : 'wait' as const,
      icon: renderStatusIcon(status),
    }
  })

  /** 获取当前运行的 Agent 消息 */
  const runningAgent = agents.find(a => a.status === 'running')
  const agentDisplay = runningAgent
    ? `${AGENT_CONFIG[runningAgent.name]?.label || runningAgent.name} Agent`
    : ''

  /** 是否处于"生成完毕, 等待用户确认"阶段 */
  const isComplete = overallProgress >= 100 && allReady

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ThunderboltOutlined style={{ color: '#1677ff', fontSize: 18 }} />
          <span>正在生成个性化学习方案</span>
        </div>
      }
      open={open}
      footer={null}
      closable={isComplete}  /* 生成完毕后允许关闭 */
      maskClosable={false}
      width={700}
      centered
    >
      <div style={{ padding: '16px 0' }}>
        {/* Agent 流水线 Steps */}
        <Steps
          direction="horizontal"
          size="small"
          current={-1}
          items={stepItems}
          style={{ marginBottom: 24 }}
        />

        {/* 总体进度 */}
        <Progress
          percent={Math.round(overallProgress)}
          status={overallProgress >= 100 ? 'success' : 'active'}
          strokeColor="#1677ff"
          style={{ marginBottom: 16 }}
        />

        {/* 当前工作状态 */}
        {runningAgent && (
          <div style={{
            background: '#f6f8fa', borderRadius: 8, padding: '12px 16px',
            border: '1px solid #e8e8e8', marginBottom: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              {renderStatusIcon('running')}
              <Text strong>{agentDisplay}</Text>
            </div>
            <Paragraph
              type="secondary"
              style={{ margin: 0, fontSize: 13 }}
              ellipsis={{ rows: 2 }}
            >
              {runningAgent.message || currentMessage}
            </Paragraph>
          </div>
        )}

        {/* 已完成 Agent 的摘要 */}
        {agents
          .filter(a => a.status === 'completed' && a.resultSummary)
          .slice(-3)
          .map(agent => (
            <div key={agent.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Tag color="success" style={{ margin: 0 }}>已完成</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {AGENT_CONFIG[agent.name]?.label || agent.name}: {agent.resultSummary}
              </Text>
            </div>
          ))
        }

        {/* 所有资源就绪 — 激活开始学习按钮 */}
        {isComplete && (
          <div style={{
            textAlign: 'center', padding: '24px 0 8px',
          }}>
            <div style={{
              color: '#52c41a', fontSize: 16, fontWeight: 500, marginBottom: 20,
            }}>
              <CheckCircleOutlined style={{ marginRight: 8, fontSize: 18 }} />
              所有资源已准备就绪！
              {readyResourceCount > 0 && (
                <span style={{ fontSize: 13, color: '#999', fontWeight: 400, marginLeft: 8 }}>
                  (共 {readyResourceCount} 项)
                </span>
              )}
            </div>
            <Button
              type="primary"
              size="large"
              icon={<RocketOutlined />}
              onClick={onStartLearning}
              style={{ minWidth: 180, height: 44, fontSize: 15 }}
            >
              开始学习
            </Button>
          </div>
        )}

      </div>
    </Modal>
  )
}
