/**
 * Live2D 虚拟形象对话互动框 — 暗黑玻璃拟态, 极简无边框
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { Button, message } from 'antd'
import { SendOutlined, StopOutlined, SoundOutlined, MutedOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import { createConversation, deleteConversation, streamChat } from '../../services/api'
import type { Conversation, Message } from '../../types'

/** 虚拟形象伙伴聊天 System Prompt */
const COMPANION_PROMPT = `你是 MLA 多学助手的虚拟学习伙伴，以亲切友好的方式和学生互动。

你的身份:
- 你的名字叫 Haru，是学生的 AI 学习伙伴

重要规则:
1. 用轻松自然的语气，像朋友一样交谈，多说鼓励的话。
2. 最多回复 2-3 句话，保持简短。
3. 不要用 Markdown 格式，用纯文本。
4. 可以适当使用语气词 (呢、啦、哦、呀) 和表情 (^_^, ~, !)。
5. 如果学生问学习相关的问题，给出简洁实用的建议而非长篇解释。
6. 如果学生闲聊或表达情绪，用共情的方式回应。
7. 多夸夸学生，关心他们的学习状态。

{memories_section}`

const CHAT_ID_KEY = 'mla-live2d-chat-conversation-id'
const CHAT_VISIBLE_KEY = 'mla-live2d-chat-visible'
const TTS_KEY = 'mla-live2d-tts-enabled'
const PANEL_WIDTH = 320
const INPUT_HEIGHT = 42

