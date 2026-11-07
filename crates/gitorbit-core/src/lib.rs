// `CommandError` is intentionally a flat, serde-friendly struct: the IPC
// contract (Engineering Specification §3.2) requires the same shape on both
// sides of the bridge, so it is slightly larger than clippy's default limit.
#![allow(clippy::result_large_err)]

pub mod credential_store;
pub mod db;
pub mod errors;
pub mod git;
pub mod models;
pub mod services;
pub mod sync;

pub use credential_store::{CredentialStore, OsCredentialStore};
pub use db::Database;
pub use errors::CommandError;
pub use git::{
    GitAdapter, GitBranchManager, GitCommitManager, GitConfigManager, GitDiffParser,
    GitHistoryManager, GitIgnoreManager, GitMergeManager, GitOperationStateManager,
    GitRemoteManager, GitStashManager, GitStatusParser,
};
pub use git::graph::{compute_lanes, color_index_for, GraphEdge, GraphEdgeKind, GraphRow};
pub use models::*;
pub use services::github_service::PendingDeviceFlow;
pub use services::{
    GitHubService, RepoLockGuard, RepoLockRegistry, RepositoryService, SettingsService,
};
