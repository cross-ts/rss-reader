package fetcher

import (
	"context"
	"net"
	"strings"
	"testing"
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
