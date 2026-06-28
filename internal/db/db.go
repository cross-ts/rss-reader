package db

import (
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

// DB wraps a sql.DB connection to the SQLite database.
type DB struct {
	db *sql.DB
}

// Open opens (or creates) the SQLite database at the given path.
func Open(path string) (*DB, error) {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create db directory: %w", err)
	}

	sqlDB, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	sqlDB.SetMaxOpenConns(1)

	if _, err := sqlDB.Exec(`PRAGMA journal_mode=WAL`); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("set journal_mode: %w", err)
	}

	if _, err := sqlDB.Exec(`PRAGMA foreign_keys=ON`); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("set foreign_keys: %w", err)
	}

	if _, err := sqlDB.Exec(`CREATE TABLE IF NOT EXISTS folders (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL)`); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("create folders table: %w", err)
	}

	if _, err := sqlDB.Exec(`CREATE TABLE IF NOT EXISTS feeds (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		folder_id INTEGER, title TEXT, url TEXT UNIQUE NOT NULL,
		site_url TEXT, etag TEXT, last_modified TEXT, last_fetched_at TEXT
	)`); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("create feeds table: %w", err)
	}

	if _, err := sqlDB.Exec(`CREATE TABLE IF NOT EXISTS articles (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		feed_id INTEGER REFERENCES feeds(id) ON DELETE CASCADE,
		guid TEXT, title TEXT, url TEXT, author TEXT, content TEXT,
		published_at TEXT, fetched_at TEXT,
		UNIQUE(feed_id, guid)
	)`); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("create articles table: %w", err)
	}

	// Migrate read-state columns (is_read, read_at, starred) onto the articles table.
	if err := migrateReadState(sqlDB); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("migrate read state: %w", err)
	}

	// Migrate legacy FTS schema (Rust-era: title_tokens, content_tokens) to trigram.
	if err := migrateLegacyFTS(sqlDB); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("migrate legacy fts: %w", err)
	}

	if _, err := sqlDB.Exec(`CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
		title, content,
		content='articles', content_rowid='id',
		tokenize='trigram'
	)`); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("create articles_fts table: %w", err)
	}

	if _, err := sqlDB.Exec(`CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
		INSERT INTO articles_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
	END`); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("create articles_ai trigger: %w", err)
	}

	if _, err := sqlDB.Exec(`CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
		INSERT INTO articles_fts(articles_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
	END`); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("create articles_ad trigger: %w", err)
	}

	if _, err := sqlDB.Exec(`CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
		INSERT INTO articles_fts(articles_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
		INSERT INTO articles_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
	END`); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("create articles_au trigger: %w", err)
	}

	return &DB{db: sqlDB}, nil
}

// Close closes the underlying database connection.
func (d *DB) Close() error {
	return d.db.Close()
}

// FeedCount returns the total number of feeds.
func (d *DB) FeedCount() (int64, error) {
	var count int64
	err := d.db.QueryRow(`SELECT COUNT(*) FROM feeds`).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("feed count: %w", err)
	}
	return count, nil
}

