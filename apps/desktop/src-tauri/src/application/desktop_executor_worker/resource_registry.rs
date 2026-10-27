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

/// One-shot resource claims pinned onto a single envelope are deleted when
/// that envelope settles. Lease grants are reusable across every call in the
/// capability session and must survive per-call cleanup; they expire with the
/// lease skew and are purged by `delete_expired`.
pub(crate) const RESOURCE_KIND_CLAIM: &str = "claim";
pub(crate) const RESOURCE_KIND_GRANT: &str = "grant";

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
    /// [`RESOURCE_KIND_CLAIM`] (single envelope) or [`RESOURCE_KIND_GRANT`]
    /// (reusable for the whole capability session).
    pub resource_kind: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalArtifact {
    pub artifact_ref: String,
    pub locator: String,
    pub name: String,
    pub sha256: String,
    pub size: u64,
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
        let resource_kind = normalize_kind(resource.resource_kind)?;
        self.connection()?
            .execute(
                "INSERT INTO client_resource_refs(
                    resource_ref, actor_ptid, device_id, capability_session_id,
                    capability_id, permission_grant_id, integrity_hash, locator,
                    expires_at_ms, kind
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT(resource_ref, capability_session_id, capability_id)
                 DO UPDATE SET
                    actor_ptid = excluded.actor_ptid,
                    device_id = excluded.device_id,
                    permission_grant_id = excluded.permission_grant_id,
                    integrity_hash = excluded.integrity_hash,
                    locator = excluded.locator,
                    expires_at_ms = excluded.expires_at_ms,
                    kind = excluded.kind",
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
                    resource_kind,
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
                 FROM client_resource_refs
                 WHERE resource_ref = ?1
                   AND capability_session_id = ?2
                   AND capability_id = ?3",
                params![
                    reference.resource_ref,
                    capability_session_id,
                    capability_id
                ],
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

    /// Deletes one one-shot claim scoped to the capability session it was
    /// registered against. Lease grants stay reusable for the whole session
    /// and are never cleansed here. Cleansing an envelope must also never
    /// remove another session's row for the same opaque reference.
    pub fn delete(
        &self,
        opaque_ref: &str,
        capability_session_id: &str,
        capability_id: &str,
    ) -> Result<(), String> {
        self.connection()?
            .execute(
                "DELETE FROM client_resource_refs
                 WHERE resource_ref = ?1
                   AND capability_session_id = ?2
                   AND capability_id = ?3
                   AND actor_ptid = ?4
                   AND device_id = ?5
                   AND kind = ?6",
                params![
                    opaque_ref,
                    capability_session_id,
                    capability_id,
                    self.actor_ptid,
                    self.device_id,
                    RESOURCE_KIND_CLAIM,
                ],
            )
            .map(|_| ())
            .map_err(|error| format!("delete opaque client resource: {error}"))
    }

    /// Drops every reusable lease grant for one capability session. Used when
    /// the local worker tears down or supersedes a session so stale grants do
    /// not linger until their lease-skew expiry.
    pub fn delete_session_grants(&self, capability_session_id: &str) -> Result<(), String> {
        self.connection()?
            .execute(
                "DELETE FROM client_resource_refs
                 WHERE capability_session_id = ?1
                   AND actor_ptid = ?2
                   AND device_id = ?3
                   AND kind = ?4",
                params![
                    capability_session_id,
                    self.actor_ptid,
                    self.device_id,
                    RESOURCE_KIND_GRANT,
                ],
            )
            .map(|_| ())
            .map_err(|error| format!("delete session resource grants: {error}"))
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

    pub fn register_artifact(&self, artifact: &LocalArtifact) -> Result<(), String> {
        if artifact.artifact_ref.trim().is_empty()
            || artifact.locator.trim().is_empty()
            || artifact.name.trim().is_empty()
            || artifact.sha256.len() != 64
        {
            return Err("CLIENT_ARTIFACT_REGISTRATION_INVALID".to_string());
        }
        self.connection()?
            .execute(
                "INSERT INTO client_artifact_refs(
                    artifact_ref, actor_ptid, device_id, locator, name, sha256, size
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(artifact_ref) DO UPDATE SET
                    actor_ptid = excluded.actor_ptid,
                    device_id = excluded.device_id,
                    locator = excluded.locator,
                    name = excluded.name,
                    sha256 = excluded.sha256,
                    size = excluded.size",
                params![
                    artifact.artifact_ref,
                    self.actor_ptid,
                    self.device_id,
                    artifact.locator,
                    artifact.name,
                    artifact.sha256,
                    artifact.size,
                ],
            )
            .map_err(|error| format!("persist opaque client artifact: {error}"))?;
        Ok(())
    }

    pub fn resolve_artifact(&self, artifact_ref: &str) -> Result<LocalArtifact, String> {
        self.connection()?
            .query_row(
                "SELECT artifact_ref, locator, name, sha256, size
                 FROM client_artifact_refs
                 WHERE artifact_ref = ?1 AND actor_ptid = ?2 AND device_id = ?3",
                params![artifact_ref, self.actor_ptid, self.device_id],
                |row| {
                    Ok(LocalArtifact {
                        artifact_ref: row.get(0)?,
                        locator: row.get(1)?,
                        name: row.get(2)?,
                        sha256: row.get(3)?,
                        size: row.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("resolve opaque client artifact: {error}"))?
            .ok_or_else(|| "CLIENT_ARTIFACT_REF_NOT_FOUND".to_string())
    }

    fn initialize(&self) -> Result<(), String> {
        let connection = self.connection()?;
        connection
            .execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA synchronous = FULL;
                 CREATE TABLE IF NOT EXISTS client_resource_refs (
                    resource_ref TEXT NOT NULL,
                    actor_ptid TEXT NOT NULL,
                    device_id TEXT NOT NULL,
                    capability_session_id TEXT NOT NULL,
                    capability_id TEXT NOT NULL,
                    permission_grant_id TEXT NOT NULL,
                    integrity_hash TEXT NOT NULL,
                    locator TEXT NOT NULL,
                    expires_at_ms INTEGER NOT NULL,
                    kind TEXT NOT NULL DEFAULT 'claim',
                    PRIMARY KEY (resource_ref, capability_session_id, capability_id)
                 );
                 CREATE TABLE IF NOT EXISTS client_artifact_refs (
                    artifact_ref TEXT PRIMARY KEY,
                    actor_ptid TEXT NOT NULL,
                    device_id TEXT NOT NULL,
                    locator TEXT NOT NULL,
                    name TEXT NOT NULL,
                    sha256 TEXT NOT NULL,
                    size INTEGER NOT NULL
                 );",
            )
            .map_err(|error| format!("initialize encrypted client resource registry: {error}"))?;
        // In-place migration: registries created before grant/claim
        // separation lack the kind column. Existing rows default to
        // one-shot claims; lease renewals upsert live grants as reusable.
        let has_kind: bool = connection
            .prepare("SELECT 1 FROM pragma_table_info('client_resource_refs') WHERE name = 'kind'")
            .and_then(|mut statement| statement.exists([]))
            .map_err(|error| format!("inspect resource registry schema: {error}"))?;
        if !has_kind {
            connection
                .execute(
                    "ALTER TABLE client_resource_refs
                     ADD COLUMN kind TEXT NOT NULL DEFAULT 'claim'",
                    [],
                )
                .map_err(|error| format!("migrate resource registry kind column: {error}"))?;
        }
        Ok(())
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

fn normalize_kind(kind: &str) -> Result<&'static str, String> {
    match kind {
        RESOURCE_KIND_CLAIM => Ok(RESOURCE_KIND_CLAIM),
        RESOURCE_KIND_GRANT => Ok(RESOURCE_KIND_GRANT),
        other => Err(format!("CLIENT_RESOURCE_KIND_INVALID: {other}")),
    }
}

fn now_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resource_grants_are_scoped_per_capability_session() {
        let path = std::env::temp_dir().join(format!(
            "peers-local-resource-registry-{}.sqlite3",
            ulid::Ulid::new()
        ));
        let registry =
            ResourceRegistry::open_test(&path, "ptid:person:test", "device-a").unwrap();
        let future = now_unix_ms() + 60_000;
        for session in ["capability_session_a", "capability_session_b"] {
            registry
                .register(RegisterResource {
                    opaque_ref: "wks-shared",
                    capability_session_id: session,
                    capability_id: "filesystem.write",
                    permission_grant_id: "grant-1",
                    integrity_hash: "sha-file",
                    locator: "/private/device/workspace",
                    expires_at_ms: future,
                    resource_kind: RESOURCE_KIND_CLAIM,
                })
                .unwrap();
        }

        for session in ["capability_session_a", "capability_session_b"] {
            let resolved = registry
                .resolve(
                    &ClientResourceRef {
                        resource_ref: "wks-shared".to_string(),
                        ptid: "ptid:person:test".to_string(),
                        device_id: "device-a".to_string(),
                        capability_session_id: session.to_string(),
                        capability_id: "filesystem.write".to_string(),
                        expires_at: Some(prost_types::Timestamp {
                            seconds: future / 1000,
                            nanos: 0,
                        }),
                        permission_grant_id: "grant-1".to_string(),
                        integrity_hash: "sha-file".to_string(),
                    },
                    session,
                    "filesystem.write",
                    now_unix_ms(),
                )
                .unwrap();
            assert_eq!(resolved.opaque_ref, "wks-shared");
            assert_eq!(resolved.locator, "/private/device/workspace");
        }

        // Cleansing one session's envelope leaves the other session intact.
        registry
            .delete("wks-shared", "capability_session_a", "filesystem.write")
            .unwrap();
        assert_eq!(
            registry
                .resolve(
                    &ClientResourceRef {
                        resource_ref: "wks-shared".to_string(),
                        ptid: "ptid:person:test".to_string(),
                        device_id: "device-a".to_string(),
                        capability_session_id: "capability_session_b".to_string(),
                        capability_id: "filesystem.write".to_string(),
                        expires_at: Some(prost_types::Timestamp {
                            seconds: future / 1000,
                            nanos: 0,
                        }),
                        permission_grant_id: "grant-1".to_string(),
                        integrity_hash: "sha-file".to_string(),
                    },
                    "capability_session_b",
                    "filesystem.write",
                    now_unix_ms(),
                )
                .unwrap()
                .opaque_ref,
            "wks-shared"
        );
    }

    #[test]
    fn lease_grants_survive_envelope_cleanup_until_session_teardown() {
        let path = std::env::temp_dir().join(format!(
            "peers-local-resource-registry-grants-{}.sqlite3",
            ulid::Ulid::new()
        ));
        let registry =
            ResourceRegistry::open_test(&path, "ptid:person:test", "device-a").unwrap();
        let future = now_unix_ms() + 60_000;
        let grant_ref = ClientResourceRef {
            resource_ref: "wks-root".to_string(),
            ptid: "ptid:person:test".to_string(),
            device_id: "device-a".to_string(),
            capability_session_id: "capability_session_a".to_string(),
            capability_id: "filesystem.read".to_string(),
            expires_at: Some(prost_types::Timestamp {
                seconds: future / 1000,
                nanos: 0,
            }),
            permission_grant_id: "grant-1".to_string(),
            integrity_hash: "sha-root".to_string(),
        };
        registry
            .register(RegisterResource {
                opaque_ref: &grant_ref.resource_ref,
                capability_session_id: &grant_ref.capability_session_id,
                capability_id: &grant_ref.capability_id,
                permission_grant_id: &grant_ref.permission_grant_id,
                integrity_hash: &grant_ref.integrity_hash,
                locator: "/private/device/workspace",
                expires_at_ms: future,
                resource_kind: RESOURCE_KIND_GRANT,
            })
            .unwrap();

        // A second envelope inside the same lease must resolve the same root:
        // per-call envelope cleanup never removes reusable lease grants.
        registry
            .delete(
                &grant_ref.resource_ref,
                &grant_ref.capability_session_id,
                &grant_ref.capability_id,
            )
            .unwrap();
        assert_eq!(
            registry
                .resolve(
                    &grant_ref,
                    &grant_ref.capability_session_id,
                    &grant_ref.capability_id,
                    now_unix_ms(),
                )
                .unwrap()
                .locator,
            "/private/device/workspace"
        );

        // Session teardown clears the grants but leaves one-shot claims alone.
        let claim = ClientResourceRef {
            resource_ref: "claim-1".to_string(),
            capability_session_id: "capability_session_a".to_string(),
            capability_id: "filesystem.write".to_string(),
            ..grant_ref.clone()
        };
        registry
            .register(RegisterResource {
                opaque_ref: &claim.resource_ref,
                capability_session_id: &claim.capability_session_id,
                capability_id: &claim.capability_id,
                permission_grant_id: &claim.permission_grant_id,
                integrity_hash: &claim.integrity_hash,
                locator: "/private/device/workspace/one.txt",
                expires_at_ms: future,
                resource_kind: RESOURCE_KIND_CLAIM,
            })
            .unwrap();
        registry
            .delete_session_grants(&grant_ref.capability_session_id)
            .unwrap();
        assert_eq!(
            registry
                .resolve(
                    &grant_ref,
                    &grant_ref.capability_session_id,
                    &grant_ref.capability_id,
                    now_unix_ms(),
                )
                .unwrap_err(),
            "CLIENT_RESOURCE_REF_NOT_FOUND"
        );
        assert_eq!(
            registry
                .resolve(
                    &claim,
                    &claim.capability_session_id,
                    &claim.capability_id,
                    now_unix_ms(),
                )
                .unwrap()
                .opaque_ref,
            "claim-1"
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn existing_registry_without_kind_migrates_in_place() {
        let path = std::env::temp_dir().join(format!(
            "peers-local-resource-registry-migration-{}.sqlite3",
            ulid::Ulid::new()
        ));
        {
            let connection = rusqlite::Connection::open(&path).unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE client_resource_refs (
                        resource_ref TEXT NOT NULL,
                        actor_ptid TEXT NOT NULL,
                        device_id TEXT NOT NULL,
                        capability_session_id TEXT NOT NULL,
                        capability_id TEXT NOT NULL,
                        permission_grant_id TEXT NOT NULL,
                        integrity_hash TEXT NOT NULL,
                        locator TEXT NOT NULL,
                        expires_at_ms INTEGER NOT NULL,
                        PRIMARY KEY (resource_ref, capability_session_id, capability_id)
                     );
                     CREATE TABLE client_artifact_refs (
                        artifact_ref TEXT PRIMARY KEY,
                        actor_ptid TEXT NOT NULL,
                        device_id TEXT NOT NULL,
                        locator TEXT NOT NULL,
                        name TEXT NOT NULL,
                        sha256 TEXT NOT NULL,
                        size INTEGER NOT NULL
                     );",
                )
                .unwrap();
        }
        let registry =
            ResourceRegistry::open_test(&path, "ptid:person:test", "device-a").unwrap();
        let future = now_unix_ms() + 60_000;
        // Pre-existing rows default to one-shot claims: envelope cleanup
        // removes them exactly like before the migration.
        registry
            .register(RegisterResource {
                opaque_ref: "legacy-ref",
                capability_session_id: "capability_session_a",
                capability_id: "filesystem.read",
                permission_grant_id: "grant-1",
                integrity_hash: "sha-file",
                locator: "/private/device/workspace",
                expires_at_ms: future,
                resource_kind: RESOURCE_KIND_GRANT,
            })
            .unwrap();
        registry
            .delete("legacy-ref", "capability_session_a", "filesystem.read")
            .unwrap();
        assert!(
            registry
                .resolve(
                    &ClientResourceRef {
                        resource_ref: "legacy-ref".to_string(),
                        ptid: "ptid:person:test".to_string(),
                        device_id: "device-a".to_string(),
                        capability_session_id: "capability_session_a".to_string(),
                        capability_id: "filesystem.read".to_string(),
                        expires_at: Some(prost_types::Timestamp {
                            seconds: future / 1000,
                            nanos: 0
                        }),
                        permission_grant_id: "grant-1".to_string(),
                        integrity_hash: "sha-file".to_string(),
                    },
                    "capability_session_a",
                    "filesystem.read",
                    now_unix_ms(),
                )
                .is_ok(),
            "upserted lease grant must survive claim cleanup after in-place migration"
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn local_artifact_refs_are_persistent_and_device_scoped() {
        let path = std::env::temp_dir().join(format!(
            "peers-local-artifact-registry-{}.sqlite3",
            ulid::Ulid::new()
        ));
        let registry = ResourceRegistry::open_test(&path, "ptid:person:test", "device-a").unwrap();
        let artifact = LocalArtifact {
            artifact_ref: "artifact-1".to_string(),
            locator: "/tmp/report.md".to_string(),
            name: "report.md".to_string(),
            sha256: "a".repeat(64),
            size: 42,
        };
        registry.register_artifact(&artifact).unwrap();
        assert_eq!(registry.resolve_artifact("artifact-1").unwrap(), artifact);

        let other = ResourceRegistry::open_test(&path, "ptid:person:test", "device-b").unwrap();
        assert_eq!(
            other.resolve_artifact("artifact-1").unwrap_err(),
            "CLIENT_ARTIFACT_REF_NOT_FOUND"
        );
        let _ = std::fs::remove_file(path);
    }
}
