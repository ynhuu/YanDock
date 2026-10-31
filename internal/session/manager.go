package session

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"
)

// Manager owns the session registry and process lifetimes, independently of
// browser connections. mu guards the registry, creation order and shutdown.
type Manager struct {
	mu       sync.Mutex
	sessions map[string]*Session
	order    []string
	program  string
	args     []string
	dir      string
	closed   bool
}

func NewManager(program string, args []string, dir string) *Manager {
	return &Manager{sessions: make(map[string]*Session), program: program, args: append([]string(nil), args...), dir: dir}
}

// WorkingDir returns the immutable project directory used by all sessions.
func (m *Manager) WorkingDir() string { return m.dir }

func (m *Manager) Create(cols, rows uint16) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil, ErrStopped
	}
	if !ValidSize(cols, rows) {
		return nil, errors.New("终端尺寸无效")
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return nil, err
	}
	s, err := startSession(hex.EncodeToString(id[:]), m.program, m.args, m.dir, cols, rows)
	if err != nil {
		return nil, err
	}
	// With n occupied labels, the first free label is at most n+1.
	// Larger labels cannot affect this search, even after many removals.
	used := make([]bool, len(m.sessions)+2)
	for _, current := range m.sessions {
		if current.seq < len(used) {
			used[current.seq] = true
		}
	}
	s.seq = 1
	for used[s.seq] {
		s.seq++
	}
	m.sessions[s.id] = s
	m.order = append(m.order, s.id)
	go s.read()
	go s.wait()
	return s, nil
}

// List returns the live session records in creation order. Ended sessions stay
// listed until they are closed, so tabs can show their final state.
func (m *Manager) List() []Info {
	m.mu.Lock()
	defer m.mu.Unlock()
	list := make([]Info, 0, len(m.order))
	for _, id := range m.order {
		if s := m.sessions[id]; s != nil {
			list = append(list, s.Info())
		}
	}
	return list
}

// Get returns the session with that ID, or nil.
func (m *Manager) Get(id string) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[id]
}

func (m *Manager) Remove(id string) bool {
	m.mu.Lock()
	s := m.sessions[id]
	if s == nil {
		m.mu.Unlock()
		return false
	}
	delete(m.sessions, id)
	for i, existing := range m.order {
		if existing == id {
			m.order = append(m.order[:i], m.order[i+1:]...)
			break
		}
	}
	m.mu.Unlock()
	// Close outside the lock: it waits for the process group to exit.
	s.Close()
	return true
}

func (m *Manager) Close() {
	m.mu.Lock()
	m.closed = true
	remaining := make([]*Session, 0, len(m.order))
	for _, id := range m.order {
		if s := m.sessions[id]; s != nil {
			remaining = append(remaining, s)
		}
	}
	m.sessions = make(map[string]*Session)
	m.order = nil
	m.mu.Unlock()
	for _, s := range remaining {
		s.Close()
	}
}
