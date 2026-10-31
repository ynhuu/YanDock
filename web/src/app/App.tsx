import { LoginScreen } from '../features/auth/LoginScreen'
import { Workspace } from '../features/workspace/Workspace'
import { useWorkspace } from '../features/workspace/useWorkspace'
import { useThemePreference } from '../shared/theme/useThemePreference'
import { usePageGestures } from '../shared/viewport/usePageGestures'
import { useVisualViewport } from '../shared/viewport/useVisualViewport'

export function App() {
  const { theme, preference, cycleTheme } = useThemePreference()
  const workspace = useWorkspace()
  useVisualViewport()
  usePageGestures()

  if (workspace.loading)
    return (
      <main className="grid min-h-dvh place-items-center text-muted-foreground">
        正在连接 YanDock…
      </main>
    )

  if (!workspace.authenticated)
    return (
      <LoginScreen
        busy={workspace.busy}
        error={workspace.error}
        onLogin={workspace.login}
      />
    )

  return (
    <Workspace
      workspace={workspace}
      theme={theme}
      preference={preference}
      onCycleTheme={cycleTheme}
    />
  )
}
