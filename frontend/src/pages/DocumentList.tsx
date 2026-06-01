/**
 * 文档列表页
 * 展示课程下的所有文档、解析状态, 支持将切片关联到知识点
 */

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Table, Tag, Typography, Popconfirm, message, Space, Button, Drawer, Select, Alert, Modal, List, Checkbox } from 'antd'
import { DeleteOutlined, EyeOutlined, LinkOutlined, ThunderboltOutlined, PlusOutlined } from '@ant-design/icons'
import { getDocuments, deleteDocument, getDocumentDetail, getCourseKnowledgePoints, linkChunkToKp, extractKP, createExtractedKP, getChapters } from '../services/api'
import type { Document, DocumentDetail, Chapter } from '../types'

const { Title, Text } = Typography

/** 提取的知识点预览类型 */
interface ExtractedKP {
  title: string
  description: string
  difficulty: string
  chunk_ids: string[]
  selected: boolean
}

/** 文件类型对应的颜色 */
const typeColorMap: Record<string, string> = {
  pdf: 'red',
  docx: 'blue',
  pptx: 'orange',
  md: 'purple',
  txt: 'default',
}

/** 解析状态映射 */
const statusMap: Record<string, { label: string; color: string }> = {
  pending: { label: '待处理', color: 'default' },
  processing: { label: '解析中', color: 'processing' },
  done: { label: '已完成', color: 'success' },
  failed: { label: '失败', color: 'error' },
  chunked: { label: '待向量化', color: 'warning' },
}

/** 知识点选项类型 */
interface KpOption {
  knowledge_point_id: string
  title: string
  chapter_title: string
  chapter_id: string
}

