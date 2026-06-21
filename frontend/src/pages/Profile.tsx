/**
 * 个人中心页面
 * 头像上传 + 个人资料编辑
 *
 * 设计规范 (MLA Brand v2.0):
 * - 使用品牌 token 替代硬编码色值
 * - 禁止 Emoji
 */

import { useState } from 'react'
import { Card, Form, Input, Button, Avatar, Upload, message, Typography, Descriptions, Spin } from 'antd'
import {
  UserOutlined, UploadOutlined, MailOutlined, ClockCircleOutlined,
  SafetyCertificateOutlined, CheckCircleOutlined, CloseCircleOutlined,
} from '@ant-design/icons'
import { updateProfile, uploadAvatar, getAvatarUrl } from '../services/api'
import { useAuthStore } from '../store'
import type { UserProfileUpdate } from '../types'
import type { RcFile } from 'antd/es/upload'
import { blue, gray } from '../styles/tokens'

const { Title } = Typography

export default function Profile() {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [form] = Form.useForm<UserProfileUpdate>()

  if (!user) {
    return <Spin size="large" style={{ display: 'block', marginTop: 100 }} />
  }

  const initialValues: UserProfileUpdate = {
    full_name: user.full_name || '',
    nickname: user.nickname || '',
    school: user.school || '',
    major: user.major || '',
    grade: user.grade || '',
    education_level: user.education_level || '',
  }

  const handleSaveProfile = async () => {
    try {
      await form.validateFields()
    } catch {
      return
    }
    setSaving(true)
    try {
      const values = form.getFieldsValue()
      const data: UserProfileUpdate = {}
      for (const [key, value] of Object.entries(values)) {
        if (value !== undefined && value !== '') {
          (data as Record<string, string>)[key] = value
        }
      }
      const updated = await updateProfile(data)
      setUser(updated)
      message.success('资料更新成功')
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '更新失败'
      message.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const handleBeforeUpload = async (file: RcFile) => {
    setUploading(true)
    try {
      const result = await uploadAvatar(file)
      setUser({ ...user, avatar: result.avatar_url })
      message.success('头像上传成功')
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '头像上传失败'
      message.error(msg)
    } finally {
      setUploading(false)
    }
    return false
  }

  const avatarUrl = getAvatarUrl(user.avatar)

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <Title level={3} style={{ marginBottom: 24 }}>个人中心</Title>

      {/* 头像和基本信息 */}
      <Card style={{ marginBottom: 24, borderRadius: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <Upload
            showUploadList={false}
            accept="image/*"
            beforeUpload={handleBeforeUpload}
          >
            <div style={{ position: 'relative', cursor: 'pointer' }}>
              <Avatar src={avatarUrl} icon={<UserOutlined />} size={80}
                style={{ backgroundColor: blue[500] }} />
              <div style={{
                position: 'absolute', bottom: 0, right: 0,
                background: blue[500], color: '#FFFFFF',
                borderRadius: '50%', width: 26, height: 26,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '2px solid #FFFFFF',
              }}>
                <UploadOutlined style={{ fontSize: 12 }} />
              </div>
            </div>
          </Upload>
          {uploading && <Spin size="small" />}
          <div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>
              {user.nickname || user.username}
            </div>
            <div style={{ color: gray[400], marginTop: 4 }}>
              {user.role === 'admin' ? '管理员' : user.role === 'teacher' ? '教师' : '学生'}
            </div>
          </div>
        </div>
      </Card>

      {/* 账号信息 (只读) */}
      <Card title="账号信息" style={{ marginBottom: 24, borderRadius: 8 }}>
        <Descriptions column={2} size="small">
          <Descriptions.Item label={<><MailOutlined /> 邮箱</>}>{user.email}</Descriptions.Item>
          <Descriptions.Item label={<><UserOutlined /> 用户名</>}>{user.username}</Descriptions.Item>
          <Descriptions.Item label={<><SafetyCertificateOutlined /> 邮箱验证</>}>
            {user.email_verified
              ? <span style={{ color: 'green' }}><CheckCircleOutlined /> 已验证</span>
              : <span style={{ color: 'red' }}><CloseCircleOutlined /> 未验证</span>}
          </Descriptions.Item>
          <Descriptions.Item label={<><ClockCircleOutlined /> 注册时间</>}>
            {user.created_at ? new Date(user.created_at).toLocaleDateString('zh-CN') : '-'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 可编辑资料 */}
      <Card title="编辑资料" style={{ borderRadius: 8 }}>
        <Form form={form} layout="vertical" initialValues={initialValues}>
          <Form.Item
            label="昵称"
            name="nickname"
            rules={[{ max: 50, message: '昵称不超过50字符' }]}
          >
            <Input placeholder="设置显示昵称" />
          </Form.Item>

          <Form.Item
            label="真实姓名"
            name="full_name"
            rules={[{ max: 50, message: '姓名不超过50字符' }]}
          >
            <Input placeholder="真实姓名" />
          </Form.Item>

          <Form.Item
            label="学校/学院"
            name="school"
            rules={[{ max: 100, message: '不超过100字符' }]}
          >
            <Input placeholder="例如: 清华大学" />
          </Form.Item>

          <Form.Item
            label="专业"
            name="major"
            rules={[{ max: 100, message: '不超过100字符' }]}
          >
            <Input placeholder="例如: 计算机科学与技术" />
          </Form.Item>

          <Form.Item
            label="年级"
            name="grade"
            rules={[{ max: 20, message: '不超过20字符' }]}
          >
            <Input placeholder="例如: 2024级" />
          </Form.Item>

          <Form.Item
            label="学历层次"
            name="education_level"
            rules={[{ max: 20, message: '不超过20字符' }]}
          >
            <Input placeholder="例如: 本科 / 硕士 / 博士" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" onClick={handleSaveProfile} loading={saving}>
              保存修改
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
