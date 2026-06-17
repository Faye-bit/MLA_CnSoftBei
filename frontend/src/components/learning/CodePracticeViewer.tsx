/**
 * 代码实操查看器
 * 展示编程练习内容, 代码高亮 + 复制按钮
 * 复用 MarkdownRenderer 渲染 Markdown 格式内容
 */

import { Typography, Button, message } from 'antd'
import { CopyOutlined } from '@ant-design/icons'
import MarkdownRenderer from '../common/MarkdownRenderer'

const { Title } = Typography

interface CodePracticeViewerProps {
  content: string
}

export default function CodePracticeViewer({ content }: CodePracticeViewerProps) {
  /** 从 Markdown 中提取所有代码块并复制 */
  function handleCopyAllCode() {
    const codeRegex = /```[\s\S]*?\n([\s\S]*?)```/g
    const snippets: string[] = []
    let match
    while ((match = codeRegex.exec(content)) !== null) {
      snippets.push(match[1].trim())
    }
    if (snippets.length === 0) {
      message.info('未找到代码块')
      return
    }
    navigator.clipboard.writeText(snippets.join('\n\n'))
      .then(() => message.success(`已复制 ${snippets.length} 个代码片段`))
      .catch(() => message.error('复制失败'))
  }

  /** 复制单个代码块 */
  function handleCopySingle(code: string) {
    navigator.clipboard.writeText(code)
      .then(() => message.success('代码已复制'))
      .catch(() => message.error('复制失败'))
  }

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* 标题栏 */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #f0f0f0',
      }}>
        <Title level={5} style={{ margin: 0 }}>编程实操</Title>
        <Button
          size="small"
          icon={<CopyOutlined />}
          onClick={handleCopyAllCode}
        >
          复制所有代码
        </Button>
      </div>

      {/* Markdown 内容 */}
      <MarkdownRenderer content={content} />
    </div>
  )
}
