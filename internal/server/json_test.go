package server

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeRequest(t *testing.T) {
	for _, tc := range []struct {
		name, contentType, body string
		invalid                 bool
	}{
		{name: "valid", contentType: "application/json", body: `{"token":"test"}`},
		{name: "charset", contentType: "application/json; charset=utf-8", body: `{"token":"test"}`},
		{name: "missing content type", body: `{"token":"test"}`, invalid: true},
		{name: "wrong content type", contentType: "text/plain", body: `{"token":"test"}`, invalid: true},
		{name: "unknown field", contentType: "application/json", body: `{"token":"test","extra":1}`, invalid: true},
		{name: "multiple values", contentType: "application/json", body: `{"token":"test"} {}`, invalid: true},
		{name: "trailing garbage", contentType: "application/json", body: `{"token":"test"} x`, invalid: true},
		{name: "empty", contentType: "application/json", invalid: true},
		{name: "oversized", contentType: "application/json", body: `{"token":"` + strings.Repeat("x", 16*1024) + `"}`, invalid: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("POST", "/api/login", strings.NewReader(tc.body))
			r.Header.Set("Content-Type", tc.contentType)
			var body struct {
				Token string `json:"token"`
			}
			err := decode(httptest.NewRecorder(), r, &body)
			if (err != nil) != tc.invalid {
				t.Fatalf("decode error = %v, invalid = %v", err, tc.invalid)
			}
			if !tc.invalid && body.Token != "test" {
				t.Fatalf("decoded token = %q", body.Token)
			}
		})
	}
}
