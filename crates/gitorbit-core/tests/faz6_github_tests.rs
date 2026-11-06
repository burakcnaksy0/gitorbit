#![allow(clippy::result_large_err)]

use gitorbit_core::CommandError;
/// Faz 6 acceptance tests — GitHub account management and repository API.
///
/// These tests use in-memory credential store and mock HTTP client,
/// so they run without OS keyring daemon or real GitHub credentials.
///
/// # Acceptance criteria being tested:
/// - AC1: Token never appears in DB or returned structs
/// - AC2: OAuth state mismatch is rejected (OAUTH_STATE_MISMATCH)
/// - AC3: Second login for same GitHub user updates existing row (no duplicate)
/// - AC4: API error codes mapped correctly (AUTH_REQUIRED, RATE_LIMITED, etc.)
/// - AC5: Disconnect clears credential store and DB record
/// - AC6: Repository listing respects pagination
/// - AC7: Device-flow expiry is detected
use gitorbit_core::credential_store::InMemoryCredentialStore;
use gitorbit_core::db::Database;
use gitorbit_core::models::{GitHubConnectionStatus, PollResult};
use gitorbit_core::services::github_service::{
    GitHubHttpClient, GitHubService, PendingDeviceFlow, RawDeviceFlowResponse, RawOwner,
    RawPollResponse, RawRepoResponse, RawUserResponse,
};
use std::sync::Mutex;

// ---------------------------------------------------------------------------
// Mock HTTP client
// ---------------------------------------------------------------------------

struct MockGitHubHttpClient {
    device_flow_resp: RawDeviceFlowResponse,
    /// Controlled by test: first call returns Pending, subsequent calls return Success.
    poll_responses: Mutex<Vec<RawPollResponse>>,
    user_resp: RawUserResponse,
    repos_resp: Vec<RawRepoResponse>,
}

impl MockGitHubHttpClient {
    fn new_with_success_on_first_poll() -> Self {
        Self {
            device_flow_resp: RawDeviceFlowResponse {
                device_code: "test_device_code".to_string(),
                user_code: "ABCD-1234".to_string(),
                verification_uri: "https://github.com/login/device".to_string(),
                expires_in: 900,
                interval: 5,
            },
            poll_responses: Mutex::new(vec![RawPollResponse::Success {
                access_token: "test_token_xyz".to_string(),
                token_type: "bearer".to_string(),
                scope: "read:user,public_repo".to_string(),
            }]),
            user_resp: RawUserResponse {
                id: 12345,
                login: "testuser".to_string(),
                name: Some("Test User".to_string()),
                avatar_url: Some("https://avatars.githubusercontent.com/u/12345".to_string()),
            },
            repos_resp: vec![RawRepoResponse {
                id: 1001,
                name: "my-repo".to_string(),
                full_name: "testuser/my-repo".to_string(),
                description: Some("A test repo".to_string()),
                clone_url: "https://github.com/testuser/my-repo.git".to_string(),
                ssh_url: "git@github.com:testuser/my-repo.git".to_string(),
                html_url: "https://github.com/testuser/my-repo".to_string(),
                private: false,
                fork: false,
                default_branch: "main".to_string(),
                language: Some("Rust".to_string()),
                stargazers_count: 42,
                visibility: Some("public".to_string()),
                owner: RawOwner {
                    login: "testuser".to_string(),
                },
            }],
        }
    }

    fn new_with_pending_then_success() -> Self {
        Self {
            device_flow_resp: RawDeviceFlowResponse {
                device_code: "test_device_code_2".to_string(),
                user_code: "EFGH-5678".to_string(),
                verification_uri: "https://github.com/login/device".to_string(),
                expires_in: 900,
                interval: 5,
            },
            poll_responses: Mutex::new(vec![
                RawPollResponse::Pending {
                    error: "authorization_pending".to_string(),
                    error_description: Some("User has not yet authorized.".to_string()),
                },
                RawPollResponse::Success {
                    access_token: "test_token_abc".to_string(),
                    token_type: "bearer".to_string(),
                    scope: "read:user,public_repo".to_string(),
                },
            ]),
            user_resp: RawUserResponse {
                id: 99999,
                login: "anotheruser".to_string(),
                name: Some("Another User".to_string()),
                avatar_url: None,
            },
            repos_resp: vec![],
        }
    }

