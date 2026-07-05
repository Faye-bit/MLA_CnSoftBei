/**
 * 单条聊天消息气泡组件
 * 根据角色 (user/assistant) 显示不同样式的消息气泡
 * AI 消息支持 Markdown 渲染和知识库来源引用展示
 * Phase 4: 流式输出时尾部追加闪烁光标
 *
 * @see branding/MLA_BRAND_GUIDELINES.md
 */

import { Avatar, Tag, Space, Typography } from 'antd'
import { FileTextOutlined, FileImageOutlined, LinkOutlined, GlobalOutlined } from '@ant-design/icons'
import MarkdownRenderer from '../common/MarkdownRenderer'
import SpeakButton from '../common/SpeakButton'
import { getAvatarUrl } from '../../services/api'
import { useAuthStore } from '../../store'
import type { ChatSource, WebLink } from '../../types'
import { blue, gray, semantic } from '../../styles/tokens'

const { Text } = Typography

interface ChatMessageProps {
  role: 'user' | 'assistant' | 'system'
  content: string
  sources?: ChatSource[] | null
  createdAt?: string | null
  /** 是否正在流式输出 — 尾部追加闪烁光标 */
  streaming?: boolean
  /** 联网搜索结果链接列表 */
  webLinks?: WebLink[]
}

/** 去除 AI 回复中的内联参考来源和联网搜索标记 */
function stripInlineReferences(content: string): string {
  return content
    .replace(/\n*参考来源[:：].*$/s, '')
    .replace(/\n*\*参考来源\*[:：].*$/s, '')
    .replace(/\[网\d+\]/g, '')   // 去除联网搜索引用标记 [网1] [网2] 等
    .trim()
}

/** 用户头像 (取自个人中心上传的头像) */
function UserAvatar() {
  const user = useAuthStore(s => s.user)
  const avatarUrl = getAvatarUrl(user?.avatar)
  if (avatarUrl) {
    return <Avatar src={avatarUrl} style={{ flexShrink: 0 }} size={36} />
  }
  return <Avatar style={{ backgroundColor: blue[500], flexShrink: 0 }} size={36}>{user?.nickname?.[0] || user?.username?.[0] || 'U'}</Avatar>
}

export default function ChatMessage({ role, content, sources, createdAt, streaming = false, webLinks }: ChatMessageProps) {
  if (role === 'system') return null

  const isUser = role === 'user'

  /** AI 回复: 去除末尾内联参考来源, 保留纯文本供朗读 */
  const displayContent = !isUser ? stripInlineReferences(content) : content

  return (
    <div style={{
      display: 'flex',
      flexDirection: isUser ? 'row-reverse' : 'row',
      alignItems: 'flex-start', gap: 12,
      marginBottom: 20, padding: '0 4px',
      animation: 'msgFadeIn 0.3s ease-out',
    }}>
      {/* 头像 */}
      {isUser ? (
        <UserAvatar />
      ) : (
        <Avatar
          src="/brand/Agent形象.svg"
          style={{ backgroundColor: 'transparent', flexShrink: 0 }}
          size={36}
        />
      )}

      {/* 消息主体 */}
      <div style={{ maxWidth: '75%', minWidth: 60 }}>
        {/* 消息气泡 */}
        <div style={{
          background: isUser ? blue[500] : gray[50],
          color: isUser ? '#FFFFFF' : gray[800],
          padding: isUser ? '12px 16px' : '12px 16px 34px 16px',
          borderRadius: isUser ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
          lineHeight: 1.7, wordBreak: 'break-word',
          position: 'relative',
        }}>
          {isUser ? (
            <div style={{ whiteSpace: 'pre-wrap' }}>{content}</div>
          ) : (
            <span>
              <MarkdownRenderer content={displayContent} compact />
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

          {/* 朗读按钮 — 气泡右下角 */}
          {!isUser && !streaming && content && (
            <div style={{ position: 'absolute', right: 8, bottom: 6 }}>
              <SpeakButton text={displayContent} size="small" />
            </div>
          )}
        </div>

        {/* 知识库来源引用 (Tag 标签区) */}
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

        {/* 联网搜索结果链接卡片 */}
        {!isUser && !streaming && webLinks && webLinks.length > 0 && (
          <WebLinksSection links={webLinks} />
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

// ============================================================================
// 联网搜索结果链接卡片组件
// ============================================================================

/** 平台名称对应的品牌色 (用于左侧色条) */
const PLATFORM_COLORS: Record<string, string> = {
  '知乎': '#0066FF',
  '知乎专栏': '#0066FF',
  'B站': '#FB7299',
  '小红书': '#FF2442',
  'CSDN': '#FC5531',
  '掘金': '#1E80FF',
  '思否': '#009A61',
  '简书': '#EC7259',
  '博客园': '#336699',
  '微信公众号': '#07C160',
  'GitHub': '#24292E',
  '码云': '#C71D23',
  'Stack Overflow': '#F48225',
  'MDN': '#000000',
  '维基百科': '#54595D',
  'Medium': '#000000',
}

/** 优先展示的知名平台链接 */
const KNOWN_PLATFORMS = new Set([
  '知乎', '知乎专栏', 'B站', '小红书', 'CSDN', '掘金',
  'GitHub', '码云', 'Stack Overflow', '博客园', '简书',
])

function WebLinksSection({ links }: { links: WebLink[] }) {
  /** 优先选取知名平台的链接，最多 3 条 */
  const prioritized = links
    .filter(l => KNOWN_PLATFORMS.has(l.source_platform))
    .concat(links.filter(l => !KNOWN_PLATFORMS.has(l.source_platform)))
    .slice(0, 3)

  return (
    <div style={{
      marginTop: 8, padding: '10px 12px',
      background: '#FFFDF5', borderRadius: 8,
      border: `1px solid #FDE68A`,
    }}>
      <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>
        <GlobalOutlined /> 联网搜索发现:
      </Text>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {prioritized.map((link, idx) => {
          const platformColor = PLATFORM_COLORS[link.source_platform] || gray[500]
          return (
            <a
              key={idx}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', gap: 10,
                padding: '8px 10px',
                background: '#FFFFFF',
                borderRadius: 8,
                border: `1px solid ${gray[200]}`,
                textDecoration: 'none',
                transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = blue[400]
                e.currentTarget.style.boxShadow = '0 1px 6px rgba(59,130,246,0.1)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = gray[200]
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              {/* 左侧平台色条 */}
              <div style={{
                width: 3, minWidth: 3,
                borderRadius: 2,
                background: platformColor,
              }} />
              {/* 链接内容 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 600,
                  color: gray[800], lineHeight: 1.4,
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {link.title}
                </div>
                {link.description && (
                  <div style={{
                    fontSize: 12, color: gray[500],
                    lineHeight: 1.5, marginTop: 2,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}>
                    {link.description}
                  </div>
                )}
              </div>
              {/* 右侧平台标签 */}
              <Tag
                color={platformColor}
                style={{
                  margin: 0, fontSize: 11,
                  flexShrink: 0, alignSelf: 'flex-start',
                }}
              >
                {link.source_platform}
              </Tag>
            </a>
          )
        })}
      </div>
    </div>
  )
}
