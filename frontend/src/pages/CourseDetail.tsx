/**
 * 课程详情页
 * 展示课程的章节树、知识点列表, 支持章节和知识点的 CRUD
 */

import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Typography,
  Button,
  Spin,
  Card,
  Space,
  Modal,
  Form,
  Input,
  Select,
  message,
  Table,
  Popconfirm,
  Tag,
  Row,
  Col,
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  FileTextOutlined,
  UploadOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import {
  getCourseDetail,
  getChapters,
  createChapter,
  deleteChapter,
  getKnowledgePoints,
  createKnowledgePoint,
  deleteKnowledgePoint,
} from '../services/api'
import type { CourseDetail, Chapter, KnowledgePoint } from '../types'

const { Title } = Typography

export default function CourseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [course, setCourse] = useState<CourseDetail | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(true)

  // 弹框状态
  const [chapterModalOpen, setChapterModalOpen] = useState(false)
  const [kpModalOpen, setKpModalOpen] = useState(false)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [chapterForm] = Form.useForm()
  const [kpForm] = Form.useForm()

  /** 加载课程和章节数据 */
  async function loadData() {
    if (!id) return
    setLoading(true)
    try {
      const [courseData, chaptersData] = await Promise.all([
        getCourseDetail(id),
        getChapters(id),
      ])
      setCourse(courseData)
      setChapters(chaptersData)
    } catch (err) {
      message.error('加载课程数据失败: ' + (err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [id])

  /** 创建章节 */
  async function handleCreateChapter() {
    if (!id) return
    try {
      const values = await chapterForm.validateFields()
      await createChapter(id, values)
      message.success('章节创建成功')
      setChapterModalOpen(false)
      chapterForm.resetFields()
      loadData()
    } catch (err) {
      if ((err as { errorFields?: unknown[] }).errorFields) return
      message.error('创建失败: ' + (err as Error).message)
    }
  }

  /** 创建知识点 */
  async function handleCreateKnowledgePoint() {
    if (!selectedChapterId) return
    try {
      const values = await kpForm.validateFields()
      await createKnowledgePoint(selectedChapterId, values)
      message.success('知识点创建成功')
      setKpModalOpen(false)
      kpForm.resetFields()
      loadData()
    } catch (err) {
      if ((err as { errorFields?: unknown[] }).errorFields) return
      message.error('创建失败: ' + (err as Error).message)
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    )
  }

  if (!course) {
    return <div>课程不存在</div>
  }

  /** 章节表格列定义 */
  const chapterColumns = [
    { title: '排序', dataIndex: 'order_index', key: 'order_index', width: 60 },
    { title: '章节标题', dataIndex: 'title', key: 'title' },
    {
      title: '知识点数',
      dataIndex: 'knowledge_point_count',
      key: 'kp_count',
      width: 100,
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_: unknown, record: Chapter) => (
        <Space>
          <Button
            size="small"
            type="primary"
            ghost
            icon={<PlusOutlined />}
            onClick={() => {
              setSelectedChapterId(record.id)
              setKpModalOpen(true)
            }}
          >
            添加知识点
          </Button>
          <Popconfirm
            title="确定删除此章节?"
            onConfirm={() => handleDeleteChapter(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  /** 删除章节 */
  async function handleDeleteChapter(chapterId: string) {
    try {
      await deleteChapter(chapterId)
      message.success('章节已删除')
      loadData()
    } catch (err) {
      message.error('删除失败: ' + (err as Error).message)
    }
  }

  return (
    <div>
      {/* 课程基本信息 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 24 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            {course.name}
          </Title>
          <div style={{ color: '#8c8c8c', marginTop: 8 }}>{course.description || '暂无描述'}</div>
        </div>
        <Space>
          <Button icon={<UploadOutlined />} onClick={() => navigate(`/courses/${id}/upload`)}>
            上传文档
          </Button>
          <Button icon={<FileTextOutlined />} onClick={() => navigate(`/courses/${id}/documents`)}>
            文档列表
          </Button>
          <Button icon={<SearchOutlined />} onClick={() => navigate('/knowledge')}>
            知识检索
          </Button>
        </Space>
      </div>

      {/* 课程统计 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24}>
          <Card size="small">
            <Space size={24}>
              <span>
                <strong>{course.chapter_count}</strong> 个章节
              </span>
              <span>
                <strong>{course.document_count}</strong> 份文档
              </span>
              <span>
                创建时间: {new Date(course.created_at).toLocaleDateString('zh-CN')}
              </span>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* 章节列表 */}
      <Card
        title="章节管理"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setChapterModalOpen(true)}>
            添加章节
          </Button>
        }
      >
        <Table
          dataSource={chapters}
          columns={chapterColumns}
          rowKey="id"
          pagination={false}
          expandable={{
            expandedRowRender: (record) => <KnowledgePointList chapterId={record.id} />,
          }}
          locale={{ emptyText: '暂无章节，点击右上角按钮添加' }}
        />
      </Card>

      {/* 创建章节弹框 */}
      <Modal
        title="添加章节"
        open={chapterModalOpen}
        onOk={handleCreateChapter}
        onCancel={() => {
          setChapterModalOpen(false)
          chapterForm.resetFields()
        }}
        okText="创建"
        cancelText="取消"
      >
        <Form form={chapterForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="title"
            label="章节标题"
            rules={[{ required: true, message: '请输入章节标题' }]}
          >
            <Input placeholder="例如: 第一章 人工智能概述" />
          </Form.Item>
          <Form.Item name="description" label="章节描述">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="order_index" label="排序序号">
            <Input type="number" placeholder="数字越小越靠前" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 创建知识点弹框 */}
      <Modal
        title="添加知识点"
        open={kpModalOpen}
        onOk={handleCreateKnowledgePoint}
        onCancel={() => {
          setKpModalOpen(false)
          kpForm.resetFields()
        }}
        okText="创建"
        cancelText="取消"
      >
        <Form form={kpForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="title"
            label="知识点名称"
            rules={[{ required: true, message: '请输入知识点名称' }]}
          >
            <Input placeholder="例如: 监督学习与无监督学习" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="content" label="知识点正文">
            <Input.TextArea rows={4} placeholder="详细的知识点讲解内容..." />
          </Form.Item>
          <Form.Item name="difficulty" label="难度">
            <Select placeholder="选择难度等级">
              <Select.Option value="easy">简单</Select.Option>
              <Select.Option value="medium">中等</Select.Option>
              <Select.Option value="hard">困难</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

/**
 * 知识点列表子组件
 * 在章节表格的展开行中渲染
 */
function KnowledgePointList({ chapterId }: { chapterId: string }) {
  const [kps, setKps] = useState<KnowledgePoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadKps() {
      try {
        const data = await getKnowledgePoints(chapterId)
        setKps(data)
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
    }
    loadKps()
  }, [chapterId])

  if (loading) return <Spin size="small" />
  if (kps.length === 0) return <div style={{ color: '#8c8c8c' }}>暂无知识点</div>

  return (
    <div style={{ padding: '8px 0' }}>
      {kps.map((kp) => (
        <div
          key={kp.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 16px',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <div>
            <span style={{ fontWeight: 500 }}>{kp.title}</span>
            <Tag color={kp.difficulty === 'easy' ? 'green' : kp.difficulty === 'medium' ? 'blue' : 'red'} style={{ marginLeft: 8 }}>
              {kp.difficulty === 'easy' ? '简单' : kp.difficulty === 'medium' ? '中等' : '困难'}
            </Tag>
          </div>
          <Popconfirm
            title="确定删除此知识点?"
            onConfirm={async () => {
              try {
                await deleteKnowledgePoint(kp.id)
                message.success('知识点已删除')
                // 重新加载
                window.location.reload()
              } catch (err) {
                message.error('删除失败: ' + (err as Error).message)
              }
            }}
            okText="确定"
            cancelText="取消"
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </div>
      ))}
    </div>
  )
}

