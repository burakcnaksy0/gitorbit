//! v0.2 konfor paketi entegrasyon testleri — ignore + stash akışları.

use gitorbit_core::db::Database;
use gitorbit_core::services::RepositoryService;
use gitorbit_core::RepositoryOperationState;
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

/// Hata durumunu saydırmayan varyant (çakışma üreten merge gibi beklenmedik
/// çıkış kodları üreten komutlar için).
#[allow(dead_code)]
fn run_cmd_allow_fail(dir: &Path, args: &[&str]) {
    let _ = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .expect("git komutu çalıştırılamadı");
}

fn init_repo(dir: &Path) {
    run_cmd(dir, &["init", "-b", "main"]);
    run_cmd(dir, &["config", "user.name", "Test User"]);
    run_cmd(dir, &["config", "user.email", "test@example.com"]);
    run_cmd(dir, &["config", "commit.gpgsign", "false"]);
    fs::write(dir.join("README.md"), "# repo\n").unwrap();
    run_cmd(dir, &["add", "README.md"]);
    run_cmd(dir, &["commit", "-m", "init"]);
}

/// Depoyu DB'ye kaydedip repo_id döner.
fn register(db: &Database, dir: &Path) -> String {
    let canonical = dir.canonicalize().unwrap();
    RepositoryService::add_repository(db, canonical.to_str().unwrap())
        .unwrap()
        .id
}

// ---------------------------------------------------------------------------
// Ignore
// ---------------------------------------------------------------------------

#[test]
fn ignore_local_and_repo_scopes_take_effect() {
    let temp = tempdir().unwrap();
    let repo = temp.path().join("repo");
    fs::create_dir_all(&repo).unwrap();
    init_repo(&repo);
    let db = Database::in_memory().unwrap();
    let id = register(&db, &repo);

    fs::write(repo.join("secret.env"), "TOKEN=1").unwrap();
    fs::create_dir(repo.join("build")).unwrap();
    fs::write(repo.join("build/out.js"), "x").unwrap();

    // local scope → .git/info/exclude
    let res = RepositoryService::ignore_file(&db, &id, "secret.env", "local").unwrap();
    assert_eq!(res.scope, "local");
    assert_eq!(res.pattern, "/secret.env");
    assert!(!res.already_present);
    let exclude = fs::read_to_string(repo.join(".git/info/exclude")).unwrap();
    assert!(exclude.contains("/secret.env"));

    // repo scope (dizin) → .gitignore
    let res = RepositoryService::ignore_file(&db, &id, "build", "repo").unwrap();
    assert_eq!(res.pattern, "/build/");
    let gitignore = fs::read_to_string(repo.join(".gitignore")).unwrap();
    assert!(gitignore.contains("/build/"));

    // git status artık ikisini de untracked listememeli.
    let status = RepositoryService::get_repository_status(&db, &id).unwrap();
    assert!(
        status
            .untracked_files
            .iter()
            .all(|f| !f.path.contains("secret.env") && !f.path.contains("build")),
        "yoksayılanlar listede kaldı: {:?}",
        status
            .untracked_files
            .iter()
            .map(|f| &f.path)
            .collect::<Vec<_>>()
    );

    // Duplicate: ikinci çağrı dosyaya tekrar yazmaz.
    let res2 = RepositoryService::ignore_file(&db, &id, "secret.env", "local").unwrap();
    assert!(res2.already_present);
    let exclude2 = fs::read_to_string(repo.join(".git/info/exclude")).unwrap();
    assert_eq!(
        exclude2.matches("/secret.env").count(),
        1,
        "desen iki kez yazıldı"
    );
}

