package db

// Folder represents a folder that groups feeds.
type Folder struct {
	ID        int
	Name      string
	FeedCount int64
}

// Feed represents an RSS/Atom feed subscription.
type Feed struct {
	ID           int
	Title        string
	URL          string
	SiteURL      *string
	Folder       *string
	ArticleCount int64
}

// Article represents a single article from a feed.
type Article struct {
	ID          int
	FeedID      int
	FeedTitle   string
	Title       string
	URL         string
	Author      *string
	Content     string
	PublishedAt *string
}

// ArticlesResult holds a page of articles along with the total count.
type ArticlesResult struct {
	Items []Article
	Total int64
}

// ArticleFilter specifies filtering and pagination for listing articles.
type ArticleFilter struct {
	FolderID *int
	FeedID   *int
	Q        *string
	Limit    int64
	Offset   int64
}

// FeedTarget holds the minimal information needed to fetch a feed.
type FeedTarget struct {
	ID           int
	URL          string
	Etag         *string
	LastModified *string
}

// NewArticle represents a new article to be inserted from a feed fetch.
type NewArticle struct {
	GUID        string
	Title       string
	URL         string
	Author      string
	Content     string
	PublishedAt *string
}

// FetchMeta holds metadata from an HTTP fetch response.
type FetchMeta struct {
	Etag         *string
	LastModified *string
	FetchedAt    string
}

// FeedFetchResult holds the parsed articles and metadata from a feed fetch.
type FeedFetchResult struct {
	Articles []NewArticle
	Meta     *FetchMeta
}

// FolderDef defines a folder for subscription reconciliation.
type FolderDef struct {
	Name string
}

// FeedDef defines a feed for subscription reconciliation.
type FeedDef struct {
	Title   string
	URL     string
	Folder  *string
	SiteURL *string
}
