package server

import (
	"net/http"
	"sync"

	"github.com/cross-ts/rss-reader/internal/config"
	"github.com/cross-ts/rss-reader/internal/db"
	"github.com/cross-ts/rss-reader/internal/handlers"
)

// AppState holds shared application state for all request handlers.
type AppState struct {
	DB          *db.DB
	Config      *config.Config
	FeedClient  *http.Client // redirect disabled, for feed fetching
	ProxyClient *http.Client // redirect enabled, for frontend proxy
	FeedsLock   sync.Mutex   // serializes OPML read-modify-write
}

// NewServeMux creates and configures the HTTP route multiplexer.
func NewServeMux(state *AppState) *http.ServeMux {
	mux := http.NewServeMux()

	// Folder routes
	mux.HandleFunc("GET /api/folders", handlers.ListFolders(state.DB))
	mux.HandleFunc("POST /api/folders", handlers.CreateFolder(state.DB, state.Config.FeedsPath, &state.FeedsLock))
	mux.HandleFunc("PUT /api/folders/{id}", handlers.UpdateFolder(state.DB, state.Config.FeedsPath, &state.FeedsLock))
	mux.HandleFunc("DELETE /api/folders/{id}", handlers.DeleteFolder(state.DB, state.Config.FeedsPath, &state.FeedsLock))

	// Feed routes
	mux.HandleFunc("GET /api/feeds", handlers.ListFeeds(state.DB))
	mux.HandleFunc("POST /api/feeds", handlers.CreateFeed(state.DB, state.Config.FeedsPath, &state.FeedsLock, state.FeedClient))
	mux.HandleFunc("POST /api/feeds/discover", handlers.DiscoverFeed(state.FeedClient))
	mux.HandleFunc("PUT /api/feeds/{id}", handlers.UpdateFeed(state.DB, state.Config.FeedsPath, &state.FeedsLock))
	mux.HandleFunc("DELETE /api/feeds/{id}", handlers.DeleteFeed(state.DB, state.Config.FeedsPath, &state.FeedsLock))

	// Article routes
	mux.HandleFunc("GET /api/articles", handlers.ListArticles(state.DB))

	// Refresh route
	mux.HandleFunc("POST /api/refresh", handlers.Refresh(state.DB, state.FeedClient))

	// Fallback: proxy or static file serving
	if state.Config.StaticDir != "" {
		mux.Handle("/", staticHandler(state))
	} else {
		mux.HandleFunc("/", proxyHandler(state))
	}

	return mux
}

// CORSMiddleware wraps an http.Handler to add CORS headers to every response.
func CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
