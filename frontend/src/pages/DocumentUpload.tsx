/**
 * 文档上传页
 * 支持拖拽或点击上传课程资料文件
 */

import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Typography, Card } from 'antd'
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

  return (
    <div>
      <Title level={3} style={{ marginBottom: 24 }}>
        上传课程文档
      </Title>

      {/* 上传区域 */}
      <Card style={{ marginBottom: 24 }}>
        <FileUpload
          action={`${API_BASE}/courses/${id}/documents/upload`}
          onSuccess={handleUploadSuccess}
          onError={handleUploadError}
        />
      </Card>

      {/* 上传历史 */}
      {uploadedFiles.length > 0 && (
        <Card title="上传记录">
          {uploadedFiles.map((file) => (
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
              <Text type={file.status === 'done' ? 'success' : file.status === 'failed' ? 'danger' : 'secondary'}>
                {file.status === 'done'
                  ? '解析完成'
                  : file.status === 'failed'
                    ? '解析失败'
                    : file.status === 'processing'
                      ? '解析中...'
                      : '等待处理'}
              </Text>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
