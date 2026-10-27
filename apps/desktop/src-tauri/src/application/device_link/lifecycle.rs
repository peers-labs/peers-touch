use super::{cancellation::cancel_flow, ActiveSession, Flow, Slot};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, LazyLock, Mutex, TryLockError,
    },
    time::{Duration, Instant},
};

#[derive(Default)]
struct Registry {
    live: HashMap<String, Arc<Slot>>,
    retired: HashMap<String, Vec<Arc<Slot>>>,
}
static REGISTRY: LazyLock<Mutex<Registry>> = LazyLock::new(|| Mutex::new(Registry::default()));

pub(super) fn current(window: &str) -> Result<Arc<Slot>, String> {
    REGISTRY
        .lock()
        .map_err(|_| "deviceLink.runtimeLock")?
        .live
        .get(window)
        .cloned()
        .ok_or_else(|| "deviceLink.notReady".into())
}

pub(super) fn reserve(window: &str) -> Result<Arc<Slot>, String> {
    let mut registry = REGISTRY.lock().map_err(|_| "deviceLink.runtimeLock")?;
    if registry.retired.values().map(Vec::len).sum::<usize>() >= 32 {
        return Err("deviceLink.cancellationPending".into());
    }
    if let Some(slot) = registry.live.get(window) {
        if !slot.cancelled.load(Ordering::SeqCst) {
            return Ok(slot.clone());
        }
    }
    if registry.live.len() >= 16 && !registry.live.contains_key(window) {
        return Err("deviceLink.capacityExceeded".into());
    }
    let slot = Arc::new(Slot {
        cancelled: AtomicBool::new(false),
        flow: Mutex::new(None),
    });
    if let Some(old) = registry.live.insert(window.into(), slot.clone()) {
        old.cancelled.store(true, Ordering::SeqCst);
        registry.retired.entry(window.into()).or_default().push(old);
    }
    Ok(slot)
}

pub(super) fn withdraw(window: &str) -> Result<(), String> {
    let mut registry = REGISTRY.lock().map_err(|_| "deviceLink.runtimeLock")?;
    if let Some(slot) = registry.live.remove(window) {
        slot.cancelled.store(true, Ordering::SeqCst);
        registry
            .retired
            .entry(window.into())
            .or_default()
            .push(slot);
    }
    Ok(())
}

pub(super) fn cleanup_retired(window: &str) -> Result<(), String> {
    cleanup_selected(window, |_| true)
}

pub(super) fn cleanup_retired_in_scope(
    window: &str,
    session: &ActiveSession,
    station: &str,
    root: &[u8],
) -> Result<(), String> {
    cleanup_selected(window, |flow| {
        flow.session.activation_id == session.activation_id
            && flow.session.actor == session.actor
            && flow.station_peer_id == station
            && flow.station_root == root
    })
}

fn cleanup_selected(window: &str, selected: impl Fn(&Flow) -> bool) -> Result<(), String> {
    let slots = REGISTRY
        .lock()
        .map_err(|_| "deviceLink.runtimeLock")?
        .retired
        .get(window)
        .cloned()
        .unwrap_or_default();
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut failure = None;
    for slot in slots {
        let mut guard = match slot.flow.try_lock() {
            Ok(guard) => guard,
            Err(TryLockError::WouldBlock) => {
                failure.get_or_insert_with(|| "deviceLink.cancellationPending".to_string());
                continue;
            }
            Err(TryLockError::Poisoned(_)) => {
                failure.get_or_insert_with(|| "deviceLink.runtimeLock".to_string());
                continue;
            }
        };
        if let Some(flow) = guard.as_mut() {
            if !selected(flow) {
                // Different authority cannot reconcile this Flow. Keep it
                // owned without allowing its old JWT to block a new login.
                continue;
            }
            if Instant::now() >= deadline {
                failure.get_or_insert_with(|| "deviceLink.cancellationPending".to_string());
                continue;
            }
            if let Err(error) = cancel_flow(flow) {
                failure.get_or_insert(error);
                // One unresolved outcome must not starve later retirements.
                continue;
            }
        }
        drop(guard);
        let mut registry = REGISTRY.lock().map_err(|_| "deviceLink.runtimeLock")?;
        if let Some(slots) = registry.retired.get_mut(window) {
            slots.retain(|candidate| !Arc::ptr_eq(candidate, &slot));
            if slots.is_empty() {
                registry.retired.remove(window);
            }
        }
    }
    failure.map_or(Ok(()), Err)
}

