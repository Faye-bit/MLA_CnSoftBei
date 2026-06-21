/**
 * 交互动画查看器 — 通过 iframe srcdoc 渲染 LLM 生成的交互式 HTML 动画
 *
 * 设计规范 (MLA Brand v2.0):
 * - 使用品牌 token 替代硬编码色值
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { Spin, Typography, Button, message } from 'antd'
import { ExpandOutlined, ReloadOutlined, FullscreenExitOutlined } from '@ant-design/icons'
import { gray } from '../../styles/tokens'

const { Text } = Typography
const IFRAME_LOAD_TIMEOUT = 20000

interface AnimationViewerProps { content: string }

export default function AnimationViewer({ content }: AnimationViewerProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [renderKey, setRenderKey] = useState(0)

  function preprocessContent(raw: string): string {
    let html = raw.trim()
    if (html.startsWith('```html')) html = html.slice(7)
    else if (html.startsWith('```')) html = html.slice(3)
    if (html.endsWith('```')) html = html.slice(0, -3)
    html = html.trim()
    if (html.startsWith('<!DOCTYPE') || html.startsWith('<html')) return html
    if (html.includes('<style') || html.includes('<script')) {
      return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${html}</body></html>`
    }
    return html
  }

  const processedContent = preprocessContent(content)

  const handleIframeLoad = useCallback(() => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
    setLoading(false); setError(null)
  }, [])

  useEffect(() => {
    timeoutRef.current = setTimeout(() => { setLoading(false); setError('动画加载超时 — 页面可能包含错误脚本或过于复杂') }, IFRAME_LOAD_TIMEOUT)
    return () => { if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null } }
  }, [])

  function handleFullscreen() {
    const w = window.open('', '_blank', 'width=1200,height=800')
    if (!w) { message.error('弹窗被浏览器拦截, 请允许弹窗后重试'); return }
    w.document.write(processedContent); w.document.close()
  }

  function handleRetry() { setLoading(true); setError(null); setRenderKey(prev => prev + 1) }

  if (!processedContent || processedContent.length < 20) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400, flexDirection: 'column', gap: 12 }}><Text type="secondary">动画内容为空, 请尝试重新生成</Text></div>
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: isFullscreen ? 'calc(100vh - 120px)' : '100%', transition: 'height 0.3s ease', background: gray[50], borderRadius: isFullscreen ? 0 : 8, overflow: 'hidden' }}>
      {!loading && !error && (
        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, display: 'flex', gap: 4, background: 'rgba(255,255,255,0.85)', borderRadius: 6, padding: '2px 4px' }}>
          <Button size="small" icon={isFullscreen ? <FullscreenExitOutlined /> : <ExpandOutlined />} onClick={() => setIsFullscreen(prev => !prev)} title={isFullscreen ? '退出最大化' : '页面内最大化'} />
          <Button size="small" icon={<ExpandOutlined />} onClick={handleFullscreen} title="在新窗口中全屏打开" />
          <Button size="small" icon={<ReloadOutlined />} onClick={handleRetry} title="重新加载动画" />
        </div>
      )}
      <iframe ref={iframeRef} key={renderKey} srcDoc={processedContent} title="交互动画"
        style={{ width: '100%', height: '100%', border: 'none', display: loading ? 'none' : 'block' }}
        onLoad={handleIframeLoad} />
      {loading && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: gray[50] }}>
          <Spin size="default" /><div style={{ marginTop: 16 }}><Text type="secondary">正在加载交互动画...</Text></div>
        </div>
      )}
      {error && !loading && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#FFFFFF', textAlign: 'center', padding: 40 }}>
          <Text type="danger" style={{ fontSize: 14 }}>{error}</Text>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <Button icon={<ReloadOutlined />} onClick={handleRetry}>重试</Button>
            <Button icon={<ExpandOutlined />} onClick={handleFullscreen}>新窗口打开</Button>
          </div>
        </div>
      )}
    </div>
  )
}
