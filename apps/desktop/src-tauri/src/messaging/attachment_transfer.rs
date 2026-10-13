use crate::application::station_runtime::client::{
    ReplayPolicy, StationClient, StationRequest, StationRequestBody, StationResponse,
    StationRouteSecurity, TrafficClass,
};
use crate::model::chat::{
    AttachmentTransferError, AttachmentTransferErrorCode, AttachmentTransferState,
    BeginAttachmentUploadRequest, BeginAttachmentUploadResponse, CancelAttachmentUploadRequest,
    CancelAttachmentUploadResponse, CompleteAttachmentUploadRequest,
    CompleteAttachmentUploadResponse, CryptoEndpoint, EncryptedObjectDescriptor,
    PutAttachmentChunkRequest,
};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use prost::Message;
use reqwest::header::{
    HeaderMap, HeaderName, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE, IF_MATCH, RANGE,
};
use secure_content_core::object::{
    EncryptedObjectChunk as EncryptedAttachmentChunk, OBJECT_TAG_SIZE as ATTACHMENT_TAG_SIZE,
};
use std::io::Read;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

pub use messaging_core::attachment::{
    upload_commitment_fields, AttachmentRetryPolicy, AttachmentTransferControl,
    AttachmentTransferFailure, AttachmentTransferProgress, AttachmentTransferRecord,
    AttachmentTransferTransport, AttachmentTransferWorker, PreparedAttachmentUpload,
    ATTACHMENT_TRANSFER_MEMORY_OVERHEAD,
};

pub struct StationAttachmentTransferTransport {
    station_client: StationClient,
    token: String,
    device_id: String,
    endpoint: CryptoEndpoint,
}

impl StationAttachmentTransferTransport {
    pub fn new(
        station_client: StationClient,
        token: String,
        endpoint: CryptoEndpoint,
    ) -> Result<Self, String> {
        if token.trim().is_empty()
            || endpoint.ptid.trim().is_empty()
            || endpoint.device_id.trim().is_empty()
        {
            return Err("messaging attachment transport identity is incomplete".to_string());
        }
        Ok(Self {
            station_client,
            token,
            device_id: endpoint.device_id.clone(),
            endpoint,
        })
    }

