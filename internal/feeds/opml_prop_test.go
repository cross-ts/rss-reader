package feeds

import (
	"bytes"
	"encoding/xml"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"pgregory.net/rapid"
)

// The alphabet includes XML-special characters on purpose; control characters
// are excluded because they are not representable in XML 1.0.
const propAlphabet = "abcXYZ019 &<>\"'-_.:ゆず"

func propText() *rapid.Generator[string] {
	return rapid.StringOfN(rapid.SampledFrom([]rune(propAlphabet)), 1, 8, -1)
}

func propFolderPath() *rapid.Generator[string] {
	return rapid.Map(rapid.SliceOfN(propText(), 1, 4), func(s []string) string {
		return strings.Join(s, "/")
	})
}

func propPath(t *rapid.T) string {
	dir, err := os.MkdirTemp("", "opmlprop")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	return filepath.Join(dir, "feeds.opml")
}

func withAncestors(paths []string) map[string]bool {
	set := map[string]bool{}
	for _, p := range paths {
		parts := strings.Split(p, "/")
		for i := range parts {
			set[strings.Join(parts[:i+1], "/")] = true
		}
	}
	return set
}

type feedKey struct {
	Title, Folder, Site, Type string
	HasFolder, HasSite        bool
}

func keyOf(f FeedEntry) feedKey {
	k := feedKey{Title: f.Title, Type: f.Type}
	if f.Folder != nil {
		k.HasFolder, k.Folder = true, *f.Folder
	}
	if f.SiteURL != nil {
		k.HasSite, k.Site = true, *f.SiteURL
	}
	return k
}

// Documented normalization: empty Type becomes "rss", empty HeadTitle becomes
// the default title, folder ancestors are synthesized, and document order is
// not preserved (feeds are grouped under their folders).
func TestProp_OPMLRoundTrip(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		folderPaths := rapid.SliceOfN(propFolderPath(), 0, 5).Draw(t, "folders")
		known := withAncestors(folderPaths)
		var knownList []string
		for p := range known {
			knownList = append(knownList, p)
		}
		slices.Sort(knownList)

		urls := rapid.SliceOfNDistinct(propText(), 0, 6, func(s string) string { return s }).Draw(t, "urls")
		want := map[string]feedKey{}
		in := &Subscriptions{HeadTitle: rapid.OneOf(rapid.Just(""), propText()).Draw(t, "head")}
		for _, p := range folderPaths {
			in.Folders = append(in.Folders, FolderEntry{Name: p})
		}
		for _, u := range urls {
			f := FeedEntry{
				Title: propText().Draw(t, "title"),
				URL:   u,
				Type:  rapid.SampledFrom([]string{"", "rss", "atom"}).Draw(t, "type"),
			}
			if len(knownList) > 0 && rapid.Bool().Draw(t, "inFolder") {
				p := rapid.SampledFrom(knownList).Draw(t, "folder")
				f.Folder = &p
			}
			if rapid.Bool().Draw(t, "hasSite") {
				s := propText().Draw(t, "site")
				f.SiteURL = &s
			}
			in.Feeds = append(in.Feeds, f)

			exp := f
			if exp.Type == "" {
				exp.Type = "rss"
			}
			want[u] = keyOf(exp)
		}

		path := propPath(t)
		if err := SaveOPML(path, in); err != nil {
			t.Fatalf("SaveOPML: %v", err)
		}
		got, err := ReadFeedsOPML(path)
		if err != nil {
			t.Fatalf("ReadFeedsOPML: %v", err)
		}

		wantHead := in.HeadTitle
		if wantHead == "" {
			wantHead = "rss-reader subscriptions"
		}
		if got.HeadTitle != wantHead {
			t.Fatalf("head title: got %q want %q", got.HeadTitle, wantHead)
		}
		if len(got.Feeds) != len(want) {
			t.Fatalf("feed count: got %d want %d", len(got.Feeds), len(want))
		}
		for _, f := range got.Feeds {
			w, ok := want[f.URL]
			if !ok {
				t.Fatalf("unexpected feed %q", f.URL)
			}
			if keyOf(f) != w {
				t.Fatalf("feed %q: got %+v want %+v", f.URL, keyOf(f), w)
			}
		}
		gotFolders := map[string]bool{}
		for _, f := range got.Folders {
			gotFolders[f.Name] = true
		}
		if len(gotFolders) != len(got.Folders) {
			t.Fatalf("duplicate folder entries: %+v", got.Folders)
		}
		if len(gotFolders) != len(known) {
			t.Fatalf("folders: got %v want %v", gotFolders, known)
		}
		for p := range known {
			if !gotFolders[p] {
				t.Fatalf("missing folder %q", p)
			}
		}
	})
}

