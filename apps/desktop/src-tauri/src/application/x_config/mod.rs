mod persistence;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use x_config_core::evaluation::EvaluatedValue;
use x_config_core::proto::{
    ClientArchitecture, ClientPlatform, EndpointSeedKind, ReleaseDescriptor,
};
use x_config_core::{
    effective_origins, evaluate_directives, fetch_with_failover, project_suggestions,
    select_release, snapshot_url, FailoverSuccess, Freshness, PublisherKeyring,
    SnapshotCoordinator, SnapshotFetch, SnapshotOrigin, StationSuggestion, TargetingContext,
    XConfigError, MAX_ENVELOPE_BYTES,
};

use crate::application::meta::ClientMeta;
use reqwest::blocking::Client;
use reqwest::header::{ETAG, IF_NONE_MATCH};
use reqwest::redirect::Policy;
use serde::Serialize;
use station_trust::proto::PublicEndpointConnectionMaterial;
use std::io::Read;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::infrastructure::storage::{StorageKind, StorageLayout};
use persistence::{DesktopWatermarkStore, FileSnapshotCache};

const REFRESH_TIMEOUT: Duration = Duration::from_secs(5);
const FOREGROUND_REFRESH_INTERVAL_MS: i64 = 6 * 60 * 60 * 1_000;
const MAX_BACKOFF_MS: i64 = 6 * 60 * 60 * 1_000;
const PUBLISHER_KEYS: &[u8] =
    include_bytes!("../../../../../x-config/public-keys/publisher-keys.json");

pub struct XConfigRuntime {
    state: Mutex<RuntimeState>,
}

impl XConfigRuntime {
    pub fn new(layout: &StorageLayout, meta: ClientMeta) -> Self {
        Self {
            state: Mutex::new(RuntimeState::new(layout, meta)),
        }
    }

    pub fn projection(&self) -> Result<XConfigProjection, XConfigError> {
        let state = self
            .state
            .lock()
            .map_err(|_| XConfigError::new("x_config_state_lock"))?;
        Ok(state.projection(unix_ms()))
    }

    pub fn refresh(&self, force: bool) -> Result<XConfigProjection, XConfigError> {
        let plan = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| XConfigError::new("x_config_state_lock"))?;
            let now = unix_ms();
            if state.refreshing || (!force && now < state.next_refresh_at_unix_ms) {
                return Ok(state.projection(now));
            }
            let targets = state.refresh_targets();
            if targets.is_empty() {
                return Ok(state.projection(now));
            }
            state.refreshing = true;
            state.last_refresh_attempt_at_unix_ms = Some(now);
            RefreshPlan {
                targets,
                etag: state.etag.clone(),
                has_current: state
                    .coordinator
                    .as_ref()
                    .is_some_and(|coordinator| coordinator.current().is_some()),
            }
        };

        let outcome = fetch_with_failover(
            &plan.urls(),
            plan.etag.as_deref(),
            plan.has_current,
            |url, etag| fetch_snapshot(url, etag),
            |bytes| {
                let mut state = self
                    .state
                    .lock()
                    .map_err(|_| XConfigError::new("x_config_state_lock"))?;
                let coordinator = state
                    .coordinator
                    .as_mut()
                    .ok_or_else(|| XConfigError::new("x_config_unavailable"))?;
                coordinator.accept_remote(bytes, unix_ms())
            },
        );

        let mut state = self
            .state
            .lock()
            .map_err(|_| XConfigError::new("x_config_state_lock"))?;
        let now = unix_ms();
        state.refreshing = false;
        match outcome {
            Ok(FailoverSuccess::NotModified { origin_index, etag }) => {
                state.active_origin = plan.origin_at(origin_index);
                state.etag = etag.or(state.etag.take());
                state.mark_success(now);
            }
            Ok(FailoverSuccess::Accepted { origin_index, etag }) => {
                state.active_origin = plan.origin_at(origin_index);
                state.source = Freshness::Current;
                state.etag = etag;
                state.mark_success(now);
            }
            Err(error) => state.record_failure(now, error.code),
        }
        Ok(state.projection(now))
    }

    pub fn suggestion_material(
        &self,
        seed_id: &str,
    ) -> Result<PublicEndpointConnectionMaterial, XConfigError> {
        let state = self
            .state
            .lock()
            .map_err(|_| XConfigError::new("x_config_state_lock"))?;
        let now = unix_ms();
        let snapshot = state
            .coordinator
            .as_ref()
            .and_then(SnapshotCoordinator::current)
            .ok_or_else(|| XConfigError::new("x_config_snapshot_unavailable"))?;
        let freshness = effective_freshness(snapshot.expires_at_unix_ms, now, state.source);
        let suggestion = project_suggestions(snapshot, now, freshness)
            .into_iter()
            .find(|suggestion| suggestion.seed_id == seed_id)
            .ok_or_else(|| XConfigError::new("x_config_suggestion_not_found"))?;
        if !suggestion.actionable {
            return Err(XConfigError::new(
                "x_config_suggestion_not_actionable",
            ));
        }
        snapshot
            .statement
            .endpoint_seeds
            .iter()
            .find(|seed| seed.seed_id == seed_id)
            .and_then(|seed| seed.connection_material.clone())
            .ok_or_else(|| XConfigError::new("x_config_suggestion_not_found"))
    }
}

