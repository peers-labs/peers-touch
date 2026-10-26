use tauri::{App, AppHandle, Manager, Runtime};
use tauri_plugin_deep_link::DeepLinkExt;

use crate::error::MobileResult;
use crate::platform::background_bridge;
use crate::platform::lifecycle_bridge::NativeLifecycleSource;
use crate::platform::native_events;
use crate::platform::secure_storage::SecureStorage;
use crate::runtime::oauth::OAuthCoordinator;

pub fn install<R: Runtime>(app: &mut App<R>) -> Result<(), Box<dyn std::error::Error>> {
    let warm_app = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            dispatch_deep_link(&warm_app, url);
        }
    });

    if let Some(urls) = app.deep_link().get_current()? {
        for url in urls {
            dispatch_deep_link(app.handle(), url);
        }
    }

    Ok(())
}

/// Route incoming deep links to the appropriate handler.
///
/// OAuth callbacks are processed by the OAuth coordinator.
/// All other deep links are emitted as native events to the TS layer
/// and trigger a lifecycle generation advance for proper ordering.
fn dispatch_deep_link<R: Runtime>(app: &AppHandle<R>, url: tauri::Url) {
    if schema_core::parse(url.as_str()).is_err() {
        let _ = native_events::emit_native_event_error(
            app,
            "route-deep-link",
            "Invalid or unsupported link",
        );
        return;
    }
    if is_oauth_callback(&url) {
        dispatch_oauth_callback(app, url);
    } else if matches!(schema_core::parse(url.as_str()), Ok(schema_core::Link::Action(action))
        if matches!(action.action, Some(schema_core::proto::schema_action::Action::DeviceLinkOffer(_)
            | schema_core::proto::schema_action::Action::DeviceLinkLocator(_)))) {
        let app = app.clone();
        let epoch = app.state::<crate::runtime::device_link::MobileDeviceLinkRuntime>().epoch();
        tauri::async_runtime::spawn(async move {
            let result = crate::commands::device_link::receive(app.clone(),
                zeroize::Zeroizing::new(url.to_string()), epoch).await;
            match result {
                Ok(projection) => {
                    use tauri::Emitter;
                    let _ = app.emit("mobile:device-link", projection);
                }
                Err(_) => {
                    let _ = native_events::emit_native_event_error(&app, "device-link", "Device link unavailable");
                }
            }
        });
    } else {
        dispatch_general_deep_link(app, url);
    }
}

fn dispatch_oauth_callback<R: Runtime>(app: &AppHandle<R>, url: tauri::Url) {
    if let Err(error) = handle_native_callback(app, url) {
        let _ = native_events::emit_native_event_error(
            app,
            "route-oauth-deep-link",
            &error.to_string(),
        );
    }
}

/// Handle non-OAuth deep links.
///
/// Emits a wakeup in the current generation and routes the URL to the TS layer.
/// The native foreground callback remains the sole owner of resume generation.
fn dispatch_general_deep_link<R: Runtime>(app: &AppHandle<R>, url: tauri::Url) {
    background_bridge::handle_native_wakeup(app, NativeLifecycleSource::DeepLinkActivation);

    if let Err(error) = native_events::emit_deep_link(app, url.to_string()) {
        let _ = native_events::emit_native_event_error(
            app,
            "route-general-deep-link",
            &error.to_string(),
        );
    }
}

fn handle_native_callback<R: Runtime>(app: &AppHandle<R>, url: tauri::Url) -> MobileResult<()> {
    if !is_oauth_callback(&url) {
        return Ok(());
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = {
            let coordinator = app.state::<OAuthCoordinator>();
            let storage = app.state::<SecureStorage>();
            coordinator.handle_callback(&storage, url.as_str()).await
        };
        match result {
            Ok(projection) => {
                let _ = native_events::emit_oauth_projection(&app, projection);
            }
            Err(error) => {
                let _ = native_events::emit_native_event_error(
                    &app,
                    "route-oauth-deep-link",
                    &error.to_string(),
                );
            }
        }
    });
    Ok(())
}

fn is_oauth_callback(url: &tauri::Url) -> bool {
    matches!(
        schema_core::parse(url.as_str()),
        Ok(schema_core::Link::OAuthCallback(_))
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parses(value: &str) -> tauri::Url {
        tauri::Url::parse(value).expect("test URL must parse")
    }

    #[test]
    fn accepts_only_the_oauth_callback_route() {
        assert!(is_oauth_callback(&parses(
            "peers-touch://oauth/callback?code=code&state=state"
        )));
        assert!(!is_oauth_callback(&parses(
            "peers-touch://oauth/other?code=code&state=state"
        )));
        assert!(!is_oauth_callback(&parses(
            "peers-touch://profile/callback?code=code&state=state"
        )));
        assert!(!is_oauth_callback(&parses(
            "https://oauth/callback?code=code&state=state"
        )));
        assert!(!is_oauth_callback(&parses(
            "peers-touch://oauth/callback?code=code&state=state#fragment"
        )));
    }
}
