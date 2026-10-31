import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { AppErrorBoundary } from './app/AppErrorBoundary'
import './app/styles.css'

// Terminal resources also support effect cleanup/remount; avoid opening a
// throwaway WebSocket during StrictMode's development-only initial replay.
const root = document.getElementById('root')
if (!root) throw new Error('缺少应用根节点')
createRoot(root).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
)
