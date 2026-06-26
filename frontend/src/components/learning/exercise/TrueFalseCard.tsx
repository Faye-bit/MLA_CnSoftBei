/**
 * 判断题卡片
 * 渲染 正确/错误 两个选项
 */
import { Radio } from 'antd'
import type { ExerciseQuestion } from '../../../types'

interface TrueFalseCardProps {
  question: ExerciseQuestion
  userAnswer: number | number[] | string | undefined
  submitted: boolean
  onChange: (value: number) => void
}

export function TrueFalseCard({ question: _q, userAnswer, submitted, onChange }: TrueFalseCardProps) {
  return (
    <Radio.Group
      value={userAnswer as number}
      onChange={e => onChange(e.target.value)}
      disabled={submitted}
    >
      <Radio value={0} style={{ marginRight: 24 }}>正确</Radio>
      <Radio value={1}>错误</Radio>
    </Radio.Group>
  )
}
