/**
 * AI 对话主页面
 * 模仿 ChatGPT/Claude 的布局: 左侧对话列表 + 右侧聊天区域
 *
 * 滚动模型 (关键):
 *   - 外层 div overflow:hidden, height 精确匹配可用空间 → 页面不滚动
 *   - 左侧边栏: 独立的 flex 纵列, 内部 overflow:auto → 对话列表独立滚动
 *   - 右侧消息区: flex:1 + overflow:auto → 仅消息区滚动
 *   - 输入栏: flex-shrink:0 → 始终悬浮于底部, 不随消息滚动
 *
 * @see branding/MLA_BRAND_GUIDELINES.md
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Typography, Spin, Empty, message } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import ConversationList from '../components/chat/ConversationList'
import ChatMessage from '../components/chat/ChatMessage'
import ChatInput from '../components/chat/ChatInput'
import {
  getConversations, getConversationDetail, createConversation,
  deleteConversation, updateConversation, streamChat,
} from '../services/api'
import type { Conversation, Message, ChatSource } from '../types'
import { blue, gray } from '../styles/tokens'

const { Text } = Typography

/** ====== 欢迎页建议提示词 ====== */
const SUGGESTIONS = [
  '这个课程的核心知识点有哪些？',
  '帮我总结一下已学内容的重点',
  '用思维导图的方式梳理知识体系',
  '针对我的薄弱环节出几道练习题',
  '解释一下最近学的概念，并举一个例子',
]

