use std::fs;
use std::ops::Deref;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use aes_gcm::aead::{Aead, KeyInit, OsRng, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use prost::Message;
use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension};
use zeroize::Zeroizing;

use crate::runtime::reliability::{
    ActivatedReliabilityScope, CanonicalScopePaths, ExactScope, LogicalCleanupResult,
    ReliabilityError, ReliabilityErrorKind, ReliabilityResult, ScopeKeyContext,
    RELIABILITY_SCHEMA_REVISION,
};
use crate::runtime::reliability_proto::peers_touch::model::mobile::v1::{
    mobile_draft_envelope_v2, ChatDraftPayload, MobileDraftEnvelopeV2, MobileDraftSurfaceKind,
    MomentDraftPayload,
};
use crate::runtime::reliability_proto::peers_touch::model::social::v1::audience::Kind as AudienceKind;

const METADATA_VERSION: u16 = 1;
const AEAD_AES_256_GCM: u8 = 1;
const NONCE_BYTES: usize = 12;
const TAG_BYTES: usize = 16;
const MAX_METADATA_BYTES: usize = 4096;
const MAX_DRAFT_ENVELOPE_BYTES: usize = 256 * 1024;
const MAX_TARGET_ID_BYTES: usize = 1024;
const MAX_BLOB_REFERENCE_BYTES: usize = 1024;

pub struct DraftStore {
    scope: ExactScope,
    inner: Mutex<Option<DraftStoreInner>>,
}

struct DraftStoreInner {
    connection: Connection,
    draft_key: Zeroizing<[u8; 32]>,
    key_context: ScopeKeyContext,
}

struct OpenDraftGuard<'a>(MutexGuard<'a, Option<DraftStoreInner>>);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DraftKey {
    pub scope: ExactScope,
    pub surface_kind: MobileDraftSurfaceKind,
    pub target_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DraftRetentionResult {
    pub retained_records: u64,
    pub exact_scope: ExactScope,
}

struct MetadataRecord {
    schema_revision: u32,
    kek_id: [u8; 16],
    install_epoch: [u8; 32],
    station_peer_id: String,
    actor_ptid: String,
    nonce: [u8; NONCE_BYTES],
    tag: [u8; TAG_BYTES],
}

impl DraftKey {
    pub fn new(
        scope: ExactScope,
        surface_kind: MobileDraftSurfaceKind,
        target_id: impl Into<String>,
    ) -> ReliabilityResult<Self> {
        let key = Self {
            scope,
            surface_kind,
            target_id: target_id.into(),
        };
        validate_target_id(&key.target_id)?;
        if key.surface_kind == MobileDraftSurfaceKind::Unspecified {
            return Err(ReliabilityError::invalid(
                "draft surface kind must be generated and explicit",
            ));
        }
        Ok(key)
    }
}

impl DraftStore {
    pub fn open(activation: &ActivatedReliabilityScope) -> ReliabilityResult<Self> {
        let scope = activation.context().scope().clone();
        ensure_scope_directory(activation.paths())?;
        let database_path = activation.paths().draft_database();
        let metadata_path = activation.paths().draft_metadata();
        let database_exists = regular_file_exists(&database_path)?;
        let metadata_exists = regular_file_exists(&metadata_path)?;
        if database_exists && !metadata_exists {
            return Err(ReliabilityError::authentication(
                "draft database exists without authenticated metadata",
            ));
        }

        let metadata_bytes = if metadata_exists {
            let bytes =
                crate::runtime::reliability::codec::read_file(&metadata_path, MAX_METADATA_BYTES)?;
            verify_metadata(&bytes, activation.context(), activation.draft_key())?;
            bytes
        } else {
            let bytes = create_metadata(activation.context(), activation.draft_key())?;
            crate::runtime::reliability::codec::atomic_write(&metadata_path, &bytes)?;
            bytes
        };

        // Authenticated sidecar verification occurs before SQLite opens, so a
        // wrong key or epoch cannot trigger WAL recovery or row mutation.
        let connection = Connection::open(&database_path)
            .map_err(|error| ReliabilityError::io("open v2 draft database", error))?;
        if database_exists {
            verify_database_metadata(&connection, activation.context(), &metadata_bytes)?;
        } else {
            initialize_database(&connection, activation.context(), &metadata_bytes)?;
        }
        harden_database_permissions(&database_path)?;
        connection
            .execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
            .map_err(|error| ReliabilityError::io("configure v2 draft database", error))?;

        let mut draft_key = Zeroizing::new([0u8; 32]);
        draft_key.copy_from_slice(activation.draft_key());
        Ok(Self {
            scope,
            inner: Mutex::new(Some(DraftStoreInner {
                connection,
                draft_key,
                key_context: activation.context().clone(),
            })),
        })
    }

