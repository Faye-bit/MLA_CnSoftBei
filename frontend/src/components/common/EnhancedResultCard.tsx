/**
 * 增强检索结果卡片组件 (Phase 2)
 * 展示单条检索结果的完整信息, 包含:
 * - 面包屑来源导航 (课程 → 章节 → 知识点 → 文档)
 * - 相似度分数和关键词标签
 * - AI 增强摘要 (浅蓝背景高亮)
 * - 查询关键词高亮的正文内容
 * - 可折叠的元数据信息
 */

import { useState } from 'react'
import {
  Typography,
  Tag,
  Space,
  Breadcrumb,
  Collapse,
  Button,
} from 'antd'
import {
  FileTextOutlined,
  StarOutlined,
  BulbOutlined,
  BookOutlined,
  TagsOutlined,
  DownOutlined,
  UpOutlined,
} from '@ant-design/icons'
import type { RetrievalResultItem } from '../../types'

const { Title, Text, Paragraph } = Typography

/** 组件 Props */
interface EnhancedResultCardProps {
  /** 单条检索结果 */
  item: RetrievalResultItem
  /** 原始查询文本 (用于高亮) */
  query: string
  /** 是否启用了 AI 增强模式 */
  isEnhanced: boolean
}

/**
 * 将文本按高亮位置渲染为带标记的片段
 * 在匹配位置插入 <mark> 标签实现关键词高亮
 */
function HighlightContent({
  text,
  highlights,
  query,
}: {
  text: string
  highlights: Array<{ keyword: string; positions: Array<[number, number]> }>
  query: string
}) {
  // 如果没有高亮信息, 简单降级: 文本中出现查询词的位置高亮
  if (!highlights || highlights.length === 0) {
    // 降级高亮: 直接搜索查询词在文本中的位置
    if (!query || !text) {
      return <span>{text}</span>
    }
    // 从查询中提取可能的关键词
    const terms = query
      .split(/[\s,，。！？、；：]+/)
      .filter((t) => t.length >= 2)
    if (terms.length === 0) {
      return <span>{text}</span>
    }

    // 使用简单关键词匹配高亮
    const pattern = terms
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')
    try {
      const regex = new RegExp(`(${pattern})`, 'gi')
      const parts = text.split(regex)
      return (
        <span>
          {parts.map((part, i) =>
            terms.some((t) => t.toLowerCase() === part.toLowerCase()) ? (
              <mark
                key={i}
                style={{
                  background: '#ffd666',
                  padding: '0 2px',
                  borderRadius: 2,
                }}
              >
                {part}
              </mark>
            ) : (
              <span key={i}>{part}</span>
            )
          )}
        </span>
      )
    } catch {
      return <span>{text}</span>
    }
  }

  // 使用后端返回的精确定位进行高亮
  // 收集所有高亮区间 [(start, end, keyword), ...]
  const intervals: Array<{ start: number; end: number; keyword: string }> = []
  for (const h of highlights) {
    for (const [start, end] of h.positions) {
      intervals.push({ start, end, keyword: h.keyword })
    }
  }
  // 按起始位置排序
  intervals.sort((a, b) => a.start - b.start)

  // 合并重叠区间
  const merged: Array<{ start: number; end: number }> = []
  for (const iv of intervals) {
    if (merged.length > 0 && iv.start <= merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(
        merged[merged.length - 1].end,
        iv.end
      )
    } else {
      merged.push({ start: iv.start, end: iv.end })
    }
  }

  // 根据合并后的区间渲染文本
  if (merged.length === 0) {
    return <span>{text}</span>
  }

  const elements: React.ReactNode[] = []
  let lastEnd = 0
  for (const m of merged) {
    // 非高亮部分
    if (m.start > lastEnd) {
      elements.push(
        <span key={`text-${lastEnd}`}>{text.slice(lastEnd, m.start)}</span>
      )
    }
    // 高亮部分
    elements.push(
      <mark
        key={`mark-${m.start}`}
        style={{
          background: '#ffd666',
          padding: '0 2px',
          borderRadius: 2,
        }}
      >
        {text.slice(m.start, m.end)}
      </mark>
    )
    lastEnd = m.end
  }
  // 尾部剩余文本
  if (lastEnd < text.length) {
    elements.push(
      <span key={`text-${lastEnd}`}>{text.slice(lastEnd)}</span>
    )
  }

  return <span>{elements}</span>
}

/**
 * 相似度分数 → 百分比字符串
 */
function scorePercent(score: number): string {
  return (score * 100).toFixed(1) + '%'
}

/**
 * 相似度分数 → 对应的颜色标签
 */
function scoreColor(score: number): string {
  if (score >= 0.8) return 'green'
  if (score >= 0.6) return 'blue'
  if (score >= 0.4) return 'orange'
  return 'red'
}

/**
 * 增强检索结果卡片
 * 展示检索结果的完整结构化信息
 */