// ReconcileSubscriptions synchronizes the database with the given folder and feed definitions.
func (d *DB) ReconcileSubscriptions(folders []FolderDef, feeds []FeedDef) error {
	tx, err := d.db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Upsert folders
	for _, f := range folders {
		if _, err := tx.Exec(`INSERT INTO folders (name) VALUES (?) ON CONFLICT (name) DO NOTHING`, f.Name); err != nil {
			return fmt.Errorf("upsert folder %q: %w", f.Name, err)
		}
	}

	// Upsert feeds
	for _, f := range feeds {
		var folderID *int
		if f.Folder != nil {
			var id int
			err := tx.QueryRow(`SELECT id FROM folders WHERE name = ?`, *f.Folder).Scan(&id)
			if err != nil {
				return fmt.Errorf("resolve folder %q: %w", *f.Folder, err)
			}
			folderID = &id
		}

		if _, err := tx.Exec(
			`INSERT INTO feeds (folder_id, title, url) VALUES (?,?,?) ON CONFLICT (url) DO UPDATE SET folder_id = excluded.folder_id, title = excluded.title`,
			folderID, f.Title, f.URL,
		); err != nil {
			return fmt.Errorf("upsert feed %q: %w", f.URL, err)
		}

		// Update site_url (filter empty string to NULL)
		var siteURL *string
		if f.SiteURL != nil && *f.SiteURL != "" {
			siteURL = f.SiteURL
		}
		if _, err := tx.Exec(`UPDATE feeds SET site_url = ? WHERE url = ?`, siteURL, f.URL); err != nil {
			return fmt.Errorf("update site_url for %q: %w", f.URL, err)
		}
	}

	// Delete feeds/articles not in subscription
	if len(feeds) > 0 {
		urls := make([]string, len(feeds))
		args := make([]interface{}, len(feeds))
		for i, f := range feeds {
			urls[i] = "?"
			args[i] = f.URL
		}
		placeholders := strings.Join(urls, ",")

		if _, err := tx.Exec(
			fmt.Sprintf(`DELETE FROM articles WHERE feed_id IN (SELECT id FROM feeds WHERE url NOT IN (%s))`, placeholders),
			args...,
		); err != nil {
			return fmt.Errorf("delete orphaned articles: %w", err)
		}
		if _, err := tx.Exec(
			fmt.Sprintf(`DELETE FROM feeds WHERE url NOT IN (%s)`, placeholders),
			args...,
		); err != nil {
			return fmt.Errorf("delete orphaned feeds: %w", err)
		}
	} else {
		if _, err := tx.Exec(`DELETE FROM articles`); err != nil {
			return fmt.Errorf("delete all articles: %w", err)
		}
		if _, err := tx.Exec(`DELETE FROM feeds`); err != nil {
			return fmt.Errorf("delete all feeds: %w", err)
		}
	}

	// Delete folders not in subscription
	if len(folders) > 0 {
		names := make([]string, len(folders))
		args := make([]interface{}, len(folders))
		for i, f := range folders {
			names[i] = "?"
			args[i] = f.Name
		}
		placeholders := strings.Join(names, ",")

		if _, err := tx.Exec(
			fmt.Sprintf(`UPDATE feeds SET folder_id = NULL WHERE folder_id IN (SELECT id FROM folders WHERE name NOT IN (%s))`, placeholders),
			args...,
		); err != nil {
			return fmt.Errorf("nullify orphaned folder_ids: %w", err)
		}
		if _, err := tx.Exec(
			fmt.Sprintf(`DELETE FROM folders WHERE name NOT IN (%s)`, placeholders),
			args...,
		); err != nil {
			return fmt.Errorf("delete orphaned folders: %w", err)
		}
	} else {
		if _, err := tx.Exec(`UPDATE feeds SET folder_id = NULL`); err != nil {
			return fmt.Errorf("nullify all folder_ids: %w", err)
		}
		if _, err := tx.Exec(`DELETE FROM folders`); err != nil {
			return fmt.Errorf("delete all folders: %w", err)
		}
	}

	return tx.Commit()
}

// ListArticles returns a paginated, optionally filtered list of articles.
func (d *DB) ListArticles(filter ArticleFilter) (*ArticlesResult, error) {
	if filter.Q != nil && *filter.Q != "" {
		return d.listArticlesWithSearch(filter)
	}
	return d.listArticlesNoSearch(filter)
}

