// GitOrbit — Tauri command layer
// This file wires gitorbit-core services to the Tauri IPC bridge.
// Only the commands relevant to the current phase are exposed.

// `AppError` owns several String fields (~144 bytes). Tauri's IPC error
// serialization requires the concrete type, and the Err variant size is
// irrelevant next to real command payloads (statuses, diffs, histories).
// Same documented choice as `gitorbit-core` (see its lib.rs).
#![allow(clippy::result_large_err)]

use gitorbit_core::GitHubService;
use gitorbit_core::db::Database;
use gitorbit_core::services::{RepositoryService, SettingsService};
use gitorbit_core::sync::{
    RepoSyncOutcome, SyncOutcomeStatus, SyncPlanEntry, SyncRepoInput, SyncSkipReason,
    plan_sync_list,
};
use gitorbit_core::{
    AppInfo, AppSettings, AppSettingsUpdate, BranchComparison, BranchInfo, CloneResult,
    CommandError, CommitDetails, CommitResult, DeviceFlowSession, DiffOutput, GitCommitManager,
    GitConfigManager, GitEnvironment,
    GitHubAccount, GitHubProfile, GitHubPublishResult, GitHubRepoPage, GitIdentity,
    GitRemoteManager, GitStatus, HistoryOutput, IgnoredFile, PendingDeviceFlow, PollResult,
    RemoteInfo, RepoLockRegistry, RepositoryDetails, RepositoryOperationState, RepositoryRecord,
    StashEntry,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

// ---------------------------------------------------------------------------
// AppState — shared application state managed by Tauri
// ---------------------------------------------------------------------------

/// Application-wide state shared across Tauri commands.
pub struct AppState {
    pub db: Mutex<Database>,
    /// GitHub API service (device-flow OAuth + account management + repo listing).
    pub github: GitHubService,
    /// In-progress device-flow sessions, keyed by `session_token`.  Kept in
    /// memory, NEVER serialised. A map (not a single slot) so that two login
    /// attempts — e.g. GitHubView and SettingsView — never overwrite each
    /// other's `device_code` (root cause of the spurious OAUTH_STATE_MISMATCH /
    /// "authorization_pending forever" reports).
    pub pending_device_flow: Mutex<HashMap<String, PendingDeviceFlow>>,
    /// Per-repository mutation locks (REPOSITORY_BUSY on contention).
    pub locks: RepoLockRegistry,
    /// v0.2: "Tümünü eşitle" turunun iptal bayrağı (frontend durdur butonu).
    pub sync_cancel: AtomicBool,
}

impl AppState {
    pub fn init() -> Result<Self, String> {
        let db = Database::open_default().map_err(|e| e.to_string())?;
        Ok(Self {
            db: Mutex::new(db),
            github: GitHubService::new_real(),
            pending_device_flow: Mutex::new(HashMap::new()),
            locks: RepoLockRegistry::new(),
            sync_cancel: AtomicBool::new(false),
        })
    }
}

// ---------------------------------------------------------------------------
// Error serialisation helper
// ---------------------------------------------------------------------------

/// Serialisable error returned to the frontend.
/// Maps from `CommandError` — keeps the same fields the frontend expects.
#[derive(Debug, Serialize, Deserialize)]
pub struct AppError {
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

impl AppError {
    fn simple(code: &str, message: &str, recoverable: bool) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            recoverable,
            safe_details: None,
            recovery_hint: None,
            retryable: recoverable,
            correlation_id: String::new(),
        }
    }
}

impl From<CommandError> for AppError {
    fn from(e: CommandError) -> Self {
        Self {
            code: e.code,
            message: e.message,
            recoverable: e.recoverable,
            safe_details: e.safe_details,
            recovery_hint: e.recovery_hint,
            retryable: e.retryable,
            correlation_id: e.correlation_id,
        }
    }
}

type CmdResult<T> = Result<T, AppError>;

fn with_db<F, T>(state: &State<AppState>, f: F) -> CmdResult<T>
where
    F: FnOnce(&Database) -> Result<T, CommandError>,
{
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::simple("DATABASE_ERROR", "Veritabani kilidi alinamadi.", false))?;
    f(&db).map_err(AppError::from)
}

// ---------------------------------------------------------------------------
// Faz 0 / utility commands (kept from original skeleton)
// ---------------------------------------------------------------------------

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn ping() -> String {
    "pong".to_string()
}

// ---------------------------------------------------------------------------
// Faz 2 — repository management commands
// ---------------------------------------------------------------------------

/// Returns Git environment info (version, installed, path).
#[tauri::command]
fn app_get_environment() -> GitEnvironment {
    gitorbit_core::GitAdapter::detect_environment()
}

/// Adds a repository by path. Validates, canonicalises, and persists to DB.
/// Adds a repository already under Git version control. Use
/// `repository_init` for plain (non-Git) folders.
#[tauri::command]
fn repository_add(state: State<AppState>, path: String) -> CmdResult<RepositoryRecord> {
    with_db(&state, |db| RepositoryService::add_repository(db, &path))
}

/// Initializes `git init` in a plain directory and registers it.
/// Used when the user chooses "open as Git repository" for a non-Git folder.
#[tauri::command]
fn repository_init(state: State<AppState>, path: String) -> CmdResult<RepositoryRecord> {
    with_db(&state, |db| RepositoryService::init_repository(db, &path))
}

/// Lists all registered repositories.
#[tauri::command]
fn repository_list(state: State<AppState>) -> CmdResult<Vec<RepositoryRecord>> {
    with_db(&state, RepositoryService::list_repositories)
}

