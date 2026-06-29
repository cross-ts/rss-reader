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

func TestListFolders_DBError(t *testing.T) {
	database := openTestDB(t)
	database.Close()

	handler := ListFolders(database)
	req := httptest.NewRequest("GET", "/api/folders", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestListFolders_Empty(t *testing.T) {
	database := openTestDB(t)

	handler := ListFolders(database)
	req := httptest.NewRequest("GET", "/api/folders", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp []FolderResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp) != 0 {
		t.Fatalf("expected 0 folders, got %d", len(resp))
	}
}

func TestListFolders_WithFolders(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	seedFeedWithFolder(t, database, feedsPath, "Feed", "https://example.com/feed.xml", "Tech")

	handler := ListFolders(database)
	req := httptest.NewRequest("GET", "/api/folders", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp []FolderResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp) != 1 {
		t.Fatalf("expected 1 folder, got %d", len(resp))
	}
	if resp[0].Name != "Tech" {
		t.Errorf("expected folder name 'Tech', got %q", resp[0].Name)
	}
}

func TestCreateFolder_InvalidBody(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	handler := CreateFolder(database, feedsPath, &mu)
	req := httptest.NewRequest("POST", "/api/folders", strings.NewReader("not json"))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreateFolder_EmptyName(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	handler := CreateFolder(database, feedsPath, &mu)
	req := httptest.NewRequest("POST", "/api/folders", strings.NewReader(`{"name":""}`))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreateFolder_Success(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	handler := CreateFolder(database, feedsPath, &mu)
	req := httptest.NewRequest("POST", "/api/folders", strings.NewReader(`{"name":"Tech"}`))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp FolderResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Name != "Tech" {
		t.Errorf("expected name 'Tech', got %q", resp.Name)
	}
}

func TestCreateFolder_Duplicate(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	handler := CreateFolder(database, feedsPath, &mu)

	// First creation.
	req := httptest.NewRequest("POST", "/api/folders", strings.NewReader(`{"name":"Tech"}`))
	w := httptest.NewRecorder()
	handler(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("first create: expected 201, got %d", w.Code)
	}

	// Second creation (same name) - should still succeed (idempotent).
	req2 := httptest.NewRequest("POST", "/api/folders", strings.NewReader(`{"name":"Tech"}`))
	w2 := httptest.NewRecorder()
	handler(w2, req2)
	if w2.Code != http.StatusCreated {
		t.Fatalf("second create: expected 201, got %d: %s", w2.Code, w2.Body.String())
	}
}

func TestUpdateFolder_InvalidID(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/folders/{id}", UpdateFolder(database, feedsPath, &mu))

	req := httptest.NewRequest("PATCH", "/api/folders/abc", strings.NewReader(`{"name":"New"}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdateFolder_InvalidBody(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/folders/{id}", UpdateFolder(database, feedsPath, &mu))

	req := httptest.NewRequest("PATCH", "/api/folders/1", strings.NewReader("not json"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdateFolder_EmptyName(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/folders/{id}", UpdateFolder(database, feedsPath, &mu))

	req := httptest.NewRequest("PATCH", "/api/folders/1", strings.NewReader(`{"name":""}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdateFolder_NotFound(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/folders/{id}", UpdateFolder(database, feedsPath, &mu))

	req := httptest.NewRequest("PATCH", "/api/folders/999", strings.NewReader(`{"name":"New"}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestUpdateFolder_Rename(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	seedFeedWithFolder(t, database, feedsPath, "Feed", "https://example.com/feed.xml", "OldName")

	folders, _ := database.ListFolders()
	if len(folders) != 1 {
		t.Fatalf("expected 1 folder, got %d", len(folders))
	}
	folderID := folders[0].ID

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/folders/{id}", UpdateFolder(database, feedsPath, &mu))

	req := httptest.NewRequest("PATCH", "/api/folders/"+itoa(folderID), strings.NewReader(`{"name":"NewName"}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp FolderResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Name != "NewName" {
		t.Errorf("expected name 'NewName', got %q", resp.Name)
	}
}

func TestUpdateFolder_SameName(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	seedFeedWithFolder(t, database, feedsPath, "Feed", "https://example.com/feed.xml", "Tech")

	folders, _ := database.ListFolders()
	folderID := folders[0].ID

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/folders/{id}", UpdateFolder(database, feedsPath, &mu))

	req := httptest.NewRequest("PATCH", "/api/folders/"+itoa(folderID), strings.NewReader(`{"name":"Tech"}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdateFolder_ConflictingName(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	// Create two folders.
	seedFeedWithFolder(t, database, feedsPath, "Feed1", "https://a.example.com/feed.xml", "FolderA")
	// Add second folder by adding another feed.
	subs, err := ensureSubscriptions(feedsPath)
	if err != nil {
		t.Fatalf("ensure subs: %v", err)
	}
	subs.Folders = append(subs.Folders, folderEntry("FolderB"))
	if err := readAndReconcile(database, feedsPath, subs); err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	folders, _ := database.ListFolders()
	var folderAID int
	for _, f := range folders {
		if f.Name == "FolderA" {
			folderAID = f.ID
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/folders/{id}", UpdateFolder(database, feedsPath, &mu))

	// Try renaming FolderA to FolderB.
	req := httptest.NewRequest("PATCH", "/api/folders/"+itoa(folderAID), strings.NewReader(`{"name":"FolderB"}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeleteFolder_InvalidID(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	mux := http.NewServeMux()
	mux.HandleFunc("DELETE /api/folders/{id}", DeleteFolder(database, feedsPath, &mu))

	req := httptest.NewRequest("DELETE", "/api/folders/abc", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestDeleteFolder_NotFound(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	mux := http.NewServeMux()
	mux.HandleFunc("DELETE /api/folders/{id}", DeleteFolder(database, feedsPath, &mu))

	req := httptest.NewRequest("DELETE", "/api/folders/999", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestCreateFolder_OPMLError(t *testing.T) {
	database := openTestDB(t)
	badFeedsPath := t.TempDir() // directory, not file
	var mu sync.Mutex

	handler := CreateFolder(database, badFeedsPath, &mu)
	req := httptest.NewRequest("POST", "/api/folders", strings.NewReader(`{"name":"Tech"}`))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreateFolder_ReconcileError(t *testing.T) {
	database := openTestDB(t)
	badFeedsPath := filepath.Join(t.TempDir(), "nonexistent", "subdir", "feeds.opml")
	var mu sync.Mutex

	handler := CreateFolder(database, badFeedsPath, &mu)
	req := httptest.NewRequest("POST", "/api/folders", strings.NewReader(`{"name":"Tech"}`))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdateFolder_ReconcileError(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	seedFeedWithFolder(t, database, feedsPath, "Feed", "https://example.com/feed.xml", "Tech")

	folders, _ := database.ListFolders()
	folderID := folders[0].ID

	badFeedsPath := filepath.Join(t.TempDir(), "nonexistent", "subdir", "feeds.opml")

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/folders/{id}", UpdateFolder(database, badFeedsPath, &mu))

	req := httptest.NewRequest("PATCH", "/api/folders/"+itoa(folderID), strings.NewReader(`{"name":"NewName"}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeleteFolder_ReconcileError(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	seedFeedWithFolder(t, database, feedsPath, "Feed", "https://example.com/feed.xml", "Tech")

	folders, _ := database.ListFolders()
	folderID := folders[0].ID

	badFeedsPath := filepath.Join(t.TempDir(), "nonexistent", "subdir", "feeds.opml")

	mux := http.NewServeMux()
	mux.HandleFunc("DELETE /api/folders/{id}", DeleteFolder(database, badFeedsPath, &mu))

	req := httptest.NewRequest("DELETE", "/api/folders/"+itoa(folderID), nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdateFolder_OPMLError(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	seedFeedWithFolder(t, database, feedsPath, "Feed", "https://example.com/feed.xml", "Tech")

	folders, _ := database.ListFolders()
	folderID := folders[0].ID

	badFeedsPath := t.TempDir()

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/folders/{id}", UpdateFolder(database, badFeedsPath, &mu))

	req := httptest.NewRequest("PATCH", "/api/folders/"+itoa(folderID), strings.NewReader(`{"name":"NewName"}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeleteFolder_OPMLError(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	seedFeedWithFolder(t, database, feedsPath, "Feed", "https://example.com/feed.xml", "Tech")

	folders, _ := database.ListFolders()
	folderID := folders[0].ID

	badFeedsPath := t.TempDir()

	mux := http.NewServeMux()
	mux.HandleFunc("DELETE /api/folders/{id}", DeleteFolder(database, badFeedsPath, &mu))

	req := httptest.NewRequest("DELETE", "/api/folders/"+itoa(folderID), nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreateFolder_DBError(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	// Create folder first to get OPML file, then close DB.
	handler := CreateFolder(database, feedsPath, &mu)
	req := httptest.NewRequest("POST", "/api/folders", strings.NewReader(`{"name":"Tech"}`))
	w := httptest.NewRecorder()
	handler(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("initial create: expected 201, got %d", w.Code)
	}

	database.Close()

	// Now try creating another folder - should fail on DB reconcile.
	req2 := httptest.NewRequest("POST", "/api/folders", strings.NewReader(`{"name":"News"}`))
	w2 := httptest.NewRecorder()
	handler(w2, req2)

	if w2.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w2.Code, w2.Body.String())
	}
}

func TestUpdateFolder_DBError(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	seedFeedWithFolder(t, database, feedsPath, "Feed", "https://example.com/feed.xml", "Tech")

	folders, _ := database.ListFolders()
	folderID := folders[0].ID

	database.Close()

	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/folders/{id}", UpdateFolder(database, feedsPath, &mu))

	req := httptest.NewRequest("PATCH", "/api/folders/"+itoa(folderID), strings.NewReader(`{"name":"NewName"}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 (DB closed), got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeleteFolder_DBError(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	seedFeedWithFolder(t, database, feedsPath, "Feed", "https://example.com/feed.xml", "Tech")

	folders, _ := database.ListFolders()
	folderID := folders[0].ID

	database.Close()

	mux := http.NewServeMux()
	mux.HandleFunc("DELETE /api/folders/{id}", DeleteFolder(database, feedsPath, &mu))

	req := httptest.NewRequest("DELETE", "/api/folders/"+itoa(folderID), nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 (DB closed), got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdateFolder_CascadeRenameChildren(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	// Create a folder hierarchy: "Tech" and "Tech/Go" with a feed in "Tech/Go".
	subs := &feeds.Subscriptions{
		Folders: []feeds.FolderEntry{{Name: "Tech"}, {Name: "Tech/Go"}},
		Feeds: []feeds.FeedEntry{
			{Title: "Go Blog", URL: "https://go.dev/blog/feed.atom", Folder: strPtr("Tech/Go")},
		},
	}
	if err := readAndReconcile(database, feedsPath, subs); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Find the "Tech" folder ID.
	folders, _ := database.ListFolders()
	var techID int
	for _, f := range folders {
		if f.Name == "Tech" {
			techID = f.ID
		}
	}

	// Rename "Tech" to "Technology".
	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /api/folders/{id}", UpdateFolder(database, feedsPath, &mu))

	req := httptest.NewRequest("PATCH", "/api/folders/"+itoa(techID), strings.NewReader(`{"name":"Technology"}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Verify the response has the new name.
	var resp FolderResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Name != "Technology" {
		t.Errorf("expected renamed folder 'Technology', got %q", resp.Name)
	}

	// Verify child folder was also renamed.
	folders2, _ := database.ListFolders()
	nameSet := make(map[string]bool)
	for _, f := range folders2 {
		nameSet[f.Name] = true
	}
	if !nameSet["Technology"] {
		t.Errorf("expected folder 'Technology' to exist after rename")
	}
	if !nameSet["Technology/Go"] {
		t.Errorf("expected child folder 'Technology/Go' to exist after rename")
	}
	if nameSet["Tech"] {
		t.Errorf("old folder 'Tech' should not exist after rename")
	}
	if nameSet["Tech/Go"] {
		t.Errorf("old child folder 'Tech/Go' should not exist after rename")
	}

	// Verify feed's folder reference was updated.
	feedList, _ := database.ListFeeds()
	if len(feedList) != 1 {
		t.Fatalf("expected 1 feed, got %d", len(feedList))
	}
	if feedList[0].Folder == nil {
		t.Fatal("expected feed to have a folder, got nil")
	}
	if *feedList[0].Folder != "Technology/Go" {
		t.Errorf("expected feed folder 'Technology/Go', got %q", *feedList[0].Folder)
	}

	// Verify OPML reflects the rename.
	opml, err := feeds.ReadFeedsOPML(feedsPath)
	if err != nil {
		t.Fatalf("read OPML: %v", err)
	}
	opmlFolderNames := make(map[string]bool)
	for _, f := range opml.Folders {
		opmlFolderNames[f.Name] = true
	}
	if !opmlFolderNames["Technology/Go"] {
		t.Errorf("expected OPML to contain folder 'Technology/Go'")
	}
	if opmlFolderNames["Tech/Go"] {
		t.Errorf("expected OPML not to contain old folder 'Tech/Go'")
	}
}

func TestDeleteFolder_CascadeRemoveChildren(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	// Create a folder hierarchy: "Tech", "Tech/Go", and "Tech/Go/SubChild" with feeds.
	subs := &feeds.Subscriptions{
		Folders: []feeds.FolderEntry{{Name: "Tech"}, {Name: "Tech/Go"}, {Name: "Tech/Go/SubChild"}},
		Feeds: []feeds.FeedEntry{
			{Title: "Go Blog", URL: "https://go.dev/blog/feed.atom", Folder: strPtr("Tech/Go")},
			{Title: "Sub Feed", URL: "https://example.com/sub.xml", Folder: strPtr("Tech/Go/SubChild")},
		},
	}
	if err := readAndReconcile(database, feedsPath, subs); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Find the "Tech" folder ID.
	folders, _ := database.ListFolders()
	var techID int
	for _, f := range folders {
		if f.Name == "Tech" {
			techID = f.ID
		}
	}
	if techID == 0 {
		t.Fatal("could not find 'Tech' folder")
	}

	// Delete "Tech".
	mux := http.NewServeMux()
	mux.HandleFunc("DELETE /api/folders/{id}", DeleteFolder(database, feedsPath, &mu))

	req := httptest.NewRequest("DELETE", "/api/folders/"+itoa(techID), nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}

	// Verify all folders (Tech, Tech/Go, Tech/Go/SubChild) are removed.
	folders2, _ := database.ListFolders()
	if len(folders2) != 0 {
		names := make([]string, len(folders2))
		for i, f := range folders2 {
			names[i] = f.Name
		}
		t.Errorf("expected 0 folders after cascade delete, got %d: %v", len(folders2), names)
	}

	// Verify feeds still exist but have nil folder references.
	feedList, _ := database.ListFeeds()
	if len(feedList) != 2 {
		t.Fatalf("expected 2 feeds after folder delete, got %d", len(feedList))
	}
	for _, feed := range feedList {
		if feed.Folder != nil {
			t.Errorf("expected nil folder on feed %q after cascade delete, got %q", feed.Title, *feed.Folder)
		}
	}
}

func TestDeleteFolder_WithMultipleFolders(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	// Create two folders with feeds.
	subs := &feeds.Subscriptions{
		Folders: []feeds.FolderEntry{{Name: "Tech"}, {Name: "News"}},
		Feeds: []feeds.FeedEntry{
			{Title: "Feed 1", URL: "https://a.example.com/feed.xml", Folder: strPtr("Tech")},
			{Title: "Feed 2", URL: "https://b.example.com/feed.xml", Folder: strPtr("News")},
		},
	}
	if err := readAndReconcile(database, feedsPath, subs); err != nil {
		t.Fatalf("seed: %v", err)
	}

	folders, _ := database.ListFolders()
	var techID int
	for _, f := range folders {
		if f.Name == "Tech" {
			techID = f.ID
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("DELETE /api/folders/{id}", DeleteFolder(database, feedsPath, &mu))

	req := httptest.NewRequest("DELETE", "/api/folders/"+itoa(techID), nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}

	// Verify only News folder remains.
	folders2, _ := database.ListFolders()
	if len(folders2) != 1 {
		t.Errorf("expected 1 folder, got %d", len(folders2))
	}
}

func TestDeleteFolder_Success(t *testing.T) {
	database := openTestDB(t)
	feedsPath := filepath.Join(t.TempDir(), "feeds.opml")
	var mu sync.Mutex

	seedFeedWithFolder(t, database, feedsPath, "Feed", "https://example.com/feed.xml", "Tech")

	folders, _ := database.ListFolders()
	if len(folders) != 1 {
		t.Fatalf("expected 1 folder, got %d", len(folders))
	}
	folderID := folders[0].ID

	mux := http.NewServeMux()
	mux.HandleFunc("DELETE /api/folders/{id}", DeleteFolder(database, feedsPath, &mu))

	req := httptest.NewRequest("DELETE", "/api/folders/"+itoa(folderID), nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}

	// Verify folder is deleted.
	folders2, _ := database.ListFolders()
	if len(folders2) != 0 {
		t.Errorf("expected 0 folders after delete, got %d", len(folders2))
	}

	// Verify feed still exists but without folder.
	feedList, _ := database.ListFeeds()
	if len(feedList) != 1 {
		t.Errorf("expected 1 feed after folder delete, got %d", len(feedList))
	}
	if feedList[0].Folder != nil {
		t.Errorf("expected nil folder on feed after folder delete, got %v", *feedList[0].Folder)
	}
}
