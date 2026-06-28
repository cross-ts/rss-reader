package poller

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/cross-ts/rss-reader/internal/db"
	"github.com/cross-ts/rss-reader/internal/fetcher"
	"github.com/cross-ts/rss-reader/internal/opmlsync"
)

// RunOnce fetches all feed targets and applies the results.
func RunOnce(database *db.DB, client *http.Client) error {
	targets, err := database.GetFeedTargets()
	if err != nil {
		return err
	}

	slog.Info("poller: starting run", "feed_count", len(targets))

	for _, t := range targets {
		result, err := fetcher.FetchFeedData(client, &t)
		if err != nil {
			slog.Warn("poller: fetch feed failed", "url", t.URL, "error", err)
			continue
		}
		if result == nil {
			// Not modified (304).
			continue
		}
		inserted, err := database.ApplyFetchResult(t.ID, result.Articles, result.Meta)
		if err != nil {
			slog.Warn("poller: apply fetch result failed", "url", t.URL, "error", err)
			continue
		}
		if inserted > 0 {
			slog.Info("poller: new articles", "url", t.URL, "count", inserted)
		}
	}

	if err := database.RebuildSearchIndex(); err != nil {
		return err
	}

	slog.Info("poller: run complete")
	return nil
}

// Start launches the background poller that runs immediately and then on each tick.
func Start(database *db.DB, client *http.Client, intervalMinutes uint64, syncer *opmlsync.Syncer) {
	// Run immediately in a goroutine.
	go func() {
		if syncer != nil {
			if err := syncer.SyncIfChanged(); err != nil {
				slog.Warn("poller: opml sync failed", "error", err)
			}
		}
		if err := RunOnce(database, client); err != nil {
			slog.Error("poller: initial run failed", "error", err)
		}
	}()

	// Start ticker goroutine.
	go func() {
		ticker := time.NewTicker(time.Duration(intervalMinutes) * time.Minute)
		defer ticker.Stop()

		for range ticker.C {
			if syncer != nil {
				if err := syncer.SyncIfChanged(); err != nil {
					slog.Warn("poller: opml sync failed", "error", err)
				}
			}
			if err := RunOnce(database, client); err != nil {
				slog.Error("poller: scheduled run failed", "error", err)
			}
		}
	}()
}
