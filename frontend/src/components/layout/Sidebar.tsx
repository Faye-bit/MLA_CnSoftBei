/**
 * 侧边栏导航组件
 * 提供课程管理、知识检索、个人中心、管理后台等页面的导航入口
 */

import { useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu, Avatar, Dropdown, Space, Typography, Divider, message } from 'antd'
import {
  DashboardOutlined,
  BookOutlined,
  SearchOutlined,
  SettingOutlined,
  UserOutlined,
  TeamOutlined,
  SafetyCertificateOutlined,
  FileTextOutlined,
  LogoutOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { useAuthStore } from '../../store'
import { logout as logoutApi, getAvatarUrl } from '../../services/api'

const { Sider } = Layout
const { Text } = Typography

type MenuItem = Required<MenuProps>['items'][number]

export default function Sidebar({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const isAdmin = useAuthStore((s) => s.isAdmin)
  const logout = useAuthStore((s) => s.logout)

  /** 导航菜单项配置 */
  const menuItems: MenuItem[] = [
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
      key: 'knowledge-group',
      icon: <SearchOutlined />,
      label: '知识库',
      children: [
        {
          key: '/knowledge',
          icon: <SearchOutlined />,
          label: '知识检索',
        },
      ],
    },
    {
      key: '/profile',
      icon: <UserOutlined />,
      label: '个人中心',
    },
    {
      key: '/settings',
      icon: <SettingOutlined />,
      label: '系统设置',
    },
  ]

  // 管理员专属菜单
  if (isAdmin) {
    menuItems.push({
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

  /** 菜单点击: 跳转到对应路由 */
  const handleMenuClick: MenuProps['onClick'] = (e) => {
    navigate(e.key)
  }

  /** 退出登录 */
  const handleLogout = async () => {
    await logoutApi()
    logout()
    message.success('已退出登录')
    navigate('/login', { replace: true })
  }

  /** 用户下拉菜单 */
  const userDropdownItems: MenuProps['items'] = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: '个人中心',
      onClick: () => navigate('/profile'),
    },
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ]

  /** 根据当前路径确定选中的菜单项 */
  const selectedKey = location.pathname

  return (
    <Sider
      trigger={null}
      collapsible
      collapsed={collapsed}
      width={220}
      style={{
        background: '#fff',
        borderRight: '1px solid #f0f0f0',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Logo 区域 */}
      <div
        style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: '1px solid #f0f0f0',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: collapsed ? 16 : 20,
            fontWeight: 700,
            color: '#1677ff',
            whiteSpace: 'nowrap',
          }}
        >
          {collapsed ? 'MLA' : 'MLA 多学助手'}
        </span>
      </div>

      {/* 导航菜单 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          defaultOpenKeys={['knowledge-group', 'admin-group']}
          items={menuItems}
          onClick={handleMenuClick}
          style={{ borderRight: 0 }}
        />
      </div>

      {/* 底部用户信息 */}
      <div
        style={{
          borderTop: '1px solid #f0f0f0',
          padding: collapsed ? '12px 8px' : '12px',
          flexShrink: 0,
        }}
      >
        <Dropdown menu={{ items: userDropdownItems }} trigger={['click']} placement="topRight">
          <Space
            style={{
              cursor: 'pointer',
              width: '100%',
              justifyContent: collapsed ? 'center' : 'flex-start',
            }}
          >
            <Avatar
              src={getAvatarUrl(user?.avatar)}
              icon={<UserOutlined />}
              size="small"
              style={{ flexShrink: 0 }}
            />
            {!collapsed && (
              <Text
                style={{
                  maxWidth: 120,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 13,
                }}
              >
                {user?.nickname || user?.username || '用户'}
              </Text>
            )}
          </Space>
        </Dropdown>
      </div>
    </Sider>
  )
}
