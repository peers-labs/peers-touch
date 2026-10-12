//! macOS UserNotifications integration for bot/social events (BOT-A31/A33/A35).
//!
//! Why native instead of `tauri-plugin-notification`: that plugin's desktop
//! backend is notify-rust and is fire-and-forget — it drops the identifier,
//! `userInfo`, and all click/action callbacks, so notification taps cannot be
//! routed back to a conversation. `UNUserNotificationCenter` delivers the
//! tapped notification's response to our delegate; the routing tuple
//! (`notificationId` / `sessionUlid` / `target`) travels inside `userInfo` and
//! therefore survives app relaunch.
//!
//! All AppKit/UserNotifications calls run on the main thread. The delegate is
//! retained in a `OnceLock` because the center holds it weakly.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use block2::RcBlock;
use objc2::{
    define_class, msg_send,
    rc::Retained,
    runtime::{AnyObject, Bool, NSObject, NSObjectProtocol, ProtocolObject},
    AnyThread, MainThreadMarker,
};
use objc2_foundation::{ns_string, NSBundle, NSDictionary, NSError, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification,
    UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse,
    UNNotificationSound, UNTimeIntervalNotificationTrigger, UNUserNotificationCenter,
    UNUserNotificationCenterDelegate,
};
use tauri::{AppHandle, Wry};

use super::native_surface::NativeNotificationRoute;
use crate::application::{host_events, tray};

static APP_HANDLE: OnceLock<AppHandle<Wry>> = OnceLock::new();
static DELEGATE: OnceLock<Retained<NotificationDelegate>> = OnceLock::new();
/// UserNotifications only works inside a bundled `.app`; a bare debug binary
/// aborts with "bundleProxyForCurrentProcess is nil" when touching the center.
/// Track successful activation so `post` degrades instead of crashing.
static AVAILABLE: AtomicBool = AtomicBool::new(false);

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "PTUNNotificationDelegate"]
    pub struct NotificationDelegate;

    unsafe impl NSObjectProtocol for NotificationDelegate {}

    unsafe impl UNUserNotificationCenterDelegate for NotificationDelegate {
        // The app can remain the active application while its window is hidden
        // to the tray. Without this callback foreground delivery is silent; we
        // always present a banner/list and honor the per-notification sound flag.
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn user_notification_center_will_present(
            &self,
            _center: &UNUserNotificationCenter,
            notification: &UNNotification,
            completion_handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            let info = notification.request().content().userInfo();
            let sound_enabled =
                user_info_string(&info, ns_string!("sound")).as_deref() == Some("1");
            let mut options =
                UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::List;
            if sound_enabled {
                options |= UNNotificationPresentationOptions::Sound;
            }
            completion_handler.call((options,));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn user_notification_center_did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion_handler: &block2::DynBlock<dyn Fn()>,
        ) {
            handle_response(response);
            completion_handler.call(());
        }
    }
);

/// Install the notification delegate and request alert/sound/badge
/// authorization. Must run once on the main thread during setup.
pub fn init(app: AppHandle<Wry>) -> Result<(), String> {
    if APP_HANDLE.set(app).is_err() {
        return Err("notification center already initialized".to_string());
    }
    if MainThreadMarker::new().is_none() {
        return Err("notification init must run on the main thread".to_string());
    }
    // UserNotifications requires a bundled `.app` (it throws when the process
    // has no bundle proxy). `tauri dev` runs an unbundled debug binary, so
    // degrade gracefully there; packaged builds proceed normally.
    if NSBundle::mainBundle().bundleIdentifier().is_none() {
        tracing::warn!(
            "native notifications unavailable: process is not running inside a bundled .app"
        );
        return Ok(());
    }

    let delegate = unsafe {
        let allocated = NotificationDelegate::alloc().set_ivars(());
        let delegate: Retained<NotificationDelegate> = msg_send![super(allocated), init];
        delegate
    };
    let protocol: &ProtocolObject<dyn UNUserNotificationCenterDelegate> =
        ProtocolObject::from_ref(&*delegate);

    let center = UNUserNotificationCenter::currentNotificationCenter();
    center.setDelegate(Some(protocol));
    DELEGATE
        .set(delegate)
        .map_err(|_| "notification delegate already installed".to_string())?;

    let completion: RcBlock<dyn Fn(Bool, *mut NSError)> =
        RcBlock::new(|granted: Bool, error: *mut NSError| {
            if !granted.as_bool() {
                // SAFETY: the pointer is only dereferenced within this callback,
                // where it is either null or a valid NSError for the call's duration.
                let error = unsafe { error.as_ref() };
                tracing::warn!(error = ?error, "user notification authorization was not granted");
            }
        });
    center.requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Alert
            | UNAuthorizationOptions::Sound
            | UNAuthorizationOptions::Badge,
        &completion,
    );

    AVAILABLE.store(true, Ordering::Release);
    Ok(())
}

