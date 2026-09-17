mod trusted_catalog;

use crate::application::skills::{SKILL_DELETE_PATH, SKILL_INSTALL_PATH, SKILL_LIST_PATH};
use crate::application::{agents, mcp, plugins};
use crate::contracts::{
    AgentIdInput, McpCreateInput, McpNameInput, SkillImportAddressInput, SkillImportGitHubInput,
    SkillImportZipInput, SkillMarketAddInput, SkillMarketDetailInput, SkillMarketIdInput,
    SkillMarketListInput, SkillMarketSyncInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::infrastructure::storage::{self, StorageKind};
use crate::model;
use base64::prelude::*;
use prost::Message;
use reqwest::blocking::Client;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Cursor, Read};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use trusted_catalog::{
    default_catalog, default_envelope_json, default_source, github_raw_manifest_url,
    public_key_fingerprint, verify_catalog, CatalogPackage, CatalogSourceRegistration,
    VerifiedCatalog, DEFAULT_SOURCE_ID, INSTALL_ALLOWED, INSTALL_BLOCKED,
    INSTALL_CONFIRMATION_REQUIRED, TRANSPORT_OFFICIAL_STATION, TRANSPORT_USER_PINNED_GITHUB,
};

const OFFICIAL_CATALOG_ENDPOINT: &str = "/sub-agent/agent/package-catalog/official";
const OFFICIAL_CATALOG_DISTRIBUTION_ID: &str = "peers-official-station-v1";
const CATALOG_SYNC_BOOTSTRAP_VERIFIED: &str = "bootstrap_verified";
const CATALOG_SYNC_FRESH_VERIFIED: &str = "fresh_verified";
const CATALOG_SYNC_STALE_VERIFIED: &str = "stale_verified";
const CATALOG_SYNC_INVALID_REJECTED: &str = "invalid_rejected";

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn invalid_argument(message: &str) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InvalidArgument, message, None)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct MarketSource {
    id: String,
    name: String,
    #[serde(default = "default_user_pinned_transport")]
    transport_kind: String,
    url: String,
    #[serde(default)]
    branch: Option<String>,
    #[serde(default)]
    manifest_path: String,
    #[serde(default)]
    publisher_id: String,
    #[serde(default)]
    signing_key_id: String,
    #[serde(default)]
    public_key_base64: String,
    #[serde(default)]
    public_key_fingerprint: String,
    #[serde(default)]
    trust_class: String,
    #[serde(default)]
    built_in: bool,
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default, alias = "skills")]
    skills: Vec<MarketSkill>,
    #[serde(default)]
    catalog_revision: String,
    #[serde(default)]
    generated_at: String,
    #[serde(default)]
    signature_status: String,
    #[serde(default)]
    source_revoked_at: Option<String>,
    #[serde(default)]
    verified_envelope: Option<String>,
    #[serde(default = "default_stale_verified_state")]
    sync_state: String,
    #[serde(default)]
    last_synced: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct MarketSkill {
    identifier: String,
    name: String,
    description: String,
    file_path: String,
    content: Option<String>,
    version: Option<String>,
    author: Option<String>,
    license: Option<String>,
    keywords: Vec<String>,
    publisher: Option<String>,
    homepage: Option<String>,
    repository: Option<String>,
    trust_level: Option<String>,
    risk_level: Option<String>,
    #[serde(default)]
    scan_verdict: String,
    package_type: Option<String>,
    source: Option<String>,
    #[serde(default)]
    content_hash: String,
    #[serde(default)]
    signature_status: String,
    #[serde(default)]
    signing_key_id: String,
    #[serde(default)]
    install_policy: String,
    #[serde(default)]
    revoked_at: Option<String>,
    #[serde(default)]
    artifact_encoding: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct MarketInstallRecord {
    market_id: String,
    file_path: String,
    agent_id: String,
    skill_id: String,
    installed_at: String,
    source: String,
    scan_verdict: String,
    package_type: Option<String>,
    #[serde(default)]
    package_id: String,
    #[serde(default)]
    package_version: String,
    #[serde(default)]
    catalog_revision: String,
    #[serde(default)]
    artifact_sha256: String,
    #[serde(default)]
    target_authority: String,
    #[serde(default)]
    last_readback_at: String,
    #[serde(default)]
    revoked_at: Option<String>,
}

struct MarketStore {
    sources: Vec<MarketSource>,
    installed: Vec<MarketInstallRecord>,
}

#[derive(Default, Serialize, Deserialize)]
struct MarketStoreFile {
    sources: Vec<MarketSource>,
    installed: Vec<MarketInstallRecord>,
}

struct SkillInstallOutcome {
    skill_id: String,
    installed: bool,
    verdict: String,
}

#[derive(Debug)]
struct CatalogFetch {
    envelope: String,
    transport_kind: String,
    endpoint: String,
    distribution_id: String,
    envelope_sha256: String,
}

fn default_true() -> bool {
    true
}

fn default_user_pinned_transport() -> String {
    TRANSPORT_USER_PINNED_GITHUB.to_string()
}

fn default_stale_verified_state() -> String {
    CATALOG_SYNC_STALE_VERIFIED.to_string()
}

impl MarketSource {
    fn registration(&self) -> CatalogSourceRegistration {
        CatalogSourceRegistration {
            source_id: self.id.clone(),
            display_name: self.name.clone(),
            transport_kind: self.transport_kind.clone(),
            repository: self.url.clone(),
            branch: self.branch.clone().unwrap_or_default(),
            manifest_path: self.manifest_path.clone(),
            publisher_id: self.publisher_id.clone(),
            signing_key_id: self.signing_key_id.clone(),
            public_key_base64: self.public_key_base64.clone(),
            trust_class: self.trust_class.clone(),
            built_in: self.built_in,
            enabled: self.enabled,
        }
    }

    fn apply_verified_catalog(
        &mut self,
        catalog: VerifiedCatalog,
        envelope: String,
        sync_state: &str,
        last_synced: Option<String>,
    ) {
        self.catalog_revision = catalog.revision;
        self.generated_at = catalog.generated_at;
        self.signature_status = catalog.signature_status;
        self.source_revoked_at = catalog.revoked_at;
        self.verified_envelope = Some(envelope);
        self.sync_state = sync_state.to_string();
        self.enabled = self.source_revoked_at.is_none();
        let source_id = self.id.clone();
        let catalog_revision = self.catalog_revision.clone();
        let signature_status = self.signature_status.clone();
        let signing_key_id = self.signing_key_id.clone();
        self.skills = catalog
            .packages
            .into_iter()
            .map(|package| {
                MarketSkill::from_catalog(
                    package,
                    &source_id,
                    &catalog_revision,
                    &signature_status,
                    &signing_key_id,
                )
            })
            .collect();
        self.last_synced = last_synced;
        self.error = None;
    }

    fn from_registration(
        registration: CatalogSourceRegistration,
        catalog: Option<VerifiedCatalog>,
        envelope: Option<String>,
    ) -> Result<Self, String> {
        let fingerprint = public_key_fingerprint(&registration.public_key_base64)?;
        let mut source = Self {
            id: registration.source_id,
            name: registration.display_name,
            transport_kind: registration.transport_kind,
            url: registration.repository,
            branch: (!registration.branch.is_empty()).then_some(registration.branch),
            manifest_path: registration.manifest_path,
            publisher_id: registration.publisher_id,
            signing_key_id: registration.signing_key_id,
            public_key_base64: registration.public_key_base64,
            public_key_fingerprint: fingerprint,
            trust_class: registration.trust_class,
            built_in: registration.built_in,
            enabled: registration.enabled,
            skills: Vec::new(),
            catalog_revision: String::new(),
            generated_at: String::new(),
            signature_status: "pending".to_string(),
            source_revoked_at: None,
            verified_envelope: None,
            sync_state: CATALOG_SYNC_INVALID_REJECTED.to_string(),
            last_synced: None,
            error: None,
        };
        if let (Some(catalog), Some(envelope)) = (catalog, envelope) {
            source.apply_verified_catalog(catalog, envelope, CATALOG_SYNC_BOOTSTRAP_VERIFIED, None);
        }
        Ok(source)
    }
}

impl MarketSkill {
    fn from_catalog(
        package: CatalogPackage,
        source_id: &str,
        catalog_revision: &str,
        signature_status: &str,
        signing_key_id: &str,
    ) -> Self {
        Self {
            identifier: package.package_id.clone(),
            name: package.name,
            description: package.description,
            file_path: package.package_id,
            content: Some(package.artifact_content_base64),
            version: Some(package.version),
            author: Some(package.publisher_id.clone()),
            license: Some(package.license),
            keywords: package.keywords,
            publisher: Some(package.publisher_id),
            homepage: Some(package.homepage),
            repository: Some(package.repository),
            trust_level: Some(package.trust_level),
            risk_level: Some(package.risk_level),
            scan_verdict: package.scan_verdict,
            package_type: Some(package.package_type),
            source: Some(format!("catalog://{source_id}/{catalog_revision}")),
            content_hash: package.artifact_sha256,
            signature_status: signature_status.to_string(),
            signing_key_id: signing_key_id.to_string(),
            install_policy: package.install_policy,
            revoked_at: package.revoked_at,
            artifact_encoding: package.artifact_encoding,
        }
    }

    fn artifact_bytes(&self) -> Result<Vec<u8>, String> {
        let encoded = self
            .content
            .as_deref()
            .ok_or_else(|| "verified catalog artifact is unavailable".to_string())?;
        BASE64_STANDARD
            .decode(encoded)
            .map_err(|error| format!("verified catalog artifact is not valid base64: {error}"))
    }

    fn artifact_text(&self) -> Result<String, String> {
        String::from_utf8(self.artifact_bytes()?)
            .map_err(|_| "verified catalog artifact is not UTF-8".to_string())
    }
}

impl Default for MarketStore {
    fn default() -> Self {
        let source = default_source();
        let source = default_catalog()
            .and_then(|catalog| {
                MarketSource::from_registration(
                    source,
                    Some(catalog),
                    Some(default_envelope_json()?.to_string()),
                )
            })
            .ok();
        Self {
            sources: source.into_iter().collect(),
            installed: Vec::new(),
        }
    }
}

fn market_store() -> &'static Mutex<MarketStore> {
    static STORE: OnceLock<Mutex<MarketStore>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(load_market_store()))
}

