/// Faz 4 — Branch ve Commit Kabul Testleri
///
/// Kapsam:
///   - AC-1: Commit sonrası SHA ve history doğru görünür.
///   - AC-2: Dirty worktree checkout sırasında otomatik veri kaybı olmaz (çakışmada otomatik stash/discard yapılmaz).
///   - AC-3: Aktif branch silinemez.
///   - AC-4: Boş commit mesajı ve staged değişiklik yokken commit engellenir.
///   - AC-5: Git identity guard (user.name veya user.email eksikken engelleme; repo-local identity ayarlama).
///   - AC-6: Branch listeleme, local/remote ayrımı ve detached HEAD algılama.
///   - AC-7: Geçersiz branch adı ve mevcut branch adıyla oluşturma engelleme.
///   - AC-8: Unmerged branch için güvenli silme (-d) ve zorla silme (-D).
///   - AC-9: Boş depolarda ve çoklu commitlerde pagination desteği.
use gitorbit_core::db::Database;
use gitorbit_core::services::RepositoryService;
use std::fs;
use std::process::Command;
use tempfile::tempdir;

fn setup_repo_with_commit() -> (tempfile::TempDir, std::path::PathBuf) {
    let temp = tempdir().expect("geçici dizin oluşturulamadı");
    let repo = temp.path().join("repo");
    fs::create_dir_all(&repo).unwrap();

    let _ = Command::new("git")
        .arg("-C")
        .arg(&repo)
        .args(["init", "-b", "main"])
        .output();
    let _ = Command::new("git")
        .arg("-C")
        .arg(&repo)
        .args(["config", "user.name", "Test Runner"])
        .output();
    let _ = Command::new("git")
        .arg("-C")
        .arg(&repo)
        .args(["config", "user.email", "test@gitorbit.dev"])
        .output();

    fs::write(repo.join("README.md"), "# Initial Commit\n").unwrap();
    let _ = Command::new("git")
        .arg("-C")
        .arg(&repo)
        .args(["add", "--", "README.md"])
        .output();
    let _ = Command::new("git")
        .arg("-C")
        .arg(&repo)
        .args(["commit", "-m", "chore: initial commit"])
        .output();

    (temp, repo)
}

// -------------------------------------------------------------------------
// AC-1: Commit sonrası SHA ve history doğru görünür
// -------------------------------------------------------------------------
#[test]
fn test_commit_creates_sha_and_updates_history_ac1() {
    let (_temp, repo_path) = setup_repo_with_commit();
    let db = Database::in_memory().unwrap();
    let record = RepositoryService::add_repository(&db, repo_path.to_str().unwrap()).unwrap();

    // Create a new file and stage it
    fs::write(repo_path.join("app.ts"), "console.log('hello world');\n").unwrap();
    RepositoryService::stage_files(&db, &record.id, &["app.ts".to_string()]).unwrap();

    // Commit
    let commit_res = RepositoryService::commit(&db, &record.id, "feat: add app.ts", false).unwrap();
    assert!(!commit_res.commit_sha.is_empty(), "Commit SHA boş olmamalı");
    assert_eq!(
        commit_res.status.staged_files.len(),
        0,
        "Commit sonrası staged dosyalar temizlenmeli"
    );

    // Verify history contains this commit
    let history = RepositoryService::get_history(&db, &record.id, None, 10, 0).unwrap();
    assert!(history.commits.len() >= 2);
    let latest = &history.commits[0];
    assert_eq!(latest.sha, commit_res.commit_sha);
    assert_eq!(latest.message, "feat: add app.ts");
    assert_eq!(latest.author_name, "Test Runner");
    assert_eq!(latest.author_email, "test@gitorbit.dev");
}

