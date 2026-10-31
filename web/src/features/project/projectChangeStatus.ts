import type { ProjectChange } from './projectApi'

export type ProjectChangeStatus = Pick<ProjectChange, 'status' | 'label'>

export function changeKind(change: ProjectChangeStatus | undefined) {
  if (!change) return undefined
  if (
    change.label === '新增' ||
    change.status.includes('A') ||
    change.status === '??'
  )
    return 'added'
  if (change.label === '删除' || change.status.includes('D')) return 'deleted'
  return 'modified'
}

export function changeMarker(change: ProjectChangeStatus | undefined) {
  if (change?.status === '??') return 'U'
  const kind = changeKind(change)
  return kind === 'added' ? 'A' : kind === 'deleted' ? 'D' : 'M'
}
