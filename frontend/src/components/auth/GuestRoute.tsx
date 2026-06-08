/**
 * 访客路由守卫
 * 已登录时自动跳转到首页, 防止重复访问登录/注册页面
 */

import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../../store'

export default function GuestRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
