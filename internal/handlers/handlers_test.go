package handlers

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/cross-ts/rss-reader/internal/db"
	"github.com/cross-ts/rss-reader/internal/feeds"
)

// openTestDB creates a temporary test database.
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

// testClient creates an HTTP client that bypasses SSRF validation by rewriting
// 127.0.0.1 addresses to 8.8.8.8 and routing them back to the test server.
func testClient(servers ...*httptest.Server) (*http.Client, func(serverURL string) string) {
	addrMap := make(map[string]string)
	for _, s := range servers {
		addr := s.Listener.Addr().String()
		_, port, _ := net.SplitHostPort(addr)
		fakeAddr := "8.8.8.8:" + port
		addrMap[fakeAddr] = addr
	}
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			if actual, ok := addrMap[addr]; ok {
				return net.Dial(network, actual)
			}
			return nil, fmt.Errorf("unexpected address: %s", addr)
		},
	}
	client := &http.Client{
		Timeout:   15 * time.Second,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	rewrite := func(serverURL string) string {
		return strings.Replace(serverURL, "127.0.0.1", "8.8.8.8", 1)
	}
	return client, rewrite
}

const validRSSXML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <link>http://example.com</link>
    <item>
      <title>Article 1</title>
      <link>http://example.com/1</link>
      <guid>guid-1</guid>
      <description>Content 1</description>
    </item>
  </channel>
</rss>`

const validRSSXML2 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Second Feed</title>
    <link>http://example2.com</link>
    <item>
      <title>Article 2</title>
      <link>http://example2.com/2</link>
      <guid>guid-2</guid>
      <description>Content 2</description>
    </item>
  </channel>
</rss>`

func htmlWithFeedLink(feedURL string) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
  <title>Test Page</title>
  <link rel="alternate" type="application/rss+xml" href="%s" title="Test Feed"/>
</head>
<body><p>Hello</p></body>
</html>`, feedURL)
}

// itoa converts an int to string.
func itoa(i int) string {
	return strconv.Itoa(i)
}

// seedFeed creates a feed in the test database via OPML reconciliation.
func seedFeed(t *testing.T, database *db.DB, feedsPath string, title, url string) *feeds.Subscriptions {
	t.Helper()
	subs := &feeds.Subscriptions{
		Feeds: []feeds.FeedEntry{
			{Title: title, URL: url},
		},
	}
	if err := readAndReconcile(database, feedsPath, subs); err != nil {
		t.Fatalf("seed feed: %v", err)
	}
	return subs
}

// seedFeedWithFolder creates a feed with a folder in the test database.
func seedFeedWithFolder(t *testing.T, database *db.DB, feedsPath string, title, url, folder string) *feeds.Subscriptions {
	t.Helper()
	subs := &feeds.Subscriptions{
		Folders: []feeds.FolderEntry{{Name: folder}},
		Feeds: []feeds.FeedEntry{
			{Title: title, URL: url, Folder: &folder},
		},
	}
	if err := readAndReconcile(database, feedsPath, subs); err != nil {
		t.Fatalf("seed feed with folder: %v", err)
	}
	return subs
}

// strPtr returns a pointer to the given string.
func strPtr(s string) *string {
	return &s
}

// folderEntry creates a FolderEntry for convenience in tests.
func folderEntry(name string) feeds.FolderEntry {
	return feeds.FolderEntry{Name: name}
}

// seedArticles adds articles to a feed in the database for testing.
func seedArticles(t *testing.T, database *db.DB, feedID int, articles []db.NewArticle) {
	t.Helper()
	fetchedAt := time.Now().UTC().Format("2006-01-02T15:04:05Z")
	meta := &db.FetchMeta{FetchedAt: fetchedAt}
	if _, err := database.ApplyFetchResult(feedID, articles, meta); err != nil {
		t.Fatalf("seed articles: %v", err)
	}
	if err := database.RebuildSearchIndex(); err != nil {
		t.Fatalf("rebuild search index: %v", err)
	}
}
