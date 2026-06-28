package fetcher

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/cross-ts/rss-reader/internal/db"
)

// testClient creates a client that can reach httptest servers through SSRF validation.
// It rewrites the test server URL to use a public IP (8.8.8.8) so ValidateFeedURL passes,
// and uses a custom transport to route connections back to the actual test server.
func testClient(servers ...*httptest.Server) (*http.Client, func(serverURL string) string) {
	// Map each server to a unique port on the fake public IP.
	addrMap := make(map[string]string) // "8.8.8.8:<port>" -> actual addr
	for _, s := range servers {
		addr := s.Listener.Addr().String()
		_, port, _ := net.SplitHostPort(addr)
		fakeAddr := "8.8.8.8:" + port
		addrMap[fakeAddr] = addr
	}

	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			if actual, ok := addrMap[addr]; ok {
				return net.Dial(network, actual)
			}
			return nil, fmt.Errorf("unexpected address: %s", addr)
		},
	}

	client := &http.Client{
		Timeout:   15 * time.Second,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	rewrite := func(serverURL string) string {
		return strings.Replace(serverURL, "127.0.0.1", "8.8.8.8", 1)
	}

	return client, rewrite
}

func TestNewFeedClient(t *testing.T) {
	client := NewFeedClient()

	if client.Timeout.Seconds() != 15 {
		t.Errorf("expected 15s timeout, got %v", client.Timeout)
	}

	if client.CheckRedirect == nil {
		t.Fatal("expected CheckRedirect to be set")
	}

	// CheckRedirect should return http.ErrUseLastResponse
	err := client.CheckRedirect(nil, nil)
	if err != http.ErrUseLastResponse {
		t.Errorf("expected http.ErrUseLastResponse, got %v", err)
	}
}

func TestNewProxyClient(t *testing.T) {
	client := NewProxyClient()

	if client.Timeout.Seconds() != 15 {
		t.Errorf("expected 15s timeout, got %v", client.Timeout)
	}

	if client.CheckRedirect != nil {
		t.Error("expected CheckRedirect to be nil for proxy client")
	}
}

