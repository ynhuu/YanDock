import spriteUrl from './opencode-file-icons.svg?url'
import { projectFileIconName } from './projectFileIcons'

export function ProjectFileIcon({
  path,
  className,
}: {
  path: string
  className: string
}) {
  const name = projectFileIconName(path)
  return (
    <svg
      className={className}
      data-component="file-icon"
      data-icon-name={name}
      aria-hidden="true"
    >
      <use href={`${spriteUrl}#${name}`} />
    </svg>
  )
}
