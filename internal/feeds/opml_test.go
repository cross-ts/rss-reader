package feeds

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadFeedsOPML_NonExistentFile(t *testing.T) {
	subs, err := ReadFeedsOPML("/nonexistent/path/feeds.opml")
	if err != nil {
		t.Fatalf("expected nil error for non-existent file, got %v", err)
	}
	if subs != nil {
		t.Fatalf("expected nil subscriptions for non-existent file, got %+v", subs)
	}
}

func TestReadFeedsOPML_ValidOPML(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "feeds.opml")

	opml := `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body>
    <outline text="Tech" title="Tech">
      <outline text="Go Blog" title="Go Blog" type="rss" xmlUrl="https://go.dev/blog/feed.atom" htmlUrl="https://go.dev/blog"/>
      <outline text="Rust Blog" title="Rust Blog" type="rss" xmlUrl="https://blog.rust-lang.org/feed.xml"/>
    </outline>
    <outline text="Top Level Feed" title="Top Level Feed" type="rss" xmlUrl="https://example.com/feed.xml" htmlUrl="https://example.com"/>
  </body>
</opml>`

	if err := os.WriteFile(path, []byte(opml), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	subs, err := ReadFeedsOPML(path)
	if err != nil {
		t.Fatalf("ReadFeedsOPML() error: %v", err)
	}

	// Check folders
	if len(subs.Folders) != 1 {
		t.Fatalf("expected 1 folder, got %d", len(subs.Folders))
	}
	if subs.Folders[0].Name != "Tech" {
		t.Errorf("folder name = %q, want %q", subs.Folders[0].Name, "Tech")
	}

	// Check feeds
	if len(subs.Feeds) != 3 {
		t.Fatalf("expected 3 feeds, got %d", len(subs.Feeds))
	}

	// First feed: in folder with SiteURL
	f0 := subs.Feeds[0]
	if f0.Title != "Go Blog" {
		t.Errorf("feeds[0].Title = %q, want %q", f0.Title, "Go Blog")
	}
	if f0.URL != "https://go.dev/blog/feed.atom" {
		t.Errorf("feeds[0].URL = %q, want %q", f0.URL, "https://go.dev/blog/feed.atom")
	}
	if f0.Folder == nil || *f0.Folder != "Tech" {
		t.Errorf("feeds[0].Folder = %v, want *Tech", f0.Folder)
	}
	if f0.SiteURL == nil || *f0.SiteURL != "https://go.dev/blog" {
		t.Errorf("feeds[0].SiteURL = %v, want *https://go.dev/blog", f0.SiteURL)
	}

	// Second feed: in folder without SiteURL
	f1 := subs.Feeds[1]
	if f1.SiteURL != nil {
		t.Errorf("feeds[1].SiteURL = %v, want nil", f1.SiteURL)
	}
	if f1.Folder == nil || *f1.Folder != "Tech" {
		t.Errorf("feeds[1].Folder = %v, want *Tech", f1.Folder)
	}

	// Third feed: top-level
	f2 := subs.Feeds[2]
	if f2.Folder != nil {
		t.Errorf("feeds[2].Folder = %v, want nil", f2.Folder)
	}
}

func TestReadFeedsOPML_EmptyOPML(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "feeds.opml")

	opml := `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Empty</title></head>
  <body></body>
</opml>`

	if err := os.WriteFile(path, []byte(opml), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	subs, err := ReadFeedsOPML(path)
	if err != nil {
		t.Fatalf("ReadFeedsOPML() error: %v", err)
	}
	if len(subs.Feeds) != 0 {
		t.Errorf("expected 0 feeds, got %d", len(subs.Feeds))
	}
	if len(subs.Folders) != 0 {
		t.Errorf("expected 0 folders, got %d", len(subs.Folders))
	}
}

func TestReadFeedsOPML_InvalidXML(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "feeds.opml")

	if err := os.WriteFile(path, []byte("not xml at all<<<"), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	_, err := ReadFeedsOPML(path)
	if err == nil {
		t.Fatal("expected error for invalid XML, got nil")
	}
}

