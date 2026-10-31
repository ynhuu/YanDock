import { describe, expect, it } from 'vitest'
import { projectFileIconName } from './projectFileIcons'

describe('OpenCode file type icons', () => {
  it.each([
    ['README.md', 'Readme'],
    ['docs/使用指南.md', 'Markdown'],
    ['internal/server/project_files.go', 'Go'],
    ['web/e2e/layout.spec.ts', 'TestTs'],
    ['web/src/ProjectDrawer.tsx', 'React_ts'],
    ['C:\\repo\\.gitignore', 'Git'],
    ['archive.unknown', 'Document'],
  ])('maps %s to %s', (path, icon) => {
    expect(projectFileIconName(path)).toBe(icon)
  })
})
