/**
 * 登录页面 — 双栏布局
 * 左侧品牌展示区 + 右侧登录表单
 *
 * @see branding/MLA_BRAND_GUIDELINES.md
 */

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Form, Input, Button, message, Space } from 'antd'
import { MailOutlined, LockOutlined } from '@ant-design/icons'
import { login as loginApi } from '../services/api'
import { useAuthStore } from '../store'
import type { LoginRequest } from '../types'
import AuthLayout from '../components/auth/AuthLayout'
import { gray } from '../styles/tokens'

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
    <AuthLayout
      title="登录"
      subtitle="欢迎回来，请登录你的 MLA 账号"
    >
      <Form form={form} onFinish={handleSubmit} size="large" layout="vertical">
        <Form.Item
          name="email"
          rules={[
            { required: true, message: '请输入邮箱地址' },
            { type: 'email', message: '请输入有效的邮箱地址' },
          ]}
        >
          <Input
            prefix={<MailOutlined style={{ color: gray[400] }} />}
            placeholder="邮箱地址"
            autoComplete="email"
          />
        </Form.Item>

        <Form.Item
          name="password"
          rules={[
            { required: true, message: '请输入密码' },
            { min: 6, message: '密码至少6位' },
          ]}
        >
          <Input.Password
            prefix={<LockOutlined style={{ color: gray[400] }} />}
            placeholder="登录密码"
            autoComplete="current-password"
          />
        </Form.Item>

        <Form.Item style={{ marginBottom: 12 }}>
          <Button type="primary" htmlType="submit" loading={loading} block size="large"
            style={{ height: 44, borderRadius: 8, fontSize: 15, fontWeight: 600 }}>
            登 录
          </Button>
        </Form.Item>
      </Form>

      <div style={{ textAlign: 'center' }}>
        <Space split={<span style={{ color: gray[300] }}>|</span>}>
          <Link to="/reset-password" style={{ fontSize: 13 }}>忘记密码?</Link>
          <Link to="/register" style={{ fontSize: 13 }}>注册新账号</Link>
        </Space>
      </div>
    </AuthLayout>
  )
}