/// Removes a repository record from the DB. Does NOT delete files on disk.
#[tauri::command]
fn repository_remove(state: State<AppState>, repo_id: String) -> CmdResult<bool> {
    with_db(&state, |db| {
        RepositoryService::remove_repository(db, &repo_id)
    })
}

/// v0.2 madde 10 — sabitleme bayrağını günceller (yalnızca DB; depo ağacına
/// dokunmaz, bu yüzden kilit gerektirmez).
#[tauri::command]
fn repository_set_pinned(
    state: State<AppState>,
    repo_id: String,
    pinned: bool,
) -> CmdResult<RepositoryRecord> {
    with_db(&state, |db| RepositoryService::set_pinned(db, &repo_id, pinned))
}

/// Returns the current Git status (branch, staged/unstaged/untracked files, etc.).
#[tauri::command]
fn repository_get_status(state: State<AppState>, repo_id: String) -> CmdResult<GitStatus> {
    with_db(&state, |db| {
        RepositoryService::get_repository_status(db, &repo_id)
    })
}

// ---------------------------------------------------------------------------
// Faz 3 — stage / unstage / diff / discard commands
// ---------------------------------------------------------------------------

/// Stages the given relative file paths.
/// Rejects absolute paths and path traversal (`..`) attempts.
#[tauri::command]
fn repository_stage_files(
    state: State<AppState>,
    repo_id: String,
    paths: Vec<String>,
) -> CmdResult<GitStatus> {
    let _lock = state.locks.try_acquire(&repo_id).map_err(AppError::from)?;
    with_db(&state, |db| {
        RepositoryService::stage_files(db, &repo_id, &paths)
    })
}

/// Unstages the given relative file paths.
/// Rejects absolute paths and path traversal attempts.
#[tauri::command]
fn repository_unstage_files(
    state: State<AppState>,
    repo_id: String,
    paths: Vec<String>,
) -> CmdResult<GitStatus> {
    let _lock = state.locks.try_acquire(&repo_id).map_err(AppError::from)?;
    with_db(&state, |db| {
        RepositoryService::unstage_files(db, &repo_id, &paths)
    })
}

/// Returns a typed diff for a single file.
///
/// - `staged = true`  → `git diff --cached -- <path>`
/// - `staged = false` → `git diff -- <path>`
///
/// Large diffs (> 512 KB) are returned with `truncated = true`.
/// Binary files are returned with `binary = true` and an empty `lines` array.
#[tauri::command]
fn repository_get_diff(
    state: State<AppState>,
    repo_id: String,
    file_path: String,
    staged: bool,
) -> CmdResult<DiffOutput> {
    with_db(&state, |db| {
        RepositoryService::get_file_diff(db, &repo_id, &file_path, staged)
    })
}

/// Discards changes for a single file (unstaged) or removes an untracked file.
///
/// Safety: requires `expected_status_hash` computed from the status the user
/// confirmed against. If the actual status has changed since then, returns
/// `STATUS_CHANGED` and the caller must re-show the updated file list.
///
/// NEVER runs `git clean -fd`. Untracked files are removed one by one.
#[tauri::command]
fn repository_discard_changes(
    state: State<AppState>,
    repo_id: String,
    file_path: String,
    expected_status_hash: String,
) -> CmdResult<GitStatus> {
    let _lock = state.locks.try_acquire(&repo_id).map_err(AppError::from)?;
    with_db(&state, |db| {
        RepositoryService::discard_changes(db, &repo_id, &file_path, &expected_status_hash)
    })
}

/// Returns the status hash for the given repository — used by the frontend
/// to obtain the token before calling `repository_discard_changes`.
#[tauri::command]
fn repository_get_status_hash(state: State<AppState>, repo_id: String) -> CmdResult<String> {
    with_db(&state, |db| {
        let status = RepositoryService::get_repository_status(db, &repo_id)?;
        Ok(RepositoryService::compute_status_hash(&status))
    })
}

// ---------------------------------------------------------------------------
// Faz 4 — branch, commit, identity & history commands
// ---------------------------------------------------------------------------

/// Lists all local and remote branches for a repository.
#[tauri::command]
fn repository_get_branches(state: State<AppState>, repo_id: String) -> CmdResult<Vec<BranchInfo>> {
    with_db(&state, |db| RepositoryService::get_branches(db, &repo_id))
}

/// Creates a new branch from a base reference.
#[tauri::command]
fn repository_create_branch(
    state: State<AppState>,
    repo_id: String,
    name: String,
    base_ref: Option<String>,
    checkout: bool,
) -> CmdResult<BranchInfo> {
    let _lock = state.locks.try_acquire(&repo_id).map_err(AppError::from)?;
    with_db(&state, |db| {
        RepositoryService::create_branch(db, &repo_id, &name, base_ref.as_deref(), checkout)
    })
}

/// Safely checks out a branch. If uncommitted changes conflict, returns DIRTY_WORKTREE error.
#[tauri::command]
fn repository_checkout_branch(
    state: State<AppState>,
    repo_id: String,
    branch: String,
) -> CmdResult<GitStatus> {
    let _lock = state.locks.try_acquire(&repo_id).map_err(AppError::from)?;
    with_db(&state, |db| {
        RepositoryService::checkout_branch(db, &repo_id, &branch)
    })
}

/// Safely deletes a branch (never active branch).
#[tauri::command]
fn repository_delete_branch(
    state: State<AppState>,
    repo_id: String,
    branch: String,
    force: bool,
) -> CmdResult<bool> {
    let _lock = state.locks.try_acquire(&repo_id).map_err(AppError::from)?;
    with_db(&state, |db| {
        RepositoryService::delete_branch(db, &repo_id, &branch, force)
    })
}