#[test]
fn ignore_rejects_tracked_and_invalid_paths() {
    let temp = tempdir().unwrap();
    let repo = temp.path().join("repo");
    fs::create_dir_all(&repo).unwrap();
    init_repo(&repo);
    let db = Database::in_memory().unwrap();
    let id = register(&db, &repo);

    let err = RepositoryService::ignore_file(&db, &id, "README.md", "repo").unwrap_err();
    assert_eq!(err.code, "ALREADY_TRACKED");

    for bad in ["", "..", "-rf", "src/../.git"] {
        assert!(
            RepositoryService::ignore_file(&db, &id, bad, "repo").is_err(),
            "kabul edilmemeliydi: {bad:?}"
        );
    }
    assert!(RepositoryService::ignore_file(&db, &id, "x.txt", "yanlis").is_err());
}

// ---------------------------------------------------------------------------
// Stash
// ---------------------------------------------------------------------------

#[test]
fn stash_push_list_pop_roundtrip() {
    let temp = tempdir().unwrap();
    let repo = temp.path().join("repo");
    fs::create_dir_all(&repo).unwrap();
    init_repo(&repo);
    let db = Database::in_memory().unwrap();
    let id = register(&db, &repo);

    // Temiz ağaçta stash reddedilir.
    let err = RepositoryService::stash_push(&db, &id, "bos", false).unwrap_err();
    assert_eq!(err.code, "VALIDATION_ERROR");

    fs::write(repo.join("README.md"), "# degisti\n").unwrap();
    fs::write(repo.join("yeni.txt"), "n").unwrap();

    // untracked dahil olmadan: README stash'lenir, yeni.txt yerinde kalır.
    let after = RepositoryService::stash_push(&db, &id, "wip başlığı", false).unwrap();
    assert!(after.unstaged_files.is_empty());
    assert!(!after.untracked_files.is_empty());

    // untracked dahil: ağaç tamamen temizlenir.
    let after2 = RepositoryService::stash_push(&db, &id, "hepsi", true).unwrap();
    assert!(after2.untracked_files.is_empty() && after2.unstaged_files.is_empty());

    let list = RepositoryService::stash_list(&db, &id).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].message, "main: hepsi");
    assert_eq!(list[1].message, "main: wip başlığı");

    // pop: içerik geri gelir ve stash listeden düşer.
    let status = RepositoryService::stash_pop(&db, &id, "0").unwrap();
    assert_eq!(status.untracked_files.len(), 1);
    assert_eq!(RepositoryService::stash_list(&db, &id).unwrap().len(), 1);

    // apply: içerik gelir, stash KALIR.
    let status = RepositoryService::stash_apply(&db, &id, "0").unwrap();
    assert!(!status.unstaged_files.is_empty());
    assert_eq!(RepositoryService::stash_list(&db, &id).unwrap().len(), 1);

    // drop: liste boşalır.
    let list = RepositoryService::stash_drop(&db, &id, "0").unwrap();
    assert!(list.is_empty());
}

#[test]
fn stash_pop_conflict_preserves_stash() {
    let temp = tempdir().unwrap();
    let repo = temp.path().join("repo");
    fs::create_dir_all(&repo).unwrap();
    init_repo(&repo);
    let db = Database::in_memory().unwrap();
    let id = register(&db, &repo);

    // Stash: README'ye "stash satırı" ekle.
    fs::write(repo.join("README.md"), "# repo\nstash satırı\n").unwrap();
    RepositoryService::stash_push(&db, &id, "çakışacak", false).unwrap();

    // Aynı bölgeye başka bir commit — pop çakışmalı.
    fs::write(repo.join("README.md"), "# repo\nmain satırı\n").unwrap();
    run_cmd(&repo, &["add", "README.md"]);
    run_cmd(&repo, &["commit", "-m", "ayrı değişiklik"]);

    let err = RepositoryService::stash_pop(&db, &id, "0").unwrap_err();
    assert_eq!(err.code, "CONFLICTS_PRESENT");

    // Stash silinmemis olmali ve cakisma statude gorunmeli (stash pop cakismasi
    // MERGE_HEAD olusturmaz — islem durumu degil, conflict dosyalari sinyaller).
    assert_eq!(RepositoryService::stash_list(&db, &id).unwrap().len(), 1);
    let status = RepositoryService::get_repository_status(&db, &id).unwrap();
    assert!(
        !status.conflicted_files.is_empty(),
        "cakisma dosyalari gorunmadi"
    );

    // Cakismayi abort yerine cozumlu isaretle temizleyip stash'i yeniden
    // deneyebilir durum: conflict dosyasini main halini alarak cozelim.
    run_cmd(&repo, &["checkout", "--theirs", "--", "README.md"]);
    run_cmd(&repo, &["add", "README.md"]);
    assert!(
        RepositoryService::get_repository_status(&db, &id)
            .unwrap()
            .conflicted_files
            .is_empty()
    );
    // Stash hâlâ duruyor — temiz ağaca inince uygulanabilir hale getirmek için
    // staged commit'i tamamlayip stash'i drop edebiliyoruz (bilincli akis).
    run_cmd(&repo, &["commit", "-m", "cakisma cozuldu"]);
    assert_eq!(RepositoryService::stash_list(&db, &id).unwrap().len(), 1);
}

