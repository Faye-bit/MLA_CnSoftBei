/**
 * 雷达图维度追踪卡片
 */

import { useState, useEffect } from 'react'
import { Card, Typography, Progress, Tag, Spin, Empty, Space, Collapse } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, MinusCircleOutlined } from '@ant-design/icons'
import { BarChart, Bar, XAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { useAuthStore } from '../../store'
import { blue, gray, semantic } from '../../styles/tokens'
import ExerciseViewer from '../learning/ExerciseViewer'

const { Text } = Typography

interface DetailItem { label: string; value: number; max?: number; unit?: string; date?: string
  active?: boolean; status?: string; doc_count?: number; session_count?: number
  stage_count?: number; knowledge_points?: string[]; type?: string }

interface QuestionItem { id: string; text: string; answered: boolean; correct: boolean | null; score: number | null }
interface ExerciseItem { id: string; title: string; date: string; questions: QuestionItem[]; content?: string; progress?: Record<string, unknown> }
interface StageItem { title: string; question_count: number; exercises: ExerciseItem[] }
interface CourseItem { name: string; stages: StageItem[] }
interface WeakPoint { title: string; exercise_title: string; date: string }
interface PracticeDetail {
  weekly_stats?: Array<{ day: string; count: number; wrong?: number }>
  courses?: CourseItem[]; weak_points?: WeakPoint[]; detail_items?: DetailItem[]
}
type DimensionDataType = { key: string; label: string; score: number
  detail_items: (DetailItem | PracticeDetail)[]; suggestion: string }

const LABEL_MAP: Record<string, string> = {
  subject_balance: '学科均衡度', learning_discipline: '学习自律度',
  active_learning: '主动学习意愿', practice_intensity: '刷题巩固强度',
  review_habit: '知识留存度', focus_level: '学习沉浸度',
}
const WEEKDAY_CN: Record<string, string> = { Mon:'一', Tue:'二', Wed:'三', Thu:'四', Fri:'五', Sat:'六', Sun:'日' }

interface Props { dimensionKey?: string }

export default function DimensionDetail({ dimensionKey = 'practice_intensity' }: Props) {
  const [data, setData] = useState<DimensionDataType | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!dimensionKey) return
    setLoading(true)
    setData(null) // 清空旧数据, 避免渲染未匹配
    const token = useAuthStore.getState().token
    fetch(`http://localhost:8000/api/v1/profile/radar/${dimensionKey}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json()).then(r => { if (r.code === 0) setData(r.data); else setData(null) })
      .catch(() => setData(null)).finally(() => setLoading(false))
  }, [dimensionKey])

  return (
    <Card size="small"
      title={<Space><span>{LABEL_MAP[dimensionKey] || dimensionKey}</span>
        {data?.score != null && <Tag color={data.score >= 8 ? 'green' : data.score >= 5 ? 'blue' : 'orange'}>{data.score}/10</Tag>}
      </Space>}
      style={{ height: '100%', overflow: 'auto' }}>
      {loading ? <Spin style={{ display:'block', textAlign:'center', padding:40 }} />
      : !data ? <Empty description="选择维度查看详情" />
      : dimensionKey === 'practice_intensity' ? <PracticeView detail={data} />
      : Array.isArray(data.detail_items) ? <GenericView items={data.detail_items as DetailItem[]} suggestion={data.suggestion} />
      : <Empty description="暂无数据" />}
    </Card>
  )
}

function GenericView({ items, suggestion }: { items: DetailItem[]; suggestion: string }) {
  return <div>
    {items?.map((item, i) => {
      if (typeof item.active === 'boolean') return <div key={i} style={{ display:'inline-block', width:12,height:12,margin:2,borderRadius:2,background:item.active?'#1677ff':'#f0f0f0'}} title={`${item.date}:${item.active?'活跃':'未活跃'}`} />
      if (item.max) {
        const pct = Math.min(Math.round((item.value/item.max)*100),100)
        return <div key={i} style={{ marginBottom:12 }}><div style={{ display:'flex',justifyContent:'space-between' }}><Text style={{ fontSize:13 }}>{item.label}</Text><Text type="secondary" style={{ fontSize:12 }}>{item.value}{item.unit||''} / {item.max}{item.unit||''}</Text></div><Progress percent={pct} size="small" showInfo={false} strokeColor={pct>=80?'#52c41a':pct>=50?'#1677ff':'#faad14'} /></div>
      }
      return <div key={i} style={{ marginBottom:8,padding:'6px 8px',background:'#fafafa',borderRadius:6 }}><div style={{ display:'flex',justifyContent:'space-between' }}><Text style={{ fontSize:13 }}>{item.label}</Text><Space size={4}>{item.date&&<Text type="secondary" style={{ fontSize:11 }}>{item.date}</Text>}{item.status&&<Tag color={item.status==='completed'?'green':'blue'} style={{ fontSize:10 }}>{item.status==='completed'?'完成':item.status}</Tag>}</Space></div>{item.knowledge_points?.map((kp,j)=><Tag key={j} style={{ fontSize:10,marginTop:2 }}>{kp}</Tag>)}</div>
    })}
    {suggestion && <SuggestionBox text={suggestion} />}
  </div>
}

function SuggestionBox({ text }: { text: string }) {
  return <div style={{ marginTop:12,padding:'10px 12px',background:'linear-gradient(135deg,#f0f5ff,#e6f7ff)',borderRadius:8,border:'1px solid #d6e4ff' }}>
    <Text strong style={{ fontSize:12,color:'#1677ff' }}>💡 建议</Text><br /><Text style={{ fontSize:13 }}>{text}</Text>
  </div>
}

function PracticeView({ detail }: { detail: DimensionDataType }) {
  const pd = detail.detail_items as unknown as PracticeDetail
  const baseItems = pd.detail_items || []

  return <div>
    {/* 左图表 + 右统计 */}
    <div style={{ display:'flex', gap:12, marginBottom:16 }}>
      <div style={{ flex:1, minHeight:160 }}>
        <Text strong style={{ fontSize:12,display:'block',marginBottom:4 }}>📊 近 7 天做题 (绿=已答,红=答错)</Text>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={(pd.weekly_stats||[]).map(d=>({ day:WEEKDAY_CN[d.day]||d.day, '已答':d.count, '答错':d.wrong||0 }))} margin={{ top:4,right:4,bottom:0,left:-20 }}>
            <XAxis dataKey="day" tick={{ fontSize:10 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ borderRadius:8,border:'1px solid #e8e8e8' }} />
            <Bar dataKey="已答" fill={semantic.success} radius={[4,4,0,0]} maxBarSize={20} />
            <Bar dataKey="答错" fill={semantic.danger} radius={[4,4,0,0]} maxBarSize={20} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ width:100,display:'flex',flexDirection:'column',justifyContent:'center',gap:8 }}>
        {baseItems.map((item,i) => (
          <div key={i} style={{ textAlign:'center',padding:'8px 4px',background:'#fafafa',borderRadius:8 }}>
            <div style={{ fontSize:20,fontWeight:700,color:blue[500] }}>{item.value}<span style={{ fontSize:11,fontWeight:400,color:'#888' }}>{item.unit}</span></div>
            <div style={{ fontSize:11,color:'#666' }}>{item.label}</div>
          </div>
        ))}
      </div>
    </div>

    {/* 课程→阶段→练习→题目 */}
    {pd.courses && pd.courses.length > 0 && (
      <div style={{ marginBottom:16 }}>
        <Text strong style={{ fontSize:13,display:'block',marginBottom:8 }}>📁 按课程/阶段分类</Text>
        <Collapse size="small" ghost items={pd.courses.map((course,ci)=>({
          key:'c'+ci,
          label: <Space><Text style={{ fontSize:13,fontWeight:500 }}>{course.name}</Text><Tag>{course.stages?.reduce((s,st)=>s+st.question_count,0)||0}题</Tag></Space>,
          children: <Collapse size="small" ghost items={(course.stages||[]).map((stage,si)=>({
            key:'s'+si,
            label: <Space><Text style={{ fontSize:13 }}>{stage.title}</Text><Tag style={{ fontSize:10 }}>{stage.question_count}题</Tag></Space>,
            children: (stage.exercises||[]).map((ex,ei) => (
              <Card key={ei} size="small" style={{ marginBottom:8,borderRadius:8,background:'#fafafa' }}
                title={<Space><Text style={{ fontSize:12 }}>{ex.title}</Text><Text type="secondary" style={{ fontSize:10 }}>{ex.date}</Text></Space>}>
                {ex.questions?.slice(0,10).map((q,qi) => (
                  <div key={qi} style={{ display:'flex',alignItems:'center',gap:6,fontSize:12,marginBottom:4 }}>
                    {q.answered ? (q.correct ? <CheckCircleOutlined style={{ color:semantic.success }} /> : <CloseCircleOutlined style={{ color:semantic.danger }} />) : <MinusCircleOutlined style={{ color:'#d9d9d9' }} />}
                    <Text style={{ flex:1 }} ellipsis={{ tooltip:true }}>{q.text}</Text>
                    {q.score != null && <Tag color={q.score>=8?'green':'orange'} style={{ fontSize:10,margin:0 }}>{q.score}分</Tag>}
                  </div>
                ))}
                {/* 完整题目用 ExerciseViewer readOnly */}
                {ex.content && ex.progress && (
                  <Collapse size="small" ghost items={[{
                    key:'exercise'+ei,
                    label: <Text style={{ fontSize:11,color:blue[500],cursor:'pointer' }}>📋 查看完整题目</Text>,
                    children: <ExerciseViewer content={ex.content} resourceId={ex.id}
                      resourceMetadata={{ exercise_progress: ex.progress }} readOnly />
                  }]} />
                )}
              </Card>
            )),
          }))} />
        }))} />
      </div>
    )}

    {/* 薄弱知识点 */}
    {pd.weak_points && pd.weak_points.length > 0 && (
      <div style={{ marginBottom:16 }}>
        <Text strong style={{ fontSize:13,display:'block',marginBottom:6 }}>🔍 薄弱知识点 (需巩固)</Text>
        {pd.weak_points.map((wp,i)=><div key={i} style={{ padding:'6px 8px',marginBottom:4,background:'#fff7e6',borderRadius:6,borderLeft:'3px solid #faad14' }}><Text style={{ fontSize:12 }}>{wp.title}</Text><div style={{ fontSize:10,color:'#888',marginTop:2 }}>{wp.exercise_title} · {wp.date}</div></div>)}
      </div>
    )}

    {detail.suggestion && <SuggestionBox text={detail.suggestion} />}
  </div>
}