    pub fn save(&self, envelope: &MobileDraftEnvelopeV2) -> ReliabilityResult<()> {
        validate_envelope(envelope, &self.scope)?;
        let encoded = envelope.encode_to_vec();
        if encoded.len() > MAX_DRAFT_ENVELOPE_BYTES {
            return Err(ReliabilityError::invalid(
                "generated draft envelope exceeds the v2 payload limit",
            ));
        }
        let surface = MobileDraftSurfaceKind::try_from(envelope.surface_kind)
            .map_err(|_| ReliabilityError::invalid("draft surface enum is unknown"))?;
        let guard = self.lock_open()?;
        let aad = draft_aad(&guard.key_context, surface, &envelope.target_id)?;
        let encrypted = encrypt(&guard.draft_key, &aad, &encoded)?;
        let updated_at = envelope
            .updated_at
            .as_ref()
            .ok_or_else(|| ReliabilityError::invalid("draft updated_at is required"))?;
        guard
            .connection
            .execute(
                "INSERT INTO drafts (
                    schema_revision, station_peer_id, actor_ptid, surface_kind,
                    target_id, payload_blob, updated_seconds, updated_nanos
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(station_peer_id, actor_ptid, surface_kind, target_id)
                 DO UPDATE SET
                    schema_revision = excluded.schema_revision,
                    payload_blob = excluded.payload_blob,
                    updated_seconds = excluded.updated_seconds,
                    updated_nanos = excluded.updated_nanos",
                params![
                    envelope.schema_revision,
                    envelope.station_peer_id,
                    envelope.actor_ptid,
                    envelope.surface_kind,
                    envelope.target_id,
                    encrypted,
                    updated_at.seconds,
                    updated_at.nanos,
                ],
            )
            .map_err(|error| ReliabilityError::io("save generated draft envelope", error))?;
        Ok(())
    }

    pub fn load(&self, key: &DraftKey) -> ReliabilityResult<Option<MobileDraftEnvelopeV2>> {
        self.validate_key(key)?;
        let guard = self.lock_open()?;
        let payload = guard
            .connection
            .query_row(
                "SELECT payload_blob FROM drafts
                 WHERE station_peer_id = ?1 AND actor_ptid = ?2
                   AND surface_kind = ?3 AND target_id = ?4",
                params![
                    key.scope.station_peer_id(),
                    key.scope.actor_ptid(),
                    key.surface_kind as i32,
                    key.target_id,
                ],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()
            .map_err(|error| ReliabilityError::io("load generated draft envelope", error))?;
        payload
            .map(|payload| decode_envelope(&guard, key, &payload))
            .transpose()
    }

    pub fn list(
        &self,
        surface_kind: Option<MobileDraftSurfaceKind>,
    ) -> ReliabilityResult<Vec<MobileDraftEnvelopeV2>> {
        if surface_kind == Some(MobileDraftSurfaceKind::Unspecified) {
            return Err(ReliabilityError::invalid(
                "cannot list an unspecified draft surface",
            ));
        }
        let guard = self.lock_open()?;
        let mut statement = if surface_kind.is_some() {
            guard
                .connection
                .prepare(
                    "SELECT surface_kind, target_id, payload_blob FROM drafts
                     WHERE station_peer_id = ?1 AND actor_ptid = ?2 AND surface_kind = ?3
                     ORDER BY updated_seconds DESC, updated_nanos DESC",
                )
                .map_err(|error| ReliabilityError::io("prepare scoped draft list", error))?
        } else {
            guard
                .connection
                .prepare(
                    "SELECT surface_kind, target_id, payload_blob FROM drafts
                     WHERE station_peer_id = ?1 AND actor_ptid = ?2
                     ORDER BY updated_seconds DESC, updated_nanos DESC",
                )
                .map_err(|error| ReliabilityError::io("prepare scoped draft list", error))?
        };
        let map_row = |row: &rusqlite::Row<'_>| {
            Ok((
                row.get::<_, i32>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Vec<u8>>(2)?,
            ))
        };
        let rows = match surface_kind {
            Some(surface) => statement.query_map(
                params![
                    self.scope.station_peer_id(),
                    self.scope.actor_ptid(),
                    surface as i32
                ],
                map_row,
            ),
            None => statement.query_map(
                params![self.scope.station_peer_id(), self.scope.actor_ptid()],
                map_row,
            ),
        }
        .map_err(|error| ReliabilityError::io("query scoped draft list", error))?;

        let mut envelopes = Vec::new();
        for row in rows {
            let (surface, target_id, payload) =
                row.map_err(|error| ReliabilityError::io("read scoped draft row", error))?;
            let surface = MobileDraftSurfaceKind::try_from(surface)
                .map_err(|_| ReliabilityError::corrupt("stored draft surface enum is unknown"))?;
            let key = DraftKey::new(self.scope.clone(), surface, target_id)?;
            envelopes.push(decode_envelope(&guard, &key, &payload)?);
        }
        Ok(envelopes)
    }

