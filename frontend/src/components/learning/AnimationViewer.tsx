/**
 * 交互动画查看器
 * 通过 iframe srcdoc 渲染 LLM 生成的交互式 HTML 动画页面
 *
 * 安全考量:
 * - 不使用 sandbox 属性: LLM 生成的动画需要完整 JS 执行环境
 *   (requestAnimationFrame / setTimeout / DOM 操作等)
 * - 内容来自后端受控生成, 非用户提交, 风险可控
 * - 使用 srcdoc 注入, 不发起网络请求
 * - 提供全屏按钮: 在新窗口中打开, 方便演示和调试
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { Spin, Typography, Button, message } from 'antd'
import { ExpandOutlined, ReloadOutlined, FullscreenExitOutlined } from '@ant-design/icons'

const { Text } = Typography

/** iframe 加载超时时间 (ms): 超过此时间仍未加载完成则显示错误 */
const IFRAME_LOAD_TIMEOUT = 20000

interface AnimationViewerProps {
  /** 完整的 HTML 文档字符串 (<!DOCTYPE html> 开头) */
  content: string
}

export default function AnimationViewer({ content }: AnimationViewerProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** 是否在全屏模式 (当前页面内最大化) */
  const [isFullscreen, setIsFullscreen] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 使用 key 强制重新挂载 iframe */
  const [renderKey, setRenderKey] = useState(0)

  /**
   * 预处理 HTML 内容:
   * 如果是纯文本 (不含 <html> 标签), 尝试包裹为完整 HTML
   */
  function preprocessContent(raw: string): string {
    let html = raw.trim()

    // 如果以 markdown 代码块包裹, 去除包裹
    if (html.startsWith('```html')) {
      html = html.slice(7)
    } else if (html.startsWith('```')) {
      html = html.slice(3)
    }
    if (html.endsWith('```')) {
      html = html.slice(0, -3)
    }
    html = html.trim()

    // 如果已经是完整 HTML, 直接返回
    if (html.startsWith('<!DOCTYPE') || html.startsWith('<html')) {
      return html
    }

    // 如果包含 <style> 或 <script> 标签, 包装为完整 HTML
    if (html.includes('<style') || html.includes('<script')) {
      return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
${html}
</body>
</html>`
    }

    // 纯文本: 显示错误
    return html
  }

  const processedContent = preprocessContent(content)

  /** iframe 加载完成 */
  const handleIframeLoad = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setLoading(false)
    setError(null)
  }, [])

  /** iframe 开始加载: 设置超时 */
  const handleIframeStart = useCallback(() => {
    setLoading(true)
    setError(null)

    // 清除旧超时
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    // 设置加载超时
    timeoutRef.current = setTimeout(() => {
      setLoading(false)
      setError('动画加载超时 — 页面可能包含错误脚本或过于复杂')
    }, IFRAME_LOAD_TIMEOUT)
  }, [])

  /** 在新窗口中全屏打开动画 (绕过 sandbox 限制) */
  function handleFullscreen() {
    const w = window.open('', '_blank', 'width=1200,height=800')
    if (!w) {
      message.error('弹窗被浏览器拦截, 请允许弹窗后重试')
      return
    }
    w.document.write(processedContent)
    w.document.close()
  }

  /** 页面内最大化切换 */
  function handleToggleMaximize() {
    setIsFullscreen(prev => !prev)
  }

  /** 重新加载动画 */
  function handleRetry() {
    setLoading(true)
    setError(null)
    setRenderKey(prev => prev + 1)  // 强制重新挂载 iframe
  }

  /** 组件卸载时清理超时定时器 */
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [])

  // 处理空内容
  if (!processedContent || processedContent.length < 20) {
    return (
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        minHeight: 400, flexDirection: 'column', gap: 12,
      }}>
        <Text type="secondary">动画内容为空, 请尝试重新生成</Text>
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: isFullscreen ? 'calc(100vh - 120px)' : 600,
        transition: 'height 0.3s ease',
        background: '#f5f5f5',
        borderRadius: isFullscreen ? 0 : 8,
        overflow: 'hidden',
      }}
    >
      {/* ================================================================ */}
      {/* 工具栏: 全屏 + 刷新 */}
      {/* ================================================================ */}
      {!loading && !error && (
        <div style={{
          position: 'absolute', top: 8, right: 8, zIndex: 10,
          display: 'flex', gap: 4,
          background: 'rgba(255,255,255,0.85)',
          borderRadius: 6, padding: '2px 4px',
        }}>
          <Button
            size="small"
            icon={isFullscreen ? <FullscreenExitOutlined /> : <ExpandOutlined />}
            onClick={handleToggleMaximize}
            title={isFullscreen ? '退出最大化' : '页面内最大化'}
          />
          <Button
            size="small"
            icon={<ExpandOutlined />}
            onClick={handleFullscreen}
            title="在新窗口中全屏打开"
          />
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={handleRetry}
            title="重新加载动画"
          />
        </div>
      )}

      {/* ================================================================ */}
      {/* iframe 动画容器 */}
      {/* ================================================================ */}
      <iframe
        ref={iframeRef}
        key={renderKey}
        srcDoc={processedContent}
        title="交互动画"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          display: loading ? 'none' : 'block',
        }}
        onLoad={handleIframeLoad}
      />

      {/* ================================================================ */}
      {/* 加载覆盖层 */}
      {/* ================================================================ */}
      {loading && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: '#fafafa',
        }}>
          <Spin size="default" />
          <div style={{ marginTop: 16 }}>
            <Text type="secondary">正在加载交互动画...</Text>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* 错误覆盖层 */}
      {/* ================================================================ */}
      {error && !loading && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: '#fff', textAlign: 'center', padding: 40,
        }}>
          <Text type="danger" style={{ fontSize: 14 }}>{error}</Text>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <Button icon={<ReloadOutlined />} onClick={handleRetry}>
              重试
            </Button>
            <Button icon={<ExpandOutlined />} onClick={handleFullscreen}>
              新窗口打开
            </Button>
          </div>
        </div>
      )}

    </div>
  )
}
