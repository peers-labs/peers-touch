use super::messaging::active_engine;
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;
use messaging_core::proto::chat::{
    AttachmentFileAction, AttachmentFileActionRequest, AttachmentFileActionResult,
    AttachmentFileActionState,
};
use prost::Message;
use serde::Deserialize;
use std::sync::Arc;
#[cfg(target_os = "macos")]
use std::{collections::HashMap, sync::Mutex};
use tauri::{Manager, State, Window};
use tauri_plugin_opener::OpenerExt;

#[derive(Deserialize)]
pub struct AttachmentAccessInput {
    attachment_id: String,
    #[serde(default)]
    start_download: bool,
    #[serde(default)]
    retry: bool,
}

#[derive(Deserialize)]
pub struct AttachmentHandleInput {
    access_handle: String,
}

#[derive(Deserialize)]
pub struct AttachmentActionInput {
    request_bytes: Vec<u8>,
}

#[cfg(target_os = "macos")]
async fn pick_save_destination(filename: &str) -> Option<std::path::PathBuf> {
    crate::infrastructure::native_file_dialog::save_single_file(filename.to_string()).await
}

#[cfg(not(target_os = "macos"))]
async fn pick_save_destination(filename: &str) -> Option<std::path::PathBuf> {
    rfd::AsyncFileDialog::new()
        .set_file_name(filename)
        .save_file()
        .await
        .map(|handle| handle.path().to_path_buf())
}

/// Host-owned native presentations are terminated before application exit.
#[derive(Default)]
pub struct NativeFilePresentations {
    #[cfg(target_os = "macos")]
    processes: Mutex<HashMap<String, std::process::Child>>,
}

