package main

import (
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/cross-ts/rss-reader/internal/db"
	"github.com/cross-ts/rss-reader/internal/feeds"
)

// openTestDB creates a fresh database in a temp directory for testing.
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

// writeTestOPML writes a minimal OPML file with one folder and one feed.
func writeTestOPML(t *testing.T, path string) {
	t.Helper()
	content := `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>test</title></head>
  <body>
    <outline text="Tech">
      <outline text="Go Blog" type="rss" xmlUrl="https://go.dev/blog/feed.atom" htmlUrl="https://go.dev/blog"/>
    </outline>
  </body>
</opml>`
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write test OPML: %v", err)
	}
}

func TestRun_ParseError(t *testing.T) {
	oldArgs := os.Args
	t.Cleanup(func() { os.Args = oldArgs })

	os.Args = []string{"test", "-frontend-url", "ftp://invalid"}
	err := run()
	if err == nil {
		t.Fatal("expected error for invalid frontend URL scheme")
	}
}

func TestRun_ListenError(t *testing.T) {
	oldArgs := os.Args
	t.Cleanup(func() { os.Args = oldArgs })

	dir := t.TempDir()

	// Bind a port so ListenAndServe will fail with "address already in use".
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("bind: %v", err)
	}
	defer ln.Close()
	_, port, _ := net.SplitHostPort(ln.Addr().String())

	os.Args = []string{"test",
		"-db", filepath.Join(dir, "test.db"),
		"-feeds", filepath.Join(dir, "feeds.opml"),
		"-host", "127.0.0.1",
		"-port", port,
		"-frontend-url", "http://localhost:3000",
	}

	err = run()
	if err == nil {
		t.Fatal("expected error from ListenAndServe")
	}
	if !strings.Contains(err.Error(), "http server") {
		t.Errorf("expected 'http server' in error, got: %v", err)
	}
}

func TestRun_StaticDirMode(t *testing.T) {
	oldArgs := os.Args
	t.Cleanup(func() { os.Args = oldArgs })

	dir := t.TempDir()
	staticDir := t.TempDir()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("bind: %v", err)
	}
	defer ln.Close()
	_, port, _ := net.SplitHostPort(ln.Addr().String())

	os.Args = []string{"test",
		"-db", filepath.Join(dir, "test.db"),
		"-feeds", filepath.Join(dir, "feeds.opml"),
		"-host", "127.0.0.1",
		"-port", port,
		"-frontend-url", "http://localhost:3000",
		"-static-dir", staticDir,
	}

	err = run()
	if err == nil {
		t.Fatal("expected error from ListenAndServe")
	}
}

func TestReconcile(t *testing.T) {
	t.Run("with folders and feeds", func(t *testing.T) {
		database := openTestDB(t)

		folder := "Tech"
		siteURL := "https://go.dev/blog"
		subs := &feeds.Subscriptions{
			Folders: []feeds.FolderEntry{{Name: "Tech"}},
			Feeds: []feeds.FeedEntry{
				{
					Title:   "Go Blog",
					URL:     "https://go.dev/blog/feed.atom",
					Folder:  &folder,
					SiteURL: &siteURL,
				},
			},
		}

		if err := reconcile(database, subs); err != nil {
			t.Fatalf("reconcile: %v", err)
		}

		// Verify folders were created.
		folders, err := database.ListFolders()
		if err != nil {
			t.Fatalf("list folders: %v", err)
		}
		if len(folders) != 1 {
			t.Fatalf("expected 1 folder, got %d", len(folders))
		}
		if folders[0].Name != "Tech" {
			t.Errorf("expected folder name %q, got %q", "Tech", folders[0].Name)
		}

		// Verify feeds were created.
		feedList, err := database.ListFeeds()
		if err != nil {
			t.Fatalf("list feeds: %v", err)
		}
		if len(feedList) != 1 {
			t.Fatalf("expected 1 feed, got %d", len(feedList))
		}
		if feedList[0].Title != "Go Blog" {
			t.Errorf("expected feed title %q, got %q", "Go Blog", feedList[0].Title)
		}
		if feedList[0].URL != "https://go.dev/blog/feed.atom" {
			t.Errorf("expected feed URL %q, got %q", "https://go.dev/blog/feed.atom", feedList[0].URL)
		}
		if feedList[0].SiteURL == nil || *feedList[0].SiteURL != siteURL {
			t.Errorf("expected site URL %q, got %v", siteURL, feedList[0].SiteURL)
		}
		if feedList[0].Folder == nil || *feedList[0].Folder != "Tech" {
			t.Errorf("expected folder %q, got %v", "Tech", feedList[0].Folder)
		}
	})

	t.Run("skips feeds with invalid URLs", func(t *testing.T) {
		database := openTestDB(t)
		folder := "Tech"
		subs := &feeds.Subscriptions{
			Folders: []feeds.FolderEntry{{Name: "Tech"}},
			Feeds: []feeds.FeedEntry{
				{Title: "Valid Feed", URL: "https://example.com/feed.xml", Folder: &folder},
				{Title: "File Feed", URL: "file:///etc/passwd", Folder: &folder},
				{Title: "FTP Feed", URL: "ftp://example.com/feed", Folder: &folder},
				{Title: "Localhost Feed", URL: "http://localhost/feed.xml", Folder: &folder},
			},
		}

		if err := reconcile(database, subs); err != nil {
			t.Fatalf("reconcile: %v", err)
		}

		feedList, err := database.ListFeeds()
		if err != nil {
			t.Fatalf("list feeds: %v", err)
		}
		if len(feedList) != 1 {
			t.Fatalf("expected 1 feed, got %d", len(feedList))
		}
		if feedList[0].Title != "Valid Feed" {
			t.Errorf("expected feed title %q, got %q", "Valid Feed", feedList[0].Title)
		}
		for _, f := range feedList {
			if f.Title == "File Feed" || f.Title == "FTP Feed" || f.Title == "Localhost Feed" {
				t.Errorf("feed %q should have been skipped", f.Title)
			}
		}
	})

	t.Run("with empty subscriptions", func(t *testing.T) {
		database := openTestDB(t)

		subs := &feeds.Subscriptions{}
		if err := reconcile(database, subs); err != nil {
			t.Fatalf("reconcile with empty subs: %v", err)
		}

		feedCount, err := database.FeedCount()
		if err != nil {
			t.Fatalf("feed count: %v", err)
		}
		if feedCount != 0 {
			t.Errorf("expected 0 feeds, got %d", feedCount)
		}
	})
}

