import { expect, it } from 'vitest'
import { changeKind, changeMarker } from './projectChangeStatus'
import type { ProjectChange } from './projectApi'

it.each([
  ['??', '新增', 'added', 'U'],
  ['A ', '新增', 'added', 'A'],
  [' D', '删除', 'deleted', 'D'],
  [' M', '修改', 'modified', 'M'],
  ['R ', '重命名', 'modified', 'M'],
  ['UU', '冲突', 'modified', 'M'],
])('文件树与 Git 更改共享 %s 的显示映射', (status, label, kind, marker) => {
  const change: ProjectChange = {
    path: 'file',
    status,
    label,
    additions: 0,
    deletions: 0,
    statsComplete: true,
  }
  expect(changeKind(change)).toBe(kind)
  expect(changeMarker(change)).toBe(marker)
})

it('未更改的文件不显示状态类型', () => {
  expect(changeKind(undefined)).toBeUndefined()
})
