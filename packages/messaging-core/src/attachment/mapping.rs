use crate::proto::chat::{
    AttachmentEncryptionSuite, AttachmentNonceStrategy, AttachmentTransferDirection,
    AttachmentTransferErrorCode, AttachmentTransferState, EncryptedObjectDescriptor,
    EncryptedObjectUploadSpec,
};
use secure_content_core::object::{
    validate_object_descriptor, validate_object_transfer_record, validate_object_upload_spec,
    ObjectDescriptor, ObjectEncryptionSuite, ObjectNonceStrategy, ObjectTransferDirection,
    ObjectTransferErrorCode, ObjectTransferFailure, ObjectTransferRecord, ObjectTransferState,
    ObjectUploadSpec,
};

use super::{AttachmentTransferFailure, AttachmentTransferRecord};

pub fn validate_chat_encrypted_object_upload_spec(
    spec: &EncryptedObjectUploadSpec,
) -> Result<(), String> {
    validate_object_upload_spec(&chat_upload_spec_to_core(spec)?).map_err(chat_validation_error)
}

pub fn validate_chat_encrypted_object_descriptor(
    descriptor: &EncryptedObjectDescriptor,
) -> Result<(), String> {
    validate_object_descriptor(&chat_descriptor_to_core(descriptor)?).map_err(chat_validation_error)
}

pub fn validate_chat_attachment_transfer_record(
    transfer: &AttachmentTransferRecord,
) -> Result<(), String> {
    validate_object_transfer_record(&chat_transfer_record_to_core(transfer)?)
        .map_err(chat_validation_error)
}

pub(crate) fn chat_upload_spec_to_core(
    spec: &EncryptedObjectUploadSpec,
) -> Result<ObjectUploadSpec, String> {
    let encryption_suite = match AttachmentEncryptionSuite::try_from(spec.encryption_suite) {
        Ok(AttachmentEncryptionSuite::Aes256GcmChunked) => ObjectEncryptionSuite::Aes256GcmChunked,
        _ => return Err("messaging attachment descriptor is invalid".to_string()),
    };
    let nonce_strategy = match AttachmentNonceStrategy::try_from(spec.nonce_strategy) {
        Ok(AttachmentNonceStrategy::Counter32Be) => ObjectNonceStrategy::Counter32Be,
        _ => return Err("messaging attachment descriptor is invalid".to_string()),
    };
    Ok(ObjectUploadSpec {
        ciphertext_size: spec.ciphertext_size,
        ciphertext_sha256: spec.ciphertext_sha256.clone(),
        media_type: Some(spec.media_type.clone()),
        chunk_size: spec.chunk_size,
        chunk_count: spec.chunk_count,
        encryption_suite,
        tag_size: spec.tag_size,
        nonce_strategy,
        chunk_ciphertext_sha256: spec.chunk_ciphertext_sha256.clone(),
    })
}

pub(crate) fn core_upload_spec_to_chat(
    spec: &ObjectUploadSpec,
) -> Result<EncryptedObjectUploadSpec, String> {
    let media_type = spec
        .media_type
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "messaging attachment media type is invalid".to_string())?;
    Ok(EncryptedObjectUploadSpec {
        ciphertext_size: spec.ciphertext_size,
        ciphertext_sha256: spec.ciphertext_sha256.clone(),
        media_type,
        chunk_size: spec.chunk_size,
        chunk_count: spec.chunk_count,
        encryption_suite: AttachmentEncryptionSuite::Aes256GcmChunked as i32,
        tag_size: spec.tag_size,
        nonce_strategy: AttachmentNonceStrategy::Counter32Be as i32,
        chunk_ciphertext_sha256: spec.chunk_ciphertext_sha256.clone(),
    })
}

pub(crate) fn chat_descriptor_to_core(
    descriptor: &EncryptedObjectDescriptor,
) -> Result<ObjectDescriptor, String> {
    Ok(ObjectDescriptor {
        object_id: descriptor.object_id.clone(),
        storage_ref: descriptor.storage_ref.clone(),
        commitment: chat_upload_spec_to_core(&EncryptedObjectUploadSpec {
            ciphertext_size: descriptor.ciphertext_size,
            ciphertext_sha256: descriptor.ciphertext_sha256.clone(),
            media_type: descriptor.media_type.clone(),
            chunk_size: descriptor.chunk_size,
            chunk_count: descriptor.chunk_count,
            encryption_suite: descriptor.encryption_suite,
            tag_size: descriptor.tag_size,
            nonce_strategy: descriptor.nonce_strategy,
            chunk_ciphertext_sha256: descriptor.chunk_ciphertext_sha256.clone(),
        })?,
    })
}

