package handlers

import (
	"log/slog"
	"net/http"
	"strconv"

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
