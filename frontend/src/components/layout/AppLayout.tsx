/**
 * 全局应用布局组件
 * 包含可折叠的侧边栏、顶部导航和内容区域
 * 所有页面通过此布局组件的 Outlet 渲染
 */

import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Layout, Button, theme } from 'antd'
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons'
import Sidebar from './Sidebar'

const { Header, Content } = Layout

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const { token } = theme.useToken()

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* 侧边栏 */}
      <Sidebar collapsed={collapsed} />

      {/* 主内容区域 */}
      <Layout>
        {/* 顶栏 */}
        <Header
          style={{
            padding: '0 24px',
            background: token.colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
            style={{ fontSize: 16, width: 40, height: 40 }}
          />

          <span style={{ marginLeft: 16, fontSize: 16, fontWeight: 500 }}>
            {collapsed ? '' : '面向高校的个性化学习资源智能平台'}
          </span>
        </Header>

        {/* 内容区域 */}
        <Content
          style={{
            margin: 24,
            padding: 24,
            background: token.colorBgContainer,
            borderRadius: token.borderRadiusLG,
            minHeight: 280,
            overflow: 'auto',
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
