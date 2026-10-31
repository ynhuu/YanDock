import type { SessionInfo } from './protocol'
import type { SessionState } from './sessionState'

export type SessionList = {
  sessions: SessionInfo[]
  activeId: string | null
  states: Record<string, SessionState>
}

type Action =
  | { type: 'reset'; sessions: SessionInfo[]; preferredActiveId?: string | null }
  | { type: 'add'; session: SessionInfo }
  | { type: 'select'; id: string }
  | { type: 'move'; id: string; targetId: string }
  | { type: 'remove'; id: string }
  | { type: 'status'; id: string; state: SessionState }

export const emptySessionList: SessionList = {
  sessions: [],
  activeId: null,
  states: {},
}

// Update list, selection and connection states atomically. In particular,
// async closes must use the latest selection, not the render that started them.
export function sessionListReducer(
  state: SessionList,
  action: Action,
): SessionList {
  switch (action.type) {
    case 'reset':
      return {
        sessions: action.sessions,
        activeId: action.sessions.some(
          (session) => session.id === action.preferredActiveId,
        )
          ? (action.preferredActiveId ?? null)
          : (action.sessions[0]?.id ?? null),
        states: {},
      }
    case 'add':
      return {
        ...state,
        sessions: [...state.sessions, action.session],
        activeId: action.session.id,
      }
    case 'select':
      if (state.activeId === action.id) return state
      return state.sessions.some((session) => session.id === action.id)
        ? { ...state, activeId: action.id }
        : state
    case 'status':
      if (state.states[action.id] === action.state) return state
      return state.sessions.some((session) => session.id === action.id)
        ? { ...state, states: { ...state.states, [action.id]: action.state } }
        : state
    case 'move': {
      const from = state.sessions.findIndex(
        (session) => session.id === action.id,
      )
      const to = state.sessions.findIndex(
        (session) => session.id === action.targetId,
      )
      if (from < 0 || to < 0 || from === to) return state
      const sessions = [...state.sessions]
      sessions.splice(from, 1)
      sessions.splice(to, 0, state.sessions[from])
      return { ...state, sessions }
    }
    case 'remove': {
      const index = state.sessions.findIndex(
        (session) => session.id === action.id,
      )
      if (index === -1) return state
      const sessions = state.sessions.filter(
        (session) => session.id !== action.id,
      )
      const states = { ...state.states }
      delete states[action.id]
      return {
        sessions,
        activeId:
          state.activeId === action.id
            ? (sessions[Math.min(index, sessions.length - 1)]?.id ?? null)
            : state.activeId,
        states,
      }
    }
  }
}