impl NativeFilePresentations {
    pub fn shutdown(&self) {
        #[cfg(target_os = "macos")]
        if let Ok(mut processes) = self.processes.lock() {
            for (_, mut child) in processes.drain() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

/// Privileged Native test observation. Absent from production builds and never
/// grants an asset-protocol path. The driver uses this only for cache integrity
/// and cache-eviction fault injection, separately from visible product proof.
#[cfg(feature = "acceptance-webdriver")]
#[tauri::command]
pub async fn messaging_acceptance_attachment_readback(
    input: AttachmentAccessInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> Result<AppResult<serde_json::Value>, String> {
    let (_, token, engine) =
        active_engine(state.inner(), &window).map_err(|_| "FILE_SCOPE_UNAVAILABLE")?;
    let owner = file_owner(state.inner(), window.label())?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let access = engine.attachment_access(&token, &owner, &input.attachment_id, true, false)?;
        let ready =
            access.state == messaging_core::proto::chat::AttachmentAccessState::Ready as i32;
        let local_path = if ready {
            engine.acceptance_attachment_cache_path(&input.attachment_id)?
        } else {
            String::new()
        };
        if ready {
            engine
                .attachment_file_access
                .release(&owner, &access.access_handle);
        }
        Ok::<_, String>(serde_json::json!({
            "state": if ready { "ready" } else { "pending" },
            "localPath": local_path,
        }))
    })
    .await
    .map_err(|_| "FILE_ACCESS_WORKER_FAILED")?;
    Ok(match result {
        Ok(value) => AppResult::success(value),
        Err(error) => AppResult::fail(ErrorCode::InternalError, error, None),
    })
}

#[tauri::command]
pub async fn messaging_attachment_access(
    input: AttachmentAccessInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> Result<AppResult<Vec<u8>>, String> {
    let (_, token, engine) =
        active_engine(state.inner(), &window).map_err(|_| "FILE_SCOPE_UNAVAILABLE")?;
    let owner = file_owner(state.inner(), window.label())?;
    let expected_engine = engine.clone();
    let expected_owner = owner.clone();
    let epoch = engine.attachment_file_access.epoch();
    let observed_attachment_id = input.attachment_id.clone();
    let observed_start_download = input.start_download;
    let result = tauri::async_runtime::spawn_blocking(move || {
        engine.attachment_access(
            &token,
            &owner,
            &input.attachment_id,
            input.start_download,
            input.retry,
        )
    })
    .await
    .map_err(|_| "FILE_ACCESS_WORKER_FAILED")?;
    if let Ok(projection) = &result {
        let current = active_engine(state.inner(), &window)
            .is_ok_and(|(_, _, engine)| Arc::ptr_eq(&expected_engine, &engine));
        if !current
            || file_owner(state.inner(), window.label()).ok().as_deref()
                != Some(expected_owner.as_str())
            || !expected_engine
                .attachment_file_access
                .epoch_is_current(epoch)
        {
            expected_engine
                .attachment_file_access
                .release(&expected_owner, &projection.access_handle);
            return Err("FILE_ACCESS_STALE".into());
        }
    }
    Ok(match result {
        Ok(projection) => AppResult::success(projection.encode_to_vec()),
        Err(error) => {
            tracing::warn!(
                attachment_id = %observed_attachment_id,
                start_download = observed_start_download,
                error_code = %error,
                "attachment access failed",
            );
            AppResult::fail(ErrorCode::InternalError, error, None)
        }
    })
}

#[tauri::command]
pub fn messaging_release_attachment(
    input: AttachmentHandleInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> Result<(), String> {
    let (_, _, engine) =
        active_engine(state.inner(), &window).map_err(|_| "FILE_SCOPE_UNAVAILABLE")?;
    engine.attachment_file_access.release(
        &file_owner(state.inner(), window.label())?,
        &input.access_handle,
    );
    Ok(())
}

#[tauri::command]
pub async fn messaging_cancel_attachment(
    input: AttachmentAccessInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> Result<AppResult<()>, String> {
    let (_, token, engine) =
        active_engine(state.inner(), &window).map_err(|_| "FILE_SCOPE_UNAVAILABLE")?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        engine
            .attachment_transfer_worker(token)?
            .cancel(&input.attachment_id, now_unix_ms())
    })
    .await
    .map_err(|_| "FILE_CANCEL_WORKER_FAILED")?;
    Ok(match result {
        Ok(()) => AppResult::success(()),
        Err(error) => AppResult::fail(ErrorCode::InternalError, error, None),
    })
}

#[tauri::command]
pub async fn messaging_attachment_file_action(
    input: AttachmentActionInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> Result<AppResult<Vec<u8>>, String> {
    let request = AttachmentFileActionRequest::decode(input.request_bytes.as_slice())
        .map_err(|_| "FILE_ACTION_INVALID")?;
    let action =
        AttachmentFileAction::try_from(request.action).map_err(|_| "FILE_ACTION_INVALID")?;
    let (_, _, engine) =
        active_engine(state.inner(), &window).map_err(|_| "FILE_SCOPE_UNAVAILABLE")?;
    let owner = file_owner(state.inner(), window.label())?;
    engine.validate_attachment_handle(&owner, &request.access_handle, &request.attachment_id)?;
    if action == AttachmentFileAction::SaveCopy {
        let filename = engine
            .attachment_file_access
            .filename(&owner, &request.access_handle)?;
        ensure_current(state.inner(), &window, &engine, &request)?;
        let selected = pick_save_destination(&filename).await;
        let Some(destination) = selected else {
            return Ok(action_result(AttachmentFileActionState::Cancelled, ""));
        };
        ensure_current(state.inner(), &window, &engine, &request)?;
        let handle = request.access_handle;
        let result = tauri::async_runtime::spawn_blocking(move || {
            engine
                .attachment_file_access
                .save_copy(&owner, &handle, &destination)
        })
        .await
        .map_err(|_| "FILE_EXPORT_WORKER_FAILED")?;
        return Ok(match result {
            Ok(()) => action_result(AttachmentFileActionState::Completed, ""),
            Err(error) => action_result(AttachmentFileActionState::Failed, &error),
        });
    }
    if !matches!(
        action,
        AttachmentFileAction::Preview | AttachmentFileAction::OpenExternal
    ) {
        return Ok(action_result(
            AttachmentFileActionState::Unavailable,
            "FILE_ACTION_UNAVAILABLE",
        ));
    }
    let stage_engine = engine.clone();
    let stage_owner = owner.clone();
    let handle = request.access_handle.clone();
    let staging_root = engine.attachment_handoff_root()?;
    let worker_root = staging_root.clone();
    let staged = tauri::async_runtime::spawn_blocking(move || {
        stage_engine
            .attachment_file_access
            .stage_copy(&stage_owner, &handle, &worker_root)
    })
    .await
    .map_err(|_| "FILE_COPY_WORKER_FAILED")??;
    if let Err(error) = ensure_current(state.inner(), &window, &engine, &request) {
        discard_staged_copy(&staging_root, &staged);
        return Err(error);
    }
    let result = if action == AttachmentFileAction::Preview {
        let current_state = state.inner().clone();
        let current_window = window.clone();
        native_preview(
            &staged,
            &staging_root,
            window
                .state::<Arc<NativeFilePresentations>>()
                .inner()
                .clone(),
            move || ensure_current(&current_state, &current_window, &engine, &request).is_ok(),
        )
    } else {
        window
            .app_handle()
            .opener()
            .open_path(staged.to_string_lossy(), None::<&str>)
            .map_err(|_| "FILE_OPEN_UNAVAILABLE".to_string())
    };
    if result.is_err() {
        discard_staged_copy(&staging_root, &staged);
    }
    Ok(match result {
        Ok(()) => action_result(AttachmentFileActionState::Completed, ""),
        Err(error) => action_result(AttachmentFileActionState::Unavailable, &error),
    })
}

fn ensure_current(
    state: &Arc<AppState>,
    window: &Window,
    expected: &Arc<crate::messaging::MessagingEngine>,
    request: &AttachmentFileActionRequest,
) -> Result<(), String> {
    let (_, _, current) = active_engine(state, window).map_err(|_| "FILE_ACCESS_STALE")?;
    if !Arc::ptr_eq(expected, &current) {
        return Err("FILE_ACCESS_STALE".into());
    }
    current.validate_attachment_handle(
        &file_owner(state, window.label())?,
        &request.access_handle,
        &request.attachment_id,
    )
}

fn file_owner(state: &Arc<AppState>, label: &str) -> Result<String, String> {
    let session = state.sessions.get(label).ok_or("FILE_SCOPE_UNAVAILABLE")?;
    Ok(format!("{label}:{}", session.activation_id))
}

fn action_result(state: AttachmentFileActionState, error_code: &str) -> AppResult<Vec<u8>> {
    AppResult::success(
        AttachmentFileActionResult {
            state: state as i32,
            error_code: error_code.into(),
        }
        .encode_to_vec(),
    )
}

fn discard_staged_copy(root: &std::path::Path, path: &std::path::Path) {
    if let Err(error) =
        messaging_native_filesystem::file_access::AttachmentFileAccess::discard_copy(root, path)
    {
        tracing::warn!(error = %error, "attachment handoff copy cleanup failed");
    }
}

fn native_preview(
    path: &std::path::Path,
    staging_root: &std::path::Path,
    presentations: Arc<NativeFilePresentations>,
    is_current: impl Fn() -> bool + Send + 'static,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut child = std::process::Command::new("/usr/bin/qlmanage")
            .arg("-p")
            .arg(path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|_| "FILE_PREVIEW_UNAVAILABLE".to_string())?;
        let id = ulid::Ulid::new().to_string();
        match presentations.processes.lock() {
            Ok(mut processes) => {
                processes.insert(id.clone(), child);
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("FILE_PREVIEW_UNAVAILABLE".into());
            }
        }
        let copy = path.to_path_buf();
        let root = staging_root.to_path_buf();
        std::thread::spawn(move || {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(300);
            loop {
                let revoked = !is_current() || std::time::Instant::now() >= deadline;
                let finished = match presentations.processes.lock() {
                    Ok(mut processes) => {
                        let finished = match processes.get_mut(&id) {
                            Some(child) => revoked || !matches!(child.try_wait(), Ok(None)),
                            None => true,
                        };
                        if finished {
                            if let Some(mut child) = processes.remove(&id) {
                                let _ = child.kill();
                                let _ = child.wait();
                            }
                        }
                        finished
                    }
                    Err(_) => true,
                };
                if finished {
                    discard_staged_copy(&root, &copy);
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
        });
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (path, staging_root, presentations, is_current);
        Err("FILE_PREVIEW_UNAVAILABLE".into())
    }
}

pub fn asset_response(
    state: &Arc<AppState>,
    owner: &str,
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let result = (|| {
        let session = state.sessions.get(owner).ok_or("FILE_SCOPE_UNAVAILABLE")?;
        if session.jwt.is_empty() {
            return Err("FILE_SCOPE_UNAVAILABLE".to_string());
        }
        let engine = state
            .messaging_engines
            .get(&session.account_id)?
            .ok_or("FILE_SCOPE_UNAVAILABLE")?;
        let owner = format!("{owner}:{}", session.activation_id);
        let handle = request.uri().path().trim_start_matches('/');
        let attachment_id = engine
            .attachment_file_access
            .attachment_id(&owner, handle)?;
        engine.validate_attachment_handle(&owner, handle, &attachment_id)?;
        let head = request.method() == tauri::http::Method::HEAD;
        if !head && request.method() != tauri::http::Method::GET {
            return Err("FILE_METHOD_INVALID".into());
        }
        if let Some(query) = request.uri().query() {
            if query != "representation=preview" {
                return Err("FILE_REPRESENTATION_INVALID".into());
            }
            return engine
                .attachment_file_access
                .read_image_preview(&owner, handle, head);
        }
        engine.attachment_file_access.read_asset(
            &owner,
            handle,
            request
                .headers()
                .get("range")
                .and_then(|value| value.to_str().ok()),
            head,
        )
    })();
    asset_http_response(result, request.method() == tauri::http::Method::HEAD)
}

fn asset_http_response(
    result: Result<messaging_native_filesystem::file_access::AttachmentAsset, String>,
    head: bool,
) -> tauri::http::Response<Vec<u8>> {
    let mut response = tauri::http::Response::builder()
        .header("cache-control", "no-store")
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'; sandbox")
        .header(
            "access-control-expose-headers",
            "content-range, content-length, accept-ranges",
        )
        .header("access-control-allow-origin", "*");
    match result {
        Ok(asset) => {
            response = response
                .status(if asset.partial { 206 } else { 200 })
                .header("content-type", asset.mime_type)
                .header("accept-ranges", "bytes")
                .header(
                    "content-length",
                    if head {
                        asset.total
                    } else {
                        asset.bytes.len() as u64
                    },
                );
            if asset.partial {
                response = response.header(
                    "content-range",
                    format!("bytes {}-{}/{}", asset.start, asset.end, asset.total),
                );
            }
            response.body(asset.bytes).expect("file asset response")
        }
        Err(error) => {
            tracing::debug!(error_code = %error, "attachment asset read rejected");
            response
                .status(if error == "FILE_RANGE_INVALID" {
                    416
                } else {
                    404
                })
                .body(Vec::new())
                .expect("file asset error response")
        }
    }
}

fn now_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}
