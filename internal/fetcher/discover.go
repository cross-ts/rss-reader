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

// DiscoveredLink holds a discovered feed URL and its MIME type.
type DiscoveredLink struct {
	URL  string
	Type string
}

// DiscoverFeedURLs extracts feed URLs from HTML <link rel="alternate"> elements.
func DiscoverFeedURLs(htmlContent string, baseURL *url.URL) []DiscoveredLink {
	doc, err := html.Parse(strings.NewReader(htmlContent))
	if err != nil {
		return nil
	}

	seen := make(map[string]bool)
	var links []DiscoveredLink

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

			hasAlternate := false
			for _, r := range strings.Fields(rel) {
				if strings.EqualFold(r, "alternate") {
					hasAlternate = true
					break
				}
			}

			if hasAlternate && feedMIMETypes[strings.ToLower(typ)] && href != "" {
				resolved := href
				if baseURL != nil {
					if ref, err := url.Parse(href); err == nil {
						resolved = baseURL.ResolveReference(ref).String()
					}
				}

				if !seen[resolved] {
					seen[resolved] = true
					links = append(links, DiscoveredLink{URL: resolved, Type: strings.ToLower(typ)})
				}
			}
		}

		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)

	return links
}

// DiscoverFeedURLsFromLinkHeader extracts feed URLs from HTTP Link headers (RFC 8288).
func DiscoverFeedURLsFromLinkHeader(header http.Header, baseURL *url.URL) []string {
	seen := make(map[string]bool)
	var urls []string

	for _, headerVal := range header.Values("Link") {
		for _, link := range parseLinkHeader(headerVal) {
			mediaType := strings.TrimSpace(link.typ)
			if idx := strings.IndexByte(mediaType, ';'); idx >= 0 {
				mediaType = strings.TrimSpace(mediaType[:idx])
			}
			if link.hasAlternate && feedMIMETypes[strings.ToLower(mediaType)] && link.href != "" {
				resolved := link.href
				if baseURL != nil {
					if ref, err := url.Parse(link.href); err == nil {
						resolved = baseURL.ResolveReference(ref).String()
					}
				}
				if !seen[resolved] {
					seen[resolved] = true
					urls = append(urls, resolved)
				}
			}
		}
	}

	return urls
}

type parsedLink struct {
	href         string
	hasAlternate bool
	typ          string
}

// parseLinkHeader parses a single Link header value which may contain
// multiple comma-separated link entries.
func parseLinkHeader(value string) []parsedLink {
	var links []parsedLink

	for value != "" {
		value = strings.TrimSpace(value)
		if value == "" {
			break
		}

		// Extract URI-Reference: <...>
		if value[0] != '<' {
			if idx := strings.IndexByte(value, ','); idx >= 0 {
				value = value[idx+1:]
				continue
			}
			break
		}
		end := strings.Index(value, ">")
		if end < 0 {
			if idx := strings.IndexByte(value, ','); idx >= 0 {
				value = value[idx+1:]
				continue
			}
			break
		}
		href := value[1:end]
		value = strings.TrimSpace(value[end+1:])

		var hasAlternate bool
		var typ string
		malformed := false

		// Parse parameters (;key="value" or ;key=value)
		for strings.HasPrefix(value, ";") {
			value = strings.TrimSpace(value[1:])

			eqIdx := strings.IndexAny(value, "=,;>")
			if eqIdx < 0 || value[eqIdx] != '=' {
				malformed = true
				break
			}
			key := strings.TrimSpace(value[:eqIdx])
			value = strings.TrimSpace(value[eqIdx+1:])

			var paramVal string
			if len(value) > 0 && value[0] == '"' {
				closeQuote := strings.Index(value[1:], "\"")
				if closeQuote < 0 {
					malformed = true
					break
				}
				paramVal = value[1 : closeQuote+1]
				value = strings.TrimSpace(value[closeQuote+2:])
			} else {
				endIdx := strings.IndexAny(value, ",;")
				if endIdx < 0 {
					paramVal = strings.TrimSpace(value)
					value = ""
				} else {
					paramVal = strings.TrimSpace(value[:endIdx])
					value = value[endIdx:]
				}
			}

			switch strings.ToLower(key) {
			case "rel":
				for _, r := range strings.Fields(paramVal) {
					if strings.EqualFold(r, "alternate") {
						hasAlternate = true
						break
					}
				}
			case "type":
				typ = paramVal
			}
		}

		if malformed {
			if idx := strings.IndexByte(value, ','); idx >= 0 {
				value = value[idx+1:]
				continue
			}
			break
		}

		links = append(links, parsedLink{href: href, hasAlternate: hasAlternate, typ: typ})

		if strings.HasPrefix(value, ",") {
			value = value[1:]
		} else {
			break
		}
	}

	return links
}