func TestReadFeedsOPML_Deduplication(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "feeds.opml")

	opml := `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body>
    <outline text="Feed A" type="rss" xmlUrl="https://example.com/feed.xml"/>
    <outline text="Feed B" type="rss" xmlUrl="https://example.com/feed.xml"/>
  </body>
</opml>`

	if err := os.WriteFile(path, []byte(opml), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	subs, err := ReadFeedsOPML(path)
	if err != nil {
		t.Fatalf("ReadFeedsOPML() error: %v", err)
	}

	if len(subs.Feeds) != 1 {
		t.Fatalf("expected 1 feed after dedup, got %d", len(subs.Feeds))
	}
	if subs.Feeds[0].Title != "Feed A" {
		t.Errorf("expected first-wins dedup, got title %q", subs.Feeds[0].Title)
	}
}

func TestReadFeedsOPML_NestedFolders(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "feeds.opml")

	opml := `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body>
    <outline text="Parent">
      <outline text="Child">
        <outline text="Deep Feed" type="rss" xmlUrl="https://example.com/deep.xml"/>
      </outline>
    </outline>
  </body>
</opml>`

	if err := os.WriteFile(path, []byte(opml), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	subs, err := ReadFeedsOPML(path)
	if err != nil {
		t.Fatalf("ReadFeedsOPML() error: %v", err)
	}

	if len(subs.Folders) != 2 {
		t.Fatalf("expected 2 folders, got %d", len(subs.Folders))
	}
	if len(subs.Feeds) != 1 {
		t.Fatalf("expected 1 feed, got %d", len(subs.Feeds))
	}
	// Folders should use path-based names
	wantFolders := []string{"Parent", "Parent/Child"}
	for i, wf := range wantFolders {
		if subs.Folders[i].Name != wf {
			t.Errorf("folders[%d].Name = %q, want %q", i, subs.Folders[i].Name, wf)
		}
	}
	// Feed should be in the innermost folder "Parent/Child"
	if subs.Feeds[0].Folder == nil || *subs.Feeds[0].Folder != "Parent/Child" {
		t.Errorf("feed folder = %v, want *Parent/Child", subs.Feeds[0].Folder)
	}
}

func TestReadFeedsOPML_TitlePriority(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "feeds.opml")

	opml := `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body>
    <outline title="TitleValue" text="TextValue" type="rss" xmlUrl="https://example.com/1.xml"/>
    <outline text="TextOnly" type="rss" xmlUrl="https://example.com/2.xml"/>
    <outline type="rss" xmlUrl="https://example.com/3.xml"/>
  </body>
</opml>`

	if err := os.WriteFile(path, []byte(opml), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	subs, err := ReadFeedsOPML(path)
	if err != nil {
		t.Fatalf("ReadFeedsOPML() error: %v", err)
	}

	if len(subs.Feeds) != 3 {
		t.Fatalf("expected 3 feeds, got %d", len(subs.Feeds))
	}

	tests := []struct {
		index int
		want  string
	}{
		{0, "TitleValue"},
		{1, "TextOnly"},
		{2, "https://example.com/3.xml"},
	}

	for _, tt := range tests {
		if subs.Feeds[tt.index].Title != tt.want {
			t.Errorf("feeds[%d].Title = %q, want %q", tt.index, subs.Feeds[tt.index].Title, tt.want)
		}
	}
}

func TestReadFeedsOPML_EmptyFolderName(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "feeds.opml")

	opml := `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body>
    <outline text="Parent">
      <outline text="">
        <outline text="Feed" type="rss" xmlUrl="https://example.com/feed.xml"/>
      </outline>
    </outline>
  </body>
</opml>`

	if err := os.WriteFile(path, []byte(opml), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	subs, err := ReadFeedsOPML(path)
	if err != nil {
		t.Fatalf("ReadFeedsOPML() error: %v", err)
	}

	// Empty folder name should inherit parent's folder
	if len(subs.Feeds) != 1 {
		t.Fatalf("expected 1 feed, got %d", len(subs.Feeds))
	}
	if subs.Feeds[0].Folder == nil || *subs.Feeds[0].Folder != "Parent" {
		t.Errorf("feed folder = %v, want *Parent (inherited from parent)", subs.Feeds[0].Folder)
	}
}

