use gitorbit_core::db::Database;
use gitorbit_core::git::{GitAdapter, GitStatusParser};
use gitorbit_core::models::ChangedFileStatus;
use gitorbit_core::services::RepositoryService;
use std::fs;
use std::process::Command;
use tempfile::tempdir;

#[test]
fn test_git_environment_detection() {
    let env = GitAdapter::detect_environment();
    assert!(env.installed, "Git sistemde kurulu olmalıdır");
    assert!(env.version.is_some(), "Git sürümü tespit edilmelidir");
}

#[test]
fn test_temporary_repo_lifecycle_and_acceptance_criteria() {
    // Acceptance criterion 1: Gerçek geçici repository eklenir ve status gösterilir
    let temp = tempdir().expect("Geçici dizin oluşturulamadı");
    let repo_path = temp.path().join("test-repo");
    fs::create_dir_all(&repo_path).expect("Repo dizini oluşturulamadı");

    // Run: git init
    let init_res = Command::new("git")
        .arg("-C")
        .arg(&repo_path)
        .args(["init", "-b", "main"])
        .output()
        .expect("git init çalıştırılamadı");
    assert!(init_res.status.success());

    // Configure local git identity for tests
    let _ = Command::new("git")
        .arg("-C")
        .arg(&repo_path)
        .args(["config", "user.name", "Test Runner"])
        .output();
    let _ = Command::new("git")
        .arg("-C")
        .arg(&repo_path)
        .args(["config", "user.email", "test@gitorbit.dev"])
        .output();

    let db = Database::in_memory().expect("In-memory DB oluşturulamadı");

    // Add repository via service
    let repo_record = RepositoryService::add_repository(&db, repo_path.to_str().unwrap())
        .expect("Repository eklenemedi");

    assert_eq!(repo_record.display_name, "test-repo");
    assert!(repo_record.canonical_path.contains("test-repo"));

    // Verify status on fresh repo
    let status =
        RepositoryService::get_repository_status(&db, &repo_record.id).expect("Status okunamadı");
    assert_eq!(status.branch, Some("main".to_string()));
    assert_eq!(status.staged_files.len(), 0);
    assert_eq!(status.unstaged_files.len(), 0);

    // Acceptance criterion 4: Özel karakterli dosya isimleri doğru parse edilir
    let special_filename = "türkçe dosya (özel #1).txt";
    let special_file_path = repo_path.join(special_filename);
    fs::write(&special_file_path, "özel içerik şçöğüı").expect("Özel dosya yazılamadı");

    let status_after_file =
        RepositoryService::get_repository_status(&db, &repo_record.id).expect("Status okunamadı");
    assert_eq!(
        status_after_file.untracked_files.len(),
        1,
        "Özel karakterli dosya untracked olarak algılanmalı"
    );
    assert_eq!(
        status_after_file.untracked_files[0].path, special_filename,
        "Özel karakterli dosya adı birebir doğru parse edilmelidir"
    );

    // Stage the special file
    let add_res = Command::new("git")
        .arg("-C")
        .arg(&repo_path)
        .args(["add", "--", special_filename])
        .output()
        .expect("git add çalıştırılamadı");
    assert!(add_res.status.success());

    let status_staged =
        RepositoryService::get_repository_status(&db, &repo_record.id).expect("Status okunamadı");
    assert_eq!(status_staged.staged_files.len(), 1);
    assert_eq!(
        status_staged.staged_files[0].status,
        ChangedFileStatus::Added
    );
    assert_eq!(status_staged.staged_files[0].path, special_filename);

    // Commit the special file
    let commit_res = Command::new("git")
        .arg("-C")
        .arg(&repo_path)
        .args(["commit", "-m", "test: özel karakterli commit"])
        .output()
        .expect("git commit çalıştırılamadı");
    assert!(commit_res.status.success());

    // Acceptance criterion 2: Duplicate path testi
    let duplicate_res = RepositoryService::add_repository(&db, repo_path.to_str().unwrap());
    assert!(duplicate_res.is_err(), "Aynı repo tekrar eklenememelidir");
    assert_eq!(
        duplicate_res.unwrap_err().code,
        "REPO_ALREADY_EXISTS",
        "Hata kodu REPO_ALREADY_EXISTS olmalıdır"
    );

    // Subdirectory test: adding a subdirectory resolves to the root
    let sub_dir = repo_path.join("src").join("nested");
    fs::create_dir_all(&sub_dir).expect("Alt dizin oluşturulamadı");
    let sub_add_res = RepositoryService::add_repository(&db, sub_dir.to_str().unwrap());
    assert!(
        sub_add_res.is_err(),
        "Alt dizin seçilse bile aynı root olduğu için duplicate hatası vermelidir"
    );

    // Acceptance criterion 2 (devam): Invalid path testleri
    let invalid_path_res = RepositoryService::add_repository(&db, "/dizin/kesinlikle/yok_12345");
    assert!(invalid_path_res.is_err());
    assert_eq!(invalid_path_res.unwrap_err().code, "REPO_NOT_FOUND");

    let non_git_dir = temp.path().join("not-a-git-dir");
    fs::create_dir_all(&non_git_dir).expect("Dizin oluşturulamadı");
    let not_git_res = RepositoryService::add_repository(&db, non_git_dir.to_str().unwrap());
    assert!(not_git_res.is_err());
    assert_eq!(not_git_res.unwrap_err().code, "NOT_A_GIT_REPOSITORY");

    // Acceptance criterion 3: Remove repository klasörü silmez!
    let repo_list_before = RepositoryService::list_repositories(&db).expect("Listeleme başarısız");
    assert_eq!(repo_list_before.len(), 1);

    let remove_res = RepositoryService::remove_repository(&db, &repo_record.id);
    assert!(remove_res.is_ok());

    let repo_list_after = RepositoryService::list_repositories(&db).expect("Listeleme başarısız");
    assert_eq!(repo_list_after.len(), 0, "DB kaydı silinmiş olmalıdır");

    // CRITICAL VERIFICATION: Does the physical directory and the file still exist?
    assert!(
        repo_path.exists(),
        "KABUL KRİTERİ İHLALİ: Remove işleminden sonra fiziksel klasör diskte silinmeden kalmalıdır!"
    );
    assert!(
        special_file_path.exists(),
        "KABUL KRİTERİ İHLALİ: Repository içindeki dosyalar silinmeden korunmalıdır!"
    );
}

