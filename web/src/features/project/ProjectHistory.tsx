import { lazy, Suspense, useMemo } from 'react'
import type { FileDiffOptions } from '@pierre/diffs'
import { ProjectFileIcon } from './ProjectFileIcon'
import { changeKind, changeMarker } from './projectChangeStatus'
import type { ProjectBrowser } from './useProjectBrowser'
import {
  historyGraphColors,
  historyGraphWidth,
  layoutHistoryGraph,
} from './historyGraph'

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

const rowHeight = 38
const laneWidth = 15
const graphPadding = 13

function formatCommitDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function refLabel(kind: string) {
  if (kind === 'remote') return '远程'
  if (kind === 'tag') return '标签'
  return '分支'
}

function refIcon(kind: string) {
  if (kind === 'remote') return '⇄'
  if (kind === 'tag') return '◆'
  return '⑂'
}

type HistoryDiff = ProjectBrowser['historyDiffs'][string]

function HistoryFileDiff({
  path,
  diff,
  loading,
  id,
}: {
  path: string
  diff: HistoryDiff | undefined
  loading: boolean
  id: string
}) {
  return (
    <div
      className="project-review-diff project-history-file-diff"
      id={id}
      role="region"
      aria-label={`文件差异 ${path}`}
      aria-live="polite"
    >
      {loading ? (
        <p className="project-empty">正在读取文件差异…</p>
      ) : diff === undefined ? null : diff.kind === 'binary' ? (
        <p className="project-empty">这是二进制文件，无法显示文本差异。</p>
      ) : diff.kind === 'empty' ? (
        <p className="project-empty">没有差异内容</p>
      ) : diff.kind === 'limited' ? (
        <>
          <p className="project-muted">
            文件内容超过读取上限，以下仅显示可能不完整的补丁。
          </p>
          {diff.patch.trim() && (
            <Suspense
              fallback={<p className="project-empty">正在加载差异视图…</p>}
            >
              <PierrePatchDiff
                patch={diff.patch}
                options={options}
                className="project-diff-view"
              />
            </Suspense>
          )}
        </>
      ) : (
        <Suspense fallback={<p className="project-empty">正在加载差异视图…</p>}>
          {diff.kind === 'file' ? (
            <PierreFileDiff
              fileDiff={diff.fileDiff}
              options={options}
              className="project-diff-view"
            />
          ) : (
            <PierrePatchDiff
              patch={diff.patch}
              options={options}
              className="project-diff-view"
            />
          )}
        </Suspense>
      )}
    </div>
  )
}

type HistoryDetailProps = Pick<
  ProjectBrowser,
  | 'historyDetail'
  | 'historyDetailLoading'
  | 'selectedHistoryFilePath'
  | 'historyDiffs'
  | 'historyDiffLoadingPath'
  | 'selectHistoryFile'
> & {
  graphWidth: number
  graphLineColor: string
  graphLineX: number
}

