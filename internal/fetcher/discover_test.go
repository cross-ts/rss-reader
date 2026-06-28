package fetcher

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestDiscoverFeedURLsFromLinkHeader(t *testing.T) {
	base, _ := url.Parse("https://example.com/blog")

	tests := []struct {
		name    string
		headers []string
		want    []string
	}{
		{
			name:    "single RSS link",
			headers: []string{`</feed.xml>; rel="alternate"; type="application/rss+xml"`},
			want:    []string{"https://example.com/feed.xml"},
		},
		{
			name:    "single Atom link",
			headers: []string{`</atom.xml>; rel="alternate"; type="application/atom+xml"`},
			want:    []string{"https://example.com/atom.xml"},
		},
		{
			name:    "JSON Feed",
			headers: []string{`</feed.json>; rel="alternate"; type="application/feed+json"`},
			want:    []string{"https://example.com/feed.json"},
		},
		{
			name:    "multiple links in one header",
			headers: []string{`</feed.xml>; rel="alternate"; type="application/rss+xml", </atom.xml>; rel="alternate"; type="application/atom+xml"`},
			want:    []string{"https://example.com/feed.xml", "https://example.com/atom.xml"},
		},
		{
			name: "multiple Link header values",
			headers: []string{
				`</feed.xml>; rel="alternate"; type="application/rss+xml"`,
				`</atom.xml>; rel="alternate"; type="application/atom+xml"`,
			},
			want: []string{"https://example.com/feed.xml", "https://example.com/atom.xml"},
		},
		{
			name:    "rel without alternate is ignored",
			headers: []string{`</style.css>; rel="stylesheet"; type="text/css"`},
			want:    nil,
		},
		{
			name:    "no type is ignored",
			headers: []string{`</page>; rel="alternate"`},
			want:    nil,
		},
		{
			name:    "non-feed type is ignored",
			headers: []string{`</page>; rel="alternate"; type="text/html"`},
			want:    nil,
		},
		{
			name:    "absolute URL preserved",
			headers: []string{`<https://cdn.example.com/feed.xml>; rel="alternate"; type="application/rss+xml"`},
			want:    []string{"https://cdn.example.com/feed.xml"},
		},
		{
			name:    "deduplication",
			headers: []string{`</feed.xml>; rel="alternate"; type="application/rss+xml", </feed.xml>; rel="alternate"; type="application/rss+xml"`},
			want:    []string{"https://example.com/feed.xml"},
		},
		{
			name:    "empty Link header",
			headers: []string{},
			want:    nil,
		},
		{
			name:    "unquoted param values",
			headers: []string{`</feed.xml>; rel=alternate; type=application/rss+xml`},
			want:    []string{"https://example.com/feed.xml"},
		},
		{
			name:    "type with charset suffix",
			headers: []string{`</feed.xml>; rel="alternate"; type="application/rss+xml; charset=utf-8"`},
			want:    []string{"https://example.com/feed.xml"},
		},
		{
			name:    "malformed link followed by valid link",
			headers: []string{`GARBAGE, </feed.xml>; rel="alternate"; type="application/rss+xml"`},
			want:    []string{"https://example.com/feed.xml"},
		},
		{
			name:    "type param before rel param",
			headers: []string{`</feed.xml>; type="application/rss+xml"; rel="alternate"`},
			want:    []string{"https://example.com/feed.xml"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			header := http.Header{}
			for _, h := range tt.headers {
				header.Add("Link", h)
			}

			got := DiscoverFeedURLsFromLinkHeader(header, base)

			if len(got) != len(tt.want) {
				t.Fatalf("got %d URLs %v, want %d URLs %v", len(got), got, len(tt.want), tt.want)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("URL[%d] = %q, want %q", i, got[i], tt.want[i])
				}
			}
		})
	}
}

