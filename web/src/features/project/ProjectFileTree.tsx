import { useMemo, type RefObject } from 'react'
import { Icon } from '../../shared/ui/Icon'
import type { ProjectChange, ProjectFile } from './projectApi'
import { ProjectFileIcon } from './ProjectFileIcon'
import { changeKind, changeMarker } from './projectChangeStatus'
import { useFileMenu } from './useFileMenu'
import type { ProjectBrowser } from './useProjectBrowser'

type Props = Pick<
  ProjectBrowser,
  | 'files'
  | 'changes'
  | 'directory'
  | 'treeDirectories'
  | 'expandedDirectories'
  | 'treeLoadingPaths'
  | 'treeTruncatedPaths'
  | 'filesTruncated'
  | 'filesLoading'
  | 'setDirectory'
  | 'clearPreview'
  | 'openFile'
> & {
  panel: RefObject<HTMLElement | null>
  uploading: boolean
  onUpload: (path: string) => void
  onDownload: (path: string) => void
  onDelete: (file: ProjectFile) => Promise<void>
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ProjectFileTree({
  files,
  changes,
  directory,
  treeDirectories,
  expandedDirectories,
  treeLoadingPaths,
  treeTruncatedPaths,
  filesTruncated,
  filesLoading,
  setDirectory,
  clearPreview,
  openFile,
  panel,
  uploading,
  onUpload,
  onDownload,
  onDelete,
}: Props) {
  const { menu, menuRef, close, entryEvents } = useFileMenu(panel)
  const { changesByPath, changedDirectories } = useMemo(() => {
    const byPath = new Map<string, ProjectChange>()
    const directories = new Set<string>()
    for (const change of changes) {
      const { path } = change
      byPath.set(path, change)
      let separator = path.lastIndexOf('/')
      while (separator > 0) {
        directories.add(path.slice(0, separator))
        separator = path.lastIndexOf('/', separator - 1)
      }
    }
    return { changesByPath: byPath, changedDirectories: directories }
  }, [changes])
  const rows = useMemo(() => {
    const result: { file: ProjectFile; depth: number }[] = []
    const append = (entries: ProjectFile[], depth: number) => {
      for (const file of entries) {
        result.push({ file, depth })
        if (file.isDir && expandedDirectories.has(file.path))
          append(treeDirectories[file.path] ?? [], depth + 1)
      }
    }
    append(files, 0)
    return result
  }, [files, treeDirectories, expandedDirectories])

  return (
    <>
      <div
        className="project-entry-list"
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            !event.target.closest('.project-entry')
          ) {
            setDirectory('')
            clearPreview()
          }
        }}
      >
        {filesLoading && files.length === 0 ? (
          <p className="project-empty">正在读取目录…</p>
        ) : rows.length === 0 ? (
          <p className="project-empty">此目录为空</p>
        ) : (
          rows.map(({ file, depth }) => {
            const change = changesByPath.get(file.path)
            const kind = changeKind(change)
            const expanded = expandedDirectories.has(file.path)
            const stateStyle = {
              paddingInlineStart: `${(depth + 1) * 16 + 30}px`,
            }
            return (
              <div key={file.path}>
                <div
                  className="project-file-row"
                  data-depth={depth}
                  style={{ paddingInlineStart: `${depth * 16}px` }}
                >
                  <button
                    type="button"
                    className="project-entry"
                    aria-expanded={file.isDir ? expanded : undefined}
                    aria-current={
                      file.isDir && directory === file.path ? 'true' : undefined
                    }
                    {...entryEvents(file, () => void openFile(file))}
                  >
                    {file.isDir && (
                      <span
                        className={`project-tree-chevron${expanded ? ' is-expanded' : ''}`}
                        aria-hidden="true"
                      />
                    )}
                    <span className="project-entry-icon">
                      {file.isDir ? (
                        <Icon name="folder" />
                      ) : (
                        <ProjectFileIcon
                          className="project-entry-file-icon"
                          path={file.name}
                        />
                      )}
                    </span>
                    <span className="project-entry-name">{file.name}</span>
                    {!file.isDir && (
                      <span className="project-file-size">
                        {formatSize(file.size)}
                      </span>
                    )}
                    {kind ? (
                      <span
                        className="project-file-change"
                        data-type={kind}
                        aria-label={change?.label}
                      >
                        {changeMarker(change)}
                      </span>
                    ) : !file.isDir ? (
                      <span
                        className="project-file-change project-file-change-placeholder"
                        aria-hidden="true"
                      />
                    ) : file.isDir && changedDirectories.has(file.path) ? (
                      <span
                        className="project-file-change project-file-change-directory"
                        aria-label="包含 Git 更改"
                      />
                    ) : null}
                  </button>
                </div>
                {file.isDir && expanded && treeLoadingPaths.has(file.path) && (
                  <p className="project-tree-state" style={stateStyle}>
                    正在读取目录…
                  </p>
                )}
                {file.isDir &&
                  expanded &&
                  !treeLoadingPaths.has(file.path) &&
                  treeDirectories[file.path]?.length === 0 && (
                    <p className="project-tree-state" style={stateStyle}>
                      空文件夹
                    </p>
                  )}
                {file.isDir &&
                  expanded &&
                  treeTruncatedPaths.has(file.path) && (
                    <p className="project-muted" style={stateStyle}>
                      目录项较多，仅显示前 5000 项。
                    </p>
                  )}
              </div>
            )
          })
        )}
        {filesTruncated && (
          <p className="project-muted">目录项较多，仅显示前 5000 项。</p>
        )}
      </div>
      {menu && (
        <div
          ref={menuRef}
          className="project-file-context-menu"
          role="menu"
          aria-label={`${menu.file.name} 文件操作`}
          style={{ left: menu.left, top: menu.top }}
        >
          {menu.file.isDir ? (
            <button
              type="button"
              role="menuitem"
              disabled={uploading}
              onClick={() => {
                onUpload(menu.file.path)
                close()
              }}
            >
              <Icon name="upload" size={16} />
              上传
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onDownload(menu.file.path)
                close()
              }}
            >
              <Icon name="download" size={16} />
              下载
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => {
              void onDelete(menu.file)
              close()
            }}
          >
            <Icon name="trash" size={16} />
            删除
          </button>
        </div>
      )}
    </>
  )
}
