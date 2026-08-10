use super::attachment::{
    decrypt_attachment_chunk, encrypt_attachment_chunk, validate_encrypted_object_descriptor,
    AttachmentCryptoMaterial, EncryptedAttachmentChunk, ATTACHMENT_TAG_SIZE,
};
use super::{AttachmentTransferRecord, MessagingStore};
use crate::model::chat::{
    AttachmentTransferState, BeginAttachmentUploadRequest, BeginAttachmentUploadResponse,
    CompleteAttachmentUploadRequest, CompleteAttachmentUploadResponse, CryptoEndpoint,
    EncryptedObjectDescriptor, EncryptedObjectUploadSpec, PutAttachmentChunkRequest,
};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use prost::Message;
use reqwest::blocking::Client;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, IF_MATCH, RANGE};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::Arc;

pub const ATTACHMENT_TRANSFER_MEMORY_OVERHEAD: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct PreparedAttachmentUpload {
    pub object: EncryptedObjectUploadSpec,
    pub descriptor_sha256: [u8; 32],
}

pub trait AttachmentTransferTransport: Send + Sync {
    fn begin_upload(
        &self,
        transfer: &AttachmentTransferRecord,
        prepared: &PreparedAttachmentUpload,
    ) -> Result<(String, u64, Vec<u8>), String>;

    fn put_upload_chunk(
        &self,
        transfer: &AttachmentTransferRecord,
        chunk: &EncryptedAttachmentChunk,
    ) -> Result<(), String>;

    fn complete_upload(
        &self,
        transfer: &AttachmentTransferRecord,
        prepared: &PreparedAttachmentUpload,
    ) -> Result<EncryptedObjectDescriptor, String>;

    fn get_download_chunk(
        &self,
        transfer: &AttachmentTransferRecord,
        descriptor: &EncryptedObjectDescriptor,
        chunk_index: u32,
        start: u64,
        end: u64,
    ) -> Result<Vec<u8>, String>;
}

pub struct AttachmentTransferWorker {
    store: Arc<MessagingStore>,
    transport: Arc<dyn AttachmentTransferTransport>,
}

pub struct StationAttachmentTransferTransport {
    token: String,
    device_id: String,
    endpoint: CryptoEndpoint,
    client: Client,
}

impl StationAttachmentTransferTransport {
    pub fn new(token: String, endpoint: CryptoEndpoint) -> Result<Self, String> {
        if token.trim().is_empty()
            || endpoint.ptid.trim().is_empty()
            || endpoint.device_id.trim().is_empty()
        {
            return Err("messaging attachment transport identity is incomplete".to_string());
        }
        Ok(Self {
            token,
            device_id: endpoint.device_id.clone(),
            endpoint,
            client: Client::new(),
        })
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::blocking::RequestBuilder {
        self.client
            .request(
                method,
                format!(
                    "{}{}",
                    crate::infrastructure::station_client::station_base_url(),
                    path
                ),
            )
            .header(AUTHORIZATION, format!("Bearer {}", self.token))
            .header("X-Device-ID", &self.device_id)
    }

    fn require_success(response: reqwest::blocking::Response) -> Result<Vec<u8>, String> {
        let status = response.status();
        let body = response.bytes().map_err(|error| error.to_string())?;
        if !status.is_success() {
            return Err(format!(
                "messaging attachment station status {}: {}",
                status,
                String::from_utf8_lossy(&body)
            ));
        }
        Ok(body.to_vec())
    }
}

impl AttachmentTransferTransport for StationAttachmentTransferTransport {
    fn begin_upload(
        &self,
        transfer: &AttachmentTransferRecord,
        prepared: &PreparedAttachmentUpload,
    ) -> Result<(String, u64, Vec<u8>), String> {
        let mut request = BeginAttachmentUploadRequest {
            conversation_id: transfer.conversation_id.clone(),
            message_id: transfer.message_id.clone(),
            attachment_id: transfer.attachment_id.clone(),
            uploader: Some(self.endpoint.clone()),
            object: Some(prepared.object.clone()),
            descriptor_commitment_sha256: Vec::new(),
            idempotency_key: transfer.attachment_id.clone(),
            authority_station_id: transfer.authority_station_id.clone(),
        };
        request.descriptor_commitment_sha256 = upload_commitment(&request)?;
        let body = Self::require_success(
            self.request(
                reqwest::Method::POST,
                "/messaging/attachments/uploads:begin",
            )
            .header(CONTENT_TYPE, "application/x-protobuf")
            .header(ACCEPT, "application/x-protobuf")
            .body(request.encode_to_vec())
            .send()
            .map_err(|error| error.to_string())?,
        )?;
        let response = BeginAttachmentUploadResponse::decode(body.as_slice())
            .map_err(|error| error.to_string())?;
        if response.authority_station_id != transfer.authority_station_id
            || response.upload_id.trim().is_empty()
            || response.generation == 0
        {
            return Err("messaging attachment begin response binding mismatch".to_string());
        }
        Ok((
            response.upload_id,
            response.generation,
            response.received_chunk_bitmap,
        ))
    }

