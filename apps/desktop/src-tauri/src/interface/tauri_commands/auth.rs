use crate::contracts::{
    AccessDecisionPayload, AccessSubmitInviteInput, AccessSubmitLoginInput, AuthLoginInput,
    AuthSessionPayload, AuthValidateTokenInput, OAuthLoopbackPollInput,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::identity_event::{self, IdentityChangeReason, IdentityChangedPayload};
use crate::infrastructure::session_revocation::SESSION_KICKED_EVENT;
use crate::infrastructure::window_session_registry::{
    ExclusiveBindingCommit, WindowSessionRegistry,
};
use crate::state::{AppState, SessionState};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State, Window};

use crate::application::auth::service as auth_service;
use crate::application::oauth2 as application_oauth2;

pub(crate) fn commit_tauri_session(
    state: &Arc<AppState>,
    app: &AppHandle,
    window: &Window,
    prepared: auth_service::PreparedAuthSession,
) -> AppResult<AuthSessionPayload> {
    commit_tauri_session_with_identity_state(state, app, window, prepared)
}

pub(crate) fn commit_tauri_session_with_identity_state(
    state: &Arc<AppState>,
    app: &AppHandle,
    window: &Window,
    prepared: auth_service::PreparedAuthSession,
) -> AppResult<AuthSessionPayload> {
    let previous_identity_state = match prepared.identity_state.as_ref() {
        Some(_) => match crate::infrastructure::auth_identity::read_state() {
            Ok(state) => Some(state),
            Err(error) => {
                return AppResult::fail(ErrorCode::InternalError, error, None);
            }
        },
        None => None,
    };
    let activation = match auth_service::prepare_messaging_profile_activation(
        state,
        &prepared.account_id,
        &prepared.actor_id,
        &prepared.token,
    ) {
        Ok(activation) => activation,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to prepare messaging identity: {error}"),
                Some(serde_json::json!({
                    "command": prepared.payload.command,
                    "reason": "engine_preparation_failed"
                })),
            )
        }
    };
    let active_session = prepared.active_session(window.label());
    let next_mirror = SessionState {
        actor_id: Some(prepared.actor_id.clone()),
        token: Some(prepared.token.clone()),
        account_id: Some(prepared.account_id.clone()),
    };
    let kicked = match commit_runtime_binding(
        &state.sessions,
        &state.session,
        active_session,
        next_mirror,
        prepared
            .revoked_previous_actor_sessions
            .then_some(prepared.actor_id.as_str()),
        || {
            prepared
                .identity_state
                .as_ref()
                .map(crate::infrastructure::auth_identity::write_state)
                .transpose()
                .map(|_| ())
        },
    ) {
        Ok(kicked) => kicked,
        Err(error) => {
            let rollback_error =
                auth_service::rollback_messaging_profile_preparation(state, activation).err();
            let message = rollback_error.map_or_else(
                || format!("Failed to commit authenticated identity: {error}"),
                |rollback| {
                    format!(
                        "Failed to commit authenticated identity: {error}; messaging preparation rollback failed: {rollback}"
                    )
                },
            );
            return AppResult::fail(
                ErrorCode::InternalError,
                message,
                Some(serde_json::json!({
                    "command": prepared.payload.command,
                    "reason": "identity_commit_failed"
                })),
            );
        }
    };
    if let Err(error) =
        auth_service::commit_messaging_profile_activation(state, &activation, &prepared.token)
    {
        let binding_rollback = rollback_runtime_binding(
            &state.sessions,
            &state.session,
            kicked,
            prepared
                .revoked_previous_actor_sessions
                .then_some(prepared.actor_id.as_str()),
            || {
                previous_identity_state
                    .as_ref()
                    .map(crate::infrastructure::auth_identity::write_state)
                    .transpose()
                    .map(|_| ())
            },
        )
        .err();
        let preparation_rollback =
            auth_service::rollback_messaging_profile_preparation(state, activation).err();
        let rollback_error = [binding_rollback, preparation_rollback]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join("; ");
        let message = if rollback_error.is_empty() {
            format!("Failed to activate committed messaging identity: {error}")
        } else {
            format!(
                "Failed to activate committed messaging identity: {error}; rollback failed: {rollback_error}"
            )
        };
        return AppResult::fail(
            ErrorCode::InternalError,
            message,
            Some(serde_json::json!({
                "command": prepared.payload.command,
                "reason": "engine_activation_failed"
            })),
        );
    }
    let kicked = kicked.binding.into_kicked();
    for session in kicked {
        let payload = serde_json::json!({
            "reason": "takeover",
            "actor_id": session.actor.actor_id,
        });
        if let Err(error) = app.emit_to(&session.window_label, SESSION_KICKED_EVENT, &payload) {
            tracing::warn!(window = %session.window_label, error = %error, "auth: failed to emit local session kick");
        }
    }
    AppResult::success(prepared.payload)
}

