use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use x_config_core::proto::{
    ClientArchitecture, ClientPlatform, EndpointSeedKind, ReleaseDescriptor,
};
use x_config_core::{
    project_suggestions, select_release, AcceptOutcome, XConfigError, Freshness,
    PublisherKeyring, SecureWatermark, SecureWatermarkStore, SnapshotCacheKey, SnapshotCacheStore,
    SnapshotCoordinator, SnapshotOrigin, StationSuggestion, MAX_ENVELOPE_BYTES,
};
use reqwest::blocking::Client;
use reqwest::header::{ETAG, IF_NONE_MATCH};
use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use station_trust::proto::PublicEndpointConnectionMaterial;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Runtime};

use crate::error::{MobileError, MobileResult};
use crate::platform::secure_storage::SecureStorage;

const DEFAULT_CHANNEL: &str = "stable";
const REFRESH_TIMEOUT: Duration = Duration::from_secs(5);
const FOREGROUND_REFRESH_INTERVAL_MS: i64 = 6 * 60 * 60 * 1_000;
const MAX_BACKOFF_MS: i64 = 6 * 60 * 60 * 1_000;
const WATERMARK_KEY_PREFIX: &str = "peers-touch.mobile.x-config.watermark.v1.";
const PUBLISHER_KEYS: &[u8] =
    include_bytes!("../../../../x-config/public-keys/publisher-keys.json");

pub struct MobileXConfigRuntime {
    metadata: Mutex<RefreshMetadata>,
}

impl Default for MobileXConfigRuntime {
    fn default() -> Self {
        let channel = configured_channel();
        let (remote_url, configuration_error) = match configured_remote_url(&channel) {
            Ok(remote_url) => (remote_url, None),
            Err(error) => (None, Some(error.code.to_string())),
        };
        Self {
            metadata: Mutex::new(RefreshMetadata {
                channel,
                remote_url,
                etag: None,
                refreshing: false,
                refresh_failures: 0,
                last_refresh_attempt_at_unix_ms: None,
                next_refresh_at_unix_ms: 0,
                last_refresh_error: configuration_error,
            }),
        }
    }
}

