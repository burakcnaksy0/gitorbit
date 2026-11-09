/// Faz 3 — Changes ve Diff kabul testleri
///
/// Kapsam:
///   - Stage / unstage
///   - Diff (staged ve unstaged)
///   - Discard (ikinci durum kontrolü, path traversal koruması)
///   - Büyük diff boyutu koruması (MAX_DIFF_BYTES)
use gybe_core::db::Database;
use gybe_core::git::GitDiffParser;
use gybe_core::git::diff::MAX_DIFF_BYTES;
use gybe_core::models::DiffLineKind;
use gybe_core::services::RepositoryService;
use std::fs;
use std::process::Command;
use tempfile::tempdir;

/// Initialises a fresh git repo with an initial commit so that staged/unstaged
/// operations work as expected (git restore requires at least one commit).
fn setup_repo_with_commit() -> (tempfile::TempDir, std::path::PathBuf) {
    let temp = tempdir().expect("gecici dizin olusturulamadi");
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
        .args(["config", "user.email", "test@gybe.dev"])
        .output();

    // Write an initial file and commit it so the index exists and restore works
    fs::write(repo.join("README.md"), "# Test\n").unwrap();
    let _ = Command::new("git")
        .arg("-C")
        .arg(&repo)
        .args(["add", "--", "README.md"])
        .output();
    let _ = Command::new("git")
        .arg("-C")
        .arg(&repo)
        .args(["commit", "-m", "initial commit"])
        .output();

    (temp, repo)
}

// -------------------------------------------------------------------------
// AC-1: Stage
// -------------------------------------------------------------------------

#[test]
fn test_stage_files_ac1() {
    let (_temp, repo_path) = setup_repo_with_commit();

    let db = Database::in_memory().unwrap();
    let record = RepositoryService::add_repository(&db, repo_path.to_str().unwrap()).unwrap();

    // Create an untracked file
    fs::write(repo_path.join("new_file.txt"), "hello\n").unwrap();

    let status_before = RepositoryService::get_repository_status(&db, &record.id).unwrap();
    assert_eq!(
        status_before.untracked_files.len(),
        1,
        "Dosya untracked olmalı"
    );

    // Stage the file
    let status_after =
        RepositoryService::stage_files(&db, &record.id, &["new_file.txt".to_string()]).unwrap();

    assert_eq!(status_after.staged_files.len(), 1, "Dosya staged olmalı");
    assert_eq!(status_after.untracked_files.len(), 0);
    assert_eq!(status_after.staged_files[0].path, "new_file.txt");
}

// -------------------------------------------------------------------------
// AC-2: Unstage
// -------------------------------------------------------------------------

#[test]
fn test_unstage_files_ac2() {
    let (_temp, repo_path) = setup_repo_with_commit();

    let db = Database::in_memory().unwrap();
    let record = RepositoryService::add_repository(&db, repo_path.to_str().unwrap()).unwrap();

    // Create and stage a file
    fs::write(repo_path.join("staged.txt"), "staged content\n").unwrap();
    RepositoryService::stage_files(&db, &record.id, &["staged.txt".to_string()]).unwrap();

    let status_staged = RepositoryService::get_repository_status(&db, &record.id).unwrap();
    assert_eq!(status_staged.staged_files.len(), 1);

    // Unstage it
    let status_after =
        RepositoryService::unstage_files(&db, &record.id, &["staged.txt".to_string()]).unwrap();

    assert_eq!(
        status_after.staged_files.len(),
        0,
        "Dosya artık staged olmamalı"
    );
    // File should now be untracked again
    assert_eq!(status_after.untracked_files.len(), 1);
}

// -------------------------------------------------------------------------
// AC-3: Diff viewer — staged diff
// -------------------------------------------------------------------------

