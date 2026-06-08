/**
 * 管理员 - 用户管理页面
 * 查看、编辑、删除所有用户
 */

import { useEffect, useState } from 'react'
import { Table, Button, Input, Space, Tag, Modal, Form, Select, Switch, Popconfirm, message, Typography, Avatar } from 'antd'
import { SearchOutlined, EditOutlined, DeleteOutlined, UserOutlined } from '@ant-design/icons'
import { getUsers, getUserById, adminUpdateUser, adminDeleteUser, getAvatarUrl } from '../../services/api'
import type { UserInfo, UserAdminUpdate } from '../../types'
import type { ColumnsType } from 'antd/es/table'

const { Title } = Typography

const roleMap: Record<string, { color: string; label: string }> = {
  student: { color: 'blue', label: '学生' },
  teacher: { color: 'green', label: '教师' },
  admin: { color: 'red', label: '管理员' },
}

export default function UserManagement() {
  const [users, setUsers] = useState<UserInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<UserInfo | null>(null)
  const [saving, setSaving] = useState(false)
  const [editForm] = Form.useForm<UserAdminUpdate>()

  const loadUsers = async () => {
    setLoading(true)
    try {
      const result = await getUsers(page, pageSize, keyword || undefined)
      if (result) {
        setUsers(result.items)
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
    loadUsers()
  }, [page, pageSize])

  const handleSearch = () => {
    setPage(1)
    loadUsers()
  }

  const handleEdit = async (userId: string) => {
    try {
      const user = await getUserById(userId)
      setEditingUser(user)
      editForm.setFieldsValue({
        full_name: user.full_name || '',
        nickname: user.nickname || '',
        school: user.school || '',
        major: user.major || '',
        grade: user.grade || '',
        education_level: user.education_level || '',
        role: user.role,
        email_verified: user.email_verified,
      })
      setEditModalOpen(true)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '获取用户信息失败'
      message.error(msg)
    }
  }

  const handleSaveEdit = async () => {
    if (!editingUser) return
    try {
      const values = await editForm.validateFields()
    } catch {
      return
    }
    setSaving(true)
    try {
      const values = editForm.getFieldsValue()
      const data: UserAdminUpdate = {}
      for (const [key, value] of Object.entries(values)) {
        if (value !== undefined && value !== '') {
          (data as Record<string, unknown>)[key] = value
        }
      }
      await adminUpdateUser(editingUser.id, data)
      message.success('用户信息已更新')
      setEditModalOpen(false)
      loadUsers()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '更新失败'
      message.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (userId: string) => {
    try {
      await adminDeleteUser(userId)
      message.success('用户已删除')
      loadUsers()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '删除失败'
      message.error(msg)
    }
  }

  const columns: ColumnsType<UserInfo> = [
    {
      title: '头像', dataIndex: 'avatar', key: 'avatar', width: 60,
      render: (avatar: string | null) => (
        <Avatar src={getAvatarUrl(avatar)} icon={<UserOutlined />} size="small" />
      ),
    },
    {
      title: '用户名', dataIndex: 'username', key: 'username',
      width: 120, ellipsis: true,
    },
    {
      title: '邮箱', dataIndex: 'email', key: 'email',
      width: 200, ellipsis: true,
    },
    {
      title: '姓名', dataIndex: 'full_name', key: 'full_name',
      width: 100, ellipsis: true, render: (v: string | null) => v || '-',
    },
    {
      title: '学校', dataIndex: 'school', key: 'school',
      width: 120, ellipsis: true, render: (v: string | null) => v || '-',
    },
    {
      title: '角色', dataIndex: 'role', key: 'role', width: 80,
      render: (role: string) => {
        const info = roleMap[role] || { color: 'default', label: role }
        return <Tag color={info.color}>{info.label}</Tag>
      },
    },
    {
      title: '邮箱验证', dataIndex: 'email_verified', key: 'email_verified',
      width: 80, render: (v: boolean) => v ? '✅' : '❌',
    },
    {
      title: '注册时间', dataIndex: 'created_at', key: 'created_at',
      width: 140,
      render: (v: string | null) => v ? new Date(v).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作', key: 'actions', width: 140, fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />}
            onClick={() => handleEdit(record.id)}>编辑</Button>
          <Popconfirm
            title="确认删除此用户？"
            description="删除后无法恢复"
            onConfirm={() => handleDelete(record.id)}
            okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Title level={3} style={{ marginBottom: 24 }}>用户管理</Title>

      {/* 搜索栏 */}
      <div style={{ marginBottom: 16, display: 'flex', gap: 12 }}>
        <Input
          placeholder="搜索邮箱/用户名/姓名"
          prefix={<SearchOutlined />}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={handleSearch}
          style={{ maxWidth: 300 }}
          allowClear
        />
        <Button type="primary" onClick={handleSearch}>搜索</Button>
      </div>

      <Table
        columns={columns}
        dataSource={users}
        rowKey="id"
        loading={loading}
        scroll={{ x: 1100 }}
        pagination={{
          current: page, pageSize, total,
          showSizeChanger: true, showTotal: (t) => `共 ${t} 名用户`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps) },
        }}
      />

      {/* 编辑用户模态框 */}
      <Modal
        title={`编辑用户: ${editingUser?.username || ''}`}
        open={editModalOpen}
        onOk={handleSaveEdit}
        onCancel={() => setEditModalOpen(false)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="昵称" name="nickname"><Input placeholder="昵称" /></Form.Item>
          <Form.Item label="真实姓名" name="full_name"><Input placeholder="真实姓名" /></Form.Item>
          <Form.Item label="学校" name="school"><Input placeholder="学校/学院" /></Form.Item>
          <Form.Item label="专业" name="major"><Input placeholder="专业" /></Form.Item>
          <Form.Item label="年级" name="grade"><Input placeholder="年级" /></Form.Item>
          <Form.Item label="学历层次" name="education_level"><Input placeholder="学历层次" /></Form.Item>
          <Form.Item label="角色" name="role">
            <Select>
              <Select.Option value="student">学生</Select.Option>
              <Select.Option value="teacher">教师</Select.Option>
              <Select.Option value="admin">管理员</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="邮箱已验证" name="email_verified" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
