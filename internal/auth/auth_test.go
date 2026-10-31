package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSessionExpiryAndLogout(t *testing.T) {
	a := New(strings.Repeat("x", 32))
	loginRequest := httptest.NewRequest("POST", "https://dock.example.com/api/login", nil)
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	a.now = func() time.Time { return now }
	w := httptest.NewRecorder()
	if !a.Login(w, loginRequest, strings.Repeat("x", 32)) {
		t.Fatal("login failed")
	}
	c := w.Result().Cookies()[0]
	if !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteStrictMode {
		t.Fatal("unsafe cookie")
	}
	r := httptest.NewRequest("GET", "/", nil)
	r.AddCookie(c)
	if !a.Valid(r) {
		t.Fatal("session invalid")
	}
	a.Logout(httptest.NewRecorder(), r)
	if a.Valid(r) {
		t.Fatal("logout did not revoke")
	}
	w = httptest.NewRecorder()
	if !a.Login(w, loginRequest, strings.Repeat("x", 32)) {
		t.Fatal("second login failed")
	}
	r = httptest.NewRequest("GET", "/", nil)
	r.AddCookie(w.Result().Cookies()[0])
	revoked, valid := a.Watch(r)
	if !valid {
		t.Fatal("new login invalid")
	}
	now = now.Add(12 * time.Hour)
	if a.Valid(r) {
		t.Fatal("expired session accepted")
	}
	select {
	case <-revoked:
	default:
		t.Fatal("expiry did not notify connections")
	}
}

func TestCookieSecurityFollowsRequest(t *testing.T) {
	for _, tc := range []struct {
		name, requestURL, origin string
		secure                   bool
	}{
		{"HTTP", "http://dock.example.com/api/login", "http://dock.example.com", false},
		{"TLS", "https://dock.example.com/api/login", "https://dock.example.com", true},
		{"HTTPS proxy", "http://dock.example.com/api/login", "https://dock.example.com", true},
		{"HTTPS scheme case", "http://dock.example.com/api/login", "HTTPS://dock.example.com", true},
		{"forwarded headers ignored", "http://dock.example.com/api/login", "http://dock.example.com", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := New("test-credential")
			r := httptest.NewRequest("POST", tc.requestURL, nil)
			r.Header.Set("Origin", tc.origin)
			r.Header.Set("X-Forwarded-Proto", "https")
			w := httptest.NewRecorder()
			if !a.Login(w, r, "test-credential") {
				t.Fatal("login failed")
			}
			cookie := w.Result().Cookies()[0]
			if cookie.Secure != tc.secure || !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode {
				t.Fatal("unexpected login cookie security")
			}
			r.AddCookie(cookie)
			w = httptest.NewRecorder()
			a.Logout(w, r)
			cleared := w.Result().Cookies()[0]
			if cleared.Secure != tc.secure || cleared.MaxAge != -1 {
				t.Fatal("unexpected logout cookie security")
			}
		})
	}
}

func TestRateLimit(t *testing.T) {
	a := New(strings.Repeat("x", 32))
	loginRequest := httptest.NewRequest("POST", "/api/login", nil)
	now := time.Now()
	a.now = func() time.Time { return now }
	for i := 0; i < 5; i++ {
		w := httptest.NewRecorder()
		if a.Login(w, loginRequest, "wrong") || w.Code != http.StatusUnauthorized {
			t.Fatal("bad credential accepted")
		}
	}
	w := httptest.NewRecorder()
	if a.Login(w, loginRequest, strings.Repeat("x", 32)) || w.Code != http.StatusTooManyRequests {
		t.Fatal("rate limit missing")
	}
	now = now.Add(time.Minute)
	if !a.Login(httptest.NewRecorder(), loginRequest, strings.Repeat("x", 32)) {
		t.Fatal("window not reset")
	}
}

// A single user restarts and re-authenticates often; correct credentials must
// not be throttled by the brute-force limiter.
func TestSuccessfulLoginsAreNotRateLimited(t *testing.T) {
	a := New(strings.Repeat("x", 32))
	loginRequest := httptest.NewRequest("POST", "/api/login", nil)
	for i := 0; i < 10; i++ {
		w := httptest.NewRecorder()
		if !a.Login(w, loginRequest, strings.Repeat("x", 32)) {
			t.Fatalf("login %d rejected with %d", i+1, w.Code)
		}
	}
	// Brute-force protection still applies to wrong credentials.
	for i := 0; i < 5; i++ {
		w := httptest.NewRecorder()
		if a.Login(w, loginRequest, "wrong") || w.Code != http.StatusUnauthorized {
			t.Fatal("bad credential accepted")
		}
	}
	w := httptest.NewRecorder()
	if a.Login(w, loginRequest, "wrong") || w.Code != http.StatusTooManyRequests {
		t.Fatal("failed attempts are not limited")
	}
}

func TestLatestLoginWins(t *testing.T) {
	a := New("test-credential")
	loginRequest := httptest.NewRequest("POST", "/api/login", nil)
	var requests []*http.Request
	var signals []<-chan struct{}
	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		if !a.Login(w, loginRequest, "test-credential") {
			t.Fatal("login failed")
		}
		r := httptest.NewRequest("GET", "/", nil)
		r.AddCookie(w.Result().Cookies()[0])
		done, valid := a.Watch(r)
		if !valid {
			t.Fatal("new login invalid")
		}
		requests = append(requests, r)
		signals = append(signals, done)
	}
	select {
	case <-signals[0]:
	default:
		t.Fatal("previous login was not notified")
	}
	if a.Valid(requests[0]) || !a.Valid(requests[1]) {
		t.Fatal("only the latest login should remain valid")
	}
	w := httptest.NewRecorder()
	if a.Login(w, loginRequest, "wrong") || w.Code != http.StatusUnauthorized {
		t.Fatal("wrong credential accepted")
	}
	// A stale cookie must not log out the new device.
	a.Logout(httptest.NewRecorder(), requests[0])
	select {
	case <-signals[1]:
		t.Fatal("failed login or stale logout revoked the latest login")
	default:
	}
	if !a.Valid(requests[1]) {
		t.Fatal("latest login was invalidated")
	}
	a.Logout(httptest.NewRecorder(), requests[1])
	select {
	case <-signals[1]:
	default:
		t.Fatal("logout did not notify connections")
	}
	if a.Valid(requests[1]) {
		t.Fatal("logged-out cookie accepted")
	}
}

func TestConcurrentLoginsKeepOnlyOneSession(t *testing.T) {
	a := New("test-credential")
	loginRequest := httptest.NewRequest("POST", "/api/login", nil)
	const count = 10
	cookies := make(chan *http.Cookie, count)
	for i := 0; i < count; i++ {
		go func() {
			w := httptest.NewRecorder()
			if !a.Login(w, loginRequest, "test-credential") {
				t.Error("concurrent login failed")
				cookies <- nil
				return
			}
			cookies <- w.Result().Cookies()[0]
		}()
	}
	requests := make([]*http.Request, 0, count)
	for i := 0; i < count; i++ {
		if cookie := <-cookies; cookie != nil {
			r := httptest.NewRequest("GET", "/", nil)
			r.AddCookie(cookie)
			requests = append(requests, r)
		}
	}
	valid := 0
	for _, r := range requests {
		if a.Valid(r) {
			valid++
		}
	}
	if valid != 1 {
		t.Fatalf("valid logins: got %d want 1", valid)
	}
}
