package fetcher

import (
	"net"
	"testing"
)

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

func TestValidateFeedURL(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		wantErr bool
	}{
		// Valid URLs
		{"valid https", "https://example.com/feed.xml", false},
		{"valid http", "http://example.com/feed.xml", false},
		{"valid public IP", "http://8.8.8.8/feed", false},
		{"valid public IPv6", "http://[2001:4860:4860::8888]/feed", false},

		// Invalid scheme
		{"ftp scheme", "ftp://example.com/file", true},
		{"file scheme", "file:///etc/passwd", true},
		{"javascript scheme", "javascript:alert(1)", true},
		{"data scheme", "data:text/html,<h1>hi</h1>", true},
		{"empty scheme", "://example.com", true},

		// Empty host
		{"empty host", "http:///path", true},

		// Localhost
		{"localhost", "http://localhost/feed", true},
		{"localhost with port", "http://localhost:8080/feed", true},

		// Loopback IPs
		{"loopback 127.0.0.1", "http://127.0.0.1/feed", true},
		{"loopback 127.0.0.2", "http://127.0.0.2/feed", true},
		{"loopback 127.255.255.255", "http://127.255.255.255/feed", true},

		// Private IPs
		{"private 10.x", "http://10.0.0.1/feed", true},
		{"private 10.255.x", "http://10.255.255.255/feed", true},
		{"private 172.16.x", "http://172.16.0.1/feed", true},
		{"private 172.31.x", "http://172.31.255.255/feed", true},
		{"not private 172.15.x", "http://172.15.0.1/feed", false},
		{"not private 172.32.x", "http://172.32.0.1/feed", false},
		{"private 192.168.x", "http://192.168.1.1/feed", true},

		// Link-local
		{"link-local 169.254.x", "http://169.254.1.1/feed", true},

		// Unspecified
		{"unspecified 0.0.0.0", "http://0.0.0.0/feed", true},
		{"zero prefix 0.1.2.3", "http://0.1.2.3/feed", true},

		// Broadcast
		{"broadcast", "http://255.255.255.255/feed", true},

		// CGNAT
		{"CGNAT 100.64.0.1", "http://100.64.0.1/feed", true},
		{"CGNAT 100.127.255.255", "http://100.127.255.255/feed", true},
		{"not CGNAT 100.128.0.1", "http://100.128.0.1/feed", false},

		// IETF Protocol Assignments
		{"IETF 192.0.0.1", "http://192.0.0.1/feed", true},

		// Documentation ranges
		{"doc 192.0.2.1", "http://192.0.2.1/feed", true},
		{"doc 198.51.100.1", "http://198.51.100.1/feed", true},
		{"doc 203.0.113.1", "http://203.0.113.1/feed", true},

		// Benchmarking
		{"benchmark 198.18.0.1", "http://198.18.0.1/feed", true},
		{"benchmark 198.19.255.255", "http://198.19.255.255/feed", true},
		{"not benchmark 198.20.0.1", "http://198.20.0.1/feed", false},

		// Reserved
		{"reserved 240.0.0.1", "http://240.0.0.1/feed", true},
		{"reserved 250.0.0.1", "http://250.0.0.1/feed", true},

		// IPv6 special addresses
		{"ipv6 loopback", "http://[::1]/feed", true},
		{"ipv6 unspecified", "http://[::]/feed", true},
		{"ipv6 unique local fc", "http://[fc00::1]/feed", true},
		{"ipv6 unique local fd", "http://[fd00::1]/feed", true},
		{"ipv6 link-local", "http://[fe80::1]/feed", true},
		{"ipv6 documentation", "http://[2001:db8::1]/feed", true},
		{"ipv6 public", "http://[2001:4860:4860::8844]/feed", false},

		// IPv4-mapped IPv6
		{"ipv4-mapped loopback", "http://[::ffff:127.0.0.1]/feed", true},
		{"ipv4-mapped private", "http://[::ffff:10.0.0.1]/feed", true},
		{"ipv4-mapped public", "http://[::ffff:8.8.8.8]/feed", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateFeedURL(tt.url)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateFeedURL(%q) error = %v, wantErr = %v", tt.url, err, tt.wantErr)
			}
		})
	}
}

func TestValidateFeedURLStatic(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		wantErr bool
	}{
		{"valid https", "https://example.com/feed.xml", false},
		{"valid http", "http://example.com/feed.xml", false},
		{"valid public IP", "http://8.8.8.8/feed", false},
		{"ftp scheme", "ftp://example.com/file", true},
		{"file scheme", "file:///etc/passwd", true},
		{"empty host", "http:///path", true},
		{"localhost", "http://localhost/feed", true},
		{"loopback IP", "http://127.0.0.1/feed", true},
		{"private IP", "http://10.0.0.1/feed", true},
		{"hostname passes without DNS", "http://nonexistent.invalid/feed", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateFeedURLStatic(tt.url)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateFeedURLStatic(%q) error = %v, wantErr = %v", tt.url, err, tt.wantErr)
			}
		})
	}
}

