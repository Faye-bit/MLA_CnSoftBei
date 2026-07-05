/**
 * MLA 图形 Logo 组件
 *
 * 展示品牌图形标识 (字母标Logo.svg)。
 * 图形 Logo 即为完整品牌标识, 不再附加 MLA 文字。
 *
 * 变体:
 * - "vertical"   — Logo (高50px) + "智小学" 横向排布 (侧边栏展开)
 * - "compact"    — 仅 Logo, 高50px (侧边栏折叠)
 * - "horizontal" — 仅 Logo, 高24px (小空间)
 *
 * @see branding/MLA_BRAND_GUIDELINES.md
 */

import { gray } from '../../styles/tokens'

const LOGO_SRC = '/brand/字母标Logo.svg'

type LogoVariant = 'vertical' | 'horizontal' | 'compact'

interface MLALogoProps {
  variant?: LogoVariant
  style?: React.CSSProperties
  onClick?: () => void
}

/** 副标题 "智小学" 文字样式 */
const SUBTITLE_STYLE: React.CSSProperties = {
  fontWeight: 500,
  letterSpacing: '0.08em',
  color: gray[400],
  lineHeight: 1,
  userSelect: 'none',
  whiteSpace: 'nowrap',
}

export default function MLALogo({ variant = 'vertical', style, onClick }: MLALogoProps) {
  switch (variant) {
    // ========================================================================
    // vertical — 侧边栏展开: Logo 50px + "智小学" 横向排布
    // ========================================================================
    case 'vertical':
      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: onClick ? 'pointer' : 'default',
            userSelect: 'none',
            ...style,
          }}
          onClick={onClick}
        >
          <img src={LOGO_SRC} alt="MLA 智小学" style={{ height: 50 }} />
          <span style={{ ...SUBTITLE_STYLE, fontSize: 15 }}>
            智小学
          </span>
        </div>
      )

    // ========================================================================
    // compact — 侧边栏折叠: 仅 Logo, 50px
    // ========================================================================
    case 'compact':
      return (
        <img
          src={LOGO_SRC}
          alt="MLA 智小学"
          style={{
            height: 50,
            display: 'block',
            cursor: onClick ? 'pointer' : 'default',
            userSelect: 'none',
            ...style,
          }}
          onClick={onClick}
        />
      )

    // ========================================================================
    // horizontal — 小空间: 仅 Logo, 24px
    // ========================================================================
    case 'horizontal':
      return (
        <img
          src={LOGO_SRC}
          alt="MLA 智小学"
          style={{
            height: 24,
            display: 'block',
            cursor: onClick ? 'pointer' : 'default',
            userSelect: 'none',
            ...style,
          }}
          onClick={onClick}
        />
      )
  }
}
