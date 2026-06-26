/**
 * 学习会话 SSE 进度追踪 Hook
 * 封装学习路径生成和阶段完成的 SSE 流式进度管理
 * 消除 LearningSession.tsx 中 startSSEGeneration 和 handleCompleteStage 的重复逻辑
 *
 * 两组进度公式:
 *   初始生成: 加权公式 (resource_generation 1.5x) + 阶段累积贡献
 *   下一阶段: completedAgents.length / 4, 阶段完成固定 95%
 *
 * 用法:
 *   const {
 *     agents, progressMessage, overallProgress, allResourcesReady,
 *     generatingNext, showProgress, readyResourceCount,
 *     startGeneration, completeStage, cancelGeneration, dismissProgress,
 *   } = useLearningSSE(sessionId, PIPELINE_ORDER, {
 *     onPathUpdate: (data) => { ... },
 *     onSessionComplete: () => { ... },
 *     onError: (msg) => { ... },
 *   })
 */
import { useState, useRef, useCallback } from 'react'
import { streamLearningSession, streamCompleteStage } from '../services/api'
import type {
  AgentStatus,
  SessionInitEvent,
  StageStartEvent,
  AgentStartEvent,
  AgentProgressEvent,
  AgentDoneEvent,
  ResourceReadyEvent,
  PathUpdateEvent,
  StageCompleteEvent,
  SessionCompleteEvent,
  SSEErrorEvent,
} from '../types'

export interface UseLearningSSEOptions {
  /** path_update 事件回调 — 调用者用于同步 session.learning_path */
  onPathUpdate?: (data: PathUpdateEvent) => void
  /** session_complete 事件回调 — 调用者用于 reload session 等 */
  onSessionComplete?: () => void
  /** error 事件回调 — 调用者用于显示错误消息 (如 antd message.error) */
  onError?: (message: string) => void
}

