/**
 * 代码实操查看器
 * 展示编程练习内容, 每个代码块自带复制按钮
 * 复用 MarkdownRenderer 渲染 Markdown 格式内容
 */

import { Typography } from 'antd'
import MarkdownRenderer from '../common/MarkdownRenderer'

const { Title } = Typography

interface CodePracticeViewerProps {
  /** Markdown 格式的编程实操内容 */
  content: string
}

export default function CodePracticeViewer({ content }: CodePracticeViewerProps) {
  return (
    <div style={{ padding: '20px 24px' }}>
      {/* 标题栏 */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #E2E8F0',
      }}>
        <Title level={5} style={{ margin: 0 }}>编程实操</Title>
      </div>

      {/* Markdown 内容: 每个代码块右上角自带复制按钮 */}
      <MarkdownRenderer content={content} />
    </div>
  )
}
