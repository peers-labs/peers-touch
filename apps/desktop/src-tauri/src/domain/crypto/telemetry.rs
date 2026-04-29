//! Chat-ratchet decrypt-path telemetry.
//!
//! Counts how many messages are decrypted via the legacy chain-only
//! ratchet versus the (future) Double Ratchet. M0 of the chat ratchet
//! upgrade — see `docs/architecture/encryption/chat-ratchet-upgrade.md`
//! section 6 — gates the eventual cutover decision on having ≥ 1
//! release cycle of these counts in the wild.
//!
//! Counter is process-wide (`OnceLock<RwLock<...>>`) and resets on
//! restart. We deliberately don't persist: the metric is a population
//! signal, not an audit trail; per-actor SQLCipher persistence would
//! leak which actor decrypted what and when, which is worse than
//! losing data on restart.

use std::sync::{OnceLock, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy)]
pub struct RatchetTelemetry {
    pub legacy_decrypts: u64,
    pub dr_decrypts: u64,
    pub since_unix_ms: i64,
}

#[derive(Default)]
struct State {
    legacy: u64,
    dr: u64,
    started_at_ms: i64,
}

fn cell() -> &'static RwLock<State> {
    static C: OnceLock<RwLock<State>> = OnceLock::new();
    C.get_or_init(|| {
        let started_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        RwLock::new(State {
            legacy: 0,
            dr: 0,
            started_at_ms,
        })
    })
}

pub fn record_legacy_decrypt() {
    if let Ok(mut s) = cell().write() {
        s.legacy = s.legacy.saturating_add(1);
    }
}

pub fn record_dr_decrypt() {
    if let Ok(mut s) = cell().write() {
        s.dr = s.dr.saturating_add(1);
    }
}

pub fn snapshot() -> RatchetTelemetry {
    if let Ok(s) = cell().read() {
        RatchetTelemetry {
            legacy_decrypts: s.legacy,
            dr_decrypts: s.dr,
            since_unix_ms: s.started_at_ms,
        }
    } else {
        RatchetTelemetry {
            legacy_decrypts: 0,
            dr_decrypts: 0,
            since_unix_ms: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counters_and_snapshot_track_legacy_and_dr() {
        record_legacy_decrypt();
        record_legacy_decrypt();
        record_dr_decrypt();
        let s = snapshot();
        assert_eq!(s.legacy_decrypts, 2);
        assert_eq!(s.dr_decrypts, 1);
    }
}