    fn put_upload_chunk(
        &self,
        transfer: &AttachmentTransferRecord,
        chunk: &EncryptedAttachmentChunk,
    ) -> Result<(), String> {
        let metadata = PutAttachmentChunkRequest {
            upload_id: transfer.upload_id.clone(),
            generation: transfer.generation,
            chunk_index: chunk.chunk_index,
            byte_offset: u64::from(chunk.chunk_index)
                * u64::from(transfer.chunk_size + ATTACHMENT_TAG_SIZE),
            ciphertext_size: chunk.ciphertext.len() as u64,
            ciphertext_sha256: chunk.ciphertext_sha256.to_vec(),
            idempotency_key: format!("{}:{}", transfer.attachment_id, chunk.chunk_index),
            authority_station_id: transfer.authority_station_id.clone(),
            conversation_id: transfer.conversation_id.clone(),
        };
        Self::require_success(
            self.request(
                reqwest::Method::PUT,
                &format!(
                    "/messaging/attachments/uploads/{}/chunks/{}",
                    transfer.upload_id, chunk.chunk_index
                ),
            )
            .header(CONTENT_TYPE, "application/octet-stream")
            .header(
                "X-Peers-Attachment-Metadata-Bin",
                B64.encode(metadata.encode_to_vec()),
            )
            .body(chunk.ciphertext.clone())
            .send()
            .map_err(|error| error.to_string())?,
        )?;
        Ok(())
    }

    fn complete_upload(
        &self,
        transfer: &AttachmentTransferRecord,
        prepared: &PreparedAttachmentUpload,
    ) -> Result<EncryptedObjectDescriptor, String> {
        let request = CompleteAttachmentUploadRequest {
            upload_id: transfer.upload_id.clone(),
            generation: transfer.generation,
            descriptor_commitment_sha256: prepared.descriptor_sha256.to_vec(),
            authority_station_id: transfer.authority_station_id.clone(),
            conversation_id: transfer.conversation_id.clone(),
        };
        let body = Self::require_success(
            self.request(
                reqwest::Method::POST,
                &format!(
                    "/messaging/attachments/uploads/{}/complete",
                    transfer.upload_id
                ),
            )
            .header(CONTENT_TYPE, "application/x-protobuf")
            .header(ACCEPT, "application/x-protobuf")
            .body(request.encode_to_vec())
            .send()
            .map_err(|error| error.to_string())?,
        )?;
        CompleteAttachmentUploadResponse::decode(body.as_slice())
            .map_err(|error| error.to_string())?
            .object
            .ok_or_else(|| "messaging attachment completion omitted descriptor".to_string())
    }

    fn get_download_chunk(
        &self,
        transfer: &AttachmentTransferRecord,
        descriptor: &EncryptedObjectDescriptor,
        _chunk_index: u32,
        start: u64,
        end: u64,
    ) -> Result<Vec<u8>, String> {
        let mut url = reqwest::Url::parse(&format!(
            "{}/messaging/attachments/objects/{}",
            crate::infrastructure::station_client::station_base_url(),
            descriptor.object_id
        ))
        .map_err(|error| error.to_string())?;
        url.query_pairs_mut()
            .append_pair("conversation_id", &transfer.conversation_id);
        let response = self
            .client
            .get(url)
            .header(AUTHORIZATION, format!("Bearer {}", self.token))
            .header("X-Device-ID", &self.device_id)
            .header(
                "X-Peers-Authority-Station-ID",
                &transfer.authority_station_id,
            )
            .header(
                IF_MATCH,
                format!("\"{}\"", hex::encode(&descriptor.ciphertext_sha256)),
            )
            .header(RANGE, format!("bytes={start}-{end}"))
            .send()
            .map_err(|error| error.to_string())?;
        if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
            return Err(format!(
                "messaging attachment range status {}",
                response.status()
            ));
        }
        Self::require_success(response)
    }
}

impl AttachmentTransferWorker {
    pub fn new(
        store: Arc<MessagingStore>,
        transport: Arc<dyn AttachmentTransferTransport>,
    ) -> Self {
        Self { store, transport }
    }

    pub fn memory_bound(chunk_size: u32) -> usize {
        2 * chunk_size as usize + ATTACHMENT_TRANSFER_MEMORY_OVERHEAD
    }

