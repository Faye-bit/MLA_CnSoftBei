/**
 * 资源目录树组件
 * 以文件目录风格展示当前阶段的所有生成资源
 * 使用 Ant Design Tree 组件, 点击资源节点在右侧加载详情
 *
 * 设计规范 (MLA Brand v2.0):
 * - 资源类型图标使用品牌语义色
 */

import { Tree, Typography, Spin } from 'antd'
import type { DataNode } from 'antd/es/tree'
import {
  FolderOutlined, FileTextOutlined, ApartmentOutlined,
  FormOutlined, ReadOutlined, CodeOutlined, VideoCameraOutlined,
} from '@ant-design/icons'
import type { GeneratedResource, ResourceType } from '../../types'
import { blue, gray, semantic } from '../../styles/tokens'

const { Text } = Typography

/** 资源类型 → 图标 (品牌语义色) */
const RESOURCE_ICONS: Record<ResourceType, React.ReactNode> = {
  handout: <FileTextOutlined style={{ color: blue[500] }} />,
  mindmap: <ApartmentOutlined style={{ color: '#7C3AED' }} />,
  exercise: <FormOutlined style={{ color: semantic.warning }} />,
  reading: <ReadOutlined style={{ color: semantic.success }} />,
  coding_practice: <CodeOutlined style={{ color: '#DB2777' }} />,
  video_script: <VideoCameraOutlined style={{ color: '#0891B2' }} />,
}

const RESOURCE_LABELS: Record<ResourceType, string> = {
  handout: '讲义', mindmap: '思维导图', exercise: '练习题',
  reading: '拓展阅读', coding_practice: '编程练习', video_script: '交互动画',
}

interface ResourceTreeProps {
  resources: GeneratedResource[]
  selectedResourceId: string | null
  onSelect: (resource: GeneratedResource) => void
  loading?: boolean
}

export default function ResourceTree({ resources, selectedResourceId, onSelect, loading }: ResourceTreeProps) {
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin size="small" />
        <div style={{ marginTop: 8 }}><Text type="secondary" style={{ fontSize: 12 }}>加载资源...</Text></div>
      </div>
    )
  }

  if (!resources || resources.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center' }}><Text type="secondary" style={{ fontSize: 13 }}>暂无资源</Text></div>
  }

  function buildTreeData(): DataNode[] {
    const grouped: Record<string, GeneratedResource[]> = {}
    for (const res of resources) {
      if (!grouped[res.resource_type]) grouped[res.resource_type] = []
      grouped[res.resource_type].push(res)
    }

    const typeOrder: ResourceType[] = ['handout', 'mindmap', 'exercise', 'reading', 'coding_practice', 'video_script']

    return typeOrder
      .filter(type => grouped[type] && grouped[type].length > 0)
      .map(type => {
        const items = grouped[type]
        const needNumbering = items.length > 1 && items.every(r => r.title === items[0].title)

        return {
          key: `group-${type}`,
          title: (
            <span style={{ fontWeight: 500, fontSize: 13 }}>
              {RESOURCE_LABELS[type]}
              <span style={{ marginLeft: 8, color: gray[400], fontSize: 11 }}>({items.length})</span>
            </span>
          ),
          icon: <FolderOutlined />,
          selectable: false,
          children: items.map((res, idx) => ({
            key: res.id,
            title: <span style={{ fontSize: 12 }}>{needNumbering ? `${res.title} (${idx + 1})` : res.title}</span>,
            icon: RESOURCE_ICONS[res.resource_type],
            isLeaf: true,
          })),
        }
      })
  }

  return (
    <div style={{ padding: '12px 0' }}>
      <div style={{ padding: '0 16px 8px', borderBottom: `1px solid ${gray[200]}` }}>
        <Text strong style={{ fontSize: 13 }}>学习资源</Text>
        <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>{resources.length} 项</Text>
      </div>
      <Tree showIcon defaultExpandAll treeData={buildTreeData()}
        selectedKeys={selectedResourceId ? [selectedResourceId] : []}
        onSelect={(keys) => {
          if (keys.length === 0) return
          const key = keys[0] as string
          if (key.startsWith('group-')) return
          const res = resources.find(r => r.id === key)
          if (res) onSelect(res)
        }}
        style={{ padding: '8px 8px' }} />
    </div>
  )
}
