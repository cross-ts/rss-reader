package fetcher

import (
	"net/http"
	"net/url"
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
