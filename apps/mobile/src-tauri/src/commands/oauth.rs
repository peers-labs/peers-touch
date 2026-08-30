use tauri::{AppHandle, Runtime, State};

use crate::error::MobileResult;
use crate::platform::browser;
use crate::platform::secure_storage::SecureStorage;
#[cfg(feature = "acceptance-harness")]
use crate::runtime::oauth::{
    CallbackReplayHandleProjection, CallbackReplayHandleRequest, NegativeCallbackProjection,
    NegativeCallbackRequest,
};
use crate::runtime::oauth::{
    OAuthCoordinator, OAuthPublicProjection, OAuthPurgeProjection, OAuthScopeIntent,
    OAuthStartIntent,
};

#[tauri::command]
pub async fn oauth_start<R: Runtime>(
    app: AppHandle<R>,
    coordinator: State<'_, OAuthCoordinator>,
    storage: State<'_, SecureStorage>,
    input: OAuthStartIntent,
) -> MobileResult<OAuthPublicProjection> {
    let launch = coordinator.start(&storage, input).await?;
    if let Some(authorize_url) = launch.authorize_url {
        browser::open_external(&app, &authorize_url)?;
    }
    Ok(launch.projection)
}

#[tauri::command]
pub async fn oauth_status(
    coordinator: State<'_, OAuthCoordinator>,
    storage: State<'_, SecureStorage>,
    input: OAuthScopeIntent,
) -> MobileResult<OAuthPublicProjection> {
    coordinator.status(&storage, input).await
}

#[tauri::command]
pub async fn oauth_cancel(
    coordinator: State<'_, OAuthCoordinator>,
    storage: State<'_, SecureStorage>,
    input: OAuthScopeIntent,
) -> MobileResult<OAuthPublicProjection> {
    coordinator.cancel(&storage, input).await
}

#[tauri::command]
pub async fn oauth_logout_purge(
    coordinator: State<'_, OAuthCoordinator>,
    storage: State<'_, SecureStorage>,
    input: OAuthScopeIntent,
) -> MobileResult<OAuthPurgeProjection> {
    coordinator.logout_purge(&storage, input).await
}

#[tauri::command]
pub fn oauth_retry_browser<R: Runtime>(
    app: AppHandle<R>,
    coordinator: State<'_, OAuthCoordinator>,
    storage: State<'_, SecureStorage>,
) -> MobileResult<OAuthPublicProjection> {
    let authorize_url = coordinator.retry_browser_url(&storage)?;
    browser::open_external(&app, &authorize_url)?;
    coordinator.projection(&storage)
}

#[tauri::command]
pub fn oauth_projection(
    coordinator: State<'_, OAuthCoordinator>,
    storage: State<'_, SecureStorage>,
) -> MobileResult<OAuthPublicProjection> {
    coordinator.projection(&storage)
}

#[tauri::command]
pub async fn oauth_restore(
    coordinator: State<'_, OAuthCoordinator>,
    storage: State<'_, SecureStorage>,
    input: OAuthScopeIntent,
) -> MobileResult<OAuthPublicProjection> {
    coordinator.restore(&storage, input).await
}

#[cfg(feature = "acceptance-harness")]
#[tauri::command]
pub fn oauth_acceptance_callback_replay_handle(
    coordinator: State<'_, OAuthCoordinator>,
    storage: State<'_, SecureStorage>,
    input: CallbackReplayHandleRequest,
) -> MobileResult<CallbackReplayHandleProjection> {
    coordinator.acceptance_callback_replay_handle(&*storage, input)
}

#[cfg(feature = "acceptance-harness")]
#[tauri::command]
pub async fn oauth_acceptance_negative_callback(
    coordinator: State<'_, OAuthCoordinator>,
    storage: State<'_, SecureStorage>,
    input: NegativeCallbackRequest,
) -> MobileResult<NegativeCallbackProjection> {
    coordinator
        .acceptance_negative_callback(&*storage, input)
        .await
}
