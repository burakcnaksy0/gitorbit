pub mod github_accounts;
pub mod migrations;
pub mod repositories;
pub mod settings;

use crate::errors::CommandError;
use migrations::MigrationManager;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
    db_path: Option<PathBuf>,
}

impl Database {
    /// Opens or creates SQLite database at the given path and applies migrations.
    pub fn open(path: &Path) -> Result<Self, CommandError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                CommandError::io_error(format!("Veritabani dizini olusturulamadi: {}", e))
            })?;
        }

        let mut conn = Connection::open(path).map_err(|e| {
            CommandError::database_error(format!("SQLite veritabani acilamadi: {}", e))
        })?;

        MigrationManager::apply_migrations(&mut conn)?;

        // WAL dosyasının sınırsız büyümesini sınırla (checkpoint sonrası 4 MB
        // üstü kırpılır). Best-effort: başarısızlık açmayı engellemez.
        let _ = conn.pragma_update(None, "journal_size_limit", 4 * 1024 * 1024);

        // WP-5: ikinci bir uygulama örneği / sarkmış write ile anlık SQLITE_BUSY
        // yerine 5 sn bekleyip dene (WAL'da okuyucular zaten bloklanmaz).
        let _ = conn.pragma_update(None, "busy_timeout", 5000);

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            db_path: Some(path.to_path_buf()),
        })
    }

    /// Opens the default per-user database in a platform-appropriate data directory.
    ///
    /// - Linux/macOS: `$XDG_DATA_HOME/gitorbit/gitorbit.db`
    ///   (falls back to `$HOME/.local/share/gitorbit/gitorbit.db`)
    /// - Windows: `%APPDATA%\gitorbit\gitorbit.db`
    pub fn open_default() -> Result<Self, CommandError> {
        let data_dir = Self::resolve_data_dir()?;
        let db_path = data_dir.join("gitorbit.db");
        Self::open(&db_path)
    }

    /// Resolves the platform data directory for GitOrbit.
    fn resolve_data_dir() -> Result<PathBuf, CommandError> {
        // Try XDG_DATA_HOME first (Linux/macOS)
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME")
            && !xdg.is_empty()
        {
            return Ok(PathBuf::from(xdg).join("gitorbit"));
        }
        // Fall back to $HOME/.local/share on Unix, %APPDATA% on Windows
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .map_err(|_| {
                CommandError::io_error(
                    "Ev dizini tespit edilemedi (HOME ve USERPROFILE ayarlanmamis)",
                )
            })?;
        #[cfg(windows)]
        {
            if let Ok(appdata) = std::env::var("APPDATA") {
                return Ok(PathBuf::from(appdata).join("gitorbit"));
            }
        }
        Ok(PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("gitorbit"))
    }

    /// Creates an in-memory SQLite database with migrations applied, ideal for unit testing.
    pub fn in_memory() -> Result<Self, CommandError> {
        let mut conn = Connection::open_in_memory().map_err(|e| {
            CommandError::database_error(format!("In-memory veritabanı açılamadı: {}", e))
        })?;

        MigrationManager::apply_migrations(&mut conn)?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            db_path: None,
        })
    }

    /// Acquires a lock on the database connection to run an operation.
    pub fn with_conn<F, T>(&self, f: F) -> Result<T, CommandError>
    where
        F: FnOnce(&Connection) -> Result<T, CommandError>,
    {
        let conn = self.conn.lock().map_err(|_| {
            CommandError::database_error("Veritabanı kilitlenme hatası (poisoned mutex)")
        })?;
        f(&conn)
    }

    pub fn path(&self) -> Option<&PathBuf> {
        self.db_path.as_ref()
    }

    /// Uygulama kapanırken WAL dosyasını ana veritabanına eritir
    /// (TRUNCATE). Uzun süre çalışan oturumlarda -wal dosyasının yüzlerce MB
    /// olmasını ve anormal kapanışta veri kaybı yüzeyini azaltır.
    /// Best-effort: hata durumunda Err döner ama çağıran görmezden gelebilir.
    pub fn checkpoint_wal(&self) -> Result<(), CommandError> {
        self.with_conn(|conn| {
            conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
                .map_err(|e| CommandError::database_error(format!("WAL checkpoint: {}", e)))
        })
    }
}