func (d *DB) listArticlesNoSearch(filter ArticleFilter) (*ArticlesResult, error) {
	var wheres []string
	var args []interface{}

	if filter.FolderID != nil {
		wheres = append(wheres, "f.folder_id = ?")
		args = append(args, *filter.FolderID)
	}
	if filter.FeedID != nil {
		wheres = append(wheres, "a.feed_id = ?")
		args = append(args, *filter.FeedID)
	}

	whereClause := ""
	if len(wheres) > 0 {
		whereClause = "WHERE " + strings.Join(wheres, " AND ")
	}

	baseQuery := fmt.Sprintf(
		`FROM articles a JOIN feeds f ON f.id = a.feed_id %s`,
		whereClause,
	)

	// Count total
	var total int64
	countArgs := make([]interface{}, len(args))
	copy(countArgs, args)
	if err := d.db.QueryRow(fmt.Sprintf(`SELECT COUNT(*) %s`, baseQuery), countArgs...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count articles: %w", err)
	}

	// Fetch items
	selectQuery := fmt.Sprintf(
		`SELECT a.id, a.feed_id, COALESCE(f.title, '') AS feed_title, COALESCE(a.title, '') AS title, COALESCE(a.url, '') AS url, a.author, COALESCE(a.content, '') AS content, a.published_at, a.is_read, a.read_at, a.starred %s ORDER BY a.published_at IS NULL, a.published_at DESC LIMIT ? OFFSET ?`,
		baseQuery,
	)
	args = append(args, filter.Limit, filter.Offset)

	rows, err := d.db.Query(selectQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("query articles: %w", err)
	}
	defer rows.Close()

	items, err := scanArticles(rows)
	if err != nil {
		return nil, err
	}

	return &ArticlesResult{Items: items, Total: total}, nil
}

func (d *DB) listArticlesWithSearch(filter ArticleFilter) (*ArticlesResult, error) {
	// Check if there are any articles at all
	var articleCount int64
	if err := d.db.QueryRow(`SELECT count(*) FROM articles`).Scan(&articleCount); err != nil {
		return nil, fmt.Errorf("count articles: %w", err)
	}
	if articleCount == 0 {
		return &ArticlesResult{Items: []Article{}, Total: 0}, nil
	}

	q := *filter.Q

	if len(q) >= 3 {
		return d.listArticlesFTS(filter, q)
	}
	return d.listArticlesLike(filter, q)
}

func (d *DB) listArticlesFTS(filter ArticleFilter, q string) (*ArticlesResult, error) {
	// Escape double quotes and wrap as phrase
	escaped := strings.ReplaceAll(q, `"`, `""`)
	matchQ := fmt.Sprintf(`"%s"`, escaped)

	var wheres []string
	var args []interface{}

	wheres = append(wheres, "articles_fts MATCH ?")
	args = append(args, matchQ)

	if filter.FolderID != nil {
		wheres = append(wheres, "f.folder_id = ?")
		args = append(args, *filter.FolderID)
	}
	if filter.FeedID != nil {
		wheres = append(wheres, "a.feed_id = ?")
		args = append(args, *filter.FeedID)
	}

	whereClause := "WHERE " + strings.Join(wheres, " AND ")

	baseQuery := fmt.Sprintf(
		`FROM articles a JOIN feeds f ON f.id = a.feed_id JOIN articles_fts ON a.id = articles_fts.rowid %s`,
		whereClause,
	)

	// Count total
	var total int64
	countArgs := make([]interface{}, len(args))
	copy(countArgs, args)
	if err := d.db.QueryRow(fmt.Sprintf(`SELECT COUNT(*) %s`, baseQuery), countArgs...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count fts articles: %w", err)
	}

	// Fetch items
	selectQuery := fmt.Sprintf(
		`SELECT a.id, a.feed_id, COALESCE(f.title, '') AS feed_title, COALESCE(a.title, '') AS title, COALESCE(a.url, '') AS url, a.author, COALESCE(a.content, '') AS content, a.published_at, a.is_read, a.read_at, a.starred %s ORDER BY a.published_at IS NULL, a.published_at DESC LIMIT ? OFFSET ?`,
		baseQuery,
	)
	args = append(args, filter.Limit, filter.Offset)

	rows, err := d.db.Query(selectQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("query fts articles: %w", err)
	}
	defer rows.Close()

	items, err := scanArticles(rows)
	if err != nil {
		return nil, err
	}

	return &ArticlesResult{Items: items, Total: total}, nil
}

