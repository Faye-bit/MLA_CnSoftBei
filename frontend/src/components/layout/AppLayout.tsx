/**
 * 全局应用布局组件
 * 包含可折叠的侧边栏、顶部导航和内容区域
 * 所有页面通过此布局组件的 Outlet 渲染
 *
 * 设计规范 (MLA Brand v2.0 §9.1-9.2):
 * - Header: 毛玻璃效果, sticky 吸附, 内容滚动时从背后穿过可见模糊
 * - 内容区: gray-50 背景, 占满全部可用区域, 不由外层卡片限制
 * - 侧边栏: gray-100 背景, 1px gray-200 右侧边框
 *
 * 滚动模型 (关键):
 * - 外两栏 flex, 不可滚动
 * - 内层 Layout overflow:auto 作为滚动容器
 * - Header sticky:top 吸附在该滚动容器顶部
 * - Content 自然撑高, 内容滚动时穿过半透明 Header 后方 — 毛玻璃效果显现
 */

import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Button, Avatar, Dropdown, Space, Typography, message } from 'antd'
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  LogoutOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import Sidebar from './Sidebar'
import MLALogo from '../common/MLALogo'
/** 悬浮聊天组件按需加载: 用户点击时才加载聊天模块 */
const FloatingChat = lazy(() => import('../common/FloatingChat'))
import Live2DStage from '../avatar/Live2DStage'
import Live2DChat from '../avatar/Live2DChat'
import AvatarBubble from '../avatar/AvatarBubble'
import { startIdleDetection, timeGreeting, dispatchAvatarEvent, setCurrentRoute, dismissBubble } from '../avatar/AvatarEventBus'
import { getLive2DEnabled } from '../../pages/Settings'
import { useAuthStore } from '../../store'
import { logout as logoutApi, getAvatarUrl } from '../../services/api'
import { getTokenRemainingSeconds } from '../../utils/jwt'
import { gray, blue } from '../../styles/tokens'

const { Text } = Typography

/**
 * 顶栏用户头像下拉菜单组件
 * 点击头像弹出个人中心和退出登录选项
 */
