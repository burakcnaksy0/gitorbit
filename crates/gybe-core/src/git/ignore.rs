use crate::errors::CommandError;
use crate::git::adapter::GitAdapter;
use crate::models::IgnoredFile;
use std::path::Path;
use std::time::Duration;

const WRITE_TIMEOUT: Duration = Duration::from_secs(10);

/// "Yoksay" akışı: untracked bir dosya/dizin `.gitignore`'a (versiyonlu) veya
/// `.git/info/exclude`'a (yalnız bu makine) eklenir.
///
/// Desen her zaman kökene sabitlenmiş mutlak depo-yoludur (`/yol/dosya`):
/// alt dizinlerdeki `!` desenlerini ve ada-göre-match sürprizlerini engeller.
pub struct GitIgnoreManager;

impl GitIgnoreManager {
    /// Depo-yolundan (status çıktısı) kök-eşli gitignore deseni üretir.
    /// Dizinler `/` ile biter. Saf fonksiyon — birim testli.
    pub fn derive_pattern(repo_path: &str, is_dir: bool) -> String {
        let trimmed = repo_path.trim().trim_matches('/');
        let mut pattern = format!("/{}", trimmed.replace('\\', "/"));
        if is_dir && !pattern.ends_with('/') {
            pattern.push('/');
        }
        pattern
    }

    /// Mevcut dosya içeriğinde desen zaten (trim edilmiş satır olarak) var mı?
    /// Saf fonksiyon — duplicate eklemeyi önler.
    pub fn pattern_present(content: &str, pattern: &str) -> bool {
        content
            .lines()
            .any(|line| line.trim() == pattern && !pattern.is_empty())
    }

    /// `info/exclude`'un GERÇEK ev sahibi git dizini: tekil repoda `.git`,
    /// linked worktree/submodule'da ORTAK dizin (`--git-common-dir`).
    /// Eski git'lerde common-dir anahtarı yoksa `--git-dir`'e düşülür.
    fn resolve_common_git_dir(repo_dir: &Path) -> Option<std::path::PathBuf> {
        for arg in ["--git-common-dir", "--git-dir"] {
            if let Ok(out) =
                GitAdapter::execute_with_timeout(repo_dir, &["rev-parse", arg], WRITE_TIMEOUT)
                && out.status.success()
            {
                let raw = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if raw.is_empty() {
                    continue;
                }
                let p = if std::path::Path::new(&raw).is_absolute() {
                    std::path::PathBuf::from(raw)
                } else {
                    repo_dir.join(raw)
                };
                // Git 2.31 öncesi common-dir, worktree'da yanlış adres
                // verebiliyordu; klasör değilse sıradaki anahtarı dene.
                if p.is_dir() {
                    return Some(p);
                }
            }
        }
        None
    }