/// Reads effective Git user.name and user.email for a repository.
#[tauri::command]
fn repository_get_identity(state: State<AppState>, repo_id: String) -> CmdResult<GitIdentity> {
    with_db(&state, |db| {
        RepositoryService::get_git_identity(db, &repo_id)
    })
}

/// Sets repository-local user.name and user.email.
#[tauri::command]
fn repository_set_identity(
    state: State<AppState>,
    repo_id: String,
    name: String,
    email: String,
) -> CmdResult<GitIdentity> {
    let _lock = state.locks.try_acquire(&repo_id).map_err(AppError::from)?;
    with_db(&state, |db| {
        RepositoryService::set_git_identity(db, &repo_id, &name, &email)
    })
}

/// Creates a commit with the provided message.
/// Validates message, staged changes, and Git identity guard.
#[tauri::command]
fn repository_commit(
    state: State<AppState>,
    repo_id: String,
    message: String,
    amend: Option<bool>,
) -> CmdResult<CommitResult> {
    let _lock = state.locks.try_acquire(&repo_id).map_err(AppError::from)?;
    with_db(&state, |db| {
        RepositoryService::commit(db, &repo_id, &message, amend.unwrap_or(false))
    })
}

/// Son commit'in yalnızca mesajını yeniden yazar. Push edilmiş commit
/// reddedilir (AMEND_PUSHED) — geçmiş sessizce değiştirilmez.
#[tauri::command]
fn repository_amend_message(
    state: State<AppState>,
    repo_id: String,
    message: String,
) -> CmdResult<CommitResult> {
    let _lock = state.locks.try_acquire(&repo_id).map_err(AppError::from)?;
    with_db(&state, |db| {
        RepositoryService::amend_message(db, &repo_id, &message)
    })
}

