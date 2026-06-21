/**
 * MLA 智学引擎 - 前端应用入口
 * 挂载 React 应用到 DOM, 配置路由与 Ant Design 主题
 *
 * @see branding/MLA_BRAND_GUIDELINES.md — 品牌视觉唯一权威来源
 * @see frontend/src/styles/tokens.ts — TypeScript 设计 Token
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Ant Design 中文国际化 + 品牌主题配置 */}
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          /* === 品牌主色 === */
          colorPrimary: '#3B82F6',       // blue-500 — 主按钮、链接、活跃态

          /* === 语义色 === */
          colorSuccess: '#16A34A',       // success
          colorWarning: '#D97706',       // warning (唯一保留的暖色)
          colorError: '#DC2626',         // danger
          colorInfo: '#3B82F6',          // info (与主色一致)

          /* === 中性色 === */
          colorBgLayout: '#F8FAFC',      // gray-50 — 页面背景
          colorBgContainer: '#FFFFFF',    // 白色 — 卡片、输入框表面
          colorBorder: '#E2E8F0',        // gray-200 — 边框、分割线
          colorText: '#334155',           // gray-700 — 正文文字
          colorTextHeading: '#1E293B',    // gray-800 — 标题文字
          colorTextSecondary: '#64748B',  // gray-500 — 辅助说明文字
          colorTextDisabled: '#94A3B8',   // gray-400 — 禁用文字

          /* === 圆角 === */
          borderRadius: 6,                // radius-sm — Ant Design 全局圆角基准

          /* === 字体 === */
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
          fontSize: 14,                   // body 字号

          /* === 阴影 === */
          boxShadow: '0 1px 3px rgba(15,23,42,0.06)',          // shadow-sm
          boxShadowSecondary: '0 4px 12px rgba(15,23,42,0.08)', // shadow-md

          /* === 行高 === */
          lineHeight: 1.5,
        },
        /* === 组件级 Token 微调 === */
        components: {
          Menu: {
            itemBg: 'transparent',
            itemSelectedBg: '#FFFFFF',
            itemSelectedColor: '#3B82F6',
            itemHoverBg: '#E2E8F0',
            subMenuItemBg: 'transparent',
          },
          Layout: {
            siderBg: '#F1F5F9',          // gray-100 — 侧边栏背景
            bodyBg: '#F8FAFC',           // gray-50 — 页面背景
            headerBg: 'rgba(255,255,255,0.8)',
          },
          Card: {
            borderRadiusLG: 12,           // radius-lg
            paddingLG: 24,
          },
          Button: {
            primaryShadow: 'none',
            defaultShadow: 'none',
            dangerShadow: 'none',
          },
          Input: {
            activeBorderColor: '#3B82F6',
            activeShadow: '0 0 0 3px rgba(59,130,246,0.15)',
          },
          Table: {
            headerBg: '#F8FAFC',
            borderColor: '#E2E8F0',
          },
          Tag: {
            borderRadiusSM: 6,
          },
          Modal: {
            borderRadiusLG: 16,           // radius-xl
          },
        },
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </StrictMode>,
)
