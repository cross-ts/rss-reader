package handlers

import (
	"log/slog"
	"net/http"
	"strconv"

	"github.com/cross-ts/rss-reader/internal/db"
	"github.com/cross-ts/rss-reader/internal/fetcher"
)

// Refresh returns an http.HandlerFunc that refreshes feeds.
func Refresh(database *db.DB, feedClient *http.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var targets []db.FeedTarget
		var err error

		if feedIDStr := r.URL.Query().Get("feedId"); feedIDStr != "" {
			feedID, parseErr := strconv.Atoi(feedIDStr)
			if parseErr != nil {
				http.Error(w, "invalid feedId", http.StatusBadRequest)
				return
			}
			targets, err = database.GetFeedTargetsByID(feedID)
		} else {
			targets, err = database.GetFeedTargets()
		}

		if err != nil {
			slog.Error("get feed targets", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		refreshed := 0
		for i := range targets {
			result, fetchErr := fetcher.FetchFeedData(feedClient, &targets[i])
			if fetchErr != nil {
				slog.Warn("refresh: fetch feed failed", "url", targets[i].URL, "error", fetchErr)
				continue
			}
			if result == nil {
				// Not modified (304).
				refreshed++
				continue
			}
			if _, applyErr := database.ApplyFetchResult(targets[i].ID, result.Articles, result.Meta); applyErr != nil {
				slog.Warn("refresh: apply fetch result failed", "url", targets[i].URL, "error", applyErr)
				continue
			}
			refreshed++
		}

		if err := database.RebuildSearchIndex(); err != nil {
			slog.Warn("refresh: rebuild search index failed", "error", err)
		}

		writeJSON(w, http.StatusOK, map[string]int{
			"refreshed": refreshed,
		})
	}
}
