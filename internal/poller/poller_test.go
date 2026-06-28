package poller

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
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

func seedFeeds(t *testing.T, database *db.DB, feedDefs []db.FeedDef) {
	t.Helper()
	err := database.ReconcileSubscriptions(nil, feedDefs)
	if err != nil {
		t.Fatalf("seed feeds: %v", err)
	}
}

func seedFeed(t *testing.T, database *db.DB, title, url string) {
	t.Helper()
	seedFeeds(t, database, []db.FeedDef{{Title: title, URL: url}})
}

func TestRunOnce_NoFeeds(t *testing.T) {
	database := openTestDB(t)
	client := http.DefaultClient

	err := RunOnce(database, client)
	if err != nil {
		t.Fatalf("RunOnce with no feeds: %v", err)
	}
}

func TestRunOnce_SuccessfulFetch(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		w.Write([]byte(validRSSXML))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	feedURL := rewrite(ts.URL) + "/feed.xml"

	database := openTestDB(t)
	seedFeed(t, database, "Test Feed", feedURL)

	err := RunOnce(database, client)
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}

	// Verify articles were inserted.
	result, err := database.ListArticles(db.ArticleFilter{Limit: 50})
	if err != nil {
		t.Fatalf("list articles: %v", err)
	}
	if result.Total != 1 {
		t.Errorf("expected 1 article, got %d", result.Total)
	}
}

func TestRunOnce_FetchFailure(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "server error", http.StatusInternalServerError)
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	feedURL := rewrite(ts.URL) + "/feed.xml"

	database := openTestDB(t)
	seedFeed(t, database, "Bad Feed", feedURL)

	// RunOnce should not return error even if individual feeds fail.
	err := RunOnce(database, client)
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}

	// No articles should have been inserted.
	result, err := database.ListArticles(db.ArticleFilter{Limit: 50})
	if err != nil {
		t.Fatalf("list articles: %v", err)
	}
	if result.Total != 0 {
		t.Errorf("expected 0 articles, got %d", result.Total)
	}
}

func TestRunOnce_NotModified(t *testing.T) {
	requestCount := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		if requestCount == 1 {
			// First request: return content with ETag.
			w.Header().Set("Content-Type", "application/rss+xml")
			w.Header().Set("Etag", `"test-etag"`)
			w.Write([]byte(validRSSXML))
			return
		}
		// Second request: return 304 if If-None-Match is set.
		if r.Header.Get("If-None-Match") == `"test-etag"` {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Content-Type", "application/rss+xml")
		w.Write([]byte(validRSSXML))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	feedURL := rewrite(ts.URL) + "/feed.xml"

	database := openTestDB(t)
	seedFeed(t, database, "Test Feed", feedURL)

	// First run: fetch content.
	if err := RunOnce(database, client); err != nil {
		t.Fatalf("first RunOnce: %v", err)
	}

	// Second run: should get 304.
	if err := RunOnce(database, client); err != nil {
		t.Fatalf("second RunOnce: %v", err)
	}
}

func TestRunOnce_InvalidFeedBody(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		w.Write([]byte("this is not valid XML"))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	feedURL := rewrite(ts.URL) + "/feed.xml"

	database := openTestDB(t)
	seedFeed(t, database, "Bad XML Feed", feedURL)

	// Should not return error (individual feed errors are logged, not returned).
	err := RunOnce(database, client)
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
}

func TestRunOnce_MultipleFeeds(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		if strings.Contains(r.URL.Path, "feed2") {
			w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
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
</rss>`))
		} else {
			w.Write([]byte(validRSSXML))
		}
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	feed1URL := rewrite(ts.URL) + "/feed1.xml"
	feed2URL := rewrite(ts.URL) + "/feed2.xml"

	database := openTestDB(t)
	seedFeeds(t, database, []db.FeedDef{
		{Title: "Feed 1", URL: feed1URL},
		{Title: "Feed 2", URL: feed2URL},
	})

	err := RunOnce(database, client)
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}

	result, err := database.ListArticles(db.ArticleFilter{Limit: 50})
	if err != nil {
		t.Fatalf("list articles: %v", err)
	}
	if result.Total != 2 {
		t.Errorf("expected 2 articles from 2 feeds, got %d", result.Total)
	}
}

func TestRunOnce_DBError(t *testing.T) {
	database := openTestDB(t)
	database.Close()

	err := RunOnce(database, http.DefaultClient)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestStart_DBError(t *testing.T) {
	database := openTestDB(t)
	database.Close()

	// Start should not panic even with a closed DB.
	Start(database, http.DefaultClient, 60)

	// Wait for the initial goroutine to finish (it will log an error).
	time.Sleep(500 * time.Millisecond)
}

func TestStart(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		w.Write([]byte(validRSSXML))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	feedURL := rewrite(ts.URL) + "/feed.xml"

	database := openTestDB(t)
	seedFeed(t, database, "Test Feed", feedURL)

	// Start with a large interval so only the initial run fires.
	Start(database, client, 60)

	// Wait a bit for the initial goroutine to complete.
	time.Sleep(2 * time.Second)

	result, err := database.ListArticles(db.ArticleFilter{Limit: 50})
	if err != nil {
		t.Fatalf("list articles: %v", err)
	}
	if result.Total < 1 {
		t.Errorf("expected at least 1 article after Start, got %d", result.Total)
	}
}