impl MobileXConfigRuntime {
    fn projection<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        storage: &SecureStorage,
    ) -> MobileResult<XConfigProjection> {
        let metadata = self
            .metadata
            .lock()
            .map_err(|_| x_config_error("stateLock"))?;
        let cache_path = snapshot_cache_path(app, &metadata.channel)?;
        let (coordinator, source) =
            load_coordinator(storage, cache_path, &metadata.channel).map_err(map_core_error)?;
        Ok(project_runtime(&metadata, &coordinator, source, unix_ms()))
    }

    fn refresh<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        storage: &SecureStorage,
        force: bool,
    ) -> MobileResult<XConfigProjection> {
        let plan = {
            let mut metadata = self
                .metadata
                .lock()
                .map_err(|_| x_config_error("stateLock"))?;
            let now = unix_ms();
            let Some(url) = metadata.remote_url.clone() else {
                drop(metadata);
                return self.projection(app, storage);
            };
            if metadata.refreshing || (!force && now < metadata.next_refresh_at_unix_ms) {
                drop(metadata);
                return self.projection(app, storage);
            }
            metadata.refreshing = true;
            metadata.last_refresh_attempt_at_unix_ms = Some(now);
            RefreshPlan {
                channel: metadata.channel.clone(),
                url,
                etag: metadata.etag.clone(),
            }
        };

        let now = unix_ms();
        let mut fetched = fetch_snapshot(&plan);
        let cache_path = match snapshot_cache_path(app, &plan.channel) {
            Ok(path) => path,
            Err(error) => {
                self.record_refresh_preparation_failure(now, "cachePath");
                return Err(error);
            }
        };
        let (mut coordinator, mut source) =
            match load_coordinator(storage, cache_path, &plan.channel) {
                Ok(value) => value,
                Err(error) => {
                    self.record_refresh_preparation_failure(now, error.code);
                    return Err(map_core_error(error));
                }
            };
        if matches!(&fetched, Ok(FetchOutcome::NotModified { .. }))
            && coordinator.current().is_none()
        {
            fetched = fetch_snapshot(&RefreshPlan {
                channel: plan.channel.clone(),
                url: plan.url.clone(),
                etag: None,
            });
        }
        let mut metadata = self
            .metadata
            .lock()
            .map_err(|_| x_config_error("stateLock"))?;
        metadata.refreshing = false;
        match fetched {
            Ok(FetchOutcome::NotModified { etag }) => {
                metadata.etag = etag.or(metadata.etag.take());
                metadata.refresh_failures = 0;
                metadata.next_refresh_at_unix_ms =
                    now.saturating_add(FOREGROUND_REFRESH_INTERVAL_MS);
                metadata.last_refresh_error = None;
            }
            Ok(FetchOutcome::Snapshot { bytes, etag }) => {
                match coordinator.accept_remote(&bytes, now) {
                    Ok(AcceptOutcome::Advanced | AcceptOutcome::Unchanged) => {
                        source = Freshness::Current;
                        metadata.etag = etag;
                        metadata.refresh_failures = 0;
                        metadata.next_refresh_at_unix_ms =
                            now.saturating_add(FOREGROUND_REFRESH_INTERVAL_MS);
                        metadata.last_refresh_error = None;
                    }
                    Err(error) => metadata.record_failure(now, error.code),
                }
            }
            Err(error) => metadata.record_failure(now, error.code),
        }
        Ok(project_runtime(&metadata, &coordinator, source, now))
    }

    fn record_refresh_preparation_failure(&self, now: i64, code: &'static str) {
        if let Ok(mut metadata) = self.metadata.lock() {
            metadata.refreshing = false;
            metadata.record_failure(now, code);
        }
    }

    fn suggestion_material<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        storage: &SecureStorage,
        seed_id: &str,
    ) -> MobileResult<PublicEndpointConnectionMaterial> {
        let metadata = self
            .metadata
            .lock()
            .map_err(|_| x_config_error("stateLock"))?;
        let cache_path = snapshot_cache_path(app, &metadata.channel)?;
        let (coordinator, source) =
            load_coordinator(storage, cache_path, &metadata.channel).map_err(map_core_error)?;
        let snapshot = coordinator
            .current()
            .ok_or_else(|| x_config_error("snapshotUnavailable"))?;
        let now = unix_ms();
        let freshness = effective_freshness(snapshot.expires_at_unix_ms, now, source);
        let suggestion = project_suggestions(snapshot, now, freshness)
            .into_iter()
            .find(|suggestion| suggestion.seed_id == seed_id)
            .ok_or_else(|| x_config_error("suggestionNotFound"))?;
        if !suggestion.actionable {
            return Err(x_config_error("suggestionNotActionable"));
        }
        snapshot
            .statement
            .endpoint_seeds
            .iter()
            .find(|seed| seed.seed_id == seed_id)
            .and_then(|seed| seed.connection_material.clone())
            .ok_or_else(|| x_config_error("suggestionNotFound"))
    }
}

#[tauri::command]
pub fn x_config_projection<R: Runtime>(
    app: AppHandle<R>,
) -> MobileResult<XConfigProjection> {
    let storage = app.state::<SecureStorage>();
    let runtime = app.state::<MobileXConfigRuntime>();
    runtime.projection(&app, storage.inner())
}

#[tauri::command]
pub async fn x_config_refresh<R: Runtime>(
    app: AppHandle<R>,
    force: bool,
) -> MobileResult<XConfigProjection> {
    tauri::async_runtime::spawn_blocking(move || {
        let storage = app.state::<SecureStorage>();
        let runtime = app.state::<MobileXConfigRuntime>();
        runtime.refresh(&app, storage.inner(), force)
    })
    .await
    .map_err(|_| x_config_error("refreshTask"))?
}

