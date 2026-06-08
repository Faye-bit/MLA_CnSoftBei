/**
 * 登录页面
 * 邮箱+密码登录, 登录成功后跳转首页
 */

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Form, Input, Button, Card, message, Typography, Space } from 'antd'
import { MailOutlined, LockOutlined } from '@ant-design/icons'
import { login as loginApi } from '../services/api'
import { useAuthStore } from '../store'
import type { LoginRequest } from '../types'

const { Title, Text } = Typography

export default function Login() {
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [form] = Form.useForm<LoginRequest>()

  const handleSubmit = async (values: LoginRequest) => {
    setLoading(true)
    try {
      const result = await loginApi(values)
      setAuth(result.access_token, result.user)
      message.success('登录成功')
      navigate('/', { replace: true })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '登录失败'
      message.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
      <Card style={{ width: 420, borderRadius: 12, boxShadow: '0 8px 40px rgba(0,0,0,0.12)' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Title level={2} style={{ color: '#1677ff', marginBottom: 4 }}>MLA 多学助手</Title>
          <Text type="secondary">面向高校的个性化学习资源智能平台</Text>
        </div>

        <Form form={form} onFinish={handleSubmit} size="large" layout="vertical">
          <Form.Item
            name="email"
            rules={[
              { required: true, message: '请输入邮箱地址' },
              { type: 'email', message: '请输入有效的邮箱地址' },
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder="邮箱地址" autoComplete="email" />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 6, message: '密码至少6位' },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="登录密码" autoComplete="current-password" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              登 录
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: 'center' }}>
          <Space split={<span style={{ color: '#d9d9d9' }}>|</span>}>
            <Link to="/reset-password" style={{ fontSize: 13 }}>忘记密码?</Link>
            <Link to="/register" style={{ fontSize: 13 }}>注册新账号</Link>
          </Space>
        </div>
      </Card>
    </div>
  )
}
