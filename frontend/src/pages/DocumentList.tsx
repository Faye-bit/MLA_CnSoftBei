/**
 * 文档列表页
 * 展示课程下的所有文档、解析状态, 支持将切片/页面关联到知识点
 * Phase 3: PDF/PPTX 文档显示页面网格视图, DOCX/MD/TXT 显示切片列表
 */

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Table, Tag, Typography, Popconfirm, message, Space, Button, Drawer, Select, Alert, Modal, List, Checkbox, Image, Card, Row, Col } from 'antd'
import { DeleteOutlined, EyeOutlined, LinkOutlined, ThunderboltOutlined, PlusOutlined, FileImageOutlined } from '@ant-design/icons'
import { getDocuments, deleteDocument, getDocumentDetail, getCourseKnowledgePoints, linkChunkToKp, linkPageToKp, extractKP, createExtractedKP, getChapters, getPageImageUrl } from '../services/api'
import type { Document, DocumentDetail, DocumentPage, Chapter } from '../types'

const { Title, Text, Paragraph } = Typography

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
  const [classified, setClassified] = useState<Array<{ category: string; items: Array<{ title: string; description: string; difficulty: string; chunk_ids: string[]; selected: boolean }> }>>([])
  const [creating, setCreating] = useState(false)
  const [currentExtractDocId, setCurrentExtractDocId] = useState<string | null>(null)

  // 页面大图查看 (Phase 3)
  const [pagePreviewOpen, setPagePreviewOpen] = useState(false)
  const [previewPage, setPreviewPage] = useState<DocumentPage | null>(null)
  const [linkingPageId, setLinkingPageId] = useState<string | null>(null)

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

  /** 关联页面到知识点 (Phase 3) */
  async function handleLinkPageToKp(pageId: string, kpId: string) {
    if (!id || !kpId) return
    setLinkingPageId(pageId)
    try {
      await linkPageToKp(id, pageId, [kpId])
      message.success('页面已关联到知识点')
      if (selectedDoc) {
        const updated = await getDocumentDetail(id, selectedDoc.id)
        setSelectedDoc(updated)
      }
    } catch (err) {
      message.error('关联失败: ' + (err as Error).message)
    } finally {
      setLinkingPageId(null)
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

  /** 执行 LLM 提取知识点 + 自动分类 */
  async function handleExtract() {
    if (!id || !currentExtractDocId || !extractChapterId) {
      message.warning('请先选择目标章节')
      return
    }
    setExtracting(true)
    try {
      const data = await extractKP(id, currentExtractDocId, extractChapterId)
      // 优先使用分类结构, 兼容旧格式
      if (data.classified && data.classified.length > 0) {
        setClassified(data.classified.map((cat: { category: string; items: Array<{ title: string; description: string; difficulty: string; chunk_ids: string[] }> }) => ({
          ...cat,
          items: cat.items.map(item => ({ ...item, selected: true })),
        })))
      } else {
        setClassified([])
      }
      const kps = (data.kp_list || []).map((kp) => ({
        ...kp,
        selected: true,
      }))
      setExtractedKPs(kps)
      const catCount = data.classified?.length || 0
      if (kps.length === 0) {
        message.info('LLM 未从文档中识别到新知识点')
      } else if (catCount > 0) {
        message.success(`提取到 ${kps.length} 个知识点, AI 已分为 ${catCount} 个分类`)
      } else {
        message.success(`提取到 ${kps.length} 个知识点, 请确认后创建`)
      }
    } catch (err) {
      message.error('提取失败: ' + (err as Error).message)
    } finally {
      setExtracting(false)
    }
  }

  /** 批量创建确认的知识点 (优先使用分类结构) */
  async function handleCreateKPs() {
    if (!id || !currentExtractDocId || !extractChapterId) return

    // 有分类结构 → 发送分类格式
    if (classified.length > 0) {
      const catsWithSelected = classified
        .map(cat => ({ category: cat.category, items: cat.items.filter(item => item.selected) }))
        .filter(cat => cat.items.length > 0)
      if (catsWithSelected.length === 0) { message.warning('请至少保留一个知识点'); return }
      setCreating(true)
      try {
        await createExtractedKP(id, currentExtractDocId, extractChapterId, catsWithSelected)
        message.success(`已创建 ${catsWithSelected.length} 个分类的知识点树`)
        setExtractModalOpen(false)
        setExtractedKPs([])
        setClassified([])
        if (currentExtractDocId) handleViewDetail(currentExtractDocId)
      } catch (err) { message.error('创建失败: ' + (err as Error).message) }
      finally { setCreating(false) }
      return
    }

    // 回退: 扁平列表
    const selected = extractedKPs.filter((kp) => kp.selected)
    if (selected.length === 0) { message.warning('请至少选择一个知识点'); return }
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
      title: '切片/页数',
      key: 'count',
      width: 80,
      render: (_: unknown, record: Document) => {
        // 对于 PDF/PPTX 显示页数, 其他显示切片数
        if (record.file_type === 'pdf' || record.file_type === 'pptx') {
          return <span>{record.page_count > 0 ? `${record.page_count} 页` : '-'}</span>
        }
        return <span>{record.chunk_count > 0 ? `${record.chunk_count} 片` : '-'}</span>
      },
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
              <Space size={16} wrap>
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
                {selectedDoc.file_type === 'pdf' || selectedDoc.file_type === 'pptx' ? (
                  <>
                    <span>页数: {selectedDoc.page_count}</span>
                    {selectedDoc.kp_count > 0 && <span>知识点: {selectedDoc.kp_count}</span>}
                  </>
                ) : (
                  <span>切片: {selectedDoc.chunk_count}</span>
                )}
              </Space>
            </div>

            {selectedDoc.error_message && (
              <div style={{ color: '#ff4d4f', marginBottom: 16, padding: 8, background: '#fff2f0', borderRadius: 4 }}>
                提示: {selectedDoc.error_message}
              </div>
            )}

            {/* PDF/PPTX: 页面网格视图 */}
            {selectedDoc.file_type === 'pdf' || selectedDoc.file_type === 'pptx' ? (
              <>
                <Title level={5}>
                  页面列表 ({selectedDoc.pages?.length || 0})
                  {selectedDoc.kp_count > 0 && (
                    <Tag color="blue" style={{ marginLeft: 8 }}>
                      {selectedDoc.kp_count} 个知识点
                    </Tag>
                  )}
                </Title>
                {(!selectedDoc.pages || selectedDoc.pages.length === 0) ? (
                  <div style={{ color: '#8c8c8c' }}>暂无页面数据</div>
                ) : (
                  <Row gutter={[12, 12]}>
                    {selectedDoc.pages.map((page) => (
                      <Col span={12} key={page.id}>
                        <Card
                          hoverable
                          size="small"
                          onClick={() => {
                            setPreviewPage(page)
                            setPagePreviewOpen(true)
                          }}
                          cover={
                            <div style={{ height: 140, overflow: 'hidden', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <img
                                src={getPageImageUrl(id!, selectedDoc.id, page.page_number)}
                                alt={`第 ${page.page_number} 页`}
                                style={{ width: '100%', objectFit: 'cover' }}
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement
                                  target.style.display = 'none'
                                  // 显示占位图标
                                  const parent = target.parentElement
                                  if (parent && !parent.querySelector('.img-placeholder')) {
                                    const placeholder = document.createElement('span')
                                    placeholder.className = 'img-placeholder'
                                    placeholder.textContent = '🖼️'
                                    placeholder.style.fontSize = '32px'
                                    parent.appendChild(placeholder)
                                  }
                                }}
                              />
                            </div>
                          }
                        >
                          <Card.Meta
                            title={
                              <Space size={4}>
                                <Text strong>第 {page.page_number} 页</Text>
                                {page.linked_kp_ids.length > 0 && (
                                  <Tag color="green" style={{ fontSize: 10 }}>
                                    已关联 {page.linked_kp_ids.length}
                                  </Tag>
                                )}
                              </Space>
                            }
                            description={
                              <div>
                                {page.summary ? (
                                  <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 4, fontSize: 12 }}>
                                    {page.summary}
                                  </Paragraph>
                                ) : (
                                  <Text type="secondary" style={{ fontSize: 12 }}>
                                    {page.extracted_kps.length > 0 ? '未生成摘要' : '待 AI 解析'}
                                  </Text>
                                )}
                                {page.extracted_kps.length > 0 && (
                                  <Space size={4} wrap>
                                    {page.extracted_kps.map((kp, idx) => (
                                      <Tag key={idx} color="blue" style={{ fontSize: 10, margin: '2px 0' }}>
                                        {kp.title}
                                      </Tag>
                                    ))}
                                  </Space>
                                )}
                              </div>
                            }
                          />
                        </Card>
                      </Col>
                    ))}
                  </Row>
                )}
              </>
            ) : (
              <>
                {/* DOCX/MD/TXT: 切片列表视图 (保持现有逻辑) */}
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
                        <div style={{ fontSize: 13, lineHeight: 1.6, color: '#595959' }}>
                          {chunk.content.slice(0, 300)}
                          {chunk.content.length > 300 ? '...' : ''}
                        </div>
                      </div>
                    )
                  })
                )}
              </>
            )}
          </div>
        )}
      </Drawer>

      {/* 页面大图预览弹窗 (Phase 3) */}
      <Modal
        title={previewPage ? `第 ${previewPage.page_number} 页` : '页面预览'}
        open={pagePreviewOpen}
        onCancel={() => setPagePreviewOpen(false)}
        width={900}
        footer={null}
      >
        {previewPage && (
          <div>
            <Image
              src={getPageImageUrl(id!, selectedDoc!.id, previewPage.page_number)}
              alt={`第 ${previewPage.page_number} 页`}
              style={{ width: '100%' }}
              fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
            />

            <div style={{ marginTop: 16 }}>
              {/* 页面摘要 */}
              {previewPage.summary && (
                <div style={{ marginBottom: 12 }}>
                  <Text strong>📝 页面摘要：</Text>
                  <Paragraph style={{ marginTop: 4 }}>{previewPage.summary}</Paragraph>
                </div>
              )}

              {/* 提取的知识点 */}
              {previewPage.extracted_kps.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <Text strong>🏷️ AI 提取的知识点：</Text>
                  <div style={{ marginTop: 8 }}>
                    {previewPage.extracted_kps.map((kp, idx) => (
                      <Tag
                        key={idx}
                        color={kp.difficulty === 'easy' ? 'green' : kp.difficulty === 'medium' ? 'blue' : 'red'}
                        style={{ marginBottom: 4 }}
                      >
                        {kp.title}
                        {kp.description ? `: ${kp.description}` : ''}
                        <Text type="secondary" style={{ fontSize: 10, marginLeft: 4 }}>
                          ({kp.difficulty === 'easy' ? '基础' : kp.difficulty === 'medium' ? '中等' : '困难'})
                        </Text>
                      </Tag>
                    ))}
                  </div>
                </div>
              )}

              {/* 关联已有知识点 */}
              {kpOptions.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <Text strong>🔗 关联到已有知识点：</Text>
                  <Select
                    placeholder="选择知识点关联此页面..."
                    style={{ minWidth: 300, marginLeft: 8 }}
                    loading={linkingPageId === previewPage.id}
                    onChange={(kpId) => handleLinkPageToKp(previewPage.id, kpId)}
                    options={kpOptions.map((kp) => ({
                      label: `${kp.chapter_title} / ${kp.title}`,
                      value: kp.knowledge_point_id,
                    }))}
                    optionFilterProp="label"
                    showSearch
                    value={previewPage.linked_kp_ids.length > 0 ? previewPage.linked_kp_ids[0] : undefined}
                  />
                </div>
              )}

              {/* 无知识点提示 */}
              {previewPage.extracted_kps.length === 0 && previewPage.linked_kp_ids.length === 0 && (
                <Text type="secondary">此页面暂无知识点（可能是目录页、标题页或尚未 AI 解析）</Text>
              )}
            </div>
          </div>
        )}
      </Modal>

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