pub(crate) fn core_descriptor_to_chat(
    descriptor: &ObjectDescriptor,
) -> Result<EncryptedObjectDescriptor, String> {
    let commitment = core_upload_spec_to_chat(&descriptor.commitment)?;
    Ok(EncryptedObjectDescriptor {
        object_id: descriptor.object_id.clone(),
        storage_ref: descriptor.storage_ref.clone(),
        ciphertext_size: commitment.ciphertext_size,
        ciphertext_sha256: commitment.ciphertext_sha256,
        media_type: commitment.media_type,
        chunk_size: commitment.chunk_size,
        chunk_count: commitment.chunk_count,
        encryption_suite: commitment.encryption_suite,
        tag_size: commitment.tag_size,
        nonce_strategy: commitment.nonce_strategy,
        chunk_ciphertext_sha256: commitment.chunk_ciphertext_sha256,
    })
}

pub(crate) fn chat_transfer_record_to_core(
    transfer: &AttachmentTransferRecord,
) -> Result<ObjectTransferRecord, String> {
    Ok(ObjectTransferRecord {
        transfer_id: transfer.attachment_id.clone(),
        owner_scope_id: transfer.conversation_id.clone(),
        operation_id: transfer.message_id.clone(),
        authority_id: transfer.authority_station_id.clone(),
        direction: chat_direction_to_core(transfer.direction)?,
        state: chat_state_to_core(transfer.state)?,
        upload_id: transfer.upload_id.clone(),
        generation: transfer.generation,
        descriptor_sha256: transfer.descriptor_sha256.clone(),
        completed_chunk_bitmap: transfer.completed_chunk_bitmap.clone(),
        source_local_ref: transfer.source_local_ref.clone(),
        partial_local_ref: transfer.partial_local_ref.clone(),
        object_key: transfer.object_key.clone(),
        base_nonce: transfer.base_nonce.clone(),
        plaintext_size: transfer.plaintext_size,
        chunk_size: transfer.chunk_size,
        attempt_count: transfer.attempt_count,
        next_attempt_at_unix_ms: transfer.next_attempt_at_unix_ms,
        last_error: chat_error_to_core(transfer.last_error_code)?,
        updated_at_unix_ms: transfer.updated_at_unix_ms,
    })
}

pub(crate) fn core_transfer_record_to_chat(
    transfer: &ObjectTransferRecord,
) -> AttachmentTransferRecord {
    AttachmentTransferRecord {
        attachment_id: transfer.transfer_id.clone(),
        conversation_id: transfer.owner_scope_id.clone(),
        message_id: transfer.operation_id.clone(),
        authority_station_id: transfer.authority_id.clone(),
        direction: core_direction_to_chat(transfer.direction) as i32,
        state: core_state_to_chat(transfer.state) as i32,
        upload_id: transfer.upload_id.clone(),
        generation: transfer.generation,
        descriptor_sha256: transfer.descriptor_sha256.clone(),
        completed_chunk_bitmap: transfer.completed_chunk_bitmap.clone(),
        source_local_ref: transfer.source_local_ref.clone(),
        partial_local_ref: transfer.partial_local_ref.clone(),
        object_key: transfer.object_key.clone(),
        base_nonce: transfer.base_nonce.clone(),
        plaintext_size: transfer.plaintext_size,
        chunk_size: transfer.chunk_size,
        attempt_count: transfer.attempt_count,
        next_attempt_at_unix_ms: transfer.next_attempt_at_unix_ms,
        last_error_code: transfer
            .last_error
            .map_or(0, |code| core_error_to_chat(code) as i32),
        updated_at_unix_ms: transfer.updated_at_unix_ms,
    }
}

pub(crate) fn chat_failure_to_core(failure: AttachmentTransferFailure) -> ObjectTransferFailure {
    ObjectTransferFailure {
        code: chat_error_code_to_core(failure.code),
        retry_after_ms: failure.retry_after_ms,
        retryable: failure.retryable,
        detail: failure.detail,
    }
}

pub(crate) fn core_failure_to_chat(failure: ObjectTransferFailure) -> AttachmentTransferFailure {
    AttachmentTransferFailure {
        code: core_error_to_chat(failure.code),
        retry_after_ms: failure.retry_after_ms,
        retryable: failure.retryable,
        detail: failure.detail,
    }
}

fn chat_direction_to_core(value: i32) -> Result<ObjectTransferDirection, String> {
    match AttachmentTransferDirection::try_from(value) {
        Ok(AttachmentTransferDirection::Upload) => Ok(ObjectTransferDirection::Upload),
        Ok(AttachmentTransferDirection::Download) => Ok(ObjectTransferDirection::Download),
        _ => Err("messaging attachment transfer direction is invalid".to_string()),
    }
}

fn core_direction_to_chat(value: ObjectTransferDirection) -> AttachmentTransferDirection {
    match value {
        ObjectTransferDirection::Upload => AttachmentTransferDirection::Upload,
        ObjectTransferDirection::Download => AttachmentTransferDirection::Download,
    }
}

fn chat_state_to_core(value: i32) -> Result<ObjectTransferState, String> {
    match AttachmentTransferState::try_from(value) {
        Ok(AttachmentTransferState::Queued) => Ok(ObjectTransferState::Queued),
        Ok(AttachmentTransferState::Transferring) => Ok(ObjectTransferState::Transferring),
        Ok(AttachmentTransferState::Verifying) => Ok(ObjectTransferState::Verifying),
        Ok(AttachmentTransferState::Complete) => Ok(ObjectTransferState::Complete),
        Ok(AttachmentTransferState::RetryWait) => Ok(ObjectTransferState::RetryWait),
        Ok(AttachmentTransferState::Cancelled) => Ok(ObjectTransferState::Cancelled),
        Ok(AttachmentTransferState::Terminal) => Ok(ObjectTransferState::Terminal),
        _ => Err("messaging attachment transfer state is invalid".to_string()),
    }
}

