/**
 * 聊天输入栏组件
 * 包含课程选择器 (知识库对话模式)、文本输入框和发送/停止按钮
 *
 * 快捷键 (与 ChatGPT/Claude 一致):
 *   - Enter        → 发送消息
 *   - Shift+Enter  → 换行
 *   - IME 组合中 Enter → 选词 (不发送)
 *
 * @see branding/MLA_BRAND_GUIDELINES.md
 */

import { useState, useEffect, useRef } from 'react'
import { Select, Button, Tooltip } from 'antd'
import { SendOutlined, StopOutlined, GlobalOutlined } from '@ant-design/icons'
import type { Course } from '../../types'
import { getCourses } from '../../services/api'
import { blue, gray } from '../../styles/tokens'

interface ChatInputProps {
  onSend: (content: string, courseId: string | null) => void
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

  const handleSend = () => {
    const trimmed = inputValue.trim()
    if (!trimmed || streaming) return
    onSend(trimmed, selectedCourseId)
    setInputValue('')
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
    // Shift+Enter → 换行 (textarea 原生行为, 不做任何事)
    // IME 组合中 Enter → 选词 (不做任何事, 由 IME 接管)
  }

  const autoResize = () => {
    const el = textareaRef.current
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 150) + 'px' }
  }

  return (
    <div style={{ borderTop: `1px solid ${gray[200]}`, padding: '12px 16px', background: '#FFFFFF' }}>
      {conversationType === 'chat' && (
        <div style={{ marginBottom: 8 }}>
          <Select
            placeholder="选择关联课程 (可选, 启用知识库检索)"
            value={selectedCourseId}
            onChange={setSelectedCourseId}
            style={{ width: '100%', maxWidth: 400 }}
            allowClear showSearch
            optionFilterProp="label"
            options={courses.map((c) => ({ label: c.name, value: c.id }))}
            size="small"
          />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        {/* 联网搜索开关 — 仅知识库对话模式显示 */}
        {conversationType === 'chat' && onWebSearchToggle && (
          <Tooltip title={webSearchEnabled ? '联网搜索已开启 — 将搜索知乎/B站/小红书等平台' : '开启联网搜索'}>
            <Button
              type="text"
              size="small"
              icon={<GlobalOutlined />}
              onClick={onWebSearchToggle}
              disabled={streaming}
              style={{
                color: webSearchEnabled ? blue[500] : gray[400],
                fontSize: 18,
                width: 32, height: 32,
                borderRadius: 8,
                border: webSearchEnabled ? `1px solid ${blue[300]}` : `1px solid transparent`,
                background: webSearchEnabled ? '#f0f7ff' : 'transparent',
                transition: 'all 0.2s',
              }}
            />
          </Tooltip>
        )}
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
