//go:build e2e

package fetcher

// Only the e2e fixture server lives on loopback; never make this a runtime flag.
const allowLoopback = true