    pub fn remove(&self, key: &DraftKey) -> ReliabilityResult<bool> {
        self.validate_key(key)?;
        let guard = self.lock_open()?;
        let affected = guard
            .connection
            .execute(
                "DELETE FROM drafts
                 WHERE station_peer_id = ?1 AND actor_ptid = ?2
                   AND surface_kind = ?3 AND target_id = ?4",
                params![
                    key.scope.station_peer_id(),
                    key.scope.actor_ptid(),
                    key.surface_kind as i32,
                    key.target_id,
                ],
            )
            .map_err(|error| ReliabilityError::io("remove exact-scope draft", error))?;
        Ok(affected == 1)
    }

    pub fn discard_scope(&self) -> ReliabilityResult<LogicalCleanupResult> {
        let guard = self.lock_open()?;
        guard
            .connection
            .execute(
                "DELETE FROM drafts WHERE station_peer_id = ?1 AND actor_ptid = ?2",
                params![self.scope.station_peer_id(), self.scope.actor_ptid()],
            )
            .map_err(|error| ReliabilityError::io("discard exact-scope drafts", error))?;
        let remaining: u64 = guard
            .connection
            .query_row(
                "SELECT COUNT(*) FROM drafts
                 WHERE station_peer_id = ?1 AND actor_ptid = ?2",
                params![self.scope.station_peer_id(), self.scope.actor_ptid()],
                |row| row.get(0),
            )
            .map_err(|error| ReliabilityError::io("verify exact-scope draft discard", error))?;
        Ok(LogicalCleanupResult {
            records_absent: remaining == 0,
            paths_absent: false,
            keys_absent: false,
            secure_physical_deletion_proven: false,
        })
    }

    pub fn close_retaining(&self) -> ReliabilityResult<DraftRetentionResult> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| ReliabilityError::corrupt("draft store lock poisoned"))?;
        let inner = guard.as_ref().ok_or_else(|| {
            ReliabilityError::new(ReliabilityErrorKind::StoreClosed, "draft store is closed")
        })?;
        let retained_records = count_records(&inner.connection, &self.scope)?;
        *guard = None;
        Ok(DraftRetentionResult {
            retained_records,
            exact_scope: self.scope.clone(),
        })
    }

    pub fn count(&self) -> ReliabilityResult<u64> {
        let guard = self.lock_open()?;
        count_records(&guard.connection, &self.scope)
    }

    fn validate_key(&self, key: &DraftKey) -> ReliabilityResult<()> {
        if key.scope != self.scope {
            return Err(ReliabilityError::authentication(
                "draft key does not match the open Station/PTID scope",
            ));
        }
        validate_target_id(&key.target_id)?;
        if key.surface_kind == MobileDraftSurfaceKind::Unspecified {
            return Err(ReliabilityError::invalid(
                "draft key surface is unspecified",
            ));
        }
        Ok(())
    }

    fn lock_open(&self) -> ReliabilityResult<OpenDraftGuard<'_>> {
        let guard = self
            .inner
            .lock()
            .map_err(|_| ReliabilityError::corrupt("draft store lock poisoned"))?;
        if guard.is_none() {
            return Err(ReliabilityError::new(
                ReliabilityErrorKind::StoreClosed,
                "draft store is closed",
            ));
        }
        Ok(OpenDraftGuard(guard))
    }
}

impl Deref for OpenDraftGuard<'_> {
    type Target = DraftStoreInner;

    fn deref(&self) -> &Self::Target {
        self.0
            .as_ref()
            .expect("OpenDraftGuard is constructed only for an open store")
    }
}

fn initialize_database(
    connection: &Connection,
    context: &ScopeKeyContext,
    metadata_bytes: &[u8],
) -> ReliabilityResult<()> {
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| ReliabilityError::io("start v2 draft schema transaction", error))?;
    transaction
        .execute_batch(
            "PRAGMA application_id = 1347703364;
             PRAGMA user_version = 2;
             CREATE TABLE reliability_metadata (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                schema_revision INTEGER NOT NULL,
                station_peer_id TEXT NOT NULL,
                actor_ptid TEXT NOT NULL,
                kek_id BLOB NOT NULL,
                install_epoch BLOB NOT NULL,
                authenticated_record BLOB NOT NULL
             );
             CREATE TABLE drafts (
                schema_revision INTEGER NOT NULL,
                station_peer_id TEXT NOT NULL,
                actor_ptid TEXT NOT NULL,
                surface_kind INTEGER NOT NULL,
                target_id TEXT NOT NULL,
                payload_blob BLOB NOT NULL,
                updated_seconds INTEGER NOT NULL,
                updated_nanos INTEGER NOT NULL,
                PRIMARY KEY (station_peer_id, actor_ptid, surface_kind, target_id)
             );",
        )
        .map_err(|error| ReliabilityError::io("create v2 draft schema", error))?;
    transaction
        .execute(
            "INSERT INTO reliability_metadata (
                id, schema_revision, station_peer_id, actor_ptid,
                kek_id, install_epoch, authenticated_record
             ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                context.schema_revision(),
                context.scope().station_peer_id(),
                context.scope().actor_ptid(),
                context.kek_id().as_slice(),
                context.install_epoch().as_slice(),
                metadata_bytes,
            ],
        )
        .map_err(|error| ReliabilityError::io("write v2 draft metadata", error))?;
    transaction
        .commit()
        .map_err(|error| ReliabilityError::io("commit v2 draft schema", error))
}