    fn execute(
        &self,
        method: reqwest::Method,
        path_and_query: String,
        mut headers: HeaderMap,
        body: StationRequestBody,
        replay_policy: ReplayPolicy,
    ) -> Result<StationResponse, AttachmentTransferFailure> {
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", self.token))
                .map_err(|error| transport_error(error.to_string()))?,
        );
        headers.insert(
            HeaderName::from_static("x-device-id"),
            HeaderValue::from_str(&self.device_id)
                .map_err(|error| transport_error(error.to_string()))?,
        );
        self.station_client
            .execute_raw(StationRequest {
                method,
                path_and_query,
                headers,
                body,
                timeout: Duration::from_secs(30),
                admission_timeout: Duration::from_secs(30),
                traffic_class: TrafficClass::Bulk,
                route_security: StationRouteSecurity::VerifiedRoute,
                replay_policy,
                cancellation: CancellationToken::new(),
                expected_scope: None,
            })
            .map_err(|error| transport_error(error.to_string()))
    }

    fn require_success(
        mut response: StationResponse,
    ) -> Result<Vec<u8>, AttachmentTransferFailure> {
        let status = response.status;
        let retry_after_ms = response
            .headers
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<i64>().ok())
            .map(|seconds| seconds.saturating_mul(1_000));
        let mut body = Vec::new();
        response
            .body
            .read_to_end(&mut body)
            .map_err(|error| transport_error(error.to_string()))?;
        if !(200..300).contains(&status) {
            if let Some(failure) = decode_typed_transfer_failure(&body, retry_after_ms) {
                return Err(failure);
            }
            let detail = format!("messaging attachment station status {status}");
            return Err(match status {
                401 | 403 => AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::NotGranted,
                    detail,
                ),
                409 => AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::PartConflict,
                    detail,
                ),
                412 => AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::DescriptorMismatch,
                    detail,
                ),
                416 => AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::RangeInvalid,
                    detail,
                ),
                429 => AttachmentTransferFailure::retryable(
                    AttachmentTransferErrorCode::QuotaExceeded,
                    retry_after_ms,
                    detail,
                ),
                500..=599 => AttachmentTransferFailure::retryable(
                    AttachmentTransferErrorCode::RetryLater,
                    retry_after_ms,
                    detail,
                ),
                _ => AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::DescriptorMismatch,
                    detail,
                ),
            });
        }
        Ok(body)
    }

    fn download_chunk_request(
        &self,
        transfer: &AttachmentTransferRecord,
        descriptor: &EncryptedObjectDescriptor,
        start: u64,
        end: u64,
    ) -> Result<StationResponse, AttachmentTransferFailure> {
        let headers = Self::download_chunk_headers(transfer, descriptor, start, end)?;
        self.execute(
            reqwest::Method::GET,
            format!("/conversation/attachments/objects/{}", descriptor.object_id),
            headers,
            StationRequestBody::Empty,
            ReplayPolicy::SafeRead,
        )
    }

    fn download_chunk_headers(
        transfer: &AttachmentTransferRecord,
        descriptor: &EncryptedObjectDescriptor,
        start: u64,
        end: u64,
    ) -> Result<HeaderMap, AttachmentTransferFailure> {
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("x-peers-conversation-id"),
            HeaderValue::from_str(&transfer.conversation_id)
                .map_err(|error| transport_error(error.to_string()))?,
        );
        headers.insert(
            HeaderName::from_static("x-peers-authority-station-id"),
            HeaderValue::from_str(&transfer.authority_station_id)
                .map_err(|error| transport_error(error.to_string()))?,
        );
        headers.insert(
            IF_MATCH,
            HeaderValue::from_str(&format!(
                "\"{}\"",
                hex::encode(&descriptor.ciphertext_sha256)
            ))
            .map_err(|error| transport_error(error.to_string()))?,
        );
        headers.insert(
            RANGE,
            HeaderValue::from_str(&format!("bytes={start}-{end}"))
                .map_err(|error| transport_error(error.to_string()))?,
        );
        Ok(headers)
    }
}

fn decode_typed_transfer_failure(
    body: &[u8],
    header_retry_after_ms: Option<i64>,
) -> Option<AttachmentTransferFailure> {
    let typed = AttachmentTransferError::decode(body).ok()?;
    let code = AttachmentTransferErrorCode::try_from(typed.code).ok()?;
    if code == AttachmentTransferErrorCode::Unspecified {
        return None;
    }
    let typed_retry_after_ms = typed.retry_after.and_then(|duration| {
        if duration.seconds < 0 || !(0..1_000_000_000).contains(&duration.nanos) {
            return None;
        }
        duration.seconds.checked_mul(1_000).and_then(|millis| {
            millis.checked_add(i64::from(duration.nanos).saturating_add(999_999) / 1_000_000)
        })
    });
    let detail = format!("messaging attachment station error {}", code.as_str_name());
    Some(
        if matches!(
            code,
            AttachmentTransferErrorCode::QuotaExceeded | AttachmentTransferErrorCode::RetryLater
        ) {
            AttachmentTransferFailure::retryable(
                code,
                typed_retry_after_ms.or(header_retry_after_ms),
                detail,
            )
        } else {
            AttachmentTransferFailure::terminal(code, detail)
        },
    )
}

fn transport_error(detail: String) -> AttachmentTransferFailure {
    AttachmentTransferFailure::retryable(AttachmentTransferErrorCode::RetryLater, None, detail)
}

