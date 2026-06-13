/**
 * 聊天输入栏组件
 * 包含课程选择器 (知识库对话模式)、文本输入框和发送/停止按钮
 * 支持 Enter 发送, Shift+Enter 换行
 */

import { useState, useEffect, useRef } from 'react'
import { Select, Button } from 'antd'
import { SendOutlined, StopOutlined } from '@ant-design/icons'
import type { Course } from '../../types'
import { getCourses } from '../../services/api'

interface ChatInputProps {
  /** 发送消息回调 */
  onSend: (content: string, courseId: string | null) => void
  /** 停止生成回调 */
  onStop?: () => void
  /** 是否正在生成中 */
  streaming?: boolean
  /** 对话类型: chat 时显示课程选择器 */
  conversationType?: 'chat' | 'profile_collection'
  /** 当前选中的课程 ID */
  selectedCourseId?: string | null
}

export default function ChatInput({
  onSend,
  onStop,
  streaming = false,
  conversationType = 'chat',
  selectedCourseId: initialCourseId,
}: ChatInputProps) {
  const [inputValue, setInputValue] = useState('')
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(initialCourseId || null)
  const [coursesLoaded, setCoursesLoaded] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  /** 加载课程列表 (仅知识库对话模式) */
  useEffect(() => {
    if (conversationType !== 'chat' || coursesLoaded) return
    async function loadCourses() {
      try {
        const data = await getCourses(1, 100)
        setCourses(data.items)
      } catch {
        // ignore
      }
      setCoursesLoaded(true)
    }
    loadCourses()
  }, [conversationType, coursesLoaded])

  /** 发送消息 */
  const handleSend = () => {
    const trimmed = inputValue.trim()
    if (!trimmed || streaming) return
    onSend(trimmed, selectedCourseId)
    setInputValue('')
    // 聚焦回输入框
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  /** 键盘事件处理 */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter 发送, Shift+Enter 换行
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  /** 自动调整 textarea 高度 */
  const autoResize = () => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 150) + 'px'
    }
  }

  return (
    <div
      style={{
        borderTop: '1px solid #f0f0f0',
        padding: '12px 16px',
        background: '#fff',
      }}
    >
      {/* 课程选择器 (仅知识库对话模式) */}
      {conversationType === 'chat' && (
        <div style={{ marginBottom: 8 }}>
          <Select
            placeholder="选择关联课程 (可选, 启用知识库检索)"
            value={selectedCourseId}
            onChange={setSelectedCourseId}
            style={{ width: '100%', maxWidth: 400 }}
            allowClear
            showSearch
            optionFilterProp="label"
            options={courses.map((c) => ({ label: c.name, value: c.id }))}
            size="small"
          />
        </div>
      )}

      {/* 输入区域 */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        <textarea
          ref={textareaRef}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value)
            autoResize()
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            conversationType === 'profile_collection'
              ? '与 MLA 助手聊聊你的学习情况...'
              : '输入你的问题, Shift+Enter 换行, Enter 发送...'
          }
          rows={1}
          disabled={streaming}
          style={{
            flex: 1,
            resize: 'none',
            border: '1px solid #d9d9d9',
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 14,
            lineHeight: 1.5,
            outline: 'none',
            fontFamily: 'inherit',
            maxHeight: 150,
          }}
          onFocus={(e) => {
            e.target.style.borderColor = '#1677ff'
            e.target.style.boxShadow = '0 0 0 2px rgba(22,119,255,0.1)'
          }}
          onBlur={(e) => {
            e.target.style.borderColor = '#d9d9d9'
            e.target.style.boxShadow = 'none'
          }}
        />

        {streaming ? (
          <Button
            type="primary"
            danger
            icon={<StopOutlined />}
            onClick={onStop}
          >
            停止
          </Button>
        ) : (
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSend}
            disabled={!inputValue.trim()}
          >
            发送
          </Button>
        )}
      </div>
    </div>
  )
}
