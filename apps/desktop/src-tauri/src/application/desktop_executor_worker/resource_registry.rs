use crate::domain::storage::database::{DatabaseOpenSpec, EncryptionLevel};
use crate::infrastructure::storage;
use crate::infrastructure::storage::key_provider::PlatformKeyProvider;
use crate::model::agent::ClientResourceRef;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
#[cfg(test)]
use std::path::Path;
use std::path::PathBuf;

const RESOURCE_REGISTRY_SCHEMA_VERSION: i32 = 1;

#[derive(Debug, Clone)]
enum RegistryStorage {
    Encrypted(DatabaseOpenSpec),
    PlainTest(PathBuf),
}

#[derive(Debug, Clone)]
pub struct ResourceRegistry {
    actor_ptid: String,
    device_id: String,
    storage: RegistryStorage,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalResource {
    pub opaque_ref: String,
    pub locator: String,
    pub permission_grant_id: String,
    pub integrity_hash: String,
}

pub struct RegisterResource<'a> {
    pub opaque_ref: &'a str,
    pub capability_session_id: &'a str,
    pub capability_id: &'a str,
    pub permission_grant_id: &'a str,
    pub integrity_hash: &'a str,
    pub locator: &'a str,
    pub expires_at_ms: i64,
}

impl ResourceRegistry {
    pub fn open(actor_ptid: &str, device_id: &str) -> Result<Self, String> {
        require_scope(actor_ptid, device_id)?;
        let app_name = std::env::var("PT_PROFILE")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "desktop".to_string());
        let registry = Self {
            actor_ptid: actor_ptid.to_string(),
            device_id: device_id.to_string(),
            storage: RegistryStorage::Encrypted(DatabaseOpenSpec {
                app_name: app_name.clone(),
                domain: "agent-client-resources".to_string(),
                profile: format!("device-{}", scope_hash(device_id)),
                user_scope: actor_ptid.to_string(),
                encryption_level: EncryptionLevel::L2,
                key_ref: format!(
                    "agent-client-resources/{app_name}/{}/{}",
                    scope_hash(actor_ptid),
                    scope_hash(device_id)
                ),
                schema_version: RESOURCE_REGISTRY_SCHEMA_VERSION,
            }),
        };
        registry.initialize()?;
        Ok(registry)
    }

    #[cfg(test)]
    pub fn open_test(path: &Path, actor_ptid: &str, device_id: &str) -> Result<Self, String> {
        require_scope(actor_ptid, device_id)?;
        let registry = Self {
            actor_ptid: actor_ptid.to_string(),
            device_id: device_id.to_string(),
            storage: RegistryStorage::PlainTest(path.to_path_buf()),
        };
        registry.initialize()?;
        Ok(registry)
    }

    pub fn register(&self, resource: RegisterResource<'_>) -> Result<(), String> {
        if resource.opaque_ref.trim().is_empty()
            || resource.capability_session_id.trim().is_empty()
            || resource.capability_id.trim().is_empty()
            || resource.permission_grant_id.trim().is_empty()
            || resource.integrity_hash.trim().is_empty()
            || resource.locator.trim().is_empty()
            || resource.expires_at_ms <= now_unix_ms()
        {
            return Err("CLIENT_RESOURCE_REGISTRATION_INVALID".to_string());
        }
        self.connection()?
            .execute(
                "INSERT INTO client_resource_refs(
                    resource_ref, actor_ptid, device_id, capability_session_id,
                    capability_id, permission_grant_id, integrity_hash, locator,
                    expires_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(resource_ref) DO UPDATE SET
                    actor_ptid = excluded.actor_ptid,
                    device_id = excluded.device_id,
                    capability_session_id = excluded.capability_session_id,
                    capability_id = excluded.capability_id,
                    permission_grant_id = excluded.permission_grant_id,
                    integrity_hash = excluded.integrity_hash,
                    locator = excluded.locator,
                    expires_at_ms = excluded.expires_at_ms",
                params![
                    resource.opaque_ref,
                    self.actor_ptid,
                    self.device_id,
                    resource.capability_session_id,
                    resource.capability_id,
                    resource.permission_grant_id,
                    resource.integrity_hash,
                    resource.locator,
                    resource.expires_at_ms,
                ],
            )
            .map_err(|error| format!("persist opaque client resource: {error}"))?;
        Ok(())
    }

    pub fn resolve(
        &self,
        reference: &ClientResourceRef,
        capability_session_id: &str,
        capability_id: &str,
        now_ms: i64,
    ) -> Result<LocalResource, String> {
        validate_wire_scope(
            reference,
            &self.actor_ptid,
            &self.device_id,
            capability_session_id,
            capability_id,
            now_ms,
        )?;
        let record = self
            .connection()?
            .query_row(
                "SELECT actor_ptid, device_id, capability_session_id, capability_id,
                        permission_grant_id, integrity_hash, locator, expires_at_ms
                 FROM client_resource_refs WHERE resource_ref = ?1",
                params![reference.resource_ref],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, i64>(7)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| format!("resolve opaque client resource: {error}"))?
            .ok_or_else(|| "CLIENT_RESOURCE_REF_NOT_FOUND".to_string())?;
        if record.0 != self.actor_ptid
            || record.1 != self.device_id
            || record.2 != capability_session_id
            || record.3 != capability_id
            || record.4 != reference.permission_grant_id
            || record.5 != reference.integrity_hash
            || record.7 <= now_ms
        {
            return Err("CLIENT_RESOURCE_REF_SCOPE_MISMATCH".to_string());
        }
        Ok(LocalResource {
            opaque_ref: reference.resource_ref.clone(),
            locator: record.6,
            permission_grant_id: record.4,
            integrity_hash: record.5,
        })
    }

    pub fn delete(&self, opaque_refs: &[String]) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("begin opaque resource cleanup: {error}"))?;
        for opaque_ref in opaque_refs {
            transaction
                .execute(
                    "DELETE FROM client_resource_refs
                     WHERE resource_ref = ?1 AND actor_ptid = ?2 AND device_id = ?3",
                    params![opaque_ref, self.actor_ptid, self.device_id],
                )
                .map_err(|error| format!("delete opaque client resource: {error}"))?;
        }
        transaction
            .commit()
            .map_err(|error| format!("commit opaque resource cleanup: {error}"))
    }

    pub fn delete_expired(&self, now_ms: i64) -> Result<(), String> {
        self.connection()?
            .execute(
                "DELETE FROM client_resource_refs
                 WHERE actor_ptid = ?1 AND device_id = ?2 AND expires_at_ms <= ?3",
                params![self.actor_ptid, self.device_id, now_ms],
            )
            .map_err(|error| format!("delete expired opaque client resources: {error}"))?;
        Ok(())
    }

    fn initialize(&self) -> Result<(), String> {
        self.connection()?
            .execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA synchronous = FULL;
                 CREATE TABLE IF NOT EXISTS client_resource_refs (
                    resource_ref TEXT PRIMARY KEY,
                    actor_ptid TEXT NOT NULL,
                    device_id TEXT NOT NULL,
                    capability_session_id TEXT NOT NULL,
                    capability_id TEXT NOT NULL,
                    permission_grant_id TEXT NOT NULL,
                    integrity_hash TEXT NOT NULL,
                    locator TEXT NOT NULL,
                    expires_at_ms INTEGER NOT NULL
                 );",
            )
            .map_err(|error| format!("initialize encrypted client resource registry: {error}"))
    }

    fn connection(&self) -> Result<Connection, String> {
        match &self.storage {
            RegistryStorage::Encrypted(spec) => {
                storage::open_database(spec, PlatformKeyProvider::shared())
                    .map_err(|error| format!("open encrypted client resource registry: {error}"))
            }
            RegistryStorage::PlainTest(path) => {
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent).map_err(|error| {
                        format!("create client resource test directory: {error}")
                    })?;
                }
                Connection::open(path)
                    .map_err(|error| format!("open client resource test registry: {error}"))
            }
        }
    }
}

