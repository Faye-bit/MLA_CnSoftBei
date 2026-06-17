/**
 * 悬浮 AI 助手组件
 *
 * 功能:
 * - 默认显示为悬浮按钮 (固定在页面右侧边缘)
 * - 点击展开为聊天窗口 (380×520px)
 * - 支持拖动改变位置, 松开后自动吸附到最近的边缘
 * - 完全复用项目已有的 ChatMessage 和流式对话 API
 * - 自动记录最近使用的对话 ID (localStorage), 关闭再开启默认接续
 *
 * 设计统一: Ant Design 风格, 与 AppLayout 视觉一致
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Button, Select, Spin, Typography, message } from 'antd'
import {
  MessageOutlined,
  CloseOutlined,
  SendOutlined,
  StopOutlined,
  RobotOutlined,
  ExpandOutlined,
  MinusOutlined,
  DeleteOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import ChatMessage from '../chat/ChatMessage'
import {
  getConversations,
  getConversationDetail,
  createConversation,
  deleteConversation,
  streamChat,
} from '../../services/api'
import type { Conversation, Message, ChatSource } from '../../types'

const { Text } = Typography

/** localStorage 键: 记录最近使用的对话 ID */
const LAST_CONVERSATION_KEY = 'mla-floating-chat-conversation-id'

/** 悬浮窗默认尺寸 */
const PANEL_WIDTH = 380
const PANEL_HEIGHT = 520

/** 悬浮按钮尺寸 */
const BUTTON_SIZE = 52

