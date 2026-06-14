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
  id: string; chapter_id: string; title: string
  description: string | null; content: string | null
  prerequisite_kp_id: string | null; parent_kp_id: string | null
  kp_type: 'category' | 'item'
  difficulty: 'easy' | 'medium' | 'hard'; created_at: string
}
/** 知识点树节点 */
export interface KnowledgePointTreeNode {
  id: string; chapter_id: string; title: string
  description: string | null; content: string | null
  prerequisite_kp_id: string | null; parent_kp_id: string | null
  kp_type: 'category' | 'item'; difficulty: string; created_at: string
  children: KnowledgePointTreeNode[]
}

// ==================== 文档相关 ====================

/** 文档 */
export interface Document {
  id: string
  course_id: string
  chapter_id: string | null
  filename: string
  file_type: string
  file_size: number
  file_path: string
  parse_status: 'pending' | 'processing' | 'done' | 'failed' | 'chunked'
  chunk_count: number
  page_count: number
  kp_count: number
  error_message: string | null
  created_at: string
  updated_at: string
}

/** 文档页面 (PDF/PPTX 页面级索引) */
export interface DocumentPage {
  id: string
  page_number: number
  image_url: string
  summary: string | null
  /** LLM 提取的知识点原始数据 */
  extracted_kps: Array<{ title: string; description: string; difficulty: 'easy' | 'medium' | 'hard' }>
  /** 已关联的正式知识点 ID 列表 */
  linked_kp_ids: string[]
  created_at: string
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

/** 文档详情 (根据 file_type 返回 pages 或 chunks) */
export interface DocumentDetail extends Document {
  chunks: DocumentChunk[]
  pages: DocumentPage[]
  page_count: number
  kp_count: number
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

/** 检索请求 (Phase 2 增强) */
export interface RetrievalRequest {
  query: string
  course_id: string
  top_k?: number
  /** 是否启用 LLM 增强处理 (提取观点、关键词、去重合并) */
  enhance?: boolean
  /** 相似度阈值 (0.0-1.0), 低于此分数的结果被隐藏, 默认 0.0 不过滤 */
  similarity_threshold?: number
}

/** 单条检索结果 (Phase 2 扩展: 章节/知识点关联 + LLM 增强) */
export interface RetrievalResultItem {
  chunk_id: string
  document_id: string
  document_filename: string
  /** 切片文本内容 (增强模式下已清洗) */
  content: string
  score: number
  chunk_index: number
  metadata: Record<string, unknown> | null
  // Phase 2: 来源结构化上下文
  chapter_title: string | null
  chapter_id: string | null
  knowledge_point_title: string | null
  knowledge_point_id: string | null
  // Phase 2: LLM 增强结果
  /** AI 提取的核心观点 (一句话摘要) */
  enhanced_summary: string | null
  /** AI 提取的关键词列表 */
  keywords: string[]
  /** 查询关键词高亮位置 [{keyword, positions: [[start,end],...]}] */
  highlights: Array<{ keyword: string; positions: Array<[number, number]> }>
}

/** 页面级检索结果 (Phase 3: PDF/PPTX 文档) */
export interface PageRetrievalResult {
  result_type: 'page'
  page_id: string
  document_id: string
  document_name: string
  page_number: number
  image_url: string
  summary: string | null
  score: number
  /** 关联的知识点列表 */
  knowledge_points: Array<{ id: string; title: string; description: string | null; difficulty: string }>
}

/** 检索响应 (Phase 3 扩展: 支持 page 和 chunk 两种结果类型) */
export interface RetrievalResponse {
  query: string
  course_id: string
  results: RetrievalResultItem[]
  total: number
  /** 是否使用了 LLM 增强 */
  enhanced: boolean
  /** AI 自动去重合并的结果数 */
  deduplicated_count: number
  // Phase 3: 页面级检索结果
  page_results: PageRetrievalResult[]
  page_total: number
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
  title: string; description?: string; content?: string
  prerequisite_kp_id?: string; parent_kp_id?: string
  kp_type?: 'category' | 'item'
  difficulty?: 'easy' | 'medium' | 'hard'
}

// ==================== 认证相关 ====================

/** 发送验证码请求 */
export interface SendCodeRequest {
  email: string
  purpose: 'register' | 'reset_password'
}

/** 登录请求 */
export interface LoginRequest {
  email: string
  password: string
}

/** 注册请求 */
export interface RegisterRequest {
  email: string
  username: string
  password: string
  full_name?: string
  school?: string
  major?: string
  grade?: string
  education_level?: string
  role: 'student' | 'teacher'
  verification_code: string
}

/** 重置密码请求 */
export interface ResetPasswordRequest {
  email: string
  verification_code: string
  new_password: string
}

/** JWT Token 响应 */
export interface TokenResponse {
  access_token: string
  token_type: string
  user: UserInfo
}

// ==================== 用户相关 ====================

/** 用户信息 */
export interface UserInfo {
  id: string
  username: string
  email: string
  full_name: string | null
  nickname: string | null
  avatar: string | null
  school: string | null
  major: string | null
  grade: string | null
  education_level: string | null
  role: 'student' | 'teacher' | 'admin'
  email_verified: boolean
  created_at: string | null
  updated_at: string | null
}

/** 个人资料更新请求 */
export interface UserProfileUpdate {
  full_name?: string
  nickname?: string
  school?: string
  major?: string
  grade?: string
  education_level?: string
}

/** 管理员更新用户请求 */
export interface UserAdminUpdate {
  full_name?: string
  nickname?: string
  school?: string
  major?: string
  grade?: string
  education_level?: string
  role?: 'student' | 'teacher' | 'admin'
  email_verified?: boolean
}

/** 头像上传响应 */
export interface AvatarUploadResponse {
  avatar_url: string
  message: string
}

// ==================== 审计日志 ====================

/** 操作日志 */
export interface AuditLog {
  id: string
  user_id: string | null
  user_email: string | null
  action: string
  ip_address: string | null
  user_agent: string | null
  details: Record<string, unknown> | null
  created_at: string | null
}

// ==================== 对话相关 ====================

/** 对话会话 */
export interface Conversation {
  id: string
  user_id: string
  course_id: string | null
  title: string
  conversation_type: 'chat' | 'profile_collection'
  profile_collection_stage: string | null
  message_count: number
  created_at: string | null
  updated_at: string | null
}

/** 对话详情 (含消息列表) */
export interface ConversationDetail extends Conversation {
  messages: Message[]
}

/** 消息 */
export interface Message {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  sources: ChatSource[] | null
  message_metadata: Record<string, unknown> | null
  created_at: string | null
}

/** 知识库引用来源 */
export interface ChatSource {
  chunk_id: string
  document_id: string
  document_filename: string
  content: string
  score: number
  chunk_index: number
  /** 结果类型: "page" (PDF/PPTX 页面) 或 undefined (文本切片) */
  result_type?: 'page'
  /** 页码 (仅 page 类型) */
  page_number?: number
}

/** 创建对话请求 */
export interface ConversationCreate {
  course_id?: string
  title?: string
  conversation_type?: 'chat' | 'profile_collection'
}

/** 发送消息请求 */
export interface SendMessageRequest {
  content: string
  course_id?: string | null
}

// ==================== 学生画像相关 (描述式) ====================

/** 完整画像数据 (6 个维度, 每个为自然语言描述文本) */
export interface ProfileData {
  academic_background: string
  knowledge_basis: string
  learning_goals: string
  learning_preferences: string
  weak_areas: string
  interests: string
  [key: string]: string
}

/** 学生画像 */
export interface StudentProfile {
  id: string
  user_id: string
  profile_data: ProfileData
  missing_fields: string[]
  summary: string | null
  memories: string[]
  version: number
  created_at: string | null
  updated_at: string | null
}

/** 画像更新请求 */
export interface ProfileUpdateRequest {
  profile_data?: Partial<ProfileData>
  summary?: string
}

/** 画像提取请求 */
export interface ProfileExtractionRequest {
  conversation_id: string
}

/** 画像版本 */
export interface ProfileVersion {
  version: number
  created_at: string | null
  summary: string | null
}
