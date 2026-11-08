//! v0.2 madde 8 — çoklu depo senkronizasyonu için saf planlama.
//!
//! Ağ işi yapmayan, test edilebilir karar fonksiyonu: hangi depolar
//! pull/push turuna alınacak, hangileri hangi nedenle atlanacak.
//! Orkestrasyon (sırayla çekme/itme) `src-tauri` katmanındadır.

use serde::{Deserialize, Serialize};

/// Bir depo hakkında planlama girdisi (çağıran taraf doldurur).
#[derive(Debug, Clone)]
pub struct SyncRepoInput {
    pub repo_id: String,
    pub name: String,
    /// Kayıtlı yol diskte yok.
    pub missing: bool,
    /// Kullanıcı işlemi sürüyor (kilitli) — dokunulmaz.
    pub locked: bool,
    /// `origin` remote'u tanımlı mı?
    pub has_origin: bool,
    /// Aktif dalın upstream'i var mı?
    pub upstream: Option<String>,
    /// Duruma ulaşılamadı (bozuk depo, erişim hatası).
    pub status_error: bool,
}

/// Atlama nedeni — kullanıcıya dürüst açıklama için makro düzeyde tutulur.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyncSkipReason {
    Missing,
    Locked,
    NoOrigin,
    NoUpstream,
    StatusError,
    Cancelled,
}

impl SyncSkipReason {
    pub fn label(&self) -> &'static str {
        match self {
            SyncSkipReason::Missing => "Klasör bulunamadı",
            SyncSkipReason::Locked => "Başka işlem sürüyor",
            SyncSkipReason::NoOrigin => "origin yok",
            SyncSkipReason::NoUpstream => "upstream yok",
            SyncSkipReason::StatusError => "Durum okunamadı",
            SyncSkipReason::Cancelled => "İptal edildi",
        }
    }
}

/// Planlama çıktısı tek satırı.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case", tag = "action")]
pub enum SyncPlanEntry {
    Run {
        repo_id: String,
        name: String,
    },
    Skip {
        repo_id: String,
        name: String,
        reason: SyncSkipReason,
    },
}

/// Tur önceli sırasını korur; öncelik sırası: missing → status hatası →
/// origin → upstream → kilit.
pub fn plan_sync_list(inputs: Vec<SyncRepoInput>) -> Vec<SyncPlanEntry> {
    inputs
        .into_iter()
        .map(|input| {
            let reason = if input.missing {
                Some(SyncSkipReason::Missing)
            } else if input.status_error {
                Some(SyncSkipReason::StatusError)
            } else if !input.has_origin {
                Some(SyncSkipReason::NoOrigin)
            } else if input.upstream.is_none() {
                Some(SyncSkipReason::NoUpstream)
            } else if input.locked {
                Some(SyncSkipReason::Locked)
            } else {
                None
            };
            match reason {
                Some(reason) => SyncPlanEntry::Skip {
                    repo_id: input.repo_id,
                    name: input.name,
                    reason,
                },
                None => SyncPlanEntry::Run {
                    repo_id: input.repo_id,
                    name: input.name,
                },
            }
        })
        .collect()
}

/// Tek depo senkron sonucu (UI'ya dönen satır).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyncOutcomeStatus {
    Done,
    Skipped,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RepoSyncOutcome {
    pub repo_id: String,
    pub name: String,
    pub status: SyncOutcomeStatus,
    /// Atlama gerekçesi veya hata mesajı (Done'da None).
    pub detail: Option<String>,
    /// Yapılan iş özeti (örn. "2 içe aktarıldı"); opsiyonel.
    pub summary: Option<String>,
}

#[cfg(test)]
mod sync_plan_tests {
    use super::*;

    fn input(id: &str) -> SyncRepoInput {
        SyncRepoInput {
            repo_id: id.to_string(),
            name: id.to_string(),
            missing: false,
            locked: false,
            has_origin: true,
            upstream: Some("origin/main".to_string()),
            status_error: false,
        }
    }

    #[test]
    fn healthy_repos_are_scheduled_in_order() {
        let plan = plan_sync_list(vec![input("a"), input("b")]);
        assert_eq!(
            plan,
            vec![
                SyncPlanEntry::Run {
                    repo_id: "a".into(),
                    name: "a".into()
                },
                SyncPlanEntry::Run {
                    repo_id: "b".into(),
                    name: "b".into()
                },
            ]
        );
    }

    #[test]
    fn missing_locked_and_originless_are_skipped() {
        let mut missing = input("m");
        missing.missing = true;
        let mut locked = input("l");
        locked.locked = true;
        let mut no_origin = input("o");
        no_origin.has_origin = false;
        let mut no_upstream = input("u");
        no_upstream.upstream = None;

        let plan = plan_sync_list(vec![missing, locked, no_origin, no_upstream]);
        let reasons: Vec<_> = plan
            .iter()
            .map(|entry| match entry {
                SyncPlanEntry::Skip { reason, .. } => Some(*reason),
                SyncPlanEntry::Run { .. } => None,
            })
            .collect();
        assert_eq!(
            reasons,
            vec![
                Some(SyncSkipReason::Missing),
                Some(SyncSkipReason::Locked),
                Some(SyncSkipReason::NoOrigin),
                Some(SyncSkipReason::NoUpstream),
            ]
        );
    }

    #[test]
    fn status_error_takes_precedence_over_origin_checks() {
        let mut repo = input("x");
        repo.status_error = true;
        repo.has_origin = false;
        let plan = plan_sync_list(vec![repo]);
        assert!(matches!(
            plan[0],
            SyncPlanEntry::Skip {
                reason: SyncSkipReason::StatusError,
                ..
            }
        ));
    }
}