#[test]
fn test_status_parser_nul_delimited_renamed_and_conflicted() {
    // Test parsing raw -z status stream containing modifications, untracked, and renames
    let mut raw_stream = Vec::new();

    // 1. Modified staged: "M  src/main.rs\0"
    raw_stream.extend_from_slice(b"M  src/main.rs\0");

    // 2. Untracked file with space: "?? test folder/new file.txt\0"
    raw_stream.extend_from_slice(b"?? test folder/new file.txt\0");

    // 3. Renamed file: "R  new_name.rs\0old_name.rs\0"
    raw_stream.extend_from_slice(b"R  new_name.rs\0old_name.rs\0");

    // 4. Conflicted file: "UU conflicted.txt\0"
    raw_stream.extend_from_slice(b"UU conflicted.txt\0");

    let (staged, unstaged, untracked, conflicted) = GitStatusParser::parse_porcelain_z(&raw_stream);

    assert_eq!(staged.len(), 2);
    assert_eq!(staged[0].path, "src/main.rs");
    assert_eq!(staged[0].status, ChangedFileStatus::Modified);

    assert_eq!(staged[1].path, "new_name.rs");
    assert_eq!(staged[1].old_path, Some("old_name.rs".to_string()));
    assert_eq!(staged[1].status, ChangedFileStatus::Renamed);

    assert_eq!(untracked.len(), 1);
    assert_eq!(untracked[0].path, "test folder/new file.txt");

    assert_eq!(conflicted.len(), 1);
    assert_eq!(conflicted[0], "conflicted.txt");
    assert_eq!(unstaged.len(), 1);
    assert_eq!(unstaged[0].status, ChangedFileStatus::Conflicted);
}

