/**
 * 可拖动面板 Hook
 * 封装面板拖动和视口约束逻辑, 松开后保持位置 (不吸附边缘)
 * 用于 FloatingChat 面板的标题栏拖动
 */
import { useState, useEffect, useRef, useCallback } from 'react'

/** 面板最小尺寸 */
const MIN_WIDTH = 340
const MIN_HEIGHT = 400

/**
 * 将位置约束在视口内
 * @param x      面板 left
 * @param y      面板 top
 * @param width  面板宽度
 * @param height 面板高度
 */
function clampToViewport(x: number, y: number, width: number, height: number) {
  const maxX = window.innerWidth - width
  const maxY = window.innerHeight - height
  return {
    x: Math.max(0, Math.min(x, maxX)),
    y: Math.max(0, Math.min(y, maxY)),
  }
}

/** 计算面板居中位置 */
function centerPosition(width: number, height: number) {
  return clampToViewport(
    (window.innerWidth - width) / 2,
    (window.innerHeight - height) / 2,
    width,
    height,
  )
}

export function useDraggable(defaultWidth = 380, defaultHeight = 520) {
  // 面板尺寸 (运行时可变, 由 resize handle 更新)
  const panelWidthRef = useRef(defaultWidth)
  const panelHeightRef = useRef(defaultHeight)

  // 初始位置: 屏幕居中
  const [position, setPosition] = useState<{ x: number; y: number }>(() =>
    centerPosition(defaultWidth, defaultHeight),
  )
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef<{ mouseX: number; mouseY: number; elemX: number; elemY: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  /** 标题栏发起拖动 */
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const el = panelRef.current
    if (!el) return
    dragStart.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      elemX: el.getBoundingClientRect().left,
      elemY: el.getBoundingClientRect().top,
    }
    setDragging(true)
  }, [])

  // 拖动期间: 跟随鼠标 + 视口约束
  useEffect(() => {
    if (!dragging) return
    const mm = (e: MouseEvent) => {
      if (!dragStart.current) return
      const w = panelWidthRef.current
      const h = panelHeightRef.current
      const raw = {
        x: dragStart.current.elemX + e.clientX - dragStart.current.mouseX,
        y: dragStart.current.elemY + e.clientY - dragStart.current.mouseY,
      }
      setPosition(clampToViewport(raw.x, raw.y, w, h))
    }
    const mu = () => {
      setDragging(false)
      dragStart.current = null
      // 保持当前位置, 不吸附、不重置
    }
    window.addEventListener('mousemove', mm)
    window.addEventListener('mouseup', mu)
    return () => {
      window.removeEventListener('mousemove', mm)
      window.removeEventListener('mouseup', mu)
    }
  }, [dragging])

  /** 外部更新面板尺寸后重新约束位置 */
  const updateSize = useCallback((width: number, height: number) => {
    panelWidthRef.current = width
    panelHeightRef.current = height
    setPosition(prev => clampToViewport(prev.x, prev.y, width, height))
  }, [])

  return { position, dragging, panelRef, onDragStart, updateSize } as const
}
