/**
 * 简答题卡片
 * 渲染 Input.TextArea, 提交后禁用输入
 */
import { Input } from 'antd'
import type { ExerciseQuestion } from '../../../types'

interface ShortAnswerCardProps {
  question: ExerciseQuestion
  userAnswer: number | number[] | string | undefined
  submitted: boolean
  onChange: (value: string) => void
}

export function ShortAnswerCard({ question: _q, userAnswer, submitted, onChange }: ShortAnswerCardProps) {
  return (
    <Input.TextArea
      value={(userAnswer as string) || ''}
      onChange={e => onChange(e.target.value)}
      disabled={submitted}
      placeholder="请输入你的理解..."
      autoSize={{ minRows: 1, maxRows: 10 }}
      style={{ maxWidth: 600 }}
    />
  )
}
