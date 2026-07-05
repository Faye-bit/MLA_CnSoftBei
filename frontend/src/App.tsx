/**
 * MLA 智小学 - 应用根组件
 * 定义路由表, 包含公开路由(登录/注册)和受保护路由(需登录)
 *
 * 性能优化: 所有页面组件使用 React.lazy() 按需加载 (Vercel Rule 2.4)
 * - 初始 bundle 仅包含路由壳 + 认证逻辑
 * - 各页面代码在用户访问对应路由时才下载
 * - 减少首屏加载时间, 提升 TTI (Time to Interactive)
 */

import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { Spin } from 'antd'
import AppLayout from './components/layout/AppLayout'
import ProtectedRoute from './components/auth/ProtectedRoute'
import AdminRoute from './components/auth/AdminRoute'
import GuestRoute from './components/auth/GuestRoute'

// ==================== 路由级代码分割 (React.lazy) ====================
// 公开页面 (无需登录)
const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const PasswordReset = lazy(() => import('./pages/PasswordReset'))

// 受保护页面 (需登录)
const Dashboard = lazy(() => import('./pages/Dashboard'))
const CourseList = lazy(() => import('./pages/CourseList'))
const CourseDetailPage = lazy(() => import('./pages/CourseDetail'))
const DocumentList = lazy(() => import('./pages/DocumentList'))
const KnowledgeSearch = lazy(() => import('./pages/KnowledgeSearch'))
const Chat = lazy(() => import('./pages/Chat'))
const ProfileCollection = lazy(() => import('./pages/ProfileCollection'))
const StudentProfilePage = lazy(() => import('./pages/StudentProfile'))
const Settings = lazy(() => import('./pages/Settings'))
const Profile = lazy(() => import('./pages/Profile'))

// 管理员页面
const UserManagement = lazy(() => import('./pages/admin/UserManagement'))
const AuditLogs = lazy(() => import('./pages/admin/AuditLogs'))

// 受保护页面 (AI智学)
const ZhiXueHub = lazy(() => import('./pages/ZhiXueHub'))
const ZhiXueSession = lazy(() => import('./pages/ZhiXueSession'))

/** 全局加载占位符: 页面级 Suspense fallback */
const PageLoading = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
    <Spin size="large" />
  </div>
)

export default function App() {
  return (
    <Suspense fallback={<PageLoading />}>
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

            {/* AI智学 */}
            <Route path="/zhixue" element={<ZhiXueHub />} />
            <Route path="/zhixue/:id" element={<ZhiXueSession />} />

            {/* 管理员专属路由: 需要管理员权限 */}
            <Route element={<AdminRoute />}>
              <Route path="/admin/users" element={<UserManagement />} />
              <Route path="/admin/logs" element={<AuditLogs />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </Suspense>
  )
}
