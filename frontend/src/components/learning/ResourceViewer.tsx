/**
 * 资源查看器 — 内容分发器
 * 根据资源类型将内容路由到对应的专用查看器组件
 * - handout/reading/video_script → MarkdownRenderer
 * - mindmap → MindMapViewer
 * - exercise → ExerciseViewer
 * - coding_practice → CodePracticeViewer
 */

import { Spin, Typography, Empty, Tag } from 'antd'
import { LoadingOutlined } from '@ant-design/icons'
import MarkdownRenderer from '../common/MarkdownRenderer'
import MindMapViewer from './MindMapViewer'
import AnimationViewer from './AnimationViewer'
import ExerciseViewer from './ExerciseViewer'
import CodePracticeViewer from './CodePracticeViewer'
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

interface ResourceViewerProps {
  resource: GeneratedResourceDetail | null
  loading: boolean
  /**
   * 资源导航回调: 讲义中的 mla-resource:// 链接被点击时触发
   * 用于切换左侧资源目录和右侧查看器到目标动画资源
   */
  onNavigateToResource?: (resourceId: string) => void
}

export default function ResourceViewer({
  resource, loading, onNavigateToResource,
}: ResourceViewerProps) {
  if (loading) {
    return (
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        minHeight: 400, flexDirection: 'column', gap: 12,
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
        minHeight: 400,
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

  return (
    <div>
      {/* 资源标题栏 */}
      <div style={{
        padding: '12px 24px',
        borderBottom: '1px solid #f0f0f0',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <Title level={5} style={{ margin: 0 }}>
          {resource.title}
        </Title>
        <Tag>{typeLabel}</Tag>
      </div>

      {/* 资源描述 (如果有) */}
      {resource.description && (
        <div style={{ padding: '8px 24px', background: '#fafafa' }}>
          <Text type="secondary" style={{ fontSize: 13 }}>{resource.description}</Text>
        </div>
      )}

      {/* 资源正文 */}
      <div style={{ minHeight: 400 }}>
        {renderContent()}
      </div>
    </div>
  )
}
