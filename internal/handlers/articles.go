package handlers

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/cross-ts/rss-reader/internal/db"
)

// ArticleResponse is the JSON response for an article.
type ArticleResponse struct {
	ID          int     `json:"id"`
	FeedID      int     `json:"feedId"`
	FeedTitle   string  `json:"feedTitle"`
	Title       string  `json:"title"`
	URL         string  `json:"url"`
	Author      *string `json:"author"`
	Content     string  `json:"content"`
	PublishedAt *string `json:"publishedAt"`
	IsRead      bool    `json:"isRead"`
	ReadAt      *string `json:"readAt"`
	Starred     bool    `json:"starred"`
}

// ArticlesListResponse is the JSON response for a paginated list of articles.
type ArticlesListResponse struct {
	Items []ArticleResponse `json:"items"`
	Total int64             `json:"total"`
}

// articleToResponse converts a db.Article to an ArticleResponse.
func articleToResponse(a *db.Article) ArticleResponse {
	return ArticleResponse{
		ID:          a.ID,
		FeedID:      a.FeedID,
		FeedTitle:   a.FeedTitle,
		Title:       a.Title,
		URL:         a.URL,
		Author:      a.Author,
		Content:     a.Content,
		PublishedAt: a.PublishedAt,
		IsRead:      a.IsRead,
		ReadAt:      a.ReadAt,
		Starred:     a.Starred,
	}
}

// ListArticles returns an http.HandlerFunc that lists articles with optional filtering.
func ListArticles(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()

		filter := db.ArticleFilter{
			Limit:  50,
			Offset: 0,
		}

		if v := query.Get("folderId"); v != "" {
			id, err := strconv.Atoi(v)
			if err != nil {
				http.Error(w, "invalid folderId", http.StatusBadRequest)
				return
			}
			filter.FolderID = &id
		}

		if v := query.Get("feedId"); v != "" {
			id, err := strconv.Atoi(v)
			if err != nil {
				http.Error(w, "invalid feedId", http.StatusBadRequest)
				return
			}
			filter.FeedID = &id
		}

		if v := query.Get("q"); v != "" {
			filter.Q = &v
		}

		if v := query.Get("limit"); v != "" {
			l, err := strconv.ParseInt(v, 10, 64)
			if err == nil {
				filter.Limit = l
			}
		}
		// Clamp limit to 1..200.
		if filter.Limit < 1 {
			filter.Limit = 1
		}
		if filter.Limit > 200 {
			filter.Limit = 200
		}

		if v := query.Get("offset"); v != "" {
			o, err := strconv.ParseInt(v, 10, 64)
			if err == nil {
				filter.Offset = o
			}
		}
		// Clamp offset >= 0.
		if filter.Offset < 0 {
			filter.Offset = 0
		}

		result, err := database.ListArticles(filter)
		if err != nil {
			slog.Error("list articles", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		items := make([]ArticleResponse, len(result.Items))
		for i := range result.Items {
			items[i] = articleToResponse(&result.Items[i])
		}

		writeJSON(w, http.StatusOK, ArticlesListResponse{
			Items: items,
			Total: result.Total,
		})
	}
}

// UpdateArticle returns an http.HandlerFunc that updates the read and/or
// starred state of a single article via PATCH /api/articles/{id}.
func UpdateArticle(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "invalid article id", http.StatusBadRequest)
			return
		}

		var body struct {
			IsRead  *bool `json:"isRead"`
			Starred *bool `json:"starred"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		if body.IsRead == nil && body.Starred == nil {
			http.Error(w, "isRead or starred is required", http.StatusBadRequest)
			return
		}

		updated := false
		if body.IsRead != nil {
			ok, err := database.SetArticleRead(id, *body.IsRead, time.Now().UTC().Format(time.RFC3339))
			if err != nil {
				slog.Error("set article read", "id", id, "error", err)
				http.Error(w, "internal server error", http.StatusInternalServerError)
				return
			}
			updated = updated || ok
		}
		if body.Starred != nil {
			ok, err := database.SetArticleStarred(id, *body.Starred)
			if err != nil {
				slog.Error("set article starred", "id", id, "error", err)
				http.Error(w, "internal server error", http.StatusInternalServerError)
				return
			}
			updated = updated || ok
		}

		if !updated {
			http.Error(w, "article not found", http.StatusNotFound)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// MarkArticlesReadResponse is the JSON response for the bulk mark-read endpoint.
type MarkArticlesReadResponse struct {
	Updated int64 `json:"updated"`
}

// MarkArticlesRead returns an http.HandlerFunc that marks multiple articles as
// read in one request via POST /api/articles/mark-read.
func MarkArticlesRead(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ArticleIDs []int `json:"articleIds"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		updated, err := database.MarkArticlesRead(body.ArticleIDs, time.Now().UTC().Format(time.RFC3339))
		if err != nil {
			slog.Error("mark articles read", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		writeJSON(w, http.StatusOK, MarkArticlesReadResponse{Updated: updated})
	}
}

// UnreadCountsResponse is the JSON response for GET /api/unread-counts.
type UnreadCountsResponse struct {
	Total   int64            `json:"total"`
	Feeds   map[string]int64 `json:"feeds"`
	Folders map[string]int64 `json:"folders"`
}

// UnreadCounts returns an http.HandlerFunc that reports unread article counts
// aggregated by feed, folder, and overall via GET /api/unread-counts.
func UnreadCounts(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		counts, err := database.GetUnreadCounts()
		if err != nil {
			slog.Error("get unread counts", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		feeds := make(map[string]int64, len(counts.Feeds))
		for id, c := range counts.Feeds {
			feeds[strconv.Itoa(id)] = c
		}
		folders := make(map[string]int64, len(counts.Folders))
		for id, c := range counts.Folders {
			folders[strconv.Itoa(id)] = c
		}

		writeJSON(w, http.StatusOK, UnreadCountsResponse{
			Total:   counts.Total,
			Feeds:   feeds,
			Folders: folders,
		})
	}
}