/// Reads commit history with pagination.
#[tauri::command]
fn repository_get_history(
    state: State<AppState>,
    repo_id: String,
    ref_name: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> CmdResult<HistoryOutput> {
    with_db(&state, |db| {
        RepositoryService::get_history(
            db,
            &repo_id,
            ref_name.as_deref(),
            limit.unwrap_or(50),
            offset.unwrap_or(0),
        )
    })
}

// ---------------------------------------------------------------------------
// Faz 5 — remote operations & operation state
// ---------------------------------------------------------------------------

/// Fetches changes from a remote without altering working tree.
#[tauri::command]
fn repository_fetch(
    state: State<AppState>,
    repo_id: String,
    remote: Option<String>,
) -> CmdResult<GitStatus> {
    let _lock = state.locks.try_acquire(&repo_id).map_err(AppError::from)?;
    with_db(&state, |db| {
        RepositoryService::fetch(db, &repo_id, remote.as_deref())
    })
}

/// Pulls changes into the active branch.
#[tauri::command]
fn repository_pull(
    state: State<AppState>,
    repo_id: String,
    remote: Option<String>,
    branch: Option<String>,
    strategy: Option<String>,
) -> CmdResult<GitStatus> {
    let _lock = state.locks.try_acquire(&repo_id).map_err(AppError::from)?;
    with_db(&state, |db| {
        RepositoryService::pull(
            db,
            &repo_id,
            remote.as_deref(),
            branch.as_deref(),
            strategy.as_deref(),
        )
    })
}

/// Pushes commits of the active branch to remote.
#[tauri::command]
fn repository_push(
    state: State<AppState>,
    repo_id: String,
    remote: Option<String>,
    branch: Option<String>,
    force: Option<bool>,
    set_upstream: Option<bool>,
) -> CmdResult<GitStatus> {
    let _lock = state.locks.try_acquire(&repo_id).map_err(AppError::from)?;
    with_db(&state, |db| {
        // Hesap bazlı kimlik çözümü: origin owner'ı ↔ bağlı hesap login'i.
        // Eşleşme varsa push o hesabın token'ıyla (yalnızca HTTPS) gider ve
        // depo yerel commit kimliği hesaba göre kendiliğinden düzelir.
        let owner_identity = origin_owner_identity(&state, db, &repo_id);
        let token = match &owner_identity {
            // SSH remote: ~/.ssh/config kimliği zaten doğru hesabı seçer.
            Some((account, true)) => state.github.access_token(db, &account.id).ok(),
            _ => None,
        };
        if let Some((account, _)) = &owner_identity {
            let (name, email) = GitHubService::git_identity_for(account);
            // Best-effort ve yıkıcı değil: yalnızca gelecek commit'lerin kimliği
            // ayarlanır; manuel ayarlanmış kimliğe dokunulmaz. Geçmiş yeniden
            // yazımı yalnızca yayınlama akışında yapılır (remote boşken güvenli).
            let _ = apply_repo_identity(db, &repo_id, &name, &email, true, false);
        }
        RepositoryService::push(
            db,
            &repo_id,
            remote.as_deref(),
            branch.as_deref(),
            force.unwrap_or(false),
            set_upstream.unwrap_or(false),
            token.as_deref(),
        )
    })
}

/// Çözüm: origin URL'sinin owner'ı ↔ bağlı GitHub hesabı login'i. Dönüş:
/// (hesap, url HTTPS mi?). Eşleşme yoksa None — push sistem kimliğiyle denenir.
fn origin_owner_identity(
    state: &AppState,
    db: &Database,
    repo_id: &str,
) -> Option<(GitHubAccount, bool)> {
    let record = RepositoryService::get_repository(db, repo_id).ok()?;
    let remotes =
        GitRemoteManager::list_remotes(std::path::Path::new(&record.canonical_path)).ok()?;
    let url = remotes
        .iter()
        .find(|r| r.name == "origin")
        .and_then(|r| r.push_url.as_ref().or(r.fetch_url.as_ref()))?;
    let (owner, https) = GitRemoteManager::parse_remote_owner(url)?;
    state
        .github
        .account_for_repo_owner(db, &owner)
        .ok()
        .flatten()
        .map(|account| (account, https))
}

/// Depo commit kimliğini verilen hesaba bağlar: depo-yerel `user.name`/
/// `user.email` ayarlanır. `rewrite_history` ek olarak makinenin varsayılan
/// e-postasıyla yazılmış mevcut commit'leri bu kimliğe çevirir — yalnızca
/// yayınlama akışında kullanılır (yeni oluşturulan remote boş olduğu için
/// güvenli; push akışında yıkıcı olduğundan kapalıdır). Diğer yazarların
/// commit'lerine dokunulmaz. `respect_manual`: kullanıcı ChangesView'dan elle
/// kimlik verdiyse (hesabın adresinden farklıysa) hiçbir şeye dokunulmaz.
/// Best-effort: hata durumunda kısa not döner — yayında uyarıya eklenir.
fn apply_repo_identity(
    db: &Database,
    repo_id: &str,
    name: &str,
    email: &str,
    respect_manual: bool,
    rewrite_history: bool,
) -> Option<String> {
    let record = RepositoryService::get_repository(db, repo_id).ok()?;
    let path = std::path::Path::new(&record.canonical_path);

    let local = GitConfigManager::local_email(path);
    let manual_identity = local
        .as_deref()
        .is_some_and(|e| !e.eq_ignore_ascii_case(email));
    if respect_manual && manual_identity {
        return None; // kullanıcı bu depoya bilinçli kimlik vermiş — saygı
    }

    let previous = GitCommitManager::get_identity(path)
        .ok()
        .and_then(|id| id.email);
    if let Err(e) = GitCommitManager::set_identity(path, name, email) {
        return Some(format!("Depo kimliği ayarlanamadı: {}", e.message));
    }

    // Yeniden yazım yalnızca istendiyse, geçmiş varsa, eski kimlik hesaptan
    // farklıysa ve çalışma alanı temizse anlamlı/güvenli.
    let needs_rewrite = previous
        .as_deref()
        .is_some_and(|p| !p.eq_ignore_ascii_case(email));
    if !rewrite_history || !needs_rewrite || !GitConfigManager::has_commits(path) {
        return None;
    }
    if GitConfigManager::has_pending_changes(path) {
        return Some(
            "Makine varsayılanıyla yazılmış commit'lerin sahipliği henüz düzeltilmedi: \
             çalışma alanında bekleyen değişiklikler var. Onları commit'ledikten sonraki \
             ilk Push'ta sahiplik kendiliğinden düzelir."
                .to_string(),
        );
    }
    GitConfigManager::rewrite_authorship(path, previous.as_deref().unwrap_or_default(), name, email)
        .err()
        .map(|e| format!("Commit sahipliği yeniden yazılamadı: {}", e.message))
}

/// Lists all configured remotes for a repository.
#[tauri::command]
fn repository_list_remotes(state: State<AppState>, repo_id: String) -> CmdResult<Vec<RemoteInfo>> {
    with_db(&state, |db| RepositoryService::list_remotes(db, &repo_id))
}

/// Untracked bir dosya/dizini yoksayma dosyasına ekler.
/// `scope`: "repo" (.gitignore) | "local" (.git/info/exclude — sadece bu makine).
#[tauri::command]
fn repository_ignore_file(
    state: State<AppState>,
    repo_id: String,
    path: String,
    scope: String,
) -> CmdResult<IgnoredFile> {
    with_db(&state, |db| {
        RepositoryService::ignore_file(db, &repo_id, &path, &scope)
    })
}

/// Çalışma ağacındaki değişiklikleri stash'ler (kenara alır).
#[tauri::command]
fn repository_stash_push(
    state: State<AppState>,
    repo_id: String,
    message: Option<String>,
    include_untracked: Option<bool>,
) -> CmdResult<GitStatus> {
    let _lock = state.locks.try_acquire(&repo_id).map_err(AppError::from)?;
    with_db(&state, |db| {
        RepositoryService::stash_push(
            db,
            &repo_id,
            message.as_deref().unwrap_or(""),
            include_untracked.unwrap_or(false),
        )
    })
}

#[tauri::command]
fn repository_stash_list(state: State<AppState>, repo_id: String) -> CmdResult<Vec<StashEntry>> {
    with_db(&state, |db| RepositoryService::stash_list(db, &repo_id))
}

/// Stash'i uygular; stash listede KALIR.
#[tauri::command]
fn repository_stash_apply(
    state: State<AppState>,
    repo_id: String,
    id: String,
) -> CmdResult<GitStatus> {
    let _lock = state.locks.try_acquire(&repo_id).map_err(AppError::from)?;
    with_db(&state, |db| RepositoryService::stash_apply(db, &repo_id, &id))
}

/// Stash'i uygular ve listeden düşürür.
#[tauri::command]
fn repository_stash_pop(
    state: State<AppState>,
    repo_id: String,
    id: String,
) -> CmdResult<GitStatus> {
    let _lock = state.locks.try_acquire(&repo_id).map_err(AppError::from)?;
    with_db(&state, |db| RepositoryService::stash_pop(db, &repo_id, &id))
}

#[tauri::command]
fn repository_stash_drop(
    state: State<AppState>,
    repo_id: String,
    id: String,
) -> CmdResult<Vec<StashEntry>> {
    let _lock = state.locks.try_acquire(&repo_id).map_err(AppError::from)?;
    with_db(&state, |db| RepositoryService::stash_drop(db, &repo_id, &id))
}

/// Returns the current operation state (Normal, MergeInProgress, RebaseInProgress, etc.).
#[tauri::command]
fn repository_get_operation_state(
    state: State<AppState>,
    repo_id: String,
) -> CmdResult<RepositoryOperationState> {
    with_db(&state, |db| {
        RepositoryService::get_operation_state(db, &repo_id)
    })
}

// ---------------------------------------------------------------------------
// Faz 6 — GitHub accounts & repository API
// ---------------------------------------------------------------------------

/// Starts a GitHub Device-Flow login session.
///
/// Returns `DeviceFlowSession` with user_code and verification_uri safe to show in UI.
/// The actual `device_code` stays in Rust memory ONLY — never sent to frontend.
///
/// UI should: show user_code → open verification_uri in browser → poll `github_poll_login`.
#[tauri::command]
fn github_begin_login(state: State<AppState>) -> CmdResult<DeviceFlowSession> {
    let (session, pending) = state.github.begin_device_flow().map_err(AppError::from)?;

    let mut flows = state
        .pending_device_flow
        .lock()
        .map_err(|_| AppError::simple("INTERNAL_ERROR", "Oturum kilidi alınamadı.", false))?;
    // Opportunistic GC: drop sessions whose user never finished the browser step.
    flows.retain(|_, p| !p.is_expired());
    // Keyed insert: a second concurrent login never evicts the first one.
    flows.insert(session.session_token.clone(), pending);
    Ok(session)
}

/// Polls the in-progress device-flow session once.
///
/// - `{ status: "pending" }` → user not yet authorised, retry after `interval` seconds.
/// - `{ status: "success", account: GitHubAccount }` → login complete, account created.
/// - `Err(OAUTH_STATE_MISMATCH)` → session_token is wrong.
/// - `Err(DEVICE_FLOW_EXPIRED)` → code expired, call `github_begin_login` again.
/// - `Err(AUTH_REQUIRED)` → user denied access.
#[tauri::command]
fn github_poll_login(state: State<AppState>, session_token: String) -> CmdResult<PollResult> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::simple("DATABASE_ERROR", "Veritabanı kilidi alınamadı.", false))?;

    // Take this session's pending flow out of the map. `PendingDeviceFlow` is
    // not Clone, so we remove → poll → re-insert only if still pending. This
    // also guarantees the session is dropped on success, expiry or denial.
    let pending = {
        let mut flows = state
            .pending_device_flow
            .lock()
            .map_err(|_| AppError::simple("INTERNAL_ERROR", "Oturum kilidi alınamadı.", false))?;
        flows.retain(|_, p| !p.is_expired());
        flows.remove(&session_token).ok_or_else(|| {
            AppError::simple(
                "NO_ACTIVE_LOGIN",
                "Aktif giriş oturumu yok veya süresi dolmuş. Önce github_begin_login çağırın.",
                true,
            )
        })?
    };

    let pending_result = state
        .github
        .poll_device_flow(&db, &pending, &session_token)
        .map_err(AppError::from)?;

    // Keep the session alive only while the user has not finished the browser step.
    if matches!(pending_result, PollResult::Pending)
        && let Ok(mut flows) = state.pending_device_flow.lock()
    {
        flows.insert(session_token, pending);
    }

    Ok(pending_result)
}