func TestReadFeedsOPML_DuplicateFolderNames(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "feeds.opml")

	opml := `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body>
    <outline text="Tech">
      <outline text="Feed 1" type="rss" xmlUrl="https://example.com/1.xml"/>
    </outline>
    <outline text="Tech">
      <outline text="Feed 2" type="rss" xmlUrl="https://example.com/2.xml"/>
    </outline>
  </body>
</opml>`

	if err := os.WriteFile(path, []byte(opml), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	subs, err := ReadFeedsOPML(path)
	if err != nil {
		t.Fatalf("ReadFeedsOPML() error: %v", err)
	}

	// Duplicate folder names should be deduplicated
	if len(subs.Folders) != 1 {
		t.Fatalf("expected 1 folder after dedup, got %d", len(subs.Folders))
	}
	if len(subs.Feeds) != 2 {
		t.Fatalf("expected 2 feeds, got %d", len(subs.Feeds))
	}
}

func TestSaveOPML_RoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "feeds.opml")

	folder := "News"
	siteURL := "https://example.com"
	original := &Subscriptions{
		Folders: []FolderEntry{{Name: "News"}},
		Feeds: []FeedEntry{
			{
				Title:   "Example Feed",
				URL:     "https://example.com/feed.xml",
				Folder:  &folder,
				SiteURL: &siteURL,
			},
			{
				Title:  "Top Level",
				URL:    "https://toplevel.com/rss",
				Folder: nil,
			},
		},
	}

	if err := SaveOPML(path, original); err != nil {
		t.Fatalf("SaveOPML() error: %v", err)
	}

	// Verify the file was created
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected file to exist at %s", path)
	}

	// Read it back
	loaded, err := ReadFeedsOPML(path)
	if err != nil {
		t.Fatalf("ReadFeedsOPML() error: %v", err)
	}

	// Verify folders
	if len(loaded.Folders) != 1 {
		t.Fatalf("round-trip: expected 1 folder, got %d", len(loaded.Folders))
	}
	if loaded.Folders[0].Name != "News" {
		t.Errorf("round-trip: folder name = %q, want %q", loaded.Folders[0].Name, "News")
	}

	// Verify feeds
	if len(loaded.Feeds) != 2 {
		t.Fatalf("round-trip: expected 2 feeds, got %d", len(loaded.Feeds))
	}

	// Feed in folder
	if loaded.Feeds[0].Title != "Example Feed" {
		t.Errorf("round-trip: feeds[0].Title = %q, want %q", loaded.Feeds[0].Title, "Example Feed")
	}
	if loaded.Feeds[0].URL != "https://example.com/feed.xml" {
		t.Errorf("round-trip: feeds[0].URL = %q, want %q", loaded.Feeds[0].URL, "https://example.com/feed.xml")
	}
	if loaded.Feeds[0].Folder == nil || *loaded.Feeds[0].Folder != "News" {
		t.Errorf("round-trip: feeds[0].Folder = %v, want *News", loaded.Feeds[0].Folder)
	}
	if loaded.Feeds[0].SiteURL == nil || *loaded.Feeds[0].SiteURL != "https://example.com" {
		t.Errorf("round-trip: feeds[0].SiteURL = %v, want *https://example.com", loaded.Feeds[0].SiteURL)
	}

	// Top-level feed
	if loaded.Feeds[1].Folder != nil {
		t.Errorf("round-trip: feeds[1].Folder = %v, want nil", loaded.Feeds[1].Folder)
	}
}

func TestSaveOPML_EmptySubscriptions(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "feeds.opml")

	subs := &Subscriptions{}
	if err := SaveOPML(path, subs); err != nil {
		t.Fatalf("SaveOPML() error: %v", err)
	}

	loaded, err := ReadFeedsOPML(path)
	if err != nil {
		t.Fatalf("ReadFeedsOPML() error: %v", err)
	}
	if len(loaded.Feeds) != 0 {
		t.Errorf("expected 0 feeds, got %d", len(loaded.Feeds))
	}
	if len(loaded.Folders) != 0 {
		t.Errorf("expected 0 folders, got %d", len(loaded.Folders))
	}
}