func TestCheckIPv4(t *testing.T) {
	tests := []struct {
		name    string
		ip      string
		wantErr bool
	}{
		// Public IPs - should pass
		{"public 8.8.8.8", "8.8.8.8", false},
		{"public 1.1.1.1", "1.1.1.1", false},
		{"public 93.184.216.34", "93.184.216.34", false},

		// Loopback
		{"loopback 127.0.0.1", "127.0.0.1", true},
		{"loopback 127.255.255.254", "127.255.255.254", true},

		// Private 10.x
		{"private 10.0.0.0", "10.0.0.0", true},
		{"private 10.255.255.255", "10.255.255.255", true},

		// Private 172.16-31.x
		{"private 172.16.0.0", "172.16.0.0", true},
		{"private 172.31.255.255", "172.31.255.255", true},
		{"not private 172.15.255.255", "172.15.255.255", false},
		{"not private 172.32.0.0", "172.32.0.0", false},

		// Private 192.168.x
		{"private 192.168.0.0", "192.168.0.0", true},
		{"private 192.168.255.255", "192.168.255.255", true},

		// Link-local
		{"link-local 169.254.0.0", "169.254.0.0", true},
		{"link-local 169.254.255.255", "169.254.255.255", true},

		// Unspecified
		{"unspecified", "0.0.0.0", true},

		// 0.x.x.x range
		{"zero prefix", "0.1.0.0", true},

		// Broadcast
		{"broadcast", "255.255.255.255", true},

		// CGNAT
		{"CGNAT low", "100.64.0.0", true},
		{"CGNAT high", "100.127.255.255", true},
		{"not CGNAT low", "100.63.255.255", false},
		{"not CGNAT high", "100.128.0.0", false},

		// IETF Protocol Assignments
		{"IETF 192.0.0.0", "192.0.0.0", true},
		{"IETF 192.0.0.255", "192.0.0.255", true},

		// Documentation
		{"doc 192.0.2.0", "192.0.2.0", true},
		{"doc 198.51.100.0", "198.51.100.0", true},
		{"doc 203.0.113.0", "203.0.113.0", true},
		{"doc 203.0.113.255", "203.0.113.255", true},

		// Benchmarking
		{"benchmark 198.18.0.0", "198.18.0.0", true},
		{"benchmark 198.19.255.255", "198.19.255.255", true},
		{"not benchmark 198.17.255.255", "198.17.255.255", false},

		// Reserved
		{"reserved 240.0.0.0", "240.0.0.0", true},
		{"reserved 255.0.0.0", "255.0.0.0", true},
		{"reserved 254.0.0.0", "254.0.0.0", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ip := net.ParseIP(tt.ip).To4()
			if ip == nil {
				t.Fatalf("failed to parse IP: %s", tt.ip)
			}
			err := checkIPv4(ip)
			if (err != nil) != tt.wantErr {
				t.Errorf("checkIPv4(%s) error = %v, wantErr = %v", tt.ip, err, tt.wantErr)
			}
		})
	}
}

func TestCheckIPv6(t *testing.T) {
	tests := []struct {
		name    string
		ip      string
		wantErr bool
	}{
		// Public IPv6
		{"public Google DNS", "2001:4860:4860::8888", false},
		{"public Google DNS 2", "2001:4860:4860::8844", false},
		{"public Cloudflare", "2606:4700:4700::1111", false},

		// Loopback
		{"loopback", "::1", true},

		// Unspecified
		{"unspecified", "::", true},

		// IPv4-mapped IPv6 (loopback)
		{"ipv4-mapped loopback", "::ffff:127.0.0.1", true},
		// IPv4-mapped IPv6 (private)
		{"ipv4-mapped private", "::ffff:192.168.1.1", true},
		// IPv4-mapped IPv6 (public)
		{"ipv4-mapped public", "::ffff:8.8.8.8", false},

		// Unique local
		{"unique local fc00", "fc00::1", true},
		{"unique local fd00", "fd00::1", true},
		{"unique local fdff", "fdff:ffff::1", true},

		// Link-local
		{"link-local fe80", "fe80::1", true},
		{"link-local febf", "febf::1", true},

		// Documentation
		{"documentation 2001:db8", "2001:db8::1", true},
		{"documentation 2001:db8 full", "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ip := net.ParseIP(tt.ip)
			if ip == nil {
				t.Fatalf("failed to parse IP: %s", tt.ip)
			}
			// Ensure 16-byte representation for checkIPv6
			ip = ip.To16()
			err := checkIPv6(ip)
			if (err != nil) != tt.wantErr {
				t.Errorf("checkIPv6(%s) error = %v, wantErr = %v", tt.ip, err, tt.wantErr)
			}
		})
	}
}
