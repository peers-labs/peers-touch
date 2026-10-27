//! Default workspace resource grants for the local capability worker.
//!
//! The usability plan sanctions one default workspace root per actor/device
//! under the application-data directory. Read/write/shell capabilities stay
//! fenced by per-call approvals; these grants only describe the opaque
//! resource root Station pins onto dispatched envelopes. Absolute local
//! paths never leave the device.

use super::resource_registry::{RegisterResource, ResourceRegistry, RESOURCE_KIND_GRANT};
use crate::infrastructure::storage;
use crate::model::agent::{ClientCapability, ClientCapabilityLease, ClientResourceRef};
use prost_types::Timestamp;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Grants remain valid for one lease window beyond the active lease; the
/// worker re-declares on every register and renew.
const GRANT_LEASE_SKEW_SECONDS: i64 = 24 * 60 * 60;
const WORKSPACE_RESOURCE_KIND: &str = "workspace";

/// A grant paired with the local locator it resolves to. Station never sees
/// the locator; the local resource registry does.
pub(crate) struct WorkspaceGrant {
    pub reference: ClientResourceRef,
    pub locator: String,
}

/// Provisions the persistent default workspace root for one actor/device.
pub(crate) fn provision_actor_workspace(
    actor_ptid: &str,
    device_id: &str,
) -> Result<PathBuf, String> {
    let scope = hex::encode(Sha256::digest(
        format!("{actor_ptid}\x00{device_id}").as_bytes(),
    ));
    let root = storage::application_data_root()
        .map_err(|error| format!("resolve agent workspace root: {error}"))?
        .join("agent-workspaces")
        .join(&scope[..32]);
    fs::create_dir_all(&root).map_err(|error| format!("create agent workspace root: {error}"))?;
    // Tools report canonical absolute paths (they canonicalize the guarded
    // root); locators stored against grants must use the same form so claim
    // prefix matching is exact.
    fs::canonicalize(&root).map_err(|error| format!("canonicalize agent workspace root: {error}"))
}

/// Builds one opaque resource grant per leased capability whose constraints
/// require a workspace root.
pub(crate) fn build_workspace_grants(
    lease: &ClientCapabilityLease,
    workspace_root: &Path,
) -> Result<Vec<WorkspaceGrant>, String> {
    let expires_at = grant_expiry(lease)?;
    if timestamp_ms(&expires_at)? <= now_unix_ms() {
        return Err("resource grant expiry is not in the future".to_string());
    }
    let locator = workspace_root
        .to_str()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "agent workspace root is not valid UTF-8".to_string())?;
    let permission_grant_id = deterministic_id(
        "pgrant-wks",
        &[
            lease.ptid.as_bytes(),
            lease.device_id.as_bytes(),
            locator.as_bytes(),
        ],
    );
    let integrity_hash = hex::encode(Sha256::digest(
        format!("{WORKSPACE_RESOURCE_KIND}\n{locator}").as_bytes(),
    ));

    let mut grants = Vec::new();
    for capability in &lease.capabilities {
        if !requires_workspace_grant(capability) {
            continue;
        }
        let capability_id = capability.capability_id.as_str();
        let resource_ref = deterministic_id(
            "wks",
            &[
                lease.ptid.as_bytes(),
                lease.device_id.as_bytes(),
                capability_id.as_bytes(),
                locator.as_bytes(),
            ],
        );
        grants.push(WorkspaceGrant {
            reference: ClientResourceRef {
                resource_ref,
                ptid: lease.ptid.clone(),
                device_id: lease.device_id.clone(),
                capability_session_id: lease.capability_session_id.clone(),
                capability_id: capability.capability_id.clone(),
                expires_at: Some(expires_at.clone()),
                permission_grant_id: permission_grant_id.clone(),
                integrity_hash: integrity_hash.clone(),
            },
            locator: locator.to_string(),
        });
    }
    // Deterministic order keeps declarations byte-stable across renewals.
    grants.sort_by(|left, right| {
        left.reference
            .capability_id
            .cmp(&right.reference.capability_id)
    });
    Ok(grants)
}

/// Registers the grants in the device-local opaque resource registry.
pub(crate) fn register_workspace_grants(
    registry: &ResourceRegistry,
    session_id: &str,
    grants: &[WorkspaceGrant],
) -> Result<(), String> {
    for grant in grants {
        let expires_at_ms = timestamp_ms(
            grant
                .reference
                .expires_at
                .as_ref()
                .ok_or_else(|| "resource grant expiry is required".to_string())?,
        )?;
        registry.register(RegisterResource {
            opaque_ref: &grant.reference.resource_ref,
            capability_session_id: session_id,
            capability_id: &grant.reference.capability_id,
            permission_grant_id: &grant.reference.permission_grant_id,
            integrity_hash: &grant.reference.integrity_hash,
            locator: &grant.locator,
            expires_at_ms,
            resource_kind: RESOURCE_KIND_GRANT,
        })?;
    }
    Ok(())
}

fn requires_workspace_grant(capability: &ClientCapability) -> bool {
    capability
        .constraints
        .as_ref()
        .is_some_and(|constraints| {
            constraints
                .allowed_resource_kinds
                .iter()
                .any(|kind| kind == WORKSPACE_RESOURCE_KIND)
        })
}

fn grant_expiry(lease: &ClientCapabilityLease) -> Result<Timestamp, String> {
    let lease_expiry = lease
        .expires_at
        .as_ref()
        .ok_or_else(|| "capability lease expiry is required".to_string())?;
    Ok(Timestamp {
        seconds: lease_expiry
            .seconds
            .saturating_add(GRANT_LEASE_SKEW_SECONDS),
        nanos: lease_expiry.nanos,
    })
}

fn timestamp_ms(value: &Timestamp) -> Result<i64, String> {
    if value.seconds < 0 || !(0..1_000_000_000).contains(&value.nanos) {
        return Err("resource grant timestamp is invalid".to_string());
    }
    value
        .seconds
        .checked_mul(1_000)
        .and_then(|seconds| seconds.checked_add(i64::from(value.nanos) / 1_000_000))
        .ok_or_else(|| "resource grant timestamp overflows millis".to_string())
}

fn deterministic_id(prefix: &str, parts: &[&[u8]]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part);
    }
    format!("{prefix}-{}", hex::encode(hasher.finalize()))
}

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}
