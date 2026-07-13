/**
 * MLA 智小学 - 全局类型定义
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
  /** AI 解释 (快问AI 功能) */
  ai_explanation: string | null
  ai_explanation_generated_at: string | null
  ai_explanation_report_count: number
}
/** 知识点关联的文档页面信息 */
export interface LinkedPageInfo {
  page_id: string
  document_id: string
  document_name: string
  page_number: number
  image_url: string
  summary: string | null
}

/** 知识点树节点 */
export interface KnowledgePointTreeNode {
  id: string; chapter_id: string; title: string
  description: string | null; content: string | null
  prerequisite_kp_id: string | null; parent_kp_id: string | null
  kp_type: 'category' | 'item'; difficulty: string; created_at: string
  image_url: string
  children: KnowledgePointTreeNode[]
  linked_pages: LinkedPageInfo[]
  /** AI 解释 (快问AI 功能) */
  ai_explanation: string | null
  ai_explanation_generated_at: string | null
  ai_explanation_report_count: number
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
  /** 联网搜索结果链接列表 (仅 web_search_enabled 时返回) */
  web_links?: WebLink[]
  /** 用户上传的图片 URL 列表 */
  image_urls?: string[]
}

/** 联网搜索结果链接 */
export interface WebLink {
  url: string
  title: string
  description: string
  /** 来源平台中文名: 知乎/B站/小红书/CSDN/GitHub 等 */
  source_platform: string
  /** 网站 favicon URL (可选) */
  favicon?: string
  /** 封面图片 URL (可选) */
  image?: string
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

/** 画像版本 */
export interface ProfileVersion {
  version: number
  created_at: string | null
  summary: string | null
}

export interface GeneratedResource {
  id: string
  stage_id: string
  resource_type: ResourceType
  title: string
  description: string | null
  order_index: number
  resource_metadata: Record<string, unknown>
  created_at: string | null
}

/** 生成资源详情 (含 content) */
export interface GeneratedResourceDetail extends GeneratedResource {
  content: string
}

/** 资源类型 */
export type ResourceType = 'handout' | 'mindmap' | 'exercise' | 'reading' | 'coding_practice' | 'video_script'



/** 练习题 JSON 结构 */
export interface ExerciseSet {
  questions: ExerciseQuestion[]
}

export interface ExerciseQuestion {
  id: string
  type: 'single_choice' | 'multiple_choice' | 'true_false' | 'short_answer' | 'fill_blank'
  difficulty: 'easy' | 'medium' | 'hard'
  points: string[]
  question: string
  options: string[]
  /** 答案: 客观题为选项序号, 主观题 (填空/简答) 为参考答案文本 */
  answer: number | number[] | string
  explanation: string
}

// ==================== 雷达图相关 ====================

/** 雷达图单个维度 */
export interface RadarDimension {
  key: string
  label: string
  score: number
  tooltip: string
  icon: string
}

/** 雷达图完整响应 */
export interface RadarResponse {
  dimensions: RadarDimension[]
  overall_score: number
  updated_at: string
  data_available: boolean
}

// ==================== 仪表盘增强统计 ====================

/** 待办来源类型: 自动从学习阶段生成 or 用户自定义 */
export type TodoSource = 'learning_stage' | 'custom'

/** 统一待办项 (双源合并) */
export interface TodoItem {
  source: TodoSource
  // learning_stage 专属字段
  stage_id?: string
  session_id?: string
  course_name?: string
  description?: string
  order_index?: number
  // custom 专属字段
  todo_id?: string
  // 公共字段
  title: string
  is_completed: boolean
}

/** 今日待办响应 */
export interface TodayStatsResponse {
  today_messages: number
  today_completed_stages: number
  items: TodoItem[]
}

/** 每日学习活动统计 */
export interface DailyActivity {
  date: string
  day_name: string
  message_count: number
  stage_count: number
  activity_score: number
}

/** 本周学习情况响应 */
export interface WeeklyStatsResponse {
  days: DailyActivity[]
  week_total_messages: number
  week_total_stages: number
}

/** 收藏项 */
export interface FavoriteItem {
  session_id: string
  course_id: string
  course_name: string | null
  status: string
  current_stage_index: number
  total_stages: number
  completed_stages: number
  progress_percent: number
  updated_at: string | null
}

/** 收藏列表响应 */
export interface FavoritesResponse {
  favorites: FavoriteItem[]
}

// ==================== 自定义待办 ====================

/** 自定义待办 */
export interface Todo {
  id: string
  title: string
  is_completed: boolean
  completed_at: string | null
  created_at: string | null
  updated_at: string | null
}

/** 创建待办请求 */
export interface TodoCreate {
  title: string
}

/** 更新待办请求 */
export interface TodoUpdate {
  title?: string
  is_completed?: boolean
}

// ============================================================================
// AI智学 (v2) 类型定义
// ============================================================================

/** 学习节奏 */
export type StudyPace = 'steady' | 'moderate' | 'cram'

/** 智学会话状态 */
export type ZhiXueSessionStatus =
  | 'idle' | 'questionnaire' | 'planning' | 'generating'
  | 'reviewing' | 'delivering' | 'completed' | 'interrupted' | 'failed'

/** 掌握程度 */
export type MasteryLevel = 'mastered' | 'partially_mastered' | 'not_mastered'

/** 审查判定 */
export type ReviewVerdict = 'PASS' | 'FORMAT_FAIL' | 'KNOWLEDGE_MISMATCH' | 'LOGIC_FAIL'

/** 整体审查结果 */
export type OverallVerdict = 'ALL_PASS' | 'RETRY_L1' | 'MAX_RETRY'

/** 智学问卷题目 */
export interface ZhiXueQuestion {
  question_id: string
  question_type: 'single_choice' | 'multi_choice' | 'open_ended'
  category: string
  text: string
  description?: string
  options: string[]
  required: boolean
}

/** 智学问卷 */
export interface ZhiXueQuestionnaire {
  questionnaire_id: string
  session_id: string
  title: string
  description: string
  questions: ZhiXueQuestion[]
  timeout_seconds: number
}

/** 问卷答案 */
export interface ZhiXueQuestionAnswer {
  question_id: string
  selected_options: string[]
  open_text?: string
}

/** 问卷提交 */
export interface ZhiXueQuestionnaireResponse {
  questionnaire_id: string
  answers: ZhiXueQuestionAnswer[]
}

/** 阶段反馈 */
export interface ZhiXueStageFeedback {
  mastery: MasteryLevel
  self_assessment?: string
}

/** 补救资源请求 */
export interface ZhiXueRemedialRequest {
  selected: ('handout' | 'exercise')[]
}

/** 智学 SSE 事件类型 (扩展现有 v1 类型) */
export type ZhiXueSSEEventType =
  | 'session_init' | 'stage_start' | 'agent_start' | 'agent_progress'
  | 'agent_done' | 'resource_ready' | 'path_update' | 'stage_complete'
  | 'session_complete' | 'error' | 'questionnaire_ready' | 'questionnaire_skipped'
  | 'review_progress' | 'review_result' | 'craft_retry' | 'craft_failed'
  | 'remedial_ready' | 'feedback_ready' | 'interrupted' | 'resumed'
  | 'diagnosis_ready'

/** 智学 SSE 事件 */
export interface ZhiXueSSEEvent {
  type: ZhiXueSSEEventType
  [key: string]: unknown
}

/** 独立补救资源请求 (与阶段反馈解耦) */
export interface ZhiXueIndependentRemedialRequest {
  /** 学生用自然语言描述的困惑 */
  confusion_text: string
  /** 需要的补救资源类型 */
  resource_types: string[]
}

// ============================================================================
// AI智学 — 生成进度面板 Agent 卡片
// ============================================================================

/** Agent 卡片在重设计后的进度面板中的工作流状态 */
export type AgentCardState = 'active' | 'waiting' | 'delivered' | 'idle'

/** 队列排序优先级: 活跃 > 等待 > 交付 (闲置不进入队列) */
export const AGENT_PRIORITY: Record<AgentCardState, number> = {
  active: 0,
  waiting: 1,
  delivered: 2,
  idle: 3,
}

/** 队列中展示的单张 Agent 卡片 */
export interface AgentCard {
  /** framer-motion AnimatePresence 的唯一 key (Agent 全名) */
  id: string
  /** 显示名称, 如 "学习导引师向南" */
  name: string
  /** 头像文件名 (不含扩展名), 对应 /avatars/{icon}.png */
  icon: string
  /** 当前工作流状态 */
  state: AgentCardState
  /** 动态状态消息, 如 "等待俞知交付诊断报告..." */
  message: string
  /** Agent 完成后的结果摘要 (仅在 delivered 状态有值) */
  resultSummary: string | null
}
