/**
 * AI 自动提取知识点弹窗
 * 选择章节 → 开始提取 → 预览结果 → 创建确认
 */
import { Modal, Typography, Select, Button, Alert, List, Checkbox, Tag } from 'antd'
import { ThunderboltOutlined, PlusOutlined } from '@ant-design/icons'
import type { Chapter } from '../../types'
import type { ExtractedKP } from './types'

const { Text } = Typography

interface ExtractKpModalProps {
  open: boolean
  chapters: Chapter[]
  extracting: boolean
  extractedKPs: ExtractedKP[]
  classified: Array<{
    category: string
    items: Array<ExtractedKP>
  }>
  creating: boolean
  extractChapterId: string | undefined
  onCancel: () => void
  onChapterChange: (id: string | undefined) => void
  onStartExtract: () => void
  onToggleKp: (index: number, selected: boolean) => void
  onCreateKps: () => void
}

export function ExtractKpModal({
  open, chapters, extracting, extractedKPs, classified,
  creating, extractChapterId, onCancel, onChapterChange,
  onStartExtract, onToggleKp, onCreateKps,
}: ExtractKpModalProps) {
  return (
    <Modal
      title="AI 自动提取知识点"
      open={open}
      onCancel={onCancel}
      width={640}
      footer={null}
    >
      {/* 步骤1: 选择章节 + 开始提取 */}
      <div style={{ marginBottom: 16 }}>
        <Text strong>目标章节：</Text>
        <Select
          placeholder="选择知识点所属章节"
          value={extractChapterId}
          onChange={onChapterChange}
          style={{ minWidth: 280, marginLeft: 8 }}
          options={chapters.map((ch) => ({ label: ch.title, value: ch.id }))}
        />
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          onClick={onStartExtract}
          loading={extracting}
          disabled={!extractChapterId}
          style={{ marginLeft: 12 }}
        >
          开始提取
        </Button>
      </div>

      {/* 步骤2: 加载中 */}
      {extracting && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Text type="secondary">正在调用 LLM 分析文档内容, 请稍候...</Text>
        </div>
      )}

      {/* 步骤3: 预览结果 */}
      {extractedKPs.length > 0 && (
        <>
          <Alert
            message={`提取到 ${extractedKPs.length} 个知识点, 请确认后创建 (可取消不需要的)`}
            type="success"
            showIcon
            style={{ marginBottom: 12 }}
          />
          <List
            dataSource={extractedKPs}
            renderItem={(item, index) => (
              <List.Item style={{ padding: '8px 0' }}>
                <div style={{ width: '100%' }}>
                  <Checkbox
                    checked={item.selected}
                    onChange={(e) => onToggleKp(index, e.target.checked)}
                  >
                    <Text strong>{item.title}</Text>
                    <Tag
                      color={item.difficulty === 'easy' ? 'green' : item.difficulty === 'medium' ? 'blue' : 'red'}
                      style={{ marginLeft: 8 }}
                    >
                      {item.difficulty === 'easy' ? '简单' : item.difficulty === 'medium' ? '中等' : '困难'}
                    </Tag>
                    {item.chunk_ids.length > 0 && <Tag>{item.chunk_ids.length} 个关联切片</Tag>}
                  </Checkbox>
                  <div style={{ marginLeft: 28, color: '#94A3B8', fontSize: 13, marginTop: 2 }}>
                    {item.description || '暂无描述'}
                  </div>
                </div>
              </List.Item>
            )}
          />
          <div style={{ marginTop: 16, textAlign: 'right' }}>
            <Button onClick={onCancel} style={{ marginRight: 8 }}>取消</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={onCreateKps} loading={creating}>
              创建选中的知识点
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
