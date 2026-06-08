/**
 * 密码重置页面
 * 邮箱验证码验证后重置密码
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Form, Input, Button, Card, message, Typography, Divider, Steps } from 'antd'
import { MailOutlined, LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { sendVerificationCode, resetPassword as resetPasswordApi } from '../services/api'

const { Title, Text } = Typography

export default function PasswordReset() {
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const navigate = useNavigate()
  const [form] = Form.useForm()

  // 组件卸载时清除定时器, 防止内存泄漏
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const handleSendCode = useCallback(async () => {
    try {
      await form.validateFields(['email'])
    } catch {
      return
    }
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
      const msg = error instanceof Error ? error.message : '验证码发送失败'
      message.error(msg)
    } finally {
      setSendingCode(false)
    }
  }, [form])

  const handleSubmit = async (values: { email: string; verification_code: string; new_password: string }) => {
    setLoading(true)
    try {
      await resetPasswordApi(values)
      message.success('密码重置成功, 请使用新密码登录')
      navigate('/login', { replace: true })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '密码重置失败'
      message.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
      <Card style={{ width: 420, borderRadius: 12, boxShadow: '0 8px 40px rgba(0,0,0,0.12)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title level={2} style={{ color: '#1677ff', marginBottom: 4 }}>重置密码</Title>
          <Text type="secondary">通过邮箱验证码设置新密码</Text>
        </div>

        <Form form={form} onFinish={handleSubmit} size="large" layout="vertical">
          <Form.Item
            label="邮箱地址"
            name="email"
            rules={[
              { required: true, message: '请输入邮箱地址' },
              { type: 'email', message: '请输入有效的邮箱地址' },
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder="注册时使用的邮箱" />
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
                <Input prefix={<SafetyCertificateOutlined />} placeholder="6位验证码" maxLength={6} style={{ flex: 1 }} />
              </Form.Item>
              <Button onClick={handleSendCode} loading={sendingCode} disabled={countdown > 0}
                style={{ minWidth: 130 }}>
                {countdown > 0 ? `${countdown}s 后重试` : '发送验证码'}
              </Button>
            </div>
          </Form.Item>

          <Divider style={{ margin: '16px 0' }} />

          <Form.Item
            label="新密码"
            name="new_password"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, max: 128, message: '密码长度 6-128 字符' },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="设置新密码 (6位以上)" />
          </Form.Item>

          <Form.Item
            label="确认新密码"
            name="confirm_password"
            dependencies={['new_password']}
            rules={[
              { required: true, message: '请确认新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('new_password') === value) {
                    return Promise.resolve()
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'))
                },
              }),
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="再次输入新密码" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              重 置 密 码
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: 'center' }}>
          <Link to="/login" style={{ fontSize: 13 }}>← 返回登录</Link>
        </div>
      </Card>
    </div>
  )
}