#[tauri::command]
pub async fn x_config_discover_suggestion<R: Runtime>(
    app: AppHandle<R>,
    seed_id: String,
) -> MobileResult<crate::runtime::station_route::StationEndpointDiscovery> {
    let seed_id = seed_id.trim().to_string();
    if seed_id.is_empty() {
        return Err(x_config_error("seedIdRequired"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let storage = app.state::<SecureStorage>();
        let runtime = app.state::<MobileXConfigRuntime>();
        let material = runtime.suggestion_material(&app, storage.inner(), &seed_id)?;
        crate::runtime::station_route::discover_public_material(&material)
    })
    .await
    .map_err(|_| x_config_error("discoveryTask"))?
}

struct RefreshMetadata {
    channel: String,
    remote_url: Option<String>,
    etag: Option<String>,
    refreshing: bool,
    refresh_failures: u32,
    last_refresh_attempt_at_unix_ms: Option<i64>,
    next_refresh_at_unix_ms: i64,
    last_refresh_error: Option<String>,
}

impl RefreshMetadata {
    fn record_failure(&mut self, now: i64, code: &str) {
        self.refresh_failures = self.refresh_failures.saturating_add(1);
        let exponent = self.refresh_failures.saturating_sub(1).min(8);
        let base = 30_000_i64.saturating_mul(1_i64 << exponent);
        let bounded = base.min(MAX_BACKOFF_MS);
        let jitter = (now.unsigned_abs() % ((bounded / 5).max(1) as u64)) as i64;
        self.next_refresh_at_unix_ms = now.saturating_add(bounded).saturating_add(jitter);
        self.last_refresh_error = Some(code.to_string());
    }
}

struct MobileWatermarkStore<'a> {
    storage: &'a SecureStorage,
    channel: String,
}

impl SecureWatermarkStore for MobileWatermarkStore<'_> {
    fn load(&self, channel: &str) -> Result<Option<SecureWatermark>, XConfigError> {
        if channel != self.channel {
            return Err(XConfigError::new("watermark_channel"));
        }
        let Some(value) = self
            .storage
            .get(&watermark_key(channel))
            .map_err(|_| XConfigError::new("watermark_read"))?
        else {
            return Ok(None);
        };
        let document: WatermarkDocument = serde_json::from_str(&value)
            .map_err(|_| XConfigError::new("watermark_decode"))?;
        document.into_watermark(channel).map(Some)
    }

    fn save(&mut self, watermark: &SecureWatermark) -> Result<(), XConfigError> {
        if watermark.channel != self.channel {
            return Err(XConfigError::new("watermark_channel"));
        }
        let value = serde_json::to_string(&WatermarkDocument::from_watermark(watermark))
            .map_err(|_| XConfigError::new("watermark_encode"))?;
        self.storage
            .set(&watermark_key(&watermark.channel), &value)
            .map_err(|_| XConfigError::new("watermark_write"))
    }
}

struct FileSnapshotCache {
    channel: String,
    directory: PathBuf,
}

impl SnapshotCacheStore for FileSnapshotCache {
    fn load_candidates(
        &self,
        channel: &str,
        committed: Option<&SnapshotCacheKey>,
    ) -> Result<Vec<Vec<u8>>, XConfigError> {
        if channel != self.channel {
            return Err(XConfigError::new("snapshot_cache_channel"));
        }
        let Some(committed) = committed else {
            return Ok(Vec::new());
        };
        let path = self.path_for(committed);
        match fs::metadata(&path) {
            Ok(metadata) if metadata.len() == 0 || metadata.len() > MAX_ENVELOPE_BYTES as u64 => {
                return Ok(Vec::new());
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(_) => return Err(XConfigError::new("snapshot_cache_read")),
        }
        match fs::read(path) {
            Ok(bytes) => Ok(vec![bytes]),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(_) => Err(XConfigError::new("snapshot_cache_read")),
        }
    }

    fn save(
        &mut self,
        channel: &str,
        key: &SnapshotCacheKey,
        envelope_bytes: &[u8],
    ) -> Result<(), XConfigError> {
        if channel != self.channel || key.sequence == 0 {
            return Err(XConfigError::new("snapshot_cache_channel"));
        }
        let path = self.path_for(key);
        match fs::read(&path) {
            Ok(existing) if existing == envelope_bytes => return Ok(()),
            Ok(_) => return Err(XConfigError::new("snapshot_cache_conflict")),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(_) => return Err(XConfigError::new("snapshot_cache_read")),
        }
        atomic_write(&path, envelope_bytes)
            .map_err(|_| XConfigError::new("snapshot_cache_write"))
    }
}

impl FileSnapshotCache {
    fn path_for(&self, key: &SnapshotCacheKey) -> PathBuf {
        self.directory.join(format!(
            "{:020}-{}.pb",
            key.sequence,
            hex::encode(key.generation_sha256),
        ))
    }
}

#[derive(Serialize, Deserialize)]
struct WatermarkDocument {
    schema_version: u32,
    channel: String,
    signing_key_id: String,
    sequence: u64,
    statement_sha256_hex: String,
}

impl WatermarkDocument {
    fn from_watermark(watermark: &SecureWatermark) -> Self {
        Self {
            schema_version: 1,
            channel: watermark.channel.clone(),
            signing_key_id: watermark.signing_key_id.clone(),
            sequence: watermark.sequence,
            statement_sha256_hex: hex::encode(watermark.statement_sha256),
        }
    }