    pub fn upload_once(&self, attachment_id: &str, now_unix_ms: i64) -> Result<bool, String> {
        let mut transfer = self.required_transfer(attachment_id)?;
        let material = material_from_transfer(&transfer)?;
        let prepared = prepare_upload(Path::new(&transfer.source_local_ref), &material, &transfer)?;
        self.store.update_attachment_transfer_prepared(
            attachment_id,
            &prepared.descriptor_sha256,
            &transfer.partial_local_ref,
            now_unix_ms,
        )?;
        if transfer.upload_id.is_empty() {
            let (upload_id, generation, bitmap) =
                self.transport.begin_upload(&transfer, &prepared)?;
            validate_bitmap(&bitmap, material.chunk_count())?;
            self.store.update_attachment_transfer_progress(
                attachment_id,
                AttachmentTransferState::Transferring as i32,
                &upload_id,
                generation,
                &bitmap,
                transfer.attempt_count,
                0,
                0,
                now_unix_ms,
            )?;
            transfer = self.required_transfer(attachment_id)?;
        }

        let mut source =
            File::open(&transfer.source_local_ref).map_err(|error| error.to_string())?;
        for chunk_index in 0..material.chunk_count() {
            if chunk_complete(&transfer.completed_chunk_bitmap, chunk_index) {
                continue;
            }
            let plaintext = read_plaintext_chunk(&mut source, &material, chunk_index)?;
            let encrypted = encrypt_attachment_chunk(&material, chunk_index, &plaintext)?;
            if encrypted.ciphertext_sha256
                != prepared.object.chunk_ciphertext_sha256[chunk_index as usize].as_slice()
            {
                return Err("messaging attachment prepared chunk changed".to_string());
            }
            self.transport.put_upload_chunk(&transfer, &encrypted)?;
            set_chunk_complete(&mut transfer.completed_chunk_bitmap, chunk_index);
            self.store.update_attachment_transfer_progress(
                attachment_id,
                AttachmentTransferState::Transferring as i32,
                &transfer.upload_id,
                transfer.generation,
                &transfer.completed_chunk_bitmap,
                transfer.attempt_count,
                0,
                0,
                now_unix_ms,
            )?;
        }
        let descriptor = self.transport.complete_upload(&transfer, &prepared)?;
        validate_encrypted_object_descriptor(&descriptor)?;
        if descriptor.ciphertext_sha256 != prepared.object.ciphertext_sha256 {
            return Err("messaging attachment completion hash mismatch".to_string());
        }
        self.store.update_attachment_transfer_progress(
            attachment_id,
            AttachmentTransferState::Complete as i32,
            &transfer.upload_id,
            transfer.generation,
            &transfer.completed_chunk_bitmap,
            transfer.attempt_count,
            0,
            0,
            now_unix_ms,
        )?;
        Ok(true)
    }

    pub fn download_once(
        &self,
        attachment_id: &str,
        descriptor: &EncryptedObjectDescriptor,
        expected_plaintext_sha256: &[u8; 32],
        cache_path: &Path,
        now_unix_ms: i64,
    ) -> Result<bool, String> {
        validate_encrypted_object_descriptor(descriptor)?;
        let mut transfer = self.required_transfer(attachment_id)?;
        let material = material_from_transfer(&transfer)?;
        if descriptor.chunk_count != material.chunk_count()
            || descriptor.chunk_size != material.chunk_size()
        {
            return Err("messaging attachment descriptor/material mismatch".to_string());
        }
        let descriptor_hash: [u8; 32] =
            Sha256::digest(prost::Message::encode_to_vec(descriptor)).into();
        if transfer.descriptor_sha256 != vec![0; 32]
            && transfer.descriptor_sha256 != descriptor_hash
        {
            discard_partial(&transfer.partial_local_ref)?;
            return Err("messaging attachment descriptor commitment changed".to_string());
        }
        self.store.update_attachment_transfer_prepared(
            attachment_id,
            &descriptor_hash,
            &transfer.partial_local_ref,
            now_unix_ms,
        )?;
        validate_bitmap(&transfer.completed_chunk_bitmap, descriptor.chunk_count)?;
        validate_partial_file(&transfer, &material, descriptor)?;

        let partial_path = Path::new(&transfer.partial_local_ref);
        if let Some(parent) = partial_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut partial = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(partial_path)
            .map_err(|error| error.to_string())?;
        for chunk_index in 0..descriptor.chunk_count {
            if chunk_complete(&transfer.completed_chunk_bitmap, chunk_index) {
                continue;
            }
            let plaintext_size = plaintext_chunk_size(&material, chunk_index)?;
            let ciphertext_size = plaintext_size + ATTACHMENT_TAG_SIZE as usize;
            let start =
                u64::from(chunk_index) * u64::from(descriptor.chunk_size + descriptor.tag_size);
            let ciphertext = self.transport.get_download_chunk(
                &transfer,
                descriptor,
                chunk_index,
                start,
                start + ciphertext_size as u64 - 1,
            )?;
            let expected_hash: [u8; 32] = descriptor.chunk_ciphertext_sha256[chunk_index as usize]
                .as_slice()
                .try_into()
                .map_err(|_| "messaging attachment chunk commitment is invalid".to_string())?;
            let plaintext = decrypt_attachment_chunk(
                &material,
                &EncryptedAttachmentChunk {
                    chunk_index,
                    ciphertext,
                    ciphertext_sha256: expected_hash,
                },
            )?;
            partial
                .seek(SeekFrom::Start(
                    u64::from(chunk_index) * u64::from(material.chunk_size()),
                ))
                .and_then(|_| partial.write_all(&plaintext))
                .and_then(|_| partial.sync_data())
                .map_err(|error| error.to_string())?;
            set_chunk_complete(&mut transfer.completed_chunk_bitmap, chunk_index);
            self.store.update_attachment_transfer_progress(
                attachment_id,
                AttachmentTransferState::Transferring as i32,
                &transfer.upload_id,
                transfer.generation,
                &transfer.completed_chunk_bitmap,
                transfer.attempt_count,
                0,
                0,
                now_unix_ms,
            )?;
        }
        partial
            .set_len(material.plaintext_size())
            .map_err(|e| e.to_string())?;
        drop(partial);
        if sha256_file(partial_path)? != *expected_plaintext_sha256 {
            discard_partial(&transfer.partial_local_ref)?;
            return Err("messaging attachment plaintext hash mismatch".to_string());
        }
        if let Some(parent) = cache_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::rename(partial_path, cache_path).map_err(|error| error.to_string())?;
        self.store.update_attachment_transfer_progress(
            attachment_id,
            AttachmentTransferState::Complete as i32,
            &transfer.upload_id,
            transfer.generation,
            &transfer.completed_chunk_bitmap,
            transfer.attempt_count,
            0,
            0,
            now_unix_ms,
        )?;
        Ok(true)
    }