/// Lists all connected GitHub accounts.  Token fields are NEVER included.
#[tauri::command]
fn github_list_accounts(state: State<AppState>) -> CmdResult<Vec<GitHubAccount>> {
    with_db(&state, |db| state.github.list_accounts(db))
}

/// Disconnects a GitHub account: deletes token from OS keyring and removes DB record.
/// Git credential helpers are NOT modified (per spec §6.2).
#[tauri::command]
fn github_disconnect_account(state: State<AppState>, account_id: String) -> CmdResult<()> {
    with_db(&state, |db| {
        state.github.disconnect_account(db, &account_id)
    })
}

/// Lists repositories for the given account with pagination (1-indexed page, clamped per_page).
/// Returns `AUTH_EXPIRED` if the token is missing from the OS credential store.
#[tauri::command]
fn github_list_repos(
    state: State<AppState>,
    account_id: String,
    page: Option<u32>,
    per_page: Option<u32>,
) -> CmdResult<GitHubRepoPage> {
    with_db(&state, |db| {
        state
            .github
            .list_repos(db, &account_id, page.unwrap_or(1), per_page.unwrap_or(30))
    })
}

/// Fetches the live public profile/overview (bio, counts, avatar…) for a
/// connected account. Token stays in Rust; only public metadata is returned.
#[tauri::command]
fn github_get_account_profile(
    state: State<AppState>,
    account_id: String,
) -> CmdResult<GitHubProfile> {
    with_db(&state, |db| {
        state.github.get_account_profile(db, &account_id)
    })
}

