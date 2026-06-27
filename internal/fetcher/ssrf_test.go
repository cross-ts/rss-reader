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
