/**
 * URL 工具函数
 * 统一管理 API Base URL 和各资源的 URL 构建逻辑
 */

/** API 基础 URL: 优先使用环境变量, 开发环境默认 localhost:8000 */
export const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:8000'

/** 获取 API Base URL (供非 axios 请求使用, 如 SSE fetch、图片 URL 等) */
export function getApiBaseUrl(): string {
  return API_BASE
}

/** 获取文档页面图片完整 URL */
export function getPageImageUrl(courseId: string, documentId: string, pageNumber: number): string {
  return `${API_BASE}/api/v1/courses/${courseId}/documents/${documentId}/pages/${pageNumber}/image`
}

/** 获取头像完整 URL (处理相对路径和绝对 URL) */
export function getAvatarUrl(avatarPath: string | null | undefined): string | null {
  if (!avatarPath) return null
  if (avatarPath.startsWith('http')) return avatarPath
  return `${API_BASE}${avatarPath}`
}

/** 获取下载会话资源的 URL */
export function getDownloadUrl(sessionId: string, stageIndex?: number): string {
  const base = `${API_BASE}/api/v1/learning/sessions/${sessionId}/download`
  const params = stageIndex !== undefined ? `?stage_index=${stageIndex}` : ''
  return base + params
}

/** 获取 SSE 流式 URL (用于 fetch 非 axios 请求) */
export function getSSEUrl(path: string): string {
  return `${API_BASE}${path}`
}
