package handlers

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/cross-ts/rss-reader/internal/db"
	"github.com/cross-ts/rss-reader/internal/feeds"
	"github.com/cross-ts/rss-reader/internal/fetcher"
)

// FeedResponse is the JSON response for a feed.
type FeedResponse struct {
	ID           int     `json:"id"`
	Title        string  `json:"title"`
	URL          string  `json:"url"`
	SiteURL      *string `json:"siteUrl"`
	Folder       *string `json:"folder"`
	ArticleCount int64   `json:"articleCount"`
}

// feedToResponse converts a db.Feed to a FeedResponse.
func feedToResponse(f *db.Feed) FeedResponse {
	return FeedResponse{
		ID:           f.ID,
		Title:        f.Title,
		URL:          f.URL,
		SiteURL:      f.SiteURL,
		Folder:       f.Folder,
		ArticleCount: f.ArticleCount,
	}
}

// ListFeeds returns an http.HandlerFunc that lists all feeds.
func ListFeeds(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		feedList, err := database.ListFeeds()
		if err != nil {
			slog.Error("list feeds", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		resp := make([]FeedResponse, len(feedList))
		for i := range feedList {
			resp[i] = feedToResponse(&feedList[i])
		}

		writeJSON(w, http.StatusOK, resp)
	}
}

// CreateFeed returns an http.HandlerFunc that creates a new feed subscription.
func CreateFeed(database *db.DB, feedsPath string, feedsLock *sync.Mutex, feedClient *http.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			URL    string  `json:"url"`
			Folder *string `json:"folder"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		rawURL := strings.TrimSpace(body.URL)
		if rawURL == "" {
			http.Error(w, "url is required", http.StatusBadRequest)
			return
		}

		rawURL = fetcher.NormalizeURL(rawURL)

		// SSRF validation.
		if err := fetcher.ValidateFeedURL(rawURL); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Resolve feed URL (discover actual feed URL from HTML page if needed).
		resolved, err := fetcher.ResolveFeed(feedClient, rawURL)
		if err != nil {
			slog.Error("resolve feed", "url", rawURL, "error", err)
			http.Error(w, "could not resolve feed", http.StatusNotFound)
			return
		}

		feedsLock.Lock()

		subs, err := ensureSubscriptions(feedsPath)
		if err != nil {
			feedsLock.Unlock()
			slog.Error("read OPML", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		// Add folder if specified and not exists.
		if body.Folder != nil {
			folderName := strings.TrimSpace(*body.Folder)
			if folderName != "" {
				found := false
				for _, f := range subs.Folders {
					if f.Name == folderName {
						found = true
						break
					}
				}
				if !found {
					subs.Folders = append(subs.Folders, feeds.FolderEntry{Name: folderName})
				}
			}
		}

		// Add feed if URL not exists.
		feedExists := false
		for _, f := range subs.Feeds {
			if f.URL == resolved.FeedURL {
				feedExists = true
				break
			}
		}
		if !feedExists {
			var folder *string
			if body.Folder != nil {
				trimmed := strings.TrimSpace(*body.Folder)
				if trimmed != "" {
					folder = &trimmed
				}
			}
			subs.Feeds = append(subs.Feeds, feeds.FeedEntry{
				Title:   resolved.Title,
				URL:     resolved.FeedURL,
				Folder:  folder,
				SiteURL: resolved.SiteURL,
			})
		}

		if err := readAndReconcile(database, feedsPath, subs); err != nil {
			feedsLock.Unlock()
			slog.Error("reconcile after create feed", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		feed, err := database.GetFeedByURL(resolved.FeedURL)
		if err != nil {
			feedsLock.Unlock()
			slog.Error("get feed by url", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		feedsLock.Unlock()

		// Fetch initial articles synchronously so the client sees them immediately.
		targets, fetchErr := database.GetFeedTargetsByID(feed.ID)
		if fetchErr != nil {
			slog.Warn("get feed targets for initial fetch", "error", fetchErr)
		} else {
			for i := range targets {
				result, err := fetcher.FetchFeedData(feedClient, &targets[i])
				if err != nil {
					slog.Warn("initial fetch feed", "url", targets[i].URL, "error", err)
					continue
				}
				if result == nil {
					continue
				}
				if _, err := database.ApplyFetchResult(targets[i].ID, result.Articles, result.Meta); err != nil {
					slog.Warn("apply initial fetch result", "url", targets[i].URL, "error", err)
				}
			}
			if err := database.RebuildSearchIndex(); err != nil {
				slog.Warn("rebuild search index after initial fetch", "error", err)
			}
		}

		// Re-read the feed to include the updated article count.
		feed, err = database.GetFeedByURL(resolved.FeedURL)
		if err != nil {
			slog.Error("get feed after initial fetch", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		writeJSON(w, http.StatusCreated, feedToResponse(feed))
	}
}

type discoverCandidate struct {
	FeedURL string  `json:"feedUrl"`
	Title   string  `json:"title"`
	SiteURL *string `json:"siteUrl,omitempty"`
	Type    string  `json:"type,omitempty"`
}

// DiscoverFeed returns an http.HandlerFunc that discovers feed URLs from a page URL.
func DiscoverFeed(feedClient *http.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			URL string `json:"url"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		rawURL := strings.TrimSpace(body.URL)
		if rawURL == "" {
			http.Error(w, "url is required", http.StatusBadRequest)
			return
		}

		rawURL = fetcher.NormalizeURL(rawURL)

		if err := fetcher.ValidateFeedURL(rawURL); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		candidates, err := fetcher.ResolveFeeds(feedClient, rawURL)
		if err != nil {
			http.Error(w, "feed not found", http.StatusNotFound)
			return
		}

		resp := make([]discoverCandidate, len(candidates))
		for i, c := range candidates {
			resp[i] = discoverCandidate{
				FeedURL: c.FeedURL,
				Title:   c.Title,
				SiteURL: c.SiteURL,
				Type:    c.Type,
			}
		}

		writeJSON(w, http.StatusOK, resp)
	}
}

