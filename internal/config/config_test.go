package config

import (
	"os"
	"path/filepath"
	"testing"
)

// saveRestoreArgs saves os.Args and registers a cleanup to restore it.
func saveRestoreArgs(t *testing.T) {
	t.Helper()
	old := os.Args
	t.Cleanup(func() { os.Args = old })
}

func TestParseDefaults(t *testing.T) {
	saveRestoreArgs(t)

	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "data", "test.db")
	feedsPath := filepath.Join(tmpDir, "config", "feeds.opml")

	os.Args = []string{"test",
		"-db", dbPath,
		"-feeds", feedsPath,
	}

	cfg, err := Parse()
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	if cfg.Host != "127.0.0.1" {
		t.Fatalf("expected default host 127.0.0.1, got %q", cfg.Host)
	}
	if cfg.Port != 3000 {
		t.Fatalf("expected default port 3000, got %d", cfg.Port)
	}
	if cfg.FrontendURL != "https://cross-ts.github.io/rss-reader/" {
		t.Fatalf("unexpected default frontend URL: %q", cfg.FrontendURL)
	}
	if cfg.PollIntervalMinutes != 15 {
		t.Fatalf("expected default poll interval 15, got %d", cfg.PollIntervalMinutes)
	}
	if cfg.StaticDir != "" {
		t.Fatalf("expected empty static dir, got %q", cfg.StaticDir)
	}
	if cfg.DBPath != dbPath {
		t.Fatalf("expected db path %q, got %q", dbPath, cfg.DBPath)
	}
	if cfg.FeedsPath != feedsPath {
		t.Fatalf("expected feeds path %q, got %q", feedsPath, cfg.FeedsPath)
	}
}

func TestParseCustomValues(t *testing.T) {
	saveRestoreArgs(t)

	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "custom.db")
	feedsPath := filepath.Join(tmpDir, "custom.opml")
	staticDir := filepath.Join(tmpDir, "static")

	os.Args = []string{"test",
		"-db", dbPath,
		"-feeds", feedsPath,
		"-host", "0.0.0.0",
		"-port", "8080",
		"-frontend-url", "http://localhost:5173",
		"-static-dir", staticDir,
		"-poll-interval", "30",
	}

	cfg, err := Parse()
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	if cfg.Host != "0.0.0.0" {
		t.Fatalf("expected host 0.0.0.0, got %q", cfg.Host)
	}
	if cfg.Port != 8080 {
		t.Fatalf("expected port 8080, got %d", cfg.Port)
	}
	if cfg.FrontendURL != "http://localhost:5173" {
		t.Fatalf("expected frontend URL http://localhost:5173, got %q", cfg.FrontendURL)
	}
	if cfg.PollIntervalMinutes != 30 {
		t.Fatalf("expected poll interval 30, got %d", cfg.PollIntervalMinutes)
	}
	if cfg.DBPath != dbPath {
		t.Fatalf("expected db %q, got %q", dbPath, cfg.DBPath)
	}
	if cfg.FeedsPath != feedsPath {
		t.Fatalf("expected feeds %q, got %q", feedsPath, cfg.FeedsPath)
	}
}

func TestParsePortShorthand(t *testing.T) {
	saveRestoreArgs(t)

	tmpDir := t.TempDir()
	os.Args = []string{"test",
		"-db", filepath.Join(tmpDir, "test.db"),
		"-feeds", filepath.Join(tmpDir, "feeds.opml"),
		"-p", "9090",
	}

	cfg, err := Parse()
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	if cfg.Port != 9090 {
		t.Fatalf("expected port 9090, got %d", cfg.Port)
	}
}

func TestParseInvalidFrontendURLNoScheme(t *testing.T) {
	saveRestoreArgs(t)

	tmpDir := t.TempDir()
	os.Args = []string{"test",
		"-db", filepath.Join(tmpDir, "test.db"),
		"-feeds", filepath.Join(tmpDir, "feeds.opml"),
		"-frontend-url", "example.com",
	}

	_, err := Parse()
	if err == nil {
		t.Fatal("expected error for frontend URL without scheme")
	}
}

