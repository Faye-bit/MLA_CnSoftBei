/**
 * 全局应用布局组件
 * 包含可折叠的侧边栏、顶部导航和内容区域
 * 所有页面通过此布局组件的 Outlet 渲染
 *
 * 新增: Token 过期自动登出定时器
 * - 组件挂载时校验 token, 过期则立即登出
 * - 设置 setTimeout 在 token 到期时自动清理登录状态
 * - 每 30 秒轮询一次作为安全兜底
 */

import { useState, useEffect, useRef } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { Layout, Button, theme, message } from 'antd'
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons'
import Sidebar from './Sidebar'
import { useAuthStore } from '../../store'
import { getTokenRemainingSeconds } from '../../utils/jwt'

const { Header, Content } = Layout

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const { token } = theme.useToken()
  const navigate = useNavigate()

  // 保存定时器引用, 用于清理
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    /**
     * 检查 token 并设置自动登出定时器
     * - 在 token 过期前 5 秒自动登出 (留一点缓冲)
     * - 每 30 秒轮询一次, 避免因系统休眠等原因漏掉定时器
     */
    const setupTokenExpiryCheck = () => {
      const storeToken = useAuthStore.getState().token

      if (!storeToken) {
        // Token 不存在 (已在别处登出), 跳转登录页
        navigate('/login', { replace: true })
        return
      }

      const remainingSec = getTokenRemainingSeconds(storeToken)

      if (remainingSec <= 0) {
        // Token 已过期, 立即登出
        useAuthStore.getState().logout()
        message.warning('登录已过期，请重新登录')
        navigate('/login', { replace: true })
        return
      }

      // 清除旧的定时器, 设置新的过期定时器 (提前 5 秒触发, 避免刚好在请求中过期)
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current)
      const timeoutMs = Math.max((remainingSec - 5) * 1000, 0)
      expiryTimerRef.current = setTimeout(() => {
        useAuthStore.getState().logout()
        message.warning('登录已过期，请重新登录')
        navigate('/login', { replace: true })
      }, timeoutMs)
    }

    // 初次检查
    setupTokenExpiryCheck()

    // 每 30 秒轮询一次, 作为安全兜底
    pollIntervalRef.current = setInterval(setupTokenExpiryCheck, 30000)

    // 组件卸载时清理所有定时器
    return () => {
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current)
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
  }, [navigate])

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      {/* 侧边栏 */}
      <Sidebar collapsed={collapsed} />

      {/* 主内容区域 */}
      <Layout style={{ height: '100vh', overflow: 'hidden' }}>
        {/* 顶栏 */}
        <Header
          style={{
            padding: '0 24px',
            background: token.colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            flexShrink: 0,
          }}
        >
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
            style={{ fontSize: 16, width: 40, height: 40 }}
          />

          <span style={{ marginLeft: 16, fontSize: 16, fontWeight: 500 }}>
            {collapsed ? '' : '面向高校的个性化学习资源智能平台'}
          </span>
        </Header>

        {/* 内容区域 */}
        <Content
          style={{
            margin: 24,
            padding: 24,
            background: token.colorBgContainer,
            borderRadius: token.borderRadiusLG,
            flex: 1,
            overflow: 'auto',
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
