use crate::db::Database;
use crate::db::settings::SettingsDao;
use crate::errors::CommandError;
use crate::models::{AppSettings, AppSettingsUpdate};

pub struct SettingsService;

impl SettingsService {
    pub fn get(db: &Database) -> Result<AppSettings, CommandError> {
        db.with_conn(SettingsDao::get)
    }

    pub fn update(db: &Database, update: AppSettingsUpdate) -> Result<AppSettings, CommandError> {
        let mut settings = Self::get(db)?;

        if let Some(theme) = update.theme {
            let theme = theme.trim().to_ascii_lowercase();
            if theme != "dark" && theme != "light" && theme != "system" {
                return Err(CommandError::new(
                    "VALIDATION_ERROR",
                    "Tema değeri dark, light veya system olmalıdır.",
                    true,
                ));
            }
            settings.theme = theme;
        }

        if let Some(dir) = update.default_clone_dir {
            let dir = dir.trim().to_string();
            settings.default_clone_dir = if dir.is_empty() { None } else { Some(dir) };
        }

        if let Some(lines) = update.diff_context_lines {
            settings.diff_context_lines = lines.clamp(1, 50);
        }

        if let Some(level) = update.log_level {
            let level = level.trim().to_ascii_lowercase();
            if !["error", "warn", "info", "debug"].contains(&level.as_str()) {
                return Err(CommandError::new(
                    "VALIDATION_ERROR",
                    "Log seviyesi error, warn, info veya debug olmalıdır.",
                    true,
                ));
            }
            settings.log_level = level;
        }

        if let Some(confirm) = update.confirm_destructive {
            settings.confirm_destructive = confirm;
        }

        if let Some(account_id) = update.active_github_account_id {
            let account_id = account_id.trim().to_string();
            settings.active_github_account_id = if account_id.is_empty() {
                None
            } else {
                Some(account_id)
            };
        }

        if let Some(auto_fetch) = update.auto_fetch {
            settings.auto_fetch = auto_fetch;
        }

        if let Some(minutes) = update.auto_fetch_minutes {
            settings.auto_fetch_minutes = minutes.clamp(1, 120);
        }

        if let Some(done) = update.onboarding_completed {
            settings.onboarding_completed = done;
        }

        db.with_conn(|conn| SettingsDao::save(conn, &settings))?;
        Ok(settings)
    }
}