func TestBuildOPML_FeedsInFolders(t *testing.T) {
	folder := "Tech"
	subs := &Subscriptions{
		Folders: []FolderEntry{{Name: "Tech"}},
		Feeds: []FeedEntry{
			{Title: "Go Blog", URL: "https://go.dev/feed", Folder: &folder},
		},
	}

	doc := BuildOPML(subs)

	if doc.Version != "2.0" {
		t.Errorf("version = %q, want %q", doc.Version, "2.0")
	}
	if len(doc.Body.Outlines) != 1 {
		t.Fatalf("expected 1 top-level outline, got %d", len(doc.Body.Outlines))
	}
	folderOutline := doc.Body.Outlines[0]
	if folderOutline.Text != "Tech" {
		t.Errorf("folder text = %q, want %q", folderOutline.Text, "Tech")
	}
	if len(folderOutline.Outlines) != 1 {
		t.Fatalf("expected 1 feed in folder, got %d", len(folderOutline.Outlines))
	}
	if folderOutline.Outlines[0].XMLURL != "https://go.dev/feed" {
		t.Errorf("feed xmlUrl = %q, want %q", folderOutline.Outlines[0].XMLURL, "https://go.dev/feed")
	}
}

func TestBuildOPML_TopLevelFeeds(t *testing.T) {
	subs := &Subscriptions{
		Feeds: []FeedEntry{
			{Title: "Top Feed", URL: "https://example.com/feed"},
		},
	}

	doc := BuildOPML(subs)

	if len(doc.Body.Outlines) != 1 {
		t.Fatalf("expected 1 outline, got %d", len(doc.Body.Outlines))
	}
	if doc.Body.Outlines[0].XMLURL != "https://example.com/feed" {
		t.Errorf("feed xmlUrl = %q, want %q", doc.Body.Outlines[0].XMLURL, "https://example.com/feed")
	}
	if doc.Body.Outlines[0].Type != "rss" {
		t.Errorf("feed type = %q, want %q", doc.Body.Outlines[0].Type, "rss")
	}
}

func TestBuildOPML_EmptySubscriptions(t *testing.T) {
	subs := &Subscriptions{}
	doc := BuildOPML(subs)

	if len(doc.Body.Outlines) != 0 {
		t.Errorf("expected 0 outlines, got %d", len(doc.Body.Outlines))
	}
}

func TestBuildOPML_FeedWithUnknownFolder(t *testing.T) {
	unknownFolder := "Unknown"
	subs := &Subscriptions{
		Folders: []FolderEntry{{Name: "Tech"}},
		Feeds: []FeedEntry{
			{Title: "Orphan", URL: "https://example.com/orphan", Folder: &unknownFolder},
		},
	}

	doc := BuildOPML(subs)

	// Feed with unknown folder should go to top-level
	// Folder "Tech" is empty, plus the orphan feed at top level
	if len(doc.Body.Outlines) != 2 {
		t.Fatalf("expected 2 outlines (empty folder + top-level feed), got %d", len(doc.Body.Outlines))
	}
	// First outline is the empty Tech folder
	if doc.Body.Outlines[0].Text != "Tech" {
		t.Errorf("first outline text = %q, want %q", doc.Body.Outlines[0].Text, "Tech")
	}
	// Second is the orphaned feed
	if doc.Body.Outlines[1].XMLURL != "https://example.com/orphan" {
		t.Errorf("second outline xmlUrl = %q, want orphan feed", doc.Body.Outlines[1].XMLURL)
	}
}

func TestFeedToOutline_WithSiteURL(t *testing.T) {
	siteURL := "https://example.com"
	feed := &FeedEntry{
		Title:   "Test Feed",
		URL:     "https://example.com/feed.xml",
		SiteURL: &siteURL,
		Type:    "rss",
	}

	outline := feedToOutline(feed)

	if outline.Text != "Test Feed" {
		t.Errorf("Text = %q, want %q", outline.Text, "Test Feed")
	}
	if outline.Title != "Test Feed" {
		t.Errorf("Title = %q, want %q", outline.Title, "Test Feed")
	}
	if outline.Type != "rss" {
		t.Errorf("Type = %q, want %q", outline.Type, "rss")
	}
	if outline.XMLURL != "https://example.com/feed.xml" {
		t.Errorf("XMLURL = %q, want %q", outline.XMLURL, "https://example.com/feed.xml")
	}
	if outline.HTMLURL != "https://example.com" {
		t.Errorf("HTMLURL = %q, want %q", outline.HTMLURL, "https://example.com")
	}
}

