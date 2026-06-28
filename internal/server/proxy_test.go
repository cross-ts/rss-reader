package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/cross-ts/rss-reader/internal/config"
)

func TestVerifyProxyOrigin(t *testing.T) {
	tests := []struct {
		name        string
		frontendURL string
		targetURL   string
		want        bool
	}{
		{
			name:        "same origin",
			frontendURL: "http://localhost:5173",
			targetURL:   "http://localhost:5173/path",
			want:        true,
		},
		{
			name:        "different scheme",
			frontendURL: "http://localhost:5173",
			targetURL:   "https://localhost:5173/path",
			want:        false,
		},
		{
			name:        "different host",
			frontendURL: "http://localhost:5173",
			targetURL:   "http://evil.com/path",
			want:        false,
		},
		{
			name:        "different port",
			frontendURL: "http://localhost:5173",
			targetURL:   "http://localhost:8080/path",
			want:        false,
		},
		{
			name:        "invalid frontend URL",
			frontendURL: "://invalid",
			targetURL:   "http://localhost:5173/path",
			want:        false,
		},
		{
			name:        "invalid target URL",
			frontendURL: "http://localhost:5173",
			targetURL:   "://invalid",
			want:        false,
		},
		{
			name:        "https same origin",
			frontendURL: "https://example.com",
			targetURL:   "https://example.com/assets/main.js",
			want:        true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := verifyProxyOrigin(tt.frontendURL, tt.targetURL)
			if got != tt.want {
				t.Errorf("verifyProxyOrigin(%q, %q) = %v, want %v", tt.frontendURL, tt.targetURL, got, tt.want)
			}
		})
	}
}

func TestStaticHandler(t *testing.T) {
	staticDir := t.TempDir()
	// Create test files
	indexContent := "<html>SPA</html>"
	os.WriteFile(filepath.Join(staticDir, "index.html"), []byte(indexContent), 0o644)
	os.MkdirAll(filepath.Join(staticDir, "assets"), 0o755)
	jsContent := "console.log('hello')"
	os.WriteFile(filepath.Join(staticDir, "assets", "main.js"), []byte(jsContent), 0o644)

	state := &AppState{
		Config: &config.Config{StaticDir: staticDir},
	}
	handler := staticHandler(state)

	t.Run("serve existing file", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/assets/main.js", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
		}
		body := rec.Body.String()
		if body != jsContent {
			t.Errorf("body = %q, want %q", body, jsContent)
		}
	})

	t.Run("root serves index.html", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
		}
		body := rec.Body.String()
		if !strings.Contains(body, "SPA") {
			t.Errorf("body should contain SPA content, got %q", body)
		}
	})

	t.Run("non-existent path falls back to index.html", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/some/deep/route", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
		}
		body := rec.Body.String()
		if !strings.Contains(body, "SPA") {
			t.Errorf("SPA fallback: body should contain SPA content, got %q", body)
		}
	})
}