struct RuntimeBindingCommit {
    binding: ExclusiveBindingCommit,
    previous_mirror: SessionState,
}

fn commit_runtime_binding(
    sessions: &WindowSessionRegistry,
    mirror: &Mutex<SessionState>,
    active_session: crate::domain::identity::ActiveSession,
    next_mirror: SessionState,
    revoked_actor_id: Option<&str>,
    persist: impl FnOnce() -> Result<(), String>,
) -> Result<RuntimeBindingCommit, String> {
    let mut mirror_guard = mirror
        .lock()
        .map_err(|_| "legacy session mirror lock poisoned".to_string())?;
    let previous_mirror = mirror_guard.clone();
    let binding = sessions.try_bind_exclusive(active_session)?;
    *mirror_guard = next_mirror;
    if let Err(error) = persist() {
        drop(mirror_guard);
        let rollback_error = rollback_runtime_binding(
            sessions,
            mirror,
            RuntimeBindingCommit {
                binding,
                previous_mirror,
            },
            revoked_actor_id,
            || Ok(()),
        )
        .err();
        return Err(rollback_error.map_or(error.clone(), |rollback| {
            format!("{error}; runtime rollback failed: {rollback}")
        }));
    }
    Ok(RuntimeBindingCommit {
        binding,
        previous_mirror,
    })
}

fn rollback_runtime_binding(
    sessions: &WindowSessionRegistry,
    mirror: &Mutex<SessionState>,
    commit: RuntimeBindingCommit,
    revoked_actor_id: Option<&str>,
    rollback_persist: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let mut failures = Vec::new();
    if let Err(error) = rollback_persist() {
        failures.push(format!("durable identity rollback failed: {error}"));
    }
    if let Err(error) = sessions.rollback_exclusive(commit.binding) {
        failures.push(format!("window rollback failed: {error}"));
    }
    if let Some(actor_id) = revoked_actor_id {
        if let Err(error) = sessions.try_unbind_actor(actor_id) {
            failures.push(format!("revoked actor cleanup failed: {error}"));
        }
    }
    match mirror.lock() {
        Ok(mut mirror) => {
            *mirror = if revoked_actor_id.is_some_and(|actor_id| {
                commit.previous_mirror.actor_id.as_deref() == Some(actor_id)
            }) {
                SessionState::default()
            } else {
                commit.previous_mirror
            };
        }
        Err(_) => failures.push("legacy session mirror lock poisoned".to_string()),
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

fn broadcast_identity(
    app: &AppHandle,
    reason: IdentityChangeReason,
    payload: &AppResult<AuthSessionPayload>,
) {
    if !payload.ok {
        return;
    }
    let data = match &payload.data {
        Some(data) => data,
        None => return,
    };
    identity_event::emit(
        app,
        IdentityChangedPayload {
            reason,
            actor_id: data.actor_id.clone(),
            login_method: data.login_method.clone(),
        },
    );
}

fn unbind_after(state: &Arc<AppState>, window: &Window, result: &AppResult<AuthSessionPayload>) {
    if !result.ok {
        return;
    }
    state.sessions.unbind(window.label());
}

fn committed_window_session(state: &Arc<AppState>, window: &Window) -> Option<SessionState> {
    state
        .sessions
        .get(window.label())
        .map(|session| SessionState {
            actor_id: Some(session.actor.actor_id),
            token: Some(session.jwt),
            account_id: Some(session.account_id),
        })
}

fn missing_window_session(command: &str) -> AppResult<AuthSessionPayload> {
    AppResult::fail(
        ErrorCode::Unauthorized,
        "Window has no committed session",
        Some(serde_json::json!({
            "command": command,
            "reason": "window_session_missing"
        })),
    )
}

#[tauri::command]
pub fn auth_login(
    input: AuthLoginInput,
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    window: Window,
) -> AppResult<AuthSessionPayload> {
    let transition = match state.identity_transition.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Failed to coordinate identity transition",
                None,
            )
        }
    };
    let result =
        match auth_service::prepare_auth_login_during_transition(input, state.inner(), &transition)
        {
            Ok(prepared) => commit_tauri_session(state.inner(), &app, &window, prepared),
            Err(error) => error,
        };
    broadcast_identity(&app, IdentityChangeReason::Login, &result);
    result
}