fn verify_database_metadata(
    connection: &Connection,
    context: &ScopeKeyContext,
    metadata_bytes: &[u8],
) -> ReliabilityResult<()> {
    let metadata = connection
        .query_row(
            "SELECT schema_revision, station_peer_id, actor_ptid,
                    kek_id, install_epoch, authenticated_record
             FROM reliability_metadata WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, u32>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Vec<u8>>(3)?,
                    row.get::<_, Vec<u8>>(4)?,
                    row.get::<_, Vec<u8>>(5)?,
                ))
            },
        )
        .map_err(|error| {
            ReliabilityError::authentication(format!(
                "read authenticated draft database metadata: {error}"
            ))
        })?;
    if metadata.0 != context.schema_revision()
        || metadata.1 != context.scope().station_peer_id()
        || metadata.2 != context.scope().actor_ptid()
        || metadata.3 != context.kek_id()
        || metadata.4 != context.install_epoch()
        || metadata.5 != metadata_bytes
    {
        return Err(ReliabilityError::authentication(
            "draft database scope/schema metadata mismatch",
        ));
    }
    Ok(())
}

fn create_metadata(context: &ScopeKeyContext, draft_key: &[u8; 32]) -> ReliabilityResult<Vec<u8>> {
    let aad = metadata_aad(context)?;
    let cipher = Aes256Gcm::new_from_slice(draft_key)
        .map_err(|_| ReliabilityError::authentication("invalid draft metadata key"))?;
    let mut nonce = [0u8; NONCE_BYTES];
    OsRng.fill_bytes(&mut nonce);
    let tag = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &[],
                aad: &aad,
            },
        )
        .map_err(|_| ReliabilityError::authentication("authenticate draft metadata"))?;
    let tag: [u8; TAG_BYTES] = tag
        .try_into()
        .map_err(|_| ReliabilityError::corrupt("draft metadata tag length is invalid"))?;
    encode_metadata(&MetadataRecord {
        schema_revision: context.schema_revision(),
        kek_id: *context.kek_id(),
        install_epoch: *context.install_epoch(),
        station_peer_id: context.scope().station_peer_id().to_string(),
        actor_ptid: context.scope().actor_ptid().to_string(),
        nonce,
        tag,
    })
}

fn verify_metadata(
    bytes: &[u8],
    context: &ScopeKeyContext,
    draft_key: &[u8; 32],
) -> ReliabilityResult<()> {
    let metadata = decode_metadata(bytes)?;
    if metadata.schema_revision != context.schema_revision()
        || metadata.kek_id != *context.kek_id()
        || metadata.install_epoch != *context.install_epoch()
        || metadata.station_peer_id != context.scope().station_peer_id()
        || metadata.actor_ptid != context.scope().actor_ptid()
    {
        return Err(ReliabilityError::authentication(
            "draft metadata does not match KEK, epoch, scope, or schema",
        ));
    }
    let aad = metadata_aad(context)?;
    let cipher = Aes256Gcm::new_from_slice(draft_key)
        .map_err(|_| ReliabilityError::authentication("invalid draft metadata key"))?;
    cipher
        .decrypt(
            Nonce::from_slice(&metadata.nonce),
            Payload {
                msg: &metadata.tag,
                aad: &aad,
            },
        )
        .map_err(|_| {
            ReliabilityError::authentication(
                "draft scope/schema metadata authentication failed before database open",
            )
        })?;
    Ok(())
}

fn encode_metadata(metadata: &MetadataRecord) -> ReliabilityResult<Vec<u8>> {
    let mut encoder = crate::runtime::reliability::codec::Encoder::new(b"PTDM");
    encoder.u16(METADATA_VERSION);
    encoder.u8(AEAD_AES_256_GCM);
    encoder.u32(metadata.schema_revision);
    encoder.fixed(&metadata.kek_id);
    encoder.fixed(&metadata.install_epoch);
    encoder.string(&metadata.station_peer_id)?;
    encoder.string(&metadata.actor_ptid)?;
    encoder.fixed(&metadata.nonce);
    encoder.fixed(&metadata.tag);
    Ok(encoder.finish())
}

