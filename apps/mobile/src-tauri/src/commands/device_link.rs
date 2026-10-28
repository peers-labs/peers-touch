use crate::{
    error::MobileResult,
    platform::{qr_scanner, secure_storage::SecureStorage},
    runtime::{
        device_link::{MobileDeviceLinkRuntime, Projection},
        oauth::{NativeAccessSubmitInput, OAuthCoordinator},
    },
};
use tauri::{AppHandle, Manager, Runtime};

#[tauri::command]
pub async fn device_link_scan<R: Runtime>(app: AppHandle<R>) -> MobileResult<Projection> {
    let runtime = app.state::<MobileDeviceLinkRuntime>();
    let epoch = runtime.begin_scan()?;
    let payload = qr_scanner::scan(&app).await;
    runtime.end_scan();
    let payload = payload?;
    receive(app, payload, epoch).await
}

pub(crate) async fn receive<R: Runtime>(
    app: AppHandle<R>,
    payload: zeroize::Zeroizing<String>,
    epoch: u64,
) -> MobileResult<Projection> {
    tauri::async_runtime::spawn_blocking(move || {
        let platform = if cfg!(target_os = "android") {
            "android"
        } else if cfg!(target_os = "ios") {
            "ios"
        } else {
            "unsupported"
        };
        app.state::<MobileDeviceLinkRuntime>().receive(
            &app.state::<SecureStorage>(),
            &app.state::<OAuthCoordinator>(),
            &payload,
            platform,
            epoch,
        )
    })
    .await
    .map_err(|_| crate::runtime::device_link::error("runtimeUnavailable"))?
}

#[tauri::command]
pub async fn device_link_status<R: Runtime>(app: AppHandle<R>) -> MobileResult<Projection> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<MobileDeviceLinkRuntime>().poll(
            &app.state::<SecureStorage>(),
            &app.state::<OAuthCoordinator>(),
        )
    })
    .await
    .map_err(|_| crate::runtime::device_link::error("runtimeUnavailable"))?
}

#[tauri::command]
pub async fn device_link_submit<R: Runtime>(
    app: AppHandle<R>,
    input: NativeAccessSubmitInput,
) -> MobileResult<Projection> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<MobileDeviceLinkRuntime>().submit(
            &app.state::<SecureStorage>(),
            &app.state::<OAuthCoordinator>(),
            input,
        )
    })
    .await
    .map_err(|_| crate::runtime::device_link::error("runtimeUnavailable"))?
}

#[tauri::command]
pub async fn device_link_cancel<R: Runtime>(app: AppHandle<R>) -> MobileResult<Projection> {
    app.state::<MobileDeviceLinkRuntime>().invalidate();
    qr_scanner::cancel(&app).await?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<MobileDeviceLinkRuntime>().cancel(
            &app.state::<SecureStorage>(),
            &app.state::<OAuthCoordinator>(),
        )
    })
    .await
    .map_err(|_| crate::runtime::device_link::error("runtimeUnavailable"))?
}