func TestProxyHandler(t *testing.T) {
	t.Run("successful proxy", func(t *testing.T) {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("<html>hello</html>"))
		}))
		defer upstream.Close()

		state := &AppState{
			Config:      &config.Config{FrontendURL: upstream.URL},
			ProxyClient: upstream.Client(),
		}

		handler := proxyHandler(state)
		req := httptest.NewRequest("GET", "/", nil)
		rec := httptest.NewRecorder()
		handler(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want %d; body = %s", rec.Code, http.StatusOK, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "hello") {
			t.Errorf("body = %q, want to contain 'hello'", rec.Body.String())
		}
	})

	t.Run("404 for asset path", func(t *testing.T) {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNotFound)
			w.Write([]byte("not found"))
		}))
		defer upstream.Close()

		state := &AppState{
			Config:      &config.Config{FrontendURL: upstream.URL},
			ProxyClient: upstream.Client(),
		}

		handler := proxyHandler(state)
		req := httptest.NewRequest("GET", "/assets/missing.js", nil)
		rec := httptest.NewRecorder()
		handler(rec, req)

		// Asset paths that get 404 should propagate the 404
		if rec.Code != http.StatusNotFound {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
		}
	})

	t.Run("404 for non-asset path triggers SPA fallback", func(t *testing.T) {
		requestedPaths := make([]string, 0)
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			requestedPaths = append(requestedPaths, r.URL.Path)
			if r.URL.Path == "/" {
				w.Header().Set("Content-Type", "text/html")
				w.WriteHeader(http.StatusOK)
				w.Write([]byte("<html>SPA</html>"))
				return
			}
			w.WriteHeader(http.StatusNotFound)
		}))
		defer upstream.Close()

		state := &AppState{
			Config:      &config.Config{FrontendURL: upstream.URL},
			ProxyClient: upstream.Client(),
		}

		handler := proxyHandler(state)
		req := httptest.NewRequest("GET", "/some/route", nil)
		rec := httptest.NewRecorder()
		handler(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want %d; body = %s", rec.Code, http.StatusOK, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "SPA") {
			t.Errorf("body = %q, want SPA content", rec.Body.String())
		}
	})

	t.Run("upstream unreachable", func(t *testing.T) {
		state := &AppState{
			Config:      &config.Config{FrontendURL: "http://localhost:59999"},
			ProxyClient: &http.Client{},
		}

		handler := proxyHandler(state)
		req := httptest.NewRequest("GET", "/", nil)
		rec := httptest.NewRecorder()
		handler(rec, req)

		if rec.Code != http.StatusBadGateway {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusBadGateway)
		}
	})

	t.Run("with query string", func(t *testing.T) {
		var receivedQuery string
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			receivedQuery = r.URL.RawQuery
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("ok"))
		}))
		defer upstream.Close()

		state := &AppState{
			Config:      &config.Config{FrontendURL: upstream.URL},
			ProxyClient: upstream.Client(),
		}

		handler := proxyHandler(state)
		req := httptest.NewRequest("GET", "/page?foo=bar", nil)
		rec := httptest.NewRecorder()
		handler(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
		}
		if receivedQuery != "foo=bar" {
			t.Errorf("query = %q, want %q", receivedQuery, "foo=bar")
		}
	})
}

func TestProxyFetch(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"ok":true}`))
		}))
		defer srv.Close()

		statusCode, contentType, body, ok := proxyFetch(srv.Client(), srv.URL)
		if !ok {
			t.Fatal("proxyFetch returned not ok")
		}
		if statusCode != http.StatusOK {
			t.Errorf("statusCode = %d, want %d", statusCode, http.StatusOK)
		}
		if contentType != "application/json" {
			t.Errorf("contentType = %q, want %q", contentType, "application/json")
		}
		if string(body) != `{"ok":true}` {
			t.Errorf("body = %q", string(body))
		}
	})

	t.Run("oversized content-length", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Length", "999999999999")
			w.WriteHeader(http.StatusOK)
		}))
		defer srv.Close()

		_, _, _, ok := proxyFetch(srv.Client(), srv.URL)
		if ok {
			t.Error("proxyFetch should return not ok for oversized content-length")
		}
	})

	t.Run("unreachable server", func(t *testing.T) {
		_, _, _, ok := proxyFetch(&http.Client{}, "http://localhost:59998")
		if ok {
			t.Error("proxyFetch should return not ok for unreachable server")
		}
	})
}

func TestBuildProxyResponse(t *testing.T) {
	t.Run("with content type", func(t *testing.T) {
		rec := httptest.NewRecorder()
		buildProxyResponse(rec, http.StatusOK, "text/html", []byte("<html>test</html>"))

		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
		}
		if ct := rec.Header().Get("Content-Type"); ct != "text/html" {
			t.Errorf("Content-Type = %q, want %q", ct, "text/html")
		}
		if rec.Body.String() != "<html>test</html>" {
			t.Errorf("body = %q", rec.Body.String())
		}
	})

	t.Run("without content type", func(t *testing.T) {
		rec := httptest.NewRecorder()
		buildProxyResponse(rec, http.StatusNotFound, "", []byte("not found"))

		if rec.Code != http.StatusNotFound {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
		}
		if ct := rec.Header().Get("Content-Type"); ct != "" {
			t.Errorf("Content-Type = %q, want empty", ct)
		}
	})

	t.Run("custom status code", func(t *testing.T) {
		rec := httptest.NewRecorder()
		buildProxyResponse(rec, http.StatusServiceUnavailable, "text/plain", []byte("down"))

		if rec.Code != http.StatusServiceUnavailable {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
		}
	})
}
