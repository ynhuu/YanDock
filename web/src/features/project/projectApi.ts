import { request } from '../../shared/api/client'

export type ProjectFile = {
  name: string
  path: string
  isDir: boolean
  size: number
}

export type ProjectChange = {
  path: string
  status: string
  label: string
  additions: number
  deletions: number
  statsComplete: boolean
}

export type ProjectFiles = {
  files: ProjectFile[]
  truncated: boolean
}

export type ProjectChanges = {
  files: ProjectChange[]
  truncated: boolean
  additions: number
  deletions: number
  statsComplete: boolean
}

export type ProjectHistoryCommit = {
  hash: string
  shortHash: string
  parents: string[]
  subject: string
  authorName: string
  authoredAt: string
}

export type ProjectHistoryRef = {
  name: string
  kind: 'branch' | 'remote' | 'tag'
  commit: string
}

export type ProjectHistory = {
  commits: ProjectHistoryCommit[]
  refs: ProjectHistoryRef[]
  truncated: boolean
  refsTruncated: boolean
}

export const projectHistoryPageSize = 15

export type ProjectCommitFile = {
  path: string
  status: string
  label: string
}

export type ProjectCommit = ProjectHistoryCommit & {
  files: ProjectCommitFile[]
  filesTruncated: boolean
}

export type ProjectDiff = {
  patch: string
  oldContent: string
  newContent: string
  complete: boolean
  binary: boolean
}

export type SessionDirectory = { id: string; name: string }
export type ProjectDownloadProgress = { loaded: number; total: number }
export const maxProjectDownloadBytes = 128 * 1024 * 1024
export type ProjectDownloadStatus = {
  id: string
  path: string
  sessionId: string | null
  loaded: number
  total: number | null
  completed: boolean
}

function pathQuery(sessionId: string | null, path = '', showHidden = false) {
  const params = new URLSearchParams()
  if (sessionId) params.set('session', sessionId)
  if (path) params.set('path', path)
  if (showHidden) params.set('hidden', '1')
  const query = params.toString()
  return query ? `?${query}` : ''
}

export async function getProjectFiles(
  sessionId: string | null,
  path: string,
  showHidden: boolean,
  signal?: AbortSignal,
): Promise<ProjectFiles> {
  const response = await request(
    `/project/files${pathQuery(sessionId, path, showHidden)}`,
    'GET',
    undefined,
    signal,
  )
  return (await response.json()) as ProjectFiles
}

export async function getProjectChanges(
  sessionId: string | null,
  showHidden: boolean,
  signal?: AbortSignal,
): Promise<ProjectChanges> {
  const response = await request(
    `/project/changes${pathQuery(sessionId, '', showHidden)}`,
    'GET',
    undefined,
    signal,
  )
  return (await response.json()) as ProjectChanges
}

export async function getProjectHistory(
  sessionId: string | null,
  offset = 0,
  signal?: AbortSignal,
): Promise<ProjectHistory> {
  const params = new URLSearchParams({
    limit: String(projectHistoryPageSize),
    offset: String(offset),
  })
  if (sessionId) params.set('session', sessionId)
  const response = await request(
    `/project/history?${params.toString()}`,
    'GET',
    undefined,
    signal,
  )
  return (await response.json()) as ProjectHistory
}

export async function getProjectCommit(
  sessionId: string | null,
  hash: string,
  signal?: AbortSignal,
): Promise<ProjectCommit> {
  const params = new URLSearchParams({ hash })
  if (sessionId) params.set('session', sessionId)
  const response = await request(
    `/project/commit?${params.toString()}`,
    'GET',
    undefined,
    signal,
  )
  return (await response.json()) as ProjectCommit
}

export async function getProjectCommitDiff(
  sessionId: string | null,
  hash: string,
  path: string,
  signal?: AbortSignal,
): Promise<ProjectDiff> {
  const params = new URLSearchParams({ hash, path })
  if (sessionId) params.set('session', sessionId)
  const response = await request(
    `/project/commit-diff?${params.toString()}`,
    'GET',
    undefined,
    signal,
  )
  return (await response.json()) as ProjectDiff
}

