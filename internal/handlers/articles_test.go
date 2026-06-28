package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/cross-ts/rss-reader/internal/db"
)

func TestListArticles_Empty(t *testing.T) {
	database := openTestDB(t)

	handler := ListArticles(database)
	req := httptest.NewRequest("GET", "/api/articles", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp ArticlesListResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.Items) != 0 {
		t.Errorf("expected 0 items, got %d", len(resp.Items))
	}
	if resp.Total != 0 {
		t.Errorf("expected total 0, got %d", resp.Total)
	}
}

func TestListArticles_WithArticles(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	seedFeed(t, database, feedsPath, "Test Feed", "https://example.com/feed.xml")

	feedList, _ := database.ListFeeds()
	seedArticles(t, database, feedList[0].ID, []db.NewArticle{
		{GUID: "g1", Title: "Art 1", URL: "https://example.com/1", Content: "Content 1"},
		{GUID: "g2", Title: "Art 2", URL: "https://example.com/2", Content: "Content 2"},
	})

	handler := ListArticles(database)
	req := httptest.NewRequest("GET", "/api/articles", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp ArticlesListResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Total != 2 {
		t.Errorf("expected total 2, got %d", resp.Total)
	}
	if len(resp.Items) != 2 {
		t.Errorf("expected 2 items, got %d", len(resp.Items))
	}
}

func TestListArticles_InvalidFolderID(t *testing.T) {
	database := openTestDB(t)

	handler := ListArticles(database)
	req := httptest.NewRequest("GET", "/api/articles?folderId=abc", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestListArticles_InvalidFeedID(t *testing.T) {
	database := openTestDB(t)

	handler := ListArticles(database)
	req := httptest.NewRequest("GET", "/api/articles?feedId=abc", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestListArticles_FilterByFeedID(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	seedFeed(t, database, feedsPath, "Feed A", "https://a.example.com/feed.xml")

	feedList, _ := database.ListFeeds()
	seedArticles(t, database, feedList[0].ID, []db.NewArticle{
		{GUID: "g1", Title: "Art 1", URL: "https://example.com/1", Content: "C1"},
	})

	handler := ListArticles(database)
	req := httptest.NewRequest("GET", "/api/articles?feedId="+itoa(feedList[0].ID), nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp ArticlesListResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Total != 1 {
		t.Errorf("expected total 1, got %d", resp.Total)
	}
}

func TestListArticles_LimitAndOffset(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	seedFeed(t, database, feedsPath, "Feed", "https://example.com/feed.xml")

	feedList, _ := database.ListFeeds()
	articles := make([]db.NewArticle, 5)
	for i := range articles {
		articles[i] = db.NewArticle{
			GUID:    "g" + itoa(i),
			Title:   "Art " + itoa(i),
			URL:     "https://example.com/" + itoa(i),
			Content: "C" + itoa(i),
		}
	}
	seedArticles(t, database, feedList[0].ID, articles)

	handler := ListArticles(database)
	req := httptest.NewRequest("GET", "/api/articles?limit=2&offset=1", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp ArticlesListResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Total != 5 {
		t.Errorf("expected total 5, got %d", resp.Total)
	}
	if len(resp.Items) != 2 {
		t.Errorf("expected 2 items, got %d", len(resp.Items))
	}
}

func TestListArticles_LimitClamp(t *testing.T) {
	database := openTestDB(t)

	handler := ListArticles(database)
	// limit=0 should be clamped to 1, limit=999 to 200
	req := httptest.NewRequest("GET", "/api/articles?limit=0", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestListArticles_NegativeOffset(t *testing.T) {
	database := openTestDB(t)

	handler := ListArticles(database)
	req := httptest.NewRequest("GET", "/api/articles?offset=-5", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestListArticles_SearchQuery(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	seedFeed(t, database, feedsPath, "Feed", "https://example.com/feed.xml")

	feedList, _ := database.ListFeeds()
	seedArticles(t, database, feedList[0].ID, []db.NewArticle{
		{GUID: "g1", Title: "Golang Tutorial", URL: "https://example.com/1", Content: "Learn Go"},
		{GUID: "g2", Title: "Python Guide", URL: "https://example.com/2", Content: "Learn Python"},
	})

	handler := ListArticles(database)
	req := httptest.NewRequest("GET", "/api/articles?q=Golang", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestListArticles_FilterByFolderID(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	seedFeedWithFolder(t, database, feedsPath, "Feed A", "https://a.example.com/feed.xml", "Tech")

	feedList, _ := database.ListFeeds()
	seedArticles(t, database, feedList[0].ID, []db.NewArticle{
		{GUID: "g1", Title: "Art 1", URL: "https://example.com/1", Content: "C1"},
	})

	folders, _ := database.ListFolders()
	if len(folders) == 0 {
		t.Fatalf("expected folders")
	}

	handler := ListArticles(database)
	req := httptest.NewRequest("GET", "/api/articles?folderId="+itoa(folders[0].ID), nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp ArticlesListResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Total != 1 {
		t.Errorf("expected total 1, got %d", resp.Total)
	}
}

func TestListArticles_HighLimit(t *testing.T) {
	database := openTestDB(t)

	handler := ListArticles(database)
	req := httptest.NewRequest("GET", "/api/articles?limit=999", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestUnreadCounts_WithFolderArticles(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	seedFeedWithFolder(t, database, feedsPath, "Feed", "https://example.com/feed.xml", "Tech")

	feedList, _ := database.ListFeeds()
	seedArticles(t, database, feedList[0].ID, []db.NewArticle{
		{GUID: "g1", Title: "Art 1", URL: "https://example.com/1", Content: "C1"},
	})

	handler := UnreadCounts(database)
	req := httptest.NewRequest("GET", "/api/unread-counts", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp UnreadCountsResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Total != 1 {
		t.Errorf("expected total 1, got %d", resp.Total)
	}
	if len(resp.Folders) == 0 {
		t.Errorf("expected folder unread counts, got empty")
	}
	if len(resp.Feeds) == 0 {
		t.Errorf("expected feed unread counts, got empty")
	}
}

func TestListArticles_DBError(t *testing.T) {
	database := openTestDB(t)
	database.Close()

	handler := ListArticles(database)
	req := httptest.NewRequest("GET", "/api/articles", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestMarkArticlesRead_DBError(t *testing.T) {
	database := openTestDB(t)
	database.Close()

	handler := MarkArticlesRead(database)
	req := httptest.NewRequest("POST", "/api/articles/mark-read", strings.NewReader(`{"articleIds":[1]}`))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestUnreadCounts_DBError(t *testing.T) {
	database := openTestDB(t)
	database.Close()

	handler := UnreadCounts(database)
	req := httptest.NewRequest("GET", "/api/unread-counts", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestUpdateArticle_DBError_Read(t *testing.T) {
	database := openTestDB(t)
	database.Close()

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/articles/{id}", UpdateArticle(database))

	req := httptest.NewRequest("PATCH", "/api/articles/1", strings.NewReader(`{"isRead":true}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestUpdateArticle_DBError_Starred(t *testing.T) {
	database := openTestDB(t)
	database.Close()

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/articles/{id}", UpdateArticle(database))

	req := httptest.NewRequest("PATCH", "/api/articles/1", strings.NewReader(`{"starred":true}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestUpdateArticle_InvalidID(t *testing.T) {
	database := openTestDB(t)

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/articles/{id}", UpdateArticle(database))

	req := httptest.NewRequest("PATCH", "/api/articles/abc", strings.NewReader(`{"isRead":true}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdateArticle_InvalidBody(t *testing.T) {
	database := openTestDB(t)

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/articles/{id}", UpdateArticle(database))

	req := httptest.NewRequest("PATCH", "/api/articles/1", strings.NewReader("not json"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdateArticle_NeitherField(t *testing.T) {
	database := openTestDB(t)

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/articles/{id}", UpdateArticle(database))

	req := httptest.NewRequest("PATCH", "/api/articles/1", strings.NewReader(`{}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdateArticle_NotFound(t *testing.T) {
	database := openTestDB(t)

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/articles/{id}", UpdateArticle(database))

	req := httptest.NewRequest("PATCH", "/api/articles/999", strings.NewReader(`{"isRead":true}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestUpdateArticle_MarkRead(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	seedFeed(t, database, feedsPath, "Feed", "https://example.com/feed.xml")

	feedList, _ := database.ListFeeds()
	seedArticles(t, database, feedList[0].ID, []db.NewArticle{
		{GUID: "g1", Title: "Art 1", URL: "https://example.com/1", Content: "C1"},
	})

	result, _ := database.ListArticles(db.ArticleFilter{Limit: 10})
	artID := result.Items[0].ID

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/articles/{id}", UpdateArticle(database))

	req := httptest.NewRequest("PATCH", "/api/articles/"+itoa(artID), strings.NewReader(`{"isRead":true}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdateArticle_SetStarred(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	seedFeed(t, database, feedsPath, "Feed", "https://example.com/feed.xml")

	feedList, _ := database.ListFeeds()
	seedArticles(t, database, feedList[0].ID, []db.NewArticle{
		{GUID: "g1", Title: "Art 1", URL: "https://example.com/1", Content: "C1"},
	})

	result, _ := database.ListArticles(db.ArticleFilter{Limit: 10})
	artID := result.Items[0].ID

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/articles/{id}", UpdateArticle(database))

	req := httptest.NewRequest("PATCH", "/api/articles/"+itoa(artID), strings.NewReader(`{"starred":true}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdateArticle_BothFields(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	seedFeed(t, database, feedsPath, "Feed", "https://example.com/feed.xml")

	feedList, _ := database.ListFeeds()
	seedArticles(t, database, feedList[0].ID, []db.NewArticle{
		{GUID: "g1", Title: "Art 1", URL: "https://example.com/1", Content: "C1"},
	})

	result, _ := database.ListArticles(db.ArticleFilter{Limit: 10})
	artID := result.Items[0].ID

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/articles/{id}", UpdateArticle(database))

	req := httptest.NewRequest("PATCH", "/api/articles/"+itoa(artID), strings.NewReader(`{"isRead":true,"starred":true}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}
}

func TestMarkArticlesRead_InvalidBody(t *testing.T) {
	database := openTestDB(t)

	handler := MarkArticlesRead(database)
	req := httptest.NewRequest("POST", "/api/articles/mark-read", strings.NewReader("not json"))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestMarkArticlesRead_EmptyList(t *testing.T) {
	database := openTestDB(t)

	handler := MarkArticlesRead(database)
	req := httptest.NewRequest("POST", "/api/articles/mark-read", strings.NewReader(`{"articleIds":[]}`))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp MarkArticlesReadResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Updated != 0 {
		t.Errorf("expected 0 updated, got %d", resp.Updated)
	}
}

func TestMarkArticlesRead_Success(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	seedFeed(t, database, feedsPath, "Feed", "https://example.com/feed.xml")

	feedList, _ := database.ListFeeds()
	seedArticles(t, database, feedList[0].ID, []db.NewArticle{
		{GUID: "g1", Title: "Art 1", URL: "https://example.com/1", Content: "C1"},
		{GUID: "g2", Title: "Art 2", URL: "https://example.com/2", Content: "C2"},
	})

	result, _ := database.ListArticles(db.ArticleFilter{Limit: 10})
	ids := []int{result.Items[0].ID, result.Items[1].ID}

	handler := MarkArticlesRead(database)
	body, _ := json.Marshal(map[string][]int{"articleIds": ids})
	req := httptest.NewRequest("POST", "/api/articles/mark-read", strings.NewReader(string(body)))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp MarkArticlesReadResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Updated != 2 {
		t.Errorf("expected 2 updated, got %d", resp.Updated)
	}
}

func TestUnreadCounts_Empty(t *testing.T) {
	database := openTestDB(t)

	handler := UnreadCounts(database)
	req := httptest.NewRequest("GET", "/api/unread-counts", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp UnreadCountsResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Total != 0 {
		t.Errorf("expected total 0, got %d", resp.Total)
	}
}

func TestUnreadCounts_WithArticles(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	seedFeed(t, database, feedsPath, "Feed", "https://example.com/feed.xml")

	feedList, _ := database.ListFeeds()
	seedArticles(t, database, feedList[0].ID, []db.NewArticle{
		{GUID: "g1", Title: "Art 1", URL: "https://example.com/1", Content: "C1"},
		{GUID: "g2", Title: "Art 2", URL: "https://example.com/2", Content: "C2"},
	})

	handler := UnreadCounts(database)
	req := httptest.NewRequest("GET", "/api/unread-counts", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp UnreadCountsResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Total != 2 {
		t.Errorf("expected total 2, got %d", resp.Total)
	}
}
