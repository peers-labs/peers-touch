use std::fmt;

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

const PLUGIN_IDENTIFIER: &str = "com.peers.touch.mobile.securestorage";

#[derive(Debug)]
pub struct Error {
    operation: &'static str,
    detail: String,
}

impl Error {
    fn invoke(operation: &'static str, error: tauri::plugin::mobile::PluginInvokeError) -> Self {
        Self {
            operation,
            detail: error.to_string(),
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "Android secure storage {} failed: {}",
            self.operation, self.detail
        )
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone)]
pub struct SecureStorage<R: Runtime> {
    plugin_handle: PluginHandle<R>,
}

impl<R: Runtime> SecureStorage<R> {
    pub fn set(&self, key: &str, value: &str) -> Result<()> {
        self.plugin_handle
            .run_mobile_plugin("set", SetRequest { key, value })
            .map_err(|error| Error::invoke("set", error))
    }

    pub fn get(&self, key: &str) -> Result<Option<String>> {
        self.plugin_handle
            .run_mobile_plugin::<GetResponse>("get", KeyRequest { key })
            .map(|response| response.value)
            .map_err(|error| Error::invoke("get", error))
    }

    pub fn remove(&self, key: &str) -> Result<()> {
        self.plugin_handle
            .run_mobile_plugin("remove", KeyRequest { key })
            .map_err(|error| Error::invoke("remove", error))
    }

    pub fn list(&self, prefix: &str) -> Result<Vec<String>> {
        self.plugin_handle
            .run_mobile_plugin::<ListResponse>("list", ListRequest { prefix })
            .map(|response| response.keys)
            .map_err(|error| Error::invoke("list", error))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetRequest<'a> {
    key: &'a str,
    value: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyRequest<'a> {
    key: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListRequest<'a> {
    prefix: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetResponse {
    value: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListResponse {
    keys: Vec<String>,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("peers-secure-storage")
        .setup(|app, api| {
            let plugin_handle =
                api.register_android_plugin(PLUGIN_IDENTIFIER, "SecureStoragePlugin")?;
            app.manage(SecureStorage { plugin_handle });
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugin_errors_name_the_operation_without_secret_material() {
        let error = Error {
            operation: "get",
            detail: "SECURE_STORAGE_CORRUPT".to_string(),
        };

        assert_eq!(
            error.to_string(),
            "Android secure storage get failed: SECURE_STORAGE_CORRUPT"
        );
    }
}
