package fetcher

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/cross-ts/rss-reader/internal/db"
	"github.com/mmcdole/gofeed"
)

// MaxFeedBytes is the maximum allowed feed body size (10MB).
const MaxFeedBytes = 10 * 1024 * 1024

// FetchOutcome represents the result type of a conditional fetch.
type FetchOutcome int

const (
	// FetchNotModified indicates a 304 Not Modified response.
	FetchNotModified FetchOutcome = iota
	// FetchSuccess indicates a successful fetch with content.
	FetchSuccess
)

// FetchResult holds the result of a conditional HTTP fetch.
type FetchResult struct {
	Outcome      FetchOutcome
	Bytes        []byte
	FinalURL     string
	Header       http.Header
	Etag         *string
	LastModified *string
}

// NewFeedClient creates an HTTP client for feed fetching with redirect disabled.
func NewFeedClient() *http.Client {
	return &http.Client{
		Timeout: 15 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

// NewProxyClient creates an HTTP client for proxying with default redirect behavior.
func NewProxyClient() *http.Client {
	return &http.Client{
		Timeout: 15 * time.Second,
	}
}

// FetchWithGuard performs an SSRF-guarded fetch with manual redirect following.
// It does not support conditional GET (no ETag/Last-Modified).
func FetchWithGuard(client *http.Client, startURL string, maxRedirects int) ([]byte, string, error) {
	result, err := FetchWithGuardConditional(client, startURL, maxRedirects, nil, nil)
	if err != nil {
		return nil, "", err
	}
	if result.Outcome == FetchNotModified {
		return nil, "", fmt.Errorf("予期しない 304 Not Modified（条件付きヘッダなし）")
	}
	return result.Bytes, result.FinalURL, nil
}

// FetchWithGuardConditional performs an SSRF-guarded fetch with manual redirect
// following and optional conditional GET support (If-None-Match / If-Modified-Since).
func FetchWithGuardConditional(client *http.Client, startURL string, maxRedirects int, ifNoneMatch *string, ifModifiedSince *string) (*FetchResult, error) {
	currentURL := startURL
	isFirstHop := true

	for hop := 0; hop <= maxRedirects; hop++ {
		// Validate each hop for SSRF.
		if err := ValidateFeedURL(currentURL); err != nil {
			return nil, fmt.Errorf("SSRF 検証失敗 (hop %d): %s: %w", hop, currentURL, err)
		}

		req, err := http.NewRequest("GET", currentURL, nil)
		if err != nil {
			return nil, fmt.Errorf("リクエスト作成失敗: %w", err)
		}
		req.Header.Set("User-Agent", "rss-reader/0.1")

		// Conditional GET headers only on the first hop.
		if isFirstHop {
			if ifNoneMatch != nil {
				req.Header.Set("If-None-Match", *ifNoneMatch)
			}
			if ifModifiedSince != nil {
				req.Header.Set("If-Modified-Since", *ifModifiedSince)
			}
		}

		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("HTTP リクエスト失敗: %w", err)
		}

		// 304 Not Modified.
		if resp.StatusCode == http.StatusNotModified {
			resp.Body.Close()
			return &FetchResult{Outcome: FetchNotModified}, nil
		}

		// Redirect (3xx): extract Location and follow.
		if resp.StatusCode >= 300 && resp.StatusCode < 400 {
			resp.Body.Close()

			location := resp.Header.Get("Location")
			if location == "" {
				return nil, fmt.Errorf("リダイレクトレスポンスに Location ヘッダがありません")
			}

			// Resolve relative URL against current URL.
			base, err := url.Parse(currentURL)
			if err != nil {
				return nil, fmt.Errorf("現在の URL のパースに失敗: %w", err)
			}
			next, err := url.Parse(location)
			if err != nil {
				return nil, fmt.Errorf("Location ヘッダの URL のパースに失敗: %w", err)
			}
			currentURL = base.ResolveReference(next).String()
			isFirstHop = false
			continue
		}

		// Non-success, non-redirect.
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			resp.Body.Close()
			return nil, fmt.Errorf("HTTP エラー: %d (%s)", resp.StatusCode, currentURL)
		}

		// Success: read body with size cap.
		body, err := readCapped(resp)
		if err != nil {
			return nil, err
		}

		// Extract ETag and Last-Modified headers.
		var etag *string
		if v := resp.Header.Get("Etag"); v != "" {
			etag = &v
		}
		var lastModified *string
		if v := resp.Header.Get("Last-Modified"); v != "" {
			lastModified = &v
		}

		return &FetchResult{
			Outcome:      FetchSuccess,
			Bytes:        body,
			FinalURL:     currentURL,
			Header:       resp.Header,
			Etag:         etag,
			LastModified: lastModified,
		}, nil
	}

	return nil, fmt.Errorf("リダイレクト上限 (%d) を超えました", maxRedirects)
}

