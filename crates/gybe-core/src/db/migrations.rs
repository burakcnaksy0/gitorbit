use crate::errors::CommandError;
use chrono::Utc;
use rusqlite::Connection;

pub struct MigrationManager;

impl MigrationManager {
    pub fn apply_migrations(conn: &mut Connection) -> Result<(), CommandError> {
        // Enforce foreign keys and WAL mode
        conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            "#,
        )
        .map_err(|e| {
            CommandError::database_error(format!("SQLite pragma yapılandırılamadı: {}", e))
        })?;

        // 1. Create schema_migrations table
        conn.execute(
            r#"
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );
            "#,
            [],
        )
        .map_err(|e| {
            CommandError::database_error(format!("Migration tablosu oluşturulamadı: {}", e))
        })?;

        // 2. Migration 1: Initial schema (repositories and app_settings)
        let current_version: Option<i32> = conn
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap_or(None);

        if current_version.unwrap_or(0) < 1 {
            let tx = conn.transaction().map_err(|e| {
                CommandError::database_error(format!("Transaction başlatılamadı: {}", e))
            })?;

            tx.execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS repositories (
                    id TEXT PRIMARY KEY,
                    canonical_path TEXT NOT NULL UNIQUE,
                    display_name TEXT NOT NULL,
                    current_branch TEXT,
                    last_opened_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                "#,
            )
            .map_err(|e| {
                CommandError::database_error(format!("Migration 1 tabloları oluşturulamadı: {}", e))
            })?;

            let now = Utc::now().to_rfc3339();
            tx.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?1)",
                [&now],
            )
            .map_err(|e| {
                CommandError::database_error(format!("Migration 1 kaydedilemedi: {}", e))
            })?;

            tx.commit().map_err(|e| {
                CommandError::database_error(format!("Migration 1 commit edilemedi: {}", e))
            })?;
        }

        // Migration 2: github_accounts table
        // SECURITY: No token/secret is stored in this table.
        // Only non-sensitive metadata + credential_ref (key into OS keyring, NOT the token).
        if current_version.unwrap_or(0) < 2 {
            let tx = conn.transaction().map_err(|e| {
                CommandError::database_error(format!("Transaction başlatılamadı: {}", e))
            })?;

            tx.execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS github_accounts (
                    id TEXT PRIMARY KEY,
                    provider TEXT NOT NULL CHECK (provider = 'github'),
                    provider_user_id TEXT NOT NULL,
                    login TEXT NOT NULL,
                    display_name TEXT,
                    avatar_url TEXT,
                    credential_ref TEXT NOT NULL,
                    connection_status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_used_at TEXT,
                    UNIQUE(provider, provider_user_id)
                );
                "#,
            )
            .map_err(|e| {
                CommandError::database_error(format!("Migration 2 tablosu oluşturulamadı: {}", e))
            })?;

            let now_m2 = Utc::now().to_rfc3339();
            tx.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?1)",
                [&now_m2],
            )
            .map_err(|e| {
                CommandError::database_error(format!("Migration 2 kaydedilemedi: {}", e))
            })?;

            tx.commit().map_err(|e| {
                CommandError::database_error(format!("Migration 2 commit edilemedi: {}", e))
            })?;
        }

        // Migration 3: v0.2 madde 10 — depolar için sabitleme bayrağı.
        if current_version.unwrap_or(0) < 3 {
            let tx = conn.transaction().map_err(|e| {
                CommandError::database_error(format!("Transaction başlatılamadı: {}", e))
            })?;

            tx.execute_batch(
                r#"
                ALTER TABLE repositories
                    ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
                "#,
            )
            .map_err(|e| {
                CommandError::database_error(format!("Migration 3 tablosu güncellenemedi: {}", e))
            })?;

            let now_m3 = Utc::now().to_rfc3339();
            tx.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (3, ?1)",
                [&now_m3],
            )
            .map_err(|e| {
                CommandError::database_error(format!("Migration 3 kaydedilemedi: {}", e))
            })?;

            tx.commit().map_err(|e| {
                CommandError::database_error(format!("Migration 3 commit edilemedi: {}", e))
            })?;
        }

        // Migration 4: OAuth access token bitiş zamanı (github_accounts).
        // SECURITY: yalnızca bitiş ZAMANI saklanır (RFC3339) — token'ın
        // kendisi değil. Yenileme kararında kullanılır.
        if current_version.unwrap_or(0) < 4 {
            let tx = conn.transaction().map_err(|e| {
                CommandError::database_error(format!("Transaction başlatılamadı: {}", e))
            })?;

            tx.execute_batch(
                r#"
                ALTER TABLE github_accounts
                    ADD COLUMN token_expires_at TEXT;
                "#,
            )
            .map_err(|e| {
                CommandError::database_error(format!("Migration 4 tablosu güncellenemedi: {}", e))
            })?;

            let now_m4 = Utc::now().to_rfc3339();
            tx.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (4, ?1)",
                [&now_m4],
            )
            .map_err(|e| {
                CommandError::database_error(format!("Migration 4 kaydedilemedi: {}", e))
            })?;

            tx.commit().map_err(|e| {
                CommandError::database_error(format!("Migration 4 commit edilemedi: {}", e))
            })?;
        }

        Ok(())
    }
}
