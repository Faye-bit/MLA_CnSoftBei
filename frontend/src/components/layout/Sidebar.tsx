/**
 * 侧边栏导航组件
 * 提供课程管理、知识检索、资源管理等页面的导航入口
 */

import { useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu } from 'antd'
import {
  DashboardOutlined,
  BookOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'

const { Sider } = Layout

type MenuItem = Required<MenuProps>['items'][number]

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
]

interface SidebarProps {
  collapsed: boolean
}

export default function Sidebar({ collapsed }: SidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()

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
      <Menu
        mode="inline"
        selectedKeys={[selectedKey]}
        defaultOpenKeys={['knowledge-group']}
        items={menuItems}
        onClick={handleMenuClick}
        style={{ borderRight: 0 }}
      />
    </Sider>
  )
}
