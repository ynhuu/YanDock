package server

import (
	"context"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"yandock/internal/session"
)

func (s *Server) terminal(w http.ResponseWriter, r *http.Request) {
	if !sameOrigin(r) {
		http.Error(w, "请求来源不允许", http.StatusForbidden)
		return
	}
	revoked, valid := s.auth.Watch(r)
	if !valid {
		http.Error(w, "请先登录", http.StatusUnauthorized)
		return
	}
	current := s.manager.Get(r.PathValue("id"))
	if current == nil {
		http.NotFound(w, r)
		return
	}
	output, replay, detach, err := current.Attach()
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	defer detach()
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true}) // Origin already strictly checked above.
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(8192)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	if err := writeJSON(ctx, conn, map[string]any{"type": "hello", "version": 2, "replay": !replay.Fresh, "cols": replay.Cols, "rows": replay.Rows, "truncated": replay.Truncated}); err != nil {
		return
	}
	current.ConfirmAttach(output)
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		defer cancel()
		s.readTerminal(ctx, conn, r, current)
	}()
	defer func() { cancel(); _ = conn.CloseNow(); <-readDone }()
	// Attach captured the boundary under the same lock as PTY reads. All
	// retained frames are sent before the live queue, with input gated in the UI.
	frames := append([]session.ReplayFrame{{Data: replay.Modes}}, replay.Frames...)
	for _, frame := range frames {
		select {
		case <-revoked:
			_ = conn.Close(4001, "登录已失效")
			return
		default:
		}
		var err error
		if frame.Cols != 0 {
			err = writeJSON(ctx, conn, map[string]any{"type": "replay-size", "cols": frame.Cols, "rows": frame.Rows})
		} else {
			writeCtx, stop := context.WithTimeout(ctx, 5*time.Second)
			err = conn.Write(writeCtx, websocket.MessageBinary, frame.Data)
			stop()
		}
		if err != nil {
			return
		}
	}
	if !replay.Fresh {
		if err := writeJSON(ctx, conn, map[string]any{"type": "replay-end", "running": current.Info().Running}); err != nil {
			return
		}
	}

	s.writeTerminal(ctx, conn, r, current, output, revoked, &replay)
}

// The reader owns input and resize ordering. Returning cancels the writer;
// terminal() waits for this goroutine before releasing the control slot.
func (s *Server) readTerminal(ctx context.Context, conn *websocket.Conn, r *http.Request, current *session.Session) {
	for {
		kind, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		if !s.auth.Valid(r) {
			_ = conn.Close(4001, "登录已失效")
			return
		}
		if kind == websocket.MessageBinary {
			err = current.Write(data)
		} else {
			var c control
			c, err = parseControl(data)
			if err == nil {
				err = current.Resize(c.Cols, c.Rows)
			}
		}
		if err != nil {
			_ = conn.Close(websocket.StatusPolicyViolation, "终端输入或协议无效")
			return
		}
	}
}

// Idle connections also recheck authentication; closing a connection never
// closes the PTY, which remains owned by the session manager.
func (s *Server) writeTerminal(ctx context.Context, conn *websocket.Conn, r *http.Request, current *session.Session, output <-chan []byte, revoked <-chan struct{}, replay *session.Replay) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-revoked:
			_ = conn.Close(4001, "登录已失效")
			return
		case <-ticker.C:
			if !s.auth.Valid(r) {
				_ = conn.Close(4001, "登录已失效")
				return
			}
			pingCtx, stop := context.WithTimeout(ctx, 5*time.Second)
			err := conn.Ping(pingCtx)
			stop()
			if err != nil {
				return
			}
		case data, ok := <-output:
			if !ok {
				running := current.Info().Running
				reason := "输出中断，自动重连"
				if !running {
					reason = "进程已结束"
				}
				_ = writeJSON(ctx, conn, map[string]any{"type": "status", "message": reason, "retryable": running})
				_ = conn.Close(websocket.StatusNormalClosure, reason)
				return
			}
			data = replay.FilterLive(data)
			if len(data) == 0 {
				continue
			}
			writeCtx, stop := context.WithTimeout(ctx, 5*time.Second)
			err := conn.Write(writeCtx, websocket.MessageBinary, data)
			stop()
			if err != nil {
				return
			}
		}
	}
}