fn station_error(command: &str, err: station_client::StationClientError) -> AppResult<StubPayload> {
    tracing::error!(command = command, error = %err, "Station skill import request failed");
    err.into_app_result(format!("{} failed", command))
}

fn agent_id(input: Option<String>) -> String {
    input
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("assistant")
        .to_string()
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| format!("failed to create HTTP client: {error}"))
}

fn fetch_text(url: &str) -> Result<String, String> {
    let response = http_client()?
        .get(url)
        .header("Accept", "text/plain, application/json")
        .send()
        .map_err(|error| format!("failed to fetch skill source: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .map_err(|error| format!("failed to read skill source: {error}"))?;
    if !status.is_success() {
        return Err(format!("skill source returned HTTP {}", status.as_u16()));
    }
    Ok(text)
}

fn fetch_catalog_text(url: &str) -> Result<String, String> {
    const MAX_REMOTE_CATALOG_BYTES: u64 = 2 * 1024 * 1024;
    let response = http_client()?
        .get(url)
        .header("Accept", "application/json")
        .send()
        .map_err(|error| format!("failed to fetch catalog source: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("catalog source returned HTTP {}", status.as_u16()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_REMOTE_CATALOG_BYTES)
    {
        return Err("catalog source exceeds 2 MiB".to_string());
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_REMOTE_CATALOG_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("failed to read catalog source: {error}"))?;
    if bytes.len() as u64 > MAX_REMOTE_CATALOG_BYTES {
        return Err("catalog source exceeds 2 MiB".to_string());
    }
    String::from_utf8(bytes).map_err(|_| "catalog source must be UTF-8".to_string())
}

fn github_raw_url(
    owner: &str,
    repo: &str,
    branch: Option<&str>,
    file_path: Option<&str>,
) -> String {
    let branch = branch
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("main");
    let file_path = file_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("SKILL.md")
        .trim_start_matches('/');
    format!("https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{file_path}")
}

fn derive_skill_name(content: &str, fallback: &str) -> Result<String, String> {
    for line in content.lines().take(80) {
        let trimmed = line.trim();
        if let Some(name) = trimmed.strip_prefix("name:") {
            let name = name.trim().trim_matches('"').trim_matches('\'');
            if !name.is_empty() {
                return Ok(name.to_string());
            }
        }
        if let Some(title) = trimmed.strip_prefix("# ") {
            let title = title.trim();
            if !title.is_empty() {
                return Ok(title.to_string());
            }
        }
    }
    let fallback = fallback.trim();
    if fallback.is_empty() {
        return Err("skill package must include a name field or markdown title".to_string());
    }
    Ok(fallback.to_string())
}

fn validate_skill_content(content: &str, fallback_name: &str) -> Result<String, String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err("skill content is empty".to_string());
    }
    if trimmed.len() > 256 * 1024 {
        return Err("skill content exceeds 256 KiB".to_string());
    }
    derive_skill_name(trimmed, fallback_name)
}

fn install_skill(
    agent_id: String,
    name: String,
    source: String,
    content: String,
    token: &str,
) -> AppResult<StubPayload> {
    let outcome = match install_skill_at_station(
        agent_id,
        name.clone(),
        source,
        content,
        "community".to_string(),
        token,
    ) {
        Ok(outcome) => outcome,
        Err(result) => return result,
    };
    success_payload(
        "skills_import",
        json!({
            "id": outcome.skill_id,
            "identifier": name.to_lowercase().replace(' ', "-"),
            "name": name,
            "isNew": outcome.installed,
            "scanVerdict": outcome.verdict
        }),
    )
}

fn install_skill_at_station(
    agent_id: String,
    name: String,
    source: String,
    content: String,
    trust_level: String,
    token: &str,
) -> Result<SkillInstallOutcome, AppResult<StubPayload>> {
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            None,
        ));
    }
    let req = model::agent::InstallSkillRequest {
        agent_id,
        source,
        name: name.clone(),
        content,
        trust_level,
    };
    match station_client::request_proto::<
        model::agent::InstallSkillRequest,
        model::agent::InstallSkillResponse,
    >(Method::POST, SKILL_INSTALL_PATH, token, None, Some(&req))
    {
        Ok(resp) => Ok(SkillInstallOutcome {
            skill_id: resp.skill_id,
            installed: resp.installed,
            verdict: resp.verdict,
        }),
        Err(err) => Err(station_error("skills_import", err)),
    }
}

fn zip_skill_content(bytes: &[u8]) -> Result<(String, String), String> {
    let reader = Cursor::new(bytes);
    let mut archive =
        zip::ZipArchive::new(reader).map_err(|error| format!("invalid ZIP package: {error}"))?;
    let mut candidates: Vec<(String, String)> = Vec::new();

    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| format!("failed to read ZIP entry: {error}"))?;
        if file.is_dir() {
            continue;
        }
        let name = file.name().to_string();
        let lower = name.to_lowercase();
        if !(lower.ends_with("skill.md")
            || lower.ends_with(".skill.md")
            || lower.ends_with("skill.yml")
            || lower.ends_with("skill.yaml"))
        {
            continue;
        }
        let mut content = String::new();
        file.read_to_string(&mut content)
            .map_err(|error| format!("failed to read skill file as UTF-8: {error}"))?;
        candidates.push((name, content));
    }

    let Some((path, content)) = candidates
        .into_iter()
        .find(|(path, _)| path.to_lowercase().ends_with("skill.md"))
        .or_else(|| None)
    else {
        return Err("ZIP package must contain SKILL.md".to_string());
    };
    let fallback = path
        .rsplit('/')
        .next()
        .unwrap_or("Skill")
        .trim_end_matches(".md")
        .trim_end_matches(".yml")
        .trim_end_matches(".yaml");
    let name = validate_skill_content(&content, fallback)?;
    Ok((name, content))
}

fn market_skill_to_json(
    market_id: &str,
    skill: &MarketSkill,
    installed: Option<&MarketInstallRecord>,
) -> Value {
    let revoked_at = skill
        .revoked_at
        .as_deref()
        .or_else(|| installed.and_then(|record| record.revoked_at.as_deref()))
        .unwrap_or("");
    json!({
        "marketId": market_id,
        "identifier": skill.identifier,
        "name": skill.name,
        "description": skill.description,
        "filePath": skill.file_path,
        "installed": installed.is_some(),
        "installedSkillId": installed.map(|record| record.skill_id.as_str()).unwrap_or(""),
        "installedAt": installed.map(|record| record.installed_at.as_str()).unwrap_or(""),
        "scanVerdict": skill.scan_verdict,
        "version": skill.version.clone().unwrap_or_else(|| "1".to_string()),
        "author": skill.author.clone().unwrap_or_default(),
        "authorUrl": "",
        "license": skill.license.clone().unwrap_or_default(),
        "keywords": skill.keywords.clone(),
        "avatar": "",
        "tags": skill.keywords.clone(),
        "publisher": skill.publisher.clone().or_else(|| skill.author.clone()).unwrap_or_default(),
        "homepage": skill.homepage.clone().unwrap_or_default(),
        "repository": skill.repository.clone().unwrap_or_default(),
        "trustLevel": skill.trust_level.clone().unwrap_or_else(|| "unknown".to_string()),
        "riskLevel": skill.risk_level.clone().unwrap_or_else(|| infer_risk_level(skill).to_string()),
        "packageType": skill.package_type.clone().or_else(|| installed.and_then(|record| record.package_type.clone())).unwrap_or_else(|| "skill".to_string()),
        "source": skill.source.clone().unwrap_or_else(|| "market".to_string()),
        "contentHash": skill.content_hash,
        "signatureStatus": skill.signature_status,
        "signingKeyId": skill.signing_key_id,
        "installPolicy": skill.install_policy,
        "revoked": !revoked_at.is_empty(),
        "revokedAt": revoked_at,
        "targetAuthority": installed.map(|record| record.target_authority.as_str()).unwrap_or(""),
        "targetReadbackAt": installed.map(|record| record.last_readback_at.as_str()).unwrap_or("")
    })
}

fn market_store_path() -> Result<PathBuf, String> {
    storage::app_file_path(
        "desktop",
        StorageKind::Data,
        &["skills_market", "store.json"],
    )
    .map_err(|error| format!("failed to resolve skill market store path: {error:?}"))
}

