/**
 * 阶段完成栏组件
 * 固定在页面底部的操作栏, 用户确认完成当前阶段后触发生成下一阶段
 */

import { Button, Typography, Space, message } from 'antd'
import {
  CheckOutlined, RocketOutlined, LoadingOutlined,
} from '@ant-design/icons'

const { Text } = Typography

interface StageCompletionBarProps {
  currentStageIndex: number
  totalStages: number
  isLastStage: boolean
  generating: boolean
  onComplete: () => void
}

export default function StageCompletionBar({
  currentStageIndex, totalStages, isLastStage,
  generating, onComplete,
}: StageCompletionBarProps) {
  return (
    <div style={{
      position: 'sticky', bottom: 0, zIndex: 10,
      background: '#fff',
      borderTop: '1px solid #f0f0f0',
      boxShadow: '0 -2px 8px rgba(0,0,0,0.06)',
      padding: '12px 24px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      {/* 左侧: 进度信息 */}
      <div>
        <Text style={{ fontSize: 13 }}>
          阶段 {currentStageIndex + 1} / {totalStages}
        </Text>
        <Text type="secondary" style={{ fontSize: 12, marginLeft: 12 }}>
          {isLastStage ? '这是最后一个阶段' : '完成本阶段后将自动生成下一阶段'}
        </Text>
      </div>

      {/* 右侧: 操作按钮 */}
      <Space>
        {!isLastStage ? (
          <Button
            type="primary"
            icon={generating ? <LoadingOutlined /> : <RocketOutlined />}
            loading={generating}
            onClick={onComplete}
            size="large"
          >
            {generating ? '正在生成下一阶段...' : '我已完成本阶段，生成下一阶段'}
          </Button>
        ) : (
          <Button
            type="primary"
            icon={<CheckOutlined />}
            onClick={onComplete}
            size="large"
            style={{ background: '#52c41a', borderColor: '#52c41a' }}
          >
            完成全部课程学习
          </Button>
        )}
      </Space>
    </div>
  )
}
