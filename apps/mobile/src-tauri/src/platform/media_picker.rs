use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use prost::Message;
use secure_content_core::object::{
    decrypt_object_chunk, encrypt_object_chunk, EncryptedObjectChunk, ObjectCryptoMaterial,
    OBJECT_CHUNK_SIZE, OBJECT_TAG_SIZE,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_peers_platform_permissions::{
    NativeMediaPickItem, NativeMediaPickRequest, NativeMediaPickResponse, PlatformPermissions,
};
use ulid::Ulid;

use crate::error::{MobileError, MobileResult};
use crate::platform::lifecycle_bridge;
use crate::platform::secure_storage::SecureStorage;
use crate::runtime::oauth::session::authenticated_native_session;
use crate::runtime::station_transport::{upload_native_file, NativeFileUpload};
use crate::secure_content::private_mention::domain_hmac_sha256;
use crate::secure_content::proto::common::v1::EncryptedMediaDescriptor;
use crate::secure_content::proto::secure_content::v1 as wire;
use crate::secure_content::proto::social::v1::{self as social, ImageAttachment};

const MAX_PICK_DEADLINE_MS: u64 = 5 * 60 * 1_000;
const MAX_PICK_ITEMS: u32 = 10;
const MAX_PICK_BYTES: u64 = 64 * 1024 * 1024;
const MAX_MIME_LENGTH: usize = 255;
const COPY_BUFFER_BYTES: usize = 64 * 1024;
const MAX_MOMENT_CIPHERTEXT_BYTES: u64 = 32 * 1024 * 1024;
const MOMENT_MEDIA_SURFACE: &str = "moment_media";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaPickInput {
    station_peer_id: String,
    actor_ptid: String,
    session_id: String,
    request_id: String,
    surface_kind: String,
    capability: String,
    deadline_ms: u64,
    accepted_media_kinds: Vec<String>,
    max_item_count: u32,
    max_total_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedMediaHandle {
    handle: String,
    media_kind: String,
    mime_type: String,
    byte_length: u64,
    sha256_base64: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaPickProjection {
    request_id: String,
    lifecycle_generation: u64,
    outcome: String,
    items: Vec<StagedMediaHandle>,
    error_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StagedMomentMediaInput {
    station_peer_id: String,
    actor_ptid: String,
    session_id: String,
    handle: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StagedMediaMetadata {
    handle: String,
    media_kind: String,
    mime_type: String,
    byte_length: u64,
    sha256_base64: String,
}

pub(crate) struct PreparedMomentMedia {
    ciphertext_path: PathBuf,
    mime_type: String,
    plaintext_size: u64,
    ciphertext_size: u64,
    plaintext_sha256: [u8; 32],
    ciphertext_sha256: [u8; 32],
    material: ObjectCryptoMaterial,
    chunk_count: u32,
    chunk_ciphertext_sha256: Vec<Vec<u8>>,
}

impl PreparedMomentMedia {
    pub(crate) fn upload_spec(
        &self,
        resource: &wire::SecureResourceRef,
        object_id: &str,
    ) -> wire::EncryptedObjectUploadSpec {
        wire::EncryptedObjectUploadSpec {
            resource: Some(resource.clone()),
            object_id: object_id.to_string(),
            ciphertext_size: self.ciphertext_size,
            ciphertext_sha256: self.ciphertext_sha256.to_vec(),
            chunk_size: self.material.chunk_size(),
            chunk_count: self.chunk_count,
            encryption_suite: wire::ObjectEncryptionSuite::Aes256GcmChunked as i32,
            tag_size: OBJECT_TAG_SIZE,
            nonce_strategy: wire::ObjectNonceStrategy::Counter32Be as i32,
            chunk_ciphertext_sha256: self.chunk_ciphertext_sha256.clone(),
        }
    }

    pub(crate) fn descriptor_commitment_sha256(
        &self,
        resource: &wire::SecureResourceRef,
        object_id: &str,
    ) -> [u8; 32] {
        let input = wire::EncryptedObjectDescriptorCommitmentInput {
            format_version: 1,
            resource: Some(resource.clone()),
            object_id: object_id.to_string(),
            upload_spec: Some(self.upload_spec(resource, object_id)),
        };
        Sha256::digest(input.encode_to_vec()).into()
    }

    pub(crate) fn chunk_count(&self) -> u32 {
        self.chunk_count
    }

    pub(crate) fn chunk_stride(&self) -> u64 {
        u64::from(self.material.chunk_size() + OBJECT_TAG_SIZE)
    }

    pub(crate) fn chunk_sha256(&self, chunk_index: u32) -> MobileResult<[u8; 32]> {
        self.chunk_ciphertext_sha256
            .get(chunk_index as usize)
            .ok_or_else(|| picker_error("private Moment media chunk hash is unavailable"))?
            .as_slice()
            .try_into()
            .map_err(|_| picker_error("private Moment media chunk hash is invalid"))
    }

    pub(crate) fn ciphertext_chunk(&self, chunk_index: u32) -> MobileResult<Vec<u8>> {
        if chunk_index >= self.chunk_count {
            return Err(picker_error("private Moment media chunk index is invalid"));
        }
        let offset = u64::from(chunk_index)
            .saturating_mul(u64::from(self.material.chunk_size() + OBJECT_TAG_SIZE));
        let remaining = self.ciphertext_size.saturating_sub(offset);
        let length = remaining.min(u64::from(self.material.chunk_size() + OBJECT_TAG_SIZE));
        let mut file = File::open(&self.ciphertext_path)
            .map_err(|error| picker_error(format!("open private Moment ciphertext: {error}")))?;
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| picker_error(format!("seek private Moment ciphertext: {error}")))?;
        let mut ciphertext = vec![
            0_u8;
            usize::try_from(length).map_err(|_| {
                picker_error("private Moment ciphertext chunk size is invalid")
            })?
        ];
        file.read_exact(&mut ciphertext)
            .map_err(|error| picker_error(format!("read private Moment ciphertext: {error}")))?;
        Ok(ciphertext)
    }

    pub(crate) fn attachment_metadata(
        &self,
        attachment_id: &str,
        descriptor: wire::EncryptedObjectDescriptor,
        width: u32,
        height: u32,
        duration_ms: u32,
        alt_text: String,
    ) -> social::PrivateAttachmentMetadata {
        social::PrivateAttachmentMetadata {
            attachment_id: attachment_id.to_string(),
            filename: attachment_id.to_string(),
            mime_type: self.mime_type.clone(),
            plaintext_size: self.plaintext_size,
            plaintext_sha256: self.plaintext_sha256.to_vec(),
            object_key: self.material.object_key().to_vec(),
            base_nonce: self.material.base_nonce().to_vec(),
            object: Some(descriptor),
            width,
            height,
            duration_ms,
            alt_text,
        }
    }
}

pub async fn pick<R: Runtime>(
    app: &AppHandle<R>,
    storage: &SecureStorage,
    input: MediaPickInput,
) -> MobileResult<MediaPickProjection> {
    let _session = authenticated_native_session(
        storage,
        &input.station_peer_id,
        &input.actor_ptid,
        &input.session_id,
    )?;
    let now_ms = current_time_ms()?;
    let lifecycle_generation = lifecycle_bridge::current_generation();
    validate_request(&input, lifecycle_generation, now_ms)?;
    let platform = app
        .try_state::<PlatformPermissions<R>>()
        .ok_or_else(|| picker_error("native platform plugin is not registered"))?;
    let response = platform
        .pick_media(NativeMediaPickRequest {
            request_id: &input.request_id,
            surface_kind: &input.surface_kind,
            capability: &input.capability,
            lifecycle_generation,
            deadline_ms: input.deadline_ms,
            accepted_media_kinds: &input.accepted_media_kinds,
            max_item_count: input.max_item_count,
            max_total_bytes: input.max_total_bytes,
        })
        .await
        .map_err(|error| picker_error(format!("native media picker failed: {error}")))?;
    validate_response_identity(&input, lifecycle_generation, &response, current_time_ms()?)?;
    if response.outcome != "selected" {
        if !response.items.is_empty() {
            cleanup_native_items(&response.items);
            return Err(picker_error("non-selected picker result contains items"));
        }
        if !matches!(
            response.outcome.as_str(),
            "cancelled" | "permission_required" | "expired" | "failed"
        ) {
            return Err(picker_error("native picker outcome is invalid"));
        }
        return Ok(MediaPickProjection {
            request_id: input.request_id,
            lifecycle_generation,
            outcome: response.outcome,
            items: Vec::new(),
            error_code: response.error_code,
        });
    }

    let root = staging_root(
        app,
        &input.station_peer_id,
        &input.actor_ptid,
        &input.surface_kind,
    )?;
    let staged = stage_selected_items(&root, &input, &response);
    cleanup_native_items(&response.items);
    let items = staged?;
    Ok(MediaPickProjection {
        request_id: input.request_id,
        lifecycle_generation,
        outcome: "selected".to_string(),
        items,
        error_code: None,
    })
}

pub async fn upload_moment_media<R: Runtime>(
    app: &AppHandle<R>,
    storage: &SecureStorage,
    input: StagedMomentMediaInput,
) -> MobileResult<Vec<u8>> {
    let session = authenticated_native_session(
        storage,
        &input.station_peer_id,
        &input.actor_ptid,
        &input.session_id,
    )?;
    let root = staging_root(
        app,
        &input.station_peer_id,
        &input.actor_ptid,
        MOMENT_MEDIA_SURFACE,
    )?;
    let metadata = load_staged_metadata(&root, &input.handle)?;
    if metadata.media_kind != "image" {
        return Err(picker_error("moment media handle is not an image"));
    }
    let prepared = prepare_moment_media(&root, &metadata)?;
    let ciphertext_sha256_hex = hex_digest(&prepared.ciphertext_sha256);
    let upload = upload_native_file(
        &session,
        "moment_media_upload",
        &prepared.ciphertext_path,
        &format!("{}.bin", metadata.handle),
        "moments",
        "public",
        prepared.ciphertext_size,
        &ciphertext_sha256_hex,
    )
    .await;
    let _ = fs::remove_file(&prepared.ciphertext_path);
    let uploaded = upload?;
    let attachment = build_moment_image_attachment(&prepared, uploaded)?;
    cleanup_staged_handle(&root, &metadata.handle);
    Ok(attachment.encode_to_vec())
}

pub(crate) fn prepare_private_moment_media<R: Runtime>(
    app: &AppHandle<R>,
    station_peer_id: &str,
    actor_ptid: &str,
    handle: &str,
    object_id: &str,
    object_material_seed: &[u8; 32],
) -> MobileResult<PreparedMomentMedia> {
    let root = staging_root(app, station_peer_id, actor_ptid, MOMENT_MEDIA_SURFACE)?;
    let metadata = load_staged_metadata(&root, handle)?;
    let object_key = domain_hmac_sha256(
        object_material_seed,
        &[
            b"peers-touch:mobile-private-object-key:v1",
            object_id.as_bytes(),
        ],
    );
    let nonce_digest = domain_hmac_sha256(
        object_material_seed,
        &[
            b"peers-touch:mobile-private-object-nonce:v1",
            object_id.as_bytes(),
        ],
    );
    let mut base_nonce = [0_u8; 12];
    base_nonce.copy_from_slice(&nonce_digest[..12]);
    let material = ObjectCryptoMaterial::from_parts(
        object_key,
        base_nonce,
        metadata.byte_length,
        OBJECT_CHUNK_SIZE,
    )
    .map_err(picker_error)?;
    prepare_moment_media_with_material(&root, &metadata, material)
}

pub(crate) fn discard_private_moment_ciphertext(prepared: &PreparedMomentMedia) {
    let _ = fs::remove_file(&prepared.ciphertext_path);
}

pub(crate) fn consume_private_moment_media_handle<R: Runtime>(
    app: &AppHandle<R>,
    station_peer_id: &str,
    actor_ptid: &str,
    handle: &str,
) -> MobileResult<()> {
    if Ulid::from_string(handle).is_err() {
        return Err(picker_error("staged media handle is invalid"));
    }
    let root = staging_root(app, station_peer_id, actor_ptid, MOMENT_MEDIA_SURFACE)?;
    cleanup_staged_handle(&root, handle);
    Ok(())
}

pub(crate) fn purge_private_moment_media_cache<R: Runtime>(
    app: &AppHandle<R>,
    station_peer_id: &str,
    actor_ptid: &str,
) -> MobileResult<()> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| picker_error(format!("resolve app data directory: {error}")))?
        .join("private-social-media-cache")
        .join("v1")
        .join(scope_digest_parts(
            station_peer_id,
            actor_ptid,
            "private_moment",
        ));
    if root.exists() {
        fs::remove_dir_all(&root)
            .map_err(|error| picker_error(format!("purge private Moment media cache: {error}")))?;
    }
    Ok(())
}

pub(crate) fn materialize_private_moment_media<R, F>(
    app: &AppHandle<R>,
    station_peer_id: &str,
    actor_ptid: &str,
    metadata: &social::PrivateAttachmentMetadata,
    descriptor: &wire::EncryptedObjectDescriptor,
    mut fetch_chunk: F,
) -> MobileResult<String>
where
    R: Runtime,
    F: FnMut(u32, u64, u64, &[u8; 32]) -> Result<Vec<u8>, String>,
{
    let commitment = descriptor
        .commitment
        .as_ref()
        .ok_or_else(|| picker_error("private Moment object commitment is unavailable"))?;
    if metadata.object.as_ref() != Some(descriptor)
        || metadata.object_key.len() != 32
        || metadata.base_nonce.len() != 12
        || metadata.plaintext_sha256.len() != 32
        || metadata.plaintext_size == 0
        || commitment.chunk_count == 0
        || commitment.chunk_ciphertext_sha256.len() != commitment.chunk_count as usize
    {
        return Err(picker_error("private Moment media metadata is invalid"));
    }
    let material = ObjectCryptoMaterial::from_parts(
        metadata
            .object_key
            .as_slice()
            .try_into()
            .map_err(|_| picker_error("private Moment object key is invalid"))?,
        metadata
            .base_nonce
            .as_slice()
            .try_into()
            .map_err(|_| picker_error("private Moment object nonce is invalid"))?,
        metadata.plaintext_size,
        commitment.chunk_size,
    )
    .map_err(picker_error)?;
    let descriptor_sha256: [u8; 32] = Sha256::digest(descriptor.encode_to_vec()).into();
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| picker_error(format!("resolve app data directory: {error}")))?
        .join("private-social-media-cache")
        .join("v1")
        .join(scope_digest_parts(
            station_peer_id,
            actor_ptid,
            "private_moment",
        ));
    create_staging_directory(&root)?;
    let name = hex_digest(&Sha256::digest(descriptor.object_id.as_bytes()).into());
    let destination = root.join(format!("{name}.media"));
    let temporary = root.join(format!("{name}.partial"));
    let result = (|| {
        let mut writer = BufWriter::new(create_private_file(&temporary)?);
        let mut plaintext_hasher = Sha256::new();
        for chunk_index in 0..material.chunk_count() {
            let start = u64::from(chunk_index)
                .saturating_mul(u64::from(material.chunk_size() + OBJECT_TAG_SIZE));
            let remaining = commitment.ciphertext_size.saturating_sub(start);
            let length = remaining.min(u64::from(material.chunk_size() + OBJECT_TAG_SIZE));
            let expected_hash: [u8; 32] = commitment.chunk_ciphertext_sha256[chunk_index as usize]
                .as_slice()
                .try_into()
                .map_err(|_| picker_error("private Moment object chunk hash is invalid"))?;
            let ciphertext = fetch_chunk(
                chunk_index,
                start,
                start.saturating_add(length).saturating_sub(1),
                &descriptor_sha256,
            )
            .map_err(picker_error)?;
            let plaintext = decrypt_object_chunk(
                &material,
                &EncryptedObjectChunk {
                    chunk_index,
                    ciphertext,
                    ciphertext_sha256: expected_hash,
                },
            )
            .map_err(picker_error)?;
            plaintext_hasher.update(&plaintext);
            writer
                .write_all(&plaintext)
                .map_err(|error| picker_error(format!("write private Moment media: {error}")))?;
        }
        writer
            .flush()
            .map_err(|error| picker_error(format!("flush private Moment media: {error}")))?;
        let file = writer
            .into_inner()
            .map_err(|error| picker_error(format!("finalize private Moment media: {error}")))?;
        file.sync_all()
            .map_err(|error| picker_error(format!("sync private Moment media: {error}")))?;
        if Sha256::digest([]).as_slice() == metadata.plaintext_sha256.as_slice()
            || plaintext_hasher.finalize().as_slice() != metadata.plaintext_sha256
        {
            return Err(picker_error(
                "private Moment media plaintext hash mismatched",
            ));
        }
        if destination.exists() {
            fs::remove_file(&destination)
                .map_err(|error| picker_error(format!("replace private Moment media: {error}")))?;
        }
        fs::rename(&temporary, &destination)
            .map_err(|error| picker_error(format!("commit private Moment media: {error}")))?;
        Ok::<_, MobileError>(destination.to_string_lossy().into_owned())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn build_moment_image_attachment(
    prepared: &PreparedMomentMedia,
    uploaded: NativeFileUpload,
) -> MobileResult<ImageAttachment> {
    let plaintext_size = i64::try_from(prepared.plaintext_size)
        .map_err(|_| picker_error("moment media plaintext size exceeds i64"))?;
    let ciphertext_size = i64::try_from(uploaded.size)
        .map_err(|_| picker_error("moment media ciphertext size exceeds i64"))?;
    Ok(ImageAttachment {
        id: uploaded.reference.clone(),
        url: uploaded.reference,
        size_bytes: plaintext_size,
        media_encryption: Some(EncryptedMediaDescriptor {
            encrypted: true,
            version: 2,
            suite: "AES-256-GCM-CHUNKED".to_string(),
            key_b64: STANDARD.encode(prepared.material.object_key()),
            nonce_b64: STANDARD.encode(prepared.material.base_nonce()),
            plaintext_sha256_b64: STANDARD.encode(prepared.plaintext_sha256),
            ciphertext_sha256_b64: STANDARD.encode(prepared.ciphertext_sha256),
            plaintext_size,
            ciphertext_size,
            chunking: "fixed-v1".to_string(),
            chunk_size: OBJECT_CHUNK_SIZE,
            chunk_count: prepared.chunk_count,
            tag_size: OBJECT_TAG_SIZE,
            nonce_strategy: "prefix-counter32-be".to_string(),
        }),
        ..Default::default()
    })
}

pub fn discard_moment_media<R: Runtime>(
    app: &AppHandle<R>,
    storage: &SecureStorage,
    input: StagedMomentMediaInput,
) -> MobileResult<()> {
    let _session = authenticated_native_session(
        storage,
        &input.station_peer_id,
        &input.actor_ptid,
        &input.session_id,
    )?;
    let root = staging_root(
        app,
        &input.station_peer_id,
        &input.actor_ptid,
        MOMENT_MEDIA_SURFACE,
    )?;
    if Ulid::from_string(&input.handle).is_err() {
        return Err(picker_error("staged media handle is invalid"));
    }
    if !root.join(format!("{}.json", input.handle)).exists() {
        cleanup_staged_handle(&root, &input.handle);
        return Ok(());
    }
    let metadata = load_staged_metadata(&root, &input.handle)?;
    cleanup_staged_handle(&root, &metadata.handle);
    Ok(())
}

fn validate_request(input: &MediaPickInput, generation: u64, now_ms: u64) -> MobileResult<()> {
    if Ulid::from_string(&input.request_id).is_err()
        || !matches!(
            input.surface_kind.as_str(),
            "chat_attachment" | "moment_media"
        )
        || !matches!(
            input.capability.as_str(),
            "photo_library" | "camera" | "document"
        )
        || generation == 0
        || input.deadline_ms <= now_ms
        || input.deadline_ms > now_ms.saturating_add(MAX_PICK_DEADLINE_MS)
        || input.max_item_count == 0
        || input.max_item_count > MAX_PICK_ITEMS
        || input.max_total_bytes == 0
        || input.max_total_bytes > MAX_PICK_BYTES
        || input.accepted_media_kinds.is_empty()
        || input.accepted_media_kinds.len() > 3
    {
        return Err(picker_error("native media picker request is invalid"));
    }
    if input
        .accepted_media_kinds
        .iter()
        .any(|kind| !matches!(kind.as_str(), "image" | "video" | "file"))
    {
        return Err(picker_error("native media kind is invalid"));
    }
    Ok(())
}

fn validate_response_identity(
    input: &MediaPickInput,
    generation: u64,
    response: &NativeMediaPickResponse,
    now_ms: u64,
) -> MobileResult<()> {
    if response.request_id != input.request_id
        || response.lifecycle_generation != generation
        || response.lifecycle_generation != lifecycle_bridge::current_generation()
        || now_ms > input.deadline_ms
    {
        cleanup_native_items(&response.items);
        return Err(picker_error("native media picker result is stale"));
    }
    Ok(())
}

fn stage_selected_items(
    root: &Path,
    input: &MediaPickInput,
    response: &NativeMediaPickResponse,
) -> MobileResult<Vec<StagedMediaHandle>> {
    if response.items.is_empty() || response.items.len() > input.max_item_count as usize {
        return Err(picker_error("native media picker item count is invalid"));
    }
    create_staging_directory(root)?;

    let mut total_bytes = 0_u64;
    let mut staged = Vec::with_capacity(response.items.len());
    let mut staged_paths = Vec::with_capacity(response.items.len() * 2);
    for item in &response.items {
        let result = stage_one_item(root, input, item, &mut total_bytes);
        match result {
            Ok((handle, paths)) => {
                staged_paths.extend(paths);
                staged.push(handle);
            }
            Err(error) => {
                for path in staged_paths {
                    let _ = fs::remove_file(path);
                }
                return Err(error);
            }
        }
    }
    Ok(staged)
}

fn stage_one_item(
    root: &Path,
    input: &MediaPickInput,
    item: &NativeMediaPickItem,
    total_bytes: &mut u64,
) -> MobileResult<(StagedMediaHandle, Vec<PathBuf>)> {
    if !input
        .accepted_media_kinds
        .iter()
        .any(|kind| kind == &item.media_kind)
        || item.mime_type.is_empty()
        || item.mime_type.len() > MAX_MIME_LENGTH
        || item.byte_length == 0
    {
        return Err(picker_error("native media picker item metadata is invalid"));
    }
    *total_bytes = total_bytes
        .checked_add(item.byte_length)
        .ok_or_else(|| picker_error("native media picker aggregate size overflow"))?;
    if *total_bytes > input.max_total_bytes {
        return Err(picker_error(
            "native media picker aggregate size exceeds limit",
        ));
    }

    let native_source = PathBuf::from(&item.local_path);
    if fs::symlink_metadata(&native_source)
        .map_err(|error| picker_error(format!("inspect native media file: {error}")))?
        .file_type()
        .is_symlink()
    {
        return Err(picker_error("native media picker path is invalid"));
    }
    let source = fs::canonicalize(&native_source)
        .map_err(|error| picker_error(format!("resolve native media file: {error}")))?;
    if !source
        .components()
        .any(|component| component.as_os_str() == "peers-touch-native-picker")
    {
        return Err(picker_error("native media picker path is invalid"));
    }
    let metadata = fs::metadata(&source)
        .map_err(|error| picker_error(format!("read native media metadata: {error}")))?;
    if !metadata.is_file() || metadata.len() != item.byte_length {
        return Err(picker_error("native media picker file length mismatch"));
    }
    let expected_sha256 = decode_sha256(&item.sha256_base64)?;
    let handle = Ulid::new().to_string();
    let destination = root.join(format!("{handle}.stage"));
    let copy_result = (|| {
        let mut source_file = File::open(&source)
            .map_err(|error| picker_error(format!("open native media file: {error}")))?;
        let mut destination_file = create_private_file(&destination)?;
        let mut hasher = Sha256::new();
        let mut copied = 0_u64;
        let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];
        loop {
            let read = source_file
                .read(&mut buffer)
                .map_err(|error| picker_error(format!("read native media file: {error}")))?;
            if read == 0 {
                break;
            }
            destination_file
                .write_all(&buffer[..read])
                .map_err(|error| picker_error(format!("write staged media file: {error}")))?;
            hasher.update(&buffer[..read]);
            copied = copied
                .checked_add(read as u64)
                .ok_or_else(|| picker_error("native media copy size overflow"))?;
            if copied > item.byte_length {
                return Err(picker_error("native media file grew during copy"));
            }
        }
        destination_file
            .sync_all()
            .map_err(|error| picker_error(format!("sync staged media file: {error}")))?;
        Ok::<_, MobileError>((copied, <[u8; 32]>::from(hasher.finalize())))
    })();
    let (copied, actual_sha256) = match copy_result {
        Ok(result) => result,
        Err(error) => {
            let _ = fs::remove_file(&destination);
            return Err(error);
        }
    };
    if copied != item.byte_length || actual_sha256 != expected_sha256 {
        let _ = fs::remove_file(&destination);
        return Err(picker_error("native media hash verification failed"));
    }

    let metadata = StagedMediaMetadata {
        handle: handle.clone(),
        media_kind: item.media_kind.clone(),
        mime_type: item.mime_type.clone(),
        byte_length: item.byte_length,
        sha256_base64: STANDARD.encode(actual_sha256),
    };
    let metadata_path = match write_staged_metadata(root, &metadata) {
        Ok(path) => path,
        Err(error) => {
            let _ = fs::remove_file(&destination);
            return Err(error);
        }
    };
    Ok((
        StagedMediaHandle {
            handle,
            media_kind: item.media_kind.clone(),
            mime_type: item.mime_type.clone(),
            byte_length: item.byte_length,
            sha256_base64: STANDARD.encode(actual_sha256),
        },
        vec![destination, metadata_path],
    ))
}

fn staging_root<R: Runtime>(
    app: &AppHandle<R>,
    station_peer_id: &str,
    actor_ptid: &str,
    surface_kind: &str,
) -> MobileResult<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| picker_error(format!("resolve app data directory: {error}")))?
        .join("native-media-staging")
        .join("v1")
        .join(scope_digest_parts(
            station_peer_id,
            actor_ptid,
            surface_kind,
        )))
}

