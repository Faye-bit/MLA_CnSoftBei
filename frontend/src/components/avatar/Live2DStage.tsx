/**
 * Live2D 虚拟形象组件
 *
 * 基于 l2d-widget (oh-my-live2d 继任者, 作者 hacxy) 实现.
 *
 * 功能:
 *   - 渲染 Live2D Cubism 5 模型 (moc3 v6 兼容)
 *   - 8 个模型切换 (Haru / Hiyori / Mao / Natori / Rice / Ren / Wanko / Mark)
 *   - CSS transform 拖动 (不破坏 l2d-widget 内部 fixed 定位)
 *   - 鼠标头部跟随 + 点击互动
 *   - 系统设置页开关控制显示/隐藏
 *   - 上半身裁剪 (clip-path 裁掉下半身, 避免遮挡内容)
 *   - 暴露 Widget 引用给全局朗读系统做口型同步
 *
 * 技术要点:
 *   - l2d-widget 的 DOM 追加到 body 后, 我们找到这些元素并附加拖动事件
 *   - 拖动使用 CSS transform: translate() 而非修改 left/top,
 *     确保 l2d-widget 切换模型/休眠时不会重置位置
 *   - 状态文字 ("正在加载"/"正在休息") 通过 MutationObserver 持续隐藏
 */

import { useEffect, useRef } from 'react'

// ============================================================================
// 配置
// ============================================================================

/** 模型列表 (来自 Cubism 5 SDK Samples/Resources/) */
const MODELS = [
  { path: '/models/haru/Haru.model3.json',     tips: false as const },
  { path: '/models/hiyori/Hiyori.model3.json', tips: false as const },
  { path: '/models/mao/Mao.model3.json',       tips: false as const },
  { path: '/models/natori/Natori.model3.json', tips: false as const },
  { path: '/models/rice/Rice.model3.json',     tips: false as const },
  { path: '/models/ren/Ren.model3.json',       tips: false as const },
  { path: '/models/wanko/Wanko.model3.json',   tips: false as const },
  { path: '/models/mark/Mark.model3.json',     tips: false as const },
]

/** 画布尺寸 */
const CANVAS_SIZE = { width: 300, height: 380 }

/** 下半身裁剪比例 (裁掉底部 35%, 只保留上半身) */
const CLIP_BOTTOM_RATIO = 0.35

/** 组件 props */
interface Live2DStageProps {
  /** 是否可见 (由 AppLayout 根据系统设置控制) */
  visible?: boolean
}

// ============================================================================
// Widget 引用暴露 (供 Live2DSpeechProvider 做口型同步)
// ============================================================================

/**
 * l2d-widget 的 Widget 接口类型 (简化版)
 * 只暴露口型同步所需的方法
 */
export interface L2DWidgetRef {
  l2d: {
    setParams: (params: Record<string, number>) => void
  }
}

/** 模块级 widget 引用, 由 Live2DStage 初始化, 供 Live2DSpeechProvider 读取 */
let _widget: L2DWidgetRef | null = null

/** 获取当前 Live2D Widget 引用 (供口型同步使用) */
export function getL2DWidget(): L2DWidgetRef | null {
  return _widget
}

// ============================================================================
// 组件
// ============================================================================