    /// `path` depo-yolundaki öğeyi `scope` kapsamlı ignore dosyasına ekler.
    /// `scope`: `"repo"` → `.gitignore`, `"local"` → `.git/info/exclude`.
    pub fn ignore(repo_dir: &Path, path: &str, scope: &str) -> Result<IgnoredFile, CommandError> {
        let canonical_repo = repo_dir
            .canonicalize()
            .map_err(|e| CommandError::io_error(format!("Geçersiz depo dizini: {}", e)))?;

        let path = path.trim();
        if path.is_empty()
            || path.starts_with('-')
            || path.contains("..")
            || path.chars().any(|c| c.is_control())
        {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                "Yok sayılacak yol geçersiz.",
                true,
            ));
        }

        let target_rel = match scope {
            "repo" | "" => ".gitignore",
            "local" => ".git/info/exclude",
            _ => {
                return Err(CommandError::new(
                    "VALIDATION_ERROR",
                    "Geçersiz yoksayma kapsamı (repo veya local olmalı).",
                    true,
                ));
            }
        };

        // Öğeyi dizin olarak mı dosya olarak mı yoksayacağımız: diskteki
        // gerçek tür belirleyici; yoksa (sahne öncesi silinmiş olabilir) dosya.
        let entry_path = canonical_repo.join(path);
        let is_dir = entry_path.is_dir();
        let pattern = Self::derive_pattern(path, is_dir);

        // Race koruması: git status'tan bu yana öğe izlenir (tracked) olduysa
        // ignore etmenin anlamı yok — sessizce yanlış dosyaya yazmayalım.
        let tracked = GitAdapter::execute_with_timeout(
            &canonical_repo,
            &["ls-files", "--error-unmatch", "--", path],
            WRITE_TIMEOUT,
        )
        .map(|o| o.status.success())
        .unwrap_or(false);
        if tracked {
            return Err(CommandError::new(
                "ALREADY_TRACKED",
                "Bu dosya zaten git tarafından izleniyor. Önce 'git rm --cached' gerekir; arayüzden yapılamaz.",
                true,
            ));
        }

        // GO-07c: "local" hedefi asla <repo>/.git/... DİZEYLENEMEZ — linked
        // worktree/submodule'da .git bir DOSYADIR (gitdir: ...) ve
        // create_dir_all("<repo>/.git/info") ENOTDIR ile patlar. Gerçek git
        // dizinini git'in kendisine soruyoruz. İkinci tuzak: worktree'da
        // info/exclude PER-WORKTREE gitdir'den DEĞİL, ortak dizinden
        // (--git-common-dir) okunur — yanlış yere yazmak sessizce etkisiz
        // kalırdı (check-ignore doğrulaması bunu IGNORE_INEFFECTIVE ile yakalar).
        let target = match scope {
            "repo" | "" => canonical_repo.join(target_rel),
            "local" => match Self::resolve_common_git_dir(&canonical_repo) {
                Some(git_dir) => git_dir.join("info").join("exclude"),
                None => {
                    return Err(CommandError::new(
                        "INVALID_STATE",
                        "Deponun git dizini çözülemedi; yerel yoksayma yazılamadı.",
                        true,
                    ));
                }
            },
            _ => unreachable!("scope yukarıda doğrulandı"),
        };
        let existing = std::fs::read_to_string(&target).unwrap_or_default();
        if Self::pattern_present(&existing, &pattern) {
            return Ok(IgnoredFile {
                path: path.to_string(),
                pattern,
                scope: scope.to_string(),
                already_present: true,
            });
        }

        let mut content = existing;
        if !content.is_empty() && !content.ends_with('\n') {
            content.push('\n');
        }
        if content.is_empty() {
            content.push_str("# Gybe — yoksayılan dosyalar\n");
        }
        content.push_str(&pattern);
        content.push('\n');

        // .git/info/exclude dizini tekil repoda her zaman vardır; worktree /
        // ilginç kurulumlarda eksik olabileceğinden emin olarak yaz.
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                CommandError::io_error(format!("Yoksayma dosyası dizini oluşturulamadı: {}", e))
            })?;
        }
        std::fs::write(&target, content)
            .map_err(|e| CommandError::io_error(format!("Yoksayma dosyasına yazılamadı: {}", e)))?;

        // Diske yazıldı; dosyanın gerçekten yoksayılıp yoksayılmadığını git'e
        // sor (mevcut desen/çelişki durumlarında kullanıcıyu yanıltma).
        let ignored = GitAdapter::execute_with_timeout(
            &canonical_repo,
            &["check-ignore", "-q", "--", path],
            WRITE_TIMEOUT,
        )
        .map(|o| o.status.success())
        .unwrap_or(false);
        if !ignored {
            return Err(CommandError::new(
                "IGNORE_INEFFECTIVE",
                format!(
                    "Desen '{}' yazıldı ancak git bu öğeyi hâlâ izliyor görünüyor; \
                     daha geniş bir '!' (un-ignore) deseni çakışıyor olabilir.",
                    pattern
                ),
                true,
            ));
        }

        Ok(IgnoredFile {
            path: path.to_string(),
            pattern,
            scope: scope.to_string(),
            already_present: false,
        })
    }
}

#[cfg(test)]
mod ignore_tests {
    use super::GitIgnoreManager;

    #[test]
    fn patterns_are_root_anchored_and_dir_aware() {
        assert_eq!(
            GitIgnoreManager::derive_pattern("node_modules", true),
            "/node_modules/"
        );
        assert_eq!(
            GitIgnoreManager::derive_pattern("docs/a.md", false),
            "/docs/a.md"
        );
        // status, untracked dizinleri çoğu zaman 'dir/' biçiminde verir.
        assert_eq!(
            GitIgnoreManager::derive_pattern("target/", true),
            "/target/"
        );
        assert_eq!(GitIgnoreManager::derive_pattern(" a.txt ", false), "/a.txt");
    }

    #[test]
    fn duplicate_detection_is_trim_tolerant() {
        let content = "# comment\n/env/\n  /secret.txt  \n";
        assert!(GitIgnoreManager::pattern_present(content, "/env/"));
        assert!(GitIgnoreManager::pattern_present(content, "/secret.txt"));
        assert!(!GitIgnoreManager::pattern_present(content, "/other"));
        assert!(!GitIgnoreManager::pattern_present(content, ""));
    }
}