fn create_staging_directory(path: &Path) -> MobileResult<()> {
    fs::create_dir_all(path)
        .map_err(|error| picker_error(format!("create media staging directory: {error}")))?;
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| picker_error(format!("secure media staging directory: {error}")))?;
    Ok(())
}

fn create_private_file(path: &Path) -> MobileResult<File> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);
    options
        .open(path)
        .map_err(|error| picker_error(format!("create staged media file: {error}")))
}

fn write_staged_metadata(root: &Path, metadata: &StagedMediaMetadata) -> MobileResult<PathBuf> {
    let encoded = serde_json::to_vec(metadata)
        .map_err(|error| picker_error(format!("encode staged media metadata: {error}")))?;
    if encoded.len() > 4096 {
        return Err(picker_error("staged media metadata exceeds limit"));
    }
    let path = root.join(format!("{}.json", metadata.handle));
    let mut file = create_private_file(&path)?;
    if let Err(error) = file.write_all(&encoded).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&path);
        return Err(picker_error(format!(
            "persist staged media metadata: {error}"
        )));
    }
    Ok(path)
}

fn load_staged_metadata(root: &Path, handle: &str) -> MobileResult<StagedMediaMetadata> {
    if Ulid::from_string(handle).is_err() {
        return Err(picker_error("staged media handle is invalid"));
    }
    let path = root.join(format!("{handle}.json"));
    let path_metadata = fs::symlink_metadata(&path)
        .map_err(|_| picker_error("staged media metadata is missing"))?;
    if path_metadata.file_type().is_symlink()
        || !path_metadata.is_file()
        || path_metadata.len() > 4096
    {
        return Err(picker_error("staged media metadata is invalid"));
    }
    let encoded = fs::read(&path)
        .map_err(|error| picker_error(format!("read staged media metadata: {error}")))?;
    let metadata: StagedMediaMetadata = serde_json::from_slice(&encoded)
        .map_err(|_| picker_error("staged media metadata is invalid"))?;
    if metadata.handle != handle
        || !matches!(metadata.media_kind.as_str(), "image" | "video" | "file")
        || metadata.mime_type.is_empty()
        || metadata.mime_type.len() > MAX_MIME_LENGTH
        || metadata.byte_length == 0
        || metadata.byte_length > MAX_PICK_BYTES
    {
        return Err(picker_error("staged media metadata is invalid"));
    }
    decode_sha256(&metadata.sha256_base64)?;
    Ok(metadata)
}

