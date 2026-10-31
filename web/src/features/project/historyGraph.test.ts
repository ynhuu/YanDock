import { expect, it } from 'vitest'
import { historyGraphWidth, layoutHistoryGraph } from './historyGraph'
import type { ProjectHistoryCommit } from './projectApi'

function commit(hash: string, parents: string[]): ProjectHistoryCommit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents,
    subject: hash,
    authorName: 'Test',
    authoredAt: '2026-01-01T00:00:00Z',
  }
}

it('线性历史保持在同一条线路', () => {
  const rows = layoutHistoryGraph([
    commit('c', ['b']),
    commit('b', ['a']),
    commit('a', []),
  ])

  expect(rows.map((row) => row.lane)).toEqual([0, 0, 0])
  expect(rows.map((row) => row.incoming)).toEqual([false, true, true])
  expect(
    rows.flatMap((row) =>
      row.edges.map((edge) => [edge.fromLane, edge.toLane]),
    ),
  ).toEqual([
    [0, 0],
    [0, 0],
  ])
})

it('合并历史会展开并重新汇合线路', () => {
  const rows = layoutHistoryGraph([
    commit('merge', ['feature', 'main']),
    commit('feature', ['base']),
    commit('main', ['base']),
    commit('base', []),
  ])

  expect(rows.map((row) => row.lane)).toEqual([0, 0, 1, 0])
  expect(rows.map((row) => row.incoming)).toEqual([false, true, true, true])
  expect(rows[0].edges.map((edge) => edge.toLane)).toEqual([0, 1])
  expect(rows[2].edges.map((edge) => edge.toLane)).toEqual([0])
  expect(historyGraphWidth(rows)).toBeGreaterThan(28)
})
