import type { ProjectHistoryCommit } from './projectApi'

export const historyGraphColors = [
  '#64b5f6',
  '#81c784',
  '#ffb74d',
  '#ba68c8',
  '#4dd0e1',
  '#e57373',
]

export type HistoryGraphEdge = {
  fromLane: number
  toLane: number
  color: string
}

export type HistoryGraphRow = {
  commit: ProjectHistoryCommit
  incoming: boolean
  lane: number
  lanes: string[]
  edges: HistoryGraphEdge[]
}

export function layoutHistoryGraph(
  commits: ProjectHistoryCommit[],
): HistoryGraphRow[] {
  const rows: HistoryGraphRow[] = []
  let lanes: string[] = []

  for (const commit of commits) {
    let lane = lanes.indexOf(commit.hash)
    const incoming = lane !== -1
    if (lane === -1) {
      lane = lanes.length
      lanes = [...lanes, commit.hash]
    }

    const lanesBefore = lanes
    const remaining = lanes.filter((hash) => hash !== commit.hash)
    const nextLanes = [...remaining]
    const edges: HistoryGraphEdge[] = []
    let inserted = 0

    for (const parent of commit.parents) {
      const existing = nextLanes.indexOf(parent)
      const targetLane = existing === -1 ? lane + inserted : existing
      if (existing === -1) {
        nextLanes.splice(targetLane, 0, parent)
        inserted += 1
      }
      edges.push({
        fromLane: lane,
        toLane: targetLane,
        color: historyGraphColors[lane % historyGraphColors.length],
      })
    }

    rows.push({
      commit,
      incoming,
      lane,
      lanes: lanesBefore,
      edges,
    })
    lanes = nextLanes
  }

  return rows
}

export function historyGraphWidth(rows: HistoryGraphRow[]) {
  const maxLanes = rows.reduce(
    (maximum, row) =>
      Math.max(
        maximum,
        row.lanes.length,
        ...row.edges.map((edge) => edge.toLane + 1),
      ),
    1,
  )
  return 28 + maxLanes * 16
}
