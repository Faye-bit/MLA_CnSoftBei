/**
 * AI 对话主页面
 * 模仿 ChatGPT/Claude 的布局: 左侧对话列表 + 右侧聊天区域
 * 支持 SSE 流式输出、知识库来源引用、对话历史管理
 *
 * 核心设计:
 * - streamingContentRef / streamingSourcesRef: 用 ref 累积流式数据,
 *   避免在 setState 回调中嵌套 setState 导致的重复渲染 bug
 * - streamingContent / streamingSources: 仅用于驱动 UI 渲染,
 *   onDone/onError 从 ref 读取最终值
 * - 用户画像通过后台记忆提取自动累积, 无需手动操作
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Typography, Spin, Empty, message } from 'antd'
import ConversationList from '../components/chat/ConversationList'
import ChatMessage from '../components/chat/ChatMessage'
import ChatInput from '../components/chat/ChatInput'
import {
  getConversations,
  getConversationDetail,
  createConversation,
  deleteConversation,
  updateConversation,
  streamChat,
} from '../services/api'
import type { Conversation, Message, ChatSource } from '../types'

const { Text } = Typography

export default function Chat() {
  const [searchParams] = useSearchParams()
  const typeParam = searchParams.get('type') as 'chat' | 'profile_collection' | null

  // 对话列表状态
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [conversationsLoading, setConversationsLoading] = useState(true)

  // 当前对话状态
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)

  // SSE 流式状态
  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingSources, setStreamingSources] = useState<ChatSource[]>([])
  const streamingContentRef = useRef('')
  const streamingSourcesRef = useRef<ChatSource[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)

  // 滚动容器引用
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [userScrolledUp, setUserScrolledUp] = useState(false)

  /** 加载对话列表 */
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

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  /** 选择对话: 加载消息历史 */
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
    } catch (err) {
      message.error('创建对话失败: ' + (err as Error).message)
    }
  }, [loadConversations, handleSelectConversation, typeParam])

  /** 删除对话 */
  const handleDeleteConversation = useCallback(async (id: string) => {
    try {
      await deleteConversation(id)
      message.success('对话已删除')
      if (activeConversation?.id === id) {
        setActiveConversation(null)
        setMessages([])
      }
      await loadConversations()
    } catch (err) {
      message.error('删除失败: ' + (err as Error).message)
    }
  }, [activeConversation, loadConversations])

  /** 重命名对话 */
  const handleRenameConversation = useCallback(async (id: string, title: string) => {
    try {
      await updateConversation(id, { title })
      await loadConversations()
      if (activeConversation?.id === id) {
        setActiveConversation((prev) => prev ? { ...prev, title } : null)
      }
    } catch (err) {
      message.error('重命名失败: ' + (err as Error).message)
    }
  }, [activeConversation, loadConversations])

  /** 发送消息 (SSE 流式) */
  const handleSendMessage = useCallback(async (content: string, courseId: string | null) => {
    if (!activeConversation) return

    const userMsg: Message = {
      id: 'temp-' + Date.now(),
      conversation_id: activeConversation.id,
      role: 'user',
      content,
      sources: null,
      message_metadata: null,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])

    streamingContentRef.current = ''
    streamingSourcesRef.current = []
    setStreaming(true)
    setStreamingContent('')
    setStreamingSources([])

    const conversationSnapshot = activeConversation

    abortControllerRef.current = streamChat(
      conversationSnapshot.id,
      content,
      courseId,
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
            conversation_id: conversationSnapshot.id,
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
          streamingContentRef.current = ''
          streamingSourcesRef.current = []
          loadConversations()
        },
        onError: (error) => {
          message.error('生成回复失败: ' + error)
          const partialContent = streamingContentRef.current
          if (partialContent) {
            const errorMsg: Message = {
              id: 'error-' + Date.now(),
              conversation_id: conversationSnapshot.id,
              role: 'assistant',
              content: partialContent + '\n\n[回复生成过程中断: ' + error + ']',
              sources: streamingSourcesRef.current.length > 0 ? streamingSourcesRef.current : null,
              message_metadata: null,
              created_at: new Date().toISOString(),
            }
            setMessages((prev) => [...prev, errorMsg])
          }
          setStreaming(false)
          setStreamingContent('')
          setStreamingSources([])
          streamingContentRef.current = ''
          streamingSourcesRef.current = []
        },
      }
    )
  }, [activeConversation, loadConversations])

  /** 停止生成 */
  const handleStopStreaming = useCallback(() => {
    abortControllerRef.current?.abort()
    const partialContent = streamingContentRef.current
    if (partialContent && activeConversation) {
      const partialMsg: Message = {
        id: 'partial-' + Date.now(),
        conversation_id: activeConversation.id,
        role: 'assistant',
        content: partialContent + '\n\n[已停止生成]',
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
    streamingSourcesRef.current = []
  }, [activeConversation])

  /** 自动滚动到底部 */
  useEffect(() => {
    if (!userScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, streamingContent, userScrolledUp])

  /** 监听用户滚动 */
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    setUserScrolledUp(distanceFromBottom > 100)
  }, [])

  return (
    <div style={{ display: 'flex', height: '100%', margin: -24, minHeight: 0 }}>
      {/* 左侧对话列表 */}
      <ConversationList
        conversations={conversations}
        activeId={activeConversation?.id || null}
        loading={conversationsLoading}
        onSelect={handleSelectConversation}
        onNew={handleNewConversation}
        onDelete={handleDeleteConversation}
        onRename={handleRenameConversation}
      />

      {/* 右侧聊天区域 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* 消息列表区域 */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '16px 24px',
            background: '#fff',
          }}
        >
          {!activeConversation ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                gap: 16,
              }}
            >
              <Empty
                description={
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                      MLA 多学助手
                    </div>
                    <Text type="secondary">
                      {typeParam === 'profile_collection'
                        ? '点击左侧「新建对话」开始画像收集, AI 助手将通过对话了解你的学习情况'
                        : '选择一个对话或创建新对话, 基于课程知识库与 AI 助手交流'}
                    </Text>
                  </div>
                }
              />
            </div>
          ) : messagesLoading ? (
            <div style={{ textAlign: 'center', padding: 60 }}>
              <Spin tip="加载消息中..." />
            </div>
          ) : (
            <div>
              {messages.length === 0 && !streaming && (
                <div style={{ textAlign: 'center', padding: 40 }}>
                  <Text type="secondary">
                    {activeConversation.conversation_type === 'profile_collection'
                      ? '开始画像收集对话, AI 助手将逐步了解你的学习情况'
                      : '开始与 AI 助手对话, 可以选择关联课程以启用知识库检索'}
                  </Text>
                </div>
              )}

              {messages.map((msg) => (
                <ChatMessage
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  sources={msg.sources}
                  createdAt={msg.created_at}
                />
              ))}

              {streaming && streamingContent && (
                <ChatMessage
                  role="assistant"
                  content={streamingContent}
                  sources={streamingSources}
                />
              )}

              {streaming && !streamingContent && (
                <div style={{ textAlign: 'center', padding: 20 }}>
                  <Spin size="small" /> <Text type="secondary">思考中...</Text>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}

          {userScrolledUp && (
            <div
              onClick={() => {
                setUserScrolledUp(false)
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
              }}
              style={{
                position: 'absolute',
                bottom: 100,
                left: '50%',
                transform: 'translateX(-50%)',
                background: '#1677ff',
                color: '#fff',
                padding: '6px 16px',
                borderRadius: 20,
                cursor: 'pointer',
                fontSize: 13,
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                zIndex: 10,
              }}
            >
              回到底部
            </div>
          )}
        </div>

        {/* 输入栏 */}
        {activeConversation && (
          <ChatInput
            onSend={handleSendMessage}
            onStop={handleStopStreaming}
            streaming={streaming}
            conversationType={activeConversation.conversation_type}
            selectedCourseId={activeConversation.course_id}
          />
        )}
      </div>
    </div>
  )
}