/// Open an interactive access attempt and return the Station's initial gate
/// decision. This is a pre-login step in the gate chain — no session is
/// produced, so no window binding or identity broadcast is performed.
#[tauri::command]
pub fn access_start() -> AppResult<AccessDecisionPayload> {
    auth_service::access_start()
}

/// Redeem a self-service invite code against a live attempt and return the
/// re-evaluated decision. Advances the chain toward the login gate; never
/// produces a session on its own.
#[tauri::command]
pub fn access_submit_invite_code(
    input: AccessSubmitInviteInput,
) -> AppResult<AccessDecisionPayload> {
    auth_service::access_submit_invite_code(input)
}

/// Submit the login credential gate for a live attempt. On grant this lands
/// the full desktop session, so it reuses the same window binding and identity
/// broadcast as the one-shot `auth_login`.
#[tauri::command]
pub fn access_submit_login(
    input: AccessSubmitLoginInput,
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    window: Window,
) -> AppResult<AuthSessionPayload> {
    let transition = match state.identity_transition.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Failed to coordinate identity transition",
                None,
            )
        }
    };
    let result = match auth_service::prepare_access_submit_login_during_transition(
        input,
        state.inner(),
        &transition,
    ) {
        Ok(prepared) => commit_tauri_session(state.inner(), &app, &window, prepared),
        Err(error) => error,
    };
    broadcast_identity(&app, IdentityChangeReason::Login, &result);
    result
}

#[tauri::command]
pub fn auth_logout(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    window: Window,
) -> AppResult<AuthSessionPayload> {
    let transition = match state.identity_transition.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Failed to coordinate identity transition",
                None,
            )
        }
    };
    let Some(committed_session) = committed_window_session(state.inner(), &window) else {
        return missing_window_session("auth_logout");
    };
    let result = auth_service::auth_logout_during_transition(
        state.inner(),
        &transition,
        Some(committed_session),
    );
    unbind_after(state.inner(), &window, &result);
    broadcast_identity(&app, IdentityChangeReason::Logout, &result);
    result
}

#[tauri::command]
pub fn auth_restore_session(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    window: Window,
) -> AppResult<AuthSessionPayload> {
    let transition = match state.identity_transition.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Failed to coordinate identity transition",
                None,
            )
        }
    };
    match auth_service::prepare_auth_restore_session_during_transition(state.inner(), &transition) {
        Ok(prepared) => commit_tauri_session(state.inner(), &app, &window, prepared),
        Err(error) => error,
    }
}