    fn required_transfer(&self, attachment_id: &str) -> Result<AttachmentTransferRecord, String> {
        self.store
            .attachment_transfer(attachment_id)?
            .ok_or_else(|| "messaging attachment transfer is unavailable".to_string())
    }
}

fn prepare_upload(
    path: &Path,
    material: &AttachmentCryptoMaterial,
    transfer: &AttachmentTransferRecord,
) -> Result<PreparedAttachmentUpload, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() != material.plaintext_size() {
        return Err("messaging attachment source size changed".to_string());
    }
    let mut source = File::open(path).map_err(|error| error.to_string())?;
    let mut whole = Sha256::new();
    let mut chunk_hashes = Vec::with_capacity(material.chunk_count() as usize);
    let mut ciphertext_size = 0_u64;
    for chunk_index in 0..material.chunk_count() {
        let plaintext = read_plaintext_chunk(&mut source, material, chunk_index)?;
        let encrypted = encrypt_attachment_chunk(material, chunk_index, &plaintext)?;
        whole.update(&encrypted.ciphertext);
        ciphertext_size += encrypted.ciphertext.len() as u64;
        chunk_hashes.push(encrypted.ciphertext_sha256.to_vec());
    }
    let object = EncryptedObjectUploadSpec {
        ciphertext_size,
        ciphertext_sha256: whole.finalize().to_vec(),
        media_type: "application/octet-stream".to_string(),
        chunk_size: material.chunk_size(),
        chunk_count: material.chunk_count(),
        encryption_suite: crate::model::chat::AttachmentEncryptionSuite::Aes256GcmChunked as i32,
        tag_size: ATTACHMENT_TAG_SIZE,
        nonce_strategy: crate::model::chat::AttachmentNonceStrategy::Counter32Be as i32,
        chunk_ciphertext_sha256: chunk_hashes,
    };
    let descriptor_sha256 = upload_commitment_fields(
        &transfer.conversation_id,
        &transfer.message_id,
        &transfer.attachment_id,
        &transfer.authority_station_id,
        &object,
    );
    Ok(PreparedAttachmentUpload {
        object,
        descriptor_sha256,
    })
}

fn upload_commitment(request: &BeginAttachmentUploadRequest) -> Result<Vec<u8>, String> {
    let object = request
        .object
        .as_ref()
        .ok_or_else(|| "messaging attachment upload object is required".to_string())?;
    Ok(upload_commitment_fields(
        &request.conversation_id,
        &request.message_id,
        &request.attachment_id,
        &request.authority_station_id,
        object,
    )
    .to_vec())
}

fn upload_commitment_fields(
    conversation_id: &str,
    message_id: &str,
    attachment_id: &str,
    authority_station_id: &str,
    object: &EncryptedObjectUploadSpec,
) -> [u8; 32] {
    let mut hash = Sha256::new();
    let object_bytes = object.encode_to_vec();
    for value in [
        b"peers-touch:attachment:upload-commitment:1".as_slice(),
        conversation_id.as_bytes(),
        message_id.as_bytes(),
        attachment_id.as_bytes(),
        authority_station_id.as_bytes(),
        object_bytes.as_slice(),
    ] {
        hash.update((value.len() as u64).to_be_bytes());
        hash.update(value);
    }
    hash.finalize().into()
}

