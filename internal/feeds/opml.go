package feeds

import (
	"encoding/xml"
	"os"
	"path/filepath"
)

// FeedEntry represents a single feed subscription from OPML.
type FeedEntry struct {
	Title   string
	URL     string  // xmlUrl
	Folder  *string // parent folder name, nil if top-level
	SiteURL *string // htmlUrl, nullable
	Type    string  // OPML type attribute (e.g. "rss", "atom")
}

// FolderEntry represents a folder from OPML.
type FolderEntry struct {
	Name string
}

// Subscriptions is the parsed internal representation of feeds.opml.
type Subscriptions struct {
	Folders []FolderEntry
	Feeds   []FeedEntry
}

// XML structures for OPML parsing/writing.

type opmlDoc struct {
	XMLName xml.Name `xml:"opml"`
	Version string   `xml:"version,attr"`
	Head    opmlHead `xml:"head"`
	Body    opmlBody `xml:"body"`
}

type opmlHead struct {
	Title string `xml:"title"`
}

type opmlBody struct {
	Outlines []opmlOutline `xml:"outline"`
}

type opmlOutline struct {
	Text     string        `xml:"text,attr"`
	Title    string        `xml:"title,attr,omitempty"`
	Type     string        `xml:"type,attr,omitempty"`
	XMLURL   string        `xml:"xmlUrl,attr,omitempty"`
	HTMLURL  string        `xml:"htmlUrl,attr,omitempty"`
	Outlines []opmlOutline `xml:"outline,omitempty"`
}

// collectOutline recursively processes an opmlOutline and populates subs.
func collectOutline(outline *opmlOutline, folder *string, subs *Subscriptions) {
	if outline.XMLURL != "" {
		// It's a feed entry. Deduplicate by URL (first wins).
		for i := range subs.Feeds {
			if subs.Feeds[i].URL == outline.XMLURL {
				return
			}
		}

		// Determine title: prefer Title, then Text, then xmlUrl.
		title := outline.Title
		if title == "" {
			title = outline.Text
		}
		if title == "" {
			title = outline.XMLURL
		}

		// SiteURL: htmlUrl if non-empty, else nil.
		var siteURL *string
		if outline.HTMLURL != "" {
			s := outline.HTMLURL
			siteURL = &s
		}

		feedType := outline.Type
		if feedType == "" {
			feedType = "rss"
		}

		subs.Feeds = append(subs.Feeds, FeedEntry{
			Title:   title,
			URL:     outline.XMLURL,
			Folder:  folder,
			SiteURL: siteURL,
			Type:    feedType,
		})
		return
	}

	// It's a folder.
	var folderName *string
	if outline.Text != "" {
		// Add to folder list if not already present.
		found := false
		for i := range subs.Folders {
			if subs.Folders[i].Name == outline.Text {
				found = true
				break
			}
		}
		if !found {
			subs.Folders = append(subs.Folders, FolderEntry{Name: outline.Text})
		}
		s := outline.Text
		folderName = &s
	} else {
		// Empty name: inherit parent's folder.
		folderName = folder
	}

	// Recurse into children.
	for i := range outline.Outlines {
		collectOutline(&outline.Outlines[i], folderName, subs)
	}
}

// feedToOutline converts a FeedEntry to an opmlOutline.
func feedToOutline(feed *FeedEntry) opmlOutline {
	htmlURL := ""
	if feed.SiteURL != nil {
		htmlURL = *feed.SiteURL
	}
	feedType := feed.Type
	if feedType == "" {
		feedType = "rss"
	}
	return opmlOutline{
		Text:    feed.Title,
		Title:   feed.Title,
		Type:    feedType,
		XMLURL:  feed.URL,
		HTMLURL: htmlURL,
	}
}

// BuildOPML creates an OPML 2.0 document from Subscriptions.
func BuildOPML(subs *Subscriptions) opmlDoc {
	doc := opmlDoc{
		Version: "2.0",
		Head:    opmlHead{Title: "rss-reader subscriptions"},
	}

	// Build a set of known folder names for quick lookup.
	knownFolders := make(map[string]struct{}, len(subs.Folders))
	for _, f := range subs.Folders {
		knownFolders[f.Name] = struct{}{}
	}

	// Group feeds by folder.
	folderFeeds := make(map[string][]opmlOutline)
	var topLevel []opmlOutline

	for i := range subs.Feeds {
		feed := &subs.Feeds[i]
		outline := feedToOutline(feed)
		if feed.Folder != nil {
			if _, ok := knownFolders[*feed.Folder]; ok {
				folderFeeds[*feed.Folder] = append(folderFeeds[*feed.Folder], outline)
				continue
			}
		}
		topLevel = append(topLevel, outline)
	}

	// Add folder outlines (in definition order), each containing its feeds.
	for _, f := range subs.Folders {
		folderOutline := opmlOutline{
			Text:     f.Name,
			Title:    f.Name,
			Outlines: folderFeeds[f.Name],
		}
		doc.Body.Outlines = append(doc.Body.Outlines, folderOutline)
	}

	// Add top-level feeds.
	doc.Body.Outlines = append(doc.Body.Outlines, topLevel...)

	return doc
}

// ReadFeedsOPML reads and parses an OPML file into Subscriptions.
// If the file does not exist, it returns (nil, nil).
func ReadFeedsOPML(path string) (*Subscriptions, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var doc opmlDoc
	if err := xml.Unmarshal(data, &doc); err != nil {
		return nil, err
	}

	subs := &Subscriptions{}
	for i := range doc.Body.Outlines {
		collectOutline(&doc.Body.Outlines[i], nil, subs)
	}

	return subs, nil
}

// SaveOPML atomically writes Subscriptions as an OPML file.
func SaveOPML(path string, subs *Subscriptions) error {
	doc := BuildOPML(subs)

	data, err := xml.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}

	content := []byte("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
	content = append(content, data...)

	tmpPath := path + ".tmp"

	if err := writeAndSync(tmpPath, content); err != nil {
		os.Remove(tmpPath)
		return err
	}

	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
		return err
	}

	// Best-effort sync parent directory.
	syncDir(filepath.Dir(path))

	return nil
}

// writeAndSync writes data to a file and fsyncs it.
func writeAndSync(path string, data []byte) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	if _, err := f.Write(data); err != nil {
		return err
	}

	return f.Sync()
}

// syncDir performs a best-effort fsync on a directory.
func syncDir(dir string) {
	f, err := os.Open(dir)
	if err != nil {
		return
	}
	defer f.Close()
	_ = f.Sync()
}