function HistoryCommitDetails({
  historyDetail,
  historyDetailLoading,
  selectedHistoryFilePath,
  historyDiffs,
  historyDiffLoadingPath,
  selectHistoryFile,
  graphWidth,
  graphLineColor,
  graphLineX,
}: HistoryDetailProps) {
  return (
    <section
      className="project-history-detail"
      aria-label="提交详情"
      aria-live="polite"
      style={{ paddingLeft: graphWidth + 10 }}
    >
      <span
        className="project-history-detail-content-line"
        style={{ left: graphWidth + 10 }}
        aria-hidden="true"
      />
      <span
        className="project-history-detail-graph-line"
        style={{ left: graphLineX, backgroundColor: graphLineColor }}
        aria-hidden="true"
      />
      {historyDetailLoading ? (
        <p className="project-empty">正在读取提交详情…</p>
      ) : historyDetail ? (
        <>
          {historyDetail.files.length === 0 ? (
            <p className="project-muted">没有文件变更</p>
          ) : (
            <ul className="project-history-files">
              {historyDetail.files.map((file) => {
                const selected = selectedHistoryFilePath === file.path
                const name = file.path.split('/').at(-1) || file.path
                const directory = file.path.slice(
                  0,
                  Math.max(0, file.path.lastIndexOf('/')),
                )
                const diffId = `project-history-diff-${encodeURIComponent(file.path)}`
                return (
                  <li
                    className="project-change-item"
                    key={`${file.status}:${file.path}`}
                  >
                    <button
                      type="button"
                      className="project-change-trigger"
                      aria-label={`${file.label} ${file.path}`}
                      aria-expanded={selected}
                      aria-controls={diffId}
                      onClick={() => void selectHistoryFile(file)}
                    >
                      <ProjectFileIcon
                        className="project-file-icon"
                        path={file.path}
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
                        data-type={changeKind(file)}
                        aria-label={file.label}
                      >
                        {changeMarker(file)}
                      </span>
                    </button>
                    {selected && (
                      <HistoryFileDiff
                        path={file.path}
                        diff={
                          historyDiffs[
                            `commit-diff:${historyDetail.hash}:${file.path}`
                          ]
                        }
                        loading={historyDiffLoadingPath === file.path}
                        id={diffId}
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {historyDetail.filesTruncated && (
            <p className="project-muted">修改文件较多，列表已截断。</p>
          )}
        </>
      ) : null}
    </section>
  )
}

export function ProjectHistory({
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
  const { commits, refs } = history
  const rows = useMemo(() => layoutHistoryGraph(commits), [commits])
  const graphWidth = historyGraphWidth(rows)
  const refsByCommit = useMemo(() => {
    const result = new Map<string, typeof refs>()
    for (const ref of refs) {
      const refs = result.get(ref.commit) ?? []
      refs.push(ref)
      result.set(ref.commit, refs)
    }
    return result
  }, [refs])

  return (
    <>
      {history.refsTruncated && (
        <p className="project-muted project-history-truncated" role="status">
          分支和标签较多，仅显示部分引用。
        </p>
      )}
      <div className="project-history-list">
        {historyLoading && history.commits.length === 0 ? (
          <p className="project-empty">正在读取 Git 历史…</p>
        ) : history.commits.length === 0 ? (
          <p className="project-empty">没有可显示的 Git 提交</p>
        ) : (
          rows.map((row) => {
            const refs = refsByCommit.get(row.commit.hash) ?? []
            const nodeX = graphPadding + row.lane * laneWidth
            const nodeColor =
              historyGraphColors[row.lane % historyGraphColors.length]
            return (
              <div className="project-history-item" key={row.commit.hash}>
                <button
                  className={`project-history-row${selectedHistoryHash === row.commit.hash ? ' is-selected' : ''}`}
                  type="button"
                  aria-label={`提交 ${row.commit.shortHash}：${row.commit.subject}`}
                  aria-expanded={selectedHistoryHash === row.commit.hash}
                  onClick={() => selectHistoryCommit(row.commit)}
                >
                  <svg
                    className="project-history-graph"
                    width={graphWidth}
                    height={rowHeight}
                    viewBox={`0 0 ${graphWidth} ${rowHeight}`}
                    aria-hidden="true"
                  >
                    {row.lanes.map((hash, lane) =>
                      lane === row.lane ? null : (
                        <line
                          key={`lane-${hash}`}
                          x1={graphPadding + lane * laneWidth}
                          y1="0"
                          x2={graphPadding + lane * laneWidth}
                          y2={rowHeight}
                          stroke={
                            historyGraphColors[lane % historyGraphColors.length]
                          }
                          strokeWidth="2"
                        />
                      ),
                    )}
                    {row.incoming && (
                      <line
                        x1={graphPadding + row.lane * laneWidth}
                        y1="0"
                        x2={graphPadding + row.lane * laneWidth}
                        y2={rowHeight / 2}
                        stroke={
                          historyGraphColors[
                            row.lane % historyGraphColors.length
                          ]
                        }
                        strokeWidth="2"
                      />
                    )}
                    {row.edges.map((edge, index) => {
                      const fromX = graphPadding + edge.fromLane * laneWidth
                      const toX = graphPadding + edge.toLane * laneWidth
                      const middleY = rowHeight / 2
                      return (
                        <path
                          key={`edge-${index}`}
                          d={`M ${fromX} ${middleY} C ${fromX} ${middleY + 8}, ${toX} ${rowHeight - 8}, ${toX} ${rowHeight}`}
                          fill="none"
                          stroke={edge.color}
                          strokeWidth="2"
                        />
                      )
                    })}
                    {selectedHistoryHash === row.commit.hash && (
                      <line
                        x1={nodeX}
                        y1={rowHeight / 2}
                        x2={nodeX}
                        y2={rowHeight}
                        stroke={nodeColor}
                        strokeWidth="3"
                      />
                    )}
                    {row.commit.parents.length > 1 ? (
                      <rect
                        x={nodeX - 4.5}
                        y={rowHeight / 2 - 4.5}
                        width="9"
                        height="9"
                        rx="1"
                        fill="var(--card)"
                        stroke={nodeColor}
                        strokeWidth="2.5"
                        transform={`rotate(45 ${nodeX} ${rowHeight / 2})`}
                      />
                    ) : (
                      <circle
                        cx={nodeX}
                        cy={rowHeight / 2}
                        r="4.5"
                        fill="var(--card)"
                        stroke={nodeColor}
                        strokeWidth="2.5"
                      />
                    )}
                  </svg>
                  <span className="project-history-content">
                    <span className="project-history-title-line">
                      <code className="project-history-hash">
                        {row.commit.shortHash}
                      </code>
                      <span className="project-history-subject">
                        {row.commit.subject || '（无提交说明）'}
                      </span>
                    </span>
                    <span className="project-history-meta">
                      <span>{row.commit.authorName}</span>
                      <span>{formatCommitDate(row.commit.authoredAt)}</span>
                      {refs.slice(0, 3).map((ref) => (
                        <span
                          className={`project-history-ref is-${ref.kind}`}
                          key={`${ref.kind}:${ref.name}`}
                        >
                          <span
                            className="project-history-ref-icon"
                            aria-hidden="true"
                          >
                            {refIcon(ref.kind)}
                          </span>
                          {refLabel(ref.kind)} {ref.name}
                        </span>
                      ))}
                      {refs.length > 3 && <span>+{refs.length - 3}</span>}
                    </span>
                  </span>
                  <span
                    className={`project-history-chevron${selectedHistoryHash === row.commit.hash ? ' is-expanded' : ''}`}
                    aria-hidden="true"
                  >
                    ›
                  </span>
                </button>
                {selectedHistoryHash === row.commit.hash && (
                  <HistoryCommitDetails
                    historyDetail={historyDetail}
                    historyDetailLoading={historyDetailLoading}
                    selectedHistoryFilePath={selectedHistoryFilePath}
                    historyDiffs={historyDiffs}
                    historyDiffLoadingPath={historyDiffLoadingPath}
                    selectHistoryFile={selectHistoryFile}
                    graphWidth={graphWidth}
                    graphLineColor={nodeColor}
                    graphLineX={nodeX + 12}
                  />
                )}
              </div>
            )
          })
        )}
      </div>
      {historyTruncated && (
        <button
          type="button"
          className="project-history-load-more"
          disabled={historyLoading}
          onClick={() => void loadMoreHistory()}
        >
          {historyLoading ? '正在读取更多历史…' : '加载更多历史'}
        </button>
      )}
    </>
  )
}
