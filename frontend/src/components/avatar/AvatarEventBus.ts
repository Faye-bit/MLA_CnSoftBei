/**
 * Live2D 虚拟形象事件总线 + 智能气泡引擎
 *
 * 调试开关: localStorage key `mla-bubble-debug` (true=开启控制台日志)
 */

// ====== 类型 ======

export type AvatarEvent =
  | 'idle_60s' | 'idle_180s' | 'welcome' | 'page_change'
  | 'doc_upload' | 'exercise_done' | 'course_created'

export interface BubbleMessage {
  text: string
  duration?: number
}

type BubbleCallback = (msg: BubbleMessage) => void

// ====== 状态 ======

const MIN_INTERVAL = 30000
let lastTriggerTime = 0
let listeners: BubbleCallback[] = []
let currentRoute = '/'

// ====== 气泡开关 ======

/** 气泡系统是否启用 (由系统设置页控制) */
function isBubbleEnabled(): boolean {
  return localStorage.getItem('mla-bubble-enabled') !== 'false'
}

// ====== 公开 API ======

export function onBubble(fn: BubbleCallback) {
  listeners.push(fn)
  return () => { listeners = listeners.filter(l => l !== fn) }
}

export function triggerBubble(msg: BubbleMessage, cooldown = true) {
  if (!isBubbleEnabled()) return
  const now = Date.now()
  if (cooldown && now - lastTriggerTime < MIN_INTERVAL) return
  lastTriggerTime = now
  listeners.forEach(fn => fn(msg))
}

/** 立即关闭气泡 */
export function dismissBubble() {
  listeners.forEach(fn => fn({ text: '', duration: 0 }))
}

/** 更新当前页面路由 */
export function setCurrentRoute(path: string) {
  currentRoute = path
}

function isLive2DEnabled(): boolean {
  return localStorage.getItem('mla-live2d-enabled') !== 'false'
}

/** 触发虚拟形象事件 */
export function dispatchAvatarEvent(event: AvatarEvent) {
  if (!isLive2DEnabled() && event !== 'welcome') return
  if (!isBubbleEnabled()) return

  const msg = getPresetBubble(event)
  if (!msg) return
  const skipCooldown = event === 'page_change' || event === 'welcome'
  triggerBubble(msg, !skipCooldown)
}

function getPageName(route: string): string {
  if (route === '/' || route.startsWith('/dashboard')) return '仪表盘'
  if (route.startsWith('/courses')) return '课程管理'
  if (route.startsWith('/knowledge')) return '知识检索'
  if (route.startsWith('/profile') || route.startsWith('/student-profile')) return '我的画像'
  if (route.startsWith('/chat') || route.startsWith('/ai-chat')) return 'AI 对话'
  if (route.startsWith('/learning')) return 'AI 助学'
  if (route.startsWith('/settings')) return '系统设置'
  if (route.startsWith('/admin')) return '管理后台'
  return 'MLA 平台'
}

// ====== 预置文案 ======

function getPresetBubble(event: AvatarEvent): BubbleMessage | null {
  const page = getPageName(currentRoute)

  const pageMessages: Record<string, string[]> = {
    '仪表盘': ['看看今天的学习数据吧~', '从这里开始你的学习之旅！'],
    '课程管理': ['管理好课程结构，学习更有条理哦', '记得为每个课程添加章节~'],
    '知识检索': ['输入关键词，AI 帮你找到答案', '试试问一个你最近困惑的问题~'],
    '我的画像': ['完善画像能让 AI 更懂你', '你的学习偏好是什么？'],
    'AI 对话': ['有什么想问的尽管问我~', '和 AI 聊聊学习中的困惑吧'],
    'AI 助学': ['选择一门课程开始学习吧', 'AI 会为你定制专属学习路径'],
    '系统设置': ['配置好 API Key 可以让 AI 更强大', '检查一下设置是否都正确~'],
    '管理后台': ['管理员辛苦啦~', '查看一下用户数据吧'],
    'MLA 平台': ['欢迎使用 MLA 多学助手！', '有什么需要帮助的吗？'],
  }

  const eventMessages: Record<string, string[]> = {
    idle_60s: ['还在吗？我在这儿呢~', '想学习的话随时叫我'],
    idle_180s: ['好久没动了，需要帮助吗？', '要不要喝杯水活动一下~'],
    welcome: ['欢迎回来！准备好学习了吗？', '嗨~ 今天想学什么？'],
    page_change: pageMessages[page] || pageMessages['MLA 平台'],
    doc_upload: ['文档上传成功！试试知识检索吧~', '资料已收录，AI 帮你整理知识点'],
    exercise_done: ['做得不错！要不要再来一组？', '太棒了！休息一下继续~'],
    course_created: ['课程创建成功！添加些资料吧~', '新课程就绪，上传章节内容吧'],
  }

  const pool = eventMessages[event]
  if (!pool) return null
  return { text: pool[Math.floor(Math.random() * pool.length)] }
}

// ====== 空闲检测 (修复: 180s 定时器也正确清理) ======

let idleTimer60: ReturnType<typeof setTimeout> | null = null
let idleTimer180: ReturnType<typeof setTimeout> | null = null
let idle60Fired = false
let idle180Fired = false

function resetIdle() {
  idle60Fired = false
  idle180Fired = false
  if (idleTimer60) clearTimeout(idleTimer60)
  if (idleTimer180) clearTimeout(idleTimer180)

  idleTimer60 = setTimeout(() => {
    if (!idle60Fired) {
      idle60Fired = true
      dispatchAvatarEvent('idle_60s')
    }
  }, 60000)

  idleTimer180 = setTimeout(() => {
    if (!idle180Fired) {
      idle180Fired = true
      dispatchAvatarEvent('idle_180s')
    }
  }, 180000)
}

export function startIdleDetection() {
  ;['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
    window.addEventListener(evt, resetIdle, { passive: true })
  })
  resetIdle()
}

// ====== 时段问候 ======

export function timeGreeting() {
  const h = new Date().getHours()
  if (h >= 6 && h < 12) triggerBubble({ text: '早上好！新的一天开始学习吧~' })
  else if (h >= 12 && h < 18) triggerBubble({ text: '下午好！记得劳逸结合哦~' })
  else if (h >= 18 && h < 24) triggerBubble({ text: '晚上好！回顾一下今天的学习吧~' })
  else triggerBubble({ text: '夜深了，学完这波早点休息哦' })
}
