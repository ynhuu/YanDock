package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os/exec"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/coder/websocket"
	"yandock/internal/auth"
	"yandock/internal/session"
)

func setup(t *testing.T) (*httptest.Server, *session.Manager, *http.Cookie) {
	t.Helper()
	sh, err := exec.LookPath("sh")
	if err != nil {
		t.Fatal(err)
	}
	m := session.NewManager(sh, nil, t.TempDir())
	srv := httptest.NewServer(New(auth.New(strings.Repeat("x", 32)), m, fstest.MapFS{"index.html": {Data: []byte("YanDock")}}))
	t.Cleanup(func() { m.Close(); srv.Close() })
	r, _ := http.NewRequest("POST", srv.URL+"/api/login", strings.NewReader(`{"token":"`+strings.Repeat("x", 32)+`"}`))
	r.Header.Set("Origin", srv.URL)
	r.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 204 {
		t.Fatalf("login: %d", response.StatusCode)
	}
	return srv, m, response.Cookies()[0]
}

func TestHTTPGuards(t *testing.T) {
	srv, _, cookie := setup(t)
	for _, tc := range []struct {
		method, path, origin, body string
		login                      bool
		status                     int
	}{
		{"GET", "/api/sessions", "", "", false, 401},
		{"POST", "/api/session", "https://evil.example", `{"cols":80,"rows":24}`, true, 403},
		{"POST", "/api/session", "", `{"cols":80,"rows":24}`, true, 403},
		{"POST", "/api/session", srv.URL, `{"cols":0,"rows":24}`, true, 400},
		{"POST", "/api/session", srv.URL, `{"cols":80,"rows":24,"extra":1}`, true, 400},
		{"POST", "/api/session", srv.URL, `{"cols":80,"rows":24} {}`, true, 400},
		{"POST", "/api/session", srv.URL, `{"cols":80,"rows":24}`, true, 201},
		// Creating another session leaves the first session running.
		{"POST", "/api/session", srv.URL, `{"cols":80,"rows":24}`, true, 201},
	} {
		r, _ := http.NewRequest(tc.method, srv.URL+tc.path, strings.NewReader(tc.body))
		r.Header.Set("Origin", tc.origin)
		r.Header.Set("Content-Type", "application/json")
		if tc.login {
			r.AddCookie(cookie)
		}
		response, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		_ = response.Body.Close()
		if response.StatusCode != tc.status {
			t.Fatalf("%s %s: got %d want %d", tc.method, tc.path, response.StatusCode, tc.status)
		}
	}
}

func TestSessionListAndRemove(t *testing.T) {
	srv, _, cookie := setup(t)
	create := func() session.Info {
		t.Helper()
		r, _ := http.NewRequest("POST", srv.URL+"/api/session", strings.NewReader(`{"cols":80,"rows":24}`))
		r.Header.Set("Origin", srv.URL)
		r.Header.Set("Content-Type", "application/json")
		r.AddCookie(cookie)
		response, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != 201 {
			t.Fatalf("create: %d", response.StatusCode)
		}
		var info session.Info
		if json.NewDecoder(response.Body).Decode(&info) != nil {
			t.Fatal("invalid create response")
		}
		return info
	}
	first, second := create(), create()
	list := func() []session.Info {
		t.Helper()
		r, _ := http.NewRequest("GET", srv.URL+"/api/sessions", nil)
		r.AddCookie(cookie)
		response, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var sessions []session.Info
		if json.NewDecoder(response.Body).Decode(&sessions) != nil {
			t.Fatal("invalid list response")
		}
		return sessions
	}
	got := list()
	if len(got) != 2 || got[0].ID != first.ID || got[1].ID != second.ID || !got[0].Running || got[0].Seq != first.Seq || got[1].Seq <= got[0].Seq {
		t.Fatalf("unexpected list %+v", got)
	}
	r, _ := http.NewRequest("DELETE", srv.URL+"/api/session/"+first.ID, nil)
	r.Header.Set("Origin", srv.URL)
	r.Header.Set("Content-Type", "application/json")
	r.AddCookie(cookie)
	response, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != 204 {
		t.Fatalf("remove: %d", response.StatusCode)
	}
	if got = list(); len(got) != 1 || got[0].ID != second.ID {
		t.Fatalf("removed session still listed: %+v", got)
	}
	r, _ = http.NewRequest("GET", srv.URL+"/api/session/"+first.ID+"/terminal", nil)
	r.Header.Set("Origin", srv.URL)
	r.AddCookie(cookie)
	response, err = http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != 404 {
		t.Fatalf("removed session terminal: %d", response.StatusCode)
	}
}

