/**
 * 课程列表页
 * 展示所有课程卡片, 支持创建、删除和进入课程详情
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Row,
  Col,
  Card,
  Button,
  Modal,
  Form,
  Input,
  Typography,
  Empty,
  Popconfirm,
  message,
  Spin,
  Tag,
} from 'antd'
import { PlusOutlined, DeleteOutlined, BookOutlined } from '@ant-design/icons'
import { getCourses, createCourse, deleteCourse } from '../services/api'
import type { Course } from '../types'

const { Title } = Typography

export default function CourseList() {
  const navigate = useNavigate()
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()

  /** 加载课程列表 */
  async function loadCourses() {
    setLoading(true)
    try {
      const data = await getCourses(1, 100)
      setCourses(data.items)
    } catch (err) {
      message.error('加载课程列表失败: ' + (err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCourses()
  }, [])

  /** 创建课程 */
  async function handleCreate() {
    try {
      const values = await form.validateFields()
      setSubmitting(true)
      await createCourse(values)
      message.success('课程创建成功')
      setModalOpen(false)
      form.resetFields()
      loadCourses()
    } catch (err) {
      if ((err as { errorFields?: unknown[] }).errorFields) return // 表单校验错误
      message.error('创建失败: ' + (err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  /** 删除课程 */
  async function handleDelete(courseId: string) {
    try {
      await deleteCourse(courseId)
      message.success('课程已删除')
      loadCourses()
    } catch (err) {
      message.error('删除失败: ' + (err as Error).message)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>
          课程管理
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
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
        <Row gutter={[16, 16]}>
          {courses.map((course) => (
            <Col xs={24} sm={12} lg={8} key={course.id}>
              <Card
                hoverable
                onClick={() => navigate(`/courses/${course.id}`)}
                actions={[
                  <Popconfirm
                    title="确定删除此课程?"
                    description="课程下的所有章节、文档和知识切片将被一并删除"
                    onConfirm={(e) => {
                      e?.stopPropagation()
                      handleDelete(course.id)
                    }}
                    onCancel={(e) => e?.stopPropagation()}
                    okText="确定"
                    cancelText="取消"
                    key="delete"
                  >
                    <DeleteOutlined
                      key="delete"
                      style={{ color: '#ff4d4f' }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Popconfirm>,
                ]}
              >
                <Card.Meta
                  avatar={<BookOutlined style={{ fontSize: 24, color: '#1677ff' }} />}
                  title={course.name}
                  description={
                    <div>
                      <div style={{ marginBottom: 8, color: '#8c8c8c', minHeight: 40 }}>
                        {course.description || '暂无描述'}
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <Tag color="blue">{course.chapter_count} 个章节</Tag>
                        <Tag color="green">{course.document_count} 份文档</Tag>
                      </div>
                    </div>
                  }
                />
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {/* 创建课程弹框 */}
      <Modal
        title="创建新课程"
        open={modalOpen}
        onOk={handleCreate}
        onCancel={() => {
          setModalOpen(false)
          form.resetFields()
        }}
        confirmLoading={submitting}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="课程名称"
            rules={[{ required: true, message: '请输入课程名称' }]}
          >
            <Input placeholder="例如: 人工智能导论" />
          </Form.Item>
          <Form.Item name="description" label="课程描述">
            <Input.TextArea rows={3} placeholder="课程简介..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
