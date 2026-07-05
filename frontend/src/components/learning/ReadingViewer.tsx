/**
 * 拓展阅读查看器 — 杂志式阅读体验
 *
 * 与讲义共用的 MarkdownRenderer 不同, ReadingViewer 提供:
 *   1. 蔡丰网络调研链接区块 (从 resource_metadata.research_links 读取)
 *   2. 按难度分级 (入门/进阶/研究) 的卡片式条目布局
 *   3. 每条推荐含标题、来源标签、摘要、适用人群、预计阅读时间
 *   4. 链接自动识别为可点击跳转
 *
 * 解析逻辑: 优先按结构化 Markdown 模式提取条目,
 * 解析失败时 fallback 到增强版 Markdown 渲染。
 */

import { useState, useMemo } from 'react'
import { Typography, Tag, Collapse, Empty } from 'antd'
import {
  LinkOutlined,
  ReadOutlined,
  ClockCircleOutlined,
  UserOutlined,
  BookOutlined,
  SearchOutlined,
  CaretRightOutlined,
} from '@ant-design/icons'
import MarkdownRenderer from '../common/MarkdownRenderer'
import { gray, blue, semantic } from '../../styles/tokens'

const { Title, Text, Paragraph } = Typography

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 蔡丰网络调研链接 */
interface ResearchLink {
  url: string
  title: string
  description?: string
  source_type?: string
  relevance_score?: number
}

/** 解析出的单条阅读推荐 */
interface ReadingEntry {
  title: string
  level: string           // 入门级 / 进阶级 / 研究级
  source?: string         // 来源: 教材/论文/博客/文档
  summary?: string        // 摘要
  audience?: string       // 适用人群
  readingTime?: string    // 预计阅读时间
  body: string            // 正文 (已去除已提取的元数据行)
  urls: string[]          // 正文中检测到的 URL
}

/** 难度级别配色 */
const LEVEL_STYLES: Record<string, { color: string; bg: string; border: string; icon: string }> = {
  '入门级': { color: '#16A34A', bg: '#F0FDF4', border: '#BBF7D0', icon: '🌱' },
  '进阶级': { color: '#2563EB', bg: '#EFF6FF', border: '#BFDBFE', icon: '📖' },
  '研究级': { color: '#9333EA', bg: '#FAF5FF', border: '#E9D5FF', icon: '🔬' },
}

const DEFAULT_LEVEL_STYLE = { color: gray[600], bg: gray[50], border: gray[200], icon: '📄' }

// ---------------------------------------------------------------------------
// 解析工具
// ---------------------------------------------------------------------------

/** 从 Markdown 文本中提取所有 URL */
function extractUrls(text: string): string[] {
  const urlRe = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g
  return [...new Set(text.match(urlRe) || [])]
}

/** 尝试从 Markdown 行中提取键值对元数据 (形如 `- **来源**: xxx` 或 `**来源**: xxx`) */
function extractMetaLine(line: string): { key: string; value: string } | null {
  // 匹配: - **来源**: xxx 或 **来源**: xxx 或 - 来源: xxx
  const patterns = [
    /^[-*]\s*\*\*(.+?)\*\*[：:]\s*(.+)/,
    /^\*\*(.+?)\*\*[：:]\s*(.+)/,
    /^[-*]\s*(.+?)[：:]\s*(.+)/,
  ]
  for (const re of patterns) {
    const m = line.match(re)
    if (m) return { key: m[1].trim(), value: m[2].trim() }
  }
  return null
}

/**
 * 解析阅读 Markdown 内容为结构化条目
 *
 * 预期格式 (来自 READING_SYSTEM_PROMPT):
 *   ## 入门级
 *   ### 标题1
 *   - **来源**: 教材
 *   - **摘要**: xxx
 *   - **适用人群**: xxx
 *   - **预计阅读时间**: 15min
 *
 *   详细描述段落...
 *
 * 解析失败时返回 null, 由调用方 fallback 到纯 Markdown 渲染。
 */