fn load_market_store() -> MarketStore {
    let path = match market_store_path() {
        Ok(path) => path,
        Err(error) => {
            tracing::warn!(error = %error, "Failed to resolve skill market store path");
            return MarketStore::default();
        }
    };
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return MarketStore::default()
        }
        Err(error) => {
            tracing::warn!(error = %error, path = %path.display(), "Failed to read skill market store");
            return MarketStore::default();
        }
    };
    match serde_json::from_str::<MarketStoreFile>(&content) {
        Ok(file) => normalize_market_store(MarketStore {
            sources: file.sources,
            installed: file.installed,
        }),
        Err(error) => {
            tracing::warn!(error = %error, path = %path.display(), "Failed to parse skill market store");
            MarketStore::default()
        }
    }
}

fn normalize_market_store(mut store: MarketStore) -> MarketStore {
    let mut normalized = Vec::with_capacity(store.sources.len() + 1);
    for mut source in store.sources.drain(..) {
        if source.id == DEFAULT_SOURCE_ID {
            let registration = default_source();
            source.name = registration.display_name;
            source.transport_kind = registration.transport_kind;
            source.url = registration.repository;
            source.branch = None;
            source.manifest_path = registration.manifest_path;
            source.publisher_id = registration.publisher_id;
            source.signing_key_id = registration.signing_key_id;
            source.public_key_base64 = registration.public_key_base64;
            source.public_key_fingerprint =
                public_key_fingerprint(&source.public_key_base64).unwrap_or_default();
            source.trust_class = registration.trust_class;
            source.built_in = true;
            source.enabled = true;
        }
        let registration = source.registration();
        let persisted_sync_state = source.sync_state.clone();
        let persisted_last_synced = source.last_synced.clone();
        match source
            .verified_envelope
            .clone()
            .ok_or_else(|| "verified catalog envelope is missing".to_string())
            .and_then(|envelope| {
                verify_catalog(&registration, &envelope).map(|catalog| (catalog, envelope))
            }) {
            Ok((catalog, envelope)) => source.apply_verified_catalog(
                catalog,
                envelope,
                if matches!(
                    persisted_sync_state.as_str(),
                    CATALOG_SYNC_BOOTSTRAP_VERIFIED
                        | CATALOG_SYNC_FRESH_VERIFIED
                        | CATALOG_SYNC_STALE_VERIFIED
                ) {
                    &persisted_sync_state
                } else {
                    CATALOG_SYNC_STALE_VERIFIED
                },
                persisted_last_synced,
            ),
            Err(error) if source.id == DEFAULT_SOURCE_ID => {
                match default_catalog().and_then(|catalog| {
                    source.apply_verified_catalog(
                        catalog,
                        default_envelope_json()?.to_string(),
                        CATALOG_SYNC_STALE_VERIFIED,
                        persisted_last_synced,
                    );
                    Ok(())
                }) {
                    Ok(()) => {
                        source.error = Some(error.clone());
                    }
                    Err(default_error) => {
                        source.enabled = false;
                        source.signature_status = "invalid".to_string();
                        source.sync_state = CATALOG_SYNC_INVALID_REJECTED.to_string();
                        source.error = Some(default_error);
                    }
                }
                tracing::warn!(error = %error, "Discarded invalid persisted default catalog snapshot");
            }
            Err(_) => {
                source.enabled = false;
                source.signature_status = "invalid".to_string();
                source.sync_state = CATALOG_SYNC_INVALID_REJECTED.to_string();
                source.skills.clear();
                source.error = Some("LEGACY_UNSIGNED_CATALOG_SOURCE_DISABLED".to_string());
            }
        }
        normalized.push(source);
    }
    if !normalized
        .iter()
        .any(|source| source.id == DEFAULT_SOURCE_ID)
    {
        if let Some(source) = MarketStore::default().sources.into_iter().next() {
            normalized.insert(0, source);
        }
    }
    store.sources = normalized;
    reconcile_revocations(&mut store);
    store
}

fn reconcile_revocations(store: &mut MarketStore) {
    for record in &mut store.installed {
        record.revoked_at = store
            .sources
            .iter()
            .find(|source| source.id == record.market_id)
            .and_then(|source| {
                source
                    .skills
                    .iter()
                    .find(|skill| skill.file_path == record.file_path)
                    .and_then(|skill| skill.revoked_at.clone())
                    .or_else(|| source.source_revoked_at.clone())
            });
    }
}

fn persist_market_store(store: &MarketStore) -> Result<(), String> {
    let path = market_store_path()?;
    let file = MarketStoreFile {
        sources: store.sources.clone(),
        installed: store.installed.clone(),
    };
    let content = serde_json::to_string_pretty(&file)
        .map_err(|error| format!("failed to serialize skill market store: {error}"))?;
    storage::write_string_atomic(&path, &content)
        .map_err(|error| format!("failed to write skill market store: {error}"))
}

fn persist_error(error: impl std::fmt::Display) -> AppResult<StubPayload> {
    tracing::error!(error = %error, "Failed to persist skill market store");
    AppResult::fail(
        ErrorCode::InternalError,
        format!("failed to persist skill market store: {error}"),
        None,
    )
}

fn installed_record<'a>(
    store: &'a MarketStore,
    market_id: &str,
    file_path: &str,
    agent_id: &str,
) -> Option<&'a MarketInstallRecord> {
    store.installed.iter().find(|record| {
        record.market_id == market_id
            && record.file_path == file_path
            && record.agent_id == agent_id
    })
}

fn infer_risk_level(skill: &MarketSkill) -> &'static str {
    let text = format!(
        "{} {} {}",
        skill.name,
        skill.description,
        skill.keywords.join(" ")
    )
    .to_lowercase();
    if text.contains("shell") || text.contains("filesystem") || text.contains("network") {
        "medium"
    } else {
        "low"
    }
}

fn fetch_catalog_envelope(source: &MarketSource, token: &str) -> Result<CatalogFetch, String> {
    match source.transport_kind.as_str() {
        TRANSPORT_OFFICIAL_STATION => {
            if token.trim().is_empty() {
                return Err("OFFICIAL_CATALOG_AUTHORIZATION_FAILED".to_string());
            }
            let response = station_client::request_proto::<
                model::agent::GetOfficialPackageCatalogRequest,
                model::agent::GetOfficialPackageCatalogResponse,
            >(Method::GET, OFFICIAL_CATALOG_ENDPOINT, token, None, None)
            .map_err(official_catalog_transport_error)?;
            validate_official_catalog_response(response)
        }
        TRANSPORT_USER_PINNED_GITHUB => {
            let url = github_raw_manifest_url(&source.registration())?;
            let envelope = fetch_catalog_text(&url)?;
            Ok(CatalogFetch {
                envelope_sha256: sha256_hex(envelope.as_bytes()),
                envelope,
                transport_kind: TRANSPORT_USER_PINNED_GITHUB.to_string(),
                endpoint: url,
                distribution_id: String::new(),
            })
        }
        _ => Err("CATALOG_TRANSPORT_UNSUPPORTED".to_string()),
    }
}

fn validate_official_catalog_response(
    response: model::agent::GetOfficialPackageCatalogResponse,
) -> Result<CatalogFetch, String> {
    const MAX_REMOTE_CATALOG_BYTES: usize = 2 * 1024 * 1024;
    if response.envelope_json.is_empty() || response.envelope_json.len() > MAX_REMOTE_CATALOG_BYTES
    {
        return Err("OFFICIAL_CATALOG_RESPONSE_SIZE_INVALID".to_string());
    }
    if response.media_type != "application/json" {
        return Err("OFFICIAL_CATALOG_MEDIA_TYPE_INVALID".to_string());
    }
    if response.distribution_id != OFFICIAL_CATALOG_DISTRIBUTION_ID {
        return Err("OFFICIAL_CATALOG_DISTRIBUTION_INVALID".to_string());
    }
    let actual_sha256 = sha256_hex(&response.envelope_json);
    if response.envelope_sha256 != actual_sha256 {
        return Err("OFFICIAL_CATALOG_TRANSPORT_DIGEST_INVALID".to_string());
    }
    let envelope = String::from_utf8(response.envelope_json)
        .map_err(|_| "OFFICIAL_CATALOG_RESPONSE_NOT_UTF8".to_string())?;
    Ok(CatalogFetch {
        envelope,
        transport_kind: TRANSPORT_OFFICIAL_STATION.to_string(),
        endpoint: OFFICIAL_CATALOG_ENDPOINT.to_string(),
        distribution_id: response.distribution_id,
        envelope_sha256: actual_sha256,
    })
}

fn official_catalog_transport_error(error: station_client::StationClientError) -> String {
    match error.kind {
        station_client::StationClientErrorKind::HttpStatus(401)
        | station_client::StationClientErrorKind::SessionRevoked => {
            "OFFICIAL_CATALOG_AUTHORIZATION_FAILED".to_string()
        }
        station_client::StationClientErrorKind::HttpStatus(404) => {
            "OFFICIAL_CATALOG_ENDPOINT_UNAVAILABLE".to_string()
        }
        station_client::StationClientErrorKind::Network => {
            "OFFICIAL_CATALOG_NETWORK_FAILED".to_string()
        }
        _ => "OFFICIAL_CATALOG_RESPONSE_INVALID".to_string(),
    }
}