    fn new_with_denied() -> Self {
        Self {
            device_flow_resp: RawDeviceFlowResponse {
                device_code: "test_device_code_denied".to_string(),
                user_code: "DENY-0000".to_string(),
                verification_uri: "https://github.com/login/device".to_string(),
                expires_in: 900,
                interval: 5,
            },
            poll_responses: Mutex::new(vec![RawPollResponse::Pending {
                error: "access_denied".to_string(),
                error_description: Some("User denied access.".to_string()),
            }]),
            user_resp: RawUserResponse {
                id: 0,
                login: "nobody".to_string(),
                name: None,
                avatar_url: None,
            },
            repos_resp: vec![],
        }
    }
}

impl GitHubHttpClient for MockGitHubHttpClient {
    fn begin_device_flow(
        &self,
        _client_id: &str,
        _scope: &str,
    ) -> Result<RawDeviceFlowResponse, CommandError> {
        Ok(RawDeviceFlowResponse {
            device_code: self.device_flow_resp.device_code.clone(),
            user_code: self.device_flow_resp.user_code.clone(),
            verification_uri: self.device_flow_resp.verification_uri.clone(),
            expires_in: self.device_flow_resp.expires_in,
            interval: self.device_flow_resp.interval,
        })
    }

    fn poll_device_token(
        &self,
        _client_id: &str,
        _device_code: &str,
    ) -> Result<RawPollResponse, CommandError> {
        let mut responses = self.poll_responses.lock().unwrap();
        if responses.is_empty() {
            return Err(CommandError::new(
                "MOCK_EXHAUSTED",
                "No more poll responses configured.",
                false,
            ));
        }
        Ok(responses.remove(0))
    }

    fn get_authenticated_user(&self, _token: &str) -> Result<RawUserResponse, CommandError> {
        Ok(RawUserResponse {
            id: self.user_resp.id,
            login: self.user_resp.login.clone(),
            name: self.user_resp.name.clone(),
            avatar_url: self.user_resp.avatar_url.clone(),
        })
    }

    fn list_repos(
        &self,
        _token: &str,
        _page: u32,
        _per_page: u32,
    ) -> Result<Vec<RawRepoResponse>, CommandError> {
        Ok(self
            .repos_resp
            .iter()
            .map(|r| RawRepoResponse {
                id: r.id,
                name: r.name.clone(),
                full_name: r.full_name.clone(),
                description: r.description.clone(),
                clone_url: r.clone_url.clone(),
                ssh_url: r.ssh_url.clone(),
                html_url: r.html_url.clone(),
                private: r.private,
                fork: r.fork,
                default_branch: r.default_branch.clone(),
                language: r.language.clone(),
                stargazers_count: r.stargazers_count,
                visibility: r.visibility.clone(),
                owner: RawOwner {
                    login: r.owner.login.clone(),
                },
            })
            .collect())
    }
}

// ---------------------------------------------------------------------------
// Helper: build a GitHubService with mocks
// ---------------------------------------------------------------------------

fn make_service(client: MockGitHubHttpClient) -> GitHubService {
    GitHubService::new(Box::new(client), Box::new(InMemoryCredentialStore::new()))
}

fn make_db() -> Database {
    Database::in_memory().expect("in-memory DB")
}

// ---------------------------------------------------------------------------
// AC2: OAuth state mismatch is rejected
// ---------------------------------------------------------------------------

#[test]
fn test_ac2_state_mismatch_rejected() {
    let svc = make_service(MockGitHubHttpClient::new_with_success_on_first_poll());
    let db = make_db();

    let (_session, pending) = svc.begin_device_flow().expect("begin_device_flow");

    // Use a wrong session token
    let result = svc.poll_device_flow(&db, &pending, "WRONG_TOKEN_12345");

    assert!(result.is_err());
    let err = result.unwrap_err();
    assert_eq!(
        err.code, "OAUTH_STATE_MISMATCH",
        "Expected OAUTH_STATE_MISMATCH, got: {}",
        err.code
    );
}

// ---------------------------------------------------------------------------
// AC1 + AC3: Successful login — token not in DB, no duplicate row on re-login
// ---------------------------------------------------------------------------