#[tauri::command]
pub fn auth_validate_token(
    input: AuthValidateTokenInput,
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    window: Window,
) -> AppResult<AuthSessionPayload> {
    let transition = match state.identity_transition.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Failed to coordinate identity transition",
                None,
            )
        }
    };
    let Some(committed_session) = committed_window_session(state.inner(), &window) else {
        return missing_window_session("auth_validate_token");
    };
    let result = auth_service::auth_validate_token_during_transition(
        input,
        state.inner(),
        &transition,
        Some(committed_session),
    );
    if !result.ok
        && result
            .error
            .as_ref()
            .is_some_and(|error| error.code == ErrorCode::Unauthorized)
    {
        state.sessions.unbind(window.label());
    }
    result
}

/// Load a Station JWT (persisted during OAuth callback) into AppState
/// so the BFF session becomes immediately active.
#[tauri::command]
pub fn ensure_station_session(
    input: OAuthLoopbackPollInput,
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    window: Window,
) -> AppResult<AuthSessionPayload> {
    let transition = match state.identity_transition.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Failed to coordinate identity transition",
                None,
            )
        }
    };
    let (account_id, actor_id) =
        match application_oauth2::completed_loopback_identity(input.session_id.trim()) {
            Ok(identity) => identity,
            Err(error) => {
                return AppResult::fail(
                    ErrorCode::Unauthorized,
                    error,
                    Some(serde_json::json!({
                        "command": "ensure_station_session",
                        "reason": "loopback_session_invalid"
                    })),
                )
            }
        };
    let result = match auth_service::prepare_station_session_for_account_during_transition(
        state.inner(),
        &transition,
        &account_id,
        Some(&actor_id),
    ) {
        Ok(prepared) => commit_tauri_session(state.inner(), &app, &window, prepared),
        Err(error) => error,
    };
    broadcast_identity(&app, IdentityChangeReason::OauthBridge, &result);
    result
}

#[cfg(test)]
mod tests {
    use super::{commit_runtime_binding, rollback_runtime_binding};
    use crate::application::auth::service::PreparedAuthSession;
    use crate::contracts::AuthSessionPayload;
    use crate::domain::identity::{ActiveSession, ActorRef};
    use crate::infrastructure::window_session_registry::WindowSessionRegistry;
    use crate::state::SessionState;
    use std::cell::RefCell;
    use std::sync::Mutex;

    #[test]
    fn prepared_session_constructs_window_binding_from_one_tuple() {
        let prepared = PreparedAuthSession {
            payload: AuthSessionPayload {
                command: "auth_restore_session".to_string(),
                status: "restored".to_string(),
                actor_id: Some("actor-b".to_string()),
                ptid: Some("ptid:v1:actor:b".to_string()),
                name: None,
                email: None,
                avatar_url: None,
                avatar_local_path: None,
                login_method: Some("password".to_string()),
            },
            account_id: "station:account-b".to_string(),
            actor_id: "actor-b".to_string(),
            token: "token-b".to_string(),
            revoked_previous_actor_sessions: false,
            identity_state: None,
        };

        let active = prepared.active_session("window-b");
        assert_eq!(active.window_label, "window-b");
        assert_eq!(active.account_id, "station:account-b");
        assert_eq!(active.actor.actor_id, "actor-b");
        assert_eq!(active.actor.ptid, "ptid:v1:actor:b");
        assert_eq!(active.jwt, "token-b");
    }