#[test]
fn stash_invalid_refs_rejected() {
    let temp = tempdir().unwrap();
    let repo = temp.path().join("repo");
    fs::create_dir_all(&repo).unwrap();
    init_repo(&repo);
    let db = Database::in_memory().unwrap();
    let id = register(&db, &repo);

    for bad in ["abc", "0; rm -rf /", "stash@{0}", ""] {
        assert!(
            RepositoryService::stash_pop(&db, &id, bad).is_err(),
            "kabul edilmemeliydi: {bad:?}"
        );
        assert!(RepositoryService::stash_drop(&db, &id, bad).is_err());
    }
}

// ---------------------------------------------------------------------------
// Amend mesaj (v0.2 madde 3)
// ---------------------------------------------------------------------------

#[test]
fn amend_message_rejects_unborn_and_pushed_commits() {
    let temp = tempdir().unwrap();
    let repo = temp.path().join("repo");
    fs::create_dir_all(&repo).unwrap();
    run_cmd(&repo, &["init", "-b", "main"]);
    run_cmd(&repo, &["config", "user.name", "Test User"]);
    run_cmd(&repo, &["config", "user.email", "test@example.com"]);
    let db = Database::in_memory().unwrap();
    let id = register(&db, &repo);

    // Unborn HEAD: düzenlenecek commit yok.
    let err = RepositoryService::amend_message(&db, &id, "bos mesaj").unwrap_err();
    assert_eq!(err.code, "NO_COMMITS");

    // Yerel commit: amend serbest.
    fs::write(repo.join("README.md"), "# repo\n").unwrap();
    run_cmd(&repo, &["add", "README.md"]);
    run_cmd(&repo, &["commit", "-m", "eski mesaj"]);
    let res = RepositoryService::amend_message(&db, &id, "  yeni mesaj  ").unwrap();
    assert_eq!(
        run_cmd(&repo, &["log", "-1", "--format=%s"]),
        "yeni mesaj"
    );
    assert!(!res.commit_sha.is_empty());

    // Push edildikten sonra reddedilmeli.
    let origin = temp.path().join("origin.git");
    fs::create_dir_all(&origin).unwrap();
    run_cmd(&origin, &["init", "--bare"]);
    run_cmd(&repo, &["remote", "add", "origin", origin.to_str().unwrap()]);
    run_cmd(&repo, &["push", "-u", "origin", "main"]);
    let err = RepositoryService::amend_message(&db, &id, "riskli rewrite").unwrap_err();
    assert_eq!(err.code, "AMEND_PUSHED");

    // Bos mesaj girdi olarak hep reddedilir.
    assert!(RepositoryService::amend_message(&db, &id, "   ").is_err());
}