fn decode_metadata(bytes: &[u8]) -> ReliabilityResult<MetadataRecord> {
    let mut decoder = crate::runtime::reliability::codec::Decoder::new(bytes, b"PTDM")?;
    if decoder.u16()? != METADATA_VERSION || decoder.u8()? != AEAD_AES_256_GCM {
        return Err(ReliabilityError::corrupt(
            "unsupported draft metadata contract",
        ));
    }
    let schema_revision = decoder.u32()?;
    let kek_id = decoder.take_fixed::<16>()?;
    let install_epoch = decoder.take_fixed::<32>()?;
    let station_peer_id = decoder.string(512)?;
    let actor_ptid = decoder.string(512)?;
    let nonce = decoder.take_fixed::<NONCE_BYTES>()?;
    let tag = decoder.take_fixed::<TAG_BYTES>()?;
    decoder.finish()?;
    Ok(MetadataRecord {
        schema_revision,
        kek_id,
        install_epoch,
        station_peer_id,
        actor_ptid,
        nonce,
        tag,
    })
}

fn metadata_aad(context: &ScopeKeyContext) -> ReliabilityResult<Vec<u8>> {
    context.authenticated_context(
        b"draft-store-metadata/aes-256-gcm/v2",
        &[b"prost-MobileDraftEnvelopeV2"],
    )
}

fn draft_aad(
    context: &ScopeKeyContext,
    surface: MobileDraftSurfaceKind,
    target_id: &str,
) -> ReliabilityResult<Vec<u8>> {
    context.authenticated_context(
        b"draft-envelope/aes-256-gcm/v2",
        &[&(surface as i32).to_be_bytes(), target_id.as_bytes()],
    )
}

fn encrypt(key: &[u8; 32], aad: &[u8], plaintext: &[u8]) -> ReliabilityResult<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| ReliabilityError::authentication("invalid draft encryption key"))?;
    let mut nonce = [0u8; NONCE_BYTES];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| ReliabilityError::authentication("encrypt generated draft envelope"))?;
    let mut blob = Vec::with_capacity(NONCE_BYTES + ciphertext.len());
    blob.extend_from_slice(&nonce);
    blob.extend_from_slice(&ciphertext);
    Ok(blob)
}

fn decrypt(key: &[u8; 32], aad: &[u8], blob: &[u8]) -> ReliabilityResult<Zeroizing<Vec<u8>>> {
    if blob.len() < NONCE_BYTES + TAG_BYTES {
        return Err(ReliabilityError::corrupt(
            "encrypted draft envelope is truncated",
        ));
    }
    let (nonce, ciphertext) = blob.split_at(NONCE_BYTES);
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| ReliabilityError::authentication("invalid draft decryption key"))?;
    cipher
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| {
            ReliabilityError::authentication(
                "draft envelope failed exact scope/schema/key authentication",
            )
        })
}

fn decode_envelope(
    inner: &DraftStoreInner,
    key: &DraftKey,
    encrypted: &[u8],
) -> ReliabilityResult<MobileDraftEnvelopeV2> {
    let aad = draft_aad(&inner.key_context, key.surface_kind, &key.target_id)?;
    let plaintext = decrypt(&inner.draft_key, &aad, encrypted)?;
    let envelope = MobileDraftEnvelopeV2::decode(plaintext.as_slice())
        .map_err(|_| ReliabilityError::corrupt("stored draft envelope is not valid Proto"))?;
    validate_envelope(&envelope, &key.scope)?;
    if envelope.surface_kind != key.surface_kind as i32 || envelope.target_id != key.target_id {
        return Err(ReliabilityError::authentication(
            "stored draft envelope does not match its authenticated row key",
        ));
    }
    Ok(envelope)
}

fn validate_envelope(
    envelope: &MobileDraftEnvelopeV2,
    scope: &ExactScope,
) -> ReliabilityResult<()> {
    if envelope.schema_revision != RELIABILITY_SCHEMA_REVISION {
        return Err(ReliabilityError::invalid(
            "unsupported generated draft schema revision",
        ));
    }
    if envelope.station_peer_id != scope.station_peer_id()
        || envelope.actor_ptid != scope.actor_ptid()
    {
        return Err(ReliabilityError::authentication(
            "generated draft envelope does not match the open Station/PTID scope",
        ));
    }
    validate_target_id(&envelope.target_id)?;
    let updated_at = envelope
        .updated_at
        .as_ref()
        .ok_or_else(|| ReliabilityError::invalid("draft updated_at is required"))?;
    if !(0..1_000_000_000).contains(&updated_at.nanos) {
        return Err(ReliabilityError::invalid(
            "draft updated_at nanoseconds are invalid",
        ));
    }
    let surface = MobileDraftSurfaceKind::try_from(envelope.surface_kind)
        .map_err(|_| ReliabilityError::invalid("draft surface enum is unknown"))?;
    match (surface, envelope.payload.as_ref()) {
        (
            MobileDraftSurfaceKind::ChatComposer,
            Some(mobile_draft_envelope_v2::Payload::Chat(chat)),
        ) => validate_chat_payload(chat),
        (
            MobileDraftSurfaceKind::MomentComposer,
            Some(mobile_draft_envelope_v2::Payload::Moment(moment)),
        ) => validate_moment_payload(moment),
        (MobileDraftSurfaceKind::Unspecified, _) => Err(ReliabilityError::invalid(
            "draft surface kind must be explicit",
        )),
        (_, None) => Err(ReliabilityError::invalid(
            "generated draft payload is required",
        )),
        _ => Err(ReliabilityError::invalid(
            "generated draft payload does not match surface kind",
        )),
    }
}