// UpdateFeed returns an http.HandlerFunc that updates a feed's title and/or folder.
func UpdateFeed(database *db.DB, feedsPath string, feedsLock *sync.Mutex) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "invalid feed id", http.StatusBadRequest)
			return
		}

		// Parse body as map to distinguish absent vs null vs value for "folder".
		var raw map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		// Extract title (optional string).
		var newTitle *string
		if titleRaw, ok := raw["title"]; ok {
			var t string
			if err := json.Unmarshal(titleRaw, &t); err == nil {
				trimmed := strings.TrimSpace(t)
				if trimmed != "" {
					newTitle = &trimmed
				}
			}
		}

		// Extract folder (3-value: absent=don't change, null=remove, string=set).
		type folderAction int
		const (
			folderKeep   folderAction = iota // key absent
			folderRemove                     // key present, value null
			folderSet                        // key present, value string
		)
		action := folderKeep
		var folderValue string

		if folderRaw, ok := raw["folder"]; ok {
			if string(folderRaw) == "null" {
				action = folderRemove
			} else {
				var f string
				if err := json.Unmarshal(folderRaw, &f); err == nil {
					action = folderSet
					folderValue = strings.TrimSpace(f)
				}
			}
		}

		feedsLock.Lock()
		defer feedsLock.Unlock()

		oldURL, oldTitle, oldFolder, err := database.GetFeedInfoByID(id)
		if err != nil {
			http.Error(w, "feed not found", http.StatusNotFound)
			return
		}

		// Compute effective title.
		effectiveTitle := oldTitle
		if newTitle != nil {
			effectiveTitle = *newTitle
		}

		// Compute effective folder.
		var effectiveFolder *string
		switch action {
		case folderKeep:
			effectiveFolder = oldFolder
		case folderRemove:
			effectiveFolder = nil
		case folderSet:
			if folderValue != "" {
				effectiveFolder = &folderValue
			}
		}

		subs, err := ensureSubscriptions(feedsPath)
		if err != nil {
			slog.Error("read OPML", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		// Add new folder if needed.
		if effectiveFolder != nil {
			found := false
			for _, f := range subs.Folders {
				if f.Name == *effectiveFolder {
					found = true
					break
				}
			}
			if !found {
				subs.Folders = append(subs.Folders, feeds.FolderEntry{Name: *effectiveFolder})
			}
		}

		// Update feed entry in OPML.
		for i := range subs.Feeds {
			if subs.Feeds[i].URL == oldURL {
				subs.Feeds[i].Title = effectiveTitle
				subs.Feeds[i].Folder = effectiveFolder
				break
			}
		}

		if err := readAndReconcile(database, feedsPath, subs); err != nil {
			slog.Error("reconcile after update feed", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		feed, err := database.GetFeedByURL(oldURL)
		if err != nil {
			slog.Error("get feed by url", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		writeJSON(w, http.StatusOK, feedToResponse(feed))
	}
}

// DeleteFeed returns an http.HandlerFunc that deletes a feed subscription.
func DeleteFeed(database *db.DB, feedsPath string, feedsLock *sync.Mutex) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "invalid feed id", http.StatusBadRequest)
			return
		}

		feedsLock.Lock()
		defer feedsLock.Unlock()

		feedURL, err := database.GetFeedURLByID(id)
		if err != nil {
			http.Error(w, "feed not found", http.StatusNotFound)
			return
		}

		subs, err := ensureSubscriptions(feedsPath)
		if err != nil {
			slog.Error("read OPML", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		// Remove feed from OPML.
		newFeeds := make([]feeds.FeedEntry, 0, len(subs.Feeds))
		for _, f := range subs.Feeds {
			if f.URL != feedURL {
				newFeeds = append(newFeeds, f)
			}
		}
		subs.Feeds = newFeeds

		if err := readAndReconcile(database, feedsPath, subs); err != nil {
			slog.Error("reconcile after delete feed", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}