export default function Live2DStage({ visible = true }: Live2DStageProps) {
  /** 隐藏 div 的 ref (用于 React 生命周期 + 防重复创建) */
  const guardRef = useRef<HTMLDivElement>(null)
  /** 保存 l2d-widget 创建的 DOM 元素引用, 用于清理 */
  const widgetElsRef = useRef<HTMLElement[]>([])

  useEffect(() => {
    if (!visible) return
    let cancelled = false

    const init = async () => {
      // 防重复创建: 检查是否已有 l2d 元素存在
      if (document.querySelector('[class*="l2d"]')) return

      // 记录 body 已有子元素 (用于后续识别 l2d-widget 新增的)
      const bodyBefore = new Set(document.body.children)

      // 动态导入 l2d-widget (ESM)
      const { createWidget } = await import('l2d-widget')
      if (cancelled || !guardRef.current) return

      // ---- 创建 widget ----
      const widget = createWidget({
        model: MODELS,
        position: 'bottom-right',
        size: CANVAS_SIZE,
        primaryColor: '#1677ff',
        transitionDuration: 0,
      })
      // 保存 widget 引用供全局朗读系统做口型同步
      _widget = widget as unknown as L2DWidgetRef
      console.log('[Live2D] Widget 引用已保存, 可供口型同步使用')

      // 等待 l2d-widget 完成 DOM 渲染
      await new Promise(r => setTimeout(r, 1000))
      if (cancelled) return

      // ---- 查找 l2d-widget 创建的 body 级元素 ----
      const widgetEls: HTMLElement[] = []
      for (let i = 0; i < document.body.children.length; i++) {
        const el = document.body.children[i] as HTMLElement
        if (!bodyBefore.has(el) && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE') {
          widgetEls.push(el)
        }
      }
      if (widgetEls.length === 0) return
      widgetElsRef.current = widgetEls

      // ---- 上半身裁剪: 裁掉下半身, 避免遮挡内容 ----
      widgetEls.forEach(w => {
        if (window.getComputedStyle(w).position === 'fixed') {
          // 找到最外层的 l2d 容器并应用 clip-path
          const l2dContainer = w.querySelector('[class*="l2d"]') || w.querySelector('canvas')?.parentElement
          const target = (l2dContainer || w) as HTMLElement
          const clipValue = `inset(0 0 ${CLIP_BOTTOM_RATIO * 100}% 0)`
          target.style.clipPath = clipValue
          target.style.setProperty('clip-path', clipValue)
        }
      })

      // ---- 隐藏不需要的 UI ("正在加载"/"正在休息"/"About") ----
      const hideTexts = ['正在加载', '正在休息', 'About', '关于']
      const hideStatusTexts = () => {
        widgetEls.forEach(w => {
          w.querySelectorAll('*').forEach(el => {
            const text = (el as HTMLElement).innerText || ''
            const title = (el as HTMLElement).getAttribute('title') || ''
            if (hideTexts.some(s => text.includes(s) || title.includes(s))) {
              (el as HTMLElement).style.display = 'none'
            }
          })
        })
      }
      hideStatusTexts()
      const statusObserver = new MutationObserver(hideStatusTexts)
      widgetEls.forEach(w => statusObserver.observe(w, {
        childList: true, subtree: true, characterData: true,
      }))

      // ---- 拖动: CSS transform, 不影响 l2d-widget 内部定位 ----
      widgetEls.forEach(widget => {
        // 只对 fixed 定位的容器添加拖动
        if (window.getComputedStyle(widget).position !== 'fixed') return

        const dragState = {
          info: null as { sx: number; sy: number; moved: boolean } | null,
          pointerId: -1,
          deltaX: 0,
          deltaY: 0,
          baseX: 0,
          baseY: 0,
        }

        const onPointerDown = (e: PointerEvent) => {
          dragState.info = { sx: e.clientX, sy: e.clientY, moved: false }
          dragState.pointerId = e.pointerId
          // 读取已有的 transform 偏移
          const m = widget.style.transform.match(
            /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/,
          )
          if (m) {
            dragState.baseX = parseFloat(m[1])
            dragState.baseY = parseFloat(m[2])
          } else {
            dragState.baseX = 0
            dragState.baseY = 0
          }
        }

        const onPointerMove = (e: PointerEvent) => {
          const { info } = dragState
          if (!info || e.pointerId !== dragState.pointerId) return
          dragState.deltaX = e.clientX - info.sx
          dragState.deltaY = e.clientY - info.sy
          if (Math.abs(dragState.deltaX) > 2 || Math.abs(dragState.deltaY) > 2) {
            if (!info.moved) {
              info.moved = true
              widget.setPointerCapture(dragState.pointerId)
              window.dispatchEvent(new CustomEvent('mla-live2d-drag-start'))
            }
            widget.style.transform = `translate(${
              dragState.baseX + dragState.deltaX
            }px, ${
              dragState.baseY + dragState.deltaY
            }px)`
          }
        }

        const onPointerUp = () => {
          if (dragState.info?.moved) {
            widget.releasePointerCapture(dragState.pointerId)
            window.dispatchEvent(new CustomEvent('mla-live2d-drag-end'))
            widget.style.transform = `translate(${
              dragState.baseX + dragState.deltaX
            }px, ${
              dragState.baseY + dragState.deltaY
            }px)`
          }
          dragState.info = null
          dragState.pointerId = -1
          dragState.deltaX = 0
          dragState.deltaY = 0
        }

        widget.addEventListener('pointerdown', onPointerDown)
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)

        // 存储清理函数
        ;(widget as Record<string, unknown>)._l2dCleanup = () => {
          widget.removeEventListener('pointerdown', onPointerDown)
          window.removeEventListener('pointermove', onPointerMove)
          window.removeEventListener('pointerup', onPointerUp)
          statusObserver.disconnect()
        }
      })

      console.log(`[Live2D] 就绪, ${MODELS.length} 个模型, 上半身裁剪: ${CLIP_BOTTOM_RATIO * 100}%`)
    }

    init()

    // ---- 清理 (销毁所有 l2d-widget 的 DOM 和事件) ----
    return () => {
      cancelled = true
      _widget = null  // 清除全局引用
      // 断开事件 + 移除 DOM
      const els = widgetElsRef.current
      els.forEach(el => {
        const c = (el as Record<string, unknown>)._l2dCleanup as (() => void) | undefined
        c?.()
        el.remove()
      })
      widgetElsRef.current = []
      // 兜底: 清理 body 上残留的 l2d 元素
      document.querySelectorAll('[class*="l2d"]').forEach(el => {
        if (el.parentElement) el.remove()
      })
    }
  }, [visible])

  // 隐藏 div — 仅用于 React 生命周期管理和防重复创建
  if (!visible) return null
  return <div ref={guardRef} style={{ display: 'none' }} />
}
