/**
 * 聊天输入栏组件
 * 包含课程选择器 (知识库对话模式)、文本输入框、图片上传和发送/停止按钮
 *
 * 快捷键 (与 ChatGPT/Claude 一致):
 *   - Enter        → 发送消息
 *   - Shift+Enter  → 换行
 *   - IME 组合中 Enter → 选词 (不发送)
 *
 * @see branding/MLA_BRAND_GUIDELINES.md
 */

import { useState, useEffect, useRef } from 'react'
import { Select, Button, message } from 'antd'
import { SendOutlined, StopOutlined, GlobalOutlined, PictureOutlined, CloseCircleFilled } from '@ant-design/icons'
import type { Course } from '../../types'
import { getCourses, uploadChatImage } from '../../services/api'
import { blue, gray } from '../../styles/tokens'

/** 已知支持多模态的模型关键词 (前端拦截用) */
const VISION_MODEL_KEYWORDS = [
  'gpt-4o', 'gpt-4-turbo', 'gpt-4-vision',
  'claude-3', 'claude-4', 'claude-3.5', 'claude-3-5',
  'gemini', 'vision', 'vl', 'multimodal', 'qvq',
  'qwen-vl', 'doubao-vision', 'yi-vision', 'glm-4v',
]

function isVisionModel(modelName: string): boolean {
  const lower = modelName.toLowerCase()
  return VISION_MODEL_KEYWORDS.some(k => lower.includes(k))
}

interface ChatInputProps {
  onSend: (content: string, courseId: string | null, imageUrls?: string[]) => void
  onStop?: () => void
  streaming?: boolean
  conversationType?: 'chat' | 'profile_collection'
  selectedCourseId?: string | null
  /** 联网搜索开关状态 */
  webSearchEnabled?: boolean
  /** 联网搜索开关切换回调 */
  onWebSearchToggle?: () => void
}

