/**
 * 课程详情页
 * 展示课程的章节树、知识点列表, 支持章节和知识点的 CRUD
 * Phase 3: 文档上传绑定到章节, 移除手动添加知识点按钮 (由 AI 自动提取)
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
  Steps,
  Upload,
  Alert,
  Tree,
  Popover,
  Image,
  Divider,
} from 'antd'
import type { DataNode } from 'antd/es/tree'
import {
  PlusOutlined,
  DeleteOutlined,
  FileTextOutlined,
  UploadOutlined,
  SearchOutlined,
  CheckCircleOutlined,
  InboxOutlined,
  FolderOutlined,
  BulbOutlined,
} from '@ant-design/icons'
import {
  getCourseDetail,
  getChapters,
  createChapter,
  deleteChapter,
  getKnowledgePoints,
  deleteKnowledgePoint,
  uploadDocument,
  reportAIExplanation,
} from '../services/api'
import { useAuthStore, useAppStore } from '../store'
import { useQuickAskStore } from '../store/quickAsk'
import type { CourseDetail, Chapter, KnowledgePoint, KnowledgePointTreeNode, LinkedPageInfo } from '../types'
import { blue, gray, semantic } from '../styles/tokens'

const { Title, Text } = Typography
const { Dragger } = Upload

/** 后端 API 基础地址, 用于拼接页面图片完整 URL */
const API_BASE = 'http://localhost:8000'

