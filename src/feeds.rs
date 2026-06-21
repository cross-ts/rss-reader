use anyhow::Result;
use duckdb::params;
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeedYamlEntry {
    pub title: String,
    pub url: String,
    pub folder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderYamlEntry {
    pub name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FeedsYaml {
    #[serde(default)]
    pub folders: Vec<FolderYamlEntry>,
    #[serde(default)]
    pub feeds: Vec<FeedYamlEntry>,
}

/// ファイル不在は Ok(None)、読込/パース失敗は Err（fail-fast用）
pub fn read_feeds_yaml(path: &str) -> Result<Option<FeedsYaml>> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(Some(serde_yaml::from_str(&content)?)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn save_yaml(path: &str, yaml: &FeedsYaml) -> Result<()> {
    let content = serde_yaml::to_string(yaml)?;
    fs::write(path, content)?;
    Ok(())
}

/// yaml を正本として DB（folders/feeds）を同期する（トランザクション付き）
/// articles は yaml にない feed の分を削除し孤立を防ぐ。
pub fn reconcile_from_yaml(conn: &duckdb::Connection, yaml: &FeedsYaml) -> Result<()> {
    conn.execute_batch("BEGIN")?;

    let result: Result<()> = (|| {
        // 1. folders を upsert
        for folder in &yaml.folders {
            conn.execute(
                "INSERT INTO folders (name) VALUES (?) ON CONFLICT (name) DO NOTHING",
                params![folder.name],
            )?;
        }

        // 2. feeds を upsert（folder_id は名前から解決）
        for feed in &yaml.feeds {
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
        }

        // 3. yaml にない feed の articles を削除 → feed を削除
        let yaml_feed_urls: Vec<String> = yaml.feeds.iter().map(|f| f.url.clone()).collect();
        if !yaml_feed_urls.is_empty() {
            let placeholders: String = yaml_feed_urls
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
                yaml_feed_urls.iter().map(|s| s as &dyn duckdb::ToSql).collect();
            conn.execute(&sql_art, duckdb::params_from_iter(params_art.iter()))?;

            // feeds 削除
            let sql_feeds = format!("DELETE FROM feeds WHERE url NOT IN ({})", placeholders);
            let params_feeds: Vec<&dyn duckdb::ToSql> =
                yaml_feed_urls.iter().map(|s| s as &dyn duckdb::ToSql).collect();
            conn.execute(&sql_feeds, duckdb::params_from_iter(params_feeds.iter()))?;
        } else {
            // yaml に feed が0件 → 全 articles/feeds 削除
            conn.execute("DELETE FROM articles", [])?;
            conn.execute("DELETE FROM feeds", [])?;
        }

        // 4. yaml にない folder を削除（参照 feed の folder_id を NULL に → folder 削除）
        let yaml_folder_names: Vec<String> =
            yaml.folders.iter().map(|f| f.name.clone()).collect();
        if !yaml_folder_names.is_empty() {
            let placeholders: String = yaml_folder_names
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
                yaml_folder_names.iter().map(|s| s as &dyn duckdb::ToSql).collect();
            conn.execute(&sql_null, duckdb::params_from_iter(params_null.iter()))?;

            // folder 削除
            let sql_del = format!(
                "DELETE FROM folders WHERE name NOT IN ({})",
                placeholders
            );
            let params_del: Vec<&dyn duckdb::ToSql> =
                yaml_folder_names.iter().map(|s| s as &dyn duckdb::ToSql).collect();
            conn.execute(&sql_del, duckdb::params_from_iter(params_del.iter()))?;
        } else {
            // yaml に folder が0件 → 参照を NULL に → folder 削除
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

