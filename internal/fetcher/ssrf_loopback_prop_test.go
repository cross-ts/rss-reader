//go:build !e2e

package fetcher

import (
	"net"
	"testing"

	"pgregory.net/rapid"
)

func TestProp_LoopbackRangeRejected(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		b := rapid.SliceOfN(rapid.Byte(), 3, 3).Draw(t, "tail")
		ip := net.IPv4(127, b[0], b[1], b[2])
		if checkIP(ip) == nil {
			t.Fatalf("checkIP(%v) accepted a loopback address", ip)
		}
	})
}
