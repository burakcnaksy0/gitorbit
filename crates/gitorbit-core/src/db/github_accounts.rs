/// Data-access object for the `github_accounts` table.
///
/// # Security
/// - NO token or secret is ever stored in or read from this table.
/// - `credential_ref` is an opaque key pointing to the OS credential store entry.
use crate::errors::CommandError;
use crate::models::{GitHubAccount, GitHubConnectionStatus};
use chrono::Utc;
use rusqlite::{Connection, params};

pub struct GitHubAccountDao;

impl GitHubAccountDao {
    // -----------------------------------------------------------------------
    // Write operations
    // -----------------------------------------------------------------------

    /// Inserts a new account or updates an existing one with the same
    /// (provider, provider_user_id) pair.  Never creates duplicate rows.
    pub fn upsert(conn: &Connection, account: &GitHubAccount) -> Result<(), CommandError> {
        conn.execute(
            r#"
            INSERT INTO github_accounts
                (id, provider, provider_user_id, login, display_name, avatar_url,
                 credential_ref, connection_status, created_at, last_used_at, token_expires_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            ON CONFLICT(provider, provider_user_id) DO UPDATE SET
                login             = excluded.login,
                display_name      = excluded.display_name,
                avatar_url        = excluded.avatar_url,
                credential_ref    = excluded.credential_ref,
                connection_status = excluded.connection_status,
                last_used_at      = excluded.last_used_at,
                token_expires_at  = excluded.token_expires_at
            "#,
            params![
                account.id,
                account.provider,
                account.provider_user_id,
                account.login,
                account.display_name,
                account.avatar_url,
                account.credential_ref,
                Self::status_to_str(account.connection_status),
                account.created_at,
                account.last_used_at,
                account.token_expires_at,
            ],
        )
        .map_err(|e| CommandError::database_error(format!("Hesap kaydedilemedi: {}", e)))?;
        Ok(())
    }

    /// Removes an account by its UUID.  Returns `true` if a row was deleted.
    pub fn remove(conn: &Connection, id: &str) -> Result<bool, CommandError> {
        let rows = conn
            .execute("DELETE FROM github_accounts WHERE id = ?1", params![id])
            .map_err(|e| CommandError::database_error(format!("Hesap silinemedi: {}", e)))?;
        Ok(rows > 0)
    }

    /// Updates the connection_status field without touching other columns.
    pub fn set_status(
        conn: &Connection,
        id: &str,
        status: GitHubConnectionStatus,
    ) -> Result<(), CommandError> {
        conn.execute(
            "UPDATE github_accounts SET connection_status = ?1 WHERE id = ?2",
            params![Self::status_to_str(status), id],
        )
        .map_err(|e| {
            CommandError::database_error(format!("Bağlantı durumu güncellenemedi: {}", e))
        })?;
        Ok(())
    }

    /// Touch `last_used_at` for the given account.
    pub fn touch_last_used(conn: &Connection, id: &str) -> Result<(), CommandError> {
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE github_accounts SET last_used_at = ?1 WHERE id = ?2",
            params![now, id],
        )
        .map_err(|e| {
            CommandError::database_error(format!("Son kullanım tarihi güncellenemedi: {}", e))
        })?;
        Ok(())
    }

