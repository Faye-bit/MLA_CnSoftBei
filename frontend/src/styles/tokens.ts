/**
 * MLA（智小学）设计 Token 系统
 *
 * 本文档为品牌视觉指南 (branding/MLA_BRAND_GUIDELINES.md) 的代码实现。
 * 所有 UI 组件应优先引用此处的 token，而非硬编码色值。
 *
 * @see branding/MLA_BRAND_GUIDELINES.md — 品牌视觉唯一权威来源
 * @version 2.0 — 扁平文字标识 · 克制蓝 · 冷灰中性
 */

// ============================================================================
// 品牌主色 (克制的蓝 Blue-500)
// ============================================================================

/** 品牌蓝完整色阶 (50-900)，引用自 Tailwind Blue */
export const blue = {
  50: '#EFF6FF',
  100: '#DBEAFE',
  200: '#BFDBFE',
  300: '#93C5FD',
  400: '#60A5FA',
  /** 品牌主色 — 主按钮、链接、活跃态 */
  500: '#3B82F6',
  /** Hover 态加深 */
  600: '#2563EB',
  /** Active 态按压 */
  700: '#1D4ED8',
  800: '#1E40AF',
  900: '#1E3A8A',
} as const

/** 品牌主色 (最常用) */
export const PRIMARY = blue[500]

// ============================================================================
// 中性色 (冷灰 Slate)
// ============================================================================

/** 冷灰完整色阶 (50-900)，引用自 Tailwind Slate */
export const gray = {
  /** 页面背景 */
  50: '#F8FAFC',
  /** 侧边栏背景、卡片次级底色 */
  100: '#F1F5F9',
  /** 边框、分割线 */
  200: '#E2E8F0',
  /** 输入框边框、禁用态边框 */
  300: '#CBD5E1',
  /** 禁用文字、占位符 */
  400: '#94A3B8',
  /** 辅助说明文字 */
  500: '#64748B',
  /** 次要正文 */
  600: '#475569',
  /** 正文文字 */
  700: '#334155',
  /** 标题文字 */
  800: '#1E293B',
  /** 最深标题、强调文字 */
  900: '#0F172A',
} as const

// ============================================================================
// 语义色彩
// ============================================================================

/** 语义色 Token */
export const semantic = {
  success: '#16A34A',
  successBg: '#DCFCE7',
  /** 警告 (唯一保留的暖色) */
  warning: '#D97706',
  warningBg: '#FEF3C7',
  danger: '#DC2626',
  dangerBg: '#FEE2E2',
  /** 信息 (与主色一致) */
  info: '#3B82F6',
  infoBg: '#EFF6FF',
} as const

// ============================================================================
// 字体系统
// ============================================================================

/** 字体族 */
export const fontFamily = {
  /** 主字体 (Inter + PingFang SC) */
  sans: "'Inter', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
  /** 等宽字体 (代码块、数据展示) */
  mono: "'JetBrains Mono', 'SF Mono', 'Fira Code', 'Consolas', monospace",
} as const

/** 排版层级 */
export const typography = {
  h1: { fontSize: 24, lineHeight: 1.2, fontWeight: 700, letterSpacing: '-0.025em' },
  h2: { fontSize: 18, lineHeight: 1.25, fontWeight: 600, letterSpacing: '-0.015em' },
  h3: { fontSize: 15, lineHeight: 1.35, fontWeight: 600, letterSpacing: '0' },
  body: { fontSize: 14, lineHeight: 1.5, fontWeight: 400, letterSpacing: '0' },
  bodyS: { fontSize: 13, lineHeight: 1.5, fontWeight: 400, letterSpacing: '0' },
  caption: { fontSize: 12, lineHeight: 1.4, fontWeight: 500, letterSpacing: '0' },
  overline: { fontSize: 10, lineHeight: 1.3, fontWeight: 600, letterSpacing: '0.05em' },
  /** 大数字 (统计卡片用) */
  statNumber: { fontSize: 28, fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.02em' },
} as const

// ============================================================================
// 间距系统 (4px 基准)
// ============================================================================

/** 间距 Token (4px 基准网格) */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const

// ============================================================================
// 圆角系统
// ============================================================================

/** 圆角 Token (外层大、内层小) */
export const radius = {
  /** 输入框、标签、小按钮 */
  sm: 6,
  /** 图标容器、列表项 */
  md: 8,
  /** 卡片、面板 */
  lg: 12,
  /** 模态框 */
  xl: 16,
  /** 头像、胶囊标签、浮动按钮 */
  full: 9999,
} as const

// ============================================================================
// 阴影系统 (全部使用 gray-900 rgba)
// ============================================================================

/** 阴影 Token (关键：使用 gray-900 的 rgba，不使用纯黑) */
export const shadow = {
  /** 微分层 (侧边栏活跃项) */
  xs: '0 1px 2px rgba(15,23,42,0.04)',
  /** 下拉菜单 */
  sm: '0 1px 3px rgba(15,23,42,0.06)',
  /** Hover 卡片 */
  md: '0 4px 12px rgba(15,23,42,0.08)',
  /** 模态框 */
  lg: '0 12px 28px rgba(15,23,42,0.10)',
  /** 全屏覆盖层 */
  xl: '0 20px 48px rgba(15,23,42,0.12)',
} as const

// ============================================================================
// 动效系统
// ============================================================================

/** 过渡与动效 Token */
export const motion = {
  /** 标准缓出曲线 (所有交互动画) */
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  /** 微交互 (hover/active/focus) */
  durationFast: '150ms',
  /** 标准过渡 */
  durationNormal: '200ms',
  /** 入场动画、布局切换 */
  durationSlow: '300ms',
} as const

// ============================================================================
// 布局参数
// ============================================================================

/** 布局常量 */
export const layout = {
  /** 侧边栏宽度 */
  sidebarWidth: 232,
  /** 顶部 Header 高度 */
  headerHeight: 56,
  /** 内容区最大宽度 */
  contentMax: 1200,
  /** 卡片列间距 */
  cardGap: 16,
} as const

// ============================================================================
// 组件状态色映射
// ============================================================================

/**
 * 统计卡片主题色配置
 * 四个维度的图标色 + 背景色，用于 StatsOverview 等统计组件
 */
export const statCardColors = [
  { icon: blue[500], bg: blue[50] },       // 蓝色 — 课程/总数
  { icon: semantic.success, bg: semantic.successBg },   // 绿色 — 文档
  { icon: '#7C3AED', bg: '#F5F3FF' },      // 紫色 — 知识切片
  { icon: semantic.warning, bg: semantic.warningBg },   // 琥珀 — 今日消息
] as const

// ============================================================================
// 聚合导出 (便于整体导入)
// ============================================================================

/** 完整设计 Token 集合 */
const tokens = {
  blue,
  gray,
  semantic,
  fontFamily,
  typography,
  space,
  radius,
  shadow,
  motion,
  layout,
  statCardColors,
  PRIMARY,
}

export default tokens
