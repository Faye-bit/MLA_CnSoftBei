/**
 * 注册页面 — 双栏布局
 * 左侧品牌展示区 + 右侧注册表单
 * 表单较长, 右侧容器 overflow:auto 独立滚动
 *
 * @see branding/MLA_BRAND_GUIDELINES.md
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Form, Input, Button, message, Typography, Divider } from 'antd'
import {
  MailOutlined, LockOutlined, UserOutlined, SafetyCertificateOutlined,
} from '@ant-design/icons'
import { sendVerificationCode, register as registerApi, login as loginApi } from '../services/api'
import { useAuthStore } from '../store'
import type { RegisterRequest } from '../types'
import AuthLayout from '../components/auth/AuthLayout'
import { gray } from '../styles/tokens'

const { Text } = Typography

export default function Register() {
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [form] = Form.useForm<RegisterRequest>()

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  const handleSendCode = useCallback(async () => {
    try { await form.validateFields(['email']) } catch { return }
    const email = form.getFieldValue('email')
    setSendingCode(true)
    try {
      await sendVerificationCode({ email, purpose: 'register' })
      message.success('验证码已发送, 请查收邮件')
      setCountdown(60)
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null } return 0 }
          return prev - 1
        })
      }, 1000)
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '验证码发送失败')
    } finally { setSendingCode(false) }
  }, [form])

  const handleSubmit = async (values: RegisterRequest) => {
    setLoading(true)
    try {
      await registerApi(values)
      const loginResult = await loginApi({ email: values.email, password: values.password })
      setAuth(loginResult.access_token, loginResult.user)
      message.success('注册成功! 欢迎使用 MLA 智学引擎')
      navigate('/', { replace: true })
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '注册失败')
    } finally { setLoading(false) }
  }

  return (
    <AuthLayout
      title="创建账号"
      subtitle="加入 MLA 智学引擎，开启个性化学习之旅"
    >
      <Form form={form} onFinish={handleSubmit} size="large" layout="vertical">

        {/* ── 邮箱 ── */}
        <Form.Item
          label="邮箱地址"
          name="email"
          rules={[
            { required: true, message: '请输入邮箱地址' },
            { type: 'email', message: '请输入有效的邮箱地址' },
          ]}
        >
          <Input prefix={<MailOutlined style={{ color: gray[400] }} />} placeholder="your@qq.com" />
        </Form.Item>

        {/* ── 验证码 ── */}
        <Form.Item label="邮箱验证码" required>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item
              noStyle
              name="verification_code"
              rules={[
                { required: true, message: '请输入验证码' },
                { len: 6, message: '验证码为6位数字' },
              ]}
            >
              <Input
                prefix={<SafetyCertificateOutlined style={{ color: gray[400] }} />}
                placeholder="6位验证码" maxLength={6} autoComplete="off"
                style={{ flex: 1 }}
              />
            </Form.Item>
            <Button onClick={handleSendCode} loading={sendingCode} disabled={countdown > 0}
              style={{ minWidth: 130, height: 40 }}>
              {countdown > 0 ? `${countdown}s 后重试` : '发送验证码'}
            </Button>
          </div>
        </Form.Item>

        <Divider style={{ margin: '20px 0' }} />

        {/* ── 用户名 ── */}
        <Form.Item
          label="用户名"
          name="username"
          rules={[
            { required: true, message: '请设置用户名' },
            { min: 3, max: 50, message: '用户名长度 3-50 字符' },
          ]}
        >
          <Input prefix={<UserOutlined style={{ color: gray[400] }} />} placeholder="用于登录和展示的用户名" />
        </Form.Item>

        {/* ── 密码 ── */}
        <Form.Item
          label="登录密码"
          name="password"
          rules={[
            { required: true, message: '请设置密码' },
            { min: 6, max: 128, message: '密码长度 6-128 字符' },
          ]}
        >
          <Input.Password prefix={<LockOutlined style={{ color: gray[400] }} />} placeholder="6位以上密码" />
        </Form.Item>

        {/* ── 确认密码 ── */}
        <Form.Item
          label="确认密码"
          name="confirm_password"
          dependencies={['password']}
          rules={[
            { required: true, message: '请确认密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) return Promise.resolve()
                return Promise.reject(new Error('两次输入的密码不一致'))
              },
            }),
          ]}
        >
          <Input.Password prefix={<LockOutlined style={{ color: gray[400] }} />} placeholder="再次输入密码" />
        </Form.Item>

        {/* ── 提交 ── */}
        <Form.Item style={{ marginBottom: 12, marginTop: 8 }}>
          <Button type="primary" htmlType="submit" loading={loading} block size="large"
            style={{ height: 44, borderRadius: 8, fontSize: 15, fontWeight: 600 }}>
            注 册
          </Button>
        </Form.Item>
      </Form>

      <div style={{ textAlign: 'center', paddingBottom: 24 }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          已有账号? <Link to="/login">去登录</Link>
        </Text>
      </div>
    </AuthLayout>
  )
}