func TestFeedToOutline_WithoutSiteURL(t *testing.T) {
	feed := &FeedEntry{
		Title: "Test Feed",
		URL:   "https://example.com/feed.xml",
		Type:  "rss",
	}

	outline := feedToOutline(feed)

	if outline.HTMLURL != "" {
		t.Errorf("HTMLURL = %q, want empty string", outline.HTMLURL)
	}
}

func TestFeedToOutline_AtomTypePreserved(t *testing.T) {
	feed := &FeedEntry{
		Title: "Atom Feed",
		URL:   "https://example.com/feed.atom",
		Type:  "atom",
	}

	outline := feedToOutline(feed)

	if outline.Type != "atom" {
		t.Errorf("Type = %q, want %q", outline.Type, "atom")
	}
}

func TestFeedToOutline_EmptyTypeDefaultsToRSS(t *testing.T) {
	feed := &FeedEntry{
		Title: "No Type Feed",
		URL:   "https://example.com/feed.xml",
		Type:  "",
	}

	outline := feedToOutline(feed)

	if outline.Type != "rss" {
		t.Errorf("Type = %q, want %q", outline.Type, "rss")
	}
}

func TestReadFeedsOPML_AtomTypePreserved(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "feeds.opml")

	opml := `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body>
    <outline text="Atom Feed" title="Atom Feed" type="atom" xmlUrl="https://example.com/feed.atom"/>
    <outline text="RSS Feed" title="RSS Feed" type="rss" xmlUrl="https://example.com/feed.xml"/>
  </body>
</opml>`

	if err := os.WriteFile(path, []byte(opml), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	subs, err := ReadFeedsOPML(path)
	if err != nil {
		t.Fatalf("ReadFeedsOPML() error: %v", err)
	}

	if len(subs.Feeds) != 2 {
		t.Fatalf("expected 2 feeds, got %d", len(subs.Feeds))
	}
	if subs.Feeds[0].Type != "atom" {
		t.Errorf("feeds[0].Type = %q, want %q", subs.Feeds[0].Type, "atom")
	}
	if subs.Feeds[1].Type != "rss" {
		t.Errorf("feeds[1].Type = %q, want %q", subs.Feeds[1].Type, "rss")
	}
}

func TestReadFeedsOPML_EmptyTypeDefaultsToRSS(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "feeds.opml")

	opml := `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body>
    <outline text="No Type Feed" xmlUrl="https://example.com/feed.xml"/>
  </body>
</opml>`

	if err := os.WriteFile(path, []byte(opml), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	subs, err := ReadFeedsOPML(path)
	if err != nil {
		t.Fatalf("ReadFeedsOPML() error: %v", err)
	}

	if len(subs.Feeds) != 1 {
		t.Fatalf("expected 1 feed, got %d", len(subs.Feeds))
	}
	if subs.Feeds[0].Type != "rss" {
		t.Errorf("feeds[0].Type = %q, want %q", subs.Feeds[0].Type, "rss")
	}
}

func TestBuildOPML_MultipleFolders(t *testing.T) {
	tech := "Tech"
	news := "News"
	subs := &Subscriptions{
		Folders: []FolderEntry{
			{Name: "Tech"},
			{Name: "News"},
		},
		Feeds: []FeedEntry{
			{Title: "Go Blog", URL: "https://go.dev/feed", Folder: &tech},
			{Title: "BBC", URL: "https://bbc.com/feed", Folder: &news},
			{Title: "Top", URL: "https://top.com/feed"},
		},
	}

	doc := BuildOPML(subs)

	// 2 folders + 1 top-level feed
	if len(doc.Body.Outlines) != 3 {
		t.Fatalf("expected 3 outlines, got %d", len(doc.Body.Outlines))
	}

	// Folders come first, in definition order
	if doc.Body.Outlines[0].Text != "Tech" {
		t.Errorf("outline[0].Text = %q, want Tech", doc.Body.Outlines[0].Text)
	}
	if doc.Body.Outlines[1].Text != "News" {
		t.Errorf("outline[1].Text = %q, want News", doc.Body.Outlines[1].Text)
	}
	// Top-level feed last
	if doc.Body.Outlines[2].XMLURL != "https://top.com/feed" {
		t.Errorf("outline[2].XMLURL = %q, want top-level feed", doc.Body.Outlines[2].XMLURL)
	}
}

