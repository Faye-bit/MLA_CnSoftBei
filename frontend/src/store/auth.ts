/**
 * 认证状态管理 (Zustand + localStorage 持久化)
 * 管理 JWT Token、用户信息、认证状态和权限
 *
 * 新增:
 * - checkAndClearExpiredToken: 校验 token 是否过期, 过期则自动清理
 * - 通过 persist middleware 的 onRehydrate 钩子, 从 localStorage
 *   恢复状态时自动校验 token 有效性
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UserInfo } from '../types'
import { isTokenExpired } from '../utils/jwt'

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
  /** 检查 token 是否过期, 过期则自动清除认证状态; 返回 true 表示 token 有效 */
  checkAndClearExpiredToken: () => boolean
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
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

      /**
       * 检查 token 是否过期, 过期则自动清除认证状态
       * 应在应用启动时和关键操作前调用
       * @returns true 表示 token 有效 (未过期), false 表示已过期并已清理
       */
      checkAndClearExpiredToken: () => {
        const { token, isAuthenticated } = get()
        // 未登录状态无需检查
        if (!isAuthenticated || !token) return false
        // Token 过期则自动清理
        if (isTokenExpired(token)) {
          get().logout()
          return false
        }
        return true
      },
    }),
    {
      name: 'mla-auth-storage',
      /** localStorage 版本号: UserInfo 字段变更时递增 (Vercel Rule 4.4) */
      version: 1,
      /**
       * 版本迁移函数: 处理 localStorage 中旧版本数据
       * 当 UserInfo 类型变更时, 在此添加迁移逻辑
       */
      migrate: (persistedState: unknown, version: number) => {
        // 当前版本, 无需迁移
        if (version === 0) {
          // v0 -> v1: 初始版本化, 直接返回
          return persistedState as AuthState
        }
        return persistedState as AuthState
      },
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        isAdmin: state.isAdmin,
      }),
      /**
       * 从 localStorage 恢复状态后回调
       * 在此处校验 token: 如果恢复的 token 已过期, 立即清除
       * 这样即使用户刷新页面, 过期的登录状态也会被拦截
       */
      onRehydrateStorage: () => {
        return (state, error) => {
          if (error) {
            console.error('认证状态恢复失败:', error)
            return
          }
          if (state && state.isAuthenticated && state.token) {
            // 从 localStorage 恢复的 token 可能已过期, 需要校验
            if (isTokenExpired(state.token)) {
              // 直接修改 state (这里在 rehydrate 完成后的回调中, 修改 state 是安全的)
              state.token = null
              state.user = null
              state.isAuthenticated = false
              state.isAdmin = false
            }
          }
        }
      },
    }
  )
)
