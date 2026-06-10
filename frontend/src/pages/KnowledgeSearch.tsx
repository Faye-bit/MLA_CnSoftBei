/**
 * 知识检索页 (RAG) — Phase 2 增强版
 * 基于课程知识库的语义搜索, 支持选择课程、输入查询、展示来源引用
 *
 * Phase 2 新增功能:
 * - AI 增强模式开关: 启用后 LLM 二次加工, 提取核心观点和关键词
 * - 相似度阈值滑块: 隐藏低于阈值的结果, 减少噪音
 * - 增强结果卡片: 面包屑导航、关键词高亮、AI 摘要、去重提示
 */

import { useState, useEffect } from 'react'
import {
  Typography,
  Input,
  Select,
  Button,
  Card,
  List,
  Switch,
  Slider,
  Tag,
  Spin,
  Empty,
  Space,
  Tooltip,
  Alert,
  message,
} from 'antd'
import { SearchOutlined, BulbOutlined, FilterOutlined } from '@ant-design/icons'
import { getCourses, searchKnowledge } from '../services/api'
import type { Course, RetrievalResultItem } from '../types'
import EnhancedResultCard from '../components/common/EnhancedResultCard'

const { Title, Text } = Typography

export default function KnowledgeSearch() {
  // ==================== 状态管理 ====================

  /** 课程列表 (供下拉选择) */
  const [courses, setCourses] = useState<Course[]>([])
  /** 当前选中的课程 ID */
  const [selectedCourseId, setSelectedCourseId] = useState<string | undefined>()
  /** 查询输入文本 */
  const [query, setQuery] = useState('')
  /** 是否正在搜索 */
  const [searching, setSearching] = useState(false)
  /** 检索结果列表 */
  const [results, setResults] = useState<RetrievalResultItem[]>([])
  /** 是否已执行过检索 */
  const [hasSearched, setHasSearched] = useState(false)

  // Phase 2 新增状态
  /** 是否启用 AI 增强模式 */
  const [enhanceMode, setEnhanceMode] = useState(false)
  /** 相似度阈值 (0.0-1.0, 默认 0.3) */
  const [similarityThreshold, setSimilarityThreshold] = useState(0.3)
  /** 本次检索是否使用了增强 */
  const [isEnhanced, setIsEnhanced] = useState(false)
  /** AI 去重合并的结果数量 */
  const [deduplicatedCount, setDeduplicatedCount] = useState(0)

  // ==================== 副作用 ====================

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

  // ==================== 执行检索 ====================

  /** 执行语义检索 (基础或增强模式) */
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
        enhance: enhanceMode,
        similarity_threshold: similarityThreshold,
      })
      setResults(data?.results || [])
      setIsEnhanced(data?.enhanced || false)
      setDeduplicatedCount(data?.deduplicated_count || 0)
    } catch (err) {
      message.error('检索失败: ' + (err as Error).message)
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  // ==================== 渲染 ====================

  return (
    <div>
      <Title level={3} style={{ marginBottom: 24 }}>
        知识检索
      </Title>

      {/* 搜索栏 */}
      <Card style={{ marginBottom: 24 }}>
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          {/* 第一行: 课程选择 + 搜索框 */}
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

          {/* 第二行: Phase 2 增强控制 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 24,
              flexWrap: 'wrap',
            }}
          >
            {/* AI 增强模式开关 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Tooltip
                title={
                  <div>
                    <div>启用后由 AI 自动:</div>
                    <ul style={{ margin: '4px 0', paddingLeft: 16 }}>
                      <li>提取每个切片的核心观点</li>
                      <li>标注 2-4 个关键词</li>
                      <li>自动识别并合并重复结果</li>
                      <li>生成查询关键词高亮</li>
                    </ul>
                    <div>处理耗时增加约 2-5 秒</div>
                  </div>
                }
              >
                <Switch
                  checked={enhanceMode}
                  onChange={setEnhanceMode}
                  checkedChildren={
                    <span>
                      <BulbOutlined style={{ marginRight: 4 }} />
                      AI 增强
                    </span>
                  }
                  unCheckedChildren="基础检索"
                />
              </Tooltip>
              <Text type="secondary" style={{ fontSize: 13 }}>
                {enhanceMode ? 'AI 将对结果进行智能分析与去重' : '快速返回原始检索结果'}
              </Text>
            </div>

            {/* 相似度阈值滑块 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 260 }}>
              <FilterOutlined style={{ color: '#8c8c8c' }} />
              <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                最低相似度
              </Text>
              <Slider
                value={similarityThreshold}
                onChange={setSimilarityThreshold}
                min={0}
                max={1}
                step={0.05}
                style={{ width: 140, margin: 0 }}
                tooltip={{ formatter: (v) => (v! * 100).toFixed(0) + '%' }}
              />
              <Text strong style={{ fontSize: 13, minWidth: 36 }}>
                {(similarityThreshold * 100).toFixed(0)}%
              </Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                (低于此分数隐藏)
              </Text>
            </div>
          </div>

          {/* 增强模式提示 */}
          {enhanceMode && (
            <Alert
              message="AI 增强模式已开启"
              description="检索完成后, AI 将对结果进行智能分析、提取核心观点、标注关键词, 并自动合并重复内容。处理耗时约 2-5 秒。"
              type="info"
              showIcon
              icon={<BulbOutlined />}
              style={{ padding: '8px 16px' }}
            />
          )}

          <Text type="secondary">
            基于课程知识库的语义检索, 返回最相关的文档切片, 附带来源引用
          </Text>
        </Space>
      </Card>

      {/* 去重提示 */}
      {hasSearched && isEnhanced && deduplicatedCount > 0 && (
        <Alert
          message={`AI 已自动合并 ${deduplicatedCount} 条语义重复的结果`}
          type="success"
          showIcon
          closable
          style={{ marginBottom: 16 }}
        />
      )}

      {/* 检索结果 */}
      {searching ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin size="large" tip={enhanceMode ? 'AI 正在分析检索结果...' : '正在检索...'} />
        </div>
      ) : hasSearched && results.length === 0 ? (
        <Empty
          description={
            similarityThreshold > 0
              ? '未找到高相关结果, 请尝试降低"最低相似度"后重新搜索'
              : '未找到相关结果, 请尝试其他关键词或确认课程已上传资料'
          }
          style={{ padding: 60 }}
        />
      ) : (
        <List
          dataSource={results}
          renderItem={(item) => (
            <EnhancedResultCard
              key={item.chunk_id}
              item={item}
              query={query}
              isEnhanced={isEnhanced}
            />
          )}
        />
      )}
    </div>
  )
}