    /// Stores (or clears) the access-token expiry timestamp. Only the RFC3339
    /// instant is written — never any token material.
    pub fn set_token_expires_at(
        conn: &Connection,
        id: &str,
        expires_at: Option<&str>,
    ) -> Result<(), CommandError> {
        conn.execute(
            "UPDATE github_accounts SET token_expires_at = ?1 WHERE id = ?2",
            params![expires_at, id],
        )
        .map_err(|e| {
            CommandError::database_error(format!("token_expires_at güncellenemedi: {}", e))
        })?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Read operations
    // -----------------------------------------------------------------------

    /// Returns all accounts ordered by created_at ascending.
    pub fn list(conn: &Connection) -> Result<Vec<GitHubAccount>, CommandError> {
        let mut stmt = conn
            .prepare(
                "SELECT id, provider, provider_user_id, login, display_name, avatar_url,
                        credential_ref, connection_status, created_at, last_used_at,
                        token_expires_at
                 FROM github_accounts
                 ORDER BY created_at ASC",
            )
            .map_err(|e| {
                CommandError::database_error(format!("Hesap sorgusu hazırlanamadı: {}", e))
            })?;

        let rows = stmt
            .query_map([], Self::row_to_account)
            .map_err(|e| CommandError::database_error(format!("Hesaplar alınamadı: {}", e)))?;

        let mut accounts = Vec::new();
        for row in rows {
            accounts.push(row.map_err(|e| {
                CommandError::database_error(format!("Hesap satırı okunamadı: {}", e))
            })?);
        }
        Ok(accounts)
    }

    /// Finds an account by UUID, returns `None` if not found.
    pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<GitHubAccount>, CommandError> {
        let mut stmt = conn
            .prepare(
                "SELECT id, provider, provider_user_id, login, display_name, avatar_url,
                        credential_ref, connection_status, created_at, last_used_at,
                        token_expires_at
                 FROM github_accounts WHERE id = ?1",
            )
            .map_err(|e| {
                CommandError::database_error(format!("Hesap sorgusu hazırlanamadı: {}", e))
            })?;

        let mut rows = stmt
            .query_map(params![id], Self::row_to_account)
            .map_err(|e| CommandError::database_error(format!("Hesap alınamadı: {}", e)))?;

        if let Some(r) = rows.next() {
            Ok(Some(r.map_err(|e| {
                CommandError::database_error(format!("Hesap satırı okunamadı: {}", e))
            })?))
        } else {
            Ok(None)
        }
    }

    /// Finds an account by (provider='github', provider_user_id).
    /// Used to detect duplicate logins.
    pub fn find_by_provider_user_id(
        conn: &Connection,
        provider_user_id: &str,
    ) -> Result<Option<GitHubAccount>, CommandError> {
        let mut stmt = conn
            .prepare(
                "SELECT id FROM github_accounts
                 WHERE provider = 'github' AND provider_user_id = ?1",
            )
            .map_err(|e| CommandError::database_error(format!("Sorgu hazırlanamadı: {}", e)))?;

        let mut ids = stmt
            .query_map(params![provider_user_id], |row| row.get::<_, String>(0))
            .map_err(|e| CommandError::database_error(format!("Sorgu çalıştırılamadı: {}", e)))?;

        if let Some(id_result) = ids.next() {
            let id = id_result
                .map_err(|e| CommandError::database_error(format!("ID alınamadı: {}", e)))?;
            Self::get_by_id(conn, &id)
        } else {
            Ok(None)
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn row_to_account(row: &rusqlite::Row<'_>) -> Result<GitHubAccount, rusqlite::Error> {
        let status_str: String = row.get(7)?;
        Ok(GitHubAccount {
            id: row.get(0)?,
            provider: row.get(1)?,
            provider_user_id: row.get(2)?,
            login: row.get(3)?,
            display_name: row.get(4)?,
            avatar_url: row.get(5)?,
            credential_ref: row.get(6)?,
            connection_status: Self::str_to_status(&status_str),
            created_at: row.get(8)?,
            last_used_at: row.get(9)?,
            token_expires_at: row.get(10)?,
        })
    }

    fn status_to_str(status: GitHubConnectionStatus) -> &'static str {
        match status {
            GitHubConnectionStatus::Connected => "connected",
            GitHubConnectionStatus::AuthRequired => "auth_required",
            GitHubConnectionStatus::AuthExpired => "auth_expired",
        }
    }

    fn str_to_status(s: &str) -> GitHubConnectionStatus {
        match s {
            "connected" => GitHubConnectionStatus::Connected,
            "auth_expired" => GitHubConnectionStatus::AuthExpired,
            _ => GitHubConnectionStatus::AuthRequired,
        }
    }
}
