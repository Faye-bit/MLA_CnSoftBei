/**
 * Markdown 渲染组件
 * 封装 react-markdown, 支持 GFM 表格、代码高亮、数学公式等
 * 用于 AI 消息和资源内容的统一渲染
 *
 * 设计规范 (MLA Brand v2.0):
 * - 代码块: 浅色背景 gray[50] + gray[200] 边框, 与整体浅色 UI 协调
 * - 语法高亮: GitHub Light 主题 (highlight.js), 经品牌色微调
 * - 复制按钮: 图标 (CopyOutlined / CheckOutlined), hover 可见
 */

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import { CopyOutlined, CheckOutlined } from '@ant-design/icons'
import { blue, gray, semantic } from '../../styles/tokens'

/** 导入 GitHub Light 语法高亮主题 */
import 'highlight.js/styles/github.css'

/** mla-resource:// 协议前缀 */
const MLA_RESOURCE_PROTOCOL = 'mla-resource://'

interface MarkdownRendererProps {
  content: string
  compact?: boolean
  onNavigateToResource?: (resourceId: string) => void
}

/**
 * 带复制按钮的代码块包装组件
 * hover 时右上角显示复制图标, 点击复制代码到剪贴板
 * 语言标签显示在左上角
 */
function CodeBlockWithCopy({ code, className, children }: {
  code: string
  className?: string
  children: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)

  /** 从 className 中提取语言名 (如 "language-python" → "Python") */
  const lang = (className?.replace('language-', '') || '').trim()
  const langLabel = lang ? lang.charAt(0).toUpperCase() + lang.slice(1) : ''

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = code
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div style={{ position: 'relative', marginBottom: 8 }} className="code-block-wrapper">
      {/* 语言标签 */}
      {langLabel && (
        <span style={{
          position: 'absolute', top: 8, left: 12, zIndex: 1,
          fontSize: 11, fontWeight: 500,
          color: gray[400], userSelect: 'none',
          pointerEvents: 'none',
        }}>
          {langLabel}
        </span>
      )}

      {/* 代码容器 — 浅色背景 + 边框, 匹配整体 UI */}
      <pre
        style={{
          background: gray[50],
          border: `1px solid ${gray[200]}`,
          borderRadius: 8,
          padding: '36px 16px 16px',  // 顶部多留空间装语言标签
          overflow: 'auto',
          fontSize: 13,
          lineHeight: 1.65,
          margin: 0,
          // 覆盖 github.css 的 hljs 背景色, 继承此处背景
        }}
      >
        {children}
      </pre>

      {/* 复制按钮 — 图标, hover 时显示 */}
      <button
        onClick={handleCopy}
        title={copied ? '已复制' : '复制代码'}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: copied ? semantic.success : gray[100],
          border: copied ? `1px solid ${semantic.success}` : `1px solid ${gray[200]}`,
          borderRadius: 6,
          padding: copied ? '3px 8px' : '3px 6px',
          cursor: 'pointer',
          color: copied ? '#FFFFFF' : gray[500],
          fontSize: 12,
          opacity: copied ? 1 : 0,
          transition: 'opacity 0.2s, background 0.2s, border-color 0.2s',
          lineHeight: 1,
        }}
      >
        {copied ? (
          <>
            <CheckOutlined style={{ fontSize: 12 }} />
            已复制
          </>
        ) : (
          <CopyOutlined style={{ fontSize: 14 }} />
        )}
      </button>

      <style>{`
        .code-block-wrapper:hover button { opacity: 1 !important; }
        /* 覆盖 github.css 的 hljs 背景, 使用透明继承我们设置的容器背景 */
        .code-block-wrapper .hljs {
          background: transparent !important;
          padding: 0 !important;
        }
      `}</style>
    </div>
  )
}

export default function MarkdownRenderer({ content, compact = false, onNavigateToResource }: MarkdownRendererProps) {
  return (
    <div
      className={`markdown-body ${compact ? 'markdown-compact' : ''}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
        urlTransform={(url) => {
          if (url.startsWith(MLA_RESOURCE_PROTOCOL)) return url
          return url
        }}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            if (!match) {
              // 行内代码
              return (
                <code
                  style={{
                    background: gray[50],
                    border: `1px solid ${gray[200]}`,
                    padding: '2px 6px',
                    borderRadius: 4,
                    fontSize: '0.9em',
                    fontFamily: 'monospace',
                    color: gray[800],
                  }}
                  {...props}
                >
                  {children}
                </code>
              )
            }
            // 代码块 — 带复制按钮 + 语法高亮
            return (
              <CodeBlockWithCopy code={String(children).replace(/\n$/, '')} className={className}>
                <code className={className} {...props}>{children}</code>
              </CodeBlockWithCopy>
            )
          },
          table({ children }) {
            return (
              <div style={{ overflow: 'auto' }}>
                <table>{children}</table>
              </div>
            )
          },
          th({ children }) {
            return <th>{children}</th>
          },
          td({ children }) {
            return <td>{children}</td>
          },
          a({ href, children, ...props }) {
            if (href?.startsWith(MLA_RESOURCE_PROTOCOL)) {
              const resourceId = href.slice(MLA_RESOURCE_PROTOCOL.length)
              return (
                <span role="button" tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); onNavigateToResource?.(resourceId) }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault(); e.stopPropagation(); onNavigateToResource?.(resourceId)
                    }
                  }}
                  style={{ color: blue[500], cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '3px' }}
                  title={`跳转到交互动画 (ID: ${resourceId.slice(0, 8)}...)`}>
                  {children}
                </span>
              )
            }
            return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: blue[500] }} {...props}>{children}</a>
          },
          blockquote({ children }) {
            return <blockquote>{children}</blockquote>
          },
        }}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