export default function CourseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [course, setCourse] = useState<CourseDetail | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(true)

  // 弹框状态
  const [chapterModalOpen, setChapterModalOpen] = useState(false)
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [uploadingChapterId, setUploadingChapterId] = useState<string | null>(null)
  const [uploadingChapterTitle, setUploadingChapterTitle] = useState('')
  const [uploading, setUploading] = useState(false)
  const [chapterForm] = Form.useForm()

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

  /** 打开章节上传弹窗 */
  function handleOpenUpload(chapterId: string, chapterTitle: string) {
    setUploadingChapterId(chapterId)
    setUploadingChapterTitle(chapterTitle)
    setUploadModalOpen(true)
  }

  /** 在章节中上传文档 */
  async function handleChapterUpload(file: File) {
    if (!id || !uploadingChapterId) return
    setUploading(true)
    try {
      const result = await uploadDocument(id, file, uploadingChapterId)
      message.success(`文档 "${result.filename}" 上传成功，AI 正在解析并将知识点归入当前章节`)
      setUploadModalOpen(false)
      loadData()
    } catch (err) {
      message.error('上传失败: ' + (err as Error).message)
    } finally {
      setUploading(false)
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
      width: 160,
      render: (_: unknown, record: Chapter) => (
        <Space>
          <Button
            size="small"
            icon={<UploadOutlined />}
            onClick={() => handleOpenUpload(record.id, record.title)}
          >
            上传文档
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
          <div style={{ color: gray[400], marginTop: 8 }}>{course.description || '暂无描述'}</div>
        </div>
        <Space>
          <Button icon={<FileTextOutlined />} onClick={() => navigate(`/courses/${id}/documents`)}>
            文档列表
          </Button>
          <Button icon={<SearchOutlined />} onClick={() => navigate('/knowledge')}>
            知识检索
          </Button>
        </Space>
      </div>

      {/* 工作流步骤引导 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Steps
          size="small"
          current={
            course.chapter_count === 0 ? 0
            : course.document_count === 0 ? 1
            : 2
          }
          items={[
            {
              title: '创建章节',
              description: '构建课程知识结构',
              icon: course.chapter_count > 0 ? <CheckCircleOutlined style={{ color: semantic.success }} /> : undefined,
              status: course.chapter_count > 0 ? 'finish' : 'process',
            },
            {
              title: '在章节中上传文档',
              description: '在对应章节中上传讲义/课件, AI 自动提取知识点',
              status: course.chapter_count > 0 ? (course.document_count > 0 ? 'finish' : 'process') : 'wait',
            },
            {
              title: '开始知识检索',
              description: '基于知识库的智能问答',
              status: course.document_count > 0 ? 'process' : 'wait',
            },
          ]}
        />
      </Card>

      {/* 课程统计 */}
      <Card size="small" style={{ marginBottom: 24 }}>
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
            expandedRowRender: (record) => <KnowledgePointList chapterId={record.id} courseId={id!} onDelete={loadData} />,
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

      {/* 章节上传文档弹框 */}
      <Modal
        title={`上传文档到: ${uploadingChapterTitle}`}
        open={uploadModalOpen}
        onCancel={() => {
          setUploadModalOpen(false)
          setUploadingChapterId(null)
        }}
        footer={null}
        width={520}
      >
        <div style={{ padding: '16px 0' }}>
          <Alert
            message="上传文档到此章节"
            description={`上传 PDF/PPTX/DOCX/MD/TXT 文件。PDF/PPTX 将使用 AI 页面级解析并提取知识点，知识点会自动归入"${uploadingChapterTitle}"章节。`}
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
          <Dragger
            name="file"
            multiple={false}
            showUploadList={false}
            accept=".pdf,.pptx,.docx,.md,.txt"
            disabled={uploading}
            customRequest={({ file }) => {
              handleChapterUpload(file as File)
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
            <p className="ant-upload-hint">
              支持 PDF、PPTX、DOCX、Markdown、TXT 格式
            </p>
          </Dragger>
          {uploading && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <Spin />
              <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                正在上传并解析文档...
              </Text>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

/**
 * 知识点列表子组件
 * 在章节表格的展开行中渲染
 */
function KnowledgePointList({ chapterId, courseId, onDelete }: { chapterId: string; courseId: string; onDelete: () => void }) {
  const [nodes, setNodes] = useState<KnowledgePointTreeNode[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try { setNodes(await getKnowledgePoints(chapterId) as unknown as KnowledgePointTreeNode[]) }
    catch { /* ignore */ } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [chapterId])

  if (loading) return <Spin size="small" />
  if (nodes.length === 0) return <div style={{ color: gray[400] }}>暂无知识点</div>

  function toTree(items: KnowledgePointTreeNode[]): DataNode[] {
    return items.map(item => {
      const hasChildren = item.children?.length > 0
      return {
        key: item.id,
        icon: item.kp_type === 'category' ? <FolderOutlined /> : undefined,
        title: (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {item.kp_type !== 'category' ? (
              <Popover trigger="click" placement="right"
                title={<span style={{ fontSize: 15, fontWeight: 600 }}>{item.title}</span>}
                content={
                  <div style={{ maxWidth: 420 }}>
                    {item.description && <p style={{ color: gray[800], lineHeight: 1.8, marginBottom: 8 }}>{item.description}</p>}
                    {item.content && <p style={{ color: gray[600], lineHeight: 1.8, marginBottom: 8, borderTop: `1px solid ${gray[200]}`, paddingTop: 8 }}>{item.content}</p>}
                    <Tag color={item.difficulty === 'easy' ? 'green' : item.difficulty === 'medium' ? 'blue' : 'red'}>
                      难度: {item.difficulty === 'easy' ? '简单' : item.difficulty === 'medium' ? '中等' : '困难'}
                    </Tag>

                    {/* AI 解释展示 (快问AI 功能): 仅当已存储且未达隐藏阈值时显示 */}
                    {item.ai_explanation && (item.ai_explanation_report_count ?? 0) < 5 && (
                      <div style={{
                        marginTop: 12, padding: '10px 12px',
                        background: '#EFF6FF', border: '1px solid #BFDBFE',
                        borderRadius: 8,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <Tag color="purple" style={{ fontSize: 10, margin: 0 }}>
                            <BulbOutlined /> AI 生成，仅供参考
                          </Tag>
                          {item.ai_explanation_generated_at && (
                            <Text style={{ fontSize: 10, color: gray[400] }}>
                              {new Date(item.ai_explanation_generated_at).toLocaleDateString('zh-CN')}
                            </Text>
                          )}
                        </div>
                        <Text style={{ fontSize: 13, lineHeight: 1.7 }}>
                          {item.ai_explanation}
                        </Text>
                        <div style={{ marginTop: 6, textAlign: 'right' }}>
                          <Button
                            type="link"
                            danger
                            size="small"
                            style={{ fontSize: 11 }}
                            onClick={async (e) => {
                              e.stopPropagation()
                              try {
                                await reportAIExplanation(item.id)
                                message.success('已报告，感谢反馈')
                                load() // 刷新以更新计数
                              } catch { message.error('报告失败') }
                            }}
                          >
                            报告不准确
                          </Button>
                        </div>
                      </div>
                    )}

                    {item.linked_pages && item.linked_pages.length > 0 && (
                      <>
                        <Divider style={{ margin: '12px 0 8px', fontSize: 13, color: gray[400] }}>关联页面</Divider>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {item.linked_pages.map((page: LinkedPageInfo) => (
                            <div key={page.page_id} style={{ width: 140, textAlign: 'center' }}>
                              <Image
                                src={`${API_BASE}${page.image_url}`}
                                alt={`第 ${page.page_number} 页`}
                                width={130}
                                height={90}
                                style={{ objectFit: 'cover', borderRadius: 4, border: `1px solid ${gray[200]}` }}
                                fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTMwIiBoZWlnaHQ9IjkwIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMzAiIGhlaWdodD0iOTAiIGZpbGw9IiNmNWY1ZjUiLz48dGV4dCB4PSI2NSIgeT0iNTAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiNjY2MiIGZvbnQtc2l6ZT0iMTIiPuWbvueJh+WKoOi9veWksei0pTwvdGV4dD48L3N2Zz4="
                              />
                              <div style={{ fontSize: 11, color: gray[400], marginTop: 2 }}>
                                第 {page.page_number} 页
                              </div>
                              {page.summary && (
                                <div style={{ fontSize: 10, color: gray[400], marginTop: 1, lineHeight: 1.4, maxHeight: 28, overflow: 'hidden' }}>
                                  {page.summary}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {/* 快问AI 按钮: 一键触发对该知识点的 AI 深度解释 */}
                    <Divider style={{ margin: '12px 0 8px' }} />
                    <Button
                      type="primary"
                      ghost
                      size="small"
                      icon={<BulbOutlined />}
                      block
                      onClick={(e) => {
                        e.stopPropagation()
                        useQuickAskStore.getState().trigger({
                          sourceType: 'kp',
                          contextText: [
                            `知识点：${item.title}`,
                            item.description ? `描述：${item.description}` : '',
                            item.content ? `内容：${item.content}` : '',
                          ].filter(Boolean).join('\n'),
                          prefillQuestion: `请帮我详细解释一下"${item.title}"这个知识点`,
                          metadata: {
                            courseId: courseId,
                            chapterId: item.chapter_id,
                            kpId: item.id,
                          },
                        })
                      }}
                    >
                      快问AI — 深入理解这个知识点
                    </Button>
                  </div>
                }
              >
                <span style={{ cursor: 'pointer' }} onClick={e => e.stopPropagation()}>
                  <span style={{ fontWeight: 400 }}>{item.title}</span>
                  <Tag color={item.difficulty === 'easy' ? 'green' : item.difficulty === 'medium' ? 'blue' : 'red'} style={{ marginLeft: 8, fontSize: 11 }}>
                    {item.difficulty === 'easy' ? '简单' : item.difficulty === 'medium' ? '中等' : '困难'}
                  </Tag>
                </span>
              </Popover>
            ) : (
              <span>
                <span style={{ fontWeight: 600 }}>{item.title}</span>
              </span>
            )}
            <Popconfirm title={item.kp_type === 'category' ? '删除分类会同时删除其下所有知识点' : '确定删除?'}
              onConfirm={async e => { e?.stopPropagation(); await deleteKnowledgePoint(item.id); message.success('已删除'); load(); onDelete() }}
              okText="确定" cancelText="取消">
              <Button size="small" danger icon={<DeleteOutlined />} onClick={e => e.stopPropagation()} />
            </Popconfirm>
          </div>
        ),
        children: hasChildren ? toTree(item.children) : undefined,
      }
    })
  }

  return <div style={{ padding: '8px 0' }}><Tree treeData={toTree(nodes)} defaultExpandAll={false} blockNode /></div>
}