func TestReconcileOnStartup(t *testing.T) {
	t.Run("OPML exists with feeds", func(t *testing.T) {
		database := openTestDB(t)
		dir := t.TempDir()
		opmlPath := filepath.Join(dir, "feeds.opml")
		writeTestOPML(t, opmlPath)

		if err := reconcileOnStartup(database, opmlPath); err != nil {
			t.Fatalf("reconcileOnStartup: %v", err)
		}

		// Verify feeds were reconciled.
		feedList, err := database.ListFeeds()
		if err != nil {
			t.Fatalf("list feeds: %v", err)
		}
		if len(feedList) != 1 {
			t.Fatalf("expected 1 feed, got %d", len(feedList))
		}
		if feedList[0].Title != "Go Blog" {
			t.Errorf("expected feed title %q, got %q", "Go Blog", feedList[0].Title)
		}

		// Verify folder was created.
		folders, err := database.ListFolders()
		if err != nil {
			t.Fatalf("list folders: %v", err)
		}
		if len(folders) != 1 {
			t.Fatalf("expected 1 folder, got %d", len(folders))
		}
		if folders[0].Name != "Tech" {
			t.Errorf("expected folder name %q, got %q", "Tech", folders[0].Name)
		}
	})

	t.Run("OPML absent and DB empty", func(t *testing.T) {
		database := openTestDB(t)
		dir := t.TempDir()
		opmlPath := filepath.Join(dir, "feeds.opml")

		if err := reconcileOnStartup(database, opmlPath); err != nil {
			t.Fatalf("reconcileOnStartup: %v", err)
		}

		// Should have generated an empty feeds.opml.
		if _, err := os.Stat(opmlPath); err != nil {
			t.Fatalf("expected feeds.opml to be created: %v", err)
		}

		// DB should still be empty.
		feedCount, err := database.FeedCount()
		if err != nil {
			t.Fatalf("feed count: %v", err)
		}
		if feedCount != 0 {
			t.Errorf("expected 0 feeds, got %d", feedCount)
		}
	})

	t.Run("OPML absent and DB has feeds", func(t *testing.T) {
		database := openTestDB(t)

		// Seed the DB with a feed so it's non-empty.
		err := database.ReconcileSubscriptions(
			nil,
			[]db.FeedDef{{Title: "Existing", URL: "https://example.com/feed.xml"}},
		)
		if err != nil {
			t.Fatalf("seed feeds: %v", err)
		}

		dir := t.TempDir()
		opmlPath := filepath.Join(dir, "nonexistent.opml")

		err = reconcileOnStartup(database, opmlPath)
		if err == nil {
			t.Fatal("expected error when OPML absent and DB has feeds")
		}
		if !strings.Contains(err.Error(), "feeds.opml が見つかりません") {
			t.Errorf("expected error about missing feeds.opml, got: %v", err)
		}
	})

	t.Run("OPML with invalid XML", func(t *testing.T) {
		database := openTestDB(t)
		dir := t.TempDir()
		opmlPath := filepath.Join(dir, "feeds.opml")

		if err := os.WriteFile(opmlPath, []byte("<<<not xml>>>"), 0644); err != nil {
			t.Fatalf("write invalid OPML: %v", err)
		}

		err := reconcileOnStartup(database, opmlPath)
		if err == nil {
			t.Fatal("expected error for invalid XML")
		}
		if !strings.Contains(err.Error(), "read feeds.opml") {
			t.Errorf("expected 'read feeds.opml' in error, got: %v", err)
		}
	})

	t.Run("OPML save error on nonexistent directory", func(t *testing.T) {
		database := openTestDB(t)
		opmlPath := filepath.Join(t.TempDir(), "missing", "subdir", "feeds.opml")

		err := reconcileOnStartup(database, opmlPath)
		if err == nil {
			t.Fatal("expected error when SaveOPML fails")
		}
		if !strings.Contains(err.Error(), "save empty feeds.opml") {
			t.Errorf("expected 'save empty feeds.opml' in error, got: %v", err)
		}
	})
}
