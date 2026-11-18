package fetcher

import (
	"fmt"
	"net"
	"testing"

	"pgregory.net/rapid"
)

func TestProp_NormalizeURLIdempotent(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		s := rapid.String().Draw(t, "url")
		once := NormalizeURL(s)
		if twice := NormalizeURL(once); twice != once {
			t.Fatalf("NormalizeURL(%q)=%q, but applying again gives %q", s, once, twice)
		}
	})
}

func TestProp_CheckIPv4MappedAgreement(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		b := rapid.SliceOfN(rapid.Byte(), 4, 4).Draw(t, "v4")
		v4 := net.IP(b)
		mapped := make(net.IP, net.IPv6len)
		mapped[10], mapped[11] = 0xff, 0xff
		copy(mapped[12:], b)

		want := checkIP(v4) != nil
		for name, got := range map[string]bool{
			"To16":           checkIP(v4.To16()) != nil,
			"mapped":         checkIP(mapped) != nil,
			"checkIPv6":      checkIPv6(mapped) != nil,
			"checkIPv4":      checkIPv4(v4) != nil,
			"checkIPv4(16B)": checkIPv4(mapped) != nil,
		} {
			if got != want {
				t.Fatalf("%v: %s rejected=%v, 4-byte form rejected=%v", v4, name, got, want)
			}
		}
	})
}

func privateIPv4() *rapid.Generator[net.IP] {
	return rapid.Custom(func(t *rapid.T) net.IP {
		x := rapid.IntRange(0, 255).Draw(t, "b1")
		y := rapid.IntRange(0, 255).Draw(t, "b2")
		z := rapid.IntRange(0, 255).Draw(t, "b3")
		switch rapid.IntRange(0, 2).Draw(t, "range") {
		case 0:
			return net.IPv4(10, byte(x), byte(y), byte(z))
		case 1:
			return net.IPv4(172, byte(16+x%16), byte(y), byte(z))
		default:
			return net.IPv4(192, 168, byte(y), byte(z))
		}
	})
}

func TestProp_PrivateRangesRejected(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		ip := privateIPv4().Draw(t, "ip")
		if checkIP(ip) == nil {
			t.Fatalf("checkIP(%v) accepted a private address", ip)
		}
		if ValidateFeedURLStatic(fmt.Sprintf("http://%s/feed", ip)) == nil {
			t.Fatalf("ValidateFeedURLStatic accepted private %v", ip)
		}
	})
}