// -------------------------------------------------------------------------
// AC-2: Dirty worktree checkout sırasında otomatik veri kaybı olmaz
// -------------------------------------------------------------------------
#[test]
fn test_dirty_worktree_checkout_prevents_data_loss_ac2() {
    let (_temp, repo_path) = setup_repo_with_commit();
    let db = Database::in_memory().unwrap();
    let record = RepositoryService::add_repository(&db, repo_path.to_str().unwrap()).unwrap();

    // Create a feature branch and commit a conflicting change to README.md in feature
    RepositoryService::create_branch(&db, &record.id, "feature", None, true).unwrap();
    fs::write(repo_path.join("README.md"), "# Feature Branch Content\n").unwrap();
    RepositoryService::stage_files(&db, &record.id, &["README.md".to_string()]).unwrap();
    RepositoryService::commit(&db, &record.id, "feat: update readme in feature", false).unwrap();

    // Checkout back to main
    RepositoryService::checkout_branch(&db, &record.id, "main").unwrap();

    // Now introduce local dirty changes to README.md on main
    let local_work = "# Unsaved Local Modifications on Main\n";
    fs::write(repo_path.join("README.md"), local_work).unwrap();

    // Attempt to checkout feature branch — this conflicts with local dirty README.md
    let checkout_res = RepositoryService::checkout_branch(&db, &record.id, "feature");
    assert!(
        checkout_res.is_err(),
        "Dirty worktree çakışmasında checkout hata vermelidir"
    );

    let err = checkout_res.unwrap_err();
    assert_eq!(
        err.code, "DIRTY_WORKTREE",
        "Hata kodu DIRTY_WORKTREE olmalıdır"
    );

    // Verify user's local work was NOT discarded or lost
    let current_content = fs::read_to_string(repo_path.join("README.md")).unwrap();
    assert_eq!(
        current_content, local_work,
        "Kullanıcının yerel değişiklikleri kaybolmamalıdır"
    );

    // Verify still on branch main
    let status = RepositoryService::get_repository_status(&db, &record.id).unwrap();
    assert_eq!(
        status.branch.as_deref(),
        Some("main"),
        "Orijinal branch korunmalıdır"
    );
}

// -------------------------------------------------------------------------
// AC-3: Aktif branch silinemez
// -------------------------------------------------------------------------
#[test]
fn test_active_branch_cannot_be_deleted_ac3() {
    let (_temp, repo_path) = setup_repo_with_commit();
    let db = Database::in_memory().unwrap();
    let record = RepositoryService::add_repository(&db, repo_path.to_str().unwrap()).unwrap();

    // Try deleting active branch 'main'
    let delete_res = RepositoryService::delete_branch(&db, &record.id, "main", false);
    assert!(delete_res.is_err(), "Aktif branch silinmemelidir");
    let err = delete_res.unwrap_err();
    assert_eq!(err.code, "CANNOT_DELETE_ACTIVE_BRANCH");

    // Also verify with force = true
    let delete_res_force = RepositoryService::delete_branch(&db, &record.id, "main", true);
    assert!(
        delete_res_force.is_err(),
        "Aktif branch force ile de silinmemelidir"
    );
    let err_force = delete_res_force.unwrap_err();
    assert_eq!(err_force.code, "CANNOT_DELETE_ACTIVE_BRANCH");
}

// -------------------------------------------------------------------------
// AC-4: Boş commit mesajı ve staged değişiklik yokken commit engellenir
// -------------------------------------------------------------------------
#[test]
fn test_empty_commit_message_and_no_staged_changes_blocked_ac4() {
    let (_temp, repo_path) = setup_repo_with_commit();
    let db = Database::in_memory().unwrap();
    let record = RepositoryService::add_repository(&db, repo_path.to_str().unwrap()).unwrap();

    // 1. Stage a file, but provide empty commit message
    fs::write(repo_path.join("file.txt"), "content\n").unwrap();
    RepositoryService::stage_files(&db, &record.id, &["file.txt".to_string()]).unwrap();

    let empty_msg_res = RepositoryService::commit(&db, &record.id, "   ", false);
    assert!(empty_msg_res.is_err(), "Boş commit mesajı reddedilmelidir");
    assert_eq!(empty_msg_res.unwrap_err().code, "VALIDATION_ERROR");

    // 2. Unstage the file, then try committing with valid message but 0 staged changes
    RepositoryService::unstage_files(&db, &record.id, &["file.txt".to_string()]).unwrap();
    let no_staged_res = RepositoryService::commit(&db, &record.id, "valid commit message", false);
    assert!(
        no_staged_res.is_err(),
        "Staged dosya yokken commit engellenmelidir"
    );
    assert_eq!(no_staged_res.unwrap_err().code, "VALIDATION_ERROR");
}

