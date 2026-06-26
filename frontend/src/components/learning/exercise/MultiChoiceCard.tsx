/**
 * 多选题卡片
 * 渲染 Checkbox.Group 选项
 */
import { Checkbox, Space } from 'antd'
import type { ExerciseQuestion } from '../../../types'

interface MultiChoiceCardProps {
  question: ExerciseQuestion
  userAnswer: number | number[] | string | undefined
  submitted: boolean
  onChange: (value: number[]) => void
}

export function MultiChoiceCard({ question, userAnswer, submitted, onChange }: MultiChoiceCardProps) {
  return (
    <Checkbox.Group
      value={userAnswer as number[]}
      onChange={vals => onChange(vals as number[])}
      disabled={submitted}
      style={{ width: '100%' }}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        {(question.options || []).map((opt, i) => (
          <Checkbox key={i} value={i} style={{ padding: '8px 12px', width: '100%' }}>
            {opt}
          </Checkbox>
        ))}
      </Space>
    </Checkbox.Group>
  )
}
