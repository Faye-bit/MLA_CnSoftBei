/**
 * 系统设置页
 * 用户可在此配置自己的 LLM 和 Embedding API Key, 修改后即时生效
 */

import { useEffect, useState } from 'react'
import {
  Typography,
  Card,
  Form,
  Input,
  Button,
  Space,
  message,
  Spin,
  Alert,
  Tag,
} from 'antd'
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons'
import { getApiConfig, updateApiConfig } from '../services/api'

const { Title, Text } = Typography

/** 配置项定义 */
interface ConfigItem {
  key: string
  label: string
  value: string
  default_value: string
}

export default function Settings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  /** 加载当前配置 */
  async function loadConfig() {
    setLoading(true)
    try {
      const data = await getApiConfig()
      const formValues: Record<string, string> = {}
      data.items.forEach((item: ConfigItem) => {
        formValues[item.key] = item.value
      })
      form.setFieldsValue(formValues)
    } catch (err) {
      message.error('加载配置失败: ' + (err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadConfig()
  }, [])

  /** 保存配置 */
  async function handleSave() {
    try {
      const values = await form.validateFields()
      setSaving(true)
      // 只提交有值的字段
      const payload: Record<string, string> = {}
      for (const [key, value] of Object.entries(values)) {
        if (value) payload[key] = value as string
      }
      await updateApiConfig(payload)
      message.success('配置已保存，即时生效')
    } catch (err) {
      if ((err as { errorFields?: unknown[] }).errorFields) return
      message.error('保存失败: ' + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div>
      <Title level={3} style={{ marginBottom: 24 }}>
        系统设置
      </Title>

      <Alert
        message="在此配置您自己的大模型 API Key，配置后即时生效，无需重启服务。不填则使用系统默认值。"
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Form form={form} layout="vertical">
        {/* LLM 配置 */}
        <Card
          title={
            <Space>
              <Tag color="blue">LLM</Tag>
              <span>大语言模型配置</span>
              <Text type="secondary" style={{ fontSize: 12 }}>
                (对话、资源生成等)
              </Text>
            </Space>
          }
          style={{ marginBottom: 24 }}
        >
          <Form.Item name="llm_api_key" label="API Key">
            <Input.Password placeholder="sk-your-llm-api-key" />
          </Form.Item>
          <Form.Item name="llm_api_base" label="API 地址">
            <Input placeholder="https://api.deepseek.com" />
          </Form.Item>
          <Form.Item name="llm_model" label="模型名称">
            <Input placeholder="deepseek-chat" />
          </Form.Item>
        </Card>

        {/* Embedding 配置 */}
        <Card
          title={
            <Space>
              <Tag color="green">Embedding</Tag>
              <span>嵌入模型配置</span>
              <Text type="secondary" style={{ fontSize: 12 }}>
                (文档向量化、知识检索)
              </Text>
            </Space>
          }
          style={{ marginBottom: 24 }}
        >
          <Form.Item name="embedding_api_key" label="API Key">
            <Input.Password placeholder="sk-your-embedding-api-key" />
          </Form.Item>
          <Form.Item name="embedding_api_base" label="API 地址">
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item name="embedding_model" label="模型名称">
            <Input placeholder="text-embedding-3-small" />
          </Form.Item>
        </Card>

        <Space>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={saving}
            size="large"
          >
            保存配置
          </Button>
          <Button icon={<ReloadOutlined />} onClick={loadConfig}>
            重置
          </Button>
        </Space>
      </Form>
    </div>
  )
}
