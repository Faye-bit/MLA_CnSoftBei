/**
 * 资源目录树组件
 * 以文件目录风格展示当前阶段的所有生成资源
 * 使用 Ant Design Tree 组件, 点击资源节点在右侧加载详情
 */

import { Tree, Typography, Spin } from 'antd'
import type { DataNode } from 'antd/es/tree'
import {
  FolderOutlined, FileTextOutlined, ApartmentOutlined,
  FormOutlined, ReadOutlined, CodeOutlined, VideoCameraOutlined,
} from '@ant-design/icons'
import type { GeneratedResource, ResourceType } from '../../types'

const { Text } = Typography

/** 资源类型对应的叶子节点图标映射 (彩色) */
const RESOURCE_ICONS: Record<ResourceType, React.ReactNode> = {
  handout: <FileTextOutlined style={{ color: '#1677ff' }} />,
  mindmap: <ApartmentOutlined style={{ color: '#722ed1' }} />,
  exercise: <FormOutlined style={{ color: '#fa8c16' }} />,
  reading: <ReadOutlined style={{ color: '#52c41a' }} />,
  coding_practice: <CodeOutlined style={{ color: '#eb2f96' }} />,
  video_script: <VideoCameraOutlined style={{ color: '#13c2c2' }} />,
}

/** 资源类型的中文标签 */
const RESOURCE_LABELS: Record<ResourceType, string> = {
  handout: '讲义',
  mindmap: '思维导图',
  exercise: '练习题',
  reading: '拓展阅读',
  coding_practice: '编程练习',
  video_script: '交互动画',
}

interface ResourceTreeProps {
  resources: GeneratedResource[]
  selectedResourceId: string | null
  onSelect: (resource: GeneratedResource) => void
  loading?: boolean
}

export default function ResourceTree({
  resources, selectedResourceId, onSelect, loading,
}: ResourceTreeProps) {
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin size="small" />
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>加载资源...</Text>
        </div>
      </div>
    )
  }

  if (!resources || resources.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Text type="secondary" style={{ fontSize: 13 }}>暂无资源</Text>
      </div>
    )
  }

  /** 将资源列表转换为 Tree 的 DataNode 数组 */
  function buildTreeData(): DataNode[] {
    // 按类型分组
    const grouped: Record<string, GeneratedResource[]> = {}
    for (const res of resources) {
      const type = res.resource_type
      if (!grouped[type]) grouped[type] = []
      grouped[type].push(res)
    }

    // 资源类型排序
    const typeOrder: ResourceType[] = [
      'handout', 'mindmap', 'exercise',
      'reading', 'coding_practice', 'video_script',
    ]

    return typeOrder
      .filter(type => grouped[type] && grouped[type].length > 0)
      .map(type => {
        const items = grouped[type]
        // 同类型多个资源时, 如果标题完全相同则显示编号以区分
        const needNumbering = items.length > 1 &&
          items.every(r => r.title === items[0].title)

        return {
          key: `group-${type}`,
          title: (
            <span style={{ fontWeight: 500, fontSize: 13 }}>
              {RESOURCE_LABELS[type]}
              <span style={{ marginLeft: 8, color: '#999', fontSize: 11 }}>
                ({items.length})
              </span>
            </span>
          ),
          icon: <FolderOutlined />,
          selectable: false,
          children: items.map((res, idx) => ({
            key: res.id,
            title: (
              <span style={{ fontSize: 12 }}>
                {needNumbering ? `${res.title} (${idx + 1})` : res.title}
              </span>
            ),
            icon: RESOURCE_ICONS[res.resource_type],
            isLeaf: true,
          })),
        }
      })
  }

  return (
    <div style={{ padding: '12px 0' }}>
      <div style={{ padding: '0 16px 8px', borderBottom: '1px solid #f0f0f0' }}>
        <Text strong style={{ fontSize: 13 }}>学习资源</Text>
        <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
          {resources.length} 项
        </Text>
      </div>

      <Tree
        showIcon
        defaultExpandAll
        treeData={buildTreeData()}
        selectedKeys={selectedResourceId ? [selectedResourceId] : []}
        onSelect={(keys) => {
          if (keys.length === 0) return
          const key = keys[0] as string
          if (key.startsWith('group-')) return
          const res = resources.find(r => r.id === key)
          if (res) onSelect(res)
        }}
        style={{ padding: '8px 8px' }}
      />
    </div>
  )
}
