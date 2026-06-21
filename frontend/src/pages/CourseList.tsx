/**
 * 课程列表页 — 书封行设计
 *
 * 每门课程独占一行, 左侧为书的正面封面, 右侧为课程信息与操作区。
 * 封面使用品牌蓝色系 (blue-500 ~ blue-900), 遵循品牌指南。
 * 右侧展示课程简介 + 元数据 + 操作按钮。
 *
 * @see branding/MLA_BRAND_GUIDELINES.md
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button, Modal, Form, Input, Typography, Empty, Popconfirm,
  message, Spin, Tag,
} from 'antd'
import {
  PlusOutlined, DeleteOutlined, EditOutlined,
  FileTextOutlined, BookOutlined, RightOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons'
import { getCourses, createCourse, updateCourse, deleteCourse } from '../services/api'
import type { Course } from '../types'
import { blue, gray, radius } from '../styles/tokens'

const { Title, Text, Paragraph } = Typography

/**
 * 书封配色 — 遵循品牌蓝色系 (blue-500 ~ blue-900)
 * 不同课程轮换使用不同深度的品牌蓝, 保持统一又有辨识度
 */
const COVER_COLORS = [
  { bg: blue[600], spine: blue[800] },
  { bg: blue[700], spine: blue[900] },
  { bg: blue[500], spine: blue[700] },
  { bg: blue[800], spine: gray[900] },
  { bg: blue[600], spine: blue[900] },
  { bg: blue[500], spine: blue[800] },
  { bg: blue[700], spine: blue[800] },
] as const