// ---------------------------------------------------------------------------
// init_repository: plain folder -> git init -> registered record (Faz 8 UX)
// ---------------------------------------------------------------------------

#[test]
fn test_init_repository_creates_and_registers() {
    let dir = tempdir().expect("tempdir");
    let plain = dir.path().join("yeniproje");
    fs::create_dir(&plain).expect("create plain dir");
    fs::write(plain.join("readme.md"), "merhaba").expect("write file");

    let db = Database::in_memory().expect("in-memory DB");
    let record = RepositoryService::init_repository(&db, &plain.to_string_lossy())
        .expect("init_repository should succeed");

    assert!(plain.join(".git").exists(), "git init .git oluşturmalı");
    assert_eq!(record.display_name, "yeniproje");

    // Registered exactly once and now openable like any repository.
    let listed = RepositoryService::list_repositories(&db).expect("list");
    assert_eq!(listed.len(), 1);
    let status = RepositoryService::get_repository_status(&db, &record.id);
    assert!(status.is_ok(), "init sonrası durum okunabilmeli");
}

#[test]
fn test_init_repository_rejects_existing_repo() {
    let dir = tempdir().expect("tempdir");
    let repo = dir.path().join("zatenrepo");
    fs::create_dir(&repo).expect("create dir");
    Command::new("git")
        .current_dir(&repo)
        .args(["init"])
        .output()
        .expect("git init");

    let db = Database::in_memory().expect("in-memory DB");
    let err = RepositoryService::init_repository(&db, &repo.to_string_lossy())
        .expect_err("mevcut depoya init yapılmamalı");
    assert_eq!(err.code, "ALREADY_A_GIT_REPOSITORY");
}

#[test]
fn last_opened_at_throttled_on_status_reads() {
    // GO-09c: her status okuması DB yazması üretmemeli — 10 dakikalık
    // amortisman penceresinde ikinci okuma last_opened_at'i DEĞİŞTİRMEMELİ
    // (auto-fetch + senkron turlarının WAL gürültüsü ve liste yeniden
    // sıralaması buradan geliyordu).
    let temp = tempdir().expect("tempdir");
    let repo_path = temp.path().join("throttle-repo");
    fs::create_dir_all(&repo_path).unwrap();
    let run = |args: &[&str]| {
        let o = Command::new("git")
            .current_dir(&repo_path)
            .args(args)
            .output()
            .unwrap();
        assert!(o.status.success(), "{args:?}: {}", String::from_utf8_lossy(&o.stderr));
    };
    run(&["init", "-b", "main"]);
    run(&["config", "user.name", "T"]);
    run(&["config", "user.email", "t@example.com"]);
    fs::write(repo_path.join("f.txt"), "x\n").unwrap();
    run(&["add", "f.txt"]);
    run(&["commit", "-m", "init"]);

    let db = Database::open(&temp.path().join("t.db")).unwrap();
    let record = RepositoryService::add_repository(&db, repo_path.to_str().unwrap()).unwrap();

    RepositoryService::get_repository_status(&db, &record.id).unwrap();
    let first = RepositoryService::get_repository(&db, &record.id)
        .unwrap()
        .last_opened_at;
    assert!(first.is_some(), "ilk status yazmalı");

    RepositoryService::get_repository_status(&db, &record.id).unwrap();
    let second = RepositoryService::get_repository(&db, &record.id)
        .unwrap()
        .last_opened_at;
    assert_eq!(first, second, "10 sn içindeki ikinci okuma yazmamalı");
}
