/**
 * AI智学 轻量问卷模态框
 *
 * 5-8 道题, 单选/多选为主, 最多 1 道选填简答。
 * 支持跳过 ("使用已有画像, 跳过问卷")。
 */

import { useState } from 'react'
import { Modal, Radio, Checkbox, Input, Button, Space, Progress } from 'antd'
import type { ZhiXueQuestionnaire, ZhiXueQuestionAnswer } from '../../types'

const { TextArea } = Input

interface Props {
  visible: boolean
  questionnaire: ZhiXueQuestionnaire | null
  onSubmit: (answers: ZhiXueQuestionAnswer[]) => void
  onSkip: () => void
  onCancel?: () => void
}

export default function QuestionnaireModal({
  visible, questionnaire, onSubmit, onSkip, onCancel,
}: Props) {
  const [answers, setAnswers] = useState<Record<string, ZhiXueQuestionAnswer>>({})
  const [currentStep, setCurrentStep] = useState(0)

  if (!questionnaire) return null

  const questions = questionnaire.questions
  const totalQuestions = questions.length
  const progress = totalQuestions > 0
    ? Math.round(((currentStep + 1) / totalQuestions) * 100)
    : 0

  // 当前题目
  const question = questions[currentStep]
  if (!question) return null

  const currentAnswer = answers[question.question_id]
    || {
        question_id: question.question_id,
        selected_options: [],
        open_text: '',
      }

  const handleNext = () => {
    if (currentStep < totalQuestions - 1) {
      setCurrentStep(prev => prev + 1)
    } else {
      // 最后一步: 提交
      const allAnswers = questions.map(q =>
        answers[q.question_id] || {
          question_id: q.question_id,
          selected_options: [],
          open_text: '',
        },
      )
      onSubmit(allAnswers)
    }
  }

  const handlePrev = () => {
    if (currentStep > 0) setCurrentStep(prev => prev - 1)
  }

  const updateAnswer = (updates: Partial<ZhiXueQuestionAnswer>) => {
    setAnswers(prev => ({
      ...prev,
      [question.question_id]: { ...currentAnswer, ...updates },
    }))
  }

  const isLastStep = currentStep === totalQuestions - 1
  const canProceed = question.required
    ? ((question.question_type === 'open_ended' || question.question_type === 'short_answer')
        ? (currentAnswer.open_text || '').trim().length > 0
        : currentAnswer.selected_options.length > 0)
    : true

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>📋</span>
          <span>{questionnaire.title}</span>
        </div>
      }
      open={visible}
      closable={false}
      maskClosable={false}
      width={560}
      centered
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space size={12}>
            <Button type="link" onClick={onSkip} style={{ padding: 0 }}>
              使用已有画像, 跳过问卷
            </Button>
            {onCancel && (
              <Button type="link" danger onClick={onCancel} style={{ padding: 0 }}>
                取消
              </Button>
            )}
          </Space>
          <Space>
            {currentStep > 0 && (
              <Button onClick={handlePrev}>上一题</Button>
            )}
            <Button
              type="primary"
              onClick={handleNext}
              disabled={!canProceed}
              style={{
                background: '#4A90D9',
                border: 'none',
                borderRadius: 8,
              }}
            >
              {isLastStep ? '提交' : '下一题'}
            </Button>
          </Space>
        </div>
      }
    >
      <div style={{ padding: '12px 0' }}>
        {/* 进度条 */}
        <div style={{ marginBottom: 20 }}>
          <Progress
            percent={progress}
            showInfo={false}
            strokeColor="#4A90D9"
            size="small"
          />
          <div style={{
            textAlign: 'center', color: '#999', fontSize: 12, marginTop: 4,
          }}>
            {currentStep + 1} / {totalQuestions}
          </div>
        </div>

        {/* 题目描述 */}
        {question.description && (
          <div style={{
            color: '#999', fontSize: 12, marginBottom: 12,
            background: '#f5f5f5', padding: '6px 10px', borderRadius: 6,
          }}>
            {question.description}
          </div>
        )}

        {/* 题目 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 15, fontWeight: 500, color: '#333', marginBottom: 16,
          }}>
            {currentStep + 1}. {question.text}
            {!question.required && (
              <span style={{ color: '#999', fontSize: 12, marginLeft: 6 }}>
                (选填)
              </span>
            )}
          </div>

          {/* 单选题 */}
          {question.question_type === 'single_choice' && (
            <Radio.Group
              value={currentAnswer.selected_options[0]}
              onChange={e => updateAnswer({ selected_options: [e.target.value] })}
              style={{ width: '100%' }}
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                {question.options.map((opt, idx) => (
                  <Radio key={idx} value={opt} style={{
                    padding: '10px 14px',
                    border: '1px solid #f0f0f0',
                    borderRadius: 8,
                    width: '100%',
                    marginBottom: 4,
                  }}>
                    {opt}
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          )}

          {/* 多选题 */}
          {(question.question_type === 'multi_choice' || question.question_type === 'multiple_choice') && (
            <Checkbox.Group
              value={currentAnswer.selected_options}
              onChange={vals => updateAnswer({ selected_options: vals as string[] })}
              style={{ width: '100%' }}
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                {question.options.map((opt, idx) => (
                  <Checkbox key={idx} value={opt} style={{
                    padding: '10px 14px',
                    border: '1px solid #f0f0f0',
                    borderRadius: 8,
                    width: '100%',
                    marginBottom: 4,
                  }}>
                    {opt}
                  </Checkbox>
                ))}
              </Space>
            </Checkbox.Group>
          )}

          {/* 简答题 */}
          {(question.question_type === 'open_ended' || question.question_type === 'short_answer') && (
            <TextArea
              value={currentAnswer.open_text}
              onChange={e => updateAnswer({ open_text: e.target.value })}
              placeholder="输入你的回答 (可选)..."
              rows={3}
              maxLength={200}
              showCount
            />
          )}
        </div>
      </div>
    </Modal>
  )
}
