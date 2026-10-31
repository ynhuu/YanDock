import { useRef, useState, type ChangeEvent, type RefObject } from 'react'
import { Icon } from '../../shared/ui/Icon'
import type { StatusToastVariant } from '../../shared/ui/StatusToast'
import {
  deleteProjectFile,
  uploadProjectFile,
  type ProjectDownloadStatus,
  type ProjectFile,
} from './projectApi'
import { ProjectFileTree } from './ProjectFileTree'
import { ProjectPreview } from './ProjectPreview'
import type { ProjectBrowser } from './useProjectBrowser'

type Props = {
  browser: ProjectBrowser
  sessionId: string | null
  panel: RefObject<HTMLElement | null>
  active: boolean
  downloads: ProjectDownloadStatus[]
  onDownload: (path: string) => void
  onToast: (message: string, variant: StatusToastVariant) => void
}

function parentPath(path: string) {
  const pieces = path.split('/').filter(Boolean)
  pieces.pop()
  return pieces.join('/')
}

// Remains mounted across tabs so an upload keeps its captured project context.
export function ProjectFiles({
  browser,
  sessionId,
  panel,
  active,
  downloads,
  onDownload,
  onToast,
}: Props) {
  const uploadInput = useRef<HTMLInputElement>(null)
  const uploadTarget = useRef<{
    directory: string
    isCurrent: () => boolean
  } | null>(null)
  const [uploading, setUploading] = useState(false)
  const {
    directory,
    directoryName,
    showHidden,
    preview,
    previewLoading,
    setDirectory,
    setError,
    clearPreview,
    refreshFiles,
    refreshFileTree,
    refreshChanges,
    changeHiddenVisibility,
    captureContext,
  } = browser

  async function deleteFile(file: ProjectFile) {
    if (
      !window.confirm(
        file.isDir
          ? `确定删除文件夹“${file.path}”及其全部内容吗？此操作不可撤销。`
          : `确定删除文件“${file.path}”吗？`,
      )
    )
      return
    const isCurrent = captureContext()
    setError('')
    try {
      await deleteProjectFile(sessionId, file.path)
      if (!isCurrent()) return
      if (preview?.path === file.path) clearPreview()
      if (
        file.isDir &&
        (directory === file.path || directory.startsWith(`${file.path}/`))
      )
        setDirectory(parentPath(file.path))
      onToast(`已删除 ${file.name}`, 'success')
      await refreshFiles(parentPath(file.path))
      if (isCurrent()) void refreshChanges(showHidden)
    } catch (cause) {
      if (isCurrent())
        setError(cause instanceof Error ? cause.message : '删除失败')
    }
  }

  function selectUpload(path: string) {
    uploadTarget.current = { directory: path, isCurrent: captureContext() }
    uploadInput.current?.click()
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    const target = uploadTarget.current
    uploadTarget.current = null
    if (!selected.length || !target || !target.isCurrent()) return
    const { directory: uploadDirectory, isCurrent } = target
    setUploading(true)
    setError('')
    onToast(`正在上传 ${selected.length} 个文件`, 'info')
    let uploaded = 0
    let uploadError = ''
    try {
      for (const file of selected) {
        if (!isCurrent()) throw new Error('项目已变化，剩余文件未上传')
        await uploadProjectFile(sessionId, uploadDirectory, file)
        uploaded++
      }
    } catch (cause) {
      uploadError = cause instanceof Error ? cause.message : '上传失败'
    }
    if (isCurrent()) {
      await refreshFiles(uploadDirectory)
      if (isCurrent()) void refreshChanges(showHidden)
    }
    setUploading(false)
    if (uploadError)
      onToast(
        uploaded > 0
          ? `已上传 ${uploaded} 个文件；${uploadError}`
          : uploadError,
        uploaded > 0 ? 'warning' : 'error',
      )
    else onToast(`已上传 ${uploaded} 个文件`, 'success')
  }

  if (!active) return null
  if (preview)
    return (
      <ProjectPreview
        preview={preview}
        loading={previewLoading}
        sessionId={sessionId}
        downloads={downloads}
        onBack={clearPreview}
        onDownload={onDownload}
        onError={setError}
      />
    )
  const breadcrumbs = directory ? directory.split('/') : []
  return (
    <>
      <div className="project-toolbar project-files-toolbar">
        <nav className="project-breadcrumbs" aria-label="当前目录">
          <button type="button" onClick={() => setDirectory('')}>
            {directoryName}
          </button>
          {breadcrumbs.map((part, index) => {
            const path = breadcrumbs.slice(0, index + 1).join('/')
            return (
              <span key={path}>
                <span aria-hidden="true">/</span>
                <button type="button" onClick={() => setDirectory(path)}>
                  {part}
                </button>
              </span>
            )
          })}
        </nav>
        <div className="project-toolbar-actions">
          <button
            type="button"
            className="project-icon-button"
            aria-label={showHidden ? '隐藏点文件' : '显示隐藏文件'}
            title={showHidden ? '隐藏点文件' : '显示隐藏文件'}
            onClick={changeHiddenVisibility}
          >
            <Icon name={showHidden ? 'eyeOff' : 'eye'} />
          </button>
          <button
            type="button"
            className="project-icon-button"
            aria-label="刷新文件树"
            title="刷新"
            disabled={browser.filesLoading || uploading}
            onClick={() => void refreshFileTree()}
          >
            <Icon name="rotateCcw" />
          </button>
          <button
            type="button"
            className="project-icon-button"
            aria-label={uploading ? '正在上传文件' : '上传文件'}
            title={uploading ? '上传中' : '上传文件'}
            disabled={uploading}
            onClick={() => selectUpload(directory)}
          >
            <Icon name="upload" />
          </button>
          <input
            ref={uploadInput}
            type="file"
            multiple
            className="sr-only"
            aria-label="选择要上传的文件"
            onChange={handleUpload}
          />
        </div>
      </div>
      <ProjectFileTree
        {...browser}
        panel={panel}
        uploading={uploading}
        onUpload={selectUpload}
        onDownload={onDownload}
        onDelete={deleteFile}
      />
    </>
  )
}