    fn into_watermark(self, expected_channel: &str) -> Result<SecureWatermark, XConfigError> {
        let digest = hex::decode(self.statement_sha256_hex)
            .map_err(|_| XConfigError::new("watermark_decode"))?;
        let statement_sha256: [u8; 32] = digest
            .try_into()
            .map_err(|_| XConfigError::new("watermark_decode"))?;
        if self.schema_version != 1
            || self.channel != expected_channel
            || self.sequence == 0
            || self.signing_key_id.trim().is_empty()
        {
            return Err(XConfigError::new("watermark_decode"));
        }
        Ok(SecureWatermark {
            channel: self.channel,
            signing_key_id: self.signing_key_id,
            sequence: self.sequence,
            statement_sha256,
        })
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XConfigProjection {
    channel: String,
    sequence: Option<u64>,
    expires_at_unix_ms: Option<i64>,
    freshness: &'static str,
    suggestions: Vec<XConfigSuggestionProjection>,
    release: Option<ClientReleaseProjection>,
    refreshing: bool,
    last_refresh_attempt_at_unix_ms: Option<i64>,
    next_refresh_at_unix_ms: Option<i64>,
    last_refresh_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XConfigSuggestionProjection {
    seed_id: String,
    kind: &'static str,
    display_name: String,
    canonical_origin: String,
    regions: Vec<String>,
    freshness: &'static str,
    actionable: bool,
    source_sequence: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientReleaseProjection {
    release_id: String,
    version: String,
    manifest_url: String,
    manifest_sha256_hex: String,
    release_signing_key_id: String,
    release_notes_url: String,
}

struct RefreshPlan {
    channel: String,
    url: String,
    etag: Option<String>,
}

enum FetchOutcome {
    NotModified {
        etag: Option<String>,
    },
    Snapshot {
        bytes: Vec<u8>,
        etag: Option<String>,
    },
}

fn load_coordinator<'a>(
    storage: &'a SecureStorage,
    cache_path: PathBuf,
    channel: &str,
) -> Result<
    (
        SnapshotCoordinator<MobileWatermarkStore<'a>, FileSnapshotCache>,
        Freshness,
    ),
    XConfigError,
> {
    let cache = FileSnapshotCache {
        channel: channel.to_string(),
        directory: cache_path,
    };
    let embedded = embedded_snapshot();
    let keyring = PublisherKeyring::from_json(PUBLISHER_KEYS)?;
    let mut coordinator = SnapshotCoordinator::new(
        channel.to_string(),
        keyring,
        MobileWatermarkStore {
            storage,
            channel: channel.to_string(),
        },
        cache,
    );
    let initialized = coordinator
        .initialize(embedded.as_deref(), unix_ms())?
        .is_some();
    let source = if initialized && coordinator.current_origin() == Some(SnapshotOrigin::Persisted) {
        Freshness::Current
    } else {
        Freshness::Embedded
    };
    Ok((coordinator, source))
}

fn project_runtime(
    metadata: &RefreshMetadata,
    coordinator: &SnapshotCoordinator<MobileWatermarkStore<'_>, FileSnapshotCache>,
    source: Freshness,
    now: i64,
) -> XConfigProjection {
    let Some(snapshot) = coordinator.current() else {
        return XConfigProjection {
            channel: metadata.channel.clone(),
            sequence: None,
            expires_at_unix_ms: None,
            freshness: "unavailable",
            suggestions: Vec::new(),
            release: None,
            refreshing: metadata.refreshing,
            last_refresh_attempt_at_unix_ms: metadata.last_refresh_attempt_at_unix_ms,
            next_refresh_at_unix_ms: optional_positive(metadata.next_refresh_at_unix_ms),
            last_refresh_error: metadata.last_refresh_error.clone(),
        };
    };
    let freshness = effective_freshness(snapshot.expires_at_unix_ms, now, source);
    XConfigProjection {
        channel: metadata.channel.clone(),
        sequence: Some(snapshot.statement.sequence),
        expires_at_unix_ms: Some(snapshot.expires_at_unix_ms),
        freshness: freshness_name(freshness),
        suggestions: project_suggestions(snapshot, now, freshness)
            .into_iter()
            .map(project_suggestion)
            .collect(),
        release: select_release(
            snapshot,
            current_platform(),
            current_architecture(),
            env!("CARGO_PKG_VERSION"),
            now,
        )
        .map(project_release),
        refreshing: metadata.refreshing,
        last_refresh_attempt_at_unix_ms: metadata.last_refresh_attempt_at_unix_ms,
        next_refresh_at_unix_ms: optional_positive(metadata.next_refresh_at_unix_ms),
        last_refresh_error: metadata.last_refresh_error.clone(),
    }
}

fn fetch_snapshot(plan: &RefreshPlan) -> Result<FetchOutcome, XConfigError> {
    let client = Client::builder()
        .timeout(REFRESH_TIMEOUT)
        .redirect(Policy::none())
        .build()
        .map_err(|_| XConfigError::new("x_config_http_client"))?;
    let mut request = client.get(&plan.url);
    if let Some(etag) = plan.etag.as_deref() {
        request = request.header(IF_NONE_MATCH, etag);
    }
    let response = request
        .send()
        .map_err(|_| XConfigError::new("x_config_http_fetch"))?;
    let etag = response
        .headers()
        .get(ETAG)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    if response.status() == reqwest::StatusCode::NOT_MODIFIED {
        return Ok(FetchOutcome::NotModified { etag });
    }
    if !response.status().is_success() {
        return Err(XConfigError::new("x_config_http_status"));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_ENVELOPE_BYTES as u64)
    {
        return Err(XConfigError::new("snapshot_envelope_size"));
    }
    let mut bytes = Vec::new();
    response
        .take((MAX_ENVELOPE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| XConfigError::new("x_config_http_body"))?;
    if bytes.len() > MAX_ENVELOPE_BYTES {
        return Err(XConfigError::new("snapshot_envelope_size"));
    }
    Ok(FetchOutcome::Snapshot { bytes, etag })
}

fn project_suggestion(suggestion: StationSuggestion) -> XConfigSuggestionProjection {
    XConfigSuggestionProjection {
        seed_id: suggestion.seed_id,
        kind: match suggestion.kind {
            EndpointSeedKind::Relay => "relay",
            EndpointSeedKind::DirectStation => "direct_station",
            EndpointSeedKind::Unspecified => "unspecified",
        },
        display_name: suggestion.display_name,
        canonical_origin: suggestion.connection_material.canonical_discovery_origin,
        regions: suggestion.regions,
        freshness: freshness_name(suggestion.freshness),
        actionable: suggestion.actionable,
        source_sequence: suggestion.source_sequence,
    }
}

fn project_release(release: ReleaseDescriptor) -> ClientReleaseProjection {
    ClientReleaseProjection {
        release_id: release.release_id,
        version: release.version,
        manifest_url: release.manifest_url,
        manifest_sha256_hex: hex::encode(release.manifest_sha256),
        release_signing_key_id: release.release_signing_key_id,
        release_notes_url: release.release_notes_url,
    }
}

fn snapshot_cache_path<R: Runtime>(app: &AppHandle<R>, channel: &str) -> MobileResult<PathBuf> {
    app.path()
        .app_cache_dir()
        .map(|path| path.join("x-config").join(channel))
        .map_err(|_| x_config_error("cachePath"))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("storage path has no parent"))?;
    fs::create_dir_all(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
    }
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))?;
    }
    fs::rename(temporary, path)
}

fn configured_channel() -> String {
    std::env::var("PEERS_X_CONFIG_CHANNEL")
        .ok()
        .or_else(|| option_env!("PEERS_X_CONFIG_CHANNEL").map(str::to_string))
        .filter(|value| valid_channel(value))
        .unwrap_or_else(|| DEFAULT_CHANNEL.to_string())
}

fn configured_remote_url(channel: &str) -> Result<Option<String>, XConfigError> {
    let Some(value) = std::env::var("PEERS_X_CONFIG_URL")
        .ok()
        .or_else(|| option_env!("PEERS_X_CONFIG_URL").map(str::to_string))
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(None);
    };
    let mut url = reqwest::Url::parse(value.trim())
        .map_err(|_| XConfigError::new("x_config_url"))?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(XConfigError::new("x_config_url"));
    }
    url.set_path(&format!("/channels/{channel}/latest.pb"));
    Ok(Some(url.to_string()))
}

