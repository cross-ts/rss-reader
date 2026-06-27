package fetcher

import "testing"

func TestNormalizeURL(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"no scheme", "tech.timee.co.jp", "https://tech.timee.co.jp"},
		{"https scheme", "https://example.com", "https://example.com"},
		{"http scheme", "http://example.com", "http://example.com"},
		{"no scheme with path", "example.com/feed", "https://example.com/feed"},
		{"scheme in query param", "example.com/?next=https://foo", "https://example.com/?next=https://foo"},
		{"protocol-relative", "//example.com", "https://example.com"},
		{"ftp scheme unchanged", "ftp://example.com/file", "ftp://example.com/file"},
		{"scheme in fragment", "example.com#https://foo", "https://example.com#https://foo"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NormalizeURL(tt.in)
			if got != tt.want {
				t.Errorf("NormalizeURL(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}
