/**
 * 全局文本选中 → 快问AI 触发器
 * 监听全局 mouseup 事件, 当用户选中 >10 字符的文本时,
 * 在选区上方显示浮动 "Ask AI" 按钮, 点击后触发快问AI
 *
 * 在 AppLayout 中注册 (与 FloatingChat 同级)
 */
import { useState, useEffect } from 'react'
import { Button } from 'antd'
import { BulbOutlined } from '@ant-design/icons'
import { useQuickAskStore } from '../../store/quickAsk'
import { useAppStore } from '../../store'

export default function TextSelectionAsk() {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [selectedText, setSelectedText] = useState('')
  const triggerQuickAsk = useQuickAskStore((s) => s.trigger)

  useEffect(() => {
    /**
     * 鼠标松开时检测文本选区
     * 使用 setTimeout 确保 selection 已经稳定 (Webkit bug workaround)
     */
    const handleMouseUp = (_e: MouseEvent) => {
      setTimeout(() => {
        const selection = window.getSelection()
        const text = selection?.toString().trim()

        // 忽略太短的选中文本 (<10 字符) 和 FloatingChat 内部的选择
        if (!text || text.length < 10) {
          setVisible(false)
          return
        }

        // 忽略发生在 FloatingChat 面板内部的选择
        const range = selection!.getRangeAt(0)
        const container = range.commonAncestorContainer
        const floatPanel = (container as Element)?.closest?.('[class*="float"]')
        if (floatPanel || document.querySelector('[style*="z-index: 1050"]')?.contains(container as Node)) {
          setVisible(false)
          return
        }

        const rect = range.getBoundingClientRect()
        setPosition({
          x: rect.left + rect.width / 2,
          y: rect.top + window.scrollY - 8,
        })
        setSelectedText(text)
        setVisible(true)
      }, 100)
    }

    // 点击其他地方时隐藏气泡
    const handleClick = () => {
      setTimeout(() => setVisible(false), 200)
    }

    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('mousedown', handleClick)
    return () => {
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [])

  if (!visible) return null

  return (
    <div
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        transform: 'translate(-50%, -100%)',
        zIndex: 1060,
        pointerEvents: 'auto',
      }}
    >
      <Button
        type="primary"
        size="small"
        icon={<BulbOutlined />}
        onClick={() => {
          triggerQuickAsk({
            sourceType: 'text_selection',
            contextText: selectedText,
            prefillQuestion: `请帮我解释这段内容：${selectedText.slice(0, 100)}`,
            metadata: {
              courseId: useAppStore.getState().currentCourseId ?? undefined,
            },
          })
          setVisible(false)
        }}
        style={{
          boxShadow: '0 2px 12px rgba(59,130,246,0.35)',
          borderRadius: 16,
          fontSize: 12,
        }}
      >
        Ask AI
      </Button>
    </div>
  )
}
