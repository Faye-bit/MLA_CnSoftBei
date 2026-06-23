/**
 * 悬浮 AI 助手组件
 * 默认显示为悬浮按钮, 点击展开为聊天窗口 (380×520px)
 * 支持拖动改变位置, 松开后自动吸附到最近的边缘
 *
 * 设计规范 (MLA Brand v2.0):
 * - 使用品牌 token 替代硬编码色值
 * - 标题栏使用纯色品牌蓝, 禁止 AI 渐变
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Button, Spin, Typography, message } from 'antd'
import {
  MessageOutlined, CloseOutlined, SendOutlined, StopOutlined,
  ExpandOutlined, MinusOutlined, DeleteOutlined, PlusOutlined,
} from '@ant-design/icons'
import ChatMessage from '../chat/ChatMessage'
import { getConversationDetail, createConversation, streamChat } from '../../services/api'
import type { Conversation, Message, ChatSource } from '../../types'
import { blue, gray } from '../../styles/tokens'

const { Text } = Typography
const LAST_CONVERSATION_KEY = 'mla-floating-chat-conversation-id'
const PANEL_WIDTH = 380
const PANEL_HEIGHT = 520
const BUTTON_SIZE = 52

export default function FloatingChat() {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [snapSide, setSnapSide] = useState<'left' | 'right'>('right')
  const dragStart = useRef<{ mouseX: number; mouseY: number; elemX: number; elemY: number } | null>(null)
  const floatRef = useRef<HTMLDivElement>(null)
  const collapseBtnRef = useRef<HTMLDivElement>(null)

  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [inputValue, setInputValue] = useState('')

  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingSources, setStreamingSources] = useState<ChatSource[]>([])
  const streamingContentRef = useRef('')
  const streamingSourcesRef = useRef<ChatSource[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)
  /**
   * 追踪用户是否已在本轮会话中发送过消息
   * 用于防止 loadConversationById 在流式进行中覆盖本地消息状态
   */
  const hasSentMessageRef = useRef(false)
  /** IME 组合状态: 输入法激活时 Enter 只选词不发送 */
  const isComposingRef = useRef(false)
  /** 输入框 DOM 引用 — 用于自适应高度 */
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { return () => { abortControllerRef.current?.abort() } }, [])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streamingContent])

  useEffect(() => {
    if (!visible) return
    const savedConversationId = localStorage.getItem(LAST_CONVERSATION_KEY)
    if (savedConversationId) {
      loadConversationById(savedConversationId).catch(() => { createNewConversation() })
    } else { createNewConversation() }
  }, [visible])

  async function loadConversationById(id: string) {
    setMessagesLoading(true)
    try {
      const detail = await getConversationDetail(id)
      /**
       * 仅在用户未发送消息时才覆盖 conversation 和 messages
       * 如果已发送, 状态由 handleSend/onDone/onError 管理,
       * 避免慢速 API 响应覆盖已更新的本地状态;
       * 同时也避免重置 streamingContentRef 干扰正在进行的流式输出
       */
      if (!hasSentMessageRef.current) {
        /** 对齐 Chat.tsx handleSelectConversation: 加载对话前重置流式状态 */
        setStreaming(false); setStreamingContent(''); setStreamingSources([])
        streamingContentRef.current = ''; streamingSourcesRef.current = []
        setConversation({ id: detail.id, user_id: detail.user_id, course_id: detail.course_id, title: detail.title, conversation_type: detail.conversation_type, profile_collection_stage: detail.profile_collection_stage, message_count: detail.message_count, created_at: detail.created_at, updated_at: detail.updated_at })
        setMessages(detail.messages || [])
      }
    } finally { setMessagesLoading(false) }
  }

  async function createNewConversation() {
    hasSentMessageRef.current = false
    setMessagesLoading(true)
    try {
      const conv = await createConversation({ conversation_type: 'chat', title: '快速问答' })
      setConversation(conv); setMessages([])
      localStorage.setItem(LAST_CONVERSATION_KEY, conv.id)
    } catch { /* ignore */ } finally { setMessagesLoading(false) }
  }

  async function handleDeleteAndNew() {
    /** 不再删除旧会话 — 保留在数据库中供"AI问答"页面访问 */
    setConversation(null); setMessages([])
    localStorage.removeItem(LAST_CONVERSATION_KEY)
    await createNewConversation()
    message.success('已开始新对话')
  }

  async function handleSend() {
    const content = inputValue.trim()
    if (!content || streaming || !conversation) return

    /** 标记本会话已发送消息, 防止 loadConversationById 覆盖本地消息 */
    hasSentMessageRef.current = true

    const userMsg: Message = { id: 'temp-' + Date.now(), conversation_id: conversation.id, role: 'user', content, sources: null, message_metadata: null, created_at: new Date().toISOString() }
    setMessages((prev) => [...prev, userMsg]); setInputValue('')
    /** 发送后重置输入框高度 */
    const el = textareaRef.current
    if (el) { el.style.height = 'auto' }

    streamingContentRef.current = ''; streamingSourcesRef.current = []
    setStreaming(true); setStreamingContent(''); setStreamingSources([])
    const convSnapshot = conversation

    abortControllerRef.current = streamChat(convSnapshot.id, content, convSnapshot.course_id, {
      onContent: (chunk) => { streamingContentRef.current += chunk; setStreamingContent(streamingContentRef.current) },
      onSources: (sources) => { streamingSourcesRef.current = sources; setStreamingSources(sources) },
      onDone: (messageId) => {
        /** 必须先将 ref 内容保存到局部变量, 再调用 setMessages
         *  React 19 自动批处理状态下, setMessages 的 updater 回调
         *  可能在 streamingContentRef 被重置之后才执行,
         *  导致 AI 回复内容丢失 (空气泡 bug) */
        const finalContent = streamingContentRef.current
        const finalSources = streamingSourcesRef.current
        setMessages((prev) => [...prev, { id: messageId, conversation_id: convSnapshot.id, role: 'assistant', content: finalContent, sources: finalSources.length > 0 ? finalSources : null, message_metadata: null, created_at: new Date().toISOString() }])
        setStreaming(false); setStreamingContent(''); setStreamingSources([]); streamingContentRef.current = ''; streamingSourcesRef.current = []
      },
      onError: (error) => {
        message.error('回复生成失败: ' + error)
        const partial = streamingContentRef.current
        if (partial) setMessages((prev) => [...prev, { id: 'error-' + Date.now(), conversation_id: convSnapshot.id, role: 'assistant', content: partial + '\n\n[回复中断: ' + error + ']', sources: streamingSourcesRef.current.length > 0 ? streamingSourcesRef.current : null, message_metadata: null, created_at: new Date().toISOString() }])
        setStreaming(false); setStreamingContent(''); setStreamingSources([]); streamingContentRef.current = ''; streamingSourcesRef.current = []
      },
    })
  }

  function handleStop() {
    abortControllerRef.current?.abort()
    hasSentMessageRef.current = false
    const partial = streamingContentRef.current
    if (partial && conversation) setMessages((prev) => [...prev, { id: 'partial-' + Date.now(), conversation_id: conversation.id, role: 'assistant', content: partial + '\n\n[已停止]', sources: streamingSourcesRef.current.length > 0 ? streamingSourcesRef.current : null, message_metadata: null, created_at: new Date().toISOString() }])
    setStreaming(false); setStreamingContent(''); setStreamingSources([]); streamingContentRef.current = ''; streamingSourcesRef.current = []
  }

  /**
   * 输入框自适应高度 — 根据文字内容自动伸缩
   * 最小 1 行高度 (≈34px), 最大不超过 120px
   */
  const autoResize = () => {
    const el = textareaRef.current
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px' }
  }

  // Drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); const el = floatRef.current; if (!el) return
    dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, elemX: el.getBoundingClientRect().left, elemY: el.getBoundingClientRect().top }
    setDragging(true)
  }, [])

  useEffect(() => {
    if (!dragging) return
    const mm = (e: MouseEvent) => { if (!dragStart.current) return; setPosition({ x: dragStart.current.elemX + e.clientX - dragStart.current.mouseX, y: dragStart.current.elemY + e.clientY - dragStart.current.mouseY }) }
    const mu = () => { setDragging(false); dragStart.current = null; if (floatRef.current) { const r = floatRef.current.getBoundingClientRect(); setSnapSide(r.left + r.width / 2 < window.innerWidth / 2 ? 'left' : 'right'); setPosition(null) } }
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu)
    return () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu) }
  }, [dragging])

  const collapseDragStart = useRef<{ mouseY: number; top: number } | null>(null)
  const [collapseTop, setCollapseTop] = useState<number | null>(null)

  const handleCollapseDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation(); const btn = collapseBtnRef.current; if (!btn) return
    collapseDragStart.current = { mouseY: e.clientY, top: btn.getBoundingClientRect().top }
    const mm = (ev: MouseEvent) => { if (!collapseDragStart.current) return; setCollapseTop(Math.max(60, Math.min(window.innerHeight - BUTTON_SIZE - 20, collapseDragStart.current.top + ev.clientY - collapseDragStart.current.mouseY))) }
    const mu = () => { collapseDragStart.current = null; window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu) }
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu)
  }, [])

  const panelStyle = useMemo((): React.CSSProperties => {
    if (position) return { position: 'fixed', left: position.x, top: position.y, width: PANEL_WIDTH, height: PANEL_HEIGHT, zIndex: 1050 }
    return { position: 'fixed', [snapSide]: 12, top: collapseTop != null ? collapseTop : 'calc(50vh - 260px)', width: PANEL_WIDTH, height: PANEL_HEIGHT, zIndex: 1050, transition: dragging ? 'none' : 'left 0.25s ease, right 0.25s ease' }
  }, [position, snapSide, collapseTop, dragging])

  const collapseBtnStyle = useMemo((): React.CSSProperties => ({
    position: 'fixed', [snapSide]: -4, top: collapseTop != null ? collapseTop : 'calc(50vh - 26px)',
    width: BUTTON_SIZE, height: BUTTON_SIZE, zIndex: 1049, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab', transition: 'all 0.25s ease',
    borderRadius: snapSide === 'left' ? '0 12px 12px 0' : '12px 0 0 12px',
  }), [snapSide, collapseTop])

  function handleClose() {
    /** 仅在实际流式进行中时才中止请求, 避免已完成流式上的副作用 */
    if (streaming) abortControllerRef.current?.abort()
    /** 重置发送标记, 下次打开面板时允许从服务器加载最新消息 */
    hasSentMessageRef.current = false
    setVisible(false); setStreaming(false); setStreamingContent(''); setStreamingSources([])
    streamingContentRef.current = ''; streamingSourcesRef.current = []
  }

  return (
    <>
      {!visible && (
        <div ref={collapseBtnRef} style={collapseBtnStyle} onMouseDown={handleCollapseDragStart}>
          <Button type="primary" shape="circle" size="large" icon={<MessageOutlined style={{ fontSize: 20 }} />}
            onClick={() => setVisible(true)}
            style={{ width: BUTTON_SIZE, height: BUTTON_SIZE, boxShadow: `0 4px 16px rgba(59,130,246,0.35)`, cursor: 'pointer' }} />
        </div>
      )}

      {visible && (
        <div ref={floatRef} style={{ ...panelStyle, background: '#FFFFFF', borderRadius: 12, boxShadow: `0 8px 40px rgba(15,23,42,0.12)`, display: 'flex', flexDirection: 'column', overflow: 'hidden', border: `1px solid ${gray[200]}`, userSelect: dragging ? 'none' : 'auto' }}>
          {/* 标题栏 — 纯色品牌蓝, 禁止渐变 */}
          <div onMouseDown={handleDragStart} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: blue[500], color: '#FFFFFF', cursor: dragging ? 'grabbing' : 'grab', flexShrink: 0, userSelect: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <img src="/brand/字母标Logo.svg" alt="MLA" style={{ width: 18, height: 18 }} />
              <span style={{ fontWeight: 600, fontSize: 14 }}>{conversation?.title || 'AI 助手'}</span>
            </div>
            <div style={{ display: 'flex', gap: 2 }}>
              <Button type="text" size="small" icon={<PlusOutlined />} onClick={(e) => { e.stopPropagation(); handleDeleteAndNew() }} style={{ color: '#FFFFFF' }} title="新对话" />
              <Button type="text" size="small" icon={<MinusOutlined />} onClick={(e) => { e.stopPropagation(); handleClose() }} style={{ color: '#FFFFFF' }} title="最小化" />
            </div>
          </div>

          {/* 消息列表 */}
          <div style={{ flex: 1, overflow: 'auto', padding: '12px 14px', background: gray[50], minHeight: 0 }}>
            {messagesLoading ? (
              <div style={{ textAlign: 'center', padding: 40 }}><Spin size="small" /></div>
            ) : messages.length === 0 && !streaming ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, opacity: 0.6 }}>
                <img src="/brand/字母标Logo.svg" alt="MLA 智学引擎" style={{ width: 80, height: 80, opacity: 0.85 }} />
                <Text type="secondary" style={{ fontSize: 13 }}>基于课程知识库的 AI 助手</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>输入你的问题, 我会在资料中寻找答案</Text>
              </div>
            ) : (
              <>
                {messages.map((msg) => <ChatMessage key={msg.id} role={msg.role} content={msg.content} sources={msg.sources} createdAt={msg.created_at} />)}
                {streaming && streamingContent && <ChatMessage role="assistant" content={streamingContent} sources={streamingSources} streaming />}
                {streaming && !streamingContent && <div style={{ textAlign: 'center', padding: 16 }}><Spin size="small" /> <Text type="secondary" style={{ fontSize: 12 }}>思考中...</Text></div>}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* 输入区域 */}
          <div style={{ borderTop: `1px solid ${gray[200]}`, padding: '8px 10px', background: '#FFFFFF', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
              <textarea ref={textareaRef} value={inputValue}
                onChange={(e) => { setInputValue(e.target.value); autoResize() }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !isComposingRef.current && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                onCompositionStart={() => { isComposingRef.current = true }}
                onCompositionEnd={() => { isComposingRef.current = false }}
                placeholder="输入问题, Enter 发送, Shift+Enter 换行" rows={1} disabled={streaming || messagesLoading}
                style={{ flex: 1, resize: 'none', border: `1px solid ${gray[300]}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, lineHeight: 1.4, outline: 'none', fontFamily: 'inherit', maxHeight: 120, minHeight: 34 }}
                onFocus={(e) => { e.target.style.borderColor = blue[500]; e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.15)' }}
                onBlur={(e) => { e.target.style.borderColor = gray[300]; e.target.style.boxShadow = 'none' }} />
              {streaming ? (
                <Button type="primary" danger size="small" icon={<StopOutlined />} onClick={handleStop} />
              ) : (
                <Button type="primary" size="small" icon={<SendOutlined />} onClick={handleSend} disabled={!inputValue.trim() || messagesLoading} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