func (d *DB) listArticlesLike(filter ArticleFilter, q string) (*ArticlesResult, error) {
	// Escape LIKE special characters
	escapedQ := strings.ReplaceAll(q, `\`, `\\`)
	escapedQ = strings.ReplaceAll(escapedQ, `%`, `\%`)
	escapedQ = strings.ReplaceAll(escapedQ, `_`, `\_`)
	likePattern := "%" + escapedQ + "%"

	var wheres []string
	var args []interface{}

	wheres = append(wheres, "(a.title LIKE ? ESCAPE '\\' OR a.content LIKE ? ESCAPE '\\')")
	args = append(args, likePattern, likePattern)

	if filter.FolderID != nil {
		wheres = append(wheres, "f.folder_id = ?")
		args = append(args, *filter.FolderID)
	}
	if filter.FeedID != nil {
		wheres = append(wheres, "a.feed_id = ?")
		args = append(args, *filter.FeedID)
	}

	whereClause := "WHERE " + strings.Join(wheres, " AND ")

	baseQuery := fmt.Sprintf(
		`FROM articles a JOIN feeds f ON f.id = a.feed_id %s`,
		whereClause,
	)

	// Count total
	var total int64
	countArgs := make([]interface{}, len(args))
	copy(countArgs, args)
	if err := d.db.QueryRow(fmt.Sprintf(`SELECT COUNT(*) %s`, baseQuery), countArgs...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count like articles: %w", err)
	}

	// Fetch items
	selectQuery := fmt.Sprintf(
		`SELECT a.id, a.feed_id, COALESCE(f.title, '') AS feed_title, COALESCE(a.title, '') AS title, COALESCE(a.url, '') AS url, a.author, COALESCE(a.content, '') AS content, a.published_at, a.is_read, a.read_at, a.starred %s ORDER BY a.published_at IS NULL, a.published_at DESC LIMIT ? OFFSET ?`,
		baseQuery,
	)
	args = append(args, filter.Limit, filter.Offset)

	rows, err := d.db.Query(selectQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("query like articles: %w", err)
	}
	defer rows.Close()

	items, err := scanArticles(rows)
	if err != nil {
		return nil, err
	}

	return &ArticlesResult{Items: items, Total: total}, nil
}

func scanArticles(rows *sql.Rows) ([]Article, error) {
	var items []Article
	for rows.Next() {
		var a Article
		if err := rows.Scan(&a.ID, &a.FeedID, &a.FeedTitle, &a.Title, &a.URL, &a.Author, &a.Content, &a.PublishedAt, &a.IsRead, &a.ReadAt, &a.Starred); err != nil {
			return nil, fmt.Errorf("scan article: %w", err)
		}
		items = append(items, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate articles: %w", err)
	}
	if items == nil {
		items = []Article{}
	}
	return items, nil
}

// ListFeeds returns all feeds with their folder names and article counts.
func (d *DB) ListFeeds() ([]Feed, error) {
	rows, err := d.db.Query(`SELECT f.id, COALESCE(f.title, '') AS title, f.url, f.site_url, fo.name AS folder_name, COUNT(a.id) AS article_count
		FROM feeds f
		LEFT JOIN folders fo ON fo.id = f.folder_id
		LEFT JOIN articles a ON a.feed_id = f.id
		GROUP BY f.id, f.title, f.url, f.site_url, fo.name
		ORDER BY f.title`)
	if err != nil {
		return nil, fmt.Errorf("query feeds: %w", err)
	}
	defer rows.Close()

	var feeds []Feed
	for rows.Next() {
		var f Feed
		if err := rows.Scan(&f.ID, &f.Title, &f.URL, &f.SiteURL, &f.Folder, &f.ArticleCount); err != nil {
			return nil, fmt.Errorf("scan feed: %w", err)
		}
		feeds = append(feeds, f)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate feeds: %w", err)
	}
	if feeds == nil {
		feeds = []Feed{}
	}
	return feeds, nil
}

// ListFolders returns all folders with their feed counts.
func (d *DB) ListFolders() ([]Folder, error) {
	rows, err := d.db.Query(`SELECT f.id, f.name, COUNT(fd.id) AS feed_count
		FROM folders f
		LEFT JOIN feeds fd ON fd.folder_id = f.id
		GROUP BY f.id, f.name
		ORDER BY f.name`)
	if err != nil {
		return nil, fmt.Errorf("query folders: %w", err)
	}
	defer rows.Close()

	var folders []Folder
	for rows.Next() {
		var f Folder
		if err := rows.Scan(&f.ID, &f.Name, &f.FeedCount); err != nil {
			return nil, fmt.Errorf("scan folder: %w", err)
		}
		folders = append(folders, f)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate folders: %w", err)
	}
	if folders == nil {
		folders = []Folder{}
	}
	return folders, nil
}

// GetFeedTargets returns all feeds as fetch targets.
func (d *DB) GetFeedTargets() ([]FeedTarget, error) {
	rows, err := d.db.Query(`SELECT id, url, etag, last_modified FROM feeds`)
	if err != nil {
		return nil, fmt.Errorf("query feed targets: %w", err)
	}
	defer rows.Close()

	var targets []FeedTarget
	for rows.Next() {
		var t FeedTarget
		if err := rows.Scan(&t.ID, &t.URL, &t.Etag, &t.LastModified); err != nil {
			return nil, fmt.Errorf("scan feed target: %w", err)
		}
		targets = append(targets, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate feed targets: %w", err)
	}
	if targets == nil {
		targets = []FeedTarget{}
	}
	return targets, nil
}

// GetFeedTargetsByID returns feed targets for a specific feed ID.
func (d *DB) GetFeedTargetsByID(feedID int) ([]FeedTarget, error) {
	rows, err := d.db.Query(`SELECT id, url, etag, last_modified FROM feeds WHERE id = ?`, feedID)
	if err != nil {
		return nil, fmt.Errorf("query feed targets by id: %w", err)
	}
	defer rows.Close()

	var targets []FeedTarget
	for rows.Next() {
		var t FeedTarget
		if err := rows.Scan(&t.ID, &t.URL, &t.Etag, &t.LastModified); err != nil {
			return nil, fmt.Errorf("scan feed target: %w", err)
		}
		targets = append(targets, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate feed targets: %w", err)
	}
	if targets == nil {
		targets = []FeedTarget{}
	}
	return targets, nil
}

// GetFeedByURL returns a single feed by its URL.
func (d *DB) GetFeedByURL(url string) (*Feed, error) {
	var f Feed
	err := d.db.QueryRow(`SELECT f.id, COALESCE(f.title, '') AS title, f.url, f.site_url, fo.name AS folder_name, COUNT(a.id) AS article_count
		FROM feeds f
		LEFT JOIN folders fo ON fo.id = f.folder_id
		LEFT JOIN articles a ON a.feed_id = f.id
		WHERE f.url = ?
		GROUP BY f.id, f.title, f.url, f.site_url, fo.name`, url).Scan(&f.ID, &f.Title, &f.URL, &f.SiteURL, &f.Folder, &f.ArticleCount)
	if err != nil {
		return nil, fmt.Errorf("get feed by url: %w", err)
	}
	return &f, nil
}

// GetFolderByName returns a single folder by its name.
func (d *DB) GetFolderByName(name string) (*Folder, error) {
	var f Folder
	err := d.db.QueryRow(`SELECT f.id, f.name, COUNT(fd.id) AS feed_count
		FROM folders f
		LEFT JOIN feeds fd ON fd.folder_id = f.id
		WHERE f.name = ?
		GROUP BY f.id, f.name`, name).Scan(&f.ID, &f.Name, &f.FeedCount)
	if err != nil {
		return nil, fmt.Errorf("get folder by name: %w", err)
	}
	return &f, nil
}

// GetFeedURLByID returns the URL of a feed by its ID.
func (d *DB) GetFeedURLByID(id int) (string, error) {
	var url string
	err := d.db.QueryRow(`SELECT url FROM feeds WHERE id = ?`, id).Scan(&url)
	if err != nil {
		return "", fmt.Errorf("get feed url by id: %w", err)
	}
	return url, nil
}

// GetFeedInfoByID returns the URL, title, and folder name for a feed.
func (d *DB) GetFeedInfoByID(id int) (url string, title string, folder *string, err error) {
	err = d.db.QueryRow(`SELECT f.url, COALESCE(f.title, ''), fo.name FROM feeds f LEFT JOIN folders fo ON fo.id = f.folder_id WHERE f.id = ?`, id).Scan(&url, &title, &folder)
	if err != nil {
		return "", "", nil, fmt.Errorf("get feed info by id: %w", err)
	}
	return url, title, folder, nil
}

// GetFolderNameByID returns the name of a folder by its ID.
func (d *DB) GetFolderNameByID(id int) (string, error) {
	var name string
	err := d.db.QueryRow(`SELECT name FROM folders WHERE id = ?`, id).Scan(&name)
	if err != nil {
		return "", fmt.Errorf("get folder name by id: %w", err)
	}
	return name, nil
}

// ApplyFetchResult inserts new articles and updates feed metadata.
// Returns the number of newly inserted articles.
func (d *DB) ApplyFetchResult(feedID int, articles []NewArticle, meta *FetchMeta) (int, error) {
	tx, err := d.db.Begin()
	if err != nil {
		return 0, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	var insertedCount int
	for _, a := range articles {
		result, err := tx.Exec(
			`INSERT INTO articles (feed_id, guid, title, url, author, content, published_at, fetched_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (feed_id, guid) DO NOTHING`,
			feedID, a.GUID, a.Title, a.URL, a.Author, a.Content, a.PublishedAt, meta.FetchedAt,
		)
		if err != nil {
			return 0, fmt.Errorf("insert article %q: %w", a.GUID, err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return 0, fmt.Errorf("rows affected: %w", err)
		}
		if affected > 0 {
			insertedCount++
		}
	}

	if _, err := tx.Exec(
		`UPDATE feeds SET etag=?, last_modified=?, last_fetched_at=? WHERE id=?`,
		meta.Etag, meta.LastModified, meta.FetchedAt, feedID,
	); err != nil {
		return 0, fmt.Errorf("update feed metadata: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit transaction: %w", err)
	}

	return insertedCount, nil
}

// RebuildSearchIndex rebuilds the FTS5 search index.
func (d *DB) RebuildSearchIndex() error {
	var count int64
	if err := d.db.QueryRow(`SELECT count(*) FROM articles`).Scan(&count); err != nil {
		return fmt.Errorf("count articles: %w", err)
	}
	if count == 0 {
		return nil
	}

	slog.Info("rebuilding search index", "article_count", count)

	if _, err := d.db.Exec(`INSERT INTO articles_fts(articles_fts) VALUES('rebuild')`); err != nil {
		return fmt.Errorf("rebuild search index: %w", err)
	}

	slog.Info("search index rebuilt")
	return nil
}

// SetArticleRead sets the read state of a single article.
// When marking as read, read_at is set to the given timestamp only if the
// article was previously unread (preserving the first read timestamp); when
// marking as unread, read_at is cleared. Returns false if no article matched
// the id.
func (d *DB) SetArticleRead(id int, isRead bool, readAt string) (bool, error) {
	var result sql.Result
	var err error
	if isRead {
		result, err = d.db.Exec(`UPDATE articles SET is_read = 1, read_at = ? WHERE id = ? AND is_read = 0`, readAt, id)
	} else {
		result, err = d.db.Exec(`UPDATE articles SET is_read = 0, read_at = NULL WHERE id = ? AND is_read = 1`, id)
	}
	if err != nil {
		return false, fmt.Errorf("set article read: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("rows affected: %w", err)
	}
	if affected > 0 {
		return true, nil
	}
	// No rows updated — check whether the article exists (it may already
	// be in the desired state).
	var exists bool
	if err := d.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM articles WHERE id = ?)`, id).Scan(&exists); err != nil {
		return false, fmt.Errorf("check article exists: %w", err)
	}
	return exists, nil
}

// MarkArticlesRead marks the given article ids as read, setting read_at on
// articles that were previously unread. Returns the number of rows updated.
func (d *DB) MarkArticlesRead(ids []int, readAt string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}

	placeholders := make([]string, len(ids))
	args := make([]interface{}, 0, len(ids)+1)
	args = append(args, readAt)
	for i, id := range ids {
		placeholders[i] = "?"
		args = append(args, id)
	}

	query := fmt.Sprintf(
		`UPDATE articles SET is_read = 1, read_at = ? WHERE is_read = 0 AND id IN (%s)`,
		strings.Join(placeholders, ","),
	)
	result, err := d.db.Exec(query, args...)
	if err != nil {
		return 0, fmt.Errorf("mark articles read: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("rows affected: %w", err)
	}
	return affected, nil
}

// SetArticleStarred sets the starred state of a single article.
// Returns false if no article matched the id. When the starred state is already
// in the desired state, it is treated as success.
func (d *DB) SetArticleStarred(id int, starred bool) (bool, error) {
	val := 0
	if starred {
		val = 1
	}
	result, err := d.db.Exec(`UPDATE articles SET starred = ? WHERE id = ?`, val, id)
	if err != nil {
		return false, fmt.Errorf("set article starred: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("rows affected: %w", err)
	}
	if affected > 0 {
		return true, nil
	}
	// No rows updated — check whether the article exists (it may already
	// be in the desired state).
	var exists bool
	if err := d.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM articles WHERE id = ?)`, id).Scan(&exists); err != nil {
		return false, fmt.Errorf("check article exists: %w", err)
	}
	return exists, nil
}

// UnreadCounts holds aggregated unread counts by feed, by folder, and overall.
type UnreadCounts struct {
	Total   int64
	Feeds   map[int]int64
	Folders map[int]int64
}

// GetUnreadCounts computes unread article counts grouped by feed and folder,
// plus the overall total, entirely in SQL.
func (d *DB) GetUnreadCounts() (*UnreadCounts, error) {
	counts := &UnreadCounts{
		Feeds:   make(map[int]int64),
		Folders: make(map[int]int64),
	}

	// Overall total (includes any rows with a NULL feed_id).
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM articles WHERE is_read = 0`).Scan(&counts.Total); err != nil {
		return nil, fmt.Errorf("query total unread count: %w", err)
	}

	// Per-feed unread counts (skip NULL feed_id, which can't map to a feed badge).
	feedRows, err := d.db.Query(`SELECT feed_id, COUNT(*) FROM articles WHERE is_read = 0 AND feed_id IS NOT NULL GROUP BY feed_id`)
	if err != nil {
		return nil, fmt.Errorf("query feed unread counts: %w", err)
	}
	defer feedRows.Close()
	for feedRows.Next() {
		var feedID int
		var c int64
		if err := feedRows.Scan(&feedID, &c); err != nil {
			return nil, fmt.Errorf("scan feed unread count: %w", err)
		}
		counts.Feeds[feedID] = c
	}
	if err := feedRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate feed unread counts: %w", err)
	}

	// Per-folder unread counts.
	folderRows, err := d.db.Query(`SELECT f.folder_id, COUNT(*)
		FROM articles a JOIN feeds f ON f.id = a.feed_id
		WHERE a.is_read = 0 AND f.folder_id IS NOT NULL
		GROUP BY f.folder_id`)
	if err != nil {
		return nil, fmt.Errorf("query folder unread counts: %w", err)
	}
	defer folderRows.Close()
	for folderRows.Next() {
		var folderID int
		var c int64
		if err := folderRows.Scan(&folderID, &c); err != nil {
			return nil, fmt.Errorf("scan folder unread count: %w", err)
		}
		counts.Folders[folderID] = c
	}
	if err := folderRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate folder unread counts: %w", err)
	}

	return counts, nil
}

