/**
 * API 服务层
 * 封装所有后端接口调用, 统一处理请求/响应和错误
 */

import axios, { AxiosError } from 'axios'
import { useAuthStore } from '../store'
import { API_BASE, getApiBaseUrl, getPageImageUrl, getAvatarUrl } from '../utils/urls'
import type {
  ApiResponse,
  PaginatedResponse,
  Course,
  CourseDetail,
  Chapter,
  KnowledgePoint,
  KnowledgePointTreeNode,
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
  Conversation,
  ConversationDetail,
  Message,
  ChatSource,
  WebLink,
  StudentProfile,
  ProfileUpdateRequest,
  ProfileVersion,
  // 资源 (AI智学共享)
  GeneratedResource, GeneratedResourceDetail,
  // 雷达图
  RadarResponse,
  // 仪表盘增强统计
  TodayStatsResponse, WeeklyStatsResponse, FavoritesResponse,
  Todo, TodoCreate, TodoUpdate,
} from '../types'

// 创建 axios 实例, 配置基础 URL 和超时
const api = axios.create({
  baseURL: `${API_BASE}/api/v1`,
  timeout: 600000,  // 文档上传 + 解析可能需要较长时间
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
    // 跳过非 JSON 响应 (如 blob/arraybuffer 等二进制数据)
    if (response.config.responseType === 'blob' || response.config.responseType === 'arraybuffer') {
      return response
    }
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

/** 更新课程 */
export async function updateCourse(courseId: string, data: { name?: string; description?: string }) {
  const res = await api.put<ApiResponse<Course>>(`/courses/${courseId}`, data)
  return res.data.data!
}

/** 删除课程 */
export async function deleteCourse(courseId: string) {
  await api.delete(`/courses/${courseId}`)
}

/** 获取仪表盘统计数据 (课程/文档/切片总数) */
export async function getDashboardStats() {
  const res = await api.get<ApiResponse<{ course_count: number; document_count: number; chunk_count: number }>>('/stats/')
  return res.data.data!
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

/** 获取知识点列表 (树形结构) */
export async function getKnowledgePoints(chapterId: string) {
  const res = await api.get<ApiResponse<KnowledgePointTreeNode[]>>(`/courses/chapters/${chapterId}/knowledge-points`)
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

/** AI 重新分类章节知识点 */
export async function reclassifyKnowledgePoints(chapterId: string) {
  const res = await api.post<ApiResponse<{ category_count: number; item_count: number }>>(
    `/courses/chapters/${chapterId}/knowledge-points/reclassify`
  )
  return res.data.data!
}

// ==================== 文档 API ====================

/** 上传文档 (可指定所属章节) */
export async function uploadDocument(courseId: string, file: File, chapterId?: string) {
  const formData = new FormData()
  formData.append('file', file)
  const params: Record<string, string> = {}
  if (chapterId) params.chapter_id = chapterId
  const res = await api.post<ApiResponse<DocumentUploadResponse>>(
    `/courses/${courseId}/documents/upload`,
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      params,
    }
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

/** 关联文档到章节并自动分类 */
export async function linkDocumentToChapter(courseId: string, documentId: string, chapterId: string) {
  const res = await api.put<ApiResponse<{ document_id: string; chapter_id: string; category_count: number; item_count: number }>>(
    `/courses/${courseId}/documents/${documentId}/link-chapter`, null, { params: { chapter_id: chapterId } }
  )
  return res.data.data!
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

/** 关联页面到知识点 */
export async function linkPageToKp(courseId: string, pageId: string, knowledgePointIds: string[]) {
  await api.put(
    `/courses/${courseId}/documents/pages/${pageId}/link-kp`,
    { knowledge_point_ids: knowledgePointIds }
  )
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

// ==================== 对话 API ====================

/** 创建对话 */
export async function createConversation(data: {
  course_id?: string
  title?: string
  conversation_type?: 'chat' | 'profile_collection'
}) {
  const res = await api.post<ApiResponse<Conversation>>('/chat/conversations', data)
  return res.data.data!
}

/** 获取对话列表 */
export async function getConversations(
  page = 1,
  pageSize = 20,
  type?: 'chat' | 'profile_collection'
) {
  const params: Record<string, string | number> = { page, page_size: pageSize }
  if (type) params.type = type
  const res = await api.get<ApiResponse<PaginatedResponse<Conversation>>>('/chat/conversations', { params })
  return res.data.data!
}

/** 获取对话详情 (含消息列表) */
export async function getConversationDetail(conversationId: string) {
  const res = await api.get<ApiResponse<ConversationDetail>>(`/chat/conversations/${conversationId}`)
  return res.data.data!
}

/** 更新对话标题 */
export async function updateConversation(conversationId: string, data: { title?: string }) {
  const res = await api.put<ApiResponse<Conversation>>(`/chat/conversations/${conversationId}`, data)
  return res.data.data!
}

/** 删除对话 */
export async function deleteConversation(conversationId: string) {
  await api.delete(`/chat/conversations/${conversationId}`)
}

// ============================================================================
// 通用 SSE 流式读取工具
// ============================================================================

/**
 * SSE 流式请求通用函数
 * 封装 fetch + ReadableStream SSE 读取循环, 消除 4 个流式函数中的重复代码
 *
 * @param url       - 完整的请求 URL
 * @param options   - fetch 选项 (method, body, headers 等)
 * @param onEvent   - 事件分发回调, 接收解析后的 JSON 事件对象
 * @param onError   - 错误回调
 * @returns AbortController 用于外部取消请求
 */
function fetchSSEStream(
  url: string,
  options: {
    method?: string
    body?: string
    headers?: Record<string, string>
    externalSignal?: AbortSignal
  },
  onEvent: (event: Record<string, unknown>) => void,
  onError: (message: string) => void,
): AbortController {
  const controller = new AbortController()
  const signal = options.externalSignal || controller.signal
  const token = useAuthStore.getState().token

  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    ...(options.headers || {}),
  }
  if (token) headers.Authorization = `Bearer ${token}`

  fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body || undefined,
    signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        let msg = `请求失败 (${response.status})`
        try {
          const errorData = await response.json()
          msg = errorData?.detail || msg
        } catch { /* use default msg */ }
        onError(msg)
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        onError('无法读取响应流')
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            onEvent(event)
          } catch {
            // 跳过无法解析的行
          }
        }
      }

      // 处理缓冲区中可能残留的完整 SSE 事件
      if (buffer.trim()) {
        try {
          const trimmed = buffer.trim()
          if (trimmed.startsWith('data: ')) {
            const event = JSON.parse(trimmed.slice(6))
            onEvent(event)
          }
        } catch { /* 最后一个片段可能不完整, 忽略 */ }
      }
    })
    .catch((err: Error & { name: string }) => {
      if (err.name !== 'AbortError') {
        onError(err.message || '网络错误')
      }
    })

  return controller
}

/**
 * SSE 流式对话
 * 使用 fetch + ReadableStream 实现 SSE 消费, 不使用 axios
 *
 * @param conversationId - 对话 ID
 * @param content - 用户消息内容
 * @param courseId - 关联课程 ID (可选)
 * @param callbacks - 回调函数集合
 * @returns AbortController 用于取消请求
 */
export function streamChat(
  conversationId: string,
  content: string,
  courseId: string | null,
  callbacks: {
    onContent: (chunk: string) => void
    onSources: (sources: ChatSource[]) => void
    onWebLinks?: (links: WebLink[]) => void
    onDone: (messageId: string) => void
    onError: (error: string) => void
  },
  systemPrompt?: string,
  quickAskMetadata?: Record<string, unknown>,
  webSearchEnabled?: boolean,
  imageUrls?: string[],
): AbortController {
  const url = `${API_BASE}/api/v1/chat/conversations/${conversationId}/messages`
  const body: Record<string, unknown> = { content }
  if (courseId) body.course_id = courseId
  if (systemPrompt) body.system_prompt = systemPrompt
  if (quickAskMetadata) body.quick_ask_context = quickAskMetadata
  if (webSearchEnabled) body.web_search_enabled = true
  if (imageUrls) body.image_urls = imageUrls

  return fetchSSEStream(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    (event) => {
      switch (event.type) {
        case 'content':  callbacks.onContent(event.content as string); break
        case 'sources':  callbacks.onSources((event.sources || []) as ChatSource[]); break
        case 'web_links': callbacks.onWebLinks?.((event.links || []) as WebLink[]); break
        case 'done':     callbacks.onDone(event.message_id as string); break
        case 'error':    callbacks.onError((event.message || '未知错误') as string); break
      }
    },
    callbacks.onError,
  )
}

// ==================== 学生画像 API ====================

/** 上传图片到对话 (返回相对路径 URL) */
export async function uploadChatImage(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post<ApiResponse<{ url: string; size: number }>>('/chat/upload-image', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data.data!.url
}

/** 获取当前用户画像 */
export async function getStudentProfile() {
  const res = await api.get<ApiResponse<StudentProfile>>('/profile/')
  return res.data.data!
}

/** 手动更新画像 */
export async function updateStudentProfile(data: ProfileUpdateRequest) {
  const res = await api.put<ApiResponse<StudentProfile>>('/profile/', data)
  return res.data.data!
}

/** 从对话中提取画像 */
export async function extractProfile(conversationId: string) {
  const res = await api.post<ApiResponse<StudentProfile>>('/profile/extract', {
    conversation_id: conversationId,
  })
  return res.data.data!
}

/** 获取画像版本历史 */
export async function getProfileVersions() {
  const res = await api.get<ApiResponse<ProfileVersion[]>>('/profile/versions')
  return res.data.data!
}

/** 从记忆重建画像 (描述式归类) */
export async function rebuildProfile() {
  const res = await api.post<ApiResponse<StudentProfile>>('/profile/rebuild')
  return res.data.data!
}

/** 删除/重置画像 */
export async function deleteProfile() {
  await api.delete('/profile/')
}

// ==================== 艾宾浩斯复习提醒 API ====================

export interface ReviewItem {
  id: string; content_title: string; content_type: string
  interval_index: number; interval_days: number
  review_at: string; status: string; reminded: boolean
  knowledge_point_id: string | null; course_id: string | null
}
export interface ReviewPendingResponse {
  pending: ReviewItem[]; upcoming: ReviewItem[]
  total_pending: number; total_upcoming: number
}

/** 记录学习行为 */
export async function recordLearning(data: {
  content_type: string; content_title: string
  course_id?: string; knowledge_point_id?: string; duration_seconds?: number
}) {
  const res = await api.post<ApiResponse<{ record_id: string; schedules_count: number }>>('/review/record', data)
  return res.data.data!
}

/** 获取待复习提醒 */
export async function getPendingReviews() {
  const res = await api.get<ApiResponse<ReviewPendingResponse>>('/review/pending')
  return res.data.data!
}

/** 标记复习完成 */
export async function markReviewComplete(scheduleId: string) {
  const res = await api.post<ApiResponse<{ schedule_id: string }>>('/review/complete', { schedule_id: scheduleId })
  return res.data.data!
}

/** 一键完成所有提醒 */
export async function markAllReviewsComplete() {
  const res = await api.post<ApiResponse<{ count: number }>>('/review/complete-all')
  return res.data.data!
}

/** 获取学习行为雷达图 */
export async function getRadarData() {
  const res = await api.get<ApiResponse<RadarResponse>>('/profile/radar')
  return res.data.data!
}

// ==================== 仪表盘增强统计 API ====================

/** 获取今日待办数据 (双源合并: 学习阶段 + 自定义待办) */
export async function getTodayStats() {
  const res = await api.get<ApiResponse<TodayStatsResponse>>('/stats/today')
  return res.data.data!
}

/** 获取本周学习情况统计 */
export async function getWeeklyStats() {
  const res = await api.get<ApiResponse<WeeklyStatsResponse>>('/stats/weekly')
  return res.data.data!
}

/** 获取收藏的学习会话列表 */
export async function getFavorites() {
  const res = await api.get<ApiResponse<FavoritesResponse>>('/stats/favorites')
  return res.data.data!
}

// ==================== 自定义待办 API ====================

/** 创建自定义待办 */
export async function createTodo(data: TodoCreate) {
  const res = await api.post<ApiResponse<Todo>>('/todos/', data)
  return res.data.data!
}

/** 获取自定义待办列表 */
export async function getTodos(isCompleted?: boolean) {
  const params: Record<string, string> = {}
  if (isCompleted !== undefined) params.is_completed = String(isCompleted)
  const res = await api.get<ApiResponse<Todo[]>>('/todos/', { params })
  return res.data.data!
}

/** 更新自定义待办 (修改标题或切换完成状态) */
export async function updateTodo(todoId: string, data: TodoUpdate) {
  const res = await api.put<ApiResponse<Todo>>(`/todos/${todoId}`, data)
  return res.data.data!
}

/** 删除自定义待办 */
export async function deleteTodo(todoId: string) {
  await api.delete(`/todos/${todoId}`)
}

// ============================================================================
// TTS 语音合成
// ============================================================================

/**
 * 调用后端 TTS 服务合成语音
 * 使用火山引擎 seed-tts-2.0 大模型, 将文本合成为 MP3 音频
 * @param text 待合成的文本 (上限 500 字符)
 * @param voice 可选音色 ID, 不传则使用后端默认音色
 * @param speed 可选语速倍率 (0.5 ~ 2.0)
 * @returns MP3 音频 Blob
 */
export async function synthesizeTTS(
  text: string,
  voice?: string,
  speed?: number,
): Promise<Blob> {
  // 使用单独的 axios 调用来获取 blob 响应
  const res = await api.post<Blob>(
    '/tts/synthesize',
    { text, voice, speed },
    { responseType: 'blob' },
  )
  return res.data
}

// ============================================================================
// AI 解释 (快问AI 功能)
// ============================================================================

/**
 * 获取知识点的 AI 解释
 * 前端在展示知识点卡片时调用, 判断是否已有 AI 解释可展示
 */
export async function getKPExplanation(kpId: string) {
  const res = await api.get<ApiResponse<{
    ai_explanation: string | null
    ai_explanation_generated_at: string | null
    ai_explanation_report_count: number
    condensed_text?: string | null
  }>>(`/courses/knowledge-points/${kpId}/ai-explanation`)
  return res.data.data!
}

/**
 * 浓缩 AI 回复并存储到知识点 (手动触发)
 * @param kpId 知识点 ID
 * @param fullResponse 完整的 AI 回复文本
 * @param query 触发该解释的原始用户提问
 * @returns 浓缩结果, 含 condensed_text
 */
export async function condenseAndStoreExplanation(
  kpId: string,
  fullResponse: string,
  query: string,
) {
  const res = await api.post<ApiResponse<{
    ai_explanation: string | null
    ai_explanation_generated_at: string | null
    ai_explanation_report_count: number
    condensed_text?: string | null
  }>>(`/courses/knowledge-points/${kpId}/condense-explanation`, {
    full_response: fullResponse,
    query,
  })
  return res.data.data!
}

/** 删除知识点的 AI 解释 */
export async function deleteAIExplanation(kpId: string) {
  await api.delete(`/courses/knowledge-points/${kpId}/ai-explanation`)
}

/** 报告 AI 解释不准确 (计数器 +1) */
export async function reportAIExplanation(kpId: string) {
  const res = await api.post<ApiResponse<{ report_count: number; hidden: boolean }>>(
    `/courses/knowledge-points/${kpId}/report-ai-explanation`,
  )
  return res.data.data!
}

// ============================================================================
// 工具函数
// ============================================================================

// Re-export URL utility functions from utils/urls.ts for backward compatibility
export { getApiBaseUrl, getPageImageUrl, getAvatarUrl }

/**
 * 带认证的文件下载工具 (blob 方式)
 * 自动处理 Content-Disposition 头解析文件名、创建临时 URL 触发下载
 *
 * @param url - 完整的下载 URL
 * @param defaultFilename - 解析不到 Content-Disposition 时的兜底文件名
 */
export async function downloadFile(url: string, defaultFilename: string = 'download'): Promise<void> {
  const token = useAuthStore.getState().token
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`下载失败: ${response.status}`)

  const blob = await response.blob()
  const contentDisposition = response.headers.get('Content-Disposition')
  let filename = defaultFilename
  if (contentDisposition) {
    const match = contentDisposition.match(/filename\*?=(?:UTF-8'')?([^;\s]+)/i)
    if (match) {
      filename = decodeURIComponent(match[1].replace(/^"|"$/g, ''))
    }
  }

  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(objectUrl)
}

// ============================================================================
// AI智学 (v2) API
// ============================================================================

/** AI智学 会话列表项 */
export interface ZhiXueSessionItem {
  id: string
  course_id: string
  course_name?: string
  status: string
  current_stage_index: number
  total_stages?: number
  is_favorited?: boolean
  created_at: string
  updated_at: string
}

// v2 API 使用独立 baseURL (不是 /api/v1)
const apiV2 = axios.create({
  baseURL: `${API_BASE}/api/v2`,
  timeout: 120000,  // 会话创建 (LLM生成问卷) 可能需要 30-60s
  headers: { 'Content-Type': 'application/json' },
})

// v2 请求拦截器 (复用 v1 的 token 注入逻辑)
apiV2.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

/** 获取智学会话列表 */
export async function getZhiXueSessions(params?: {
  skip?: number
  limit?: number
  course_id?: string
  status?: string
}) {
  const res = await apiV2.get<PaginatedResponse<ZhiXueSessionItem>>('/zhixue/sessions', { params })
  return res.data
}

/** 创建智学会话 */
export async function createZhiXueSession(params: {
  course_id: string
  selected_materials: string[]
  scouting_enabled?: boolean
}) {
  const res = await apiV2.post<{
    session_id: string
    status: string
    next_action: string
    payload?: Record<string, unknown>
    error?: Record<string, unknown>
  }>('/zhixue/sessions', params)
  return res.data  // v2 API 直接返回 session 对象，无 {data: ...} 包裹
}

/** 删除智学会话 */
export async function deleteZhiXueSession(sessionId: string) {
  await apiV2.delete(`/zhixue/sessions/${sessionId}`)
}

/** 获取智学会话详情 */
export async function getZhiXueSessionDetail(sessionId: string) {
  const res = await apiV2.get<ZhiXueSessionItem>(`/zhixue/sessions/${sessionId}`)
  return res.data  // v2 直接返回
}

/** 提交问卷答案 (或跳过) */
export async function submitZhiXueQuestionnaire(
  sessionId: string,
  data: {
    answers?: Array<{ question_id: string; selected_options: string[]; open_text?: string }>
    skipped?: boolean
    skip_reason?: string
  },
) {
  const res = await apiV2.post<{ status: string; next_action: string; payload?: Record<string, unknown> }>(
    `/zhixue/sessions/${sessionId}/questionnaire`, data,
  )
  return res.data
}

/** 提交阶段反馈 */
export async function submitZhiXueFeedback(
  sessionId: string,
  data: { mastery: string; self_assessment?: string; remedial_selected?: string[] },
) {
  const res = await apiV2.post<{ status: string; next_action: string }>(
    `/zhixue/sessions/${sessionId}/feedback`, data,
  )
  return res.data
}

/** 获取阶段资源列表 (不含 content) */
export async function getZhiXueStageResources(sessionId: string, stageIndex: number) {
  const res = await apiV2.get<{ stage_index: number; resources: GeneratedResource[] }>(
    `/zhixue/sessions/${sessionId}/stages/${stageIndex}/resources`,
  )
  return res.data.resources
}

/** 获取资源详情 (含完整 content) */
export async function getZhiXueResourceDetail(resourceId: string): Promise<GeneratedResourceDetail> {
  const res = await apiV2.get<GeneratedResourceDetail>(`/zhixue/resources/${resourceId}`)
  return res.data
}

/** 提交独立补救资源请求 (与阶段反馈解耦) */
export async function submitZhiXueRemedial(
  sessionId: string,
  data: { confusion_text: string; resource_types: string[] },
) {
  const res = await apiV2.post<{ session_id: string; status: string; next_action: string; current_stage?: number; total_stages?: number }>(
    `/zhixue/sessions/${sessionId}/remedial`, data,
  )
  return res.data
}

/** 取消/中断智学会话 */
export async function cancelZhiXueSession(sessionId: string): Promise<void> {
  await apiV2.post(`/zhixue/sessions/${sessionId}/cancel`)
}

/** v2 切换智学会话收藏状态 */
export async function toggleZhiXueFavorite(sessionId: string): Promise<{ is_favorited: boolean }> {
  const res = await apiV2.put<{ session_id: string; is_favorited: boolean }>(
    `/zhixue/sessions/${sessionId}/favorite`,
  )
  return res.data
}

/** v2 获取智学会话下载 URL (直接链接, 用于浏览器下载) */
export function getZhiXueDownloadUrl(sessionId: string): string {
  const token = useAuthStore.getState().token
  return `${API_BASE}/api/v2/zhixue/sessions/${sessionId}/download?token=${encodeURIComponent(token || '')}`
}

/** v2 保存练习题作答进度 */
export async function saveZhiXueExerciseProgress(
  resourceId: string,
  progress: {
    answers: Record<string, number | number[] | string>
    submitted: Record<string, boolean>
    current_index: number
    scores?: Record<string, { score: number; feedback: string }>
  }
): Promise<void> {
  await apiV2.put(`/zhixue/resources/${resourceId}/progress`, progress)
}

/** v2 AI 评分主观题 */
export async function scoreZhiXueExerciseAnswer(
  resourceId: string,
  request: {
    question_id: string
    question_type: string
    question_text: string
    user_answer: string
    reference_answer: string
    explanation?: string
  }
): Promise<{ question_id: string; score: number; feedback: string }> {
  const res = await apiV2.post<{ question_id: string; score: number; feedback: string }>(
    `/zhixue/resources/${resourceId}/score`,
    request
  )
  return res.data
}