/// Whether native notifications are usable in this process (bundled `.app`
/// with an initialized center).
pub fn is_available() -> bool {
    AVAILABLE.load(Ordering::Acquire)
}

/// Schedule one notification. Reusing the same `notification_id` replaces a
/// pending/delivered notification, giving one surface per event per device
/// (BOT-A35). Construction hops to the main thread; only plain strings cross.
pub fn post(route: NativeNotificationRoute) -> Result<(), String> {
    if !is_available() {
        return Err("native notifications are unavailable in this process".to_string());
    }
    dispatch2::DispatchQueue::main().exec_async(move || {
        if let Err(error) = post_on_main(&route) {
            tracing::warn!(error = %error, notification_id = %route.notification_id, "failed to post native notification");
        }
    });
    Ok(())
}

fn post_on_main(route: &NativeNotificationRoute) -> Result<(), String> {
    let content = UNMutableNotificationContent::new();
    let title = NSString::from_str(&route.title);
    let body = NSString::from_str(&route.body);
    content.setTitle(&title);
    content.setBody(&body);
    if let Some(group_key) = &route.group_key {
        content.setThreadIdentifier(&NSString::from_str(group_key));
    }
    if route.play_sound {
        content.setSound(Some(&UNNotificationSound::defaultSound()));
    }
    // SAFETY: setUserInfo is a plain retained-property setter; the dictionary
    // and its members are all 'static for the duration of the call.
    unsafe { content.setUserInfo(&build_user_info(route)) };

    // Near-immediate delivery through the trigger pipeline (rather than
    // posting directly) so identifier replacement and center rules apply.
    let trigger = UNTimeIntervalNotificationTrigger::triggerWithTimeInterval_repeats(1.0, false);
    let identifier = NSString::from_str(&route.notification_id);
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
        &identifier,
        &content,
        Some(&trigger),
    );
    UNUserNotificationCenter::currentNotificationCenter()
        .addNotificationRequest_withCompletionHandler(&request, None);
    Ok(())
}

fn handle_response(response: &UNNotificationResponse) {
    let Some(app) = APP_HANDLE.get() else {
        tracing::warn!("notification tapped before app handle was registered");
        return;
    };
    let info = response.notification().request().content().userInfo();
    let notification_id = user_info_string(&info, ns_string!("notificationId"));
    let session_ulid = user_info_string(&info, ns_string!("sessionUlid"));
    let target = user_info_string(&info, ns_string!("target"));

    tray::restore_main_window(app);
    if let Err(error) =
        host_events::emit_notification_tap(app, notification_id, session_ulid, target)
    {
        tracing::warn!(error = %error, "failed to emit notification-tap host event");
    }
}

fn user_info_string(info: &NSDictionary, key: &NSString) -> Option<String> {
    let value: Retained<AnyObject> = info.objectForKey(key)?;
    let text: Retained<NSString> = value.downcast().ok()?;
    Some(text.to_string())
}

fn build_user_info(route: &NativeNotificationRoute) -> Retained<NSDictionary> {
    let sound = NSString::from_str(if route.play_sound { "1" } else { "0" });
    let notification_id = NSString::from_str(&route.notification_id);

    let mut keys: Vec<&NSString> = vec![ns_string!("notificationId"), ns_string!("sound")];
    let mut values: Vec<Retained<NSString>> = vec![notification_id, sound];
    if let Some(session_ulid) = &route.session_ulid {
        keys.push(ns_string!("sessionUlid"));
        values.push(NSString::from_str(session_ulid));
    }
    if let Some(target) = &route.target {
        keys.push(ns_string!("target"));
        values.push(NSString::from_str(target));
    }
    let objects: Vec<&AnyObject> = values
        .iter()
        .map(|value| {
            let object: &AnyObject = value;
            object
        })
        .collect();
    let dictionary = NSDictionary::from_slices(&keys, &objects);
    // SAFETY: `NSDictionary` generic parameters are compile-time annotations that
    // are erased at runtime; the concrete class and stored objects are unchanged.
    unsafe { Retained::cast_unchecked::<NSDictionary>(dictionary) }
}
