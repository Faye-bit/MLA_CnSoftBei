/**
 * DocumentList 页面共享类型、常量和工具函数
 */
import type { Chapter } from '../../types'

/** 提取的知识点预览类型 */
export interface ExtractedKP {
  title: string
  description: string
  difficulty: string
  chunk_ids: string[]
  selected: boolean
}

/** 知识点选项类型 */
export interface KpOption {
  knowledge_point_id: string
  title: string
  chapter_title: string
  chapter_id: string
}

/** 文件类型对应的颜色 */
export const typeColorMap: Record<string, string> = {
  pdf: 'red',
  docx: 'blue',
  pptx: 'orange',
  md: 'purple',
  txt: 'default',
}

/** 解析状态映射 */
export const statusMap: Record<string, { label: string; color: string }> = {
  pending: { label: '待处理', color: 'default' },
  processing: { label: '解析中', color: 'processing' },
  done: { label: '已完成', color: 'success' },
  failed: { label: '失败', color: 'error' },
  chunked: { label: '待向量化', color: 'warning' },
}

/** 文件大小格式化 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