// ResolveResult holds the result of resolving an input URL to a feed.
type ResolveResult struct {
	FeedURL string
	Title   string
	SiteURL *string
}

// FeedCandidate holds a discovered feed candidate with metadata.
type FeedCandidate struct {
	FeedURL string
	Title   string
	SiteURL *string
	Type    string
}

// detectFeedContentType extracts a recognized feed MIME type from a Content-Type header value.
func detectFeedContentType(contentType string) string {
	ct := strings.ToLower(contentType)
	if idx := strings.IndexByte(ct, ';'); idx >= 0 {
		ct = ct[:idx]
	}
	ct = strings.TrimSpace(ct)
	if feedMIMETypes[ct] {
		return ct
	}
	return ""
}

// ResolveFeeds attempts to resolve an input URL to one or more feed candidates.
func ResolveFeeds(client *http.Client, inputURL string) ([]FeedCandidate, error) {
	result, fetchErr := FetchWithGuardConditional(client, inputURL, 5, nil, nil)
	if fetchErr != nil {
		return nil, fmt.Errorf("URL の取得に失敗: %w", fetchErr)
	}
	if result.Outcome == FetchNotModified {
		return nil, fmt.Errorf("予期しない 304 Not Modified（条件付きヘッダなし）")
	}

	body := result.Bytes
	finalURL := result.FinalURL

	parser := gofeed.NewParser()
	feed, parseErr := parser.ParseString(string(body))
	if parseErr == nil && feed != nil {
		feedTitle := feed.Title
		if feedTitle == "" {
			feedTitle = finalURL
		}

		var site *string
		if feed.Link != "" {
			site = &feed.Link
		}

		return []FeedCandidate{{
			FeedURL: finalURL,
			Title:   feedTitle,
			SiteURL: site,
			Type:    detectFeedContentType(result.Header.Get("Content-Type")),
		}}, nil
	}

	base, err := url.Parse(finalURL)
	if err != nil {
		return nil, fmt.Errorf("ベース URL のパースに失敗: %w", err)
	}

	discoveredLinks := DiscoverFeedURLs(string(body), base)

	seen := make(map[string]bool, len(discoveredLinks))
	for _, l := range discoveredLinks {
		seen[l.URL] = true
	}
	for _, u := range DiscoverFeedURLsFromLinkHeader(result.Header, base) {
		if !seen[u] {
			seen[u] = true
			discoveredLinks = append(discoveredLinks, DiscoveredLink{URL: u})
		}
	}

	if len(discoveredLinks) == 0 {
		return nil, fmt.Errorf("フィードが見つかりませんでした: %s", inputURL)
	}

	var candidates []FeedCandidate
	var lastErr error
	fetchAttempts := 0
	for _, link := range discoveredLinks {
		if fetchAttempts >= 5 {
			break
		}

		if err := ValidateFeedURL(link.URL); err != nil {
			continue
		}

		fetchAttempts++

		candidateBody, candidateFinalURL, fetchErr := FetchWithGuard(client, link.URL, 5)
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

		candidates = append(candidates, FeedCandidate{
			FeedURL: candidateFinalURL,
			Title:   feedTitle,
			SiteURL: site,
			Type:    link.Type,
		})
	}

	if len(candidates) > 0 {
		return candidates, nil
	}

	if lastErr != nil {
		return nil, fmt.Errorf("フィード候補の取得/パースに失敗: %w", lastErr)
	}
	return nil, fmt.Errorf("フィードが見つかりませんでした: %s", inputURL)
}

// ResolveFeed attempts to resolve an input URL to a feed.
// It first tries parsing the URL content as a feed directly.
// If that fails, it treats the content as HTML and discovers feed links.
func ResolveFeed(client *http.Client, inputURL string) (*ResolveResult, error) {
	candidates, err := ResolveFeeds(client, inputURL)
	if err != nil {
		return nil, err
	}

	c := candidates[0]
	return &ResolveResult{FeedURL: c.FeedURL, Title: c.Title, SiteURL: c.SiteURL}, nil
}
