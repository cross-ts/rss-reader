use anyhow::Result;
use duckdb::params;
use opml::{Outline, OPML};
use std::collections::HashSet;
use std::fs;
use std::io::Write;

/// 1フィードの購読定義（OPML の `<outline type="rss" ...>` に対応）
#[derive(Debug, Clone)]
pub struct FeedEntry {
    pub title: String,
    /// RSS/Atom フィードの URL（OPML の xmlUrl）
    pub url: String,
    /// 所属フォルダ名（トップレベルなら None）
    pub folder: Option<String>,
    /// サイト URL（OPML の htmlUrl）。任意。
    pub site_url: Option<String>,
}

/// フォルダ定義（OPML の子を持つ `<outline text="...">` に対応）
#[derive(Debug, Clone)]
pub struct FolderEntry {
    pub name: String,
}

/// 購読の正本（feeds.opml）をパースした内部表現。
#[derive(Debug, Clone, Default)]
pub struct Subscriptions {
    pub folders: Vec<FolderEntry>,
    pub feeds: Vec<FeedEntry>,
}

/// OPML の outline を再帰的に走査して Subscriptions を構築する。
/// - xmlUrl を持つ outline はフィード（folder は祖先のフォルダ名）
/// - それ以外の outline はフォルダ（text をフォルダ名とし、子を再帰）
fn collect_outline(outline: &Outline, folder: Option<&str>, subs: &mut Subscriptions) {
    if let Some(xml_url) = outline.xml_url.as_ref() {
        // フィード。同一 xmlUrl が複数回現れた場合は先出しを優先して以降を無視する
        // （DB は url に一意制約があるため SSOT の意味を一致させる）。
        if subs.feeds.iter().any(|f| &f.url == xml_url) {
            return;
        }
        let title = outline
            .title
            .clone()
            .filter(|t| !t.is_empty())
            .or_else(|| {
                if outline.text.is_empty() {
                    None
                } else {
                    Some(outline.text.clone())
                }
            })
            .unwrap_or_else(|| xml_url.clone());
        subs.feeds.push(FeedEntry {
            title,
            url: xml_url.clone(),
            folder: folder.map(|s| s.to_string()),
            site_url: outline.html_url.clone().filter(|s| !s.is_empty()),
        });
    } else {
        // フォルダ
        let name = outline.text.clone();
        if !name.is_empty() && !subs.folders.iter().any(|f| f.name == name) {
            subs.folders.push(FolderEntry { name: name.clone() });
        }
        let child_folder = if name.is_empty() { folder } else { Some(name.as_str()) };
        for child in &outline.outlines {
            collect_outline(child, child_folder, subs);
        }
    }
}

/// 1フィードを OPML outline に変換する。
fn feed_to_outline(feed: &FeedEntry) -> Outline {
    Outline {
        text: feed.title.clone(),
        title: Some(feed.title.clone()),
        r#type: Some("rss".to_string()),
        xml_url: Some(feed.url.clone()),
        html_url: feed.site_url.clone(),
        ..Default::default()
    }
}

/// Subscriptions を OPML 文書に変換する。
fn build_opml(subs: &Subscriptions) -> OPML {
    let mut opml = OPML::default(); // version 2.0
    let mut outlines: Vec<Outline> = Vec::new();

    let known: HashSet<&str> = subs.folders.iter().map(|f| f.name.as_str()).collect();

    // フォルダ（定義順）。各フォルダの子は所属フィード。
    for folder in &subs.folders {
        let children: Vec<Outline> = subs
            .feeds
            .iter()
            .filter(|f| f.folder.as_deref() == Some(folder.name.as_str()))
            .map(feed_to_outline)
            .collect();
        outlines.push(Outline {
            text: folder.name.clone(),
            title: Some(folder.name.clone()),
            outlines: children,
            ..Default::default()
        });
    }

    // フォルダ未所属（または未知フォルダ参照）のフィードはトップレベルに置く
    for feed in &subs.feeds {
        let placed = feed
            .folder
            .as_deref()
            .map(|n| known.contains(n))
            .unwrap_or(false);
        if !placed {
            outlines.push(feed_to_outline(feed));
        }
    }

    opml.body.outlines = outlines;
    opml
}

/// 購読ファイル（feeds.opml）を読み込む。
/// ファイル不在は Ok(None)、読込/パース失敗は Err（fail-fast 用）。
pub fn read_feeds_opml(path: &str) -> Result<Option<Subscriptions>> {
    match std::fs::read_to_string(path) {
        Ok(content) => {
            let doc = OPML::from_str(&content)
                .map_err(|e| anyhow::anyhow!("OPML のパースに失敗: {e}"))?;
            let mut subs = Subscriptions::default();
            for outline in &doc.body.outlines {
                collect_outline(outline, None, &mut subs);
            }
            Ok(Some(subs))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// 購読を OPML としてファイルに保存する。
/// クラッシュや I/O 障害で SSOT が切り詰められないよう、一時ファイルに書き込んでから
/// atomic rename で置換する（同一ファイルシステム上での rename は原子的）。
pub fn save_opml(path: &str, subs: &Subscriptions) -> Result<()> {
    let opml = build_opml(subs);
    let xml = opml
        .to_string()
        .map_err(|e| anyhow::anyhow!("OPML のシリアライズに失敗: {e}"))?;
    let tmp_path = format!("{path}.tmp");
    // temp ファイルに書き込み → fsync → rename の順で電源断耐性を確保する
    let write_result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&tmp_path)?;
        file.write_all(xml.as_bytes())?;
        // rename 前に temp をディスク同期（データ＋メタデータ）
        file.sync_all()?;
        Ok(())
    })();
    if let Err(e) = write_result {
        // 書き込み失敗時は一時ファイルを後始末して伝播
        let _ = fs::remove_file(&tmp_path);
        return Err(e.into());
    }
    if let Err(e) = fs::rename(&tmp_path, path) {
        // rename 失敗時も一時ファイルを後始末して伝播
        let _ = fs::remove_file(&tmp_path);
        return Err(e.into());
    }
    // 親ディレクトリの rename を永続化する（best-effort: 失敗しても致命としない）
    let dir = std::path::Path::new(path)
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."));
    let _ = std::fs::File::open(dir).and_then(|f| f.sync_all());
    Ok(())
}