// readCapped reads the response body up to MaxFeedBytes.
func readCapped(resp *http.Response) ([]byte, error) {
	defer resp.Body.Close()

	// If Content-Length is known and exceeds limit, reject early.
	if resp.ContentLength > int64(MaxFeedBytes) {
		return nil, fmt.Errorf("Content-Length (%d bytes) が上限 %d bytes を超えています", resp.ContentLength, MaxFeedBytes)
	}

	// Read up to MaxFeedBytes+1 to detect oversized bodies.
	data, err := io.ReadAll(io.LimitReader(resp.Body, int64(MaxFeedBytes)+1))
	if err != nil {
		return nil, fmt.Errorf("レスポンスボディの読み込み中にエラーが発生しました: %w", err)
	}
	if len(data) > MaxFeedBytes {
		return nil, fmt.Errorf("レスポンスボディが上限 %d bytes を超えました（SSRF/DoS対策）", MaxFeedBytes)
	}

	return data, nil
}

// FetchFeedData fetches a feed (using the target's conditional GET headers),
// parses it with gofeed, and returns the articles and metadata.
// Returns nil if the server responds with 304 Not Modified.
func FetchFeedData(client *http.Client, target *db.FeedTarget) (*db.FeedFetchResult, error) {
	result, err := FetchWithGuardConditional(client, target.URL, 5, target.Etag, target.LastModified)
	if err != nil {
		return nil, err
	}

	// 304 Not Modified: no new data.
	if result.Outcome == FetchNotModified {
		return nil, nil
	}

	// Parse the feed body.
	parser := gofeed.NewParser()
	feed, err := parser.ParseString(string(result.Bytes))
	if err != nil {
		return nil, fmt.Errorf("フィードのパースに失敗: %w", err)
	}

	var articles []db.NewArticle
	for _, item := range feed.Items {
		guid := item.GUID
		if guid == "" {
			guid = item.Link
		}
		if guid == "" {
			guid = item.Title
		}
		if guid == "" {
			continue
		}

		title := item.Title

		itemURL := ""
		if item.Link != "" {
			itemURL = item.Link
		}

		author := ""
		if item.Author != nil {
			author = item.Author.Name
		}

		content := item.Content
		if content == "" {
			content = item.Description
		}

		var publishedAt *string
		if item.PublishedParsed != nil {
			s := item.PublishedParsed.UTC().Format("2006-01-02T15:04:05Z")
			publishedAt = &s
		} else if item.UpdatedParsed != nil {
			s := item.UpdatedParsed.UTC().Format("2006-01-02T15:04:05Z")
			publishedAt = &s
		}

		articles = append(articles, db.NewArticle{
			GUID:        guid,
			Title:       title,
			URL:         itemURL,
			Author:      author,
			Content:     content,
			PublishedAt: publishedAt,
		})
	}

	fetchedAt := time.Now().UTC().Format("2006-01-02T15:04:05Z")

	return &db.FeedFetchResult{
		Articles: articles,
		Meta: &db.FetchMeta{
			Etag:         result.Etag,
			LastModified: result.LastModified,
			FetchedAt:    fetchedAt,
		},
	}, nil
}
