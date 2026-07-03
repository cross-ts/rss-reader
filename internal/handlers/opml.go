package handlers

import (
	"io"
	"log/slog"
	"net/http"
	"os"
	"sort"
	"sync"

	"github.com/cross-ts/rss-reader/internal/db"
	"github.com/cross-ts/rss-reader/internal/feeds"
	"github.com/cross-ts/rss-reader/internal/fetcher"
)

// maxOPMLImportBytes is the maximum accepted size for an OPML import body.
const maxOPMLImportBytes = 1 << 20 // 1MB

// ExportOPML returns an http.HandlerFunc that serves the raw feeds.opml file.
func ExportOPML(database *db.DB, feedsPath string, feedsLock *sync.Mutex) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		feedsLock.Lock()
		defer feedsLock.Unlock()

		data, err := os.ReadFile(feedsPath)
		if err != nil {
			if os.IsNotExist(err) {
				http.Error(w, "feeds.opml not found", http.StatusNotFound)
				return
			}
			slog.Error("export opml: read file", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/xml")
		w.Header().Set("Content-Disposition", `attachment; filename="feeds.opml"`)
		w.WriteHeader(http.StatusOK)
		w.Write(data)
	}
}

// opmlPreviewFeed describes a single feed in an import preview.
type opmlPreviewFeed struct {
	Title     string  `json:"title"`
	URL       string  `json:"url"`
	Folder    *string `json:"folder"`
	Duplicate bool    `json:"duplicate"`
	Invalid   bool    `json:"invalid"`
}

// opmlPreviewFolder describes a folder and its feed count in an import preview.
type opmlPreviewFolder struct {
	Name      string `json:"name"`
	FeedCount int    `json:"feedCount"`
}

// opmlPreviewResponse is the JSON response for a dry-run OPML import.
type opmlPreviewResponse struct {
	TotalFeeds     int                 `json:"totalFeeds"`
	NewFeeds       int                 `json:"newFeeds"`
	DuplicateFeeds int                 `json:"duplicateFeeds"`
	InvalidFeeds   int                 `json:"invalidFeeds"`
	Folders        []opmlPreviewFolder `json:"folders"`
	Feeds          []opmlPreviewFeed   `json:"feeds"`
}

// opmlImportResponse is the JSON response for an executed OPML import.
type opmlImportResponse struct {
	Imported int `json:"imported"`
	Skipped  int `json:"skipped"`
	Invalid  int `json:"invalid"`
}

// normalizeAndValidateFeedURL normalizes a feed URL the same way the manual
// "add feed" flow does, then applies the same static SSRF validation used by
// opmlsync (scheme/host/IP-literal checks, no DNS resolution). Returns the
// normalized URL and whether it is valid.
func normalizeAndValidateFeedURL(rawURL string) (string, bool) {
	normalized := fetcher.NormalizeURL(rawURL)
	if err := fetcher.ValidateFeedURLStatic(normalized); err != nil {
		return normalized, false
	}
	return normalized, true
}

// normalizeImportedFeeds normalizes each feed's URL in place and returns a
// parallel slice indicating which entries passed SSRF validation. Feeds must
// be filtered/indexed against this slice before being persisted or counted
// as new/duplicate.
func normalizeImportedFeeds(subs *feeds.Subscriptions) []bool {
	valid := make([]bool, len(subs.Feeds))
	for i := range subs.Feeds {
		normalized, ok := normalizeAndValidateFeedURL(subs.Feeds[i].URL)
		subs.Feeds[i].URL = normalized
		valid[i] = ok
	}
	return valid
}

