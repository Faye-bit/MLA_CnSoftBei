/**
 * MLA 多学助手 - 应用根组件
 * 定义路由表, 所有页面通过 AppLayout 布局渲染
 */

import { Routes, Route } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout'
import Dashboard from './pages/Dashboard'
import CourseList from './pages/CourseList'
import CourseDetailPage from './pages/CourseDetail'
import DocumentList from './pages/DocumentList'
import DocumentUpload from './pages/DocumentUpload'
import KnowledgeSearch from './pages/KnowledgeSearch'

export default function App() {
  return (
    <Routes>
      {/* 所有页面包裹在统一的 AppLayout 布局中 */}
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/courses" element={<CourseList />} />
        <Route path="/courses/:id" element={<CourseDetailPage />} />
        <Route path="/courses/:id/documents" element={<DocumentList />} />
        <Route path="/courses/:id/upload" element={<DocumentUpload />} />
        <Route path="/knowledge" element={<KnowledgeSearch />} />
      </Route>
    </Routes>
  )
}