function parseReadingContent(content: string): ReadingEntry[] | null {
  if (!content || typeof content !== 'string') return null

  const entries: ReadingEntry[] = []
  const lines = content.split('\n')

  // 状态机遍历
  let currentLevel = ''        // 当前难度级别 (入门级/进阶级/研究级)
  let currentEntry: Partial<ReadingEntry> | null = null
  let bodyLines: string[] = []

  /** 保存当前条目 */
  function flushEntry() {
    if (currentEntry && currentEntry.title) {
      const body = bodyLines.join('\n').trim()
      entries.push({
        title: currentEntry.title,
        level: currentEntry.level || currentLevel || '其他',
        source: currentEntry.source,
        summary: currentEntry.summary,
        audience: currentEntry.audience,
        readingTime: currentEntry.readingTime,
        body,
        urls: extractUrls(body),
      })
    }
    currentEntry = null
    bodyLines = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()

    // ── ## 级别标题 (入门级/进阶级/研究级) ──
    if (line.startsWith('## ') && !line.startsWith('### ')) {
      const heading = line.replace(/^##\s+/, '').trim()
      // 识别难度级别 (含「入门级推荐」「进阶阅读」等变体)
      if (/入门/.test(heading)) { flushEntry(); currentLevel = '入门级'; continue }
      if (/进阶|中级|提高/.test(heading)) { flushEntry(); currentLevel = '进阶级'; continue }
      if (/研究|高级|深入|专家/.test(heading)) { flushEntry(); currentLevel = '研究级'; continue }
      // 非标准标题 — 可能是顶部标题 (# 拓展阅读推荐), 跳过
      continue
    }

    // ── ### 条目标题 ──
    if (line.startsWith('### ') && !line.startsWith('#### ')) {
      flushEntry()
      currentEntry = { title: line.replace(/^###\s+/, '').trim(), level: currentLevel }
      continue
    }

    // ── 元数据行 ──
    if (currentEntry) {
      const meta = extractMetaLine(line)
      if (meta) {
        const key = meta.key.toLowerCase()
        if (key.includes('来源')) currentEntry.source = meta.value
        else if (key.includes('摘要') || key.includes('简介')) currentEntry.summary = meta.value
        else if (key.includes('适用') || key.includes('人群') || key.includes('读者')) currentEntry.audience = meta.value
        else if (key.includes('阅读') || key.includes('时间') || key.includes('预计')) currentEntry.readingTime = meta.value
        else bodyLines.push(rawLine)
        continue
      }
    }

    // ── 其他行: 收集为正文 ──
    if (currentEntry || currentLevel) {
      bodyLines.push(rawLine)
    }
  }

  // 保存最后一个条目
  flushEntry()

  // 如果至少提取到了 2 个条目, 认为解析成功
  return entries.length >= 2 ? entries : null
}

// ---------------------------------------------------------------------------
// 组件 Props
// ---------------------------------------------------------------------------

interface ReadingViewerProps {
  content: string
  /** 由后端注入的蔡丰网络调研链接 */
  researchLinks?: ResearchLink[]
}

// ---------------------------------------------------------------------------
// 子组件
// ---------------------------------------------------------------------------

/** 蔡丰网络调研链接区块 */
function ResearchLinksSection({ links }: { links: ResearchLink[] }) {
  const [collapsed, setCollapsed] = useState(true)

  if (!links || links.length === 0) return null

  /** 来源类型 → 中文标签 + 配色 */
  function sourceBadge(type?: string) {
    const map: Record<string, { label: string; color: string; bg: string }> = {
      web: { label: '网页', color: '#2563EB', bg: '#EFF6FF' },
      academic: { label: '学术', color: '#9333EA', bg: '#FAF5FF' },
      doc: { label: '文档', color: '#16A34A', bg: '#F0FDF4' },
      video: { label: '视频', color: '#DC2626', bg: '#FEF2F2' },
      paper: { label: '论文', color: '#CA8A04', bg: '#FEFCE8' },
    }
    const t = (type || 'web').toLowerCase()
    return map[t] || map['web']
  }

  /** 截断 URL 为可读域名 */
  function displayUrl(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
  }

  return (
    <div style={{
      marginBottom: 24,
      background: 'linear-gradient(135deg, #FEFCE8 0%, #FFFBEB 100%)',
      border: `1px solid #FDE68A`,
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      {/* 标题栏 — 可点击折叠 */}
      <div
        onClick={() => setCollapsed(v => !v)}
        style={{
          padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: 8,
          cursor: 'pointer', userSelect: 'none',
          background: collapsed ? undefined : '#FEF3C7',
          borderBottom: collapsed ? undefined : '1px solid #FDE68A',
          transition: 'background 0.2s',
        }}
      >
        <SearchOutlined style={{ color: '#D97706', fontSize: 15 }} />
        <Text strong style={{ fontSize: 13, color: '#92400E', flex: 1 }}>
          网络调研发现 · {links.length} 条相关资源
        </Text>
        <Text type="secondary" style={{ fontSize: 11 }}>
          {collapsed ? '展开查看' : '收起'}
        </Text>
        <CaretRightOutlined
          style={{
            color: '#D97706', fontSize: 11,
            transition: 'transform 0.25s ease',
            transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
          }}
        />
      </div>

      {/* 链接列表 — 折叠过渡 */}
      <div style={{
        maxHeight: collapsed ? 0 : 2000,
        overflow: 'hidden',
        transition: 'max-height 0.4s ease',
      }}>
        <div style={{ padding: '4px 16px 12px' }}>
          {links.slice(0, 10).map((link, i) => {
            const badge = sourceBadge(link.source_type)
            return (
              <a
                key={i}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                title={link.url}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '10px 0',
                  borderBottom: i < Math.min(links.length, 10) - 1 ? `1px solid #FEF3C7` : undefined,
                  textDecoration: 'none', color: 'inherit',
                }}
              >
                <LinkOutlined style={{ color: '#D97706', marginTop: 3, flexShrink: 0, fontSize: 13 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: link.description ? 3 : 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: gray[800] }}>
                      {link.title || '外部资源'}
                    </span>
                    {/* 来源类型标签 */}
                    <span style={{
                      fontSize: 10, lineHeight: '16px',
                      padding: '0 6px', borderRadius: 3,
                      color: badge.color, background: badge.bg,
                      fontWeight: 500,
                    }}>
                      {badge.label}
                    </span>
                    {/* 相关度 */}
                    {link.relevance_score != null && (
                      <span style={{ fontSize: 10, color: gray[400] }}>
                        {(link.relevance_score * 100).toFixed(0)}% 匹配
                      </span>
                    )}
                  </div>
                  {link.description && (
                    <div style={{ fontSize: 12, color: gray[500], lineHeight: 1.6 }}>
                      {link.description.length > 140
                        ? link.description.slice(0, 140) + '...'
                        : link.description}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: gray[400], marginTop: 2, fontFamily: 'monospace' }}>
                    {displayUrl(link.url)}
                  </div>
                </div>
              </a>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** 单条阅读推荐卡片 */
function ReadingCard({ entry }: { entry: ReadingEntry }) {
  const style = LEVEL_STYLES[entry.level] || DEFAULT_LEVEL_STYLE

  return (
    <div style={{
      marginBottom: 16,
      background: '#FFFFFF',
      border: `1px solid ${gray[200]}`,
      borderRadius: 10,
      overflow: 'hidden',
      transition: 'box-shadow 0.2s',
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.06)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '' }}
    >
      {/* 卡片头部 — 难度标签 + 标题 */}
      <div style={{
        padding: '14px 18px 0',
        display: 'flex', alignItems: 'flex-start', gap: 10,
      }}>
        <span style={{
          display: 'inline-block', fontSize: 18, lineHeight: 1, flexShrink: 0, marginTop: 1,
        }}>
          {style.icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text strong style={{ fontSize: 15, color: gray[900], lineHeight: 1.5 }}>
            {entry.title}
          </Text>
        </div>
      </div>

      {/* 元数据标签 */}
      <div style={{ padding: '8px 18px 0', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <Tag style={{
          fontSize: 11, borderRadius: 4, margin: 0,
          color: style.color, background: style.bg, border: `1px solid ${style.border}`,
        }}>
          {entry.level}
        </Tag>
        {entry.source && (
          <Tag icon={<BookOutlined />} style={{ fontSize: 11, borderRadius: 4, margin: 0, color: gray[500] }}>
            {entry.source}
          </Tag>
        )}
        {entry.readingTime && (
          <Tag icon={<ClockCircleOutlined />} style={{ fontSize: 11, borderRadius: 4, margin: 0, color: gray[500] }}>
            {entry.readingTime}
          </Tag>
        )}
        {entry.audience && (
          <Tag icon={<UserOutlined />} style={{ fontSize: 11, borderRadius: 4, margin: 0, color: gray[500] }}>
            {entry.audience}
          </Tag>
        )}
      </div>

      {/* 摘要 */}
      {entry.summary && (
        <div style={{
          padding: '10px 18px 0',
        }}>
          <Text style={{ fontSize: 13, color: gray[600], lineHeight: 1.7 }}>
            {entry.summary}
          </Text>
        </div>
      )}

      {/* 正文 */}
      {entry.body && (
        <div style={{ padding: '10px 18px 14px' }}>
          <div className="markdown-body" style={{ fontSize: 13, lineHeight: 1.8, color: gray[600] }}>
            <MarkdownRenderer content={entry.body} />
          </div>
        </div>
      )}

      {/* 链接按钮 */}
      {entry.urls.length > 0 && (
        <div style={{
          padding: '8px 18px 14px',
          display: 'flex', flexWrap: 'wrap', gap: 6,
        }}>
          {entry.urls.slice(0, 5).map((url, i) => (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 12, color: blue[500], textDecoration: 'none',
                padding: '3px 10px', borderRadius: 6,
                background: blue[50], border: `1px solid ${blue[100]}`,
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = blue[100] }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = blue[50] }}
            >
              <LinkOutlined style={{ fontSize: 11 }} />
              {new URL(url).hostname}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export default function ReadingViewer({ content, researchLinks }: ReadingViewerProps) {
  const entries = useMemo(() => parseReadingContent(content), [content])

  // ── 无内容 ──
  if (!content || content.length < 20) {
    return (
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        minHeight: 300, flexDirection: 'column', gap: 12,
      }}>
        <Empty description="阅读内容为空, 请尝试重新生成" />
      </div>
    )
  }

  // ── 有结构化条目 → 卡片渲染 ──
  if (entries && entries.length > 0) {
    // 按难度分组
    const groups: Record<string, ReadingEntry[]> = {}
    for (const e of entries) {
      const g = e.level || '其他'
      if (!groups[g]) groups[g] = []
      groups[g].push(e)
    }

    return (
      <div style={{ padding: '8px 0' }}>
        {/* 蔡丰网络调研链接 */}
        <ResearchLinksSection links={researchLinks || []} />

        {/* 按难度分组的卡片 */}
        {Object.entries(groups).map(([level, items]) => {
          const style = LEVEL_STYLES[level] || DEFAULT_LEVEL_STYLE
          return (
            <div key={level} style={{ marginBottom: 20 }}>
              {/* 分组标题 */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
                padding: '0 4px',
              }}>
                <span style={{ fontSize: 16 }}>{style.icon}</span>
                <Text strong style={{ fontSize: 14, color: style.color }}>
                  {level}
                </Text>
                <div style={{ flex: 1, height: 1, background: style.border }} />
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {items.length} 篇推荐
                </Text>
              </div>

              {/* 条目卡片 */}
              {items.map((entry, i) => (
                <ReadingCard key={i} entry={entry} />
              ))}
            </div>
          )
        })}
      </div>
    )
  }

  // ── 解析失败 → fallback: 增强 Markdown 渲染 ──
  return (
    <div style={{ padding: '8px 0' }}>
      <ResearchLinksSection links={researchLinks || []} />

      <div style={{
        background: '#FFFFFF',
        border: `1px solid ${gray[200]}`,
        borderRadius: 10,
        padding: '24px 28px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16,
          paddingBottom: 12, borderBottom: `1px solid ${gray[100]}`,
        }}>
          <ReadOutlined style={{ color: blue[500], fontSize: 16 }} />
          <Text strong style={{ fontSize: 14, color: gray[800] }}>拓展阅读推荐</Text>
        </div>
        <div className="markdown-body" style={{ fontSize: 14, lineHeight: 2.0, color: gray[700] }}>
          <MarkdownRenderer content={content} />
        </div>
      </div>
    </div>
  )
}
