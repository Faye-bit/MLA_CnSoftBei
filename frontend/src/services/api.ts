/**
 * API 服务层
 * 封装所有后端接口调用, 统一处理请求/响应和错误
 */

import axios, { AxiosError } from 'axios'
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
} from '../types'

// 创建 axios 实例, 配置基础 URL 和超时
const api = axios.create({
  baseURL: 'http://localhost:8000/api/v1',
  timeout: 60000,  // 文档上传 + 解析可能需要较长时间
  headers: { 'Content-Type': 'application/json' },
})

// 响应拦截器: 统一提取 data 字段
api.interceptors.response.use(
  (response) => {
    const body = response.data as ApiResponse<unknown>
    if (body.code !== 0) {
      return Promise.reject(new Error(body.message || '请求失败'))
    }
    return response
  },
  (error: AxiosError<{ detail?: string }>) => {
    const message = error.response?.data?.detail || error.message || '网络错误'
    return Promise.reject(new Error(message))
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
