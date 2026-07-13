/**
 * 首页仪表盘 (品牌 v2.0 + Phase 4 视觉提升)
 *
 * Bento Grid 布局, 展示学习全貌:
 * Row 1: 四个统计概览卡片 (课程/文档/切片/今日消息)
 * Row 2: 本周学习活动图表 (宽) + 今日待办 (窄)
 * Row 3: 学习进度概览 + 学习画像雷达图 + 我的收藏
 *
 * Phase 4 提升:
 * - 卡片 hover 时上浮 translateY(-2px) + 阴影 + 边框色过渡
 * - 标题图标使用品牌语义色, 增强视觉识别
 * - 统计卡片入场数字递增动画
 *
 * @see branding/MLA_BRAND_GUIDELINES.md
 */

import { lazy, Suspense } from 'react'
import { Row, Col, Skeleton } from 'antd'
import {
  BarChartOutlined,
  StarOutlined,
  BellOutlined,
} from '@ant-design/icons'
import StatsOverview from '../components/dashboard/StatsOverview'
import ReviewDashboardCard from '../components/dashboard/ReviewDashboardCard'
import FavoritesList from '../components/dashboard/FavoritesList'
import LearningProgress from '../components/dashboard/LearningProgress'
import RadarOverview from '../components/dashboard/RadarOverview'
import { gray, radius, typography, blue, semantic } from '../styles/tokens'

const WeeklyChart = lazy(() => import('../components/dashboard/WeeklyChart'))

/** 卡片容器 — hover 上浮 + 阴影 + 边框 */
const CARD_STYLE: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: radius.lg,
  border: `1px solid ${gray[200]}`,
  overflow: 'hidden',
  transition: `
    box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    border-color 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)
  `,
}

/** 卡片标题 */
const CARD_TITLE_STYLE: React.CSSProperties = {
  padding: '16px 24px 0',
  fontSize: typography.h3.fontSize,
  fontWeight: typography.h3.fontWeight,
  color: gray[800],
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

/** Row 2 卡片统一固定高度 — 确保 WeeklyChart 全部内容可见，ReviewDashboardCard 同高滚动 */
const ROW2_CARD_HEIGHT = 420

export default function Dashboard() {
  return (
    <div style={{ padding: '16px 24px 24px' }}>
      {/* Row 1: 统计概览 — hover 效果由 StatsOverview 内部处理 */}
      <StatsOverview />

      {/* Row 2: 图表 + 待办 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={16}>
          <div
            style={{ ...CARD_STYLE, display: 'flex', flexDirection: 'column', height: ROW2_CARD_HEIGHT }}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
          >
            <div style={{ ...CARD_TITLE_STYLE, flexShrink: 0 }}>
              <BarChartOutlined style={{ color: blue[500], fontSize: 16 }} />
              <span>本周学习活动</span>
            </div>
            <Suspense fallback={
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
                <div style={{ width: '100%', padding: '16px 24px 24px' }}>
                  <Skeleton active paragraph={{ rows: 6 }} title={false} />
                </div>
              </div>
            }>
              <WeeklyChart />
            </Suspense>
          </div>
        </Col>

        <Col xs={24} lg={8}>
          <div
            style={{ ...CARD_STYLE, display: 'flex', flexDirection: 'column', height: ROW2_CARD_HEIGHT }}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
          >
            <div style={{ ...CARD_TITLE_STYLE, flexShrink: 0, paddingBottom: 12 }}>
              <BellOutlined style={{ color: semantic.warning, fontSize: 16 }} />
              <span>艾宾浩斯复习提醒</span>
            </div>
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <ReviewDashboardCard />
            </div>
          </div>
        </Col>
      </Row>

      {/* Row 3: 进度 + 雷达 + 收藏 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={8}>
          <div
            style={CARD_STYLE}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
          >
            <LearningProgress />
          </div>
        </Col>

        <Col xs={24} lg={8}>
          <div
            style={CARD_STYLE}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
          >
            <RadarOverview />
          </div>
        </Col>

        <Col xs={24} lg={8}>
          <div
            style={CARD_STYLE}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
          >
            <div style={CARD_TITLE_STYLE}>
              <StarOutlined style={{ color: semantic.warning, fontSize: 16 }} />
              <span>我的收藏</span>
            </div>
            <div style={{ padding: '12px 20px 16px' }}>
              <FavoritesList />
            </div>
          </div>
        </Col>
      </Row>

    </div>
  )
}

// ── 共享 hover 回调 ──────────────────────────────────────

function hoverIn(e: React.MouseEvent<HTMLDivElement>) {
  e.currentTarget.style.boxShadow = '0 4px 12px rgba(15,23,42,0.08)'
  e.currentTarget.style.borderColor = '#CBD5E1'
  e.currentTarget.style.transform = 'translateY(-1px)'
}

function hoverOut(e: React.MouseEvent<HTMLDivElement>) {
  e.currentTarget.style.boxShadow = 'none'
  e.currentTarget.style.borderColor = '#E2E8F0'
  e.currentTarget.style.transform = 'translateY(0)'
}