fn validate_chat_payload(payload: &ChatDraftPayload) -> ReliabilityResult<()> {
    validate_blob_references(
        payload
            .attachment_refs
            .iter()
            .map(|reference| reference.blob_id.as_str()),
    )
}

fn validate_moment_payload(payload: &MomentDraftPayload) -> ReliabilityResult<()> {
    let audience = payload.audience.as_ref().ok_or_else(|| {
        ReliabilityError::invalid("Moment composer draft requires generated audience selection")
    })?;
    if AudienceKind::try_from(audience.kind)
        .map_err(|_| ReliabilityError::invalid("Moment draft audience kind is unknown"))?
        == AudienceKind::Unspecified
    {
        return Err(ReliabilityError::invalid(
            "Moment composer draft audience must be explicit",
        ));
    }
    validate_blob_references(
        payload
            .media_refs
            .iter()
            .map(|reference| reference.blob_id.as_str()),
    )
}

fn validate_blob_references<'a>(
    references: impl Iterator<Item = &'a str>,
) -> ReliabilityResult<()> {
    for reference in references {
        if reference.is_empty()
            || reference.trim() != reference
            || reference.as_bytes().contains(&0)
            || reference.len() > MAX_BLOB_REFERENCE_BYTES
        {
            return Err(ReliabilityError::invalid(
                "draft contains an invalid encrypted blob reference",
            ));
        }
    }
    Ok(())
}

fn validate_target_id(target_id: &str) -> ReliabilityResult<()> {
    if target_id.is_empty()
        || target_id.trim() != target_id
        || target_id.as_bytes().contains(&0)
        || target_id.len() > MAX_TARGET_ID_BYTES
    {
        return Err(ReliabilityError::invalid(
            "draft target_id is not canonical",
        ));
    }
    Ok(())
}

fn ensure_scope_directory(paths: &CanonicalScopePaths) -> ReliabilityResult<()> {
    ensure_real_directory(paths.reliability_root(), paths.v2_root())?;
    ensure_real_directory(paths.v2_root(), paths.scopes_root())?;
    ensure_real_directory(paths.scopes_root(), paths.scope_root())
}

fn ensure_real_directory(parent: &Path, directory: &Path) -> ReliabilityResult<()> {
    match fs::symlink_metadata(directory) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            Err(ReliabilityError::corrupt(format!(
                "owned draft path is not a real directory: {}",
                directory.display()
            )))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(directory)
                .map_err(|error| ReliabilityError::io("create owned draft directory", error))?;
            crate::runtime::reliability::codec::sync_directory(parent)
        }
        Err(error) => Err(ReliabilityError::io("inspect owned draft directory", error)),
    }
}

fn regular_file_exists(path: &Path) -> ReliabilityResult<bool> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err(ReliabilityError::corrupt(format!(
                "owned draft path is not a file: {}",
                path.display()
            )))
        }
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(ReliabilityError::io("inspect owned draft file", error)),
    }
}

fn harden_database_permissions(path: &Path) -> ReliabilityResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| ReliabilityError::io("restrict draft database permissions", error))?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

