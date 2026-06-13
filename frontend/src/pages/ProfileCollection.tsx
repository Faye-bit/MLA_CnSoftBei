/**
 * 画像收集页
 * 通过自然对话方式收集学生信息, 自动构建学习画像
 * 复用 Chat 页面的对话组件 (ChatMessage + ChatInput)
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Typography, Spin, Empty, message, Button, Space, Steps, Card, Progress, Modal } from 'antd'
import {
  ThunderboltOutlined,
  ArrowLeftOutlined,
} from '@ant-design/icons'
import ChatMessage from '../components/chat/ChatMessage'
import ChatInput from '../components/chat/ChatInput'
import {
  getConversations,
  getConversationDetail,
  createConversation,
  streamChat,
  extractProfile,
} from '../services/api'
import type { Conversation, Message, ChatSource } from '../types'

const { Title, Text } = Typography

/** 画像收集的 6 个阶段 */
const PROFILE_STAGES = [
  { key: 'academic_background', title: '专业背景' },
  { key: 'knowledge_basis', title: '知识基础' },
  { key: 'learning_goals', title: '学习目标' },
  { key: 'learning_preferences', title: '学习偏好' },
  { key: 'weak_areas', title: '薄弱知识点' },
  { key: 'interests', title: '兴趣方向' },
]

