/**
 * Live2D 虚拟形象气泡组件
 *
 * 在模型上方显示对话气泡, 自动跟随模型位置.
 * 气泡在 duration 毫秒后自动消失.
 */

import { useEffect, useState, useRef } from 'react'
import { onBubble, type BubbleMessage } from './AvatarEventBus'

const DEFAULT_DURATION = 6000

export default function AvatarBubble() {
  const [msg, setMsg] = useState<BubbleMessage | null>(null)
  const [pos, setPos] = useState<{ right: number; bottom: number }>({ right: 316, bottom: 380 })
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  // 监听气泡事件
  useEffect(() => {
    return onBubble((m) => {
      if (!m.text) { setMsg(null); return } // dismiss
      setMsg(m)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setMsg(null), m.duration || DEFAULT_DURATION)
    })
  }, [])

  // 跟随 Live2D 模型位置
  useEffect(() => {
    if (!msg) return
    const sync = () => {
      for (const child of document.body.children) {
        const el = child as HTMLElement
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue
        if (el.querySelector('canvas') && getComputedStyle(el).position === 'fixed') {
          const r = el.getBoundingClientRect()
          setPos({
            right: window.innerWidth - r.right + r.width / 2 - 80,
            bottom: window.innerHeight - r.top + 30,
          })
          break
        }
      }
    }
    sync()
    const iv = setInterval(sync, 150)
    return () => clearInterval(iv)
  }, [msg])

  if (!msg) return null

  return (
    <div
      style={{
        position: 'fixed',
        right: pos.right,
        bottom: pos.bottom,
        zIndex: 1062,
        maxWidth: 240,
        padding: '8px 14px',
        background: 'rgba(22, 22, 35, 0.88)',
        backdropFilter: 'blur(16px) saturate(140%)',
        WebkitBackdropFilter: 'blur(16px) saturate(140%)',
        borderRadius: 14,
        color: 'rgba(255,255,255,0.9)',
        fontSize: 13,
        lineHeight: 1.6,
        boxShadow: '0 4px 24px rgba(0,0,0,0.3), 0 0 0 0.5px rgba(255,255,255,0.08) inset',
        animation: 'mla-bubble-in 0.3s ease-out',
        pointerEvents: 'none',
      }}
    >
      {msg.text}
      {/* CSS 动画 */}
      <style>{`
        @keyframes mla-bubble-in {
          from { opacity: 0; transform: translateY(8px) scale(0.95); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  )
}