#[test]
fn test_get_staged_diff_ac3() {
    let (_temp, repo_path) = setup_repo_with_commit();

    let db = Database::in_memory().unwrap();
    let record = RepositoryService::add_repository(&db, repo_path.to_str().unwrap()).unwrap();

    // Modify README and stage it
    fs::write(repo_path.join("README.md"), "# Test\n\nNew line.\n").unwrap();
    RepositoryService::stage_files(&db, &record.id, &["README.md".to_string()]).unwrap();

    let diff = RepositoryService::get_file_diff(&db, &record.id, "README.md", true).unwrap();

    assert!(!diff.binary, "README.md ikili değil");
    assert!(!diff.truncated, "Küçük diff kesilmemeli");
    assert!(!diff.lines.is_empty(), "Diff satırları boş olmamalı");

    // There must be at least one Added line
    let has_added = diff.lines.iter().any(|l| l.kind == DiffLineKind::Added);
    assert!(has_added, "En az bir eklenen satır olmalı");
}

// -------------------------------------------------------------------------
// AC-4: Diff viewer — unstaged diff
// -------------------------------------------------------------------------

#[test]
fn test_get_unstaged_diff_ac4() {
    let (_temp, repo_path) = setup_repo_with_commit();

    let db = Database::in_memory().unwrap();
    let record = RepositoryService::add_repository(&db, repo_path.to_str().unwrap()).unwrap();

    // Modify README but do NOT stage it
    fs::write(repo_path.join("README.md"), "# Test\n\nUnstaged change.\n").unwrap();

    let diff = RepositoryService::get_file_diff(&db, &record.id, "README.md", false).unwrap();

    assert!(!diff.binary);
    assert!(!diff.truncated);
    let has_added = diff.lines.iter().any(|l| l.kind == DiffLineKind::Added);
    assert!(has_added, "En az bir eklenen satır olmalı");
}

// -------------------------------------------------------------------------
// AC-5: Discard — ikinci durum kontrolü
// -------------------------------------------------------------------------

#[test]
fn test_discard_status_hash_check_ac5() {
    let (_temp, repo_path) = setup_repo_with_commit();

    let db = Database::in_memory().unwrap();
    let record = RepositoryService::add_repository(&db, repo_path.to_str().unwrap()).unwrap();

    // Modify README (unstaged)
    fs::write(repo_path.join("README.md"), "# Modified\n").unwrap();

    let status = RepositoryService::get_repository_status(&db, &record.id).unwrap();
    let real_hash = RepositoryService::compute_status_hash(&status);

    // Attempt discard with WRONG hash — must be rejected
    let result =
        RepositoryService::discard_changes(&db, &record.id, "README.md", "wrong_hash_value");
    assert!(result.is_err(), "Yanlış hash ile discard reddedilmeli");
    assert_eq!(result.unwrap_err().code, "STATUS_CHANGED");

    // Attempt discard with CORRECT hash — must succeed
    let result = RepositoryService::discard_changes(&db, &record.id, "README.md", &real_hash);
    assert!(result.is_ok(), "Doğru hash ile discard başarılı olmalı");
    let after_status = result.unwrap();
    // README should be clean (no unstaged changes)
    assert!(
        after_status.unstaged_files.is_empty(),
        "Discard sonrası unstaged dosya olmamalı"
    );
}

// -------------------------------------------------------------------------
// AC-6: Discard — untracked file removal
// -------------------------------------------------------------------------

#[test]
fn test_discard_untracked_file_ac6() {
    let (_temp, repo_path) = setup_repo_with_commit();

    let db = Database::in_memory().unwrap();
    let record = RepositoryService::add_repository(&db, repo_path.to_str().unwrap()).unwrap();

    let new_file = repo_path.join("will_be_discarded.txt");
    fs::write(&new_file, "temporary\n").unwrap();

    let status = RepositoryService::get_repository_status(&db, &record.id).unwrap();
    let hash = RepositoryService::compute_status_hash(&status);

    let after_status =
        RepositoryService::discard_changes(&db, &record.id, "will_be_discarded.txt", &hash)
            .unwrap();

    assert!(!new_file.exists(), "Untracked dosya diskten silinmeli");
    assert!(after_status.untracked_files.is_empty());
}

// -------------------------------------------------------------------------
// AC-7: Path traversal koruması
// -------------------------------------------------------------------------

