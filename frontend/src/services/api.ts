/**
 * API 服务层
 * 封装所有后端接口调用, 统一处理请求/响应和错误
 */

import axios, { AxiosError } from 'axios'
import { useAuthStore } from '../store'
import type {
  ApiResponse,
  PaginatedResponse,
  Course,
  CourseDetail,
  Chapter,
  KnowledgePoint,
  Document,
  DocumentDetail,
  DocumentUploadResponse,
  RetrievalRequest,
  RetrievalResponse,
  CourseCreate,
  ChapterCreate,
  KnowledgePointCreate,
  SendCodeRequest,
  LoginRequest,
  RegisterRequest,
  ResetPasswordRequest,
  TokenResponse,
  UserInfo,
  UserProfileUpdate,
  UserAdminUpdate,
  AvatarUploadResponse,
  AuditLog,
} from '../types'

// 创建 axios 实例, 配置基础 URL 和超时
const api = axios.create({
  baseURL: 'http://localhost:8000/api/v1',
  timeout: 60000,  // 文档上传 + 解析可能需要较长时间
  headers: { 'Content-Type': 'application/json' },
})

// 请求拦截器: 自动附加 JWT Token 到 Authorization Header
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// 响应拦截器: 统一处理 ApiResponse 和 401 Token 过期
api.interceptors.response.use(
  (response) => {
    const body = response.data as ApiResponse<unknown>
    if (body.code !== 0) {
      return Promise.reject(new Error(body.message || '请求失败'))
    }
    return response
  },
  (error: AxiosError<{ detail?: string }>) => {
    if (error.response?.status === 401) {
      // Token 过期才跳转登录页; 登录接口本身返回 401 时不跳转, 让页面显示错误提示
      const wasAuthenticated = useAuthStore.getState().isAuthenticated
      useAuthStore.getState().logout()
      if (wasAuthenticated) {
        window.location.href = '/login'
      }
    }
    const msg = error.response?.data?.detail || error.message || '网络错误'
    return Promise.reject(new Error(msg))
  }
)

// ==================== 课程 API ====================

/** 获取课程列表 */
export async function getCourses(page = 1, pageSize = 20, keyword?: string) {
  const params: Record<string, string | number> = { page, page_size: pageSize }
  if (keyword) params.keyword = keyword
  const res = await api.get<ApiResponse<PaginatedResponse<Course>>>('/courses/', { params })
  return res.data.data!
}

/** 获取课程详情 */
export async function getCourseDetail(courseId: string) {
  const res = await api.get<ApiResponse<CourseDetail>>(`/courses/${courseId}`)
  return res.data.data!
}

/** 创建课程 */
export async function createCourse(data: CourseCreate) {
  const res = await api.post<ApiResponse<Course>>('/courses/', data)
  return res.data.data!
}

/** 删除课程 */
export async function deleteCourse(courseId: string) {
  await api.delete(`/courses/${courseId}`)
}

// ==================== 章节 API ====================

/** 获取章节列表 */
export async function getChapters(courseId: string) {
  const res = await api.get<ApiResponse<Chapter[]>>(`/courses/${courseId}/chapters`)
  return res.data.data!
}

/** 创建章节 */
export async function createChapter(courseId: string, data: ChapterCreate) {
  const res = await api.post<ApiResponse<Chapter>>(`/courses/${courseId}/chapters`, data)
  return res.data.data!
}

/** 删除章节 */
export async function deleteChapter(chapterId: string) {
  await api.delete(`/courses/chapters/${chapterId}`)
}

// ==================== 知识点 API ====================

/** 获取知识点列表 */
export async function getKnowledgePoints(chapterId: string) {
  const res = await api.get<ApiResponse<KnowledgePoint[]>>(`/courses/chapters/${chapterId}/knowledge-points`)
  return res.data.data!
}

/** 创建知识点 */
export async function createKnowledgePoint(chapterId: string, data: KnowledgePointCreate) {
  const res = await api.post<ApiResponse<KnowledgePoint>>(`/courses/chapters/${chapterId}/knowledge-points`, data)
  return res.data.data!
}

/** 删除知识点 */
export async function deleteKnowledgePoint(kpId: string) {
  await api.delete(`/courses/knowledge-points/${kpId}`)
}

// ==================== 文档 API ====================

/** 上传文档 */
export async function uploadDocument(courseId: string, file: File) {
  const formData = new FormData()
  formData.append('file', file)
  const res = await api.post<ApiResponse<DocumentUploadResponse>>(
    `/courses/${courseId}/documents/upload`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  )
  return res.data.data!
}

/** 获取文档列表 */
export async function getDocuments(courseId: string, page = 1, pageSize = 20) {
  const params = { page, page_size: pageSize }
  const res = await api.get<ApiResponse<PaginatedResponse<Document>>>(
    `/courses/${courseId}/documents/`,
    { params }
  )
  return res.data.data!
}

/** 获取文档详情 */
export async function getDocumentDetail(courseId: string, documentId: string) {
  const res = await api.get<ApiResponse<DocumentDetail>>(`/courses/${courseId}/documents/${documentId}`)
  return res.data.data!
}

/** 删除文档 */
export async function deleteDocument(courseId: string, documentId: string) {
  await api.delete(`/courses/${courseId}/documents/${documentId}`)
}

