/**
 * AI智学 生成进度面板 (v2 — Agent 卡片工作流)
 *
 * 将 Agent 工作流可视化为纵向排列的卡片队列:
 *   - 活跃 Agent 在顶部, 带蓝色光晕和左侧脉冲指示器
 *   - 等待 Agent 在中间, 带琥珀色背景
 *   - 已完成 Agent 在底部, 带绿色标记 (降低透明度)
 *   - 闲置 Agent 不在队列中出现
 *
 * 使用 framer-motion 实现:
 *   - 卡片入场: 从下方滑入 (spring 弹性动画, 级联延迟)
 *   - 卡片排序: layout 动画自动过渡位置变化
 *   - 状态切换: 背景色/边框平滑过渡 (0.4s easeInOut)
 *   - 退场: 向上滑出并淡出
 */

import { Modal, Typography } from 'antd'
import {
  LoadingOutlined,
  CheckCircleFilled,
  ClockCircleFilled,
  ThunderboltFilled,
} from '@ant-design/icons'
import { AnimatePresence, motion } from 'framer-motion'
import type { AgentCard, AgentCardState } from '../../types'
import { gray } from '../../styles/tokens'

const { Text } = Typography

// ============================================================================
// Props
// ============================================================================

interface ZhiXueProgressProps {
  /** 是否显示进度面板 */
  visible: boolean
  /** Agent 卡片队列 (已过滤闲置 + 按状态优先级排序) */
  cards: AgentCard[]
  /** 顶部状态提示文字 */
  progressMessage: string
  /** 当前阶段标题 */
  currentStageTitle: string
  /** 已生成资源计数 */
  readyResourceCount: number
  /** 当前阶段生成是否完成 */
  generationDone: boolean
  /** 用户点击"开始学习" */
  onStartLearning?: () => void
  /** 用户点击取消 */
  onCancel?: () => void
}

// ============================================================================
// 状态 → 视觉样式映射
// ============================================================================

/** 各状态下卡片的外观配置 (bg/border 取自 Tailwind 色系并微调) */
const STATE_STYLES: Record<
  AgentCardState,
  {
    bg: string
    border: string
    tagBg: string
    tagColor: string
    shadow: string
    glow: string
  }
> = {
  active: {
    bg: '#EFF6FF',
    border: '#93C5FD',
    tagBg: '#3B82F6',
    tagColor: '#FFFFFF',
    shadow: '0 2px 12px rgba(59,130,246,0.18)',
    glow: '0 0 0 2px rgba(59,130,246,0.12)',
  },
  waiting: {
    bg: '#FFFBEB',
    border: '#FCD34D',
    tagBg: '#F59E0B',
    tagColor: '#FFFFFF',
    shadow: '0 2px 8px rgba(245,158,11,0.12)',
    glow: 'none',
  },
  delivered: {
    bg: '#F0FDF4',
    border: '#86EFAC',
    tagBg: '#22C55E',
    tagColor: '#FFFFFF',
    shadow: '0 1px 4px rgba(34,197,94,0.06)',
    glow: 'none',
  },
  idle: {
    bg: '#FAFAFA',
    border: '#F0F0F0',
    tagBg: '#D9D9D9',
    tagColor: '#666666',
    shadow: 'none',
    glow: 'none',
  },
}

/** 各状态下卡片右侧标签的显示文字 */
const STATE_LABELS: Record<AgentCardState, string> = {
  active: '工作中',
  waiting: '等待中',
  delivered: '已完成',
  idle: '闲置',
}

// ============================================================================
// 子组件: 状态图标
// ============================================================================

/** 卡片右侧标签内的小图标, 不同状态使用不同图标 */
function StateIcon({ state }: { state: AgentCardState }) {
  switch (state) {
    case 'active':
      return <ThunderboltFilled style={{ fontSize: 10, marginRight: 4 }} />
    case 'waiting':
      return <ClockCircleFilled style={{ fontSize: 10, marginRight: 4 }} />
    case 'delivered':
      return <CheckCircleFilled style={{ fontSize: 10, marginRight: 4 }} />
    default:
      return null
  }
}



