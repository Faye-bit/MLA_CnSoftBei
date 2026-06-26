/**
 * 悬浮圆形按钮
 * 固定在屏幕右侧, 可纵向拖动改变位置, 点击呼出聊天面板
 * 点击与拖动区分在父组件 handleCollapseMouseDown 中处理
 */
import { Button } from 'antd'
import { MessageOutlined } from '@ant-design/icons'

interface FloatingButtonProps {
  collapseTop: number | null
  onDragStart: (e: React.MouseEvent) => void
  buttonRef: React.RefObject<HTMLDivElement | null>
}

const BUTTON_SIZE = 52

export function FloatingButton({ collapseTop, onDragStart, buttonRef }: FloatingButtonProps) {
  const buttonStyle: React.CSSProperties = {
    position: 'fixed',
    right: -4,
    top: collapseTop != null ? collapseTop : 'calc(50vh - 26px)',
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    zIndex: 1049,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'grab',
    transition: 'all 0.25s ease',
    borderRadius: '12px 0 0 12px',
  }

  return (
    <div ref={buttonRef} style={buttonStyle} onMouseDown={onDragStart}>
      <Button
        type="primary"
        shape="circle"
        size="large"
        icon={<MessageOutlined style={{ fontSize: 20 }} />}
        style={{
          width: BUTTON_SIZE,
          height: BUTTON_SIZE,
          boxShadow: '0 4px 16px rgba(59,130,246,0.35)',
          cursor: 'pointer',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
