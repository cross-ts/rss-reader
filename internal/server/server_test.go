package server

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/cross-ts/rss-reader/internal/config"
	"github.com/cross-ts/rss-reader/internal/db"
)

func openTestDB(t *testing.T) *db.DB {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	d, err := db.Open(path)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func TestNewServeMux(t *testing.T) {
	t.Run("with static dir", func(t *testing.T) {
		database := openTestDB(t)
		staticDir := t.TempDir()
		state := &AppState{
			DB:         database,
			Config:     &config.Config{FeedsPath: filepath.Join(t.TempDir(), "feeds.opml"), StaticDir: staticDir},
			FeedClient: &http.Client{},
		}

		mux := NewServeMux(state)
		if mux == nil {
			t.Fatal("NewServeMux returned nil")
		}
	})

	t.Run("with frontend URL (proxy mode)", func(t *testing.T) {
		database := openTestDB(t)
		state := &AppState{
			DB:          database,
			Config:      &config.Config{FeedsPath: filepath.Join(t.TempDir(), "feeds.opml"), FrontendURL: "http://localhost:5173"},
			FeedClient:  &http.Client{},
			ProxyClient: &http.Client{},
		}

		mux := NewServeMux(state)
		if mux == nil {
			t.Fatal("NewServeMux returned nil")
		}
	})

	t.Run("API routes respond", func(t *testing.T) {
		database := openTestDB(t)
		state := &AppState{
			DB:          database,
			Config:      &config.Config{FeedsPath: filepath.Join(t.TempDir(), "feeds.opml"), FrontendURL: "http://localhost:5173"},
			FeedClient:  &http.Client{},
			ProxyClient: &http.Client{},
		}

		mux := NewServeMux(state)

		// Test GET /api/articles
		req := httptest.NewRequest("GET", "/api/articles", nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("GET /api/articles: status = %d, want %d", rec.Code, http.StatusOK)
		}

		// Test GET /api/feeds
		req = httptest.NewRequest("GET", "/api/feeds", nil)
		rec = httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("GET /api/feeds: status = %d, want %d", rec.Code, http.StatusOK)
		}

		// Test GET /api/folders
		req = httptest.NewRequest("GET", "/api/folders", nil)
		rec = httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("GET /api/folders: status = %d, want %d", rec.Code, http.StatusOK)
		}

		// Test GET /api/unread-counts
		req = httptest.NewRequest("GET", "/api/unread-counts", nil)
		rec = httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("GET /api/unread-counts: status = %d, want %d", rec.Code, http.StatusOK)
		}
	})
}

func TestCORSMiddleware(t *testing.T) {
	t.Run("regular request gets CORS headers", func(t *testing.T) {
		inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		})

		handler := CORSMiddleware(inner)
		req := httptest.NewRequest("GET", "/api/test", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
		}

		origin := rec.Header().Get("Access-Control-Allow-Origin")
		if origin != "*" {
			t.Errorf("Access-Control-Allow-Origin = %q, want %q", origin, "*")
		}

		methods := rec.Header().Get("Access-Control-Allow-Methods")
		if methods == "" {
			t.Error("Access-Control-Allow-Methods is empty")
		}

		headers := rec.Header().Get("Access-Control-Allow-Headers")
		if headers != "Content-Type" {
			t.Errorf("Access-Control-Allow-Headers = %q, want %q", headers, "Content-Type")
		}
	})

	t.Run("OPTIONS preflight returns 204", func(t *testing.T) {
		called := false
		inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			called = true
			w.WriteHeader(http.StatusOK)
		})

		handler := CORSMiddleware(inner)
		req := httptest.NewRequest("OPTIONS", "/api/test", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusNoContent {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusNoContent)
		}

		if called {
			t.Error("inner handler should not be called for OPTIONS")
		}

		origin := rec.Header().Get("Access-Control-Allow-Origin")
		if origin != "*" {
			t.Errorf("Access-Control-Allow-Origin = %q, want %q", origin, "*")
		}
	})

	t.Run("POST request goes through to inner handler", func(t *testing.T) {
		inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusCreated)
		})

		handler := CORSMiddleware(inner)
		req := httptest.NewRequest("POST", "/api/test", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusCreated {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusCreated)
		}
	})
}
