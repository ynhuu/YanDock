package server

import (
	"net/http/httptest"
	"testing"
)

func TestSameOrigin(t *testing.T) {
	for _, tc := range []struct {
		name, requestURL, origin string
		allowed                  bool
	}{
		{"HTTP", "http://dock.example.com/", "http://dock.example.com", true},
		{"HTTPS", "https://dock.example.com/", "https://dock.example.com", true},
		{"HTTPS proxy", "http://dock.example.com/", "https://dock.example.com", true},
		{"HTTPS scheme case", "http://dock.example.com/", "HTTPS://dock.example.com", true},
		{"missing", "http://dock.example.com/", "", false},
		{"null", "http://dock.example.com/", "null", false},
		{"other host", "http://dock.example.com/", "https://evil.example", false},
		{"other port", "http://dock.example.com:8080/", "http://dock.example.com", false},
		{"credentials", "http://dock.example.com/", "http://user@dock.example.com", false},
		{"path", "http://dock.example.com/", "http://dock.example.com/extra", false},
		{"query", "http://dock.example.com/", "http://dock.example.com?extra=1", false},
		{"fragment", "http://dock.example.com/", "http://dock.example.com#extra", false},
		{"unsupported scheme", "http://dock.example.com/", "ftp://dock.example.com", false},
		{"HTTP origin on TLS", "https://dock.example.com/", "http://dock.example.com", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("POST", tc.requestURL, nil)
			r.Header.Set("Origin", tc.origin)
			// Client-supplied proxy headers cannot change the allowed host/scheme.
			r.Header.Set("X-Forwarded-Host", "evil.example")
			r.Header.Set("X-Forwarded-Proto", "https")
			if got := sameOrigin(r); got != tc.allowed {
				t.Fatalf("sameOrigin = %v, want %v", got, tc.allowed)
			}
		})
	}
}