export default function ProfileCollection() {
  const navigate = useNavigate()

  // 对话状态
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)

  // SSE 流式状态 — state 仅用于 UI 渲染, 最终值从 ref 读取
  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const streamingContentRef = useRef('')
  const streamingSourcesRef = useRef<ChatSource[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)

  // 提取状态
  const [extracting, setExtracting] = useState(false)
  const [extractModalOpen, setExtractModalOpen] = useState(false)

  // 当前阶段
  const [currentStage, setCurrentStage] = useState(0)

  // 滚动
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [userScrolledUp, setUserScrolledUp] = useState(false)

  /** 初始化: 查找或创建一个画像收集对话 */
  const initConversation = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getConversations(1, 10, 'profile_collection')
      if (data.items.length > 0) {
        const conv = data.items[0]
        setConversation(conv)
        const detail = await getConversationDetail(conv.id)
        setMessages(detail.messages || [])
        if (conv.profile_collection_stage) {
          const stageIdx = PROFILE_STAGES.findIndex((s) => s.key === conv.profile_collection_stage)
          setCurrentStage(stageIdx >= 0 ? stageIdx : 0)
        }
      } else {
        const conv = await createConversation({
          conversation_type: 'profile_collection',
          title: '画像收集',
        })
        setConversation(conv)
        setMessages([])
        sendInitialMessage(conv)
      }
    } catch (err) {
      message.error('初始化失败: ' + (err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    initConversation()
  }, [initConversation])

  /** 发送开场引导消息 */
  const sendInitialMessage = useCallback(async (conv: Conversation) => {
    streamingContentRef.current = ''
    streamingSourcesRef.current = []
    setStreaming(true)
    setStreamingContent('')

    abortControllerRef.current = streamChat(
      conv.id,
      '你好',
      null,
      {
        onContent: (chunk) => {
          streamingContentRef.current += chunk
          setStreamingContent(streamingContentRef.current)
        },
        onSources: () => {},
        onDone: (messageId) => {
          const finalContent = streamingContentRef.current
          const assistantMsg: Message = {
            id: messageId,
            conversation_id: conv.id,
            role: 'assistant',
            content: finalContent,
            sources: null,
            message_metadata: null,
            created_at: new Date().toISOString(),
          }
          setMessages((prev) => [...prev, assistantMsg])
          setStreaming(false)
          setStreamingContent('')
          streamingContentRef.current = ''
          setCurrentStage(0)
        },
        onError: (error) => {
          message.error('开场消息发送失败: ' + error)
          setStreaming(false)
          setStreamingContent('')
          streamingContentRef.current = ''
        },
      }
    )
  }, [])

  /** 发送消息 */
  const handleSendMessage = useCallback((content: string, _courseId: string | null) => {
    if (!conversation) return

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

    streamingContentRef.current = ''
    streamingSourcesRef.current = []
    setStreaming(true)
    setStreamingContent('')

    const conversationSnapshot = conversation

    abortControllerRef.current = streamChat(
      conversationSnapshot.id,
      content,
      null,
      {
        onContent: (chunk) => {
          streamingContentRef.current += chunk
          setStreamingContent(streamingContentRef.current)
        },
        onSources: (sources) => {
          streamingSourcesRef.current = sources
        },
        onDone: (messageId) => {
          const finalContent = streamingContentRef.current
          const assistantMsg: Message = {
            id: messageId,
            conversation_id: conversationSnapshot.id,
            role: 'assistant',
            content: finalContent,
            sources: null,
            message_metadata: null,
            created_at: new Date().toISOString(),
          }
          setMessages((prev) => [...prev, assistantMsg])
          setStreaming(false)
          setStreamingContent('')
          streamingContentRef.current = ''
          streamingSourcesRef.current = []
        },
        onError: (error) => {
          message.error('发送失败: ' + error)
          const partialContent = streamingContentRef.current
          if (partialContent) {
            const errorMsg: Message = {
              id: 'error-' + Date.now(),
              conversation_id: conversationSnapshot.id,
              role: 'assistant',
              content: partialContent + '\n\n[回复中断: ' + error + ']',
              sources: null,
              message_metadata: null,
              created_at: new Date().toISOString(),
            }
            setMessages((prev) => [...prev, errorMsg])
          }
          setStreaming(false)
          setStreamingContent('')
          streamingContentRef.current = ''
          streamingSourcesRef.current = []
        },
      }
    )
  }, [conversation])

  /** 停止生成 */
  const handleStopStreaming = useCallback(() => {
    abortControllerRef.current?.abort()
    const partialContent = streamingContentRef.current
    if (partialContent && conversation) {
      const partialMsg: Message = {
        id: 'partial-' + Date.now(),
        conversation_id: conversation.id,
        role: 'assistant',
        content: partialContent + '\n\n[已停止生成]',
        sources: null,
        message_metadata: null,
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, partialMsg])
    }
    setStreaming(false)
    setStreamingContent('')
    streamingContentRef.current = ''
    streamingSourcesRef.current = []
  }, [conversation])

  /** 提取画像 */
  const handleExtractProfile = useCallback(async () => {
    if (!conversation) return
    setExtracting(true)
    try {
      await extractProfile(conversation.id)
      message.success('画像提取成功!')
      setExtractModalOpen(false)
      navigate('/student-profile')
    } catch (err) {
      message.error('画像提取失败: ' + (err as Error).message)
    } finally {
      setExtracting(false)
    }
  }, [conversation, navigate])

  /** 自动滚动 */
  useEffect(() => {
    if (!userScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, streamingContent, userScrolledUp])

  /** 滚动监听 */
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight
    setUserScrolledUp(distanceFromBottom > 100)
  }, [])

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" tip="初始化画像收集..." />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* 顶部 */}
      <div style={{ marginBottom: 16 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} type="text">
            返回
          </Button>
          <Title level={3} style={{ margin: 0 }}>
            画像收集
          </Title>
        </Space>
        <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
          与 AI 助手的自然对话中完成学习画像收集, 系统将自动分析并构建你的个性化学习画像
        </Text>
      </div>

      {/* 进度条和阶段 */}
      <Card size="small" style={{ marginBottom: 16, borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Text strong>收集进度</Text>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={() => setExtractModalOpen(true)}
            disabled={messages.length < 4}
            size="small"
          >
            提取画像
          </Button>
        </div>
        <Progress
          percent={Math.round((currentStage / PROFILE_STAGES.length) * 100)}
          format={() => `${currentStage}/${PROFILE_STAGES.length}`}
          status="active"
        />
        <Steps
          current={currentStage}
          size="small"
          style={{ marginTop: 12 }}
          items={PROFILE_STAGES.map((s) => ({
            title: s.title,
          }))}
        />
      </Card>

      {/* 对话区域 */}
      <Card
        bodyStyle={{ padding: 0 }}
        style={{ borderRadius: 8, flex: 1 }}
      >
        <div
          onScroll={handleScroll}
          style={{
            height: 'calc(100vh - 420px)',
            minHeight: 400,
            overflow: 'auto',
            padding: '16px 24px',
            background: '#fff',
          }}
        >
          {messages.length === 0 && !streaming && (
            <div style={{ textAlign: 'center', padding: 60 }}>
              <Empty description="正在准备对话..." />
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
            />
          )}

          {streaming && !streamingContent && (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <Spin size="small" /> <Text type="secondary">思考中...</Text>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 输入栏 */}
        <ChatInput
          onSend={handleSendMessage}
          onStop={handleStopStreaming}
          streaming={streaming}
          conversationType="profile_collection"
        />
      </Card>

      {/* 提取确认弹窗 */}
      <Modal
        title="确认提取画像"
        open={extractModalOpen}
        onOk={handleExtractProfile}
        onCancel={() => setExtractModalOpen(false)}
        confirmLoading={extracting}
        okText="确认提取"
        cancelText="取消"
      >
        <p>
          AI 将分析当前对话内容, 提取你的学习画像, 包含以下 6 个维度:
        </p>
        <ul style={{ fontSize: 13, color: '#666' }}>
          {PROFILE_STAGES.map((s) => (
            <li key={s.key}>{s.title}</li>
          ))}
        </ul>
        <p style={{ color: '#faad14', fontSize: 13 }}>
          建议在收集到足够信息后再提取。你可以在提取后继续对话或手动编辑画像。
        </p>
      </Modal>
    </div>
  )
}
