/**
 * 管理员路由守卫
 * 非管理员访问时显示 403 禁止页面
 */

import { Outlet } from 'react-router-dom'
import { useAuthStore } from '../../store'
import { Result, Button } from 'antd'

export default function AdminRoute() {
  const isAdmin = useAuthStore((s) => s.isAdmin)

  if (!isAdmin) {
    return (
      <Result
        status="403"
        title="403"
        subTitle="抱歉，您没有权限访问此页面，需要管理员权限。"
        extra={
          <Button type="primary" onClick={() => window.history.back()}>
            返回上一页
          </Button>
        }
      />
    )
  }

  return <Outlet />
}
