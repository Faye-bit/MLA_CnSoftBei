/**
 * 悬浮 AI 助手容器组件
 * 悬浮按钮: 固定在屏幕右侧, 可纵向拖动, 点击呼出聊天面板
 * 聊天面板: 可拖动标题栏移动位置, 可拖拽右下角缩放尺寸
 * 面板位置与按钮位置互不关联
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { message } from 'antd'
import { getConversationDetail, createConversation, condenseAndStoreExplanation, deleteAIExplanation } from '../../services/api'
import { useStreamChat } from '../../hooks/useStreamChat'
import { useDraggable } from '../../hooks/useDraggable'
import { useQuickAskStore } from '../../store/quickAsk'
import type { QuickAskContext } from '../../store/quickAsk'
import type { Conversation, Message } from '../../types'
import { FloatingButton } from './FloatingButton'
import { ChatPanel } from './ChatPanel'

const LAST_CONVERSATION_KEY = 'mla-floating-chat-conversation-id'
const BUTTON_SIZE = 52
const DEFAULT_PANEL_WIDTH = 380
const DEFAULT_PANEL_HEIGHT = 520

export default function FloatingChat() {
  const [visible, setVisible] = useState(false)
  const collapseBtnRef = useRef<HTMLDivElement>(null)
  const [collapseTop, setCollapseTop] = useState<number | null>(null)

  // 面板可拖拽定位 (无吸附, 居中默认)
  const { position, dragging, panelRef, onDragStart, updateSize } = useDraggable(DEFAULT_PANEL_WIDTH, DEFAULT_PANEL_HEIGHT)

  // 面板可缩放尺寸
  const [panelSize, setPanelSize] = useState({ width: DEFAULT_PANEL_WIDTH, height: DEFAULT_PANEL_HEIGHT })

  const handleResize = useCallback((width: number, height: number) => {
    setPanelSize({ width, height })
    updateSize(width, height)
  }, [updateSize])

  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [inputValue, setInputValue] = useState('')
  /** 联网搜索开关 */
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)

  // SSE 流式对话管理
  const {
    messages,
    setMessages,
    streaming,
    streamingContent,
    streamingSources,
    streamingWebLinks,
    sendMessage,
    stopStreaming,
    abortStreaming,
    hasSentMessageRef,
  } = useStreamChat()

  // ========== 快问AI 集成 ==========

  const quickAskContext = useQuickAskStore((s) => s.context)
  const clearQuickAsk = useQuickAskStore((s) => s.clear)

  const saveableMessagesRef = useRef<Map<string, { kpId: string; saved: boolean }>>(new Map())
  const kpIdForPendingMessageRef = useRef<string | null>(null)

  // 流式完成后标注可保存消息
  const prevStreamingRef = useRef(streaming)
  useEffect(() => {
    if (prevStreamingRef.current && !streaming) {
      const kpId = kpIdForPendingMessageRef.current
      if (kpId && messages.length > 0) {
        const lastMsg = messages[messages.length - 1]
        if (lastMsg.role === 'assistant') {
          saveableMessagesRef.current.set(lastMsg.id, { kpId, saved: false })
        }
        kpIdForPendingMessageRef.current = null
      }
    }
    prevStreamingRef.current = streaming
  }, [streaming, messages])

  // 监听快问AI: 展开面板 + 发送预填充问题
  useEffect(() => {
    if (!quickAskContext) return
    setVisible(true)
    const timeout = setTimeout(async () => {
      const conv = await ensureConversationReady(quickAskContext)
      if (conv) {
        await handleQuickAskSend(conv, quickAskContext)
      }
      clearQuickAsk()
    }, 300)
    return () => clearTimeout(timeout)
  }, [quickAskContext])

  // ========== 对话管理 ==========

  async function ensureConversationReady(ctx: QuickAskContext): Promise<Conversation | null> {
    const courseId = ctx.metadata.courseId
    if (conversation && (!courseId || conversation.course_id === courseId)) {
      return conversation
    }
    hasSentMessageRef.current = false
    try {
      const conv = await createConversation({
        conversation_type: 'chat',
        title: '快速问答',
        course_id: courseId,
      })
      setConversation(conv)
      setMessages([])
      localStorage.setItem(LAST_CONVERSATION_KEY, conv.id)
      return conv
    } catch {
      return null
    }
  }

  function generateQuickAskQuestion(ctx: QuickAskContext): string {
    const text = ctx.contextText.slice(0, 200)
    switch (ctx.sourceType) {
      case 'kp': return `请帮我详细解释一下"${text}"这个知识点`
      case 'code': return '请帮我解释这段代码的含义和逻辑'
      case 'exercise': return '请帮我理解这道题考察的概念，不要直接给答案，帮我理清思路'
      case 'document': return '请帮我解释这份文档中的关键概念'
      case 'text_selection': return `请帮我解释这段内容：${text}`
      default: return text
    }
  }

  async function handleQuickAskSend(conv: Conversation, ctx: QuickAskContext) {
    if (streaming) return
    const question = ctx.prefillQuestion || generateQuickAskQuestion(ctx)
    if (!question.trim()) return
    const quickAskMetadata: Record<string, unknown> = {
      source_type: ctx.sourceType,
      context_text: ctx.contextText,
      kp_id: ctx.metadata.kpId,
      course_id: ctx.metadata.courseId,
      chapter_id: ctx.metadata.chapterId,
      document_id: ctx.metadata.documentId,
    }
    kpIdForPendingMessageRef.current = ctx.metadata.kpId || null
    sendMessage(conv.id, question, ctx.metadata.courseId || conv.course_id, undefined, quickAskMetadata, webSearchEnabled)
  }

  async function handleSaveToKnowledgeBase(messageId: string, kpId: string, fullResponse: string, userQuestion: string) {
    try {
      const entry = saveableMessagesRef.current.get(messageId)
      if (!entry || entry.saved) return
      message.loading({ content: '正在浓缩并存储 AI 解释…', key: 'save-kp' })
      await condenseAndStoreExplanation(kpId, fullResponse, userQuestion)
      entry.saved = true
      saveableMessagesRef.current.set(messageId, entry)
      message.success({ content: '已保存到知识卡片，可在课程详情中查看', key: 'save-kp' })
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : '未知错误'
      message.error({ content: '保存失败: ' + errMsg, key: 'save-kp' })
    }
  }

  function findUserQuestion(aiMsgIndex: number): string {
    for (let i = aiMsgIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].content
    }
    return ''
  }

  // ========== 对话生命周期 ==========

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
      if (!hasSentMessageRef.current) {
        abortStreaming()
        setConversation({
          id: detail.id, user_id: detail.user_id, course_id: detail.course_id,
          title: detail.title, conversation_type: detail.conversation_type,
          profile_collection_stage: detail.profile_collection_stage,
          message_count: detail.message_count, created_at: detail.created_at,
          updated_at: detail.updated_at,
        })
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
    setConversation(null); setMessages([])
    localStorage.removeItem(LAST_CONVERSATION_KEY)
    await createNewConversation()
    message.success('已开始新对话')
  }

  async function handleSend() {
    const content = inputValue.trim()
    if (!content || streaming || !conversation) return
    setInputValue('')
    sendMessage(conversation.id, content, conversation.course_id, undefined, undefined, webSearchEnabled)
  }

  function handleStop() {
    stopStreaming()
    hasSentMessageRef.current = false
  }

  // ========== 悬浮按钮: 点击 vs 拖动区分 ==========

  const collapseDragStart = useRef<{ mouseY: number; top: number } | null>(null)

  const handleCollapseMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const btn = collapseBtnRef.current
    if (!btn) return

    const startY = e.clientY
    let moved = false

    collapseDragStart.current = { mouseY: e.clientY, top: btn.getBoundingClientRect().top }
    const mm = (ev: MouseEvent) => {
      if (!collapseDragStart.current) return
      if (Math.abs(ev.clientY - startY) > 3) moved = true
      setCollapseTop(Math.max(60, Math.min(
        window.innerHeight - BUTTON_SIZE - 20,
        collapseDragStart.current.top + ev.clientY - collapseDragStart.current.mouseY,
      )))
    }
    const mu = () => {
      collapseDragStart.current = null
      window.removeEventListener('mousemove', mm)
      window.removeEventListener('mouseup', mu)
      if (!moved) setVisible(true)
    }
    window.addEventListener('mousemove', mm)
    window.addEventListener('mouseup', mu)
  }

  function handleClose() {
    if (streaming) abortStreaming()
    hasSentMessageRef.current = false
    setVisible(false)
    setMessages([])
  }

  // ========== 渲染 ==========

  const saveableCopy = new Map(saveableMessagesRef.current)

  return (
    <>
      {!visible && (
        <FloatingButton
          collapseTop={collapseTop}
          onDragStart={handleCollapseMouseDown}
          buttonRef={collapseBtnRef}
        />
      )}

      {visible && (
        <ChatPanel
          ref={panelRef}
          conversation={conversation}
          messages={messages}
          streaming={streaming}
          streamingContent={streamingContent}
          streamingSources={streamingSources}
          messagesLoading={messagesLoading}
          inputValue={inputValue}
          position={position}
          dragging={dragging}
          panelWidth={panelSize.width}
          panelHeight={panelSize.height}
          onDragStart={onDragStart}
          onClose={handleClose}
          onSend={handleSend}
          onStop={handleStop}
          onInputChange={setInputValue}
          onNewConversation={handleDeleteAndNew}
          onResize={handleResize}
          onSaveToKb={handleSaveToKnowledgeBase}
          saveableMessages={saveableCopy}
          findUserQuestion={findUserQuestion}
          webSearchEnabled={webSearchEnabled}
          onWebSearchToggle={() => setWebSearchEnabled(p => !p)}
          streamingWebLinks={streamingWebLinks}
        />
      )}
    </>
  )
}