pub(super) fn invalidate(window: &str) {
    if withdraw(window).is_err() {
        return;
    }
    let window = window.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        if cleanup_retired(&window).is_err() {
            tracing::warn!("Device Link cancellation remains owned for reconciliation");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::device_link::{admit_create, begin_cancel, finish_cancel};
    use crate::{application::station_runtime::client::StationClient, domain::identity::ActorRef};
    use device_link_core::{crypto, proto::CreateDeviceLinkRequest};
    use ed25519_dalek::SigningKey;

    fn pending_flow(session: ActiveSession) -> Flow {
        Flow {
            session,
            station_peer_id: "station".into(),
            station_name: String::new(),
            station_root: vec![1; 32],
            client: StationClient::testing_unavailable(),
            key: crypto::ReceiverKey::generate(),
            signing: SigningKey::from_bytes(&[2; 32]),
            offer: None,
            qr_link: String::new(),
            status: None,
            approval: None,
            create_request: Some(CreateDeviceLinkRequest::default()),
            cancellation_offer_id: None,
        }
    }

    fn session(window: &str) -> ActiveSession {
        ActiveSession::new(
            window,
            "account",
            ActorRef::new_person("actor"),
            "retired-jwt",
        )
    }

    #[test]
    fn retired_failure_keeps_ownership_but_does_not_starve_later_cleanup() {
        let window = "device-link-test-retired-failure";
        let old = admit_create(window).unwrap();
        *old.slot.flow.lock().unwrap() = Some(pending_flow(session(window)));
        begin_cancel(window).unwrap();
        let later = admit_create(window).unwrap();
        begin_cancel(window).unwrap();
        assert_eq!(
            finish_cancel(window).unwrap_err(),
            "deviceLink.cancellationPending"
        );
        let registry = REGISTRY.lock().unwrap();
        let retired = registry.retired.get(window).unwrap();
        assert_eq!(retired.len(), 1);
        assert!(Arc::ptr_eq(&retired[0], &old.slot));
        assert!(!retired.iter().any(|slot| Arc::ptr_eq(slot, &later.slot)));
        drop(registry);
        old.slot.flow.lock().unwrap().take();
        finish_cancel(window).unwrap();
    }

    #[test]
    fn pending_retirement_blocks_only_its_original_authority_scope() {
        let window = "device-link-test-retired-login";
        let original = session(window);
        let old = admit_create(window).unwrap();
        *old.slot.flow.lock().unwrap() = Some(pending_flow(original.clone()));
        begin_cancel(window).unwrap();
        assert!(cleanup_retired_in_scope(window, &original, "station", &[1; 32]).is_err());
        let new_login = session(window);
        cleanup_retired_in_scope(window, &new_login, "station", &[1; 32]).unwrap();
        cleanup_retired_in_scope(window, &original, "other-station", &[1; 32]).unwrap();
        cleanup_retired_in_scope(window, &original, "station", &[3; 32]).unwrap();
        let mut other_actor = original.clone();
        other_actor.actor = ActorRef::new_person("other-actor");
        cleanup_retired_in_scope(window, &other_actor, "station", &[1; 32]).unwrap();
        assert_eq!(
            REGISTRY.lock().unwrap().retired.get(window).unwrap().len(),
            1
        );
        old.slot.flow.lock().unwrap().take();
        finish_cancel(window).unwrap();
    }

    #[test]
    fn cancel_before_worker_start_invalidates_the_admitted_slot() {
        let window = "device-link-test-delayed-create";
        let admitted = admit_create(window).unwrap();
        begin_cancel(window).unwrap();
        finish_cancel(window).unwrap();
        assert_eq!(
            admitted.ensure_open().unwrap_err(),
            "deviceLink.scopeChanged"
        );
        assert!(current(window).is_err());
    }

    #[test]
    fn an_old_create_cannot_reacquire_a_new_reservation() {
        let window = "device-link-test-replaced-create";
        let old = admit_create(window).unwrap();
        begin_cancel(window).unwrap();
        let new = admit_create(window).unwrap();
        finish_cancel(window).unwrap();
        assert!(old.ensure_open().is_err());
        new.ensure_open().unwrap();
        assert!(Arc::ptr_eq(&current(window).unwrap(), &new.slot));
        begin_cancel(window).unwrap();
        finish_cancel(window).unwrap();
    }
}
