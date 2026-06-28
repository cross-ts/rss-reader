package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestRefresh_DBError(t *testing.T) {
	database := openTestDB(t)
	database.Close()

	handler := Refresh(database, http.DefaultClient)
	req := httptest.NewRequest("POST", "/api/refresh", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestRefresh_DBErrorWithFeedID(t *testing.T) {
	database := openTestDB(t)
	database.Close()

	handler := Refresh(database, http.DefaultClient)
	req := httptest.NewRequest("POST", "/api/refresh?feedId=1", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestRefresh_NoFeeds(t *testing.T) {
	database := openTestDB(t)
	client := http.DefaultClient

	handler := Refresh(database, client)
	req := httptest.NewRequest("POST", "/api/refresh", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]int
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp["refreshed"] != 0 {
		t.Errorf("expected 0 refreshed, got %d", resp["refreshed"])
	}
}

func TestRefresh_InvalidFeedID(t *testing.T) {
	database := openTestDB(t)
	client := http.DefaultClient

	handler := Refresh(database, client)
	req := httptest.NewRequest("POST", "/api/refresh?feedId=abc", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestRefresh_WithFeedID(t *testing.T) {
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

	// Create a feed first.
	createHandler := CreateFeed(database, feedsPath, &mu, client)
	cReq := httptest.NewRequest("POST", "/api/feeds", strings.NewReader(`{"url": "`+feedURL+`"}`))
	cW := httptest.NewRecorder()
	createHandler(cW, cReq)
	if cW.Code != http.StatusCreated {
		t.Fatalf("create feed: expected 201, got %d: %s", cW.Code, cW.Body.String())
	}

	var feedResp FeedResponse
	if err := json.NewDecoder(cW.Body).Decode(&feedResp); err != nil {
		t.Fatalf("decode feed response: %v", err)
	}

	// Refresh with specific feed ID.
	handler := Refresh(database, client)
	req := httptest.NewRequest("POST", "/api/refresh?feedId="+itoa(feedResp.ID), nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]int
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp["refreshed"] != 1 {
		t.Errorf("expected 1 refreshed, got %d", resp["refreshed"])
	}
}

func TestRefresh_AllFeeds(t *testing.T) {
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

	// Create a feed first.
	createHandler := CreateFeed(database, feedsPath, &mu, client)
	cReq := httptest.NewRequest("POST", "/api/feeds", strings.NewReader(`{"url": "`+feedURL+`"}`))
	cW := httptest.NewRecorder()
	createHandler(cW, cReq)
	if cW.Code != http.StatusCreated {
		t.Fatalf("create feed: expected 201, got %d: %s", cW.Code, cW.Body.String())
	}

	// Refresh all feeds (no feedId param).
	handler := Refresh(database, client)
	req := httptest.NewRequest("POST", "/api/refresh", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]int
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp["refreshed"] != 1 {
		t.Errorf("expected 1 refreshed, got %d", resp["refreshed"])
	}
}

func TestRefresh_NotModified(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// If the client sends If-None-Match, return 304.
		if r.Header.Get("If-None-Match") == `"test-etag"` {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		// Otherwise return feed with ETag.
		w.Header().Set("Content-Type", "application/rss+xml")
		w.Header().Set("Etag", `"test-etag"`)
		w.Write([]byte(validRSSXML))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	feedURL := rewrite(ts.URL) + "/feed.xml"

	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	// Create feed (triggers initial fetch which is request 1).
	createHandler := CreateFeed(database, feedsPath, &mu, client)
	cReq := httptest.NewRequest("POST", "/api/feeds", strings.NewReader(`{"url": "`+feedURL+`"}`))
	cW := httptest.NewRecorder()
	createHandler(cW, cReq)
	if cW.Code != http.StatusCreated {
		t.Fatalf("create feed: expected 201, got %d: %s", cW.Code, cW.Body.String())
	}

	// Refresh - should get 304.
	handler := Refresh(database, client)
	req := httptest.NewRequest("POST", "/api/refresh", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]int
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	// 304 counts as refreshed (not an error).
	if resp["refreshed"] != 1 {
		t.Errorf("expected 1 refreshed (304), got %d", resp["refreshed"])
	}
}

func TestRefresh_FetchFailure(t *testing.T) {
	// Server returns 500.
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "server error", http.StatusInternalServerError)
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	feedURL := rewrite(ts.URL) + "/feed.xml"

	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")

	// Seed the feed directly in DB (since CreateFeed would also fail).
	seedFeed(t, database, feedsPath, "Bad Feed", feedURL)

	handler := Refresh(database, client)
	req := httptest.NewRequest("POST", "/api/refresh", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]int
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	// Feed fetch failed, so 0 refreshed.
	if resp["refreshed"] != 0 {
		t.Errorf("expected 0 refreshed, got %d", resp["refreshed"])
	}
}