function coverColor(index: number) {
  return COVER_COLORS[index % COVER_COLORS.length]
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── 组件 ───────────────────────────────────────────────────

export default function CourseList() {
  const navigate = useNavigate()
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)

  // 创建
  const [createOpen, setCreateOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [createForm] = Form.useForm()

  // 编辑
  const [editOpen, setEditOpen] = useState(false)
  const [editingCourse, setEditingCourse] = useState<Course | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editForm] = Form.useForm()

  async function loadCourses() {
    setLoading(true)
    try {
      const data = await getCourses(1, 100)
      setCourses(data.items)
    } catch (err) {
      message.error('加载课程列表失败: ' + (err as Error).message)
    } finally { setLoading(false) }
  }

  useEffect(() => { loadCourses() }, [])

  // ── 创建 ─────────────────────────────────────────────────

  async function handleCreate() {
    try {
      const values = await createForm.validateFields()
      setSubmitting(true)
      await createCourse(values)
      message.success('课程创建成功')
      setCreateOpen(false)
      createForm.resetFields()
      loadCourses()
    } catch (err) {
      if ((err as { errorFields?: unknown[] }).errorFields) return
      message.error('创建失败: ' + (err as Error).message)
    } finally { setSubmitting(false) }
  }

  // ── 编辑 ─────────────────────────────────────────────────

  function openEdit(course: Course, e: React.MouseEvent) {
    e.stopPropagation()
    setEditingCourse(course)
    editForm.setFieldsValue({ name: course.name, description: course.description || '' })
    setEditOpen(true)
  }

  async function handleSaveEdit() {
    if (!editingCourse) return
    try {
      const values = await editForm.validateFields()
      setEditSaving(true)
      await updateCourse(editingCourse.id, values)
      message.success('课程信息已更新')
      setEditOpen(false)
      loadCourses()
    } catch (err) {
      if ((err as { errorFields?: unknown[] }).errorFields) return
      message.error('更新失败: ' + (err as Error).message)
    } finally { setEditSaving(false) }
  }

  // ── 删除 ─────────────────────────────────────────────────

  async function handleDelete(courseId: string, e: React.MouseEvent | undefined) {
    e?.stopPropagation()
    try {
      await deleteCourse(courseId)
      message.success('课程已删除')
      loadCourses()
    } catch (err) {
      message.error('删除失败: ' + (err as Error).message)
    }
  }

  // ── 渲染 ─────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* 页面头部 */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 28,
      }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>课程管理</Title>
          <Text type="secondary" style={{ fontSize: 13, marginTop: 4, display: 'block' }}>
            共 {courses.length} 门课程
          </Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          创建课程
        </Button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <Spin size="large" />
        </div>
      ) : courses.length === 0 ? (
        <Empty description="暂无课程，点击上方按钮创建" style={{ padding: 80 }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {courses.map((course, idx) => {
            const colors = coverColor(idx)

            return (
              <div
                key={course.id}
                onClick={() => navigate(`/courses/${course.id}`)}
                style={{
                  display: 'flex',
                  borderRadius: radius.lg,
                  overflow: 'hidden',
                  border: `1px solid ${gray[200]}`,
                  background: '#FFFFFF',
                  cursor: 'pointer',
                  transition: `
                    box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1),
                    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)
                  `,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = '0 6px 24px rgba(15,23,42,0.1)'
                  e.currentTarget.style.transform = 'translateY(-2px)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = 'none'
                  e.currentTarget.style.transform = 'translateY(0)'
                }}
              >
                {/* ==================================================== */}
                {/* 左侧: 书的正面封面 (品牌蓝色系) */}
                {/* ==================================================== */}
                <div
                  style={{
                    width: 130,
                    minHeight: 150,
                    background: colors.bg,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '20px 16px',
                    flexShrink: 0,
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  {/* 书脊效果: 左侧 8px 深色带 */}
                  <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: 8, background: colors.spine,
                  }} />

                  {/* 装饰线 */}
                  <div style={{
                    position: 'absolute', top: 14, left: 20, right: 16,
                    height: 1, background: 'rgba(255,255,255,0.15)',
                  }} />
                  <div style={{
                    position: 'absolute', top: 18, left: 20, right: 16,
                    height: 1, background: 'rgba(255,255,255,0.08)',
                  }} />
                  <div style={{
                    position: 'absolute', bottom: 14, left: 20, right: 16,
                    height: 1, background: 'rgba(255,255,255,0.12)',
                  }} />

                  {/* 图标 */}
                  <BookOutlined style={{
                    fontSize: 20, color: 'rgba(255,255,255,0.45)',
                    marginBottom: 12,
                  }} />

                  {/* 书名 */}
                  <div style={{
                    color: '#FFFFFF',
                    fontSize: 15,
                    fontWeight: 700,
                    textAlign: 'center',
                    lineHeight: 1.5,
                    letterSpacing: '0.02em',
                    wordBreak: 'break-word',
                  }}>
                    {course.name}
                  </div>
                </div>

                {/* ==================================================== */}
                {/* 右侧: 简介 + 元数据 + 操作 */}
                {/* ==================================================== */}
                <div style={{
                  flex: 1,
                  padding: '20px 24px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  gap: 10,
                  minWidth: 0,
                }}>
                  {/* 课程名 (大字号) */}
                  <div style={{
                    fontSize: 17,
                    fontWeight: 600,
                    color: gray[800],
                    lineHeight: 1.3,
                  }}>
                    {course.name}
                  </div>

                  {/* 课程简介 */}
                  {course.description ? (
                    <Paragraph
                      type="secondary"
                      style={{
                        margin: 0,
                        fontSize: 13,
                        lineHeight: 1.65,
                        color: gray[500],
                      }}
                      ellipsis={{ rows: 2 }}
                    >
                      {course.description}
                    </Paragraph>
                  ) : (
                    <Text
                      style={{ fontSize: 13, color: gray[400], fontStyle: 'italic' }}
                    >
                      暂无简介
                    </Text>
                  )}

                  {/* 元数据行 */}
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 16,
                    fontSize: 12,
                    color: gray[500],
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <FileTextOutlined />
                      {course.document_count} 份文档
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <BookOutlined />
                      {course.chapter_count} 个章节
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <ClockCircleOutlined />
                      创建于 {course.created_at ? formatDate(course.created_at) : '—'}
                    </span>
                  </div>

                  {/* 操作按钮行 */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      marginTop: 4,
                    }}
                  >
                    <Button
                      size="small"
                      icon={<EditOutlined />}
                      onClick={(e) => openEdit(course, e)}
                    >
                      编辑
                    </Button>

                    <Popconfirm
                      title="确定删除此课程?"
                      description="课程下的所有章节、文档和知识切片将被一并删除"
                      onConfirm={(e) => handleDelete(course.id, e as React.MouseEvent)}
                      onCancel={(e) => e?.stopPropagation()}
                      okText="确定"
                      cancelText="取消"
                    >
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => e.stopPropagation()}
                      >
                        删除
                      </Button>
                    </Popconfirm>

                    {/* 进入课程 — 右对齐 */}
                    <div style={{ flex: 1 }} />
                    <Tag
                      color="blue"
                      style={{
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 2,
                        padding: '2px 10px', borderRadius: 6,
                      }}
                    >
                      进入课程 <RightOutlined style={{ fontSize: 10 }} />
                    </Tag>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ================================================================ */}
      {/* 创建课程 Modal */}
      {/* ================================================================ */}
      <Modal
        title="创建新课程"
        open={createOpen}
        onOk={handleCreate}
        onCancel={() => { setCreateOpen(false); createForm.resetFields() }}
        confirmLoading={submitting}
        okText="创建"
        cancelText="取消"
      >
        <Form form={createForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="课程名称"
            rules={[{ required: true, message: '请输入课程名称' }]}
          >
            <Input placeholder="例如: 人工智能导论" />
          </Form.Item>
          <Form.Item name="description" label="课程简介">
            <Input.TextArea rows={3} placeholder="简要描述课程内容..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* ================================================================ */}
      {/* 编辑课程 Modal */}
      {/* ================================================================ */}
      <Modal
        title="编辑课程"
        open={editOpen}
        onOk={handleSaveEdit}
        onCancel={() => { setEditOpen(false); editForm.resetFields() }}
        confirmLoading={editSaving}
        okText="保存"
        cancelText="取消"
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="课程名称"
            rules={[{ required: true, message: '请输入课程名称' }]}
          >
            <Input placeholder="课程名称" />
          </Form.Item>
          <Form.Item name="description" label="课程简介">
            <Input.TextArea rows={3} placeholder="简要描述课程内容..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