/// Publishes a local repository to GitHub:
/// 1. verifies the repo exists locally and has no `origin` yet,
/// 2. creates the remote repo via the GitHub API (`POST /user/repos`),
/// 3. adds `origin` pointing at it,
/// 4. best-effort pushes the current branch with `--set-upstream`.
///
/// If step 4 fails (e.g. HEAD is unborn / git-level auth), the created remote
/// repo and the configured origin are kept and the reason is returned as a
/// warning — the user can finish from the status bar's Push button later.
#[tauri::command]
fn github_publish_repository(
    state: State<AppState>,
    account_id: String,
    repo_id: String,
    name: String,
    description: Option<String>,
    private: Option<bool>,
) -> CmdResult<GitHubPublishResult> {
    let _lock = state.locks.try_acquire(&repo_id).map_err(AppError::from)?;
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::simple("DATABASE_ERROR", "Veritabanı kilidi alınamadı.", false))?;

    // 1. Fail fast BEFORE creating anything on GitHub.
    let record = RepositoryService::get_repository(&db, &repo_id).map_err(AppError::from)?;
    let path = std::path::Path::new(&record.canonical_path);
    let remotes = GitRemoteManager::list_remotes(path).map_err(AppError::from)?;
    if remotes.iter().any(|r| r.name == "origin") {
        return Err(AppError::simple(
            "REMOTE_EXISTS",
            "'origin' remote'u zaten tanımlı. Bu depo yayınlanmış sayılır — gönderim için Dışa Aktar (Push) kullanın.",
            false,
        ));
    }

    // 2. Create the repository on GitHub.
    let created = state
        .github
        .create_remote_repo(
            &db,
            &account_id,
            &name,
            description.as_deref(),
            private.unwrap_or(false),
        )
        .map_err(AppError::from)?;

    // 3. Wire origin. If this fails the GitHub repo still exists — surface both facts.
    // Hesap için SSH host alias tanımlıysa (ssh_hosts.toml) SSH adresi tercih edilir.
    let remote_url = created
        .ssh_remote
        .as_deref()
        .unwrap_or(created.clone_url.as_str());
    if let Err(e) = GitRemoteManager::add(path, "origin", remote_url) {
        return Err(AppError::from(CommandError::new(
            "PUBLISH_PARTIAL",
            format!(
                "GitHub deposu oluşturuldu ({}) ancak 'origin' eklenemedi: {}",
                created.html_url, e.message
            ),
            true,
        )));
    }

    // 3.5. Depo commit kimliği = yayımlanan hesap: bundan sonraki commit'ler
    // o hesapla oluşur; makinenin varsayılan e-postasıyla yazılmış mevcut
    // commit'ler de bu hesaba çevrilir (remote yeni oluşturuldu — geçmiş için
    // risk yok, push öncesi son fırsat).
    let identity_note = state
        .github
        .git_identity(&db, &account_id)
        .ok()
        .and_then(|(name, email)| apply_repo_identity(&db, &repo_id, &name, &email, false, true));

    // 4. Best-effort initial push (never forces). Hesabın token'ı ile:
    // origin HTTPS ise kimlik doğrudan bu hesap olur; SSH ise config devrede.
    let push_token = state.github.access_token(&db, &account_id).ok();
    let (pushed, warning) = match RepositoryService::push(
        &db,
        &repo_id,
        None,
        None,
        false,
        true,
        push_token.as_deref(),
    ) {
        Ok(_) => (true, identity_note),
        Err(e) => (
            false,
            Some(match identity_note {
                Some(note) => format!("{} — {}", e.message, note),
                None => e.message,
            }),
        ),
    };

    Ok(GitHubPublishResult {
        html_url: created.html_url,
        clone_url: created.clone_url,
        pushed,
        warning,
    })
}

// ---------------------------------------------------------------------------
// Faz 7 — app info, settings, details, re-link, clone, merge, history detail
// ---------------------------------------------------------------------------

/// Returns static application metadata (name, version, OS, architecture).
#[tauri::command]
fn app_get_info() -> AppInfo {
    AppInfo {
        name: "GitOrbit".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

/// Reads persisted application settings.
#[tauri::command]
fn settings_get(state: State<AppState>) -> CmdResult<AppSettings> {
    with_db(&state, SettingsService::get)
}

/// Validates and persists application settings.
#[tauri::command]
fn settings_update(state: State<AppState>, update: AppSettingsUpdate) -> CmdResult<AppSettings> {
    with_db(&state, |db| SettingsService::update(db, update))
}

/// Returns repository metadata plus best-effort status and remotes.
#[tauri::command]
fn repository_get_details(state: State<AppState>, repo_id: String) -> CmdResult<RepositoryDetails> {
    with_db(&state, |db| {
        RepositoryService::get_repository_details(db, &repo_id)
    })
}

/// Re-links an existing record to a moved repository directory.
#[tauri::command]
fn repository_relink(
    state: State<AppState>,
    repo_id: String,
    new_path: String,
) -> CmdResult<RepositoryRecord> {
    let _lock = state.locks.try_acquire(&repo_id).map_err(AppError::from)?;
    with_db(&state, |db| {
        RepositoryService::relink_repository(db, &repo_id, &new_path)
    })
}

/// Clones a remote URL into an empty destination and registers the result.
#[tauri::command]
fn repository_clone(
    state: State<AppState>,
    url: String,
    destination: String,
) -> CmdResult<CloneResult> {
    let _lock = state
        .locks
        .try_acquire(destination.trim())
        .map_err(AppError::from)?;
    with_db(&state, |db| {
        RepositoryService::clone_repository(db, &url, &destination)
    })
}

/// Safely merges `branch` into the active branch.
#[tauri::command]
fn repository_merge_branch(
    state: State<AppState>,
    repo_id: String,
    branch: String,
) -> CmdResult<GitStatus> {
    let _lock = state.locks.try_acquire(&repo_id).map_err(AppError::from)?;
    with_db(&state, |db| {
        RepositoryService::merge_branch(db, &repo_id, &branch)
    })
}

/// Continues an in-progress merge/rebase/cherry-pick/revert.
#[tauri::command]
fn repository_continue_operation(state: State<AppState>, repo_id: String) -> CmdResult<GitStatus> {
    let _lock = state.locks.try_acquire(&repo_id).map_err(AppError::from)?;
    with_db(&state, |db| {
        RepositoryService::continue_operation(db, &repo_id)
    })
}

/// Aborts an in-progress operation. The UI MUST ask for explicit confirmation.
#[tauri::command]
fn repository_abort_operation(state: State<AppState>, repo_id: String) -> CmdResult<GitStatus> {
    let _lock = state.locks.try_acquire(&repo_id).map_err(AppError::from)?;
    with_db(&state, |db| {
        RepositoryService::abort_operation(db, &repo_id)
    })
}

/// v0.2 — çakışmalı bir dosyayı seçilen tarafla çözer ("ours" | "theirs")
/// ve stage'ler. Yalnızca devam eden bir işlem varsa çalışır.
#[tauri::command]
fn repository_resolve_conflict(
    state: State<AppState>,
    repo_id: String,
    path: String,
    side: String,
) -> CmdResult<GitStatus> {
    let ours = match side.as_str() {
        "ours" => true,
        "theirs" => false,
        _ => {
            return Err(AppError::simple(
                "VALIDATION_ERROR",
                "Geçersiz taraf: ours veya theirs olmalı.",
                true,
            ));
        }
    };
    let _lock = state.locks.try_acquire(&repo_id).map_err(AppError::from)?;
    with_db(&state, |db| {
        RepositoryService::resolve_conflict(db, &repo_id, &path, ours)
    })
}

// ---------------------------------------------------------------------------
// Faz 8 / v0.2 madde 8 — çoklu depo senkronizasyonu (tümünü pull/push)
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq)]
enum SyncKind {
    Pull,
    Push,
}

