/**
 * Markdown 渲染组件
 * 封装 react-markdown, 支持 GFM 表格、代码高亮、数学公式等
 * 用于 AI 消息和资源内容的统一渲染
 */

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'

/**
 * mla-resource:// 协议前缀
 * 后端链接注入使用此协议前缀, 前端统一拦截并通过 onNavigateToResource 回调处理
 */
const MLA_RESOURCE_PROTOCOL = 'mla-resource://'

interface MarkdownRendererProps {
  /** Markdown 文本内容 */
  content: string
  /** 是否在紧凑模式下渲染 (减少间距) */
  compact?: boolean
  /**
   * 资源导航回调: 当用户点击 mla-resource:// 协议链接时触发
   * 参数为资源 ID (不含协议前缀)
   * 如果不提供此回调, mla-resource:// 链接将无操作 (降级兜底)
   */
  onNavigateToResource?: (resourceId: string) => void
}

export default function MarkdownRenderer({
  content, compact = false, onNavigateToResource,
}: MarkdownRendererProps) {
  return (
    <div
      className={`markdown-body ${compact ? 'markdown-compact' : ''}`}
      style={{
        lineHeight: 1.7,
        wordBreak: 'break-word',
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
        /**
         * react-markdown 默认会过滤非标准协议的 URL (如 mla-resource://)
         * urlTransform 允许我们在过滤前保留自定义协议链接
         */
        urlTransform={(url) => {
          if (url.startsWith(MLA_RESOURCE_PROTOCOL)) {
            return url  // 保留自定义协议, 不被清空
          }
          return url
        }}
        components={{
          // 代码块: 支持语法高亮
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            const isInline = !match
            if (isInline) {
              return (
                <code
                  style={{
                    background: '#f5f5f5',
                    padding: '2px 6px',
                    borderRadius: 4,
                    fontSize: '0.9em',
                    fontFamily: 'monospace',
                  }}
                  {...props}
                >
                  {children}
                </code>
              )
            }
            return (
              <pre
                style={{
                  background: '#282c34',
                  color: '#abb2bf',
                  padding: 16,
                  borderRadius: 8,
                  overflow: 'auto',
                  fontSize: 13,
                }}
              >
                <code className={className} {...props}>
                  {children}
                </code>
              </pre>
            )
          },
          // 表格: 增加 Ant Design 风格
          table({ children }) {
            return (
              <div style={{ overflow: 'auto', margin: '8px 0' }}>
                <table
                  style={{
                    borderCollapse: 'collapse',
                    width: '100%',
                    border: '1px solid #e8e8e8',
                  }}
                >
                  {children}
                </table>
              </div>
            )
          },
          th({ children }) {
            return (
              <th
                style={{
                  background: '#fafafa',
                  padding: '8px 12px',
                  border: '1px solid #e8e8e8',
                  fontWeight: 600,
                  textAlign: 'left',
                }}
              >
                {children}
              </th>
            )
          },
          td({ children }) {
            return (
              <td
                style={{
                  padding: '8px 12px',
                  border: '1px solid #e8e8e8',
                }}
              >
                {children}
              </td>
            )
          },
          // 链接: 拦截 mla-resource:// 协议, 其余新窗口打开
          a({ href, children, ...props }) {
            // 自定义协议: 讲义 → 交互动画跳转
            // 使用 <span role="button"> 而非 <a>, 因为:
            //   1. 这不是真正的超链接 (没有有效的 href URL)
            //   2. <a> 无 href 时浏览器行为不可预测
            //   3. 避免 react-markdown 内部 props 覆盖 onClick
            if (href?.startsWith(MLA_RESOURCE_PROTOCOL)) {
              const resourceId = href.slice(MLA_RESOURCE_PROTOCOL.length)
              return (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (onNavigateToResource) {
                      onNavigateToResource(resourceId)
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      e.stopPropagation()
                      if (onNavigateToResource) {
                        onNavigateToResource(resourceId)
                      }
                    }
                  }}
                  style={{
                    color: '#1677ff',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    textUnderlineOffset: '3px',
                  }}
                  title={`跳转到交互动画 (ID: ${resourceId.slice(0, 8)}...)`}
                >
                  {children}
                </span>
              )
            }
            // 普通链接: 新窗口打开
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#1677ff' }} {...props}>
                {children}
              </a>
            )
          },
          // 引用块
          blockquote({ children }) {
            return (
              <blockquote
                style={{
                  borderLeft: '4px solid #1677ff',
                  paddingLeft: 16,
                  margin: '8px 0',
                  color: '#666',
                  background: '#f0f5ff',
                  padding: '8px 16px',
                  borderRadius: '0 4px 4px 0',
                }}
              >
                {children}
              </blockquote>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
