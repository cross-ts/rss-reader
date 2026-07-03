package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/cross-ts/rss-reader/internal/feeds"
)

const sampleImportOPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>import</title></head>
  <body>
    <outline text="Tech">
      <outline text="Existing Feed" title="Existing Feed" type="rss" xmlUrl="https://example.com/existing.xml" />
      <outline text="New Feed" title="New Feed" type="rss" xmlUrl="https://example.com/new.xml" />
    </outline>
  </body>
</opml>`

const sampleImportOPMLWithInvalid = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>import</title></head>
  <body>
    <outline text="Tech">
      <outline text="Existing Feed" title="Existing Feed" type="rss" xmlUrl="https://example.com/existing.xml" />
      <outline text="New Feed" title="New Feed" type="rss" xmlUrl="https://example.com/new.xml" />
      <outline text="File URL Feed" title="File URL Feed" type="rss" xmlUrl="file:///etc/passwd" />
      <outline text="FTP Feed" title="FTP Feed" type="rss" xmlUrl="ftp://example.com/feed" />
    </outline>
  </body>
</opml>`

// sampleImportOPMLWithInternalDup contains two entries that normalize to the
// same URL (one already has a scheme, the other is bare and gets
// "https://" prepended by NormalizeURL), plus one genuinely new feed.
const sampleImportOPMLWithInternalDup = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>import</title></head>
  <body>
    <outline text="Tech">
      <outline text="Dup Feed A" title="Dup Feed A" type="rss" xmlUrl="https://example.com/dup.xml" />
      <outline text="Dup Feed B" title="Dup Feed B" type="rss" xmlUrl="example.com/dup.xml" />
      <outline text="New Feed" title="New Feed" type="rss" xmlUrl="https://example.com/new.xml" />
    </outline>
  </body>
