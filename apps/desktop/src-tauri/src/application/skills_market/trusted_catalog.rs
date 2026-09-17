use crate::model;
use base64::prelude::*;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use prost::Message;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

pub(crate) const DEFAULT_SOURCE_ID: &str = "peers-official";
pub(crate) const CATALOG_ENVELOPE_SCHEMA: &str = "peers.package-catalog.envelope.v1";
pub(crate) const CATALOG_PAYLOAD_SCHEMA: &str = "peers.package-catalog.v1";
pub(crate) const INSTALL_ALLOWED: &str = "allowed";
pub(crate) const INSTALL_CONFIRMATION_REQUIRED: &str = "confirmation_required";
pub(crate) const INSTALL_BLOCKED: &str = "blocked";
pub(crate) const TRANSPORT_OFFICIAL_STATION: &str = "official_station";
pub(crate) const TRANSPORT_USER_PINNED_GITHUB: &str = "user_pinned_github";
const SIGNATURE_DOMAIN: &[u8] = b"peers-touch/package-catalog/v1\0";
const MAX_CATALOG_BYTES: usize = 2 * 1024 * 1024;
const MAX_ARTIFACT_BYTES: usize = 512 * 1024;
const MAX_PACKAGES: usize = 500;
const DEFAULT_PUBLISHER_ID: &str = "peers-labs";
const DEFAULT_SIGNING_KEY_ID: &str = "peers-marketplace-2026-01";
const DEFAULT_PUBLIC_KEY_BASE64: &str = "S0WiI5NaYr+jhd4C6uykn9JH9zdQy5afs2jcqCpAVo0=";
const DEFAULT_ENVELOPE: &[u8] =
    include_bytes!("../../../../../../packages/agent-catalog/official-catalog.v1.envelope.json");

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogSourceRegistration {
    pub source_id: String,
    pub display_name: String,
    pub transport_kind: String,
    pub repository: String,
    pub branch: String,
    pub manifest_path: String,
    pub publisher_id: String,
    pub signing_key_id: String,
    pub public_key_base64: String,
    pub trust_class: String,
    pub built_in: bool,
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CatalogEnvelopeV1 {
    schema_version: String,
    payload_base64: String,
    signing_key_id: String,
    signature_base64: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CatalogSnapshotV1 {
    schema_version: String,
    source_id: String,
    publisher_id: String,
    revision: String,
    generated_at: String,
    #[serde(default)]
    revoked_at: Option<String>,
    packages: Vec<CatalogPackage>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CatalogPackage {
    pub package_id: String,
    pub package_type: String,
    pub version: String,
    pub name: String,
    pub description: String,
    pub publisher_id: String,
    pub artifact_encoding: String,
    pub artifact_content_base64: String,
    pub artifact_sha256: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub homepage: String,
    #[serde(default)]
    pub repository: String,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub revoked_at: Option<String>,
    #[serde(default)]
    pub trust_level: String,
    #[serde(default)]
    pub risk_level: String,
    #[serde(default)]
    pub scan_verdict: String,
    #[serde(default)]
    pub install_policy: String,
}

impl CatalogPackage {
    pub(crate) fn artifact_bytes(&self) -> Result<Vec<u8>, String> {
        let bytes = BASE64_STANDARD
            .decode(self.artifact_content_base64.trim())
            .map_err(|error| format!("catalog artifact is not valid base64: {error}"))?;
        if bytes.len() > MAX_ARTIFACT_BYTES {
            return Err(format!(
                "catalog artifact exceeds {} bytes",
                MAX_ARTIFACT_BYTES
            ));
        }
        Ok(bytes)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifiedCatalog {
    pub source_id: String,
    pub publisher_id: String,
    pub revision: String,
    pub generated_at: String,
    pub revoked_at: Option<String>,
    pub signing_key_id: String,
    pub signature_status: String,
    pub packages: Vec<CatalogPackage>,
}

pub(crate) fn default_source() -> CatalogSourceRegistration {
    CatalogSourceRegistration {
        source_id: DEFAULT_SOURCE_ID.to_string(),
        display_name: "Peers Official".to_string(),
        transport_kind: TRANSPORT_OFFICIAL_STATION.to_string(),
        repository: String::new(),
        branch: String::new(),
        manifest_path: String::new(),
        publisher_id: DEFAULT_PUBLISHER_ID.to_string(),
        signing_key_id: DEFAULT_SIGNING_KEY_ID.to_string(),
        public_key_base64: DEFAULT_PUBLIC_KEY_BASE64.to_string(),
        trust_class: "official".to_string(),
        built_in: true,
        enabled: true,
    }
}

pub(crate) fn default_catalog() -> Result<VerifiedCatalog, String> {
    verify_catalog(&default_source(), default_envelope_json()?)
}

pub(crate) fn default_envelope_json() -> Result<&'static str, String> {
    std::str::from_utf8(DEFAULT_ENVELOPE)
        .map_err(|_| "bundled catalog envelope must be UTF-8".to_string())
}

pub(crate) fn verify_catalog(
    source: &CatalogSourceRegistration,
    envelope_json: &str,
) -> Result<VerifiedCatalog, String> {
    validate_source_registration(source)?;
    if envelope_json.as_bytes().len() > MAX_CATALOG_BYTES {
        return Err(format!(
            "catalog envelope exceeds {} bytes",
            MAX_CATALOG_BYTES
        ));
    }
    let envelope: CatalogEnvelopeV1 = serde_json::from_str(envelope_json)
        .map_err(|error| format!("invalid catalog envelope JSON: {error}"))?;
    if envelope.schema_version != CATALOG_ENVELOPE_SCHEMA {
        return Err("unsupported catalog envelope schema".to_string());
    }
    if envelope.signing_key_id != source.signing_key_id {
        return Err("catalog signing key does not match pinned source key".to_string());
    }

    let payload = BASE64_STANDARD
        .decode(envelope.payload_base64.trim())
        .map_err(|error| format!("catalog payload is not valid base64: {error}"))?;
    if payload.len() > MAX_CATALOG_BYTES {
        return Err(format!(
            "catalog payload exceeds {} bytes",
            MAX_CATALOG_BYTES
        ));
    }
    let public_key = BASE64_STANDARD
        .decode(source.public_key_base64.trim())
        .map_err(|error| format!("catalog public key is not valid base64: {error}"))?;
    let public_key: [u8; 32] = public_key
        .try_into()
        .map_err(|_| "catalog public key must contain 32 bytes".to_string())?;
    let verifying_key = VerifyingKey::from_bytes(&public_key)
        .map_err(|error| format!("catalog public key is invalid: {error}"))?;
    let signature = BASE64_STANDARD
        .decode(envelope.signature_base64.trim())
        .map_err(|error| format!("catalog signature is not valid base64: {error}"))?;
    let signature = Signature::from_slice(&signature)
        .map_err(|error| format!("catalog signature is invalid: {error}"))?;
    let mut signed = Vec::with_capacity(SIGNATURE_DOMAIN.len() + payload.len());
    signed.extend_from_slice(SIGNATURE_DOMAIN);
    signed.extend_from_slice(&payload);
    verifying_key
        .verify(&signed, &signature)
        .map_err(|_| "catalog signature verification failed".to_string())?;

    let mut snapshot: CatalogSnapshotV1 = serde_json::from_slice(&payload)
        .map_err(|error| format!("invalid catalog payload JSON: {error}"))?;
    if snapshot.schema_version != CATALOG_PAYLOAD_SCHEMA {
        return Err("unsupported catalog payload schema".to_string());
    }
    if snapshot.source_id != source.source_id || snapshot.publisher_id != source.publisher_id {
        return Err("catalog source or publisher does not match pinned registration".to_string());
    }
    if snapshot.revision.trim().is_empty() || snapshot.revision.len() > 96 {
        return Err("catalog revision is invalid".to_string());
    }
    validate_catalog_timestamp(&snapshot.generated_at, "catalog generatedAt")?;
    if let Some(revoked_at) = snapshot.revoked_at.as_deref() {
        validate_catalog_timestamp(revoked_at, "catalog revokedAt")?;
    }
    if snapshot.packages.is_empty() || snapshot.packages.len() > MAX_PACKAGES {
        return Err(format!(
            "catalog must contain between 1 and {} packages",
            MAX_PACKAGES
        ));
    }

    let source_revoked = snapshot.revoked_at.is_some() || !source.enabled;
    let mut identities = HashSet::with_capacity(snapshot.packages.len());
    for package in &mut snapshot.packages {
        validate_package_identity(package, source)?;
        if let Some(revoked_at) = package.revoked_at.as_deref() {
            validate_catalog_timestamp(revoked_at, "package revokedAt")?;
        }
        let identity = format!(
            "{}:{}:{}",
            package.package_type, package.package_id, package.version
        );
        if !identities.insert(identity) {
            return Err("catalog contains a duplicate package identity".to_string());
        }
        let artifact = package.artifact_bytes()?;
        let actual_hash = format!("sha256:{}", hex::encode(Sha256::digest(&artifact)));
        if actual_hash != package.artifact_sha256.to_ascii_lowercase() {
            return Err(format!(
                "catalog artifact hash mismatch for {}",
                package.package_id
            ));
        }
        let (scan_verdict, risk_level) = scan_package(package, &artifact)?;
        package.trust_level = source.trust_class.clone();
        package.scan_verdict = scan_verdict.to_string();
        package.risk_level = risk_level.to_string();
        package.install_policy = if source_revoked || package.revoked_at.is_some() {
            INSTALL_BLOCKED.to_string()
        } else if scan_verdict != "passed" {
            INSTALL_BLOCKED.to_string()
        } else if risk_level == "high" {
            INSTALL_CONFIRMATION_REQUIRED.to_string()
        } else {
            INSTALL_ALLOWED.to_string()
        };
    }

    Ok(VerifiedCatalog {
        source_id: snapshot.source_id,
        publisher_id: snapshot.publisher_id,
        revision: snapshot.revision,
        generated_at: snapshot.generated_at,
        revoked_at: snapshot.revoked_at,
        signing_key_id: source.signing_key_id.clone(),
        signature_status: "verified".to_string(),
        packages: snapshot.packages,
    })
}

pub(crate) fn github_raw_manifest_url(
    source: &CatalogSourceRegistration,
) -> Result<String, String> {
    validate_source_registration(source)?;
    if source.transport_kind != TRANSPORT_USER_PINNED_GITHUB {
        return Err("catalog source does not use GitHub transport".to_string());
    }
    let url = validate_github_transport(source)?;
    let segments = url
        .path_segments()
        .map(|segments| {
            segments
                .filter(|segment| !segment.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if segments.len() != 2
        || !safe_path_segment(segments[0])
        || !safe_path_segment(segments[1].trim_end_matches(".git"))
    {
        return Err("catalog repository must identify one GitHub owner/repository".to_string());
    }
    Ok(format!(
        "https://raw.githubusercontent.com/{}/{}/{}/{}",
        segments[0],
        segments[1].trim_end_matches(".git"),
        source.branch,
        source.manifest_path
    ))
}

pub(crate) fn public_key_fingerprint(public_key_base64: &str) -> Result<String, String> {
    let key = BASE64_STANDARD
        .decode(public_key_base64.trim())
        .map_err(|error| format!("catalog public key is not valid base64: {error}"))?;
    if key.len() != 32 || key.iter().all(|byte| *byte == 0) {
        return Err("catalog public key must contain 32 bytes".to_string());
    }
    Ok(format!("sha256:{}", hex::encode(Sha256::digest(key))))
}

fn validate_source_registration(source: &CatalogSourceRegistration) -> Result<(), String> {
    for (label, value) in [
        ("source id", source.source_id.as_str()),
        ("display name", source.display_name.as_str()),
        ("publisher id", source.publisher_id.as_str()),
        ("signing key id", source.signing_key_id.as_str()),
    ] {
        if value.trim().is_empty() || value.len() > 160 {
            return Err(format!("catalog {label} is invalid"));
        }
    }
    if !source
        .source_id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
    {
        return Err("catalog source id contains unsupported characters".to_string());
    }
    if !matches!(source.trust_class.as_str(), "official" | "user-pinned") {
        return Err("catalog trust class is invalid".to_string());
    }
    public_key_fingerprint(&source.public_key_base64)?;
    match source.transport_kind.as_str() {
        TRANSPORT_OFFICIAL_STATION => {
            if source.source_id != DEFAULT_SOURCE_ID
                || !source.built_in
                || source.trust_class != "official"
                || !source.repository.is_empty()
                || !source.branch.is_empty()
                || !source.manifest_path.is_empty()
            {
                return Err("official Station catalog registration is invalid".to_string());
            }
            Ok(())
        }
        TRANSPORT_USER_PINNED_GITHUB => {
            if source.built_in || source.trust_class != "user-pinned" {
                return Err("user-pinned GitHub catalog registration is invalid".to_string());
            }
            validate_github_transport(source).map(|_| ())
        }
        _ => Err("catalog transport kind is invalid".to_string()),
    }
}

fn validate_github_transport(source: &CatalogSourceRegistration) -> Result<Url, String> {
    let url = Url::parse(source.repository.trim())
        .map_err(|error| format!("invalid catalog repository URL: {error}"))?;
    if url.scheme() != "https" || url.host_str() != Some("github.com") {
        return Err("catalog repository must be an https://github.com repository".to_string());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("catalog repository URL cannot include query or fragment".to_string());
    }
    validate_relative_path(&source.branch)?;
    validate_relative_path(&source.manifest_path)?;
    Ok(url)
}

fn validate_catalog_timestamp(value: &str, label: &str) -> Result<(), String> {
    OffsetDateTime::parse(value.trim(), &Rfc3339)
        .map(|_| ())
        .map_err(|error| format!("{label} is not RFC3339: {error}"))
}

fn validate_package_identity(
    package: &CatalogPackage,
    source: &CatalogSourceRegistration,
) -> Result<(), String> {
    if package.package_id.trim().is_empty()
        || package.package_id.len() > 160
        || !package
            .package_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
        || package.name.trim().is_empty()
        || package.name.len() > 160
    {
        return Err("catalog package identity is invalid".to_string());
    }
    if !matches!(package.package_type.as_str(), "agent" | "skill" | "mcp") {
        return Err(format!(
            "catalog package {} has unsupported type",
            package.package_id
        ));
    }
    if package.publisher_id != source.publisher_id {
        return Err(format!(
            "catalog package {} publisher does not match source",
            package.package_id
        ));
    }
    if !valid_semver(&package.version) {
        return Err(format!(
            "catalog package {} version is invalid",
            package.package_id
        ));
    }
    if !package
        .artifact_sha256
        .strip_prefix("sha256:")
        .is_some_and(|digest| digest.len() == 64 && digest.chars().all(|ch| ch.is_ascii_hexdigit()))
    {
        return Err(format!(
            "catalog package {} artifact hash is invalid",
            package.package_id
        ));
    }
    Ok(())
}

fn scan_package(
    package: &CatalogPackage,
    artifact: &[u8],
) -> Result<(&'static str, &'static str), String> {
    match package.package_type.as_str() {
        "agent" => {
            if package.artifact_encoding != "protobuf-base64" {
                return Err("Agent catalog artifacts must use protobuf-base64".to_string());
            }
            let document = model::agent::AgentPackageDocument::decode(artifact)
                .map_err(|error| format!("invalid Agent package protobuf: {error}"))?;
            if document.schema_version != "peers.agent.package.v1"
                || document
                    .agent
                    .as_ref()
                    .is_none_or(|agent| agent.name.trim().is_empty())
            {
                return Err("Agent catalog package schema is invalid".to_string());
            }
            Ok(("passed", "high"))
        }
        "skill" => {
            if package.artifact_encoding != "utf8-base64" {
                return Err("Skill catalog artifacts must use utf8-base64".to_string());
            }
            let content = std::str::from_utf8(artifact)
                .map_err(|_| "Skill catalog artifact must be UTF-8".to_string())?;
            if content.trim().is_empty() {
                return Err("Skill catalog artifact is empty".to_string());
            }
            let lower = content.to_ascii_lowercase();
            let risk = if ["rm -rf", "shell", "exec(", "child_process", "filesystem"]
                .iter()
                .any(|needle| lower.contains(needle))
            {
                "high"
            } else {
                "low"
            };
            Ok(("passed", risk))
        }
        "mcp" => {
            if package.artifact_encoding != "json-base64" {
                return Err("MCP catalog artifacts must use json-base64".to_string());
            }
            let value: Value = serde_json::from_slice(artifact)
                .map_err(|error| format!("invalid MCP catalog JSON: {error}"))?;
            let server = value
                .get("server")
                .or_else(|| value.get("mcpServer"))
                .unwrap_or(&value);
            let server_type = server.get("type").and_then(Value::as_str).unwrap_or("");
            let name = server.get("name").and_then(Value::as_str).unwrap_or("");
            if name.trim().is_empty() || !matches!(server_type, "stdio" | "http" | "sse") {
                return Err("MCP catalog package schema is invalid".to_string());
            }
            Ok((
                "passed",
                if server_type == "stdio" {
                    "high"
                } else {
                    "medium"
                },
            ))
        }
        _ => Err("unsupported catalog package type".to_string()),
    }
}

fn valid_semver(value: &str) -> bool {
    let core = value.split_once('-').map(|(core, _)| core).unwrap_or(value);
    let parts = core.split('.').collect::<Vec<_>>();
    parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|ch| ch.is_ascii_digit()))
}

fn safe_path_segment(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
}

fn validate_relative_path(value: &str) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty()
        || value.starts_with('/')
        || value.contains('\\')
        || value
            .split('/')
            .any(|part| part == ".." || !safe_path_segment(part))
    {
        return Err("catalog branch or manifest path is invalid".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user_pinned_source() -> CatalogSourceRegistration {
        CatalogSourceRegistration {
            source_id: "user-source".to_string(),
            display_name: "User Source".to_string(),
            transport_kind: TRANSPORT_USER_PINNED_GITHUB.to_string(),
            repository: "https://github.com/example/catalog".to_string(),
            branch: "main".to_string(),
            manifest_path: "packages/catalog/envelope.json".to_string(),
            publisher_id: "example".to_string(),
            signing_key_id: "example-key".to_string(),
            public_key_base64: DEFAULT_PUBLIC_KEY_BASE64.to_string(),
            trust_class: "user-pinned".to_string(),
            built_in: false,
            enabled: true,
        }
    }

    #[test]
    fn bundled_catalog_verifies_and_derives_policy() {
        let catalog = default_catalog().expect("default catalog");
        assert_eq!(catalog.source_id, DEFAULT_SOURCE_ID);
        assert_eq!(catalog.signature_status, "verified");
        assert!(catalog
            .packages
            .iter()
            .any(|package| package.package_type == "agent"));
        assert!(catalog
            .packages
            .iter()
            .any(|package| package.package_type == "skill"));
        assert!(catalog
            .packages
            .iter()
            .any(|package| package.package_type == "mcp"));
        assert!(catalog.packages.iter().any(|package| {
            package.package_type == "agent"
                && package.install_policy == INSTALL_CONFIRMATION_REQUIRED
        }));
        assert!(catalog.packages.iter().any(|package| {
            package.revoked_at.is_some() && package.install_policy == INSTALL_BLOCKED
        }));
    }

    #[test]
    fn tampered_catalog_is_rejected() {
        let source = default_source();
        let tampered = default_envelope_json().expect("default envelope").replacen(
            "payloadBase64",
            "payloadBase65",
            1,
        );
        let error = verify_catalog(&source, &tampered).expect_err("tamper must fail");
        assert!(error.contains("payload") || error.contains("envelope"));
    }

    #[test]
    fn repository_and_branch_resolve_to_raw_manifest() {
        let source = user_pinned_source();
        assert_eq!(
            github_raw_manifest_url(&source).expect("raw URL"),
            "https://raw.githubusercontent.com/example/catalog/main/packages/catalog/envelope.json"
        );
    }

    #[test]
    fn arbitrary_json_url_is_not_a_catalog_repository() {
        let mut source = user_pinned_source();
        source.repository = "https://example.test/catalog.json".to_string();
        assert!(github_raw_manifest_url(&source).is_err());
    }

    #[test]
    fn source_cannot_replace_the_pinned_key() {
        let mut source = default_source();
        source.public_key_base64 = BASE64_STANDARD.encode([7_u8; 32]);
        let error = verify_catalog(&source, default_envelope_json().expect("default envelope"))
            .expect_err("wrong key must fail");
        assert!(error.contains("signature"));
    }

    #[test]
    fn official_source_has_no_github_transport_fields() {
        let source = default_source();
        assert_eq!(source.transport_kind, TRANSPORT_OFFICIAL_STATION);
        assert!(source.repository.is_empty());
        assert!(source.branch.is_empty());
        assert!(source.manifest_path.is_empty());
        assert!(github_raw_manifest_url(&source).is_err());
    }

    #[test]
    fn catalog_timestamps_must_be_rfc3339() {
        assert!(validate_catalog_timestamp("2026-09-17T00:00:00Z", "generatedAt").is_ok());
        assert!(validate_catalog_timestamp("17 September 2026", "generatedAt").is_err());
    }
}