fn material_from_transfer(
    transfer: &AttachmentTransferRecord,
) -> Result<AttachmentCryptoMaterial, String> {
    AttachmentCryptoMaterial::from_parts(
        transfer
            .object_key
            .as_slice()
            .try_into()
            .map_err(|_| "invalid object key")?,
        transfer
            .base_nonce
            .as_slice()
            .try_into()
            .map_err(|_| "invalid base nonce")?,
        transfer.plaintext_size,
        transfer.chunk_size,
    )
}

fn read_plaintext_chunk(
    file: &mut File,
    material: &AttachmentCryptoMaterial,
    index: u32,
) -> Result<Vec<u8>, String> {
    let size = plaintext_chunk_size(material, index)?;
    let mut bytes = vec![0; size];
    file.seek(SeekFrom::Start(
        u64::from(index) * u64::from(material.chunk_size()),
    ))
    .and_then(|_| file.read_exact(&mut bytes))
    .map_err(|error| error.to_string())?;
    Ok(bytes)
}

fn plaintext_chunk_size(material: &AttachmentCryptoMaterial, index: u32) -> Result<usize, String> {
    if index >= material.chunk_count() {
        return Err("messaging attachment chunk index exceeds policy".to_string());
    }
    let offset = u64::from(index) * u64::from(material.chunk_size());
    Ok((material.plaintext_size() - offset).min(u64::from(material.chunk_size())) as usize)
}

fn validate_bitmap(bitmap: &[u8], chunks: u32) -> Result<(), String> {
    if bitmap.len() != chunks.div_ceil(8) as usize {
        return Err("messaging attachment checkpoint bitmap mismatch".to_string());
    }
    Ok(())
}

fn chunk_complete(bitmap: &[u8], index: u32) -> bool {
    bitmap
        .get(index as usize / 8)
        .is_some_and(|byte| byte & (1 << (index % 8)) != 0)
}

fn set_chunk_complete(bitmap: &mut [u8], index: u32) {
    bitmap[index as usize / 8] |= 1 << (index % 8);
}

fn validate_partial_file(
    transfer: &AttachmentTransferRecord,
    material: &AttachmentCryptoMaterial,
    descriptor: &EncryptedObjectDescriptor,
) -> Result<(), String> {
    let path = Path::new(&transfer.partial_local_ref);
    if !path.exists() {
        if transfer
            .completed_chunk_bitmap
            .iter()
            .any(|byte| *byte != 0)
        {
            return Err("messaging attachment partial file is missing".to_string());
        }
        return Ok(());
    }
    let expected_min = transfer
        .completed_chunk_bitmap
        .iter()
        .enumerate()
        .flat_map(|(byte_index, byte)| {
            (0..8).filter_map(move |bit| {
                if byte & (1 << bit) != 0 {
                    Some((byte_index * 8 + bit + 1) as u64)
                } else {
                    None
                }
            })
        })
        .max()
        .unwrap_or(0)
        .saturating_mul(u64::from(material.chunk_size()))
        .min(material.plaintext_size());
    if fs::metadata(path).map_err(|e| e.to_string())?.len() < expected_min {
        discard_partial(&transfer.partial_local_ref)?;
        return Err("messaging attachment partial file checkpoint mismatch".to_string());
    }
    let mut partial = File::open(path).map_err(|error| error.to_string())?;
    for chunk_index in 0..material.chunk_count() {
        if !chunk_complete(&transfer.completed_chunk_bitmap, chunk_index) {
            continue;
        }
        let plaintext = read_plaintext_chunk(&mut partial, material, chunk_index)?;
        let encrypted = encrypt_attachment_chunk(material, chunk_index, &plaintext)?;
        if descriptor.chunk_ciphertext_sha256[chunk_index as usize] != encrypted.ciphertext_sha256 {
            drop(partial);
            discard_partial(&transfer.partial_local_ref)?;
            return Err("messaging attachment partial file integrity mismatch".to_string());
        }
    }
    Ok(())
}

