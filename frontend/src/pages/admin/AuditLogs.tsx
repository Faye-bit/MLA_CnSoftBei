/**
 * 管理员 - 操作日志页面
 * 查看全量用户操作日志, 支持按操作类型过滤
 */

import { useEffect, useState } from 'react'
import { Table, Select, Tag, Typography, message } from 'antd'
import { getAuditLogs } from '../../services/api'
import type { AuditLog } from '../../types'
import type { ColumnsType } from 'antd/es/table'

const { Title } = Typography

const actionColorMap: Record<string, string> = {
  register: 'blue',
  login: 'green',
  logout: 'default',
  update_profile: 'orange',
  upload_avatar: 'purple',
  reset_password: 'red',
  admin_update_user: 'volcano',
  admin_delete_user: 'red',
}

const actionLabelMap: Record<string, string> = {
  register: '注册',
  login: '登录',
  logout: '登出',
  update_profile: '修改资料',
  upload_avatar: '上传头像',
  reset_password: '重置密码',
  admin_update_user: '编辑用户',
  admin_delete_user: '删除用户',
}

export default function AuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [actionFilter, setActionFilter] = useState<string>('')

  const loadLogs = async () => {
    setLoading(true)
    try {
      const result = await getAuditLogs(page, pageSize, actionFilter || undefined)
      if (result) {
        setLogs(result.items)
        setTotal(result.total)
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '加载失败'
      message.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadLogs()
  }, [page, pageSize, actionFilter])

  const columns: ColumnsType<AuditLog> = [
    {
      title: '时间', dataIndex: 'created_at', key: 'created_at', width: 170,
      render: (v: string | null) => v ? new Date(v).toLocaleString('zh-CN') : '-',
    },
    {
      title: '用户', dataIndex: 'user_email', key: 'user_email',
      width: 200, ellipsis: true, render: (v: string | null) => v || '-',
    },
    {
      title: '操作', dataIndex: 'action', key: 'action', width: 110,
      render: (action: string) => (
        <Tag color={actionColorMap[action] || 'default'}>
          {actionLabelMap[action] || action}
        </Tag>
      ),
    },
    {
      title: 'IP 地址', dataIndex: 'ip_address', key: 'ip_address',
      width: 140, render: (v: string | null) => v || '-',
    },
    {
      title: '详情', dataIndex: 'details', key: 'details',
      ellipsis: true,
      render: (details: Record<string, unknown> | null) => {
        if (!details || Object.keys(details).length === 0) return '-'
        return JSON.stringify(details)
      },
    },
  ]

  return (
    <div>
      <Title level={3} style={{ marginBottom: 24 }}>操作日志</Title>

      <div style={{ marginBottom: 16 }}>
        <Select
          placeholder="按操作类型过滤"
          allowClear
          value={actionFilter || undefined}
          onChange={(value) => { setActionFilter(value || ''); setPage(1) }}
          style={{ width: 200 }}
        >
          {Object.entries(actionLabelMap).map(([value, label]) => (
            <Select.Option key={value} value={value}>{label}</Select.Option>
          ))}
        </Select>
      </div>

      <Table
        columns={columns}
        dataSource={logs}
        rowKey="id"
        loading={loading}
        pagination={{
          current: page, pageSize, total,
          showSizeChanger: true, showTotal: (t) => `共 ${t} 条日志`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps) },
        }}
      />
    </div>
  )
}