// ImportOPML returns an http.HandlerFunc that previews (dryRun=true) or
// executes an OPML import, merging new feeds into the existing subscriptions.
func ImportOPML(database *db.DB, feedsPath string, feedsLock *sync.Mutex) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxOPMLImportBytes)
		data, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "request body too large or unreadable", http.StatusBadRequest)
			return
		}

		imported, err := feeds.ParseOPML(data)
		if err != nil {
			http.Error(w, "invalid OPML", http.StatusBadRequest)
			return
		}

		// Normalize and validate each imported feed URL the same way the
		// manual "add feed" flow does, so import can't be used to bypass
		// SSRF protections. Invalid feeds are excluded from saving, and
		// duplicate detection uses the normalized URL.
		validFlags := normalizeImportedFeeds(imported)

		dryRun := r.URL.Query().Get("dryRun") == "true"

		feedsLock.Lock()
		defer feedsLock.Unlock()

		existing, err := ensureSubscriptions(database, feedsPath)
		if err != nil {
			writeOPMLError(w, "read OPML", err)
			return
		}

		existingURLs := make(map[string]bool, len(existing.Feeds))
		for _, f := range existing.Feeds {
			existingURLs[fetcher.NormalizeURL(f.URL)] = true
		}

		if dryRun {
			writeJSON(w, http.StatusOK, buildOPMLPreview(imported, validFlags, existingURLs))
			return
		}

		existingFolders := make(map[string]bool, len(existing.Folders))
		for _, f := range existing.Folders {
			existingFolders[f.Name] = true
		}

		importedCount, skipped, invalid := 0, 0, 0
		for i, f := range imported.Feeds {
			if !validFlags[i] {
				invalid++
				continue
			}
			if existingURLs[f.URL] {
				skipped++
				continue
			}
			existingURLs[f.URL] = true
			if f.Folder != nil && !existingFolders[*f.Folder] {
				existing.Folders = append(existing.Folders, feeds.FolderEntry{Name: *f.Folder})
				existingFolders[*f.Folder] = true
			}
			existing.Feeds = append(existing.Feeds, f)
			importedCount++
		}

		if err := readAndReconcile(database, feedsPath, existing); err != nil {
			writeOPMLError(w, "reconcile after import opml", err)
			return
		}

		writeJSON(w, http.StatusOK, opmlImportResponse{Imported: importedCount, Skipped: skipped, Invalid: invalid})
	}
}

// buildOPMLPreview computes preview statistics for a dry-run OPML import.
// imported.Feeds URLs must already be normalized, with validFlags indicating
// which entries (by index) passed SSRF validation. existingURLs is treated
// as read-only; a local copy is mutated as feeds are walked so that two
// imported feeds which normalize to the same URL are counted the same way
// the actual import execution would (first occurrence new, later ones
// duplicate), rather than both being counted as new.
func buildOPMLPreview(imported *feeds.Subscriptions, validFlags []bool, existingURLs map[string]bool) opmlPreviewResponse {
	resp := opmlPreviewResponse{
		Feeds: make([]opmlPreviewFeed, 0, len(imported.Feeds)),
	}

	seenURLs := make(map[string]bool, len(existingURLs))
	for url := range existingURLs {
		seenURLs[url] = true
	}

	folderCounts := map[string]int{}

	for i, f := range imported.Feeds {
		invalidFeed := !validFlags[i]
		dup := !invalidFeed && seenURLs[f.URL]
		resp.TotalFeeds++
		switch {
		case invalidFeed:
			resp.InvalidFeeds++
		case dup:
			resp.DuplicateFeeds++
		default:
			resp.NewFeeds++
			seenURLs[f.URL] = true
		}
		if !invalidFeed && f.Folder != nil {
			folderCounts[*f.Folder]++
		}
		resp.Feeds = append(resp.Feeds, opmlPreviewFeed{
			Title:     f.Title,
			URL:       f.URL,
			Folder:    f.Folder,
			Duplicate: dup,
			Invalid:   invalidFeed,
		})
	}

	folderNames := make([]string, 0, len(folderCounts))
	for name := range folderCounts {
		folderNames = append(folderNames, name)
	}
	sort.Strings(folderNames)
	resp.Folders = make([]opmlPreviewFolder, 0, len(folderNames))
	for _, name := range folderNames {
		resp.Folders = append(resp.Folders, opmlPreviewFolder{Name: name, FeedCount: folderCounts[name]})
	}

	return resp
}