function HeaderUserMenu() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  /** 退出登录 */
  const handleLogout = useCallback(async () => {
    await logoutApi()
    logout()
    message.success('已退出登录')
    navigate('/login', { replace: true })
  }, [logout, navigate])

  /**
   * 下拉菜单项
   * useMemo 缓存: 仅当用户信息或退出回调变化时才重建
   */
  const dropdownItems: MenuProps['items'] = useMemo(() => [
    {
      key: 'user-info',
      label: (
        <div style={{ padding: '4px 0' }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: gray[800] }}>
            {user?.nickname || user?.username || '用户'}
          </div>
          <Text style={{ fontSize: 12, color: gray[500] }}>{user?.email || ''}</Text>
        </div>
      ),
      disabled: true,
    },
    { type: 'divider' },
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: '个人中心',
      onClick: () => navigate('/profile'),
    },
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ], [user?.nickname, user?.username, user?.email, handleLogout, navigate])

  return (
    <Dropdown menu={{ items: dropdownItems }} trigger={['click']} placement="bottomRight">
      <Space style={{ cursor: 'pointer' }}>
        <Avatar
          src={getAvatarUrl(user?.avatar)}
          icon={<UserOutlined />}
          size="small"
          style={{ flexShrink: 0, backgroundColor: blue[500] }}
        />
        <Text
          style={{
            fontSize: 13,
            maxWidth: 100,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: gray[700],
          }}
        >
          {user?.nickname || user?.username || '用户'}
        </Text>
      </Space>
    </Dropdown>
  )
}

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const [live2dVisible, setLive2dVisible] = useState(getLive2DEnabled)

  // 追踪路由变化 → 页面气泡
  useEffect(() => {
    setCurrentRoute(location.pathname)
    const t = setTimeout(() => dispatchAvatarEvent('page_change'), 2000)
    return () => clearTimeout(t)
  }, [location.pathname])

  // 监听 Live2D 开关
  useEffect(() => {
    const h = (e: Event) => setLive2dVisible((e as CustomEvent).detail)
    window.addEventListener('mla-live2d-toggle', h)
    return () => window.removeEventListener('mla-live2d-toggle', h)
  }, [])

  // 智能气泡系统 + 拖动关闭
  useEffect(() => {
    startIdleDetection(); timeGreeting(); dispatchAvatarEvent('welcome')
    const onDrag = () => dismissBubble()
    window.addEventListener('mla-live2d-drag-start', onDrag)
    return () => window.removeEventListener('mla-live2d-drag-start', onDrag)
  }, [])
  useEffect(() => { if (!live2dVisible) dismissBubble() }, [live2dVisible])

  // 保存定时器引用, 用于清理
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    /**
     * 检查 token 并设置自动登出定时器
     * - 在 token 过期前 5 秒自动登出
     * - 每 30 秒轮询一次, 作为安全兜底
     */
    const setupTokenExpiryCheck = () => {
      const storeToken = useAuthStore.getState().token

      if (!storeToken) {
        navigate('/login', { replace: true })
        return
      }

      const remainingSec = getTokenRemainingSeconds(storeToken)

      if (remainingSec <= 0) {
        useAuthStore.getState().logout()
        message.warning('登录已过期，请重新登录')
        navigate('/login', { replace: true })
        return
      }

      // 清除旧定时器, 设置新过期定时器 (提前 5 秒触发)
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

    // 每 30 秒轮询兜底
    pollIntervalRef.current = setInterval(setupTokenExpiryCheck, 30000)

    // 组件卸载时清理
    return () => {
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current)
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
  }, [navigate])

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      {/* === 侧边栏 === */}
      <Sidebar collapsed={collapsed} />

      {/* ==================================================================== */}
      {/* 右侧: 普通 div flex 纵列 — 完全控制滚动模型 */}
      {/*                                                                      */}
      {/* 布局逻辑:                                                              */}
      {/*   [outer Layout] ─ horizontal flex, height: 100vh, overflow:hidden     */}
      {/*     ├─ Sidebar                                                        */}
      {/*     └─ [right div] ─ flex: 1, minHeight:0, 纵列                       */}
      {/*          ├─ [scrollContent div] ─ flex: 1, overflow: auto ← 滚动容器    */}
      {/*          │   ├─ [header div] ─ sticky: top:0 ← 在滚动容器内吸附         */}
      {/*          │   └─ [page div] ─ padding, <Outlet />                      */}
      {/*          │                                                            */}
      {/*   关键: sticky header 必须在 overflow:auto 的容器内部才能生效            */}
      {/* ==================================================================== */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          background: gray[50],
        }}
      >
        {/* === 滚动容器 (sticky header 在此内部吸附) === */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
          }}
        >
          {/* === 顶栏 — 毛玻璃 sticky === */}
          <div
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 100,
              height: 56,
              padding: '0 24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              // 毛玻璃核心: 半透明白色底色 + 背景模糊
              background: 'rgba(255,255,255,0.72)',
              backdropFilter: 'blur(12px) saturate(180%)',
              WebkitBackdropFilter: 'blur(12px) saturate(180%)',
              borderBottom: `1px solid ${gray[200]}`,
            }}
          >
            {/* 左侧: 折叠按钮 + 横排 Logo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Button
                type="text"
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setCollapsed(!collapsed)}
                style={{ fontSize: 16, width: 40, height: 40, color: gray[600] }}
              />
              {!collapsed && (
                <MLALogo variant="horizontal" />
              )}
            </div>

            {/* 右侧: 用户头像下拉 */}
            <HeaderUserMenu />
          </div>

          {/* === 页面内容区 === */}
          <div style={{ padding: 24, background: gray[50] }}>
            <Outlet />
          </div>
        </div>
      </div>

      {/* 按需加载的悬浮聊天组件 */}
      <Suspense fallback={null}>
        <FloatingChat />
      </Suspense>
      <Live2DStage visible={live2dVisible} />
      <Live2DChat />
      <AvatarBubble />
    </Layout>
  )
}
