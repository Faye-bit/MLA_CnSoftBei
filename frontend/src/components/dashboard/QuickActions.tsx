/**
 * 快捷操作入口组件
 * 提供常用功能的快速跳转入口
 *
 * 设计规范 (MLA Brand v2.0):
 * - 水平排列的圆形图标 + 文字入口
 * - hover 时 gray-50 背景变化 + 图标缩放
 * - 使用品牌语义色 (蓝/绿/紫/琥珀/青/粉)
 *
 * @see branding/MLA_BRAND_GUIDELINES.md
 */

import { useNavigate } from 'react-router-dom'
import {
  ExperimentOutlined,
  UploadOutlined,
  SearchOutlined,
  MessageOutlined,
  BookOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { gray, blue, semantic } from '../../styles/tokens'

/** 快捷入口配置 */
interface QuickActionItem {
  icon: React.ReactNode
  label: string
  path: string
  color: string
  bgColor: string
}

/** 入口按钮样式 */
const ACTION_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  padding: '16px 12px',
  borderRadius: 12,
  cursor: 'pointer',
  transition: 'background-color 0.2s ease',
  flex: 1,
  minWidth: 0,
}

/** 圆形图标容器样式 */
const iconCircleStyle = (bgColor: string, color: string): React.CSSProperties => ({
  width: 44,
  height: 44,
  borderRadius: '50%',
  backgroundColor: bgColor,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 20,
  color,
  transition: 'transform 0.2s ease',
})

/** 标签文字样式 */
const LABEL_STYLE: React.CSSProperties = {
  fontSize: 12,
  color: gray[500],
  textAlign: 'center',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '100%',
}

export default function QuickActions() {
  const navigate = useNavigate()

  /** 快捷入口列表 (品牌语义色) */
  const actions: QuickActionItem[] = [
    { icon: <ExperimentOutlined />, label: 'AI 助学', path: '/learning', color: blue[500], bgColor: blue[50] },
    { icon: <UploadOutlined />, label: '上传文档', path: '/courses', color: semantic.success, bgColor: semantic.successBg },
    { icon: <SearchOutlined />, label: '知识检索', path: '/knowledge', color: '#7C3AED', bgColor: '#F5F3FF' },
    { icon: <MessageOutlined />, label: 'AI 对话', path: '/chat', color: semantic.warning, bgColor: semantic.warningBg },
    { icon: <BookOutlined />, label: '课程管理', path: '/courses', color: '#0891B2', bgColor: '#ECFEFF' },
    { icon: <UserOutlined />, label: '我的画像', path: '/student-profile', color: '#DB2777', bgColor: '#FDF2F8' },
  ]

  return (
    <div style={{ display: 'flex', gap: 8, padding: '4px 0' }}>
      {actions.map((action) => (
        <div
          key={action.label}
          style={ACTION_STYLE}
          onClick={() => navigate(action.path)}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = gray[50]
            const icon = e.currentTarget.querySelector('.action-icon') as HTMLElement
            if (icon) icon.style.transform = 'scale(1.1)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
            const icon = e.currentTarget.querySelector('.action-icon') as HTMLElement
            if (icon) icon.style.transform = 'scale(1)'
          }}
        >
          <div className="action-icon" style={iconCircleStyle(action.bgColor, action.color)}>
            {action.icon}
          </div>
          <div style={LABEL_STYLE}>{action.label}</div>
        </div>
      ))}
    </div>
  )
}
