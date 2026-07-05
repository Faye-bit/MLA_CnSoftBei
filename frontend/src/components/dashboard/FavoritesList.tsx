/**
 * 我的收藏看板
 * 展示用户已收藏的学习会话列表, 含课程名、状态、进度条
 * 最多展示 5 条, 超过时底部显示"查看全部"链接
 *
 * 设计规范 (MLA Brand v2.0):
 * - 列表项: 1px gray-200 边框, 8px 圆角
 * - hover: border 变色 blue-500 + shadow-md
 * - 进度条: blue-500 → semantic.success 渐变
 *
 * @see branding/MLA_BRAND_GUIDELINES.md
 */

import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Skeleton, Empty, Progress, Tag, Typography, Button } from 'antd'
import { StarFilled, RightOutlined } from '@ant-design/icons'
import { getFavorites } from '../../services/api'
import type { FavoriteItem } from '../../types'
import { gray, blue, semantic } from '../../styles/tokens'

const { Text } = Typography

/** 会话状态对应的 Tag 配置 */
const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  active: { color: 'blue', label: '进行中' },
  completed: { color: 'green', label: '已完成' },
  paused: { color: 'orange', label: '已暂停' },
}

/** 最大展示条数 */
const MAX_DISPLAY = 5

export default function FavoritesList() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [favorites, setFavorites] = useState<FavoriteItem[]>([])

  /** 加载收藏数据 */
  const loadData = useCallback(async () => {
    try {
      const data = await getFavorites()
      setFavorites(data.favorites)
    } catch {
      // 请求失败时保持空状态
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  /** 跳转到学习会话详情 (AI智学) */
  const handleGoToSession = useCallback((sessionId: string) => {
    navigate(`/zhixue/${sessionId}`)
  }, [navigate])

  // ---- 加载态 ----
  if (loading) {
    return (
      <div style={{ padding: '8px 0' }}>
        <Skeleton active paragraph={{ rows: 3 }} title={false} />
      </div>
    )
  }

  // ---- 空数据态 ----
  if (favorites.length === 0) {
    return (
      <div style={{ padding: '16px 0', textAlign: 'center' }}>
        <Empty
          description="暂无收藏"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        >
          <Text style={{ fontSize: 12, color: gray[500] }}>
            在学习会话中点击星标即可收藏
          </Text>
        </Empty>
      </div>
    )
  }

  /** 显示的收藏列表 (最多 MAX_DISPLAY 条) */
  const displayFavorites = favorites.slice(0, MAX_DISPLAY)
  const hasMore = favorites.length > MAX_DISPLAY

  // ---- 数据态 ----
  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ maxHeight: 380, overflowY: 'auto' }}>
        {displayFavorites.map((fav) => {
          const statusCfg = STATUS_CONFIG[fav.status] || { color: 'default', label: fav.status }

          return (
            <div
              key={fav.session_id}
              onClick={() => handleGoToSession(fav.session_id)}
              style={{
                padding: '10px 12px',
                marginBottom: 8,
                borderRadius: 8,
                border: `1px solid ${gray[200]}`,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = blue[500]
                e.currentTarget.style.boxShadow = `0 2px 8px rgba(59,130,246,0.08)`
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = gray[200]
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              {/* 课程名 + 星标 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <StarFilled style={{ color: semantic.warning, fontSize: 14 }} />
                <Text strong style={{ flex: 1, fontSize: 14, color: gray[800] }} ellipsis>
                  {fav.course_name || '未命名课程'}
                </Text>
                <Tag color={statusCfg.color} style={{ fontSize: 11, margin: 0 }}>
                  {statusCfg.label}
                </Tag>
              </div>

              {/* 进度条 */}
              <div style={{ marginBottom: 4 }}>
                <Progress
                  percent={fav.progress_percent}
                  size="small"
                  strokeColor={{
                    '0%': blue[500],
                    '100%': semantic.success,
                  }}
                  format={() =>
                    fav.total_stages > 0
                      ? `${fav.completed_stages}/${fav.total_stages}`
                      : '—'
                  }
                />
              </div>

              {/* 上次更新时间 */}
              {fav.updated_at && (
                <Text style={{ fontSize: 11, color: gray[500] }}>
                  {formatRelativeTime(fav.updated_at)}
                </Text>
              )}
            </div>
          )
        })}
      </div>

      {/* 查看全部 */}
      {hasMore && (
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <Button
            type="link"
            size="small"
            onClick={() => navigate('/zhixue')}
            iconPosition="end"
            icon={<RightOutlined />}
          >
            查看全部 ({favorites.length})
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * 将 ISO 时间字符串格式化为相对时间描述
 * 如 "3 小时前"、"昨天"、"2 天前"
 *
 * @param isoStr - ISO 8601 格式的时间字符串
 * @returns 相对时间描述文本
 */
function formatRelativeTime(isoStr: string): string {
  const now = Date.now()
  const then = new Date(isoStr).getTime()
  const diffMs = now - then

  // 负值表示未来时间, 显示原始日期
  if (diffMs < 0) {
    return new Date(isoStr).toLocaleDateString('zh-CN')
  }

  const diffMin = Math.floor(diffMs / 60000)
  const diffHour = Math.floor(diffMs / 3600000)
  const diffDay = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  if (diffHour < 24) return `${diffHour} 小时前`
  if (diffDay === 1) return '昨天'
  if (diffDay < 7) return `${diffDay} 天前`
  if (diffDay < 30) return `${Math.floor(diffDay / 7)} 周前`

  return new Date(isoStr).toLocaleDateString('zh-CN')
}
