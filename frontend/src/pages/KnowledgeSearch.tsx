/**
 * 知识检索页 (RAG)
 * 基于课程知识库的语义搜索, 支持选择课程、输入查询、展示来源引用
 */

import { useState, useEffect } from 'react'
import {
  Typography,
  Input,
  Select,
  Button,
  Card,
  List,
  Tag,
  Spin,
  Empty,
  Space,
  message,
} from 'antd'
import { SearchOutlined, FileTextOutlined, StarOutlined } from '@ant-design/icons'
import { getCourses, searchKnowledge } from '../services/api'
import type { Course, RetrievalResultItem } from '../types'

const { Title, Text, Paragraph } = Typography

export default function KnowledgeSearch() {
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedCourseId, setSelectedCourseId] = useState<string | undefined>()
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<RetrievalResultItem[]>([])
  const [hasSearched, setHasSearched] = useState(false)

  /** 加载课程列表供选择 */
  useEffect(() => {
    async function loadCourses() {
      try {
        const data = await getCourses(1, 100)
        setCourses(data.items)
      } catch {
        // ignore
      }
    }
    loadCourses()
  }, [])

  /** 执行检索 */
  async function handleSearch() {
    if (!selectedCourseId) {
      message.warning('请先选择一个课程')
      return
    }
    if (!query.trim()) {
      message.warning('请输入搜索内容')
      return
    }

    setSearching(true)
    setHasSearched(true)
    try {
      const data = await searchKnowledge({
        query: query.trim(),
        course_id: selectedCourseId,
        top_k: 10,
      })
      setResults(data?.results || [])
    } catch (err) {
      message.error('检索失败: ' + (err as Error).message)
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  /** 相似度分数 → 百分比 */
  function scorePercent(score: number): string {
    return (score * 100).toFixed(1) + '%'
  }

  /** 分数对应的颜色 */
  function scoreColor(score: number): string {
    if (score >= 0.8) return 'green'
    if (score >= 0.6) return 'blue'
    if (score >= 0.4) return 'orange'
    return 'red'
  }

  return (
    <div>
      <Title level={3} style={{ marginBottom: 24 }}>
        知识检索
      </Title>

      {/* 搜索栏 */}
      <Card style={{ marginBottom: 24 }}>
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <div style={{ display: 'flex', gap: 12 }}>
            <Select
              placeholder="选择课程"
              value={selectedCourseId}
              onChange={setSelectedCourseId}
              style={{ minWidth: 240 }}
              options={courses.map((c) => ({
                label: c.name,
                value: c.id,
              }))}
              showSearch
              optionFilterProp="label"
            />
            <Input.Search
              placeholder="输入你想了解的知识点或问题..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onSearch={handleSearch}
              enterButton={
                <Button type="primary" icon={<SearchOutlined />} loading={searching}>
                  检索
                </Button>
              }
              size="large"
              style={{ flex: 1 }}
            />
          </div>
          <Text type="secondary">
            基于课程知识库的语义检索, 返回最相关的文档切片, 附带来源引用
          </Text>
        </Space>
      </Card>

      {/* 检索结果 */}
      {searching ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin size="large" tip="正在检索..." />
        </div>
      ) : hasSearched && results.length === 0 ? (
        <Empty description="未找到相关结果, 请尝试其他关键词或确认课程已上传资料" style={{ padding: 60 }} />
      ) : (
        <List
          dataSource={results}
          renderItem={(item) => (
            <Card
              style={{ marginBottom: 12 }}
              key={item.chunk_id}
              size="small"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
                <Space size={8}>
                  <FileTextOutlined />
                  <Text strong>{item.document_filename}</Text>
                  <Tag>切片 #{item.chunk_index}</Tag>
                </Space>
                <Tag color={scoreColor(item.score)} icon={<StarOutlined />}>
                  相似度: {scorePercent(item.score)}
                </Tag>
              </div>

              <Paragraph
                style={{
                  background: '#fafafa',
                  padding: 12,
                  borderRadius: 6,
                  marginBottom: 8,
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.6,
                }}
              >
                {item.content}
              </Paragraph>

              {item.metadata && Object.keys(item.metadata).length > 0 && (
                <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                  <Space size={12}>
                    {item.metadata.file_type ? <span>类型: {String(item.metadata.file_type)}</span> : null}
                  </Space>
                </div>
              )}
            </Card>
          )}
        />
      )}
    </div>
  )
}
