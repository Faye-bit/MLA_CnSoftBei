/**
 * 聊天 SSE 流式逻辑 Hook
 * 封装消息列表管理、SSE 流式消费、中止与部分消息保存
 * 消除 Chat.tsx 和 FloatingChat.tsx 中的重复流式逻辑
 *
 * 用法:
 *   const { messages, setMessages, streaming, streamingContent, streamingSources,
 *           sendMessage, stopStreaming, abortStreaming, hasSentMessageRef } = useStreamChat()
 *
 *   // 加载已有对话消息:
 *   setMessages(detail.messages || [])
 *
 *   // 发送消息:
 *   sendMessage(conversationId, content, courseId)
 *
 *   // 用户手动停止:
 *   stopStreaming()   // 保存部分内容到消息列表
 *
 *   // 切换对话/关闭面板时:
 *   abortStreaming()  // 不保存部分内容
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { streamChat } from '../services/api'
import type { Message, ChatSource, WebLink } from '../types'

export interface UseStreamChatOptions {
  /** 初始消息列表 (可选) */
  initialMessages?: Message[]
  /** onDone 时的附加回调 (如刷新对话列表) */
  onStreamDone?: () => void
}

export function useStreamChat(options?: UseStreamChatOptions) {
  const [messages, setMessages] = useState<Message[]>(options?.initialMessages || [])
  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingSources, setStreamingSources] = useState<ChatSource[]>([])
  const [streamingWebLinks, setStreamingWebLinks] = useState<WebLink[]>([])

  /** ref 同步流式内容 — 避免 React 批处理下的竞态问题 */
  const streamingContentRef = useRef('')
  const streamingSourcesRef = useRef<ChatSource[]>([])
  const streamingWebLinksRef = useRef<WebLink[]>([])
  /** 流式请求的 AbortController */
  const abortControllerRef = useRef<AbortController | null>(null)
  /** 最后一个发送请求的对话 ID — stopStreaming 时用于构造消息 */
  const conversationIdRef = useRef<string | null>(null)
  /**
   * 追踪用户是否已在本轮会话中发送过消息
   * 用于 FloatingChat 中防止 loadConversationById 覆盖本地消息状态
   */
  const hasSentMessageRef = useRef(false)

  /** 组件卸载时中止流式请求 */
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  /**
   * 发送消息并启动 SSE 流式消费
   *
   * @param conversationId - 对话 ID
   * @param content - 用户消息内容
   * @param courseId - 关联课程 ID (可选)
   * @param systemPrompt - 自定义系统提示词 (可选)
   * @param quickAskMetadata - 快问AI 元数据 (可选)
   * @param webSearchEnabled - 是否开启联网搜索 (可选)
   */
  const sendMessage = useCallback((
    conversationId: string,
    content: string,
    courseId: string | null,
    systemPrompt?: string,
    quickAskMetadata?: Record<string, unknown>,
    webSearchEnabled?: boolean,
  ) => {
    hasSentMessageRef.current = true
    conversationIdRef.current = conversationId

    // 添加用户消息
    const userMsg: Message = {
      id: 'temp-' + Date.now(),
      conversation_id: conversationId,
      role: 'user',
      content,
      sources: null,
      message_metadata: null,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])

    // 重置流式状态
    streamingContentRef.current = ''
    streamingSourcesRef.current = []
    streamingWebLinksRef.current = []
    setStreaming(true)
    setStreamingContent('')
    setStreamingSources([])
    setStreamingWebLinks([])

    abortControllerRef.current = streamChat(conversationId, content, courseId, {
      onContent: (chunk) => {
        streamingContentRef.current += chunk
        setStreamingContent(streamingContentRef.current)
      },
      onSources: (sources) => {
        streamingSourcesRef.current = sources
        setStreamingSources(sources)
      },
      onWebLinks: (links) => {
        streamingWebLinksRef.current = links
        setStreamingWebLinks(links)
      },
      onDone: (messageId) => {
        // 必须先将 ref 内容保存到局部变量, 再调用 setMessages
        // React 19 自动批处理状态下, setMessages 的 updater 回调
        // 可能在 ref 被重置之后才执行
        const finalContent = streamingContentRef.current
        const finalSources = streamingSourcesRef.current
        const finalWebLinks = streamingWebLinksRef.current
        setMessages((prev) => [
          ...prev,
          {
            id: messageId,
            conversation_id: conversationId,
            role: 'assistant' as const,
            content: finalContent,
            sources: finalSources.length > 0 ? finalSources : null,
            message_metadata: null,
            created_at: new Date().toISOString(),
            web_links: finalWebLinks.length > 0 ? finalWebLinks : undefined,
          },
        ])
        setStreaming(false)
        setStreamingContent('')
        setStreamingSources([])
        setStreamingWebLinks([])
        streamingContentRef.current = ''
        streamingSourcesRef.current = []
        streamingWebLinksRef.current = []
        options?.onStreamDone?.()
      },
      onError: (error) => {
        const partial = streamingContentRef.current
        if (partial) {
          setMessages((prev) => [
            ...prev,
            {
              id: 'error-' + Date.now(),
              conversation_id: conversationId,
              role: 'assistant' as const,
              content: partial + '\n\n[回复生成过程中断: ' + error + ']',
              sources: streamingSourcesRef.current.length > 0 ? streamingSourcesRef.current : null,
              message_metadata: null,
              created_at: new Date().toISOString(),
              web_links: streamingWebLinksRef.current.length > 0 ? streamingWebLinksRef.current : undefined,
            },
          ])
        }
        setStreaming(false)
        setStreamingContent('')
        setStreamingSources([])
        setStreamingWebLinks([])
        streamingContentRef.current = ''
        streamingSourcesRef.current = []
        streamingWebLinksRef.current = []
      },
    }, systemPrompt, quickAskMetadata, webSearchEnabled)
  }, [options?.onStreamDone])

  /**
   * 停止流式生成 — 保存已接收的部分内容为消息
   */
  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort()
    const partial = streamingContentRef.current
    if (partial && conversationIdRef.current) {
      setMessages((prev) => [
        ...prev,
        {
          id: 'partial-' + Date.now(),
          conversation_id: conversationIdRef.current,
          role: 'assistant' as const,
          content: partial + '\n\n[已停止生成]',
          sources: streamingSourcesRef.current.length > 0 ? streamingSourcesRef.current : null,
          message_metadata: null,
          created_at: new Date().toISOString(),
          web_links: streamingWebLinksRef.current.length > 0 ? streamingWebLinksRef.current : undefined,
        },
      ])
    }
    setStreaming(false)
    setStreamingContent('')
    setStreamingSources([])
    setStreamingWebLinks([])
    streamingContentRef.current = ''
    streamingSourcesRef.current = []
    streamingWebLinksRef.current = []
  }, [])

  /**
   * 中止流式生成 — 不保存部分内容 (用于切换对话、关闭面板等场景)
   */
  const abortStreaming = useCallback(() => {
    abortControllerRef.current?.abort()
    setStreaming(false)
    setStreamingContent('')
    setStreamingSources([])
    setStreamingWebLinks([])
    streamingContentRef.current = ''
    streamingSourcesRef.current = []
    streamingWebLinksRef.current = []
  }, [])

  return {
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
  }
}
