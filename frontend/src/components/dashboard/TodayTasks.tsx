/**
 * 今日待办看板
 * 双源合并展示: 学习阶段自动待办 + 用户自定义待办
 * - 自动待办: 阶段完成后自动从列表消失, 不可手动勾选
 * - 自定义待办: 用户可手动勾选完成 / 编辑标题 / 删除
 *
 * 设计规范 (MLA Brand v2.0):
 * - 使用品牌 token 替代硬编码色值
 * - blue-50/blue-100 用于学习阶段卡片
 * - gray token 用于边框和文字
 *
 * @see branding/MLA_BRAND_GUIDELINES.md
 */

import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Skeleton, Empty, Button, Checkbox, Input, Tag, Typography, Space,
  Popconfirm, message as antMsg, Tooltip,
} from 'antd'
import {
  PlusOutlined, DeleteOutlined, BookOutlined,
  SendOutlined, CheckCircleOutlined, LoadingOutlined,
} from '@ant-design/icons'
import { getTodayStats, createTodo, updateTodo, deleteTodo } from '../../services/api'
import type { TodoItem } from '../../types'
import { gray, blue, semantic } from '../../styles/tokens'

const { Text } = Typography

export default function TodayTasks() {
  const navigate = useNavigate()
  // 数据状态
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<TodoItem[]>([])
  const [todayMessages, setTodayMessages] = useState(0)
  const [todayCompletedStages, setTodayCompletedStages] = useState(0)

  // 自定义待办输入状态
  const [inputValue, setInputValue] = useState('')
  const [adding, setAdding] = useState(false)

  /** 加载今日待办数据 */
  const loadData = useCallback(async () => {
    try {
      const data = await getTodayStats()
      setItems(data.items)
      setTodayMessages(data.today_messages)
      setTodayCompletedStages(data.today_completed_stages)
    } catch {
      // 请求失败时保持上次数据或空状态
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  /** 添加自定义待办 */
  const handleAddTodo = useCallback(async () => {
    const title = inputValue.trim()
    if (!title) return
    setAdding(true)
    try {
      await createTodo({ title })
      setInputValue('')
      antMsg.success('待办已添加')
      await loadData()
    } catch (e: unknown) {
      antMsg.error(e instanceof Error ? e.message : '添加失败')
    } finally {
      setAdding(false)
    }
  }, [inputValue, loadData])

  /** 勾选 / 取消勾选自定义待办 */
  const handleToggleTodo = useCallback(async (todoId: string, currentCompleted: boolean) => {
    try {
      await updateTodo(todoId, { is_completed: !currentCompleted })
      // 本地更新: 已完成项直接从列表移除
      setItems(prev => prev.filter(item => item.todo_id !== todoId))
      if (!currentCompleted) {
        antMsg.success('待办已完成')
      }
    } catch (e: unknown) {
      antMsg.error(e instanceof Error ? e.message : '操作失败')
    }
  }, [])

  /** 删除自定义待办 */
  const handleDeleteTodo = useCallback(async (todoId: string) => {
    try {
      await deleteTodo(todoId)
      setItems(prev => prev.filter(item => item.todo_id !== todoId))
      antMsg.success('待办已删除')
    } catch (e: unknown) {
      antMsg.error(e instanceof Error ? e.message : '删除失败')
    }
  }, [])

  /** 跳转到学习会话 (自动待办点击) */
  const handleGoToSession = useCallback((sessionId: string) => {
    navigate(`/learning/${sessionId}`)
  }, [navigate])

  // ---- 加载态 ----
  if (loading) {
    return (
      <div style={{ padding: '8px 0' }}>
        <Skeleton active paragraph={{ rows: 4 }} title={false} />
      </div>
    )
  }

  // ---- 底部添加待办输入框 ----
  const renderAddTodoInput = () => (
    <div
      style={{
        display: 'flex',
        gap: 8,
        marginTop: 12,
        paddingTop: 12,
        borderTop: `1px solid ${gray[200]}`,
      }}
    >
      <Input
        placeholder="添加自定义待办..."
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onPressEnter={handleAddTodo}
        disabled={adding}
        maxLength={500}
        style={{ flex: 1 }}
      />
      <Button
        type="primary"
        icon={adding ? <LoadingOutlined /> : <PlusOutlined />}
        onClick={handleAddTodo}
        disabled={!inputValue.trim() || adding}
      >
        添加
      </Button>
    </div>
  )

  // ---- 空数据态 ----
  if (items.length === 0) {
    return (
      <div style={{ padding: '8px 0' }}>
        <div style={{ padding: '16px 0', textAlign: 'center' }}>
          <Empty
            description="暂无学习任务, 你可以添加自定义待办"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            <Button type="link" onClick={() => navigate('/learning')}>
              去 AI 助学开始学习 →
            </Button>
          </Empty>
        </div>
        {renderAddTodoInput()}
      </div>
    )
  }

  // ---- 数据态 ----
  return (
    <div style={{ padding: '4px 0' }}>
      {/* 顶部活动摘要 */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          marginBottom: 16,
          padding: '8px 12px',
          background: gray[50],
          borderRadius: 8,
          fontSize: 13,
          color: gray[600],
        }}
      >
        <Space size={4}>
          <SendOutlined style={{ color: blue[500] }} />
          <span>今日已发送 <b style={{ color: blue[500] }}>{todayMessages}</b> 条消息</span>
        </Space>
        <Space size={4}>
          <CheckCircleOutlined style={{ color: semantic.success }} />
          <span>完成 <b style={{ color: semantic.success }}>{todayCompletedStages}</b> 个阶段</span>
        </Space>
      </div>

      {/* 待办列表 */}
      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
        {items.map((item) => {
          const key = item.source === 'learning_stage'
            ? `stage-${item.stage_id}`
            : `todo-${item.todo_id}`

          if (item.source === 'learning_stage') {
            // ---- 自动待办: 学习阶段 ----
            return (
              <div
                key={key}
                onClick={() => handleGoToSession(item.session_id!)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '10px 12px',
                  marginBottom: 8,
                  background: blue[50],
                  borderRadius: 8,
                  border: `1px solid ${blue[100]}`,
                  cursor: 'pointer',
                  transition: 'box-shadow 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = `0 2px 8px rgba(59,130,246,0.12)`
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = 'none'
                }}
              >
                <BookOutlined style={{ color: blue[500], marginTop: 2, fontSize: 16 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <Text strong style={{ fontSize: 14, color: gray[800] }}>{item.title}</Text>
                    <Tag color="blue" style={{ fontSize: 11, lineHeight: '18px', margin: 0 }}>
                      学习中
                    </Tag>
                  </div>
                  <Text style={{ fontSize: 12, color: gray[500] }}>
                    {item.course_name}
                  </Text>
                </div>
              </div>
            )
          }

          // ---- 自定义待办 ----
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                marginBottom: 6,
                borderRadius: 8,
                border: `1px solid ${gray[200]}`,
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = gray[50] }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              {/* 勾选框 */}
              <Checkbox
                checked={item.is_completed}
                onChange={() => handleToggleTodo(item.todo_id!, item.is_completed)}
              />

              {/* 待办文本 (勾选后划线变灰) */}
              <Text
                delete={item.is_completed}
                style={{
                  flex: 1,
                  fontSize: 14,
                  color: item.is_completed ? gray[400] : gray[700],
                }}
              >
                {item.title}
              </Text>

              {/* 删除按钮 */}
              <Popconfirm
                title="确定删除此待办吗?"
                onConfirm={() => handleDeleteTodo(item.todo_id!)}
                okText="删除"
                cancelText="取消"
                placement="left"
              >
                <Tooltip title="删除">
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    style={{ opacity: 0.5 }}
                  />
                </Tooltip>
              </Popconfirm>
            </div>
          )
        })}
      </div>

      {/* 底部: 添加自定义待办 */}
      {renderAddTodoInput()}
    </div>
  )
}