func TestDiscoverFeedURLsFromLinkHeader_MergedWithHTML(t *testing.T) {
	base, _ := url.Parse("https://example.com/")

	htmlBody := `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body></body></html>`
	htmlCandidates := DiscoverFeedURLs(htmlBody, base)

	header := http.Header{}
	header.Set("Link", `</atom.xml>; rel="alternate"; type="application/atom+xml"`)
	linkCandidates := DiscoverFeedURLsFromLinkHeader(header, base)

	// Merge with deduplication (same logic as ResolveFeeds).
	seen := make(map[string]bool, len(htmlCandidates))
	var mergedURLs []string
	for _, c := range htmlCandidates {
		seen[c.URL] = true
		mergedURLs = append(mergedURLs, c.URL)
	}
	for _, c := range linkCandidates {
		if !seen[c] {
			mergedURLs = append(mergedURLs, c)
		}
	}

	want := []string{"https://example.com/feed.xml", "https://example.com/atom.xml"}
	if len(mergedURLs) != len(want) {
		t.Fatalf("got %d URLs %v, want %d URLs %v", len(mergedURLs), mergedURLs, len(want), want)
	}
	for i := range mergedURLs {
		if mergedURLs[i] != want[i] {
			t.Errorf("URL[%d] = %q, want %q", i, mergedURLs[i], want[i])
		}
	}
}

func TestDiscoverFeedURLsFromLinkHeader_DeduplicatesWithHTML(t *testing.T) {
	base, _ := url.Parse("https://example.com/")

	htmlBody := `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body></body></html>`
	htmlCandidates := DiscoverFeedURLs(htmlBody, base)

	// Same URL in Link header should be deduplicated.
	header := http.Header{}
	header.Set("Link", `</feed.xml>; rel="alternate"; type="application/rss+xml"`)
	linkCandidates := DiscoverFeedURLsFromLinkHeader(header, base)

	seen := make(map[string]bool, len(htmlCandidates))
	var mergedURLs []string
	for _, c := range htmlCandidates {
		seen[c.URL] = true
		mergedURLs = append(mergedURLs, c.URL)
	}
	for _, c := range linkCandidates {
		if !seen[c] {
			mergedURLs = append(mergedURLs, c)
		}
	}

	if len(mergedURLs) != 1 {
		t.Fatalf("expected 1 URL after dedup, got %d: %v", len(mergedURLs), mergedURLs)
	}
	if mergedURLs[0] != "https://example.com/feed.xml" {
		t.Errorf("URL = %q, want %q", mergedURLs[0], "https://example.com/feed.xml")
	}
}