func TestParseInvalidFrontendURLFTPScheme(t *testing.T) {
	saveRestoreArgs(t)

	tmpDir := t.TempDir()
	os.Args = []string{"test",
		"-db", filepath.Join(tmpDir, "test.db"),
		"-feeds", filepath.Join(tmpDir, "feeds.opml"),
		"-frontend-url", "ftp://example.com",
	}

	_, err := Parse()
	if err == nil {
		t.Fatal("expected error for ftp scheme")
	}
}

func TestParseXDGDefaults(t *testing.T) {
	saveRestoreArgs(t)

	// Don't pass -db or -feeds so XDG defaults are used.
	// Set XDG env vars to temp dirs so we don't pollute real dirs.
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(tmpDir, "config"))
	t.Setenv("XDG_DATA_HOME", filepath.Join(tmpDir, "data"))

	os.Args = []string{"test"}

	cfg, err := Parse()
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	expectedFeeds := filepath.Join(tmpDir, "config", "rss-reader", "feeds.opml")
	if cfg.FeedsPath != expectedFeeds {
		t.Fatalf("expected feeds %q, got %q", expectedFeeds, cfg.FeedsPath)
	}

	expectedDB := filepath.Join(tmpDir, "data", "rss-reader", "rss.sqlite")
	if cfg.DBPath != expectedDB {
		t.Fatalf("expected db %q, got %q", expectedDB, cfg.DBPath)
	}
}

func TestConfigHomeWithXDG(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", "/custom/config")
	if got := ConfigHome(); got != "/custom/config" {
		t.Fatalf("expected /custom/config, got %q", got)
	}
}

func TestConfigHomeDefault(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", "")
	home := ConfigHome()
	if home == "" {
		t.Fatal("expected non-empty config home")
	}
	// Should end with .config
	if filepath.Base(home) != ".config" {
		t.Fatalf("expected .config suffix, got %q", home)
	}
}

func TestDataHomeWithXDG(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", "/custom/data")
	if got := DataHome(); got != "/custom/data" {
		t.Fatalf("expected /custom/data, got %q", got)
	}
}

func TestDataHomeDefault(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", "")
	home := DataHome()
	if home == "" {
		t.Fatal("expected non-empty data home")
	}
	// Should end with share
	if filepath.Base(home) != "share" {
		t.Fatalf("expected share suffix, got %q", home)
	}
}

func TestParseStaticDirResolved(t *testing.T) {
	saveRestoreArgs(t)

	tmpDir := t.TempDir()
	staticDir := filepath.Join(tmpDir, "static")

	os.Args = []string{"test",
		"-db", filepath.Join(tmpDir, "test.db"),
		"-feeds", filepath.Join(tmpDir, "feeds.opml"),
		"-static-dir", staticDir,
	}

	cfg, err := Parse()
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	if cfg.StaticDir == "" {
		t.Fatal("expected non-empty static dir")
	}
	if !filepath.IsAbs(cfg.StaticDir) {
		t.Fatalf("expected absolute path, got %q", cfg.StaticDir)
	}
}

func TestParseInvalidFlag(t *testing.T) {
	saveRestoreArgs(t)

	os.Args = []string{"test", "-unknown-flag"}

	_, err := Parse()
	if err == nil {
		t.Fatal("expected error for unknown flag")
	}
}

// setConfigHome points XDG_CONFIG_HOME at a fresh temp dir so config.yml
// reads/writes don't touch the real user config.
func setConfigHome(t *testing.T) string {
	t.Helper()
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)
	return tmpDir
}

func writeConfigYAML(t *testing.T, configHome, content string) {
	t.Helper()
	dir := filepath.Join(configHome, "rss-reader")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "config.yml"), []byte(content), 0644); err != nil {
		t.Fatalf("write config.yml: %v", err)
	}
}