// -------------------------------------------------------------------------
// AC-5: Git identity guard çalışır
// -------------------------------------------------------------------------
#[test]
fn test_git_identity_guard_blocks_and_configures_ac5() {
    let temp = tempdir().expect("geçici dizin");
    let repo = temp.path().join("repo_no_id");
    fs::create_dir_all(&repo).unwrap();

    let empty_global = temp.path().join("empty.gitconfig");
    fs::write(&empty_global, "").unwrap();

    let prev_global = std::env::var("GIT_CONFIG_GLOBAL").ok();
    let prev_system = std::env::var("GIT_CONFIG_NOSYSTEM").ok();
    unsafe {
        std::env::set_var("GIT_CONFIG_GLOBAL", &empty_global);
        std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
    }

    let _ = Command::new("git")
        .arg("-C")
        .arg(&repo)
        .args(["init", "-b", "main"])
        .output();
    let _ = Command::new("git")
        .arg("-C")
        .arg(&repo)
        .args(["config", "--local", "--unset", "user.name"])
        .output();
    let _ = Command::new("git")
        .arg("-C")
        .arg(&repo)
        .args(["config", "--local", "--unset", "user.email"])
        .output();

    let db = Database::in_memory().unwrap();
    let record = RepositoryService::add_repository(&db, repo.to_str().unwrap()).unwrap();

    fs::write(repo.join("file.txt"), "hello").unwrap();
    RepositoryService::stage_files(&db, &record.id, &["file.txt".to_string()]).unwrap();

    let id_before = RepositoryService::get_git_identity(&db, &record.id).unwrap();
    let missing = id_before
        .name
        .as_deref()
        .map(|s| s.trim().is_empty())
        .unwrap_or(true)
        || id_before
            .email
            .as_deref()
            .map(|s| s.trim().is_empty())
            .unwrap_or(true);
    assert!(missing, "İzolasyon sonrası etkili kimlik boş olmalıdır");

    let blocked = RepositoryService::commit(&db, &record.id, "feat: should be blocked", false);
    assert!(blocked.is_err(), "Kimlik yokken commit engellenmelidir");
    assert_eq!(blocked.unwrap_err().code, "IDENTITY_MISSING");

    let set_res = RepositoryService::set_git_identity(
        &db,
        &record.id,
        "Custom Engineer",
        "engineer@gitorbit.dev",
    )
    .unwrap();
    assert_eq!(set_res.name.as_deref(), Some("Custom Engineer"));
    assert_eq!(set_res.email.as_deref(), Some("engineer@gitorbit.dev"));

    let id_after = RepositoryService::get_git_identity(&db, &record.id).unwrap();
    assert_eq!(id_after.name.as_deref(), Some("Custom Engineer"));
    assert_eq!(id_after.email.as_deref(), Some("engineer@gitorbit.dev"));

    let commit_res = RepositoryService::commit(
        &db,
        &record.id,
        "feat: initial commit with configured identity",
        false,
    );
    assert!(
        commit_res.is_ok(),
        "Identity ayarlandıktan sonra commit başarılı olmalıdır"
    );

    unsafe {
        match prev_global {
            Some(v) => std::env::set_var("GIT_CONFIG_GLOBAL", v),
            None => std::env::remove_var("GIT_CONFIG_GLOBAL"),
        }
        match prev_system {
            Some(v) => std::env::set_var("GIT_CONFIG_NOSYSTEM", v),
            None => std::env::remove_var("GIT_CONFIG_NOSYSTEM"),
        }
    }
}

