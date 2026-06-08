/**
 * 受保护路由守卫
 * 未登录时重定向到登录页面, 已登录时正常渲染子路由
 */

import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../../store'

export default function ProtectedRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}
