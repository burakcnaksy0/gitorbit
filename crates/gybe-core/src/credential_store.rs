/// Gybe credential store abstraction.
///
/// # Security contract
/// - Secrets (OAuth tokens) MUST be stored ONLY via this interface.
/// - If the OS credential store is unavailable, `CREDENTIAL_STORE_UNAVAILABLE` is returned.
/// - Plaintext fallback (file, SQLite, env var) is FORBIDDEN.
/// - Tokens MUST NEVER appear in logs, IPC responses, or DB rows.
use crate::errors::CommandError;

// ---------------------------------------------------------------------------
// Trait
// ---------------------------------------------------------------------------

pub trait CredentialStore: Send + Sync {
    /// Store `secret` under `key`.  Overwrites if key already exists.
    fn set_credential(&self, key: &str, secret: &str) -> Result<(), CommandError>;

    /// Retrieve the secret stored under `key`.
    /// Returns `NO_CREDENTIAL` if the key does not exist.
    fn get_credential(&self, key: &str) -> Result<String, CommandError>;

    /// Remove the entry for `key`. Returns `Ok(())` even if the key did not exist.
    fn delete_credential(&self, key: &str) -> Result<(), CommandError>;
}

// ---------------------------------------------------------------------------
// Production implementation — OS keyring
// ---------------------------------------------------------------------------

/// Uses the platform keyring (GNOME Keyring / SecretService on Linux,
/// Keychain on macOS, Credential Manager on Windows).
pub struct OsCredentialStore;

const KEYRING_SERVICE: &str = "gybe";

impl CredentialStore for OsCredentialStore {
    fn set_credential(&self, key: &str, secret: &str) -> Result<(), CommandError> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| {
            CommandError::credential_store_unavailable(format!(
                "Kimlik deposu girişi oluşturulamadı: {}",
                e
            ))
        })?;
        entry.set_password(secret).map_err(|e| {
            CommandError::credential_store_unavailable(format!("Kimlik kaydedilemedi: {}", e))
        })
    }

    fn get_credential(&self, key: &str) -> Result<String, CommandError> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| {
            CommandError::credential_store_unavailable(format!(
                "Kimlik deposu girişi oluşturulamadı: {}",
                e
            ))
        })?;
        entry.get_password().map_err(|e| match e {
            keyring::Error::NoEntry => {
                CommandError::new("NO_CREDENTIAL", "Saklanan kimlik bulunamadı.", true)
            }
            other => {
                CommandError::credential_store_unavailable(format!("Kimlik alınamadı: {}", other))
            }
        })
    }

    fn delete_credential(&self, key: &str) -> Result<(), CommandError> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| {
            CommandError::credential_store_unavailable(format!(
                "Kimlik deposu girişi oluşturulamadı: {}",
                e
            ))
        })?;
        match entry.delete_password() {
            Ok(_) => Ok(()),
            // If the entry doesn't exist, treat it as success (idempotent delete).
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(CommandError::credential_store_unavailable(format!(
                "Kimlik silinemedi: {}",
                e
            ))),
        }
    }
}

// ---------------------------------------------------------------------------
// Test-only in-memory implementation
// ---------------------------------------------------------------------------

/// In-memory credential store for unit/integration tests.
/// MUST NOT be used in production code.
#[cfg(any(test, feature = "test-support"))]
pub struct InMemoryCredentialStore {
    store: std::sync::Mutex<std::collections::HashMap<String, String>>,
}

#[cfg(any(test, feature = "test-support"))]
impl InMemoryCredentialStore {
    pub fn new() -> Self {
        Self {
            store: std::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }
}

#[cfg(any(test, feature = "test-support"))]
impl Default for InMemoryCredentialStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(any(test, feature = "test-support"))]
impl CredentialStore for InMemoryCredentialStore {
    fn set_credential(&self, key: &str, secret: &str) -> Result<(), CommandError> {
        self.store
            .lock()
            .unwrap()
            .insert(key.to_string(), secret.to_string());
        Ok(())
    }

    fn get_credential(&self, key: &str) -> Result<String, CommandError> {
        self.store
            .lock()
            .unwrap()
            .get(key)
            .cloned()
            .ok_or_else(|| CommandError::new("NO_CREDENTIAL", "Saklanan kimlik bulunamadı.", true))
    }

    fn delete_credential(&self, key: &str) -> Result<(), CommandError> {
        self.store.lock().unwrap().remove(key);
        Ok(())
    }
}
