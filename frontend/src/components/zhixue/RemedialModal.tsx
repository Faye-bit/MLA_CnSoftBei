/**
 * AI智学 补救资源选择模态框
 * 用户选 "基本没掌握" 后弹出, 可选补救讲义和/或补救练习
 */

import { useState } from 'react'
import { Modal, Checkbox, Button, Space } from 'antd'

interface Props {
  visible: boolean
  onConfirm: (selected: ('handout' | 'exercise')[]) => void
  onSkip: () => void
}

export default function RemedialModal({ visible, onConfirm, onSkip }: Props) {
  const [selected, setSelected] = useState<('handout' | 'exercise')[]>(['handout', 'exercise'])

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>🔄</span>
          <span>需要额外资料巩固一下吗?</span>
        </div>
      }
      open={visible}
      closable={false}
      maskClosable={false}
      width={440}
      centered
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button type="link" onClick={onSkip} style={{ padding: 0 }}>
            直接继续下一阶段
          </Button>
          <Button
            type="primary"
            disabled={selected.length === 0}
            onClick={() => onConfirm(selected)}
            style={{ background: '#4A90D9', border: 'none', borderRadius: 8 }}
          >
            生成补充资料
          </Button>
        </div>
      }
    >
      <div style={{ padding: '8px 0' }}>
        <div style={{
          color: '#999', fontSize: 13, marginBottom: 16,
          background: '#fff7e6', padding: '10px 14px', borderRadius: 8,
          lineHeight: 1.6,
        }}>
          以下资源将针对本阶段的核心概念重新生成,
          内容会更基础、更详细, 帮助巩固理解。
        </div>

        <Checkbox.Group
          style={{ width: '100%' }}
          value={selected}
          onChange={vals => setSelected(vals as ('handout' | 'exercise')[])}
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            <Checkbox value="handout" style={{
              padding: '12px 14px', border: '1px solid #f0f0f0',
              borderRadius: 10, width: '100%', marginBottom: 6,
            }}>
              <div style={{ fontWeight: 500 }}>
                📝 <strong>补充讲义</strong>
              </div>
              <div style={{ fontSize: 12, color: '#999' }}>
                重新梳理核心概念, 更多通俗比喻, 更低术语密度
              </div>
            </Checkbox>

            <Checkbox value="exercise" style={{
              padding: '12px 14px', border: '1px solid #f0f0f0',
              borderRadius: 10, width: '100%', marginBottom: 6,
            }}>
              <div style={{ fontWeight: 500 }}>
                ✏️ <strong>补充练习</strong>
              </div>
              <div style={{ fontSize: 12, color: '#999' }}>
                更多基础题 (70%基础+30%提升), 强化易错点
              </div>
            </Checkbox>
          </Space>
        </Checkbox.Group>
      </div>
    </Modal>
  )
}