func TestDiscoverFeedURLs(t *testing.T) {
	base, _ := url.Parse("https://example.com/blog/")

	tests := []struct {
		name string
		html string
		want []DiscoveredLink
	}{
		{
			name: "RSS link tag",
			html: `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body></body></html>`,
			want: []DiscoveredLink{{URL: "https://example.com/feed.xml", Type: "application/rss+xml"}},
		},
		{
			name: "Atom link tag",
			html: `<html><head><link rel="alternate" type="application/atom+xml" href="/atom.xml"></head><body></body></html>`,
			want: []DiscoveredLink{{URL: "https://example.com/atom.xml", Type: "application/atom+xml"}},
		},
		{
			name: "JSON Feed link tag",
			html: `<html><head><link rel="alternate" type="application/feed+json" href="/feed.json"></head><body></body></html>`,
			want: []DiscoveredLink{{URL: "https://example.com/feed.json", Type: "application/feed+json"}},
		},
		{
			name: "application/json link tag",
			html: `<html><head><link rel="alternate" type="application/json" href="/feed.json"></head><body></body></html>`,
			want: []DiscoveredLink{{URL: "https://example.com/feed.json", Type: "application/json"}},
		},
		{
			name: "multiple feed links",
			html: `<html><head>
				<link rel="alternate" type="application/rss+xml" href="/rss.xml">
				<link rel="alternate" type="application/atom+xml" href="/atom.xml">
			</head><body></body></html>`,
			want: []DiscoveredLink{
				{URL: "https://example.com/rss.xml", Type: "application/rss+xml"},
				{URL: "https://example.com/atom.xml", Type: "application/atom+xml"},
			},
		},
		{
			name: "absolute URL preserved",
			html: `<html><head><link rel="alternate" type="application/rss+xml" href="https://cdn.example.com/feed.xml"></head></html>`,
			want: []DiscoveredLink{{URL: "https://cdn.example.com/feed.xml", Type: "application/rss+xml"}},
		},
		{
			name: "relative URL resolved",
			html: `<html><head><link rel="alternate" type="application/rss+xml" href="feed.xml"></head></html>`,
			want: []DiscoveredLink{{URL: "https://example.com/blog/feed.xml", Type: "application/rss+xml"}},
		},
		{
			name: "deduplication",
			html: `<html><head>
				<link rel="alternate" type="application/rss+xml" href="/feed.xml">
				<link rel="alternate" type="application/rss+xml" href="/feed.xml">
			</head></html>`,
			want: []DiscoveredLink{{URL: "https://example.com/feed.xml", Type: "application/rss+xml"}},
		},
		{
			name: "non-feed type ignored",
			html: `<html><head><link rel="alternate" type="text/html" href="/page"></head></html>`,
			want: nil,
		},
		{
			name: "rel stylesheet ignored",
			html: `<html><head><link rel="stylesheet" type="application/rss+xml" href="/style.css"></head></html>`,
			want: nil,
		},
		{
			name: "no rel alternate ignored",
			html: `<html><head><link type="application/rss+xml" href="/feed.xml"></head></html>`,
			want: nil,
		},
		{
			name: "empty href ignored",
			html: `<html><head><link rel="alternate" type="application/rss+xml" href=""></head></html>`,
			want: nil,
		},
		{
			name: "no links at all",
			html: `<html><head><title>Test</title></head><body><p>No links</p></body></html>`,
			want: nil,
		},
		{
			name: "empty HTML",
			html: "",
			want: nil,
		},
		{
			name: "case insensitive type",
			html: `<html><head><link rel="alternate" type="Application/RSS+XML" href="/feed.xml"></head></html>`,
			want: []DiscoveredLink{{URL: "https://example.com/feed.xml", Type: "application/rss+xml"}},
		},
		{
			name: "rel with multiple values including alternate",
			html: `<html><head><link rel="alternate nofollow" type="application/rss+xml" href="/feed.xml"></head></html>`,
			want: []DiscoveredLink{{URL: "https://example.com/feed.xml", Type: "application/rss+xml"}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := DiscoverFeedURLs(tt.html, base)

			if len(got) != len(tt.want) {
				t.Fatalf("got %d links %v, want %d links %v", len(got), got, len(tt.want), tt.want)
			}
			for i := range got {
				if got[i].URL != tt.want[i].URL {
					t.Errorf("link[%d].URL = %q, want %q", i, got[i].URL, tt.want[i].URL)
				}
				if got[i].Type != tt.want[i].Type {
					t.Errorf("link[%d].Type = %q, want %q", i, got[i].Type, tt.want[i].Type)
				}
			}
		})
	}
}

func TestDiscoverFeedURLs_NilBaseURL(t *testing.T) {
	html := `<html><head><link rel="alternate" type="application/rss+xml" href="https://example.com/feed.xml"></head></html>`
	got := DiscoverFeedURLs(html, nil)
	if len(got) != 1 {
		t.Fatalf("expected 1 link, got %d", len(got))
	}
	if got[0].URL != "https://example.com/feed.xml" {
		t.Errorf("unexpected URL: %q", got[0].URL)
	}
}

func TestDetectFeedContentType(t *testing.T) {
	tests := []struct {
		name        string
		contentType string
		want        string
	}{
		{"rss+xml", "application/rss+xml", "application/rss+xml"},
		{"atom+xml", "application/atom+xml", "application/atom+xml"},
		{"json", "application/json", "application/json"},
		{"feed+json", "application/feed+json", "application/feed+json"},
		{"with charset", "application/rss+xml; charset=utf-8", "application/rss+xml"},
		{"uppercase", "Application/RSS+XML", "application/rss+xml"},
		{"text/html", "text/html", ""},
		{"text/xml", "text/xml", ""},
		{"empty", "", ""},
		{"unknown", "application/octet-stream", ""},
		{"with spaces", "  application/rss+xml  ; charset=utf-8", "application/rss+xml"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := detectFeedContentType(tt.contentType)
			if got != tt.want {
				t.Errorf("detectFeedContentType(%q) = %q, want %q", tt.contentType, got, tt.want)
			}
		})
	}
}

