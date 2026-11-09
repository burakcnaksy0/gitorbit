//! Faz 8 — çoklu hesap commit kimliği testleri.
//!
//! `GitConfigManager::rewrite_authorship` yanlış kimlikle (makine varsayılanı)
//! yazılmış commit'leri hesap kimliğine çevirmeli; diğer yazarlara dokunmamalı.

use gybe_core::{GitCommitManager, GitConfigManager};
use std::fs;
use std::path::Path;
use std::process::Command;
use tempfile::tempdir;

fn run_cmd(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .expect("git komutu çalıştırılamadı");
    assert!(
        output.status.success(),
        "Komut başarısız: {:?}\nstderr: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn init_repo_with_wrong_identity(dir: &Path) {
    run_cmd(dir, &["init", "-b", "main"]);
    run_cmd(dir, &["config", "user.name", "Machine Default"]);
    run_cmd(dir, &["config", "user.email", "wrong@machine.local"]);
    run_cmd(dir, &["config", "commit.gpgsign", "false"]);
}

#[test]
fn rewrite_authorship_moves_only_wrong_identity_commits() {
    let temp_root = tempdir().unwrap();
    let repo = temp_root.path().join("repo");
    fs::create_dir_all(&repo).unwrap();
    init_repo_with_wrong_identity(&repo);

    // 1. Commit — makinenin yanlış varsayılan kimliğiyle.
    fs::write(repo.join("a.txt"), "a").unwrap();
    run_cmd(&repo, &["add", "a.txt"]);
    run_cmd(&repo, &["commit", "-m", "first"]);

    // 2. Commit — başka bir yazarla (dokunulmamalı).
    fs::write(repo.join("b.txt"), "b").unwrap();
    run_cmd(&repo, &["add", "b.txt"]);
    run_cmd(
        &repo,
        &[
            "commit",
            "-m",
            "colleague work",
            "--author",
            "Colleague <colleague@firma.com>",
        ],
    );

    GitConfigManager::rewrite_authorship(
        &repo,
        "wrong@machine.local",
        "Burak",
        "12345+burakcanaksoy@users.noreply.github.com",
    )
    .expect("rewrite_authorship başarısız");

    // Kronolojik sırayla (eski → yeni) yazar/committer e-postaları.
    let log = run_cmd(&repo, &["log", "--reverse", "--format=%ae|%ce"]);
    let lines: Vec<&str> = log.lines().collect();
    assert_eq!(lines.len(), 2);

    const NEW: &str = "12345+burakcanaksoy@users.noreply.github.com";
    assert_eq!(lines[0], format!("{NEW}|{NEW}"), "1. commit taşınmalıydı");
    let (author2, _committer2) = lines[1].split_once('|').unwrap();
    assert_eq!(
        author2, "colleague@firma.com",
        "diğer yazarın commit'i değişmemeli"
    );

    // Yazar adı da güncellenmiş olmalı: en yeni commit #2 (Colleague),
    // en eski commit #1 artık "Burak".
    let head_name = run_cmd(&repo, &["log", "-1", "--format=%an"]);
    assert_eq!(head_name, "Colleague");
    let first_name = run_cmd(&repo, &["log", "-1", "--skip=1", "--format=%an"]);
    assert_eq!(first_name, "Burak");
}

#[test]
fn set_identity_roundtrip_and_pending_state() {
    let temp_root = tempdir().unwrap();
    let repo = temp_root.path().join("repo");
    fs::create_dir_all(&repo).unwrap();
    init_repo_with_wrong_identity(&repo);

    // Temiz, commit'siz depo.
    assert!(!GitConfigManager::has_commits(&repo));
    assert!(!GitConfigManager::has_pending_changes(&repo));

    GitCommitManager::set_identity(&repo, "Burak", "burak@users.noreply.github.com").unwrap();
    assert_eq!(
        GitConfigManager::local_email(&repo).as_deref(),
        Some("burak@users.noreply.github.com")
    );

    // Bekleyen değişiklik tespiti.
    fs::write(repo.join("x.txt"), "x").unwrap();
    assert!(GitConfigManager::has_pending_changes(&repo));
}
