/**
 * 文档列表页
 * 展示课程下的所有文档及其解析状态
 */

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Table, Tag, Typography, Popconfirm, message, Space, Button, Drawer } from 'antd'
import { DeleteOutlined, EyeOutlined } from '@ant-design/icons'
import { getDocuments, deleteDocument, getDocumentDetail } from '../services/api'
import type { Document, DocumentDetail } from '../types'

const { Title } = Typography

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

  /** 查看文档详情 (含切片) */
  async function handleViewDetail(docId: string) {
    if (!id) return
    setDetailLoading(true)
    setDetailOpen(true)
    try {
      const data = await getDocumentDetail(id, docId)
      setSelectedDoc(data)
    } catch (err) {
      message.error('加载文档详情失败: ' + (err as Error).message)
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
            详情
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
        locale={{ emptyText: '暂无文档，请前往上传页面添加课程资料' }}
      />

      {/* 文档详情抽屉 */}
      <Drawer
        title={selectedDoc ? `文档详情: ${selectedDoc.filename}` : '文档详情'}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={640}
        loading={detailLoading}
      >
        {selectedDoc && (
          <div>
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
                错误: {selectedDoc.error_message}
              </div>
            )}

            <Title level={5}>文本切片 ({selectedDoc.chunks.length})</Title>
            {selectedDoc.chunks.length === 0 ? (
              <div style={{ color: '#8c8c8c' }}>暂无切片</div>
            ) : (
              selectedDoc.chunks.map((chunk) => (
                <div
                  key={chunk.id}
                  style={{
                    marginBottom: 12,
                    padding: 12,
                    background: '#fafafa',
                    borderRadius: 6,
                    fontSize: 13,
                    lineHeight: 1.6,
                  }}
                >
                  <div style={{ color: '#8c8c8c', marginBottom: 4, fontSize: 12 }}>
                    切片 #{chunk.chunk_index} | {chunk.token_count} tokens
                  </div>
                  <div>{chunk.content.slice(0, 300)}{chunk.content.length > 300 ? '...' : ''}</div>
                </div>
              ))
            )}
          </div>
        )}
      </Drawer>
    </div>
  )
}
