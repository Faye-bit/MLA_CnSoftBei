/**
 * 聊天面板 UI
 * 包含可拖动标题栏、消息列表、输入区域、右下角拖拽缩放手柄
 * 通过 forwardRef 暴露根 div, 供父组件的 useDraggable 使用
 */
import { useState, useRef, useEffect, forwardRef } from 'react'
import { Button, Spin, Typography } from 'antd'
import {
  CloseOutlined, SendOutlined, StopOutlined,
  PlusOutlined, MinusOutlined, SaveOutlined, BulbOutlined,
  GlobalOutlined,
} from '@ant-design/icons'
import ChatMessage from '../chat/ChatMessage'
import type { Conversation, Message, ChatSource, WebLink } from '../../types'
import { blue, gray } from '../../styles/tokens'

const { Text } = Typography

/** 面板尺寸范围 */
const MIN_WIDTH = 320
const MIN_HEIGHT = 400
const MAX_WIDTH = 720
const MAX_HEIGHT = Math.min(window.innerHeight - 40, 960)

interface ChatPanelProps {
  conversation: Conversation | null
  messages: Message[]
  streaming: boolean
  streamingContent: string
  streamingSources: ChatSource[]
  messagesLoading: boolean
  inputValue: string
  position: { x: number; y: number }
  dragging: boolean
  panelWidth: number
  panelHeight: number
  onDragStart: (e: React.MouseEvent) => void
  onClose: () => void
  onSend: () => void
  onStop: () => void
  onInputChange: (value: string) => void
  onNewConversation: () => void
  onResize: (width: number, height: number) => void
  onSaveToKb: (messageId: string, kpId: string, fullResponse: string, userQuestion: string) => void
  saveableMessages: Map<string, { kpId: string; saved: boolean }>
  findUserQuestion: (assistantIndex: number) => string
  /** 联网搜索开关状态 */
  webSearchEnabled?: boolean
  /** 联网搜索开关切换回调 */
  onWebSearchToggle?: () => void
  /** 流式中的联网搜索结果链接 */
  streamingWebLinks?: WebLink[]
}