func TestProp_OPMLDuplicateXMLURLFirstWins(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		urls := rapid.SliceOfNDistinct(propText(), 1, 4, func(s string) string { return s }).Draw(t, "urls")
		n := rapid.IntRange(1, 12).Draw(t, "n")

		var buf bytes.Buffer
		buf.WriteString(`<?xml version="1.0"?><opml version="2.0"><head><title>t</title></head><body>`)
		firstTitle := map[string]string{}
		var order []string
		for i := 0; i < n; i++ {
			u := rapid.SampledFrom(urls).Draw(t, "url")
			title := propText().Draw(t, "title")
			if _, seen := firstTitle[u]; !seen {
				firstTitle[u] = title
				order = append(order, u)
			}
			buf.WriteString(`<outline type="rss" title="`)
			_ = xml.EscapeText(&buf, []byte(title))
			buf.WriteString(`" xmlUrl="`)
			_ = xml.EscapeText(&buf, []byte(u))
			buf.WriteString(`"/>`)
		}
		buf.WriteString(`</body></opml>`)

		path := propPath(t)
		if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
			t.Fatal(err)
		}
		got, err := ReadFeedsOPML(path)
		if err != nil {
			t.Fatal(err)
		}
		if len(got.Feeds) != len(order) {
			t.Fatalf("got %d feeds, want %d unique", len(got.Feeds), len(order))
		}
		for i, f := range got.Feeds {
			if f.URL != order[i] || f.Title != firstTitle[f.URL] {
				t.Fatalf("feed %d: got (%q,%q) want (%q,%q)", i, f.URL, f.Title, order[i], firstTitle[order[i]])
			}
		}
	})
}

// An outline whose text contains "/" denotes a folder path; collectOutline
// must register every prefix, including when nested under another folder.
func TestProp_OPMLAncestorSynthesisFromSlashText(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		outer := propFolderPath().Draw(t, "outer")
		inner := propFolderPath().Draw(t, "inner")
		nested := rapid.Bool().Draw(t, "nested")

		esc := func(s string) string {
			var b bytes.Buffer
			_ = xml.EscapeText(&b, []byte(s))
			return b.String()
		}
		doc := `<opml version="2.0"><head><title>t</title></head><body><outline text="` + esc(outer) + `">`
		want := []string{outer}
		if nested {
			doc += `<outline text="` + esc(inner) + `"/>`
			want = append(want, outer+"/"+inner)
		}
		doc += `</outline></body></opml>`

		file := propPath(t)
		if err := os.WriteFile(file, []byte(doc), 0o644); err != nil {
			t.Fatal(err)
		}
		got, err := ReadFeedsOPML(file)
		if err != nil {
			t.Fatal(err)
		}
		have := map[string]bool{}
		for _, f := range got.Folders {
			have[f.Name] = true
		}
		expected := withAncestors(want)
		if len(have) != len(expected) || len(have) != len(got.Folders) {
			t.Fatalf("folders: got %v want %v", got.Folders, expected)
		}
		for p := range expected {
			if !have[p] {
				t.Fatalf("missing %q; have %v", p, have)
			}
		}
	})
}

func TestProp_OPMLAncestorSynthesis(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		paths := rapid.SliceOfN(propFolderPath(), 1, 5).Draw(t, "paths")
		in := &Subscriptions{}
		for _, p := range paths {
			in.Folders = append(in.Folders, FolderEntry{Name: p})
		}
		file := propPath(t)
		if err := SaveOPML(file, in); err != nil {
			t.Fatal(err)
		}
		got, err := ReadFeedsOPML(file)
		if err != nil {
			t.Fatal(err)
		}
		have := map[string]bool{}
		for _, f := range got.Folders {
			have[f.Name] = true
		}
		for _, p := range paths {
			parts := strings.Split(p, "/")
			for i := range parts {
				a := strings.Join(parts[:i+1], "/")
				if !have[a] {
					t.Fatalf("ancestor %q of %q missing; have %v", a, p, have)
				}
			}
		}
	})
}
