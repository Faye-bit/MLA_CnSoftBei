/**
 * 练习题查看器
 * 交互式练习题: 展示题目、选择答案、查看解析
 * 支持单选/多选/判断/填空/简答题型
 * 作答进度持久化: 在提交答案、切换题目、选择选项、组件卸载时保存到后端
 *
 * 保存策略: 多重保障
 * 1. 用户选择选项时 → 保存 (保留未提交的答案)
 * 2. 用户提交答案时 → 保存
 * 3. 用户切换题目时 → 保存
 * 4. 组件卸载时 (切换资源/离开页面) → 通过 ref 保存最新状态
 */

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import {
  Card, Radio, Checkbox, Input, Button, Typography,
  Tag, Space, Progress, Empty, message,
} from 'antd'
import {
  CheckCircleOutlined, CloseCircleOutlined,
  ArrowLeftOutlined, ArrowRightOutlined,
  BulbOutlined, LoadingOutlined, StarFilled,
} from '@ant-design/icons'
import { saveExerciseProgress, scoreExerciseAnswer } from '../../services/api'
import type { ExerciseSet, ExerciseQuestion } from '../../types'

const { Text, Title, Paragraph } = Typography

interface ExerciseViewerProps {
  content: string           // JSON 格式的题库
  resourceId: string        // 资源 ID, 用于持久化进度
  resourceMetadata: Record<string, unknown>  // 资源元数据, 包含历史进度
}

