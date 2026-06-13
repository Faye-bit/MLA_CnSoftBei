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

interface MarkdownRendererProps {
  /** Markdown 文本内容 */
  content: string
  /** 是否在紧凑模式下渲染 (减少间距) */
  compact?: boolean
}

export default function MarkdownRenderer({ content, compact = false }: MarkdownRendererProps) {
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
          // 链接: 新窗口打开
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#1677ff' }}>
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
