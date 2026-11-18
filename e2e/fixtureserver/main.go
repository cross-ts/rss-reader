//go:build e2e

// Command fixtureserver serves static feeds on a random loopback port for E2E runs.
package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
)

//go:embed testdata
var testdata embed.FS

func main() {
	root, err := fs.Sub(testdata, "testdata")
	if err != nil {
		log.Fatal(err)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatal(err)
	}
	srv := &http.Server{Handler: http.FileServer(http.FS(root))}
	go func() {
		if err := srv.Serve(ln); err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	// stdout is unbuffered in Go, so the line is visible to the harness immediately.
	fmt.Fprintf(os.Stdout, "FIXTURE_URL=http://%s\n", ln.Addr())

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
	<-sig
	srv.Close()
}