#[test]
fn amend_message_never_includes_staged_content() {
    let temp = tempdir().unwrap();
    let repo = temp.path().join("repo");
    fs::create_dir_all(&repo).unwrap();
    init_repo(&repo);
    let db = Database::in_memory().unwrap();
    let id = register(&db, &repo);

    // Stage edilmis bir dosya varken mesaj amend'i icerige dokunmamali.
    fs::write(repo.join("yeni.txt"), "içerik\n").unwrap();
    run_cmd(&repo, &["add", "yeni.txt"]);
    let before = run_cmd(&repo, &["rev-list", "--count", "HEAD"]);

    RepositoryService::amend_message(&db, &id, "mesaj duzeltildi").unwrap();

    assert_eq!(run_cmd(&repo, &["log", "-1", "--format=%s"]), "mesaj duzeltildi");
    assert_eq!(run_cmd(&repo, &["rev-list", "--count", "HEAD"]), before);
    let status = RepositoryService::get_repository_status(&db, &id).unwrap();
    assert!(
        status
            .staged_files
            .iter()
            .any(|f| f.path == "yeni.txt"),
        "staged dosya amend sonrasi yerinde kalmali"
    );
    // Uzak hic yokken de amend serbest (ahead mantigi upstream'siz dallarda
    // head_on_remote kontrolune duser).
    assert_eq!(status.upstream, None);
}

// ---------------------------------------------------------------------------
// Geçmiş grafiği + refs (v0.2 madde 6)
// ---------------------------------------------------------------------------

#[test]
fn history_returns_graph_rows_and_ref_decorations() {
    let temp = tempdir().unwrap();
    let repo = temp.path().join("repo");
    fs::create_dir_all(&repo).unwrap();
    init_repo(&repo);

    // feature dali + merge — gerçek bir kavusma grafigi.
    run_cmd(&repo, &["checkout", "-b", "feature"]);
    fs::write(repo.join("f.txt"), "f\n").unwrap();
    run_cmd(&repo, &["add", "f.txt"]);
    run_cmd(&repo, &["commit", "-m", "feature isi"]);
    run_cmd(&repo, &["checkout", "main"]);
    fs::write(repo.join("m.txt"), "m\n").unwrap();
    run_cmd(&repo, &["add", "m.txt"]);
    run_cmd(&repo, &["commit", "-m", "main isi"]);
    run_cmd(&repo, &["merge", "--no-ff", "feature", "-m", "merge feature"]);
    run_cmd(&repo, &["tag", "v1.0"]);

    let db = Database::in_memory().unwrap();
    let id = register(&db, &repo);

    let history =
        gitorbit_core::services::RepositoryService::get_history(&db, &id, None, 50, 0).unwrap();

    // En yeni commit merge commit: 2 ebeveyn → grafikte ikinci serit acilmali.
    assert!(history.commits.len() >= 4);
    let merge_row_index = history
        .commits
        .iter()
        .position(|c| c.parents.len() == 2)
        .expect("merge commit bulunamadi");
    assert_eq!(merge_row_index, 0, "merge commit en yeni olmali");
    assert_eq!(history.graph.len(), history.commits.len());
    assert!(
        history.graph[0].active_lanes.len() >= 2,
        "merge satirinda ikinci serit bekleniyordu: {:?}",
        history.graph
    );

    // refs: main (HEAD -> main dalinda degiliz — feature'de degiliz; HEAD merge sonrasi main)
    // ve tag v1.0 gorunmeli.
    let head_refs = &history.commits[0].refs;
    assert!(
        head_refs.iter().any(|r| r == "main" || r == "HEAD"),
        "HEAD dekorasyonu yok: {head_refs:?}"
    );
    assert!(
        head_refs.iter().any(|r| r == "tag:v1.0"),
        "tag dekorasyonu yok: {head_refs:?}"
    );
}

// ---------------------------------------------------------------------------
// Çakışma çözimi (v0.2 madde 7)
// ---------------------------------------------------------------------------

