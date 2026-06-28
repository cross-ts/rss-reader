package handlers

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/cross-ts/rss-reader/internal/db"
	"github.com/cross-ts/rss-reader/internal/feeds"
)

// FolderResponse is the JSON response for a folder.
type FolderResponse struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	FeedCount int64  `json:"feedCount"`
}

// folderToResponse converts a db.Folder to a FolderResponse.
func folderToResponse(f *db.Folder) FolderResponse {
	return FolderResponse{
		ID:        f.ID,
		Name:      f.Name,
		FeedCount: f.FeedCount,
	}
}

// readAndReconcile reads OPML, reconciles with DB, and returns the subscriptions.
func readAndReconcile(database *db.DB, feedsPath string, subs *feeds.Subscriptions) error {
	folderDefs := make([]db.FolderDef, len(subs.Folders))
	for i, f := range subs.Folders {
		folderDefs[i] = db.FolderDef{Name: f.Name}
	}
	feedDefs := make([]db.FeedDef, len(subs.Feeds))
	for i, f := range subs.Feeds {
		feedDefs[i] = db.FeedDef{
			Title:   f.Title,
			URL:     f.URL,
			Folder:  f.Folder,
			SiteURL: f.SiteURL,
		}
	}

	if err := database.ReconcileSubscriptions(folderDefs, feedDefs); err != nil {
		return err
	}

	return feeds.SaveOPML(feedsPath, subs)
}

// ensureSubscriptions reads existing OPML or creates empty subscriptions.
func ensureSubscriptions(feedsPath string) (*feeds.Subscriptions, error) {
	subs, err := feeds.ReadFeedsOPML(feedsPath)
	if err != nil {
		return nil, err
	}
	if subs == nil {
		subs = &feeds.Subscriptions{}
	}
	return subs, nil
}

// ListFolders returns an http.HandlerFunc that lists all folders.
func ListFolders(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		folders, err := database.ListFolders()
		if err != nil {
			slog.Error("list folders", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		resp := make([]FolderResponse, len(folders))
		for i := range folders {
			resp[i] = folderToResponse(&folders[i])
		}

		writeJSON(w, http.StatusOK, resp)
	}
}

// CreateFolder returns an http.HandlerFunc that creates a new folder.
func CreateFolder(database *db.DB, feedsPath string, feedsLock *sync.Mutex) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		name := strings.TrimSpace(body.Name)
		if name == "" {
			http.Error(w, "name is required", http.StatusBadRequest)
			return
		}

		feedsLock.Lock()
		defer feedsLock.Unlock()

		subs, err := ensureSubscriptions(feedsPath)
		if err != nil {
			slog.Error("read OPML", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		// Add folder if not exists.
		found := false
		for _, f := range subs.Folders {
			if f.Name == name {
				found = true
				break
			}
		}
		if !found {
			subs.Folders = append(subs.Folders, feeds.FolderEntry{Name: name})
		}

		if err := readAndReconcile(database, feedsPath, subs); err != nil {
			slog.Error("reconcile after create folder", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		folder, err := database.GetFolderByName(name)
		if err != nil {
			slog.Error("get folder by name", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		writeJSON(w, http.StatusCreated, folderToResponse(folder))
	}
}

// UpdateFolder returns an http.HandlerFunc that renames a folder.
func UpdateFolder(database *db.DB, feedsPath string, feedsLock *sync.Mutex) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "invalid folder id", http.StatusBadRequest)
			return
		}

		var body struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		newName := strings.TrimSpace(body.Name)
		if newName == "" {
			http.Error(w, "name is required", http.StatusBadRequest)
			return
		}

		feedsLock.Lock()
		defer feedsLock.Unlock()

		oldName, err := database.GetFolderNameByID(id)
		if err != nil {
			http.Error(w, "folder not found", http.StatusNotFound)
			return
		}

		subs, err := ensureSubscriptions(feedsPath)
		if err != nil {
			slog.Error("read OPML", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		// Check for conflict: new name already exists and is not the old name.
		if newName != oldName {
			for _, f := range subs.Folders {
				if f.Name == newName {
					http.Error(w, "folder name already exists", http.StatusConflict)
					return
				}
			}
		}

		// Rename folder in OPML.
		for i := range subs.Folders {
			if subs.Folders[i].Name == oldName {
				subs.Folders[i].Name = newName
				break
			}
		}

		// Update feed references.
		for i := range subs.Feeds {
			if subs.Feeds[i].Folder != nil && *subs.Feeds[i].Folder == oldName {
				subs.Feeds[i].Folder = &newName
			}
		}

		if err := readAndReconcile(database, feedsPath, subs); err != nil {
			slog.Error("reconcile after update folder", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		folder, err := database.GetFolderByName(newName)
		if err != nil {
			slog.Error("get folder by name", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		writeJSON(w, http.StatusOK, folderToResponse(folder))
	}
}

// DeleteFolder returns an http.HandlerFunc that deletes a folder.
func DeleteFolder(database *db.DB, feedsPath string, feedsLock *sync.Mutex) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "invalid folder id", http.StatusBadRequest)
			return
		}

		feedsLock.Lock()
		defer feedsLock.Unlock()

		folderName, err := database.GetFolderNameByID(id)
		if err != nil {
			http.Error(w, "folder not found", http.StatusNotFound)
			return
		}

		subs, err := ensureSubscriptions(feedsPath)
		if err != nil {
			slog.Error("read OPML", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		// Remove folder from OPML.
		newFolders := make([]feeds.FolderEntry, 0, len(subs.Folders))
		for _, f := range subs.Folders {
			if f.Name != folderName {
				newFolders = append(newFolders, f)
			}
		}
		subs.Folders = newFolders

		// Set feed folder references to nil for feeds in this folder.
		for i := range subs.Feeds {
			if subs.Feeds[i].Folder != nil && *subs.Feeds[i].Folder == folderName {
				subs.Feeds[i].Folder = nil
			}
		}

		if err := readAndReconcile(database, feedsPath, subs); err != nil {
			slog.Error("reconcile after delete folder", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}
