/**
 * AI智学 SSE 进度追踪 Hook (v2 — Agent 卡片工作流)
 *
 * 将 SSE 事件流映射为 4 状态 Agent 卡片模型:
 *   active (活跃) > waiting (等待) > delivered (交付) > idle (闲置, 不在队列中)
 *
 * 状态推断引擎: 后端只发送 agent_start / agent_done, 前端根据上下文推断
 * 向南的 waiting 状态和其他 Agent 的完整生命周期。
 */

import { useState, useRef, useCallback, useMemo } from 'react'
import { getApiBaseUrl } from '../utils/urls'
import { useAuthStore } from '../store'
import { cancelZhiXueSession } from '../services/api'
import type { AgentCard, AgentCardState } from '../types'
import { AGENT_PRIORITY } from '../types'

// ============================================================================
// 导出类型 (保持向后兼容)
// ============================================================================

/** @deprecated 使用 AgentCard 代替 */
export interface ZhiXueAgentState {
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  message: string
  resultSummary: string | null
}

export interface ZhiXueResourceItem {
  resource_type: string
  resource_id?: string
  title: string
  stage_index?: number
  is_remedial?: boolean
}

export interface ZhiXueSSECallbacks {
  onSessionInit?: (data: Record<string, unknown>) => void
  onQuestionnaireReady?: (data: Record<string, unknown>) => void
  onPathUpdate?: (data: Record<string, unknown>) => void
  onStageStart?: (data: Record<string, unknown>) => void
  onStageComplete?: (data: Record<string, unknown>) => void
  onFeedbackReady?: (data: Record<string, unknown>) => void
  onRemedialReady?: (data: Record<string, unknown>) => void
  onSessionComplete?: () => void
  onError?: (message: string) => void
}

// ============================================================================
// Agent 定义 (结构化元数据)
// ============================================================================

/** 单个 Agent 的静态定义 */
interface AgentDef {
  /** SSE 事件中使用的中文全名 */
  name: string
  /** emoji 图标 */
  icon: string
  /** 在流水线中的角色 */
  role: 'orchestrator' | 'analyst' | 'planner' | 'scout' | 'crafter' | 'reviewer'
  /** 匠人对应的资源类型 (用于闲置检测), 非匠人为 undefined */
  materialType?: string
}

/** 全部 12 个已注册 Agent 的定义 (按流水线顺序排列) */
const AGENT_DEFS: AgentDef[] = [
  { name: '学习导引师向南', icon: 'XiangNan', role: 'orchestrator' },
  { name: '学情诊断师俞知', icon: 'YuZhi', role: 'analyst' },
  { name: '教纲设计专家李纲', icon: 'LiGang', role: 'planner' },
  { name: '资源采集师蔡丰', icon: 'CaiFeng', role: 'scout' },
  { name: '解惑师霍然', icon: 'HuoRan', role: 'analyst' },
  { name: '讲义编写师张义', icon: 'ZhangYi', role: 'crafter', materialType: 'handout' },
  { name: '导图设计师屠思', icon: 'TuSi', role: 'crafter', materialType: 'mindmap' },
  { name: '习题设计师习真', icon: 'XiZheng', role: 'crafter', materialType: 'exercise' },
  { name: '阅读推荐师岳读', icon: 'YueDu', role: 'crafter', materialType: 'reading' },
  { name: '动画制作师董华', icon: 'DongHua', role: 'crafter', materialType: 'animation' },
  { name: '代码实操师戴码', icon: 'DaiMa', role: 'crafter', materialType: 'code' },
  { name: '质量审核师简真', icon: 'JianZheng', role: 'reviewer' },
]

/** 向南的中文全名 (多处引用, 提取为常量) */
const SOUTH_NAME = '学习导引师向南'

// ============================================================================
// 向南动态等待消息映射
// ============================================================================

