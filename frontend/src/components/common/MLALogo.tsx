/**
 * MLA 纯文字品牌标识组件
 *
 * 设计规范 (MLA Brand v2.0 §2):
 * - 扁平化纯文字 Wordmark，无拟物图形
 * - 仅依靠字体、字重、间距传达品牌感
 * - 参考 Stripe, Notion, Vercel 的设计哲学
 *
 * 变体:
 * - "vertical" — 竖排完整标识 (MLA 大字 + 下方智学引擎小字)，侧边栏使用
 * - "horizontal" — 横排 MLA 智学引擎，Header 使用
 * - "compact" — 仅 MLA 三个字母，小空间使用
 *
 * @see branding/MLA_BRAND_GUIDELINES.md §2
 */

import { gray, blue } from '../../styles/tokens'

/** Logo 变体类型 */
type LogoVariant = 'vertical' | 'horizontal' | 'compact'

interface MLALogoProps {
  /** Logo 变体 */
  variant?: LogoVariant
  /** 自定义样式覆盖 */
  style?: React.CSSProperties
  /** 点击回调 (如跳转首页) */
  onClick?: () => void
}

/** MLA 主文字样式 (大字，800 字重) */
const MLA_TEXT_STYLE: React.CSSProperties = {
  fontWeight: 800,
  letterSpacing: '-0.03em',
  color: blue[500],
  lineHeight: 1,
  userSelect: 'none',
}

/** 副标题样式 (智学引擎，500 字重) */
const SUBTITLE_STYLE: React.CSSProperties = {
  fontWeight: 500,
  letterSpacing: '0.08em',
  color: gray[400],
  lineHeight: 1,
  userSelect: 'none',
}

export default function MLALogo({ variant = 'vertical', style, onClick }: MLALogoProps) {
  switch (variant) {
    // ==========================================================================
    // 竖排完整标识 — 侧边栏顶部
    // ==========================================================================
    case 'vertical':
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 2,
            cursor: onClick ? 'pointer' : 'default',
            ...style,
          }}
          onClick={onClick}
        >
          <span style={{ ...MLA_TEXT_STYLE, fontSize: 20 }}>
            MLA
          </span>
          <span style={{ ...SUBTITLE_STYLE, fontSize: 10 }}>
            智学引擎
          </span>
        </div>
      )

    // ==========================================================================
    // 横排标识 — Header 使用
    // ==========================================================================
    case 'horizontal':
      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            cursor: onClick ? 'pointer' : 'default',
            ...style,
          }}
          onClick={onClick}
        >
          <span style={{ ...MLA_TEXT_STYLE, fontSize: 16 }}>
            MLA
          </span>
          <span style={{ ...SUBTITLE_STYLE, fontSize: 12 }}>
            智学引擎
          </span>
        </div>
      )

    // ==========================================================================
    // 紧凑标识 — 折叠侧边栏 / 小空间
    // ==========================================================================
    case 'compact':
      return (
        <span
          style={{
            ...MLA_TEXT_STYLE,
            fontSize: 18,
            cursor: onClick ? 'pointer' : 'default',
            ...style,
          }}
          onClick={onClick}
        >
          MLA
        </span>
      )
  }
}
