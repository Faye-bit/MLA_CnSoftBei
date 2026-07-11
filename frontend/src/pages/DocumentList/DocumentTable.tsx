/**
 * 文档表格组件
 * 展示文档列表 (文件名、类型、大小、状态、切片/页数、上传时间、操作)
 * Props-only, 不发起 API 请求
 */
import { useMemo } from 'react'
import { Table, Tag, Popconfirm, Space, Button, Tooltip } from 'antd'
import { EyeOutlined, DeleteOutlined, ReloadOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import { typeColorMap, statusMap, formatFileSize } from './types'
import type { Document } from '../../types'

interface DocumentTableProps {
  documents: Document[]
  loading: boolean
  page: number
  total: number
  onPageChange: (page: number) => void
  onViewDetail: (docId: string) => void
  onDelete: (docId: string) => void
  onReprocess: (docId: string) => void
}

export function DocumentTable({
  documents, loading, page, total,
  onPageChange, onViewDetail, onDelete, onReprocess,
}: DocumentTableProps) {
  const columns = useMemo(() => [
    { title: '文件名', dataIndex: 'filename', key: 'filename', ellipsis: true },
    {
      title: '类型', dataIndex: 'file_type', key: 'file_type', width: 70,
      render: (t: string) => <Tag color={typeColorMap[t] || 'default'}>{t.toUpperCase()}</Tag>,
    },
    {
      title: '大小', dataIndex: 'file_size', key: 'file_size', width: 80,
      render: (size: number) => formatFileSize(size),
    },
    {
      title: '状态', dataIndex: 'parse_status', key: 'parse_status', width: 100,
      render: (status: string, record: Document) => {
        const info = statusMap[status] || { label: status, color: 'default' }
        const hasError = (status === 'chunked' || status === 'failed') && record.error_message
        return (
          <span>
            <Tag color={info.color}>{info.label}</Tag>
            {hasError && (
              <Tooltip title={record.error_message}>
                <ExclamationCircleOutlined style={{ color: '#faad14', cursor: 'help' }} />
              </Tooltip>
            )}
          </span>
        )
      },
    },
    {
      title: '切片/页数', key: 'count', width: 75,
      render: (_: unknown, record: Document) => {
        if (record.file_type === 'pdf' || record.file_type === 'pptx') {
          return <span>{record.page_count > 0 ? `${record.page_count} 页` : '-'}</span>
        }
        return <span>{record.chunk_count > 0 ? `${record.chunk_count} 片` : '-'}</span>
      },
    },
    {
      title: '上传时间', dataIndex: 'created_at', key: 'created_at', width: 150,
      render: (t: string) => new Date(t).toLocaleString('zh-CN'),
    },
    {
      title: '操作', key: 'actions', width: 280, fixed: 'right' as const,
      render: (_: unknown, record: Document) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => onViewDetail(record.id)}>
            详情与关联
          </Button>
          {record.parse_status === 'chunked' && (
            <Popconfirm
              title="重新向量化?"
              description="将对此文档的已有切片重新执行 Embedding 并写入向量数据库"
              onConfirm={() => onReprocess(record.id)}
              okText="确定" cancelText="取消"
            >
              <Button type="link" size="small" icon={<ReloadOutlined />}>重试向量化</Button>
            </Popconfirm>
          )}
          <Popconfirm
            title="确定删除此文档?"
            description="关联的切片和向量数据将被一并清理"
            onConfirm={() => onDelete(record.id)}
            okText="确定" cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除文档</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ], [onViewDetail, onDelete, onReprocess])

  return (
    <Table
      dataSource={documents}
      columns={columns}
      rowKey="id"
      loading={loading}
      scroll={{ x: 800 }}
      pagination={{
        current: page,
        total,
        pageSize: 20,
        onChange: (p) => onPageChange(p),
        showTotal: (t: number) => `共 ${t} 份文档`,
      }}
      locale={{ emptyText: '暂无文档，请前往上传页面添加课程文档' }}
    />
  )
}
