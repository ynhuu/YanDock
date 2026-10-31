import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { failed: boolean }

// On a phone a blank page gives no clue at all. Any render error — including a
// lazy chunk that no longer exists after a redeploy — must say so instead.
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('界面渲染失败', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center">
        <div className="max-w-sm space-y-3">
          <h1 className="text-lg font-semibold">界面加载失败</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            页面资源可能在服务更新后失效。重新加载页面即可恢复，终端进程不受影响。
          </p>
          <button
            type="button"
            className="control bg-primary text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            重新加载页面
          </button>
        </div>
      </main>
    )
  }
}
