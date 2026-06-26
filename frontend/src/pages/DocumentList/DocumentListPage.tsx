/**
 * 文档列表页 (容器组件)
 * 管理所有数据获取、API 调用和 UI 状态, 编排子组件渲染
 * 拆分为: DocumentTable / DocumentDetailDrawer / PagePreviewModal / ExtractKpModal
 */
import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Typography, Alert, message } from 'antd'
import {
  getDocuments, deleteDocument, getDocumentDetail,
  getCourseKnowledgePoints, linkChunkToKp, linkPageToKp,
  extractKP, createExtractedKP, getChapters,
  linkDocumentToChapter,
} from '../../services/api'
import { useQuickAskStore } from '../../store/quickAsk'
import { DocumentTable } from './DocumentTable'
import { DocumentDetailDrawer } from './DocumentDetailDrawer'
import { PagePreviewModal } from './PagePreviewModal'
import { ExtractKpModal } from './ExtractKpModal'
import type { ExtractedKP, KpOption } from './types'
import type { Document, DocumentDetail, DocumentPage, Chapter } from '../../types'

const { Title } = Typography

export default function DocumentListPage() {
  const { id } = useParams<{ id: string }>()
  const triggerQuickAsk = useQuickAskStore((s) => s.trigger)

  // ── 文档列表 ──
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)

  // ── 详情抽屉 ──
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedDoc, setSelectedDoc] = useState<DocumentDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [linkChapterId, setLinkChapterId] = useState<string | null>(null)
  const [linkChapterLoading, setLinkChapterLoading] = useState(false)
  const [detailChapters, setDetailChapters] = useState<Array<{ id: string; title: string }>>([])
  const [kpOptions, setKpOptions] = useState<KpOption[]>([])
  const [linkingChunks, setLinkingChunks] = useState<Set<string>>(new Set())

  // ── 自动提取知识点 ──
  const [extractModalOpen, setExtractModalOpen] = useState(false)
  const [extractChapterId, setExtractChapterId] = useState<string | undefined>()
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [extracting, setExtracting] = useState(false)
  const [extractedKPs, setExtractedKPs] = useState<ExtractedKP[]>([])
  const [classified, setClassified] = useState<Array<{
    category: string
    items: Array<ExtractedKP>
  }>>([])
  const [creating, setCreating] = useState(false)
  const [currentExtractDocId, setCurrentExtractDocId] = useState<string | null>(null)

  // ── 页面预览 ──
  const [pagePreviewOpen, setPagePreviewOpen] = useState(false)
  const [previewPage, setPreviewPage] = useState<DocumentPage | null>(null)
  const [linkingPageId, setLinkingPageId] = useState<string | null>(null)
  const [failedPages, setFailedPages] = useState<Set<number>>(new Set())

  // ====================================================================
  // 数据获取
  // ====================================================================

  async function loadDocuments(p = 1) {
    if (!id) return
    setLoading(true)
    try {
      const data = await getDocuments(id, p, 20)
      setDocuments(data.items)
      setTotal(data.total)
    } catch (err) {
      message.error('加载文档列表失败: ' + (err as Error).message)
    } finally { setLoading(false) }
  }

  useEffect(() => { loadDocuments() }, [id])

  async function handleViewDetail(docId: string) {
    if (!id) return
    setDetailLoading(true)
    setDetailOpen(true)
    setLinkChapterId(null)
    try {
      const [docData, kpData, chData] = await Promise.all([
        getDocumentDetail(id, docId),
        getCourseKnowledgePoints(id),
        getChapters(id),
      ])
      setDetailChapters(chData.map(ch => ({ id: ch.id, title: ch.title })))
      setSelectedDoc(docData)
      setKpOptions(kpData)
    } catch (err) {
      message.error('加载详情失败: ' + (err as Error).message)
      setDetailOpen(false)
    } finally { setDetailLoading(false) }
  }

  // ====================================================================
  // 操作回调
  // ====================================================================

  async function handleDelete(docId: string) {
    if (!id) return
    try { await deleteDocument(id, docId); message.success('文档已删除'); loadDocuments(page) }
    catch (err) { message.error('删除失败: ' + (err as Error).message) }
  }

  async function handleLinkChunk(chunkId: string, kpId: string) {
    if (!id || !kpId) return
    setLinkingChunks(prev => new Set(prev).add(chunkId))
    try {
      await linkChunkToKp(id, chunkId, kpId)
      message.success('切片已关联到知识点')
      if (selectedDoc) {
        const updated = await getDocumentDetail(id, selectedDoc.id)
        setSelectedDoc(updated)
      }
    } catch (err) { message.error('关联失败: ' + (err as Error).message) }
    finally {
      setLinkingChunks(prev => { const next = new Set(prev); next.delete(chunkId); return next })
    }
  }

  async function handleLinkPageToKp(pageId: string, kpId: string) {
    if (!id || !kpId) return
    setLinkingPageId(pageId)
    try {
      await linkPageToKp(id, pageId, [kpId])
      message.success('页面已关联到知识点')
      if (selectedDoc) {
        const updated = await getDocumentDetail(id, selectedDoc.id)
        setSelectedDoc(updated)
      }
    } catch (err) { message.error('关联失败: ' + (err as Error).message) }
    finally { setLinkingPageId(null) }
  }

  async function handleLinkChapter(chapterId: string) {
    if (!id || !selectedDoc) return
    setLinkChapterLoading(true)
    try {
      const r = await linkDocumentToChapter(id, selectedDoc.id, chapterId)
      message.success(`已关联并分类: ${r.category_count} 组 ${r.item_count} 个知识点`)
      setLinkChapterId(null)
      handleViewDetail(selectedDoc.id)
    } catch (err) { message.error('关联失败: ' + (err as Error).message) }
    finally { setLinkChapterLoading(false) }
  }

  async function handleOpenExtract(docId: string) {
    if (!id) return
    setCurrentExtractDocId(docId)
    setExtractModalOpen(true)
    setExtractedKPs([])
    setExtractChapterId(undefined)
    try { const data = await getChapters(id); setChapters(data) }
    catch { message.error('加载章节列表失败') }
  }

  async function handleExtract() {
    if (!id || !currentExtractDocId || !extractChapterId) {
      message.warning('请先选择目标章节'); return
    }
    setExtracting(true)
    try {
      const data = await extractKP(id, currentExtractDocId, extractChapterId)
      if (data.classified && data.classified.length > 0) {
        setClassified(data.classified.map((cat: any) => ({
          ...cat, items: cat.items.map((item: any) => ({ ...item, selected: true })),
        })))
      } else { setClassified([]) }
      const kps = (data.kp_list || []).map((kp) => ({ ...kp, selected: true }))
      setExtractedKPs(kps)
      const catCount = data.classified?.length || 0
      if (kps.length === 0) message.info('LLM 未从文档中识别到新知识点')
      else if (catCount > 0) message.success(`提取到 ${kps.length} 个知识点, AI 已分为 ${catCount} 个分类`)
      else message.success(`提取到 ${kps.length} 个知识点, 请确认后创建`)
    } catch (err) { message.error('提取失败: ' + (err as Error).message) }
    finally { setExtracting(false) }
  }

  async function handleCreateKPs() {
    if (!id || !currentExtractDocId || !extractChapterId) return
    if (classified.length > 0) {
      const cats = classified
        .map(cat => ({ category: cat.category, items: cat.items.filter(i => i.selected) }))
        .filter(cat => cat.items.length > 0)
      if (cats.length === 0) { message.warning('请至少保留一个知识点'); return }
      setCreating(true)
      try {
        await createExtractedKP(id, currentExtractDocId, extractChapterId, cats as any)
        message.success(`已创建 ${cats.length} 个分类的知识点树`)
        setExtractModalOpen(false); setExtractedKPs([]); setClassified([])
        if (currentExtractDocId) handleViewDetail(currentExtractDocId)
      } catch (err) { message.error('创建失败: ' + (err as Error).message) }
      finally { setCreating(false) }
      return
    }
    const selected = extractedKPs.filter(kp => kp.selected)
    if (selected.length === 0) { message.warning('请至少选择一个知识点'); return }
    setCreating(true)
    try {
      await createExtractedKP(id, currentExtractDocId, extractChapterId, selected)
      message.success(`已创建 ${selected.length} 个知识点并关联切片`)
      setExtractModalOpen(false)
      if (currentExtractDocId) handleViewDetail(currentExtractDocId)
    } catch (err) { message.error('创建失败: ' + (err as Error).message) }
    finally { setCreating(false) }
  }

  function handleToggleKp(index: number, selected: boolean) {
    const updated = [...extractedKPs]
    updated[index] = { ...updated[index], selected }
    setExtractedKPs(updated)
  }

  const getLinkedKp = useCallback((chunkKpId: string | null): KpOption | undefined => {
    if (!chunkKpId) return undefined
    return kpOptions.find(kp => kp.knowledge_point_id === chunkKpId)
  }, [kpOptions])

  // ====================================================================
  // 渲染
  // ====================================================================

  return (
    <div>
      <Title level={3} style={{ marginBottom: 24 }}>文档管理</Title>

      {documents.length > 0 && (
        <Alert
          message="下一步：关联切片到知识点"
          description="点击每份文档的「详情与关联」，在抽屉中将文本切片绑定到对应知识点。关联后检索结果会展示结构化的来源信息（章节名 + 知识点名）。"
          type="info" showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      <DocumentTable
        documents={documents}
        loading={loading}
        page={page}
        total={total}
        onPageChange={(p) => { setPage(p); loadDocuments(p) }}
        onViewDetail={handleViewDetail}
        onDelete={handleDelete}
      />

      <DocumentDetailDrawer
        open={detailOpen}
        selectedDoc={selectedDoc}
        detailLoading={detailLoading}
        detailChapters={detailChapters}
        kpOptions={kpOptions}
        linkingChunks={linkingChunks}
        linkChapterId={linkChapterId}
        linkChapterLoading={linkChapterLoading}
        failedPages={failedPages}
        courseId={id!}
        onClose={() => setDetailOpen(false)}
        onLinkChunk={handleLinkChunk}
        onLinkPageToKp={handleLinkPageToKp}
        onOpenExtract={handleOpenExtract}
        onLinkChapter={handleLinkChapter}
        onLinkChapterIdChange={setLinkChapterId}
        onPreviewPage={(page) => { setPreviewPage(page); setPagePreviewOpen(true) }}
        onPageImageError={(pn) => setFailedPages(prev => new Set(prev).add(pn))}
        onAskAI={(page) => triggerQuickAsk({
          sourceType: 'document',
          contextText: page.summary || `页面 ${page.page_number} 的内容`,
          prefillQuestion: `请帮我解释第 ${page.page_number} 页的核心概念`,
          metadata: { courseId: id, documentId: selectedDoc?.id, pageNumber: page.page_number },
        })}
        getLinkedKp={getLinkedKp}
      />

      <PagePreviewModal
        open={pagePreviewOpen}
        previewPage={previewPage}
        kpOptions={kpOptions}
        linkingPageId={linkingPageId}
        courseId={id!}
        docId={selectedDoc?.id || ''}
        onCancel={() => setPagePreviewOpen(false)}
        onLinkPageToKp={handleLinkPageToKp}
      />

      <ExtractKpModal
        open={extractModalOpen}
        chapters={chapters}
        extracting={extracting}
        extractedKPs={extractedKPs}
        classified={classified}
        creating={creating}
        extractChapterId={extractChapterId}
        onCancel={() => setExtractModalOpen(false)}
        onChapterChange={setExtractChapterId}
        onStartExtract={handleExtract}
        onToggleKp={handleToggleKp}
        onCreateKps={handleCreateKPs}
      />
    </div>
  )
}