fn mark_catalog_sync_failed(source: &mut MarketSource, error: String, synced_at: String) {
    source.error = Some(error);
    source.last_synced = Some(synced_at);
    source.sync_state = if source.skills.is_empty() {
        CATALOG_SYNC_INVALID_REJECTED
    } else {
        CATALOG_SYNC_STALE_VERIFIED
    }
    .to_string();
}

fn encode_page_cursor(source_id: &str, revision: &str, query: &str, offset: usize) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(
        serde_json::to_vec(&json!({
            "sourceId": source_id,
            "revision": revision,
            "query": query,
            "offset": offset
        }))
        .expect("catalog cursor serialization"),
    )
}

fn decode_page_cursor(
    cursor: Option<&str>,
    source_id: &str,
    revision: &str,
    query: &str,
) -> Result<usize, String> {
    let Some(cursor) = cursor.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(0);
    };
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(cursor)
        .map_err(|_| "catalog page cursor is invalid".to_string())?;
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "catalog page cursor is invalid".to_string())?;
    if value.get("sourceId").and_then(Value::as_str) != Some(source_id)
        || value.get("revision").and_then(Value::as_str) != Some(revision)
        || value.get("query").and_then(Value::as_str) != Some(query)
    {
        return Err("catalog page cursor does not match this snapshot".to_string());
    }
    value
        .get("offset")
        .and_then(Value::as_u64)
        .and_then(|offset| usize::try_from(offset).ok())
        .ok_or_else(|| "catalog page cursor offset is invalid".to_string())
}

fn validate_catalog_update(
    source: &MarketSource,
    catalog: &VerifiedCatalog,
    envelope: &str,
) -> Result<(), String> {
    if !source.catalog_revision.is_empty() {
        let current_generated_at = OffsetDateTime::parse(&source.generated_at, &Rfc3339)
            .map_err(|error| format!("persisted catalog generatedAt is invalid: {error}"))?;
        let next_generated_at = OffsetDateTime::parse(&catalog.generated_at, &Rfc3339)
            .map_err(|error| format!("catalog generatedAt is invalid: {error}"))?;
        if next_generated_at < current_generated_at {
            return Err("catalog snapshot rollback was rejected".to_string());
        }
        if catalog.revision == source.catalog_revision
            && source.verified_envelope.as_deref() != Some(envelope)
        {
            return Err("catalog revision was reused with different signed bytes".to_string());
        }
    }
    Ok(())
}

fn paginate_market_skills<'a>(
    source: &'a MarketSource,
    query: &str,
    cursor: Option<&str>,
    limit: u32,
) -> Result<(Vec<&'a MarketSkill>, usize, Option<String>), String> {
    let query = query.trim().to_lowercase();
    let filtered = source
        .skills
        .iter()
        .filter(|skill| {
            query.is_empty()
                || skill.name.to_lowercase().contains(&query)
                || skill.description.to_lowercase().contains(&query)
                || skill.identifier.to_lowercase().contains(&query)
                || skill
                    .keywords
                    .iter()
                    .any(|keyword| keyword.to_lowercase().contains(&query))
        })
        .collect::<Vec<_>>();
    let total = filtered.len();
    let offset = decode_page_cursor(cursor, &source.id, &source.catalog_revision, &query)?;
    if offset > total {
        return Err("catalog page cursor is beyond the current result set".to_string());
    }
    let limit = limit.clamp(1, 100) as usize;
    let page = filtered
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    let next_offset = offset.saturating_add(page.len());
    let next_cursor = (next_offset < total)
        .then(|| encode_page_cursor(&source.id, &source.catalog_revision, &query, next_offset));
    Ok((page, total, next_cursor))
}

pub fn skills_import_url(input: SkillImportAddressInput, token: &str) -> AppResult<StubPayload> {
    if input.address.trim().is_empty() {
        return invalid_argument("address is required");
    }
    let content = match fetch_text(input.address.trim()) {
        Ok(content) => content,
        Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
    };
    let name = match validate_skill_content(&content, input.address.trim()) {
        Ok(name) => name,
        Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
    };
    install_skill(
        agent_id(input.agent_id),
        name,
        input.address,
        content,
        token,
    )
}

pub fn skills_import_github(input: SkillImportGitHubInput, token: &str) -> AppResult<StubPayload> {
    if input.owner.trim().is_empty() || input.repo.trim().is_empty() {
        return invalid_argument("owner and repo are required");
    }
    let url = github_raw_url(
        input.owner.trim(),
        input.repo.trim(),
        input.branch.as_deref(),
        input.file_path.as_deref(),
    );
    let content = match fetch_text(&url) {
        Ok(content) => content,
        Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
    };
    let fallback = input
        .file_path
        .as_deref()
        .unwrap_or("SKILL.md")
        .rsplit('/')
        .next()
        .unwrap_or("Skill");
    let name = match validate_skill_content(&content, fallback) {
        Ok(name) => name,
        Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
    };
    install_skill(agent_id(input.agent_id), name, url, content, token)
}

pub fn skills_import_zip(input: SkillImportZipInput, token: &str) -> AppResult<StubPayload> {
    if input.data_base64.trim().is_empty() {
        return invalid_argument("data_base64 is required");
    }
    let bytes = match BASE64_STANDARD.decode(input.data_base64.trim()) {
        Ok(bytes) => bytes,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("invalid ZIP payload: {error}"),
                None,
            )
        }
    };
    let (name, content) = match zip_skill_content(&bytes) {
        Ok(value) => value,
        Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
    };
    install_skill(
        agent_id(input.agent_id),
        name,
        input.file_name,
        content,
        token,
    )
}

pub fn skills_validate_zip(input: SkillImportZipInput) -> AppResult<StubPayload> {
    if input.data_base64.trim().is_empty() {
        return invalid_argument("data_base64 is required");
    }
    let bytes = match BASE64_STANDARD.decode(input.data_base64.trim()) {
        Ok(bytes) => bytes,
        Err(error) => {
            return success_payload(
                "skills_validate_zip",
                json!({ "valid": false, "skillPath": "", "skillName": "", "skillCount": 0, "error": format!("invalid ZIP payload: {error}") }),
            )
        }
    };
    match zip_skill_content(&bytes) {
        Ok((name, _)) => success_payload(
            "skills_validate_zip",
            json!({ "valid": true, "skillPath": "SKILL.md", "skillName": name, "skillCount": 1 }),
        ),
        Err(error) => success_payload(
            "skills_validate_zip",
            json!({ "valid": false, "skillPath": "", "skillName": "", "skillCount": 0, "error": error }),
        ),
    }
}

pub fn skills_market_dir() -> AppResult<StubPayload> {
    success_payload("skills_market_dir", json!({ "path": ".skills" }))
}

pub fn skills_market_open_dir() -> AppResult<StubPayload> {
    success_payload(
        "skills_market_open_dir",
        json!({ "ok": true, "path": ".skills" }),
    )
}

pub fn skills_market_list() -> AppResult<StubPayload> {
    let guard = match market_store().lock() {
        Ok(guard) => guard,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to access market store: {error}"),
                None,
            )
        }
    };
    let markets = guard
        .sources
        .iter()
        .map(|source| {
            json!({
                "id": source.id,
                "name": source.name,
                "transportKind": source.transport_kind,
                "url": source.url,
                "branch": source.branch,
                "manifestPath": source.manifest_path,
                "publisherId": source.publisher_id,
                "signingKeyId": source.signing_key_id,
                "publicKeyFingerprint": source.public_key_fingerprint,
                "trustLevel": source.trust_class,
                "builtIn": source.built_in,
                "enabled": source.enabled,
                "catalogRevision": source.catalog_revision,
                "generatedAt": source.generated_at,
                "signatureStatus": source.signature_status,
                "syncState": source.sync_state,
                "revoked": source.source_revoked_at.is_some(),
                "revokedAt": source.source_revoked_at,
                "skillCount": source.skills.len(),
                "lastSynced": source.last_synced,
                "synced": source.signature_status == "verified" && !source.skills.is_empty(),
                "stale": source.error.is_some() && !source.skills.is_empty(),
                "error": source.error
            })
        })
        .collect::<Vec<_>>();
    success_payload("skills_market_list", json!({ "markets": markets }))
}

