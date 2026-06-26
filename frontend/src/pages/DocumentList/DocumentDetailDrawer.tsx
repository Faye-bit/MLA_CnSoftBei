/**
 * 文档详情抽屉
 * PDF/PPTX: 页面网格视图 + 知识点标签 + 快问AI
 * DOCX/MD/TXT: 切片列表 + 知识点关联 + AI 提取按钮
 */
import { useState } from 'react'
import {
  Drawer, Typography, Tag, Space, Button, Select,
  Alert, Row, Col, Card, Image,
} from 'antd'
import {
  LinkOutlined, ThunderboltOutlined, BulbOutlined,
} from '@ant-design/icons'
import { getPageImageUrl } from '../../services/api'
import { typeColorMap, statusMap, formatFileSize } from './types'
import type { DocumentDetail, DocumentPage } from '../../types'
import type { KpOption } from './types'

const { Title, Text, Paragraph } = Typography

interface DocumentDetailDrawerProps {
  open: boolean
  selectedDoc: DocumentDetail | null
  detailLoading: boolean
  detailChapters: Array<{ id: string; title: string }>
  kpOptions: KpOption[]
  linkingChunks: Set<string>
  linkChapterId: string | null
  linkChapterLoading: boolean
  failedPages: Set<number>
  courseId: string
  onClose: () => void
  onLinkChunk: (chunkId: string, kpId: string) => void
  onLinkPageToKp: (pageId: string, kpId: string) => void
  onOpenExtract: (docId: string) => void
  onLinkChapter: (chapterId: string) => Promise<void>
  onLinkChapterIdChange: (id: string | null) => void
  onPreviewPage: (page: DocumentPage) => void
  onPageImageError: (pageNumber: number) => void
  onAskAI: (page: DocumentPage) => void
  getLinkedKp: (kpId: string | null) => KpOption | undefined
}

