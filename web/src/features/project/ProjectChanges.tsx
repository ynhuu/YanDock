import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { FileDiffOptions } from '@pierre/diffs'
import { Icon } from '../../shared/ui/Icon'
import { ProjectFileIcon } from './ProjectFileIcon'
import { ProjectHistory } from './ProjectHistory'
import { changeKind, changeMarker } from './projectChangeStatus'
import type { ProjectBrowser } from './useProjectBrowser'

const PierrePatchDiff = lazy(() =>
  import('@pierre/diffs/react').then(({ PatchDiff }) => ({
    default: PatchDiff,
  })),
)
const PierreFileDiff = lazy(() =>
  import('@pierre/diffs/react').then(({ FileDiff }) => ({ default: FileDiff })),
)
const options: FileDiffOptions<unknown> = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  themeType: 'system',
  disableLineNumbers: false,
  overflow: 'wrap',
  diffStyle: 'unified',
  disableFileHeader: true,
  diffIndicators: 'bars',
  hunkSeparators: 'line-info-basic',
  lineDiffType: 'word',
  collapsedContextThreshold: 1,
}

type Props = Pick<
  ProjectBrowser,
  | 'changes'
  | 'changesTruncated'
  | 'changeTotals'
  | 'changesLoading'
  | 'showHidden'
  | 'expandedChanges'
  | 'changeDiffs'
  | 'diffLoadingPaths'
  | 'refreshChanges'
  | 'refreshHistory'
  | 'toggleChange'
  | 'openChangedFile'
  | 'reviewTab'
  | 'switchReviewTab'
  | 'history'
  | 'historyTruncated'
  | 'historyLoading'
  | 'loadMoreHistory'
  | 'selectedHistoryHash'
  | 'historyDetail'
  | 'historyDetailLoading'
  | 'selectHistoryCommit'
  | 'selectedHistoryFilePath'
  | 'historyDiffs'
  | 'historyDiffLoadingPath'
  | 'selectHistoryFile'
>