pub fn skills_market_add(input: SkillMarketAddInput) -> AppResult<StubPayload> {
    if input.url.trim().is_empty()
        || input.branch.as_deref().unwrap_or("").trim().is_empty()
        || input
            .manifest_path
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
        || input
            .publisher_id
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
        || input
            .signing_key_id
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
        || input
            .public_key_base64
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
    {
        return invalid_argument(
            "repository, branch, manifest_path, publisher_id, signing_key_id and public_key_base64 are required",
        );
    }
    let url = input.url.trim().to_string();
    let branch = input.branch.unwrap_or_default().trim().to_string();
    let manifest_path = input.manifest_path.unwrap_or_default().trim().to_string();
    let publisher_id = input.publisher_id.unwrap_or_default().trim().to_string();
    let signing_key_id = input.signing_key_id.unwrap_or_default().trim().to_string();
    let public_key_base64 = input
        .public_key_base64
        .unwrap_or_default()
        .trim()
        .to_string();
    let source_identity =
        format!("{url}\n{branch}\n{manifest_path}\n{publisher_id}\n{signing_key_id}");
    let id = input
        .source_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("market-{}", sha256_short(&source_identity)));
    let registration = CatalogSourceRegistration {
        source_id: id.clone(),
        display_name: input.name.unwrap_or_else(|| url.clone()),
        transport_kind: TRANSPORT_USER_PINNED_GITHUB.to_string(),
        repository: url,
        branch,
        manifest_path,
        publisher_id,
        signing_key_id,
        public_key_base64,
        trust_class: "user-pinned".to_string(),
        built_in: false,
        enabled: true,
    };
    if let Err(error) = github_raw_manifest_url(&registration) {
        return AppResult::fail(ErrorCode::InvalidArgument, error, None);
    }
    let source = match MarketSource::from_registration(registration, None, None) {
        Ok(source) => source,
        Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
    };
    let mut guard = match market_store().lock() {
        Ok(guard) => guard,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to access market store: {error}"),
                None,
            )
        }
    };
    if let Some(existing) = guard.sources.iter().find(|source| source.id == id) {
        if existing.transport_kind != source.transport_kind
            || existing.url != source.url
            || existing.branch != source.branch
            || existing.manifest_path != source.manifest_path
            || existing.publisher_id != source.publisher_id
            || existing.signing_key_id != source.signing_key_id
            || existing.public_key_base64 != source.public_key_base64
        {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "catalog source identity is already pinned to different governance metadata",
                None,
            );
        }
    } else {
        guard.sources.push(source);
    }
    if let Err(error) = persist_market_store(&guard) {
        return persist_error(error);
    }
    success_payload("skills_market_add", json!({ "ok": true, "id": id }))
}

pub fn skills_market_remove(input: SkillMarketIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let mut guard = match market_store().lock() {
        Ok(guard) => guard,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to access market store: {error}"),
                None,
            )
        }
    };
    if guard
        .sources
        .iter()
        .any(|source| source.id == input.id && source.built_in)
    {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "built-in catalog sources cannot be removed",
            None,
        );
    }
    if guard
        .installed
        .iter()
        .any(|record| record.market_id == input.id)
    {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "uninstall catalog packages before removing their source",
            None,
        );
    }
    let before = guard.sources.len();
    guard.sources.retain(|source| source.id != input.id);
    if let Err(error) = persist_market_store(&guard) {
        return persist_error(error);
    }
    success_payload(
        "skills_market_remove",
        json!({ "ok": before != guard.sources.len() }),
    )
}

pub fn skills_market_sync(input: SkillMarketSyncInput, token: &str) -> AppResult<StubPayload> {
    if input.market_id.trim().is_empty() {
        return invalid_argument("market_id is required");
    }
    let source_snapshot = match market_store().lock() {
        Ok(guard) => guard,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to access market store: {error}"),
                None,
            )
        }
    }
    .sources
    .iter()
    .find(|source| source.id == input.market_id)
    .cloned();
    let Some(source_snapshot) = source_snapshot else {
        return AppResult::fail(ErrorCode::NotFound, "market source not found", None);
    };
    let registration = source_snapshot.registration();
    let sync_result = fetch_catalog_envelope(&source_snapshot, token).and_then(|fetch| {
        let catalog = verify_catalog(&registration, &fetch.envelope)?;
        validate_catalog_update(&source_snapshot, &catalog, &fetch.envelope)?;
        Ok((catalog, fetch))
    });
    let mut guard = match market_store().lock() {
        Ok(guard) => guard,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to access market store: {error}"),
                None,
            )
        }
    };
    let Some(source) = guard
        .sources
        .iter_mut()
        .find(|source| source.id == input.market_id)
    else {
        return AppResult::fail(ErrorCode::NotFound, "market source not found", None);
    };
    let synced_at = current_millis().to_string();
    let (stale_error, transport_kind, endpoint, distribution_id, envelope_sha256) =
        match sync_result {
            Ok((catalog, fetch)) => {
                let CatalogFetch {
                    envelope,
                    transport_kind,
                    endpoint,
                    distribution_id,
                    envelope_sha256,
                } = fetch;
                source.apply_verified_catalog(
                    catalog,
                    envelope,
                    CATALOG_SYNC_FRESH_VERIFIED,
                    Some(synced_at),
                );
                (
                    None,
                    transport_kind,
                    endpoint,
                    distribution_id,
                    envelope_sha256,
                )
            }
            Err(error) => {
                mark_catalog_sync_failed(source, error.clone(), synced_at);
                (
                    Some(error),
                    source_snapshot.transport_kind.clone(),
                    if source_snapshot.transport_kind == TRANSPORT_OFFICIAL_STATION {
                        OFFICIAL_CATALOG_ENDPOINT.to_string()
                    } else {
                        github_raw_manifest_url(&source_snapshot.registration()).unwrap_or_default()
                    },
                    String::new(),
                    String::new(),
                )
            }
        };
    reconcile_revocations(&mut guard);
    if let Err(error) = persist_market_store(&guard) {
        return persist_error(error);
    }
    let source = guard
        .sources
        .iter()
        .find(|source| source.id == input.market_id)
        .expect("source remains present while synchronized");
    if source.skills.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            stale_error.unwrap_or_else(|| "catalog source has no verified snapshot".to_string()),
            None,
        );
    }
    let skills = source
        .skills
        .iter()
        .map(|skill| {
            market_skill_to_json(
                &source.id,
                skill,
                installed_record(&guard, &source.id, &skill.file_path, "assistant"),
            )
        })
        .collect::<Vec<_>>();
    success_payload(
        "skills_market_sync",
        json!({
            "skills": skills,
            "total": skills.len(),
            "catalogRevision": source.catalog_revision,
            "signatureStatus": source.signature_status,
            "syncState": source.sync_state,
            "transportKind": transport_kind,
            "transportEndpoint": endpoint,
            "distributionId": distribution_id,
            "envelopeSha256": envelope_sha256,
            "stale": stale_error.is_some(),
            "error": stale_error
        }),
    )
}

pub fn skills_market_list_skills(input: SkillMarketListInput) -> AppResult<StubPayload> {
    if input.market_id.trim().is_empty() {
        return invalid_argument("market_id is required");
    }
    let guard = match market_store().lock() {
        Ok(guard) => guard,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to access market store: {error}"),
                None,
            )
        }
    };
    let Some(source) = guard
        .sources
        .iter()
        .find(|source| source.id == input.market_id)
    else {
        return AppResult::fail(ErrorCode::NotFound, "market source not found", None);
    };
    let (page, total, next_cursor) = match paginate_market_skills(
        source,
        input.q.as_deref().unwrap_or(""),
        input.cursor.as_deref(),
        input.limit.unwrap_or(100),
    ) {
        Ok(page) => page,
        Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
    };
    let skills = page
        .into_iter()
        .map(|skill| {
            market_skill_to_json(
                &source.id,
                skill,
                installed_record(&guard, &source.id, &skill.file_path, "assistant"),
            )
        })
        .collect::<Vec<_>>();
    success_payload(
        "skills_market_list_skills",
        json!({
            "skills": skills,
            "total": total,
            "nextCursor": next_cursor,
            "catalogRevision": source.catalog_revision
        }),
    )
}

fn catalog_detail_content(skill: &MarketSkill) -> Result<String, String> {
    if skill.package_type.as_deref() != Some("agent") {
        return skill.artifact_text();
    }
    let package = model::agent::AgentPackageDocument::decode(skill.artifact_bytes()?.as_slice())
        .map_err(|error| format!("invalid Agent package protobuf: {error}"))?;
    let agent = package
        .agent
        .ok_or_else(|| "Agent package does not contain an Agent".to_string())?;
    serde_json::to_string_pretty(&json!({
        "schemaVersion": package.schema_version,
        "name": agent.name,
        "title": agent.title,
        "description": agent.description,
        "providerId": agent.provider_id,
        "modelName": agent.model_name,
        "thinkingMode": agent.thinking_mode,
        "bindingCount": package.bindings.len(),
        "knowledgeResourceCount": package.knowledge_resources.len()
    }))
    .map_err(|error| format!("failed to render Agent package detail: {error}"))
}

fn verify_skill_readback(
    agent_id: &str,
    skill_id: &str,
    token: &str,
) -> Result<(), AppResult<StubPayload>> {
    let response = station_client::request_proto::<
        model::agent::ListSkillsRequest,
        model::agent::ListSkillsResponse,
    >(
        Method::POST,
        SKILL_LIST_PATH,
        token,
        None,
        Some(&model::agent::ListSkillsRequest {
            agent_id: agent_id.to_string(),
            category: String::new(),
        }),
    )
    .map_err(|error| station_error("skills_market_install", error))?;
    if response
        .skills
        .iter()
        .any(|skill| skill.skill_id == skill_id)
    {
        Ok(())
    } else {
        Err(AppResult::fail(
            ErrorCode::InternalError,
            "MARKETPLACE_TARGET_READBACK_FAILED",
            None,
        ))
    }
}

