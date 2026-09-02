use tauri::{App, AppHandle, Manager, Runtime};
use tauri_plugin_deep_link::DeepLinkExt;

use crate::error::MobileResult;
use crate::platform::background_bridge;
use crate::platform::lifecycle_bridge::NativeLifecycleSource;
use crate::platform::native_events;
use crate::platform::secure_storage::SecureStorage;
use crate::runtime::oauth::OAuthCoordinator;

const OAUTH_CALLBACK_SCHEME: &str = "peers-touch";
const OAUTH_CALLBACK_HOST: &str = "oauth";
const OAUTH_CALLBACK_PATH: &str = "/callback";

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
    if is_oauth_callback(&url) {
        dispatch_oauth_callback(app, url);
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
/// Advances lifecycle generation (the deep link may have woken the app)
/// and emits the URL to the TS layer for routing.
fn dispatch_general_deep_link<R: Runtime>(app: &AppHandle<R>, url: tauri::Url) {
    // Advance generation — deep link activation may wake the app from background
    background_bridge::handle_native_resume(app, NativeLifecycleSource::DeepLinkActivation);

    // Emit the deep link URL to the TS layer
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
    url.scheme() == OAUTH_CALLBACK_SCHEME
        && url.host_str() == Some(OAUTH_CALLBACK_HOST)
        && url.path() == OAUTH_CALLBACK_PATH
        && url.fragment().is_none()
        && url.username().is_empty()
        && url.password().is_none()
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
