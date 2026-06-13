/**
 * 对话列表组件 (左侧边栏)
 * 显示用户的对话列表, 支持新建、切换、删除对话
 */

import { useState } from 'react'
import { List, Button, Dropdown, Typography } from 'antd'
import {
  PlusOutlined,
  MessageOutlined,
  DeleteOutlined,
  EditOutlined,
  FormOutlined,
} from '@ant-design/icons'
import type { Conversation } from '../../types'

const { Text } = Typography

interface ConversationListProps {
  /** 对话列表数据 */
  conversations: Conversation[]
  /** 当前选中的对话 ID */
  activeId: string | null
  /** 是否加载中 */
  loading?: boolean
  /** 选中对话回调 */
  onSelect: (conversation: Conversation) => void
  /** 新建对话回调 */
  onNew: () => void
  /** 删除对话回调 */
  onDelete: (id: string) => void
  /** 重命名对话回调 */
  onRename: (id: string, title: string) => void
}

export default function ConversationList({
  conversations,
  activeId,
  loading,
  onSelect,
  onNew,
  onDelete,
  onRename,
}: ConversationListProps) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  /** 开始重命名 */
  const startRename = (conv: Conversation) => {
    setRenaming(conv.id)
    setRenameValue(conv.title)
  }

  /** 确认重命名 */
  const confirmRename = () => {
    if (renaming && renameValue.trim()) {
      onRename(renaming, renameValue.trim())
    }
    setRenaming(null)
    setRenameValue('')
  }

  return (
    <div
      style={{
        width: 260,
        minWidth: 260,
        height: '100%',
        borderRight: '1px solid #f0f0f0',
        display: 'flex',
        flexDirection: 'column',
        background: '#fafafa',
      }}
    >
      {/* 新建按钮 */}
      <div style={{ padding: '12px' }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          block
          onClick={onNew}
        >
          新建对话
        </Button>
      </div>

      {/* 对话列表 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <List
          loading={loading}
          dataSource={conversations}
          locale={{ emptyText: '暂无对话' }}
          renderItem={(conv) => (
            <div
              key={conv.id}
              onClick={() => onSelect(conv)}
              style={{
                padding: '10px 12px',
                cursor: 'pointer',
                background: conv.id === activeId ? '#e6f4ff' : 'transparent',
                borderLeft: conv.id === activeId ? '3px solid #1677ff' : '3px solid transparent',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                if (conv.id !== activeId) {
                  (e.target as HTMLElement).style.background = '#f0f0f0'
                }
              }}
              onMouseLeave={(e) => {
                if (conv.id !== activeId) {
                  (e.target as HTMLElement).style.background = 'transparent'
                }
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {conv.conversation_type === 'profile_collection' ? (
                  <FormOutlined style={{ color: '#faad14', fontSize: 14 }} />
                ) : (
                  <MessageOutlined style={{ color: '#1677ff', fontSize: 14 }} />
                )}

                <div style={{ flex: 1, minWidth: 0 }}>
                  {renaming === conv.id ? (
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={confirmRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') confirmRename()
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                      autoFocus
                      style={{
                        width: '100%',
                        border: '1px solid #1677ff',
                        borderRadius: 4,
                        padding: '2px 6px',
                        fontSize: 13,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <Text
                      ellipsis
                      style={{
                        fontSize: 13,
                        fontWeight: conv.id === activeId ? 600 : 400,
                      }}
                    >
                      {conv.title}
                    </Text>
                  )}
                </div>

                {/* 操作菜单 */}
                <Dropdown
                  menu={{
                    items: [
                      {
                        key: 'rename',
                        icon: <EditOutlined />,
                        label: '重命名',
                        onClick: (e) => {
                          e.domEvent.stopPropagation()
                          startRename(conv)
                        },
                      },
                      { type: 'divider' },
                      {
                        key: 'delete',
                        icon: <DeleteOutlined />,
                        label: '删除',
                        danger: true,
                        onClick: (e) => {
                          e.domEvent.stopPropagation()
                          onDelete(conv.id)
                        },
                      },
                    ],
                  }}
                  trigger={['click']}
                >
                  <Button
                    type="text"
                    size="small"
                    style={{ fontSize: 12 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    ···
                  </Button>
                </Dropdown>
              </div>

              <div style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {conv.message_count > 0 ? `${conv.message_count} 条消息` : '新对话'}
                  {conv.conversation_type === 'profile_collection' && ' · 画像收集'}
                </Text>
              </div>
            </div>
          )}
        />
      </div>
    </div>
  )
}
