/**
 * Live2DSpeechProvider — 全局朗读 Context
 *
 * 提供跨组件的语音朗读能力:
 * - speak(text): 调用后端 TTS API → 播放音频 + 驱动 Live2D 口型
 * - pause(): 暂停播放
 * - resume(): 恢复播放
 * - stop(): 停止播放
 *
 * 状态机:
 *   idle → loading → playing → (done) → idle
 *                    → paused  → (resume) → playing
 *
 * 口型同步: 使用 Web Audio API AnalyserNode 实时分析音频波形,
 * 将 RMS 音量映射到 Live2D ParamMouthOpenY 参数。
 *
 * 注意: l2d-widget 的 setParams 对 Cubism 5 模型使用错误的参数名
 * 格式 (PARAM_MOUTH_OPEN_Y), 无法正确映射到模型的 ParamMouthOpenY。
 * 因此本实现直接设置底层 delegate 的 _forcedParams 绕过此 bug。
 * 若无法访问底层 delegate 则降级为周期脉冲方案。
 */

import { createContext, useContext, useState, useCallback, useRef, useMemo, type ReactNode } from 'react'
import { synthesizeTTS } from '../../services/api'
import { getL2DWidget } from './Live2DStage'

// ============================================================================
// 类型
// ============================================================================

export type SpeechStatus = 'idle' | 'loading' | 'playing' | 'paused'

interface Live2DSpeechContextValue {
  speak: (text: string) => Promise<void>
  pause: () => void
  resume: () => void
  stop: () => void
  status: SpeechStatus
}

// ============================================================================
// Context
// ============================================================================

const Live2DSpeechContext = createContext<Live2DSpeechContextValue | null>(null)

export function useLive2DSpeech(): Live2DSpeechContextValue {
  const ctx = useContext(Live2DSpeechContext)
  if (!ctx) {
    return {
      speak: async () => {},
      pause: () => {},
      resume: () => {},
      stop: () => {},
      status: 'idle' as SpeechStatus,
    }
  }
  return ctx
}

// ============================================================================
// 常量
// ============================================================================

/** 口型最大值 (Live2D 范围 0~1) */
const MOUTH_MAX = 0.85

/** RMS 放大系数 (原始语音 RMS ~0~0.25 → 映射到 0~0.85) */
const RMS_AMPLIFY = 4.5

/** RMS 指数移动平均平滑系数 */
const RMS_SMOOTH = 0.35

/** 静音阈值 */
const SILENCE_THRESHOLD = 0.015

/** AnalyserNode FFT size */
const ANALYSER_FFT_SIZE = 256

/** 文本清理 + 截断上限 */
const MAX_TEXT_LENGTH = 3000