func TestCreateManySessionsHTTP(t *testing.T) {
	srv, m, cookie := setup(t)
	const count = 10
	for i := 0; i < count; i++ {
		r, _ := http.NewRequest("POST", srv.URL+"/api/session", strings.NewReader(`{"cols":80,"rows":24}`))
		r.Header.Set("Origin", srv.URL)
		r.Header.Set("Content-Type", "application/json")
		r.AddCookie(cookie)
		response, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		_ = response.Body.Close()
		if response.StatusCode != 201 {
			t.Fatalf("session %d: %d", i+1, response.StatusCode)
		}
	}
	if len(m.List()) != count {
		t.Fatalf("unexpected list length %d", len(m.List()))
	}
}

func TestWebSocketProtocolAndGuards(t *testing.T) {
	srv, m, cookie := setup(t)
	s, err := m.Create(80, 24)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/session/" + s.Info().ID + "/terminal"
	header := http.Header{"Origin": {srv.URL}, "Cookie": {cookie.String()}}
	for _, tc := range []struct {
		headers http.Header
		status  int
	}{
		{http.Header{"Origin": {srv.URL}}, 401},
		{http.Header{"Origin": {"https://evil.example"}, "Cookie": {cookie.String()}}, 403},
	} {
		conn, response, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: tc.headers})
		if conn != nil {
			_ = conn.CloseNow()
		}
		if response != nil {
			_ = response.Body.Close()
		}
		if err == nil || response == nil || response.StatusCode != tc.status {
			t.Fatalf("WebSocket guard: %v", err)
		}
	}
	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: header})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	kind, data, err := conn.Read(ctx)
	if err != nil || kind != websocket.MessageText {
		t.Fatalf("hello: %v", err)
	}
	var hello map[string]any
	if json.Unmarshal(data, &hello) != nil || hello["version"] != float64(2) {
		t.Fatal("invalid hello")
	}
	duplicate, response, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: header})
	if duplicate != nil {
		_ = duplicate.CloseNow()
	}
	if response != nil {
		_ = response.Body.Close()
	}
	if err == nil || response.StatusCode != 409 {
		t.Fatal("duplicate WebSocket accepted")
	}
	if err := conn.Write(ctx, websocket.MessageText, []byte(`{"type":"resize","cols":100,"rows":30}`)); err != nil {
		t.Fatal(err)
	}
	if err := conn.Write(ctx, websocket.MessageBinary, []byte("stty size\n")); err != nil {
		t.Fatal(err)
	}
	var output strings.Builder
	for !strings.Contains(output.String(), "30 100") {
		kind, data, err := conn.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if kind == websocket.MessageBinary {
			output.Write(data)
		}
	}
	if err := conn.Write(ctx, websocket.MessageText, []byte(`{"type":"resize","cols":0,"rows":30}`)); err != nil {
		t.Fatal(err)
	}
	for {
		_, _, err := conn.Read(ctx)
		if err != nil {
			if websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
				t.Fatalf("invalid protocol close: %v", err)
			}
			break
		}
	}
	if !s.Info().Running {
		t.Fatal("protocol failure killed session")
	}
}

func TestStaticDoesNotExposeSource(t *testing.T) {
	srv, _, _ := setup(t)
	for _, path := range []string{"/go.mod", "/.env", "/internal/auth/auth.go"} {
		response, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, response.Body)
		_ = response.Body.Close()
		if response.StatusCode != 404 {
			t.Fatalf("source path %s exposed", path)
		}
	}
}

