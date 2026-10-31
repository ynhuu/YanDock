package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

func decode(w http.ResponseWriter, r *http.Request, target any) error {
	if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
		return errors.New("需要 application/json")
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	return decodeJSON(r.Body, target)
}

// Both HTTP bodies and WebSocket controls accept exactly one JSON value and
// reject unknown fields. Transport-specific size limits remain at the caller.
func decodeJSON(reader io.Reader, target any) error {
	d := json.NewDecoder(reader)
	d.DisallowUnknownFields()
	if err := d.Decode(target); err != nil {
		return err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return errors.New("请求只能包含一个 JSON 对象")
	}
	return nil
}

func respond(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}