export function ProjectChanges({
  changes,
  changesTruncated,
  changeTotals,
  changesLoading,
  showHidden,
  expandedChanges,
  changeDiffs,
  diffLoadingPaths,
  refreshChanges,
  refreshHistory,
  toggleChange,
  openChangedFile,
  reviewTab,
  switchReviewTab,
  history,
  historyTruncated,
  historyLoading,
  loadMoreHistory,
  selectedHistoryHash,
  historyDetail,
  historyDetailLoading,
  selectHistoryCommit,
  selectedHistoryFilePath,
  historyDiffs,
  historyDiffLoadingPath,
  selectHistoryFile,
}: Props) {
  const [reviewMenuOpen, setReviewMenuOpen] = useState(false)
  const reviewSelectorRef = useRef<HTMLDivElement>(null)
  const reviewTriggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!reviewMenuOpen) return
    const selector = reviewSelectorRef.current
    const items = () =>
      Array.from(
        selector?.querySelectorAll<HTMLButtonElement>(
          '[role="menuitemradio"]',
        ) ?? [],
      )
    items()
      .find((item) => item.getAttribute('aria-checked') === 'true')
      ?.focus()

    const dismissOutside = (event: PointerEvent) => {
      if (!selector?.contains(event.target as Node)) setReviewMenuOpen(false)
    }
    const navigateMenu = (event: KeyboardEvent) => {
      if (!['Tab', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
        return
      event.preventDefault()
      event.stopPropagation()
      const menuItems = items()
      const index = menuItems.findIndex(
        (item) => item === document.activeElement,
      )
      const step =
        event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)
          ? -1
          : 1
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? menuItems.length - 1
            : (index + step + menuItems.length) % menuItems.length
      menuItems[next]?.focus({ preventScroll: true })
    }

    document.addEventListener('pointerdown', dismissOutside)
    window.addEventListener('keydown', navigateMenu)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      window.removeEventListener('keydown', navigateMenu)
    }
  }, [reviewMenuOpen])

  const chooseReviewTab = (next: 'changes' | 'history') => {
    setReviewMenuOpen(false)
    switchReviewTab(next)
    reviewTriggerRef.current?.focus({ preventScroll: true })
  }

  return (
    <>
      <div className="project-review-header">
        <div className="project-review-selector" ref={reviewSelectorRef}>
          <button
            type="button"
            ref={reviewTriggerRef}
            className="project-review-selector-button"
            aria-haspopup="menu"
            aria-expanded={reviewMenuOpen}
            aria-controls="project-review-menu"
            aria-label={`Git视图：${reviewTab === 'changes' ? '当前变更' : '历史变更'}`}
            onClick={() => setReviewMenuOpen((open) => !open)}
          >
            <span>{reviewTab === 'changes' ? '当前变更' : '历史变更'}</span>
            <span
              className="project-review-selector-chevron"
              aria-hidden="true"
            >
              ▾
            </span>
          </button>
          {reviewMenuOpen && (
            <div
              className="project-review-menu"
              id="project-review-menu"
              role="menu"
              aria-label="Git视图"
            >
              {(
                [
                  ['changes', '当前变更'],
                  ['history', '历史变更'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={reviewTab === value}
                  onClick={() => chooseReviewTab(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {reviewTab === 'changes' && (
          <div
            className="project-review-total"
            aria-label={`增加 ${changeTotals.additions} 行，删除 ${changeTotals.deletions} 行`}
          >
            <span className="project-diff-additions">
              +{changeTotals.additions}
            </span>
            <span className="project-diff-deletions">
              −{changeTotals.deletions}
            </span>
          </div>
        )}
        <button
          type="button"
          className="project-icon-button"
          aria-label={`刷新 Git ${reviewTab === 'changes' ? '变更' : '历史'}`}
          title="刷新"
          disabled={reviewTab === 'changes' ? changesLoading : historyLoading}
          onClick={() => {
            if (reviewTab === 'changes') void refreshChanges(showHidden)
            else void refreshHistory()
          }}
        >
          <Icon name="rotateCcw" />
        </button>
      </div>
      {reviewTab === 'changes' && changeTotals.statsComplete === false && (
        <p className="project-muted" role="status">
          行数统计不完整，仅显示已统计部分。
        </p>
      )}
      {reviewTab === 'history' ? (
        <ProjectHistory
          history={history}
          historyTruncated={historyTruncated}
          historyLoading={historyLoading}
          loadMoreHistory={loadMoreHistory}
          selectedHistoryHash={selectedHistoryHash}
          historyDetail={historyDetail}
          historyDetailLoading={historyDetailLoading}
          selectHistoryCommit={selectHistoryCommit}
          selectedHistoryFilePath={selectedHistoryFilePath}
          historyDiffs={historyDiffs}
          historyDiffLoadingPath={historyDiffLoadingPath}
          selectHistoryFile={selectHistoryFile}
        />
      ) : (
        <div className="project-entry-list project-review-list">
          {changesLoading && changes.length === 0 ? (
            <p className="project-empty">正在读取 Git 更改…</p>
          ) : changes.length === 0 ? (
            <p className="project-empty">没有未提交的更改</p>
          ) : (
            changes.map((change) => {
              const expanded = expandedChanges.has(change.path)
              const content = changeDiffs[change.path]
              const name = change.path.split('/').at(-1) || change.path
              const directory = change.path.slice(
                0,
                Math.max(0, change.path.lastIndexOf('/')),
              )
              const diffId = `project-diff-${encodeURIComponent(change.path)}`
              return (
                <div
                  className="project-change-item"
                  key={`${change.status}:${change.path}`}
                >
                  <button
                    type="button"
                    className="project-change-trigger"
                    aria-label={`${change.label} ${change.path}`}
                    aria-expanded={expanded}
                    aria-controls={diffId}
                    onClick={() => void toggleChange(change)}
                  >
                    <ProjectFileIcon
                      className="project-file-icon"
                      path={change.path}
                    />
                    <span className="project-change-path">
                      {directory && (
                        <>
                          <span className="project-change-directory">
                            {directory}
                          </span>
                          <span
                            className="project-change-separator"
                            aria-hidden="true"
                          >
                            /
                          </span>
                        </>
                      )}
                      <code className="project-change-name">{name}</code>
                    </span>
                    <span
                      className="project-file-change"
                      data-type={changeKind(change)}
                      aria-label={change.label}
                    >
                      {changeMarker(change)}
                    </span>
                  </button>
                  {expanded && (
                    <div className="project-review-diff" id={diffId}>
                      <div className="project-review-file-toolbar">
                        {change.statsComplete === false ? (
                          <span className="project-muted">行数未完整统计</span>
                        ) : (
                          <div
                            className="project-diff-stats"
                            aria-label={`增加 ${change.additions} 行，删除 ${change.deletions} 行`}
                          >
                            <span className="project-diff-additions">
                              +{change.additions}
                            </span>
                            <span className="project-diff-deletions">
                              −{change.deletions}
                            </span>
                          </div>
                        )}
                        <button
                          type="button"
                          className="project-open-file"
                          onClick={() => openChangedFile(change)}
                        >
                          <Icon name="openExternal" size={16} />
                          打开文件
                        </button>
                      </div>
                      {diffLoadingPaths.has(change.path) ? (
                        <p className="project-empty">正在读取差异…</p>
                      ) : content === undefined || content.kind === 'empty' ? (
                        <p className="project-empty">没有差异内容</p>
                      ) : (
                        <Suspense
                          fallback={
                            <p className="project-empty">正在加载差异视图…</p>
                          }
                        >
                          {content.kind === 'file' ? (
                            <PierreFileDiff
                              fileDiff={content.fileDiff}
                              options={options}
                              className="project-diff-view"
                            />
                          ) : (
                            <PierrePatchDiff
                              patch={content.patch}
                              options={options}
                              className="project-diff-view"
                            />
                          )}
                        </Suspense>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
          {changesTruncated && (
            <p className="project-muted">更改较多，仅显示前 2000 项。</p>
          )}
        </div>
      )}
    </>
  )
}
