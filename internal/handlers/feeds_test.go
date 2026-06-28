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

func TestListFeeds_DBError(t *testing.T) {
	database := openTestDB(t)
	database.Close()

	handler := ListFeeds(database)
	req := httptest.NewRequest("GET", "/api/feeds", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestListFeeds_Empty(t *testing.T) {
	database := openTestDB(t)

	handler := ListFeeds(database)
	req := httptest.NewRequest("GET", "/api/feeds", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp []FeedResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp) != 0 {
		t.Fatalf("expected 0 feeds, got %d", len(resp))
	}
}

func TestListFeeds_WithFeeds(t *testing.T) {
	database := openTestDB(t)

	// Seed a feed via reconciliation.
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	subs := seedFeed(t, database, feedsPath, "Test Feed", "https://example.com/feed.xml")

	_ = subs
	handler := ListFeeds(database)
	req := httptest.NewRequest("GET", "/api/feeds", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp []FeedResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp) != 1 {
		t.Fatalf("expected 1 feed, got %d", len(resp))
	}
	if resp[0].Title != "Test Feed" {
		t.Errorf("expected title 'Test Feed', got %q", resp[0].Title)
	}
}

func TestCreateFeed_OPMLError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		w.Write([]byte(validRSSXML))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	feedURL := rewrite(ts.URL) + "/feed.xml"

	database := openTestDB(t)
	// Use a directory as feedsPath to cause ensureSubscriptions to fail.
	feedsPath := t.TempDir()
	var mu sync.Mutex

	handler := CreateFeed(database, feedsPath, &mu, client)
	body := `{"url": "` + feedURL + `"}`
	req := httptest.NewRequest("POST", "/api/feeds", strings.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreateFeed_ResolveFeedError(t *testing.T) {
	// Server returns non-feed content without any feed links.
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	feedURL := rewrite(ts.URL) + "/page"

	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	handler := CreateFeed(database, feedsPath, &mu, client)
	body := `{"url": "` + feedURL + `"}`
	req := httptest.NewRequest("POST", "/api/feeds", strings.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreateFeed_DBError_AfterResolve(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		w.Write([]byte(validRSSXML))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	feedURL := rewrite(ts.URL) + "/feed.xml"

	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	// Close DB so that ensureSubscriptions->ReconcileSubscriptions fails.
	database.Close()

	handler := CreateFeed(database, feedsPath, &mu, client)
	body := `{"url": "` + feedURL + `"}`
	req := httptest.NewRequest("POST", "/api/feeds", strings.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreateFeed_EmptyURL(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	handler := CreateFeed(database, feedsPath, &mu, http.DefaultClient)
	body := `{"url": ""}`
	req := httptest.NewRequest("POST", "/api/feeds", strings.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreateFeed_InvalidBody(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	handler := CreateFeed(database, feedsPath, &mu, http.DefaultClient)
	req := httptest.NewRequest("POST", "/api/feeds", strings.NewReader("not json"))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreateFeed_SSRFBlocked(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	handler := CreateFeed(database, feedsPath, &mu, http.DefaultClient)
	body := `{"url": "http://127.0.0.1:9999/feed"}`
	req := httptest.NewRequest("POST", "/api/feeds", strings.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreateFeed_Success(t *testing.T) {
	// Test server serving valid RSS.
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		w.Write([]byte(validRSSXML))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	feedURL := rewrite(ts.URL) + "/feed.xml"

	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	handler := CreateFeed(database, feedsPath, &mu, client)
	body := `{"url": "` + feedURL + `"}`
	req := httptest.NewRequest("POST", "/api/feeds", strings.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp FeedResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Title != "Test Feed" {
		t.Errorf("expected title 'Test Feed', got %q", resp.Title)
	}
	if resp.ArticleCount != 1 {
		t.Errorf("expected 1 article, got %d", resp.ArticleCount)
	}
}

func TestCreateFeed_SuccessWithFolder(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		w.Write([]byte(validRSSXML))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	feedURL := rewrite(ts.URL) + "/feed.xml"

	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	handler := CreateFeed(database, feedsPath, &mu, client)
	body := `{"url": "` + feedURL + `", "folder": "Tech"}`
	req := httptest.NewRequest("POST", "/api/feeds", strings.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp FeedResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Folder == nil || *resp.Folder != "Tech" {
		t.Errorf("expected folder 'Tech', got %v", resp.Folder)
	}
}

func TestCreateFeed_WithExistingFolder(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		w.Write([]byte(validRSSXML))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	feedURL := rewrite(ts.URL) + "/feed.xml"

	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	// Pre-create a folder.
	createFolderHandler := CreateFolder(database, feedsPath, &mu)
	fReq := httptest.NewRequest("POST", "/api/folders", strings.NewReader(`{"name":"Tech"}`))
	fW := httptest.NewRecorder()
	createFolderHandler(fW, fReq)
	if fW.Code != http.StatusCreated {
		t.Fatalf("create folder: expected 201, got %d", fW.Code)
	}

	// Create feed in the existing folder.
	handler := CreateFeed(database, feedsPath, &mu, client)
	body := `{"url": "` + feedURL + `", "folder": "Tech"}`
	req := httptest.NewRequest("POST", "/api/feeds", strings.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp FeedResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Folder == nil || *resp.Folder != "Tech" {
		t.Errorf("expected folder 'Tech', got %v", resp.Folder)
	}
}

func TestCreateFeed_EmptyFolderName(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		w.Write([]byte(validRSSXML))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	feedURL := rewrite(ts.URL) + "/feed.xml"

	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	// Folder is empty string - should be treated as no folder.
	handler := CreateFeed(database, feedsPath, &mu, client)
	body := `{"url": "` + feedURL + `", "folder": ""}`
	req := httptest.NewRequest("POST", "/api/feeds", strings.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp FeedResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Folder != nil {
		t.Errorf("expected nil folder for empty folder name, got %v", *resp.Folder)
	}
}

func TestCreateFeed_DuplicateURL(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		w.Write([]byte(validRSSXML))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	feedURL := rewrite(ts.URL) + "/feed.xml"

	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	handler := CreateFeed(database, feedsPath, &mu, client)

	// First creation.
	body := `{"url": "` + feedURL + `"}`
	req := httptest.NewRequest("POST", "/api/feeds", strings.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("first create: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	// Second creation with same URL.
	req2 := httptest.NewRequest("POST", "/api/feeds", strings.NewReader(body))
	w2 := httptest.NewRecorder()
	handler(w2, req2)
	if w2.Code != http.StatusCreated {
		t.Fatalf("second create: expected 201, got %d: %s", w2.Code, w2.Body.String())
	}
}

func TestCreateFeed_ResolveFromHTML(t *testing.T) {
	// Feed server.
	feedServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		w.Write([]byte(validRSSXML))
	}))
	defer feedServer.Close()

	_, feedRewrite := testClient(feedServer)
	feedURL := feedRewrite(feedServer.URL) + "/feed.xml"

	// HTML server referencing the feed.
	htmlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(htmlWithFeedLink(feedURL)))
	}))
	defer htmlServer.Close()

	client, htmlRewrite := testClient(feedServer, htmlServer)
	htmlURL := htmlRewrite(htmlServer.URL)

	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	handler := CreateFeed(database, feedsPath, &mu, client)
	body := `{"url": "` + htmlURL + `"}`
	req := httptest.NewRequest("POST", "/api/feeds", strings.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp FeedResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Title != "Test Feed" {
		t.Errorf("expected title 'Test Feed', got %q", resp.Title)
	}
}

func TestDiscoverFeed_EmptyURL(t *testing.T) {
	handler := DiscoverFeed(http.DefaultClient)
	body := `{"url": ""}`
	req := httptest.NewRequest("POST", "/api/discover", strings.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestDiscoverFeed_InvalidBody(t *testing.T) {
	handler := DiscoverFeed(http.DefaultClient)
	req := httptest.NewRequest("POST", "/api/discover", strings.NewReader("not json"))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestDiscoverFeed_SSRFBlocked(t *testing.T) {
	handler := DiscoverFeed(http.DefaultClient)
	body := `{"url": "http://127.0.0.1:9999/page"}`
	req := httptest.NewRequest("POST", "/api/discover", strings.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestDiscoverFeed_DirectFeed(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		w.Write([]byte(validRSSXML))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	feedURL := rewrite(ts.URL) + "/feed.xml"

	handler := DiscoverFeed(client)
	body := `{"url": "` + feedURL + `"}`
	req := httptest.NewRequest("POST", "/api/discover", strings.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp []discoverCandidate
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp) != 1 {
		t.Fatalf("expected 1 candidate, got %d", len(resp))
	}
	if resp[0].Title != "Test Feed" {
		t.Errorf("expected title 'Test Feed', got %q", resp[0].Title)
	}
}

func TestDiscoverFeed_FromHTML(t *testing.T) {
	feedServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		w.Write([]byte(validRSSXML))
	}))
	defer feedServer.Close()

	_, feedRewrite := testClient(feedServer)
	feedURL := feedRewrite(feedServer.URL) + "/feed.xml"

	htmlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(htmlWithFeedLink(feedURL)))
	}))
	defer htmlServer.Close()

	client, htmlRewrite := testClient(feedServer, htmlServer)
	htmlURL := htmlRewrite(htmlServer.URL)

	handler := DiscoverFeed(client)
	body := `{"url": "` + htmlURL + `"}`
	req := httptest.NewRequest("POST", "/api/discover", strings.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp []discoverCandidate
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp) < 1 {
		t.Fatalf("expected at least 1 candidate, got %d", len(resp))
	}
}

func TestDiscoverFeed_NoFeedFound(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(`<html><body>No feeds here</body></html>`))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)

	handler := DiscoverFeed(client)
	body := `{"url": "` + rewrite(ts.URL) + `"}`
	req := httptest.NewRequest("POST", "/api/discover", strings.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdateFeed_InvalidID(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/feeds/{id}", UpdateFeed(database, feedsPath, &mu))

	req := httptest.NewRequest("PATCH", "/api/feeds/abc", strings.NewReader(`{"title":"New"}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdateFeed_InvalidBody(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/feeds/{id}", UpdateFeed(database, feedsPath, &mu))

	req := httptest.NewRequest("PATCH", "/api/feeds/1", strings.NewReader("not json"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdateFeed_NotFound(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/feeds/{id}", UpdateFeed(database, feedsPath, &mu))

	req := httptest.NewRequest("PATCH", "/api/feeds/999", strings.NewReader(`{"title":"New"}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestUpdateFeed_RenameTitle(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	seedFeed(t, database, feedsPath, "Old Title", "https://example.com/feed.xml")

	// Get the feed ID.
	feedList, err := database.ListFeeds()
	if err != nil {
		t.Fatalf("list feeds: %v", err)
	}
	if len(feedList) != 1 {
		t.Fatalf("expected 1 feed, got %d", len(feedList))
	}
	feedID := feedList[0].ID

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/feeds/{id}", UpdateFeed(database, feedsPath, &mu))

	body := `{"title":"New Title"}`
	req := httptest.NewRequest("PATCH", "/api/feeds/"+strings.TrimSpace(itoa(feedID)), strings.NewReader(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp FeedResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Title != "New Title" {
		t.Errorf("expected title 'New Title', got %q", resp.Title)
	}
}

func TestUpdateFeed_SetFolder(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	seedFeed(t, database, feedsPath, "Test Feed", "https://example.com/feed.xml")

	feedList, err := database.ListFeeds()
	if err != nil {
		t.Fatalf("list feeds: %v", err)
	}
	feedID := feedList[0].ID

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/feeds/{id}", UpdateFeed(database, feedsPath, &mu))

	body := `{"folder":"Tech"}`
	req := httptest.NewRequest("PATCH", "/api/feeds/"+itoa(feedID), strings.NewReader(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp FeedResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Folder == nil || *resp.Folder != "Tech" {
		t.Errorf("expected folder 'Tech', got %v", resp.Folder)
	}
}

func TestUpdateFeed_SetExistingFolder(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	// Create feed with folder "FolderA", and also create "FolderB".
	seedFeedWithFolder(t, database, feedsPath, "Test Feed", "https://example.com/feed.xml", "FolderA")
	subs, _ := ensureSubscriptions(feedsPath)
	subs.Folders = append(subs.Folders, folderEntry("FolderB"))
	if err := readAndReconcile(database, feedsPath, subs); err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	feedList, _ := database.ListFeeds()
	feedID := feedList[0].ID

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/feeds/{id}", UpdateFeed(database, feedsPath, &mu))

	// Move feed from FolderA to existing FolderB.
	body := `{"folder":"FolderB"}`
	req := httptest.NewRequest("PATCH", "/api/feeds/"+itoa(feedID), strings.NewReader(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp FeedResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Folder == nil || *resp.Folder != "FolderB" {
		t.Errorf("expected folder 'FolderB', got %v", resp.Folder)
	}
}

func TestUpdateFeed_RemoveFolder(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	seedFeedWithFolder(t, database, feedsPath, "Test Feed", "https://example.com/feed.xml", "Tech")

	feedList, err := database.ListFeeds()
	if err != nil {
		t.Fatalf("list feeds: %v", err)
	}
	feedID := feedList[0].ID

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/feeds/{id}", UpdateFeed(database, feedsPath, &mu))

	body := `{"folder":null}`
	req := httptest.NewRequest("PATCH", "/api/feeds/"+itoa(feedID), strings.NewReader(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp FeedResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Folder != nil {
		t.Errorf("expected nil folder, got %v", *resp.Folder)
	}
}

func TestUpdateFeed_ReconcileError(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	seedFeed(t, database, feedsPath, "Test Feed", "https://example.com/feed.xml")

	feedList, _ := database.ListFeeds()
	feedID := feedList[0].ID

	// Point to a path where writing will fail (non-existent parent dir).
	badFeedsPath := filepath.Join(t.TempDir(), "nonexistent", "subdir", "feeds.opml")

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/feeds/{id}", UpdateFeed(database, badFeedsPath, &mu))

	req := httptest.NewRequest("PATCH", "/api/feeds/"+itoa(feedID), strings.NewReader(`{"title":"New"}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdateFeed_OPMLError(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	seedFeed(t, database, feedsPath, "Test Feed", "https://example.com/feed.xml")

	feedList, _ := database.ListFeeds()
	feedID := feedList[0].ID

	// Remove the OPML file and replace with a directory to cause ensureSubscriptions error.
	badFeedsPath := t.TempDir()

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/feeds/{id}", UpdateFeed(database, badFeedsPath, &mu))

	req := httptest.NewRequest("PATCH", "/api/feeds/"+itoa(feedID), strings.NewReader(`{"title":"New"}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdateFeed_DBError(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	seedFeed(t, database, feedsPath, "Test Feed", "https://example.com/feed.xml")

	feedList, _ := database.ListFeeds()
	feedID := feedList[0].ID

	database.Close()

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/feeds/{id}", UpdateFeed(database, feedsPath, &mu))

	req := httptest.NewRequest("PATCH", "/api/feeds/"+itoa(feedID), strings.NewReader(`{"title":"New"}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 (DB closed), got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeleteFeed_ReconcileError(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	seedFeed(t, database, feedsPath, "Test Feed", "https://example.com/feed.xml")

	feedList, _ := database.ListFeeds()
	feedID := feedList[0].ID

	badFeedsPath := filepath.Join(t.TempDir(), "nonexistent", "subdir", "feeds.opml")

	mux := http.NewServeMux()
	mux.HandleFunc("DELETE /api/feeds/{id}", DeleteFeed(database, badFeedsPath, &mu))

	req := httptest.NewRequest("DELETE", "/api/feeds/"+itoa(feedID), nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeleteFeed_OPMLError(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	seedFeed(t, database, feedsPath, "Test Feed", "https://example.com/feed.xml")

	feedList, _ := database.ListFeeds()
	feedID := feedList[0].ID

	badFeedsPath := t.TempDir()

	mux := http.NewServeMux()
	mux.HandleFunc("DELETE /api/feeds/{id}", DeleteFeed(database, badFeedsPath, &mu))

	req := httptest.NewRequest("DELETE", "/api/feeds/"+itoa(feedID), nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeleteFeed_DBError(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	seedFeed(t, database, feedsPath, "Test Feed", "https://example.com/feed.xml")

	feedList, _ := database.ListFeeds()
	feedID := feedList[0].ID

	database.Close()

	mux := http.NewServeMux()
	mux.HandleFunc("DELETE /api/feeds/{id}", DeleteFeed(database, feedsPath, &mu))

	req := httptest.NewRequest("DELETE", "/api/feeds/"+itoa(feedID), nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 (DB closed), got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeleteFeed_InvalidID(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	mux := http.NewServeMux()
	mux.HandleFunc("DELETE /api/feeds/{id}", DeleteFeed(database, feedsPath, &mu))

	req := httptest.NewRequest("DELETE", "/api/feeds/abc", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestDeleteFeed_NotFound(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	mux := http.NewServeMux()
	mux.HandleFunc("DELETE /api/feeds/{id}", DeleteFeed(database, feedsPath, &mu))

	req := httptest.NewRequest("DELETE", "/api/feeds/999", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestDeleteFeed_SuccessWithMultipleFeeds(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	// Create two feeds.
	subs := &feeds.Subscriptions{
		Feeds: []feeds.FeedEntry{
			{Title: "Feed 1", URL: "https://a.example.com/feed.xml"},
			{Title: "Feed 2", URL: "https://b.example.com/feed.xml"},
		},
	}
	if err := readAndReconcile(database, feedsPath, subs); err != nil {
		t.Fatalf("seed feeds: %v", err)
	}

	feedList, _ := database.ListFeeds()
	if len(feedList) != 2 {
		t.Fatalf("expected 2 feeds, got %d", len(feedList))
	}

	// Delete the first feed.
	feedID := feedList[0].ID

	mux := http.NewServeMux()
	mux.HandleFunc("DELETE /api/feeds/{id}", DeleteFeed(database, feedsPath, &mu))

	req := httptest.NewRequest("DELETE", "/api/feeds/"+itoa(feedID), nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}

	// Verify only one feed remains.
	feedList2, _ := database.ListFeeds()
	if len(feedList2) != 1 {
		t.Errorf("expected 1 feed after delete, got %d", len(feedList2))
	}
}

func TestDeleteFeed_Success(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	seedFeed(t, database, feedsPath, "Test Feed", "https://example.com/feed.xml")

	feedList, err := database.ListFeeds()
	if err != nil {
		t.Fatalf("list feeds: %v", err)
	}
	if len(feedList) != 1 {
		t.Fatalf("expected 1 feed, got %d", len(feedList))
	}
	feedID := feedList[0].ID

	mux := http.NewServeMux()
	mux.HandleFunc("DELETE /api/feeds/{id}", DeleteFeed(database, feedsPath, &mu))

	req := httptest.NewRequest("DELETE", "/api/feeds/"+itoa(feedID), nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}

	// Verify feed is deleted.
	feedList2, err := database.ListFeeds()
	if err != nil {
		t.Fatalf("list feeds after delete: %v", err)
	}
	if len(feedList2) != 0 {
		t.Errorf("expected 0 feeds after delete, got %d", len(feedList2))
	}
}
