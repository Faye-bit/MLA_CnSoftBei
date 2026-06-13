/**
 * 受保护路由守卫
 * 未登录或 token 过期时重定向到登录页面, 已登录时正常渲染子路由
 *
 * 修复: 新增 token 过期校验逻辑
 * - 之前只检查 isAuthenticated 布尔值, token 过期后仍可访问受保护页面
 * - 现在每次渲染前检查 token 是否过期, 过期则自动清理并重定向
 */

import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../../store'
import { isTokenExpired } from '../../utils/jwt'

export default function ProtectedRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const token = useAuthStore((s) => s.token)

  // 检查 token 是否已过期 (isAuthenticated 为 true 但 token 可能已到期)
  const tokenExpired = isAuthenticated && token ? isTokenExpired(token) : false

  // 如果 token 已过期, 在 effect 中清理 store (不能在 render 中直接调用 setState)
  useEffect(() => {
    if (tokenExpired) {
      useAuthStore.getState().logout()
    }
  }, [tokenExpired])

  // token 过期或未登录 → 重定向到登录页
  if (!isAuthenticated || tokenExpired) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}
