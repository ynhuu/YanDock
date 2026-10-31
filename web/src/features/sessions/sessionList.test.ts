import { describe, expect, it } from 'vitest'
import {
  emptySessionList,
  sessionListReducer,
  type SessionList,
} from './sessionList'

const sessions = [1, 2, 3].map((seq) => ({
  id: String(seq),
  seq,
  running: true,
}))
const initial: SessionList = {
  sessions,
  activeId: '2',
  states: { '2': 'live' },
}

describe('workspace session list', () => {
  it('preserves state identity for repeated selection and status events', () => {
    expect(sessionListReducer(initial, { type: 'select', id: '2' })).toBe(
      initial,
    )
    expect(
      sessionListReducer(initial, { type: 'status', id: '2', state: 'live' }),
    ).toBe(initial)
  })

  it('moves tabs in either direction without changing IDs, labels, active tab or states', () => {
    const moved = sessionListReducer(initial, {
      type: 'move',
      id: '1',
      targetId: '3',
    })
    expect(moved.sessions).toEqual([sessions[1], sessions[2], sessions[0]])
    expect(moved.activeId).toBe(initial.activeId)
    expect(moved.states).toBe(initial.states)
    expect(initial.sessions).toEqual(sessions)
    expect(
      sessionListReducer(moved, { type: 'move', id: '1', targetId: '2' }),
    ).toEqual(initial)
    for (const action of [
      { type: 'move', id: 'missing', targetId: '2' },
      { type: 'move', id: '1', targetId: 'missing' },
      { type: 'move', id: '1', targetId: '1' },
    ] as const) {
      expect(sessionListReducer(initial, action)).toBe(initial)
    }
  })

  it('resets selection and connection states together', () => {
    expect(
      sessionListReducer(initial, { type: 'reset', sessions: [] }),
    ).toEqual(emptySessionList)
    expect(sessionListReducer(initial, { type: 'reset', sessions })).toEqual({
      sessions,
      activeId: '1',
      states: {},
    })
  })

  it('restores a preferred active session when it still exists', () => {
    expect(
      sessionListReducer(initial, {
        type: 'reset',
        sessions,
        preferredActiveId: '2',
      }).activeId,
    ).toBe('2')
    expect(
      sessionListReducer(initial, {
        type: 'reset',
        sessions,
        preferredActiveId: 'missing',
      }).activeId,
    ).toBe('1')
  })

  it('selects newly created sessions without changing existing states', () => {
    const session = { id: '4', seq: 4, running: true }
    expect(sessionListReducer(initial, { type: 'add', session })).toEqual({
      sessions: [...sessions, session],
      activeId: '4',
      states: initial.states,
    })
  })

  it('selects the next or previous tab when removing the active tab', () => {
    const next = sessionListReducer(initial, { type: 'remove', id: '2' })
    expect(next).toEqual({
      sessions: [sessions[0], sessions[2]],
      activeId: '3',
      states: {},
    })
    const previous = sessionListReducer(next, { type: 'remove', id: '3' })
    expect(previous.activeId).toBe('1')
    expect(sessionListReducer(previous, { type: 'remove', id: '1' })).toEqual(
      emptySessionList,
    )
  })

  it('keeps the latest selection if an async close completes after a tab switch', () => {
    const selected = sessionListReducer(initial, { type: 'select', id: '1' })
    const result = sessionListReducer(selected, { type: 'remove', id: '2' })
    expect(result.activeId).toBe('1')
    expect(result.sessions.map((session) => session.seq)).toEqual([1, 3])
    expect(initial.sessions).toHaveLength(3)
    expect(initial.states).toEqual({ '2': 'live' })
  })

  it('applies consecutive removals to the latest list', () => {
    const first = sessionListReducer(initial, { type: 'remove', id: '1' })
    expect(sessionListReducer(first, { type: 'remove', id: '2' })).toEqual({
      sessions: [sessions[2]],
      activeId: '3',
      states: {},
    })
  })

  it('ignores removed sessions and their late status events', () => {
    for (const action of [
      { type: 'remove', id: 'missing' },
      { type: 'select', id: 'missing' },
      { type: 'status', id: 'missing', state: 'live' },
    ] as const) {
      expect(sessionListReducer(initial, action)).toBe(initial)
    }
    expect(
      sessionListReducer(initial, { type: 'status', id: '2', state: 'retry' })
        .states,
    ).toEqual({ '2': 'retry' })
  })
})
