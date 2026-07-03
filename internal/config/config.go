package config

import (
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
)

// Source identifies where a configuration value came from.
type Source string

const (
	SourceFlag    Source = "flag"
	SourceEnv     Source = "env"
	SourceFile    Source = "file"
	SourceDefault Source = "default"
)

// Config holds the application configuration.
type Config struct {
	DBPath              string
	FeedsPath           string
	PollIntervalMinutes uint64
	Host                string
	Port                int
	FrontendURL         string
	StaticDir           string // empty string means not set

	// Sources records where each settable field's effective value came from.
	Sources map[string]Source
}

const (
	defaultHost         = "127.0.0.1"
	defaultPort         = 3000
	defaultFrontendURL  = "https://cross-ts.github.io/rss-reader/"
	defaultPollInterval = uint64(15)
)

// ValidateFrontendURL checks that raw parses as a URL with an http or https
// scheme and a non-empty host.
func ValidateFrontendURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid frontend URL %q: %w", raw, err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("frontend URL must use http or https scheme, got %q", u.Scheme)
	}
	if u.Host == "" {
		return fmt.Errorf("frontend URL must include a host, got %q", raw)
	}
	return nil
}

// Parse parses configuration from CLI flags, environment variables, and
// config.yml. Priority: CLI flag > environment variable > config.yml > default.
func Parse() (*Config, error) {
	fs := flag.NewFlagSet(os.Args[0], flag.ContinueOnError)

	feeds := fs.String("feeds", "", "Path to feeds OPML file")
	db := fs.String("db", "", "Path to SQLite database")
	host := fs.String("host", "", "Listen host")
	port := fs.Int("port", 0, "Listen port")
	fs.IntVar(port, "p", 0, "Listen port (shorthand)")
	frontendURL := fs.String("frontend-url", "", "Frontend URL")
	staticDir := fs.String("static-dir", "", "Static file directory")
	pollInterval := fs.Uint64("poll-interval", 0, "Poll interval in minutes")

	if err := fs.Parse(os.Args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			os.Exit(0)
		}
		return nil, err
	}

	flagSet := make(map[string]bool)
	fs.Visit(func(f *flag.Flag) { flagSet[f.Name] = true })

	fileCfg, err := LoadFile(FilePath())
	if err != nil {
		return nil, err
	}

	sources := make(map[string]Source)

	resolvedHost := resolveString(*host, flagSet["host"], "HOST", fileCfg.Host, defaultHost, "host", sources)
	resolvedPort, err := resolveInt(*port, flagSet["port"] || flagSet["p"], "PORT", fileCfg.Port, defaultPort, "port", sources)
	if err != nil {
		return nil, err
	}
	resolvedFrontendURL := resolveString(*frontendURL, flagSet["frontend-url"], "FRONTEND_URL", fileCfg.FrontendURL, defaultFrontendURL, "frontend_url", sources)
	resolvedPollInterval, err := resolveUint64(*pollInterval, flagSet["poll-interval"], "POLL_INTERVAL_MINUTES", fileCfg.PollIntervalMinutes, defaultPollInterval, "poll_interval_minutes", sources)
	if err != nil {
		return nil, err
	}
	resolvedFeeds := resolveString(*feeds, flagSet["feeds"], "FEEDS_PATH", fileCfg.Feeds, "", "feeds", sources)
	resolvedDB := resolveString(*db, flagSet["db"], "DB_PATH", fileCfg.DB, "", "db", sources)
	resolvedStaticDir := resolveString(*staticDir, flagSet["static-dir"], "STATIC_DIR", fileCfg.StaticDir, "", "static_dir", sources)

	// Validate FrontendURL: must have http or https scheme and a host.
	if err := ValidateFrontendURL(resolvedFrontendURL); err != nil {
		return nil, err
	}

	if resolvedHost == "" {
		return nil, fmt.Errorf("host must not be empty")
	}
	if resolvedPort < 1 || resolvedPort > 65535 {
		return nil, fmt.Errorf("port must be between 1 and 65535, got %d", resolvedPort)
	}
	if resolvedPollInterval < 1 {
		return nil, fmt.Errorf("poll interval minutes must be >= 1, got %d", resolvedPollInterval)
	}

	// Resolve XDG defaults for feeds path.
	feedsPath := resolvedFeeds
	if feedsPath == "" {
		feedsPath = filepath.Join(ConfigHome(), "rss-reader", "feeds.opml")
	} else {
		feedsPath, err = filepath.Abs(feedsPath)
		if err != nil {
			return nil, fmt.Errorf("resolving feeds path: %w", err)
		}
	}

	// Resolve XDG defaults for DB path.
	dbPath := resolvedDB
	if dbPath == "" {
		dbPath = filepath.Join(DataHome(), "rss-reader", "rss.sqlite")
	} else {
		dbPath, err = filepath.Abs(dbPath)
		if err != nil {
			return nil, fmt.Errorf("resolving db path: %w", err)
		}
	}

	// Resolve static dir if set.
	if resolvedStaticDir != "" {
		resolvedStaticDir, err = filepath.Abs(resolvedStaticDir)
		if err != nil {
			return nil, fmt.Errorf("resolving static dir path: %w", err)
		}
	}

	// Create parent directories.
	if err := os.MkdirAll(filepath.Dir(feedsPath), 0755); err != nil {
		return nil, fmt.Errorf("creating feeds directory: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		return nil, fmt.Errorf("creating database directory: %w", err)
	}

	return &Config{
		DBPath:              dbPath,
		FeedsPath:           feedsPath,
		PollIntervalMinutes: resolvedPollInterval,
		Host:                resolvedHost,
		Port:                resolvedPort,
		FrontendURL:         resolvedFrontendURL,
		StaticDir:           resolvedStaticDir,
		Sources:             sources,
	}, nil
}

