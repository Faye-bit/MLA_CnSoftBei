/**
 * 侧边栏导航组件
 * 提供课程管理、知识检索、AI 对话、画像、管理后台等页面的导航入口
 * 注: 个人中心和退出登录已移至顶栏右侧头像下拉菜单
 */

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
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { useAuthStore } from '../../store'

const { Sider } = Layout

type MenuItem = Required<MenuProps>['items'][number]

export default function Sidebar({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const isAdmin = useAuthStore((s) => s.isAdmin)

  /** 导航菜单项配置 (个人中心已移至顶栏头像下拉) */
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
        {
          key: '/chat',
          icon: <MessageOutlined />,
          label: 'AI 对话',
        },
      ],
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
    </Sider>
  )
}
