package feeds

import (
	"encoding/xml"
	"os"
	"path/filepath"
	"strings"
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
	Folders   []FolderEntry
	Feeds     []FeedEntry
	HeadTitle string // preserved from the original OPML head/title element
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
// folder is the full path of the parent folder (e.g. "A/B"), nil if top-level.
func collectOutline(outline *opmlOutline, folder *string, subs *Subscriptions) {
	if outline.XMLURL != "" {
		for i := range subs.Feeds {
			if subs.Feeds[i].URL == outline.XMLURL {
				return
			}
		}

		title := outline.Title
		if title == "" {
			title = outline.Text
		}
		if title == "" {
			title = outline.XMLURL
		}

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

	var fullPath *string
	if outline.Text != "" {
		var p string
		if folder != nil {
			p = *folder + "/" + outline.Text
		} else {
			p = outline.Text
		}
		fullPath = &p

		// Register all ancestor paths as FolderEntry entries.
		parts := strings.Split(p, "/")
		for i := range parts {
			ancestor := strings.Join(parts[:i+1], "/")
			found := false
			for j := range subs.Folders {
				if subs.Folders[j].Name == ancestor {
					found = true
					break
				}
			}
			if !found {
				subs.Folders = append(subs.Folders, FolderEntry{Name: ancestor})
			}
		}
	} else {
		fullPath = folder
	}

	for i := range outline.Outlines {
		collectOutline(&outline.Outlines[i], fullPath, subs)
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

type folderNode struct {
	name     string
	children []*folderNode
	feeds    []opmlOutline
}

func (n *folderNode) toOutline() opmlOutline {
	o := opmlOutline{Text: n.name, Title: n.name}
	for _, child := range n.children {
		o.Outlines = append(o.Outlines, child.toOutline())
	}
	o.Outlines = append(o.Outlines, n.feeds...)
	return o
}

// BuildOPML creates an OPML 2.0 document from Subscriptions.
func BuildOPML(subs *Subscriptions) opmlDoc {
	title := subs.HeadTitle
	if title == "" {
		title = "rss-reader subscriptions"
	}
	doc := opmlDoc{
		Version: "2.0",
		Head:    opmlHead{Title: title},
	}

	root := &folderNode{}
	nodeMap := map[string]*folderNode{}

	for _, f := range subs.Folders {
		parts := strings.Split(f.Name, "/")
		for i := range parts {
			path := strings.Join(parts[:i+1], "/")
			if _, exists := nodeMap[path]; exists {
				continue
			}
			node := &folderNode{name: parts[i]}
			nodeMap[path] = node
			if i == 0 {
				root.children = append(root.children, node)
			} else {
				parentPath := strings.Join(parts[:i], "/")
				parent := nodeMap[parentPath]
				parent.children = append(parent.children, node)
			}
		}
	}

	var topLevel []opmlOutline
	for i := range subs.Feeds {
		feed := &subs.Feeds[i]
		outline := feedToOutline(feed)
		if feed.Folder != nil {
			if node, ok := nodeMap[*feed.Folder]; ok {
				node.feeds = append(node.feeds, outline)
				continue
			}
		}
		topLevel = append(topLevel, outline)
	}

	for _, child := range root.children {
		doc.Body.Outlines = append(doc.Body.Outlines, child.toOutline())
	}
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

	subs := &Subscriptions{HeadTitle: doc.Head.Title}
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
