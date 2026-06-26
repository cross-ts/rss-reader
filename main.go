package main

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"

	"github.com/cross-ts/rss-reader/internal/config"
	"github.com/cross-ts/rss-reader/internal/db"
	"github.com/cross-ts/rss-reader/internal/feeds"
	"github.com/cross-ts/rss-reader/internal/fetcher"
	"github.com/cross-ts/rss-reader/internal/poller"
	"github.com/cross-ts/rss-reader/internal/server"
)

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Parse()
	if err != nil {
		return err
	}

	bindAddr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)

	slog.Info("Starting rss-reader")
	slog.Info("config", "bind", bindAddr, "db", cfg.DBPath, "feeds", cfg.FeedsPath)
	if cfg.StaticDir != "" {
		slog.Info("frontend", "mode", "static dir", "dir", cfg.StaticDir)
	} else {
		slog.Info("frontend", "mode", "reverse-proxy", "url", cfg.FrontendURL)
	}

	// Open the database (creates parent dir, runs migrations, validates FTS5).
	database, err := db.Open(cfg.DBPath)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer database.Close()

	// feeds.opml fail-safe startup sequence.
	if err := reconcileOnStartup(database, cfg.FeedsPath); err != nil {
		return err
	}

	// Rebuild FTS index for any articles inserted before the triggers existed.
	if err := database.RebuildSearchIndex(); err != nil {
		return fmt.Errorf("rebuild search index: %w", err)
	}

	// HTTP clients: feed client disables auto-redirect (manual SSRF check),
	// proxy client follows redirects for frontend serving.
	feedClient := fetcher.NewFeedClient()
	proxyClient := fetcher.NewProxyClient()

	state := &server.AppState{
		DB:          database,
		Config:      cfg,
		FeedClient:  feedClient,
		ProxyClient: proxyClient,
	}

	// Start background poller (immediate run + interval ticker).
	poller.Start(database, feedClient, cfg.PollIntervalMinutes)

	mux := server.NewServeMux(state)
	handler := server.CORSMiddleware(mux)

	slog.Info("Listening", "addr", "http://"+bindAddr)
	if err := http.ListenAndServe(bindAddr, handler); err != nil {
		return fmt.Errorf("http server: %w", err)
	}
	return nil
}

// reconcileOnStartup implements the feeds.opml fail-safe startup logic:
//   - feeds.opml present -> reconcile DB to match it.
//   - absent + DB has subscriptions -> abort (prevent accidental wipe).
//   - absent + DB empty -> generate an empty feeds.opml and reconcile.
func reconcileOnStartup(database *db.DB, feedsPath string) error {
	subs, err := feeds.ReadFeedsOPML(feedsPath)
	if err != nil {
		return fmt.Errorf("read feeds.opml: %w", err)
	}

	if subs == nil {
		feedCount, err := database.FeedCount()
		if err != nil {
			return fmt.Errorf("count feeds: %w", err)
		}
		if feedCount > 0 {
			return fmt.Errorf(
				"feeds.opml が見つかりません（パス: %s）が、DB には %d 件の購読があります。"+
					"パスやファイル権限を確認してください。誤って全削除しないよう起動を中止します",
				feedsPath, feedCount,
			)
		}
		slog.Info("feeds.opml absent and DB empty; generating empty feeds.opml", "path", feedsPath)
		subs = &feeds.Subscriptions{}
		if err := feeds.SaveOPML(feedsPath, subs); err != nil {
			return fmt.Errorf("save empty feeds.opml: %w", err)
		}
	} else {
		slog.Info("feeds.opml found; reconciling",
			"folders", len(subs.Folders), "feeds", len(subs.Feeds))
	}

	return reconcile(database, subs)
}

// reconcile converts subscriptions to DB defs and reconciles the database.
func reconcile(database *db.DB, subs *feeds.Subscriptions) error {
	folderDefs := make([]db.FolderDef, len(subs.Folders))
	for i, f := range subs.Folders {
		folderDefs[i] = db.FolderDef{Name: f.Name}
	}
	feedDefs := make([]db.FeedDef, len(subs.Feeds))
	for i, f := range subs.Feeds {
		feedDefs[i] = db.FeedDef{
			Title:   f.Title,
			URL:     f.URL,
			Folder:  f.Folder,
			SiteURL: f.SiteURL,
		}
	}
	return database.ReconcileSubscriptions(folderDefs, feedDefs)
}