/// main ve feature dallari AYNI satiri farkli degistirir → merge cakismasi.
fn setup_conflict(repo: &Path) {
    init_repo(repo);
    fs::write(repo.join("conflict.txt"), "satir1\n").unwrap();
    run_cmd(repo, &["add", "conflict.txt"]);
    run_cmd(repo, &["commit", "-m", "base dosya"]);

    run_cmd(repo, &["checkout", "-b", "feature"]);
    fs::write(repo.join("conflict.txt"), "onlarin degisikligi\n").unwrap();
    run_cmd(repo, &["commit", "-am", "feature degisti"]);

    run_cmd(repo, &["checkout", "main"]);
    fs::write(repo.join("conflict.txt"), "bizim degisikligimiz\n").unwrap();
    run_cmd(repo, &["commit", "-am", "main degisti"]);

    // Merge cakisma uretmeli — hata bekleniyor, state merge_in_progress kalmali.
    let _ = run_cmd_allow_fail(repo, &["merge", "--no-edit", "feature"]);
}

#[test]
fn resolve_conflict_rejects_wrong_state_and_paths() {
    let temp = tempdir().unwrap();
    let repo = temp.path().join("repo");
    fs::create_dir_all(&repo).unwrap();
    setup_conflict(&repo);
    let db = Database::in_memory().unwrap();
    let id = register(&db, &repo);

    // Cakisma ortasinda cakismali olmayan yol reddedilir.
    let err = gitorbit_core::services::RepositoryService::resolve_conflict(
        &db, &id, "README.md", true,
    )
    .unwrap_err();
    assert_eq!(err.code, "NOT_CONFLICTED");

    // Girdi dogrulamasi: bayrak enjeksiyonu / mutlak yol / bos.
    for bad in ["", "-ours", "/etc/passwd", "../gizli"] {
        assert!(
            gitorbit_core::services::RepositoryService::resolve_conflict(&db, &id, bad, true)
                .is_err(),
            "reddedilmeliydi: {bad:?}"
        );
    }
}

#[test]
fn resolve_conflict_full_flow_ours_theirs_continue() {
    let temp = tempdir().unwrap();
    let repo = temp.path().join("repo");
    fs::create_dir_all(&repo).unwrap();
    setup_conflict(&repo);
    let db = Database::in_memory().unwrap();
    let id = register(&db, &repo);

    let status = RepositoryService::get_repository_status(&db, &id).unwrap();
    assert_eq!(status.operation_state, RepositoryOperationState::MergeInProgress);
    assert!(status.conflicted_files.contains(&"conflict.txt".to_string()));

    // "Bizim" taraf secilip stage'lenir.
    let status =
        gitorbit_core::services::RepositoryService::resolve_conflict(&db, &id, "conflict.txt", true)
            .unwrap();
    assert!(
        status.conflicted_files.is_empty(),
        "cozum sonrasi cakismali dosya kalmamali: {:?}",
        status.conflicted_files
    );
    assert_eq!(
        fs::read_to_string(repo.join("conflict.txt")).unwrap().trim(),
        "bizim degisikligimiz"
    );

    // Merge hâlâ sürüyor — continue ile tamamlanir.
    let status = RepositoryService::continue_operation(&db, &id).unwrap();
    assert_eq!(status.operation_state, RepositoryOperationState::Normal);
    assert!(
        run_cmd(&repo, &["log", "-1", "--format=%P"])
            .split_whitespace()
            .count()
            == 2,
        "merge commit iki ebeveynli olmali"
    );

    // Normal duruma donuldugu icin artik resolve reddedilir.
    let err = gitorbit_core::services::RepositoryService::resolve_conflict(
        &db, &id, "conflict.txt", false,
    )
    .unwrap_err();
    assert_eq!(err.code, "INVALID_STATE");
}

#[test]
fn resolve_conflict_theirs_side_wins() {
    let temp = tempdir().unwrap();
    let repo = temp.path().join("repo");
    fs::create_dir_all(&repo).unwrap();
    setup_conflict(&repo);
    let db = Database::in_memory().unwrap();
    let id = register(&db, &repo);

    gitorbit_core::services::RepositoryService::resolve_conflict(&db, &id, "conflict.txt", false)
        .unwrap();
    assert_eq!(
        fs::read_to_string(repo.join("conflict.txt")).unwrap().trim(),
        "onlarin degisikligi"
    );
}