/** 获取课程下所有知识点 (供切片关联选择) */
export async function getCourseKnowledgePoints(courseId: string) {
  const res = await api.get<ApiResponse<Array<{
    knowledge_point_id: string
    title: string
    chapter_title: string
    chapter_id: string
  }>>>(`/courses/${courseId}/documents/knowledge-points`)
  return res.data.data!
}

/** 关联切片到知识点 */
export async function linkChunkToKp(courseId: string, chunkId: string, knowledgePointId: string) {
  await api.put(`/courses/${courseId}/documents/chunks/${chunkId}/link`, null, {
    params: { knowledge_point_id: knowledgePointId },
  })
}

/** 从文档自动提取知识点 */
export async function extractKP(courseId: string, documentId: string, chapterId: string) {
  const res = await api.post<ApiResponse<{
    kp_list: Array<{ title: string; description: string; difficulty: string; chunk_ids: string[] }>
    chapter_id: string
  }>>(`/courses/${courseId}/documents/${documentId}/extract-kp`, null, {
    params: { chapter_id: chapterId },
  })
  return res.data.data!
}

/** 批量创建提取的知识点 */
export async function createExtractedKP(
  courseId: string,
  documentId: string,
  chapterId: string,
  kpList: Array<{ title: string; description: string; difficulty: string; chunk_ids: string[] }>,
) {
  const res = await api.post<ApiResponse<{ created_count: number }>>(
    `/courses/${courseId}/documents/${documentId}/create-kp`,
    { chapter_id: chapterId, kp_list: kpList },
  )
  return res.data.data!
}

// ==================== 检索 API ====================

/** RAG 语义检索 */
export async function searchKnowledge(data: RetrievalRequest) {
  const res = await api.post<ApiResponse<RetrievalResponse>>('/retrieval/search', data)
  return res.data.data!
}

// ==================== 配置 API ====================

/** 配置项 */
export interface ConfigItem {
  key: string
  label: string
  value: string
  default_value: string
}

/** 获取当前配置 */
export async function getApiConfig(): Promise<{ items: ConfigItem[] }> {
  const res = await api.get<ApiResponse<{ items: ConfigItem[] }>>('/config/')
  return res.data.data!
}

/** 更新配置 */
export async function updateApiConfig(configs: Record<string, string>) {
  await api.put('/config/', configs)
}

// ==================== 认证 API ====================

/** 发送邮箱验证码 */
export async function sendVerificationCode(data: SendCodeRequest) {
  await api.post<ApiResponse<null>>('/auth/send-code', data)
}

/** 用户注册 */
export async function register(data: RegisterRequest) {
  const res = await api.post<ApiResponse<UserInfo>>('/auth/register', data)
  return res.data.data!
}

/** 用户登录 */
export async function login(data: LoginRequest) {
  const res = await api.post<ApiResponse<TokenResponse>>('/auth/login', data)
  return res.data.data!
}

/** 重置密码 */
export async function resetPassword(data: ResetPasswordRequest) {
  await api.post<ApiResponse<null>>('/auth/reset-password', data)
}

/** 退出登录 (调用后端记录日志) */
export async function logout() {
  try {
    await api.post<ApiResponse<null>>('/auth/logout')
  } catch {
    // 即使后端调用失败, 也继续执行前端清理
  }
}

// ==================== 用户 API ====================

/** 获取当前用户信息 */
export async function getCurrentUser() {
  const res = await api.get<ApiResponse<UserInfo>>('/users/me')
  return res.data.data!
}

/** 更新个人资料 */
export async function updateProfile(data: UserProfileUpdate) {
  const res = await api.put<ApiResponse<UserInfo>>('/users/me', data)
  return res.data.data!
}

/** 上传头像 */
export async function uploadAvatar(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  const res = await api.post<ApiResponse<AvatarUploadResponse>>(
    '/users/me/avatar',
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  )
  return res.data.data!
}

/** 获取头像完整 URL */
export function getAvatarUrl(avatarPath: string | null | undefined): string | null {
  if (!avatarPath) return null
  if (avatarPath.startsWith('http')) return avatarPath
  return `http://localhost:8000${avatarPath}`
}

// ==================== 管理员 API ====================

/** 获取用户列表 (管理员) */
export async function getUsers(page = 1, pageSize = 20, keyword?: string) {
  const params: Record<string, string | number> = { page, page_size: pageSize }
  if (keyword) params.keyword = keyword
  const res = await api.get<ApiResponse<PaginatedResponse<UserInfo>>>('/users/', { params })
  return res.data.data!
}

/** 获取用户详情 (管理员) */
export async function getUserById(userId: string) {
  const res = await api.get<ApiResponse<UserInfo>>(`/users/${userId}`)
  return res.data.data!
}

/** 管理员更新用户 */
export async function adminUpdateUser(userId: string, data: UserAdminUpdate) {
  const res = await api.put<ApiResponse<UserInfo>>(`/users/${userId}`, data)
  return res.data.data!
}

/** 管理员删除用户 */
export async function adminDeleteUser(userId: string) {
  await api.delete<ApiResponse<null>>(`/users/${userId}`)
}

/** 获取操作日志 (管理员) */
export async function getAuditLogs(
  page = 1,
  pageSize = 20,
  action?: string,
  userId?: string
) {
  const params: Record<string, string | number> = { page, page_size: pageSize }
  if (action) params.action = action
  if (userId) params.user_id = userId
  const res = await api.get<ApiResponse<PaginatedResponse<AuditLog>>>('/audit-logs/', { params })
  return res.data.data!
}
