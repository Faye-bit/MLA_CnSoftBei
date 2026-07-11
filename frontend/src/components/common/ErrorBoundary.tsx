/**
 * 错误边界组件
 * 捕获子组件树中的 JavaScript 错误, 显示降级 UI 而非白屏
 *
 * 使用场景:
 * - 包裹 React.lazy() 加载的页面, 捕获模块加载失败
 * - 包裹关键 UI 区域, 防止局部错误导致整个应用崩溃
 *
 * 注意: 错误边界无法捕获以下错误:
 * - 事件处理器中的错误 (需用 try/catch)
 * - 异步代码中的错误 (需用 try/catch 或 .catch())
 * - 服务端渲染中的错误
 * - 错误边界自身抛出的错误
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button, Result } from 'antd'

interface ErrorBoundaryProps {
  /** 子节点 */
  children: ReactNode
  /** 自定义降级 UI, 不传则使用默认样式 */
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  /** 是否发生了错误 */
  hasError: boolean
  /** 错误信息, 用于调试 */
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  /**
   * 从子组件抛出的错误中派生 state
   * 在渲染阶段调用, 不应包含副作用
   */
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  /**
   * 记录错误信息 (日志/上报)
   * 可在此处对接错误监控服务 (如 Sentry)
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] 捕获到渲染错误:', error)
    console.error('[ErrorBoundary] 组件栈:', errorInfo.componentStack)
  }

  /** 重置错误状态, 尝试重新渲染 */
  handleReset = (): void => {
    this.setState({ hasError: false, error: null })
  }

  /** 刷新页面 (适用于模块加载失败等不可恢复错误) */
  handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // 如果提供了自定义降级 UI, 使用自定义的
      if (this.props.fallback) {
        return this.props.fallback
      }

      // 默认降级 UI: 使用 antd Result 组件
      return (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '100vh',
            padding: 24,
          }}
        >
          <Result
            status="error"
            title="页面加载失败"
            subTitle={
              process.env.NODE_ENV === 'development'
                ? this.state.error?.message || '未知错误'
                : '页面渲染时发生了错误, 请尝试刷新页面'
            }
            extra={[
              <Button key="retry" type="primary" onClick={this.handleReset}>
                重试
              </Button>,
              <Button key="reload" onClick={this.handleReload}>
                刷新页面
              </Button>,
            ]}
          />
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
