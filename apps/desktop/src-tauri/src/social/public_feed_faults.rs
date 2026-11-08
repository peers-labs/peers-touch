//! Bounded Acceptance controls at the original signed-feed transport seams.
//! Requests, journal commits and verification remain owned by the real path.

use std::time::{Duration, Instant};

const MAX_FAULT_LIFETIME: Duration = Duration::from_secs(90);
const MAX_RESPONSE_BYTES: usize = 1 << 20;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FeedFaultScope {
    pub actor: String,
    pub account: String,
    pub device: String,
    pub station: String,
    pub generation: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum FeedFaultKind {
    ObserveReads,
    DropSubmitAck,
    CorruptReadPayload,
    RollbackReadHead,
}

#[derive(Clone, Debug, Default)]
pub(super) struct FeedFaultSnapshot {
    pub id: String,
    pub kind: Option<FeedFaultKind>,
    pub armed: bool,
    pub expired: bool,
    pub effect_count: u32,
    pub command_id: String,
    pub event_sha256: String,
    pub submission_count: u32,
    pub retry_bytes_match: bool,
    pub rejection: String,
    pub read_count: u32,
    pub thread_read_count: u32,
    pub max_event_count: usize,
    pub max_thread_count: usize,
    pub max_response_bytes: usize,
    pub bounded_responses: bool,
    pub submission_rejection: String,
}

struct FeedFaultRule {
    scope: FeedFaultScope,
    target: String,
    expires: Instant,
}

#[derive(Default)]
pub(super) struct FeedFaultController {
    rule: Option<FeedFaultRule>,
    snapshot: FeedFaultSnapshot,
}

impl FeedFaultController {
    pub fn arm(&mut self, scope: FeedFaultScope, id: &str, kind: FeedFaultKind,
        target: &str, now: Instant) -> Result<FeedFaultSnapshot, &'static str> {
        if id.is_empty() || id.len() > 160 || id.chars().any(char::is_whitespace)
            || target.is_empty() || target.len() > 512
            || [&scope.actor, &scope.account, &scope.device, &scope.station, &scope.generation]
                .iter().any(|field| field.is_empty())
            || (kind == FeedFaultKind::DropSubmitAck && target != scope.actor) {
            return Err("SOCIAL_ACCEPTANCE_FAULT_INVALID");
        }
        self.expire(now);
        if self.rule.as_ref().is_some_and(|rule| rule.scope != scope) { self.clear(); }
        if self.snapshot.armed { return Err("SOCIAL_ACCEPTANCE_FAULT_ALREADY_ARMED"); }
        self.rule = Some(FeedFaultRule {scope, target: target.into(), expires: now + MAX_FAULT_LIFETIME});
        self.snapshot = FeedFaultSnapshot {
            id: id.into(), kind: Some(kind), armed: true,
            retry_bytes_match: true, bounded_responses: true, ..Default::default()
        };
        Ok(self.snapshot.clone())
    }

    fn expire(&mut self, now: Instant) {
        if self.rule.as_ref().is_some_and(|rule| now >= rule.expires) {
            self.snapshot.armed = false;
            self.snapshot.expired = true;
        }
    }

    pub fn observe_submit(&mut self, scope: &FeedFaultScope, command: &str,
        event_sha256: &str, now: Instant) -> Result<(), &'static str> {
        self.expire(now);
        let Some(rule) = &self.rule else { return Ok(()); };
        if self.snapshot.expired || &rule.scope != scope
            || self.snapshot.kind != Some(FeedFaultKind::DropSubmitAck) { return Ok(()); }
        if command.is_empty() || event_sha256.len() != 64
            || !event_sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("SOCIAL_ACCEPTANCE_FAULT_INVALID");
        }
        if self.snapshot.command_id.is_empty() && self.snapshot.armed {
            self.snapshot.command_id = command.into();
            self.snapshot.event_sha256 = event_sha256.into();
        }
        if self.snapshot.command_id == command {
            self.snapshot.submission_count = self.snapshot.submission_count.saturating_add(1);
            self.snapshot.retry_bytes_match &= self.snapshot.event_sha256 == event_sha256;
        }
        Ok(())
    }

    /// Consume only after a real response; callers qualify payload/head first.
    pub fn consume(&mut self, scope: &FeedFaultScope, kind: FeedFaultKind,
        target: &str, command: Option<&str>, now: Instant) -> bool {
        self.expire(now);
        let Some(rule) = &self.rule else { return false; };
        if !self.snapshot.armed || &rule.scope != scope || rule.target != target
            || self.snapshot.kind != Some(kind)
            || (kind == FeedFaultKind::DropSubmitAck
                && (self.snapshot.command_id.is_empty()
                    || command != Some(self.snapshot.command_id.as_str()))) { return false; }
        self.snapshot.armed = false;
        self.snapshot.effect_count = self.snapshot.effect_count.saturating_add(1);
        true
    }

    pub fn record_rejection(&mut self, scope: &FeedFaultScope, code: &str, now: Instant) {
        self.expire(now);
        if self.rule.as_ref().is_some_and(|rule| &rule.scope == scope)
            && !self.snapshot.expired && self.snapshot.effect_count == 1
            && self.snapshot.rejection.is_empty() && code.starts_with("FEED_")
            && code.len() <= 64
            && code.bytes().all(|byte| byte.is_ascii_uppercase() || byte == b'_') {
            self.snapshot.rejection = code.into();
        }
    }

    pub fn record_submission_rejection(&mut self, scope: &FeedFaultScope,
        code: &str, now: Instant) {
        self.expire(now);
        if !self.snapshot.expired && self.rule.as_ref().is_some_and(|rule| &rule.scope == scope)
            && self.snapshot.submission_rejection.is_empty() {
            if let Some(code) = code.split(|c: char| !c.is_ascii_uppercase() && c != '_')
                .filter(|word| word.starts_with("FEED_") && word.len() <= 64).next_back() {
                self.snapshot.submission_rejection = code.into();
            }
        }
    }

    pub fn observe_read(&mut self, scope: &FeedFaultScope, target: &str,
        event_count: usize, thread_count: usize, limit: usize,
        include_thread: bool, response_bytes: usize, now: Instant) {
        self.expire(now);
        if !self.snapshot.expired && self.rule.as_ref().is_some_and(
            |rule| &rule.scope == scope && rule.target == target) {
            self.snapshot.read_count = self.snapshot.read_count.saturating_add(1);
            if include_thread {
                self.snapshot.thread_read_count = self.snapshot.thread_read_count.saturating_add(1);
            }
            self.snapshot.max_event_count = self.snapshot.max_event_count.max(event_count);
            self.snapshot.max_thread_count = self.snapshot.max_thread_count.max(thread_count);
            self.snapshot.max_response_bytes = self.snapshot.max_response_bytes.max(response_bytes);
            self.snapshot.bounded_responses &= limit > 0 && limit <= 64
                && event_count <= limit && thread_count <= 32 && response_bytes <= MAX_RESPONSE_BYTES;
        }
    }

    pub fn snapshot(&mut self, scope: &FeedFaultScope, now: Instant) -> FeedFaultSnapshot {
        self.expire(now);
        if self.rule.as_ref().is_some_and(|rule| &rule.scope != scope) {
            return FeedFaultSnapshot::default();
        }
        self.snapshot.clone()
    }

    pub fn clear(&mut self) {
        self.rule = None;
        self.snapshot = FeedFaultSnapshot::default();
    }
}