impl AttachmentTransferTransport for StationAttachmentTransferTransport {
    fn begin_upload(
        &self,
        transfer: &AttachmentTransferRecord,
        prepared: &PreparedAttachmentUpload,
    ) -> Result<(String, u64, Vec<u8>), AttachmentTransferFailure> {
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
        request.descriptor_commitment_sha256 = prepared.descriptor_sha256.to_vec();
        let mut headers = HeaderMap::new();
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/x-protobuf"),
        );
        headers.insert(ACCEPT, HeaderValue::from_static("application/x-protobuf"));
        let body = Self::require_success(self.execute(
            reqwest::Method::POST,
            "/conversation/attachments/uploads:begin".to_string(),
            headers,
            StationRequestBody::Bytes(request.encode_to_vec()),
            ReplayPolicy::Idempotent(transfer.attachment_id.clone()),
        )?)?;
        let response = BeginAttachmentUploadResponse::decode(body.as_slice()).map_err(|error| {
            AttachmentTransferFailure::terminal(
                AttachmentTransferErrorCode::DescriptorMismatch,
                error.to_string(),
            )
        })?;
        if response.authority_station_id != transfer.authority_station_id
            || response.upload_id.trim().is_empty()
            || response.generation == 0
        {
            return Err(AttachmentTransferFailure::terminal(
                AttachmentTransferErrorCode::DescriptorMismatch,
                "messaging attachment begin response binding mismatch".to_string(),
            ));
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
    ) -> Result<(), AttachmentTransferFailure> {
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
        let mut headers = HeaderMap::new();
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/octet-stream"),
        );
        headers.insert(
            HeaderName::from_static("x-peers-attachment-metadata-bin"),
            HeaderValue::from_str(&B64.encode(metadata.encode_to_vec()))
                .map_err(|error| transport_error(error.to_string()))?,
        );
        Self::require_success(self.execute(
            reqwest::Method::PUT,
            format!(
                "/conversation/attachments/uploads/{}/chunks/{}",
                transfer.upload_id, chunk.chunk_index
            ),
            headers,
            StationRequestBody::Bytes(chunk.ciphertext.clone()),
            ReplayPolicy::Idempotent(format!("{}:{}", transfer.attachment_id, chunk.chunk_index)),
        )?)?;
        Ok(())
    }

    fn complete_upload(
        &self,
        transfer: &AttachmentTransferRecord,
        prepared: &PreparedAttachmentUpload,
    ) -> Result<EncryptedObjectDescriptor, AttachmentTransferFailure> {
        let request = CompleteAttachmentUploadRequest {
            upload_id: transfer.upload_id.clone(),
            generation: transfer.generation,
            descriptor_commitment_sha256: prepared.descriptor_sha256.to_vec(),
            authority_station_id: transfer.authority_station_id.clone(),
            conversation_id: transfer.conversation_id.clone(),
        };
        let mut headers = HeaderMap::new();
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/x-protobuf"),
        );
        headers.insert(ACCEPT, HeaderValue::from_static("application/x-protobuf"));
        let body = Self::require_success(self.execute(
            reqwest::Method::POST,
            format!(
                "/conversation/attachments/uploads/{}/complete",
                transfer.upload_id
            ),
            headers,
            StationRequestBody::Bytes(request.encode_to_vec()),
            ReplayPolicy::Idempotent(transfer.attachment_id.clone()),
        )?)?;
        CompleteAttachmentUploadResponse::decode(body.as_slice())
            .map_err(|error| {
                AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::DescriptorMismatch,
                    error.to_string(),
                )
            })?
            .object
            .ok_or_else(|| {
                AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::DescriptorMismatch,
                    "messaging attachment completion omitted descriptor".to_string(),
                )
            })
    }

    fn get_download_chunk(
        &self,
        transfer: &AttachmentTransferRecord,
        descriptor: &EncryptedObjectDescriptor,
        _chunk_index: u32,
        start: u64,
        end: u64,
    ) -> Result<Vec<u8>, AttachmentTransferFailure> {
        let response = self.download_chunk_request(transfer, descriptor, start, end)?;
        if response.status != 206 {
            return Self::require_success(response).and_then(|_| {
                Err(AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::RangeInvalid,
                    "messaging attachment range response was not partial".to_string(),
                ))
            });
        }
        Self::require_success(response)
    }

    fn cancel_upload(
        &self,
        transfer: &AttachmentTransferRecord,
    ) -> Result<(), AttachmentTransferFailure> {
        let request = CancelAttachmentUploadRequest {
            upload_id: transfer.upload_id.clone(),
            generation: transfer.generation,
            authority_station_id: transfer.authority_station_id.clone(),
            conversation_id: transfer.conversation_id.clone(),
        };
        let mut headers = HeaderMap::new();
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/x-protobuf"),
        );
        headers.insert(ACCEPT, HeaderValue::from_static("application/x-protobuf"));
        let body = Self::require_success(self.execute(
            reqwest::Method::POST,
            format!(
                "/conversation/attachments/uploads/{}/cancel",
                transfer.upload_id
            ),
            headers,
            StationRequestBody::Bytes(request.encode_to_vec()),
            ReplayPolicy::Idempotent(transfer.attachment_id.clone()),
        )?)?;
        let response =
            CancelAttachmentUploadResponse::decode(body.as_slice()).map_err(|error| {
                AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::DescriptorMismatch,
                    error.to_string(),
                )
            })?;
        if response.state != AttachmentTransferState::Cancelled as i32 {
            return Err(AttachmentTransferFailure::terminal(
                AttachmentTransferErrorCode::DescriptorMismatch,
                "messaging attachment cancellation state mismatch".to_string(),
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messaging::MessagingStore;
    use messaging_core::proto::actor_device_ptid;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Arc;
    use ulid::Ulid;

    fn temp_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("pt-attachment-{label}-{}", Ulid::new()))
    }

    #[test]
    #[ignore = "requires a native Desktop profile, session file, and live Station"]
    fn live_engine_worker_uploads_through_station_transport() {
        let profile = std::env::var("PT_PROFILE").unwrap_or_else(|_| "desktop".to_string());
        let layout = crate::infrastructure::storage::resolve_layout(&profile)
            .expect("native Desktop storage layout");
        let config_dir = layout
            .dirs
            .get(&crate::infrastructure::storage::StorageKind::Config)
            .expect("native Desktop config directory");
        let station_runtime =
            crate::application::station_runtime::StationRuntime::start(config_dir)
                .expect("native Station runtime");
        station_runtime
            .resume_persisted()
            .expect("resume persisted Station binding");
        station_runtime
            .binding()
            .mark_bound()
            .expect("complete live Station binding");
        let station_client = station_runtime.client().clone();
        #[derive(serde::Deserialize)]
        struct NativeSession {
            actor_ptid: String,
            token: String,
        }

        struct FailBeforeSecondChunk {
            inner: StationAttachmentTransferTransport,
        }

        impl AttachmentTransferTransport for FailBeforeSecondChunk {
            fn begin_upload(
                &self,
                transfer: &AttachmentTransferRecord,
                prepared: &PreparedAttachmentUpload,
            ) -> Result<(String, u64, Vec<u8>), AttachmentTransferFailure> {
                self.inner.begin_upload(transfer, prepared)
            }

            fn put_upload_chunk(
                &self,
                transfer: &AttachmentTransferRecord,
                chunk: &EncryptedAttachmentChunk,
            ) -> Result<(), AttachmentTransferFailure> {
                if chunk.chunk_index == 1 {
                    return Err(AttachmentTransferFailure::retryable(
                        AttachmentTransferErrorCode::RetryLater,
                        None,
                        "injected process interruption before chunk 1".to_string(),
                    ));
                }
                self.inner.put_upload_chunk(transfer, chunk)
            }

            fn complete_upload(
                &self,
                transfer: &AttachmentTransferRecord,
                prepared: &PreparedAttachmentUpload,
            ) -> Result<EncryptedObjectDescriptor, AttachmentTransferFailure> {
                self.inner.complete_upload(transfer, prepared)
            }

            fn get_download_chunk(
                &self,
                transfer: &AttachmentTransferRecord,
                descriptor: &EncryptedObjectDescriptor,
                chunk_index: u32,
                start: u64,
                end: u64,
            ) -> Result<Vec<u8>, AttachmentTransferFailure> {
                self.inner
                    .get_download_chunk(transfer, descriptor, chunk_index, start, end)
            }

            fn cancel_upload(
                &self,
                transfer: &AttachmentTransferRecord,
            ) -> Result<(), AttachmentTransferFailure> {
                self.inner.cancel_upload(transfer)
            }
        }

        let profile_id = std::env::var("MESSAGING_ATTACHMENT_ENGINE_PROFILE_ID")
            .expect("MESSAGING_ATTACHMENT_ENGINE_PROFILE_ID is required");
        let ptid = std::env::var("MESSAGING_ATTACHMENT_PTID")
            .expect("MESSAGING_ATTACHMENT_PTID is required");
        let device_id = std::env::var("MESSAGING_ATTACHMENT_DEVICE_ID")
            .expect("MESSAGING_ATTACHMENT_DEVICE_ID is required");
        let token_file = std::env::var("MESSAGING_ATTACHMENT_TOKEN_FILE")
            .expect("MESSAGING_ATTACHMENT_TOKEN_FILE is required");
        let session: NativeSession = serde_json::from_slice(
            &fs::read(token_file).expect("native Desktop session file must be readable"),
        )
        .expect("native Desktop session file must be valid");
        assert!(!session.token.trim().is_empty());
        assert_eq!(
            session.actor_ptid, ptid,
            "native session actor must match the requested attachment actor"
        );
        assert!(
            profile_id.ends_with(&session.actor_ptid),
            "native session actor must match the Engine profile"
        );

        let explicit_route = std::env::var("MESSAGING_ATTACHMENT_CONVERSATION_ID")
            .ok()
            .zip(std::env::var("MESSAGING_ATTACHMENT_AUTHORITY_STATION_ID").ok());
        let projection = if explicit_route.is_some() {
            None
        } else {
            let profile_store = MessagingStore::open(&profile_id).unwrap();
            if let Some(enrollment) = profile_store.device_enrollment().unwrap() {
                let enrollment_device = enrollment.certificate.device.as_ref().unwrap();
                assert_eq!(actor_device_ptid(enrollment_device).unwrap(), ptid);
                assert_eq!(enrollment_device.device_id, device_id);
            }
            let projection = profile_store
                .conversation_projections()
                .unwrap()
                .into_iter()
                .find(|projection| {
                    projection.active && !projection.authority_station_id.is_empty()
                });
            drop(profile_store);
            projection
        };
        if let Some(projection) = &projection {
            assert!(
                projection.members.iter().any(|member| member.ptid == ptid),
                "native endpoint must be an active conversation member"
            );
        }

        let endpoint = crate::messaging::EngineEndpoint {
            ptid: ptid.clone(),
            device_id: device_id.clone(),
        };
        let restart_phase = std::env::var("MESSAGING_ATTACHMENT_RESTART_PHASE").ok();
        let engine = match restart_phase.as_deref() {
            Some("prepare" | "resume") => crate::messaging::MessagingEngine::open(
                station_client.clone(),
                profile_id.clone(),
                endpoint.clone(),
            )
            .unwrap(),
            Some(phase) => panic!("unsupported attachment restart phase: {phase}"),
            None => crate::messaging::MessagingEngine::in_memory(
                format!("attachment-live-{}", Ulid::new()),
                endpoint.clone(),
            )
            .unwrap(),
        };
        let (conversation_id, authority_station_id) = match (explicit_route, projection) {
            (Some(route), _) => route,
            (None, Some(projection)) => {
                (projection.conversation_id, projection.authority_station_id)
            }
            (None, None) => {
                use crate::model::chat::{ListConversationsRequest, ListConversationsResponse};
                use reqwest::Method;

                let peer_ptid = std::env::var("MESSAGING_ATTACHMENT_PEER_PTID")
                    .expect("MESSAGING_ATTACHMENT_PEER_PTID is required without a local route");
                let federation_id = std::env::var("MESSAGING_ATTACHMENT_FEDERATION_ID")
                    .expect("MESSAGING_ATTACHMENT_FEDERATION_ID is required without a local route");
                let conversation_id = engine
                    .create_direct_conversation(&session.token, &peer_ptid, &federation_id)
                    .unwrap();
                let response = station_client.request_proto_for_device::<
                    ListConversationsRequest,
                    ListConversationsResponse,
                >(
                    Method::GET,
                    "/conversation/list",
                    &session.token,
                    None,
                    None::<&ListConversationsRequest>,
                    &device_id,
                )
                .unwrap();
                let authority_station_id = response
                    .conversations
                    .into_iter()
                    .find(|conversation| conversation.conversation_id == conversation_id)
                    .map(|conversation| conversation.authority_station_peer_id)
                    .filter(|authority| !authority.is_empty())
                    .expect("created conversation must expose its Authority Station");
                (conversation_id, authority_station_id)
            }
        };
        let source = match restart_phase.as_deref() {
            Some(_) => std::env::var("MESSAGING_ATTACHMENT_SOURCE_FILE")
                .map(std::path::PathBuf::from)
                .expect("MESSAGING_ATTACHMENT_SOURCE_FILE is required for restart evidence"),
            None => temp_path("live-engine-source"),
        };
        let partial = temp_path("live-engine-partial");
        let plaintext = vec![11_u8; 1024 * 1024 + 41];
        fs::write(&source, &plaintext).unwrap();
        let attachment_id = match restart_phase.as_deref() {
            Some(_) => std::env::var("MESSAGING_ATTACHMENT_ID")
                .expect("MESSAGING_ATTACHMENT_ID is required for restart evidence"),
            None => Ulid::new().to_string(),
        };
        let record = AttachmentTransferRecord {
            attachment_id: attachment_id.clone(),
            conversation_id,
            message_id: Ulid::new().to_string(),
            authority_station_id,
            direction: 1,
            state: AttachmentTransferState::Queued as i32,
            upload_id: String::new(),
            generation: 0,
            descriptor_sha256: vec![0; 32],
            completed_chunk_bitmap: vec![0],
            source_local_ref: source.display().to_string(),
            partial_local_ref: partial.display().to_string(),
            object_key: vec![19; 32],
            base_nonce: vec![0; 12],
            plaintext_size: plaintext.len() as u64,
            chunk_size: 1024 * 1024,
            attempt_count: 0,
            next_attempt_at_unix_ms: 1,
            last_error_code: 0,
            updated_at_unix_ms: 1,
        };
        if engine
            .store()
            .attachment_transfer(&attachment_id)
            .unwrap()
            .is_none()
        {
            engine.store().create_attachment_transfer(&record).unwrap();
        }
        let worker = match restart_phase.as_deref() {
            Some("prepare") => AttachmentTransferWorker::new(
                Arc::new(MessagingStore::open(&profile_id).unwrap()),
                Arc::new(FailBeforeSecondChunk {
                    inner: StationAttachmentTransferTransport::new(
                        station_client.clone(),
                        session.token,
                        CryptoEndpoint { ptid, device_id },
                    )
                    .unwrap(),
                }),
                Arc::new(crate::infrastructure::attachment_blob::FilesystemAttachmentBlob),
            ),
            _ => engine.attachment_transfer_worker(session.token).unwrap(),
        };

        let now_unix_ms = if restart_phase.as_deref() == Some("resume") {
            1_000_000
        } else {
            20_000
        };
        let progress = worker.run_upload_once(&attachment_id, now_unix_ms).unwrap();
        let persisted = engine
            .store()
            .attachment_transfer(&attachment_id)
            .unwrap()
            .unwrap();
        if restart_phase.as_deref() == Some("prepare") {
            assert!(matches!(
                progress,
                AttachmentTransferProgress::RetryScheduled { .. }
            ), "restart preparation progress={progress:?} state={} error_code={} bitmap={:?} has_upload_id={}",
                persisted.state,
                persisted.last_error_code,
                persisted.completed_chunk_bitmap,
                !persisted.upload_id.is_empty(),
            );
            assert_eq!(persisted.state, AttachmentTransferState::RetryWait as i32);
            assert_eq!(persisted.completed_chunk_bitmap, vec![1]);
            assert!(!persisted.upload_id.is_empty());
            return;
        }
        assert_eq!(progress, AttachmentTransferProgress::Complete);
        assert_eq!(persisted.state, AttachmentTransferState::Complete as i32);
        assert_eq!(persisted.completed_chunk_bitmap, vec![3]);
        assert!(!persisted.upload_id.is_empty());
        let _ = fs::remove_file(source);
    }

    #[test]
    fn canonical_station_error_body_overrides_http_fallback() {
        let retry_later = AttachmentTransferError {
            code: AttachmentTransferErrorCode::RetryLater as i32,
            retry_after: Some(prost_types::Duration {
                seconds: 1,
                nanos: 250_000_000,
            }),
        }
        .encode_to_vec();
        assert_eq!(
            decode_typed_transfer_failure(&retry_later, Some(5_000)),
            Some(AttachmentTransferFailure::retryable(
                AttachmentTransferErrorCode::RetryLater,
                Some(1_250),
                "messaging attachment station error ATTACHMENT_TRANSFER_ERROR_CODE_RETRY_LATER"
                    .to_string(),
            ))
        );

        let conflict = AttachmentTransferError {
            code: AttachmentTransferErrorCode::PartConflict as i32,
            retry_after: None,
        }
        .encode_to_vec();
        assert_eq!(
            decode_typed_transfer_failure(&conflict, None),
            Some(AttachmentTransferFailure::terminal(
                AttachmentTransferErrorCode::PartConflict,
                "messaging attachment station error ATTACHMENT_TRANSFER_ERROR_CODE_PART_CONFLICT"
                    .to_string(),
            ))
        );

        let invalid_duration = AttachmentTransferError {
            code: AttachmentTransferErrorCode::RetryLater as i32,
            retry_after: Some(prost_types::Duration {
                seconds: 1,
                nanos: 1_000_000_000,
            }),
        }
        .encode_to_vec();
        assert_eq!(
            decode_typed_transfer_failure(&invalid_duration, Some(5_000)),
            Some(AttachmentTransferFailure::retryable(
                AttachmentTransferErrorCode::RetryLater,
                Some(5_000),
                "messaging attachment station error ATTACHMENT_TRANSFER_ERROR_CODE_RETRY_LATER"
                    .to_string(),
            ))
        );
        assert_eq!(decode_typed_transfer_failure(b"not protobuf", None), None);
    }

    #[test]
    fn download_request_uses_canonical_conversation_header() {
        let transfer = AttachmentTransferRecord {
            attachment_id: "attachment-1".to_string(),
            conversation_id: "conversation-1".to_string(),
            message_id: "message-1".to_string(),
            authority_station_id: "station:local".to_string(),
            direction: 2,
            state: AttachmentTransferState::Queued as i32,
            upload_id: String::new(),
            generation: 0,
            descriptor_sha256: vec![0; 32],
            completed_chunk_bitmap: vec![0],
            source_local_ref: String::new(),
            partial_local_ref: "attachment-1.part".to_string(),
            object_key: vec![1; 32],
            base_nonce: vec![2; 12],
            plaintext_size: 4,
            chunk_size: 4,
            attempt_count: 0,
            next_attempt_at_unix_ms: 1,
            last_error_code: 0,
            updated_at_unix_ms: 1,
        };
        let descriptor = EncryptedObjectDescriptor {
            object_id: "object-1".to_string(),
            storage_ref: "storage-1".to_string(),
            ciphertext_size: 20,
            ciphertext_sha256: vec![3; 32],
            media_type: "application/octet-stream".to_string(),
            chunk_size: 4,
            chunk_count: 1,
            encryption_suite: 1,
            tag_size: 16,
            nonce_strategy: 1,
            chunk_ciphertext_sha256: vec![vec![4; 32]],
        };

        let headers = StationAttachmentTransferTransport::download_chunk_headers(
            &transfer,
            &descriptor,
            0,
            19,
        )
        .unwrap();
        assert_eq!(headers["X-Peers-Conversation-ID"], "conversation-1");
        assert_eq!(headers["X-Peers-Authority-Station-ID"], "station:local");
        assert_eq!(headers[IF_MATCH], format!("\"{}\"", "03".repeat(32)));
        assert_eq!(headers[RANGE], "bytes=0-19");
    }
}
