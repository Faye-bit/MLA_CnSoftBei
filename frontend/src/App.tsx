/**
 * MLA 多学助手 - 应用根组件
 * 定义路由表, 包含公开路由(登录/注册)和受保护路由(需登录)
 */

import { Routes, Route } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout'
import ProtectedRoute from './components/auth/ProtectedRoute'
import AdminRoute from './components/auth/AdminRoute'
import GuestRoute from './components/auth/GuestRoute'

// 公开页面 (无需登录)
import Login from './pages/Login'
import Register from './pages/Register'
import PasswordReset from './pages/PasswordReset'

// 受保护页面 (需登录)
import Dashboard from './pages/Dashboard'
import CourseList from './pages/CourseList'
import CourseDetailPage from './pages/CourseDetail'
import DocumentList from './pages/DocumentList'
import KnowledgeSearch from './pages/KnowledgeSearch'
import Chat from './pages/Chat'
import ProfileCollection from './pages/ProfileCollection'
import StudentProfilePage from './pages/StudentProfile'
import Settings from './pages/Settings'
import Profile from './pages/Profile'

// 管理员页面
import UserManagement from './pages/admin/UserManagement'
import AuditLogs from './pages/admin/AuditLogs'

export default function App() {
  return (
    <Routes>
      {/* 访客路由: 已登录用户自动跳转首页 */}
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/reset-password" element={<PasswordReset />} />
      </Route>

      {/* 受保护路由: 需要登录后才能访问 */}
      <Route element={<ProtectedRoute />}>
        {/* 所有页面包裹在统一的 AppLayout 布局中 */}
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/courses" element={<CourseList />} />
          <Route path="/courses/:id" element={<CourseDetailPage />} />
          <Route path="/courses/:id/documents" element={<DocumentList />} />
          <Route path="/knowledge" element={<KnowledgeSearch />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/chat/:id" element={<Chat />} />
          <Route path="/profile-collection" element={<ProfileCollection />} />
          <Route path="/student-profile" element={<StudentProfilePage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/profile" element={<Profile />} />

          {/* 管理员专属路由: 需要管理员权限 */}
          <Route element={<AdminRoute />}>
            <Route path="/admin/users" element={<UserManagement />} />
            <Route path="/admin/logs" element={<AuditLogs />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  )
}