/// 購読（feeds.opml 由来）を正本として DB（folders/feeds）を同期する（トランザクション付き）。
/// articles は購読にない feed の分を削除し孤立を防ぐ。
pub fn reconcile_subscriptions(conn: &duckdb::Connection, subs: &Subscriptions) -> Result<()> {
    conn.execute_batch("BEGIN")?;

    let result: Result<()> = (|| {
        // 1. folders を upsert
        for folder in &subs.folders {
            conn.execute(
                "INSERT INTO folders (name) VALUES (?) ON CONFLICT (name) DO NOTHING",
                params![folder.name],
            )?;
        }

        // 2. feeds を upsert（folder_id は名前から解決）
        for feed in &subs.feeds {
            let folder_id: Option<i32> = if let Some(ref fname) = feed.folder {
                conn.query_row(
                    "SELECT id FROM folders WHERE name = ?",
                    params![fname],
                    |r| r.get(0),
                )
                .ok()
            } else {
                None
            };

            conn.execute(
                "INSERT INTO feeds (folder_id, title, url) VALUES (?, ?, ?)
                 ON CONFLICT (url) DO UPDATE SET folder_id = excluded.folder_id, title = excluded.title",
                params![folder_id, feed.title, feed.url],
            )?;

            // OPML(SSOT) の htmlUrl を site_url に反映する。
            // 変更は上書きし、htmlUrl が無ければ NULL 化する（site_url の唯一の供給源は OPML）。
            let su = feed.site_url.as_deref().filter(|s| !s.is_empty());
            conn.execute(
                "UPDATE feeds SET site_url = ? WHERE url = ?",
                params![su, feed.url],
            )?;
        }

        // 3. 購読にない feed の articles を削除 → feed を削除
        let feed_urls: Vec<String> = subs.feeds.iter().map(|f| f.url.clone()).collect();
        if !feed_urls.is_empty() {
            let placeholders: String = feed_urls
                .iter()
                .enumerate()
                .map(|(i, _)| format!("${}", i + 1))
                .collect::<Vec<_>>()
                .join(", ");
            // articles 削除
            let sql_art = format!(
                "DELETE FROM articles WHERE feed_id IN (SELECT id FROM feeds WHERE url NOT IN ({}))",
                placeholders
            );
            let params_art: Vec<&dyn duckdb::ToSql> =
                feed_urls.iter().map(|s| s as &dyn duckdb::ToSql).collect();
            conn.execute(&sql_art, duckdb::params_from_iter(params_art.iter()))?;

            // feeds 削除
            let sql_feeds = format!("DELETE FROM feeds WHERE url NOT IN ({})", placeholders);
            let params_feeds: Vec<&dyn duckdb::ToSql> =
                feed_urls.iter().map(|s| s as &dyn duckdb::ToSql).collect();
            conn.execute(&sql_feeds, duckdb::params_from_iter(params_feeds.iter()))?;
        } else {
            // 購読に feed が0件 → 全 articles/feeds 削除
            conn.execute("DELETE FROM articles", [])?;
            conn.execute("DELETE FROM feeds", [])?;
        }

        // 4. 購読にない folder を削除（参照 feed の folder_id を NULL に → folder 削除）
        let folder_names: Vec<String> = subs.folders.iter().map(|f| f.name.clone()).collect();
        if !folder_names.is_empty() {
            let placeholders: String = folder_names
                .iter()
                .enumerate()
                .map(|(i, _)| format!("${}", i + 1))
                .collect::<Vec<_>>()
                .join(", ");
            // 参照を NULL に
            let sql_null = format!(
                "UPDATE feeds SET folder_id = NULL WHERE folder_id IN (SELECT id FROM folders WHERE name NOT IN ({}))",
                placeholders
            );
            let params_null: Vec<&dyn duckdb::ToSql> =
                folder_names.iter().map(|s| s as &dyn duckdb::ToSql).collect();
            conn.execute(&sql_null, duckdb::params_from_iter(params_null.iter()))?;

            // folder 削除
            let sql_del = format!("DELETE FROM folders WHERE name NOT IN ({})", placeholders);
            let params_del: Vec<&dyn duckdb::ToSql> =
                folder_names.iter().map(|s| s as &dyn duckdb::ToSql).collect();
            conn.execute(&sql_del, duckdb::params_from_iter(params_del.iter()))?;
        } else {
            // 購読に folder が0件 → 参照を NULL に → folder 削除
            conn.execute("UPDATE feeds SET folder_id = NULL WHERE folder_id IS NOT NULL", [])?;
            conn.execute("DELETE FROM folders", [])?;
        }

        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute_batch("COMMIT")?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}
