/**
 * 思维导图查看器 — 使用 markmap 将 Markdown 标题层级渲染为交互式 SVG 思维导图
 *
 * markmap 优势:
 * - 横向布局 (左→右), 符合阅读习惯
 * - Pan / Zoom / 节点折叠交互
 * - 完全可定制的品牌色系
 *
 * 设计规范 (MLA Brand v2.0):
 * - 根节点使用品牌蓝 blue[500]
 * - 一级分支使用 blue[700]
 * - 二级+使用冷灰 gray[600..400]
 * - 连线使用 blue[300]
 */

import { useEffect, useRef, useState, useMemo } from 'react'
import { Spin, Typography, Button } from 'antd'
import { ReloadOutlined, ExpandOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons'
import { gray, blue, fontFamily } from '../../styles/tokens'

const { Text } = Typography

// ============================================================================
// 静态缓存: 惰性加载的 markmap 模块实例
// ============================================================================

let _globalCounter = 0
let _markmapLib: any = null
let _markmapView: any = null
const LOAD_TIMEOUT = 10000  // 模块加载超时 (10s)
const RENDER_TIMEOUT = 15000 // 渲染超时 (15s)

/** 品牌色数组: depth 0→blue 500, depth 1→blue 700, depth 2→gray 600, depth 3+→gray 500 */
const BRAND_COLORS = [blue[500], blue[700], gray[600], gray[500]]

/** markmap JSON 配置 (便携选项, 可序列化) */
const MARKMAP_JSON_OPTIONS = {
  color: BRAND_COLORS,
  colorFreezeLevel: 2,       // depth 2 开始冻结颜色, 避免深层嵌套五彩缤纷
  duration: 500,             // 折叠/展开动画时长 (ms)
  maxWidth: 320,             // 节点最大宽度 (px)
  nodeMinHeight: 22,         // 节点最小高度, 增大提升可读性
  spacingHorizontal: 100,    // 父子节点水平间距
  spacingVertical: 8,        // 兄弟节点垂直间距
  paddingX: 16,              // 节点内边距
  autoFit: true,             // 自动缩放适配容器
  fitRatio: 0.92,            // fit 缩放比例: 留出少量呼吸空间
}

/**
 * 惰性加载 markmap-lib 和 markmap-view 模块
 * 两个包合计约 500KB, 动态导入不影响首屏加载
 */
async function _getMarkmap(): Promise<{ lib: any; view: any }> {
  if (!_markmapLib) {
    const module = await Promise.race([
      import('markmap-lib'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Markmap 模块加载超时 (10s), 请刷新页面重试')), LOAD_TIMEOUT)
      ),
    ])
    _markmapLib = module
  }
  if (!_markmapView) {
    const module = await Promise.race([
      import('markmap-view'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Markmap 模块加载超时 (10s), 请刷新页面重试')), LOAD_TIMEOUT)
      ),
    ])
    _markmapView = module
  }
  return { lib: _markmapLib, view: _markmapView }
}


// ============================================================================
// MindMapViewer 组件
// ============================================================================

interface MindMapViewerProps {
  /** 思维导图内容: Markdown 标题层级字符串 */
  content: string
}

export default function MindMapViewer({ content }: MindMapViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const markmapRef = useRef<any>(null)       // markmap 实例, 供缩放控制
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  // ── 内容预处理 ──
  const processedContent = useMemo(() => {
    let text = (content || '').trim()
    // 空内容 fallback
    if (!text) return '# (空内容)'
    // 去除 Markdown 代码块包裹 (兼容 LLM 偶尔加包裹的情况)
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:markdown|mermaid)?\s*\n?/, '')
      text = text.replace(/\n?```\s*$/, '')
      text = text.trim()
    }
    return text
  }, [content])

  // ── 渲染 markmap ──
  useEffect(() => {
    let cancelled = false
    _globalCounter += 1
    const renderId = `markmap-${_globalCounter}-${Date.now()}`

    async function renderMarkmap() {
      setLoading(true)
      setError(null)

      // 清理旧内容
      if (containerRef.current) {
        containerRef.current.innerHTML = ''
      }
      markmapRef.current = null

      try {
        // 动态加载模块
        const { lib, view } = await _getMarkmap()
        if (cancelled) return

        // 解析 Markdown → 树结构
        const transformer = new lib.Transformer()
        const { root } = transformer.transform(processedContent)

        // 创建 SVG 容器, 用绝对定位占满父容器以提供确定性尺寸
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.id = renderId
        svg.setAttribute('style', 'display:block;width:100%;height:100%;')

        if (containerRef.current) {
          containerRef.current.appendChild(svg)
        }

        // 合并选项: deriveOptions 将 color[] 转为 (node)=>string 回调
        const options = {
          ...view.deriveOptions(MARKMAP_JSON_OPTIONS),
        }

        // 创建 markmap 实例
        const mm = view.Markmap.create(svg, options, root)
        markmapRef.current = mm  // 保存实例引用

        // 注入品牌字体和样式到 SVG
        const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style')
        styleEl.textContent = `
          .markmap-foreign {
            font-family: ${fontFamily.sans};
          }
          .markmap-node--depth-0 .markmap-foreign {
            font-weight: 700;
            font-size: 16px;
          }
          .markmap-node--depth-1 .markmap-foreign {
            font-weight: 600;
            font-size: 14px;
          }
          .markmap-node--depth-2 .markmap-foreign {
            font-size: 13px;
          }
          .markmap-link {
            stroke: ${blue[300]};
            stroke-opacity: 0.5;
            stroke-width: 2;
          }
          .markmap-node circle {
            fill: ${blue[400]};
            stroke: ${blue[500]};
            r: 5;
          }
        `
        svg.appendChild(styleEl)

        // 等待布局完成后再 fit, 确保容器尺寸已确定
        await new Promise(resolve => requestAnimationFrame(resolve))
        if (cancelled) return

        mm.fit()

        setLoading(false)
      } catch (e) {
        if (!cancelled) {
          console.error('Markmap 渲染失败:', (e as Error).message, e)
          setError((e as Error).message || '思维导图渲染失败')
          setLoading(false)
        }
      }
    }

    // 带超时的渲染
    Promise.race([
      renderMarkmap(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('思维导图渲染超时 (15s)')), RENDER_TIMEOUT)
      ),
    ]).catch((e) => {
      if (!cancelled) {
        console.error('Markmap 渲染超时:', (e as Error).message)
        setError((e as Error).message || '思维导图渲染超时')
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [processedContent, retryCount])

  // ── 缩放控制 ──
  function handleZoomIn() {
    const mm = markmapRef.current
    if (!mm?.svg || !mm?.zoom) return
    mm.transition(mm.svg).call(mm.zoom.scaleBy, 1.3)
  }

  function handleZoomOut() {
    const mm = markmapRef.current
    if (!mm?.svg || !mm?.zoom) return
    mm.transition(mm.svg).call(mm.zoom.scaleBy, 1 / 1.3)
  }

  /** 重置缩放为自动适配 */
  function handleZoomFit() {
    const mm = markmapRef.current
    if (!mm) return
    mm.fit()
  }

  // ── 全屏查看 ──
  function handleFullscreen() {
    const mm = markmapRef.current
    const svgEl = containerRef.current?.querySelector('svg')
    if (!svgEl) return

    const ww = Math.max(1400, screen.availWidth - 100)
    const wh = Math.max(900, screen.availHeight - 100)
    const w = window.open('', '_blank', `width=${ww},height=${wh}`)
    if (!w) return

    w.document.title = '思维导图'
    w.document.body.style.cssText =
      'margin:0;background:#FFFFFF;overflow:hidden;'

    // 全窗口 SVG: 深拷贝保留 markmap 完整结构和 D3 zoom 状态
    const cloned = svgEl.cloneNode(true) as SVGElement
    cloned.setAttribute('style', 'display:block;width:100vw;height:100vh;')

    // 重新执行 fit, 让内容适配全窗口尺寸
    // 简单做法: 读原始 viewBox / g bbox, 设为新 SVG 的 viewBox
    const origG = svgEl.querySelector('g.markmap > g > g') as SVGGElement | null
    if (origG) {
      try {
        const bb = origG.getBBox()
        const pad = 40
        cloned.setAttribute('viewBox',
          `${bb.x - pad} ${bb.y - pad} ${bb.width + pad * 2} ${bb.height + pad * 2}`
        )
        cloned.setAttribute('preserveAspectRatio', 'xMidYMid meet')
      } catch {
        // getBBox 失败时忽略, 保留原始缩放状态即可
      }
    }

    w.document.body.appendChild(cloned)
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 工具栏: 全屏 + 缩放 */}
      {!loading && !error && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          gap: 4, padding: '4px 8px', flexShrink: 0,
          borderBottom: `1px solid ${gray[100]}`,
        }}>
          <Button size="small" icon={<ZoomOutOutlined />} onClick={handleZoomOut} title="缩小" />
          <Button size="small" icon={<ZoomInOutlined />} onClick={handleZoomIn} title="放大" />
          <Button size="small" onClick={handleZoomFit} title="重置为自动适配">
            适配
          </Button>
          <div style={{ width: 1, height: 16, background: gray[200], margin: '0 4px' }} />
          <Button size="small" icon={<ExpandOutlined />} onClick={handleFullscreen} title="全屏查看" />
        </div>
      )}

      {/* SVG 渲染容器 — 填满剩余空间, 让 markmap 获得最大渲染区域 */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          background: '#FAFBFC',
          /** 确保 SVG height:100% 有确定性父级高度 */
          position: 'relative',
        }}
      />

      {/* 加载态 */}
      {loading && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', background: 'rgba(255,255,255,0.9)',
        }}>
          <Spin size="default" />
          <div style={{ marginTop: 12 }}>
            <Text type="secondary">正在渲染思维导图...</Text>
          </div>
        </div>
      )}

      {/* 错误态 */}
      {error && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', background: 'rgba(255,255,255,0.95)',
          textAlign: 'center', padding: 40,
        }}>
          <Text type="danger" style={{ fontSize: 13 }}>{error}</Text>
          <div style={{ marginTop: 8 }}>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => setRetryCount(prev => prev + 1)}
            >
              重试
            </Button>
          </div>
          <pre style={{
            marginTop: 16, padding: 12, background: gray[50],
            borderRadius: 8, textAlign: 'left', fontSize: 12,
            overflow: 'auto', maxHeight: 300, whiteSpace: 'pre-wrap',
            maxWidth: 600,
          }}>
            {processedContent}
          </pre>
        </div>
      )}
    </div>
  )
}