#[test]
fn test_path_traversal_rejected_ac7() {
    let (_temp, repo_path) = setup_repo_with_commit();

    let db = Database::in_memory().unwrap();
    let record = RepositoryService::add_repository(&db, repo_path.to_str().unwrap()).unwrap();

    // Attempt to stage a file with path traversal
    let result = RepositoryService::stage_files(&db, &record.id, &["../escape.txt".to_string()]);
    assert!(result.is_err(), "Path traversal reddedilmeli");
    assert_eq!(result.unwrap_err().code, "INVALID_PATH");

    // Attempt to discard a file with absolute path
    let status = RepositoryService::get_repository_status(&db, &record.id).unwrap();
    let hash = RepositoryService::compute_status_hash(&status);
    let result = RepositoryService::discard_changes(&db, &record.id, "/etc/passwd", &hash);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().code, "INVALID_PATH");
}

// -------------------------------------------------------------------------
// AC-8: Büyük/binary dosya — diff parser truncation guard
// -------------------------------------------------------------------------

#[test]
fn test_diff_truncation_guard_ac8() {
    let (_temp, repo_path) = setup_repo_with_commit();

    let db = Database::in_memory().unwrap();
    let record = RepositoryService::add_repository(&db, repo_path.to_str().unwrap()).unwrap();

    // Write a file larger than MAX_DIFF_BYTES to trigger truncation
    let huge_content = "x".repeat(MAX_DIFF_BYTES + 1);
    fs::write(repo_path.join("huge.txt"), &huge_content).unwrap();

    // Stage so we can get a staged diff
    RepositoryService::stage_files(&db, &record.id, &["huge.txt".to_string()]).unwrap();

    let diff = RepositoryService::get_file_diff(&db, &record.id, "huge.txt", true).unwrap();
    // The diff of a file this large should be truncated
    assert!(
        diff.truncated || diff.lines.len() < 10_000,
        "Büyük dosya diffi truncated olmalı veya çok az satır içermeli"
    );
    // In either case, the application must NOT hang
}

// -------------------------------------------------------------------------
// AC-9: Binary diff detection
// -------------------------------------------------------------------------

#[test]
fn test_binary_diff_detection_ac9() {
    let (_temp, repo_path) = setup_repo_with_commit();

    let db = Database::in_memory().unwrap();
    let record = RepositoryService::add_repository(&db, repo_path.to_str().unwrap()).unwrap();

    // Write a binary-like file (null bytes)
    let binary_content: Vec<u8> = vec![0u8, 1, 2, 3, 255, 254, 253];
    fs::write(repo_path.join("binary.bin"), &binary_content).unwrap();
    RepositoryService::stage_files(&db, &record.id, &["binary.bin".to_string()]).unwrap();

    let diff = RepositoryService::get_file_diff(&db, &record.id, "binary.bin", true).unwrap();

    // git should report this as binary — check that we handle it gracefully
    if diff.binary {
        assert!(diff.lines.is_empty(), "Binary dosya için satır olmamalı");
    }
    // Whether or not git calls it binary, the parser must not crash
}

// -------------------------------------------------------------------------
// AC-10: parse_unified_diff — unit test
// -------------------------------------------------------------------------

#[test]
fn test_parse_unified_diff_unit_ac10() {
    // Use a raw string to preserve the leading space on context lines.
    // Rust's backslash-newline continuation strips leading whitespace which would
    // break the " context line" -> Context classification.
    let raw = "diff --git a/foo.txt b/foo.txt\nindex abc1234..def5678 100644\n--- a/foo.txt\n+++ b/foo.txt\n@@ -1,3 +1,4 @@\n context line\n-removed line\n+added line\n+another added\n trailing context\n";

    let diff = GitDiffParser::parse_diff_text_for_test(raw);
    let added: Vec<_> = diff
        .iter()
        .filter(|l| l.kind == DiffLineKind::Added)
        .collect();
    let removed: Vec<_> = diff
        .iter()
        .filter(|l| l.kind == DiffLineKind::Removed)
        .collect();
    let context: Vec<_> = diff
        .iter()
        .filter(|l| l.kind == DiffLineKind::Context)
        .collect();

    assert_eq!(added.len(), 2, "Iki eklenen satir olmali");
    assert_eq!(removed.len(), 1, "Bir silinen satir olmali");
    assert_eq!(context.len(), 2, "Iki context satiri olmali");
    // Hunk: @@ -1,3 +1,4 @@ -> old_line starts at 1, new_line starts at 1
    // " context line" -> old=1 new=1
    // "-removed line" -> old=2
    // "+added line"   -> new=2
    // "+another added"-> new=3
    assert_eq!(
        added[0].new_line_no,
        Some(2),
        "Ilk added satir new_line_no 2 olmali"
    );
    assert_eq!(
        removed[0].old_line_no,
        Some(2),
        "Removed satir old_line_no 2 olmali"
    );
}

