/**
 * 注册页面
 * 邮箱验证码 → 填写信息 → 注册成功 → 自动登录
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Form, Input, Button, Card, message, Typography, Radio, Divider } from 'antd'
import { MailOutlined, LockOutlined, UserOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { sendVerificationCode, register as registerApi, login as loginApi } from '../services/api'
import { useAuthStore } from '../store'
import type { RegisterRequest } from '../types'

const { Title, Text } = Typography

export default function Register() {
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [form] = Form.useForm<RegisterRequest>()

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
      await sendVerificationCode({ email, purpose: 'register' })
      message.success('验证码已发送, 请查收邮件')
      // 开始 60 秒倒计时, 用 ref 存储 timer ID 以便卸载时清理
      setCountdown(60)
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
            return 0
          }
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

  const handleSubmit = async (values: RegisterRequest) => {
    setLoading(true)
    try {
      // 注册
      await registerApi(values)
      // 自动登录
      const loginResult = await loginApi({ email: values.email, password: values.password })
      setAuth(loginResult.access_token, loginResult.user)
      message.success('注册成功! 欢迎使用 MLA 多学助手')
      navigate('/', { replace: true })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '注册失败'
      message.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center py-8" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
      <Card style={{ width: 480, borderRadius: 12, boxShadow: '0 8px 40px rgba(0,0,0,0.12)', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title level={2} style={{ color: '#1677ff', marginBottom: 4 }}>创建账号</Title>
          <Text type="secondary">加入 MLA 多学助手，开启个性化学习之旅</Text>
        </div>

        <Form form={form} onFinish={handleSubmit} size="large" layout="vertical"
          initialValues={{ role: 'student' }}>
          {/* 邮箱 + 验证码 */}
          <Form.Item
            label="邮箱地址"
            name="email"
            rules={[
              { required: true, message: '请输入邮箱地址' },
              { type: 'email', message: '请输入有效的邮箱地址' },
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder="your@qq.com" />
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

          {/* 基本信息 */}
          <Form.Item
            label="用户名"
            name="username"
            rules={[
              { required: true, message: '请设置用户名' },
              { min: 3, max: 50, message: '用户名长度 3-50 字符' },
            ]}
          >
            <Input prefix={<UserOutlined />} placeholder="用于登录和展示的用户名" />
          </Form.Item>

          <Form.Item
            label="登录密码"
            name="password"
            rules={[
              { required: true, message: '请设置密码' },
              { min: 6, max: 128, message: '密码长度 6-128 字符' },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="6位以上密码" />
          </Form.Item>

          <Form.Item
            label="确认密码"
            name="confirm_password"
            dependencies={['password']}
            rules={[
              { required: true, message: '请确认密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve()
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'))
                },
              }),
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="再次输入密码" />
          </Form.Item>

          <Form.Item
            label="真实姓名"
            name="full_name"
            rules={[{ max: 50, message: '姓名不超过50字符' }]}
          >
            <Input placeholder="选填" />
          </Form.Item>

          {/* 角色 */}
          <Form.Item
            label="身份角色"
            name="role"
            rules={[{ required: true, message: '请选择身份角色' }]}
          >
            <Radio.Group>
              <Radio.Button value="student">🎓 学生</Radio.Button>
              <Radio.Button value="teacher">📚 教师</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              注 册
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: 'center' }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            已有账号? <Link to="/login">去登录</Link>
          </Text>
        </div>
      </Card>
    </div>
  )
}
