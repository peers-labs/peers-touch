use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use sha2::{Digest, Sha256};

const BARRIER_WAIT_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum BarrierName {
    PersistedBeforeSend,
    SentBeforeResponse,
    ResponseBeforeLocalCommit,
}

impl BarrierName {
    fn as_str(self) -> &'static str {
        match self {
            Self::PersistedBeforeSend => "persisted-before-send",
            Self::SentBeforeResponse => "sent-before-response",
            Self::ResponseBeforeLocalCommit => "response-before-local-commit",
        }
    }
}

impl std::fmt::Display for BarrierName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Clone, Debug)]
pub struct BarrierToken {
    pub barrier: BarrierName,
    pub boot_identity: String,
    pub session_generation: u64,
    pub operation_id: String,
    pub state_digest: String,
}

#[derive(Debug)]
struct PendingBarrier {
    token: BarrierToken,
    released: bool,
}

pub struct LifecycleBarrierController {
    boot_identity: String,
    session_generation: AtomicU64,
    pending: Mutex<HashMap<String, PendingBarrier>>,
    release_signal: Condvar,
    sequence: AtomicU64,
}

fn barrier_key(name: BarrierName, operation_id: &str) -> String {
    format!("{}/{}", name.as_str(), operation_id)
}

impl LifecycleBarrierController {
    pub fn new(boot_identity: String, session_generation: u64) -> Self {
        Self {
            boot_identity,
            session_generation: AtomicU64::new(session_generation),
            pending: Mutex::new(HashMap::new()),
            release_signal: Condvar::new(),
            sequence: AtomicU64::new(1),
        }
    }

    pub fn boot_identity(&self) -> &str {
        &self.boot_identity
    }

    pub fn session_generation(&self) -> u64 {
        self.session_generation.load(Ordering::Acquire)
    }

    pub fn advance_generation(&self, generation: u64) {
        self.session_generation.store(generation, Ordering::Release);
    }

