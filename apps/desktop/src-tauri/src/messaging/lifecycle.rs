use super::{ConversationMemberProjection, ConversationProjection, MessagingEngine};
use crate::model::chat::{
    GetConversationMembersRequest, GetConversationMembersResponse, ListConversationsRequest,
    ListConversationsResponse, MemberStatus,
};
use messaging_core::contracts::CryptoEndpoint;
use messaging_core::engine::{
    activate_engine, begin_engine_stop, complete_engine_start, complete_engine_stop,
    validate_active_engine, EngineFence, EngineLifecycleRecord, EnginePhase,
};
use messaging_core::outbox::CommandRetryPolicy;
use messaging_core::ports::LifecycleCancellation;
use reqwest::Method;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

// Active interval while the engine is busy or recovering. When a cycle
// succeeds with nothing to do, the worker backs off exponentially so an idle
// Desktop does not issue a full Station round-trip sweep every two seconds.
// Any wake (new token, user action, incoming signal) interrupts the wait and
// resets the cadence to the active interval.
const LIFECYCLE_ACTIVE_INTERVAL: Duration = Duration::from_secs(2);
const LIFECYCLE_IDLE_INTERVALS: &[Duration] = &[
    Duration::from_secs(2),
    Duration::from_secs(5),
    Duration::from_secs(15),
    Duration::from_secs(30),
];
const DRAIN_BATCH_LIMIT: u32 = 100;

/// Adaptive cadence: fast while work or errors are observed, exponential
/// backoff while idle. Pure and unit-testable; the worker notifies on every
/// state transition so `wait_timeout` wakes immediately when cadence changes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Cadence {
    idle_step: usize,
}

impl Cadence {
    fn active() -> Self {
        Self { idle_step: 0 }
    }

    /// Next wait after a cycle. `did_work` is true when the cycle performed
    /// observable progress; errors keep the fast interval for prompt retry.
    fn after_cycle(&self, did_work: bool, had_error: bool) -> Self {
        if had_error || did_work {
            return Self::active();
        }
        Self {
            idle_step: (self.idle_step + 1).min(LIFECYCLE_IDLE_INTERVALS.len() - 1),
        }
    }

    fn wait_duration(&self) -> Duration {
        LIFECYCLE_IDLE_INTERVALS[self.idle_step]
    }

    fn awakened_early(&self) -> Self {
        // An explicit wake (token refresh, user/network signal) means new work
        // may be ready: run at the active interval immediately.
        Self::active()
    }
}

struct LifecycleState {
    token: String,
    last_error: Option<String>,
    lifecycle: EngineLifecycleRecord,
}

/// Outcome of one maintenance cycle. `did_work` marks observable progress so
/// the adaptive cadence keeps polling quickly while there is activity and
/// backs off once the engine is idle.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct CycleOutcome {
    did_work: bool,
    had_error: bool,
    error: Option<String>,
}

impl CycleOutcome {
    fn worked(&mut self) {
        self.did_work = true;
    }
}

struct WorkerCancellation(AtomicBool);

impl LifecycleCancellation for WorkerCancellation {
    fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

pub struct MessagingLifecycleWorker {
    state: Arc<(Mutex<LifecycleState>, Condvar)>,
    cancellation: Arc<WorkerCancellation>,
    fence: EngineFence,
    handle: Option<JoinHandle<()>>,
}

impl MessagingLifecycleWorker {
    pub fn start(engine: Arc<MessagingEngine>, token: String) -> Result<Self, String> {
        if token.trim().is_empty() {
            return Err("messaging lifecycle worker requires token".to_string());
        }
        let station_peer_id = lifecycle_station_peer_id(engine.as_ref())?;
        let cancellation = Arc::new(WorkerCancellation(AtomicBool::new(false)));
        let inactive = EngineLifecycleRecord::inactive(
            CryptoEndpoint::new(
                engine.endpoint().ptid.clone(),
                engine.endpoint().device_id.clone(),
            )?,
            station_peer_id,
            super::engine::now_unix_ms(),
        )
        .map_err(|error| error.to_string())?;
        let starting = activate_engine(
            &inactive,
            cancellation.as_ref(),
            next_lifecycle_time(&inactive),
        )
        .map_err(|error| error.to_string())?;
        let active = complete_engine_start(
            &starting,
            starting.fence(),
            engine.runtime_consumer_epoch(),
            next_lifecycle_time(&starting),
        )
        .map_err(|error| error.to_string())?;
        let fence = active.fence();
        let state = Arc::new((
            Mutex::new(LifecycleState {
                token,
                last_error: None,
                lifecycle: active,
            }),
            Condvar::new(),
        ));
        let thread_state = state.clone();
        let cycle_state = state.clone();
        let thread_cancellation = cancellation.clone();
        let cycle_cancellation = cancellation.clone();
        let handle = thread::Builder::new()
            .name(format!("messaging:{}", engine.profile_id()))
            .spawn(move || {
                lifecycle_loop(thread_state, fence, thread_cancellation, move |token| {
                    run_cycle(
                        &engine,
                        token,
                        &cycle_state,
                        fence,
                        cycle_cancellation.as_ref(),
                    )
                });
            })
            .map_err(|error| {
                cancellation.0.store(true, Ordering::Release);
                format!("start messaging lifecycle worker: {error}")
            })?;
        Ok(Self {
            state,
            cancellation,
            fence,
            handle: Some(handle),
        })
    }

