/**
 * 单选题卡片
 * 渲染 Radio.Group 选项, 提交后显示正确/错误颜色反馈
 */
import { Radio, Space } from 'antd'
import type { ExerciseQuestion } from '../../../types'

interface SingleChoiceCardProps {
  question: ExerciseQuestion
  userAnswer: number | number[] | string | undefined
  submitted: boolean
  onChange: (value: number) => void
}

export function SingleChoiceCard({ question, userAnswer, submitted, onChange }: SingleChoiceCardProps) {
  const isCorrect = (optionIndex: number) => optionIndex === question.answer

  return (
    <Radio.Group
      value={userAnswer as number}
      onChange={e => onChange(e.target.value)}
      disabled={submitted}
      style={{ width: '100%' }}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        {(question.options || []).map((opt, i) => (
          <Radio
            key={i}
            value={i}
            style={{
              padding: '8px 12px', borderRadius: 6,
              background: submitted && isCorrect(i) ? '#DCFCE7'
                : submitted && i === userAnswer && !isCorrect(i) ? '#FEE2E2'
                : '#F8FAFC',
              border: submitted && isCorrect(i) ? '1px solid #BBF7D0'
                : submitted && i === userAnswer && !isCorrect(i) ? '1px solid #FECACA'
                : '1px solid transparent',
              width: '100%',
            }}
          >
            {opt}
          </Radio>
        ))}
      </Space>
    </Radio.Group>
  )
}
