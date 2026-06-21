/**
 * Canvas 神经网络动画背景
 *
 * 模拟知识图谱/神经网络的视觉效果:
 * - 随机散布的节点 (80 个)
 * - 近距离节点之间连线
 * - 节点缓慢漂移 + 呼吸脉冲
 *
 * 跨路由状态保持:
 *   模块级变量 _globalNodes / _globalAnimId 保存节点数据与动画帧。
 *   组件因路由切换卸载再挂载时, 复用已有节点, 直接恢复动画 — Canvas 不重播。
 *
 * 性能: requestAnimationFrame 驱动, pointer-events: none 不阻断交互
 */

import { useEffect, useRef } from 'react'

// ── 模块级状态 ── 跨组件实例保持, 路由切换不丢失
interface Node {
  x: number; y: number
  baseR: number
  phase: number
  vx: number; vy: number
}

let _globalNodes: Node[] = []
let _globalAnimId = 0

const MARGIN = 40
const MAX_DIST = 150
const NODE_COUNT = 80

export default function NeuralBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 取消上一实例的动画帧 (但不清理节点 — 保留跨路由连续性)
    if (_globalAnimId) cancelAnimationFrame(_globalAnimId)

    function initNodes(w: number, h: number) {
      const nodes: Node[] = []
      for (let i = 0; i < NODE_COUNT; i++) {
        nodes.push({
          x: MARGIN + Math.random() * (w - MARGIN * 2),
          y: MARGIN + Math.random() * (h - MARGIN * 2),
          baseR: 1.2 + Math.random() * 2.5,
          phase: Math.random() * Math.PI * 2,
          vx: (Math.random() - 0.5) * 0.12,
          vy: (Math.random() - 0.5) * 0.12,
        })
      }
      _globalNodes = nodes
    }

    function resize() {
      const parent = canvas!.parentElement
      if (!parent) return
      const dpr = window.devicePixelRatio || 1
      const w = parent.clientWidth
      const h = parent.clientHeight
      canvas!.width = w * dpr
      canvas!.height = h * dpr
      canvas!.style.width = `${w}px`
      canvas!.style.height = `${h}px`
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      // 只在首次或尺寸剧变时重建
      if (_globalNodes.length === 0 || Math.abs(_globalNodes[0].x - w) > 200) {
        initNodes(w, h)
      }
    }

    resize()
    window.addEventListener('resize', resize)

    let startTime = performance.now()

    function animate(now: number) {
      startTime = now

      const dpr = window.devicePixelRatio || 1
      const w = canvas!.width / dpr
      const h = canvas!.height / dpr

      ctx!.clearRect(0, 0, w, h)
      const nodes = _globalNodes

      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy
        if (n.x < MARGIN || n.x > w - MARGIN) n.vx *= -1
        if (n.y < MARGIN || n.y > h - MARGIN) n.vy *= -1
        n.vx += (Math.random() - 0.5) * 0.02
        n.vy += (Math.random() - 0.5) * 0.02
        const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy)
        if (speed > 0.2) { n.vx *= 0.95; n.vy *= 0.95 }
      }

      // 连线
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x
          const dy = nodes[i].y - nodes[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist > MAX_DIST) continue
          const alpha = (1 - dist / MAX_DIST) * 0.15
          ctx!.beginPath()
          ctx!.moveTo(nodes[i].x, nodes[i].y)
          ctx!.lineTo(nodes[j].x, nodes[j].y)
          ctx!.strokeStyle = `rgba(147,197,253,${alpha})`
          ctx!.lineWidth = 0.5
          ctx!.stroke()
        }
      }

      // 节点
      for (const n of nodes) {
        n.phase += 0.008
        const pulse = 1 + Math.sin(n.phase) * 0.4
        const r = n.baseR * pulse
        const glow = ctx!.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 3)
        glow.addColorStop(0, 'rgba(147,197,253,0.35)')
        glow.addColorStop(0.4, 'rgba(96,165,250,0.12)')
        glow.addColorStop(1, 'rgba(96,165,250,0)')
        ctx!.beginPath(); ctx!.arc(n.x, n.y, r * 3, 0, Math.PI * 2)
        ctx!.fillStyle = glow; ctx!.fill()
        ctx!.beginPath(); ctx!.arc(n.x, n.y, r, 0, Math.PI * 2)
        ctx!.fillStyle = 'rgba(191,219,254,0.7)'; ctx!.fill()
      }

      _globalAnimId = requestAnimationFrame(animate)
    }

    _globalAnimId = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(_globalAnimId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        opacity: 0.65,
      }}
    />
  )
}
