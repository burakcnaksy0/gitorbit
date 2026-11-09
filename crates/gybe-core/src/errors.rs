use serde::{Deserialize, Serialize};
use std::fmt;

/// Stable, serialisable error contract shared by the Rust core and the UI.
///
/// Invariants (Engineering Specification §3.2, GT-018):
/// - `message`, `safe_details` and `recovery_hint` NEVER contain tokens,
///   passwords, Authorization headers or credentials embedded in URLs.
/// - `recoverable` is kept for backwards compatibility; `retryable` is the
///   spec-aligned field. They are normally identical.
/// - `correlation_id` is a non-sensitive identifier used to match UI reports
///   with developer logs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommandError {
    pub code: String,
    pub message: String,
    pub recoverable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub safe_details: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery_hint: Option<String>,
    pub retryable: bool,
    pub correlation_id: String,
}

impl CommandError {
    pub fn new(code: impl Into<String>, message: impl Into<String>, recoverable: bool) -> Self {
        Self::with_details(code, message, recoverable, None, None)
    }

    pub fn with_details(
        code: impl Into<String>,
        message: impl Into<String>,
        recoverable: bool,
        safe_details: Option<String>,
        recovery_hint: Option<String>,
    ) -> Self {
        Self {
            code: code.into(),
            message: redact_sensitive(&message.into()),
            recoverable,
            safe_details: safe_details.map(|s| redact_sensitive(&s)),
            recovery_hint,
            retryable: recoverable,
            correlation_id: uuid::Uuid::new_v4().to_string(),
        }
    }

    /// Adds a user-facing recovery hint, e.g. "Run `git pull` first".
    pub fn with_recovery_hint(mut self, hint: impl Into<String>) -> Self {
        self.recovery_hint = Some(hint.into());
        self
    }

    /// Adds redacted technical details intended for the UI's expandable area.
    pub fn with_safe_details(mut self, details: impl Into<String>) -> Self {
        self.safe_details = Some(redact_sensitive(&details.into()));
        self
    }

    pub fn git_not_installed(msg: impl Into<String>) -> Self {
        Self::new("GIT_NOT_INSTALLED", msg, false).with_recovery_hint(
            "Git'i https://git-scm.com/downloads adresinden kurun ve uygulamayı yeniden başlatın.",
        )
    }

    pub fn not_a_git_repository(msg: impl Into<String>) -> Self {
        Self::new("NOT_A_GIT_REPOSITORY", msg, true)
            .with_recovery_hint("Geçerli bir Git deposunun kök klasörünü seçin.")
    }

    pub fn repo_not_found(msg: impl Into<String>) -> Self {
        Self::new("REPO_NOT_FOUND", msg, true).with_recovery_hint(
            "Depo taşınmış veya silinmiş olabilir. Yeniden bağlayın ya da kaydı kaldırın.",
        )
    }

    pub fn repo_already_exists(msg: impl Into<String>) -> Self {
        Self::new("REPO_ALREADY_EXISTS", msg, false)
    }

    pub fn repository_busy(msg: impl Into<String>) -> Self {
        Self::new("REPOSITORY_BUSY", msg, true)
            .with_recovery_hint("Devam eden işlem bitene kadar bekleyip tekrar deneyin.")
    }

    pub fn invalid_path(msg: impl Into<String>) -> Self {
        Self::new("INVALID_PATH", msg, true)
    }

    pub fn io_error(msg: impl Into<String>) -> Self {
        Self::new("IO_ERROR", msg, true)
    }

    pub fn database_error(msg: impl Into<String>) -> Self {
        Self::new("DATABASE_ERROR", msg, false)
    }

    // ---- Phase 6: GitHub / credential store errors ----

    pub fn auth_required(msg: impl Into<String>) -> Self {
        Self::new("AUTH_REQUIRED", msg, true)
            .with_recovery_hint("GitHub hesabını yeniden bağlayın.")
    }

    pub fn auth_expired(msg: impl Into<String>) -> Self {
        Self::new("AUTH_EXPIRED", msg, true).with_recovery_hint("GitHub hesabını yeniden bağlayın.")
    }

    pub fn rate_limited(msg: impl Into<String>) -> Self {
        Self::new("RATE_LIMITED", msg, true)
            .with_recovery_hint("GitHub API sınırı sıfırlanana kadar bekleyin.")
    }

    pub fn permission_denied(msg: impl Into<String>) -> Self {
        Self::new("PERMISSION_DENIED", msg, true)
    }

    /// Returned when the OS credential store (keyring) is unavailable.
    /// MUST NOT fall back to plaintext storage.
    pub fn credential_store_unavailable(msg: impl Into<String>) -> Self {
        Self::new("CREDENTIAL_STORE_UNAVAILABLE", msg, false)
    }