func TestSaveOPML_NestedRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "feeds.opml")

	techGo := "Tech/Go"
	original := &Subscriptions{
		Folders: []FolderEntry{{Name: "Tech"}, {Name: "Tech/Go"}},
		Feeds: []FeedEntry{
			{Title: "Go Blog", URL: "https://go.dev/feed", Folder: &techGo},
		},
	}

	if err := SaveOPML(path, original); err != nil {
		t.Fatalf("SaveOPML() error: %v", err)
	}

	// Verify raw XML contains nested outlines
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}
	xmlStr := string(raw)
	// Should have Tech > Go > feed nesting, not a flat "Tech/Go" folder
	if !strings.Contains(xmlStr, `text="Tech"`) {
		t.Error("expected XML to contain outline with text=\"Tech\"")
	}
	if !strings.Contains(xmlStr, `text="Go"`) {
		t.Error("expected XML to contain outline with text=\"Go\"")
	}

	// Read back
	loaded, err := ReadFeedsOPML(path)
	if err != nil {
		t.Fatalf("ReadFeedsOPML() error: %v", err)
	}

	// Verify folders
	wantFolders := []string{"Tech", "Tech/Go"}
	if len(loaded.Folders) != len(wantFolders) {
		t.Fatalf("round-trip: expected %d folders, got %d", len(wantFolders), len(loaded.Folders))
	}
	for i, wf := range wantFolders {
		if loaded.Folders[i].Name != wf {
			t.Errorf("round-trip: folders[%d].Name = %q, want %q", i, loaded.Folders[i].Name, wf)
		}
	}

	// Verify feed
	if len(loaded.Feeds) != 1 {
		t.Fatalf("round-trip: expected 1 feed, got %d", len(loaded.Feeds))
	}
	if loaded.Feeds[0].Folder == nil || *loaded.Feeds[0].Folder != "Tech/Go" {
		t.Errorf("round-trip: feed folder = %v, want *Tech/Go", loaded.Feeds[0].Folder)
	}
}

func TestBuildOPML_NestedFolders(t *testing.T) {
	tech := "Tech"
	techGo := "Tech/Go"
	techRust := "Tech/Rust"
	subs := &Subscriptions{
		Folders: []FolderEntry{
			{Name: "Tech"},
			{Name: "Tech/Go"},
			{Name: "Tech/Rust"},
		},
		Feeds: []FeedEntry{
			{Title: "Tech News", URL: "https://tech.com/feed", Folder: &tech},
			{Title: "Go Blog", URL: "https://go.dev/feed", Folder: &techGo},
			{Title: "Rust Blog", URL: "https://rust-lang.org/feed", Folder: &techRust},
		},
	}

	doc := BuildOPML(subs)

	// Should have 1 top-level outline: "Tech"
	if len(doc.Body.Outlines) != 1 {
		t.Fatalf("expected 1 top-level outline, got %d", len(doc.Body.Outlines))
	}

	techOutline := doc.Body.Outlines[0]
	if techOutline.Text != "Tech" {
		t.Errorf("top-level outline text = %q, want Tech", techOutline.Text)
	}

	// Tech should have 2 child outlines (Go, Rust) + 1 feed
	// Children come first, then feeds
	if len(techOutline.Outlines) != 3 {
		t.Fatalf("expected 3 outlines under Tech (Go + Rust + feed), got %d", len(techOutline.Outlines))
	}

	// Child folders
	if techOutline.Outlines[0].Text != "Go" {
		t.Errorf("Tech child[0].Text = %q, want Go", techOutline.Outlines[0].Text)
	}
	if techOutline.Outlines[1].Text != "Rust" {
		t.Errorf("Tech child[1].Text = %q, want Rust", techOutline.Outlines[1].Text)
	}

	// Go should have 1 feed
	if len(techOutline.Outlines[0].Outlines) != 1 {
		t.Fatalf("expected 1 feed under Go, got %d", len(techOutline.Outlines[0].Outlines))
	}
	if techOutline.Outlines[0].Outlines[0].XMLURL != "https://go.dev/feed" {
		t.Errorf("Go feed URL = %q, want https://go.dev/feed", techOutline.Outlines[0].Outlines[0].XMLURL)
	}

	// Rust should have 1 feed
	if len(techOutline.Outlines[1].Outlines) != 1 {
		t.Fatalf("expected 1 feed under Rust, got %d", len(techOutline.Outlines[1].Outlines))
	}
	if techOutline.Outlines[1].Outlines[0].XMLURL != "https://rust-lang.org/feed" {
		t.Errorf("Rust feed URL = %q, want https://rust-lang.org/feed", techOutline.Outlines[1].Outlines[0].XMLURL)
	}

	// Tech direct feed
	if techOutline.Outlines[2].XMLURL != "https://tech.com/feed" {
		t.Errorf("Tech direct feed URL = %q, want https://tech.com/feed", techOutline.Outlines[2].XMLURL)
	}
}