fn prepare_moment_media(
    root: &Path,
    metadata: &StagedMediaMetadata,
) -> MobileResult<PreparedMomentMedia> {
    let material = ObjectCryptoMaterial::generate(metadata.byte_length).map_err(picker_error)?;
    prepare_moment_media_with_material(root, metadata, material)
}

fn prepare_moment_media_with_material(
    root: &Path,
    metadata: &StagedMediaMetadata,
    material: ObjectCryptoMaterial,
) -> MobileResult<PreparedMomentMedia> {
    let plaintext_path = root.join(format!("{}.stage", metadata.handle));
    let plaintext_metadata = fs::symlink_metadata(&plaintext_path)
        .map_err(|_| picker_error("staged media file is missing"))?;
    if plaintext_metadata.file_type().is_symlink()
        || !plaintext_metadata.is_file()
        || plaintext_metadata.len() != metadata.byte_length
    {
        return Err(picker_error("staged media file is invalid"));
    }
    let chunk_count = material.chunk_count();
    let ciphertext_size = metadata
        .byte_length
        .checked_add(u64::from(chunk_count) * u64::from(OBJECT_TAG_SIZE))
        .ok_or_else(|| picker_error("moment media ciphertext size overflow"))?;
    if ciphertext_size > MAX_MOMENT_CIPHERTEXT_BYTES {
        return Err(picker_error("moment media exceeds Station upload limit"));
    }

    let ciphertext_path = root.join(format!("{}.cipher", metadata.handle));
    if let Ok(existing) = fs::symlink_metadata(&ciphertext_path) {
        if existing.file_type().is_symlink() || !existing.is_file() {
            return Err(picker_error("moment media ciphertext path is invalid"));
        }
        fs::remove_file(&ciphertext_path)
            .map_err(|error| picker_error(format!("replace moment media ciphertext: {error}")))?;
    }

    let encryption_result = (|| {
        let mut reader = BufReader::new(
            File::open(&plaintext_path)
                .map_err(|error| picker_error(format!("open staged media file: {error}")))?,
        );
        let mut writer = BufWriter::new(create_private_file(&ciphertext_path)?);
        let mut plaintext_hasher = Sha256::new();
        let mut ciphertext_hasher = Sha256::new();
        let mut chunk_ciphertext_sha256 = Vec::with_capacity(chunk_count as usize);
        for chunk_index in 0..chunk_count {
            let offset = u64::from(chunk_index) * u64::from(OBJECT_CHUNK_SIZE);
            let chunk_length =
                usize::try_from((metadata.byte_length - offset).min(u64::from(OBJECT_CHUNK_SIZE)))
                    .map_err(|_| picker_error("moment media chunk size is invalid"))?;
            let mut plaintext = vec![0_u8; chunk_length];
            reader
                .read_exact(&mut plaintext)
                .map_err(|error| picker_error(format!("read staged media chunk: {error}")))?;
            plaintext_hasher.update(&plaintext);
            let encrypted =
                encrypt_object_chunk(&material, chunk_index, &plaintext).map_err(picker_error)?;
            writer
                .write_all(&encrypted.ciphertext)
                .map_err(|error| picker_error(format!("write encrypted media chunk: {error}")))?;
            ciphertext_hasher.update(&encrypted.ciphertext);
            chunk_ciphertext_sha256.push(encrypted.ciphertext_sha256.to_vec());
        }
        let mut trailing = [0_u8; 1];
        if reader
            .read(&mut trailing)
            .map_err(|error| picker_error(format!("verify staged media length: {error}")))?
            != 0
        {
            return Err(picker_error("staged media file grew during encryption"));
        }
        writer
            .flush()
            .map_err(|error| picker_error(format!("flush encrypted media: {error}")))?;
        let file = writer
            .into_inner()
            .map_err(|error| picker_error(format!("finalize encrypted media: {error}")))?;
        file.sync_all()
            .map_err(|error| picker_error(format!("sync encrypted media: {error}")))?;
        let plaintext_sha256: [u8; 32] = plaintext_hasher.finalize().into();
        if plaintext_sha256 != decode_sha256(&metadata.sha256_base64)? {
            return Err(picker_error("staged media changed after selection"));
        }
        let ciphertext_sha256: [u8; 32] = ciphertext_hasher.finalize().into();
        Ok::<_, MobileError>((plaintext_sha256, ciphertext_sha256, chunk_ciphertext_sha256))
    })();
    let (plaintext_sha256, ciphertext_sha256, chunk_ciphertext_sha256) = match encryption_result {
        Ok(result) => result,
        Err(error) => {
            let _ = fs::remove_file(&ciphertext_path);
            return Err(error);
        }
    };
    let encrypted_metadata = fs::metadata(&ciphertext_path)
        .map_err(|error| picker_error(format!("inspect encrypted media: {error}")))?;
    if encrypted_metadata.len() != ciphertext_size {
        let _ = fs::remove_file(&ciphertext_path);
        return Err(picker_error("encrypted media size mismatch"));
    }
    Ok(PreparedMomentMedia {
        ciphertext_path,
        mime_type: metadata.mime_type.clone(),
        plaintext_size: metadata.byte_length,
        ciphertext_size,
        plaintext_sha256,
        ciphertext_sha256,
        material,
        chunk_count,
        chunk_ciphertext_sha256,
    })
}

