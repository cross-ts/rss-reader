package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/cross-ts/rss-reader/internal/config"
)

func testConfig(t *testing.T) *config.Config {
	t.Helper()
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	return &config.Config{
		Host:                "127.0.0.1",
		Port:                3000,
		PollIntervalMinutes: 15,
		FrontendURL:         "https://example.com",
		DBPath:              "/tmp/rss.sqlite",
		FeedsPath:           "/tmp/feeds.opml",
		StaticDir:           "",
		Sources: map[string]config.Source{
			"host":                  config.SourceDefault,
			"port":                  config.SourceDefault,
			"poll_interval_minutes": config.SourceDefault,
			"frontend_url":          config.SourceDefault,
			"db":                    config.SourceDefault,
			"feeds":                 config.SourceDefault,
			"static_dir":            config.SourceDefault,
		},
	}
}

func TestGetSettings(t *testing.T) {
	cfg := testConfig(t)

	handler := GetSettings(cfg)
	req := httptest.NewRequest("GET", "/api/settings", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp SettingsResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Host.Value != "127.0.0.1" {
		t.Fatalf("expected host 127.0.0.1, got %v", resp.Host.Value)
	}
	if !resp.Host.Editable {
		t.Fatal("expected host editable")
	}
	if resp.DB.Editable {
		t.Fatal("expected db not editable")
	}
	if !resp.Host.RestartRequired {
		t.Fatal("expected host restartRequired")
	}
}

func TestUpdateSettings_Success(t *testing.T) {
	cfg := testConfig(t)

	handler := UpdateSettings(cfg)
	body, _ := json.Marshal(map[string]any{"host": "0.0.0.0", "port": 8080})
	req := httptest.NewRequest("PUT", "/api/settings", bytes.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}

	fileCfg, err := config.LoadFile(config.FilePath())
	if err != nil {
		t.Fatalf("load config file: %v", err)
	}
	if fileCfg.Host == nil || *fileCfg.Host != "0.0.0.0" {
		t.Fatalf("expected persisted host 0.0.0.0, got %v", fileCfg.Host)
	}
	if fileCfg.Port == nil || *fileCfg.Port != 8080 {
		t.Fatalf("expected persisted port 8080, got %v", fileCfg.Port)
	}
}

func TestUpdateSettings_PreservesUnrelatedKeys(t *testing.T) {
	cfg := testConfig(t)

	path := config.FilePath()
	poll := uint64(30)
	if err := config.SaveFile(path, &config.FileConfig{PollIntervalMinutes: &poll}); err != nil {
		t.Fatalf("seed config file: %v", err)
	}

	handler := UpdateSettings(cfg)
	body, _ := json.Marshal(map[string]any{"host": "0.0.0.0"})
	req := httptest.NewRequest("PUT", "/api/settings", bytes.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}

	fileCfg, err := config.LoadFile(path)
	if err != nil {
		t.Fatalf("load config file: %v", err)
	}
	if fileCfg.PollIntervalMinutes == nil || *fileCfg.PollIntervalMinutes != 30 {
		t.Fatalf("expected preserved poll interval 30, got %v", fileCfg.PollIntervalMinutes)
	}
	if fileCfg.Host == nil || *fileCfg.Host != "0.0.0.0" {
		t.Fatalf("expected persisted host 0.0.0.0, got %v", fileCfg.Host)
	}
}

func TestUpdateSettings_InvalidPort(t *testing.T) {
	cfg := testConfig(t)

	handler := UpdateSettings(cfg)
	body, _ := json.Marshal(map[string]any{"port": 70000})
	req := httptest.NewRequest("PUT", "/api/settings", bytes.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdateSettings_InvalidPollInterval(t *testing.T) {
	cfg := testConfig(t)

	handler := UpdateSettings(cfg)
	body, _ := json.Marshal(map[string]any{"pollIntervalMinutes": 0})
	req := httptest.NewRequest("PUT", "/api/settings", bytes.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdateSettings_PollIntervalAboveMax(t *testing.T) {
	cfg := testConfig(t)

	handler := UpdateSettings(cfg)
	body, _ := json.Marshal(map[string]any{"pollIntervalMinutes": config.MaxPollIntervalMinutes + 1})
	req := httptest.NewRequest("PUT", "/api/settings", bytes.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdateSettings_InvalidFrontendURL(t *testing.T) {
	cfg := testConfig(t)

	handler := UpdateSettings(cfg)
	body, _ := json.Marshal(map[string]any{"frontendUrl": "ftp://example.com"})
	req := httptest.NewRequest("PUT", "/api/settings", bytes.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdateSettings_FrontendURLMissingHost(t *testing.T) {
	cfg := testConfig(t)

	handler := UpdateSettings(cfg)
	body, _ := json.Marshal(map[string]any{"frontendUrl": "http://"})
	req := httptest.NewRequest("PUT", "/api/settings", bytes.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdateSettings_RejectsNonEditableKeys(t *testing.T) {
	cfg := testConfig(t)

	handler := UpdateSettings(cfg)
	body, _ := json.Marshal(map[string]any{"db": filepath.Join(t.TempDir(), "x.db")})
	req := httptest.NewRequest("PUT", "/api/settings", bytes.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdateSettings_EmptyHost(t *testing.T) {
	cfg := testConfig(t)

	handler := UpdateSettings(cfg)
	body, _ := json.Marshal(map[string]any{"host": "  "})
	req := httptest.NewRequest("PUT", "/api/settings", bytes.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}