struct RuntimeState {
    channel: String,
    meta: ClientMeta,
    coordinator: Option<SnapshotCoordinator<DesktopWatermarkStore, FileSnapshotCache>>,
    source: Freshness,
    /// Development override (`PEERS_X_CONFIG_URL`); always tried first.
    override_origin: Option<String>,
    /// Package-time anchors baked from the channel registry (XCFG-D06).
    baked_origins: Vec<String>,
    /// Origin that served the last successful refresh, for diagnostics.
    active_origin: Option<String>,
    etag: Option<String>,
    refreshing: bool,
    refresh_failures: u32,
    last_refresh_attempt_at_unix_ms: Option<i64>,
    next_refresh_at_unix_ms: i64,
    last_refresh_error: Option<String>,
}

impl RuntimeState {
    fn new(layout: &StorageLayout, meta: ClientMeta) -> Self {
        let channel = meta.channel().to_string();
        let (override_origin, mut configuration_error) = match configured_override_origin() {
            Ok(origin) => (origin, None),
            Err(error) => (None, Some(error.code.to_string())),
        };
        let baked_origins = match x_config_core::compiled_build_identity!() {
            Some(Ok(identity)) => identity.x_config_origins,
            Some(Err(error)) => {
                configuration_error = configuration_error.or(Some(error.code.to_string()));
                Vec::new()
            }
            None => Vec::new(),
        };
        let cache_dir = layout
            .dirs
            .get(&StorageKind::Cache)
            .cloned()
            .unwrap_or_else(|| layout.root.join("cache"))
            .join("x-config");
        let secure_store_dir = layout
            .dirs
            .get(&StorageKind::Data)
            .cloned()
            .unwrap_or_else(|| layout.root.join("data"))
            .join("secure-store")
            .join("x-config");
        let cache = FileSnapshotCache::new(cache_dir, &channel);
        let embedded = embedded_snapshot();
        let coordinator = PublisherKeyring::from_json(PUBLISHER_KEYS)
            .map(|keyring| {
                SnapshotCoordinator::new(
                    channel.clone(),
                    keyring,
                    DesktopWatermarkStore::new(&channel, secure_store_dir),
                    cache,
                )
            })
            .ok();
        let mut state = Self {
            channel,
            meta,
            coordinator,
            source: Freshness::Embedded,
            override_origin,
            baked_origins,
            active_origin: None,
            etag: None,
            refreshing: false,
            refresh_failures: 0,
            last_refresh_attempt_at_unix_ms: None,
            next_refresh_at_unix_ms: 0,
            last_refresh_error: configuration_error,
        };
        if let Some(coordinator) = state.coordinator.as_mut() {
            match coordinator.initialize(embedded.as_deref(), unix_ms()) {
                Ok(Some(_)) => {
                    state.source =
                        if coordinator.current_origin() == Some(SnapshotOrigin::Persisted) {
                            Freshness::Current
                        } else {
                            Freshness::Embedded
                        };
                }
                Ok(None) => {}
                Err(error) => state.last_refresh_error = Some(error.code.to_string()),
            }
        } else {
            state.last_refresh_error = Some("publisher_keyring".to_string());
        }
        state
    }

