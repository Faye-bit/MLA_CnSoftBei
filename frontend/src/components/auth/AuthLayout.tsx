/**
 * 认证页共享布局组件 — 四层双栏设计
 *
 * 左侧 (45%): 四层品牌展示
 *   1. 品牌 — MLA 文字标识
 *   2. 价值 — 一句话核心价值主张
 *   3. 流程 — 三步使用路径
 *   4. 亮点 — 核心技术能力
 *
 * 右侧 (55%): 表单区, 渲染子组件
 *
 * 动画记忆: sessionStorage 记录首次播放, 切换登录/注册不再重播
 *
 * 背景: Canvas 神经网络动画 (NeuralBackground)
 *
 * @see branding/MLA_BRAND_GUIDELINES.md
 */

import { useState, useEffect } from 'react'
import { blue, gray } from '../../styles/tokens'
import NeuralBackground from './NeuralBackground'
import {
  UploadOutlined,
  DeploymentUnitOutlined,
  TrophyOutlined,
} from '@ant-design/icons'

interface AuthLayoutProps {
  title: string
  subtitle: string
  children: React.ReactNode
}

/** 用户使用流程 — 三步路径 */
const STEPS = [
  { icon: <UploadOutlined />, label: '上传课件资料', desc: '导入课程文档与讲义' },
  { icon: <DeploymentUnitOutlined />, label: 'AI 智能分析', desc: '多智能体协同生成学习方案' },
  { icon: <TrophyOutlined />, label: '个性化学习', desc: '针对性练习与知识巩固' },
]

/** 技术亮点 */
const HIGHLIGHTS = [
  '多智能体协同编排',
  '知识图谱深度检索',
  '学习画像持续进化',
  '个性化路径规划',
]

/** sessionStorage key — 记录入场动画是否已播放 */
const INTRO_KEY = 'mla-brand-intro-played'

export default function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  /**
   * 入场动画控制:
   * - 首次访问: 播放四层 stagger 入场动画, 1.5s 后标记"已播放"
   * - 再次访问 (登录↔注册切换): 跳过动画, 直接显示最终态
   * sessionStorage 仅在当前会话有效, 关闭标签页后重置 — 下次打开重新播放动画
   */
  const [introPlayed, setIntroPlayed] = useState(
    () => sessionStorage.getItem(INTRO_KEY) === 'true'
  )

  useEffect(() => {
    if (introPlayed) return
    const timer = setTimeout(() => {
      sessionStorage.setItem(INTRO_KEY, 'true')
      setIntroPlayed(true)
    }, 1500) // 最晚动画 delay (0.6s) + duration (0.8s) = ~1.4s, 取 1.5s 安全
    return () => clearTimeout(timer)
  }, [introPlayed])

  /** 动画样式: 已播放则跳过 */
  const fadeIn = (delay: string) =>
    introPlayed
      ? {}
      : { animation: `brandFadeIn 0.8s ease-out ${delay} both` }

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: '#FFFFFF',
      }}
    >
      {/* ================================================================= */}
      {/* 左侧: 品牌展示区 (45%) */}
      {/* ================================================================= */}
      <div
        style={{
          width: '45%',
          minWidth: 420,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '64px 56px',
          position: 'relative',
          overflow: 'hidden',
          background: `linear-gradient(165deg, ${blue[700]} 0%, ${blue[800]} 45%, ${gray[900]} 100%)`,
        }}
      >
        {/* ── Canvas 神经网络动画 ── */}
        <NeuralBackground />

        {/* ── 内容区 ── */}
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 36,
          }}
        >
          {/* ============================================================ */}
          {/* 第一层: 品牌 — 图形 Logo + 毛玻璃底, 居中 */}
          {/* ============================================================ */}
          <div style={{ alignSelf: 'center', marginBottom: 4, ...fadeIn('0s') }}>
            <div
              style={{
                width: 200,
                height: 200,
                borderRadius: 36,
                background: 'rgba(255,255,255,0.20)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                border: '2px solid rgba(255,255,255,0.25)',
                boxShadow: '0 8px 40px rgba(0,0,0,0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 4,
              }}
            >
              <img
                src="/brand/字母标Logo.svg"
                alt="MLA 智学引擎"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            </div>
          </div>

          {/* ============================================================ */}
          {/* 第二层: 价值 */}
          {/* ============================================================ */}
          <div style={fadeIn('0.25s')}>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: '#FFFFFF',
                lineHeight: 1.4,
                letterSpacing: '-0.01em',
              }}
            >
              你的个性化
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                lineHeight: 1.4,
                letterSpacing: '-0.01em',
              }}
            >
              <span
                style={{
                  background: 'linear-gradient(135deg, #93C5FD 0%, #60A5FA 50%, #38BDF8 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                专属 AI 导师
              </span>
            </div>
          </div>

          {/* ============================================================ */}
          {/* 第三层: 用户使用流程 */}
          {/* ============================================================ */}
          <div style={fadeIn('0.4s')}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.08em',
                color: 'rgba(255,255,255,0.35)',
                textTransform: 'uppercase',
                marginBottom: 16,
              }}
            >
              三步开启智慧学习
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {STEPS.map((step, idx) => (
                <div
                  key={step.label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: '10px 16px',
                    borderRadius: 10,
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    transition: 'background 0.3s, border-color 0.3s',
                    ...fadeIn(`${0.45 + idx * 0.1}s`),
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: 'rgba(255,255,255,0.12)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 14,
                      color: 'rgba(255,255,255,0.55)',
                      flexShrink: 0,
                    }}
                  >
                    {step.icon}
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'rgba(255,255,255,0.85)',
                        lineHeight: 1.4,
                      }}
                    >
                      {step.label}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'rgba(255,255,255,0.40)',
                        lineHeight: 1.4,
                        marginTop: 1,
                      }}
                    >
                      {step.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ============================================================ */}
          {/* 第四层: 技术亮点 */}
          {/* ============================================================ */}
          <div style={fadeIn('0.55s')}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.08em',
                color: 'rgba(255,255,255,0.35)',
                textTransform: 'uppercase',
                marginBottom: 14,
              }}
            >
              核心技术
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {HIGHLIGHTS.map((text) => (
                <span
                  key={text}
                  style={{
                    fontSize: 12,
                    color: 'rgba(255,255,255,0.55)',
                    padding: '4px 12px',
                    borderRadius: 20,
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    lineHeight: 1.5,
                  }}
                >
                  {text}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── 入场动画定义 ── */}
        <style>{`
          @keyframes brandFadeIn {
            from { opacity: 0; transform: translateY(12px); }
            to   { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>

      {/* ================================================================= */}
      {/* 右侧: 表单区 (55%) */}
      {/* ================================================================= */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '60px 48px',
          overflow: 'auto',
          background: '#FFFFFF',
        }}
      >
        <div style={{ width: '100%', maxWidth: 440 }}>
          <div style={{ marginBottom: 36 }}>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: gray[800],
                marginBottom: 6,
                letterSpacing: '-0.02em',
              }}
            >
              {title}
            </div>
            <div style={{ fontSize: 14, color: gray[500] }}>{subtitle}</div>
          </div>

          {children}
        </div>
      </div>
    </div>
  )
}
