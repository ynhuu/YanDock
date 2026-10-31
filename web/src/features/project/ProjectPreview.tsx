import { lazy, Suspense, useMemo } from 'react'
import type { FileOptions } from '@pierre/diffs'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { Icon } from '../../shared/ui/Icon'
import type { ProjectDownloadStatus } from './projectApi'
import type { ProjectPreview as Preview } from './useProjectBrowser'

const PierreFile = lazy(() =>
  import('@pierre/diffs/react').then(({ File }) => ({ default: File })),
)
const options: FileOptions<undefined> = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  themeType: 'system',
  disableLineNumbers: false,
  overflow: 'wrap',
  disableFileHeader: true,
}

type Props = {
  preview: Preview
  loading: boolean
  sessionId: string | null
  downloads: ProjectDownloadStatus[]
  onBack: () => void
  onDownload: (path: string) => void
  onError: (message: string) => void
}

export function ProjectPreview({
  preview,
  loading,
  sessionId,
  downloads,
  onBack,
  onDownload,
  onError,
}: Props) {
  const markdown = /\.(?:md|markdown)$/i.test(preview.path)
  const markdownContent = useMemo(
    () =>
      markdown
        ? DOMPurify.sanitize(marked.parse(preview.content, { async: false }))
        : '',
    [markdown, preview.content],
  )
  const activeDownload = downloads.find(
    (download) =>
      download.sessionId === sessionId && download.path === preview.path,
  )
  const downloadInProgress = activeDownload?.completed === false
  return (
    <>
      <div className="project-toolbar">
        <button type="button" className="project-toolbar-back" onClick={onBack}>
          <Icon name="back" />
          文件列表
        </button>
        <button
          type="button"
          className="project-download-button"
          aria-busy={downloadInProgress}
          onClick={() => onDownload(preview.path)}
        >
          <Icon name="download" />
          {activeDownload?.completed
            ? '下载完成'
            : downloadInProgress
              ? '下载中…'
              : '下载'}
        </button>
      </div>
      <div className="project-preview-heading">
        <code>{preview.path}</code>
      </div>
      <div className="project-preview-scroll" aria-busy={loading}>
        {loading ? (
          <p className="project-preview-loading">正在读取文件…</p>
        ) : preview.error ? (
          <p className="project-preview-message" role="status">
            {preview.error}
          </p>
        ) : preview.imageUrl ? (
          <div className="project-image-preview" key={preview.imageUrl}>
            <img
              src={preview.imageUrl}
              alt={preview.path}
              onError={(event) => {
                event.currentTarget.hidden = true
                onError('图片无法加载或格式无效，请下载原文件查看')
              }}
            />
          </div>
        ) : markdown ? (
          <article
            className="project-markdown-preview"
            dangerouslySetInnerHTML={{ __html: markdownContent }}
          />
        ) : (
          <div className="project-source-preview">
            <Suspense
              fallback={
                <p className="project-preview-loading">正在加载代码预览…</p>
              }
            >
              <PierreFile
                className="project-source-file"
                file={{
                  name: preview.path.split('/').at(-1) || preview.path,
                  contents: preview.content,
                }}
                options={options}
              />
            </Suspense>
          </div>
        )}
      </div>
    </>
  )
}
