import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { request, Unauthorized } from '../../shared/api/client'
import { createSession, getSessions } from '../sessions/api'
import type { TerminalEvent } from '../sessions/sessionState'
import { emptySessionList, sessionListReducer } from '../sessions/sessionList'

const activeSessionStorageKey = 'yandock-active-session-id'

function getPreferredActiveSessionId() {
  try {
    return localStorage.getItem(activeSessionStorageKey)
  } catch {
    return null
  }
}

// Coordinates authentication and the session list; terminal connections are
// owned by the mounted Terminal components, not by workspace navigation.
export function useWorkspace() {
  const [authenticated, setAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [{ sessions, activeId, states }, dispatch] = useReducer(
    sessionListReducer,
    emptySessionList,
  )
  const [closingId, setClosingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const loggingOut = useRef(false)

  useEffect(() => {
    let active = true
    void getSessions()
      .then((list) => {
        if (active) {
          setAuthenticated(true)
          dispatch({
            type: 'reset',
            sessions: list,
            preferredActiveId: getPreferredActiveSessionId(),
          })
        }
      })
      .catch((err: unknown) => {
        if (active && !(err instanceof Unauthorized))
          setError(err instanceof Error ? err.message : '服务不可用')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!authenticated || !activeId) return
    try {
      localStorage.setItem(activeSessionStorageKey, activeId)
    } catch {
      // Session selection still works for this page if storage is unavailable.
    }
  }, [activeId, authenticated])

  async function action(work: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (err) {
      if (err instanceof Unauthorized) {
        setAuthenticated(false)
        dispatch({ type: 'reset', sessions: [] })
      }
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  function login(credential: string) {
    loggingOut.current = false
    void action(async () => {
      await request('/login', 'POST', { token: credential })
      const list = await getSessions()
      setAuthenticated(true)
      dispatch({
        type: 'reset',
        sessions: list,
        preferredActiveId: getPreferredActiveSessionId(),
      })
    })
  }

  const handleEvent = useCallback((id: string, event: TerminalEvent) => {
    if (event === 'unauthorized') {
      if (loggingOut.current) return
      setAuthenticated(false)
      dispatch({ type: 'reset', sessions: [] })
      setError('登录已失效或已在其他设备登录，请重新登录')
      return
    }
    // A session closed elsewhere (another tab or the ⋯ menu) leaves the list.
    if (event === 'gone') {
      dispatch({ type: 'remove', id })
      return
    }
    dispatch({ type: 'status', id, state: event })
  }, [])

  function addSession(measure: () => Promise<{ cols: number; rows: number }>) {
    void action(async () => {
      const info = await createSession(await measure())
      dispatch({ type: 'add', session: info })
    })
  }

  function closeSession(id: string) {
    setClosingId(id)
    void action(async () => {
      try {
        await request(`/session/${id}`, 'DELETE')
        dispatch({ type: 'remove', id })
      } finally {
        setClosingId((current) => (current === id ? null : current))
      }
    })
  }

  function logout() {
    loggingOut.current = true
    void action(async () => {
      try {
        await request('/logout', 'POST')
      } catch (error) {
        loggingOut.current = false
        throw error
      }
      dispatch({ type: 'reset', sessions: [] })
      setAuthenticated(false)
    })
  }

  return {
    authenticated,
    loading,
    busy,
    sessions,
    activeId,
    closingId,
    states,
    error,
    login,
    logout,
    selectSession: (id: string) => dispatch({ type: 'select', id }),
    moveSession: (id: string, targetId: string) =>
      dispatch({ type: 'move', id, targetId }),
    addSession,
    closeSession,
    handleEvent,
  }
}