func TestResolveFeeds_DirectFeedURL(t *testing.T) {
	feed := `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Direct Feed</title>
    <link>https://example.com</link>
    <item>
      <title>Item 1</title>
      <guid>guid-1</guid>
    </item>
  </channel>
</rss>`

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(feed))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	url := rewrite(ts.URL)
	candidates, err := ResolveFeeds(client, url)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(candidates) != 1 {
		t.Fatalf("expected 1 candidate, got %d", len(candidates))
	}
	if candidates[0].Title != "Direct Feed" {
		t.Errorf("expected title 'Direct Feed', got %q", candidates[0].Title)
	}
	if candidates[0].FeedURL != url {
		t.Errorf("expected feed URL %q, got %q", url, candidates[0].FeedURL)
	}
	if candidates[0].SiteURL == nil || *candidates[0].SiteURL != "https://example.com" {
		t.Errorf("unexpected site URL: %v", candidates[0].SiteURL)
	}
	if candidates[0].Type != "application/rss+xml" {
		t.Errorf("unexpected type: %q", candidates[0].Type)
	}
}

func TestResolveFeeds_DirectFeedNoTitle(t *testing.T) {
	feed := `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title></title>
    <item>
      <title>Item</title>
      <guid>g1</guid>
    </item>
  </channel>
</rss>`

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(feed))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	url := rewrite(ts.URL)
	candidates, err := ResolveFeeds(client, url)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Title should fall back to the URL
	if candidates[0].Title != url {
		t.Errorf("expected title to be URL %q, got %q", url, candidates[0].Title)
	}
	// No site link
	if candidates[0].SiteURL != nil {
		t.Errorf("expected nil SiteURL, got %v", candidates[0].SiteURL)
	}
}

func TestResolveFeeds_HTMLWithFeedDiscovery(t *testing.T) {
	feed := `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Discovered Feed</title>
    <link>https://example.com</link>
    <item>
      <title>Item 1</title>
      <guid>guid-1</guid>
    </item>
  </channel>
</rss>`

	feedServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(feed))
	}))
	defer feedServer.Close()

	_, rewriteFeed := testClient(feedServer)
	feedURL := rewriteFeed(feedServer.URL)

	htmlPage := fmt.Sprintf(`<html><head>
		<link rel="alternate" type="application/rss+xml" href="%s">
	</head><body><h1>Blog</h1></body></html>`, feedURL)

	htmlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(htmlPage))
	}))
	defer htmlServer.Close()

	client, rewrite := testClient(htmlServer, feedServer)
	candidates, err := ResolveFeeds(client, rewrite(htmlServer.URL))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(candidates) != 1 {
		t.Fatalf("expected 1 candidate, got %d", len(candidates))
	}
	if candidates[0].Title != "Discovered Feed" {
		t.Errorf("expected title 'Discovered Feed', got %q", candidates[0].Title)
	}
}

func TestResolveFeeds_NoFeedFound(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("<html><body>No feeds here</body></html>"))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	_, err := ResolveFeeds(client, rewrite(ts.URL))
	if err == nil {
		t.Fatal("expected error for no feeds found")
	}
	if !strings.Contains(err.Error(), "フィードが見つかりませんでした") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestResolveFeeds_MultipleCandidates(t *testing.T) {
	rssFeed := `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>RSS Feed</title>
    <link>https://example.com</link>
    <item><title>RSS Item</title><guid>rss-1</guid></item>
  </channel>
</rss>`

	atomFeed := `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <link href="https://example.com"/>
  <entry>
    <title>Atom Item</title>
    <id>atom-1</id>
    <updated>2025-01-01T00:00:00Z</updated>
  </entry>
</feed>`

	mux := http.NewServeMux()
	mux.HandleFunc("/rss", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		w.Write([]byte(rssFeed))
	})
	mux.HandleFunc("/atom", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/atom+xml")
		w.Write([]byte(atomFeed))
	})

	feedServer := httptest.NewServer(mux)
	defer feedServer.Close()

	_, rewriteFeed := testClient(feedServer)

	htmlPage := fmt.Sprintf(`<html><head>
		<link rel="alternate" type="application/rss+xml" href="%s/rss">
		<link rel="alternate" type="application/atom+xml" href="%s/atom">
	</head><body></body></html>`, rewriteFeed(feedServer.URL), rewriteFeed(feedServer.URL))

	htmlMux := http.NewServeMux()
	htmlMux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(htmlPage))
	})
	htmlServer := httptest.NewServer(htmlMux)
	defer htmlServer.Close()

	client, rewrite := testClient(htmlServer, feedServer)
	candidates, err := ResolveFeeds(client, rewrite(htmlServer.URL))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(candidates) != 2 {
		t.Fatalf("expected 2 candidates, got %d", len(candidates))
	}
}

