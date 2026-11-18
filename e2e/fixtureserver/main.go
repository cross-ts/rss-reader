//go:build e2e

// Command fixtureserver serves static feeds on a random loopback port for E2E runs.
package main

import (
	"bytes"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path"
	"strings"
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
	files := http.FileServer(http.FS(root))
	base := "http://" + ln.Addr().String()
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ext := path.Ext(r.URL.Path)
		if ext != ".xml" && ext != ".atom" && ext != ".html" {
			files.ServeHTTP(w, r)
			return
		}
		// The app stores item links verbatim and the UI rejects relative URLs, so links must be absolute.
		b, err := fs.ReadFile(root, strings.TrimPrefix(path.Clean(r.URL.Path), "/"))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", mime.TypeByExtension(ext))
		w.Write(bytes.ReplaceAll(b, []byte("{{BASE}}"), []byte(base)))
	})}
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
