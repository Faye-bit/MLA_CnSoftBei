/**
 * 资源查看器 — 内容分发器
 * 根据资源类型将内容路由到对应的专用查看器组件
 * - handout/reading/video_script → MarkdownRenderer
 * - mindmap → MindMapViewer
 * - exercise → ExerciseViewer
 * - coding_practice → CodePracticeViewer
 *
 * 阅读器模式: 讲义、拓展阅读、编程实操、练习题采用居中排版 (max-width: 900px)
 * 可视化模式: 思维导图、交互动画采用全宽展示
 */

import { Spin, Typography, Empty, Tag } from 'antd'
import { LoadingOutlined } from '@ant-design/icons'
import MarkdownRenderer from '../common/MarkdownRenderer'
import MindMapViewer from './MindMapViewer'
import AnimationViewer from './AnimationViewer'
import ExerciseViewer from './ExerciseViewer'
import CodePracticeViewer from './CodePracticeViewer'
import SpeakButton from '../common/SpeakButton'
import type { GeneratedResourceDetail, ResourceType } from '../../types'

const { Title, Text } = Typography

/** 资源类型中文标签 */
const TYPE_LABELS: Record<ResourceType, string> = {
  handout: '讲义',
  mindmap: '思维导图',
  exercise: '练习题',
  reading: '拓展阅读',
  coding_practice: '编程练习',
  video_script: '交互动画',
}

/** 朗读不可用的资源类型 (非连续文本) */
const NO_SPEAK_TYPES: ResourceType[] = ['mindmap', 'exercise']

/** 从资源内容中提取纯文本供朗读使用 */
function extractPlainText(resource: GeneratedResourceDetail): string {
  const { resource_type, content } = resource
  if (NO_SPEAK_TYPES.includes(resource_type)) return ''

  if (resource_type === 'video_script') {
    // 从 HTML 中提取纯文本
    try {
      const doc = new DOMParser().parseFromString(content, 'text/html')
      return doc.body.textContent || ''
    } catch {
      return content.replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, '')
    }
  }

  // Markdown/讲义/阅读/编程练习: 去 Markdown 标记
  return content
}

interface ResourceViewerProps {
  resource: GeneratedResourceDetail | null
  loading: boolean
  /**
   * 资源导航回调: 讲义中的 mla-resource:// 链接被点击时触发
   * 用于切换左侧资源目录和右侧查看器到目标动画资源
   */
  onNavigateToResource?: (resourceId: string) => void
  /** v2 覆盖: 保存练习进度 */
  onSaveExerciseProgress?: (resourceId: string, progress: {
    answers: Record<string, number | number[] | string>
    submitted: Record<string, boolean>
    current_index: number
    scores?: Record<string, { score: number; feedback: string }>
  }) => Promise<void>
  /** v2 覆盖: AI 评分主观题 */
  onScoreExerciseAnswer?: (resourceId: string, request: {
    question_id: string
    question_type: string
    question_text: string
    user_answer: string
    reference_answer: string
    explanation?: string
  }) => Promise<{ question_id: string; score: number; feedback: string }>
}

export default function ResourceViewer({
  resource, loading, onNavigateToResource,
  onSaveExerciseProgress, onScoreExerciseAnswer,
}: ResourceViewerProps) {
  if (loading) {
    return (
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        height: '100%', flexDirection: 'column', gap: 12,
      }}>
        <Spin indicator={<LoadingOutlined style={{ fontSize: 32 }} spin />} />
        <Text type="secondary">加载资源内容...</Text>
      </div>
    )
  }

  if (!resource) {
    return (
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        height: '100%',
      }}>
        <Empty description="请从左侧选择资源" />
      </div>
    )
  }

  /** 根据资源类型渲染对应内容 */
  function renderContent() {
    const { resource_type, content } = resource!

    switch (resource_type) {
      case 'handout':
      case 'reading':
        return (
          <MarkdownRenderer
            content={content}
            onNavigateToResource={onNavigateToResource}
          />
        )

      case 'video_script':
        return <AnimationViewer content={content} />

      case 'mindmap':
        return <MindMapViewer content={content} />

      case 'exercise':
        return (
          <ExerciseViewer
            key={resource.id}
            content={content}
            resourceId={resource.id}
            resourceMetadata={resource.resource_metadata}
            onSaveProgress={onSaveExerciseProgress}
            onScoreAnswer={onScoreExerciseAnswer}
          />
        )

      case 'coding_practice':
        return <CodePracticeViewer content={content} />

      default:
        return (
          <MarkdownRenderer
            content={content}
            onNavigateToResource={onNavigateToResource}
          />
        )
    }
  }

  const typeLabel = TYPE_LABELS[resource.resource_type] || resource.resource_type

  /**
   * 判断当前资源类型是否使用「阅读器模式」居中排版
   * 讲义、拓展阅读、编程实操、练习题 → 居中展示 (max-width: 900px)
   * 思维导图、交互动画 → 全宽展示
   */
  const isReaderType: boolean = ['handout', 'reading', 'coding_practice', 'exercise'].includes(
    resource.resource_type
  )

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 资源标题栏 */}
      <div style={{
        padding: '12px 24px',
        borderBottom: '1px solid #E2E8F0',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
        flexShrink: 0,
      }}>
        <Title level={5} style={{ margin: 0 }}>
          {resource.title}
        </Title>
        {/* 朗读按钮 (非连续文本类型不显示) */}
        {!NO_SPEAK_TYPES.includes(resource.resource_type) && (
          <SpeakButton text={extractPlainText(resource)} size="small" />
        )}
      </div>

      {/* 资源正文 — 阅读器类型居中展示，思维导图/动画全宽展示 */}
      <div style={{
        flex: 1,
        minHeight: isReaderType ? 0 : 520,
        overflow: 'auto',
      }}>
        {isReaderType ? (
          <div style={{
            maxWidth: 900,
            margin: '0 auto',
            padding: '20px 24px',
          }}>
            {renderContent()}
          </div>
        ) : (
          renderContent()
        )}
      </div>
    </div>
  )
}
