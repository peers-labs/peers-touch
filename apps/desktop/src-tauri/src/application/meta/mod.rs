//! Client meta module — the single owner of "who this build and runtime is".
//!
//! Build identity is baked at package time (XCFG-D05); runtime values
//! (region/environment overrides) and the persistent device identifier (DID)
//! are resolved here. X Config targeting and debug surfaces must consume this
//! module instead of parsing build environment on their own.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use x_config_core::evaluation::TargetingContext;
use x_config_core::proto::{ClientArchitecture, ClientPlatform};
use x_config_core::{semver::Version, BuildIdentity};

use crate::infrastructure::storage::{StorageKind, StorageLayout};

const DEFAULT_CHANNEL: &str = "stable";
const DEVICE_ID_BYTES: usize = 32;

/// Process-wide meta owner; cheap to clone behind `Arc`.
#[derive(Clone)]
pub struct ClientMeta {
    inner: Arc<MetaInner>,
}

struct MetaInner {
    identity: Option<BuildIdentity>,
    channel: String,
    region: String,
    environment: String,
    device_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientMetaProjection {
    pub packaged: bool,
    pub product: Option<String>,
    pub flavor: Option<String>,
    pub channel: String,
    pub version: Option<String>,
    pub build_number: Option<u64>,
    pub commit: Option<String>,
    pub identifier: Option<String>,
    pub default_region: Option<String>,
    pub region: String,
    pub environment: String,
    pub device_id: String,
    pub labels: BTreeMap<String, String>,
}

impl ClientMeta {
    pub fn new(layout: &StorageLayout) -> Self {
        let identity = match x_config_core::compiled_build_identity!() {
            Some(Ok(identity)) => Some(identity),
            // A malformed baked identity must not brick the process; it
            // surfaces on the debug panel via the x-config error channel.
            Some(Err(_)) | None => None,
        };
        let channel = configured_channel(identity.as_ref().map(|value| value.channel.as_str()));
        let region = resolve_region(identity.as_ref());
        let packaged = identity.is_some();
        let environment = resolve_environment(packaged);
        let device_id = load_or_create_device_id(layout);
        Self {
            inner: Arc::new(MetaInner {
                identity,
                channel,
                region,
                environment,
                device_id,
            }),
        }
    }

    pub fn channel(&self) -> &str {
        &self.inner.channel
    }

    pub fn packaged(&self) -> bool {
        self.inner.identity.is_some()
    }

    pub fn targeting_context(
        &self,
        platform: ClientPlatform,
        architecture: ClientArchitecture,
        package_version: &str,
    ) -> Option<TargetingContext> {
        let inner = &self.inner;
        let identity = inner.identity.as_ref();
        let version = identity
            .map(|value| Version::parse(&value.version))
            .unwrap_or_else(|| Version::parse(package_version))
            .ok()?;
        Some(TargetingContext {
            product: "desktop".to_string(),
            platform,
            architecture,
            flavor: identity
                .map(|value| value.flavor.clone())
                .unwrap_or_else(|| "dev".to_string()),
            channel: inner.channel.clone(),
            environment: inner.environment.clone(),
            region: inner.region.clone(),
            version,
            labels: identity
                .map(|value| value.labels.clone())
                .unwrap_or_default(),
            device_id: inner.device_id.clone(),
        })
    }

    pub fn projection(&self) -> ClientMetaProjection {
        let inner = &self.inner;
        ClientMetaProjection {
            packaged: inner.identity.is_some(),
            product: inner.identity.as_ref().map(|value| value.product.clone()),
            flavor: inner.identity.as_ref().map(|value| value.flavor.clone()),
            channel: inner.channel.clone(),
            version: inner.identity.as_ref().map(|value| value.version.clone()),
            build_number: inner.identity.as_ref().map(|value| value.build_number),
            commit: inner.identity.as_ref().map(|value| value.commit.clone()),
            identifier: inner
                .identity
                .as_ref()
                .map(|value| value.identifier.clone()),
            default_region: inner
                .identity
                .as_ref()
                .map(|value| value.default_region.clone()),
            region: inner.region.clone(),
            environment: inner.environment.clone(),
            device_id: inner.device_id.clone(),
            labels: inner
                .identity
                .as_ref()
                .map(|value| value.labels.clone())
                .unwrap_or_default(),
        }
    }
}

fn configured_channel(baked: Option<&str>) -> String {
    std::env::var("PEERS_X_CONFIG_CHANNEL")
        .ok()
        .or_else(|| option_env!("PEERS_X_CONFIG_CHANNEL").map(str::to_string))
        .or_else(|| baked.map(str::to_string))
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 32
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
        .unwrap_or_else(|| DEFAULT_CHANNEL.to_string())
}

fn resolve_region(identity: Option<&BuildIdentity>) -> String {
    std::env::var("PEERS_REGION")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| identity.map(|value| value.default_region.clone()))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}

fn resolve_environment(packaged: bool) -> String {
    std::env::var("PEERS_DEPLOYMENT_ENVIRONMENT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| if packaged { "prod" } else { "dev" }.to_string())
}

fn device_id_path(layout: &StorageLayout) -> PathBuf {
    let data = layout
        .dirs
        .get(&StorageKind::Data)
        .cloned()
        .unwrap_or_else(|| layout.root.join("data"));
    data.join("meta").join("device-id")
}

fn load_or_create_device_id(layout: &StorageLayout) -> String {
    let path = device_id_path(layout);
    if let Ok(raw) = fs::read_to_string(&path) {
        let trimmed = raw.trim().to_string();
        if is_valid_device_id(&trimmed) {
            return trimmed;
        }
    }
    let generated = generate_device_id();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = crate::infrastructure::storage::write_string_atomic(&path, &generated);
    generated
}

fn generate_device_id() -> String {
    use uuid::Uuid;
    let suffix = Uuid::new_v4().simple().to_string();
    debug_assert_eq!(suffix.len(), DEVICE_ID_BYTES);
    format!("desktop-{suffix}")
}

fn is_valid_device_id(value: &str) -> bool {
    value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}