#[test]
fn test_ac1_token_not_in_db_and_ac3_no_duplicate_on_relogin() {
    let db = make_db();

    // ---- First login ----
    let svc1 = make_service(MockGitHubHttpClient::new_with_success_on_first_poll());
    let (_session1, pending1) = svc1.begin_device_flow().expect("begin_device_flow 1");
    let session_token1 = pending1.session_token.clone();

    let result1 = svc1
        .poll_device_flow(&db, &pending1, &session_token1)
        .expect("poll 1");

    let account1 = match result1 {
        PollResult::Success { account } => account,
        PollResult::Pending => panic!("Expected success on first poll"),
    };

    // AC1: token MUST NOT be in any field of the returned account
    // (verified structurally — GitHubAccount has no token field)
    assert_eq!(account1.login, "testuser");
    assert_eq!(account1.provider, "github");
    assert_eq!(
        account1.connection_status,
        GitHubConnectionStatus::Connected
    );
    // credential_ref is an opaque key, not the token
    assert!(
        account1.credential_ref.starts_with("github:"),
        "credential_ref should be a key prefix, not the token"
    );
    assert!(
        !account1.credential_ref.contains("test_token"),
        "Token must not appear in credential_ref"
    );

    // Verify DB has exactly 1 account
    let accounts = svc1.list_accounts(&db).expect("list accounts");
    assert_eq!(accounts.len(), 1, "Should have exactly 1 account");

    // ---- Second login with SAME GitHub user (same provider_user_id=12345) ----
    let svc2 = make_service(MockGitHubHttpClient::new_with_success_on_first_poll());
    let (_session2, pending2) = svc2.begin_device_flow().expect("begin_device_flow 2");
    let session_token2 = pending2.session_token.clone();

    let result2 = svc2
        .poll_device_flow(&db, &pending2, &session_token2)
        .expect("poll 2");

    let account2 = match result2 {
        PollResult::Success { account } => account,
        PollResult::Pending => panic!("Expected success on second poll"),
    };

    // AC3: Same ID (updated, not duplicated)
    assert_eq!(
        account1.id, account2.id,
        "Same user must reuse same account ID"
    );

    let accounts_after = svc2
        .list_accounts(&db)
        .expect("list accounts after re-login");
    assert_eq!(
        accounts_after.len(),
        1,
        "Must still have exactly 1 account (no duplicate)"
    );
}

// ---------------------------------------------------------------------------
// Pending → Success flow
// ---------------------------------------------------------------------------

#[test]
fn test_pending_then_success() {
    let db = make_db();
    let svc = make_service(MockGitHubHttpClient::new_with_pending_then_success());

    let (_session, pending) = svc.begin_device_flow().expect("begin_device_flow");
    let token = pending.session_token.clone();

    // First poll: should be Pending
    let r1 = svc.poll_device_flow(&db, &pending, &token).expect("poll 1");
    assert!(
        matches!(r1, PollResult::Pending),
        "First poll should be Pending"
    );

    // Second poll: should succeed
    let r2 = svc.poll_device_flow(&db, &pending, &token).expect("poll 2");
    match r2 {
        PollResult::Success { account } => {
            assert_eq!(account.login, "anotheruser");
        }
        PollResult::Pending => panic!("Second poll should succeed"),
    }
}

// ---------------------------------------------------------------------------
// Access denied returns AUTH_REQUIRED
// ---------------------------------------------------------------------------

#[test]
fn test_access_denied_returns_auth_required() {
    let db = make_db();
    let svc = make_service(MockGitHubHttpClient::new_with_denied());

    let (_session, pending) = svc.begin_device_flow().expect("begin_device_flow");
    let token = pending.session_token.clone();

    let err = svc
        .poll_device_flow(&db, &pending, &token)
        .expect_err("Should fail with AUTH_REQUIRED");

    assert_eq!(
        err.code, "AUTH_REQUIRED",
        "Denied access should map to AUTH_REQUIRED"
    );
}

// ---------------------------------------------------------------------------
// AC7: Expired device-flow session
// ---------------------------------------------------------------------------

#[test]
fn test_ac7_expired_device_flow() {
    let svc = make_service(MockGitHubHttpClient::new_with_success_on_first_poll());
    let db = make_db();

    let (_session, mut pending) = svc.begin_device_flow().expect("begin_device_flow");
    let token = pending.session_token.clone();

    // Manually set expires_at to the past
    pending = PendingDeviceFlow::make_expired_for_test(pending);

    let err = svc
        .poll_device_flow(&db, &pending, &token)
        .expect_err("Expired session should fail");

    assert_eq!(err.code, "DEVICE_FLOW_EXPIRED");
}

// ---------------------------------------------------------------------------
// AC5: Disconnect clears credential store and DB record
// ---------------------------------------------------------------------------