export async function getSessionDirectory(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionDirectory> {
  const response = await request(
    `/session/${encodeURIComponent(sessionId)}/cwd`,
    'GET',
    undefined,
    signal,
  )
  return (await response.json()) as SessionDirectory
}

export async function getProjectFile(
  sessionId: string | null,
  path: string,
  showHidden: boolean,
  signal?: AbortSignal,
): Promise<string> {
  const response = await request(
    `/project/file${pathQuery(sessionId, path, showHidden)}`,
    'GET',
    undefined,
    signal,
  )
  return response.text()
}

export function isProjectImage(path: string) {
  return /\.(?:png|jpe?g|gif|webp|ico|svg)$/i.test(path)
}

export async function getProjectImage(
  sessionId: string | null,
  path: string,
  showHidden: boolean,
  signal: AbortSignal,
) {
  const response = await request(
    `/project/file${pathQuery(sessionId, path, showHidden)}&image=1`,
    'GET',
    undefined,
    signal,
  )
  return response.blob()
}

export async function getProjectDiff(
  sessionId: string | null,
  path: string,
  showHidden: boolean,
  signal?: AbortSignal,
): Promise<ProjectDiff> {
  const response = await request(
    `/project/diff${pathQuery(sessionId, path, showHidden)}`,
    'GET',
    undefined,
    signal,
  )
  return (await response.json()) as ProjectDiff
}

export async function uploadProjectFile(
  sessionId: string | null,
  directory: string,
  file: File,
) {
  const form = new FormData()
  form.append('file', file, file.name)
  await request(
    `/project/upload${pathQuery(sessionId, directory)}`,
    'POST',
    form,
  )
}

export async function downloadProjectFile(
  sessionId: string | null,
  path: string,
  onProgress?: (progress: ProjectDownloadProgress) => void,
  signal?: AbortSignal,
) {
  const response = await request(
    `/project/download${pathQuery(sessionId, path, true)}`,
    'GET',
    undefined,
    signal,
  )
  const contentLength = response.headers.get('content-length')
  const total = contentLength?.trim() ? Number(contentLength) : Number.NaN
  if (!Number.isSafeInteger(total) || total < 0) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('下载失败：服务器未提供有效的文件大小')
  }
  if (total > maxProjectDownloadBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('下载失败：文件超过 128 MiB 下载上限')
  }
  onProgress?.({ loaded: 0, total })

  let blob: Blob
  if (!response.body) {
    blob = await response.blob()
    if (blob.size !== total) {
      throw new Error('下载失败：响应内容长度不一致')
    }
    onProgress?.({ loaded: blob.size, total })
  } else {
    const reader = response.body.getReader()
    try {
      const data = new Uint8Array(total)
      let loaded = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (loaded + value.byteLength > total) {
          throw new Error('下载失败：响应内容长度不一致')
        }
        data.set(value, loaded)
        loaded += value.byteLength
        onProgress?.({ loaded, total })
      }
      if (loaded !== total) {
        throw new Error('下载失败：响应内容长度不一致')
      }
      blob = new Blob([data], {
        type:
          response.headers.get('content-type') ?? 'application/octet-stream',
      })
    } catch (cause) {
      await reader.cancel().catch(() => undefined)
      throw cause
    } finally {
      reader.releaseLock()
    }
  }

  const link = document.createElement('a')
  const objectUrl = URL.createObjectURL(blob)
  link.href = objectUrl
  link.download = path.slice(path.lastIndexOf('/') + 1) || 'download'
  link.hidden = true
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  }
}

export async function deleteProjectFile(
  sessionId: string | null,
  path: string,
) {
  await request(`/project/file${pathQuery(sessionId, path, true)}`, 'DELETE')
}
