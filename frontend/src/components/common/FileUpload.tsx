/**
 * 文件上传组件
 * 支持拖拽上传和点击选择, 自动识别文件类型
 * 用于课程资料的批量上传场景
 */

import { Upload, message, Tag, Space } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import type { UploadProps } from 'antd'
import { useAuthStore } from '../../store'

const { Dragger } = Upload

/** 支持的文件类型及对应颜色 */
const ACCEPTED_TYPES = '.pdf,.docx,.pptx,.md,.txt'

/** 格式列表，供标签展示 */
const FORMAT_LIST = [
  { ext: 'PDF', color: 'red' },
  { ext: 'DOCX', color: 'blue' },
  { ext: 'PPTX', color: 'orange' },
  { ext: 'Markdown', color: 'purple' },
  { ext: 'TXT', color: 'default' },
]

interface FileUploadProps {
  /** 上传接口地址 */
  action: string
  /** 上传成功回调 */
  onSuccess?: (response: { document_id: string; filename: string; parse_status: string }) => void
  /** 上传失败回调 */
  onError?: (error: Error) => void
}

export default function FileUpload({ action, onSuccess, onError }: FileUploadProps) {
  const token = useAuthStore((s) => s.token)

  const uploadProps: UploadProps = {
    name: 'file',
    multiple: false,
    accept: ACCEPTED_TYPES,
    action,
    showUploadList: true,
    // 覆盖默认的上传行为, 手动发 fetch 并附 JWT Token
    customRequest: async (options) => {
      const { file, onSuccess: uploadSuccess, onError: uploadError } = options
      const formData = new FormData()
      formData.append('file', file as File)

      try {
        const headers: Record<string, string> = {}
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        }
        const response = await fetch(action, {
          method: 'POST',
          headers,
          body: formData,
        })
        const result = await response.json()
        if (result.code === 0) {
          uploadSuccess?.(result.data)
          message.success(`${(file as File).name} 上传成功`)
          onSuccess?.(result.data)
        } else {
          throw new Error(result.message || '上传失败')
        }
      } catch (err) {
        uploadError?.(err as Error)
        message.error(`${(file as File).name} 上传失败`)
        onError?.(err as Error)
      }
    },
    // 上传前校验
    beforeUpload: (file) => {
      const isValidType = ACCEPTED_TYPES.split(',').some((ext) =>
        file.name.toLowerCase().endsWith(ext.replace('.', ''))
      )
      if (!isValidType) {
        message.error(`不支持的文件类型: ${file.name}`)
        return false
      }
      const maxSize = 50 * 1024 * 1024 // 50MB
      if (file.size > maxSize) {
        message.error(`文件太大: ${(file.size / 1024 / 1024).toFixed(1)}MB > 50MB`)
        return false
      }
      return true
    },
  }

  return (
    <Dragger {...uploadProps}>
      <p className="ant-upload-drag-icon">
        <InboxOutlined />
      </p>
      <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
      <p className="ant-upload-hint">
        单文件最大 50MB，上传后自动解析并向量化
      </p>
      <div style={{ marginTop: 12 }}>
        <Space size={4} wrap>
          {FORMAT_LIST.map((f) => (
            <Tag key={f.ext} color={f.color} style={{ fontSize: 13, padding: '2px 10px' }}>
              {f.ext}
            </Tag>
          ))}
        </Space>
      </div>
    </Dragger>
  )
}
