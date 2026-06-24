/**
 * 侧边栏导航组件
 * 提供课程管理、知识检索、AI 对话、画像、管理后台等页面的导航入口
 *
 * 设计规范 (MLA Brand v2.0 §9.1):
 * - 背景: gray-100 (#F1F5F9)
 * - 活跃项: 白色背景 + shadow-xs + 1px gray-200 边框 (浮起效果)
 * - 默认项: 透明背景, hover 时 gray-200 背景
 * - 右侧 1px gray-200 边框与页面背景 gray-50 形成一级明度差
 * - 顶部纯文字 MLA Logo (竖排完整标识)
 */

import { useMemo, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu } from 'antd'
import {
  DashboardOutlined,
  BookOutlined,
  SearchOutlined,
  SettingOutlined,
  TeamOutlined,
  SafetyCertificateOutlined,
  FileTextOutlined,
  MessageOutlined,
  IdcardOutlined,
  ExperimentOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { useAuthStore } from '../../store'
import MLALogo from '../common/MLALogo'
import { gray } from '../../styles/tokens'

const { Sider } = Layout

type MenuItem = Required<MenuProps>['items'][number]

export default function Sidebar({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const isAdmin = useAuthStore((s) => s.isAdmin)

  /**
   * 导航菜单项配置
   * 使用 useMemo 缓存: 仅当管理员状态变化时才重建
   */
  const menuItems: MenuItem[] = useMemo(() => {
    const items: MenuItem[] = [
      {
        key: '/',
        icon: <DashboardOutlined />,
        label: '首页仪表盘',
      },
      {
        key: '/courses',
        icon: <BookOutlined />,
        label: '课程管理',
      },
      {
        key: '/knowledge',
        icon: <SearchOutlined />,
        label: '知识检索',
      },
      {
        key: '/chat',
        icon: <MessageOutlined />,
        label: 'AI 对话',
      },
      {
        key: '/learning',
        icon: <ExperimentOutlined />,
        label: 'AI 助学',
      },
      {
        key: '/student-profile',
        icon: <IdcardOutlined />,
        label: '我的画像',
      },
      {
        key: '/settings',
        icon: <SettingOutlined />,
        label: '系统设置',
      },
    ]

    // 管理员专属菜单
    if (isAdmin) {
      items.push({
        key: 'admin-group',
        icon: <SafetyCertificateOutlined />,
        label: '管理后台',
        children: [
          {
            key: '/admin/users',
            icon: <TeamOutlined />,
            label: '用户管理',
          },
          {
            key: '/admin/logs',
            icon: <FileTextOutlined />,
            label: '操作日志',
          },
        ],
      })
    }

    return items
  }, [isAdmin])

  /** 菜单点击: 跳转到对应路由 */
  const handleMenuClick: MenuProps['onClick'] = useCallback((e) => {
    navigate(e.key)
  }, [navigate])

  /** 根据当前路径确定选中的菜单项 */
  const selectedKey = location.pathname

  return (
    <Sider
      trigger={null}
      collapsible
      collapsed={collapsed}
      width={232}
      style={{
        background: gray[100],
        borderRight: `1px solid ${gray[200]}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* ================================================================ */}
      {/* Logo 区域 — 纯文字 MLA 标识 */}
      {/* ================================================================ */}
      <div
        style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: collapsed ? undefined : 24,
          justifyContent: collapsed ? 'center' : 'flex-start',
          borderBottom: `1px solid ${gray[200]}`,
          flexShrink: 0,
        }}
      >
        {collapsed ? (
          <MLALogo variant="compact" onClick={() => navigate('/')} />
        ) : (
          <MLALogo variant="vertical" onClick={() => navigate('/')} />
        )}
      </div>

      {/* ================================================================ */}
      {/* 导航菜单 */}
      {/* ================================================================ */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          defaultOpenKeys={['admin-group']}
          items={menuItems}
          onClick={handleMenuClick}
          style={{
            borderRight: 0,
            background: 'transparent',
          }}
        />
      </div>
    </Sider>
  )
}