func TestFetchWithGuardConditional_Success(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"abc123"`)
		w.Header().Set("Last-Modified", "Wed, 01 Jan 2025 00:00:00 GMT")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("feed content"))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	url := rewrite(ts.URL)
	result, err := FetchWithGuardConditional(client, url, 5, nil, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Outcome != FetchSuccess {
		t.Errorf("expected FetchSuccess, got %v", result.Outcome)
	}
	if string(result.Bytes) != "feed content" {
		t.Errorf("unexpected body: %q", result.Bytes)
	}
	if result.Etag == nil || *result.Etag != `"abc123"` {
		t.Errorf("unexpected etag: %v", result.Etag)
	}
	if result.LastModified == nil || *result.LastModified != "Wed, 01 Jan 2025 00:00:00 GMT" {
		t.Errorf("unexpected last-modified: %v", result.LastModified)
	}
	if result.FinalURL != url {
		t.Errorf("unexpected final URL: %q", result.FinalURL)
	}
}

func TestFetchWithGuardConditional_304NotModified(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("If-None-Match") == `"abc123"` {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("content"))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	etag := `"abc123"`
	result, err := FetchWithGuardConditional(client, rewrite(ts.URL), 5, &etag, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Outcome != FetchNotModified {
		t.Errorf("expected FetchNotModified, got %v", result.Outcome)
	}
}

func TestFetchWithGuardConditional_IfModifiedSince(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("If-Modified-Since") == "Wed, 01 Jan 2025 00:00:00 GMT" {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("content"))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	ims := "Wed, 01 Jan 2025 00:00:00 GMT"
	result, err := FetchWithGuardConditional(client, rewrite(ts.URL), 5, nil, &ims)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Outcome != FetchNotModified {
		t.Errorf("expected FetchNotModified, got %v", result.Outcome)
	}
}

func TestFetchWithGuardConditional_Redirect(t *testing.T) {
	finalServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("final content"))
	}))
	defer finalServer.Close()

	_, rewriteFinal := testClient(finalServer)
	finalURL := rewriteFinal(finalServer.URL)

	redirectServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", finalURL)
		w.WriteHeader(http.StatusMovedPermanently)
	}))
	defer redirectServer.Close()

	client, rewrite := testClient(redirectServer, finalServer)
	result, err := FetchWithGuardConditional(client, rewrite(redirectServer.URL), 5, nil, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Outcome != FetchSuccess {
		t.Errorf("expected FetchSuccess, got %v", result.Outcome)
	}
	if string(result.Bytes) != "final content" {
		t.Errorf("unexpected body: %q", result.Bytes)
	}
	if result.FinalURL != finalURL {
		t.Errorf("expected final URL %q, got %q", finalURL, result.FinalURL)
	}
}

func TestFetchWithGuardConditional_ConditionalHeadersOnlyFirstHop(t *testing.T) {
	var secondHopHeaders http.Header

	finalServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		secondHopHeaders = r.Header.Clone()
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	}))
	defer finalServer.Close()

	_, rewriteFinal := testClient(finalServer)
	finalURL := rewriteFinal(finalServer.URL)

	redirectServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify first hop has conditional headers
		if r.Header.Get("If-None-Match") != `"etag"` {
			t.Error("expected If-None-Match on first hop")
		}
		w.Header().Set("Location", finalURL)
		w.WriteHeader(http.StatusFound)
	}))
	defer redirectServer.Close()

	client, rewrite := testClient(redirectServer, finalServer)
	etag := `"etag"`
	ims := "Wed, 01 Jan 2025 00:00:00 GMT"
	_, err := FetchWithGuardConditional(client, rewrite(redirectServer.URL), 5, &etag, &ims)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Second hop should NOT have conditional headers
	if secondHopHeaders.Get("If-None-Match") != "" {
		t.Error("If-None-Match should not be on second hop")
	}
	if secondHopHeaders.Get("If-Modified-Since") != "" {
		t.Error("If-Modified-Since should not be on second hop")
	}
}

func TestFetchWithGuardConditional_MaxRedirectExceeded(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", r.URL.Path+"x")
		w.WriteHeader(http.StatusFound)
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	_, err := FetchWithGuardConditional(client, rewrite(ts.URL)+"/start", 2, nil, nil)
	if err == nil {
		t.Fatal("expected error for max redirects exceeded")
	}
	if !strings.Contains(err.Error(), "リダイレクト上限") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestFetchWithGuardConditional_RedirectMissingLocation(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusMovedPermanently)
		// No Location header
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	_, err := FetchWithGuardConditional(client, rewrite(ts.URL), 5, nil, nil)
	if err == nil {
		t.Fatal("expected error for missing Location header")
	}
	if !strings.Contains(err.Error(), "Location") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestFetchWithGuardConditional_HTTPError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	_, err := FetchWithGuardConditional(client, rewrite(ts.URL), 5, nil, nil)
	if err == nil {
		t.Fatal("expected error for 500 response")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestFetchWithGuardConditional_ContentLengthExceedsLimit(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", MaxFeedBytes+1))
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("small body"))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	_, err := FetchWithGuardConditional(client, rewrite(ts.URL), 5, nil, nil)
	if err == nil {
		t.Fatal("expected error for oversized Content-Length")
	}
	if !strings.Contains(err.Error(), "Content-Length") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestFetchWithGuardConditional_NoEtagNoLastModified(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("content"))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	result, err := FetchWithGuardConditional(client, rewrite(ts.URL), 5, nil, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Etag != nil {
		t.Error("expected nil Etag")
	}
	if result.LastModified != nil {
		t.Error("expected nil LastModified")
	}
}

func TestFetchWithGuardConditional_SSRFOnRedirect(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", "http://10.0.0.1/internal")
		w.WriteHeader(http.StatusFound)
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	_, err := FetchWithGuardConditional(client, rewrite(ts.URL), 5, nil, nil)
	if err == nil {
		t.Fatal("expected SSRF error on redirect to private IP")
	}
	if !strings.Contains(err.Error(), "SSRF") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestFetchWithGuardConditional_RelativeRedirect(t *testing.T) {
	hop := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if hop == 0 {
			hop++
			w.Header().Set("Location", "/final")
			w.WriteHeader(http.StatusFound)
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("final"))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	result, err := FetchWithGuardConditional(client, rewrite(ts.URL), 5, nil, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if string(result.Bytes) != "final" {
		t.Errorf("unexpected body: %q", result.Bytes)
	}
}

func TestFetchWithGuardConditional_UserAgent(t *testing.T) {
	var gotUA string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUA = r.Header.Get("User-Agent")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	_, err := FetchWithGuardConditional(client, rewrite(ts.URL), 5, nil, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotUA != "rss-reader/0.1" {
		t.Errorf("expected User-Agent 'rss-reader/0.1', got %q", gotUA)
	}
}

func TestFetchWithGuard_Success(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("body"))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	url := rewrite(ts.URL)
	body, finalURL, err := FetchWithGuard(client, url, 5)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if string(body) != "body" {
		t.Errorf("unexpected body: %q", body)
	}
	if finalURL != url {
		t.Errorf("unexpected final URL: %q", finalURL)
	}
}

func TestFetchWithGuard_ErrorPropagation(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	_, _, err := FetchWithGuard(client, rewrite(ts.URL), 5)
	if err == nil {
		t.Fatal("expected error")
	}
}

// validRSSFeed returns a minimal valid RSS 2.0 feed XML.
func validRSSFeed(title, link, guid, itemTitle, itemLink, author, content, pubDate string) string {
	authorXML := ""
	if author != "" {
		authorXML = fmt.Sprintf("<author>%s</author>", author)
	}
	contentXML := ""
	if content != "" {
		contentXML = fmt.Sprintf("<content:encoded>%s</content:encoded>", content)
	}
	pubDateXML := ""
	if pubDate != "" {
		pubDateXML = fmt.Sprintf("<pubDate>%s</pubDate>", pubDate)
	}
	guidXML := ""
	if guid != "" {
		guidXML = fmt.Sprintf("<guid>%s</guid>", guid)
	}
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>%s</title>
    <link>%s</link>
    <item>
      <title>%s</title>
      <link>%s</link>
      %s
      %s
      %s
      %s
    </item>
  </channel>
</rss>`, title, link, itemTitle, itemLink, guidXML, authorXML, contentXML, pubDateXML)
}

