use crate::errors::CommandError;
use crate::models::RepositoryRecord;
use rusqlite::{Connection, OptionalExtension, params};

pub struct RepositoryDao;

impl RepositoryDao {
    pub fn insert(conn: &Connection, repo: &RepositoryRecord) -> Result<(), CommandError> {
        conn.execute(
            r#"
            INSERT INTO repositories (
                id, canonical_path, display_name, current_branch,
                last_opened_at, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
            params![
                repo.id,
                repo.canonical_path,
                repo.display_name,
                repo.current_branch,
                repo.last_opened_at,
                repo.created_at,
                repo.updated_at,
            ],
        )
        .map_err(|e| {
            if let rusqlite::Error::SqliteFailure(err, _) = &e
                && (err.extended_code == 2067 || err.extended_code == 1555)
            {
                return CommandError::repo_already_exists(format!(
                    "Bu repository yolu zaten kayıtlı: {}",
                    repo.canonical_path
                ));
            }
            CommandError::database_error(format!("Repository eklenemedi: {}", e))
        })?;

        Ok(())
    }

    pub fn list(conn: &Connection) -> Result<Vec<RepositoryRecord>, CommandError> {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT id, canonical_path, display_name, current_branch,
                       last_opened_at, created_at, updated_at, pinned
                FROM repositories
                ORDER BY COALESCE(last_opened_at, created_at) DESC
                "#,
            )
            .map_err(|e| {
                CommandError::database_error(format!("Repository listesi hazırlanamadı: {}", e))
            })?;

        let rows = stmt
            .query_map([], |row| {
                Ok(RepositoryRecord {
                    id: row.get(0)?,
                    canonical_path: row.get(1)?,
                    display_name: row.get(2)?,
                    current_branch: row.get(3)?,
                    last_opened_at: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                    missing: false,
                    pinned: row.get::<_, i64>(7)? != 0,
                })
            })
            .map_err(|e| {
                CommandError::database_error(format!("Repository kayıtları okunamadı: {}", e))
            })?;

        let mut list = Vec::new();
        for row in rows {
            list.push(row.map_err(|e| {
                CommandError::database_error(format!("Repository satırı ayrıştırılamadı: {}", e))
            })?);
        }

        Ok(list)
    }

    pub fn get_by_id(
        conn: &Connection,
        id: &str,
    ) -> Result<Option<RepositoryRecord>, CommandError> {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT id, canonical_path, display_name, current_branch,
                       last_opened_at, created_at, updated_at, pinned
                FROM repositories
                WHERE id = ?1
                "#,
            )
            .map_err(|e| CommandError::database_error(format!("Sorgu hazırlanamadı: {}", e)))?;

