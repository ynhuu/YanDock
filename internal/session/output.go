package session

const outputQueueSize = 64

// Attach atomically captures retained output and claims the single control slot.
func (s *Session) Attach() (<-chan []byte, Replay, func(), error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.running && s.replay.cols == 0 {
		return nil, Replay{}, nil, ErrStopped
	}
	if s.output != nil {
		return nil, Replay{}, nil, ErrConflict
	}
	ch := make(chan []byte, outputQueueSize) // at most 256 KiB of queued terminal bytes
	s.output = ch
	s.outputDone = make(chan struct{})
	s.outputActive = true
	snapshot := s.replay.snapshot(s.cursorMode)
	// Startup output is delivered as live data, so genuine terminal queries
	// can receive their first response. Only subsequent connections replay.
	snapshot.Fresh = !s.attached && !snapshot.Truncated && s.running
	if snapshot.Fresh {
		for _, frame := range snapshot.Frames {
			if frame.Cols != 0 {
				snapshot.Fresh = false
				break
			}
		}
	}

	if !s.running {
		s.outputActive = false
		close(ch)
	}
	return ch, snapshot, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.output == ch {
			if s.outputActive {
				s.outputActive = false
				close(s.outputDone)
			}
			s.output = nil
			s.outputDone = nil
		}
	}, nil
}

// ConfirmAttach records a delivered handshake, not an attempted HTTP upgrade.
// A delayed callback from a released controller must not affect its successor.
func (s *Session) ConfirmAttach(output <-chan []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if output != nil && s.output == output {
		s.attached = true
	}
}

// stopOutput releases a PTY reader blocked by a full queue during forced close.
// Keep the channel open so the writer can drain queued bytes before wait closes it.
func (s *Session) stopOutput() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.output != nil && s.outputActive {
		s.outputActive = false
		close(s.outputDone)
	}
}

func (s *Session) read() {
	defer close(s.readerDone)
	buf := make([]byte, 4096)
	for {
		n, err := s.pty.Read(buf)
		if n > 0 {
			s.mu.Lock()
			before := s.cursorMode
			s.cursorMode.consume(buf[:n])
			s.replay.append(buf[:n], before, s.cursorMode)
			output, outputDone, active := s.output, s.outputDone, s.outputActive
			s.mu.Unlock()
			if output != nil && active {
				select {
				case <-outputDone:
					// Retained in replay; no live controller needs these bytes.
				default:
					data := append([]byte(nil), buf[:n]...)
					select {
					case output <- data:
						// A full queue applies backpressure until the writer catches up.
					case <-outputDone:
						// Detach must release a blocked send so PTY output can be drained.
					}
				}
			}
		}
		if err != nil {
			return
		}
	}
}