    pub fn arm(
        &self,
        name: BarrierName,
        operation_id: &str,
        session_generation: u64,
        state_bytes: &[u8],
    ) -> Result<BarrierToken, String> {
        let current_gen = self.session_generation.load(Ordering::Acquire);
        if session_generation != current_gen {
            return Err(format!(
                "barrier {name} generation mismatch: expected {current_gen}, got {session_generation}"
            ));
        }
        let key = barrier_key(name, operation_id);
        let state_digest = hex::encode(Sha256::digest(state_bytes));
        let token = BarrierToken {
            barrier: name,
            boot_identity: self.boot_identity.clone(),
            session_generation,
            operation_id: operation_id.to_string(),
            state_digest,
        };
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "barrier controller lock poisoned".to_string())?;
        if pending.contains_key(&key) {
            return Err(format!(
                "barrier {name} already armed for operation {operation_id}"
            ));
        }
        pending.insert(
            key,
            PendingBarrier {
                token: token.clone(),
                released: false,
            },
        );
        Ok(token)
    }

    pub fn wait(&self, token: &BarrierToken) -> Result<(), String> {
        let key = barrier_key(token.barrier, &token.operation_id);
        if token.boot_identity != self.boot_identity {
            return Err(format!("barrier {} boot identity mismatch", token.barrier));
        }
        let pending = self
            .pending
            .lock()
            .map_err(|_| "barrier controller lock poisoned".to_string())?;
        let (pending, timeout_result) = self
            .release_signal
            .wait_timeout_while(pending, BARRIER_WAIT_TIMEOUT, |map| {
                map.get(&key).map(|b| !b.released).unwrap_or(false)
            })
            .map_err(|_| "barrier controller lock poisoned".to_string())?;
        match pending.get(&key) {
            Some(b) if b.released => Ok(()),
            Some(_) if timeout_result.timed_out() => Err(format!(
                "barrier {} timed out for operation {}",
                token.barrier, token.operation_id
            )),
            Some(_) => Err(format!("barrier {} spurious wakeup", token.barrier)),
            None => Err(format!(
                "barrier {} was removed before release",
                token.barrier
            )),
        }
    }

    pub fn release(
        &self,
        name: BarrierName,
        operation_id: &str,
        boot_identity: &str,
        session_generation: u64,
    ) -> Result<BarrierToken, String> {
        if boot_identity != self.boot_identity {
            return Err(format!("barrier {name} release boot identity mismatch"));
        }
        let current_gen = self.session_generation.load(Ordering::Acquire);
        if session_generation != current_gen {
            return Err(format!(
                "barrier {name} release generation mismatch: expected {current_gen}, got {session_generation}"
            ));
        }
        let key = barrier_key(name, operation_id);
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "barrier controller lock poisoned".to_string())?;
        let barrier = pending
            .get_mut(&key)
            .ok_or_else(|| format!("barrier {name} not armed for operation {operation_id}"))?;
        if barrier.released {
            return Err(format!(
                "barrier {name} already released for operation {operation_id}"
            ));
        }
        barrier.released = true;
        let token = barrier.token.clone();
        self.release_signal.notify_all();
        Ok(token)
    }

    pub fn drain(&self, operation_id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.retain(|key, _| !key.ends_with(&format!("/{operation_id}")));
        }
    }

    pub fn next_sequence(&self) -> u64 {
        self.sequence.fetch_add(1, Ordering::Relaxed)
    }

    pub fn pending_count(&self) -> usize {
        self.pending.lock().map(|map| map.len()).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_controller() -> LifecycleBarrierController {
        LifecycleBarrierController::new("boot-test-001".to_string(), 1)
    }

    #[test]
    fn arm_wait_release_cycle() {
        let ctrl = test_controller();
        let token = ctrl
            .arm(BarrierName::PersistedBeforeSend, "op-1", 1, b"state-bytes")
            .unwrap();
        assert_eq!(token.barrier, BarrierName::PersistedBeforeSend);
        assert_eq!(token.boot_identity, "boot-test-001");
        assert_eq!(ctrl.pending_count(), 1);

        let released = ctrl
            .release(BarrierName::PersistedBeforeSend, "op-1", "boot-test-001", 1)
            .unwrap();
        assert_eq!(released.operation_id, "op-1");
        ctrl.wait(&token).unwrap();
        ctrl.drain("op-1");
        assert_eq!(ctrl.pending_count(), 0);
    }

    #[test]
    fn duplicate_arm_rejected() {
        let ctrl = test_controller();
        ctrl.arm(BarrierName::SentBeforeResponse, "op-2", 1, b"a")
            .unwrap();
        let err = ctrl
            .arm(BarrierName::SentBeforeResponse, "op-2", 1, b"b")
            .unwrap_err();
        assert!(err.contains("already armed"));
    }

    #[test]
    fn wrong_generation_rejected() {
        let ctrl = test_controller();
        let err = ctrl
            .arm(BarrierName::PersistedBeforeSend, "op-3", 99, b"x")
            .unwrap_err();
        assert!(err.contains("generation mismatch"));
    }

    #[test]
    fn wrong_boot_identity_rejected() {
        let ctrl = test_controller();
        ctrl.arm(BarrierName::ResponseBeforeLocalCommit, "op-4", 1, b"y")
            .unwrap();
        let err = ctrl
            .release(
                BarrierName::ResponseBeforeLocalCommit,
                "op-4",
                "wrong-boot",
                1,
            )
            .unwrap_err();
        assert!(err.contains("boot identity mismatch"));
    }

    #[test]
    fn release_before_wait() {
        let ctrl = test_controller();
        let token = ctrl
            .arm(BarrierName::SentBeforeResponse, "op-5", 1, b"z")
            .unwrap();
        ctrl.release(BarrierName::SentBeforeResponse, "op-5", "boot-test-001", 1)
            .unwrap();
        ctrl.wait(&token).unwrap();
    }

    #[test]
    fn concurrent_arm_wait_release() {
        let ctrl = Arc::new(test_controller());
        let token = ctrl
            .arm(BarrierName::PersistedBeforeSend, "op-6", 1, b"concurrent")
            .unwrap();
        let ctrl_clone = Arc::clone(&ctrl);
        let handle = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            ctrl_clone
                .release(BarrierName::PersistedBeforeSend, "op-6", "boot-test-001", 1)
                .unwrap();
        });
        ctrl.wait(&token).unwrap();
        handle.join().unwrap();
    }
}