    #[test]
    fn account_switch_commit_failure_preserves_old_active_session() {
        let sessions = WindowSessionRegistry::new();
        sessions.bind(ActiveSession::new(
            "main",
            "station:account-old",
            ActorRef::new_person("actor-old"),
            "token-old",
        ));
        let mirror = Mutex::new(SessionState {
            actor_id: Some("actor-old".to_string()),
            token: Some("token-old".to_string()),
            account_id: Some("station:account-old".to_string()),
        });
        let durable_active = RefCell::new("station:account-old".to_string());

        let result = commit_runtime_binding(
            &sessions,
            &mirror,
            ActiveSession::new(
                "main",
                "station:account-new",
                ActorRef::new_person("actor-new"),
                "token-new",
            ),
            SessionState {
                actor_id: Some("actor-new".to_string()),
                token: Some("token-new".to_string()),
                account_id: Some("station:account-new".to_string()),
            },
            Some("actor-new"),
            || Err("injected durable active account write failure".to_string()),
        );

        assert!(result.is_err());
        assert_eq!(&*durable_active.borrow(), "station:account-old");
        let restored = sessions.get("main").expect("old window session restored");
        assert_eq!(restored.account_id, "station:account-old");
        assert_eq!(
            mirror.lock().expect("mirror").account_id.as_deref(),
            Some("station:account-old")
        );
    }

    #[test]
    fn commit_failure_unbinds_actor_when_takeover_revoked_old_token() {
        let sessions = WindowSessionRegistry::new();
        sessions.bind(ActiveSession::new(
            "main",
            "station:account-old",
            ActorRef::new_person("actor-shared"),
            "token-old",
        ));
        let mirror = Mutex::new(SessionState {
            actor_id: Some("actor-shared".to_string()),
            token: Some("token-old".to_string()),
            account_id: Some("station:account-old".to_string()),
        });

        let result = commit_runtime_binding(
            &sessions,
            &mirror,
            ActiveSession::new(
                "main",
                "station:account-new",
                ActorRef::new_person("actor-shared"),
                "token-new",
            ),
            SessionState {
                actor_id: Some("actor-shared".to_string()),
                token: Some("token-new".to_string()),
                account_id: Some("station:account-new".to_string()),
            },
            Some("actor-shared"),
            || Err("injected durable active account write failure".to_string()),
        );

        assert!(result.is_err());
        assert!(sessions.get("main").is_none());
        let cleared = mirror.lock().expect("mirror");
        assert!(cleared.actor_id.is_none());
        assert!(cleared.token.is_none());
        assert!(cleared.account_id.is_none());
    }

    #[test]
    fn worker_activation_failure_rolls_back_committed_identity() {
        let sessions = WindowSessionRegistry::new();
        sessions.bind(ActiveSession::new(
            "main",
            "station:account-old",
            ActorRef::new_person("actor-old"),
            "token-old",
        ));
        let mirror = Mutex::new(SessionState {
            actor_id: Some("actor-old".to_string()),
            token: Some("token-old".to_string()),
            account_id: Some("station:account-old".to_string()),
        });
        let durable_active = RefCell::new("station:account-old".to_string());

        let commit = commit_runtime_binding(
            &sessions,
            &mirror,
            ActiveSession::new(
                "main",
                "station:account-new",
                ActorRef::new_person("actor-new"),
                "token-new",
            ),
            SessionState {
                actor_id: Some("actor-new".to_string()),
                token: Some("token-new".to_string()),
                account_id: Some("station:account-new".to_string()),
            },
            Some("actor-new"),
            || {
                durable_active.replace("station:account-new".to_string());
                Ok(())
            },
        )
        .expect("identity commit should succeed before worker activation");

        rollback_runtime_binding(&sessions, &mirror, commit, Some("actor-new"), || {
            durable_active.replace("station:account-old".to_string());
            Ok(())
        })
        .expect("worker activation rollback should restore the prior identity");

        assert_eq!(&*durable_active.borrow(), "station:account-old");
        let restored = sessions.get("main").expect("old window session restored");
        assert_eq!(restored.actor.actor_id, "actor-old");
        assert_eq!(restored.jwt, "token-old");
        let restored_mirror = mirror.lock().expect("mirror");
        assert_eq!(restored_mirror.actor_id.as_deref(), Some("actor-old"));
        assert_eq!(restored_mirror.token.as_deref(), Some("token-old"));
    }
}