fn cleanup_staged_handle(root: &Path, handle: &str) {
    for suffix in ["stage", "json", "cipher"] {
        let _ = fs::remove_file(root.join(format!("{handle}.{suffix}")));
    }
}

fn cleanup_native_items(items: &[NativeMediaPickItem]) {
    for item in items {
        if item.local_path.contains("peers-touch-native-picker") {
            let _ = fs::remove_file(&item.local_path);
        }
    }
}

fn scope_digest_parts(station_peer_id: &str, actor_ptid: &str, surface_kind: &str) -> String {
    let mut hasher = Sha256::new();
    for value in [
        station_peer_id.as_bytes(),
        actor_ptid.as_bytes(),
        surface_kind.as_bytes(),
    ] {
        hasher.update((value.len() as u64).to_be_bytes());
        hasher.update(value);
    }
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn hex_digest(digest: &[u8; 32]) -> String {
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn decode_sha256(value: &str) -> MobileResult<[u8; 32]> {
    let decoded = STANDARD
        .decode(value.as_bytes())
        .map_err(|_| picker_error("native media sha256 is not base64"))?;
    if decoded.len() != 32 || STANDARD.encode(&decoded) != value {
        return Err(picker_error("native media sha256 is invalid"));
    }
    decoded
        .try_into()
        .map_err(|_| picker_error("native media sha256 length is invalid"))
}

fn current_time_ms() -> MobileResult<u64> {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| picker_error("system clock is before unix epoch"))?;
    u64::try_from(elapsed.as_millis()).map_err(|_| picker_error("system clock exceeds u64"))
}

fn picker_error(message: impl Into<String>) -> MobileError {
    MobileError::coded("MOBILE_MEDIA_PICKER", message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use secure_content_core::object::{decrypt_object_chunk, EncryptedObjectChunk};

    #[test]
    fn selected_media_is_hash_verified_and_native_path_is_not_returned() {
        let request_id = Ulid::new().to_string();
        let source_root = std::env::temp_dir()
            .join("peers-touch-native-picker")
            .join(&request_id);
        let destination_root = std::env::temp_dir()
            .join("peers-touch-native-media-test")
            .join(&request_id);
        fs::create_dir_all(&source_root).unwrap();
        let source = source_root.join("selected.bin");
        fs::write(&source, b"selected-media").unwrap();
        let digest = Sha256::digest(b"selected-media");
        let input = MediaPickInput {
            station_peer_id: "station".to_string(),
            actor_ptid: "ptid:alice".to_string(),
            session_id: "session".to_string(),
            request_id: request_id.clone(),
            surface_kind: "moment_media".to_string(),
            capability: "photo_library".to_string(),
            deadline_ms: u64::MAX,
            accepted_media_kinds: vec!["image".to_string()],
            max_item_count: 1,
            max_total_bytes: 1024,
        };
        let response = NativeMediaPickResponse {
            request_id,
            lifecycle_generation: 1,
            outcome: "selected".to_string(),
            items: vec![NativeMediaPickItem {
                local_path: source.to_string_lossy().into_owned(),
                media_kind: "image".to_string(),
                mime_type: "image/png".to_string(),
                byte_length: 14,
                sha256_base64: STANDARD.encode(digest),
            }],
            error_code: None,
        };

        let staged = stage_selected_items(&destination_root, &input, &response).unwrap();
        assert_eq!(staged.len(), 1);
        assert!(!staged[0].handle.contains('/'));
        assert!(!format!("{staged:?}").contains(source.to_string_lossy().as_ref()));

        let metadata = load_staged_metadata(&destination_root, &staged[0].handle).unwrap();
        let prepared = prepare_moment_media(&destination_root, &metadata).unwrap();
        assert_eq!(prepared.plaintext_size, 14);
        assert_eq!(
            prepared.ciphertext_size,
            prepared.plaintext_size + u64::from(OBJECT_TAG_SIZE)
        );
        let material = ObjectCryptoMaterial::from_parts(
            *prepared.material.object_key(),
            *prepared.material.base_nonce(),
            prepared.plaintext_size,
            OBJECT_CHUNK_SIZE,
        )
        .unwrap();
        let ciphertext = fs::read(&prepared.ciphertext_path).unwrap();
        let retry_material = ObjectCryptoMaterial::from_parts(
            *prepared.material.object_key(),
            *prepared.material.base_nonce(),
            prepared.plaintext_size,
            OBJECT_CHUNK_SIZE,
        )
        .unwrap();
        let retry =
            prepare_moment_media_with_material(&destination_root, &metadata, retry_material)
                .unwrap();
        assert_eq!(fs::read(&retry.ciphertext_path).unwrap(), ciphertext);
        assert_eq!(
            retry.chunk_ciphertext_sha256,
            prepared.chunk_ciphertext_sha256
        );
        let decrypted = decrypt_object_chunk(
            &material,
            &EncryptedObjectChunk {
                chunk_index: 0,
                ciphertext_sha256: Sha256::digest(&ciphertext).into(),
                ciphertext,
            },
        )
        .unwrap();
        assert_eq!(decrypted, b"selected-media");
        let attachment = build_moment_image_attachment(
            &prepared,
            NativeFileUpload {
                reference: "oss://self/cas/image".to_string(),
                size: prepared.ciphertext_size,
            },
        )
        .unwrap();
        let round_trip = ImageAttachment::decode(attachment.encode_to_vec().as_slice()).unwrap();
        let descriptor = round_trip.media_encryption.unwrap();
        assert_eq!(round_trip.id, "oss://self/cas/image");
        assert_eq!(round_trip.size_bytes, 14);
        assert_eq!(descriptor.suite, "AES-256-GCM-CHUNKED");
        assert_eq!(descriptor.chunking, "fixed-v1");
        assert_eq!(descriptor.nonce_strategy, "prefix-counter32-be");
        assert_eq!(descriptor.chunk_size, OBJECT_CHUNK_SIZE);
        assert_eq!(descriptor.chunk_count, 1);
        assert_eq!(descriptor.tag_size, OBJECT_TAG_SIZE);

        let _ = fs::remove_dir_all(source_root);
        let _ = fs::remove_dir_all(destination_root);
    }

    #[test]
    fn staged_media_tampering_fails_before_upload() {
        let request_id = Ulid::new().to_string();
        let source_root = std::env::temp_dir()
            .join("peers-touch-native-picker")
            .join(&request_id);
        let destination_root = std::env::temp_dir()
            .join("peers-touch-native-media-test")
            .join(&request_id);
        fs::create_dir_all(&source_root).unwrap();
        let source = source_root.join("selected.bin");
        fs::write(&source, b"selected-media").unwrap();
        let input = MediaPickInput {
            station_peer_id: "station".to_string(),
            actor_ptid: "ptid:alice".to_string(),
            session_id: "session".to_string(),
            request_id: request_id.clone(),
            surface_kind: "moment_media".to_string(),
            capability: "photo_library".to_string(),
            deadline_ms: u64::MAX,
            accepted_media_kinds: vec!["image".to_string()],
            max_item_count: 1,
            max_total_bytes: 1024,
        };
        let response = NativeMediaPickResponse {
            request_id,
            lifecycle_generation: 1,
            outcome: "selected".to_string(),
            items: vec![NativeMediaPickItem {
                local_path: source.to_string_lossy().into_owned(),
                media_kind: "image".to_string(),
                mime_type: "image/png".to_string(),
                byte_length: 14,
                sha256_base64: STANDARD.encode(Sha256::digest(b"selected-media")),
            }],
            error_code: None,
        };
        let staged = stage_selected_items(&destination_root, &input, &response).unwrap();
        let metadata = load_staged_metadata(&destination_root, &staged[0].handle).unwrap();
        fs::write(
            destination_root.join(format!("{}.stage", staged[0].handle)),
            b"tampered-media",
        )
        .unwrap();

        assert!(prepare_moment_media(&destination_root, &metadata).is_err());
        assert!(!destination_root
            .join(format!("{}.cipher", staged[0].handle))
            .exists());

        let _ = fs::remove_dir_all(source_root);
        let _ = fs::remove_dir_all(destination_root);
    }
}
