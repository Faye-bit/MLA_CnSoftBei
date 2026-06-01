/**
 * MLA 多学助手 - 全局类型定义
 * 与后端 API 响应结构对齐
 */

// ==================== 通用类型 ====================

/** 统一 API 响应格式 */
export interface ApiResponse<T> {
  code: number
  message: string
  data: T | null
}

/** 分页响应 */
export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

// ==================== 课程相关 ====================

/** 课程 */
export interface Course {
  id: string
  name: string
  description: string | null
  cover_image: string | null
  created_by: string | null
  chapter_count: number
  document_count: number
  created_at: string
  updated_at: string
}

/** 课程详情 (含章节列表) */
export interface CourseDetail extends Course {
  chapters: Chapter[]
}

/** 章节 */
export interface Chapter {
  id: string
  course_id: string
  title: string
  description: string | null
  order_index: number
  knowledge_point_count: number
  created_at: string
}

/** 知识点 */
export interface KnowledgePoint {
  id: string
  chapter_id: string
  title: string
  description: string | null
  content: string | null
  prerequisite_kp_id: string | null
  difficulty: 'easy' | 'medium' | 'hard'
  created_at: string
}

// ==================== 文档相关 ====================

/** 文档 */
export interface Document {
  id: string
  course_id: string
  filename: string
  file_type: string
  file_size: number
  file_path: string
  parse_status: 'pending' | 'processing' | 'done' | 'failed'
  chunk_count: number
  error_message: string | null
  created_at: string
  updated_at: string
}

/** 文档切片 */
export interface DocumentChunk {
  id: string
  document_id: string
  knowledge_point_id: string | null
  chunk_index: number
  content: string
  chunk_metadata: Record<string, unknown> | null
  token_count: number
  created_at: string
}

/** 文档详情 (含切片列表) */
export interface DocumentDetail extends Document {
  chunks: DocumentChunk[]
}

/** 文档上传响应 */
export interface DocumentUploadResponse {
  document_id: string
  filename: string
  file_type: string
  file_size: number
  parse_status: string
  message: string
}

// ==================== 检索相关 ====================

/** 检索请求 */
export interface RetrievalRequest {
  query: string
  course_id: string
  top_k?: number
}

/** 单条检索结果 */
export interface RetrievalResultItem {
  chunk_id: string
  document_id: string
  document_filename: string
  content: string
  score: number
  chunk_index: number
  metadata: Record<string, unknown> | null
}

/** 检索响应 */
export interface RetrievalResponse {
  query: string
  course_id: string
  results: RetrievalResultItem[]
  total: number
}

// ==================== 创建/更新请求类型 ====================

export interface CourseCreate {
  name: string
  description?: string
  cover_image?: string
}

export interface ChapterCreate {
  title: string
  description?: string
  order_index?: number
}

export interface KnowledgePointCreate {
  title: string
  description?: string
  content?: string
  prerequisite_kp_id?: string
  difficulty?: 'easy' | 'medium' | 'hard'
}