/// Sıralı senkron turu: planlama saf fonksiyonda (`plan_sync_list`), uygulama
/// burada. Depolar arasında iptal bayrağı kontrol edilir; kilitli depo
/// beklemez, atlanır. Hata bir depoyu durdurmaz — sonuç listesi döner.
fn run_sync_round(state: &State<AppState>, kind: SyncKind) -> Vec<RepoSyncOutcome> {
    state.sync_cancel.store(false, Ordering::Relaxed);

    // 1) Girdi topla (kayıtlı depolar + hızlı ön kontroller).
    let inputs: Vec<SyncRepoInput> = with_db(state, |db| {
        let repos = RepositoryService::list_repositories(db)?;
        let mut inputs = Vec::with_capacity(repos.len());
        for repo in repos {
            let mut input = SyncRepoInput {
                repo_id: repo.id.clone(),
                name: repo.display_name.clone(),
                missing: repo.missing,
                locked: false,
                has_origin: false,
                upstream: None,
                status_error: false,
            };
            if !repo.missing {
                let path = std::path::Path::new(&repo.canonical_path);
                match GitRemoteManager::list_remotes(path) {
                    Ok(remotes) => {
                        input.has_origin = remotes.iter().any(|r| r.name == "origin")
                    }
                    Err(_) => input.status_error = true,
                }
                match RepositoryService::get_repository_status(db, &repo.id) {
                    Ok(status) => input.upstream = status.upstream,
                    Err(_) => input.status_error = true,
                }
            }
            inputs.push(input);
        }
        Ok(inputs)
    })
    .unwrap_or_default();

    // 2) Planla ve sırayla uygula.
    let mut outcomes = Vec::new();
    let cancelled = || state.sync_cancel.load(Ordering::Relaxed);

    for entry in plan_sync_list(inputs) {
        let (repo_id, name) = match entry {
            SyncPlanEntry::Skip {
                repo_id,
                name,
                reason,
            } => {
                outcomes.push(RepoSyncOutcome {
                    repo_id,
                    name,
                    status: SyncOutcomeStatus::Skipped,
                    detail: Some(reason.label().to_string()),
                    summary: None,
                });
                continue;
            }
            SyncPlanEntry::Run { repo_id, name } => (repo_id, name),
        };

        if cancelled() {
            outcomes.push(RepoSyncOutcome {
                repo_id,
                name,
                status: SyncOutcomeStatus::Skipped,
                detail: Some(SyncSkipReason::Cancelled.label().to_string()),
                summary: None,
            });
            continue;
        }

        // Kilit: kullanıcı bu depoda işlem yapıyorsa beklemeden atla.
        let _guard = match state.locks.try_acquire(&repo_id) {
            Ok(guard) => guard,
            Err(_) => {
                outcomes.push(RepoSyncOutcome {
                    repo_id,
                    name,
                    status: SyncOutcomeStatus::Skipped,
                    detail: Some(SyncSkipReason::Locked.label().to_string()),
                    summary: None,
                });
                continue;
            }
        };

        let result = match kind {
            SyncKind::Pull => with_db(state, |db| {
                RepositoryService::pull(db, &repo_id, None, None, None)
            }),
            SyncKind::Push => with_db(state, |db| {
                // repository_push ile aynı hesap-duyarlı kimlik/token mantığı.
                let owner_identity = origin_owner_identity(state, db, &repo_id);
                let token = match &owner_identity {
                    Some((account, true)) => state.github.access_token(db, &account.id).ok(),
                    _ => None,
                };
                if let Some((account, _)) = &owner_identity {
                    let (name, email) = GitHubService::git_identity_for(account);
                    let _ = apply_repo_identity(db, &repo_id, &name, &email, true, false);
                }
                RepositoryService::push(db, &repo_id, None, None, false, false, token.as_deref())
            }),
        };

        outcomes.push(match result {
            Ok(status) => RepoSyncOutcome {
                repo_id,
                name,
                status: SyncOutcomeStatus::Done,
                detail: None,
                summary: match kind {
                    SyncKind::Pull => Some("güncel".to_string()),
                    SyncKind::Push => Some(if status.ahead > 0 {
                        format!("{} commit hâlâ ileride", status.ahead)
                    } else {
                        "gönderildi".to_string()
                    }),
                },
            },
            Err(err) => RepoSyncOutcome {
                repo_id,
                name,
                status: SyncOutcomeStatus::Error,
                detail: Some(err.message),
                summary: None,
            },
        });
    }

    outcomes
}