fn count_records(connection: &Connection, scope: &ExactScope) -> ReliabilityResult<u64> {
    connection
        .query_row(
            "SELECT COUNT(*) FROM drafts WHERE station_peer_id = ?1 AND actor_ptid = ?2",
            params![scope.station_peer_id(), scope.actor_ptid()],
            |row| row.get(0),
        )
        .map_err(|error| ReliabilityError::io("count exact-scope drafts", error))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    use zeroize::Zeroizing;

    use super::*;
    use crate::runtime::reliability::{
        CanonicalReliabilityRoot, KeyVault, ReliabilityKeyManager, SCOPE_DEK_RECORD_PREFIX,
    };
    use crate::runtime::reliability_proto::peers_touch::model::mobile::v1::{
        EncryptedBlobReference, MobileDraftEnvelopeV2,
    };
    use crate::runtime::reliability_proto::peers_touch::model::social::v1::{audience, Audience};

    #[derive(Default)]
    struct MemoryVault {
        records: Mutex<BTreeMap<String, Vec<u8>>>,
    }

    impl KeyVault for MemoryVault {
        fn load(&self, record_id: &str) -> ReliabilityResult<Option<Zeroizing<Vec<u8>>>> {
            Ok(self
                .records
                .lock()
                .unwrap()
                .get(record_id)
                .cloned()
                .map(Zeroizing::new))
        }

        fn store(&self, record_id: &str, value: &[u8]) -> ReliabilityResult<()> {
            self.records
                .lock()
                .unwrap()
                .insert(record_id.to_string(), value.to_vec());
            Ok(())
        }

        fn delete(&self, record_id: &str) -> ReliabilityResult<()> {
            self.records.lock().unwrap().remove(record_id);
            Ok(())
        }

        fn list(&self, prefix: &str) -> ReliabilityResult<Vec<String>> {
            Ok(self
                .records
                .lock()
                .unwrap()
                .keys()
                .filter(|key| key.starts_with(prefix))
                .cloned()
                .collect())
        }
    }

    struct TempAppData(PathBuf);

    impl TempAppData {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!(
                "pt-draft-v2-{}-{}",
                std::process::id(),
                ulid::Ulid::new()
            )))
        }
    }

    impl Drop for TempAppData {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn chat_envelope(scope: &ExactScope, target: &str, text: &str) -> MobileDraftEnvelopeV2 {
        MobileDraftEnvelopeV2 {
            schema_revision: RELIABILITY_SCHEMA_REVISION,
            station_peer_id: scope.station_peer_id().to_string(),
            actor_ptid: scope.actor_ptid().to_string(),
            surface_kind: MobileDraftSurfaceKind::ChatComposer as i32,
            target_id: target.to_string(),
            updated_at: Some(prost_types::Timestamp {
                seconds: 1_700_000_000,
                nanos: 123,
            }),
            payload: Some(mobile_draft_envelope_v2::Payload::Chat(ChatDraftPayload {
                text: text.to_string(),
                reply_to_message_id: "message-1".to_string(),
                attachment_refs: vec![EncryptedBlobReference {
                    blob_id: "encrypted-blob-1".to_string(),
                }],
            })),
        }
    }

    fn moment_envelope(scope: &ExactScope) -> MobileDraftEnvelopeV2 {
        MobileDraftEnvelopeV2 {
            schema_revision: RELIABILITY_SCHEMA_REVISION,
            station_peer_id: scope.station_peer_id().to_string(),
            actor_ptid: scope.actor_ptid().to_string(),
            surface_kind: MobileDraftSurfaceKind::MomentComposer as i32,
            target_id: "moment-draft-1".to_string(),
            updated_at: Some(prost_types::Timestamp {
                seconds: 1_700_000_001,
                nanos: 456,
            }),
            payload: Some(mobile_draft_envelope_v2::Payload::Moment(
                MomentDraftPayload {
                    text: "moment text".to_string(),
                    audience: Some(Audience {
                        kind: audience::Kind::Public as i32,
                        ..Default::default()
                    }),
                    media_refs: vec![EncryptedBlobReference {
                        blob_id: "encrypted-media-1".to_string(),
                    }],
                },
            )),
        }
    }

    fn open_store(
        root: &CanonicalReliabilityRoot,
        vault: &MemoryVault,
        scope: ExactScope,
    ) -> DraftStore {
        let manager = ReliabilityKeyManager::initialize(root, vault).unwrap();
        let activation = manager.activate_scope(scope).unwrap();
        DraftStore::open(&activation).unwrap()
    }

    #[test]
    fn generated_chat_and_moment_envelopes_round_trip_without_plaintext_rows() {
        let app_data = TempAppData::new();
        let root = CanonicalReliabilityRoot::from_trusted_app_data(&app_data.0).unwrap();
        let vault = MemoryVault::default();
        let scope = ExactScope::new("station-a", "ptid-a").unwrap();
        let store = open_store(&root, &vault, scope.clone());
        let chat = chat_envelope(&scope, "conversation-1", "secret composer text");
        let moment = moment_envelope(&scope);
        store.save(&chat).unwrap();
        store.save(&moment).unwrap();

        let key = DraftKey::new(
            scope.clone(),
            MobileDraftSurfaceKind::ChatComposer,
            "conversation-1",
        )
        .unwrap();
        assert_eq!(store.load(&key).unwrap(), Some(chat));
        assert_eq!(store.list(None).unwrap().len(), 2);
        let database = fs::read(root.draft_database_path(&scope)).unwrap();
        assert!(!database
            .windows(b"secret composer text".len())
            .any(|window| window == b"secret composer text"));
    }

    #[test]
    fn exact_station_ptid_surface_and_target_are_isolated() {
        let app_data = TempAppData::new();
        let root = CanonicalReliabilityRoot::from_trusted_app_data(&app_data.0).unwrap();
        let vault = MemoryVault::default();
        let scope_a = ExactScope::new("station-a", "ptid-a").unwrap();
        let scope_b = ExactScope::new("station-a", "ptid-b").unwrap();
        let store_a = open_store(&root, &vault, scope_a.clone());
        store_a
            .save(&chat_envelope(&scope_a, "conversation-1", "a"))
            .unwrap();
        let store_b = open_store(&root, &vault, scope_b.clone());
        let key_b = DraftKey::new(
            scope_b,
            MobileDraftSurfaceKind::ChatComposer,
            "conversation-1",
        )
        .unwrap();
        assert_eq!(store_b.load(&key_b).unwrap(), None);
        let cross_scope_key = DraftKey::new(
            scope_a,
            MobileDraftSurfaceKind::ChatComposer,
            "conversation-1",
        )
        .unwrap();
        assert_eq!(
            store_b.load(&cross_scope_key).unwrap_err().kind(),
            ReliabilityErrorKind::AuthenticationFailed
        );
    }

    #[test]
    fn metadata_corruption_fails_before_database_open_or_row_mutation() {
        let app_data = TempAppData::new();
        let root = CanonicalReliabilityRoot::from_trusted_app_data(&app_data.0).unwrap();
        let vault = MemoryVault::default();
        let scope = ExactScope::new("station-a", "ptid-a").unwrap();
        let store = open_store(&root, &vault, scope.clone());
        store
            .save(&chat_envelope(&scope, "conversation-1", "retained"))
            .unwrap();
        drop(store);

        let metadata_path = root.draft_metadata_path(&scope);
        let original = fs::read(&metadata_path).unwrap();
        let mut corrupted = original.clone();
        *corrupted.last_mut().unwrap() ^= 0x80;
        fs::write(&metadata_path, corrupted).unwrap();
        let activation = ReliabilityKeyManager::initialize(&root, &vault)
            .unwrap()
            .activate_scope(scope.clone())
            .unwrap();
        assert_eq!(
            DraftStore::open(&activation).err().unwrap().kind(),
            ReliabilityErrorKind::AuthenticationFailed
        );
        fs::write(&metadata_path, original).unwrap();
        let reopened = open_store(&root, &vault, scope);
        assert_eq!(reopened.count().unwrap(), 1);
    }

    #[test]
    fn invalid_generated_membership_is_rejected_without_mutation() {
        let app_data = TempAppData::new();
        let root = CanonicalReliabilityRoot::from_trusted_app_data(&app_data.0).unwrap();
        let vault = MemoryVault::default();
        let scope = ExactScope::new("station-a", "ptid-a").unwrap();
        let store = open_store(&root, &vault, scope.clone());
        let mut invalid = chat_envelope(&scope, "conversation-1", "text");
        invalid.surface_kind = MobileDraftSurfaceKind::MomentComposer as i32;
        assert!(store.save(&invalid).is_err());
        assert_eq!(store.count().unwrap(), 0);
    }

    #[test]
    fn missing_scope_key_never_regenerates_over_existing_ciphertext() {
        let app_data = TempAppData::new();
        let root = CanonicalReliabilityRoot::from_trusted_app_data(&app_data.0).unwrap();
        let vault = MemoryVault::default();
        let scope = ExactScope::new("station-a", "ptid-a").unwrap();
        let store = open_store(&root, &vault, scope.clone());
        store
            .save(&chat_envelope(&scope, "conversation-1", "retained"))
            .unwrap();
        drop(store);
        vault
            .records
            .lock()
            .unwrap()
            .retain(|record_id, _| !record_id.starts_with(SCOPE_DEK_RECORD_PREFIX));

        let error = ReliabilityKeyManager::initialize(&root, &vault)
            .unwrap()
            .activate_scope(scope)
            .err()
            .unwrap();
        assert_eq!(error.kind(), ReliabilityErrorKind::KeyUnavailable);
    }

    #[test]
    fn retain_closes_and_discard_reports_only_logical_cleanup() {
        let app_data = TempAppData::new();
        let root = CanonicalReliabilityRoot::from_trusted_app_data(&app_data.0).unwrap();
        let vault = MemoryVault::default();
        let scope = ExactScope::new("station-a", "ptid-a").unwrap();
        let store = open_store(&root, &vault, scope.clone());
        store
            .save(&chat_envelope(&scope, "conversation-1", "text"))
            .unwrap();
        let cleanup = store.discard_scope().unwrap();
        assert!(cleanup.records_absent);
        assert!(!cleanup.paths_absent);
        assert!(!cleanup.keys_absent);
        assert!(!cleanup.secure_physical_deletion_proven);
        store
            .save(&chat_envelope(&scope, "conversation-2", "retained"))
            .unwrap();
        let retained = store.close_retaining().unwrap();
        assert_eq!(retained.retained_records, 1);
        assert_eq!(
            store.count().unwrap_err().kind(),
            ReliabilityErrorKind::StoreClosed
        );
    }
}
