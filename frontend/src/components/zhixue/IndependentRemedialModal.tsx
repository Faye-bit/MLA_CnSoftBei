/**
 * AI智学 独立补救资源弹窗
 *
 * 替代旧的 RemedialModal (与阶段反馈耦合的补救选择)。
 * 用户通过独立的"生成补救资源"按钮触发, 用自然语言描述困惑,
 * 选择需要的资源类型, 由解惑师霍然分析后协调六匠生成个性化补救资源。
 */

import { useState } from 'react'
import { Modal, Checkbox, Button, Space, Input } from 'antd'

/** 全部六种资源类型选项 */
const RESOURCE_OPTIONS: { value: string; label: string; icon: string; desc: string }[] = [
  { value: 'handout', label: '补充讲义', icon: '📝', desc: '重新梳理核心概念, 更多通俗比喻, 更低术语密度' },
  { value: 'exercise', label: '补充练习', icon: '✏️', desc: '更多基础题 (70%基础+30%提升), 强化易错点' },
  { value: 'mindmap', label: '思维导图', icon: '🧠', desc: '梳理概念关系, 可视化知识结构' },
  { value: 'reading', label: '拓展阅读', icon: '📚', desc: '推荐入门级阅读材料, 辅助理解' },
  { value: 'animation', label: '交互动画', icon: '🎬', desc: '动态可视化演示, 直观理解抽象概念' },
  { value: 'code', label: '代码实操', icon: '💻', desc: '基础代码练习, 从简单示例开始' },
]

interface Props {
  visible: boolean
  stageTitle: string
  stageIndex: number
  onConfirm: (confusionText: string, resourceTypes: string[]) => void
  onCancel: () => void
}

export default function IndependentRemedialModal({
  visible,
  stageTitle,
  stageIndex,
  onConfirm,
  onCancel,
}: Props) {
  const [confusionText, setConfusionText] = useState('')
  const [selectedTypes, setSelectedTypes] = useState<string[]>(['handout', 'exercise'])
  const [submitting, setSubmitting] = useState(false)

  /** 提交: 校验后回调父组件 */
  const handleSubmit = () => {
    const trimmed = confusionText.trim()
    if (trimmed.length < 10 || selectedTypes.length === 0) return
    setSubmitting(true)
    onConfirm(trimmed, selectedTypes)
    // Reset for next open
    setConfusionText('')
    setSelectedTypes(['handout', 'exercise'])
    setSubmitting(false)
  }

  /** 取消 */
  const handleCancel = () => {
    setConfusionText('')
    setSelectedTypes(['handout', 'exercise'])
    onCancel()
  }

  const canSubmit = confusionText.trim().length >= 10 && selectedTypes.length > 0
  const charCount = confusionText.trim().length

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>💡</span>
          <span>需要解惑吗?</span>
        </div>
      }
      open={visible}
      closable={false}
      maskClosable={false}
      width={520}
      centered
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button onClick={handleCancel}>取消</Button>
          <Button
            type="primary"
            disabled={!canSubmit}
            loading={submitting}
            onClick={handleSubmit}
            style={{ background: '#4A90D9', border: 'none', borderRadius: 8 }}
          >
            生成补救资源
          </Button>
        </div>
      }
    >
      <div style={{ padding: '4px 0' }}>
        {/* 当前阶段提示 */}
        <div style={{
          color: '#333', fontSize: 13, marginBottom: 16,
          background: '#f0f7ff', padding: '10px 14px', borderRadius: 8,
          lineHeight: 1.6,
        }}>
          当前阶段: <strong>{stageTitle}</strong> (阶段 {stageIndex + 1})
        </div>

        {/* 困惑描述文本输入 */}
        <div style={{ marginBottom: 20 }}>
          <div style={{
            fontWeight: 600, fontSize: 14, marginBottom: 8,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>请描述你不懂的地方</span>
            <span style={{
              fontSize: 12, fontWeight: 400,
              color: charCount < 10 ? '#999' : '#52c41a',
            }}>
              {charCount}/2000
            </span>
          </div>
          <Input.TextArea
            value={confusionText}
            onChange={e => setConfusionText(e.target.value)}
            placeholder={
              '例如: 我对"虚拟内存的页表机制"不太理解, 课本上说多级页表可以节省内存, 但我不太明白为什么能节省...\n\n请尽量详细描述你的困惑, 这样解惑师才能更精准地帮助你。'
            }
            autoSize={{ minRows: 4, maxRows: 8 }}
            maxLength={2000}
            showCount={false}
            style={{ borderRadius: 8, fontSize: 13 }}
          />
          {charCount > 0 && charCount < 10 && (
            <div style={{ fontSize: 12, color: '#ff4d4f', marginTop: 4 }}>
              至少需要 10 个字符来描述你的困惑
            </div>
          )}
        </div>

        {/* 资源类型选择 */}
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
            选择需要的补救资源类型
          </div>
          <div style={{
            color: '#999', fontSize: 12, marginBottom: 12,
            background: '#fff7e6', padding: '8px 12px', borderRadius: 6,
            lineHeight: 1.5,
          }}>
            解惑师霍然会根据你的困惑描述, 为每种资源制定个性化的生成指令
          </div>

          <Checkbox.Group
            style={{ width: '100%' }}
            value={selectedTypes}
            onChange={vals => setSelectedTypes(vals as string[])}
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              {RESOURCE_OPTIONS.map(opt => (
                <Checkbox
                  key={opt.value}
                  value={opt.value}
                  style={{
                    padding: '10px 14px',
                    border: '1px solid #f0f0f0',
                    borderRadius: 10,
                    width: '100%',
                    marginBottom: 4,
                  }}
                >
                  <div style={{ fontWeight: 500 }}>
                    {opt.icon} <strong>{opt.label}</strong>
                  </div>
                  <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                    {opt.desc}
                  </div>
                </Checkbox>
              ))}
            </Space>
          </Checkbox.Group>
        </div>
      </div>
    </Modal>
  )
}
