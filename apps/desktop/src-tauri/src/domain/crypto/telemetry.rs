//! Double Ratchet decrypt-path telemetry.
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
    pub dr_decrypts: u64,
    pub since_unix_ms: i64,
}

#[derive(Default)]
struct State {
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
            dr: 0,
            started_at_ms,
        })
    })
}

pub fn record_dr_decrypt() {
    if let Ok(mut s) = cell().write() {
        s.dr = s.dr.saturating_add(1);
    }
}

pub fn snapshot() -> RatchetTelemetry {
    if let Ok(s) = cell().read() {
        RatchetTelemetry {
            dr_decrypts: s.dr,
            since_unix_ms: s.started_at_ms,
        }
    } else {
        RatchetTelemetry {
            dr_decrypts: 0,
            since_unix_ms: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_tracks_double_ratchet_decrypts() {
        record_dr_decrypt();
        let s = snapshot();
        assert_eq!(s.dr_decrypts, 1);
    }
}
