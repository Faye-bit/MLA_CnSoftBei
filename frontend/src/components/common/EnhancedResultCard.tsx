/**
 * 增强检索结果卡片组件
 * 展示单条检索结果的完整信息, 包含:
 * - 面包屑来源导航 (课程 → 章节 → 知识点 → 文档)
 * - 相似度分数和关键词标签
 * - AI 增强摘要 (品牌蓝底高亮)
 * - 查询关键词高亮的正文内容
 * - 可折叠的元数据信息
 *
 * 设计规范 (MLA Brand v2.0):
 * - 使用品牌 token 替代硬编码色值
 */

import { useState } from 'react'
import { Typography, Tag, Space, Breadcrumb, Collapse, Button } from 'antd'
import {
  FileTextOutlined, StarOutlined, BulbOutlined,
  BookOutlined, TagsOutlined, DownOutlined, UpOutlined,
} from '@ant-design/icons'
import type { RetrievalResultItem } from '../../types'
import { blue, gray, semantic } from '../../styles/tokens'

const { Text } = Typography

interface EnhancedResultCardProps {
  item: RetrievalResultItem
  query: string
  isEnhanced: boolean
}

/** 搜索结果高亮色 */
const HIGHLIGHT_COLOR = '#FDE68A'

function HighlightContent({ text, highlights, query }: {
  text: string
  highlights: Array<{ keyword: string; positions: Array<[number, number]> }>
  query: string
}) {
  if (!highlights || highlights.length === 0) {
    if (!query || !text) return <span>{text}</span>
    const terms = query.split(/[\s,，。！？、；：]+/).filter((t) => t.length >= 2)
    if (terms.length === 0) return <span>{text}</span>

    const pattern = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    try {
      const regex = new RegExp(`(${pattern})`, 'gi')
      const parts = text.split(regex)
      return (
        <span>
          {parts.map((part, i) =>
            terms.some((t) => t.toLowerCase() === part.toLowerCase()) ? (
              <mark key={i} style={{ background: HIGHLIGHT_COLOR, padding: '0 2px', borderRadius: 2 }}>{part}</mark>
            ) : (
              <span key={i}>{part}</span>
            )
          )}
        </span>
      )
    } catch { return <span>{text}</span> }
  }

  const intervals: Array<{ start: number; end: number; keyword: string }> = []
  for (const h of highlights) {
    for (const [start, end] of h.positions) intervals.push({ start, end, keyword: h.keyword })
  }
  intervals.sort((a, b) => a.start - b.start)

  const merged: Array<{ start: number; end: number }> = []
  for (const iv of intervals) {
    if (merged.length > 0 && iv.start <= merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, iv.end)
    } else { merged.push({ start: iv.start, end: iv.end }) }
  }

  if (merged.length === 0) return <span>{text}</span>

  const elements: React.ReactNode[] = []
  let lastEnd = 0
  for (const m of merged) {
    if (m.start > lastEnd) elements.push(<span key={`text-${lastEnd}`}>{text.slice(lastEnd, m.start)}</span>)
    elements.push(<mark key={`mark-${m.start}`} style={{ background: HIGHLIGHT_COLOR, padding: '0 2px', borderRadius: 2 }}>{text.slice(m.start, m.end)}</mark>)
    lastEnd = m.end
  }
  if (lastEnd < text.length) elements.push(<span key={`text-${lastEnd}`}>{text.slice(lastEnd)}</span>)
  return <span>{elements}</span>
}

function scorePercent(score: number): string { return (score * 100).toFixed(1) + '%' }

function scoreColor(score: number): string {
  if (score >= 0.8) return 'green'
  if (score >= 0.6) return 'blue'
  if (score >= 0.4) return 'orange'
  return 'red'
}