    pub fn network_error(msg: impl Into<String>) -> Self {
        Self::new("NETWORK_ERROR", msg, true)
            .with_recovery_hint("İnternet bağlantınızı ve uzak depo adresini kontrol edin.")
    }

    /// Returned when the OAuth session token does not match the pending state.
    pub fn oauth_state_mismatch(msg: impl Into<String>) -> Self {
        Self::new("OAUTH_STATE_MISMATCH", msg, false)
    }

    pub fn device_flow_expired(msg: impl Into<String>) -> Self {
        Self::new("DEVICE_FLOW_EXPIRED", msg, true)
    }

    /// Returned when the device-flow poll finds the user has not yet authorised.
    pub fn device_flow_pending(msg: impl Into<String>) -> Self {
        Self::new("DEVICE_FLOW_PENDING", msg, true)
    }

    pub fn github_api_error(http_status: u16, msg: impl Into<String>) -> Self {
        let code = match http_status {
            401 => "AUTH_REQUIRED",
            403 => "PERMISSION_DENIED",
            404 => "NOT_FOUND",
            422 => "VALIDATION_ERROR",
            _ if http_status >= 500 => "SERVER_ERROR",
            _ => "GITHUB_API_ERROR",
        };
        Self::new(code, msg, http_status >= 500 || http_status == 404)
    }
}

impl fmt::Display for CommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}]: {}", self.code, self.message)
    }
}

impl std::error::Error for CommandError {}

/// Removes common credential shapes from free-form text before it is shown in
/// the UI or written to logs.
///
/// This is defence-in-depth: callers should still avoid putting secrets into
/// error messages in the first place.
pub fn redact_sensitive(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut rest = input;

    while let Some(idx) = rest.find("://") {
        output.push_str(&rest[..idx + 3]);
        rest = &rest[idx + 3..];

        // Authority section ends at the first '/', whitespace, or quote.
        let auth_end = rest
            .find(|c: char| c == '/' || c.is_whitespace() || c == '"' || c == '\'')
            .unwrap_or(rest.len());
        let authority = &rest[..auth_end];

        if let Some(at) = authority.rfind('@') {
            let userinfo = &authority[..at];
            // GO-06c: şema kontrolü — ssh:// dışındaki URL'lerde userinfo'nın
            // tamamı kimlik bilgisidir (PAT gömülü https://ghp_xxx@github.com
            // gibi) ve her halükarda maskelenir. ssh:// düz kullanıcı adını
            // korur (git@host), ama ':' varsa (user:pass) o da maskelenir.
            let scheme_is_ssh = {
                let lower = output.to_ascii_lowercase();
                lower.rfind("://").map(|s| {
                    let scheme_start = lower[..s]
                        .rfind(|c: char| {
                            !(c.is_ascii_alphanumeric() || c == '+' || c == '-' || c == '.')
                        })
                        .map(|i| i + 1)
                        .unwrap_or(0);
                    &lower[scheme_start..s] == "ssh"
                }) == Some(true)
            };
            if userinfo.contains(':') || !scheme_is_ssh {
                output.push_str("***@");
            } else {
                output.push_str(userinfo);
                output.push('@');
            }
            output.push_str(&authority[at + 1..]);
        } else {
            output.push_str(authority);
        }
        rest = &rest[auth_end..];
    }
    output.push_str(rest);

    let output = redact_key_values(&output);
    scrub_token_shapes(&output)
}

