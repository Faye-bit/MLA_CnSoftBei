/**
 * 画像维度展示卡片组件 (描述式)
 * 每个维度以自然语言描述文本展示, 支持编辑模式
 */

import { useState } from 'react'
import { Card, Tag, Button, Space, Input, Typography } from 'antd'
import { EditOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons'

const { Text } = Typography
const { TextArea } = Input

interface ProfileDimensionCardProps {
  /** 维度名称 */
  title: string
  /** 维度 key (如 academic_background) */
  dimKey: string
  /** 维度描述文本 */
  description: string
  /** 是否标记为缺失 */
  isMissing?: boolean
  /** 编辑保存回调 */
  onSave?: (dimKey: string, text: string) => void
}

/**
 * 安全获取字符串值, 兼容旧数据可能为对象的情况
 */
function safeString(val: unknown): string {
  if (typeof val === 'string') return val
  return ''
}

export default function ProfileDimensionCard({
  title,
  dimKey,
  description,
  isMissing = false,
  onSave,
}: ProfileDimensionCardProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')

  const displayText = safeString(description)
  const hasData = displayText.trim().length > 0

  /** 进入编辑模式 */
  const startEdit = () => {
    setEditValue(displayText)
    setEditing(true)
  }

  /** 保存编辑 */
  const handleSave = () => {
    onSave?.(dimKey, editValue.trim())
    setEditing(false)
  }

  return (
    <Card
      title={
        <Space>
          <span>{title}</span>
          {isMissing && <Tag color="red">信息缺失</Tag>}
          {hasData && <Tag color="green">已收集</Tag>}
        </Space>
      }
      extra={
        !editing && onSave && (
          <Button type="link" icon={<EditOutlined />} onClick={startEdit} size="small">
            编辑
          </Button>
        )
      }
      style={{
        marginBottom: 12,
        border: isMissing ? '1px dashed #ff4d4f' : undefined,
      }}
      size="small"
    >
      {editing ? (
        <div>
          <TextArea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            rows={3}
            placeholder="请输入这一维度的描述..."
            style={{ fontSize: 13 }}
          />
          <Space style={{ marginTop: 8 }}>
            <Button type="primary" size="small" icon={<SaveOutlined />} onClick={handleSave}>
              保存
            </Button>
            <Button size="small" icon={<CloseOutlined />} onClick={() => setEditing(false)}>
              取消
            </Button>
          </Space>
        </div>
      ) : hasData ? (
        <Text style={{ fontSize: 14, lineHeight: 1.8 }}>{displayText}</Text>
      ) : (
        <Text type="secondary" style={{ fontSize: 13 }}>
          暂无此维度的信息。{onSave ? '点击右上角"编辑"按钮手动填写。' : '系统将在对话中自动收集。'}
        </Text>
      )}
    </Card>
  )
}
