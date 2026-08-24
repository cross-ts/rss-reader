package fetcher

import (
	"context"
	"net"
	"strings"
	"testing"
	"time"
)

// withFakeLookup temporarily replaces lookupIPAddr and returns a restore func.
func withFakeLookup(t *testing.T, fn func(ctx context.Context, host string) ([]net.IPAddr, error)) {
	t.Helper()
	orig := lookupIPAddr
	lookupIPAddr = fn
	t.Cleanup(func() {
		lookupIPAddr = orig
	})
}

// canceledContext returns a context that is already canceled, so that
// net.Dialer.DialContext fails fast with a context error instead of making
// a real network connection. This lets us verify that safeDialContext gets
// past its validation step (i.e., does not return a checkIP-style error)
// without depending on real network/DNS access in tests.
func canceledContext() context.Context {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	return ctx
}

func TestSafeDialContext_IPLiteralLoopbackRejected(t *testing.T) {
	called := false
	withFakeLookup(t, func(ctx context.Context, host string) ([]net.IPAddr, error) {
		called = true
		return nil, nil
	})

	_, err := safeDialContext(context.Background(), "tcp", "127.0.0.1:80")
	if err == nil {
		t.Fatal("expected error for loopback IP literal")
	}
	if !strings.Contains(err.Error(), "ループバック") {
		t.Errorf("unexpected error message: %v", err)
	}
	if called {
		t.Error("lookupIPAddr should not be consulted for IP literals")
	}
}

func TestSafeDialContext_IPLiteralPublicReachesDial(t *testing.T) {
	withFakeLookup(t, func(ctx context.Context, host string) ([]net.IPAddr, error) {
		t.Fatal("lookupIPAddr should not be consulted for IP literals")
		return nil, nil
	})

	// Use an already-canceled context so no real network connection is made;
	// we only assert that validation passed (no checkIP-style error) and the
	// function proceeded to the dial step.
	_, err := safeDialContext(canceledContext(), "tcp", "93.184.216.34:80")
	if err == nil {
		t.Fatal("expected a dial error due to canceled context")
	}
	if strings.Contains(err.Error(), "拒否されています") {
		t.Errorf("expected dial-level error, got validation error: %v", err)
	}
}

func TestSafeDialContext_HostnameAllPrivateRejected(t *testing.T) {
	withFakeLookup(t, func(ctx context.Context, host string) ([]net.IPAddr, error) {
		return []net.IPAddr{
			{IP: net.ParseIP("10.0.0.1")},
			{IP: net.ParseIP("192.168.1.1")},
		}, nil
	})

	_, err := safeDialContext(context.Background(), "tcp", "internal.example.com:80")
	if err == nil {
		t.Fatal("expected error for hostname resolving only to private IPs")
	}
	if !strings.Contains(err.Error(), "プライベート") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestSafeDialContext_HostnameMixedPublicPrivateRejected(t *testing.T) {
	withFakeLookup(t, func(ctx context.Context, host string) ([]net.IPAddr, error) {
		return []net.IPAddr{
			{IP: net.ParseIP("8.8.8.8")},
			{IP: net.ParseIP("10.0.0.1")},
		}, nil
	})

	_, err := safeDialContext(context.Background(), "tcp", "rebinding.example.com:80")
	if err == nil {
		t.Fatal("expected error when any resolved IP is private, even if others are public")
	}
	if !strings.Contains(err.Error(), "プライベート") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestSafeDialContext_HostnameAllPublicReachesDial(t *testing.T) {
	withFakeLookup(t, func(ctx context.Context, host string) ([]net.IPAddr, error) {
		return []net.IPAddr{
			{IP: net.ParseIP("8.8.8.8")},
			{IP: net.ParseIP("1.1.1.1")},
		}, nil
	})

	// Canceled context avoids any real network connection; we only assert
	// that validation passed and the function proceeded to dial.
	_, err := safeDialContext(canceledContext(), "tcp", "public.example.com:80")
	if err == nil {
		t.Fatal("expected a dial error due to canceled context")
	}
	if strings.Contains(err.Error(), "拒否されています") {
		t.Errorf("expected dial-level error, got validation error: %v", err)
	}
}

func TestSafeDialContext_LookupFailure(t *testing.T) {
	withFakeLookup(t, func(ctx context.Context, host string) ([]net.IPAddr, error) {
		return nil, &net.DNSError{Err: "no such host", Name: host, IsNotFound: true}
	})

	_, err := safeDialContext(context.Background(), "tcp", "nonexistent.example.com:80")
	if err == nil {
		t.Fatal("expected error for DNS lookup failure")
	}
	if !strings.Contains(err.Error(), "DNS 解決失敗") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestSafeDialContext_EmptyLookupResult(t *testing.T) {
	withFakeLookup(t, func(ctx context.Context, host string) ([]net.IPAddr, error) {
		return []net.IPAddr{}, nil
	})

	_, err := safeDialContext(context.Background(), "tcp", "empty.example.com:80")
	if err == nil {
		t.Fatal("expected error for empty DNS lookup result")
	}
	if !strings.Contains(err.Error(), "DNS 解決結果が空") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestSafeDialContext_InvalidAddr(t *testing.T) {
	_, err := safeDialContext(context.Background(), "tcp", "not-a-valid-addr")
	if err == nil {
		t.Fatal("expected error for unparseable addr")
	}
	if !strings.Contains(err.Error(), "アドレスのパースに失敗") {
		t.Errorf("unexpected error message: %v", err)
	}
}

// TestDialFirstReachable_FallsBackToSecondIP verifies that when the first IP
// in the (already-validated) list is unreachable, dialFirstReachable falls
// back to the next one instead of failing outright — restoring the
// multi-address fallback behavior that dialing a hostname directly would
// normally provide.
func TestDialFirstReachable_FallsBackToSecondIP(t *testing.T) {
	// A real listener on loopback to accept the "successful" connection.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to create listener: %v", err)
	}
	defer ln.Close()

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			conn.Close()
		}
	}()

	_, port, err := net.SplitHostPort(ln.Addr().String())
	if err != nil {
		t.Fatalf("failed to split listener addr: %v", err)
	}

	// 203.0.113.1 (TEST-NET-3, RFC 5737) is documentation-only and guaranteed
	// unroutable, so dialing it should fail fast-ish; the loopback IP is a
	// stand-in for a second, reachable resolved address. Note: checkIP would
	// reject 127.0.0.1 as loopback, but this test exercises only the dial
	// loop in isolation (post-validation), not the validation step itself.
	unreachable := net.ParseIP("203.0.113.1")
	reachable := net.ParseIP("127.0.0.1")

	dialer := &net.Dialer{Timeout: 500 * time.Millisecond}
	conn, err := dialFirstReachable(context.Background(), dialer, "tcp", []net.IP{unreachable, reachable}, port)
	if err != nil {
		t.Fatalf("expected fallback to reachable IP to succeed, got error: %v", err)
	}
	conn.Close()
}

// TestDialFirstReachable_AllFail verifies that dialFirstReachable returns an
// error (the last one encountered) when every candidate IP fails to connect.
func TestDialFirstReachable_AllFail(t *testing.T) {
	dialer := &net.Dialer{Timeout: 200 * time.Millisecond}
	ips := []net.IP{net.ParseIP("203.0.113.1"), net.ParseIP("203.0.113.2")}

	_, err := dialFirstReachable(context.Background(), dialer, "tcp", ips, "80")
	if err == nil {
		t.Fatal("expected error when all candidate IPs fail to connect")
	}
}