func TestBuildOPML_EmptyIntermediateFolder(t *testing.T) {
	abc := "A/B/C"
	subs := &Subscriptions{
		Folders: []FolderEntry{
			{Name: "A"},
			{Name: "A/B"},
			{Name: "A/B/C"},
		},
		Feeds: []FeedEntry{
			{Title: "Deep Feed", URL: "https://example.com/deep.xml", Folder: &abc},
		},
	}

	doc := BuildOPML(subs)

	// Should have 1 top-level outline: "A"
	if len(doc.Body.Outlines) != 1 {
		t.Fatalf("expected 1 top-level outline, got %d", len(doc.Body.Outlines))
	}

	aOutline := doc.Body.Outlines[0]
	if aOutline.Text != "A" {
		t.Errorf("top-level outline text = %q, want A", aOutline.Text)
	}

	// A has 1 child: B
	if len(aOutline.Outlines) != 1 {
		t.Fatalf("expected 1 child under A, got %d", len(aOutline.Outlines))
	}
	bOutline := aOutline.Outlines[0]
	if bOutline.Text != "B" {
		t.Errorf("A child text = %q, want B", bOutline.Text)
	}

	// B has 1 child: C
	if len(bOutline.Outlines) != 1 {
		t.Fatalf("expected 1 child under B, got %d", len(bOutline.Outlines))
	}
	cOutline := bOutline.Outlines[0]
	if cOutline.Text != "C" {
		t.Errorf("B child text = %q, want C", cOutline.Text)
	}

	// C has the feed
	if len(cOutline.Outlines) != 1 {
		t.Fatalf("expected 1 feed under C, got %d", len(cOutline.Outlines))
	}
	if cOutline.Outlines[0].XMLURL != "https://example.com/deep.xml" {
		t.Errorf("feed URL = %q, want https://example.com/deep.xml", cOutline.Outlines[0].XMLURL)
	}
}

func TestReadFeedsOPML_DeeplyNested(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "feeds.opml")

	opml := `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body>
    <outline text="A">
      <outline text="B">
        <outline text="C">
          <outline text="Deep Feed" type="rss" xmlUrl="https://example.com/deep.xml"/>
        </outline>
      </outline>
    </outline>
  </body>
</opml>`

	if err := os.WriteFile(path, []byte(opml), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	subs, err := ReadFeedsOPML(path)
	if err != nil {
		t.Fatalf("ReadFeedsOPML() error: %v", err)
	}

	// Should have 3 folders with path-based names
	wantFolders := []string{"A", "A/B", "A/B/C"}
	if len(subs.Folders) != len(wantFolders) {
		t.Fatalf("expected %d folders, got %d", len(wantFolders), len(subs.Folders))
	}
	for i, wf := range wantFolders {
		if subs.Folders[i].Name != wf {
			t.Errorf("folders[%d].Name = %q, want %q", i, subs.Folders[i].Name, wf)
		}
	}

	// Feed should be in "A/B/C"
	if len(subs.Feeds) != 1 {
		t.Fatalf("expected 1 feed, got %d", len(subs.Feeds))
	}
	if subs.Feeds[0].Folder == nil || *subs.Feeds[0].Folder != "A/B/C" {
		t.Errorf("feed folder = %v, want *A/B/C", subs.Feeds[0].Folder)
	}
}