export default function Chat() {
  const [searchParams] = useSearchParams()
  const typeParam = searchParams.get('type') as 'chat' | 'profile_collection' | null

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [conversationsLoading, setConversationsLoading] = useState(true)
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingSources, setStreamingSources] = useState<ChatSource[]>([])
  const streamingContentRef = useRef('')
  const streamingSourcesRef = useRef<ChatSource[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [userScrolledUp, setUserScrolledUp] = useState(false)
  /** 新建对话后自动聚焦输入框 */
  const [shouldFocusInput, setShouldFocusInput] = useState(false)

  const loadConversations = useCallback(async () => {
    setConversationsLoading(true)
    try {
      const data = await getConversations(1, 50, typeParam || undefined)
      setConversations(data.items)
    } catch (err) {
      message.error('加载对话列表失败: ' + (err as Error).message)
    } finally {
      setConversationsLoading(false)
    }
  }, [typeParam])

  useEffect(() => { loadConversations() }, [loadConversations])

  /**
   * 静默刷新对话列表 (不触发 loading 状态)
   * 用于 SSE 流式完成后的标题/消息数更新, 避免触发 ConversationList 的
   * loading spinner 导致列表闪烁或意外重渲染
   *
   * 同时将更新后的标题同步到 activeConversation, 保证右侧面板立即显示新标题
   */
  const silentRefreshConversations = useCallback(async () => {
    try {
      const data = await getConversations(1, 50, typeParam || undefined)
      setConversations(data.items)
      // 同步更新当前活跃对话的标题 (后端可能已自动生成标题)
      setActiveConversation((prev) => {
        if (!prev) return null
        const updated = data.items.find((c) => c.id === prev.id)
        if (updated && updated.title !== prev.title) {
          return { ...prev, title: updated.title, message_count: updated.message_count }
        }
        return prev
      })
    } catch {
      // 静默失败, 不影响主流程
    }
  }, [typeParam])

  const handleSelectConversation = useCallback(async (conv: Conversation) => {
    setActiveConversation(conv)
    setMessagesLoading(true)
    setMessages([])
    setStreamingContent('')
    setStreaming(false)
    streamingContentRef.current = ''
    streamingSourcesRef.current = []

    try {
      const detail = await getConversationDetail(conv.id)
      setMessages(detail.messages || [])
    } catch (err) {
      message.error('加载消息失败: ' + (err as Error).message)
    } finally {
      setMessagesLoading(false)
    }
  }, [])

  /** 新建对话 */
  const handleNewConversation = useCallback(async () => {
    try {
      const conv = await createConversation({
        conversation_type: typeParam || 'chat',
        title: typeParam === 'profile_collection' ? '画像收集' : '新对话',
      })
      await loadConversations()
      await handleSelectConversation(conv)
      message.success('对话已创建')
      /** 标记需要聚焦输入框 */
      setShouldFocusInput(true)
    } catch (err) {
      message.error('创建对话失败: ' + (err as Error).message)
    }
  }, [loadConversations, handleSelectConversation, typeParam])

  const handleDeleteConversation = useCallback(async (id: string) => {
    try {
      await deleteConversation(id)
      message.success('对话已删除')
      if (activeConversation?.id === id) { setActiveConversation(null); setMessages([]) }
      await loadConversations()
    } catch (err) { message.error('删除失败: ' + (err as Error).message) }
  }, [activeConversation, loadConversations])

  const handleRenameConversation = useCallback(async (id: string, title: string) => {
    try {
      await updateConversation(id, { title })
      await loadConversations()
      if (activeConversation?.id === id) setActiveConversation((prev) => prev ? { ...prev, title } : null)
    } catch (err) { message.error('重命名失败: ' + (err as Error).message) }
  }, [activeConversation, loadConversations])

  /** 发送用户消息后滚动到底部并清除聚焦标记 */
  const scrollAfterSend = useCallback(() => {
    setUserScrolledUp(false)
    setShouldFocusInput(false)
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }, [])

  const handleSendMessage = useCallback(async (content: string, courseId: string | null) => {
    if (!activeConversation) return

    const userMsg: Message = {
      id: 'temp-' + Date.now(), conversation_id: activeConversation.id,
      role: 'user', content, sources: null,
      message_metadata: null, created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])

    streamingContentRef.current = ''; streamingSourcesRef.current = []
    setStreaming(true); setStreamingContent(''); setStreamingSources([])
    scrollAfterSend()

    const conversationSnapshot = activeConversation
    abortControllerRef.current = streamChat(conversationSnapshot.id, content, courseId, {
      onContent: (chunk) => { streamingContentRef.current += chunk; setStreamingContent(streamingContentRef.current) },
      onSources: (sources) => { streamingSourcesRef.current = sources; setStreamingSources(sources) },
      onDone: (messageId) => {
        /** 必须先将 ref 内容保存到局部变量, 再调用 setMessages
         *  React 19 自动批处理状态下, setMessages 的 updater 回调
         *  可能在 streamingContentRef 被重置之后才执行 */
        const finalContent = streamingContentRef.current
        const finalSources = streamingSourcesRef.current
        setMessages((prev) => [...prev, { id: messageId, conversation_id: conversationSnapshot.id, role: 'assistant', content: finalContent, sources: finalSources.length > 0 ? finalSources : null, message_metadata: null, created_at: new Date().toISOString() }])
        setStreaming(false); setStreamingContent(''); setStreamingSources([])
        streamingContentRef.current = ''; streamingSourcesRef.current = []
        silentRefreshConversations()
      },
      onError: (error) => {
        message.error('生成回复失败: ' + error)
        const partial = streamingContentRef.current
        if (partial) setMessages((prev) => [...prev, { id: 'error-' + Date.now(), conversation_id: conversationSnapshot.id, role: 'assistant', content: partial + '\n\n[回复生成过程中断: ' + error + ']', sources: streamingSourcesRef.current.length > 0 ? streamingSourcesRef.current : null, message_metadata: null, created_at: new Date().toISOString() }])
        setStreaming(false); setStreamingContent(''); setStreamingSources([])
        streamingContentRef.current = ''; streamingSourcesRef.current = []
      },
    })
  }, [activeConversation, silentRefreshConversations, scrollAfterSend])

  const handleStopStreaming = useCallback(() => {
    abortControllerRef.current?.abort()
    const partial = streamingContentRef.current
    if (partial && activeConversation) {
      setMessages((prev) => [...prev, { id: 'partial-' + Date.now(), conversation_id: activeConversation.id, role: 'assistant', content: partial + '\n\n[已停止生成]', sources: streamingSourcesRef.current.length > 0 ? streamingSourcesRef.current : null, message_metadata: null, created_at: new Date().toISOString() }])
    }
    setStreaming(false); setStreamingContent(''); setStreamingSources([])
    streamingContentRef.current = ''; streamingSourcesRef.current = []
  }, [activeConversation])

  /** 自动滚动 */
  useEffect(() => {
    if (!userScrolledUp) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent, userScrolledUp])

  const handleScroll = useCallback(() => {
    const c = messagesContainerRef.current
    if (!c) return
    setUserScrolledUp(c.scrollHeight - c.scrollTop - c.clientHeight > 100)
  }, [])

  // ====================================================================
  // 判断是否显示欢迎页: 已选中对话 + 无消息 + 不在加载 + 不在流式
  // ====================================================================
  const showWelcome = activeConversation && !messagesLoading && messages.length === 0 && !streaming

  return (
    <div style={{
      height: 'calc(100vh - 104px)',  // 精确填充可用空间, 防止外层滚动
      overflow: 'hidden',
      display: 'flex',
    }}>
      {/* ================================================================ */}
      {/* 左侧: 对话列表 (独立 overflow, 不受右侧消息区影响) */}
      {/* ================================================================ */}
      <ConversationList
        conversations={conversations}
        activeId={activeConversation?.id || null}
        loading={conversationsLoading}
        onSelect={handleSelectConversation}
        onNew={handleNewConversation}
        onDelete={handleDeleteConversation}
        onRename={handleRenameConversation}
      />

      {/* ================================================================ */}
      {/* 右侧: 聊天区 — flex 纵列, 仅消息区滚动 */}
      {/* ================================================================ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>

        {/* --- 未选择对话空状态 --- */}
        {!activeConversation ? (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: '#FFFFFF', gap: 20,
          }}>
            {/* MLA Logo */}
            <img
              src="/brand/字母标Logo.svg"
              alt="MLA 智学引擎"
              style={{ width: 144, height: 144 }}
            />

            <div style={{ textAlign: 'center' }}>
              <Text style={{ fontSize: 14, color: gray[500], lineHeight: 1.7 }}>
                {typeParam === 'profile_collection'
                  ? '点击左侧「新建对话」开始画像收集，AI 将通过对话了解你的学习情况'
                  : '选择左侧已有对话继续交流，或点击「新建对话」开始全新的知识探索'}
              </Text>
            </div>

            {/* 快速开始按钮 */}
            <div
              onClick={handleNewConversation}
              style={{
                marginTop: 8, padding: '10px 28px',
                background: blue[500], color: '#FFFFFF',
                borderRadius: 10, cursor: 'pointer',
                fontSize: 14, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 8,
                transition: 'background 0.2s, transform 0.2s',
                boxShadow: '0 2px 8px rgba(59,130,246,0.2)',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = blue[600]}
              onMouseLeave={(e) => e.currentTarget.style.background = blue[500]}
            >
              <ThunderboltOutlined />
              开始新对话
            </div>
          </div>
        ) : messagesLoading ? (
          /* --- 加载消息中 --- */
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FFFFFF' }}>
            <Spin tip="加载消息中..." />
          </div>
        ) : (
          /* ================================================================ */
          /* 消息 + 输入 — 仅此区域产生滚动 */
          /* ================================================================ */
          <>
            {/* --- 消息列表 (唯一滚动容器) --- */}
            <div
              ref={messagesContainerRef}
              onScroll={handleScroll}
              style={{
                flex: 1, minHeight: 0,
                overflow: 'auto',
                padding: showWelcome ? '40px 24px' : '16px 24px',
                background: '#FFFFFF',
              }}
            >
              {/* ======================================================== */}
              {/* 欢迎页: 新建对话后显示, 类似 ChatGPT 的引导界面 */}
              {/* ======================================================== */}
              {showWelcome && (
                <div style={{
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  minHeight: '100%', gap: 28,
                  paddingTop: 40, paddingBottom: 40,
                }}>
                  {/* Logo */}
                  <img
                    src="/brand/字母标Logo.svg"
                    alt="MLA 智学引擎"
                    style={{ width: 128, height: 128 }}
                  />

                  <div style={{ textAlign: 'center' }}>
                    <Text style={{ fontSize: 14, color: gray[500] }}>
                      {activeConversation.conversation_type === 'profile_collection'
                        ? '通过自然对话, AI 将逐步了解你的学习情况并构建画像'
                        : '基于课程知识库的智能问答, 试试下面的问题或直接输入你的疑问'}
                    </Text>
                  </div>

                  {/* 建议提示词卡片 */}
                  {activeConversation.conversation_type === 'chat' && (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                      gap: 10, maxWidth: 720, width: '100%',
                    }}>
                      {SUGGESTIONS.map((text, idx) => (
                        <div
                          key={idx}
                          onClick={() => handleSendMessage(text, activeConversation.course_id || null)}
                          style={{
                            padding: '12px 16px',
                            border: `1px solid ${gray[200]}`,
                            borderRadius: 10,
                            cursor: 'pointer',
                            fontSize: 13,
                            color: gray[600],
                            lineHeight: 1.5,
                            transition: 'border-color 0.2s, box-shadow 0.2s',
                            background: '#FFFFFF',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = blue[500]
                            e.currentTarget.style.boxShadow = `0 2px 8px rgba(59,130,246,0.08)`
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = gray[200]
                            e.currentTarget.style.boxShadow = 'none'
                          }}
                        >
                          {text}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* --- 已有消息 --- */}
              {!showWelcome && (
                <>
                  {messages.map((msg) => (
                    <ChatMessage key={msg.id} role={msg.role} content={msg.content}
                      sources={msg.sources} createdAt={msg.created_at} />
                  ))}

                  {streaming && streamingContent && (
                    <ChatMessage role="assistant" content={streamingContent} sources={streamingSources} streaming />
                  )}

                  {streaming && !streamingContent && (
                    <div style={{ textAlign: 'center', padding: 20 }}>
                      <Spin size="small" /> <Text type="secondary">思考中...</Text>
                    </div>
                  )}
                </>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* --- 回到底部浮动按钮 --- */}
            {userScrolledUp && (
              <div
                onClick={() => {
                  setUserScrolledUp(false)
                  messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
                }}
                style={{
                  position: 'fixed', bottom: 108, left: '50%', transform: 'translateX(-50%)',
                  background: blue[500], color: '#FFFFFF',
                  padding: '6px 16px', borderRadius: 20, cursor: 'pointer',
                  fontSize: 13, boxShadow: '0 2px 8px rgba(15,23,42,0.08)', zIndex: 10,
                }}
              >
                回到底部
              </div>
            )}

            {/* --- 输入栏: 始终固定于底部 --- */}
            <div style={{ flexShrink: 0 }}>
              <ChatInput
                onSend={handleSendMessage}
                onStop={handleStopStreaming}
                streaming={streaming}
                conversationType={activeConversation.conversation_type}
                selectedCourseId={activeConversation.course_id}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