    fn projection(&self, now: i64) -> XConfigProjection {
        let Some(snapshot) = self
            .coordinator
            .as_ref()
            .and_then(SnapshotCoordinator::current)
        else {
            return XConfigProjection {
                channel: self.channel.clone(),
                sequence: None,
                expires_at_unix_ms: None,
                freshness: "unavailable",
                suggestions: Vec::new(),
                release: None,
                defaults: ResolvedDefaults::default(),
                refreshing: self.refreshing,
                active_origin: self.active_origin.clone(),
                last_refresh_attempt_at_unix_ms: self.last_refresh_attempt_at_unix_ms,
                next_refresh_at_unix_ms: optional_positive(self.next_refresh_at_unix_ms),
                last_refresh_error: self.last_refresh_error.clone(),
            };
        };
        let freshness = effective_freshness(snapshot.expires_at_unix_ms, now, self.source);
        let station_suggestions = project_suggestions(snapshot, now, freshness);
        let defaults = self.resolved_defaults(snapshot, &station_suggestions);
        XConfigProjection {
            channel: self.channel.clone(),
            sequence: Some(snapshot.statement.sequence),
            expires_at_unix_ms: Some(snapshot.expires_at_unix_ms),
            freshness: freshness_name(freshness),
            suggestions: station_suggestions
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
            defaults,
            refreshing: self.refreshing,
            active_origin: self.active_origin.clone(),
            last_refresh_attempt_at_unix_ms: self.last_refresh_attempt_at_unix_ms,
            next_refresh_at_unix_ms: optional_positive(self.next_refresh_at_unix_ms),
            last_refresh_error: self.last_refresh_error.clone(),
        }
    }

    fn targeting_context(&self) -> Option<TargetingContext> {
        self.meta.targeting_context(
            current_platform(),
            current_architecture(),
            env!("CARGO_PKG_VERSION"),
        )
    }

    fn resolved_defaults(
        &self,
        snapshot: &x_config_core::VerifiedSnapshot,
        suggestions: &[StationSuggestion],
    ) -> ResolvedDefaults {
        let Some(context) = self.targeting_context() else {
            return ResolvedDefaults::default();
        };
        let mut defaults = ResolvedDefaults::default();
        for resolved in evaluate_directives(&snapshot.statement.directives, &context) {
            let EvaluatedValue::EndpointSeedId(seed_id) = &resolved.value else {
                continue;
            };
            let Some(suggestion) = suggestions
                .iter()
                .find(|candidate| &candidate.seed_id == seed_id)
            else {
                continue;
            };
            let projected = ResolvedEndpointDefault {
                seed_id: suggestion.seed_id.clone(),
                display_name: suggestion.display_name.clone(),
                canonical_origin: suggestion.connection_material.canonical_discovery_origin.clone(),
                matched_rule_id: resolved.matched_rule_id,
                actionable: suggestion.actionable,
            };
            match resolved.key.as_str() {
                "network.default_relay" => defaults.default_relay = Some(projected),
                "network.default_station" => defaults.default_station = Some(projected),
                _ => {}
            }
        }
        defaults
    }