    pub fn refresh_token(&self, token: String) -> Result<(), String> {
        if token.trim().is_empty() {
            return Err("messaging lifecycle token is empty".to_string());
        }
        let (state, wake) = self.state.as_ref();
        let mut state = state
            .lock()
            .map_err(|_| "messaging lifecycle state lock poisoned".to_string())?;
        validate_active_engine(&state.lifecycle, self.fence, self.cancellation.as_ref())
            .map_err(|error| error.to_string())?;
        state.token = token;
        wake.notify_one();
        Ok(())
    }

    pub fn token(&self) -> Result<String, String> {
        let state = self
            .state
            .0
            .lock()
            .map_err(|_| "messaging lifecycle state lock poisoned".to_string())?;
        validate_active_engine(&state.lifecycle, self.fence, self.cancellation.as_ref())
            .map_err(|error| error.to_string())?;
        Ok(state.token.clone())
    }

    pub fn is_active(&self) -> Result<bool, String> {
        let handle_running = self
            .handle
            .as_ref()
            .map(|handle| !handle.is_finished())
            .unwrap_or(false);
        if !handle_running {
            return Ok(false);
        }
        let state = self
            .state
            .0
            .lock()
            .map_err(|_| "messaging lifecycle state lock poisoned".to_string())?;
        Ok(
            validate_active_engine(&state.lifecycle, self.fence, self.cancellation.as_ref())
                .is_ok(),
        )
    }

    pub fn wake(&self) -> Result<(), String> {
        let (state, wake) = self.state.as_ref();
        let state = state
            .lock()
            .map_err(|_| "messaging lifecycle state lock poisoned".to_string())?;
        validate_active_engine(&state.lifecycle, self.fence, self.cancellation.as_ref())
            .map_err(|error| error.to_string())?;
        wake.notify_one();
        Ok(())
    }

    #[cfg(test)]
    pub fn last_error(&self) -> Result<Option<String>, String> {
        self.state
            .0
            .lock()
            .map(|state| state.last_error.clone())
            .map_err(|_| "messaging lifecycle state lock poisoned".to_string())
    }

    pub fn stop(mut self) -> Result<(), String> {
        self.request_stop()?;
        self.join()
    }

    fn request_stop(&self) -> Result<(), String> {
        self.cancellation.0.store(true, Ordering::Release);
        let (state, wake) = self.state.as_ref();
        let mut state = state
            .lock()
            .map_err(|_| "messaging lifecycle state lock poisoned".to_string())?;
        if !matches!(
            state.lifecycle.phase,
            EnginePhase::Inactive | EnginePhase::Stopping
        ) {
            state.lifecycle = begin_engine_stop(
                &state.lifecycle,
                self.fence,
                next_lifecycle_time(&state.lifecycle),
            )
            .map_err(|error| error.to_string())?;
        }
        wake.notify_one();
        Ok(())
    }

