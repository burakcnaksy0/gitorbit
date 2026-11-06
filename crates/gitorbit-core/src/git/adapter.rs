use crate::errors::CommandError;
use crate::models::GitEnvironment;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub struct GitAdapter;

/// Minimum Git version supported by GitOrbit.
///
/// `git restore --staged` (used for unstage) requires Git >= 2.23.
/// Documented in README.
pub const MINIMUM_GIT_VERSION: &str = "2.23.0";

impl GitAdapter {
    /// Detects Git CLI presence, version, and location on the host machine.
    pub fn detect_environment() -> GitEnvironment {
        let which_cmd = if cfg!(windows) { "where" } else { "which" };
        let path_output = Command::new(which_cmd).arg("git").output();

        let executable_path = match path_output {
            Ok(out) if out.status.success() => {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if s.is_empty() {
                    None
                } else {
                    Some(s.lines().next().unwrap_or("").to_string())
                }
            }
            _ => None,
        };

        let version_output = Command::new("git").arg("--version").output();

        match version_output {
            Ok(out) if out.status.success() => {
                let raw = String::from_utf8_lossy(&out.stdout).trim().to_string();
                // Format: "git version 2.55.0"
                let version = raw
                    .strip_prefix("git version ")
                    .unwrap_or(&raw)
                    .trim()
                    .to_string();

                let meets_minimum = Self::version_at_least(&version, MINIMUM_GIT_VERSION);

                GitEnvironment {
                    installed: true,
                    version: Some(version),
                    executable_path,
                    minimum_version: Some(MINIMUM_GIT_VERSION.to_string()),
                    meets_minimum,
                }
            }
            _ => GitEnvironment {
                installed: false,
                version: None,
                executable_path: None,
                minimum_version: Some(MINIMUM_GIT_VERSION.to_string()),
                meets_minimum: false,
            },
        }
    }

    /// Compares numeric dotted versions (`2.23.0` vs `2.9.4`).
    pub fn version_at_least(actual: &str, minimum: &str) -> bool {
        fn parse(v: &str) -> Vec<u32> {
            v.split(|c: char| !c.is_ascii_digit())
                .filter(|s| !s.is_empty())
                .take(4)
                .filter_map(|s| s.parse().ok())
                .collect()
        }
        let a = parse(actual);
        let m = parse(minimum);
        for i in 0..m.len().max(a.len()) {
            let av = a.get(i).copied().unwrap_or(0);
            let mv = m.get(i).copied().unwrap_or(0);
            if av != mv {
                return av > mv;
            }
        }
        true
    }

    /// Verifies if a directory is a valid Git repository and returns its canonical top-level root.
    pub fn get_repository_root(path: &Path) -> Result<PathBuf, CommandError> {
        if !path.exists() {
            return Err(CommandError::repo_not_found(format!(
                "Belirtilen yol mevcut değil: {}",
                path.display()
            )));
        }

        if !path.is_dir() {
            return Err(CommandError::invalid_path(format!(
                "Belirtilen yol bir dizin değil: {}",
                path.display()
            )));
        }

        // Run: git rev-parse --show-toplevel
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .args(["rev-parse", "--show-toplevel"])
            .output()
            .map_err(|e| CommandError::io_error(format!("Git komutu çalıştırılamadı: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(CommandError::not_a_git_repository(format!(
                "Seçilen dizin geçerli bir Git deposu değil: {}",
                stderr.trim()
            )));
        }

        let raw_root = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let root_path = PathBuf::from(raw_root);

        // Bare repositories have no working tree; the MVP does not support them.
        if let Ok(bare) = Command::new("git")
            .arg("-C")
            .arg(path)
            .args(["rev-parse", "--is-bare-repository"])
            .output()
            && bare.status.success()
            && String::from_utf8_lossy(&bare.stdout).trim() == "true"
        {
            return Err(CommandError::new(
                "BARE_REPOSITORY",
                "Seçilen klasör bir bare (çıplak) Git deposu. GitOrbit normal çalışma ağacı olan depoları destekler.",
                false,
            )
            .with_recovery_hint(
                "Bare depoyu klonlayın veya normal çalışma ağacı olan bir depo seçin.",
            ));
        }

        // Canonicalize the discovered root
        root_path.canonicalize().map_err(|e| {
            CommandError::io_error(format!(
                "Depo yolu canonicalize edilemedi ({}): {}",
                root_path.display(),
                e
            ))
        })
    }

    /// Executes a Git command safely with a separate argument list (never a shell string).
    pub fn execute(repo_dir: &Path, args: &[&str]) -> Result<std::process::Output, CommandError> {
        Self::execute_inner(repo_dir, args, None)
    }

    /// Same as `execute`, but kills the process if it exceeds `timeout`.
    /// Used for commit hooks that may hang.
    pub fn execute_with_timeout(
        repo_dir: &Path,
        args: &[&str],
        timeout: Duration,
    ) -> Result<std::process::Output, CommandError> {
        Self::execute_inner(repo_dir, args, Some(timeout))
    }

    /// Executes a Git command with extra environment variables (e.g., GIT_TERMINAL_PROMPT=0)
    /// and optional timeout.
    pub fn execute_with_env_and_timeout(
        repo_dir: &Path,
        args: &[&str],
        envs: &[(&str, &str)],
        timeout: Option<Duration>,
    ) -> Result<std::process::Output, CommandError> {
        let mut cmd = Command::new("git");
        cmd.arg("-C").arg(repo_dir);
        for (k, v) in envs {
            cmd.env(k, v);
        }
        cmd.args(args);
        Self::run_cmd(cmd, timeout)
    }

    fn execute_inner(
        repo_dir: &Path,
        args: &[&str],
        timeout: Option<Duration>,
    ) -> Result<std::process::Output, CommandError> {
        let mut cmd = Command::new("git");
        cmd.arg("-C").arg(repo_dir).args(args);
        Self::run_cmd(cmd, timeout)
    }

    fn run_cmd(
        mut cmd: Command,
        timeout: Option<Duration>,
    ) -> Result<std::process::Output, CommandError> {
        let Some(timeout) = timeout else {
            return cmd
                .output()
                .map_err(|e| CommandError::io_error(format!("Git komutu yürütülemedi: {}", e)));
        };

        let mut child = cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| CommandError::io_error(format!("Git komutu yürütülemedi: {}", e)))?;

        let start = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {
                    if start.elapsed() >= timeout {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(CommandError::new(
                            "TIMEOUT",
                            format!(
                                "Git işlemi {} saniye içinde tamamlanmadı ve durduruldu.",
                                timeout.as_secs()
                            ),
                            true,
                        ));
                    }
                    std::thread::sleep(Duration::from_millis(25));
                }
                Err(e) => {
                    return Err(CommandError::io_error(format!(
                        "Git süreci beklenirken hata: {}",
                        e
                    )));
                }
            }
        }

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        if let Some(mut out) = child.stdout.take() {
            let _ = out.read_to_end(&mut stdout);
        }
        if let Some(mut err) = child.stderr.take() {
            let _ = err.read_to_end(&mut stderr);
        }

        let status = child
            .wait()
            .map_err(|e| CommandError::io_error(format!("Git süreci beklenirken hata: {}", e)))?;

        Ok(std::process::Output {
            status,
            stdout,
            stderr,
        })
    }
}