// migrateReadState adds the is_read, read_at, and starred columns to the
// articles table if they do not already exist. SQLite has no
// "ADD COLUMN IF NOT EXISTS", so we inspect the existing columns first.
func migrateReadState(sqlDB *sql.DB) error {
	existing, err := tableColumns(sqlDB, "articles")
	if err != nil {
		return fmt.Errorf("inspect articles columns: %w", err)
	}

	type column struct {
		name string
		ddl  string
	}
	wanted := []column{
		{"is_read", `ALTER TABLE articles ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0`},
		{"read_at", `ALTER TABLE articles ADD COLUMN read_at TEXT`},
		{"starred", `ALTER TABLE articles ADD COLUMN starred INTEGER NOT NULL DEFAULT 0`},
	}

	for _, c := range wanted {
		if existing[c.name] {
			continue
		}
		slog.Info("migrating articles read-state column", "column", c.name)
		if _, err := sqlDB.Exec(c.ddl); err != nil {
			return fmt.Errorf("add column %q: %w", c.name, err)
		}
	}

	if _, err := sqlDB.Exec(`CREATE INDEX IF NOT EXISTS idx_articles_feed_unread ON articles(feed_id, is_read)`); err != nil {
		return fmt.Errorf("create unread index: %w", err)
	}

	return nil
}

