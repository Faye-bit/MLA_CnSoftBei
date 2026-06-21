/**
 * 密码重置页面 — 双栏布局
 * 左侧品牌展示区 + 右侧重置密码表单
 *
 * @see branding/MLA_BRAND_GUIDELINES.md
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Form, Input, Button, message, Divider } from 'antd'
import { MailOutlined, LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { sendVerificationCode, resetPassword as resetPasswordApi } from '../services/api'
import AuthLayout from '../components/auth/AuthLayout'
import { gray } from '../styles/tokens'

export default function PasswordReset() {
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const navigate = useNavigate()
  const [form] = Form.useForm()

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  const handleSendCode = useCallback(async () => {
    try { await form.validateFields(['email']) } catch { return }
    const email = form.getFieldValue('email')
    setSendingCode(true)
    try {
      await sendVerificationCode({ email, purpose: 'reset_password' })
      message.success('验证码已发送, 请查收邮件')
      setCountdown(60)
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) { clearInterval(timerRef.current!); timerRef.current = null; return 0 }
          return prev - 1
        })
      }, 1000)
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '验证码发送失败')
    } finally { setSendingCode(false) }
  }, [form])

  const handleSubmit = async (values: { email: string; verification_code: string; new_password: string }) => {
    setLoading(true)
    try {
      await resetPasswordApi(values)
      message.success('密码重置成功, 请使用新密码登录')
      navigate('/login', { replace: true })
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '密码重置失败')
    } finally { setLoading(false) }
  }

  return (
    <AuthLayout
      title="重置密码"
      subtitle="通过邮箱验证码设置新密码"
    >
      <Form form={form} onFinish={handleSubmit} size="large" layout="vertical">
        <Form.Item
          label="邮箱地址"
          name="email"
          rules={[
            { required: true, message: '请输入邮箱地址' },
            { type: 'email', message: '请输入有效的邮箱地址' },
          ]}
        >
          <Input prefix={<MailOutlined style={{ color: gray[400] }} />} placeholder="注册时使用的邮箱" />
        </Form.Item>

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

        <Form.Item
          label="新密码"
          name="new_password"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 6, max: 128, message: '密码长度 6-128 字符' },
          ]}
        >
          <Input.Password prefix={<LockOutlined style={{ color: gray[400] }} />} placeholder="设置新密码 (6位以上)" />
        </Form.Item>

        <Form.Item
          label="确认新密码"
          name="confirm_password"
          dependencies={['new_password']}
          rules={[
            { required: true, message: '请确认新密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('new_password') === value) return Promise.resolve()
                return Promise.reject(new Error('两次输入的密码不一致'))
              },
            }),
          ]}
        >
          <Input.Password prefix={<LockOutlined style={{ color: gray[400] }} />} placeholder="再次输入新密码" />
        </Form.Item>

        <Form.Item style={{ marginBottom: 12 }}>
          <Button type="primary" htmlType="submit" loading={loading} block size="large"
            style={{ height: 44, borderRadius: 8, fontSize: 15, fontWeight: 600 }}>
            重 置 密 码
          </Button>
        </Form.Item>
      </Form>

      <div style={{ textAlign: 'center' }}>
        <Link to="/login" style={{ fontSize: 13 }}>← 返回登录</Link>
      </div>
    </AuthLayout>
  )
}