export function DocumentDetailDrawer({
  open, selectedDoc, detailLoading, detailChapters,
  kpOptions, linkingChunks, linkChapterId, linkChapterLoading,
  failedPages, courseId, onClose, onLinkChunk, onLinkPageToKp,
  onOpenExtract, onLinkChapter, onLinkChapterIdChange,
  onPreviewPage, onPageImageError, onAskAI, getLinkedKp,
}: DocumentDetailDrawerProps) {
  if (!selectedDoc) return null

  const isPageBased = selectedDoc.file_type === 'pdf' || selectedDoc.file_type === 'pptx'

  return (
    <Drawer
      title={`文档详情: ${selectedDoc.filename}`}
      open={open}
      onClose={onClose}
      width={680}
      loading={detailLoading}
    >
      {/* ── 文档元信息 ── */}
      <div style={{ marginBottom: 16 }}>
        <Space size={16} wrap>
          <span>类型: <Tag color={typeColorMap[selectedDoc.file_type]}>{selectedDoc.file_type.toUpperCase()}</Tag></span>
          <span>大小: {formatFileSize(selectedDoc.file_size)}</span>
          <span>状态:{' '}
            <Tag color={statusMap[selectedDoc.parse_status]?.color}>
              {statusMap[selectedDoc.parse_status]?.label}
            </Tag>
          </span>
          {isPageBased ? (
            <>
              <span>页数: {selectedDoc.page_count}</span>
              {selectedDoc.kp_count > 0 && <span>知识点: {selectedDoc.kp_count}</span>}
            </>
          ) : (
            <span>切片: {selectedDoc.chunk_count}</span>
          )}
        </Space>
      </div>

      {/* ── 错误提示 ── */}
      {selectedDoc.error_message && (
        <div style={{ color: '#DC2626', marginBottom: 16, padding: 8, background: '#FEE2E2', borderRadius: 4 }}>
          提示: {selectedDoc.error_message}
        </div>
      )}

      {/* ── 关联章节 ── */}
      <div style={{ marginBottom: 16, padding: 12, background: '#F8FAFC', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ whiteSpace: 'nowrap' }}>关联章节:</span>
        <Select
          placeholder="选择已有章节"
          style={{ flex: 1 }}
          value={linkChapterId || undefined}
          onChange={(val) => onLinkChapterIdChange(val || null)}
          allowClear
          loading={linkChapterLoading}
          options={(detailChapters || []).map(ch => ({ value: ch.id, label: ch.title }))}
        />
        <Button
          type="primary" size="small"
          loading={linkChapterLoading}
          disabled={!linkChapterId}
          onClick={() => linkChapterId && onLinkChapter(linkChapterId)}
        >
          关联
        </Button>
      </div>

      {/* ── PDF/PPTX: 页面网格视图 ── */}
      {isPageBased ? (
        <>
          <Title level={5}>
            页面列表 ({selectedDoc.pages?.length || 0})
            {selectedDoc.kp_count > 0 && <Tag color="blue" style={{ marginLeft: 8 }}>{selectedDoc.kp_count} 个知识点</Tag>}
          </Title>
          {(!selectedDoc.pages || selectedDoc.pages.length === 0) ? (
            <div style={{ color: '#94A3B8' }}>暂无页面数据</div>
          ) : (
            <Row gutter={[12, 12]}>
              {selectedDoc.pages.map((page) => (
                <Col span={12} key={page.id}>
                  <Card
                    hoverable size="small"
                    onClick={() => onPreviewPage(page)}
                    cover={
                      <div style={{ height: 140, overflow: 'hidden', background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {failedPages.has(page.page_number) ? (
                          <span style={{ fontSize: 32 }}>🖼️</span>
                        ) : (
                          <img
                            src={getPageImageUrl(courseId, selectedDoc.id, page.page_number)}
                            alt={`第 ${page.page_number} 页`}
                            style={{ width: '100%', objectFit: 'cover' }}
                            onError={() => onPageImageError(page.page_number)}
                          />
                        )}
                      </div>
                    }
                  >
                    <Card.Meta
                      title={
                        <Space size={4}>
                          <Text strong>第 {page.page_number} 页</Text>
                          {page.linked_kp_ids.length > 0 && (
                            <Tag color="green" style={{ fontSize: 10 }}>已关联 {page.linked_kp_ids.length}</Tag>
                          )}
                        </Space>
                      }
                      description={
                        <div>
                          {page.summary ? (
                            <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 4, fontSize: 12 }}>{page.summary}</Paragraph>
                          ) : (
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {page.extracted_kps.length > 0 ? '未生成摘要' : '待 AI 解析'}
                            </Text>
                          )}
                          {page.extracted_kps.length > 0 && (
                            <Space size={4} wrap>
                              {page.extracted_kps.map((kp, idx) => (
                                <Tag key={idx} color="blue" style={{ fontSize: 10, margin: '2px 0' }}>{kp.title}</Tag>
                              ))}
                            </Space>
                          )}
                          {/* 快问AI 按钮 */}
                          <div style={{ marginTop: 4 }}>
                            <Button
                              type="link" size="small"
                              icon={<BulbOutlined />}
                              style={{ fontSize: 11, padding: 0, color: '#3B82F6' }}
                              onClick={(e) => { e.stopPropagation(); onAskAI(page) }}
                            >
                              问AI
                            </Button>
                          </div>
                        </div>
                      }
                    />
                  </Card>
                </Col>
              ))}
            </Row>
          )}
        </>
      ) : (
        <>
          {/* ── DOCX/MD/TXT: 切片列表 ── */}
          {kpOptions.length === 0 && (
            <Alert
              message="尚未创建知识点"
              description="请先在课程详情页创建章节和知识点，或者使用下方的「自动提取」功能让 AI 帮你从文档中提取知识点。"
              type="warning" showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          <div style={{ marginBottom: 16 }}>
            <Button type="primary" ghost icon={<ThunderboltOutlined />} onClick={() => onOpenExtract(selectedDoc.id)}>
              AI 自动提取知识点
            </Button>
            <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              LLM 阅读文档切片, 自动识别知识点并关联
            </Text>
          </div>

          <Title level={5}>
            文本切片 ({selectedDoc.chunks.length})
            {selectedDoc.chunks.filter((c) => c.knowledge_point_id).length > 0 && (
              <Tag color="green" style={{ marginLeft: 8 }}>
                已关联 {selectedDoc.chunks.filter((c) => c.knowledge_point_id).length} 条
              </Tag>
            )}
          </Title>

          {selectedDoc.chunks.length === 0 ? (
            <div style={{ color: '#94A3B8' }}>暂无切片</div>
          ) : (
            selectedDoc.chunks.map((chunk) => {
              const linkedKp = getLinkedKp(chunk.knowledge_point_id)
              return (
                <div key={chunk.id} style={{
                  marginBottom: 12, padding: 12,
                  background: chunk.knowledge_point_id ? '#DCFCE7' : '#F8FAFC',
                  borderRadius: 6,
                  border: chunk.knowledge_point_id ? '1px solid #BBF7D0' : '1px solid #E2E8F0',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Space size={8}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        切片 #{chunk.chunk_index} | {chunk.token_count} tokens
                      </Text>
                      {linkedKp && (
                        <Tag color="green" icon={<LinkOutlined />}>
                          {linkedKp.chapter_title} / {linkedKp.title}
                        </Tag>
                      )}
                    </Space>
                    {kpOptions.length > 0 && (
                      <Select size="small"
                        placeholder="关联到知识点..."
                        value={chunk.knowledge_point_id || undefined}
                        onChange={(kpId) => onLinkChunk(chunk.id, kpId)}
                        loading={linkingChunks.has(chunk.id)}
                        style={{ minWidth: 220 }}
                        allowClear
                        options={kpOptions.map((kp) => ({
                          label: `${kp.chapter_title} / ${kp.title}`,
                          value: kp.knowledge_point_id,
                        }))}
                        optionFilterProp="label"
                        showSearch
                        popupMatchSelectWidth={false}
                      />
                    )}
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.6, color: '#475569' }}>
                    {chunk.content.slice(0, 300)}
                    {chunk.content.length > 300 ? '...' : ''}
                  </div>
                </div>
              )
            })
          )}
        </>
      )}
    </Drawer>
  )
}
