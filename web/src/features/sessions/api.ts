import { request } from '../../shared/api/client'
import { parseSession, parseSessions } from './protocol'

export async function getSessions() {
  const response = await request('/sessions')
  return parseSessions(await response.json())
}

export async function createSession(size: { cols: number; rows: number }) {
  const response = await request('/session', 'POST', size)
  const info = parseSession(await response.json())
  if (!info) throw new Error('无效终端信息')
  return info
}
