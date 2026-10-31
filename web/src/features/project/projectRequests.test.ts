import { expect, it } from 'vitest'
import { ProjectRequests } from './projectRequests'

it('替换同一路径时取消旧请求，旧请求完成不移除新请求', () => {
  const requests = new ProjectRequests()
  const old = requests.start('preview')
  const current = requests.start('preview')
  expect(old.signal.aborted).toBe(true)
  requests.finish('preview', old)
  expect(requests.current('preview', current)).toBe(true)
  requests.finish('preview', current)
  expect(requests.current('preview', current)).toBe(false)
})

it('文件与差异可独立加载，刷新差异只取消差异请求', () => {
  const requests = new ProjectRequests()
  const file = requests.start('files:docs')
  const diff = requests.start('diff:README.md')
  requests.cancelPrefix('diff:')
  expect(diff.signal.aborted).toBe(true)
  expect(requests.current('files:docs', file)).toBe(true)
})

it('上下文切换与卸载取消所有请求，并使旧的多步任务失效', () => {
  const requests = new ProjectRequests()
  const oldEpoch = requests.epoch
  const controllers = [
    'preview',
    'files:',
    'diff:a',
    'changes',
    'cwd',
    'tree',
  ].map((key) => requests.start(key))
  requests.clear()
  expect(controllers.every((controller) => controller.signal.aborted)).toBe(
    true,
  )
  expect(requests.epoch).not.toBe(oldEpoch)
  const next = requests.start('preview')
  requests.finish('preview', controllers[0])
  expect(requests.current('preview', next)).toBe(true)
})