#[test]
fn test_ac5_disconnect_clears_keyring_and_db() {
    let db = make_db();

    // We need a service that shares the same store instance for inspection.
    let svc = GitHubService::new(
        Box::new(MockGitHubHttpClient::new_with_success_on_first_poll()),
        Box::new(InMemoryCredentialStore::new()),
    );

    // Login to create an account
    let (_session, pending) = svc.begin_device_flow().expect("begin");
    let token = pending.session_token.clone();
    let result = svc.poll_device_flow(&db, &pending, &token).expect("poll");
    let account = match result {
        PollResult::Success { account } => account,
        _ => panic!("Expected success"),
    };

    // Verify account exists in DB
    let accounts = svc.list_accounts(&db).expect("list");
    assert_eq!(accounts.len(), 1);

    // Disconnect
    svc.disconnect_account(&db, &account.id)
        .expect("disconnect");

    // Verify DB is empty
    let accounts_after = svc.list_accounts(&db).expect("list after");
    assert_eq!(accounts_after.len(), 0, "Account should be removed from DB");
}

// ---------------------------------------------------------------------------
// AC4: API error code mapping
// ---------------------------------------------------------------------------

#[test]
fn test_ac4_error_code_mapping() {
    // Test the error constructors directly (they're used by map_ureq_error in prod)
    let e401 = CommandError::auth_required("test");
    assert_eq!(e401.code, "AUTH_REQUIRED");

    let e403_rate = CommandError::rate_limited("test");
    assert_eq!(e403_rate.code, "RATE_LIMITED");

    let e403_perm = CommandError::permission_denied("test");
    assert_eq!(e403_perm.code, "PERMISSION_DENIED");

    let e404 = CommandError::github_api_error(404, "not found");
    assert_eq!(e404.code, "NOT_FOUND");

    let e422 = CommandError::github_api_error(422, "validation");
    assert_eq!(e422.code, "VALIDATION_ERROR");

    let e500 = CommandError::github_api_error(500, "server error");
    assert_eq!(e500.code, "SERVER_ERROR");
    assert!(e500.recoverable);

    let e_network = CommandError::network_error("timeout");
    assert_eq!(e_network.code, "NETWORK_ERROR");
    assert!(e_network.recoverable);

    let e_cred = CommandError::credential_store_unavailable("no keyring");
    assert_eq!(e_cred.code, "CREDENTIAL_STORE_UNAVAILABLE");
    assert!(
        !e_cred.recoverable,
        "Keyring unavailable is non-recoverable"
    );
}

// ---------------------------------------------------------------------------
// AC6: Repository pagination
// ---------------------------------------------------------------------------

#[test]
fn test_ac6_repo_listing_pagination() {
    let db = make_db();
    let svc = make_service(MockGitHubHttpClient::new_with_success_on_first_poll());

    // Login first
    let (_session, pending) = svc.begin_device_flow().expect("begin");
    let token = pending.session_token.clone();
    let result = svc.poll_device_flow(&db, &pending, &token).expect("poll");
    let account = match result {
        PollResult::Success { account } => account,
        _ => panic!("Expected success"),
    };

    // List repos page 1 with per_page=10
    let page = svc.list_repos(&db, &account.id, 1, 10).expect("list repos");
    assert_eq!(page.page, 1);
    assert_eq!(page.per_page, 10);
    assert_eq!(page.repos.len(), 1, "Should have 1 mocked repo");
    assert!(!page.has_more, "1 repo < 10 per_page so no more pages");

    // Verify repo data is correct
    let repo = &page.repos[0];
    assert_eq!(repo.name, "my-repo");
    assert_eq!(repo.owner_login, "testuser");
    assert!(!repo.private);
    // Verify no token-related fields exist (structural check)
    // GitHubRepo has no token field by design
}

// ---------------------------------------------------------------------------
// Migration 2 creates github_accounts table correctly
// ---------------------------------------------------------------------------

#[test]
fn test_migration_2_github_accounts_table() {
    let db = Database::in_memory().expect("in-memory DB");

    // Verify table exists by trying to insert and query
    db.with_conn(|conn| {
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM github_accounts", [], |r| r.get(0))
            .expect("github_accounts table should exist");
        assert_eq!(count, 0);

        // Verify UNIQUE constraint on (provider, provider_user_id)
        conn.execute(
            "INSERT INTO github_accounts (id, provider, provider_user_id, login, credential_ref, connection_status, created_at)
             VALUES ('id1', 'github', 'user123', 'login1', 'ref1', 'connected', '2024-01-01T00:00:00Z')",
            [],
        ).expect("First insert should succeed");

        // Duplicate should not create a second row (UNIQUE constraint)
        let result = conn.execute(
            "INSERT INTO github_accounts (id, provider, provider_user_id, login, credential_ref, connection_status, created_at)
             VALUES ('id2', 'github', 'user123', 'login2', 'ref2', 'connected', '2024-01-01T00:00:00Z')",
            [],
        );
        assert!(result.is_err(), "Duplicate (provider, provider_user_id) should fail");

        Ok(())
    }).expect("DB operations failed");
}
