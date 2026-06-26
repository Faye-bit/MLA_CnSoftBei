/**
 * 自动滚动 hook
 * 封装聊天场景中的"自动滚到底部 + 用户手动上滚后暂停 + 回到底部按钮"逻辑
 *
 * 用法:
 *   const { messagesEndRef, userScrolledUp, handleScroll, scrollToBottom } = useAutoScroll(deps)
 *
 *   // 在 JSX 中将 messagesEndRef 挂载到消息列表末尾的 div
 *   // 将 handleScroll 绑定到容器 onScroll
 *   // 用 userScrolledUp 控制"回到底部"浮动按钮的显示
 */

import { useState, useEffect, useCallback, useRef } from 'react'

/** useAutoScroll 返回值类型 */
export interface UseAutoScrollReturn {
  /** 挂载到消息列表末尾的 ref, 新消息到达时自动 scrollIntoView */
  messagesEndRef: React.RefObject<HTMLDivElement | null>
  /** 用户是否正在查看历史消息 (距底部超过 100px) */
  userScrolledUp: boolean
  /** 绑定到滚动容器的 onScroll 事件处理 */
  handleScroll: (e: React.UIEvent<HTMLDivElement>) => void
  /** 强制滚回底部 (点击"回到底部"按钮时调用) */
  scrollToBottom: () => void
  /** 在新消息发送后调用, 重置滚动状态并滚到底部 */
  scrollAfterSend: () => void
}

/**
 * 创建自动滚动 hook
 * @param deps - 依赖数组, 内容更新时自动滚到底部 (如 [messages, streamingContent])
 */
export function useAutoScroll(deps: unknown[] = []): UseAutoScrollReturn {
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const [userScrolledUp, setUserScrolledUp] = useState(false)

  /** 强制滚到底部 (带短暂延迟, 确保 DOM 已更新) */
  const scrollToBottom = useCallback(() => {
    setUserScrolledUp(false)
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 100)
  }, [])

  /** 新消息发送后的滚动重置 */
  const scrollAfterSend = useCallback(() => {
    scrollToBottom()
  }, [scrollToBottom])

  /** 内容更新时自动滚到底部 (除非用户正在查看历史) */
  useEffect(() => {
    if (!userScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  /** 滚动事件处理: 检测用户是否手动上滚 */
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight
    setUserScrolledUp(distanceFromBottom > 100)
  }, [])

  return { messagesEndRef, userScrolledUp, handleScroll, scrollToBottom, scrollAfterSend }
}
