/**
 * JWT Token 工具函数
 * 提供不依赖外部库的 JWT 解码和过期检查功能
 * 注: 仅解码 payload 部分 (不验证签名), 用于前端判断 token 是否过期
 */

/**
 * 解码 JWT Token 的 payload 部分
 * JWT 格式: header.payload.signature (Base64Url 编码)
 * @param token - JWT 字符串
 * @returns 解码后的 payload 对象, 解析失败返回 null
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    // Base64Url 解码 payload (第二部分)
    const payload = parts[1]
    // Base64Url → Base64: 替换字符 + 补齐等号
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = atob(base64)
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

/**
 * 检查 JWT Token 是否已过期
 * 无法解析的 token 也视为过期 (保守策略)
 * @param token - JWT 字符串
 * @returns 已过期返回 true, 否则返回 false
 */
export function isTokenExpired(token: string): boolean {
  const payload = decodeJwtPayload(token) // 解码 payload
  if (!payload || !payload.exp) return true
  // exp 是秒级 UNIX 时间戳
  const now = Math.floor(Date.now() / 1000)
  return (payload.exp as number) < now
}

/**
 * 获取 Token 剩余有效时间 (秒)
 * @param token - JWT 字符串
 * @returns 剩余秒数; 已过期则返回负数; 无法解析返回 -1
 */
export function getTokenRemainingSeconds(token: string): number {
  const payload = decodeJwtPayload(token)
  if (!payload || !payload.exp) return -1
  const now = Math.floor(Date.now() / 1000)
  return (payload.exp as number) - now
}