func TestFetchFeedData_Success(t *testing.T) {
	feed := validRSSFeed(
		"Test Feed", "https://example.com",
		"guid-123", "Article 1", "https://example.com/1",
		"John Doe", "<p>Hello World</p>",
		"Sat, 01 Jan 2025 12:00:00 +0000",
	)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		w.Header().Set("ETag", `"feed-etag"`)
		w.Header().Set("Last-Modified", "Wed, 01 Jan 2025 00:00:00 GMT")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(feed))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	target := &db.FeedTarget{URL: rewrite(ts.URL)}
	result, err := FetchFeedData(client, target)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}

	if len(result.Articles) != 1 {
		t.Fatalf("expected 1 article, got %d", len(result.Articles))
	}

	art := result.Articles[0]
	if art.GUID != "guid-123" {
		t.Errorf("expected GUID 'guid-123', got %q", art.GUID)
	}
	if art.Title != "Article 1" {
		t.Errorf("expected title 'Article 1', got %q", art.Title)
	}
	if art.URL != "https://example.com/1" {
		t.Errorf("expected URL 'https://example.com/1', got %q", art.URL)
	}
	if art.Author != "John Doe" {
		t.Errorf("expected author 'John Doe', got %q", art.Author)
	}
	if art.Content != "<p>Hello World</p>" {
		t.Errorf("unexpected content: %q", art.Content)
	}
	if art.PublishedAt == nil {
		t.Error("expected non-nil PublishedAt")
	}

	// Check meta
	if result.Meta == nil {
		t.Fatal("expected non-nil Meta")
	}
	if result.Meta.Etag == nil || *result.Meta.Etag != `"feed-etag"` {
		t.Errorf("unexpected etag: %v", result.Meta.Etag)
	}
	if result.Meta.LastModified == nil || *result.Meta.LastModified != "Wed, 01 Jan 2025 00:00:00 GMT" {
		t.Errorf("unexpected last-modified: %v", result.Meta.LastModified)
	}
	if result.Meta.FetchedAt == "" {
		t.Error("expected non-empty FetchedAt")
	}
}

func TestFetchFeedData_304NotModified(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotModified)
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	etag := `"old-etag"`
	target := &db.FeedTarget{URL: rewrite(ts.URL), Etag: &etag}
	result, err := FetchFeedData(client, target)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != nil {
		t.Error("expected nil result for 304")
	}
}

func TestFetchFeedData_ParseError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("this is not valid XML or RSS"))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	target := &db.FeedTarget{URL: rewrite(ts.URL)}
	_, err := FetchFeedData(client, target)
	if err == nil {
		t.Fatal("expected parse error")
	}
	if !strings.Contains(err.Error(), "パース") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestFetchFeedData_GUIDFallbackToLink(t *testing.T) {
	feed := `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test</title>
    <link>https://example.com</link>
    <item>
      <title>No GUID Article</title>
      <link>https://example.com/article</link>
    </item>
  </channel>
</rss>`

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(feed))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	target := &db.FeedTarget{URL: rewrite(ts.URL)}
	result, err := FetchFeedData(client, target)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(result.Articles) != 1 {
		t.Fatalf("expected 1 article, got %d", len(result.Articles))
	}
	if result.Articles[0].GUID != "https://example.com/article" {
		t.Errorf("expected GUID to be link URL, got %q", result.Articles[0].GUID)
	}
}