fn record_market_install(record: MarketInstallRecord) -> Result<(), AppResult<StubPayload>> {
    let mut guard = market_store().lock().map_err(|error| {
        AppResult::fail(
            ErrorCode::InternalError,
            format!("failed to access market store: {error}"),
            None,
        )
    })?;
    guard.installed.retain(|item| {
        !(item.market_id == record.market_id
            && item.file_path == record.file_path
            && item.agent_id == record.agent_id)
    });
    guard.installed.push(record);
    persist_market_store(&guard).map_err(persist_error)
}

fn validate_market_install_policy(
    skill: &MarketSkill,
    risk_acknowledged: bool,
) -> Result<(), &'static str> {
    if skill.signature_status != "verified" {
        return Err("MARKETPLACE_SIGNATURE_UNVERIFIED");
    }
    if skill.install_policy == INSTALL_BLOCKED || skill.revoked_at.is_some() {
        return Err("MARKETPLACE_PACKAGE_REVOKED_OR_BLOCKED");
    }
    if skill.install_policy == INSTALL_CONFIRMATION_REQUIRED && !risk_acknowledged {
        return Err("MARKETPLACE_RISK_CONFIRMATION_REQUIRED");
    }
    if skill.install_policy != INSTALL_ALLOWED
        && skill.install_policy != INSTALL_CONFIRMATION_REQUIRED
    {
        return Err("MARKETPLACE_INSTALL_POLICY_INVALID");
    }
    Ok(())
}

pub fn skills_market_detail(input: SkillMarketDetailInput) -> AppResult<StubPayload> {
    if input.market_id.trim().is_empty() || input.file_path.trim().is_empty() {
        return invalid_argument("market_id and file_path are required");
    }
    let guard = match market_store().lock() {
        Ok(guard) => guard,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to access market store: {error}"),
                None,
            )
        }
    };
    let Some(source) = guard
        .sources
        .iter()
        .find(|source| source.id == input.market_id)
    else {
        return AppResult::fail(ErrorCode::NotFound, "market source not found", None);
    };
    let Some(skill) = source
        .skills
        .iter()
        .find(|skill| skill.file_path == input.file_path)
    else {
        return AppResult::fail(ErrorCode::NotFound, "market skill not found", None);
    };
    let content = match catalog_detail_content(skill) {
        Ok(content) => content,
        Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
    };
    let mut detail = market_skill_to_json(
        &source.id,
        skill,
        installed_record(&guard, &source.id, &skill.file_path, "assistant"),
    );
    if let Some(obj) = detail.as_object_mut() {
        obj.insert("content".to_string(), json!(content));
    }
    success_payload("skills_market_detail", detail)
}

pub fn skills_market_install(
    actor_ptid: &str,
    input: SkillMarketDetailInput,
    token: &str,
) -> AppResult<StubPayload> {
    if input.market_id.trim().is_empty() || input.file_path.trim().is_empty() {
        return invalid_argument("market_id and file_path are required");
    }
    let target_agent_id = agent_id(input.agent_id.clone());
    let (market_id, catalog_revision, skill) = {
        let guard = match market_store().lock() {
            Ok(guard) => guard,
            Err(error) => {
                return AppResult::fail(
                    ErrorCode::InternalError,
                    format!("failed to access market store: {error}"),
                    None,
                )
            }
        };
        let Some(source) = guard
            .sources
            .iter()
            .find(|source| source.id == input.market_id)
        else {
            return AppResult::fail(ErrorCode::NotFound, "market source not found", None);
        };
        let Some(skill) = source
            .skills
            .iter()
            .find(|skill| skill.file_path == input.file_path)
        else {
            return AppResult::fail(ErrorCode::NotFound, "market skill not found", None);
        };
        (
            source.id.clone(),
            source.catalog_revision.clone(),
            skill.clone(),
        )
    };
    if let Err(error) =
        validate_market_install_policy(&skill, input.risk_acknowledged.unwrap_or(false))
    {
        return AppResult::fail(ErrorCode::InvalidArgument, error, None);
    }
    let source = skill.source.clone().unwrap_or_else(|| {
        format!(
            "catalog://{}/{}/{}",
            market_id, catalog_revision, skill.identifier
        )
    });
    match skill.package_type.as_deref().unwrap_or("skill") {
        "agent" => {
            return install_agent_market_package(
                actor_ptid,
                target_agent_id,
                market_id,
                catalog_revision,
                skill,
                source,
                token,
            );
        }
        "mcp" => {
            return install_mcp_market_package(
                actor_ptid,
                target_agent_id,
                market_id,
                catalog_revision,
                skill,
                source,
            );
        }
        _ => {}
    }
    let content = match skill.artifact_text() {
        Ok(content) => content,
        Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
    };
    let name = match validate_skill_content(&content, &skill.name) {
        Ok(name) => name,
        Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
    };
    let outcome = match install_skill_at_station(
        target_agent_id.clone(),
        name.clone(),
        source.clone(),
        content,
        skill
            .trust_level
            .clone()
            .unwrap_or_else(|| "unknown".to_string()),
        token,
    ) {
        Ok(outcome) => outcome,
        Err(result) => return result,
    };
    if let Err(error) = verify_skill_readback(&target_agent_id, &outcome.skill_id, token) {
        return error;
    }
    let record = MarketInstallRecord {
        market_id,
        file_path: skill.file_path,
        agent_id: target_agent_id,
        skill_id: outcome.skill_id.clone(),
        installed_at: current_millis().to_string(),
        source,
        scan_verdict: outcome.verdict.clone(),
        package_type: Some("skill".to_string()),
        package_id: skill.identifier.clone(),
        package_version: skill.version.unwrap_or_else(|| "1.0.0".to_string()),
        catalog_revision,
        artifact_sha256: skill.content_hash,
        target_authority: "station-skill".to_string(),
        last_readback_at: current_millis().to_string(),
        revoked_at: skill.revoked_at,
    };
    if let Err(result) = record_market_install(record) {
        return result;
    }
    success_payload(
        "skills_market_install",
        json!({
            "id": outcome.skill_id,
            "identifier": name.to_lowercase().replace(' ', "-"),
            "name": name,
            "isNew": outcome.installed,
            "packageType": "skill",
            "scanVerdict": outcome.verdict,
            "targetAuthority": "station-skill",
            "targetReadback": true
        }),
    )
}

fn install_agent_market_package(
    _actor_ptid: &str,
    target_agent_id: String,
    market_id: String,
    catalog_revision: String,
    skill: MarketSkill,
    source: String,
    token: &str,
) -> AppResult<StubPayload> {
    if skill.artifact_encoding != "protobuf-base64" {
        return invalid_argument("Agent package encoding is invalid");
    }
    let package = match skill.artifact_bytes().and_then(|bytes| {
        model::agent::AgentPackageDocument::decode(bytes.as_slice())
            .map_err(|error| format!("invalid Agent package protobuf: {error}"))
    }) {
        Ok(package) => package,
        Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
    };
    let request = model::agent::ImportAgentPackageRequest {
        package: Some(package),
        name: skill.name.clone(),
        idempotency_key: format!("market-install-{}", ulid::Ulid::new()),
    };
    let response = match station_client::request_proto::<
        model::agent::ImportAgentPackageRequest,
        model::agent::ImportAgentPackageResponse,
    >(
        Method::POST,
        "/sub-agent/agent/package/import",
        token,
        None,
        Some(&request),
    ) {
        Ok(response) => response,
        Err(error) => return station_error("skills_market_install", error),
    };
    if !response.unresolved_dependencies.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "MARKETPLACE_AGENT_DEPENDENCIES_UNRESOLVED",
            None,
        );
    }
    let Some(agent) = response.agent else {
        return AppResult::fail(
            ErrorCode::InternalError,
            "Agent package import returned no Agent",
            None,
        );
    };
    let readback = station_client::request_proto::<
        model::agent::GetAgentRequest,
        model::agent::GetAgentResponse,
    >(
        Method::POST,
        "/sub-agent/agent/get",
        token,
        None,
        Some(&model::agent::GetAgentRequest {
            agent_id: agent.agent_id.clone(),
        }),
    );
    if !matches!(readback, Ok(ref response) if response.agent.as_ref().is_some_and(|item| item.agent_id == agent.agent_id))
    {
        return AppResult::fail(
            ErrorCode::InternalError,
            "MARKETPLACE_TARGET_READBACK_FAILED",
            None,
        );
    }
    let record = MarketInstallRecord {
        market_id,
        file_path: skill.file_path,
        agent_id: target_agent_id,
        skill_id: agent.agent_id.clone(),
        installed_at: current_millis().to_string(),
        source,
        scan_verdict: skill.scan_verdict.clone(),
        package_type: Some("agent".to_string()),
        package_id: skill.identifier.clone(),
        package_version: skill.version.unwrap_or_else(|| "1.0.0".to_string()),
        catalog_revision,
        artifact_sha256: skill.content_hash,
        target_authority: "station-agent".to_string(),
        last_readback_at: current_millis().to_string(),
        revoked_at: skill.revoked_at,
    };
    if let Err(result) = record_market_install(record) {
        return result;
    }
    success_payload(
        "skills_market_install",
        json!({
            "id": agent.agent_id,
            "identifier": skill.identifier,
            "name": skill.name,
            "isNew": true,
            "packageType": "agent",
            "scanVerdict": skill.scan_verdict,
            "targetAuthority": "station-agent",
            "targetReadback": true
        }),
    )
}

