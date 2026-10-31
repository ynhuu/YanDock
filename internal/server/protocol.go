package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/coder/websocket"
)

type control struct {
	Type    string `json:"type"`
	Version int    `json:"version,omitempty"`
	Cols    uint16 `json:"cols,omitempty"`
	Rows    uint16 `json:"rows,omitempty"`
}

func parseControl(data []byte) (control, error) {
	var c control
	if err := decodeJSON(bytes.NewReader(data), &c); err != nil {
		return control{}, err
	}
	if c.Type != "resize" {
		return control{}, errors.New("未知控制消息")
	}
	if c.Version != 0 {
		return control{}, errors.New("无效字段")
	}
	return c, nil
}

func writeJSON(ctx context.Context, conn *websocket.Conn, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return conn.Write(ctx, websocket.MessageText, data)
}
