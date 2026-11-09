use crate::errors::CommandError;
use crate::models::AppSettings;
use rusqlite::{Connection, OptionalExtension};
use serde_json::json;

/// Persists non-sensitive preferences in the `app_settings` key/value table.
///
/// SECURITY: credentials and tokens MUST NOT be written here. GitHub tokens
/// live exclusively in the OS credential store.
pub struct SettingsDao;

const SETTINGS_KEY: &str = "app_settings";

impl SettingsDao {
    pub fn get(conn: &Connection) -> Result<AppSettings, CommandError> {
        let raw: Option<String> = conn
            .query_row(
                "SELECT value_json FROM app_settings WHERE key = ?1",
                [SETTINGS_KEY],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| CommandError::database_error(format!("Ayarlar okunamadı: {}", e)))?;

        let Some(raw) = raw else {
            return Ok(AppSettings::default());
        };

        serde_json::from_str(&raw)
            .map_err(|e| {
                CommandError::database_error(format!("Ayarlar ayrıştırılamadı: {}", e))
                    .with_recovery_hint(
                        "Ayarlar bozulmuş olabilir; varsayılan değerler kullanılacaktır.",
                    )
            })
            .or_else(|_| Ok(AppSettings::default()))
    }

    pub fn save(conn: &Connection, settings: &AppSettings) -> Result<(), CommandError> {
        let value = serde_json::to_string(settings).map_err(|e| {
            CommandError::database_error(format!("Ayarlar serileştirilemedi: {}", e))
        })?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            r#"
            INSERT INTO app_settings (key, value_json, updated_at)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
                                           updated_at = excluded.updated_at
            "#,
            [SETTINGS_KEY, value.as_str(), now.as_str()],
        )
        .map_err(|e| CommandError::database_error(format!("Ayarlar kaydedilemedi: {}", e)))?;
        Ok(())
    }

    /// Persists only the active GitHub account id without touching other keys.
    pub fn set_active_account(
        conn: &Connection,
        account_id: Option<&str>,
    ) -> Result<AppSettings, CommandError> {
        let mut settings = Self::get(conn)?;
        settings.active_github_account_id = account_id.map(|s| s.to_string());
        Self::save(conn, &settings)?;
        Ok(settings)
    }

    /// Returns the raw settings JSON for diagnostics (never contains secrets).
    pub fn export_for_diagnostics(conn: &Connection) -> Result<String, CommandError> {
        let settings = Self::get(conn)?;
        serde_json::to_string_pretty(&json!({
            "theme": settings.theme,
            "default_clone_dir": settings.default_clone_dir,
            "diff_context_lines": settings.diff_context_lines,
            "log_level": settings.log_level,
            "confirm_destructive": settings.confirm_destructive
        }))
        .map_err(|e| CommandError::database_error(format!("Tanılama verisi üretilemedi: {}", e)))
    }
}
