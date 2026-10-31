import type { ReactNode } from 'react'
import { Icon } from './Icon'

export type StatusToastVariant = 'info' | 'success' | 'warning' | 'error'

const variantIcons = {
  info: 'info',
  success: 'check',
  warning: 'warning',
  error: 'error',
} as const

type Props = {
  variant: StatusToastVariant
  children: ReactNode
  progress?: number
  action?: ReactNode
}

export function StatusToast({ variant, children, progress, action }: Props) {
  const isError = variant === 'error'
  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={`status-toast status-toast-${variant}`}
    >
      <span className="status-toast-icon">
        <Icon name={variantIcons[variant]} />
      </span>
      <div className="status-toast-content">
        <p>{children}</p>
        {progress !== undefined && (
          <div
            className="status-toast-progress"
            role="progressbar"
            aria-label="下载进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
      {action && <div className="status-toast-action">{action}</div>}
    </div>
  )
}