// tableColumns returns the set of column names for the given table.
func tableColumns(sqlDB *sql.DB, table string) (map[string]bool, error) {
	rows, err := sqlDB.Query(fmt.Sprintf(`PRAGMA table_info(%s)`, table))
	if err != nil {
		return nil, fmt.Errorf("pragma table_info: %w", err)
	}
	defer rows.Close()

	cols := make(map[string]bool)
	for rows.Next() {
		var (
			cid       int
			name      string
			ctype     string
			notnull   int
			dfltValue sql.NullString
			pk        int
		)
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dfltValue, &pk); err != nil {
			return nil, fmt.Errorf("scan table_info: %w", err)
		}
		cols[name] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate table_info: %w", err)
	}
	return cols, nil
}

// migrateLegacyFTS detects the old Rust-era FTS schema (title_tokens, content_tokens)
// and drops it so the new trigram schema can be created.
func migrateLegacyFTS(sqlDB *sql.DB) error {
	var createSQL sql.NullString
	err := sqlDB.QueryRow(
		`SELECT sql FROM sqlite_master WHERE type='table' AND name='articles_fts'`,
	).Scan(&createSQL)
	if err == sql.ErrNoRows {
		// Table does not exist yet; nothing to migrate.
		return nil
	}
	if err != nil {
		return fmt.Errorf("query sqlite_master: %w", err)
	}

	if !createSQL.Valid || !strings.Contains(createSQL.String, "title_tokens") {
		// Already using the new trigram schema or unrecognized; leave it.
		return nil
	}

	slog.Info("detected legacy FTS schema (title_tokens); migrating to trigram")

	if _, err := sqlDB.Exec(`DROP TRIGGER IF EXISTS articles_ai`); err != nil {
		return fmt.Errorf("drop legacy trigger articles_ai: %w", err)
	}
	if _, err := sqlDB.Exec(`DROP TRIGGER IF EXISTS articles_ad`); err != nil {
		return fmt.Errorf("drop legacy trigger articles_ad: %w", err)
	}
	if _, err := sqlDB.Exec(`DROP TRIGGER IF EXISTS articles_au`); err != nil {
		return fmt.Errorf("drop legacy trigger articles_au: %w", err)
	}
	if _, err := sqlDB.Exec(`DROP TABLE IF EXISTS articles_fts`); err != nil {
		return fmt.Errorf("drop legacy articles_fts: %w", err)
	}

	return nil
}