/** 向南等待特定 Agent 时显示的消息, key 为被等待的 Agent 名称 */
const WAITING_MESSAGES: Record<string, string> = {
  '学情诊断师俞知': '等待俞知交付诊断报告...',
  '教纲设计专家李纲': '等待李纲交付学习路径...',
  '资源采集师蔡丰': '等待蔡丰交付调研结果...',
  '解惑师霍然': '等待霍然分析困惑...',
  '讲义编写师张义': '等待张义交付讲义...',
  '导图设计师屠思': '等待屠思交付思维导图...',
  '习题设计师习真': '等待习真交付习题...',
  '阅读推荐师岳读': '等待岳读交付阅读材料...',
  '动画制作师董华': '等待董华交付动画...',
  '代码实操师戴码': '等待戴码交付代码实操...',
  '质量审核师简真': '等待简真审查质量...',
}

/**
 * 根据被等待的 Agent 名称生成向南的状态消息
 * @param forName - 向南正在等待的 Agent 中文全名
 * @returns 向南卡片上显示的状态描述
 */
function buildWaitingMessage(forName: string): string {
  return WAITING_MESSAGES[forName] || `等待${forName}交付...`
}

// ============================================================================
// Hook 实现
// ============================================================================

export function useZhiXueSSE(callbacks?: ZhiXueSSECallbacks) {
  // ── 核心状态: 全部 11 张 Agent 卡片 (含闲置) ──
  const [allCards, setAllCards] = useState<AgentCard[]>([])
  // ── 当前进度消息 (卡片队列上方的提示文字) ──
  const [progressMessage, setProgressMessage] = useState('')
  // ── 进度面板可见性 ──
  const [showProgress, setShowProgress] = useState(false)
  // ── 已生成资源计数 ──
  const [readyResourceCount, setReadyResourceCount] = useState(0)
  // ── 当前阶段标题 ──
  const [currentStageTitle, setCurrentStageTitle] = useState('')
  // ── Phase 1: 问卷就绪 ──
  const [questionnaireReady, setQuestionnaireReady] = useState(false)
  // ── Phase 2+: 阶段反馈就绪 ──
  const [feedbackReady, setFeedbackReady] = useState(false)
  // ── 当前阶段所有资源生成完毕 ──
  const [generationDone, setGenerationDone] = useState(false)
  // ── 已生成资源列表 (供 ResourceTree 使用) ──
  const [resources, setResources] = useState<ZhiXueResourceItem[]>([])

  // ── Refs: 状态推断引擎的内部追踪变量 (不触发重渲染) ──
  /** 当前处于活跃状态的 Agent 名称集合 (已 agent_start 但未 agent_done) */
  const activeAgentSetRef = useRef<Set<string>>(new Set())
  /** 向南正在等待的 Agent 名称 (null 表示向南未在等待任何人) */
  const waitingForRef = useRef<string | null>(null)
  /** 向南的交付标记 (会话结束时设为 true) */
  const southDoneRef = useRef(false)
  /** 提升向南为活跃的防抖定时器 (100ms, 避免匠人完成→简真启动之间闪烁) */
  const promoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** SSE 连接的 AbortController */
  const abortRef = useRef<AbortController | null>(null)
  /** 当前会话 ID */
  const sessionIdRef = useRef<string | null>(null)
  /** 匠人入场延迟计数器 (用于级联动画) */
  const crafterEntryIndexRef = useRef(0)
  /** 已生成资源计数 (ref 版本, 避免 startStream 闭包过期) */
  const readyResourceCountRef = useRef(0)

  // =========================================================================
  // 辅助: 初始化卡片 (根据用户选择标记闲置 Agent)
  // =========================================================================

  /**
   * 根据 session_init 中的 selected_materials 和 scouting_enabled
   * 初始化全部 11 张卡片的状态。
   *
   * - 未选中的匠人 → idle (不出现在队列中)
   * - 采风关闭时的蔡丰 → idle
   * - 向南 → active (流水线的起点)
   * - 其余 Agent → idle (等待被激活)
   */
  const initCards = useCallback((selectedMaterials: string[], scoutingEnabled: boolean) => {
    // 构建闲置 Agent 名称集合
    const idleNames = new Set<string>()

    // 未选中的匠人 → 闲置
    for (const def of AGENT_DEFS) {
      if (
        def.role === 'crafter'
        && def.materialType
        && !selectedMaterials.includes(def.materialType)
      ) {
        idleNames.add(def.name)
      }
    }

    // 采风关闭 → 蔡丰闲置
    if (!scoutingEnabled) {
      idleNames.add('资源采集师蔡丰')
    }

    // 重置内部追踪变量
    activeAgentSetRef.current = new Set()
    waitingForRef.current = null
    southDoneRef.current = false
    crafterEntryIndexRef.current = 0

    // 构建初始卡片数组
    setAllCards(
      AGENT_DEFS.map(def => {
        let state: AgentCardState = 'idle'
        let message = ''

        if (idleNames.has(def.name)) {
          // 闲置: 不出现在队列中
          state = 'idle'
        } else if (def.name === SOUTH_NAME) {
          // 向南: 流水线的起点, 立即激活
          state = 'active'
          message = '正在初始化学习环境...'
        }
        // 其余 Agent 保持 idle, 等待 SSE 事件激活

        return {
          id: def.name,
          name: def.name,
          icon: def.icon,
          state,
          message,
          resultSummary: null,
        }
      }),
    )
  }, [])

  // =========================================================================
  // 辅助: 提升向南为活跃 (含 100ms 防抖)
  // =========================================================================

  /**
   * 尝试将向南提升为活跃状态。
   *
   * 防抖逻辑: 如果 activeAgentSet 为空, 等待 100ms 后再提升。
   * 若 100ms 内有新 agent_start, 则取消防抖, 向南保持等待。
   * 这避免了"匠人全部完成 → 简真启动"之间的短暂闪烁。
   */
  const tryPromoteSouth = useCallback(() => {
    // 取消之前的防抖定时器
    if (promoteTimerRef.current) {
      clearTimeout(promoteTimerRef.current)
      promoteTimerRef.current = null
    }

    if (southDoneRef.current) {
      // 向南已交付, 不再改变状态
      return
    }

    if (activeAgentSetRef.current.size === 0) {
      // 无活跃 Agent → 延迟提升向南为活跃
      promoteTimerRef.current = setTimeout(() => {
        promoteTimerRef.current = null
        // 再次确认: 定时器触发时仍无活跃 Agent, 且向南未交付
        if (activeAgentSetRef.current.size === 0 && !southDoneRef.current) {
          waitingForRef.current = null
          setAllCards(prev =>
            prev.map(c =>
              c.name === SOUTH_NAME && c.state !== 'delivered'
                ? { ...c, state: 'active' as AgentCardState, message: '正在汇总整合...' }
                : c,
            ),
          )
        }
      }, 100)
    } else {
      // 仍有活跃 Agent → 向南保持/转为等待
      const waitingFor = [...activeAgentSetRef.current][0]
      waitingForRef.current = waitingFor
      setAllCards(prev =>
        prev.map(c =>
          c.name === SOUTH_NAME && c.state !== 'delivered'
            ? { ...c, state: 'waiting' as AgentCardState, message: buildWaitingMessage(waitingFor) }
            : c,
        ),
      )
    }
  }, [])

  // =========================================================================
  // 辅助: 设置 Agent 为活跃状态
  // =========================================================================

  /**
   * 将 Agent 标记为活跃, 并处理向南的等待逻辑。
   *
   * @param agentName - 被激活的 Agent 全名
   * @param message - Agent 的初始消息
   */
  const setAgentActive = useCallback((agentName: string, message: string) => {
    // 取消防抖 (新 Agent 激活意味着向南应保持等待)
    if (promoteTimerRef.current) {
      clearTimeout(promoteTimerRef.current)
      promoteTimerRef.current = null
    }

    activeAgentSetRef.current.add(agentName)

    setAllCards(prev =>
      prev.map(c => {
        // 当前 Agent → 活跃
        if (c.name === agentName) {
          return { ...c, state: 'active' as AgentCardState, message, resultSummary: null }
        }
        // 向南: 如果有其他 Agent 被激活, 向南进入等待
        if (c.name === SOUTH_NAME && agentName !== SOUTH_NAME && !southDoneRef.current) {
          waitingForRef.current = agentName
          return { ...c, state: 'waiting' as AgentCardState, message: buildWaitingMessage(agentName) }
        }
        return c
      }),
    )
  }, [])

  // =========================================================================
  // 辅助: 设置 Agent 为交付状态
  // =========================================================================

  /**
   * 将 Agent 标记为交付, 并尝试提升向南为活跃。
   *
   * @param agentName - 完成工作的 Agent 全名
   * @param resultSummary - 结果摘要
   */
  const setAgentDelivered = useCallback((agentName: string, resultSummary: string) => {
    activeAgentSetRef.current.delete(agentName)

    setAllCards(prev =>
      prev.map(c => {
        if (c.name === agentName) {
          // 向南特殊处理: 如果它正在等待, agent_done 不改变其状态
          if (agentName === SOUTH_NAME && waitingForRef.current) {
            return {
              ...c,
              resultSummary: resultSummary || c.resultSummary,
            }
          }
          // 正常交付
          if (agentName === SOUTH_NAME) {
            southDoneRef.current = true
          }
          return {
            ...c,
            state: 'delivered' as AgentCardState,
            message: '',
            resultSummary: resultSummary || c.resultSummary,
          }
        }
        return c
      }),
    )

    // 如果完成的 Agent 正是向南等待的, 尝试提升向南
    if (agentName === waitingForRef.current) {
      waitingForRef.current = null
      // 延迟到下一个微任务, 让 setAllCards 先生效
      setTimeout(() => tryPromoteSouth(), 0)
    }
  }, [tryPromoteSouth])

  // =========================================================================
  // 核心: SSE 流处理
  // =========================================================================

  const startStream = useCallback((sessionId: string): AbortController => {
    // 清理之前的连接
    abortRef.current?.abort()
    // 清理之前的防抖定时器
    if (promoteTimerRef.current) {
      clearTimeout(promoteTimerRef.current)
      promoteTimerRef.current = null
    }

    sessionIdRef.current = sessionId

    // 重置状态
    setShowProgress(true)
    setReadyResourceCount(0)
    readyResourceCountRef.current = 0
    setQuestionnaireReady(false)
    setFeedbackReady(false)
    setGenerationDone(false)
    setResources([])
    setCurrentStageTitle('')
    setProgressMessage('')
    crafterEntryIndexRef.current = 0

    // ── 立即初始化卡片 (不等 session_init SSE 事件) ──
    // 使用默认配置: 全选资源 + 开启采风, session_init 到达后会精准修正
    initCards(['handout', 'mindmap', 'exercise'], true)

    // 发起 SSE 连接
    const url = `${getApiBaseUrl()}/api/v2/zhixue/sessions/${sessionId}/stream`
    const token = useAuthStore.getState().token
    const controller = new AbortController()

    fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    })
      .then(async res => {
        if (!res.ok) {
          let m = `请求失败 (${res.status})`
          try {
            m = (await res.json())?.detail || m
          } catch {
            /* ignore parse errors */
          }
          callbacks?.onError?.(m)
          setShowProgress(false)
          return
        }

        const reader = res.body?.getReader()
        if (!reader) {
          callbacks?.onError?.('无法读取SSE流')
          return
        }

        const dec = new TextDecoder()
        let buf = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const parts = buf.split('\n\n')
          buf = parts.pop() || ''

          for (const p of parts) {
            if (!p.trim() || !p.startsWith('data: ')) continue
            try {
              handleEvent(JSON.parse(p.slice(6)))
            } catch {
              /* 忽略解析失败的事件 */
            }
          }
        }
      })
      .catch((err: Error & { name: string }) => {
        if (err.name !== 'AbortError') {
          callbacks?.onError?.(err.message || 'SSE 错误')
          setShowProgress(false)
        }
      })

    /**
     * SSE 事件分发器 — 将后端事件映射为 Agent 卡片状态变更
     *
     * 核心状态推断规则:
     *   agent_start(A) → A 活跃; 若 A≠向南 → 向南等待
     *   agent_done(A)  → A 交付; 若向南等待 A → 尝试提升向南为活跃
     *   agent_progress  → 仅更新消息
     *   session_complete → 向南交付 (若尚未交付)
     */
    function handleEvent(event: Record<string, unknown>) {
      const type = event.type as string

      switch (type) {
        // ── 会话初始化: 解析配置, 初始化卡片 ──
        case 'session_init': {
          const sMats = (event.selected_materials as string[]) || [
            'handout', 'mindmap', 'exercise',
          ]
          const scouting = (event.scouting_enabled as boolean) ?? true
          initCards(sMats, scouting)
          setProgressMessage(
            `正在为 "${event.course_name || ''}" 准备学习方案...`,
          )
          callbacks?.onSessionInit?.(event)
          break
        }

        // ── Agent 启动: 标记活跃 ──
        case 'agent_start': {
          const agent = event.agent as string
          const msg = (event.message as string) || ''
          setAgentActive(agent, msg)
          setProgressMessage(msg)
          break
        }

        // ── Agent 进度: 仅更新消息 ──
        case 'agent_progress': {
          const agent = event.agent as string
          const msg = (event.message as string) || ''
          setAllCards(prev =>
            prev.map(c => (c.name === agent ? { ...c, message: msg } : c)),
          )
          setProgressMessage(msg)
          break
        }

        // ── Agent 完成: 标记交付 ──
        case 'agent_done': {
          const agent = event.agent as string
          const summary = (event.result_summary as string) || ''
          setAgentDelivered(agent, summary)
          break
        }

        // ── 资源就绪: 更新计数和列表 ──
        case 'resource_ready':
          setReadyResourceCount(p => {
            const next = p + 1
            readyResourceCountRef.current = next
            return next
          })
          setResources(prev => [
            ...prev,
            {
              resource_type: event.resource_type as string,
              resource_id: event.resource_id as string,
              title: event.title as string,
              stage_index: event.stage_index as number,
              is_remedial: event.is_remedial as boolean,
            },
          ])
          setProgressMessage(`已生成: ${event.title || ''}`)
          break

        // ── 路径规划完成 ──
        case 'path_update':
          callbacks?.onPathUpdate?.(event)
          break

        // ── 阶段开始 ──
        case 'stage_start':
          setCurrentStageTitle((event.stage_title as string) || '')
          callbacks?.onStageStart?.(event)
          break

        // ── 审查结果 ──
        case 'review_result':
          if (event.overall_verdict !== 'ALL_PASS') {
            setProgressMessage(`审查结果: ${event.overall_verdict}`)
          }
          break

        // ── 阶段完成 ──
        case 'stage_complete':
          callbacks?.onStageComplete?.(event)
          break

        // ── 阶段反馈就绪 ──
        case 'feedback_ready':
          setGenerationDone(true)
          setCurrentStageTitle((event.stage_title as string) || '')
          // 标记向南为交付
          southDoneRef.current = true
          waitingForRef.current = null
          if (promoteTimerRef.current) {
            clearTimeout(promoteTimerRef.current)
            promoteTimerRef.current = null
          }
          setAllCards(prev =>
            prev.map(c =>
              c.name === SOUTH_NAME
                ? {
                    ...c,
                    state: 'delivered' as AgentCardState,
                    message: '全部资源已生成完毕',
                    resultSummary: `已生成 ${readyResourceCountRef.current} 个学习资源`,
                  }
                : c,
            ),
          )
          callbacks?.onFeedbackReady?.(event)
          break

        // ── 补救资源就绪 ──
        case 'remedial_ready':
          setGenerationDone(true)
          southDoneRef.current = true
          waitingForRef.current = null
          if (promoteTimerRef.current) {
            clearTimeout(promoteTimerRef.current)
            promoteTimerRef.current = null
          }
          setAllCards(prev =>
            prev.map(c =>
              c.name === SOUTH_NAME
                ? {
                    ...c,
                    state: 'delivered' as AgentCardState,
                    message: '补救资源已生成完毕',
                    resultSummary: null,
                  }
                : c,
            ),
          )
          callbacks?.onRemedialReady?.(event)
          break

        // ── 会话完成 ──
        case 'session_complete':
          callbacks?.onSessionComplete?.()
          break

        // ── 问卷就绪 (Phase 1 产物) ──
        case 'questionnaire_ready':
          setQuestionnaireReady(true)
          setShowProgress(false)
          callbacks?.onQuestionnaireReady?.(event)
          break

        // ── 诊断就绪: 解惑师霍然完成困惑分析 ──
        case 'diagnosis_ready':
          setProgressMessage((event.summary as string) || (event.diagnosis ? '困惑分析完成' : ''))
          // 标记霍然为交付
          setAgentDelivered('解惑师霍然', (event.summary as string) || '困惑分析完成')
          break

        // ── 匠失败: 生成重试耗尽, 前端展示警告标记 ──
        case 'craft_failed': {
          const cfAgent = event.agent as string
          const cfError = (event.error as string) || '生成异常'
          setAllCards(prev =>
            prev.map(c =>
              c.name === cfAgent
                ? {
                    ...c,
                    message: `⚠️ 生成异常: ${cfError}`,
                    resultSummary: `重试耗尽 (${event.retry_attempts || 0} 次)`,
                  }
                : c,
            ),
          )
          break
        }

        // ── 错误 ──
        case 'error':
          callbacks?.onError?.((event.message as string) || '未知错误')
          setShowProgress(false)
          break

        default:
          break
      }
    }

    abortRef.current = controller
    return controller
  }, [callbacks, initCards, setAgentActive, setAgentDelivered])

  // =========================================================================
  // 取消 & 关闭
  // =========================================================================

  /** 取消当前 SSE 流并关闭进度面板 */
  const cancelStream = useCallback(async () => {
    if (sessionIdRef.current) {
      try {
        await cancelZhiXueSession(sessionIdRef.current)
      } catch {
        /* 忽略取消失败 */
      }
    }
    abortRef.current?.abort()
    if (promoteTimerRef.current) {
      clearTimeout(promoteTimerRef.current)
      promoteTimerRef.current = null
    }
    setShowProgress(false)
  }, [])

  /** 关闭进度面板 (生成完成后用户点击"开始学习") */
  const dismissProgress = useCallback(() => {
    setShowProgress(false)
    setGenerationDone(false)
  }, [])

  // =========================================================================
  // 派生: 过滤闲置 + 按优先级排序 → 可见卡片队列
  // =========================================================================

  /** 可见卡片队列: 排除闲置 Agent, 按活跃 > 等待 > 交付排序 */
  const agentCards = useMemo<AgentCard[]>(() => {
    return allCards
      .filter(c => c.state !== 'idle')
      .sort((a, b) => AGENT_PRIORITY[a.state] - AGENT_PRIORITY[b.state])
  }, [allCards])

  // =========================================================================
  // 返回接口
  // =========================================================================

  return {
    /** 可见的 Agent 卡片队列 (已过滤闲置 + 按优先级排序) */
    agentCards,
    /** 当前进度提示文字 */
    progressMessage,
    /** 进度面板可见性 */
    showProgress,
    /** 已生成资源计数 */
    readyResourceCount,
    /** 当前阶段标题 */
    currentStageTitle,
    /** Phase 1 问卷就绪标记 */
    questionnaireReady,
    /** Phase 2 阶段反馈就绪标记 */
    feedbackReady,
    /** 当前阶段生成完成标记 */
    generationDone,
    /** 已生成资源列表 */
    resources,
    /** 启动 SSE 流 */
    startStream,
    /** 取消 SSE 流 */
    cancelStream,
    /** 关闭进度面板 */
    dismissProgress,
  }
}
