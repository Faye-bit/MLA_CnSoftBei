/**
 * AI智学 — 阶段切换器
 *
 * 嵌入 Header 中的阶段指示区域, 点击弹出 Popover 展示完整学习路线。
 * 已完成/当前阶段可点击跳转, 未生成阶段灰显不可点击。
 */

import { useState } from 'react'
import { Popover, Tooltip } from 'antd'
import { CheckCircleFilled, PlayCircleFilled, MinusCircleOutlined, DownOutlined } from '@ant-design/icons'
import { blue, gray, semantic } from '../../styles/tokens'

/** 单个阶段摘要 */
export interface StageSummary {
  /** 阶段标题 */
  title: string
  /** 阶段序号 (0-based) */
  index: number
  /** 状态: completed = 已生成资源 / current = 当前阶段 / pending = 尚未生成 */
  status: 'completed' | 'current' | 'pending'
}

interface Props {
  /** 所有阶段列表 */
  stages: StageSummary[]
  /** 总阶段数 */
  totalStages: number
  /** 当前阶段序号 (0-based) */
  currentStageIndex: number
  /** 当前阶段标题 */
  currentStageTitle: string
  /** 阶段导航回调, 传入目标阶段序号 */
  onNavigate: (stageIndex: number) => void
}

export default function StageSwitcher({
  stages,
  totalStages,
  currentStageIndex,
  currentStageTitle,
  onNavigate,
}: Props) {
  const [open, setOpen] = useState(false)

  /** 点击阶段项: 已完成/当前可跳转, 未生成则忽略 */
  const handleClick = (s: StageSummary) => {
    if (s.status === 'pending') return
    onNavigate(s.index)
    setOpen(false)
  }

  /** 状态图标 */
  const statusIcon = (status: StageSummary['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircleFilled style={{ color: semantic.success, fontSize: 14 }} />
      case 'current':
        return <PlayCircleFilled style={{ color: blue[500], fontSize: 14 }} />
      case 'pending':
        return <MinusCircleOutlined style={{ color: gray[400], fontSize: 14 }} />
    }
  }

  /** 状态标签 */
  const statusLabel = (status: StageSummary['status']) => {
    switch (status) {
      case 'completed': return '已完成'
      case 'current': return '进行中'
      case 'pending': return '待生成'
    }
  }

  const popoverContent = (
    <div style={{ width: 300, maxHeight: 420, overflow: 'auto' }}>
      {/* 标题行 */}
      <div style={{
        fontWeight: 600, fontSize: 14, padding: '8px 0 12px',
        borderBottom: `1px solid ${gray[200]}`, marginBottom: 8,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span>📋</span>
        <span>学习路线</span>
        <span style={{ fontSize: 12, color: gray[400], fontWeight: 400 }}>
          共 {totalStages} 个阶段
        </span>
      </div>

      {/* 阶段列表 */}
      {stages.map((s, i) => {
        const isClickable = s.status !== 'pending'
        const isCurrent = s.status === 'current'

        return (
          <Tooltip
            key={s.index}
            title={s.status === 'pending' ? '该阶段资源尚未生成, 请先完成当前阶段' : undefined}
          >
            <div
              onClick={() => handleClick(s)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 8,
                marginBottom: 4,
                cursor: isClickable ? 'pointer' : 'not-allowed',
                opacity: isClickable ? 1 : 0.45,
                background: isCurrent
                  ? `${blue[50]}`
                  : isClickable
                    ? 'transparent'
                    : 'transparent',
                border: isCurrent ? `1px solid ${blue[100]}` : '1px solid transparent',
                transition: 'background 0.15s, border-color 0.15s',
              }}
              onMouseEnter={e => {
                if (isClickable) {
                  (e.currentTarget as HTMLDivElement).style.background = '#f5f5f5'
                }
              }}
              onMouseLeave={e => {
                if (isClickable) {
                  (e.currentTarget as HTMLDivElement).style.background = isCurrent
                    ? `${blue[50]}`
                    : 'transparent'
                }
              }}
            >
              {/* 阶段序号 */}
              <span style={{
                width: 24, height: 24, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 600,
                background: isCurrent ? blue[500] : gray[100],
                color: isCurrent ? '#fff' : gray[500],
                flexShrink: 0,
              }}>
                {i + 1}
              </span>

              {/* 阶段信息 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: isCurrent ? 600 : 400,
                  color: isCurrent ? blue[600] : '#333',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {s.title}
                </div>
              </div>

              {/* 状态标记 */}
              <span style={{
                fontSize: 11, flexShrink: 0,
                color: s.status === 'completed' ? semantic.success
                  : s.status === 'current' ? blue[500]
                    : gray[400],
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                {statusIcon(s)}
                <span>{statusLabel(s.status)}</span>
              </span>
            </div>
          </Tooltip>
        )
      })}

      {/* 底部提示 */}
      <div style={{
        fontSize: 11, color: gray[400], padding: '8px 0 4px',
        borderTop: `1px solid ${gray[200]}`, marginTop: 8,
      }}>
        💡 点击已完成阶段可随时回看
      </div>
    </div>
  )

  return (
    <Popover
      content={popoverContent}
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottomLeft"
      overlayStyle={{ padding: 0 }}
      arrow={false}
    >
      <span
        style={{
          fontSize: 13,
          color: blue[500],
          cursor: 'pointer',
          userSelect: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 8px',
          borderRadius: 6,
          transition: 'background 0.15s',
          fontWeight: 500,
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLSpanElement).style.background = blue[50]
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLSpanElement).style.background = 'transparent'
        }}
      >
        <span style={{ color: gray[500], fontWeight: 400 }}>· {currentStageTitle} ·</span>
        阶段 {currentStageIndex + 1}/{totalStages}
        <DownOutlined style={{ fontSize: 10, marginLeft: 2 }} />
      </span>
    </Popover>
  )
}