fn embedded_snapshot() -> Option<Vec<u8>> {
    option_env!("PEERS_X_CONFIG_EMBEDDED_SNAPSHOT_B64")
        .and_then(|value| STANDARD.decode(value.trim()).ok())
        .filter(|bytes| !bytes.is_empty() && bytes.len() <= MAX_ENVELOPE_BYTES)
}

fn current_platform() -> ClientPlatform {
    #[cfg(target_os = "ios")]
    return ClientPlatform::Ios;
    #[cfg(target_os = "android")]
    return ClientPlatform::Android;
    #[allow(unreachable_code)]
    ClientPlatform::Unspecified
}

fn current_architecture() -> ClientArchitecture {
    #[cfg(target_arch = "aarch64")]
    return ClientArchitecture::Arm64;
    #[cfg(target_arch = "x86_64")]
    return ClientArchitecture::X8664;
    #[allow(unreachable_code)]
    ClientArchitecture::Unspecified
}

fn effective_freshness(expires_at_unix_ms: i64, now: i64, source: Freshness) -> Freshness {
    if now >= expires_at_unix_ms {
        Freshness::Stale
    } else {
        source
    }
}

fn freshness_name(freshness: Freshness) -> &'static str {
    match freshness {
        Freshness::Current => "current",
        Freshness::Stale => "stale",
        Freshness::Embedded => "embedded",
    }
}

