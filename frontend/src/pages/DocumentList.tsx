/**
 * 文档列表页
 * 展示课程下的所有文档、解析状态, 支持将切片关联到知识点
 */

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Table, Tag, Typography, Popconfirm, message, Space, Button, Drawer, Select, Alert } from 'antd'
import { DeleteOutlined, EyeOutlined, LinkOutlined } from '@ant-design/icons'
import { getDocuments, deleteDocument, getDocumentDetail, getCourseKnowledgePoints, linkChunkToKp } from '../services/api'
import type { Document, DocumentDetail } from '../types'

const { Title, Text } = Typography

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
                description="请先在课程详情页创建章节和知识点，然后回到这里将切片与知识点关联。"
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}

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
    </div>
  )
}