// -------------------------------------------------------------------------
// AC-6: Branch listeleme, local/remote ayrımı ve detached HEAD
// -------------------------------------------------------------------------
#[test]
fn test_branch_list_and_detached_head_ac6() {
    let (_temp, repo_path) = setup_repo_with_commit();
    let db = Database::in_memory().unwrap();
    let record = RepositoryService::add_repository(&db, repo_path.to_str().unwrap()).unwrap();

    // Add branch 'dev'
    RepositoryService::create_branch(&db, &record.id, "dev", None, false).unwrap();

    let branches = RepositoryService::get_branches(&db, &record.id).unwrap();
    assert_eq!(branches.len(), 2, "main ve dev olmak üzere 2 branch olmalı");

    let main_branch = branches.iter().find(|b| b.name == "main").unwrap();
    let dev_branch = branches.iter().find(|b| b.name == "dev").unwrap();

    assert!(main_branch.is_current, "main aktif branch olmalı");
    assert!(!main_branch.is_remote);
    assert!(!dev_branch.is_current, "dev henüz aktif olmamalı");
    assert!(!dev_branch.is_remote);

    // Now detach HEAD by checking out initial commit SHA
    let history = RepositoryService::get_history(&db, &record.id, None, 1, 0).unwrap();
    let initial_sha = &history.commits[0].sha;

    let _ = Command::new("git")
        .arg("-C")
        .arg(&repo_path)
        .args(["checkout", initial_sha])
        .output();

    let status = RepositoryService::get_repository_status(&db, &record.id).unwrap();
    assert!(
        status.is_detached_head,
        "Detached HEAD durumu algılanmalıdır"
    );
    assert!(status.branch.unwrap_or_default().starts_with("HEAD ("));
}

// -------------------------------------------------------------------------
// AC-7: Geçersiz branch adı ve mevcut branch adıyla oluşturma engelleme
// -------------------------------------------------------------------------
#[test]
fn test_branch_creation_validation_and_already_exists_ac7() {
    let (_temp, repo_path) = setup_repo_with_commit();
    let db = Database::in_memory().unwrap();
    let record = RepositoryService::add_repository(&db, repo_path.to_str().unwrap()).unwrap();

    // Invalid names
    let bad_names = [
        "",
        "   ",
        "bad branch with spaces",
        "..",
        "head~1",
        "-starts-with-dash",
        "test:colon",
    ];
    for bad in bad_names {
        let res = RepositoryService::create_branch(&db, &record.id, bad, None, false);
        assert!(res.is_err(), "Geçersiz branch adı reddedilmeli: '{}'", bad);
        assert_eq!(res.unwrap_err().code, "VALIDATION_ERROR");
    }

    // Attempt creating existing branch 'main'
    let exists_res = RepositoryService::create_branch(&db, &record.id, "main", None, false);
    assert!(
        exists_res.is_err(),
        "Mevcut branch adı tekrar oluşturulamamalı"
    );
    assert_eq!(exists_res.unwrap_err().code, "BRANCH_ALREADY_EXISTS");
}

// -------------------------------------------------------------------------
// AC-8: Unmerged branch için güvenli silme (-d) ve zorla silme (-D)
// -------------------------------------------------------------------------
#[test]
fn test_branch_unmerged_delete_requires_force_ac8() {
    let (_temp, repo_path) = setup_repo_with_commit();
    let db = Database::in_memory().unwrap();
    let record = RepositoryService::add_repository(&db, repo_path.to_str().unwrap()).unwrap();

    // Create branch 'unmerged-branch' and commit to it
    RepositoryService::create_branch(&db, &record.id, "unmerged-branch", None, true).unwrap();
    fs::write(repo_path.join("unmerged.txt"), "unmerged data\n").unwrap();
    RepositoryService::stage_files(&db, &record.id, &["unmerged.txt".to_string()]).unwrap();
    RepositoryService::commit(&db, &record.id, "feat: unmerged commit", false).unwrap();

    // Switch back to main
    RepositoryService::checkout_branch(&db, &record.id, "main").unwrap();

    // Attempt safe delete (-d) without force -> should be rejected because unmerged
    let safe_delete_res =
        RepositoryService::delete_branch(&db, &record.id, "unmerged-branch", false);
    assert!(
        safe_delete_res.is_err(),
        "Unmerged branch safe delete ile silinmemelidir"
    );
    assert_eq!(safe_delete_res.unwrap_err().code, "BRANCH_NOT_MERGED");

    // Delete with force = true (-D) -> should succeed
    let force_delete_res =
        RepositoryService::delete_branch(&db, &record.id, "unmerged-branch", true);
    assert!(force_delete_res.is_ok(), "Force delete başarılı olmalıdır");

    let branches = RepositoryService::get_branches(&db, &record.id).unwrap();
    assert!(branches.iter().all(|b| b.name != "unmerged-branch"));
}