export const ChatPanel = forwardRef<HTMLDivElement, ChatPanelProps>(
  function ChatPanel({
    conversation, messages, streaming, streamingContent, streamingSources,
    messagesLoading, inputValue, position, dragging, panelWidth, panelHeight,
    onDragStart, onClose, onSend, onStop, onInputChange,
    onNewConversation, onResize, onSaveToKb, saveableMessages, findUserQuestion,
    webSearchEnabled = false, onWebSearchToggle, streamingWebLinks,
  }, ref) {
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const isComposingRef = useRef(false)

    // 自动滚动到最新消息
    useEffect(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, streamingContent])

    // 输入框自适应高度
    const autoResize = () => {
      const el = textareaRef.current
      if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px' }
    }

    // ======= 缩放拖拽手柄 =======
    const [resizing, setResizing] = useState(false)
    const resizeOrigin = useRef<{ mouseX: number; mouseY: number; w: number; h: number } | null>(null)

    const handleResizeStart = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      resizeOrigin.current = { mouseX: e.clientX, mouseY: e.clientY, w: panelWidth, h: panelHeight }
      setResizing(true)
    }

    useEffect(() => {
      if (!resizing) return
      const mm = (e: MouseEvent) => {
        if (!resizeOrigin.current) return
        const newW = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, resizeOrigin.current.w + e.clientX - resizeOrigin.current.mouseX))
        const newH = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, resizeOrigin.current.h + e.clientY - resizeOrigin.current.mouseY))
        onResize(newW, newH)
      }
      const mu = () => {
        setResizing(false)
        resizeOrigin.current = null
      }
      window.addEventListener('mousemove', mm)
      window.addEventListener('mouseup', mu)
      return () => {
        window.removeEventListener('mousemove', mm)
        window.removeEventListener('mouseup', mu)
      }
    }, [resizing, onResize])

    // ======= 渲染 =======
    const panelStyle: React.CSSProperties = {
      position: 'fixed',
      left: position.x,
      top: position.y,
      width: panelWidth,
      height: panelHeight,
      zIndex: 1050,
    }

    return (
      <div ref={ref} style={{ ...panelStyle, background: '#FFFFFF', borderRadius: 12, boxShadow: '0 8px 40px rgba(15,23,42,0.12)', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: `1px solid ${gray[200]}`, userSelect: dragging ? 'none' : 'auto' }}>
        {/* 标题栏 — 纯色品牌蓝, 拖动把手 */}
        <div onMouseDown={onDragStart} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: blue[500], color: '#FFFFFF', cursor: dragging ? 'grabbing' : 'grab', flexShrink: 0, userSelect: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src="/brand/字母标Logo.svg" alt="MLA" style={{ width: 18, height: 18 }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>{conversation?.title || 'AI 助手'}</span>
          </div>
          <div style={{ display: 'flex', gap: 2 }}>
            <Button type="text" size="small" icon={<PlusOutlined />} onClick={(e) => { e.stopPropagation(); onNewConversation() }} style={{ color: '#FFFFFF' }} title="新对话" />
            <Button type="text" size="small" icon={<MinusOutlined />} onClick={(e) => { e.stopPropagation(); onClose() }} style={{ color: '#FFFFFF' }} title="最小化" />
          </div>
        </div>

        {/* 消息列表 */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 14px', background: gray[50], minHeight: 0 }}>
          {messagesLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Spin size="small" /></div>
          ) : messages.length === 0 && !streaming ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, opacity: 0.6 }}>
              <img src="/brand/字母标Logo.svg" alt="MLA 智小学" style={{ width: 80, height: 80, opacity: 0.85 }} />
              <Text type="secondary" style={{ fontSize: 13 }}>基于课程知识库的 AI 助手</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>输入你的问题, 我会在资料中寻找答案</Text>
            </div>
          ) : (
            <>
              {messages.map((msg, idx) => {
                const saveEntry = msg.role === 'assistant' ? saveableMessages.get(msg.id) : null
                return (
                  <div key={msg.id}>
                    <ChatMessage
                      role={msg.role}
                      content={msg.content}
                      sources={msg.sources}
                      createdAt={msg.created_at}
                      webLinks={msg.web_links}
                    />
                    {msg.role === 'assistant' && saveEntry && !saveEntry.saved && (
                      <div style={{ padding: '0 0 8px', textAlign: 'right' }}>
                        <Button
                          type="primary" ghost size="small"
                          icon={<SaveOutlined />}
                          onClick={() => onSaveToKb(msg.id, saveEntry.kpId, msg.content, findUserQuestion(idx))}
                          style={{ borderRadius: 6, fontSize: 12 }}
                        >
                          保存到知识库
                        </Button>
                      </div>
                    )}
                    {msg.role === 'assistant' && saveEntry && saveEntry.saved && (
                      <div style={{ padding: '0 0 8px', textAlign: 'right' }}>
                        <Text type="success" style={{ fontSize: 11 }}>
                          <BulbOutlined /> 已保存到知识卡片
                        </Text>
                      </div>
                    )}
                  </div>
                )
              })}
              {streaming && streamingContent && <ChatMessage role="assistant" content={streamingContent} sources={streamingSources} streaming webLinks={streamingWebLinks} />}
              {streaming && !streamingContent && <div style={{ textAlign: 'center', padding: 16 }}><Spin size="small" /> <Text type="secondary" style={{ fontSize: 12 }}>思考中...</Text></div>}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* 输入区域 */}
        <div style={{ borderTop: `1px solid ${gray[200]}`, padding: '8px 10px', background: '#FFFFFF', flexShrink: 0 }}>
          {/* 联网搜索开关 — 输入框上方 */}
          {onWebSearchToggle && (
            <div style={{ marginBottom: 6 }}>
              <button
                onClick={onWebSearchToggle}
                disabled={streaming || messagesLoading}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '2px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  border: webSearchEnabled
                    ? `1.5px solid ${blue[400]}`
                    : `1.5px solid ${gray[300]}`,
                  borderRadius: 16,
                  background: webSearchEnabled ? blue[50] : '#FFFFFF',
                  color: webSearchEnabled ? blue[500] : gray[500],
                  cursor: (streaming || messagesLoading) ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                  whiteSpace: 'nowrap',
                  lineHeight: '20px',
                  opacity: (streaming || messagesLoading) ? 0.5 : 1,
                }}
              >
                <GlobalOutlined style={{ fontSize: 12 }} />
                <span>联网搜索</span>
              </button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => { onInputChange(e.target.value); autoResize() }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !isComposingRef.current && !e.shiftKey) { e.preventDefault(); onSend() } }}
              onCompositionStart={() => { isComposingRef.current = true }}
              onCompositionEnd={() => { isComposingRef.current = false }}
              placeholder="输入问题, Enter 发送, Shift+Enter 换行"
              rows={1}
              disabled={streaming || messagesLoading}
              style={{ flex: 1, resize: 'none', border: `1px solid ${gray[300]}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, lineHeight: 1.4, outline: 'none', fontFamily: 'inherit', maxHeight: 120, minHeight: 34 }}
              onFocus={(e) => { e.target.style.borderColor = blue[500]; e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.15)' }}
              onBlur={(e) => { e.target.style.borderColor = gray[300]; e.target.style.boxShadow = 'none' }}
            />
            {streaming ? (
              <Button type="primary" danger size="small" icon={<StopOutlined />} onClick={onStop} />
            ) : (
              <Button type="primary" size="small" icon={<SendOutlined />} onClick={onSend} disabled={!inputValue.trim() || messagesLoading} />
            )}
          </div>
        </div>

        {/* 缩放拖拽手柄 — 右下角 */}
        <div
          onMouseDown={handleResizeStart}
          style={{
            position: 'absolute', bottom: 0, right: 0,
            width: 16, height: 16,
            cursor: 'nwse-resize',
            // Two diagonal lines hint
            background: 'linear-gradient(135deg, transparent 50%, rgba(148,163,184,0.4) 50%, rgba(148,163,184,0.4) 55%, transparent 55%, transparent 70%, rgba(148,163,184,0.4) 70%, rgba(148,163,184,0.4) 75%, transparent 75%)',
            borderRadius: '0 0 12px 0',
          }}
        />
      </div>
    )
  }
)
