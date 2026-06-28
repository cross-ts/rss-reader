package opmlsync

import (
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/cross-ts/rss-reader/internal/db"
	"github.com/cross-ts/rss-reader/internal/feeds"
)

type baseline struct {
	mod  time.Time
	size int64
	set  bool
}

// Syncer detects external changes to the OPML file by checking mtime and size,
// and reconciles the database when a change is detected.
type Syncer struct {
	db        *db.DB
	feedsPath string
	lock      *sync.Mutex
	base      atomic.Pointer[baseline]
}

// New creates a new Syncer that shares the given mutex with mutation handlers.
func New(database *db.DB, feedsPath string, lock *sync.Mutex) *Syncer {
	s := &Syncer{
		db:        database,
		feedsPath: feedsPath,
		lock:      lock,
	}
	s.base.Store(&baseline{})
	return s
}

// SyncIfChanged checks whether the OPML file has changed since the last
// baseline and, if so, reads and reconciles the database to match.
func (s *Syncer) SyncIfChanged() error {
	info, err := os.Stat(s.feedsPath)
	if err != nil {
		if os.IsNotExist(err) {
			s.base.Store(&baseline{})
			return nil
		}
		return err
	}

	b := s.base.Load()
	if b.set && info.ModTime().Equal(b.mod) && info.Size() == b.size {
		return nil
	}

	s.lock.Lock()
	defer s.lock.Unlock()

	// Re-stat and re-check under lock to avoid redundant reconcile.
	info, err = os.Stat(s.feedsPath)
	if err != nil {
		if os.IsNotExist(err) {
			s.base.Store(&baseline{})
			return nil
		}
		return err
	}

	b = s.base.Load()
	if b.set && info.ModTime().Equal(b.mod) && info.Size() == b.size {
		return nil
	}

	subs, err := feeds.ReadFeedsOPML(s.feedsPath)
	if err != nil {
		return err
	}
	if subs == nil {
		s.base.Store(&baseline{})
		return nil
	}

	if err := s.reconcile(subs); err != nil {
		return err
	}

	s.base.Store(&baseline{mod: info.ModTime(), size: info.Size(), set: true})
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
			s.base.Store(&baseline{})
			return nil
		}
		return err
	}

	s.base.Store(&baseline{mod: info.ModTime(), size: info.Size(), set: true})
	return nil
}

// reconcile converts subscriptions to DB defs and reconciles the database.
// Must be called with s.lock held.
func (s *Syncer) reconcile(subs *feeds.Subscriptions) error {
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