fn validate_wire_scope(
    reference: &ClientResourceRef,
    actor_ptid: &str,
    device_id: &str,
    capability_session_id: &str,
    capability_id: &str,
    now_ms: i64,
) -> Result<(), String> {
    let expires_at = reference
        .expires_at
        .as_ref()
        .ok_or_else(|| "CLIENT_RESOURCE_REF_EXPIRY_REQUIRED".to_string())?;
    if reference.resource_ref.trim().is_empty()
        || reference.ptid != actor_ptid
        || reference.device_id != device_id
        || reference.capability_session_id != capability_session_id
        || reference.capability_id != capability_id
        || reference.permission_grant_id.trim().is_empty()
        || reference.integrity_hash.trim().is_empty()
        || timestamp_ms(expires_at)? <= now_ms
    {
        return Err("CLIENT_RESOURCE_REF_SCOPE_MISMATCH".to_string());
    }
    Ok(())
}

fn timestamp_ms(value: &prost_types::Timestamp) -> Result<i64, String> {
    if value.seconds < 0 || !(0..1_000_000_000).contains(&value.nanos) {
        return Err("CLIENT_RESOURCE_REF_TIMESTAMP_INVALID".to_string());
    }
    value
        .seconds
        .checked_mul(1_000)
        .and_then(|seconds| seconds.checked_add(i64::from(value.nanos) / 1_000_000))
        .ok_or_else(|| "CLIENT_RESOURCE_REF_TIMESTAMP_INVALID".to_string())
}

fn require_scope(actor_ptid: &str, device_id: &str) -> Result<(), String> {
    if !actor_ptid.starts_with("ptid:") || device_id.trim().is_empty() {
        return Err("client resource registry requires actor/device scope".to_string());
    }
    Ok(())
}

fn scope_hash(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

fn now_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}
