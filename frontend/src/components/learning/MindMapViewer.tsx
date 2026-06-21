/**
 * 思维导图查看器 — 使用 mermaid.js 渲染 Mermaid mindmap 语法为 SVG 图形
 *
 * 设计规范 (MLA Brand v2.0):
 * - 使用品牌 token
 */

import { useEffect, useRef, useState, useMemo } from 'react'
import { Spin, Typography, Button } from 'antd'
import { ReloadOutlined, ExpandOutlined } from '@ant-design/icons'
import { gray } from '../../styles/tokens'

const { Text } = Typography

let _globalCounter = 0
let _mermaidInstance: any = null
let _initialized = false
const RENDER_TIMEOUT = 15000

async function _getMermaid(): Promise<any> {
  if (!_mermaidInstance) {
    const module = await Promise.race([
      import('mermaid'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Mermaid 模块加载超时 (10s), 请刷新页面重试')), 10000)),
    ])
    _mermaidInstance = module.default || module
  }
  if (!_initialized && _mermaidInstance) {
    _mermaidInstance.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose', logLevel: 'error', mindmap: { useMaxWidth: true, padding: 20 } })
    _initialized = true
  }
  return _mermaidInstance
}

interface MindMapViewerProps { content: string }

export default function MindMapViewer({ content }: MindMapViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  const processedContent = useMemo(() => {
    let text = (content || '').trim()
    if (!text) return 'mindmap\n  root((空内容))'
    if (text.startsWith('```')) { text = text.replace(/^```(?:mermaid)?\s*\n?/, ''); text = text.replace(/\n?```\s*$/, '') }
    if (!text.startsWith('mindmap')) text = 'mindmap\n  ' + text.replace(/\n/g, '\n  ')
    return text.trim()
  }, [content])

  useEffect(() => {
    let cancelled = false
    _globalCounter += 1
    const renderId = `mermaid-mm-${_globalCounter}-${Date.now()}`

    async function renderMermaid() {
      setLoading(true); setError(null)
      if (containerRef.current) containerRef.current.innerHTML = ''
      try {
        const mermaid = await _getMermaid()
        if (cancelled) return
        const result = await Promise.race([
          mermaid.render(renderId, processedContent),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('思维导图渲染超时 (15s)')), RENDER_TIMEOUT)),
        ])
        if (cancelled) return
        if (containerRef.current) containerRef.current.innerHTML = result.svg
        setLoading(false)
      } catch (e) {
        if (!cancelled) { console.error('Mermaid 渲染失败:', (e as Error).message, e); setError((e as Error).message || '思维导图渲染失败'); setLoading(false) }
      }
    }

    renderMermaid()
    return () => { cancelled = true }
  }, [processedContent, retryCount])

  function handleFullscreen() {
    const svg = containerRef.current?.querySelector('svg')
    if (!svg) return
    const w = window.open('', '_blank', 'width=1200,height=800')
    if (!w) return
    w.document.title = '思维导图'
    w.document.body.style.cssText = 'margin:0;background:#FFFFFF;display:flex;justify-content:center;align-items:center;min-height:100vh;'
    w.document.body.appendChild(svg.cloneNode(true))
  }

  return (
    <div style={{ position: 'relative' }}>
      {!loading && !error && (
        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 1, display: 'flex', gap: 4 }}>
          <Button size="small" icon={<ExpandOutlined />} onClick={handleFullscreen} title="全屏查看" />
        </div>
      )}
      <div ref={containerRef} style={{ overflow: 'auto', padding: 20, display: 'flex', justifyContent: 'center', minHeight: 200 }} />
      {loading && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.9)' }}>
          <Spin size="default" /><div style={{ marginTop: 12 }}><Text type="secondary">正在渲染思维导图...</Text></div>
        </div>
      )}
      {error && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.95)', textAlign: 'center', padding: 40 }}>
          <Text type="danger" style={{ fontSize: 13 }}>{error}</Text>
          <div style={{ marginTop: 8 }}><Button size="small" icon={<ReloadOutlined />} onClick={() => setRetryCount(prev => prev + 1)}>重试</Button></div>
          <pre style={{ marginTop: 16, padding: 12, background: gray[50], borderRadius: 8, textAlign: 'left', fontSize: 12, overflow: 'auto', maxHeight: 300, whiteSpace: 'pre-wrap', maxWidth: 600 }}>{processedContent}</pre>
        </div>
      )}
    </div>
  )
}