export default function ChatInput({
  onSend, onStop, streaming = false,
  conversationType = 'chat', selectedCourseId: initialCourseId,
  webSearchEnabled = false, onWebSearchToggle,
}: ChatInputProps) {
  const [inputValue, setInputValue] = useState('')
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(initialCourseId || null)
  const [coursesLoaded, setCoursesLoaded] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  /** 已上传的图片 URL 列表 */
  const [imageUrls, setImageUrls] = useState<string[]>([])
  /** 上传中 */
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /**
   * IME 组合状态 — compositionstart 时为 true, compositionend 时为 false
   *
   * 中文/日文输入法中用户按 Enter 是为了从候选列表中选择字词,
   * 此时不应触发发送。通过 isComposingRef 在 keydown 中判断:
   *   - true  → Enter 由 IME 处理 (选词), 不发送
   *   - false → Enter 正常发送消息
   */
  const isComposingRef = useRef(false)

  useEffect(() => {
    if (conversationType !== 'chat' || coursesLoaded) return
    async function loadCourses() {
      try {
        const data = await getCourses(1, 100)
        setCourses(data.items)
      } catch { /* ignore */ }
      setCoursesLoaded(true)
    }
    loadCourses()
  }, [conversationType, coursesLoaded])

  /** 上传图片 */
  const handleUploadImage = async () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      const url = await uploadChatImage(files[0])
      setImageUrls(prev => [...prev, url])
    } catch (err) {
      message.error('图片上传失败: ' + (err as Error).message)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  /** 移除已上传图片 */
  const removeImage = (url: string) => {
    setImageUrls(prev => prev.filter(u => u !== url))
  }

  /** 模型兼容性检查 */
  const checkModelCompatibility = async (): Promise<boolean> => {
    if (imageUrls.length === 0) return true
    try {
      const { getApiConfig } = await import('../../pages/Settings')
      const configs = await getApiConfig()
      const modelName = (configs as Record<string, string>).llm_model || ''
      if (!isVisionModel(modelName)) {
        message.warning(`当前模型 "${modelName}" 可能不支持识别图片，请切换到支持视觉的多模态模型（如 gpt-4o-mini、qwen-vl-plus）`)
        return false
      }
      return true
    } catch {
      // 无法获取模型名称时放行，后端会处理
      return true
    }
  }

  const handleSend = async () => {
    const trimmed = inputValue.trim()
    if (!trimmed || streaming) return

    // 图片兼容性检查
    const compatible = await checkModelCompatibility()
    if (!compatible) return

    onSend(trimmed, selectedCourseId, imageUrls.length > 0 ? imageUrls : undefined)
    setInputValue('')
    setImageUrls([])
    const el = textareaRef.current
    if (el) { el.style.height = 'auto' }
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter 发送 (跳过 IME 组合状态)
    if (e.key === 'Enter' && !isComposingRef.current && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const autoResize = () => {
    const el = textareaRef.current
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 150) + 'px' }
  }

  return (
    <div style={{ borderTop: `1px solid ${gray[200]}`, padding: '12px 16px', background: '#FFFFFF' }}>
      {conversationType === 'chat' && (
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Select
            placeholder="关联课程"
            value={selectedCourseId}
            onChange={setSelectedCourseId}
            style={{ width: 180, flexShrink: 0 }}
            allowClear showSearch
            optionFilterProp="label"
            options={courses.map((c) => ({ label: c.name, value: c.id }))}
            size="small"
          />
          {/* 图片上传按钮 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <button
            onClick={handleUploadImage}
            disabled={streaming || uploading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '3px 12px',
              fontSize: 13,
              fontWeight: 600,
              border: imageUrls.length > 0
                ? `1.5px solid ${blue[400]}`
                : `1.5px solid ${gray[300]}`,
              borderRadius: 20,
              background: imageUrls.length > 0 ? blue[50] : '#FFFFFF',
              color: imageUrls.length > 0 ? blue[500] : gray[500],
              cursor: (streaming || uploading) ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
              whiteSpace: 'nowrap',
              lineHeight: '22px',
              opacity: (streaming || uploading) ? 0.5 : 1,
            }}
          >
            <PictureOutlined style={{ fontSize: 14 }} />
            <span>{uploading ? '上传中...' : '图片'}</span>
          </button>
          {/* 联网搜索开关 */}
          {onWebSearchToggle && (
            <button
              onClick={onWebSearchToggle}
              disabled={streaming}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 12px',
                fontSize: 13,
                fontWeight: 600,
                border: webSearchEnabled
                  ? `1.5px solid ${blue[400]}`
                  : `1.5px solid ${gray[300]}`,
                borderRadius: 20,
                background: webSearchEnabled ? blue[50] : '#FFFFFF',
                color: webSearchEnabled ? blue[500] : gray[500],
                cursor: streaming ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                whiteSpace: 'nowrap',
                lineHeight: '22px',
                opacity: streaming ? 0.5 : 1,
              }}
            >
              <GlobalOutlined style={{ fontSize: 14 }} />
              <span>联网搜索</span>
            </button>
          )}
        </div>
      )}

      {/* 已上传图片预览 */}
      {imageUrls.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          {imageUrls.map(url => (
            <div key={url} style={{ position: 'relative', width: 56, height: 56, borderRadius: 8, overflow: 'hidden', border: `1px solid ${gray[200]}` }}>
              <img src={url} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <CloseCircleFilled
                onClick={() => removeImage(url)}
                style={{ position: 'absolute', top: -2, right: -2, fontSize: 16, color: gray[500], background: '#fff', borderRadius: '50%', cursor: 'pointer' }}
              />
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        <textarea
          ref={textareaRef}
          value={inputValue}
          onChange={(e) => { setInputValue(e.target.value); autoResize() }}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => { isComposingRef.current = true }}
          onCompositionEnd={() => { isComposingRef.current = false }}
          placeholder={
            conversationType === 'profile_collection'
              ? '与 MLA 助手聊聊你的学习情况, Enter 发送, Shift+Enter 换行'
              : '输入你的问题, Enter 发送, Shift+Enter 换行'
          }
          rows={1}
          disabled={streaming}
          style={{
            flex: 1, resize: 'none',
            border: `1px solid ${gray[300]}`,
            borderRadius: 8, padding: '10px 12px',
            fontSize: 14, lineHeight: 1.5, outline: 'none',
            fontFamily: 'inherit', maxHeight: 150,
          }}
          onFocus={(e) => {
            e.target.style.borderColor = blue[500]
            e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.15)'
          }}
          onBlur={(e) => {
            e.target.style.borderColor = gray[300]
            e.target.style.boxShadow = 'none'
          }}
        />

        {streaming ? (
          <Button type="primary" danger icon={<StopOutlined />} onClick={onStop}>停止</Button>
        ) : (
          <Button type="primary" icon={<SendOutlined />} onClick={handleSend}
            disabled={!inputValue.trim()}>发送</Button>
        )}
      </div>
    </div>
  )
}