export default function FloatingChat() {
  // ==================== 展开/折叠 ====================
  const [visible, setVisible] = useState(false)

  // ==================== 拖动状态 ====================
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [snapSide, setSnapSide] = useState<'left' | 'right'>('right')
  const dragStart = useRef<{ mouseX: number; mouseY: number; elemX: number; elemY: number } | null>(null)
  const floatRef = useRef<HTMLDivElement>(null)
  const collapseBtnRef = useRef<HTMLDivElement>(null)

  // ==================== 对话状态 ====================
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [sending, setSending] = useState(false)

  // ==================== SSE 流式状态 ====================
  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingSources, setStreamingSources] = useState<ChatSource[]>([])
  const streamingContentRef = useRef('')
  const streamingSourcesRef = useRef<ChatSource[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)

  // ==================== 消息列表滚动 ====================
  const messagesEndRef = useRef<HTMLDivElement>(null)

  /** 自动滚动到底部 */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // ==================== 初始化 + 恢复上次对话 ====================
  useEffect(() => {
    if (!visible) return // 展开时才加载

    const savedConversationId = localStorage.getItem(LAST_CONVERSATION_KEY)
    if (savedConversationId) {
      // 尝试恢复上次的对话
      loadConversationById(savedConversationId).catch(() => {
        // 如果对话不存在/失败, 创建新的
        createNewConversation()
      })
    } else {
      // 首次使用, 自动创建新对话
      createNewConversation()
    }
  }, [visible])

  /** 通过 ID 加载对话 */
  async function loadConversationById(id: string) {
    setMessagesLoading(true)
    try {
      const detail = await getConversationDetail(id)
      setConversation({
        id: detail.id,
        user_id: detail.user_id,
        course_id: detail.course_id,
        title: detail.title,
        conversation_type: detail.conversation_type,
        profile_collection_stage: detail.profile_collection_stage,
        message_count: detail.message_count,
        created_at: detail.created_at,
        updated_at: detail.updated_at,
      })
      setMessages(detail.messages || [])
    } finally {
      setMessagesLoading(false)
    }
  }

  /** 创建新对话 */
  async function createNewConversation() {
    setMessagesLoading(true)
    try {
      const conv = await createConversation({
        conversation_type: 'chat',
        title: '快速问答',
      })
      setConversation(conv)
      setMessages([])
      localStorage.setItem(LAST_CONVERSATION_KEY, conv.id)
    } catch (err) {
      // 静默失败
    } finally {
      setMessagesLoading(false)
    }
  }

  /** 删除当前对话并新建 */
  async function handleDeleteAndNew() {
    if (conversation) {
      try { await deleteConversation(conversation.id) } catch { /* ignore */ }
    }
    setConversation(null)
    setMessages([])
    localStorage.removeItem(LAST_CONVERSATION_KEY)
    await createNewConversation()
    message.success('已开始新对话')
  }

  /** 发送消息 */
  async function handleSend() {
    const content = inputValue.trim()
    if (!content || streaming || !conversation) return

    // 添加用户消息
    const userMsg: Message = {
      id: 'temp-' + Date.now(),
      conversation_id: conversation.id,
      role: 'user',
      content,
      sources: null,
      message_metadata: null,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInputValue('')
    setSending(true)

    // 开始 SSE 流式
    streamingContentRef.current = ''
    streamingSourcesRef.current = []
    setStreaming(true)
    setStreamingContent('')
    setStreamingSources([])

    const convSnapshot = conversation

    abortControllerRef.current = streamChat(
      convSnapshot.id,
      content,
      convSnapshot.course_id,
      {
        onContent: (chunk) => {
          streamingContentRef.current += chunk
          setStreamingContent(streamingContentRef.current)
        },
        onSources: (sources) => {
          streamingSourcesRef.current = sources
          setStreamingSources(sources)
        },
        onDone: (messageId) => {
          const finalContent = streamingContentRef.current
          const finalSources = streamingSourcesRef.current

          const assistantMsg: Message = {
            id: messageId,
            conversation_id: convSnapshot.id,
            role: 'assistant',
            content: finalContent,
            sources: finalSources.length > 0 ? finalSources : null,
            message_metadata: null,
            created_at: new Date().toISOString(),
          }
          setMessages((prev) => [...prev, assistantMsg])
          setStreaming(false)
          setStreamingContent('')
          setStreamingSources([])
          setSending(false)
          streamingContentRef.current = ''
          streamingSourcesRef.current = ''
        },
        onError: (error) => {
          message.error('回复生成失败: ' + error)
          const partialContent = streamingContentRef.current
          if (partialContent) {
            const errorMsg: Message = {
              id: 'error-' + Date.now(),
              conversation_id: convSnapshot.id,
              role: 'assistant',
              content: partialContent + '\n\n[回复中断: ' + error + ']',
              sources: streamingSourcesRef.current.length > 0 ? streamingSourcesRef.current : null,
              message_metadata: null,
              created_at: new Date().toISOString(),
            }
            setMessages((prev) => [...prev, errorMsg])
          }
          setStreaming(false)
          setStreamingContent('')
          setStreamingSources([])
          setSending(false)
          streamingContentRef.current = ''
          streamingSourcesRef.current = ''
        },
      }
    )
  }

  /** 停止生成 */
  function handleStop() {
    abortControllerRef.current?.abort()
    const partialContent = streamingContentRef.current
    if (partialContent && conversation) {
      const partialMsg: Message = {
        id: 'partial-' + Date.now(),
        conversation_id: conversation.id,
        role: 'assistant',
        content: partialContent + '\n\n[已停止]',
        sources: streamingSourcesRef.current.length > 0 ? streamingSourcesRef.current : null,
        message_metadata: null,
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, partialMsg])
    }
    setStreaming(false)
    setStreamingContent('')
    setStreamingSources([])
    streamingContentRef.current = ''
    streamingSourcesRef.current = ''
    setSending(false)
  }

  // ==================== 拖动处理 ====================

  /** 开始拖动 (mousedown on panel header) */
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const el = floatRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    dragStart.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      elemX: rect.left,
      elemY: rect.top,
    }
    setDragging(true)
  }, [])

  /** 拖动中 */
  useEffect(() => {
    if (!dragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStart.current) return
      const dx = e.clientX - dragStart.current.mouseX
      const dy = e.clientY - dragStart.current.mouseY
      const newX = dragStart.current.elemX + dx
      const newY = dragStart.current.elemY + dy
      setPosition({ x: newX, y: newY })
    }

    const handleMouseUp = () => {
      setDragging(false)
      dragStart.current = null

      // 松开后自动吸附到最近的边缘
      if (floatRef.current) {
        const rect = floatRef.current.getBoundingClientRect()
        const centerX = rect.left + rect.width / 2
        const screenMid = window.innerWidth / 2
        setSnapSide(centerX < screenMid ? 'left' : 'right')
        // 清掉 position 让 CSS 接管吸附
        setPosition(null)
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragging])

  // ==================== 折叠按钮拖动 ====================

  const collapseDragStart = useRef<{ mouseY: number; top: number } | null>(null)
  const [collapseTop, setCollapseTop] = useState<number | null>(null)

  const handleCollapseDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const btn = collapseBtnRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    collapseDragStart.current = {
      mouseY: e.clientY,
      top: rect.top,
    }
    const handleMove = (ev: MouseEvent) => {
      if (!collapseDragStart.current) return
      const dy = ev.clientY - collapseDragStart.current.mouseY
      const newTop = Math.max(60, Math.min(window.innerHeight - BUTTON_SIZE - 20, collapseDragStart.current.top + dy))
      setCollapseTop(newTop)
    }
    const handleUp = () => {
      collapseDragStart.current = null
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [])

  // ==================== 计算定位 ====================

  /** 展开窗口的定位样式 */
  const panelStyle = (): React.CSSProperties => {
    if (position) {
      // 拖动中: 自由定位
      return {
        position: 'fixed',
        left: position.x,
        top: position.y,
        width: PANEL_WIDTH,
        height: PANEL_HEIGHT,
        zIndex: 1050,
      }
    }
    // 吸附模式
    const style: React.CSSProperties = {
      position: 'fixed',
      [snapSide]: 12,
      top: collapseTop != null ? collapseTop : 'calc(50vh - 260px)',
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      zIndex: 1050,
      transition: dragging ? 'none' : 'left 0.25s ease, right 0.25s ease',
    }
    if (snapSide === 'left') {
      delete (style as any).right
      style.left = 12
    } else {
      delete (style as any).left
      style.right = 12
    }
    return style
  }

  /** 折叠按钮的定位样式 */
  const collapseBtnStyle = (): React.CSSProperties => {
    const style: React.CSSProperties = {
      position: 'fixed',
      [snapSide]: snapSide === 'right' ? -4 : -4,
      top: collapseTop != null ? collapseTop : 'calc(50vh - 26px)',
      width: BUTTON_SIZE,
      height: BUTTON_SIZE,
      zIndex: 1049,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'grab',
      transition: 'all 0.25s ease',
    }
    if (snapSide === 'left') {
      style.left = -4
      style.borderRadius = '0 12px 12px 0'
    } else {
      style.right = -4
      style.borderRadius = '12px 0 0 12px'
    }
    return style
  }

  // ==================== 关闭面板 ====================
  function handleClose() {
    setVisible(false)
    setStreaming(false)
    setStreamingContent('')
    setStreamingSources([])
    streamingContentRef.current = ''
    streamingSourcesRef.current = ''
    setSending(false)
  }

  // ==================== 渲染 ====================
  const { token: antdToken } = { token: { colorBgContainer: '#fff', colorBorderSecondary: '#f0f0f0', borderRadiusLG: 8 } }

  return (
    <>
      {/* ====== 折叠状态: 悬浮按钮 ====== */}
      {!visible && (
        <div
          ref={collapseBtnRef}
          style={collapseBtnStyle()}
          onMouseDown={handleCollapseDragStart}
        >
          <Button
            type="primary"
            shape="circle"
            size="large"
            icon={<MessageOutlined style={{ fontSize: 20 }} />}
            onClick={() => setVisible(true)}
            style={{
              width: BUTTON_SIZE,
              height: BUTTON_SIZE,
              boxShadow: '0 4px 16px rgba(22,119,255,0.35)',
              cursor: 'pointer',
            }}
          />
        </div>
      )}

      {/* ====== 展开状态: 聊天窗口 ====== */}
      {visible && (
        <div
          ref={floatRef}
          style={{
            ...panelStyle(),
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 8px 40px rgba(0,0,0,0.15)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            border: '1px solid #e8e8e8',
            userSelect: dragging ? 'none' : 'auto',
          }}
        >
          {/* --- 标题栏 (可拖动) --- */}
          <div
            onMouseDown={handleDragStart}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              background: 'linear-gradient(135deg, #1677ff 0%, #0958d9 100%)',
              color: '#fff',
              cursor: dragging ? 'grabbing' : 'grab',
              flexShrink: 0,
              userSelect: 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <RobotOutlined style={{ fontSize: 16 }} />
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                {conversation?.title || 'AI 助手'}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 2 }}>
              {/* 新建对话 */}
              <Button
                type="text"
                size="small"
                icon={<PlusOutlined />}
                onClick={(e) => { e.stopPropagation(); handleDeleteAndNew() }}
                style={{ color: '#fff' }}
                title="新对话"
              />
              {/* 关闭 */}
              <Button
                type="text"
                size="small"
                icon={<MinusOutlined />}
                onClick={(e) => { e.stopPropagation(); handleClose() }}
                style={{ color: '#fff' }}
                title="最小化"
              />
            </div>
          </div>

          {/* --- 消息列表 --- */}
          <div
            style={{
              flex: 1,
              overflow: 'auto',
              padding: '12px 14px',
              background: '#fafbfc',
              minHeight: 0,
            }}
          >
            {messagesLoading ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <Spin size="small" />
              </div>
            ) : messages.length === 0 && !streaming ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  gap: 8,
                  opacity: 0.6,
                }}
              >
                <RobotOutlined style={{ fontSize: 40, color: '#1677ff' }} />
                <Text type="secondary" style={{ fontSize: 13 }}>
                  基于课程知识库的 AI 助手
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  输入你的问题, 我会在资料中寻找答案
                </Text>
              </div>
            ) : (
              <>
                {messages.map((msg) => (
                  <ChatMessage
                    key={msg.id}
                    role={msg.role}
                    content={msg.content}
                    sources={msg.sources}
                    createdAt={msg.created_at}
                  />
                ))}

                {/* 流式生成中的消息 */}
                {streaming && streamingContent && (
                  <ChatMessage
                    role="assistant"
                    content={streamingContent}
                    sources={streamingSources}
                  />
                )}

                {streaming && !streamingContent && (
                  <div style={{ textAlign: 'center', padding: 16 }}>
                    <Spin size="small" /> <Text type="secondary" style={{ fontSize: 12 }}>思考中...</Text>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* --- 输入区域 --- */}
          <div
            style={{
              borderTop: '1px solid #f0f0f0',
              padding: '8px 10px',
              background: '#fff',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                placeholder="输入问题..."
                rows={1}
                disabled={streaming}
                style={{
                  flex: 1,
                  resize: 'none',
                  border: '1px solid #d9d9d9',
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 13,
                  lineHeight: 1.4,
                  outline: 'none',
                  fontFamily: 'inherit',
                  maxHeight: 80,
                  minHeight: 34,
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
                  size="small"
                  icon={<StopOutlined />}
                  onClick={handleStop}
                />
              ) : (
                <Button
                  type="primary"
                  size="small"
                  icon={<SendOutlined />}
                  onClick={handleSend}
                  disabled={!inputValue.trim()}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