func TestStaticMethodsAndHeaders(t *testing.T) {
	handler := New(nil, nil, fstest.MapFS{"index.html": {Data: []byte("YanDock")}})
	for _, tc := range []struct {
		method, path string
		status       int
	}{
		{http.MethodGet, "/", http.StatusOK},
		{http.MethodHead, "/", http.StatusOK},
		{http.MethodPost, "/", http.StatusMethodNotAllowed},
		{http.MethodGet, "/api/missing", http.StatusNotFound},
	} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
		if w.Code != tc.status {
			t.Fatalf("%s %s: got %d want %d", tc.method, tc.path, w.Code, tc.status)
		}
		for name, want := range map[string]string{
			"X-Content-Type-Options": "nosniff",
			"Referrer-Policy":        "no-referrer",
			"Cache-Control":          "no-store",
		} {
			if got := w.Header().Get(name); got != want {
				t.Fatalf("%s %s: %s = %q, want %q", tc.method, tc.path, name, got, want)
			}
		}
		if tc.status == http.StatusOK && w.Header().Get("Content-Security-Policy") == "" {
			t.Fatal("static response missing CSP")
		}
		if tc.status == http.StatusMethodNotAllowed && w.Header().Get("Allow") != "GET, HEAD" {
			t.Fatal("static response missing allowed methods")
		}
	}
}

func TestLogoutRevokesTerminalInputWithoutKillingProcess(t *testing.T) {
	srv, m, cookie := setup(t)
	s, err := m.Create(80, 24)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/session/" + s.Info().ID + "/terminal"
	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {srv.URL}, "Cookie": {cookie.String()}}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	if _, _, err := conn.Read(ctx); err != nil {
		t.Fatal(err)
	}
	r, _ := http.NewRequest("POST", srv.URL+"/api/logout", nil)
	r.Header.Set("Origin", srv.URL)
	r.AddCookie(cookie)
	response, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != 204 {
		t.Fatalf("logout: %d", response.StatusCode)
	}
	// Logout may have already closed the socket before this input is attempted.
	_ = conn.Write(ctx, websocket.MessageBinary, []byte("exit\n"))
	for {
		_, _, err := conn.Read(ctx)
		if err != nil {
			if websocket.CloseStatus(err) != 4001 {
				t.Fatalf("revoked cookie accepted: %v", err)
			}
			break
		}
	}
	if !s.Info().Running {
		t.Fatal("revoked input reached the process or logout killed it")
	}
}

func TestNewLoginRevokesIdleTerminalWithoutKillingProcess(t *testing.T) {
	srv, m, oldCookie := setup(t)
	s, err := m.Create(80, 24)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/session/" + s.Info().ID + "/terminal"
	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {srv.URL}, "Cookie": {oldCookie.String()}}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	if _, _, err := conn.Read(ctx); err != nil {
		t.Fatal(err)
	}
	r, _ := http.NewRequest("POST", srv.URL+"/api/login", strings.NewReader(`{"token":"`+strings.Repeat("x", 32)+`"}`))
	r.Header.Set("Origin", srv.URL)
	r.Header.Set("Content-Type", "application/json")
	response, err := srv.Client().Do(r)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusNoContent || len(response.Cookies()) != 1 {
		t.Fatalf("new login failed: %d", response.StatusCode)
	}
	newCookie := response.Cookies()[0]
	// No terminal input or heartbeat is needed to close the old connection.
	for {
		_, _, err := conn.Read(ctx)
		if err != nil {
			if websocket.CloseStatus(err) != 4001 {
				t.Fatalf("old connection not revoked: %v", err)
			}
			break
		}
	}
	for _, tc := range []struct {
		cookie *http.Cookie
		status int
	}{{oldCookie, http.StatusUnauthorized}, {newCookie, http.StatusOK}} {
		r, _ := http.NewRequest("GET", srv.URL+"/api/sessions", nil)
		r.AddCookie(tc.cookie)
		response, err := srv.Client().Do(r)
		if err != nil {
			t.Fatal(err)
		}
		_ = response.Body.Close()
		if response.StatusCode != tc.status {
			t.Fatalf("session access: got %d want %d", response.StatusCode, tc.status)
		}
	}
	if !s.Info().Running {
		t.Fatal("login takeover killed the terminal process")
	}
}

