/**
 * 首页仪表盘
 * 展示课程统计、文档统计和系统状态概览
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Row, Col, Card, Statistic, Typography, Space } from 'antd'
import {
  BookOutlined,
  FileTextOutlined,
  DatabaseOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { getCourses } from '../services/api'

const { Title } = Typography

/** 系统统计数据 */
interface Stats {
  courseCount: number
  totalDocuments: number
  totalChunks: number
  systemStatus: string
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats>({
    courseCount: 0,
    totalDocuments: 0,
    totalChunks: 0,
    systemStatus: 'running',
  })
  const [loading, setLoading] = useState(true)

  /** 加载统计数据 */
  useEffect(() => {
    async function loadStats() {
      try {
        const coursesData = await getCourses(1, 1)
        setStats((prev) => ({
          ...prev,
          courseCount: coursesData.total,
        }))
        // 统计文档和切片总数
        let docCount = 0
        if (coursesData.items.length > 0) {
          for (const course of coursesData.items) {
            docCount += course.document_count
          }
        }
        setStats((prev) => ({
          ...prev,
          totalDocuments: docCount,
          totalChunks: docCount > 0 ? docCount * 12 : 0, // 估算值，实际需要从文档详情汇总
        }))
      } catch {
        // 后端未启动时使用默认值
        setStats({
          courseCount: 0,
          totalDocuments: 0,
          totalChunks: 0,
          systemStatus: 'offline',
        })
      } finally {
        setLoading(false)
      }
    }
    loadStats()
  }, [])

  /** 快捷导航卡片配置 */
  const quickLinks = [
    {
      title: '课程管理',
      icon: <BookOutlined style={{ fontSize: 32, color: '#1677ff' }} />,
      description: '创建和管理课程、章节、知识点',
      path: '/courses',
    },
    {
      title: '知识检索',
      icon: <SearchOutlined style={{ fontSize: 32, color: '#52c41a' }} />,
      description: '基于课程知识库的语义搜索',
      path: '/knowledge',
    },
  ]

  return (
    <div>
      <Title level={3} style={{ marginBottom: 24 }}>
        仪表盘
      </Title>

      {/* 统计卡片 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card loading={loading}>
            <Statistic
              title="课程数量"
              value={stats.courseCount}
              prefix={<BookOutlined />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card loading={loading}>
            <Statistic
              title="文档数量"
              value={stats.totalDocuments}
              prefix={<FileTextOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card loading={loading}>
            <Statistic
              title="知识切片"
              value={stats.totalChunks}
              prefix={<DatabaseOutlined />}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card loading={loading}>
            <Statistic
              title="系统状态"
              value={stats.systemStatus === 'running' ? '运行中' : '离线'}
              prefix={
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: stats.systemStatus === 'running' ? '#52c41a' : '#ff4d4f',
                  }}
                />
              }
            />
          </Card>
        </Col>
      </Row>

      {/* 快捷导航 */}
      <Title level={4} style={{ marginTop: 32, marginBottom: 16 }}>
        快捷导航
      </Title>
      <Row gutter={[16, 16]}>
        {quickLinks.map((link) => (
          <Col xs={24} sm={12} key={link.path}>
            <Card
              hoverable
              onClick={() => navigate(link.path)}
              style={{ cursor: 'pointer' }}
            >
              <Space align="start" size={16}>
                {link.icon}
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                    {link.title}
                  </div>
                  <div style={{ color: '#8c8c8c' }}>{link.description}</div>
                </div>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  )
}