export default function EnhancedResultCard({
  item,
  query,
  isEnhanced,
}: EnhancedResultCardProps) {
  /** 是否展开完整内容 */
  const [expanded, setExpanded] = useState(false)
  /** 内容截断阈值 (字符数) */
  const CONTENT_PREVIEW_LENGTH = 300

  /** 内容是否需要截断 */
  const needTruncate = item.content.length > CONTENT_PREVIEW_LENGTH
  /** 显示的内容 */
  const displayContent = needTruncate && !expanded
    ? item.content.slice(0, CONTENT_PREVIEW_LENGTH) + '...'
    : item.content

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #f0f0f0',
        borderRadius: 8,
        padding: '16px 20px',
        marginBottom: 12,
        transition: 'box-shadow 0.2s',
        boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)'
      }}
    >
      {/* 第一行: 来源面包屑导航 */}
      <div style={{ marginBottom: 10 }}>
        <Breadcrumb
          items={[
            // 章节 (如有)
            ...(item.chapter_title
              ? [
                  {
                    title: (
                      <span style={{ fontSize: 12 }}>
                        <BookOutlined style={{ marginRight: 3 }} />
                        {item.chapter_title}
                      </span>
                    ),
                  },
                ]
              : []),
            // 知识点 (如有)
            ...(item.knowledge_point_title
              ? [
                  {
                    title: (
                      <span style={{ fontSize: 12 }}>
                        <TagsOutlined style={{ marginRight: 3 }} />
                        {item.knowledge_point_title}
                      </span>
                    ),
                  },
                ]
              : []),
            // 文档文件名
            {
              title: (
                <span style={{ fontSize: 12 }}>
                  <FileTextOutlined style={{ marginRight: 3 }} />
                  {item.document_filename}
                </span>
              ),
            },
            // 切片序号
            {
              title: (
                <span style={{ fontSize: 12, color: '#8c8c8c' }}>
                  切片 #{item.chunk_index}
                </span>
              ),
            },
          ]}
          style={{ fontSize: 12 }}
        />
      </div>

      {/* 第二行: 相似度 + 关键词标签 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 12,
        }}
      >
        <Space size={6} wrap>
          {/* 相似度分数 */}
          <Tag color={scoreColor(item.score)} icon={<StarOutlined />}>
            相似度: {scorePercent(item.score)}
          </Tag>

          {/* LLM 提取的关键词 */}
          {item.keywords && item.keywords.length > 0 &&
            item.keywords.map((kw) => (
              <Tag key={kw} color="processing" style={{ fontSize: 11 }}>
                {kw}
              </Tag>
            ))}

          {/* AI 增强标签 */}
          {isEnhanced && (
            <Tag
              color="cyan"
              icon={<BulbOutlined />}
              style={{ fontSize: 11 }}
            >
              AI 增强
            </Tag>
          )}
        </Space>
      </div>

      {/* 第三行: AI 增强摘要 (仅增强模式且存在摘要时显示) */}
      {isEnhanced && item.enhanced_summary && (
        <div
          style={{
            background: '#e6f7ff',
            border: '1px solid #91d5ff',
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 12,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              marginBottom: 4,
            }}
          >
            <BulbOutlined style={{ color: '#1890ff', marginRight: 6 }} />
            <Text strong style={{ color: '#1890ff', fontSize: 13 }}>
              AI 摘要
            </Text>
          </div>
          <Text style={{ fontSize: 13, lineHeight: 1.6, color: '#333' }}>
            {item.enhanced_summary}
          </Text>
        </div>
      )}

      {/* 第四行: 正文内容 (带高亮) */}
      <div
        style={{
          background: '#fafafa',
          borderRadius: 6,
          padding: '12px 14px',
          marginBottom: needTruncate ? 8 : 8,
          lineHeight: 1.7,
          fontSize: 14,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        <HighlightContent
          text={displayContent}
          highlights={item.highlights || []}
          query={query}
        />
      </div>

      {/* 展开/收起按钮 */}
      {needTruncate && (
        <Button
          type="link"
          size="small"
          icon={expanded ? <UpOutlined /> : <DownOutlined />}
          onClick={() => setExpanded(!expanded)}
          style={{ padding: 0, fontSize: 12 }}
        >
          {expanded ? '收起' : `展开全部 (${item.content.length} 字)`}
        </Button>
      )}

      {/* 第五行: 可折叠元数据区域 */}
      {item.metadata && Object.keys(item.metadata).length > 0 && (
        <Collapse
          ghost
          size="small"
          items={[
            {
              key: 'metadata',
              label: (
                <Text style={{ fontSize: 12, color: '#8c8c8c' }}>
                  元数据详情
                </Text>
              ),
              children: (
                <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                  {Object.entries(item.metadata).map(([key, value]) => (
                    <div key={key} style={{ marginBottom: 2 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {key}:
                      </Text>{' '}
                      {String(value)}
                    </div>
                  ))}
                </div>
              ),
            },
          ]}
          style={{ marginTop: 4 }}
        />
      )}
    </div>
  )
}