// resolveString applies the flag > env > file > default priority for a
// string value, recording the winning source under key in sources.
func resolveString(flagVal string, flagSet bool, envKey string, fileVal *string, def string, key string, sources map[string]Source) string {
	if flagSet {
		sources[key] = SourceFlag
		return flagVal
	}
	if v, ok := os.LookupEnv(envKey); ok {
		sources[key] = SourceEnv
		return v
	}
	if fileVal != nil {
		sources[key] = SourceFile
		return *fileVal
	}
	sources[key] = SourceDefault
	return def
}

// resolveInt applies the flag > env > file > default priority for an int value.
func resolveInt(flagVal int, flagSet bool, envKey string, fileVal *int, def int, key string, sources map[string]Source) (int, error) {
	if flagSet {
		sources[key] = SourceFlag
		return flagVal, nil
	}
	if v, ok := os.LookupEnv(envKey); ok {
		n, err := strconv.Atoi(v)
		if err != nil {
			return 0, fmt.Errorf("invalid %s value %q: %w", envKey, v, err)
		}
		sources[key] = SourceEnv
		return n, nil
	}
	if fileVal != nil {
		sources[key] = SourceFile
		return *fileVal, nil
	}
	sources[key] = SourceDefault
	return def, nil
}

// resolveUint64 applies the flag > env > file > default priority for a uint64 value.
func resolveUint64(flagVal uint64, flagSet bool, envKey string, fileVal *uint64, def uint64, key string, sources map[string]Source) (uint64, error) {
	if flagSet {
		sources[key] = SourceFlag
		return flagVal, nil
	}
	if v, ok := os.LookupEnv(envKey); ok {
		n, err := strconv.ParseUint(v, 10, 64)
		if err != nil {
			return 0, fmt.Errorf("invalid %s value %q: %w", envKey, v, err)
		}
		sources[key] = SourceEnv
		return n, nil
	}
	if fileVal != nil {
		sources[key] = SourceFile
		return *fileVal, nil
	}
	sources[key] = SourceDefault
	return def, nil
}
