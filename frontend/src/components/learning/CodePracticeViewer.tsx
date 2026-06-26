/**
 * 代码实操查看器
 * 展示编程练习内容, 每个代码块自带复制按钮
 * 复用 MarkdownRenderer 渲染 Markdown 格式内容
 */

import MarkdownRenderer from '../common/MarkdownRenderer'

interface CodePracticeViewerProps {
  /** Markdown 格式的编程实操内容 */
  content: string
}

export default function CodePracticeViewer({ content }: CodePracticeViewerProps) {
  return <MarkdownRenderer content={content} />
}