    fn record_failure(&mut self, now: i64, code: &str) {
        self.refresh_failures = self.refresh_failures.saturating_add(1);
        let exponent = self.refresh_failures.saturating_sub(1).min(8);
        let base = 30_000_i64.saturating_mul(1_i64 << exponent);
        let bounded = base.min(MAX_BACKOFF_MS);
        let jitter = (now.unsigned_abs() % ((bounded / 5).max(1) as u64)) as i64;
        self.next_refresh_at_unix_ms = now.saturating_add(bounded).saturating_add(jitter);
        self.last_refresh_error = Some(code.to_string());
    }

    fn mark_success(&mut self, now: i64) {
        self.refresh_failures = 0;
        self.next_refresh_at_unix_ms = now.saturating_add(FOREGROUND_REFRESH_INTERVAL_MS);
        self.last_refresh_error = None;
    }

    /// Origins advertised by the last signed, accepted snapshot (XCFG-D06).
    /// Persistence is the signed snapshot cache itself, so no extra store.
    fn advertised_origins(&self) -> Vec<String> {
        self.coordinator
            .as_ref()
            .and_then(SnapshotCoordinator::current)
            .and_then(|snapshot| snapshot.statement.distribution.as_ref())
            .map(|distribution| {
                distribution
                    .origins
                    .iter()
                    .map(|entry| entry.origin.clone())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Ordered, admitted fetch targets: override, advertised, baked anchors.
    fn refresh_targets(&self) -> Vec<RefreshTarget> {
        effective_origins(
            self.override_origin.as_deref(),
            &self.advertised_origins(),
            &self.baked_origins,
        )
        .into_iter()
        .filter_map(|origin| {
            snapshot_url(&origin, &self.channel).map(|url| RefreshTarget {
                origin,
                url: url.to_string(),
            })
        })
        .collect()
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct XConfigProjection {
    pub channel: String,
    pub sequence: Option<u64>,
    pub expires_at_unix_ms: Option<i64>,
    pub freshness: &'static str,
    pub suggestions: Vec<XConfigSuggestionProjection>,
    pub release: Option<ClientReleaseProjection>,
    pub defaults: ResolvedDefaults,
    pub refreshing: bool,
    /// Base origin that served the last accepted snapshot / 304 (XCFG-D06).
    pub active_origin: Option<String>,
    pub last_refresh_attempt_at_unix_ms: Option<i64>,
    pub next_refresh_at_unix_ms: Option<i64>,
    pub last_refresh_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct XConfigSuggestionProjection {
    pub seed_id: String,
    pub kind: &'static str,
    pub display_name: String,
    pub canonical_origin: String,
    pub regions: Vec<String>,
    pub freshness: &'static str,
    pub actionable: bool,
    pub source_sequence: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct ClientReleaseProjection {
    pub release_id: String,
    pub version: String,
    pub manifest_url: String,
    pub manifest_sha256_hex: String,
    pub release_signing_key_id: String,
    pub release_notes_url: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ResolvedEndpointDefault {
    pub seed_id: String,
    pub display_name: String,
    pub canonical_origin: String,
    pub matched_rule_id: Option<String>,
    pub actionable: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct ResolvedDefaults {
    pub default_relay: Option<ResolvedEndpointDefault>,
    pub default_station: Option<ResolvedEndpointDefault>,
}

struct RefreshTarget {
    /// Bare admitted base origin, mirrored into the projection on success.
    origin: String,
    /// Channel-scoped snapshot URL fetched from that origin.
    url: String,
}

struct RefreshPlan {
    targets: Vec<RefreshTarget>,
    etag: Option<String>,
    has_current: bool,
}

impl RefreshPlan {
    fn urls(&self) -> Vec<String> {
        self.targets
            .iter()
            .map(|target| target.url.clone())
            .collect()
    }

    fn origin_at(&self, index: usize) -> Option<String> {
        self.targets.get(index).map(|target| target.origin.clone())
    }
}

fn fetch_snapshot(url: &str, etag: Option<&str>) -> Result<SnapshotFetch, XConfigError> {
    let client = Client::builder()
        .use_rustls_tls()
        .timeout(REFRESH_TIMEOUT)
        .redirect(Policy::none())
        .build()
        .map_err(|_| XConfigError::new("x_config_http_client"))?;
    let mut request = client.get(url);
    if let Some(etag) = etag {
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
        return Ok(SnapshotFetch::NotModified { etag });
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
    Ok(SnapshotFetch::Envelope { bytes, etag })
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

/// Development override origin (XCFG-D06). Must be a bare base URL; channel
/// scoping happens per fetch target through `snapshot_url`.
fn configured_override_origin() -> Result<Option<String>, XConfigError> {
    let Some(value) = std::env::var("PEERS_X_CONFIG_URL")
        .ok()
        .or_else(|| option_env!("PEERS_X_CONFIG_URL").map(str::to_string))
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(None);
    };
    let trimmed = value.trim();
    let parsed = reqwest::Url::parse(trimmed).map_err(|_| XConfigError::new("x_config_url"))?;
    if !x_config_core::origin::valid_snapshot_origin(&parsed) || parsed.path() != "/" {
        return Err(XConfigError::new("x_config_url"));
    }
    Ok(Some(
        trimmed.strip_suffix('/').unwrap_or(trimmed).to_string(),
    ))
}

fn embedded_snapshot() -> Option<Vec<u8>> {
    option_env!("PEERS_X_CONFIG_EMBEDDED_SNAPSHOT_B64")
        .and_then(|value| STANDARD.decode(value.trim()).ok())
        .filter(|bytes| !bytes.is_empty() && bytes.len() <= MAX_ENVELOPE_BYTES)
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

fn current_platform() -> ClientPlatform {
    #[cfg(target_os = "macos")]
    return ClientPlatform::Macos;
    #[cfg(target_os = "windows")]
    return ClientPlatform::Windows;
    #[cfg(target_os = "linux")]
    return ClientPlatform::Linux;
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

fn optional_positive(value: i64) -> Option<i64> {
    (value > 0).then_some(value)
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
    fn override_origin_must_be_a_bare_admitted_base_url() {
        let _guard = crate::infrastructure::storage::test_storage_env_lock();
        std::env::set_var("PEERS_X_CONFIG_URL", "https://distribution.example/");
        assert_eq!(
            configured_override_origin().unwrap().as_deref(),
            Some("https://distribution.example")
        );
        std::env::set_var("PEERS_X_CONFIG_URL", "http://distribution.example");
        assert!(configured_override_origin().is_err());
        std::env::set_var("PEERS_X_CONFIG_URL", "https://distribution.example/base");
        assert!(configured_override_origin().is_err());
        std::env::set_var("PEERS_X_CONFIG_URL", "http://10.0.0.5:18082");
        assert_eq!(
            configured_override_origin().unwrap().as_deref(),
            Some("http://10.0.0.5:18082")
        );
        std::env::remove_var("PEERS_X_CONFIG_URL");
    }

    #[test]
    fn refresh_targets_compose_override_advertised_and_baked_origins() {
        let targets: Vec<String> = effective_origins(
            Some("http://127.0.0.1:18082"),
            &["https://mirror.example.test".to_string()],
            &["http://10.37.221.38:18082".to_string()],
        )
        .into_iter()
        .filter_map(|origin| snapshot_url(&origin, "corpstable").map(|url| url.to_string()))
        .collect();
        assert_eq!(
            targets,
            vec![
                "http://127.0.0.1:18082/channels/corpstable/latest.pb",
                "https://mirror.example.test/channels/corpstable/latest.pb",
                "http://10.37.221.38:18082/channels/corpstable/latest.pb",
            ]
        );
    }

    #[test]
    fn platform_projection_never_executes_release_metadata() {
        assert!(matches!(
            current_platform(),
            ClientPlatform::Macos | ClientPlatform::Windows | ClientPlatform::Linux
        ));
        assert!(matches!(
            current_architecture(),
            ClientArchitecture::Arm64 | ClientArchitecture::X8664 | ClientArchitecture::Unspecified
        ));
    }
}