fn install_mcp_market_package(
    actor_ptid: &str,
    target_agent_id: String,
    market_id: String,
    catalog_revision: String,
    skill: MarketSkill,
    source: String,
) -> AppResult<StubPayload> {
    let content = match skill.artifact_text() {
        Ok(content) => content,
        Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
    };
    let server = match serde_json::from_str::<Value>(&content) {
        Ok(value) => value
            .get("server")
            .or_else(|| value.get("mcpServer"))
            .cloned()
            .unwrap_or(value),
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("invalid MCP server package JSON: {error}"),
                None,
            )
        }
    };
    let result = mcp::mcp_create_server(actor_ptid, McpCreateInput { data: server });
    let Some(payload) = result.data else {
        return result;
    };
    let value = serde_json::from_str::<Value>(&payload.status).unwrap_or_else(|_| json!({}));
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if name.is_empty() {
        return AppResult::fail(
            ErrorCode::InternalError,
            "MCP package installed without a server name",
            None,
        );
    }
    let readback = mcp::mcp_get_server(actor_ptid, McpNameInput { name: name.clone() });
    if !readback.ok {
        return AppResult::fail(
            ErrorCode::InternalError,
            "MARKETPLACE_TARGET_READBACK_FAILED",
            None,
        );
    }
    let record = MarketInstallRecord {
        market_id,
        file_path: skill.file_path,
        agent_id: target_agent_id,
        skill_id: name.clone(),
        installed_at: current_millis().to_string(),
        source,
        scan_verdict: skill.scan_verdict.clone(),
        package_type: Some("mcp".to_string()),
        package_id: skill.identifier.clone(),
        package_version: skill.version.unwrap_or_else(|| "1.0.0".to_string()),
        catalog_revision,
        artifact_sha256: skill.content_hash,
        target_authority: "desktop-mcp".to_string(),
        last_readback_at: current_millis().to_string(),
        revoked_at: skill.revoked_at,
    };
    if let Err(result) = record_market_install(record) {
        return result;
    }
    success_payload(
        "skills_market_install",
        json!({
            "id": name,
            "identifier": skill.identifier,
            "name": skill.name,
            "isNew": true,
            "packageType": "mcp",
            "scanVerdict": skill.scan_verdict,
            "targetAuthority": "desktop-mcp",
            "targetReadback": true
        }),
    )
}

fn verify_agent_absent(agent_id: &str, token: &str) -> Result<(), AppResult<StubPayload>> {
    let response = station_client::request_proto::<
        model::agent::ListAgentsRequest,
        model::agent::ListAgentsResponse,
    >(
        Method::POST,
        "/sub-agent/agent/list",
        token,
        None,
        Some(&model::agent::ListAgentsRequest {
            visibility: model::agent::AgentVisibility::Unspecified as i32,
            page: 1,
            page_size: 500,
        }),
    )
    .map_err(|error| station_error("skills_market_uninstall", error))?;
    if response
        .agents
        .iter()
        .any(|agent| agent.agent_id == agent_id)
    {
        Err(AppResult::fail(
            ErrorCode::InternalError,
            "MARKETPLACE_TARGET_DELETE_READBACK_FAILED",
            None,
        ))
    } else {
        Ok(())
    }
}

fn verify_skill_absent(
    agent_id: &str,
    skill_id: &str,
    token: &str,
) -> Result<(), AppResult<StubPayload>> {
    let response = station_client::request_proto::<
        model::agent::ListSkillsRequest,
        model::agent::ListSkillsResponse,
    >(
        Method::POST,
        SKILL_LIST_PATH,
        token,
        None,
        Some(&model::agent::ListSkillsRequest {
            agent_id: agent_id.to_string(),
            category: String::new(),
        }),
    )
    .map_err(|error| station_error("skills_market_uninstall", error))?;
    if response
        .skills
        .iter()
        .any(|skill| skill.skill_id == skill_id)
    {
        Err(AppResult::fail(
            ErrorCode::InternalError,
            "MARKETPLACE_TARGET_DELETE_READBACK_FAILED",
            None,
        ))
    } else {
        Ok(())
    }
}

fn verify_mcp_absent(actor_ptid: &str, server_name: &str) -> Result<(), AppResult<StubPayload>> {
    let result = mcp::mcp_list_servers(actor_ptid);
    let Some(payload) = result.data else {
        return Err(result);
    };
    let value = serde_json::from_str::<Value>(&payload.status).map_err(|error| {
        AppResult::fail(
            ErrorCode::InternalError,
            format!("failed to decode MCP readback: {error}"),
            None,
        )
    })?;
    let present = value
        .get("servers")
        .and_then(Value::as_array)
        .is_some_and(|servers| {
            servers
                .iter()
                .any(|server| server.get("name").and_then(Value::as_str) == Some(server_name))
        });
    if present {
        Err(AppResult::fail(
            ErrorCode::InternalError,
            "MARKETPLACE_TARGET_DELETE_READBACK_FAILED",
            None,
        ))
    } else {
        Ok(())
    }
}

pub fn skills_market_uninstall(
    actor_ptid: &str,
    input: SkillMarketDetailInput,
    token: &str,
) -> AppResult<StubPayload> {
    if input.market_id.trim().is_empty() || input.file_path.trim().is_empty() {
        return invalid_argument("market_id and file_path are required");
    }
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let target_agent_id = agent_id(input.agent_id.clone());
    let record = {
        let guard = match market_store().lock() {
            Ok(guard) => guard,
            Err(error) => {
                return AppResult::fail(
                    ErrorCode::InternalError,
                    format!("failed to access market store: {error}"),
                    None,
                )
            }
        };
        installed_record(&guard, &input.market_id, &input.file_path, &target_agent_id).cloned()
    };
    let Some(record) = record else {
        return AppResult::fail(ErrorCode::NotFound, "market package is not installed", None);
    };
    let package_type =
        record
            .package_type
            .as_deref()
            .unwrap_or(if record.scan_verdict == "manifest-validated" {
                "plugin"
            } else {
                "skill"
            });

    if package_type == "agent" {
        let result = agents::agents_delete(
            actor_ptid,
            token,
            AgentIdInput {
                id: record.skill_id.clone(),
            },
        );
        if !result.ok {
            return result;
        }
        if let Err(result) = verify_agent_absent(&record.skill_id, token) {
            return result;
        }
        if let Err(result) = remove_market_install_record(&record) {
            return result;
        }
        return success_payload(
            "skills_market_uninstall",
            json!({ "ok": true, "skillId": record.skill_id, "packageType": "agent" }),
        );
    }

    if package_type == "mcp" {
        let result = mcp::mcp_delete_server(
            actor_ptid,
            McpNameInput {
                name: record.skill_id.clone(),
            },
        );
        if !result.ok {
            return result;
        }
        if let Err(result) = verify_mcp_absent(actor_ptid, &record.skill_id) {
            return result;
        }
        if let Err(result) = remove_market_install_record(&record) {
            return result;
        }
        return success_payload(
            "skills_market_uninstall",
            json!({ "ok": true, "skillId": record.skill_id, "packageType": "mcp" }),
        );
    }

    if package_type == "plugin" {
        let result =
            plugins::uninstall_plugin_by_market_package(&record.market_id, &record.file_path);
        if !result.ok {
            return result;
        }
        if let Err(result) = remove_market_install_record(&record) {
            return result;
        }
        return success_payload(
            "skills_market_uninstall",
            json!({ "ok": true, "skillId": record.skill_id, "packageType": "plugin" }),
        );
    }
    let req = model::agent::DeleteSkillRequest {
        agent_id: record.agent_id.clone(),
        skill_id: record.skill_id.clone(),
    };
    if let Err(err) = station_client::request_proto::<
        model::agent::DeleteSkillRequest,
        model::agent::DeleteSkillResponse,
    >(Method::POST, SKILL_DELETE_PATH, token, None, Some(&req))
    {
        return station_error("skills_market_uninstall", err);
    }
    if let Err(result) = verify_skill_absent(&record.agent_id, &record.skill_id, token) {
        return result;
    }
    if let Err(result) = remove_market_install_record(&record) {
        return result;
    }
    success_payload(
        "skills_market_uninstall",
        json!({ "ok": true, "skillId": record.skill_id, "packageType": "skill" }),
    )
}

fn remove_market_install_record(
    record: &MarketInstallRecord,
) -> Result<(), AppResult<StubPayload>> {
    let mut guard = match market_store().lock() {
        Ok(guard) => guard,
        Err(error) => {
            return Err(AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to access market store: {error}"),
                None,
            ))
        }
    };
    guard.installed.retain(|item| {
        !(item.market_id == record.market_id
            && item.file_path == record.file_path
            && item.agent_id == record.agent_id)
    });
    if let Err(error) = persist_market_store(&guard) {
        return Err(persist_error(error));
    }
    Ok(())
}

fn sha256_short(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    hex::encode(&digest[..6])
}

fn sha256_hex(value: &[u8]) -> String {
    hex::encode(Sha256::digest(value))
}

