package fetcher

import (
	"context"
	"fmt"
	"net"
	"net/url"
)

// ValidateFeedURL validates that a URL is safe to fetch (SSRF protection).
// It checks the scheme, host, and all resolved IP addresses.
func ValidateFeedURL(rawURL string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("URL のパースに失敗: %w", err)
	}

	// Only allow http and https schemes.
	switch parsed.Scheme {
	case "http", "https":
		// OK
	default:
		return fmt.Errorf("許可されていないスキーム: %s", parsed.Scheme)
	}

	host := parsed.Hostname()
	if host == "" {
		return fmt.Errorf("ホスト名が取得できません")
	}

	// Reject localhost immediately (before DNS resolution).
	if host == "localhost" {
		return fmt.Errorf("ループバックアドレスへのアクセスは拒否されています: %s", host)
	}

	// If host is an IP literal, check it directly.
	if ip := net.ParseIP(host); ip != nil {
		return checkIP(ip)
	}

	// DNS resolve and check ALL resolved IPs.
	addrs, err := net.DefaultResolver.LookupIPAddr(context.Background(), host)
	if err != nil {
		return fmt.Errorf("DNS 解決失敗: %s: %w", host, err)
	}

	for _, addr := range addrs {
		if err := checkIP(addr.IP); err != nil {
			return err
		}
	}

	return nil
}

// checkIP dispatches to checkIPv4 or checkIPv6 based on IP version.
func checkIP(ip net.IP) error {
	if v4 := ip.To4(); v4 != nil {
		return checkIPv4(v4)
	}
	return checkIPv6(ip.To16())
}

// checkIPv4 rejects all non-public IPv4 addresses.
func checkIPv4(ip net.IP) error {
	// Ensure we're working with the 4-byte representation.
	ip = ip.To4()
	if ip == nil {
		return fmt.Errorf("無効な IPv4 アドレス")
	}

	// Loopback: 127.0.0.0/8
	if ip[0] == 127 {
		return fmt.Errorf("ループバックアドレスへのアクセスは拒否されています: %s", ip)
	}

	// Private: 10.0.0.0/8
	if ip[0] == 10 {
		return fmt.Errorf("プライベートアドレスへのアクセスは拒否されています: %s", ip)
	}

	// Private: 172.16.0.0/12
	if ip[0] == 172 && (ip[1]&0xF0) == 16 {
		return fmt.Errorf("プライベートアドレスへのアクセスは拒否されています: %s", ip)
	}

	// Private: 192.168.0.0/16
	if ip[0] == 192 && ip[1] == 168 {
		return fmt.Errorf("プライベートアドレスへのアクセスは拒否されています: %s", ip)
	}

	// Link-local: 169.254.0.0/16
	if ip[0] == 169 && ip[1] == 254 {
		return fmt.Errorf("リンクローカルアドレスへのアクセスは拒否されています: %s", ip)
	}

	// Unspecified: 0.0.0.0
	if ip.Equal(net.IPv4zero) {
		return fmt.Errorf("未指定アドレスへのアクセスは拒否されています: %s", ip)
	}

	// 0.0.0.0/8: first octet == 0
	if ip[0] == 0 {
		return fmt.Errorf("無効なアドレスへのアクセスは拒否されています: %s", ip)
	}

	// Broadcast: 255.255.255.255
	if ip[0] == 255 && ip[1] == 255 && ip[2] == 255 && ip[3] == 255 {
		return fmt.Errorf("ブロードキャストアドレスへのアクセスは拒否されています: %s", ip)
	}

	// CGNAT: 100.64.0.0/10
	if ip[0] == 100 && (ip[1]&0xC0) == 64 {
		return fmt.Errorf("CGNAT アドレスへのアクセスは拒否されています: %s", ip)
	}

	// IETF Protocol Assignments: 192.0.0.0/24
	if ip[0] == 192 && ip[1] == 0 && ip[2] == 0 {
		return fmt.Errorf("IETF プロトコル割当アドレスへのアクセスは拒否されています: %s", ip)
	}

	// Documentation: 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24
	if (ip[0] == 192 && ip[1] == 0 && ip[2] == 2) ||
		(ip[0] == 198 && ip[1] == 51 && ip[2] == 100) ||
		(ip[0] == 203 && ip[1] == 0 && ip[2] == 113) {
		return fmt.Errorf("ドキュメント用アドレスへのアクセスは拒否されています: %s", ip)
	}

	// Benchmarking: 198.18.0.0/15
	if ip[0] == 198 && (ip[1] == 18 || ip[1] == 19) {
		return fmt.Errorf("ベンチマーク用アドレスへのアクセスは拒否されています: %s", ip)
	}

	// Reserved: 240.0.0.0/4
	if ip[0] >= 240 {
		return fmt.Errorf("予約済みアドレスへのアクセスは拒否されています: %s", ip)
	}

	return nil
}

// checkIPv6 rejects all non-public IPv6 addresses.
func checkIPv6(ip net.IP) error {
	// Ensure we're working with the 16-byte representation.
	ip = ip.To16()
	if ip == nil {
		return fmt.Errorf("無効な IPv6 アドレス")
	}

	// Loopback: ::1
	if ip.Equal(net.IPv6loopback) {
		return fmt.Errorf("ループバックアドレスへのアクセスは拒否されています: %s", ip)
	}

	// Unspecified: ::
	if ip.Equal(net.IPv6unspecified) {
		return fmt.Errorf("未指定アドレスへのアクセスは拒否されています: %s", ip)
	}

	// IPv4-mapped IPv6: ::ffff:x.x.x.x
	// If To4() returns non-nil but we arrived here via checkIP (which would have
	// dispatched to checkIPv4), it means this is an IPv4-mapped IPv6 address
	// that was constructed directly as 16-byte. Check bytes 10-11 for 0xff.
	if ip[10] == 0xff && ip[11] == 0xff {
		v4 := ip[12:16]
		return checkIPv4(net.IP(v4))
	}

	// Unique local: fc00::/7
	firstTwo := (uint16(ip[0]) << 8) | uint16(ip[1])
	if (firstTwo & 0xFE00) == 0xFC00 {
		return fmt.Errorf("ユニークローカルアドレスへのアクセスは拒否されています: %s", ip)
	}

	// Link-local: fe80::/10
	if (firstTwo & 0xFFC0) == 0xFE80 {
		return fmt.Errorf("リンクローカルアドレスへのアクセスは拒否されています: %s", ip)
	}

	// Documentation: 2001:db8::/32
	nextTwo := (uint16(ip[2]) << 8) | uint16(ip[3])
	if firstTwo == 0x2001 && nextTwo == 0x0db8 {
		return fmt.Errorf("ドキュメント用アドレスへのアクセスは拒否されています: %s", ip)
	}

	return nil
}