        stmt.query_row([id], |row| {
            Ok(RepositoryRecord {
                id: row.get(0)?,
                canonical_path: row.get(1)?,
                display_name: row.get(2)?,
                current_branch: row.get(3)?,
                last_opened_at: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                missing: false,
                pinned: row.get::<_, i64>(7)? != 0,
            })
        })
        .optional()
        .map_err(|e| CommandError::database_error(format!("Repository sorgulanamadı: {}", e)))
    }

    pub fn get_by_canonical_path(
        conn: &Connection,
        canonical_path: &str,
    ) -> Result<Option<RepositoryRecord>, CommandError> {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT id, canonical_path, display_name, current_branch,
                       last_opened_at, created_at, updated_at, pinned
                FROM repositories
                WHERE canonical_path = ?1
                "#,
            )
            .map_err(|e| CommandError::database_error(format!("Sorgu hazırlanamadı: {}", e)))?;

        stmt.query_row([canonical_path], |row| {
            Ok(RepositoryRecord {
                id: row.get(0)?,
                canonical_path: row.get(1)?,
                display_name: row.get(2)?,
                current_branch: row.get(3)?,
                last_opened_at: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                missing: false,
                pinned: row.get::<_, i64>(7)? != 0,
            })
        })
        .optional()
        .map_err(|e| CommandError::database_error(format!("Repository sorgulanamadı: {}", e)))
    }

    /// Removes the repository registration from the database.
    /// CRITICAL: Under no circumstances does this delete or touch the physical folder on disk!
    pub fn remove(conn: &Connection, id: &str) -> Result<bool, CommandError> {
        let rows_affected = conn
            .execute("DELETE FROM repositories WHERE id = ?1", [id])
            .map_err(|e| CommandError::database_error(format!("Repository silinemedi: {}", e)))?;

        Ok(rows_affected > 0)
    }

    pub fn update_last_opened(
        conn: &Connection,
        id: &str,
        opened_at: &str,
    ) -> Result<(), CommandError> {
        conn.execute(
            "UPDATE repositories SET last_opened_at = ?1, updated_at = ?1 WHERE id = ?2",
            [opened_at, id],
        )
        .map_err(|e| CommandError::database_error(format!("last_opened güncellenemedi: {}", e)))?;

        Ok(())
    }

    /// Updates the canonical path after a user re-links a moved repository.
    pub fn update_path(
        conn: &Connection,
        id: &str,
        canonical_path: &str,
        display_name: &str,
        current_branch: Option<&str>,
    ) -> Result<(), CommandError> {
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE repositories SET canonical_path = ?1, display_name = ?2, current_branch = ?3, updated_at = ?4 WHERE id = ?5",
            params![canonical_path, display_name, current_branch, now, id],
        )
        .map_err(|e| {
            if let rusqlite::Error::SqliteFailure(err, _) = &e
                && (err.extended_code == 2067 || err.extended_code == 1555)
            {
                return CommandError::repo_already_exists(
                    "Bu repository yolu başka bir kayıtta zaten mevcut.",
                );
            }
            CommandError::database_error(format!("Repository yolu güncellenemedi: {}", e))
        })?;

        Ok(())
    }

    pub fn update_current_branch(
        conn: &Connection,
        id: &str,
        branch: Option<&str>,
    ) -> Result<(), CommandError> {
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE repositories SET current_branch = ?1, updated_at = ?2 WHERE id = ?3",
            params![branch, now, id],
        )
        .map_err(|e| {
            CommandError::database_error(format!("current_branch güncellenemedi: {}", e))
        })?;

        Ok(())
    }

    /// v0.2 madde 10 — sabitleme bayrağını günceller.
    pub fn set_pinned(conn: &Connection, id: &str, pinned: bool) -> Result<(), CommandError> {
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE repositories SET pinned = ?1, updated_at = ?2 WHERE id = ?3",
            params![pinned as i64, now, id],
        )
        .map_err(|e| CommandError::database_error(format!("pinned güncellenemedi: {}", e)))?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    fn record(id: &str, path: &str) -> RepositoryRecord {
        RepositoryRecord {
            id: id.to_string(),
            canonical_path: path.to_string(),
            display_name: path.to_string(),
            current_branch: Some("main".to_string()),
            last_opened_at: Some("2026-01-01T00:00:00Z".to_string()),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            missing: false,
            pinned: false,
        }
    }

    #[test]
    fn new_database_has_pinned_column_defaulting_to_false() {
        let db = Database::in_memory().unwrap();
        db.with_conn(|conn| RepositoryDao::insert(conn, &record("r1", "/x/repo1")))
            .unwrap();
        let list = db.with_conn(RepositoryDao::list).unwrap();
        assert_eq!(list.len(), 1);
        assert!(!list[0].pinned, "yeni kayit sabitsiz dogmali");
    }

    #[test]
    fn set_pinned_roundtrips_through_list_and_get_by_id() {
        let db = Database::in_memory().unwrap();
        db.with_conn(|conn| RepositoryDao::insert(conn, &record("r1", "/x/repo1")))
            .unwrap();
        db.with_conn(|conn| RepositoryDao::insert(conn, &record("r2", "/x/repo2")))
            .unwrap();

        db.with_conn(|conn| RepositoryDao::set_pinned(conn, "r2", true))
            .unwrap();

        let list = db.with_conn(RepositoryDao::list).unwrap();
        let pinned_ids: Vec<&str> = list.iter().filter(|r| r.pinned).map(|r| r.id.as_str()).collect();
        assert_eq!(pinned_ids, vec!["r2"]);

        let fetched = db
            .with_conn(|conn| RepositoryDao::get_by_id(conn, "r2"))
            .unwrap()
            .unwrap();
        assert!(fetched.pinned);

        // toggle geri alinabilir
        db.with_conn(|conn| RepositoryDao::set_pinned(conn, "r2", false))
            .unwrap();
        let fetched = db
            .with_conn(|conn| RepositoryDao::get_by_id(conn, "r2"))
            .unwrap()
            .unwrap();
        assert!(!fetched.pinned);
    }

    #[test]
    fn migrations_are_idempotent_after_pinned_column() {
        use crate::db::migrations::MigrationManager;
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        // ayni connection'a migration'i ikinci kez uygulamak patlamamali
        MigrationManager::apply_migrations(&mut conn).unwrap();
        MigrationManager::apply_migrations(&mut conn).unwrap();
        let list = RepositoryDao::list(&conn).unwrap();
        assert!(list.is_empty());
    }
}