/** 单条消息 (暗黑风格内联渲染) */
function DarkMessage({ role, content }: { role: string; content: string }) {
  const isUser = role === 'user'
  return (
    <div style={{
      display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 10,
    }}>
      <div style={{
        maxWidth: '88%',
        padding: '8px 12px',
        borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
        background: isUser
          ? 'rgba(22,119,255,0.35)'
          : 'rgba(30,30,40,0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        fontSize: 13,
        lineHeight: 1.6,
        color: 'rgba(255,255,255,0.92)',
        wordBreak: 'break-word',
      }}>
        {isUser ? (
          <span>{content}</span>
        ) : (
          <ReactMarkdown
            components={{
              p: ({ children }) => <p style={{ margin: '0 0 4px' }}>{children}</p>,
              code: ({ children }) => (
                <code style={{
                  background: 'rgba(255,255,255,0.08)', padding: '1px 5px',
                  borderRadius: 4, fontSize: 12,
                }}>{children}</code>
              ),
              pre: ({ children }) => (
                <pre style={{
                  background: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 8,
                  overflow: 'auto', fontSize: 12,
                }}>{children}</pre>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  )
}

export default function Live2DChat() {
  const panelRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(() => localStorage.getItem(CHAT_VISIBLE_KEY) === 'true')
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [loading, setLoading] = useState(false)

  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [ttsEnabled, setTtsEnabled] = useState(() => localStorage.getItem(TTS_KEY) === 'true')
  const streamingRef = useRef('')
  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  /** TTS: 朗读文本 */
  const speak = useCallback((text: string) => {
    if (!ttsEnabled || !text) return
    speechSynthesis.cancel() // 停掉之前的
    // 清理 Markdown 标记, 取纯文本
    const plain = text.replace(/[#*`>\[\]()!\-|~]/g, '').replace(/\n{2,}/g, '。').replace(/\n/g, '，').slice(0, 500)
    if (!plain.trim()) return
    const u = new SpeechSynthesisUtterance(plain)
    u.lang = 'zh-CN'
    u.rate = 1.05
    u.volume = 0.9
    speechSynthesis.speak(u)
  }, [ttsEnabled])

  /** 切换 TTS */
  const toggleTts = useCallback(() => {
    const next = !ttsEnabled
    setTtsEnabled(next)
    localStorage.setItem(TTS_KEY, String(next))
    if (!next) speechSynthesis.cancel()
  }, [ttsEnabled])

  // ==================== 语音清理 ====================
  useEffect(() => {
    return () => { speechSynthesis.cancel() }
  }, [])

  // ==================== 跟随 Live2D 位置 ====================
  useEffect(() => {
    if (!visible) return
    const findWidget = (): HTMLElement | null => {
      for (const child of document.body.children) {
        const el = child as HTMLElement
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue
        if (el.querySelector('canvas') && getComputedStyle(el).position === 'fixed') return el
      }
      return null
    }
    const sync = () => {
      const w = findWidget(), p = panelRef.current
      if (!w || !p) return
      const r = w.getBoundingClientRect()
      p.style.right = (window.innerWidth - r.left + 16) + 'px'
      p.style.bottom = (window.innerHeight - r.bottom) + 'px'
    }
    sync()
    const iv = setInterval(sync, 100)
    return () => clearInterval(iv)
  }, [visible])

  // ==================== 对话管理 ====================
  useEffect(() => {
    if (!visible) return
    const id = localStorage.getItem(CHAT_ID_KEY)
    if (id) loadConv(id); else createNew()
  }, [visible])

  // 聊天开关
  useEffect(() => {
    const h = (e: Event) => setVisible((e as CustomEvent).detail)
    window.addEventListener('mla-live2d-chat-toggle', h)
    return () => window.removeEventListener('mla-live2d-chat-toggle', h)
  }, [])

  // 拖动虚拟形象时关闭聊天 (不自动恢复)
  useEffect(() => {
    const onDrag = () => {
      localStorage.setItem(CHAT_VISIBLE_KEY, 'false')
      setVisible(false)
    }
    window.addEventListener('mla-live2d-drag-start', onDrag)
    return () => window.removeEventListener('mla-live2d-drag-start', onDrag)
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  async function loadConv(id: string) {
    setLoading(true)
    try {
      const { getConversationDetail } = await import('../../services/api')
      const d = await getConversationDetail(id)
      setConversation({ id: d.id, user_id: d.user_id, course_id: d.course_id, title: d.title, conversation_type: d.conversation_type, profile_collection_stage: d.profile_collection_stage, message_count: d.message_count, created_at: d.created_at, updated_at: d.updated_at })
      setMessages(d.messages || [])
    } catch { createNew() }
    finally { setLoading(false) }
  }

  async function createNew() {
    setLoading(true)
    try {
      const c = await createConversation({ conversation_type: 'chat', title: '聊天' })
      setConversation(c)
      setMessages([])
      localStorage.setItem(CHAT_ID_KEY, c.id)
    } catch (e) { message.error('创建失败: ' + (e as Error).message) }
    finally { setLoading(false) }
  }

  async function reset() {
    if (conversation) { try { await deleteConversation(conversation.id) } catch { /*ok*/ } }
    setConversation(null); setMessages([])
    localStorage.removeItem(CHAT_ID_KEY)
    await createNew()
  }

  // ==================== 发送 ====================
  const handleSend = useCallback(async () => {
    const c = inputValue.trim()
    if (!c || streaming || !conversation) return
    speechSynthesis.cancel() // 停掉正在播放的语音
    const um: Message = { id: 't-' + Date.now(), conversation_id: conversation.id, role: 'user', content: c, sources: null, message_metadata: null, created_at: new Date().toISOString() }
    setMessages(p => [...p, um]); setInputValue('')

    streamingRef.current = ''; setStreaming(true); setStreamingContent('')
    const cid = conversation.id
    abortRef.current = streamChat(cid, c, null, {
      onContent: ch => { streamingRef.current += ch; setStreamingContent(streamingRef.current) },
      onSources: () => {},
      onDone: mid => {
        const content = streamingRef.current
        const am: Message = { id: mid, conversation_id: cid, role: 'assistant', content, sources: null, message_metadata: null, created_at: new Date().toISOString() }
        setMessages(p => [...p, am])
        setStreaming(false); setStreamingContent(''); streamingRef.current = ''
        speak(content)
      },
      onError: e => { message.error('回复失败: ' + e); setStreaming(false) },
    }, COMPANION_PROMPT)
  }, [inputValue, streaming, conversation, speak])

  function handleStop() { abortRef.current?.abort(); setStreaming(false) }

  function handleClose() {
    speechSynthesis.cancel()
    localStorage.setItem(CHAT_VISIBLE_KEY, 'false'); setVisible(false)
  }

  if (!visible) return null

  // ====== 暗黑玻璃拟态 ======
  const glass: React.CSSProperties = {
    background: 'transparent',
    boxShadow: 'none',
    borderRadius: 0,
  }

  const hasMessages = messages.length > 0 || streaming

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed', right: 336, bottom: 16,
        width: hasMessages ? PANEL_WIDTH : PANEL_WIDTH,
        maxHeight: hasMessages ? 420 : undefined,
        zIndex: 1061,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        transition: 'max-height 0.3s ease',
        ...glass,
      }}
    >
      {/* 关闭按钮 (右上角小叉) */}
      <button
        onClick={handleClose}
        style={{
          position: 'absolute', top: 8, right: 10,
          background: 'none', border: 'none',
          color: 'rgba(255,255,255,0.3)', cursor: 'pointer',
          fontSize: 16, lineHeight: 1, padding: 0,
          zIndex: 2,
        }}
        title="关闭"
      >×</button>

      {/* 消息列表 (有消息时才显示) */}
      {hasMessages && (
        <div style={{
          flex: 1, overflow: 'auto', padding: '12px 14px 4px',
          minHeight: 80, maxHeight: 340,
        }}>
          {messages.map(m => (
            <DarkMessage key={m.id} role={m.role} content={m.content} />
          ))}
          {streaming && streamingContent && (
            <DarkMessage role="assistant" content={streamingContent} />
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* 输入框 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: hasMessages ? '4px 0 0' : '0',
      }}>
        {/* TTS 喇叭开关 */}
        <button
          onClick={toggleTts}
          title={ttsEnabled ? '关闭语音' : '开启语音 (AI 回复自动朗读)'}
          style={{
            width: INPUT_HEIGHT, height: INPUT_HEIGHT,
            borderRadius: '50%',
            border: 'none',
            background: ttsEnabled ? 'rgba(22,119,255,0.35)' : 'rgba(255,255,255,0.12)',
            color: ttsEnabled ? '#64b5f6' : 'rgba(255,255,255,0.5)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 15,
            flexShrink: 0,
            transition: 'all 0.2s',
          }}
        >
          {ttsEnabled ? <SoundOutlined /> : <MutedOutlined />}
        </button>
        <input
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder="和 AI 聊聊..."
          disabled={streaming}
          style={{
            flex: 1, height: INPUT_HEIGHT,
            background: 'rgba(30,30,40,0.85)',
            border: 'none',
            borderRadius: INPUT_HEIGHT / 2,
            padding: '0 16px',
            fontSize: 13,
            outline: 'none',
            color: 'rgba(255,255,255,0.85)',
            caretColor: '#1677ff',
            fontFamily: 'inherit',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
        />
        {streaming ? (
          <Button type="primary" danger size="small" icon={<StopOutlined />}
            onClick={handleStop}
            style={{ borderRadius: '50%', height: INPUT_HEIGHT, width: INPUT_HEIGHT, minWidth: INPUT_HEIGHT, background: 'rgba(255,77,79,0.6)', border: 'none' }} />
        ) : (
          <Button type="primary" size="small" icon={<SendOutlined />}
            onClick={handleSend} disabled={!inputValue.trim()}
            style={{ borderRadius: '50%', height: INPUT_HEIGHT, width: INPUT_HEIGHT, minWidth: INPUT_HEIGHT, background: 'rgba(22,119,255,0.5)', border: 'none' }} />
        )}
      </div>
    </div>
  )
}
