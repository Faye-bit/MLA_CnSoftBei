/**
 * 认证状态管理 (Zustand + localStorage 持久化)
 * 管理 JWT Token、用户信息、认证状态和权限
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UserInfo } from '../types'

interface AuthState {
  /** JWT 访问令牌 */
  token: string | null
  /** 当前用户信息 */
  user: UserInfo | null
  /** 是否已登录 */
  isAuthenticated: boolean
  /** 是否为管理员 */
  isAdmin: boolean

  /** 登录成功后设置认证状态 */
  setAuth: (token: string, user: UserInfo) => void
  /** 更新用户信息 */
  setUser: (user: UserInfo) => void
  /** 登出: 清除所有认证状态 */
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      isAdmin: false,

      setAuth: (token, user) =>
        set({
          token,
          user,
          isAuthenticated: true,
          isAdmin: user.role === 'admin',
        }),

      setUser: (user) =>
        set({
          user,
          isAdmin: user.role === 'admin',
        }),

      logout: () =>
        set({
          token: null,
          user: null,
          isAuthenticated: false,
          isAdmin: false,
        }),
    }),
    {
      name: 'mla-auth-storage',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        isAdmin: state.isAdmin,
      }),
    }
  )
)
