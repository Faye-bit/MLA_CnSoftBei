/**
 * 思维导图查看器
 * 使用 mermaid.js 渲染 Mermaid mindmap 语法为 SVG 图形
 *
 * 核心策略:
 * - 模块级初始化 mermaid, 避免重复 initialize 重置内部注册表
 * - 使用 mermaid.render(id, code) 直接获取 SVG, 不依赖 requestAnimationFrame
 * - 全局递增计数器保证每次 render 的 DOM ID 唯一, 避免 mermaid 内部缓存冲突
 * - 渲染超时兜底 (15s), 防止 LLM 生成的畸形语法导致无限等待
 * - 容器 ref 始终挂载在 DOM 中, 确保 SVG 注入目标始终存在
 */

import { useEffect, useRef, useState, useMemo } from 'react'
import { Spin, Typography, Button } from 'antd'
import { ReloadOutlined, ExpandOutlined } from '@ant-design/icons'

const { Text } = Typography

/** 全局计数器: 每次组件渲染实例递增, 保证跨实例 ID 唯一 */
let _globalCounter = 0

/** 模块级 mermaid 实例 + 初始化标志 */
let _mermaidInstance: any = null
let _initialized = false

/** 渲染超时时间 (ms) */
const RENDER_TIMEOUT = 15000

/**
 * 懒加载并初始化 mermaid 实例
 * 包含超时兜底: 防止 Vite 依赖缓存过期导致动态 import 永久挂起
 */
async function _getMermaid(): Promise<any> {
  if (!_mermaidInstance) {
    const module = await Promise.race([
      import('mermaid'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Mermaid 模块加载超时 (10s), 请刷新页面重试')), 10000)
      ),
    ])
    _mermaidInstance = module.default || module
  }
  if (!_initialized && _mermaidInstance) {
    _mermaidInstance.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      logLevel: 'error',
      mindmap: { useMaxWidth: true, padding: 20 },
    })
    _initialized = true
  }
  return _mermaidInstance
}

interface MindMapViewerProps {
  content: string
}

export default function MindMapViewer({ content }: MindMapViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  /**
   * 预处理 Mermaid 内容: 清洗 LLM 输出中的常见格式问题
   */
  const processedContent = useMemo(() => {
    let text = (content || '').trim()
    if (!text) return 'mindmap\n  root((空内容))'

    // 去除 markdown 代码块包裹
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:mermaid)?\s*\n?/, '')
      text = text.replace(/\n?```\s*$/, '')
    }

    // 确保以 mindmap 关键字开头
    if (!text.startsWith('mindmap')) {
      text = 'mindmap\n  ' + text.replace(/\n/g, '\n  ')
    }

    return text.trim()
  }, [content])

  useEffect(() => {
    let cancelled = false
    _globalCounter += 1
    const renderId = `mermaid-mm-${_globalCounter}-${Date.now()}`

    async function renderMermaid() {
      setLoading(true)
      setError(null)

      // 清空容器 (ref 始终挂载, 不会为 null)
      if (containerRef.current) {
        containerRef.current.innerHTML = ''
      }

      try {
        const mermaid = await _getMermaid()

        if (cancelled) return

        const result = await Promise.race([
          mermaid.render(renderId, processedContent),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('思维导图渲染超时 (15s)')), RENDER_TIMEOUT)
          ),
        ])

        if (cancelled) return

        // 容器 ref 始终存在, 直接注入 SVG
        if (containerRef.current) {
          containerRef.current.innerHTML = result.svg
        }
        setLoading(false)
      } catch (e) {
        if (!cancelled) {
          const errMsg = (e as Error).message || '思维导图渲染失败'
          console.error('Mermaid 渲染失败:', errMsg, e)
          setError(errMsg)
          setLoading(false)
        }
      }
    }

    renderMermaid()

    return () => {
      cancelled = true
    }
  }, [processedContent, retryCount])

  /** 全屏查看 */
  function handleFullscreen() {
    const svg = containerRef.current?.querySelector('svg')
    if (!svg) return
    const w = window.open('', '_blank', 'width=1200,height=800')
    if (!w) return
    w.document.title = '思维导图'
    w.document.body.style.cssText =
      'margin:0;background:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;'
    w.document.body.appendChild(svg.cloneNode(true))
  }

  function handleRetry() {
    setRetryCount(prev => prev + 1)
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* 全屏按钮 (仅渲染成功时显示) */}
      {!loading && !error && (
        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 1, display: 'flex', gap: 4 }}>
          <Button size="small" icon={<ExpandOutlined />} onClick={handleFullscreen} title="全屏查看" />
        </div>
      )}

      {/* 容器 div — 始终渲染, 保证 ref 始终指向有效的 DOM 元素 */}
      <div
        ref={containerRef}
        style={{
          overflow: 'auto', padding: 20,
          display: 'flex', justifyContent: 'center',
          minHeight: 200,
        }}
      />

      {/* 加载覆盖层 */}
      {loading && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(255,255,255,0.9)',
        }}>
          <Spin size="default" />
          <div style={{ marginTop: 12 }}>
            <Text type="secondary">正在渲染思维导图...</Text>
          </div>
        </div>
      )}

      {/* 错误覆盖层 */}
      {error && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(255,255,255,0.95)', textAlign: 'center', padding: 40,
        }}>
          <Text type="danger" style={{ fontSize: 13 }}>{error}</Text>
          <div style={{ marginTop: 8 }}>
            <Button size="small" icon={<ReloadOutlined />} onClick={handleRetry}>
              重试
            </Button>
          </div>
          <pre style={{
            marginTop: 16, padding: 12, background: '#f6f8fa', borderRadius: 8,
            textAlign: 'left', fontSize: 12, overflow: 'auto', maxHeight: 300,
            whiteSpace: 'pre-wrap', maxWidth: 600,
          }}>
            {processedContent}
          </pre>
        </div>
      )}
    </div>
  )
}
