/**
 * 文档上传页
 * 支持拖拽或点击上传课程资料文件, 上传后引导用户进行下一步操作
 */

import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Typography, Card, Alert, Button, Tag } from 'antd'
import { FileTextOutlined, ArrowRightOutlined } from '@ant-design/icons'
import FileUpload from '../components/common/FileUpload'

const { Title, Text } = Typography

const API_BASE = 'http://localhost:8000/api/v1'

/** 上传结果记录 */
interface UploadRecord {
  id: string
  filename: string
  status: string
}

export default function DocumentUpload() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [uploadedFiles, setUploadedFiles] = useState<UploadRecord[]>([])

  function handleUploadSuccess(response: { document_id: string; filename: string; parse_status: string }) {
    setUploadedFiles((prev) => [
      {
        id: response.document_id,
        filename: response.filename,
        status: response.parse_status,
      },
      ...prev,
    ])
  }

  function handleUploadError(error: Error) {
    console.error('上传失败:', error.message)
  }

  /** 获取状态显示 */
  function getStatusDisplay(status: string): { label: string; color: string } {
    const map: Record<string, { label: string; color: string }> = {
      pending: { label: '待处理', color: 'default' },
      processing: { label: '解析中', color: 'processing' },
      done: { label: '已完成', color: 'success' },
      failed: { label: '失败', color: 'error' },
      chunked: { label: '待向量化', color: 'warning' },
    }
    return map[status] || { label: status, color: 'default' }
  }

  const hasUploaded = uploadedFiles.length > 0

  return (
    <div>
      <Title level={3} style={{ marginBottom: 24 }}>
        上传课程文档
      </Title>

      {/* 上传引导 */}
      <Alert
        message="第一步：上传课程讲义或教材"
        description="支持 PDF、DOCX、PPTX、Markdown、TXT 格式。上传后系统自动解析文本、切片并向量化（需要已配置 Embedding API Key）。"
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      {/* 上传区域 */}
      <Card style={{ marginBottom: 24 }}>
        <FileUpload
          action={`${API_BASE}/courses/${id}/documents/upload`}
          onSuccess={handleUploadSuccess}
          onError={handleUploadError}
        />
      </Card>

      {/* 上传历史 */}
      {hasUploaded && (
        <Card title="上传记录" style={{ marginBottom: 24 }}>
          {uploadedFiles.map((file) => {
            const statusInfo = getStatusDisplay(file.status)
            return (
              <div
                key={file.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: '1px solid #f0f0f0',
                }}
              >
                <Text>{file.filename}</Text>
                <Tag color={statusInfo.color}>{statusInfo.label}</Tag>
              </div>
            )
          })}
        </Card>
      )}

      {/* 下一步引导 */}
      {hasUploaded && (
        <Alert
          message="第二步：将文档切片关联到知识点"
          description={
            <div>
              <p style={{ marginBottom: 8 }}>
                文档已上传并解析为文本切片。现在需要将每个切片关联到具体的课程知识点，这样检索结果才能展示结构化的来源信息。
              </p>
              <Button
                type="primary"
                icon={<ArrowRightOutlined />}
                onClick={() => navigate(`/courses/${id}/documents`)}
              >
                前往文档列表，关联切片到知识点
              </Button>
            </div>
          }
          type="success"
          showIcon
          icon={<FileTextOutlined />}
        />
      )}
    </div>
  )
}
