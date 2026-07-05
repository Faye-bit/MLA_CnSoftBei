/**
 * 对话列表组件 (左侧边栏)
 * 显示用户的对话列表, 支持新建、切换、删除对话
 *
 * 设计规范 (MLA Brand v2.0):
 * - 使用品牌 token 替代硬编码色值
 */

import { useState } from 'react'
import { List, Button, Dropdown, Typography } from 'antd'
import {
  PlusOutlined, MessageOutlined, DeleteOutlined,
  EditOutlined, FormOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
} from '@ant-design/icons'
import type { Conversation } from '../../types'
import { blue, gray, semantic } from '../../styles/tokens'

const { Text } = Typography

interface ConversationListProps {
  conversations: Conversation[]
  activeId: string | null
  loading?: boolean
  onSelect: (conversation: Conversation) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  /** 是否折叠 (进入页面时默认折叠) */
  collapsed?: boolean
  /** 折叠切换回调 */
  onToggleCollapse?: () => void
}

export default function ConversationList({
  conversations, activeId, loading, onSelect, onNew, onDelete, onRename,
  collapsed = false, onToggleCollapse,
}: ConversationListProps) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const startRename = (conv: Conversation) => {
    setRenaming(conv.id)
    setRenameValue(conv.title)
  }

  const confirmRename = () => {
    if (renaming && renameValue.trim()) {
      onRename(renaming, renameValue.trim())
    }
    setRenaming(null)
    setRenameValue('')
  }

  // ── 折叠态：窄条 + 展开按钮 ──
  if (collapsed) {
    return (
      <div style={{
        width: 40, minWidth: 40, height: '100%',
        borderRight: `1px solid ${gray[200]}`,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', paddingTop: 12,
        background: gray[50],
      }}>
        <Button
          type="text"
          size="small"
          icon={<MenuUnfoldOutlined />}
          onClick={onToggleCollapse}
          style={{ color: gray[500] }}
          title="展开对话列表"
        />
      </div>
    )
  }

  // ── 展开态：完整侧边栏 ──
  return (
    <div style={{
      width: 260, minWidth: 260, height: '100%',
      borderRight: `1px solid ${gray[200]}`,
      display: 'flex', flexDirection: 'column',
      background: gray[50],
    }}>
      {/* 新建按钮 + 折叠 */}
      <div style={{ padding: '12px', display: 'flex', gap: 8 }}>
        <Button type="primary" icon={<PlusOutlined />} block onClick={onNew}>
          新建对话
        </Button>
        <Button
          type="text"
          size="small"
          icon={<MenuFoldOutlined />}
          onClick={onToggleCollapse}
          style={{ color: gray[500], flexShrink: 0 }}
          title="折叠对话列表"
        />
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
                padding: '10px 12px', cursor: 'pointer',
                background: conv.id === activeId ? blue[50] : 'transparent',
                borderLeft: conv.id === activeId ? `3px solid ${blue[500]}` : '3px solid transparent',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                if (conv.id !== activeId) {
                  e.currentTarget.style.background = gray[100]
                }
              }}
              onMouseLeave={(e) => {
                if (conv.id !== activeId) {
                  e.currentTarget.style.background = 'transparent'
                }
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {conv.conversation_type === 'profile_collection' ? (
                  <FormOutlined style={{ color: semantic.warning, fontSize: 14 }} />
                ) : (
                  <MessageOutlined style={{ color: blue[500], fontSize: 14 }} />
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
                        width: '100%', border: `1px solid ${blue[500]}`,
                        borderRadius: 4, padding: '2px 6px', fontSize: 13,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <Text ellipsis style={{
                      fontSize: 13,
                      fontWeight: conv.id === activeId ? 600 : 400,
                    }}>
                      {conv.title}
                    </Text>
                  )}
                </div>

                <Dropdown menu={{
                  items: [
                    { key: 'rename', icon: <EditOutlined />, label: '重命名',
                      onClick: (e) => { e.domEvent.stopPropagation(); startRename(conv) } },
                    { type: 'divider' },
                    { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true,
                      onClick: (e) => { e.domEvent.stopPropagation(); onDelete(conv.id) } },
                  ],
                }} trigger={['click']}>
                  <Button type="text" size="small" style={{ fontSize: 12 }}
                    onClick={(e) => e.stopPropagation()}>···</Button>
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
