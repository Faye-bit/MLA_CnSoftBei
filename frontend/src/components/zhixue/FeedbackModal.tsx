/**
 * AI智学 阶段反馈模态框
 * 用户学完一个阶段后弹出, 选填掌握程度。
 *
 * "已掌握" → 下一阶段
 * "部分掌握" → 下一阶段
 * "基本没掌握" → 弹出补救选项 (RemedialModal)
 */

import { Modal, Radio, Space, Button } from 'antd'

interface Props {
  visible: boolean
  stageTitle: string
  onSubmit: (mastery: string) => void
  onDismiss?: () => void
}

export default function FeedbackModal({ visible, stageTitle, onSubmit, onDismiss }: Props) {
  const handleSelect = (mastery: string) => {
    onSubmit(mastery)
  }

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>📊</span>
          <span>阶段学习反馈</span>
        </div>
      }
      open={visible}
      closable={false}
      maskClosable={false}
      footer={
        onDismiss ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="link" onClick={onDismiss}>稍后再说</Button>
          </div>
        ) : null
      }
      width={460}
      centered
    >
      <div style={{ padding: '12px 0' }}>
        <div style={{
          color: '#333', fontSize: 14, marginBottom: 20,
          background: '#f0f7ff', padding: '10px 14px', borderRadius: 8,
        }}>
          你刚完成了「<strong>{stageTitle}</strong>」的学习, 感觉掌握得怎么样?
        </div>

        <div style={{ marginBottom: 8 }}>
          <Radio.Group
            style={{ width: '100%' }}
            onChange={e => handleSelect(e.target.value)}
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              <Radio value="mastered" style={{
                padding: '12px 16px', border: '1px solid #f0f0f0',
                borderRadius: 10, width: '100%', marginBottom: 6,
              }}>
                <div style={{ fontWeight: 500 }}>✅ 已掌握</div>
                <div style={{ fontSize: 12, color: '#999' }}>
                  基本理解了本阶段内容, 可以继续下一阶段
                </div>
              </Radio>

              <Radio value="partially_mastered" style={{
                padding: '12px 16px', border: '1px solid #f0f0f0',
                borderRadius: 10, width: '100%', marginBottom: 6,
              }}>
                <div style={{ fontWeight: 500 }}>📖 部分掌握</div>
                <div style={{ fontSize: 12, color: '#999' }}>
                  理解了大半, 但有些地方还不太清楚
                </div>
              </Radio>

              <Radio value="not_mastered" style={{
                padding: '12px 16px', border: '1px solid #f0f0f0',
                borderRadius: 10, width: '100%', marginBottom: 6,
              }}>
                <div style={{ fontWeight: 500 }}>🤔 基本没掌握</div>
                <div style={{ fontSize: 12, color: '#999' }}>
                  需要额外帮助? 关闭后可点击"生成补救资源"按钮, 描述你的困惑获取针对性辅导
                </div>
              </Radio>
            </Space>
          </Radio.Group>
        </div>
      </div>
    </Modal>
  )
}
