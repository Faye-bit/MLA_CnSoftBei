/**
 * 全局状态管理 (Zustand)
 * 管理当前选中的课程 ID、侧边栏折叠等全局 UI 状态
 */

import { create } from 'zustand'

interface AppState {
  /** 侧边栏折叠状态 */
  sidebarCollapsed: boolean
  /** 切换侧边栏 */
  toggleSidebar: () => void

  /** 当前选中的课程 ID (用于各页面间共享) */
  currentCourseId: string | null
  /** 更新当前课程 */
  setCurrentCourseId: (courseId: string | null) => void
}

export { useAuthStore } from './auth'

export const useAppStore = create<AppState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  currentCourseId: null,
  setCurrentCourseId: (courseId) => set({ currentCourseId: courseId }),
}))