func TestHTTPSProxyLoginAndTerminal(t *testing.T) {
	backend, m, _ := setup(t)
	target, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}
	proxy := httptest.NewTLSServer(httputil.NewSingleHostReverseProxy(target))
	defer proxy.Close()
	r, _ := http.NewRequest("POST", proxy.URL+"/api/login", strings.NewReader(`{"token":"`+strings.Repeat("x", 32)+`"}`))
	r.Header.Set("Origin", proxy.URL)
	r.Header.Set("Content-Type", "application/json")
	response, err := proxy.Client().Do(r)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusNoContent || len(response.Cookies()) != 1 {
		t.Fatalf("proxy login: %d", response.StatusCode)
	}
	cookie := response.Cookies()[0]
	if !cookie.Secure || !cookie.HttpOnly {
		t.Fatal("HTTPS proxy login requires a secure cookie")
	}
	s, err := m.Create(80, 24)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "wss"+strings.TrimPrefix(proxy.URL, "https")+"/api/session/"+s.Info().ID+"/terminal", &websocket.DialOptions{
		HTTPClient: proxy.Client(),
		HTTPHeader: http.Header{"Origin": {proxy.URL}, "Cookie": {cookie.String()}},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var hello struct {
		Type string `json:"type"`
	}
	if json.Unmarshal(data, &hello) != nil || hello.Type != "hello" {
		t.Fatalf("proxy terminal hello: %q", data)
	}
}

func TestHTTPLoginAndTerminal(t *testing.T) {
	sh, err := exec.LookPath("sh")
	if err != nil {
		t.Fatal(err)
	}
	m := session.NewManager(sh, nil, t.TempDir())
	srv := httptest.NewServer(New(auth.New(strings.Repeat("x", 32)), m, fstest.MapFS{"index.html": {Data: []byte("YanDock")}}))
	t.Cleanup(func() { m.Close(); srv.Close() })
	r, _ := http.NewRequest("POST", srv.URL+"/api/login", strings.NewReader(`{"token":"`+strings.Repeat("x", 32)+`"}`))
	r.Header.Set("Origin", srv.URL)
	r.Header.Set("Content-Type", "application/json")
	response, err := srv.Client().Do(r)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != 204 || len(response.Cookies()) != 1 || response.Cookies()[0].Secure {
		t.Fatal("HTTP login must issue a usable HTTP cookie")
	}
	cookie := response.Cookies()[0]
	s, err := m.Create(80, 24)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/session/" + s.Info().ID + "/terminal"
	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPClient: srv.Client(), HTTPHeader: http.Header{"Origin": {srv.URL}, "Cookie": {cookie.String()}}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	kind, _, err := conn.Read(ctx)
	if err != nil || kind != websocket.MessageText {
		t.Fatalf("WS handshake failed: %v", err)
	}
	if err := conn.Write(ctx, websocket.MessageBinary, []byte("printf '\\110\\124\\124\\120\\137\\117\\113\\n'\n")); err != nil {
		t.Fatal(err)
	}
	var output strings.Builder
	for !strings.Contains(output.String(), "HTTP_OK") {
		kind, data, err := conn.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if kind == websocket.MessageBinary {
			output.Write(data)
		}
	}
}

func TestFailedUpgradePreservesFirstHandshake(t *testing.T) {
	srv, manager, cookie := setup(t)
	current, err := manager.Create(80, 24)
	if err != nil {
		t.Fatal(err)
	}
	path := "/api/session/" + current.Info().ID + "/terminal"
	request, _ := http.NewRequest("GET", srv.URL+path, nil)
	request.AddCookie(cookie)
	request.Header.Set("Origin", srv.URL)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode < 400 {
		t.Fatal("upgrade without WebSocket headers succeeded")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	headers := http.Header{"Origin": {srv.URL}, "Cookie": {cookie.String()}}
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+path, &websocket.DialOptions{HTTPHeader: headers})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var hello struct {
		Type   string `json:"type"`
		Replay bool   `json:"replay"`
	}
	if err := json.Unmarshal(data, &hello); err != nil {
		t.Fatal(err)
	}
	if hello.Type != "hello" || hello.Replay {
		t.Fatalf("failed upgrade consumed fresh startup: %+v", hello)
	}
}
