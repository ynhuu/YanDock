import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import type { FileDiffMetadata } from '@pierre/diffs'
import { ApiError } from '../../shared/api/client'
import {
  getProjectCommit,
  getProjectCommitDiff,
  getProjectChanges,
  getProjectDiff,
  getProjectFile,
  getProjectHistory,
  getProjectImage,
  isProjectImage,
  getProjectFiles,
  getSessionDirectory,
  type ProjectChange,
  type ProjectCommit,
  type ProjectCommitFile,
  type ProjectFile,
  type ProjectHistory,
  type ProjectHistoryCommit,
} from './projectApi'
import { ProjectRequests } from './projectRequests'

type Tab = 'changes' | 'files'
type ReviewTab = 'changes' | 'history'
export type ProjectPreview = {
  path: string
  content: string
  imageUrl?: string
  error?: string
}
export type ProjectBrowser = ReturnType<typeof useProjectBrowser>
type RenderableDiff =
  | { kind: 'file'; fileDiff: FileDiffMetadata }
  | { kind: 'patch'; patch: string }
  | { kind: 'empty' }
type HistoryRenderableDiff =
  RenderableDiff | { kind: 'binary' } | { kind: 'limited'; patch: string }

// Owns project reads and their state. Pointer/focus handling and rendering stay
// in ProjectDrawer; switching terminals never changes terminal connections.
export function useProjectBrowser(sessionId: string | null) {
  const [requests] = useState(() => new ProjectRequests())
  const [tab, setTab] = useState<Tab>('changes')
  const [reviewTab, setReviewTab] = useState<ReviewTab>('changes')
  const [showHidden, setShowHidden] = useState(false)
  const [changes, setChanges] = useState<ProjectChange[]>([])
  const [changesTruncated, setChangesTruncated] = useState(false)
  const [changeTotals, setChangeTotals] = useState({
    additions: 0,
    deletions: 0,
    statsComplete: true,
  })
  const [directory, setDirectory] = useState('')
  const [directoryName, setDirectoryName] = useState('工作目录')
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [treeDirectories, setTreeDirectories] = useState<
    Record<string, ProjectFile[]>
  >({})
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(
    () => new Set(),
  )
  const [treeLoadingPaths, setTreeLoadingPaths] = useState<Set<string>>(
    () => new Set(),
  )
  const [treeTruncatedPaths, setTreeTruncatedPaths] = useState<Set<string>>(
    () => new Set(),
  )
  const [filesTruncated, setFilesTruncated] = useState(false)
  const [preview, setPreview] = useState<ProjectPreview | null>(null)
  useEffect(() => {
    const url = preview?.imageUrl
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [preview?.imageUrl])
  const [expandedChanges, setExpandedChanges] = useState<Set<string>>(
    () => new Set(),
  )
  const [changeDiffs, setChangeDiffs] = useState<
    Record<string, RenderableDiff>
  >({})
  const [diffLoadingPaths, setDiffLoadingPaths] = useState<Set<string>>(
    () => new Set(),
  )
  const [changesLoading, setChangesLoading] = useState(true)
  const [history, setHistory] = useState<ProjectHistory>({
    commits: [],
    refs: [],
    truncated: false,
    refsTruncated: false,
  })
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [selectedHistoryHash, setSelectedHistoryHash] = useState<string | null>(
    null,
  )
  const [historyDetail, setHistoryDetail] = useState<ProjectCommit | null>(null)
  const [historyDetailLoading, setHistoryDetailLoading] = useState(false)
  const [selectedHistoryFilePath, setSelectedHistoryFilePath] = useState<
    string | null
  >(null)
  const [historyDiffs, setHistoryDiffs] = useState<
    Record<string, HistoryRenderableDiff>
  >({})
  const [historyDiffLoadingPath, setHistoryDiffLoadingPath] = useState<
    string | null
  >(null)
  const [filesLoading, setFilesLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [error, setError] = useState('')
  const [changesError, setChangesError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const observedDirectory = useRef('')
  const observedSession = useRef(sessionId)

  const clearPreview = useCallback(() => {
    requests.cancel('preview')
    requests.cancel('navigate')
    setPreview(null)
    setPreviewLoading(false)
  }, [requests])

  const resetBrowser = useCallback(() => {
    requests.clear()
    setDirectory('')
    setFiles([])
    setFilesTruncated(false)
    setFilesLoading(false)
    setTreeDirectories({})
    setExpandedDirectories(new Set())
    setTreeLoadingPaths(new Set())
    setTreeTruncatedPaths(new Set())
    setChanges([])
    setChangesTruncated(false)
    setChangeTotals({ additions: 0, deletions: 0, statsComplete: true })
    setChangesLoading(false)
    setHistory({
      commits: [],
      refs: [],
      truncated: false,
      refsTruncated: false,
    })
    setHistoryLoading(false)
    setHistoryLoaded(false)
    setSelectedHistoryHash(null)
    setHistoryDetail(null)
    setHistoryDetailLoading(false)
    setSelectedHistoryFilePath(null)
    setHistoryDiffs({})
    setHistoryDiffLoadingPath(null)
    setExpandedChanges(new Set())
    setChangeDiffs({})
    setDiffLoadingPaths(new Set())
    clearPreview()
    setError('')
    setChangesError('')
    setHistoryError('')
  }, [clearPreview, requests])

  async function loadPreview(path: string) {
    requests.cancel('navigate')
    const controller = requests.start('preview')
    setPreview({ path, content: '' })
    setPreviewLoading(true)
    setError('')
    try {
      if (isProjectImage(path)) {
        const blob = await getProjectImage(
          sessionId,
          path,
          showHidden,
          controller.signal,
        )
        if (requests.current('preview', controller)) {
          setPreview({ path, content: '', imageUrl: URL.createObjectURL(blob) })
        }
        return
      }
      const content = await getProjectFile(
        sessionId,
        path,
        showHidden,
        controller.signal,
      )
      if (requests.current('preview', controller)) setPreview({ path, content })
    } catch (cause) {
      if (!requests.current('preview', controller)) return
      const message = cause instanceof Error ? cause.message : '无法预览此文件'
      if (
        cause instanceof ApiError &&
        (cause.status === 413 || cause.status === 415)
      ) {
        setPreview({ path, content: '', error: message })
        return
      }
      setPreview(null)
      setError(message)
    } finally {
      if (requests.current('preview', controller)) setPreviewLoading(false)
      requests.finish('preview', controller)
    }
  }

  const refreshChanges = useCallback(
    async (hidden: boolean) => {
      const controller = requests.start('changes')
      requests.cancelPrefix('diff:')
      setChangesLoading(true)
      setExpandedChanges(new Set())
      setChangeDiffs({})
      setDiffLoadingPaths(new Set())
      setChangesError('')
      try {
        const result = await getProjectChanges(
          sessionId,
          hidden,
          controller.signal,
        )
        if (!requests.current('changes', controller)) return
        setChanges(result.files)
        setChangesTruncated(result.truncated)
        setChangeTotals({
          additions: result.additions,
          deletions: result.deletions,
          statsComplete: result.statsComplete,
        })
      } catch (cause) {
        if (requests.current('changes', controller))
          setChangesError(
            cause instanceof Error ? cause.message : '读取更改失败',
          )
      } finally {
        if (requests.current('changes', controller)) setChangesLoading(false)
        requests.finish('changes', controller)
      }
    },
    [requests, sessionId],
  )

  const refreshHistory = useCallback(async () => {
    const controller = requests.start('history')
    requests.cancel('history-more')
    requests.cancelPrefix('commit:')
    requests.cancelPrefix('commit-diff:')
    setHistoryLoading(true)
    setSelectedHistoryHash(null)
    setHistoryDetail(null)
    setHistoryDetailLoading(false)
    setSelectedHistoryFilePath(null)
    setHistoryDiffs({})
    setHistoryDiffLoadingPath(null)
    setHistoryError('')
    try {
      const result = await getProjectHistory(sessionId, 0, controller.signal)
      if (!requests.current('history', controller)) return
      setHistory(result)
      setHistoryLoaded(true)
    } catch (cause) {
      if (requests.current('history', controller)) {
        setHistoryLoaded(false)
        setHistoryError(cause instanceof Error ? cause.message : '读取历史失败')
      }
    } finally {
      if (requests.current('history', controller)) setHistoryLoading(false)
      requests.finish('history', controller)
    }
  }, [requests, sessionId])

  const loadMoreHistory = useCallback(async () => {
    if (historyLoading || !history.truncated) return
    const offset = history.commits.length
    const controller = requests.start('history-more')
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const result = await getProjectHistory(
        sessionId,
        offset,
        controller.signal,
      )
      if (!requests.current('history-more', controller)) return
      setHistory((previous) => {
        const seen = new Set(previous.commits.map((commit) => commit.hash))
        const commits = [
          ...previous.commits,
          ...result.commits.filter((commit) => !seen.has(commit.hash)),
        ]
        return { ...result, commits }
      })
    } catch (cause) {
      if (requests.current('history-more', controller))
        setHistoryError(cause instanceof Error ? cause.message : '读取历史失败')
    } finally {
      if (requests.current('history-more', controller)) setHistoryLoading(false)
      requests.finish('history-more', controller)
    }
  }, [history, historyLoading, requests, sessionId])

  async function selectHistoryCommit(commit: ProjectHistoryCommit) {
    if (selectedHistoryHash === commit.hash) {
      requests.cancelPrefix('commit:')
      requests.cancelPrefix('commit-diff:')
      setSelectedHistoryHash(null)
      setHistoryDetail(null)
      setHistoryDetailLoading(false)
      return
    }
    requests.cancelPrefix('commit:')
    requests.cancelPrefix('commit-diff:')
    const key = `commit:${commit.hash}`
    const controller = requests.start(key)
    setSelectedHistoryHash(commit.hash)
    setHistoryDetail(null)
    setHistoryDetailLoading(true)
    setSelectedHistoryFilePath(null)
    setHistoryDiffLoadingPath(null)
    setHistoryError('')
    try {
      const result = await getProjectCommit(
        sessionId,
        commit.hash,
        controller.signal,
      )
      if (requests.current(key, controller)) setHistoryDetail(result)
    } catch (cause) {
      if (requests.current(key, controller)) {
        setSelectedHistoryHash(null)
        setHistoryError(
          cause instanceof Error ? cause.message : '读取提交详情失败',
        )
      }
    } finally {
      if (requests.current(key, controller)) setHistoryDetailLoading(false)
      requests.finish(key, controller)
    }
  }

  async function selectHistoryFile(file: ProjectCommitFile) {
    if (!selectedHistoryHash) return
    if (selectedHistoryFilePath === file.path) {
      requests.cancelPrefix('commit-diff:')
      setSelectedHistoryFilePath(null)
      setHistoryDiffLoadingPath(null)
      return
    }
    const key = `commit-diff:${selectedHistoryHash}:${file.path}`
    setSelectedHistoryFilePath(file.path)
    setHistoryError('')
    requests.cancelPrefix('commit-diff:')
    if (historyDiffs[key] !== undefined) {
      setHistoryDiffLoadingPath(null)
      return
    }
    const controller = requests.start(key)
    setHistoryDiffLoadingPath(file.path)
    try {
      const response = await getProjectCommitDiff(
        sessionId,
        selectedHistoryHash,
        file.path,
        controller.signal,
      )
      if (!requests.current(key, controller)) return
      let content: HistoryRenderableDiff
      if (response.binary) {
        content = { kind: 'binary' }
      } else if (!response.complete) {
        content = { kind: 'limited', patch: response.patch }
      } else if (!response.patch.trim()) {
        content = { kind: 'empty' }
      } else {
        try {
          const { parseDiffFromFile } = await import('@pierre/diffs')
          if (!requests.current(key, controller)) return
          const fileDiff = parseDiffFromFile(
            { name: file.path, contents: response.oldContent },
            { name: file.path, contents: response.newContent },
            { context: 3 },
            true,
          )
          content = fileDiff.hunks.length
            ? { kind: 'file', fileDiff }
            : { kind: 'empty' }
        } catch {
          content = { kind: 'patch', patch: response.patch }
        }
      }
      if (requests.current(key, controller))
        setHistoryDiffs((previous) => ({ ...previous, [key]: content }))
    } catch (cause) {
      if (requests.current(key, controller))
        setHistoryError(
          cause instanceof Error ? cause.message : '读取提交差异失败',
        )
    } finally {
      if (requests.current(key, controller)) setHistoryDiffLoadingPath(null)
      requests.finish(key, controller)
    }
  }

  const refreshFiles = useCallback(
    async (path = '', hidden = showHidden) => {
      const key = `files:${path}`
      const controller = requests.start(key)
      const isCurrent = () => requests.current(key, controller)
      if (path === '') setFilesLoading(true)
      else setTreeLoadingPaths((previous) => new Set(previous).add(path))
      setError('')
      try {
        const result = await getProjectFiles(
          sessionId,
          path,
          hidden,
          controller.signal,
        )
        if (!isCurrent()) return
        if (path === '') {
          setFiles(result.files)
          setFilesTruncated(result.truncated)
        } else {
          setTreeDirectories((previous) => ({
            ...previous,
            [path]: result.files,
          }))
          setTreeTruncatedPaths((previous) => {
            const next = new Set(previous)
            if (result.truncated) next.add(path)
            else next.delete(path)
            return next
          })
        }
      } catch (cause) {
        if (!isCurrent()) return
        if (
          sessionId &&
          path &&
          cause instanceof Error &&
          ['无法读取目录', '目录不存在或路径无效', '路径不是目录'].includes(
            cause.message,
          )
        ) {
          try {
            const current = await getSessionDirectory(
              sessionId,
              controller.signal,
            )
            const result = await getProjectFiles(
              sessionId,
              '',
              hidden,
              controller.signal,
            )
            if (!isCurrent()) return
            resetBrowser()
            observedDirectory.current = current.id
            setDirectoryName(current.name)
            setFiles(result.files)
            setFilesTruncated(result.truncated)
            if (reviewTab === 'history') void refreshHistory()
            else void refreshChanges(hidden)
          } catch (retryCause) {
            if (isCurrent())
              setError(
                retryCause instanceof Error
                  ? retryCause.message
                  : '读取目录失败',
              )
          }
          return
        }
        setError(cause instanceof Error ? cause.message : '读取目录失败')
      } finally {
        if (isCurrent()) {
          if (path === '') setFilesLoading(false)
          else
            setTreeLoadingPaths((previous) => {
              const next = new Set(previous)
              next.delete(path)
              return next
            })
        }
        requests.finish(key, controller)
      }
    },
    [
      refreshChanges,
      refreshHistory,
      requests,
      resetBrowser,
      reviewTab,
      sessionId,
      showHidden,
    ],
  )

  async function refreshFileTree(hidden = showHidden) {
    const controller = requests.start('tree')
    const epoch = requests.epoch
    const paths = ['', ...expandedDirectories]
    requests.cancelPrefix('files:')
    setTreeDirectories({})
    setTreeTruncatedPaths(new Set())
    setTreeLoadingPaths(new Set())
    // Four workers bound parallel reads even when many directories are expanded.
    let index = 0
    await Promise.all(
      Array.from({ length: Math.min(4, paths.length) }, async () => {
        while (
          index < paths.length &&
          requests.epoch === epoch &&
          !controller.signal.aborted
        ) {
          await refreshFiles(paths[index++], hidden)
        }
      }),
    )
    requests.finish('tree', controller)
  }

  const loadContext = useEffectEvent((reset = false) => {
    if (reset) {
      resetBrowser()
      if (observedSession.current !== sessionId) {
        observedSession.current = sessionId
        observedDirectory.current = ''
        setDirectoryName('工作目录')
      }
    }
    if (reviewTab === 'history') void refreshHistory()
    else void refreshChanges(showHidden)
    if (tab === 'files') void refreshFiles()
  })
  useEffect(() => {
    // Defer starting reads to the microtask boundary so StrictMode's discarded
    // setup can clean up before it issues requests or clears displayed state.
    const controller = requests.start('context')
    queueMicrotask(() => {
      if (requests.current('context', controller)) loadContext(true)
    })
    return () => requests.clear()
  }, [requests, sessionId, showHidden])

  const acceptDirectory = useEffectEvent(
    (current: { id: string; name: string }) => {
      setError((previous) =>
        previous === '无法读取终端当前目录' ? '' : previous,
      )
      if (
        observedDirectory.current &&
        observedDirectory.current !== current.id
      ) {
        resetBrowser()
        loadContext()
      }
      observedDirectory.current = current.id
      setDirectoryName(current.name)
    },
  )
  useEffect(() => {
    if (!sessionId) return
    let active = true
    let inFlight = false
    const synchronize = async () => {
      if (!active || inFlight || document.visibilityState === 'hidden') return
      inFlight = true
      const controller = requests.start('cwd')
      try {
        const current = await getSessionDirectory(sessionId, controller.signal)
        if (active && requests.current('cwd', controller))
          acceptDirectory(current)
      } catch (cause) {
        if (active && requests.current('cwd', controller))
          setError(cause instanceof Error ? cause.message : '读取终端目录失败')
      } finally {
        requests.finish('cwd', controller)
        inFlight = false
      }
    }
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') requests.cancel('cwd')
      else void synchronize()
    }
    queueMicrotask(() => void synchronize())
    const timer = window.setInterval(() => void synchronize(), 1000)
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => {
      active = false
      requests.cancel('cwd')
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
  }, [requests, sessionId])

  async function toggleChange(change: ProjectChange) {
    const key = `diff:${change.path}`
    if (expandedChanges.has(change.path)) {
      requests.cancel(key)
      setExpandedChanges((previous) => {
        const next = new Set(previous)
        next.delete(change.path)
        return next
      })
      setDiffLoadingPaths((previous) => {
        const next = new Set(previous)
        next.delete(change.path)
        return next
      })
      return
    }
    setExpandedChanges((previous) => new Set(previous).add(change.path))
    setError('')
    if (changeDiffs[change.path] !== undefined) return
    const controller = requests.start(key)
    setDiffLoadingPaths((previous) => new Set(previous).add(change.path))
    try {
      const response = await getProjectDiff(
        sessionId,
        change.path,
        showHidden,
        controller.signal,
      )
      if (!requests.current(key, controller)) return
      let content: RenderableDiff
      if (!response.patch.trim()) content = { kind: 'empty' }
      else if (response.complete) {
        try {
          const { parseDiffFromFile } = await import('@pierre/diffs')
          if (!requests.current(key, controller)) return
          const fileDiff = parseDiffFromFile(
            { name: change.path, contents: response.oldContent },
            { name: change.path, contents: response.newContent },
            { context: 3 },
            true,
          )
          content = fileDiff.hunks.length
            ? { kind: 'file', fileDiff }
            : { kind: 'empty' }
        } catch {
          content = { kind: 'patch', patch: response.patch }
        }
      } else content = { kind: 'patch', patch: response.patch }
      if (requests.current(key, controller))
        setChangeDiffs((previous) => ({ ...previous, [change.path]: content }))
    } catch (cause) {
      if (requests.current(key, controller)) {
        setExpandedChanges((previous) => {
          const next = new Set(previous)
          next.delete(change.path)
          return next
        })
        setError(cause instanceof Error ? cause.message : '读取差异失败')
      }
    } finally {
      if (requests.current(key, controller))
        setDiffLoadingPaths((previous) => {
          const next = new Set(previous)
          next.delete(change.path)
          return next
        })
      requests.finish(key, controller)
    }
  }

  async function openFile(file: ProjectFile) {
    if (!file.isDir) {
      await loadPreview(file.path)
      return
    }
    setDirectory(file.path)
    clearPreview()
    setExpandedDirectories((previous) => {
      const next = new Set(previous)
      if (next.has(file.path)) next.delete(file.path)
      else next.add(file.path)
      return next
    })
    if (!expandedDirectories.has(file.path) && !treeDirectories[file.path])
      await refreshFiles(file.path)
  }

  function openChangedFile(change: ProjectChange) {
    const parent = change.path.split('/').slice(0, -1).join('/')
    setTab('files')
    setDirectory(parent)
    void loadPreview(change.path)
    const controller = requests.start('navigate')
    void (async () => {
      await refreshFiles('')
      let ancestor = ''
      for (const part of parent.split('/').filter(Boolean)) {
        if (controller.signal.aborted) return
        ancestor = ancestor ? `${ancestor}/${part}` : part
        const path = ancestor
        setExpandedDirectories((previous) => new Set(previous).add(path))
        if (!treeDirectories[path]) await refreshFiles(path)
      }
      requests.finish('navigate', controller)
    })()
  }

  function switchTab(next: Tab) {
    setTab(next)
    clearPreview()
    setError('')
    if (next === 'files') void refreshFiles()
    else if (reviewTab === 'history') void refreshHistory()
    else void refreshChanges(showHidden)
  }

  function switchReviewTab(next: ReviewTab) {
    setReviewTab(next)
    clearPreview()
    setError('')
    if (next === 'history') {
      if (!historyLoaded) void refreshHistory()
    } else void refreshChanges(showHidden)
  }

  return {
    tab,
    reviewTab,
    showHidden,
    changes,
    changesTruncated,
    changeTotals,
    directory,
    directoryName,
    files,
    treeDirectories,
    expandedDirectories,
    treeLoadingPaths,
    treeTruncatedPaths,
    filesTruncated,
    preview,
    expandedChanges,
    changeDiffs,
    diffLoadingPaths,
    changesLoading,
    history,
    historyTruncated: history.truncated,
    historyLoading,
    selectedHistoryHash,
    historyDetail,
    historyDetailLoading,
    selectedHistoryFilePath,
    historyDiffs,
    historyDiffLoadingPath,
    filesLoading,
    previewLoading,
    error:
      error ||
      (tab === 'changes'
        ? reviewTab === 'history'
          ? historyError
          : changesError
        : ''),
    setDirectory,
    setError,
    clearPreview,
    refreshChanges,
    refreshHistory,
    loadMoreHistory,
    refreshFiles,
    refreshFileTree,
    toggleChange,
    selectHistoryCommit,
    selectHistoryFile,
    openFile,
    openChangedFile,
    switchTab,
    switchReviewTab,
    captureContext: () => {
      const epoch = requests.epoch
      return () => requests.epoch === epoch
    },
    changeHiddenVisibility: () => setShowHidden((value) => !value),
  }
}
