/**
 * 快问AI — 通信总线 Store (Zustand)
 * 各触发点 (知识点卡片、代码块、练习题、文档页、文本选中) 通过此 Store
 * 将上下文传给全局 FloatingChat, 实现跨组件树的解耦通信
 *
 * 触发点 -> triggerQuickAsk(context) -> QuickAskStore -> FloatingChat 订阅 -> 展开面板 + 预填充发送
 */
import { create } from 'zustand'

/** 快问AI 的上下文来源类型 */
export type QuickAskSourceType = 'kp' | 'code' | 'exercise' | 'document' | 'text_selection'

/** 快问AI 上下文: 触发点将这段数据写入 Store, FloatingChat 读取后自动发起对话 */
export interface QuickAskContext {
  /** 上下文来源类型 */
  sourceType: QuickAskSourceType
  /** 选中的文本 / 知识点内容 / 练习题目等 (传给 AI 的原始上下文) */
  contextText: string
  /** 预填充问题: 自动生成的提问文本, 用户可直接发送或修改 */
  prefillQuestion?: string
  /** 元数据: 用于后端 RAG 检索和后续 AI 解释存储 */
  metadata: {
    courseId?: string
    chapterId?: string
    kpId?: string
    documentId?: string
    pageNumber?: number
  }
}

interface QuickAskState {
  /** 当前快问上下文 (null = 无待处理的快问请求) */
  context: QuickAskContext | null
  /** 触发快问: 各 UI 触发点调用此方法写入上下文 */
  trigger: (ctx: QuickAskContext) => void
  /** 清除上下文: FloatingChat 处理完毕后调用 */
  clear: () => void
}

export const useQuickAskStore = create<QuickAskState>((set) => ({
  context: null,
  trigger: (ctx) => set({ context: ctx }),
  clear: () => set({ context: null }),
}))