func TestParsePriorityFlagOverEnvOverFileOverDefault(t *testing.T) {
	saveRestoreArgs(t)
	configHome := setConfigHome(t)

	tmpDir := t.TempDir()
	writeConfigYAML(t, configHome, "host: \"from-file\"\nport: 4000\n")

	t.Setenv("HOST", "from-env")
	t.Setenv("PORT", "5000")
	t.Setenv("POLL_INTERVAL_MINUTES", "20")

	os.Args = []string{"test",
		"-db", filepath.Join(tmpDir, "test.db"),
		"-feeds", filepath.Join(tmpDir, "feeds.opml"),
		"-host", "from-flag",
	}

	cfg, err := Parse()
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	if cfg.Host != "from-flag" {
		t.Fatalf("expected host from flag, got %q", cfg.Host)
	}
	if cfg.Sources["host"] != SourceFlag {
		t.Fatalf("expected host source flag, got %q", cfg.Sources["host"])
	}
	if cfg.Port != 5000 {
		t.Fatalf("expected port from env (5000), got %d", cfg.Port)
	}
	if cfg.Sources["port"] != SourceEnv {
		t.Fatalf("expected port source env, got %q", cfg.Sources["port"])
	}
	if cfg.PollIntervalMinutes != 20 {
		t.Fatalf("expected poll interval from env (20), got %d", cfg.PollIntervalMinutes)
	}
}

func TestParseFileValueUsedWhenNoFlagOrEnv(t *testing.T) {
	saveRestoreArgs(t)
	configHome := setConfigHome(t)

	tmpDir := t.TempDir()
	writeConfigYAML(t, configHome, "host: \"from-file\"\nport: 4000\nfrontend_url: \"http://from-file.example\"\n")

	os.Args = []string{"test",
		"-db", filepath.Join(tmpDir, "test.db"),
		"-feeds", filepath.Join(tmpDir, "feeds.opml"),
	}

	cfg, err := Parse()
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	if cfg.Host != "from-file" {
		t.Fatalf("expected host from file, got %q", cfg.Host)
	}
	if cfg.Sources["host"] != SourceFile {
		t.Fatalf("expected host source file, got %q", cfg.Sources["host"])
	}
	if cfg.Port != 4000 {
		t.Fatalf("expected port from file (4000), got %d", cfg.Port)
	}
	if cfg.FrontendURL != "http://from-file.example" {
		t.Fatalf("expected frontend url from file, got %q", cfg.FrontendURL)
	}
}

func TestParseDefaultSourceWhenNothingSet(t *testing.T) {
	saveRestoreArgs(t)
	setConfigHome(t)

	tmpDir := t.TempDir()
	os.Args = []string{"test",
		"-db", filepath.Join(tmpDir, "test.db"),
		"-feeds", filepath.Join(tmpDir, "feeds.opml"),
	}

	cfg, err := Parse()
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	if cfg.Sources["host"] != SourceDefault {
		t.Fatalf("expected host source default, got %q", cfg.Sources["host"])
	}
	if cfg.Sources["port"] != SourceDefault {
		t.Fatalf("expected port source default, got %q", cfg.Sources["port"])
	}
}

func TestParseConfigFileMalformedYAML(t *testing.T) {
	saveRestoreArgs(t)
	configHome := setConfigHome(t)

	tmpDir := t.TempDir()
	writeConfigYAML(t, configHome, "host: [this is not valid\n")

	os.Args = []string{"test",
		"-db", filepath.Join(tmpDir, "test.db"),
		"-feeds", filepath.Join(tmpDir, "feeds.opml"),
	}

	_, err := Parse()
	if err == nil {
		t.Fatal("expected error for malformed config.yml")
	}
}

func TestParseConfigFileInvalidPort(t *testing.T) {
	saveRestoreArgs(t)
	configHome := setConfigHome(t)

	tmpDir := t.TempDir()
	writeConfigYAML(t, configHome, "port: 99999\n")

	os.Args = []string{"test",
		"-db", filepath.Join(tmpDir, "test.db"),
		"-feeds", filepath.Join(tmpDir, "feeds.opml"),
	}

	_, err := Parse()
	if err == nil {
		t.Fatal("expected error for out-of-range port in config.yml")
	}
}

func TestParseNoConfigFile(t *testing.T) {
	saveRestoreArgs(t)
	setConfigHome(t)

	tmpDir := t.TempDir()
	os.Args = []string{"test",
		"-db", filepath.Join(tmpDir, "test.db"),
		"-feeds", filepath.Join(tmpDir, "feeds.opml"),
	}

	cfg, err := Parse()
	if err != nil {
		t.Fatalf("expected no error when config.yml is absent, got %v", err)
	}
	if cfg.Host != defaultHost {
		t.Fatalf("expected default host, got %q", cfg.Host)
	}
}
