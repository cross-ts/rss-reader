package opmlsync

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/cross-ts/rss-reader/internal/db"
)

func openTestDB(t *testing.T) *db.DB {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	d, err := db.Open(path)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

const opmlTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>rss-reader subscriptions</title></head>
  <body>
    <outline text="%s" title="%s" type="rss" xmlUrl="%s"></outline>
  </body>
</opml>`

func writeOPML(t *testing.T, path, title, url string) {
	t.Helper()
	content := []byte(`<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>rss-reader subscriptions</title></head>
  <body>
    <outline text="` + title + `" title="` + title + `" type="rss" xmlUrl="` + url + `"></outline>
  </body>
</opml>`)
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatalf("write opml: %v", err)
	}
}

func writeOPMLWithFolder(t *testing.T, path, folder, title, url string) {
	t.Helper()
	content := []byte(`<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>rss-reader subscriptions</title></head>
  <body>
    <outline text="` + folder + `" title="` + folder + `">
      <outline text="` + title + `" title="` + title + `" type="rss" xmlUrl="` + url + `"></outline>
    </outline>
  </body>
</opml>`)
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatalf("write opml: %v", err)
	}
}

func TestSyncIfChanged_InitialSync(t *testing.T) {
	database := openTestDB(t)
	dir := t.TempDir()
	opmlPath := filepath.Join(dir, "feeds.opml")
	mu := &sync.Mutex{}

	writeOPML(t, opmlPath, "Test Feed", "http://example.com/feed.xml")

	syncer := New(database, opmlPath, mu)

	if err := syncer.SyncIfChanged(); err != nil {
		t.Fatalf("SyncIfChanged: %v", err)
	}

	feeds, err := database.ListFeeds()
	if err != nil {
		t.Fatalf("ListFeeds: %v", err)
	}
	if len(feeds) != 1 {
		t.Fatalf("expected 1 feed, got %d", len(feeds))
	}
	if feeds[0].Title != "Test Feed" {
		t.Errorf("expected title 'Test Feed', got %q", feeds[0].Title)
	}
	if feeds[0].URL != "http://example.com/feed.xml" {
		t.Errorf("expected URL 'http://example.com/feed.xml', got %q", feeds[0].URL)
	}
}

func TestSyncIfChanged_DetectsChange(t *testing.T) {
	database := openTestDB(t)
	dir := t.TempDir()
	opmlPath := filepath.Join(dir, "feeds.opml")
	mu := &sync.Mutex{}

	// Write initial OPML and sync.
	writeOPML(t, opmlPath, "Feed A", "http://example.com/a.xml")
	syncer := New(database, opmlPath, mu)

	if err := syncer.SyncIfChanged(); err != nil {
		t.Fatalf("initial SyncIfChanged: %v", err)
	}

	feeds, err := database.ListFeeds()
	if err != nil {
		t.Fatalf("ListFeeds: %v", err)
	}
	if len(feeds) != 1 || feeds[0].URL != "http://example.com/a.xml" {
		t.Fatalf("unexpected initial feeds: %+v", feeds)
	}

	// Rewrite OPML with a different feed, ensuring mtime and size change.
	writeOPMLWithFolder(t, opmlPath, "Tech", "Feed B Updated With Longer Title", "http://example.com/b-updated.xml")
	// Explicitly set mtime into the future to guarantee detection.
	future := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(opmlPath, future, future); err != nil {
		t.Fatalf("chtimes: %v", err)
	}

	if err := syncer.SyncIfChanged(); err != nil {
		t.Fatalf("second SyncIfChanged: %v", err)
	}

	feeds, err = database.ListFeeds()
	if err != nil {
		t.Fatalf("ListFeeds: %v", err)
	}
	if len(feeds) != 1 {
		t.Fatalf("expected 1 feed after update, got %d", len(feeds))
	}
	if feeds[0].URL != "http://example.com/b-updated.xml" {
		t.Errorf("expected updated URL, got %q", feeds[0].URL)
	}
	if feeds[0].Title != "Feed B Updated With Longer Title" {
		t.Errorf("expected updated title, got %q", feeds[0].Title)
	}
}

func TestSyncIfChanged_NoChangeIsNoOp(t *testing.T) {
	database := openTestDB(t)
	dir := t.TempDir()
	opmlPath := filepath.Join(dir, "feeds.opml")
	mu := &sync.Mutex{}

	writeOPML(t, opmlPath, "Stable Feed", "http://example.com/stable.xml")
	syncer := New(database, opmlPath, mu)

	// Initial sync.
	if err := syncer.SyncIfChanged(); err != nil {
		t.Fatalf("initial SyncIfChanged: %v", err)
	}

	// Call again without any change -- should be a no-op.
	if err := syncer.SyncIfChanged(); err != nil {
		t.Fatalf("second SyncIfChanged: %v", err)
	}

	// Call a third time to be sure.
	if err := syncer.SyncIfChanged(); err != nil {
		t.Fatalf("third SyncIfChanged: %v", err)
	}

	feeds, err := database.ListFeeds()
	if err != nil {
		t.Fatalf("ListFeeds: %v", err)
	}
	if len(feeds) != 1 {
		t.Fatalf("expected 1 feed, got %d", len(feeds))
	}
}

func TestSyncIfChanged_FileDeletedDoesNotWipeDB(t *testing.T) {
	database := openTestDB(t)
	dir := t.TempDir()
	opmlPath := filepath.Join(dir, "feeds.opml")
	mu := &sync.Mutex{}

	// Write initial OPML and sync.
	writeOPML(t, opmlPath, "Keep Me", "http://example.com/keep.xml")
	syncer := New(database, opmlPath, mu)

	if err := syncer.SyncIfChanged(); err != nil {
		t.Fatalf("initial SyncIfChanged: %v", err)
	}

	// Verify feed is there.
	feeds, err := database.ListFeeds()
	if err != nil {
		t.Fatalf("ListFeeds: %v", err)
	}
	if len(feeds) != 1 {
		t.Fatalf("expected 1 feed, got %d", len(feeds))
	}

	// Delete the OPML file.
	if err := os.Remove(opmlPath); err != nil {
		t.Fatalf("remove opml: %v", err)
	}

	// SyncIfChanged should succeed without wiping the DB.
	if err := syncer.SyncIfChanged(); err != nil {
		t.Fatalf("SyncIfChanged after delete: %v", err)
	}

	// Feed should still be in the DB.
	feeds, err = database.ListFeeds()
	if err != nil {
		t.Fatalf("ListFeeds: %v", err)
	}
	if len(feeds) != 1 {
		t.Fatalf("expected feed to survive file deletion, got %d feeds", len(feeds))
	}
	if feeds[0].URL != "http://example.com/keep.xml" {
		t.Errorf("expected preserved URL, got %q", feeds[0].URL)
	}
}

func writeOPMLMultiFeeds(t *testing.T, path string, entries []struct{ title, url string }) {
	t.Helper()
	body := ""
	for _, e := range entries {
		body += `    <outline text="` + e.title + `" title="` + e.title + `" type="rss" xmlUrl="` + e.url + `"></outline>` + "\n"
	}
	content := []byte(`<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>rss-reader subscriptions</title></head>
  <body>
` + body + `  </body>
</opml>`)
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatalf("write opml: %v", err)
	}
}

func TestSyncIfChanged_SkipsInvalidURLs(t *testing.T) {
	database := openTestDB(t)
	dir := t.TempDir()
	opmlPath := filepath.Join(dir, "feeds.opml")
	mu := &sync.Mutex{}

	writeOPMLMultiFeeds(t, opmlPath, []struct{ title, url string }{
		{"Valid Feed", "https://example.com/feed.xml"},
		{"File Feed", "file:///etc/passwd"},
		{"FTP Feed", "ftp://example.com/feed"},
		{"Localhost Feed", "http://localhost/feed.xml"},
	})

	syncer := New(database, opmlPath, mu)

	if err := syncer.SyncIfChanged(); err != nil {
		t.Fatalf("SyncIfChanged: %v", err)
	}

	feeds, err := database.ListFeeds()
	if err != nil {
		t.Fatalf("ListFeeds: %v", err)
	}
	if len(feeds) != 1 {
		t.Fatalf("expected 1 feed, got %d", len(feeds))
	}
	if feeds[0].Title != "Valid Feed" {
		t.Errorf("expected title 'Valid Feed', got %q", feeds[0].Title)
	}
	for _, f := range feeds {
		if f.Title == "File Feed" || f.Title == "FTP Feed" || f.Title == "Localhost Feed" {
			t.Errorf("feed %q should have been skipped", f.Title)
		}
	}
}

func TestMarkSynced(t *testing.T) {
	database := openTestDB(t)
	dir := t.TempDir()
	opmlPath := filepath.Join(dir, "feeds.opml")
	mu := &sync.Mutex{}

	writeOPML(t, opmlPath, "Marked Feed", "http://example.com/marked.xml")
	syncer := New(database, opmlPath, mu)

	// MarkSynced should not error.
	if err := syncer.MarkSynced(); err != nil {
		t.Fatalf("MarkSynced: %v", err)
	}

	// After MarkSynced, SyncIfChanged should be a no-op (no change detected).
	if err := syncer.SyncIfChanged(); err != nil {
		t.Fatalf("SyncIfChanged after MarkSynced: %v", err)
	}

	// DB should still be empty because MarkSynced doesn't reconcile.
	feeds, err := database.ListFeeds()
	if err != nil {
		t.Fatalf("ListFeeds: %v", err)
	}
	if len(feeds) != 0 {
		t.Fatalf("expected 0 feeds (MarkSynced does not reconcile), got %d", len(feeds))
	}
}

func TestMarkSynced_FileNotExist(t *testing.T) {
	database := openTestDB(t)
	mu := &sync.Mutex{}

	syncer := New(database, "/nonexistent/feeds.opml", mu)

	// Should not error when file does not exist.
	if err := syncer.MarkSynced(); err != nil {
		t.Fatalf("MarkSynced with missing file: %v", err)
	}
}