export default function EnhancedResultCard({ item, query, isEnhanced }: EnhancedResultCardProps) {
  const [expanded, setExpanded] = useState(false)
  const CONTENT_PREVIEW_LENGTH = 300
  const needTruncate = item.content.length > CONTENT_PREVIEW_LENGTH
  const displayContent = needTruncate && !expanded ? item.content.slice(0, CONTENT_PREVIEW_LENGTH) + '...' : item.content

  return (
    <div style={{
      background: '#FFFFFF', border: `1px solid ${gray[200]}`, borderRadius: 8,
      padding: '16px 20px', marginBottom: 12, transition: 'box-shadow 0.2s',
      boxShadow: `0 1px 4px rgba(15,23,42,0.04)`,
    }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = `0 4px 12px rgba(15,23,42,0.08)` }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = `0 1px 4px rgba(15,23,42,0.04)` }}>
      {/* 面包屑导航 */}
      <div style={{ marginBottom: 10 }}>
        <Breadcrumb items={[
          ...(item.chapter_title ? [{ title: <span style={{ fontSize: 12 }}><BookOutlined style={{ marginRight: 3 }} />{item.chapter_title}</span> }] : []),
          ...(item.knowledge_point_title ? [{ title: <span style={{ fontSize: 12 }}><TagsOutlined style={{ marginRight: 3 }} />{item.knowledge_point_title}</span> }] : []),
          { title: <span style={{ fontSize: 12 }}><FileTextOutlined style={{ marginRight: 3 }} />{item.document_filename}</span> },
          { title: <span style={{ fontSize: 12, color: gray[400] }}>切片 #{item.chunk_index}</span> },
        ]} style={{ fontSize: 12 }} />
      </div>

      {/* 相似度 + 关键词 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <Space size={6} wrap>
          <Tag color={scoreColor(item.score)} icon={<StarOutlined />}>相似度: {scorePercent(item.score)}</Tag>
          {item.keywords && item.keywords.length > 0 && item.keywords.map((kw) => <Tag key={kw} color="processing" style={{ fontSize: 11 }}>{kw}</Tag>)}
          {isEnhanced && <Tag color="cyan" icon={<BulbOutlined />} style={{ fontSize: 11 }}>AI 增强</Tag>}
        </Space>
      </div>

      {/* AI 增强摘要 */}
      {isEnhanced && item.enhanced_summary && (
        <div style={{ background: blue[50], border: `1px solid ${blue[200]}`, borderRadius: 6, padding: '10px 14px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
            <BulbOutlined style={{ color: blue[500], marginRight: 6 }} />
            <Text strong style={{ color: blue[500], fontSize: 13 }}>AI 摘要</Text>
          </div>
          <Text style={{ fontSize: 13, lineHeight: 1.6, color: gray[800] }}>{item.enhanced_summary}</Text>
        </div>
      )}

      {/* 正文内容 (带高亮) */}
      <div style={{ background: gray[50], borderRadius: 6, padding: '12px 14px', marginBottom: 8, lineHeight: 1.7, fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        <HighlightContent text={displayContent} highlights={item.highlights || []} query={query} />
      </div>

      {needTruncate && (
        <Button type="link" size="small" icon={expanded ? <UpOutlined /> : <DownOutlined />}
          onClick={() => setExpanded(!expanded)} style={{ padding: 0, fontSize: 12 }}>
          {expanded ? '收起' : `展开全部 (${item.content.length} 字)`}
        </Button>
      )}

      {/* 可折叠元数据 */}
      {item.metadata && Object.keys(item.metadata).length > 0 && (
        <Collapse ghost size="small" items={[{
          key: 'metadata',
          label: <Text style={{ fontSize: 12, color: gray[400] }}>元数据详情</Text>,
          children: (
            <div style={{ fontSize: 12, color: gray[400] }}>
              {Object.entries(item.metadata).map(([key, value]) => (
                <div key={key} style={{ marginBottom: 2 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{key}:</Text> {String(value)}
                </div>
              ))}
            </div>
          ),
        }]} style={{ marginTop: 4 }} />
      )}
    </div>
  )
}
