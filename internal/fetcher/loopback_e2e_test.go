//go:build e2e

package fetcher

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestE2ELoopbackAllowed(t *testing.T) {
	if err := checkIP(net.ParseIP("127.0.0.1")); err != nil {
		t.Fatalf("checkIP(127.0.0.1): %v", err)
	}
	if err := ValidateFeedURLStatic("http://127.0.0.1:8080/feed.xml"); err != nil {
		t.Fatalf("ValidateFeedURLStatic: %v", err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer srv.Close()
	conn, err := safeDialContext(context.Background(), "tcp", srv.Listener.Addr().String())
	if err != nil {
		t.Fatalf("safeDialContext to loopback listener: %v", err)
	}
	conn.Close()
}

func TestE2ENonLoopbackStillRejected(t *testing.T) {
	for _, ip := range []string{"::1", "10.0.0.1", "169.254.1.1", "::ffff:10.0.0.1", "192.168.1.1"} {
		if err := checkIP(net.ParseIP(ip)); err == nil {
			t.Errorf("checkIP(%s) accepted", ip)
		}
	}
	for _, u := range []string{"http://localhost/feed.xml", "http://[::1]/feed.xml", "http://10.0.0.1/feed.xml"} {
		if err := ValidateFeedURLStatic(u); err == nil {
			t.Errorf("ValidateFeedURLStatic(%s) accepted", u)
		}
	}
}
