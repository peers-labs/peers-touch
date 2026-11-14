//! macOS implementation of the sleep / screen-lock observer.

use std::ffi::CString;
use std::sync::OnceLock;

use objc2::{
    define_class, msg_send,
    rc::Retained,
    runtime::{AnyObject, NSObject, NSObjectProtocol, Sel},
    AnyThread, MainThreadMarker,
};
use objc2_app_kit::{NSWorkspace, NSWorkspaceWillSleepNotification};
use objc2_foundation::{
    NSDistributedNotificationCenter, NSNotification, NSNotificationSuspensionBehavior, NSString,
};
use tauri::{AppHandle, Wry};

use crate::application::host_events;
use crate::infrastructure::{auth_identity, session_vault};

/// Distributed notification posted by macOS when the screen locks.
const SCREEN_LOCK_NOTIFICATION: &str = "com.apple.screenIsLocked";

static APP_HANDLE: OnceLock<AppHandle<Wry>> = OnceLock::new();
/// Notification centers hold observers weakly; retain for the process lifetime.
static OBSERVER: OnceLock<Retained<WakeLockObserver>> = OnceLock::new();

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "PTWakeLockObserver"]
    pub struct WakeLockObserver;

    unsafe impl NSObjectProtocol for WakeLockObserver {}

    impl WakeLockObserver {
        #[unsafe(method(pt_handleWakeLock:))]
        fn handle_wake_lock(&self, notification: &NSNotification) {
            let reason = if notification.name().to_string() == SCREEN_LOCK_NOTIFICATION {
                "screen-lock"
            } else {
                "system-sleep"
            };
            handle_lock_event(reason);
        }
    }
);

fn handle_lock_event(reason: &str) {
    let Some(app) = APP_HANDLE.get() else {
        tracing::warn!("wake lock fired before the app handle was registered");
        return;
    };

    let Ok(identity_state) = auth_identity::read_state() else {
        tracing::warn!("wake lock: identity state unreadable; skipping auto-lock");
        return;
    };
    let Some(account_id) = identity_state.active_account_id else {
        // No signed-in account: nothing to lock.
        return;
    };

    let pin_required = session_vault::account_requires_pin(&account_id);
    if pin_required {
        // Remove the raw token so no restore edge can re-enter without the PIN.
        session_vault::purge_raw_sessions_for_pin_accounts(&identity_state.accounts);
    }

    if let Err(error) = host_events::emit_locked(app, Some(account_id), pin_required, reason) {
        tracing::warn!(error = %error, "failed to emit desktop:locked");
    }
}

/// Install the observer once during app setup. Must run on the main thread.
pub fn init(app: AppHandle<Wry>) -> Result<(), String> {
    if MainThreadMarker::new().is_none() {
        return Err("wake lock init must run on the main thread".to_string());
    }
    APP_HANDLE
        .set(app)
        .map_err(|_| "wake lock app handle already registered".to_string())?;

    let observer = unsafe {
        let allocated = WakeLockObserver::alloc().set_ivars(());
        let observer: Retained<WakeLockObserver> = msg_send![super(allocated), init];
        observer
    };
    let selector = Sel::register(
        &CString::new("pt_handleWakeLock:").expect("selector name contains no NUL"),
    );
    // SAFETY: `observer` is a retained, initialized NSObject subclass and the
    // selector is registered on that class just above.
    let observer_object: &AnyObject =
        unsafe { &*((&*observer) as *const WakeLockObserver as *const AnyObject) };

    // System sleep via the workspace notification center.
    let workspace = NSWorkspace::sharedWorkspace();
    let workspace_center = workspace.notificationCenter();
    unsafe {
        workspace_center.addObserver_selector_name_object(
            observer_object,
            selector,
            Some(NSWorkspaceWillSleepNotification),
            None,
        );
    }

    // Screen lock (including lock without sleep) via the distributed center.
    // Deliver immediately so the purge runs even while the app is backgrounded.
    let distributed_center = NSDistributedNotificationCenter::defaultCenter();
    let lock_name = NSString::from_str(SCREEN_LOCK_NOTIFICATION);
    unsafe {
        distributed_center.addObserver_selector_name_object_suspensionBehavior(
            observer_object,
            selector,
            Some(&lock_name),
            None,
            NSNotificationSuspensionBehavior::DeliverImmediately,
        );
    }

    OBSERVER
        .set(observer)
        .map_err(|_| "wake lock observer already installed".to_string())?;
    Ok(())
}
