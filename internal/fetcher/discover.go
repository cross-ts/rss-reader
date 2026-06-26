package fetcher

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/mmcdole/gofeed"
	"golang.org/x/net/html"
)

// feedMIMETypes lists the MIME types recognized as feed types.
var feedMIMETypes = map[string]bool{
	"application/rss+xml":   true,
	"application/atom+xml":  true,
	"application/json":      true,
	"application/feed+json": true,
}

// DiscoverFeedURLs extracts feed URLs from HTML <link rel="alternate"> elements.
func DiscoverFeedURLs(htmlContent string, baseURL *url.URL) []string {
	doc, err := html.Parse(strings.NewReader(htmlContent))
	if err != nil {
		return nil
	}

	seen := make(map[string]bool)
	var urls []string

	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "link" {
			var rel, typ, href string
			for _, attr := range n.Attr {
				switch strings.ToLower(attr.Key) {
				case "rel":
					rel = attr.Val
				case "type":
					typ = attr.Val
				case "href":
					href = attr.Val
				}
			}

			// Check if rel contains "alternate".
			hasAlternate := false
			for _, r := range strings.Fields(rel) {
				if strings.EqualFold(r, "alternate") {
					hasAlternate = true
					break
				}
			}

			if hasAlternate && feedMIMETypes[strings.ToLower(typ)] && href != "" {
				// Resolve against base URL.
				resolved := href
				if baseURL != nil {
					if ref, err := url.Parse(href); err == nil {
						resolved = baseURL.ResolveReference(ref).String()
					}
				}

				if !seen[resolved] {
					seen[resolved] = true
					urls = append(urls, resolved)
				}
			}
		}

		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)

	return urls
}

// ResolveResult holds the result of resolving an input URL to a feed.
type ResolveResult struct {
	FeedURL string
	Title   string
	SiteURL *string
}

// ResolveFeed attempts to resolve an input URL to a feed.
// It first tries parsing the URL content as a feed directly.
// If that fails, it treats the content as HTML and discovers feed links.
func ResolveFeed(client *http.Client, inputURL string) (*ResolveResult, error) {
	// Fetch the input URL.
	body, finalURL, fetchErr := FetchWithGuard(client, inputURL, 5)
	if fetchErr != nil {
		return nil, fmt.Errorf("URL の取得に失敗: %w", fetchErr)
	}

	// Try parsing as a feed directly.
	parser := gofeed.NewParser()
	feed, parseErr := parser.ParseString(string(body))
	if parseErr == nil && feed != nil {
		// Successfully parsed as a feed.
		feedTitle := feed.Title
		if feedTitle == "" {
			feedTitle = finalURL
		}

		var site *string
		if feed.Link != "" {
			site = &feed.Link
		}

		return &ResolveResult{FeedURL: finalURL, Title: feedTitle, SiteURL: site}, nil
	}

	// Not a feed: treat as HTML and discover feed links.
	base, err := url.Parse(finalURL)
	if err != nil {
		return nil, fmt.Errorf("ベース URL のパースに失敗: %w", err)
	}

	candidates := DiscoverFeedURLs(string(body), base)
	if len(candidates) == 0 {
		return nil, fmt.Errorf("フィードが見つかりませんでした: %s", inputURL)
	}

	// Try each candidate (up to 5 fetch attempts; SSRF validation failures don't count).
	var lastErr error
	fetchAttempts := 0
	for _, candidate := range candidates {
		if fetchAttempts >= 5 {
			break
		}

		// SSRF validation: failures skip without counting.
		if err := ValidateFeedURL(candidate); err != nil {
			continue
		}

		fetchAttempts++

		candidateBody, candidateFinalURL, fetchErr := FetchWithGuard(client, candidate, 5)
		if fetchErr != nil {
			lastErr = fetchErr
			continue
		}

		candidateFeed, parseErr := parser.ParseString(string(candidateBody))
		if parseErr != nil {
			lastErr = parseErr
			continue
		}

		feedTitle := candidateFeed.Title
		if feedTitle == "" {
			feedTitle = candidateFinalURL
		}

		var site *string
		if candidateFeed.Link != "" {
			site = &candidateFeed.Link
		}

		return &ResolveResult{FeedURL: candidateFinalURL, Title: feedTitle, SiteURL: site}, nil
	}

	if lastErr != nil {
		return nil, fmt.Errorf("フィード候補の取得/パースに失敗: %w", lastErr)
	}
	return nil, fmt.Errorf("フィードが見つかりませんでした: %s", inputURL)
}
