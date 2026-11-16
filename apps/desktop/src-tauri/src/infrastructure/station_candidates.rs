use serde::Serialize;

use crate::infrastructure::station_registry::normalize_origin;

/// Process input carrying the Profile/environment-repository Station.
/// Only the local development controller populates this; packaged builds
/// never define it.
pub(crate) const PROFILE_STATION_ENV: &str = "PEERS_PROFILE_STATION_URL";

/// Process input carrying an externally injected Station (shell, operator/MDM
/// launch, or an E2E/Acceptance harness).
pub(crate) const INJECTED_STATION_ENV: &str = "PEERS_STATION_URL";

/// Local configuration tiers. The X Config tier is not represented here: it
/// stays inside the signed snapshot projection and is merged by the renderer.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum LocalStationCandidateSource {
    /// Profile/environment-repository Station (highest proximity priority).
    Environment,
    /// Externally injected process Station.
    Injected,
}

/// One unverified local Station suggestion. This type never carries identity
/// material and is never persisted; selecting it still requires signed
/// discovery before a registry entry can exist (NCP-D23).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct LocalStationCandidate {
    pub source: LocalStationCandidateSource,
    pub canonical_origin: String,
}

fn candidate_from_env(
    variable: &str,
    source: LocalStationCandidateSource,
) -> Option<LocalStationCandidate> {
    let raw = std::env::var(variable).ok()?;
    let normalized = normalize_origin(&raw);
    if is_supported_origin(&normalized) {
        Some(LocalStationCandidate {
            source,
            canonical_origin: normalized,
        })
    } else {
        None
    }
}

/// Discovery only accepts http/https origins, so malformed or unsupported
/// values are dropped at the read boundary instead of reaching the picker.
fn is_supported_origin(origin: &str) -> bool {
    let lower = origin.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

/// Read the two local tiers in proximity order. The renderer owns cross-tier
/// dedup and the merge with X Config suggestions.
pub(crate) fn read_local_candidates() -> Vec<LocalStationCandidate> {
    [
        candidate_from_env(PROFILE_STATION_ENV, LocalStationCandidateSource::Environment),
        candidate_from_env(INJECTED_STATION_ENV, LocalStationCandidateSource::Injected),
    ]
    .into_iter()
    .flatten()
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, MutexGuard};

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    struct EnvGuard {
        // Held for the guard's whole life so env-mutating tests never run
        // concurrently; released automatically on drop after env restoration.
        _lock: MutexGuard<'static, ()>,
        profile: Option<std::ffi::OsString>,
        injected: Option<std::ffi::OsString>,
    }

    impl EnvGuard {
        fn lock(profile: Option<&str>, injected: Option<&str>) -> Self {
            let lock = ENV_LOCK.lock().unwrap();
            let guard = EnvGuard {
                _lock: lock,
                profile: std::env::var_os(PROFILE_STATION_ENV),
                injected: std::env::var_os(INJECTED_STATION_ENV),
            };
            apply(PROFILE_STATION_ENV, profile);
            apply(INJECTED_STATION_ENV, injected);
            guard
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            restore(PROFILE_STATION_ENV, self.profile.take());
            restore(INJECTED_STATION_ENV, self.injected.take());
        }
    }

    fn apply(variable: &str, value: Option<&str>) {
        match value {
            Some(raw) => std::env::set_var(variable, raw),
            None => std::env::remove_var(variable),
        }
    }

    fn restore(variable: &str, value: Option<std::ffi::OsString>) {
        match value {
            Some(raw) => std::env::set_var(variable, raw),
            None => std::env::remove_var(variable),
        }
    }

    #[test]
    fn environment_tier_precedes_injected_tier() {
        let _guard = EnvGuard::lock(
            Some("https://profile.example/"),
            Some("https://injected.example/"),
        );
        let candidates = read_local_candidates();
        assert_eq!(
            candidates,
            vec![
                LocalStationCandidate {
                    source: LocalStationCandidateSource::Environment,
                    canonical_origin: "https://profile.example".to_string(),
                },
                LocalStationCandidate {
                    source: LocalStationCandidateSource::Injected,
                    canonical_origin: "https://injected.example".to_string(),
                },
            ]
        );
    }

    #[test]
    fn injected_only_is_exposed_when_profile_absent() {
        let _guard = EnvGuard::lock(None, Some("http://10.0.0.1:18080/"));
        let candidates = read_local_candidates();
        assert_eq!(
            candidates,
            vec![LocalStationCandidate {
                source: LocalStationCandidateSource::Injected,
                canonical_origin: "http://10.0.0.1:18080".to_string(),
            }]
        );
    }

    #[test]
    fn blank_and_unsupported_origins_are_dropped() {
        let _guard = EnvGuard::lock(Some("   "), Some("ftp://not-supported.example"));
        assert!(read_local_candidates().is_empty());
    }

    #[test]
    fn no_local_inputs_yields_empty_catalog() {
        let _guard = EnvGuard::lock(None, None);
        assert!(read_local_candidates().is_empty());
    }
}