#[cfg(feature = "acceptance-webdriver")]
mod adapter {
    use super::*;
    use prost::Message;
    use serde::Deserialize;
    use serde_json::{json, Value};
    use sha2::{Digest, Sha256};
    use station_trust::feed_log::{self as feed,
        proto::{FeedEvent, FeedHead, ReadFeedRequest, ReadFeedResponse}};
    use std::sync::{Arc, Mutex, OnceLock};
    use tauri::{State, Window};
    use crate::state::AppState;

    fn owner() -> &'static Mutex<FeedFaultController> {
        static OWNER: OnceLock<Mutex<FeedFaultController>> = OnceLock::new();
        OWNER.get_or_init(|| Mutex::new(FeedFaultController::default()))
    }

    pub(crate) fn current_scope(state: &AppState, window: &Window) -> Result<FeedFaultScope, String> {
        let active = state.sessions.get(window.label()).ok_or("FEED_AUTHENTICATION_REQUIRED")?;
        if active.jwt.is_empty() { return Err("FEED_AUTHENTICATION_REQUIRED".into()); }
        let engine = state.messaging_engines.get(&active.account_id)?.ok_or("FEED_DEVICE_REQUIRED")?;
        let station = state.station.client().active_scope().ok_or("FEED_STATION_REQUIRED")?;
        if engine.endpoint().ptid != active.actor.ptid { return Err("FEED_SESSION_CHANGED".into()); }
        Ok(FeedFaultScope {
            actor: active.actor.ptid, account: active.account_id,
            device: engine.endpoint().device_id.clone(), station: station.station_peer_id,
            generation: station.lifecycle_generation.to_string(),
        })
    }

    #[derive(Deserialize)]
    pub(crate) struct FeedAcceptanceFaultInput {
        action: String,
        #[serde(default)]
        id: String,
        #[serde(default)]
        kind: String,
        #[serde(default)]
        target_actor_ptid: String,
    }

    #[tauri::command]
    pub(crate) fn social_public_feed_acceptance_fault(state: State<'_, Arc<AppState>>,
        window: Window, input: FeedAcceptanceFaultInput) -> Result<Value, String> {
        let _identity = state.identity_transition.lock().map_err(|_| "FEED_SESSION_CHANGED")?;
        let scope = current_scope(&state, &window)?;
        let mut owner = owner().lock().map_err(|_| "SOCIAL_ACCEPTANCE_FAULT_UNAVAILABLE")?;
        let now = Instant::now();
        match input.action.as_str() {
            "read" => (),
            "clear" => owner.clear(),
            "arm" => {
                let kind = match input.kind.as_str() {
                    "observe-reads" => FeedFaultKind::ObserveReads,
                    "drop-submit-ack" => FeedFaultKind::DropSubmitAck,
                    "corrupt-read-payload" => FeedFaultKind::CorruptReadPayload,
                    "rollback-read-head" => FeedFaultKind::RollbackReadHead,
                    _ => return Err("SOCIAL_ACCEPTANCE_FAULT_INVALID".into()),
                };
                owner.arm(scope.clone(), &input.id, kind, &input.target_actor_ptid, now)?;
            },
            _ => return Err("SOCIAL_ACCEPTANCE_FAULT_INVALID".into()),
        }
        let s = owner.snapshot(&scope, now);
        Ok(json!({
            "id": s.id, "kind": s.kind.map(|kind| match kind {
                FeedFaultKind::ObserveReads => "observe-reads",
                FeedFaultKind::DropSubmitAck => "drop-submit-ack",
                FeedFaultKind::CorruptReadPayload => "corrupt-read-payload",
                FeedFaultKind::RollbackReadHead => "rollback-read-head",
            }),
            "armed": s.armed, "expired": s.expired, "effectCount": s.effect_count,
            "commandId": s.command_id, "eventSha256": s.event_sha256,
            "submissionCount": s.submission_count, "retryBytesMatch": s.retry_bytes_match,
            "rejection": s.rejection, "submissionRejection": s.submission_rejection,
            "readCount": s.read_count, "threadReadCount": s.thread_read_count,
            "maxEventCount": s.max_event_count, "maxThreadCount": s.max_thread_count,
            "maxResponseBytes": s.max_response_bytes, "boundedResponses": s.bounded_responses,
        }))
    }

    pub(crate) fn observe_submit(scope: &FeedFaultScope, command: &str,
        event: &FeedEvent) -> Result<(), String> {
        owner().lock().map_err(|_| "SOCIAL_ACCEPTANCE_FAULT_UNAVAILABLE")?
            .observe_submit(scope, command, &format!("{:x}", Sha256::digest(event.encode_to_vec())),
                Instant::now()).map_err(str::to_owned)
    }

    pub(crate) fn lose_submit_ack(scope: &FeedFaultScope, command: &str) -> Result<bool, String> {
        Ok(owner().lock().map_err(|_| "SOCIAL_ACCEPTANCE_FAULT_UNAVAILABLE")?
            .consume(scope, FeedFaultKind::DropSubmitAck, &scope.actor, Some(command), Instant::now()))
    }

    pub(crate) fn transform_read_response(scope: &FeedFaultScope, target: &str,
        previous: Option<&FeedHead>, response: &mut ReadFeedResponse) -> Result<bool, String> {
        let mut owner = owner().lock().map_err(|_| "SOCIAL_ACCEPTANCE_FAULT_UNAVAILABLE")?;
        let now = Instant::now();
        let Some(bundle) = &mut response.bundle else { return Ok(false); };
        if let Some(event) = bundle.events.iter_mut().find(|event| !event.payload.is_empty()) {
            if owner.consume(scope, FeedFaultKind::CorruptReadPayload, target, None, now) {
                event.payload[0] ^= 1;
                return Ok(true);
            }
        }
        if previous.is_some_and(|head| head.sequence > 0) {
            if let Some(genesis) = &bundle.genesis {
                let old = feed::initial_head(genesis).map_err(|error| error.to_string())?;
                if owner.consume(scope, FeedFaultKind::RollbackReadHead, target, None, now) {
                    bundle.events.clear();
                    response.head = Some(old);
                    response.has_more = false;
                    response.thread_entries.clear();
                    response.thread_cursor = 0;
                    response.thread_has_more = false;
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }

    pub(crate) fn observe_read(scope: &FeedFaultScope, target: &str,
        request: &ReadFeedRequest, response: &ReadFeedResponse) {
        if let Ok(mut owner) = owner().lock() {
            owner.observe_read(scope, target,
                response.bundle.as_ref().map_or(0, |bundle| bundle.events.len()),
                response.thread_entries.len(), request.limit as usize,
                request.include_thread, response.encoded_len(), Instant::now());
        }
    }

    pub(crate) fn observe_rejection(scope: &FeedFaultScope, code: &str) {
        if let Ok(mut owner) = owner().lock() { owner.record_rejection(scope, code, Instant::now()); }
    }

    pub(crate) fn observe_submission_rejection(scope: &FeedFaultScope, code: &str) {
        if let Ok(mut owner) = owner().lock() {
            owner.record_submission_rejection(scope, code, Instant::now());
        }
    }
}

#[cfg(feature = "acceptance-webdriver")]
pub(crate) use adapter::*;

#[cfg(test)]
mod tests {
    use super::*;

    fn scope() -> FeedFaultScope {
        FeedFaultScope { actor: "author".into(), account: "account".into(),
            device: "device".into(), station: "station".into(), generation: "7".into() }
    }

    #[test]
    fn committed_ack_fault_is_exact_one_shot_and_retains_retry_bytes() {
        let now = Instant::now();
        let mut owner = FeedFaultController::default();
        let s = scope();
        owner.arm(s.clone(), "suite:ack", FeedFaultKind::DropSubmitAck, "author", now).unwrap();
        let hash = "a".repeat(64);
        owner.observe_submit(&s, "command", &hash, now).unwrap();
        assert!(!owner.consume(&s, FeedFaultKind::DropSubmitAck, "author", Some("other"), now));
        assert!(owner.consume(&s, FeedFaultKind::DropSubmitAck, "author", Some("command"), now));
        assert!(!owner.consume(&s, FeedFaultKind::DropSubmitAck, "author", Some("command"), now));
        owner.observe_submit(&s, "command", &hash, now).unwrap();
        let retained = owner.snapshot(&s, now);
        assert_eq!(retained.effect_count, 1);
        assert_eq!(retained.submission_count, 2);
        assert!(retained.retry_bytes_match);
        owner.observe_submit(&s, "command", &"b".repeat(64), now).unwrap();
        assert!(!owner.snapshot(&s, now).retry_bytes_match);
    }

    #[test]
    fn every_scope_boundary_and_target_prevents_effects() {
        let now = Instant::now();
        for field in 0..5 {
            let mut owner = FeedFaultController::default();
            owner.arm(scope(), "suite:read", FeedFaultKind::CorruptReadPayload, "remote", now).unwrap();
            let mut other = scope();
            match field {
                0 => other.actor.push('x'), 1 => other.account.push('x'),
                2 => other.device.push('x'), 3 => other.station.push('x'),
                _ => other.generation.push('x'),
            }
            assert!(!owner.consume(&other, FeedFaultKind::CorruptReadPayload, "remote", None, now));
            assert!(owner.snapshot(&other, now).id.is_empty());
            assert!(!owner.consume(&scope(), FeedFaultKind::CorruptReadPayload, "other", None, now));
            assert!(owner.consume(&scope(), FeedFaultKind::CorruptReadPayload, "remote", None, now));
        }
    }

    #[test]
    fn read_observation_counts_actual_scoped_bounds() {
        let now = Instant::now();
        let mut owner = FeedFaultController::default();
        owner.arm(scope(), "suite:normal", FeedFaultKind::ObserveReads, "remote", now).unwrap();
        owner.observe_read(&scope(), "remote", 64, 32, 64, true, MAX_RESPONSE_BYTES, now);
        owner.observe_read(&scope(), "other", 4, 1, 64, true, 2048, now);
        let s = owner.snapshot(&scope(), now);
        assert_eq!(s.read_count, 1);
        assert_eq!(s.thread_read_count, 1);
        assert!(s.bounded_responses);
        assert_eq!(s.max_event_count, 64);
        assert_eq!(s.max_thread_count, 32);
        assert_eq!(s.max_response_bytes, MAX_RESPONSE_BYTES);
        owner.observe_read(&scope(), "remote", 65, 33, 64, false, MAX_RESPONSE_BYTES + 1, now);
        assert!(!owner.snapshot(&scope(), now).bounded_responses);
        owner.observe_read(&scope(), "remote", 0, 0, 64, true, 128, now + MAX_FAULT_LIFETIME);
        assert_eq!(owner.snapshot(&scope(), now + MAX_FAULT_LIFETIME).read_count, 2);
    }

    #[test]
    fn expiry_cleanup_and_rearming_are_bounded() {
        let now = Instant::now();
        let mut owner = FeedFaultController::default();
        owner.arm(scope(), "suite:rollback", FeedFaultKind::RollbackReadHead, "remote", now).unwrap();
        assert!(owner.arm(scope(), "suite:other", FeedFaultKind::RollbackReadHead, "remote", now).is_err());
        let expired = now + MAX_FAULT_LIFETIME;
        assert!(!owner.consume(&scope(), FeedFaultKind::RollbackReadHead, "remote", None, expired));
        assert!(owner.snapshot(&scope(), expired).expired);
        owner.arm(scope(), "suite:second", FeedFaultKind::RollbackReadHead, "remote", expired).unwrap();
        assert!(owner.consume(&scope(), FeedFaultKind::RollbackReadHead, "remote", None, expired));
        owner.record_rejection(&scope(), "FEED_HEAD_ROLLBACK", expired);
        assert_eq!(owner.snapshot(&scope(), expired).rejection, "FEED_HEAD_ROLLBACK");
        owner.clear();
        assert!(owner.snapshot(&scope(), expired).id.is_empty());
        owner.arm(scope(), "suite:prior", FeedFaultKind::RollbackReadHead, "remote", expired).unwrap();
        let mut current = scope();
        current.generation = "8".into();
        owner.arm(current.clone(), "suite:current", FeedFaultKind::RollbackReadHead, "remote", expired).unwrap();
        assert!(!owner.consume(&scope(), FeedFaultKind::RollbackReadHead, "remote", None, expired));
        assert!(owner.consume(&current, FeedFaultKind::RollbackReadHead, "remote", None, expired));
    }

    #[test]
    fn submission_observation_retains_only_the_original_scoped_machine_code() {
        let now = Instant::now();
        let mut owner = FeedFaultController::default();
        owner.arm(scope(), "suite:writer", FeedFaultKind::ObserveReads, "author", now).unwrap();
        let mut other = scope();
        other.device.push('x');
        owner.record_submission_rejection(&other, "FEED_WRITER_NOT_AUTHORIZED", now);
        assert!(owner.snapshot(&scope(), now).submission_rejection.is_empty());
        owner.record_submission_rejection(&scope(),
            "FEED_SUBMISSION_FAILED: FEED_WRITER_NOT_AUTHORIZED private-response", now);
        assert_eq!(owner.snapshot(&scope(), now).submission_rejection, "FEED_WRITER_NOT_AUTHORIZED");
        owner.record_submission_rejection(&scope(), "FEED_INVALID", now);
        assert_eq!(owner.snapshot(&scope(), now).submission_rejection, "FEED_WRITER_NOT_AUTHORIZED");
        owner.clear();
        owner.arm(scope(), "suite:expired", FeedFaultKind::ObserveReads, "author", now).unwrap();
        owner.record_submission_rejection(&scope(), "FEED_INVALID", now + MAX_FAULT_LIFETIME);
        assert!(owner.snapshot(&scope(), now + MAX_FAULT_LIFETIME).submission_rejection.is_empty());
    }
}
