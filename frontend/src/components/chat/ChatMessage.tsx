/**
 * 单条聊天消息气泡组件
 * 根据角色 (user/assistant) 显示不同样式的消息气泡
 * AI 消息支持 Markdown 渲染和知识库来源引用展示
 * Phase 4: 流式输出时尾部追加闪烁光标
 *
 * @see branding/MLA_BRAND_GUIDELINES.md
 */

import { Avatar, Tag, Space, Typography } from 'antd'
import { UserOutlined, RobotOutlined, FileTextOutlined, FileImageOutlined, LinkOutlined } from '@ant-design/icons'
import MarkdownRenderer from '../common/MarkdownRenderer'
import type { ChatSource } from '../../types'
import { blue, gray, semantic } from '../../styles/tokens'

const { Text } = Typography

interface ChatMessageProps {
  role: 'user' | 'assistant' | 'system'
  content: string
  sources?: ChatSource[] | null
  createdAt?: string | null
  /** 是否正在流式输出 — 尾部追加闪烁光标 */
  streaming?: boolean
}

export default function ChatMessage({ role, content, sources, createdAt, streaming = false }: ChatMessageProps) {
  if (role === 'system') return null

  const isUser = role === 'user'

  return (
    <div style={{
      display: 'flex',
      flexDirection: isUser ? 'row-reverse' : 'row',
      alignItems: 'flex-start', gap: 12,
      marginBottom: 20, padding: '0 4px',
      animation: 'msgFadeIn 0.3s ease-out',
    }}>
      {/* 头像 */}
      <Avatar
        icon={isUser ? <UserOutlined /> : <RobotOutlined />}
        style={{
          backgroundColor: isUser ? blue[500] : semantic.success,
          flexShrink: 0,
        }}
        size={36}
      />

      {/* 消息主体 */}
      <div style={{ maxWidth: '75%', minWidth: 60 }}>
        {/* 消息气泡 */}
        <div style={{
          background: isUser ? blue[500] : gray[50],
          color: isUser ? '#FFFFFF' : gray[800],
          padding: '12px 16px',
          borderRadius: isUser ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
          lineHeight: 1.7, wordBreak: 'break-word',
          position: 'relative',
        }}>
          {isUser ? (
            <div style={{ whiteSpace: 'pre-wrap' }}>{content}</div>
          ) : (
            <span>
              <MarkdownRenderer content={content} compact />
              {/* 流式输出闪烁光标 */}
              {streaming && (
                <span
                  className="typing-cursor"
                  style={{
                    display: 'inline-block',
                    width: 2,
                    height: 16,
                    background: blue[500],
                    marginLeft: 1,
                    verticalAlign: 'text-bottom',
                    borderRadius: 1,
                  }}
                />
              )}
            </span>
          )}
        </div>

        {/* 知识库来源引用 */}
        {!isUser && !streaming && sources && sources.length > 0 && (
          <div style={{
            marginTop: 8, padding: '8px 12px',
            background: gray[50], borderRadius: 8,
            border: `1px solid ${gray[200]}`,
          }}>
            <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
              <LinkOutlined /> 参考来源:
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
                  <Tag key={source.chunk_id}
                    icon={isPage ? <FileImageOutlined /> : <FileTextOutlined />}
                    color={isPage ? 'purple' : 'blue'}
                    style={{ cursor: 'pointer', fontSize: 12 }} title={tooltip}>
                    {label}
                  </Tag>
                )
              })}
            </Space>
          </div>
        )}

        {/* 时间戳 */}
        {createdAt && (
          <div style={{ textAlign: isUser ? 'right' : 'left', marginTop: 4, padding: '0 4px' }}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {new Date(createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </div>
        )}
      </div>

      {/* 动画注入 */}
      <style>{`
        @keyframes msgFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes blinkCursor {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0; }
        }
        .typing-cursor {
          animation: blinkCursor 0.8s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}