export default function ZhiXueProgress({
  visible,
  cards,
  progressMessage,
  currentStageTitle,
  readyResourceCount,
  generationDone,
  onStartLearning,
  onCancel,
}: ZhiXueProgressProps) {
  return (
    <Modal
      open={visible}
      closable={generationDone}
      maskClosable={false}
      keyboard={false}
      footer={
        generationDone
          ? [
              <button
                key="start"
                onClick={onStartLearning}
                style={{
                  width: '100%',
                  padding: '10px 0',
                  background: '#3B82F6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                开始学习
              </button>,
            ]
          : null
      }
      onCancel={onCancel}
      centered
      width={420}
      styles={{
        body: { padding: '16px 20px', height: 420, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
      }}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {!generationDone && (
            <LoadingOutlined
              style={{ color: '#3B82F6', fontSize: 16 }}
            />
          )}
          {generationDone && (
            <CheckCircleFilled
              style={{ color: '#22C55E', fontSize: 16 }}
            />
          )}
          <span style={{ fontSize: 15, fontWeight: 600, color: gray[800] }}>
            {generationDone ? '生成完成' : 'AI智学 正在为你准备学习方案'}
          </span>
        </div>
      }
    >
      {/* ── 顶部状态栏: 进度消息 + 资源计数 ── */}
      <div
        style={{
          marginBottom: 14,
          padding: '8px 12px',
          background: gray[50],
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text
          type="secondary"
          style={{
            fontSize: 13,
            color: generationDone ? '#22C55E' : gray[500],
          }}
        >
          {generationDone
            ? `${currentStageTitle || '当前阶段'} · 全部资源已生成`
            : progressMessage || '初始化中...'}
        </Text>

        {/* 已生成资源计数 badge */}
        {readyResourceCount > 0 && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#3B82F6',
              background: '#EFF6FF',
              padding: '2px 8px',
              borderRadius: 10,
              flexShrink: 0,
              marginLeft: 8,
            }}
          >
            {readyResourceCount} 个资源
          </span>
        )}
      </div>

      {/* ── Agent 卡片队列 (可滚动) ── */}
      <div style={{ position: 'relative', flex: 1, overflowY: 'auto' }}>
        <AnimatePresence mode="popLayout">
          {cards.map((card, index) => {
            const s = STATE_STYLES[card.state]

            return (
              <motion.div
                key={card.id}
                layout
                initial={{ opacity: 0, y: 40, scale: 0.96 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  scale: 1,
                  backgroundColor: s.bg,
                  borderColor: s.border,
                  boxShadow:
                    card.state === 'active'
                      ? `${s.shadow}, ${s.glow}`
                      : s.shadow,
                }}
                exit={{ opacity: 0, y: -20, scale: 0.96 }}
                transition={{
                  type: 'spring',
                  stiffness: 400,
                  damping: 30,
                  delay: Math.min(index * 0.05, 0.3),
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: `1.5px solid ${s.border}`,
                  background: s.bg,
                  marginBottom: index < cards.length - 1 ? 8 : 0,
                  cursor: 'default',
                  userSelect: 'none',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* 活跃状态: 左侧脉冲指示条 */}
                {card.state === 'active' && (
                  <motion.div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: 3,
                      background: '#3B82F6',
                      borderRadius: '0 2px 2px 0',
                    }}
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{
                      duration: 1.6,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                  />
                )}

                {/* Agent 圆形专属头像 (SVG 格式) */}
                <img
                  src={`/Agents/${card.icon}.svg`}
                  alt={card.name}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    flexShrink: 0,
                    objectFit: 'cover',
                    opacity: card.state === 'delivered' ? 0.7 : 1,
                    transition: 'opacity 0.4s ease',
                    border: '2px solid #E5E7EB',
                  }}
                  onError={(e) => {
                    // 头像加载失败时隐藏
                    (e.target as HTMLImageElement).style.display = 'none'
                  }}
                />

                {/* Agent 名称 + 状态消息 */}
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    opacity: card.state === 'delivered' ? 0.65 : 1,
                    transition: 'opacity 0.4s ease',
                  }}
                >
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: gray[700],
                      lineHeight: 1.3,
                    }}
                  >
                    {card.name}
                  </div>
                  {card.message && (
                    <div
                      style={{
                        fontSize: 12,
                        color: gray[400],
                        marginTop: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {card.message}
                    </div>
                  )}
                </div>

                {/* 右侧状态标签 (胶囊形) */}
                <div
                  style={{
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: 10,
                    background: s.tagBg,
                    color: s.tagColor,
                    lineHeight: 1.3,
                  }}
                >
                  <StateIcon state={card.state} />
                  {STATE_LABELS[card.state]}
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>

        {/* 空状态: 所有 Agent 均为闲置 (不应在正常流程中出现) */}
        {cards.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: 24,
              color: gray[400],
              fontSize: 13,
            }}
          >
            暂无活跃 Agent
          </div>
        )}
      </div>
    </Modal>
  )
}
