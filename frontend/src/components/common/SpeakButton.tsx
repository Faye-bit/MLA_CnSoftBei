/**
 * SpeakButton — 统一朗读按钮组件
 *
 * 小圆形按钮, 四态切换:
 *   idle    — 扬声器图标, 点击开始朗读
 *   loading — 旋转加载动画 (TTS API 请求中)
 *   playing — 脉冲动画, 点击暂停
 *   paused  — 暂停态, 点击恢复
 *
 * 使用方式:
 *   <SpeakButton text="要朗读的文本" />
 *   <SpeakButton text="..." size="small" />
 */

import { useRef, useEffect } from 'react'
import { SoundOutlined, LoadingOutlined, PauseOutlined, CaretRightOutlined } from '@ant-design/icons'
import { useLive2DSpeech, type SpeechStatus } from '../avatar/Live2DSpeechProvider'

// ============================================================================
// 全局 CSS 注入 (只一次)
// ============================================================================

let _styleInjected = false
function injectStyle() {
  if (_styleInjected) return
  _styleInjected = true
  const style = document.createElement('style')
  style.textContent = `
    @keyframes speakPulse {
      0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(22,119,255,0.3); }
      50%      { transform: scale(1.08); box-shadow: 0 0 0 4px rgba(22,119,255,0); }
    }
    @keyframes speakPaused {
      0%, 100% { opacity: 0.7; }
      50%      { opacity: 1; }
    }
  `
  document.head.appendChild(style)
}

// ============================================================================
// 工具函数
// ============================================================================

interface SpeakButtonProps {
  text: string
  size?: 'small' | 'default'
}

/** 根据状态返回按钮配置 */
function getStateConfig(status: SpeechStatus, isSpeaking: boolean) {
  switch (status) {
    case 'loading':
      return {
        icon: <LoadingOutlined spin />,
        title: 'AI 正在合成语音...',
        animation: 'none',
        cursor: 'pointer' as const,
        bg: 'rgba(22,119,255,0.1)',
        color: '#1677ff',
      }
    case 'playing':
      return {
        icon: <PauseOutlined />,
        title: '点击暂停',
        animation: 'speakPulse 0.6s ease-in-out infinite',
        cursor: 'pointer' as const,
        bg: 'rgba(22,119,255,0.12)',
        color: '#1677ff',
      }
    case 'paused':
      return {
        icon: <CaretRightOutlined />,
        title: '点击继续播放',
        animation: 'speakPaused 1.5s ease-in-out infinite',
        cursor: 'pointer' as const,
        bg: 'rgba(250,173,20,0.15)',
        color: '#faad14',
      }
    default: // idle
      return {
        icon: <SoundOutlined />,
        title: '让 AI 伙伴朗读',
        animation: 'none',
        cursor: 'pointer' as const,
        bg: 'rgba(0,0,0,0.04)',
        color: 'rgba(0,0,0,0.35)',
      }
  }
}

// ============================================================================
// 组件
// ============================================================================

export default function SpeakButton({ text, size = 'default' }: SpeakButtonProps) {
  const { speak, status } = useLive2DSpeech()
  const mountedRef = useRef(false)

  useEffect(() => {
    if (!mountedRef.current) { injectStyle(); mountedRef.current = true }
  }, [])

  const btnSize = size === 'small' ? 28 : 32
  const iconSize = size === 'small' ? 13 : 14

  const cfg = getStateConfig(status, false)
  const isActive = status !== 'idle'

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        speak(text)
      }}
      title={cfg.title}
      style={{
        width: btnSize,
        height: btnSize,
        borderRadius: '50%',
        border: 'none',
        background: cfg.bg,
        color: cfg.color,
        cursor: cfg.cursor,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: iconSize,
        flexShrink: 0,
        transition: 'all 0.2s',
        animation: cfg.animation,
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLElement).style.background = 'rgba(22,119,255,0.1)'
          ;(e.currentTarget as HTMLElement).style.color = '#1677ff'
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.04)'
          ;(e.currentTarget as HTMLElement).style.color = 'rgba(0,0,0,0.35)'
        }
      }}
    >
      {cfg.icon}
    </button>
  )
}
