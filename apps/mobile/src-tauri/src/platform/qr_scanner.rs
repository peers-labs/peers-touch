//! Native host adapter over the official Tauri CameraX/MLKit and AVFoundation
//! plugin. Its decoded content is consumed in Rust, never sent to the renderer.
use crate::error::{MobileError, MobileResult};
use tauri::{AppHandle, Runtime};
use zeroize::Zeroizing;

#[cfg(mobile)]
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager,
};

#[cfg(mobile)]
pub struct Scanner<R: Runtime>(PluginHandle<R>, std::sync::atomic::AtomicU64);

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_barcode_scanner);

#[cfg(mobile)]
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    // The upstream crate intentionally exposes no Rust scan method. Register
    // its packaged platform implementation once and keep the handle in Rust.
    Builder::new("barcode-scanner")
        .setup(|app, api| {
            let _packaged_implementation = tauri_plugin_barcode_scanner::init::<R>;
            #[cfg(target_os = "android")]
            let handle =
                api.register_android_plugin("app.tauri.barcodescanner", "BarcodeScannerPlugin")?;
            #[cfg(target_os = "ios")]
            let handle = api.register_ios_plugin(init_plugin_barcode_scanner)?;
            app.manage(Scanner(handle, std::sync::atomic::AtomicU64::new(0)));
            Ok(())
        })
        .build()
}

pub async fn scan<R: Runtime>(app: &AppHandle<R>) -> MobileResult<Zeroizing<String>> {
    #[cfg(mobile)]
    {
        #[derive(serde::Deserialize)]
        struct Permission {
            camera: String,
        }
        #[derive(serde::Deserialize)]
        struct Result {
            content: String,
            format: String,
        }
        let scanner = app.state::<Scanner<R>>();
        let epoch = scanner.1.load(std::sync::atomic::Ordering::Acquire);
        let permission: Permission = scanner
            .0
            .run_mobile_plugin_async("requestPermissions", serde_json::json!({}))
            .await
            .map_err(|_| MobileError::permission("deviceLink.cameraUnavailable"))?;
        if permission.camera != "granted" {
            return Err(MobileError::permission("deviceLink.cameraDenied"));
        }
        if scanner.1.load(std::sync::atomic::Ordering::Acquire) != epoch {
            return Err(MobileError::unsupported("deviceLink.scanCancelled"));
        }
        let result = tauri::async_runtime::spawn({
            let app = app.clone();
            async move {
                app.state::<Scanner<R>>().0.run_mobile_plugin_async::<Result>(
                    "scan",
                    serde_json::json!({"formats":["QR_CODE"],"windowed":true,"cameraDirection":"back"}),
                ).await
            }
        });
        // Cancellation is owned by the native lifecycle and command adapter.
        let result = match tokio::time::timeout(std::time::Duration::from_secs(90), result).await {
            Ok(result) => result,
            Err(_) => {
                cancel(app).await?;
                return Err(MobileError::unsupported("deviceLink.scanTimedOut"));
            }
        }
        .map_err(|_| MobileError::unsupported("deviceLink.cameraUnavailable"))?
        .map_err(|_| MobileError::unsupported("deviceLink.scanCancelled"))?;
        if result.format != "QR_CODE" || result.content.len() > schema_core::MAX_LINK_BYTES {
            return Err(MobileError::invalid_input("deviceLink.invalidQr"));
        }
        Ok(Zeroizing::new(result.content))
    }
    #[cfg(not(mobile))]
    {
        let _ = app;
        Err(MobileError::unsupported("deviceLink.nativeCameraRequired"))
    }
}

pub async fn cancel<R: Runtime>(app: &AppHandle<R>) -> MobileResult<()> {
    #[cfg(mobile)]
    {
        app.state::<Scanner<R>>()
            .1
            .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
        let _: serde_json::Value = app
            .state::<Scanner<R>>()
            .0
            .run_mobile_plugin_async("cancel", serde_json::json!({}))
            .await
            .map_err(|_| MobileError::unsupported("deviceLink.cameraStopFailed"))?;
    }
    #[cfg(not(mobile))]
    let _ = app;
    Ok(())
}
