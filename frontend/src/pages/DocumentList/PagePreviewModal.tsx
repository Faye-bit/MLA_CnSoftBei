/**
 * 页面预览弹窗
 * 展示页面大图、摘要、AI 提取知识点、关联已有知识点
 */
import { Modal, Typography, Tag, Image, Select } from 'antd'
import { getPageImageUrl } from '../../services/api'
import type { DocumentPage } from '../../types'
import type { KpOption } from './types'

const { Title, Text, Paragraph } = Typography

interface PagePreviewModalProps {
  open: boolean
  previewPage: DocumentPage | null
  kpOptions: KpOption[]
  linkingPageId: string | null
  courseId: string
  docId: string
  onCancel: () => void
  onLinkPageToKp: (pageId: string, kpId: string) => void
}

export function PagePreviewModal({
  open, previewPage, kpOptions, linkingPageId,
  courseId, docId, onCancel, onLinkPageToKp,
}: PagePreviewModalProps) {
  return (
    <Modal
      title={previewPage ? `第 ${previewPage.page_number} 页` : '页面预览'}
      open={open}
      onCancel={onCancel}
      width={900}
      footer={null}
    >
      {previewPage && (
        <div>
          <Image
            src={getPageImageUrl(courseId, docId, previewPage.page_number)}
            alt={`第 ${previewPage.page_number} 页`}
            style={{ width: '100%' }}
            fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
          />

          <div style={{ marginTop: 16 }}>
            {previewPage.summary && (
              <div style={{ marginBottom: 12 }}>
                <Text strong>📝 页面摘要：</Text>
                <Paragraph style={{ marginTop: 4 }}>{previewPage.summary}</Paragraph>
              </div>
            )}

            {previewPage.extracted_kps.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <Text strong>🏷️ AI 提取的知识点：</Text>
                <div style={{ marginTop: 8 }}>
                  {previewPage.extracted_kps.map((kp, idx) => (
                    <Tag
                      key={idx}
                      color={kp.difficulty === 'easy' ? 'green' : kp.difficulty === 'medium' ? 'blue' : 'red'}
                      style={{ marginBottom: 4 }}
                    >
                      {kp.title}
                      {kp.description ? `: ${kp.description}` : ''}
                      <Text type="secondary" style={{ fontSize: 10, marginLeft: 4 }}>
                        ({kp.difficulty === 'easy' ? '基础' : kp.difficulty === 'medium' ? '中等' : '困难'})
                      </Text>
                    </Tag>
                  ))}
                </div>
              </div>
            )}

            {kpOptions.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <Text strong>🔗 关联到已有知识点：</Text>
                <Select
                  placeholder="选择知识点关联此页面..."
                  style={{ minWidth: 300, marginLeft: 8 }}
                  loading={linkingPageId === previewPage.id}
                  onChange={(kpId) => onLinkPageToKp(previewPage.id, kpId)}
                  options={kpOptions.map((kp) => ({
                    label: `${kp.chapter_title} / ${kp.title}`,
                    value: kp.knowledge_point_id,
                  }))}
                  optionFilterProp="label"
                  showSearch
                  value={previewPage.linked_kp_ids.length > 0 ? previewPage.linked_kp_ids[0] : undefined}
                />
              </div>
            )}

            {previewPage.extracted_kps.length === 0 && previewPage.linked_kp_ids.length === 0 && (
              <Text type="secondary">此页面暂无知识点（可能是目录页、标题页或尚未 AI 解析）</Text>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