fn watermark_key(channel: &str) -> String {
    format!("{WATERMARK_KEY_PREFIX}{channel}")
}

fn valid_channel(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && value.bytes().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == b'-'
        })
}

fn optional_positive(value: i64) -> Option<i64> {
    (value > 0).then_some(value)
}

fn map_core_error(error: XConfigError) -> MobileError {
    x_config_error(error.code)
}

fn x_config_error(code: impl Into<String>) -> MobileError {
    MobileError::x_config(code)
}

fn unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_url_is_https_and_channel_scoped() {
        std::env::set_var(
            "PEERS_X_CONFIG_URL",
            "https://distribution.example/base",
        );
        assert_eq!(
            configured_remote_url("stable").unwrap().as_deref(),
            Some("https://distribution.example/channels/stable/latest.pb")
        );
        std::env::set_var(
            "PEERS_X_CONFIG_URL",
            "http://distribution.example",
        );
        assert!(configured_remote_url("stable").is_err());
        std::env::remove_var("PEERS_X_CONFIG_URL");
    }

    #[test]
    fn release_projection_is_metadata_only() {
        let fields = serde_json::to_value(ClientReleaseProjection {
            release_id: "mobile-ios-arm64-2.0.0".to_string(),
            version: "2.0.0".to_string(),
            manifest_url: "https://releases.example/manifest".to_string(),
            manifest_sha256_hex: "00".repeat(32),
            release_signing_key_id: "release-1".to_string(),
            release_notes_url: "https://releases.example/notes".to_string(),
        })
        .unwrap();
        assert!(fields.get("install").is_none());
        assert!(fields.get("execute").is_none());
    }
}
