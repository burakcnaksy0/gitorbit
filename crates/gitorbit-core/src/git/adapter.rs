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

    /// GO-04c: stdout'u Boyut sınırlıyla yürütür. Devasa commit diff'leri
    /// (`git show`) tampona alındığında bellek patlayabiliyordu — boyut kontrolü
    /// *sonradan* çalışıyordu. Burada yalnızca `cap` baytı saklanır; kalanı pipe'ı
    /// tıkamadan boşaltılır (ölü kilitlenme yok) ama sayılmaya devam eder.
    /// `(Output, stdout_truncated, toplam_stdout_baytı)` döner.
    pub fn execute_capped(
        repo_dir: &Path,
        args: &[&str],
        cap: usize,
        timeout: Duration,
    ) -> Result<(std::process::Output, bool, usize), CommandError> {
        let mut cmd = Command::new("git");
        cmd.arg("-C").arg(repo_dir);
        cmd.args(args);

        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }

        let mut child = cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| CommandError::io_error(format!("Git komutu yürütülemedi: {}", e)))?;
        let child_pid = child.id();

        // Kapalı okuyucu: cap'e kadar sakla, sonrası yalnızca say (drain).
        let stdout_reader = child.stdout.take().map(|mut out| {
            std::thread::spawn(move || {
                let mut kept: Vec<u8> = Vec::new();
                let mut total = 0usize;
                let mut truncated = false;
                let mut chunk = [0u8; 64 * 1024];
                loop {
                    match out.read(&mut chunk) {
                        Ok(0) => break,
                        Ok(n) => {
                            total += n;
                            if kept.len() < cap {
                                let take = (cap - kept.len()).min(n);
                                kept.extend_from_slice(&chunk[..take]);
                            }
                            if total > cap {
                                truncated = true;
                            }
                        }
                        Err(_) => break,
                    }
                }
                (kept, truncated, total)
            })
        });
        let stderr_reader = child.stderr.take().map(|mut err| {
            std::thread::spawn(move || {
                let mut buf = Vec::new();
                let _ = err.read_to_end(&mut buf);
                buf
            })
        });

        let start = Instant::now();
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => {
                    if start.elapsed() >= timeout {
                        Self::kill_process_group(child_pid);
                        let _ = child.kill();
                        let _ = child.wait();
                        if let Some(h) = stdout_reader {
                            let _ = h.join();
                        }
                        if let Some(h) = stderr_reader {
                            let _ = h.join();
                        }
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
                        "Git süreci izlenemedi: {}",
                        e
                    )));
                }
            }
        };

        let (stdout_buf, truncated, total) = match stdout_reader {
            Some(h) => h.join().unwrap_or_else(|_| (Vec::new(), false, 0)),
            None => (Vec::new(), false, 0),
        };
        let stderr_buf = match stderr_reader {
            Some(h) => h.join().unwrap_or_default(),
            None => Vec::new(),
        };

        Ok((
            std::process::Output {
                status,
                stdout: stdout_buf,
                stderr: stderr_buf,
            },
            truncated,
            total,
        ))
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

        // Zaman aşımlı yol: süreç kendi grubuna başlatılır (unix) ki öldürme
        // anında git'in çocukları (git-remote-https, hook kabukları) da
        // temizlensin — tek child.kill() yetim süreç bırakıyordu.
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }

        let mut child = cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| CommandError::io_error(format!("Git komutu yürütülemedi: {}", e)))?;
        let child_pid = child.id();

        // KRİTİK: pipe'lar okuyucu iş parçacıklarıyla sürekli boşaltılır.
        // Beklerken okumamak, ~64 KB OS pipe tamponunu aşan çıktıda (büyük
        // merge/commit hook çıktısı) git'i write(2) içinde bloklar ve sağlıklı
        // işlem zaman aşımıyla öldürülürdü.
        let stdout_reader = child.stdout.take().map(|mut out| {
            std::thread::spawn(move || {
                let mut buf = Vec::new();
                let _ = out.read_to_end(&mut buf);
                buf
            })
        });
        let stderr_reader = child.stderr.take().map(|mut err| {
            std::thread::spawn(move || {
                let mut buf = Vec::new();
                let _ = err.read_to_end(&mut buf);
                buf
            })
        });

        let start = Instant::now();
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => {
                    if start.elapsed() >= timeout {
                        Self::kill_process_group(child_pid);
                        let _ = child.kill();
                        let _ = child.wait();
                        // Okuyucular EOF ile kısa sürede döner.
                        if let Some(h) = stdout_reader {
                            let _ = h.join();
                        }
                        if let Some(h) = stderr_reader {
                            let _ = h.join();
                        }
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
        };

        // Süreç bitti; tamponlar EOF'a ulaştı — okuyucuları katıştır.
        let stdout = stdout_reader
            .map(|h| h.join().unwrap_or_default())
            .unwrap_or_default();
        let stderr = stderr_reader
            .map(|h| h.join().unwrap_or_default())
            .unwrap_or_default();

        Ok(std::process::Output {
            status,
            stdout,
            stderr,
        })
    }

    /// Unix'te tüm süreç grubunu (negatif PID) SIGKILL ile dağıtır.
    /// process_group(0) ile çocuk grup lideri olmuştur: pgid == pid.
    /// Windows'ta yalnızca doğrudan çocuk öldürülür (Job Object kapsam dışı).
    #[cfg(unix)]
    fn kill_process_group(pid: u32) {
        unsafe {
            libc::kill(-(pid as libc::pid_t), libc::SIGKILL);
        }
    }

    #[cfg(not(unix))]
    fn kill_process_group(_pid: u32) {}
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn large_output_does_not_false_timeout() {
        // GO-01c regresyon: ~64 KB OS pipe tamponunu aşan çıktı, beklerken
        // okunmazsa git write(2) içinde bloklanır ve sağlıklı işlem TIMEOUT
        // ile öldürülürdü. Okuyucu iş parçacıkları tamponu boşaltmalı.
        let mut cmd = Command::new("sh");
        cmd.arg("-c")
            .arg("head -c 300000 /dev/zero | tr '\\0' 'x'")
            .current_dir(std::env::temp_dir());
        let out =
            GitAdapter::run_cmd(cmd, Some(Duration::from_secs(10))).expect("timeout olmamalı");
        assert!(out.status.success());
        assert_eq!(out.stdout.len(), 300000);
    }

    #[test]
    fn timeout_kills_process_group_including_children() {
        // GO-01c regresyon: zaman aşımında yalnızca doğrudan çocuk değil,
        // süreç grubunun tamamı (torun süreçler dahil) temizlenmeli.
        // `(sleep) &` torun üretir; grup öldürülmezse yetim kalır ve PPID'i
        // 1/2'ye (systemd/init) taşınır — /proc'tan ayırt edilir.
        let mut cmd = Command::new("sh");
        cmd.arg("-c")
            .arg("( sleep 27 & ) ; sleep 30")
            .current_dir(std::env::temp_dir());
        let start = Instant::now();
        let err = GitAdapter::run_cmd(cmd, Some(Duration::from_millis(400)))
            .expect_err("TIMEOUT bekleniyor");
        assert_eq!(err.code, "TIMEOUT");
        assert!(start.elapsed() < Duration::from_secs(5));

        // Öldürme + reparent için kısa fırsat ver.
        std::thread::sleep(Duration::from_millis(300));
        let orphans = orphan_sleeps();
        assert!(
            orphans.is_empty(),
            "zaman aşımı sonrası yetim sleep süreçleri kaldı: {orphans:?}"
        );
    }

    /// `sleep 2x` çalıştıran ve PPID'i 1 veya 2 olan (yani yetim kalmış)
    /// süreçlerin PID listesi.
    fn orphan_sleeps() -> Vec<u32> {
        let mut v = Vec::new();
        let Ok(entries) = std::fs::read_dir("/proc") else {
            return v;
        };
        for e in entries.flatten() {
            let name = e.file_name();
            let Some(pid): Option<u32> = name.to_string_lossy().parse().ok() else {
                continue;
            };
            let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
                continue;
            };
            // biçim: pid (comm) state ppid ...
            let Some(rest) = stat.rfind(')').map(|i| &stat[i + 1..]) else {
                continue;
            };
            let fields: Vec<&str> = rest.split_whitespace().collect();
            let (Some(state), Some(ppid)) = (fields.first(), fields.get(1)) else {
                continue;
            };
            let Ok(cmdline) = std::fs::read(format!("/proc/{pid}/cmdline")) else {
                continue;
            };
            let cmdline = String::from_utf8_lossy(&cmdline).replace('\0', " ");
            if cmdline.contains("sleep 27") && *state != "Z" && (*ppid == "1" || *ppid == "2") {
                v.push(pid);
            }
        }
        v
    }
}