    fn join(&mut self) -> Result<(), String> {
        if let Some(handle) = self.handle.take() {
            handle
                .join()
                .map_err(|_| "messaging lifecycle worker panicked".to_string())?;
        }
        let mut state = self
            .state
            .0
            .lock()
            .map_err(|_| "messaging lifecycle state lock poisoned".to_string())?;
        if state.lifecycle.phase != EnginePhase::Inactive {
            state.lifecycle = complete_engine_stop(
                &state.lifecycle,
                self.fence,
                next_lifecycle_time(&state.lifecycle),
            )
            .map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn terminate_for_test(&mut self) -> Result<(), String> {
        self.request_stop()?;
        self.join()
    }
}

impl Drop for MessagingLifecycleWorker {
    fn drop(&mut self) {
        let _ = self.request_stop();
        let _ = self.join();
    }
}

fn lifecycle_loop<F>(
    state: Arc<(Mutex<LifecycleState>, Condvar)>,
    fence: EngineFence,
    cancellation: Arc<WorkerCancellation>,
    mut run: F,
) where
    F: FnMut(&str) -> CycleOutcome,
{
    let mut cadence = Cadence::active();
    loop {
        let token = {
            let guard = match state.0.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            if validate_active_engine(&guard.lifecycle, fence, cancellation.as_ref()).is_err() {
                return;
            }
            guard.token.clone()
        };
        let outcome = run(&token);
        let mut guard = match state.0.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        if validate_active_engine(&guard.lifecycle, fence, cancellation.as_ref()).is_err() {
            return;
        }
        let next_error = outcome.error.clone();
        if next_error != guard.last_error {
            match next_error.as_deref() {
                Some(error) => tracing::warn!(error = %error, "messaging lifecycle cycle failed"),
                None => tracing::info!("messaging lifecycle cycle recovered"),
            }
        }
        guard.last_error = next_error;
        cadence = cadence.after_cycle(outcome.did_work, outcome.had_error);
        let wait = state
            .1
            .wait_timeout(guard, cadence.wait_duration());
        let (next_guard, timeout_result) = match wait {
            Ok(pair) => pair,
            Err(_) => return,
        };
        guard = next_guard;
        // A spurious/early wakeup (token refresh, explicit wake after user or
        // network activity) means new work may be ready: resume the active
        // interval immediately. A timeout keeps the (possibly backed-off)
        // cadence.
        if !timeout_result.timed_out() {
            cadence = cadence.awakened_early();
        }
        if validate_active_engine(&guard.lifecycle, fence, cancellation.as_ref()).is_err() {
            return;
        }
    }
}

fn run_cycle(
    engine: &MessagingEngine,
    token: &str,
    lifecycle_state: &Arc<(Mutex<LifecycleState>, Condvar)>,
    fence: EngineFence,
    cancellation: &dyn LifecycleCancellation,
) -> CycleOutcome {
    let mut outcome = CycleOutcome::default();
    let mut failures = Vec::new();
    // Run one maintenance step. `$progress` is an expression that reports
    // whether the step did observable work (bool / count / Ok(bool)), so the
    // adaptive cadence can stay active while there is progress.
    macro_rules! run_step {
        ($label:literal, $operation:expr) => {{
            if let Err(message) = ensure_cycle_active(lifecycle_state, fence, cancellation) {
                outcome.had_error = true;
                outcome.error = Some(message);
                return outcome;
            }
            if let Err(error) = $operation {
                failures.push(format!("{}: {error}", $label));
            }
            if let Err(message) = ensure_cycle_active(lifecycle_state, fence, cancellation) {
                outcome.had_error = true;
                outcome.error = Some(message);
                return outcome;
            }
        }};
        ($label:literal, $operation:expr, $progress:expr) => {{
            run_step!($label, $operation);
            if $progress {
                outcome.worked();
            }
        }};
    }

    // Bind steps whose return value reports observable progress so the
    // cadence stays active while background work is completing. Steps with no
    // work signal (queue drain, command dispatch, prekey publishing) either
    // self-throttle internally or are driven to immediate processing by an
    // explicit worker wake on user/inbound activity.
    macro_rules! step_progress {
        ($label:literal, $operation:expr) => {{
            ensure_active!();
            match $operation {
                Ok(active) => {
                    if active {
                        outcome.worked();
                    }
                }
                Err(error) => failures.push(format!("{}: {error}", $label)),
            }
            ensure_active!();
        }};
    }
    macro_rules! ensure_active {
        () => {
            if let Err(message) = ensure_cycle_active(lifecycle_state, fence, cancellation) {
                outcome.had_error = true;
                outcome.error = Some(message);
                return outcome;
            }
        };
    }

    run_step!(
        "enrollment",
        engine.enroll_pending_device(token, "Desktop".to_string())
    );
    run_step!("prekeys", engine.publish_prekeys(token));
    run_step!("MLS KeyPackages", engine.publish_mls_key_packages(token));
    step_progress!("membership intent", engine.resume_membership_intent_once(token));
    step_progress!("delegated leave intent", engine.resume_leave_intent_once(token));
    step_progress!(
        "attachment upload",
        engine.resume_attachment_upload_once(token, super::engine::now_unix_ms())
    );
    if let Err(message) = ensure_cycle_active(lifecycle_state, fence, cancellation) {
        outcome.had_error = true;
        outcome.error = Some(message);
        return outcome;
    }
    match engine.cleanup_completed_attachment_sources() {
        Ok(cleaned) if cleaned > 0 => outcome.worked(),
        Ok(_) => {}
        Err(error) => failures.push(format!("attachment source cleanup: {error}")),
    }
    if let Err(message) = ensure_cycle_active(lifecycle_state, fence, cancellation) {
        outcome.had_error = true;
        outcome.error = Some(message);
        return outcome;
    }
    step_progress!(
        "attachment download",
        engine.resume_attachment_download_once(token, super::engine::now_unix_ms())
    );
    step_progress!(
        "message draft",
        engine.resume_message_draft_once(token, super::engine::now_unix_ms())
    );
    run_step!(
        "submitted command reconciliation",
        engine.reconcile_submitted_commands_once(token, super::engine::now_unix_ms())
    );
    step_progress!(
        "interaction intent",
        engine.resume_interaction_intent_once(token, super::engine::now_unix_ms())
    );
    run_step!(
        "command dispatch",
        engine.dispatch_command_once(
            token,
            super::engine::now_unix_ms(),
            CommandRetryPolicy {
                initial_delay_ms: 1_000,
                maximum_delay_ms: 300_000,
            },
        )
    );
    match hydrate_projections_from_station(engine, token) {
        Ok(hydrated) if hydrated > 0 => outcome.worked(),
        Ok(_) => {}
        Err(error) => failures.push(format!("projection hydration: {error}")),
    }
    run_step!("queue drain", engine.drain_once(token, DRAIN_BATCH_LIMIT));
    step_progress!(
        "delivery receipt dispatch",
        engine.dispatch_delivery_receipt_once(token)
    );
    if failures.is_empty() {
        outcome
    } else {
        let combined = failures.join("; ");
        if engine.recover_stale_enrollment(&combined) {
            tracing::info!("device enrollment reset; re-enrollment will occur on next cycle");
        }
        outcome.had_error = true;
        outcome.error = Some(combined);
        outcome
    }
}

fn ensure_cycle_active(
    lifecycle_state: &Arc<(Mutex<LifecycleState>, Condvar)>,
    fence: EngineFence,
    cancellation: &dyn LifecycleCancellation,
) -> Result<(), String> {
    let state = lifecycle_state
        .0
        .lock()
        .map_err(|_| "messaging lifecycle state lock poisoned".to_string())?;
    validate_active_engine(&state.lifecycle, fence, cancellation).map_err(|error| error.to_string())
}

fn next_lifecycle_time(record: &EngineLifecycleRecord) -> i64 {
    super::engine::now_unix_ms().max(record.updated_at_unix_ms.saturating_add(1))
}

fn lifecycle_station_peer_id(engine: &MessagingEngine) -> Result<String, String> {
    if let Some(station_peer_id) = engine.station_client().active_station_peer_id() {
        return Ok(station_peer_id);
    }
    #[cfg(test)]
    {
        return Ok(format!("test-station:{}", engine.profile_id()));
    }
    #[cfg(not(test))]
    {
        Err("messaging lifecycle Station identity is unavailable".to_string())
    }
}

pub(crate) fn hydrate_projections_from_station(
    engine: &MessagingEngine,
    token: &str,
) -> Result<usize, String> {
    let station_client = engine.station_client();
    let current_projections = engine.store().conversation_projections()?;
    if !current_projections.is_empty()
        && current_projections
            .iter()
            .all(|projection| !projection.members.is_empty())
    {
        return Ok(0);
    }
    let response = station_client
        .request_proto_for_device::<ListConversationsRequest, ListConversationsResponse>(
            Method::GET,
            "/conversation/list",
            token,
            None,
            Some(&ListConversationsRequest {}),
            &engine.endpoint().device_id,
        )
        .map_err(|error| format!("fetch conversation list: {error}"))?;
    if response.conversations.is_empty() {
        return Ok(0);
    }
    let now = super::engine::now_unix_ms();
    let mut projections = Vec::new();
    for conversation in response.conversations {
        let conversation_id = conversation.conversation_id;
        if conversation_id.is_empty() {
            continue;
        }
        let authority_station_id = if conversation.authority_station_peer_id.is_empty() {
            "local".to_string()
        } else {
            conversation.authority_station_peer_id
        };
        // Local-scope Direct conversations carry no Federation id (the scope
        // is derived from same-Station ownership); only Federation scope
        // populates it. An empty value is therefore valid for Local scope.
        let federation_id = conversation.federation_id;
        let member_query = [("conversation_id", conversation_id.clone())];
        let member_response = station_client.request_proto_for_device::<
            GetConversationMembersRequest,
            GetConversationMembersResponse,
        >(
            Method::GET,
            "/conversation/members",
            token,
            Some(&member_query),
            None,
            &engine.endpoint().device_id,
        )
        .map_err(|error| format!("fetch conversation {conversation_id} members: {error}"))?;
        let members = member_response
            .members
            .into_iter()
            .filter(|member| member.member_status == MemberStatus::Active as i32)
            .map(|member| ConversationMemberProjection {
                ptid: member.ptid,
                role: member.role,
                home_station_peer_id: member.actor_home_station_peer_id,
                muted: member.muted,
                muted_until_unix_ms: member.muted_until.as_ref().map(|value| {
                    value
                        .seconds
                        .saturating_mul(1_000)
                        .saturating_add(i64::from(value.nanos) / 1_000_000)
                }),
            })
            .collect::<Vec<_>>();
        projections.push(ConversationProjection {
            conversation_id,
            authority_station_id,
            federation_id,
            kind: conversation.kind,
            name: conversation.name,
            description: conversation.description,
            avatar_object_id: conversation.avatar_cid,
            owner_ptid: conversation.owner_ptid,
            members,
            membership_epoch: conversation.membership_epoch,
            mls_epoch: conversation.mls_epoch,
            active: true,
            updated_at_unix_ms: now,
        });
    }
    let count = engine.hydrate_conversation_projections(&projections)?;
    if count > 0 {
        tracing::info!(
            count,
            "messaging conversation projections bootstrapped from Station"
        );
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    #[test]
    fn lifecycle_loop_runs_immediately_and_stops_on_wake() {
        let cancellation = Arc::new(WorkerCancellation(AtomicBool::new(false)));
        let inactive = EngineLifecycleRecord::inactive(
            CryptoEndpoint::new("ptid:alice", "desktop-1").unwrap(),
            "station-1",
            1,
        )
        .unwrap();
        let starting = activate_engine(&inactive, cancellation.as_ref(), 2).unwrap();
        let active = complete_engine_start(&starting, starting.fence(), 0, 3).unwrap();
        let fence = active.fence();
        let state = Arc::new((
            Mutex::new(LifecycleState {
                token: "token-a".to_string(),
                last_error: None,
                lifecycle: active,
            }),
            Condvar::new(),
        ));
        let calls = Arc::new(AtomicUsize::new(0));
        let thread_state = state.clone();
        let thread_calls = calls.clone();
        let thread_cancellation = cancellation.clone();
        let handle = thread::spawn(move || {
            lifecycle_loop(thread_state, fence, thread_cancellation, |token| {
                assert_eq!(token, "token-a");
                thread_calls.fetch_add(1, Ordering::SeqCst);
                CycleOutcome::default()
            });
        });
        while calls.load(Ordering::SeqCst) == 0 {
            thread::yield_now();
        }
        cancellation.0.store(true, Ordering::Release);
        {
            let mut guard = state.0.lock().unwrap();
            guard.lifecycle = begin_engine_stop(
                &guard.lifecycle,
                fence,
                next_lifecycle_time(&guard.lifecycle),
            )
            .unwrap();
            state.1.notify_one();
        }
        handle.join().unwrap();
        let stopped_at = calls.load(Ordering::SeqCst);
        thread::sleep(Duration::from_millis(10));
        assert_eq!(calls.load(Ordering::SeqCst), stopped_at);
    }

    #[test]
    fn cadence_backs_off_when_idle_and_caps_at_thirty_seconds() {
        let mut cadence = Cadence::active();
        assert_eq!(cadence.wait_duration(), Duration::from_secs(2));

        let expected = [
            Duration::from_secs(5),
            Duration::from_secs(15),
            Duration::from_secs(30),
        ];
        for expected_wait in expected {
            cadence = cadence.after_cycle(false, false);
            assert_eq!(cadence.wait_duration(), expected_wait);
        }
        // Stays capped instead of growing without bound.
        for _ in 0..5 {
            cadence = cadence.after_cycle(false, false);
            assert_eq!(cadence.wait_duration(), Duration::from_secs(30));
        }
    }

    #[test]
    fn cadence_returns_active_on_work_or_error_or_wake() {
        let idle = Cadence::active().after_cycle(false, false).after_cycle(false, false);
        assert_eq!(idle.wait_duration(), Duration::from_secs(15));

        assert_eq!(
            idle.after_cycle(true, false),
            Cadence::active(),
            "observed progress must restore the fast interval"
        );
        assert_eq!(
            idle.after_cycle(false, true),
            Cadence::active(),
            "a failed cycle must retry promptly rather than backing off"
        );
        assert_eq!(
            idle.awakened_early(),
            Cadence::active(),
            "an explicit wake must resume the active interval immediately"
        );
    }
}
