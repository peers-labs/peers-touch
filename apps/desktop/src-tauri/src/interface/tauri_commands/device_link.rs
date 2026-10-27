use crate::{
    application::device_link,
    error::{AppResult, ErrorCode},
    state::AppState,
};
use serde::Deserialize;
use std::sync::Arc;
use tauri::{ipc::Invoke, Manager, State, Window, Wry};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionInput {
    claim_id: String,
    observed_revision: u64,
    comparison_code: String,
    allow: bool,
}

fn result(
    value: Result<device_link::Projection, String>,
) -> Result<AppResult<device_link::Projection>, String> {
    Ok(match value {
        Ok(projection) => AppResult::success(projection),
        Err(error) => AppResult::fail(ErrorCode::Unavailable, error, None),
    })
}

/// Reserve/withdraw at synchronous IPC admission, before either worker can run.
/// The resolver remains asynchronous, so no preparation or RPC blocks the UI.
pub fn with_admission(
    next: impl Fn(Invoke<Wry>) -> bool + Send + Sync + 'static,
) -> impl Fn(Invoke<Wry>) -> bool + Send + Sync + 'static {
    move |invoke| match invoke.message.command() {
        "device_link_create" => {
            let webview = invoke.message.webview();
            let label = webview.window().label().to_string();
            let state = webview.state::<Arc<AppState>>().inner().clone();
            let admitted = device_link::admit_create(&label);
            invoke.resolver.respond_async(async move {
                let value = match admitted {
                    Ok(admitted) => tauri::async_runtime::spawn_blocking(move || {
                        device_link::create(&state, admitted)
                    })
                    .await
                    .unwrap_or_else(|_| Err("deviceLink.runtimeFailed".into())),
                    Err(error) => Err(error),
                };
                result(value).map_err(Into::into)
            });
            true
        }
        "device_link_cancel" => {
            let label = invoke.message.webview().window().label().to_string();
            let admitted = device_link::begin_cancel(&label);
            invoke.resolver.respond_async(async move {
                let value = match admitted {
                    Ok(()) => tauri::async_runtime::spawn_blocking(move || {
                        device_link::finish_cancel(&label)
                    })
                    .await
                    .unwrap_or_else(|_| Err("deviceLink.runtimeFailed".into())),
                    Err(error) => Err(error),
                };
                Ok(match value {
                    Ok(()) => AppResult::success(()),
                    Err(error) => AppResult::fail(ErrorCode::Unavailable, error, None),
                })
            });
            true
        }
        _ => next(invoke),
    }
}

#[tauri::command]
pub async fn device_link_status(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> Result<AppResult<device_link::Projection>, String> {
    let state = state.inner().clone();
    let label = window.label().to_string();
    result(
        tauri::async_runtime::spawn_blocking(move || device_link::status(&state, &label))
            .await
            .unwrap_or_else(|_| Err("deviceLink.runtimeFailed".into())),
    )
}

#[tauri::command]
pub async fn device_link_decide(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: DecisionInput,
) -> Result<AppResult<device_link::Projection>, String> {
    let state = state.inner().clone();
    let label = window.label().to_string();
    result(
        tauri::async_runtime::spawn_blocking(move || {
            device_link::decide(
                &state,
                &label,
                &input.claim_id,
                input.observed_revision,
                &input.comparison_code,
                input.allow,
            )
        })
        .await
        .unwrap_or_else(|_| Err("deviceLink.runtimeFailed".into())),
    )
}
