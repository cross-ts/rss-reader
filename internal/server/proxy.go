package server

import (
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

const maxProxyBytes = 50 * 1024 * 1024 // 50MB

// verifyProxyOrigin checks that targetURL has the same scheme+host as frontendURL.
func verifyProxyOrigin(frontendURL, targetURL string) bool {
	fe, err := url.Parse(frontendURL)
	if err != nil {
		return false
	}
	tgt, err := url.Parse(targetURL)
	if err != nil {
		return false
	}
	return fe.Scheme == tgt.Scheme && fe.Host == tgt.Host
}

// isPathContained reports whether candidate is equal to base or a descendant
// of base, after resolving both to absolute paths. This guards against
// path traversal and prefix confusion (e.g. "/static-evil" matching "/static").
func isPathContained(base, candidate string) bool {
	absBase, err := filepath.Abs(base)
	if err != nil {
		return false
	}
	absCandidate, err := filepath.Abs(candidate)
	if err != nil {
		return false
	}
	if absCandidate == absBase {
		return true
	}
	return strings.HasPrefix(absCandidate, absBase+string(filepath.Separator))
}

// staticHandler serves static files from the configured directory with SPA fallback.
func staticHandler(state *AppState) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Clean the path to prevent directory traversal.
		p := filepath.Clean(r.URL.Path)
		if p == "/" {
			p = "/index.html"
		}

		filePath := filepath.Join(state.Config.StaticDir, filepath.FromSlash(p))

		// http.ServeFile independently rejects any request whose r.URL.Path
		// contains "..", regardless of the resolved name argument it's given.
		// Serve against a clone with a sanitized path so a raw traversal
		// attempt in the original request doesn't also block the SPA
		// fallback below; the name argument alone determines what's served.
		req := r
		if strings.Contains(r.URL.Path, "..") {
			req = r.Clone(r.Context())
			req.URL.Path = "/"
		}

		// Check if the file exists and is contained within the static directory.
		if isPathContained(state.Config.StaticDir, filePath) {
			if _, err := os.Stat(filePath); err == nil {
				http.ServeFile(w, req, filePath)
				return
			}
		}

		// SPA fallback: serve index.html for non-existent paths.
		indexPath := filepath.Join(state.Config.StaticDir, "index.html")
		http.ServeFile(w, req, indexPath)
	})
}

// proxyHandler reverse-proxies requests to the frontend dev server with SPA fallback.
func proxyHandler(state *AppState) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		frontendURL := strings.TrimRight(state.Config.FrontendURL, "/")
		path := r.URL.Path
		query := r.URL.RawQuery

		// Build target URL.
		target := frontendURL + path
		if query != "" {
			target += "?" + query
		}

		// Verify origin.
		if !verifyProxyOrigin(frontendURL, target) {
			http.Error(w, "bad proxy request", http.StatusBadRequest)
			return
		}

		// Determine if the path looks like an asset (last segment contains a dot).
		looksLikeAsset := false
		if lastSlash := strings.LastIndex(path, "/"); lastSlash >= 0 {
			segment := path[lastSlash+1:]
			if strings.Contains(segment, ".") {
				looksLikeAsset = true
			}
		}

		// Fetch the target.
		statusCode, contentType, body, ok := proxyFetch(state.ProxyClient, target)
		if ok {
			if statusCode != http.StatusNotFound {
				buildProxyResponse(w, statusCode, contentType, body)
				return
			}
			if looksLikeAsset {
				// Propagate 404 for assets.
				buildProxyResponse(w, statusCode, contentType, body)
				return
			}
		}

		// SPA fallback: fetch the root page.
		spaTarget := frontendURL + "/"
		if spaTarget != target {
			spaStatus, spaCT, spaBody, spaOK := proxyFetch(state.ProxyClient, spaTarget)
			if spaOK {
				buildProxyResponse(w, spaStatus, spaCT, spaBody)
				return
			}
		}

		// All failed.
		slog.Error("proxy: upstream unreachable", "target", target)
		http.Error(w, "bad gateway", http.StatusBadGateway)
	}
}

// proxyFetch performs an HTTP GET and returns the response details.
func proxyFetch(client *http.Client, targetURL string) (statusCode int, contentType string, body []byte, ok bool) {
	resp, err := client.Get(targetURL)
	if err != nil {
		slog.Warn("proxy fetch failed", "url", targetURL, "error", err)
		return 0, "", nil, false
	}
	defer resp.Body.Close()

	// Check Content-Length if provided.
	if resp.ContentLength > int64(maxProxyBytes) {
		slog.Warn("proxy response too large", "url", targetURL, "content_length", resp.ContentLength)
		return 0, "", nil, false
	}

	// Read body with limit.
	limited := io.LimitReader(resp.Body, int64(maxProxyBytes)+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		slog.Warn("proxy read failed", "url", targetURL, "error", err)
		return 0, "", nil, false
	}
	if len(data) > maxProxyBytes {
		slog.Warn("proxy response exceeded limit", "url", targetURL, "bytes_read", len(data))
		return 0, "", nil, false
	}

	return resp.StatusCode, resp.Header.Get("Content-Type"), data, true
}

// buildProxyResponse writes a proxy response to the client.
func buildProxyResponse(w http.ResponseWriter, statusCode int, contentType string, body []byte) {
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.WriteHeader(statusCode)
	w.Write(body)
}
