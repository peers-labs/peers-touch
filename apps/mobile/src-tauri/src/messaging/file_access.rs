use super::lifecycle::MobileMessagingRuntime;
use crate::error::{MobileError, MobileResult};
use messaging_core::proto::chat::{
    AttachmentAccessState, AttachmentFileAction, AttachmentFileActionRequest,
    AttachmentFileActionResult, AttachmentFileActionState,
};
use prost::Message;
use serde::Deserialize;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime, State, Webview};
use tauri_plugin_peers_platform_permissions::{
    NativeFileActionRequest, NativeSystemActionState, PlatformPermissions,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentAccessInput {
    station_peer_id: String,
    actor_ptid: String,
    attachment_id: String,
    #[serde(default)]
    start_download: bool,
    #[serde(default)]
    retry: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentHandleInput {
    station_peer_id: String,
    actor_ptid: String,
    access_handle: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentActionInput {
    station_peer_id: String,
    actor_ptid: String,
    request_bytes: Vec<u8>,
}

#[tauri::command]
pub async fn messaging_attachment_access<R: Runtime>(
    runtime: State<'_, MobileMessagingRuntime>,
    webview: Webview<R>,
    input: AttachmentAccessInput,
) -> MobileResult<Vec<u8>> {
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    let (current, owner) = runtime.file_access_scope(webview.label())?;
    if !Arc::ptr_eq(&engine, &current) {
        return Err(MobileError::messaging("FILE_ACCESS_STALE"));
    }
    let expected_engine = engine.clone();
    let expected_owner = owner.clone();
    let epoch = engine.attachment_file_access.epoch();
    let station = input.station_peer_id.clone();
    let actor = input.actor_ptid.clone();
    let projection = tauri::async_runtime::spawn_blocking(move || {
        engine.attachment_access(
            &owner,
            &input.attachment_id,
            input.start_download,
            input.retry,
        )
    })
    .await
    .map_err(|_| MobileError::messaging("FILE_ACCESS_WORKER_FAILED"))?
    .map_err(MobileError::messaging)?;
    if !expected_engine.attachment_file_access.epoch_is_current(epoch)
        || !runtime.file_access_scope(webview.label()).is_ok_and(|(current, owner)| {
            Arc::ptr_eq(&expected_engine, &current) && owner == expected_owner
        })
    {
        expected_engine.attachment_file_access.release(
            &expected_owner, &projection.access_handle,
        );
        return Err(MobileError::messaging("FILE_ACCESS_STALE"));
    }
    if projection.state == AttachmentAccessState::Downloading as i32 {
        runtime.request_reconcile(&station, &actor)?;
    }
    Ok(projection.encode_to_vec())
}

#[tauri::command]
pub async fn messaging_release_attachment<R: Runtime>(
    app: AppHandle<R>,
    runtime: State<'_, MobileMessagingRuntime>,
    webview: Webview<R>,
    input: AttachmentHandleInput,
) -> MobileResult<()> {
    // A revoked Engine must not prevent its native callback from being fenced.
    app.state::<PlatformPermissions<R>>()
        .cancel_file_action(&input.access_handle)
        .await
        .map_err(|_| MobileError::messaging("FILE_CANCELLATION_FAILED"))?;
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    let (_, owner) = runtime.file_release_scope(webview.label())?;
    engine
        .attachment_file_access
        .release(&owner, &input.access_handle);
    Ok(())
}

#[tauri::command]
pub async fn messaging_attachment_file_action<R: Runtime>(
    app: AppHandle<R>,
    runtime: State<'_, MobileMessagingRuntime>,
    webview: Webview<R>,
    input: AttachmentActionInput,
) -> MobileResult<Vec<u8>> {
    // Issuance precedes authorization and cannot advance past cancel-all.
    let deadline_ms = now_unix_ms().saturating_add(300_000);
    let request = AttachmentFileActionRequest::decode(input.request_bytes.as_slice())
        .map_err(|_| MobileError::messaging("FILE_ACTION_INVALID"))?;
    let action = AttachmentFileAction::try_from(request.action)
        .map_err(|_| MobileError::messaging("FILE_ACTION_INVALID"))?;
    let kind = match action {
        AttachmentFileAction::Preview => "preview",
        AttachmentFileAction::OpenExternal => "open_external",
        AttachmentFileAction::SaveCopy => "save_copy",
        AttachmentFileAction::Unspecified => {
            return Err(MobileError::messaging("FILE_ACTION_INVALID"))
        }
    };
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    let (_, owner) = runtime.file_access_scope(webview.label())?;
    engine
        .validate_attachment_handle(&owner, &request.access_handle, &request.attachment_id)
        .map_err(MobileError::messaging)?;
    let staging_root = app
        .path()
        .app_cache_dir()
        .map_err(|_| MobileError::messaging("FILE_STAGING_UNAVAILABLE"))?
        .join("peers-touch-file-handoff");
    let stage_engine = engine.clone();
    let stage_owner = owner.clone();
    let handle = request.access_handle.clone();
    let attachment_id = request.attachment_id.clone();
    let worker_root = staging_root.clone();
    let (staged, mime_type) = tauri::async_runtime::spawn_blocking(move || {
        let metadata = stage_engine.attachment_metadata(&attachment_id)?;
        let staged =
            stage_engine
                .attachment_file_access
                .stage_copy(&stage_owner, &handle, &worker_root)?;
        Ok::<_, String>((staged, metadata.mime_type))
    })
    .await
    .map_err(|_| MobileError::messaging("FILE_COPY_WORKER_FAILED"))?
    .map_err(MobileError::messaging)?;
    let validation = (|| {
        let current = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
        if !Arc::ptr_eq(&engine, &current) {
            return Err(MobileError::messaging("FILE_ACCESS_STALE"));
        }
        current
            .validate_attachment_handle(&owner, &request.access_handle, &request.attachment_id)
            .map_err(MobileError::messaging)
    })();
    if let Err(error) = validation {
        discard_staged_copy(&staging_root, &staged);
        return Err(error);
    }
    let outcome = app
        .state::<PlatformPermissions<R>>()
        .execute_file_action(NativeFileActionRequest {
            request_id: &request.access_handle,
            kind,
            local_path: staged
                .to_str()
                .ok_or_else(|| MobileError::messaging("FILE_NAME_INVALID"))?,
            mime_type: &mime_type,
            deadline_ms,
        })
        .await;
    let outcome = match outcome {
        Ok(outcome) => outcome,
        Err(_) => {
            discard_staged_copy(&staging_root, &staged);
            return Err(MobileError::messaging("FILE_PLATFORM_ACTION_FAILED"));
        }
    };
    if action != AttachmentFileAction::OpenExternal
        || outcome.state != NativeSystemActionState::Completed
    {
        discard_staged_copy(&staging_root, &staged);
    }
    if outcome.request_id != request.access_handle {
        return Err(MobileError::messaging("FILE_CALLBACK_STALE"));
    }
    Ok(AttachmentFileActionResult {
        state: match outcome.state {
            NativeSystemActionState::Completed => AttachmentFileActionState::Completed,
            NativeSystemActionState::Cancelled => AttachmentFileActionState::Cancelled,
            NativeSystemActionState::Unavailable => AttachmentFileActionState::Unavailable,
            NativeSystemActionState::Failed => AttachmentFileActionState::Failed,
        } as i32,
        error_code: outcome.reason.unwrap_or_default(),
    }
    .encode_to_vec())
}

fn discard_staged_copy(root: &std::path::Path, copy: &std::path::Path) {
    if let Err(error) =
        messaging_native_filesystem::file_access::AttachmentFileAccess::discard_copy(root, copy)
    {
        log::warn!("attachment handoff copy cleanup failed: {error}");
    }
}

pub fn asset_response(
    runtime: &MobileMessagingRuntime,
    owner: &str,
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let head = request.method() == tauri::http::Method::HEAD;
    let result = (|| {
        if !head && request.method() != tauri::http::Method::GET {
            return Err("FILE_METHOD_INVALID".to_string());
        }
        let (engine, owner) = runtime
            .file_access_scope(owner)
            .map_err(|_| "FILE_SCOPE_UNAVAILABLE")?;
        let handle = request.uri().path().trim_start_matches('/');
        let attachment_id = engine
            .attachment_file_access
            .attachment_id(&owner, handle)?;
        engine.validate_attachment_handle(&owner, handle, &attachment_id)?;
        if let Some(query) = request.uri().query() {
            if query != "representation=preview" {
                return Err("FILE_REPRESENTATION_INVALID".into());
            }
            return engine.attachment_file_access.read_image_preview(&owner, handle, head);
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
    let mut response = tauri::http::Response::builder()
        .header("cache-control", "no-store")
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'; sandbox")
        .header("access-control-expose-headers", "content-range, content-length, accept-ranges")
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
        Err(error) => response
            .status(if error == "FILE_RANGE_INVALID" {
                416
            } else {
                404
            })
            .body(Vec::new())
            .expect("file asset error response"),
    }
}

fn now_unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}