/** 文件大小格式化 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function DocumentList() {
  const { id } = useParams<{ id: string }>()
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)

  // 详情抽屉
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedDoc, setSelectedDoc] = useState<DocumentDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // 知识点关联
  const [kpOptions, setKpOptions] = useState<KpOption[]>([])
  const [linkingChunks, setLinkingChunks] = useState<Set<string>>(new Set())

  // 自动提取知识点
  const [extractModalOpen, setExtractModalOpen] = useState(false)
  const [extractChapterId, setExtractChapterId] = useState<string | undefined>()
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [extracting, setExtracting] = useState(false)
  const [extractedKPs, setExtractedKPs] = useState<ExtractedKP[]>([])
  const [creating, setCreating] = useState(false)
  const [currentExtractDocId, setCurrentExtractDocId] = useState<string | null>(null)

  /** 加载文档列表 */
  async function loadDocuments(p = 1) {
    if (!id) return
    setLoading(true)
    try {
      const data = await getDocuments(id, p, 20)
      setDocuments(data.items)
      setTotal(data.total)
    } catch (err) {
      message.error('加载文档列表失败: ' + (err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDocuments()
  }, [id])

  /** 查看文档详情 (含切片) — 同时加载知识点列表供关联选择 */
  async function handleViewDetail(docId: string) {
    if (!id) return
    setDetailLoading(true)
    setDetailOpen(true)
    try {
      const [docData, kpData] = await Promise.all([
        getDocumentDetail(id, docId),
        getCourseKnowledgePoints(id),
      ])
      setSelectedDoc(docData)
      setKpOptions(kpData)
    } catch (err) {
      message.error('加载详情失败: ' + (err as Error).message)
      setDetailOpen(false)
    } finally {
      setDetailLoading(false)
    }
  }

  /** 删除文档 */
  async function handleDelete(docId: string) {
    if (!id) return
    try {
      await deleteDocument(id, docId)
      message.success('文档已删除')
      loadDocuments(page)
    } catch (err) {
      message.error('删除失败: ' + (err as Error).message)
    }
  }

  /** 关联切片到知识点 */
  async function handleLinkChunk(chunkId: string, kpId: string) {
    if (!id || !kpId) return
    setLinkingChunks((prev) => new Set(prev).add(chunkId))
    try {
      await linkChunkToKp(id, chunkId, kpId)
      message.success('切片已关联到知识点')
      // 刷新详情中的切片状态
      if (selectedDoc) {
        const updated = await getDocumentDetail(id, selectedDoc.id)
        setSelectedDoc(updated)
      }
    } catch (err) {
      message.error('关联失败: ' + (err as Error).message)
    } finally {
      setLinkingChunks((prev) => {
        const next = new Set(prev)
        next.delete(chunkId)
        return next
      })
    }
  }

  /** 打开自动提取模态框, 同时加载章节列表 */
  async function handleOpenExtract(docId: string) {
    if (!id) return
    setCurrentExtractDocId(docId)
    setExtractModalOpen(true)
    setExtractedKPs([])
    setExtractChapterId(undefined)
    try {
      const data = await getChapters(id)
      setChapters(data)
    } catch {
      message.error('加载章节列表失败')
    }
  }

  /** 执行 LLM 提取知识点 */
  async function handleExtract() {
    if (!id || !currentExtractDocId || !extractChapterId) {
      message.warning('请先选择目标章节')
      return
    }
    setExtracting(true)
    try {
      const data = await extractKP(id, currentExtractDocId, extractChapterId)
      const kps = (data.kp_list || []).map((kp) => ({
        ...kp,
        selected: true,
      }))
      setExtractedKPs(kps)
      if (kps.length === 0) {
        message.info('LLM 未从文档中识别到新知识点')
      } else {
        message.success(`提取到 ${kps.length} 个知识点, 请确认后创建`)
      }
    } catch (err) {
      message.error('提取失败: ' + (err as Error).message)
    } finally {
      setExtracting(false)
    }
  }

  /** 批量创建确认的知识点 */
  async function handleCreateKPs() {
    if (!id || !currentExtractDocId || !extractChapterId) return
    const selected = extractedKPs.filter((kp) => kp.selected)
    if (selected.length === 0) {
      message.warning('请至少选择一个知识点')
      return
    }
    setCreating(true)
    try {
      await createExtractedKP(id, currentExtractDocId, extractChapterId, selected)
      message.success(`已创建 ${selected.length} 个知识点并关联切片`)
      setExtractModalOpen(false)
      // 刷新文档详情和知识点列表
      if (currentExtractDocId) {
        handleViewDetail(currentExtractDocId)
      }
    } catch (err) {
      message.error('创建失败: ' + (err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  /** 获取切片关联的知识点信息 */
  function getLinkedKp(chunkKpId: string | null): KpOption | undefined {
    if (!chunkKpId) return undefined
    return kpOptions.find((kp) => kp.knowledge_point_id === chunkKpId)
  }

  const columns = [
    {
      title: '文件名',
      dataIndex: 'filename',
      key: 'filename',
      ellipsis: true,
    },
    {
      title: '类型',
      dataIndex: 'file_type',
      key: 'file_type',
      width: 80,
      render: (t: string) => <Tag color={typeColorMap[t] || 'default'}>{t.toUpperCase()}</Tag>,
    },
    {
      title: '大小',
      dataIndex: 'file_size',
      key: 'file_size',
      width: 100,
      render: (size: number) => formatFileSize(size),
    },
    {
      title: '状态',
      dataIndex: 'parse_status',
      key: 'parse_status',
      width: 100,
      render: (status: string) => {
        const info = statusMap[status] || { label: status, color: 'default' }
        return <Tag color={info.color}>{info.label}</Tag>
      },
    },
    {
      title: '切片数',
      dataIndex: 'chunk_count',
      key: 'chunk_count',
      width: 80,
    },
    {
      title: '上传时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (t: string) => new Date(t).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_: unknown, record: Document) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewDetail(record.id)}
          >
            详情与关联
          </Button>
          <Popconfirm
            title="确定删除此文档?"
            description="关联的切片和向量数据将被一并清理"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Title level={3} style={{ marginBottom: 24 }}>
        文档管理
      </Title>

      {/* 操作引导 */}
      {documents.length > 0 && (
        <Alert
          message="下一步：关联切片到知识点"
          description="点击每份文档的「详情与关联」，在抽屉中将文本切片绑定到对应知识点。关联后检索结果会展示结构化的来源信息（章节名 + 知识点名）。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      <Table
        dataSource={documents}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{
          current: page,
          total,
          pageSize: 20,
          onChange: (p) => {
            setPage(p)
            loadDocuments(p)
          },
          showTotal: (t) => `共 ${t} 份文档`,
        }}
        locale={{ emptyText: '暂无文档，请前往上传页面添加课程文档' }}
      />

      {/* 文档详情抽屉 */}
      <Drawer
        title={selectedDoc ? `文档详情: ${selectedDoc.filename}` : '文档详情'}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={680}
        loading={detailLoading}
      >
        {selectedDoc && (
          <div>
            {/* 文档元信息 */}
            <div style={{ marginBottom: 16 }}>
              <Space size={16}>
                <span>
                  类型: <Tag color={typeColorMap[selectedDoc.file_type]}>{selectedDoc.file_type.toUpperCase()}</Tag>
                </span>
                <span>大小: {formatFileSize(selectedDoc.file_size)}</span>
                <span>
                  状态:{' '}
                  <Tag color={statusMap[selectedDoc.parse_status]?.color}>
                    {statusMap[selectedDoc.parse_status]?.label}
                  </Tag>
                </span>
              </Space>
            </div>

            {selectedDoc.error_message && (
              <div style={{ color: '#ff4d4f', marginBottom: 16, padding: 8, background: '#fff2f0', borderRadius: 4 }}>
                提示: {selectedDoc.error_message}
              </div>
            )}

            {kpOptions.length === 0 && (
              <Alert
                message="尚未创建知识点"
                description="请先在课程详情页创建章节和知识点，或者使用下方的「自动提取」功能让 AI 帮你从文档中提取知识点。"
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}

            {/* 自动提取知识点按钮 */}
            <div style={{ marginBottom: 16 }}>
              <Button
                type="primary"
                ghost
                icon={<ThunderboltOutlined />}
                onClick={() => handleOpenExtract(selectedDoc.id)}
              >
                AI 自动提取知识点
              </Button>
              <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                LLM 阅读文档切片, 自动识别知识点并关联
              </Text>
            </div>

            <Title level={5}>
              文本切片 ({selectedDoc.chunks.length})
              {selectedDoc.chunks.filter((c) => c.knowledge_point_id).length > 0 && (
                <Tag color="green" style={{ marginLeft: 8 }}>
                  已关联 {selectedDoc.chunks.filter((c) => c.knowledge_point_id).length} 条
                </Tag>
              )}
            </Title>
            {selectedDoc.chunks.length === 0 ? (
              <div style={{ color: '#8c8c8c' }}>暂无切片</div>
            ) : (
              selectedDoc.chunks.map((chunk) => {
                const linkedKp = getLinkedKp(chunk.knowledge_point_id)
                return (
                  <div
                    key={chunk.id}
                    style={{
                      marginBottom: 12,
                      padding: 12,
                      background: chunk.knowledge_point_id ? '#f6ffed' : '#fafafa',
                      borderRadius: 6,
                      border: chunk.knowledge_point_id ? '1px solid #b7eb8f' : '1px solid #f0f0f0',
                    }}
                  >
                    {/* 切片头部信息 + 关联下拉 */}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 6,
                      }}
                    >
                      <Space size={8}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          切片 #{chunk.chunk_index} | {chunk.token_count} tokens
                        </Text>
                        {linkedKp && (
                          <Tag color="green" icon={<LinkOutlined />}>
                            {linkedKp.chapter_title} / {linkedKp.title}
                          </Tag>
                        )}
                      </Space>

                      {/* 关联知识点下拉 */}
                      {kpOptions.length > 0 && (
                        <Select
                          size="small"
                          placeholder="关联到知识点..."
                          value={chunk.knowledge_point_id || undefined}
                          onChange={(kpId) => handleLinkChunk(chunk.id, kpId)}
                          loading={linkingChunks.has(chunk.id)}
                          style={{ minWidth: 220 }}
                          allowClear
                          options={kpOptions.map((kp) => ({
                            label: `${kp.chapter_title} / ${kp.title}`,
                            value: kp.knowledge_point_id,
                          }))}
                          optionFilterProp="label"
                          showSearch
                          popupMatchSelectWidth={false}
                        />
                      )}
                    </div>

                    {/* 切片文本内容 */}
                    <div style={{ fontSize: 13, lineHeight: 1.6, color: '#595959' }}>
                      {chunk.content.slice(0, 300)}
                      {chunk.content.length > 300 ? '...' : ''}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}
      </Drawer>

      {/* 自动提取知识点模态框 */}
      <Modal
        title="AI 自动提取知识点"
        open={extractModalOpen}
        onCancel={() => setExtractModalOpen(false)}
        width={640}
        footer={null}
      >
        {/* 步骤1: 选择章节 + 开始提取 */}
        <div style={{ marginBottom: 16 }}>
          <Text strong>目标章节：</Text>
          <Select
            placeholder="选择知识点所属章节"
            value={extractChapterId}
            onChange={setExtractChapterId}
            style={{ minWidth: 280, marginLeft: 8 }}
            options={chapters.map((ch) => ({
              label: ch.title,
              value: ch.id,
            }))}
          />
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={handleExtract}
            loading={extracting}
            disabled={!extractChapterId}
            style={{ marginLeft: 12 }}
          >
            开始提取
          </Button>
        </div>

        {/* 步骤2: 预览结果 */}
        {extracting && (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Text type="secondary">正在调用 LLM 分析文档内容, 请稍候...</Text>
          </div>
        )}

        {extractedKPs.length > 0 && (
          <>
            <Alert
              message={`提取到 ${extractedKPs.length} 个知识点, 请确认后创建 (可取消不需要的)`}
              type="success"
              showIcon
              style={{ marginBottom: 12 }}
            />
            <List
              dataSource={extractedKPs}
              renderItem={(item, index) => (
                <List.Item
                  style={{ padding: '8px 0' }}
                >
                  <div style={{ width: '100%' }}>
                    <Checkbox
                      checked={item.selected}
                      onChange={(e) => {
                        const updated = [...extractedKPs]
                        updated[index] = { ...item, selected: e.target.checked }
                        setExtractedKPs(updated)
                      }}
                    >
                      <Text strong>{item.title}</Text>
                      <Tag
                        color={item.difficulty === 'easy' ? 'green' : item.difficulty === 'medium' ? 'blue' : 'red'}
                        style={{ marginLeft: 8 }}
                      >
                        {item.difficulty === 'easy' ? '简单' : item.difficulty === 'medium' ? '中等' : '困难'}
                      </Tag>
                      {item.chunk_ids.length > 0 && (
                        <Tag>{item.chunk_ids.length} 个关联切片</Tag>
                      )}
                    </Checkbox>
                    <div style={{ marginLeft: 28, color: '#8c8c8c', fontSize: 13, marginTop: 2 }}>
                      {item.description || '暂无描述'}
                    </div>
                  </div>
                </List.Item>
              )}
            />
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <Button onClick={() => setExtractModalOpen(false)} style={{ marginRight: 8 }}>
                取消
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleCreateKPs}
                loading={creating}
              >
                创建选中的知识点
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