export function useLearningSSE(
  sessionId: string,
  pipelineOrder: string[],
  options?: UseLearningSSEOptions,
) {
  // ── Agent 状态 ──
  const defaultAgents: AgentStatus[] = pipelineOrder.map(name => ({
    name,
    displayName: name,
    status: 'pending' as const,
    message: '',
    resultSummary: null,
  }))
  const [agents, setAgents] = useState<AgentStatus[]>(defaultAgents)

  // ── 进度状态 ──
  const [progressMessage, setProgressMessage] = useState('')
  const [overallProgress, setOverallProgress] = useState(0)
  const [allResourcesReady, setAllResourcesReady] = useState(false)
  const [generatingNext, setGeneratingNext] = useState(false)
  const [showProgress, setShowProgress] = useState(false)
  const [readyResourceCount, setReadyResourceCount] = useState(0)

  // ── Abort 控制 ──
  const abortRef = useRef<AbortController | null>(null)

  // ── 辅助: 更新单个 agent 状态 ──
  const updateAgent = useCallback((agentName: string, updates: Partial<AgentStatus>) => {
    setAgents(prev => prev.map(a =>
      a.name === agentName ? { ...a, ...updates } : a
    ))
  }, [])

  // ====================================================================
  // 初始生成 (streamLearningSession)
  // ====================================================================

  const startGeneration = useCallback((): AbortController => {
    setShowProgress(true)
    setGeneratingNext(false)
    setAgents(pipelineOrder.map(name => ({
      name, displayName: name,
      status: 'pending' as const,
      message: '', resultSummary: null,
    })))
    setOverallProgress(0)
    setAllResourcesReady(false)
    setReadyResourceCount(0)

    const completedAgents: string[] = []

    /** 加权进度: resource_generation 权重 1.5x, 上限 95% */
    const calcProgress = (names: string[]) => {
      const totalWeight = pipelineOrder.length
      let weight = 0
      for (const name of names) {
        weight += 1
        if (name === 'resource_generation') weight += 0.5
      }
      return Math.min(95, (weight / totalWeight) * 100)
    }

    abortRef.current = streamLearningSession(sessionId, {
      onSessionInit: (data: SessionInitEvent) => {
        setProgressMessage(`正在为 "${data.course_name}" 生成学习方案...`)
      },

      onStageStart: (data: StageStartEvent) => {
        setProgressMessage(`第 ${data.stage_index + 1} 阶段: ${data.stage_title}`)
      },

      onAgentStart: (data: AgentStartEvent) => {
        updateAgent(data.agent, {
          status: 'running',
          message: data.message,
          resultSummary: null,
        })
      },

      onAgentProgress: (data: AgentProgressEvent) => {
        updateAgent(data.agent, { message: data.message })
        setProgressMessage(data.message)
      },

      onAgentDone: (data: AgentDoneEvent) => {
        updateAgent(data.agent, {
          status: 'completed',
          resultSummary: data.result_summary,
        })
        completedAgents.push(data.agent)
        setOverallProgress(calcProgress(completedAgents))
      },

      onResourceReady: (data: ResourceReadyEvent) => {
        setProgressMessage(`已生成: ${data.title}`)
      },

      onPathUpdate: (data: PathUpdateEvent) => {
        options?.onPathUpdate?.(data)
      },

      onStageComplete: (data: StageCompleteEvent) => {
        // 渐进式: 每个阶段完成贡献 ~50% / totalStages
        const totalStages = Math.max(
          (data as any)._total_stages || 5,
          1,
        )
        // 简化: 阶段完成 → 直接推进到接近 94%
        const stageContribution = Math.round(50 / totalStages)
        setOverallProgress(prev => Math.min(prev + stageContribution, 94))
        if (data.resources && data.resources.length > 0) {
          setReadyResourceCount(data.resources.length)
        }
      },

      onSessionComplete: (_data: SessionCompleteEvent) => {
        setOverallProgress(100)
        setAllResourcesReady(true)
        // 不在这里调用 options.onSessionComplete —
        // 调用者通过检测 allResourcesReady 变化来 loadSession
      },

      onError: (data: SSEErrorEvent | string) => {
        const msg = typeof data === 'string' ? data : data.message
        options?.onError?.('生成失败: ' + msg)
        setShowProgress(false)
      },
    })

    return abortRef.current!
  }, [sessionId, pipelineOrder, updateAgent, options])

  // ====================================================================
  // 完成阶段 → 生成下一阶段 (streamCompleteStage)
  // ====================================================================

  const completeStage = useCallback((stageIndex: number): AbortController => {
    setGeneratingNext(true)
    setShowProgress(true)
    setOverallProgress(0)
    setAllResourcesReady(false)
    setReadyResourceCount(0)

    setAgents(pipelineOrder.map(name => ({
      name, displayName: name,
      status: 'pending' as const,
      message: '', resultSummary: null,
    })))

    const completedAgents: string[] = []

    abortRef.current = streamCompleteStage(sessionId, stageIndex, {
      onSessionInit: () => {
        // 下一阶段生成不需要 session_init 处理
      },

      onStageStart: (data: StageStartEvent) => {
        setProgressMessage(data.stage_title)
      },

      onAgentStart: (data: AgentStartEvent) => {
        updateAgent(data.agent, {
          status: 'running',
          message: data.message,
        })
      },

      onAgentProgress: (data: AgentProgressEvent) => {
        updateAgent(data.agent, { message: data.message })
      },

      onAgentDone: (data: AgentDoneEvent) => {
        updateAgent(data.agent, {
          status: 'completed',
          resultSummary: data.result_summary,
        })
        completedAgents.push(data.agent)
        setOverallProgress(Math.min(95, (completedAgents.length / 4) * 100))
      },

      onResourceReady: (data: ResourceReadyEvent) => {
        setProgressMessage(`已生成: ${data.title}`)
      },

      onPathUpdate: () => {
        // 下一阶段生成不需要 path_update 处理
      },

      onStageComplete: (data: StageCompleteEvent) => {
        setOverallProgress(95)
        if (data.resources && data.resources.length > 0) {
          setReadyResourceCount(data.resources.length)
        }
      },

      onSessionComplete: (_data: SessionCompleteEvent) => {
        setOverallProgress(100)
        setAllResourcesReady(true)
        setGeneratingNext(false)
        options?.onSessionComplete?.()
      },

      onError: (data: SSEErrorEvent | string) => {
        const msg = typeof data === 'string' ? data : data.message
        options?.onError?.('生成下一阶段失败: ' + msg)
        setShowProgress(false)
        setGeneratingNext(false)
      },
    })

    return abortRef.current!
  }, [sessionId, pipelineOrder, updateAgent, options])

  // ====================================================================
  // 取消 / 关闭
  // ====================================================================

  const cancelGeneration = useCallback(() => {
    abortRef.current?.abort()
    setShowProgress(false)
    setGeneratingNext(false)
  }, [])

  const dismissProgress = useCallback(() => {
    setShowProgress(false)
    setGeneratingNext(false)
    setAllResourcesReady(false)
    setReadyResourceCount(0)
  }, [])

  return {
    agents,
    progressMessage,
    overallProgress,
    allResourcesReady,
    generatingNext,
    showProgress,
    readyResourceCount,
    startGeneration,
    completeStage,
    cancelGeneration,
    dismissProgress,
  }
}