// -------------------------------------------------------------------------
// AC-9: Boş depolarda ve pagination desteği
// -------------------------------------------------------------------------
#[test]
fn test_history_pagination_and_empty_repo_ac9() {
    // 1. Empty repository
    let temp = tempdir().expect("geçici dizin");
    let empty_repo = temp.path().join("empty");
    fs::create_dir_all(&empty_repo).unwrap();
    let _ = Command::new("git")
        .arg("-C")
        .arg(&empty_repo)
        .args(["init", "-b", "main"])
        .output();

    let db = Database::in_memory().unwrap();
    let record = RepositoryService::add_repository(&db, empty_repo.to_str().unwrap()).unwrap();

    let empty_history = RepositoryService::get_history(&db, &record.id, None, 10, 0).unwrap();
    assert_eq!(
        empty_history.commits.len(),
        0,
        "Boş depoda commits boş dönmeli"
    );
    assert!(!empty_history.has_more);

    // 2. Repository with multiple commits
    let (_temp2, repo_path) = setup_repo_with_commit();
    let record2 = RepositoryService::add_repository(&db, repo_path.to_str().unwrap()).unwrap();

    for i in 1..=5 {
        fs::write(
            repo_path.join(format!("file_{}.txt", i)),
            format!("data {}", i),
        )
        .unwrap();
        RepositoryService::stage_files(&db, &record2.id, &[format!("file_{}.txt", i)]).unwrap();
        RepositoryService::commit(&db, &record2.id, &format!("commit {}", i), false).unwrap();
    }

    // Page 1: limit 2
    let page1 = RepositoryService::get_history(&db, &record2.id, None, 2, 0).unwrap();
    assert_eq!(page1.commits.len(), 2);
    assert!(page1.has_more);
    assert_eq!(page1.next_offset, 2);

    // Page 2: limit 2, offset 2
    let page2 =
        RepositoryService::get_history(&db, &record2.id, None, 2, page1.next_offset).unwrap();
    assert_eq!(page2.commits.len(), 2);
    assert!(page2.has_more);
    assert_ne!(page1.commits[0].sha, page2.commits[0].sha);
}

#[test]
fn test_amend_is_rejected_in_faz4() {
    let (_temp, repo_path) = setup_repo_with_commit();
    let db = Database::in_memory().unwrap();
    let record = RepositoryService::add_repository(&db, repo_path.to_str().unwrap()).unwrap();

    fs::write(repo_path.join("extra.txt"), "x\n").unwrap();
    RepositoryService::stage_files(&db, &record.id, &["extra.txt".to_string()]).unwrap();

    let amend_res = RepositoryService::commit(&db, &record.id, "amend should fail", true);
    assert!(amend_res.is_err());
    assert_eq!(amend_res.unwrap_err().code, "VALIDATION_ERROR");

    let history = RepositoryService::get_history(&db, &record.id, None, 10, 0).unwrap();
    assert_eq!(history.commits.len(), 1);
    assert_eq!(history.commits[0].message, "chore: initial commit");
}

#[test]
fn test_remote_tracking_branch_checkout_is_rejected() {
    let (_temp, repo_path) = setup_repo_with_commit();
    let db = Database::in_memory().unwrap();
    let record = RepositoryService::add_repository(&db, repo_path.to_str().unwrap()).unwrap();

    let _ = Command::new("git")
        .arg("-C")
        .arg(&repo_path)
        .args([
            "remote",
            "add",
            "origin",
            "https://example.invalid/repo.git",
        ])
        .output();
    let _ = Command::new("git")
        .arg("-C")
        .arg(&repo_path)
        .args(["update-ref", "refs/remotes/origin/main", "HEAD"])
        .output();

    let checkout_res = RepositoryService::checkout_branch(&db, &record.id, "origin/main");
    assert!(checkout_res.is_err());
    assert_eq!(checkout_res.unwrap_err().code, "VALIDATION_ERROR");

    let status = RepositoryService::get_repository_status(&db, &record.id).unwrap();
    assert_eq!(status.branch.as_deref(), Some("main"));
    assert!(!status.is_detached_head);
}
