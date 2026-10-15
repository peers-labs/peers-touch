use std::sync::OnceLock;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::error::{AppResult, ErrorCode};

static EXECUTABLE_SHA256: OnceLock<Result<String, String>> = OnceLock::new();

pub(crate) fn executable_sha256() -> Result<String, String> {
    EXECUTABLE_SHA256
        .get_or_init(|| {
            let executable = std::env::current_exe()
                .map_err(|error| format!("resolve Desktop executable: {error}"))?;
            let bytes = std::fs::read(executable)
                .map_err(|error| format!("read Desktop executable: {error}"))?;
            Ok(hex::encode(Sha256::digest(bytes)))
        })
        .clone()
}

#[tauri::command]
pub fn acceptance_runtime_source_identity() -> AppResult<Value> {
    match executable_sha256() {
        Ok(digest) => AppResult::success(json!({
            "sourceCommit": env!("PT_BUILD_SOURCE_COMMIT"),
            "processId": std::process::id(),
            "executableSha256": digest,
        })),
        Err(error) => AppResult::fail(ErrorCode::InternalError, &error, None),
    }
}
