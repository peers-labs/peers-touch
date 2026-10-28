//! Native package verification entrypoint; excluded from ordinary release builds.

use sha2::{Digest, Sha256};
use std::time::Duration;
use tauri_plugin_updater::UpdaterExt;

#[tauri::command]
pub async fn acceptance_updater_verify(
    app: tauri::AppHandle,
    endpoint: String,
    expected_version: String,
    install: bool,
) -> crate::error::AppResult<serde_json::Value> {
    let operation = async {
        let endpoint = reqwest::Url::parse(&endpoint)
            .map_err(|_| std::io::Error::other("RD_UPDATER_ENDPOINT_INVALID"))?;
        if endpoint.scheme() != "https" {
            return Err(std::io::Error::other("RD_UPDATER_HTTPS_REQUIRED"));
        }
        // UpdaterExt reads the state created by the actual registered plugin.
        // Only the transport endpoint changes; baked pubkey/signature policy stays.
        let updater = app
            .updater_builder()
            .endpoints(vec![endpoint])
            .map_err(std::io::Error::other)?
            .timeout(Duration::from_secs(180))
            .build()
            .map_err(std::io::Error::other)?;
        let update = updater.check().await.map_err(std::io::Error::other)?;
        let Some(update) = update else {
            return Ok(serde_json::json!({
                "updateAvailable": false,
                "currentVersion": app.package_info().version.to_string(),
            }));
        };
        if update.version != expected_version {
            return Err(std::io::Error::other("RD_UPDATER_VERSION_MISMATCH"));
        }
        let bytes = update
            .download(|_, _| {}, || {})
            .await
            .map_err(std::io::Error::other)?;
        let result = serde_json::json!({
            "updateAvailable": true,
            "currentVersion": app.package_info().version.to_string(),
            "updateVersion": update.version,
            "packageSha256": hex::encode(Sha256::digest(&bytes)),
            "signatureVerified": true,
        });
        if install {
            update.install(bytes).map_err(std::io::Error::other)?;
            app.restart();
        }
        Ok(result)
    };
    match operation.await {
        Ok(value) => crate::error::AppResult::success(value),
        Err(error) => {
            tracing::error!(error = %error, "Native updater verification failed");
            crate::error::AppResult::fail(
                crate::error::ErrorCode::InternalError,
                "RD_UPDATER_VERIFICATION_FAILED",
                None,
            )
        }
    }
}
