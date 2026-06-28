package opmlsync

import (
	"os"
	"sync"
	"time"

	"github.com/cross-ts/rss-reader/internal/db"
	"github.com/cross-ts/rss-reader/internal/feeds"
)

// Syncer detects external changes to the OPML file by checking mtime and size,
// and reconciles the database when a change is detected.
type Syncer struct {
	db          *db.DB
	feedsPath   string
	lock        *sync.Mutex
	lastMod     time.Time
	lastSize    int64
	hasBaseline bool
}

// New creates a new Syncer that shares the given mutex with mutation handlers.
func New(database *db.DB, feedsPath string, lock *sync.Mutex) *Syncer {
	return &Syncer{
		db:        database,
		feedsPath: feedsPath,
		lock:      lock,
	}
}

// SyncIfChanged checks whether the OPML file has changed since the last
// baseline and, if so, reads and reconciles the database to match.
func (s *Syncer) SyncIfChanged() error {
	s.lock.Lock()
	defer s.lock.Unlock()

	info, err := os.Stat(s.feedsPath)
	if err != nil {
		if os.IsNotExist(err) {
			// File gone: do not wipe DB (fail-safe).
			return nil
		}
		return err
	}

	if s.hasBaseline && info.ModTime().Equal(s.lastMod) && info.Size() == s.lastSize {
		// No change detected.
		return nil
	}

	subs, err := feeds.ReadFeedsOPML(s.feedsPath)
	if err != nil {
		return err
	}
	if subs == nil {
		// File disappeared between stat and read (race). Do not update baseline.
		return nil
	}

	if err := s.applyLocked(subs); err != nil {
		return err
	}

	s.lastMod = info.ModTime()
	s.lastSize = info.Size()
	s.hasBaseline = true
	return nil
}

// MarkSynced records the current OPML file's mtime and size as the baseline,
// without performing a reconcile. Call this after the startup reconcile
// succeeds so that subsequent SyncIfChanged calls skip unnecessary work.
func (s *Syncer) MarkSynced() error {
	s.lock.Lock()
	defer s.lock.Unlock()

	info, err := os.Stat(s.feedsPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	s.lastMod = info.ModTime()
	s.lastSize = info.Size()
	s.hasBaseline = true
	return nil
}

// applyLocked converts subscriptions to DB defs and reconciles the database.
// Must be called with s.lock held.
func (s *Syncer) applyLocked(subs *feeds.Subscriptions) error {
	folderDefs := make([]db.FolderDef, len(subs.Folders))
	for i, f := range subs.Folders {
		folderDefs[i] = db.FolderDef{Name: f.Name}
	}
	feedDefs := make([]db.FeedDef, len(subs.Feeds))
	for i, f := range subs.Feeds {
		feedDefs[i] = db.FeedDef{
			Title:   f.Title,
			URL:     f.URL,
			Folder:  f.Folder,
			SiteURL: f.SiteURL,
		}
	}
	return s.db.ReconcileSubscriptions(folderDefs, feedDefs)
}