</opml>`

func TestExportOPML_NotFound(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")

	var lock sync.Mutex
	handler := ExportOPML(database, feedsPath, &lock)
	req := httptest.NewRequest("GET", "/api/opml/export", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestExportOPML_Success(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	seedFeed(t, database, feedsPath, "Test Feed", "https://example.com/feed.xml")

	var lock sync.Mutex
	handler := ExportOPML(database, feedsPath, &lock)
	req := httptest.NewRequest("GET", "/api/opml/export", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/xml" {
		t.Errorf("expected Content-Type application/xml, got %q", ct)
	}
	if cd := w.Header().Get("Content-Disposition"); !strings.Contains(cd, `filename="feeds.opml"`) {
		t.Errorf("expected Content-Disposition with filename, got %q", cd)
	}
	if !strings.Contains(w.Body.String(), "https://example.com/feed.xml") {
		t.Errorf("expected body to contain feed url, got %q", w.Body.String())
	}
}

func TestImportOPML_InvalidXML(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")

	var lock sync.Mutex
	handler := ImportOPML(database, feedsPath, &lock)
	req := httptest.NewRequest("POST", "/api/opml/import", strings.NewReader("not xml"))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestImportOPML_DryRun(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	seedFeed(t, database, feedsPath, "Existing Feed", "https://example.com/existing.xml")

	var lock sync.Mutex
	handler := ImportOPML(database, feedsPath, &lock)
	req := httptest.NewRequest("POST", "/api/opml/import?dryRun=true", strings.NewReader(sampleImportOPML))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp opmlPreviewResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.TotalFeeds != 2 {
		t.Errorf("expected totalFeeds=2, got %d", resp.TotalFeeds)
	}
	if resp.NewFeeds != 1 {
		t.Errorf("expected newFeeds=1, got %d", resp.NewFeeds)
	}
	if resp.DuplicateFeeds != 1 {
		t.Errorf("expected duplicateFeeds=1, got %d", resp.DuplicateFeeds)
	}
	if len(resp.Folders) != 1 || resp.Folders[0].Name != "Tech" || resp.Folders[0].FeedCount != 2 {
		t.Errorf("expected folders=[{Tech 2}], got %+v", resp.Folders)
	}

	dupCount := 0
	for _, f := range resp.Feeds {
		if f.Duplicate {
			dupCount++
			if f.URL != "https://example.com/existing.xml" {
				t.Errorf("expected duplicate feed to be existing.xml, got %s", f.URL)
			}
		}
	}
	if dupCount != 1 {
		t.Errorf("expected 1 duplicate feed in list, got %d", dupCount)
	}

	// Dry run must not mutate DB or OPML file.
	feedCount, err := database.FeedCount()
	if err != nil {
		t.Fatalf("feed count: %v", err)
	}
	if feedCount != 1 {
		t.Errorf("expected feed count unchanged at 1, got %d", feedCount)
	}
	onDisk, err := feeds.ReadFeedsOPML(feedsPath)
	if err != nil {
		t.Fatalf("read opml: %v", err)
	}
	if len(onDisk.Feeds) != 1 {
		t.Errorf("expected opml file unchanged with 1 feed, got %d", len(onDisk.Feeds))
	}
}

func TestImportOPML_Execute(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	seedFeed(t, database, feedsPath, "Existing Feed", "https://example.com/existing.xml")

	var lock sync.Mutex
	handler := ImportOPML(database, feedsPath, &lock)
	req := httptest.NewRequest("POST", "/api/opml/import", strings.NewReader(sampleImportOPML))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp opmlImportResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Imported != 1 {
		t.Errorf("expected imported=1, got %d", resp.Imported)
	}
	if resp.Skipped != 1 {
		t.Errorf("expected skipped=1, got %d", resp.Skipped)
	}

	feed, err := database.GetFeedByURL("https://example.com/new.xml")
	if err != nil {
		t.Fatalf("get imported feed: %v", err)
	}
	if feed.Folder == nil || *feed.Folder != "Tech" {
		t.Errorf("expected imported feed folder Tech, got %+v", feed.Folder)
	}

	feedCount, err := database.FeedCount()
	if err != nil {
		t.Fatalf("feed count: %v", err)
	}
	if feedCount != 2 {
		t.Errorf("expected 2 feeds after import (dup skipped), got %d", feedCount)
	}

	onDisk, err := feeds.ReadFeedsOPML(feedsPath)
	if err != nil {
		t.Fatalf("read opml: %v", err)
	}
	if len(onDisk.Feeds) != 2 {
		t.Errorf("expected opml file to have 2 feeds, got %d", len(onDisk.Feeds))
	}
}

func TestImportOPML_DryRun_InvalidURLs(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	seedFeed(t, database, feedsPath, "Existing Feed", "https://example.com/existing.xml")

	var lock sync.Mutex
	handler := ImportOPML(database, feedsPath, &lock)
	req := httptest.NewRequest("POST", "/api/opml/import?dryRun=true", strings.NewReader(sampleImportOPMLWithInvalid))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp opmlPreviewResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.TotalFeeds != 4 {
		t.Errorf("expected totalFeeds=4, got %d", resp.TotalFeeds)
	}
	if resp.NewFeeds != 1 {
		t.Errorf("expected newFeeds=1, got %d", resp.NewFeeds)
	}
	if resp.DuplicateFeeds != 1 {
		t.Errorf("expected duplicateFeeds=1, got %d", resp.DuplicateFeeds)
	}
	if resp.InvalidFeeds != 2 {
		t.Errorf("expected invalidFeeds=2, got %d", resp.InvalidFeeds)
	}
	// Invalid feeds must not count toward the folder's feedCount.
	if len(resp.Folders) != 1 || resp.Folders[0].Name != "Tech" || resp.Folders[0].FeedCount != 2 {
		t.Errorf("expected folders=[{Tech 2}] (excluding invalid), got %+v", resp.Folders)
	}

	invalidCount := 0
	for _, f := range resp.Feeds {
		if f.Invalid {
			invalidCount++
			if f.Duplicate {
				t.Errorf("invalid feed %s must not also be marked duplicate", f.URL)
			}
		}
	}
	if invalidCount != 2 {
		t.Errorf("expected 2 invalid feeds in list, got %d", invalidCount)
	}

	// Dry run must not mutate DB or OPML file.
	feedCount, err := database.FeedCount()
	if err != nil {
		t.Fatalf("feed count: %v", err)
	}
	if feedCount != 1 {
		t.Errorf("expected feed count unchanged at 1, got %d", feedCount)
	}
}

func TestImportOPML_Execute_InvalidURLsExcluded(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	seedFeed(t, database, feedsPath, "Existing Feed", "https://example.com/existing.xml")

	var lock sync.Mutex
	handler := ImportOPML(database, feedsPath, &lock)
	req := httptest.NewRequest("POST", "/api/opml/import", strings.NewReader(sampleImportOPMLWithInvalid))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp opmlImportResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Imported != 1 {
		t.Errorf("expected imported=1, got %d", resp.Imported)
	}
	if resp.Skipped != 1 {
		t.Errorf("expected skipped=1, got %d", resp.Skipped)
	}
	if resp.Invalid != 2 {
		t.Errorf("expected invalid=2, got %d", resp.Invalid)
	}

	// Invalid feeds must never be persisted.
	if _, err := database.GetFeedByURL("file:///etc/passwd"); err == nil {
		t.Error("expected file:// feed to not be persisted")
	}
	if _, err := database.GetFeedByURL("ftp://example.com/feed"); err == nil {
		t.Error("expected ftp:// feed to not be persisted")
	}

	feedCount, err := database.FeedCount()
	if err != nil {
		t.Fatalf("feed count: %v", err)
	}
	if feedCount != 2 {
		t.Errorf("expected 2 feeds after import (1 existing + 1 new, dup skipped, invalid excluded), got %d", feedCount)
	}

	onDisk, err := feeds.ReadFeedsOPML(feedsPath)
	if err != nil {
		t.Fatalf("read opml: %v", err)
	}
	if len(onDisk.Feeds) != 2 {
		t.Errorf("expected opml file to have 2 feeds, got %d", len(onDisk.Feeds))
	}
	for _, f := range onDisk.Feeds {
		if f.URL == "file:///etc/passwd" || f.URL == "ftp://example.com/feed" {
			t.Errorf("invalid feed %s must not be written to feeds.opml", f.URL)
		}
	}
}

func TestImportOPML_DryRun_InternalDuplicateURLsMatchExecute(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")

	var lock sync.Mutex
	handler := ImportOPML(database, feedsPath, &lock)
	req := httptest.NewRequest("POST", "/api/opml/import?dryRun=true", strings.NewReader(sampleImportOPMLWithInternalDup))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp opmlPreviewResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	// Two of the three imported entries normalize to the same URL
	// (https://example.com/dup.xml). Since neither exists yet, the first
	// occurrence must be "new" and the second "duplicate" - matching what
	// the actual import execution does - rather than both being "new".
	if resp.TotalFeeds != 3 {
		t.Errorf("expected totalFeeds=3, got %d", resp.TotalFeeds)
	}
	if resp.NewFeeds != 2 {
		t.Errorf("expected newFeeds=2 (dup.xml first occurrence + new.xml), got %d", resp.NewFeeds)
	}
	if resp.DuplicateFeeds != 1 {
		t.Errorf("expected duplicateFeeds=1 (dup.xml second occurrence), got %d", resp.DuplicateFeeds)
	}

	if len(resp.Feeds) != 3 {
		t.Fatalf("expected 3 feeds in preview, got %d", len(resp.Feeds))
	}
	if resp.Feeds[0].URL != "https://example.com/dup.xml" || resp.Feeds[0].Duplicate {
		t.Errorf("expected first dup.xml entry to be new, got %+v", resp.Feeds[0])
	}
	if resp.Feeds[1].URL != "https://example.com/dup.xml" || !resp.Feeds[1].Duplicate {
		t.Errorf("expected second dup.xml entry (normalized from bare URL) to be duplicate, got %+v", resp.Feeds[1])
	}
	if resp.Feeds[2].URL != "https://example.com/new.xml" || resp.Feeds[2].Duplicate {
		t.Errorf("expected new.xml entry to be new, got %+v", resp.Feeds[2])
	}

	// Now compare against the actual execution: exactly one of the two
	// dup.xml entries should be imported, matching newFeeds above.
	execReq := httptest.NewRequest("POST", "/api/opml/import", strings.NewReader(sampleImportOPMLWithInternalDup))
	execW := httptest.NewRecorder()
	handler(execW, execReq)

	if execW.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", execW.Code, execW.Body.String())
	}
	var execResp opmlImportResponse
	if err := json.NewDecoder(execW.Body).Decode(&execResp); err != nil {
		t.Fatalf("decode exec response: %v", err)
	}
	if execResp.Imported != resp.NewFeeds {
		t.Errorf("expected execute imported=%d to match preview newFeeds, got %d", resp.NewFeeds, execResp.Imported)
	}
	if execResp.Skipped != resp.DuplicateFeeds {
		t.Errorf("expected execute skipped=%d to match preview duplicateFeeds, got %d", resp.DuplicateFeeds, execResp.Skipped)
	}

	feedCount, err := database.FeedCount()
	if err != nil {
		t.Fatalf("feed count: %v", err)
	}
	if feedCount != 2 {
		t.Errorf("expected 2 feeds persisted (dup.xml once + new.xml), got %d", feedCount)
	}
}

func TestNormalizeAndValidateFeedURL(t *testing.T) {
	cases := []struct {
		in    string
		valid bool
	}{
		{"https://example.com/feed.xml", true},
		{"example.com/feed.xml", true}, // no scheme -> normalized to https
		{"file:///etc/passwd", false},
		{"ftp://example.com/feed", false},
	}
	for _, c := range cases {
		_, valid := normalizeAndValidateFeedURL(c.in)
		if valid != c.valid {
			t.Errorf("normalizeAndValidateFeedURL(%q): expected valid=%v, got %v", c.in, c.valid, valid)
		}
	}
}
