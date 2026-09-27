use super::{
    CommandRetryPolicy, ConversationMemberProjection, ConversationProjection, MessagingEngine,
};
use crate::infrastructure::station_client;
use crate::model::chat::{
    GetConversationMembersRequest, GetConversationMembersResponse, ListConversationsRequest,
    ListConversationsResponse, MemberStatus,
};
use reqwest::Method;
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

const LIFECYCLE_INTERVAL: Duration = Duration::from_secs(2);
const DRAIN_BATCH_LIMIT: u32 = 100;

struct LifecycleState {
    stopped: bool,
    token: String,
    last_error: Option<String>,
}

pub struct MessagingLifecycleWorker {
    state: Arc<(Mutex<LifecycleState>, Condvar)>,
    handle: Option<JoinHandle<()>>,
}

impl MessagingLifecycleWorker {
    pub fn start(engine: Arc<MessagingEngine>, token: String) -> Result<Self, String> {
        if token.trim().is_empty() {
            return Err("messaging lifecycle worker requires token".to_string());
        }
        let state = Arc::new((
            Mutex::new(LifecycleState {
                stopped: false,
                token,
                last_error: None,
            }),
            Condvar::new(),
        ));
        let thread_state = state.clone();
        let cycle_state = state.clone();
        let handle = thread::Builder::new()
            .name(format!("messaging:{}", engine.profile_id()))
            .spawn(move || {
                lifecycle_loop(thread_state, move |token| {
                    run_cycle(&engine, token, &cycle_state)
                });
            })
            .map_err(|error| format!("start messaging lifecycle worker: {error}"))?;
        Ok(Self {
            state,
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
        if state.stopped {
            return Err("messaging lifecycle worker is stopped".to_string());
        }
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
        if state.stopped {
            return Err("messaging lifecycle worker is stopped".to_string());
        }
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
        self.state
            .0
            .lock()
            .map(|state| !state.stopped)
            .map_err(|_| "messaging lifecycle state lock poisoned".to_string())
    }

    pub fn wake(&self) -> Result<(), String> {
        let (state, wake) = self.state.as_ref();
        let state = state
            .lock()
            .map_err(|_| "messaging lifecycle state lock poisoned".to_string())?;
        if state.stopped {
            return Err("messaging lifecycle worker is stopped".to_string());
        }
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
        let (state, wake) = self.state.as_ref();
        let mut state = state
            .lock()
            .map_err(|_| "messaging lifecycle state lock poisoned".to_string())?;
        state.stopped = true;
        wake.notify_one();
        Ok(())
    }

    fn join(&mut self) -> Result<(), String> {
        let Some(handle) = self.handle.take() else {
            return Ok(());
        };
        handle
            .join()
            .map_err(|_| "messaging lifecycle worker panicked".to_string())
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

fn lifecycle_loop<F>(state: Arc<(Mutex<LifecycleState>, Condvar)>, mut run: F)
where
    F: FnMut(&str) -> Result<(), String>,
{
    loop {
        let token = {
            let guard = match state.0.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            if guard.stopped {
                return;
            }
            guard.token.clone()
        };
        let result = run(&token);
        let mut guard = match state.0.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let next_error = result.err();
        if next_error != guard.last_error {
            match next_error.as_deref() {
                Some(error) => tracing::warn!(error = %error, "messaging lifecycle cycle failed"),
                None => tracing::info!("messaging lifecycle cycle recovered"),
            }
        }
        guard.last_error = next_error;
        if guard.stopped {
            return;
        }
        let waited = state.1.wait_timeout(guard, LIFECYCLE_INTERVAL);
        match waited {
            Ok((next, _)) if next.stopped => return,
            Ok(_) => {}
            Err(_) => return,
        }
    }
}

fn run_cycle(
    engine: &MessagingEngine,
    token: &str,
    lifecycle_state: &Arc<(Mutex<LifecycleState>, Condvar)>,
) -> Result<(), String> {
    let mut failures = Vec::new();
    macro_rules! run_step {
        ($label:literal, $operation:expr) => {{
            ensure_cycle_active(lifecycle_state)?;
            if let Err(error) = $operation {
                failures.push(format!("{}: {error}", $label));
            }
            ensure_cycle_active(lifecycle_state)?;
        }};
    }

    run_step!(
        "enrollment",
        engine.enroll_pending_device(token, "Desktop".to_string())
    );
    run_step!("prekeys", engine.publish_prekeys(token));
    run_step!("MLS KeyPackages", engine.publish_mls_key_packages(token));
    run_step!(
        "membership intent",
        engine.resume_membership_intent_once(token)
    );
    run_step!(
        "delegated leave intent",
        engine.resume_leave_intent_once(token)
    );
    run_step!(
        "attachment upload",
        engine.resume_attachment_upload_once(token, super::engine::now_unix_ms())
    );
    run_step!(
        "attachment source cleanup",
        engine.cleanup_completed_attachment_sources()
    );
    run_step!(
        "attachment download",
        engine.resume_attachment_download_once(token, super::engine::now_unix_ms())
    );
    run_step!(
        "message draft",
        engine.resume_message_draft_once(token, super::engine::now_unix_ms())
    );
    run_step!(
        "submitted command reconciliation",
        engine.reconcile_submitted_commands_once(token, super::engine::now_unix_ms())
    );
    run_step!(
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
    run_step!(
        "projection hydration",
        hydrate_projections_from_station(engine, token)
    );
    run_step!("queue drain", engine.drain_once(token, DRAIN_BATCH_LIMIT));
    run_step!(
        "delivery receipt dispatch",
        engine.dispatch_delivery_receipt_once(token)
    );
    if failures.is_empty() {
        Ok(())
    } else {
        let combined = failures.join("; ");
        if engine.recover_stale_enrollment(&combined) {
            tracing::info!("device enrollment reset; re-enrollment will occur on next cycle");
        }
        Err(combined)
    }
}

fn ensure_cycle_active(
    lifecycle_state: &Arc<(Mutex<LifecycleState>, Condvar)>,
) -> Result<(), String> {
    let state = lifecycle_state
        .0
        .lock()
        .map_err(|_| "messaging lifecycle state lock poisoned".to_string())?;
    if state.stopped {
        Err("messaging lifecycle cycle cancelled".to_string())
    } else {
        Ok(())
    }
}

pub(crate) fn hydrate_projections_from_station(
    engine: &MessagingEngine,
    token: &str,
) -> Result<usize, String> {
    let current_projections = engine.store().conversation_projections()?;
    if !current_projections.is_empty()
        && current_projections.iter().all(|projection| {
            !projection.federation_id.trim().is_empty() && !projection.members.is_empty()
        })
    {
        return Ok(0);
    }
    let response = station_client::request_proto_for_device::<
        ListConversationsRequest,
        ListConversationsResponse,
    >(
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
        let federation_id = conversation.federation_id;
        if federation_id.is_empty() {
            return Err(format!(
                "conversation {conversation_id} has no Federation projection"
            ));
        }
        let member_query = [("conversation_id", conversation_id.clone())];
        let member_response = station_client::request_proto_for_device::<
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
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn lifecycle_loop_runs_immediately_and_stops_on_wake() {
        let state = Arc::new((
            Mutex::new(LifecycleState {
                stopped: false,
                token: "token-a".to_string(),
                last_error: None,
            }),
            Condvar::new(),
        ));
        let calls = Arc::new(AtomicUsize::new(0));
        let thread_state = state.clone();
        let thread_calls = calls.clone();
        let handle = thread::spawn(move || {
            lifecycle_loop(thread_state, |token| {
                assert_eq!(token, "token-a");
                thread_calls.fetch_add(1, Ordering::SeqCst);
                Ok(())
            });
        });
        while calls.load(Ordering::SeqCst) == 0 {
            thread::yield_now();
        }
        {
            let mut guard = state.0.lock().unwrap();
            guard.stopped = true;
            state.1.notify_one();
        }
        handle.join().unwrap();
        let stopped_at = calls.load(Ordering::SeqCst);
        thread::sleep(Duration::from_millis(10));
        assert_eq!(calls.load(Ordering::SeqCst), stopped_at);
    }
}
