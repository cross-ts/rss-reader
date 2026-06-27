package config

import (
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
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
}

// Parse parses configuration from CLI flags.
// Priority: CLI flag > default value.
func Parse() (*Config, error) {
	fs := flag.NewFlagSet(os.Args[0], flag.ContinueOnError)

	feeds := fs.String("feeds", "", "Path to feeds OPML file")
	db := fs.String("db", "", "Path to SQLite database")
	host := fs.String("host", "127.0.0.1", "Listen host")
	port := fs.Int("port", 3000, "Listen port")
	fs.IntVar(port, "p", 3000, "Listen port (shorthand)")
	frontendURL := fs.String("frontend-url", "https://cross-ts.github.io/rss-reader/", "Frontend URL")
	staticDir := fs.String("static-dir", "", "Static file directory")
	pollInterval := fs.Uint64("poll-interval", 15, "Poll interval in minutes")

	if err := fs.Parse(os.Args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			os.Exit(0)
		}
		return nil, err
	}

	// Validate FrontendURL: must have http or https scheme.
	u, err := url.Parse(*frontendURL)
	if err != nil {
		return nil, fmt.Errorf("invalid frontend URL %q: %w", *frontendURL, err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("frontend URL must use http or https scheme, got %q", u.Scheme)
	}

	// Resolve XDG defaults for feeds path.
	feedsPath := *feeds
	if feedsPath == "" {
		feedsPath = filepath.Join(ConfigHome(), "rss-reader", "feeds.opml")
	} else {
		feedsPath, err = filepath.Abs(feedsPath)
		if err != nil {
			return nil, fmt.Errorf("resolving feeds path: %w", err)
		}
	}

	// Resolve XDG defaults for DB path.
	dbPath := *db
	if dbPath == "" {
		dbPath = filepath.Join(DataHome(), "rss-reader", "rss.sqlite")
	} else {
		dbPath, err = filepath.Abs(dbPath)
		if err != nil {
			return nil, fmt.Errorf("resolving db path: %w", err)
		}
	}

	// Resolve static dir if set.
	resolvedStaticDir := *staticDir
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
		PollIntervalMinutes: *pollInterval,
		Host:                *host,
		Port:                *port,
		FrontendURL:         *frontendURL,
		StaticDir:           resolvedStaticDir,
	}, nil
}