function cleanText(text: string): string {
  return text
    .replace(/[#*`>\[\]()!\-|~]/g, '')
    .replace(/\n{2,}/g, '。')
    .replace(/\n/g, '，')
    .slice(0, MAX_TEXT_LENGTH)
    .trim()
}

// ============================================================================
// Cubism delegate 访问 (绕过 l2d-widget setParams 的参数名 bug)
// ============================================================================

/**
 * 缓存的 delegate 引用 (Live2D 模型更新循环运行在此对象上,
 *  其 _forcedParams 每帧被读取并应用到模型参数)
 */
let _cachedDelegate: any = null

/** 从 l2d-widget 内部解析出 model delegate (拥有 _forcedParams 的对象) */
function resolveDelegate(): any {
  if (_cachedDelegate) return _cachedDelegate
  const widget = getL2DWidget() as any
  if (!widget) return null
  try {
    const l2d6Model = widget.l2d?._state?.l2d6Model
    if (!l2d6Model) return null
    const mgr = l2d6Model._subdelegates?.[0]?.getLive2DManager?.()
    const delegate = mgr?._models?.[0]
    if (delegate) {
      _cachedDelegate = delegate
      console.log('[Live2D Speech] delegate 已解析并缓存')
    }
    return _cachedDelegate
  } catch {
    return null
  }
}

/** 直接设置 delegate._forcedParams (正确的参数名是 ParamMouthOpenY) */
function setMouthDelegated(value: number): void {
  const d = resolveDelegate()
  if (!d) return
  try {
    d._forcedParams = { ParamMouthOpenY: value }
  } catch { /* ignore */ }
}

// ============================================================================
// 降级方案: 周期脉冲口型
// ============================================================================

const FALLBACK_MOUTH_INTERVAL = 80
const FALLBACK_MOUTH_MIN = 0.0
const FALLBACK_MOUTH_MAX = 0.85
const FALLBACK_PULSE_BURST = 6
const FALLBACK_PAUSE_DURATION = 200

function startFallbackMouth(
  timerRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>,
): void {
  stopFallbackMouth(timerRef)
  let pulseCount = 0
  timerRef.current = setInterval(() => {
    if (pulseCount < FALLBACK_PULSE_BURST) {
      const value = FALLBACK_MOUTH_MIN + Math.random() * (FALLBACK_MOUTH_MAX - FALLBACK_MOUTH_MIN)
      setMouthDelegated(value)
      pulseCount++
    } else {
      setMouthDelegated(FALLBACK_MOUTH_MIN)
      pulseCount++
      if (pulseCount >= FALLBACK_PULSE_BURST + Math.ceil(FALLBACK_PAUSE_DURATION / FALLBACK_MOUTH_INTERVAL)) {
        pulseCount = 0
      }
    }
  }, FALLBACK_MOUTH_INTERVAL)
}

function stopFallbackMouth(
  timerRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>,
): void {
  if (timerRef.current) {
    clearInterval(timerRef.current)
    timerRef.current = null
  }
  setMouthDelegated(FALLBACK_MOUTH_MIN)
}

// ============================================================================
// Provider
// ============================================================================

export default function Live2DSpeechProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SpeechStatus>('idle')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const fallbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const rmsSmoothRef = useRef(0)

  // ==========================================================================
  // 口型动画
  // ==========================================================================

  const stopMouth = useCallback((closeCtx = false) => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    stopFallbackMouth(fallbackTimerRef)
    rmsSmoothRef.current = 0
    setMouthDelegated(0)
    if (closeCtx && audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
      analyserRef.current = null
    }
  }, [])

  const startMouth = useCallback(() => {
    stopMouth(false)
    const analyser = analyserRef.current
    const audioCtx = audioCtxRef.current

    if (!analyser || !audioCtx || !resolveDelegate()) {
      startFallbackMouth(fallbackTimerRef)
      return
    }

    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {})
    }

    rmsSmoothRef.current = 0
    const dataArray = new Uint8Array(analyser.frequencyBinCount)

    const updateMouth = () => {
      const audio = audioRef.current
      if (!audio || audio.paused || audio.ended) {
        setMouthDelegated(0)
        animFrameRef.current = null
        return
      }

      analyser.getByteTimeDomainData(dataArray)
      let sum = 0
      for (let i = 0; i < dataArray.length; i++) {
        const normalized = (dataArray[i] - 128) / 128
        sum += normalized * normalized
      }
      const rms = Math.sqrt(sum / dataArray.length)

      rmsSmoothRef.current = RMS_SMOOTH * rms + (1 - RMS_SMOOTH) * rmsSmoothRef.current
      const smoothedRMS = rmsSmoothRef.current

      const mouthValue = smoothedRMS < SILENCE_THRESHOLD
        ? 0
        : Math.min(MOUTH_MAX, smoothedRMS * RMS_AMPLIFY)

      setMouthDelegated(mouthValue)
      animFrameRef.current = requestAnimationFrame(updateMouth)
    }

    animFrameRef.current = requestAnimationFrame(updateMouth)
  }, [stopMouth])

  // ==========================================================================
  // 音频资源
  // ==========================================================================

  const cleanupAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
    }
    stopMouth(true)
  }, [stopMouth])

  const stop = useCallback(() => {
    cleanupAudio()
    setStatus('idle')
  }, [cleanupAudio])

  const pause = useCallback(() => {
    if (audioRef.current && status === 'playing') {
      audioRef.current.pause()
      if (audioCtxRef.current && audioCtxRef.current.state === 'running') {
        audioCtxRef.current.suspend().catch(() => {})
      }
      stopMouth(false)
      setStatus('paused')
    }
  }, [status, stopMouth])

  const resume = useCallback(() => {
    if (audioRef.current && status === 'paused') {
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {})
      }
      audioRef.current.play()
        .then(() => {
          startMouth()
          setStatus('playing')
        })
        .catch(() => { stop() })
    }
  }, [status, startMouth, stop])

  const createAudioContext = useCallback((audio: HTMLAudioElement): boolean => {
    try {
      const audioCtx = new AudioContext()
      const source = audioCtx.createMediaElementSource(audio)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = ANALYSER_FFT_SIZE
      analyser.smoothingTimeConstant = 0.4
      source.connect(analyser)
      analyser.connect(audioCtx.destination)
      audioCtxRef.current = audioCtx
      analyserRef.current = analyser
      return true
    } catch (err) {
      console.warn('[Live2D Speech] AudioContext 创建失败:', err)
      audioCtxRef.current = null
      analyserRef.current = null
      return false
    }
  }, [])

  const speak = useCallback(async (text: string) => {
    const plain = cleanText(text)
    if (!plain) return

    if (status === 'playing') { pause(); return }
    if (status === 'paused') { resume(); return }

    cleanupAudio()
    setStatus('loading')

    try {
      const blob = await synthesizeTTS(plain)
      if (!blob) throw new Error('empty response')

      const url = URL.createObjectURL(blob)
      audioUrlRef.current = url
      const audio = new Audio(url)
      audioRef.current = audio

      createAudioContext(audio)

      const finish = () => {
        cleanupAudio()
        setStatus('idle')
      }

      audio.onended = finish
      audio.onerror = finish

      await audio.play()
      startMouth()
      setStatus('playing')
    } catch (err) {
      console.warn('[Live2D Speech] TTS 合成失败:', err)
      cleanupAudio()
      setStatus('idle')
    }
  }, [status, cleanupAudio, pause, resume, startMouth, createAudioContext])

  const value = useMemo(
    () => ({ speak, pause, resume, stop, status }),
    [speak, pause, resume, stop, status],
  )

  return (
    <Live2DSpeechContext.Provider value={value}>
      {children}
    </Live2DSpeechContext.Provider>
  )
}