pub(crate) fn core_state_to_chat(value: ObjectTransferState) -> AttachmentTransferState {
    match value {
        ObjectTransferState::Queued => AttachmentTransferState::Queued,
        ObjectTransferState::Transferring => AttachmentTransferState::Transferring,
        ObjectTransferState::Verifying => AttachmentTransferState::Verifying,
        ObjectTransferState::Complete => AttachmentTransferState::Complete,
        ObjectTransferState::RetryWait => AttachmentTransferState::RetryWait,
        ObjectTransferState::Cancelled => AttachmentTransferState::Cancelled,
        ObjectTransferState::Terminal => AttachmentTransferState::Terminal,
    }
}

fn chat_error_to_core(value: i32) -> Result<Option<ObjectTransferErrorCode>, String> {
    match AttachmentTransferErrorCode::try_from(value) {
        Ok(AttachmentTransferErrorCode::Unspecified) => Ok(None),
        Ok(value) => Ok(Some(chat_error_code_to_core(value))),
        Err(_) => Err("messaging attachment transfer error code is invalid".to_string()),
    }
}

pub(crate) fn chat_error_code_to_core(
    value: AttachmentTransferErrorCode,
) -> ObjectTransferErrorCode {
    match value {
        AttachmentTransferErrorCode::UploadExpired => ObjectTransferErrorCode::UploadExpired,
        AttachmentTransferErrorCode::PartConflict => ObjectTransferErrorCode::PartConflict,
        AttachmentTransferErrorCode::RangeInvalid => ObjectTransferErrorCode::RangeInvalid,
        AttachmentTransferErrorCode::DescriptorMismatch => {
            ObjectTransferErrorCode::DescriptorMismatch
        }
        AttachmentTransferErrorCode::IntegrityFailed => ObjectTransferErrorCode::IntegrityFailed,
        AttachmentTransferErrorCode::NotGranted => ObjectTransferErrorCode::NotGranted,
        AttachmentTransferErrorCode::QuotaExceeded => ObjectTransferErrorCode::QuotaExceeded,
        AttachmentTransferErrorCode::RetryLater => ObjectTransferErrorCode::RetryLater,
        AttachmentTransferErrorCode::Unspecified => ObjectTransferErrorCode::DescriptorMismatch,
    }
}

pub(crate) fn core_error_to_chat(value: ObjectTransferErrorCode) -> AttachmentTransferErrorCode {
    match value {
        ObjectTransferErrorCode::UploadExpired => AttachmentTransferErrorCode::UploadExpired,
        ObjectTransferErrorCode::PartConflict => AttachmentTransferErrorCode::PartConflict,
        ObjectTransferErrorCode::RangeInvalid => AttachmentTransferErrorCode::RangeInvalid,
        ObjectTransferErrorCode::DescriptorMismatch => {
            AttachmentTransferErrorCode::DescriptorMismatch
        }
        ObjectTransferErrorCode::IntegrityFailed => AttachmentTransferErrorCode::IntegrityFailed,
        ObjectTransferErrorCode::NotGranted => AttachmentTransferErrorCode::NotGranted,
        ObjectTransferErrorCode::QuotaExceeded => AttachmentTransferErrorCode::QuotaExceeded,
        ObjectTransferErrorCode::RetryLater => AttachmentTransferErrorCode::RetryLater,
    }
}

fn chat_validation_error(error: String) -> String {
    if error == "secure content object exceeds policy" {
        "messaging attachment exceeds policy".to_string()
    } else {
        error
            .replace("secure content object", "messaging attachment")
            .replace("secure content", "messaging attachment")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persisted_chat_numeric_states_map_exactly_to_the_neutral_fsm() {
        for (numeric, core) in [
            (1, ObjectTransferState::Queued),
            (2, ObjectTransferState::Transferring),
            (3, ObjectTransferState::Verifying),
            (4, ObjectTransferState::Complete),
            (5, ObjectTransferState::RetryWait),
            (6, ObjectTransferState::Cancelled),
            (7, ObjectTransferState::Terminal),
        ] {
            assert_eq!(chat_state_to_core(numeric).unwrap(), core);
            assert_eq!(core_state_to_chat(core) as i32, numeric);
        }
        assert!(chat_state_to_core(0).is_err());
        assert!(chat_state_to_core(8).is_err());
    }

    #[test]
    fn chat_error_codes_map_without_numeric_drift() {
        for numeric in 1..=8 {
            let chat = AttachmentTransferErrorCode::try_from(numeric).unwrap();
            let core = chat_error_code_to_core(chat);
            assert_eq!(core_error_to_chat(core) as i32, numeric);
        }
    }
}