fn current_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skill_content_validation_accepts_frontmatter_name() {
        let name = validate_skill_content("---\nname: Code Review\n---\nReview code.", "fallback")
            .expect("valid skill content");
        assert_eq!(name, "Code Review");
    }

    #[test]
    fn default_market_contains_real_governed_package_types() {
        let store = MarketStore::default();
        let source = store.sources.first().expect("default source");
        assert!(source.built_in);
        assert_eq!(source.transport_kind, TRANSPORT_OFFICIAL_STATION);
        assert!(source.url.is_empty());
        assert!(source.branch.is_none());
        assert!(source.manifest_path.is_empty());
        assert_eq!(source.signature_status, "verified");
        assert_eq!(source.sync_state, CATALOG_SYNC_BOOTSTRAP_VERIFIED);
        for package_type in ["agent", "skill", "mcp"] {
            assert!(source
                .skills
                .iter()
                .any(|item| item.package_type.as_deref() == Some(package_type)));
        }
        assert!(source
            .skills
            .iter()
            .any(|item| { item.revoked_at.is_some() && item.install_policy == INSTALL_BLOCKED }));
    }

    #[test]
    fn install_policy_requires_acknowledgement_and_blocks_revocation() {
        let store = MarketStore::default();
        let source = store.sources.first().expect("default source");
        let agent = source
            .skills
            .iter()
            .find(|item| item.package_type.as_deref() == Some("agent"))
            .expect("Agent package");
        assert_eq!(
            validate_market_install_policy(agent, false),
            Err("MARKETPLACE_RISK_CONFIRMATION_REQUIRED")
        );
        assert_eq!(validate_market_install_policy(agent, true), Ok(()));

        let revoked = source
            .skills
            .iter()
            .find(|item| item.revoked_at.is_some())
            .expect("revoked package");
        assert_eq!(
            validate_market_install_policy(revoked, true),
            Err("MARKETPLACE_PACKAGE_REVOKED_OR_BLOCKED")
        );
    }

    #[test]
    fn cursor_is_bound_to_source_revision_and_query() {
        let cursor = encode_page_cursor("source-a", "revision-1", "review", 2);
        assert_eq!(
            decode_page_cursor(Some(&cursor), "source-a", "revision-1", "review"),
            Ok(2)
        );
        assert!(decode_page_cursor(Some(&cursor), "source-b", "revision-1", "review").is_err());
        assert!(decode_page_cursor(Some(&cursor), "source-a", "revision-2", "review").is_err());
        assert!(decode_page_cursor(Some(&cursor), "source-a", "revision-1", "other").is_err());
    }

    #[test]
    fn catalog_pages_do_not_overlap_and_keep_one_revision() {
        let store = MarketStore::default();
        let source = store.sources.first().expect("default source");
        let (first, total, cursor) =
            paginate_market_skills(source, "", None, 1).expect("first page");
        let cursor = cursor.expect("next cursor");
        let (second, second_total, second_cursor) =
            paginate_market_skills(source, "", Some(&cursor), 1).expect("second page");
        assert_eq!(total, source.skills.len());
        assert_eq!(second_total, total);
        assert_ne!(first[0].identifier, second[0].identifier);
        assert!(second_cursor.is_some());
    }

    #[test]
    fn catalog_update_compares_normalized_rfc3339_timestamps() {
        let store = MarketStore::default();
        let mut source = store.sources.first().expect("default source").clone();
        source.generated_at = "2026-09-17T01:00:00+01:00".to_string();
        let mut catalog = default_catalog().expect("default catalog");
        catalog.revision = "2026.09.17.2".to_string();
        catalog.generated_at = "2026-09-17T00:30:00Z".to_string();

        assert!(validate_catalog_update(&source, &catalog, "new-envelope").is_ok());
    }

    #[test]
    fn official_transport_accepts_exact_bytes_and_digest() {
        let envelope = default_envelope_json()
            .expect("default envelope")
            .as_bytes()
            .to_vec();
        let fetch =
            validate_official_catalog_response(model::agent::GetOfficialPackageCatalogResponse {
                envelope_sha256: sha256_hex(&envelope),
                envelope_json: envelope,
                media_type: "application/json".to_string(),
                distribution_id: OFFICIAL_CATALOG_DISTRIBUTION_ID.to_string(),
            })
            .expect("valid official response");
        assert_eq!(fetch.transport_kind, TRANSPORT_OFFICIAL_STATION);
        assert_eq!(fetch.endpoint, OFFICIAL_CATALOG_ENDPOINT);
        assert_eq!(
            verify_catalog(&default_source(), &fetch.envelope,)
                .expect("signed catalog")
                .signature_status,
            "verified",
        );
    }

    #[test]
    fn official_transport_rejects_tampered_bytes_before_signature_verification() {
        let mut envelope = default_envelope_json()
            .expect("default envelope")
            .as_bytes()
            .to_vec();
        let digest = sha256_hex(&envelope);
        envelope[0] ^= 0xff;
        let error =
            validate_official_catalog_response(model::agent::GetOfficialPackageCatalogResponse {
                envelope_sha256: digest,
                envelope_json: envelope,
                media_type: "application/json".to_string(),
                distribution_id: OFFICIAL_CATALOG_DISTRIBUTION_ID.to_string(),
            })
            .expect_err("tampered response must fail");
        assert_eq!(error, "OFFICIAL_CATALOG_TRANSPORT_DIGEST_INVALID");
    }

    #[test]
    fn failed_official_sync_retains_last_verified_snapshot_as_stale() {
        let mut source = MarketStore::default()
            .sources
            .into_iter()
            .next()
            .expect("default source");
        let revision = source.catalog_revision.clone();
        let envelope = source.verified_envelope.clone();
        let package_ids = source
            .skills
            .iter()
            .map(|package| package.identifier.clone())
            .collect::<Vec<_>>();

        mark_catalog_sync_failed(
            &mut source,
            "OFFICIAL_CATALOG_ENDPOINT_UNAVAILABLE".to_string(),
            "123".to_string(),
        );

        assert_eq!(source.sync_state, CATALOG_SYNC_STALE_VERIFIED);
        assert_eq!(source.catalog_revision, revision);
        assert_eq!(source.verified_envelope, envelope);
        assert_eq!(
            source
                .skills
                .iter()
                .map(|package| package.identifier.clone())
                .collect::<Vec<_>>(),
            package_ids,
        );
        assert_eq!(
            source.error.as_deref(),
            Some("OFFICIAL_CATALOG_ENDPOINT_UNAVAILABLE"),
        );
    }

    #[test]
    fn official_transport_does_not_send_an_unauthenticated_request() {
        let source = MarketStore::default()
            .sources
            .into_iter()
            .next()
            .expect("default source");
        assert_eq!(
            fetch_catalog_envelope(&source, "").expect_err("missing token must fail"),
            "OFFICIAL_CATALOG_AUTHORIZATION_FAILED",
        );
    }

    #[test]
    fn old_station_endpoint_maps_to_typed_stale_reason() {
        let error = station_client::StationClientError::new(
            station_client::StationClientErrorKind::HttpStatus(404),
            "not found",
            None,
        );
        assert_eq!(
            official_catalog_transport_error(error),
            "OFFICIAL_CATALOG_ENDPOINT_UNAVAILABLE",
        );
    }

    #[test]
    fn legacy_unsigned_source_is_disabled_during_load_normalization() {
        let file: MarketStoreFile = serde_json::from_str(
            r#"{"sources":[{"id":"legacy","name":"Legacy","url":"https://example.test/index.json","skills":[]}],"installed":[]}"#,
        )
        .expect("legacy store");
        let store = normalize_market_store(MarketStore {
            sources: file.sources,
            installed: file.installed,
        });
        let legacy = store
            .sources
            .iter()
            .find(|source| source.id == "legacy")
            .expect("legacy source");
        assert!(!legacy.enabled);
        assert_eq!(legacy.signature_status, "invalid");
        assert_eq!(
            legacy.error.as_deref(),
            Some("LEGACY_UNSIGNED_CATALOG_SOURCE_DISABLED")
        );
        assert!(store
            .sources
            .iter()
            .any(|source| source.id == DEFAULT_SOURCE_ID));
    }

    #[test]
    fn catalog_projection_uses_verified_metadata_and_authority_readback() {
        let store = MarketStore::default();
        let source = store.sources.first().expect("default source");
        let skill = source
            .skills
            .iter()
            .find(|item| item.package_type.as_deref() == Some("skill") && item.revoked_at.is_none())
            .expect("active skill");
        let record = MarketInstallRecord {
            market_id: source.id.clone(),
            file_path: skill.file_path.clone(),
            agent_id: "assistant".to_string(),
            skill_id: "skill-1".to_string(),
            installed_at: "2".to_string(),
            source: skill.source.clone().unwrap_or_default(),
            scan_verdict: "safe".to_string(),
            package_type: Some("skill".to_string()),
            package_id: skill.identifier.clone(),
            package_version: skill.version.clone().unwrap_or_default(),
            catalog_revision: source.catalog_revision.clone(),
            artifact_sha256: skill.content_hash.clone(),
            target_authority: "station-skill".to_string(),
            last_readback_at: "3".to_string(),
            revoked_at: None,
        };
        let item = market_skill_to_json(&source.id, skill, Some(&record));
        assert_eq!(
            item.get("signatureStatus").and_then(Value::as_str),
            Some("verified")
        );
        assert_eq!(
            item.get("targetAuthority").and_then(Value::as_str),
            Some("station-skill")
        );
        assert_eq!(
            item.get("installPolicy").and_then(Value::as_str),
            Some(INSTALL_ALLOWED)
        );
    }
}