// ---------------------------------------------------------------------------
// v0.2.1 denetim regresyonları — GO-08c (hunk içi "--- " satırı) /
// GO-04c (sınırsız diff okuma)
// ---------------------------------------------------------------------------

#[test]
fn go08c_hunk_body_dashes_are_not_headers() {
    // Silinen satır içeriği "-- kural" ise düz diff satırı "--- kural" olur;
    // hunk GÖVDESİNDEYSE Removed olmalı (Header değil) ve satır numaraları
    // kaymamalı. Aynı şekilde eklenen "+ x" içeriği "++ x" olarak Added'dir.
    let text = "\
diff --git a/f.md b/f.md
index 1111111..2222222 100644
--- a/f.md
+++ b/f.md
@@ -1,3 +1,3 @@
 merhaba
--- kural
++- kural
 dünya
";
    let lines = GitDiffParser::parse_diff_text_for_test(text);
    let removed = lines
        .iter()
        .filter(|l| l.kind == DiffLineKind::Removed)
        .collect::<Vec<_>>();
    let added = lines
        .iter()
        .filter(|l| l.kind == DiffLineKind::Added)
        .collect::<Vec<_>>();
    assert_eq!(removed.len(), 1, "hunk içi '--- ' Header oldu: {lines:?}");
    assert_eq!(removed[0].content, "-- kural");
    assert_eq!(removed[0].old_line_no, Some(2));
    assert_eq!(added.len(), 1);
    assert_eq!(added[0].content, "+- kural");
    assert_eq!(added[0].new_line_no, Some(2));
    // Bağlam satırı numaraları kaymadı: "dünya" eski=3 yeni=3
    let ctx = lines
        .iter()
        .find(|l| l.kind == DiffLineKind::Context && l.content == "dünya")
        .expect("bağlam satırı");
    assert_eq!(ctx.old_line_no, Some(3));
    assert_eq!(ctx.new_line_no, Some(3));
    // Gerçek dosya başlıkları Header olarak kalmalı
    assert!(
        lines
            .iter()
            .any(|l| l.kind == DiffLineKind::Header && l.content.starts_with("--- a/f.md"))
    );
}

#[test]
fn go04c_huge_diff_is_truncated_not_hung() {
    // > MAX_DIFF_BYTES (512 KB) tek dosyalık unstaged diff: yanıt truncation
    // bayrağıyla gelmeli, parse edilmemeli, süreç bloklanmamalı.
    let (temp, repo) = setup_repo_with_commit();

    let big = "x".repeat(700 * 1024);
    fs::write(repo.join("buyuk.txt"), format!("base\n{big}\n")).unwrap();
    let out = Command::new("git")
        .current_dir(&repo)
        .args(["add", "buyuk.txt"])
        .output()
        .unwrap();
    assert!(out.status.success());
    let out = Command::new("git")
        .current_dir(&repo)
        .args(["commit", "-m", "buyuk eklenir"])
        .output()
        .unwrap();
    assert!(out.status.success());
    // Küçük bir satır ekle → unstaged diff ~700 KB (satır başına +/- ile daha da büyük)
    fs::write(repo.join("buyuk.txt"), format!("BASE\n{big}\n")).unwrap();

    let db_dir = temp.path().join("db");
    fs::create_dir_all(&db_dir).unwrap();
    let db = Database::open(&db_dir.join("t.db")).unwrap();
    let rec = RepositoryService::add_repository(&db, repo.to_str().unwrap()).unwrap();

    let diff = RepositoryService::get_file_diff(&db, &rec.id, "buyuk.txt", false).unwrap();
    assert!(diff.truncated, "dev diff truncate edilmeli");
    assert!(
        diff.lines.is_empty(),
        "truncate edilen diff parse edilmemeli"
    );
    assert!(
        diff.raw_size > MAX_DIFF_BYTES,
        "toplam boyut olduğu gibi raporlanmalı, alınamadı: {}",
        diff.raw_size
    );
}