func TestFetchFeedData_GUIDFallbackToTitle(t *testing.T) {
	feed := `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test</title>
    <link>https://example.com</link>
    <item>
      <title>Title Only Article</title>
      <description>Some description</description>
    </item>
  </channel>
</rss>`

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(feed))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	target := &db.FeedTarget{URL: rewrite(ts.URL)}
	result, err := FetchFeedData(client, target)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(result.Articles) != 1 {
		t.Fatalf("expected 1 article, got %d", len(result.Articles))
	}
	if result.Articles[0].GUID != "Title Only Article" {
		t.Errorf("expected GUID to be title, got %q", result.Articles[0].GUID)
	}
}

func TestFetchFeedData_SkipItemWithNoIdentifier(t *testing.T) {
	feed := `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test</title>
    <link>https://example.com</link>
    <item>
      <description>No identifier at all</description>
    </item>
    <item>
      <title>Has Title</title>
      <link>https://example.com/valid</link>
      <guid>valid-guid</guid>
    </item>
  </channel>
</rss>`

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(feed))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	target := &db.FeedTarget{URL: rewrite(ts.URL)}
	result, err := FetchFeedData(client, target)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(result.Articles) != 1 {
		t.Fatalf("expected 1 article (skipping empty identifier), got %d", len(result.Articles))
	}
	if result.Articles[0].GUID != "valid-guid" {
		t.Errorf("expected GUID 'valid-guid', got %q", result.Articles[0].GUID)
	}
}

func TestFetchFeedData_ContentFallbackToDescription(t *testing.T) {
	feed := `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test</title>
    <link>https://example.com</link>
    <item>
      <title>Desc Only</title>
      <guid>desc-item</guid>
      <description>Description content</description>
    </item>
  </channel>
</rss>`

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(feed))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	target := &db.FeedTarget{URL: rewrite(ts.URL)}
	result, err := FetchFeedData(client, target)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(result.Articles) != 1 {
		t.Fatalf("expected 1 article, got %d", len(result.Articles))
	}
	if result.Articles[0].Content != "Description content" {
		t.Errorf("expected content to fall back to description, got %q", result.Articles[0].Content)
	}
}

func TestFetchFeedData_AtomFeed(t *testing.T) {
	feed := `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <link href="https://example.com"/>
  <updated>2025-01-01T12:00:00Z</updated>
  <entry>
    <title>Atom Entry</title>
    <id>urn:uuid:atom-entry-1</id>
    <link href="https://example.com/entry/1"/>
    <updated>2025-01-01T12:00:00Z</updated>
    <author><name>Atom Author</name></author>
    <content type="html">&lt;p&gt;Atom content&lt;/p&gt;</content>
  </entry>
</feed>`

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/atom+xml")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(feed))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	target := &db.FeedTarget{URL: rewrite(ts.URL)}
	result, err := FetchFeedData(client, target)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(result.Articles) != 1 {
		t.Fatalf("expected 1 article, got %d", len(result.Articles))
	}

	art := result.Articles[0]
	if art.GUID != "urn:uuid:atom-entry-1" {
		t.Errorf("unexpected GUID: %q", art.GUID)
	}
	if art.Author != "Atom Author" {
		t.Errorf("unexpected author: %q", art.Author)
	}
	if art.PublishedAt == nil {
		t.Error("expected PublishedAt from UpdatedParsed")
	}
}

func TestFetchFeedData_NoAuthor(t *testing.T) {
	feed := `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test</title>
    <link>https://example.com</link>
    <item>
      <title>No Author</title>
      <guid>no-author</guid>
    </item>
  </channel>
</rss>`

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(feed))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	target := &db.FeedTarget{URL: rewrite(ts.URL)}
	result, err := FetchFeedData(client, target)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Articles[0].Author != "" {
		t.Errorf("expected empty author, got %q", result.Articles[0].Author)
	}
}

func TestFetchFeedData_NoPublishedDate(t *testing.T) {
	feed := `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test</title>
    <link>https://example.com</link>
    <item>
      <title>No Date</title>
      <guid>no-date</guid>
    </item>
  </channel>
</rss>`

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(feed))
	}))
	defer ts.Close()

	client, rewrite := testClient(ts)
	target := &db.FeedTarget{URL: rewrite(ts.URL)}
	result, err := FetchFeedData(client, target)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Articles[0].PublishedAt != nil {
		t.Errorf("expected nil PublishedAt, got %v", result.Articles[0].PublishedAt)
	}
}