/// Tüm depoları sırayla içe aktarır (pull). İlerleme frontend'deki modalda;
/// `sync_cancel_all` ile tur durdurulabilir.
#[tauri::command]
async fn sync_pull_all(app: AppHandle) -> CmdResult<Vec<RepoSyncOutcome>> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        run_sync_round(&state, SyncKind::Pull)
    })
    .await
    .map_err(|_| AppError::simple("INTERNAL_ERROR", "Senkron turu başlatılamadı.", false))
}

/// Tüm depoları sırayla dışa aktarır (push). Push edilecek commit'i olmayan
/// depo başarısız sayılmaz (yerel commit yoksa push uçta hızlı döner).
#[tauri::command]
async fn sync_push_all(app: AppHandle) -> CmdResult<Vec<RepoSyncOutcome>> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        run_sync_round(&state, SyncKind::Push)
    })
    .await
    .map_err(|_| AppError::simple("INTERNAL_ERROR", "Senkron turu başlatılamadı.", false))
}

/// Devam eden "tümünü eşitle" turunu bir sonraki depoda durdurur.
#[tauri::command]
fn sync_cancel_all(state: State<AppState>) -> bool {
    state.sync_cancel.store(true, Ordering::Relaxed);
    true
}

/// Reads full details (files and line stats) for a commit.
#[tauri::command]
fn repository_get_commit_details(
    state: State<AppState>,
    repo_id: String,
    sha: String,
) -> CmdResult<CommitDetails> {
    with_db(&state, |db| {
        RepositoryService::get_commit_details(db, &repo_id, &sha)
    })
}

/// Reads the unified diff of a commit.
#[tauri::command]
fn repository_get_commit_diff(
    state: State<AppState>,
    repo_id: String,
    sha: String,
) -> CmdResult<DiffOutput> {
    with_db(&state, |db| {
        RepositoryService::get_commit_diff(db, &repo_id, &sha)
    })
}

/// Compares two branches (ahead/behind and commits unique to `head`).
#[tauri::command]
fn repository_compare_branches(
    state: State<AppState>,
    repo_id: String,
    base: String,
    head: String,
) -> CmdResult<BranchComparison> {
    with_db(&state, |db| {
        RepositoryService::compare_branches(db, &repo_id, &base, &head)
    })
}

/// Reveals a repository path in the OS file manager.
#[tauri::command]
fn open_path_in_file_manager(app: AppHandle, path: String) -> CmdResult<()> {
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| AppError::from(CommandError::io_error(e.to_string())))
}

// ---------------------------------------------------------------------------
// Tauri app entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState::init().expect("Uygulama veritabani baslatma hatasi");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // Utility
            greet,
            ping,
            // Faz 2 — repository management
            app_get_environment,
            app_get_info,
            repository_add,
            repository_init,
            repository_list,
            repository_remove,
            repository_set_pinned,
            repository_get_status,
            repository_get_details,
            repository_relink,
            repository_clone,
            open_path_in_file_manager,
            // Settings
            settings_get,
            settings_update,
            // Faz 3 — changes & diff
            repository_stage_files,
            repository_unstage_files,
            repository_get_diff,
            repository_discard_changes,
            repository_get_status_hash,
            // Faz 4 — branch, commit, history
            repository_get_branches,
            repository_create_branch,
            repository_checkout_branch,
            repository_delete_branch,
            repository_get_identity,
            repository_set_identity,
            repository_commit,
            repository_get_history,
            repository_get_commit_details,
            repository_get_commit_diff,
            repository_compare_branches,
            // Faz 5 — remote & operation state
            repository_fetch,
            repository_pull,
            repository_push,
            repository_merge_branch,
            repository_continue_operation,
            repository_abort_operation,
            repository_resolve_conflict,
            sync_pull_all,
            sync_push_all,
            sync_cancel_all,
            repository_list_remotes,
            repository_ignore_file,
            repository_stash_push,
            repository_stash_list,
            repository_stash_apply,
            repository_stash_pop,
            repository_stash_drop,
            repository_amend_message,
            repository_get_operation_state,
            // Faz 6 — GitHub accounts & repositories
            github_begin_login,
            github_poll_login,
            github_list_accounts,
            github_disconnect_account,
            github_list_repos,
            github_get_account_profile,
            github_publish_repository,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_greet() {
        assert_eq!(
            greet("Developer"),
            "Hello, Developer! You've been greeted from Rust!"
        );
    }

    #[test]
    fn test_ping() {
        assert_eq!(ping(), "pong");
    }

    #[test]
    fn test_app_error_from_command_error() {
        let ce = CommandError::new("TEST_CODE", "test message", true);
        let ae = AppError::from(ce);
        assert_eq!(ae.code, "TEST_CODE");
        assert_eq!(ae.message, "test message");
        assert!(ae.recoverable);
    }
}
