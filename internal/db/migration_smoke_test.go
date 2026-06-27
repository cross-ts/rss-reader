package db

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestMigrationFreshAndIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fresh.db")

	d, err := Open(path)
	if err != nil {
		t.Fatalf("open fresh: %v", err)
	}
	cols, err := tableColumns(d.db, "articles")
	if err != nil {
		t.Fatalf("columns: %v", err)
	}
	for _, c := range []string{"is_read", "read_at", "starred"} {
		if !cols[c] {
			t.Fatalf("missing column %q after migration", c)
		}
	}
	d.Close()

	// Re-open: migration must be idempotent.
	d2, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer d2.Close()
}

func TestMigrationUpgradesLegacyArticles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")

	// Simulate a pre-migration articles table (no is_read/read_at/starred).
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("raw open: %v", err)
	}
	_, err = raw.Exec(`CREATE TABLE articles (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		feed_id INTEGER, guid TEXT, title TEXT, url TEXT, author TEXT,
		content TEXT, published_at TEXT, fetched_at TEXT)`)
	if err != nil {
		t.Fatalf("create legacy: %v", err)
	}
	if _, err := raw.Exec(`INSERT INTO articles (title) VALUES ('hi')`); err != nil {
		t.Fatalf("insert legacy: %v", err)
	}
	raw.Close()

	d, err := Open(path)
	if err != nil {
		t.Fatalf("open legacy: %v", err)
	}
	defer d.Close()

	// Existing rows must default to unread / not starred.
	var isRead, starred int
	var readAt sql.NullString
	err = d.db.QueryRow(`SELECT is_read, read_at, starred FROM articles WHERE title='hi'`).
		Scan(&isRead, &readAt, &starred)
	if err != nil {
		t.Fatalf("scan migrated row: %v", err)
	}
	if isRead != 0 || starred != 0 || readAt.Valid {
		t.Fatalf("unexpected defaults: is_read=%d starred=%d read_at_valid=%v", isRead, starred, readAt.Valid)
	}

	// Unread counts should see the one unread article.
	counts, err := d.GetUnreadCounts()
	if err != nil {
		t.Fatalf("unread counts: %v", err)
	}
	if counts.Total != 1 {
		t.Fatalf("expected total unread 1, got %d", counts.Total)
	}
}
