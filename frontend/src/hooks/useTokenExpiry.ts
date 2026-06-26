/**
 * Token 过期检测 Hook
 * 定期检查 JWT Token 是否过期, 过期时自动登出
 *
 * 用法:
 *   const { isExpired, remainingSeconds } = useTokenExpiry()
 *
 *   // isExpired 为 true 时显示过期提示或重定向
 *   // remainingSeconds 用于倒计时显示 (负数表示已过期)
 */
import { useState, useEffect } from 'react'
import { useAuthStore } from '../store'
import { isTokenExpired, getTokenRemainingSeconds } from '../utils/jwt'

/** 轮询间隔: 30 秒检查一次 */
const CHECK_INTERVAL_MS = 30_000

export function useTokenExpiry() {
  const token = useAuthStore((s) => s.token)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const logout = useAuthStore((s) => s.logout)

  const [isExpired, setIsExpired] = useState(false)
  const [remainingSeconds, setRemainingSeconds] = useState(0)

  useEffect(() => {
    // 未登录: 无需检查
    if (!isAuthenticated || !token) {
      setIsExpired(false)
      setRemainingSeconds(0)
      return
    }

    /** 检查 Token 是否过期 */
    const check = () => {
      const expired = isTokenExpired(token)
      setIsExpired(expired)
      setRemainingSeconds(getTokenRemainingSeconds(token))

      if (expired) {
        logout()
      }
    }

    // 挂载 / token 变化时立即检查
    check()

    // 每 30 秒轮询一次
    const interval = setInterval(check, CHECK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [token, isAuthenticated, logout])

  return { isExpired, remainingSeconds }
}