func TestResolveFeeds_CandidateFetchFailure(t *testing.T) {
	// HTML page points to a feed URL that is a documentation IP (SSRF blocked)
	htmlPage := `<html><head>
		<link rel="alternate" type="application/rss+xml" href="http://192.0.2.1/feed.xml">
	</head><body></body></html>`

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(htmlPage))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	_, err := ResolveFeeds(client, rewrite(ts.URL))
	if err == nil {
		t.Fatal("expected error when candidate feed is unreachable")
	}
}

func TestResolveFeeds_LinkHeaderDiscovery(t *testing.T) {
	feed := `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Link Header Feed</title>
    <link>https://example.com</link>
    <item><title>Item</title><guid>g1</guid></item>
  </channel>
</rss>`

	feedServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		w.Write([]byte(feed))
	}))
	defer feedServer.Close()

	_, rewriteFeed := testClient(feedServer)
	feedURL := rewriteFeed(feedServer.URL)

	htmlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Header().Set("Link", fmt.Sprintf(`<%s>; rel="alternate"; type="application/rss+xml"`, feedURL))
		w.Write([]byte("<html><body>No link tags</body></html>"))
	}))
	defer htmlServer.Close()

	client, rewrite := testClient(htmlServer, feedServer)
	candidates, err := ResolveFeeds(client, rewrite(htmlServer.URL))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(candidates) != 1 {
		t.Fatalf("expected 1 candidate, got %d", len(candidates))
	}
	if candidates[0].Title != "Link Header Feed" {
		t.Errorf("expected 'Link Header Feed', got %q", candidates[0].Title)
	}
}

func TestResolveFeed_ReturnsFirstCandidate(t *testing.T) {
	feed := `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>My Feed</title>
    <link>https://example.com</link>
    <item><title>Item</title><guid>g1</guid></item>
  </channel>
</rss>`

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		w.Write([]byte(feed))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	url := rewrite(ts.URL)
	result, err := ResolveFeed(client, url)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.FeedURL != url {
		t.Errorf("unexpected feed URL: %q", result.FeedURL)
	}
	if result.Title != "My Feed" {
		t.Errorf("unexpected title: %q", result.Title)
	}
	if result.SiteURL == nil || *result.SiteURL != "https://example.com" {
		t.Errorf("unexpected site URL: %v", result.SiteURL)
	}
}

func TestResolveFeed_Error(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	_, err := ResolveFeed(client, rewrite(ts.URL))
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestResolveFeeds_CandidateParseFailure(t *testing.T) {
	feedServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("not a feed"))
	}))
	defer feedServer.Close()

	_, rewriteFeed := testClient(feedServer)
	feedURL := rewriteFeed(feedServer.URL)

	htmlPage := fmt.Sprintf(`<html><head>
		<link rel="alternate" type="application/rss+xml" href="%s">
	</head><body></body></html>`, feedURL)

	htmlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(htmlPage))
	}))
	defer htmlServer.Close()

	client, rewrite := testClient(htmlServer, feedServer)
	_, err := ResolveFeeds(client, rewrite(htmlServer.URL))
	if err == nil {
		t.Fatal("expected error when candidate feed cannot be parsed")
	}
	if !strings.Contains(err.Error(), "パース") {
		t.Errorf("unexpected error: %v", err)
	}
}