/// GO-06c: GitHub token BİÇİMLERİNİ (gh[pousr]_..., github_pat_...) metnin
/// neresinde olurlarsa olsunlar temizler. Bazı git/HTTP hata gövdeleri token'ı
/// key=value yapılarında değil serbest halde basar; bu son savunma katmanıdır.
fn scrub_token_shapes(input: &str) -> String {
    const TOKEN_PREFIXES: [&str; 6] = ["ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_"];
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < bytes.len() {
        let matched = TOKEN_PREFIXES.iter().find(|p| {
            let pb = p.as_bytes();
            if i + pb.len() > bytes.len() || &bytes[i..i + pb.len()] != pb {
                return false;
            }
            // gövde en az 16 alfanümerik karakter: "ghp_" ile başlayan normal
            // kelimelerde yanlış-pozitif üretmemek için
            let mut n = 0;
            let mut j = i + pb.len();
            while j < bytes.len() && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_') {
                n += 1;
                j += 1;
            }
            n >= 16
        });
        if let Some(p) = matched {
            out.push_str("***");
            i += p.len();
            while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
                i += 1;
            }
        } else {
            // ASCII ön ekler yalnızca karakter sınırında eşleşebilir; UTF-8
            // sınırına saygılı tek karakter kopyalama
            let ch = input[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

fn redact_key_values(input: &str) -> String {
    const SENSITIVE_KEYS: &[&str] = &[
        "access_token",
        "refresh_token",
        "token",
        "password",
        "passwd",
        "client_secret",
        "authorization",
        "api_key",
        "apikey",
    ];

    let mut result = String::with_capacity(input.len());
    for (line_idx, line) in input.split('\n').enumerate() {
        if line_idx > 0 {
            result.push('\n');
        }

        if line
            .to_ascii_lowercase()
            .trim_start()
            .starts_with("authorization:")
        {
            result.push_str("Authorization: ***");
            continue;
        }

        let mut remaining = line;
        let mut sanitized = String::with_capacity(line.len());
        loop {
            let lower = remaining.to_ascii_lowercase();
            let mut next: Option<(usize, &str)> = None;
            for key in SENSITIVE_KEYS {
                if let Some(pos) = lower.find(key) {
                    let boundary_ok =
                        pos == 0 || !lower.as_bytes()[pos - 1].is_ascii_alphanumeric();
                    if boundary_ok && next.map(|(p, _)| pos < p).unwrap_or(true) {
                        next = Some((pos, key));
                    }
                }
            }

            let Some((pos, key)) = next else {
                sanitized.push_str(remaining);
                break;
            };

            sanitized.push_str(&remaining[..pos + key.len()]);
            let after_key = &remaining[pos + key.len()..];
            let trimmed = after_key.trim_start();
            if let Some(value) = trimmed
                .strip_prefix('=')
                .or_else(|| trimmed.strip_prefix(':'))
            {
                sanitized.push('=');
                sanitized.push_str("***");
                // Skip the value up to the next separator.
                let value_trimmed = value.trim_start();
                let end = value_trimmed
                    .find(|c: char| c == '&' || c == ',' || c.is_whitespace())
                    .unwrap_or(value_trimmed.len());
                remaining = &value_trimmed[end..];
            } else {
                remaining = after_key;
            }
        }
        result.push_str(&sanitized);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_credentials_in_urls() {
        let msg = "fatal: unable to access 'https://user:secret@example.com/repo.git/'";
        let redacted = redact_sensitive(msg);
        assert!(!redacted.contains("secret"));
        assert!(redacted.contains("https://***@example.com"));
    }

    #[test]
    fn redacts_token_query_parameters() {
        let msg = "GET https://api.github.com/repos?access_token=abc123&page=1 failed";
        let redacted = redact_sensitive(msg);
        assert!(!redacted.contains("abc123"));
        assert!(redacted.contains("access_token=***"));
    }

    #[test]
    fn keeps_plain_ssh_user() {
        let msg = "git@github.com:org/repo.git";
        let redacted = redact_sensitive(msg);
        assert_eq!(redacted, msg);
    }

    #[test]
    fn error_constructor_redacts_message() {
        let err = CommandError::new(
            "NETWORK_ERROR",
            "https://x-access-token:ghp_secret@github.com/org/repo.git",
            true,
        );
        assert!(!err.message.contains("ghp_secret"));
        assert!(!err.correlation_id.is_empty());
        assert!(err.retryable);
    }

    #[test]
    fn redacts_pat_embedded_as_https_userinfo() {
        // GO-06c: ':' İÇERMEYEN userinfo (doğrudan PAT) de maskelenmeli
        let redacted = redact_sensitive(
            "fatal: access to https://ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef12@github.com/org/repo.git denied",
        );
        assert!(!redacted.contains("ghp_ABCDEFGHIJ"));
        assert!(redacted.contains("https://***@github.com"));
        // ssh:// düz kullanıcı adı korunur
        let ssh = "ssh://git@github.com/org/repo.git";
        assert_eq!(redact_sensitive(ssh), ssh);
        // ssh:// içinde user:pass varsa o maskelenir
        let ssh_pass = redact_sensitive("ssh://bob:hunter2@github.com/org/repo.git");
        assert!(!ssh_pass.contains("hunter2"));
    }

    #[test]
    fn scrubs_bare_token_shapes() {
        // GO-06c: key=value yapısı dışında basılmış token'lar
        let msg = "remote: invalid token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef12 supplied";
        let redacted = redact_sensitive(msg);
        assert!(!redacted.contains("ghp_ABCDEFGHIJ"));
        assert!(redacted.contains("***"));

        let fine = "ghu_short not a real token body here";
        assert_eq!(redact_sensitive(fine), fine);
    }
}
