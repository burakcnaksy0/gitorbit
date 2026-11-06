use gitorbit_core::db::Database;
use gitorbit_core::models::RepositoryOperationState;
use gitorbit_core::services::RepositoryService;
use gitorbit_core::{GitOperationStateManager, GitRemoteManager};
use std::fs;
use std::path::Path;
use std::process::Command;
use tempfile::tempdir;

fn run_cmd(dir: &Path, args: &[&str]) {
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
}

fn init_local_repo(dir: &Path) {
    run_cmd(dir, &["init", "-b", "main"]);
    run_cmd(dir, &["config", "user.name", "Test User"]);
    run_cmd(dir, &["config", "user.email", "test@example.com"]);
    run_cmd(dir, &["config", "commit.gpgsign", "false"]);
}

fn init_bare_repo(dir: &Path) {
    let output = Command::new("git")
        .args(["init", "--bare", "-b", "main"])
        .arg(dir)
        .output()
        .expect("git init --bare calistirilmadi");
    assert!(
        output.status.success(),
        "Bare repo oluşturulamadı: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn test_ac1_bare_remote_push_fetch_pull_sync() {
    let temp_root = tempdir().unwrap();
    let bare_dir = temp_root.path().join("bare.git");
    let repo_a_dir = temp_root.path().join("repo_a");
    let repo_b_dir = temp_root.path().join("repo_b");

    fs::create_dir_all(&bare_dir).unwrap();
    fs::create_dir_all(&repo_a_dir).unwrap();
    fs::create_dir_all(&repo_b_dir).unwrap();

    init_bare_repo(&bare_dir);
    init_local_repo(&repo_a_dir);

    // Initial commit in repo_a
    fs::write(repo_a_dir.join("README.md"), "# GitOrbit\n").unwrap();
    run_cmd(&repo_a_dir, &["add", "README.md"]);
    run_cmd(&repo_a_dir, &["commit", "-m", "Initial commit"]);

    let db_dir = temp_root.path().join("db");
    fs::create_dir_all(&db_dir).unwrap();
    let db = Database::open(&db_dir.join("test.db")).unwrap();

    let record_a = RepositoryService::add_repository(&db, repo_a_dir.to_str().unwrap()).unwrap();

    // Add remote
    run_cmd(
        &repo_a_dir,
        &["remote", "add", "origin", bare_dir.to_str().unwrap()],
    );

    // List remotes
    let remotes = RepositoryService::list_remotes(&db, &record_a.id).unwrap();
    assert_eq!(remotes.len(), 1);
    assert_eq!(remotes[0].name, "origin");

    // Push with set_upstream = true
    let push_status =
        RepositoryService::push(&db, &record_a.id, Some("origin"), Some("main"), false, true)
            .unwrap();

    assert_eq!(push_status.upstream, Some("origin/main".to_string()));
    assert_eq!(push_status.ahead, 0);
    assert_eq!(push_status.behind, 0);

    // Now clone to repo_b
    run_cmd(
        temp_root.path(),
        &[
            "clone",
            bare_dir.to_str().unwrap(),
            repo_b_dir.to_str().unwrap(),
        ],
    );
    run_cmd(&repo_b_dir, &["config", "user.name", "User B"]);
    run_cmd(&repo_b_dir, &["config", "user.email", "b@example.com"]);
    run_cmd(&repo_b_dir, &["config", "commit.gpgsign", "false"]);

    // In repo_b, add a commit and push
    fs::write(repo_b_dir.join("feature.txt"), "hello from b\n").unwrap();
    run_cmd(&repo_b_dir, &["add", "feature.txt"]);
    run_cmd(&repo_b_dir, &["commit", "-m", "Add feature from b"]);
    run_cmd(&repo_b_dir, &["push", "origin", "main"]);

    // In repo_a, fetch
    let fetch_status = RepositoryService::fetch(&db, &record_a.id, Some("origin")).unwrap();
    assert_eq!(fetch_status.ahead, 0);
    assert_eq!(fetch_status.behind, 1);

    // Now pull into repo_a
    let pull_status = RepositoryService::pull(
        &db,
        &record_a.id,
        Some("origin"),
        Some("main"),
        Some("merge"),
    )
    .unwrap();

    assert_eq!(pull_status.ahead, 0);
    assert_eq!(pull_status.behind, 0);
    assert!(repo_a_dir.join("feature.txt").exists());
}

#[test]
fn test_ac2_non_fast_forward_push_rejected_never_auto_forced() {
    let temp_root = tempdir().unwrap();
    let bare_dir = temp_root.path().join("bare.git");
    let repo_a_dir = temp_root.path().join("repo_a");
    let repo_b_dir = temp_root.path().join("repo_b");

    fs::create_dir_all(&bare_dir).unwrap();
    fs::create_dir_all(&repo_a_dir).unwrap();
    fs::create_dir_all(&repo_b_dir).unwrap();

    init_bare_repo(&bare_dir);
    init_local_repo(&repo_a_dir);

    fs::write(repo_a_dir.join("file.txt"), "base\n").unwrap();
    run_cmd(&repo_a_dir, &["add", "file.txt"]);
    run_cmd(&repo_a_dir, &["commit", "-m", "Base commit"]);
    run_cmd(
        &repo_a_dir,
        &["remote", "add", "origin", bare_dir.to_str().unwrap()],
    );
    run_cmd(&repo_a_dir, &["push", "-u", "origin", "main"]);

    // Clone to repo_b
    run_cmd(
        temp_root.path(),
        &[
            "clone",
            bare_dir.to_str().unwrap(),
            repo_b_dir.to_str().unwrap(),
        ],
    );
    run_cmd(&repo_b_dir, &["config", "user.name", "User B"]);
    run_cmd(&repo_b_dir, &["config", "user.email", "b@example.com"]);
    run_cmd(&repo_b_dir, &["config", "commit.gpgsign", "false"]);

    // User B adds commit and pushes
    fs::write(repo_b_dir.join("file_b.txt"), "b content\n").unwrap();
    run_cmd(&repo_b_dir, &["add", "file_b.txt"]);
    run_cmd(&repo_b_dir, &["commit", "-m", "Commit from B"]);
    run_cmd(&repo_b_dir, &["push", "origin", "main"]);

    let db_dir = temp_root.path().join("db");
    fs::create_dir_all(&db_dir).unwrap();
    let db = Database::open(&db_dir.join("test.db")).unwrap();
    let record_a = RepositoryService::add_repository(&db, repo_a_dir.to_str().unwrap()).unwrap();

    // User A adds diverging commit locally without pulling
    fs::write(repo_a_dir.join("file_a.txt"), "a content\n").unwrap();
    run_cmd(&repo_a_dir, &["add", "file_a.txt"]);
    run_cmd(&repo_a_dir, &["commit", "-m", "Commit from A"]);

    // Attempt push without force
    let err = RepositoryService::push(
        &db,
        &record_a.id,
        Some("origin"),
        Some("main"),
        false,
        false,
    )
    .unwrap_err();

    // Verification: Must be rejected with REMOTE_REJECTED
    assert_eq!(err.code, "REMOTE_REJECTED");
    assert!(err.message.contains("non-fast-forward"));

    // Verify remote was NOT overwritten: repo_b commit must still be head on remote
    let check_out = Command::new("git")
        .current_dir(&bare_dir)
        .args(["log", "-1", "--pretty=%s", "main"])
        .output()
        .unwrap();
    let remote_head_msg = String::from_utf8_lossy(&check_out.stdout)
        .trim()
        .to_string();
    assert_eq!(remote_head_msg, "Commit from B");
}

#[test]
fn test_ac3_pull_conflicts_never_destructive_reset() {
    let temp_root = tempdir().unwrap();
    let bare_dir = temp_root.path().join("bare.git");
    let repo_a_dir = temp_root.path().join("repo_a");
    let repo_b_dir = temp_root.path().join("repo_b");

    fs::create_dir_all(&bare_dir).unwrap();
    fs::create_dir_all(&repo_a_dir).unwrap();
    fs::create_dir_all(&repo_b_dir).unwrap();

    init_bare_repo(&bare_dir);
    init_local_repo(&repo_a_dir);

    // Common ancestor file
    fs::write(repo_a_dir.join("conflict.txt"), "line original\n").unwrap();
    run_cmd(&repo_a_dir, &["add", "conflict.txt"]);
    run_cmd(&repo_a_dir, &["commit", "-m", "Base conflict file"]);
    run_cmd(
        &repo_a_dir,
        &["remote", "add", "origin", bare_dir.to_str().unwrap()],
    );
    run_cmd(&repo_a_dir, &["push", "-u", "origin", "main"]);

    // Clone to repo_b
    run_cmd(
        temp_root.path(),
        &[
            "clone",
            bare_dir.to_str().unwrap(),
            repo_b_dir.to_str().unwrap(),
        ],
    );
    run_cmd(&repo_b_dir, &["config", "user.name", "User B"]);
    run_cmd(&repo_b_dir, &["config", "user.email", "b@example.com"]);
    run_cmd(&repo_b_dir, &["config", "commit.gpgsign", "false"]);

    // B modifies conflict.txt differently and pushes
    fs::write(repo_b_dir.join("conflict.txt"), "line from B\n").unwrap();
    run_cmd(&repo_b_dir, &["commit", "-am", "Modify conflict.txt in B"]);
    run_cmd(&repo_b_dir, &["push", "origin", "main"]);

    // A modifies conflict.txt locally with competing change
    fs::write(repo_a_dir.join("conflict.txt"), "line from A\n").unwrap();
    run_cmd(&repo_a_dir, &["commit", "-am", "Modify conflict.txt in A"]);

    let db_dir = temp_root.path().join("db");
    fs::create_dir_all(&db_dir).unwrap();
    let db = Database::open(&db_dir.join("test.db")).unwrap();
    let record_a = RepositoryService::add_repository(&db, repo_a_dir.to_str().unwrap()).unwrap();

    // Pull should encounter conflicts
    let err = RepositoryService::pull(
        &db,
        &record_a.id,
        Some("origin"),
        Some("main"),
        Some("merge"),
    )
    .unwrap_err();

    assert_eq!(err.code, "CONFLICTS_PRESENT");

    // Acceptance criterion: Repository is in MergeInProgress state
    let state = RepositoryService::get_operation_state(&db, &record_a.id).unwrap();
    assert_eq!(state, RepositoryOperationState::MergeInProgress);

    // Acceptance criterion: Never destructive reset! Conflicted files preserved
    let status = RepositoryService::get_repository_status(&db, &record_a.id).unwrap();
    assert!(
        status
            .conflicted_files
            .contains(&"conflict.txt".to_string())
    );

    let content = fs::read_to_string(repo_a_dir.join("conflict.txt")).unwrap();
    assert!(content.contains("<<<<<<<") || content.contains("line from A"));
}

#[test]
fn test_ac4_pull_dirty_worktree_rejected_safely() {
    let temp_root = tempdir().unwrap();
    let bare_dir = temp_root.path().join("bare.git");
    let repo_a_dir = temp_root.path().join("repo_a");
    let repo_b_dir = temp_root.path().join("repo_b");

    fs::create_dir_all(&bare_dir).unwrap();
    fs::create_dir_all(&repo_a_dir).unwrap();
    fs::create_dir_all(&repo_b_dir).unwrap();

    init_bare_repo(&bare_dir);
    init_local_repo(&repo_a_dir);

    fs::write(repo_a_dir.join("shared.txt"), "version 1\n").unwrap();
    run_cmd(&repo_a_dir, &["add", "shared.txt"]);
    run_cmd(&repo_a_dir, &["commit", "-m", "Initial shared.txt"]);
    run_cmd(
        &repo_a_dir,
        &["remote", "add", "origin", bare_dir.to_str().unwrap()],
    );
    run_cmd(&repo_a_dir, &["push", "-u", "origin", "main"]);

    // Clone B
    run_cmd(
        temp_root.path(),
        &[
            "clone",
            bare_dir.to_str().unwrap(),
            repo_b_dir.to_str().unwrap(),
        ],
    );
    run_cmd(&repo_b_dir, &["config", "user.name", "User B"]);
    run_cmd(&repo_b_dir, &["config", "user.email", "b@example.com"]);
    run_cmd(&repo_b_dir, &["config", "commit.gpgsign", "false"]);

    // B commits an update to shared.txt and pushes
    fs::write(repo_b_dir.join("shared.txt"), "version 2 from B\n").unwrap();
    run_cmd(&repo_b_dir, &["commit", "-am", "Update shared.txt in B"]);
    run_cmd(&repo_b_dir, &["push", "origin", "main"]);

    // In A, dirty worktree modification to shared.txt (uncommitted)
    fs::write(repo_a_dir.join("shared.txt"), "uncommitted work in A\n").unwrap();

    let db_dir = temp_root.path().join("db");
    fs::create_dir_all(&db_dir).unwrap();
    let db = Database::open(&db_dir.join("test.db")).unwrap();
    let record_a = RepositoryService::add_repository(&db, repo_a_dir.to_str().unwrap()).unwrap();

    // Pull in A should be rejected with DIRTY_WORKTREE
    let err = RepositoryService::pull(
        &db,
        &record_a.id,
        Some("origin"),
        Some("main"),
        Some("merge"),
    )
    .unwrap_err();

    assert_eq!(err.code, "DIRTY_WORKTREE");

    // Local uncommitted work MUST remain intact
    let content = fs::read_to_string(repo_a_dir.join("shared.txt")).unwrap();
    assert_eq!(content, "uncommitted work in A\n");
}

#[test]
fn test_ac5_no_upstream_handling() {
    let temp_root = tempdir().unwrap();
    let repo_dir = temp_root.path().join("local_only");
    fs::create_dir_all(&repo_dir).unwrap();
    init_local_repo(&repo_dir);

    fs::write(repo_dir.join("file.txt"), "init\n").unwrap();
    run_cmd(&repo_dir, &["add", "file.txt"]);
    run_cmd(&repo_dir, &["commit", "-m", "Initial"]);

    let db_dir = temp_root.path().join("db");
    fs::create_dir_all(&db_dir).unwrap();
    let db = Database::open(&db_dir.join("test.db")).unwrap();
    let record = RepositoryService::add_repository(&db, repo_dir.to_str().unwrap()).unwrap();

    // 1. Pull without upstream and without remote should return NO_UPSTREAM
    let pull_err = RepositoryService::pull(&db, &record.id, None, None, None).unwrap_err();
    assert_eq!(pull_err.code, "NO_UPSTREAM");

    // 2. Push without upstream and without set_upstream should return NO_UPSTREAM
    let push_err = RepositoryService::push(&db, &record.id, None, None, false, false).unwrap_err();
    assert_eq!(push_err.code, "NO_UPSTREAM");
}

#[test]
fn test_operation_state_detection() {
    let temp_root = tempdir().unwrap();
    let repo_dir = temp_root.path().join("test_ops");
    fs::create_dir_all(&repo_dir).unwrap();
    init_local_repo(&repo_dir);

    fs::write(repo_dir.join("f.txt"), "c1\n").unwrap();
    run_cmd(&repo_dir, &["add", "f.txt"]);
    run_cmd(&repo_dir, &["commit", "-m", "Commit 1"]);

    // Initially Normal
    assert_eq!(
        GitOperationStateManager::detect_state(&repo_dir),
        RepositoryOperationState::Normal
    );

    // Create MERGE_HEAD
    let git_dir = GitOperationStateManager::resolve_git_dir(&repo_dir);
    fs::write(git_dir.join("MERGE_HEAD"), "dummy\n").unwrap();
    assert_eq!(
        GitOperationStateManager::detect_state(&repo_dir),
        RepositoryOperationState::MergeInProgress
    );
    fs::remove_file(git_dir.join("MERGE_HEAD")).unwrap();

    // Create rebase-merge
    fs::create_dir_all(git_dir.join("rebase-merge")).unwrap();
    assert_eq!(
        GitOperationStateManager::detect_state(&repo_dir),
        RepositoryOperationState::RebaseInProgress
    );
    fs::remove_dir_all(git_dir.join("rebase-merge")).unwrap();

    // Create CHERRY_PICK_HEAD
    fs::write(git_dir.join("CHERRY_PICK_HEAD"), "dummy\n").unwrap();
    assert_eq!(
        GitOperationStateManager::detect_state(&repo_dir),
        RepositoryOperationState::CherryPickInProgress
    );
    fs::remove_file(git_dir.join("CHERRY_PICK_HEAD")).unwrap();

    // Create REVERT_HEAD
    fs::write(git_dir.join("REVERT_HEAD"), "dummy\n").unwrap();
    assert_eq!(
        GitOperationStateManager::detect_state(&repo_dir),
        RepositoryOperationState::RevertInProgress
    );
    fs::remove_file(git_dir.join("REVERT_HEAD")).unwrap();

    // Back to normal
    assert_eq!(
        GitOperationStateManager::detect_state(&repo_dir),
        RepositoryOperationState::Normal
    );
}

#[test]
fn test_validate_name_rejects_injection() {
    assert!(GitRemoteManager::validate_name("-oProxyCommand=calc", "Remote").is_err());
    assert!(GitRemoteManager::validate_name("--upload-pack=evil", "Remote").is_err());
    assert!(GitRemoteManager::validate_name("origin; rm -rf", "Remote").is_err());
    assert!(GitRemoteManager::validate_name("   ", "Remote").is_err());
    assert!(GitRemoteManager::validate_name("origin", "Remote").is_ok());
    assert!(GitRemoteManager::validate_name("upstream", "Remote").is_ok());
    assert!(GitRemoteManager::validate_name("feature/login-v2", "Branch").is_ok());
}

// ---------------------------------------------------------------------------
// GitRemoteManager::add — used by the GitHub publish flow
// ---------------------------------------------------------------------------

#[test]
fn test_add_remote_success_duplicate_and_invalid_url() {
    let dir = tempdir().expect("tempdir");
    init_local_repo(dir.path());

    // Success: origin added and listed.
    let remotes = GitRemoteManager::add(dir.path(), "origin", "https://github.com/user/yeni.git")
        .expect("add origin");
    assert!(remotes.iter().any(|r| r.name == "origin"));

    // Duplicate rejected with REMOTE_EXISTS.
    let err = GitRemoteManager::add(dir.path(), "origin", "https://github.com/user/b.git")
        .expect_err("duplicate origin must fail");
    assert_eq!(err.code, "REMOTE_EXISTS");

    // Invalid URLs rejected before touching git.
    assert!(GitRemoteManager::add(dir.path(), "evil", "--upload-pack=bad").is_err());
    assert!(GitRemoteManager::add(dir.path(), "ftp", "ftp://example.com/x.git").is_err());
    assert!(GitRemoteManager::add(dir.path(), "space", "https://a b/c.git").is_err());
}