fn discard_partial(path: &str) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn sha256_file(path: &Path) -> Result<[u8; 32], String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(hash.finalize().into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::Mutex;
    use ulid::Ulid;

    struct MemoryTransport {
        chunks: Mutex<HashMap<u32, Vec<u8>>>,
        upload_calls: Mutex<Vec<u32>>,
        fail_upload_once: Mutex<Option<u32>>,
        fail_download_once: Mutex<Option<u32>>,
        retain_uploads: bool,
        corrupt_download_once: Mutex<Option<u32>>,
        reject_etag: Mutex<bool>,
    }

    impl MemoryTransport {
        fn new() -> Self {
            Self {
                chunks: Mutex::new(HashMap::new()),
                upload_calls: Mutex::new(Vec::new()),
                fail_upload_once: Mutex::new(None),
                fail_download_once: Mutex::new(None),
                retain_uploads: true,
                corrupt_download_once: Mutex::new(None),
                reject_etag: Mutex::new(false),
            }
        }

        fn without_upload_retention() -> Self {
            Self {
                retain_uploads: false,
                ..Self::new()
            }
        }
    }

    impl AttachmentTransferTransport for MemoryTransport {
        fn begin_upload(
            &self,
            _transfer: &AttachmentTransferRecord,
            prepared: &PreparedAttachmentUpload,
        ) -> Result<(String, u64, Vec<u8>), String> {
            Ok((
                "upload-1".to_string(),
                1,
                vec![0; prepared.object.chunk_count.div_ceil(8) as usize],
            ))
        }

        fn put_upload_chunk(
            &self,
            _transfer: &AttachmentTransferRecord,
            chunk: &EncryptedAttachmentChunk,
        ) -> Result<(), String> {
            self.upload_calls.lock().unwrap().push(chunk.chunk_index);
            if *self.fail_upload_once.lock().unwrap() == Some(chunk.chunk_index) {
                *self.fail_upload_once.lock().unwrap() = None;
                return Err("injected upload interruption".to_string());
            }
            if self.retain_uploads {
                self.chunks
                    .lock()
                    .unwrap()
                    .insert(chunk.chunk_index, chunk.ciphertext.clone());
            }
            Ok(())
        }

        fn complete_upload(
            &self,
            _transfer: &AttachmentTransferRecord,
            prepared: &PreparedAttachmentUpload,
        ) -> Result<EncryptedObjectDescriptor, String> {
            Ok(EncryptedObjectDescriptor {
                object_id: "object-1".to_string(),
                storage_ref: "opaque-1".to_string(),
                ciphertext_size: prepared.object.ciphertext_size,
                ciphertext_sha256: prepared.object.ciphertext_sha256.clone(),
                media_type: prepared.object.media_type.clone(),
                chunk_size: prepared.object.chunk_size,
                chunk_count: prepared.object.chunk_count,
                encryption_suite: prepared.object.encryption_suite,
                tag_size: prepared.object.tag_size,
                nonce_strategy: prepared.object.nonce_strategy,
                chunk_ciphertext_sha256: prepared.object.chunk_ciphertext_sha256.clone(),
            })
        }

        fn get_download_chunk(
            &self,
            _transfer: &AttachmentTransferRecord,
            _descriptor: &EncryptedObjectDescriptor,
            chunk_index: u32,
            _start: u64,
            _end: u64,
        ) -> Result<Vec<u8>, String> {
            if *self.reject_etag.lock().unwrap() {
                return Err("messaging attachment range status 412 Precondition Failed".to_string());
            }
            if *self.fail_download_once.lock().unwrap() == Some(chunk_index) {
                *self.fail_download_once.lock().unwrap() = None;
                return Err("injected download interruption".to_string());
            }
            let mut bytes = self
                .chunks
                .lock()
                .unwrap()
                .get(&chunk_index)
                .cloned()
                .ok_or_else(|| "missing remote chunk".to_string())?;
            if *self.corrupt_download_once.lock().unwrap() == Some(chunk_index) {
                *self.corrupt_download_once.lock().unwrap() = None;
                bytes[0] ^= 1;
            }
            Ok(bytes)
        }
    }

    fn temp_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("pt-attachment-{label}-{}", Ulid::new()))
    }

    fn transfer(
        attachment_id: &str,
        source: &Path,
        partial: &Path,
        plaintext_size: u64,
        chunk_size: u32,
    ) -> AttachmentTransferRecord {
        AttachmentTransferRecord {
            attachment_id: attachment_id.to_string(),
            conversation_id: "conversation-1".to_string(),
            message_id: "message-1".to_string(),
            authority_station_id: "station-1".to_string(),
            direction: 1,
            state: AttachmentTransferState::Queued as i32,
            upload_id: String::new(),
            generation: 0,
            descriptor_sha256: vec![0; 32],
            completed_chunk_bitmap: vec![
                0;
                plaintext_size.div_ceil(chunk_size as u64).div_ceil(8)
                    as usize
            ],
            source_local_ref: source.display().to_string(),
            partial_local_ref: partial.display().to_string(),
            object_key: vec![7; 32],
            base_nonce: vec![0; 12],
            plaintext_size,
            chunk_size,
            attempt_count: 0,
            next_attempt_at_unix_ms: 1,
            last_error_code: 0,
            updated_at_unix_ms: 1,
        }
    }

    #[test]
    fn upload_resumes_from_durable_bitmap_without_replaying_completed_chunk() {
        let source = temp_path("upload-source");
        let partial = temp_path("upload-partial");
        let plaintext = (0..(2 * 1024 * 1024 + 41))
            .map(|value| value as u8)
            .collect::<Vec<_>>();
        fs::write(&source, &plaintext).unwrap();
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let record = transfer(
            "upload-transfer",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        store.create_attachment_transfer(&record).unwrap();
        let transport = Arc::new(MemoryTransport::new());
        *transport.fail_upload_once.lock().unwrap() = Some(1);
        let worker = AttachmentTransferWorker::new(store.clone(), transport.clone());

        assert!(worker.upload_once("upload-transfer", 10).is_err());
        assert_eq!(
            store
                .attachment_transfer("upload-transfer")
                .unwrap()
                .unwrap()
                .completed_chunk_bitmap,
            vec![1]
        );
        worker.upload_once("upload-transfer", 11).unwrap();
        assert_eq!(*transport.upload_calls.lock().unwrap(), vec![0, 1, 1, 2]);
        assert_eq!(
            store
                .attachment_transfer("upload-transfer")
                .unwrap()
                .unwrap()
                .state,
            AttachmentTransferState::Complete as i32
        );
        let _ = fs::remove_file(source);
    }

    #[test]
    fn download_resumes_then_atomically_promotes_verified_plaintext() {
        let source = temp_path("download-source");
        let partial = temp_path("download-partial");
        let cache = temp_path("download-cache");
        let plaintext = (0..(2 * 1024 * 1024 + 41))
            .map(|value| (value * 3) as u8)
            .collect::<Vec<_>>();
        fs::write(&source, &plaintext).unwrap();
        let material = AttachmentCryptoMaterial::from_parts(
            [7; 32],
            [0; 12],
            plaintext.len() as u64,
            1024 * 1024,
        )
        .unwrap();
        let upload_record = transfer(
            "unused",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        let prepared = prepare_upload(&source, &material, &upload_record).unwrap();
        let transport = Arc::new(MemoryTransport::new());
        for index in 0..material.chunk_count() {
            let mut file = File::open(&source).unwrap();
            let chunk = read_plaintext_chunk(&mut file, &material, index).unwrap();
            let encrypted = encrypt_attachment_chunk(&material, index, &chunk).unwrap();
            transport
                .chunks
                .lock()
                .unwrap()
                .insert(index, encrypted.ciphertext);
        }
        let descriptor = transport
            .complete_upload(&upload_record, &prepared)
            .unwrap();
        let plaintext_hash: [u8; 32] = Sha256::digest(&plaintext).into();
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let mut record = transfer(
            "download-transfer",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        record.direction = 2;
        record.source_local_ref.clear();
        store.create_attachment_transfer(&record).unwrap();
        *transport.fail_download_once.lock().unwrap() = Some(1);
        let worker = AttachmentTransferWorker::new(store.clone(), transport.clone());

        assert!(worker
            .download_once(
                "download-transfer",
                &descriptor,
                &plaintext_hash,
                &cache,
                10,
            )
            .is_err());
        assert!(partial.exists());
        assert!(!cache.exists());
        worker
            .download_once(
                "download-transfer",
                &descriptor,
                &plaintext_hash,
                &cache,
                11,
            )
            .unwrap();
        assert_eq!(fs::read(&cache).unwrap(), plaintext);
        assert!(!partial.exists());
        let _ = fs::remove_file(source);
        let _ = fs::remove_file(cache);
    }

    #[test]
    fn partial_checkpoint_mismatch_is_deleted_and_fails_closed() {
        let source = temp_path("mismatch-source");
        let partial = temp_path("mismatch-partial");
        let cache = temp_path("mismatch-cache");
        fs::write(&source, vec![1_u8; 1024 * 1024 + 17]).unwrap();
        fs::write(&partial, [1_u8; 2]).unwrap();
        let material =
            AttachmentCryptoMaterial::from_parts([7; 32], [0; 12], 1024 * 1024 + 17, 1024 * 1024)
                .unwrap();
        let upload_record = transfer("unused", &source, &partial, 1024 * 1024 + 17, 1024 * 1024);
        let prepared = prepare_upload(&source, &material, &upload_record).unwrap();
        let transport = Arc::new(MemoryTransport::new());
        let descriptor = transport
            .complete_upload(&upload_record, &prepared)
            .unwrap();
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let mut record = transfer(
            "mismatch-transfer",
            &source,
            &partial,
            1024 * 1024 + 17,
            1024 * 1024,
        );
        record.direction = 2;
        record.source_local_ref.clear();
        record.completed_chunk_bitmap = vec![1];
        store.create_attachment_transfer(&record).unwrap();
        let worker = AttachmentTransferWorker::new(store, transport);
        assert!(worker
            .download_once("mismatch-transfer", &descriptor, &[0; 32], &cache, 10)
            .is_err());
        assert!(!partial.exists());
        let _ = fs::remove_file(source);
    }

    #[test]
    fn same_length_partial_corruption_is_deleted_and_fails_closed() {
        let source = temp_path("corrupt-partial-source");
        let partial = temp_path("corrupt-partial");
        let cache = temp_path("corrupt-partial-cache");
        let plaintext = vec![7_u8; 2 * 1024 * 1024 + 17];
        fs::write(&source, &plaintext).unwrap();
        fs::write(&partial, vec![9_u8; 1024 * 1024]).unwrap();
        let material = AttachmentCryptoMaterial::from_parts(
            [7; 32],
            [0; 12],
            plaintext.len() as u64,
            1024 * 1024,
        )
        .unwrap();
        let upload_record = transfer(
            "unused",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        let prepared = prepare_upload(&source, &material, &upload_record).unwrap();
        let transport = Arc::new(MemoryTransport::new());
        let descriptor = transport
            .complete_upload(&upload_record, &prepared)
            .unwrap();
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let mut record = transfer(
            "corrupt-partial-transfer",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        record.direction = 2;
        record.source_local_ref.clear();
        record.completed_chunk_bitmap = vec![1];
        store.create_attachment_transfer(&record).unwrap();

        let worker = AttachmentTransferWorker::new(store, transport);
        assert!(worker
            .download_once(
                "corrupt-partial-transfer",
                &descriptor,
                &Sha256::digest(&plaintext).into(),
                &cache,
                10,
            )
            .is_err());
        assert!(!partial.exists());
        assert!(!cache.exists());
        let _ = fs::remove_file(source);
    }

    #[test]
    fn corrupt_download_chunk_and_wrong_etag_fail_closed() {
        let source = temp_path("corrupt-download-source");
        let partial = temp_path("corrupt-download-partial");
        let cache = temp_path("corrupt-download-cache");
        let plaintext = vec![5_u8; 1024 * 1024 + 17];
        fs::write(&source, &plaintext).unwrap();
        let material = AttachmentCryptoMaterial::from_parts(
            [7; 32],
            [0; 12],
            plaintext.len() as u64,
            1024 * 1024,
        )
        .unwrap();
        let upload_record = transfer(
            "unused",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        let prepared = prepare_upload(&source, &material, &upload_record).unwrap();
        let transport = Arc::new(MemoryTransport::new());
        for index in 0..material.chunk_count() {
            let mut file = File::open(&source).unwrap();
            let chunk = read_plaintext_chunk(&mut file, &material, index).unwrap();
            let encrypted = encrypt_attachment_chunk(&material, index, &chunk).unwrap();
            transport
                .chunks
                .lock()
                .unwrap()
                .insert(index, encrypted.ciphertext);
        }
        let descriptor = transport
            .complete_upload(&upload_record, &prepared)
            .unwrap();
        let plaintext_hash: [u8; 32] = Sha256::digest(&plaintext).into();
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let mut record = transfer(
            "corrupt-download-transfer",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        record.direction = 2;
        record.source_local_ref.clear();
        store.create_attachment_transfer(&record).unwrap();
        let worker = AttachmentTransferWorker::new(store, transport.clone());

        *transport.corrupt_download_once.lock().unwrap() = Some(0);
        assert!(worker
            .download_once(
                "corrupt-download-transfer",
                &descriptor,
                &plaintext_hash,
                &cache,
                10,
            )
            .is_err());
        assert!(!cache.exists());

        *transport.reject_etag.lock().unwrap() = true;
        assert!(worker
            .download_once(
                "corrupt-download-transfer",
                &descriptor,
                &plaintext_hash,
                &cache,
                11,
            )
            .is_err());
        assert!(!cache.exists());
        let _ = fs::remove_file(source);
        let _ = fs::remove_file(partial);
    }

    #[test]
    fn hundred_mib_upload_resumes_at_quarter_boundaries() {
        const SIZE: u64 = 100 * 1024 * 1024;
        const CHUNKS: u32 = 100;
        let source = temp_path("hundred-mib-source");
        let partial = temp_path("hundred-mib-partial");
        let file = File::create(&source).unwrap();
        file.set_len(SIZE).unwrap();

        for completed_chunks in [25_u32, 50, 75] {
            let attachment_id = format!("hundred-mib-{completed_chunks}");
            let store = Arc::new(MessagingStore::in_memory().unwrap());
            let mut record = transfer(&attachment_id, &source, &partial, SIZE, 1024 * 1024);
            record.upload_id = format!("upload-{completed_chunks}");
            record.generation = 1;
            for index in 0..completed_chunks {
                set_chunk_complete(&mut record.completed_chunk_bitmap, index);
            }
            store.create_attachment_transfer(&record).unwrap();
            let transport = Arc::new(MemoryTransport::without_upload_retention());
            let worker = AttachmentTransferWorker::new(store.clone(), transport.clone());

            worker.upload_once(&attachment_id, 10).unwrap();

            let calls = transport.upload_calls.lock().unwrap();
            assert_eq!(calls.len(), (CHUNKS - completed_chunks) as usize);
            assert_eq!(calls.first().copied(), Some(completed_chunks));
            assert_eq!(calls.last().copied(), Some(CHUNKS - 1));
            assert_eq!(
                store
                    .attachment_transfer(&attachment_id)
                    .unwrap()
                    .unwrap()
                    .state,
                AttachmentTransferState::Complete as i32
            );
        }
        let _ = fs::remove_file(source);
    }

    #[test]
    fn declared_memory_bound_matches_two_chunks_plus_overhead() {
        assert_eq!(
            AttachmentTransferWorker::memory_bound(1024 * 1024),
            18 * 1024 * 1024
        );
    }
}