export default function ExerciseViewer({ content, resourceId, resourceMetadata }: ExerciseViewerProps) {
  // ── 从 resource_metadata 中恢复历史作答进度 ──
  const saved = (resourceMetadata?.exercise_progress || {}) as {
    answers?: Record<string, number | number[] | string>
    submitted?: Record<string, boolean>
    current_index?: number
    scores?: Record<string, { score: number; feedback: string }>
  }

  const [currentIndex, setCurrentIndex] = useState(saved.current_index || 0)
  const [userAnswers, setUserAnswers] = useState<Record<string, number | number[] | string>>(
    saved.answers || {}
  )
  const [submitted, setSubmitted] = useState<Record<string, boolean>>(saved.submitted || {})
  // AI 评分状态 (仅主观题 — 填空/简答)
  const [scores, setScores] = useState<Record<string, { score: number; feedback: string }>>(
    saved.scores || {}
  )
  // 正在评分中的题目 ID 集合
  const [scoring, setScoring] = useState<Set<string>>(new Set())

  /** 组件已挂载标记 — 卸载后设为 false, 阻止卸载后的异步操作 */
  const mountedRef = useRef(true)
  /** 初始加载标记: 防止初始加载时误触发保存 */
  const initialLoadRef = useRef(true)
  /** 保存防重入锁 */
  const savingRef = useRef(false)

  /**
   * 四个 ref 始终保持与最新 state 同步
   * 用于组件卸载时获取最新值进行保存 (避免闭包过期问题)
   */
  const answersRef = useRef(userAnswers)
  const submittedRef = useRef(submitted)
  const scoresRef = useRef(scores)
  const currentIndexRef = useRef(currentIndex)
  answersRef.current = userAnswers
  submittedRef.current = submitted
  scoresRef.current = scores
  currentIndexRef.current = currentIndex

  // 标记初始加载完成
  useEffect(() => {
    // 下一个微任务标记初始加载完成, 确保 state 已从 saved 恢复
    const timer = setTimeout(() => { initialLoadRef.current = false }, 0)
    return () => {
      mountedRef.current = false
      clearTimeout(timer)
    }
  }, [])

  /**
   * 组件卸载时保存最新进度
   * 覆盖场景: 用户切换资源 / 离开学习页面 / 浏览器关闭
   * 使用 ref 获取最新 state 值, 避免闭包捕获到初始值
   */
  useEffect(() => {
    return () => {
      // 初始加载期间卸载 (如快速切换) 不保存, 避免用空数据覆盖已有进度
      if (initialLoadRef.current) return

      const latestAnswers = answersRef.current
      const latestSubmitted = submittedRef.current
      const latestIndex = currentIndexRef.current

      // 没有任何交互则跳过
      if (Object.keys(latestAnswers).length === 0 && Object.keys(latestSubmitted).length === 0) return

      // 使用 sendBeacon 风格的同步保存 — 不依赖组件生命周期
      saveExerciseProgress(resourceId, {
        answers: latestAnswers,
        submitted: latestSubmitted,
        current_index: latestIndex,
        scores: scoresRef.current,
      }).catch(err => {
        console.warn('[ExerciseViewer] 卸载保存失败:', err)
      })
    }
  }, [resourceId])

  // ── 数据解析 ──
  const exerciseSet = useMemo<ExerciseSet>(() => {
    try {
      const parsed = JSON.parse(content)
      if (parsed.questions) return parsed as ExerciseSet
      return { questions: [] }
    } catch {
      return { questions: [] }
    }
  }, [content])

  const questions = exerciseSet.questions || []
  const currentQuestion = questions[currentIndex]

  // ── 持久化辅助函数 ──
  /**
   * 执行保存操作
   * 多重守卫: 组件未挂载 / 初始加载中 / 正在保存中 均跳过
   *
   * @param answers - 当前答案映射
   * @param subm - 提交标记映射
   * @param idx - 当前题目序号
   */
  const doSave = useCallback((answers: typeof userAnswers, subm: typeof submitted, idx: number) => {
    if (!mountedRef.current) return
    if (savingRef.current) return
    if (initialLoadRef.current) return

    savingRef.current = true
    saveExerciseProgress(resourceId, {
      answers,
      submitted: subm,
      current_index: idx,
      scores: scoresRef.current,
    }).catch(err => {
      // 静默失败但输出日志便于排查
      console.error('[ExerciseViewer] 保存进度失败:', err)
    }).finally(() => {
      savingRef.current = false
    })
  }, [resourceId])

  // ── 答案判定 ──
  /** 是否为客观题 (有明确对错) */
  function isObjective(q: ExerciseQuestion): boolean {
    return q.type === 'single_choice' || q.type === 'multiple_choice' || q.type === 'true_false'
  }

  /** 判断用户答案是否正确 */
  function isAnswerCorrect(q: ExerciseQuestion, answer: number | number[] | string): boolean {
    if (q.type === 'multiple_choice') {
      const correct = (q.answer as number[]).sort()
      const user = ((answer || []) as number[]).sort()
      return JSON.stringify(correct) === JSON.stringify(user)
    }
    if (q.type === 'true_false') {
      const llmAnswer = q.answer
      const userNum = Number(answer)
      const expected = llmAnswer === true ? 0 : llmAnswer === false ? 1 : Number(llmAnswer)
      return userNum === expected
    }
    return Number(answer) === Number(q.answer)
  }

  // ── 用户操作 ──
  /** 文本输入防抖保存的 timer ref */
  const textSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 选择答案: 更新状态 + 立即保存 (用于单选/多选/判断这类点击操作) */
  function handleOptionChange(q: ExerciseQuestion, value: number | number[]) {
    const newAnswers = { ...userAnswers, [q.id]: value }
    setUserAnswers(newAnswers)
    doSave(newAnswers, submitted, currentIndex)
  }

  /** 文本输入: 更新状态 + 防抖保存 (避免每次击键都触发 API 调用) */
  function handleTextChange(q: ExerciseQuestion, value: string) {
    const newAnswers = { ...userAnswers, [q.id]: value }
    setUserAnswers(newAnswers)
    // 防抖 800ms, 用户停止输入后保存
    if (textSaveTimerRef.current) clearTimeout(textSaveTimerRef.current)
    textSaveTimerRef.current = setTimeout(() => {
      doSave(newAnswers, submitted, currentIndex)
    }, 800)
  }

  // 清理防抖 timer
  useEffect(() => {
    return () => {
      if (textSaveTimerRef.current) clearTimeout(textSaveTimerRef.current)
    }
  }, [])

  /** 提交答案: 标记为已提交 + 保存 + 主观题 AI 打分 */
  async function handleSubmit() {
    const q = currentQuestion
    if (!q) return
    const answer = userAnswers[q.id]
    if (answer === undefined) {
      message.warning('请先选择或输入你的答案')
      return
    }
    const newSubmitted = { ...submitted, [q.id]: true }
    setSubmitted(newSubmitted)
    doSave(userAnswers, newSubmitted, currentIndex)

    // 客观题 (单选/多选/判断) 已有明确对错, 无需 AI 打分
    if (isObjective(q)) return

    // 主观题 (填空/简答): 调用 AI 打分
    handleScoreSubjective(q)
  }

  /**
   * 调用后端 LLM 对主观题进行 AI 智能评分 (满分 10 分)
   * 评分结果写入 scores state 并持久化
   */
  async function handleScoreSubjective(q: ExerciseQuestion) {
    // 已评过分不再重复评
    if (scores[q.id]) return

    setScoring(prev => new Set(prev).add(q.id))
    try {
      const refAnswer = typeof q.answer === 'string'
        ? q.answer
        : JSON.stringify(q.answer)
      const userAns = (userAnswers[q.id] as string) || ''

      const result = await scoreExerciseAnswer(resourceId, {
        question_id: q.id,
        question_type: q.type,
        question_text: q.question,
        user_answer: userAns,
        reference_answer: refAnswer,
        explanation: q.explanation,
      })

      setScores(prev => {
        const updated = { ...prev, [q.id]: { score: result.score, feedback: result.feedback } }
        // 保存 scores 到进度
        saveExerciseProgress(resourceId, {
          answers: answersRef.current,
          submitted: submittedRef.current,
          current_index: currentIndexRef.current,
          scores: updated,
        }).catch(err => console.warn('[ExerciseViewer] 保存评分失败:', err))
        return updated
      })
    } catch (err) {
      console.error('[ExerciseViewer] AI 打分失败:', err)
      // 降级: 标记为已评分但无分数, 前端展示 "评分暂不可用"
      setScores(prev => {
        const updated = {
          ...prev,
          [q.id]: { score: -1, feedback: 'AI 评分暂时不可用, 请参考标准答案自行对比。' },
        }
        return updated
      })
    } finally {
      setScoring(prev => {
        const next = new Set(prev)
        next.delete(q.id)
        return next
      })
    }
  }

  /** 切换题目: 更新索引 + 保存当前进度 */
  const handleGoToQuestion = useCallback((newIndex: number) => {
    setCurrentIndex(newIndex)
    doSave(userAnswers, submitted, newIndex)
  }, [userAnswers, submitted, doSave])

  // ── 渲染辅助 ──
  if (questions.length === 0) {
    return (
      <div style={{ padding: 40 }}>
        <Empty description="练习题数据格式异常" />
      </div>
    )
  }

  function getDifficultyColor(d: string) {
    switch (d) {
      case 'easy': return 'success'
      case 'medium': return 'warning'
      case 'hard': return 'error'
      default: return 'default'
    }
  }

  function getTypeLabel(t: string) {
    switch (t) {
      case 'single_choice': return '单选'
      case 'multiple_choice': return '多选'
      case 'true_false': return '判断'
      case 'fill_blank': return '填空'
      case 'short_answer': return '简答'
      default: return t
    }
  }

  function renderOptions(q: ExerciseQuestion) {
    const submittedAnswer = submitted[q.id]
    const currentAnswer = userAnswers[q.id]

    if (q.type === 'single_choice') {
      return (
        <Radio.Group
          value={currentAnswer as number}
          onChange={e => handleOptionChange(q, e.target.value)}
          disabled={submittedAnswer}
          style={{ width: '100%' }}
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            {(q.options || []).map((opt, i) => (
              <Radio
                key={i}
                value={i}
                style={{
                  padding: '8px 12px', borderRadius: 6,
                  background: submittedAnswer && i === q.answer ? '#DCFCE7'
                    : submittedAnswer && i === currentAnswer && !isAnswerCorrect(q, i) ? '#FEE2E2'
                    : '#F8FAFC',
                  border: submittedAnswer && i === q.answer ? '1px solid #BBF7D0'
                    : submittedAnswer && i === currentAnswer && !isAnswerCorrect(q, i) ? '1px solid #FECACA'
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

    if (q.type === 'multiple_choice') {
      return (
        <Checkbox.Group
          value={currentAnswer as number[]}
          onChange={vals => handleOptionChange(q, vals as number[])}
          disabled={submittedAnswer}
          style={{ width: '100%' }}
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            {(q.options || []).map((opt, i) => (
              <Checkbox key={i} value={i} style={{ padding: '8px 12px', width: '100%' }}>
                {opt}
              </Checkbox>
            ))}
          </Space>
        </Checkbox.Group>
      )
    }

    if (q.type === 'true_false') {
      return (
        <Radio.Group
          value={currentAnswer as number}
          onChange={e => handleOptionChange(q, e.target.value)}
          disabled={submittedAnswer}
        >
          <Radio value={0} style={{ marginRight: 24 }}>正确</Radio>
          <Radio value={1}>错误</Radio>
        </Radio.Group>
      )
    }

    return (
      <Input.TextArea
        value={(currentAnswer as string) || ''}
        onChange={e => handleTextChange(q, e.target.value)}
        disabled={submittedAnswer}
        placeholder={q.type === 'fill_blank' ? '请输入答案' : '请输入你的理解...'}
        autoSize={{ minRows: 1, maxRows: 10 }}
        style={{ maxWidth: 600 }}
      />
    )
  }

  // ── 统计 ──
  const answeredCount = Object.keys(submitted).length
  const objectiveQuestions = questions.filter(q => isObjective(q))
  const correctCount = objectiveQuestions.filter(q =>
    submitted[q.id] && isAnswerCorrect(q, userAnswers[q.id])
  ).length
  const subjectiveCount = questions.length - objectiveQuestions.length

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* 顶部 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Title level={5} style={{ margin: 0 }}>练习题</Title>
        <Space>
          <Tag>{getTypeLabel(currentQuestion?.type || '')}</Tag>
          <Tag color={getDifficultyColor(currentQuestion?.difficulty || 'medium')}>
            {currentQuestion?.difficulty === 'easy' ? '基础' : currentQuestion?.difficulty === 'medium' ? '提升' : '综合'}
          </Tag>
        </Space>
      </div>

      {/* 进度条 */}
      <Progress
        percent={Math.round((answeredCount / questions.length) * 100)}
        format={() => `${answeredCount}/${questions.length}`}
        size="small"
        style={{ marginBottom: 20 }}
      />

      {/* 题目卡片 */}
      <Card style={{ borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ marginBottom: 16 }}>
          <Text strong>第 {currentIndex + 1} 题 / 共 {questions.length} 题</Text>
          <Paragraph style={{ marginTop: 8, fontSize: 15, whiteSpace: 'pre-wrap' }}>
            {currentQuestion?.question}
          </Paragraph>
        </div>

        <div style={{ marginBottom: 16 }}>
          {currentQuestion && renderOptions(currentQuestion)}
        </div>

        {currentQuestion && !submitted[currentQuestion.id] && (
          <Button type="primary" onClick={handleSubmit}>提交答案</Button>
        )}

        {/* 结果反馈 */}
        {currentQuestion && submitted[currentQuestion.id] && (
          isObjective(currentQuestion)
            ? (() => {
                const correct = isAnswerCorrect(currentQuestion, userAnswers[currentQuestion.id])
                return (
                  <div style={{
                    padding: '12px 16px', borderRadius: 8, marginTop: 12,
                    background: correct ? '#DCFCE7' : '#FEE2E2',
                    border: `1px solid ${correct ? '#BBF7D0' : '#FECACA'}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      {correct
                        ? <CheckCircleOutlined style={{ color: '#16A34A', fontSize: 16 }} />
                        : <CloseCircleOutlined style={{ color: '#DC2626', fontSize: 16 }} />
                      }
                      <Text strong style={{ color: correct ? '#16A34A' : '#DC2626' }}>
                        {correct ? '回答正确！' : '回答错误'}
                      </Text>
                    </div>
                    {currentQuestion.explanation && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <BulbOutlined style={{ color: '#D97706', marginTop: 4 }} />
                        <Text style={{ fontSize: 13 }}>{currentQuestion.explanation}</Text>
                      </div>
                    )}
                  </div>
                )
              })()
            : (() => {
                const refAnswer = typeof currentQuestion.answer === 'string'
                  ? currentQuestion.answer
                  : JSON.stringify(currentQuestion.answer)
                const currentScore = scores[currentQuestion.id]
                const isScoring = scoring.has(currentQuestion.id)

                // AI 评分展示区域
                const scoreSection = isScoring ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', background: '#FEF3C7',
                    borderRadius: 6, marginBottom: 8,
                  }}>
                    <LoadingOutlined style={{ color: '#D97706' }} />
                    <Text type="secondary" style={{ fontSize: 12 }}>AI 正在评分中...</Text>
                  </div>
                ) : currentScore ? (
                  <div style={{
                    padding: '8px 12px', borderRadius: 6, marginBottom: 8,
                    background: currentScore.score >= 8 ? '#DCFCE7'
                      : currentScore.score >= 5 ? '#FEF3C7'
                      : '#FEE2E2',
                    border: `1px solid ${currentScore.score >= 8 ? '#BBF7D0'
                      : currentScore.score >= 5 ? '#FDE68A'
                      : '#FECACA'}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {currentScore.score >= 0 ? (
                        <>
                          <StarFilled style={{
                            color: currentScore.score >= 8 ? '#16A34A'
                              : currentScore.score >= 5 ? '#D97706'
                              : '#DC2626',
                            fontSize: 18,
                          }} />
                          <Text strong style={{
                            fontSize: 16,
                            color: currentScore.score >= 8 ? '#16A34A'
                              : currentScore.score >= 5 ? '#B45309'
                              : '#DC2626',
                          }}>
                            {currentScore.score} / 10 分
                          </Text>
                        </>
                      ) : (
                        <Text type="secondary" style={{ fontSize: 13 }}>
                          {currentScore.feedback}
                        </Text>
                      )}
                    </div>
                    {currentScore.feedback && currentScore.score >= 0 && (
                      <Paragraph style={{
                        margin: '4px 0 0 0', fontSize: 12,
                        color: '#64748B', fontStyle: 'italic',
                      }}>
                        💬 {currentScore.feedback}
                      </Paragraph>
                    )}
                  </div>
                ) : null

                return (
                  <div style={{
                    padding: '12px 16px', borderRadius: 8, marginTop: 12,
                    background: '#EFF6FF', border: '1px solid #BFDBFE',
                  }}>
                    {/* AI 评分卡片 */}
                    {scoreSection}

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <CheckCircleOutlined style={{ color: '#3B82F6', fontSize: 16 }} />
                      <Text strong style={{ color: '#3B82F6' }}>已提交</Text>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <BulbOutlined style={{ color: '#3B82F6', marginTop: 4 }} />
                      <Text style={{ fontSize: 13 }}>参考答案：{refAnswer}</Text>
                    </div>
                    {currentQuestion.explanation && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <BulbOutlined style={{ color: '#D97706', marginTop: 4 }} />
                        <Text style={{ fontSize: 13 }}>{currentQuestion.explanation}</Text>
                      </div>
                    )}
                  </div>
                )
              })()
        )}
      </Card>

      {/* 底部导航 */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        marginTop: 16, paddingTop: 16, borderTop: '1px solid #E2E8F0',
      }}>
        <Button
          icon={<ArrowLeftOutlined />}
          disabled={currentIndex === 0}
          onClick={() => handleGoToQuestion(currentIndex - 1)}
        >
          上一题
        </Button>

        <Space>
          {objectiveQuestions.length > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              正确率: {correctCount}/{objectiveQuestions.length}
            </Text>
          )}
          {subjectiveCount > 0 && (
            <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
              | 已答: {answeredCount}/{questions.length}
            </Text>
          )}
        </Space>

        <Button
          icon={<ArrowRightOutlined />}
          disabled={currentIndex >= questions.length - 1}
          onClick={() => handleGoToQuestion(currentIndex + 1)}
        >
          下一题
        </Button>
      </div>
    </div>
  )
}
