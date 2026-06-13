/**
 * 单条聊天消息气泡组件
 * 根据角色 (user/assistant) 显示不同样式的消息气泡
 * AI 消息支持 Markdown 渲染和知识库来源引用展示
 */

import { Avatar, Tag, Space, Typography } from 'antd'
import { UserOutlined, RobotOutlined, FileTextOutlined, FileImageOutlined } from '@ant-design/icons'
import MarkdownRenderer from '../common/MarkdownRenderer'
import type { ChatSource } from '../../types'

const { Text } = Typography

interface ChatMessageProps {
  /** 消息角色 */
  role: 'user' | 'assistant' | 'system'
  /** 消息内容 (支持 Markdown) */
  content: string
  /** 知识库引用来源列表 (仅 AI 消息) */
  sources?: ChatSource[] | null
  /** 消息创建时间 */
  createdAt?: string | null
}

export default function ChatMessage({ role, content, sources, createdAt }: ChatMessageProps) {
  // 系统消息不显示
  if (role === 'system') return null

  const isUser = role === 'user'

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        alignItems: 'flex-start',
        gap: 12,
        marginBottom: 20,
        padding: '0 4px',
      }}
    >
      {/* 头像 */}
      <Avatar
        icon={isUser ? <UserOutlined /> : <RobotOutlined />}
        style={{
          backgroundColor: isUser ? '#1677ff' : '#52c41a',
          flexShrink: 0,
        }}
        size={36}
      />

      {/* 消息主体 */}
      <div
        style={{
          maxWidth: '75%',
          minWidth: 60,
        }}
      >
        {/* 消息气泡 */}
        <div
          style={{
            background: isUser ? '#1677ff' : '#f5f5f5',
            color: isUser ? '#fff' : '#333',
            padding: '12px 16px',
            borderRadius: isUser ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
            lineHeight: 1.7,
            wordBreak: 'break-word',
          }}
        >
          {isUser ? (
            <div style={{ whiteSpace: 'pre-wrap' }}>{content}</div>
          ) : (
            <MarkdownRenderer content={content} />
          )}
        </div>

        {/* 知识库来源引用 (仅 AI 消息, 且有来源时显示) */}
        {!isUser && sources && sources.length > 0 && (
          <div
            style={{
              marginTop: 8,
              padding: '8px 12px',
              background: '#fafafa',
              borderRadius: 8,
              border: '1px solid #f0f0f0',
            }}
          >
            <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
              📚 参考来源:
            </Text>
            <Space wrap size={[4, 4]}>
              {sources.map((source, idx) => {
                const isPage = source.result_type === 'page'
                const label = isPage
                  ? `[${idx+1}] ${source.document_filename} 第${source.page_number}页`
                  : `[${idx+1}] ${source.document_filename} #${source.chunk_index}`
                const tooltip = isPage
                  ? `${source.document_filename} - 第${source.page_number}页\n${source.content.slice(0, 100)}...`
                  : `${source.document_filename} - 切片#${source.chunk_index}\n${source.content.slice(0, 100)}...`
                return (
                  <Tag
                    key={source.chunk_id}
                    icon={isPage ? <FileImageOutlined /> : <FileTextOutlined />}
                    color={isPage ? 'purple' : 'blue'}
                    style={{ cursor: 'pointer', fontSize: 12 }}
                    title={tooltip}
                  >
                    {label}
                  </Tag>
                )
              })}
            </Space>
          </div>
        )}

        {/* 时间戳 */}
        {createdAt && (
          <div
            style={{
              textAlign: isUser ? 'right' : 'left',
              marginTop: 4,
              padding: '0 4px',
            }}
          >
            <Text type="secondary" style={{ fontSize: 11 }}>
              {new Date(createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </div>
        )}
      </div>
    </div>
  )
}
