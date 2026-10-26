//! Device-local file detail projection over private metadata and durable
//! transfer checkpoints. Native Hosts supply scoped handles and asset URLs.

use super::AttachmentTransferRecord;
use crate::proto::chat::{
    AttachmentAccessProjection, AttachmentAccessState, AttachmentPlaintextMetadata,
    AttachmentTransferErrorCode, AttachmentTransferState,
};

pub fn attachment_access_projection(
    metadata: &AttachmentPlaintextMetadata,
    transfer: Option<&AttachmentTransferRecord>,
    verified_cache_ready: bool,
) -> AttachmentAccessProjection {
    let object = metadata.object.as_ref();
    let total = object.map_or(metadata.plaintext_size, |object| object.ciphertext_size);
    let state = if verified_cache_ready {
        AttachmentAccessState::Ready
    } else {
        match transfer.and_then(|transfer| AttachmentTransferState::try_from(transfer.state).ok()) {
            Some(
                AttachmentTransferState::Queued
                | AttachmentTransferState::Transferring
                | AttachmentTransferState::RetryWait,
            ) => AttachmentAccessState::Downloading,
            Some(AttachmentTransferState::Verifying) => AttachmentAccessState::Verifying,
            Some(AttachmentTransferState::Cancelled) => AttachmentAccessState::Cancelled,
            Some(AttachmentTransferState::Terminal | AttachmentTransferState::Unspecified) => {
                AttachmentAccessState::Failed
            }
            _ => AttachmentAccessState::Remote,
        }
    };
    let transferred = if verified_cache_ready {
        total
    } else if let (Some(object), Some(transfer)) = (object, transfer) {
        let stride = u64::from(object.chunk_size) + u64::from(object.tag_size);
        (0..object.chunk_count)
            .filter(|index| {
                transfer
                    .completed_chunk_bitmap
                    .get((*index / 8) as usize)
                    .is_some_and(|byte| byte & (1 << (*index % 8)) != 0)
            })
            .map(|index| total.saturating_sub(u64::from(index) * stride).min(stride))
            .sum::<u64>()
            .min(total)
    } else {
        0
    };
    AttachmentAccessProjection {
        attachment_id: metadata.attachment_id.clone(),
        filename: metadata.filename.clone(),
        mime_type: metadata.mime_type.clone(),
        plaintext_size: metadata.plaintext_size,
        state: state as i32,
        transferred_bytes: transferred,
        transfer_total_bytes: total,
        access_handle: String::new(),
        asset_url: String::new(),
        retryable: matches!(
            state,
            AttachmentAccessState::Remote | AttachmentAccessState::Cancelled
        ) || transfer
            .is_some_and(|transfer| transfer.state == AttachmentTransferState::RetryWait as i32),
        error_code: transfer.map_or(
            AttachmentTransferErrorCode::Unspecified as i32,
            |transfer| transfer.last_error_code,
        ),
        next_attempt_at_unix_ms: transfer.map_or(0, |transfer| transfer.next_attempt_at_unix_ms),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::chat::EncryptedObjectDescriptor;

    #[test]
    fn complete_transfer_does_not_claim_ready_without_verified_cache() {
        let metadata = AttachmentPlaintextMetadata {
            attachment_id: "file".into(),
            filename: "report.pdf".into(),
            plaintext_size: 20,
            ..Default::default()
        };
        let unavailable = attachment_access_projection(&metadata, None, false);
        assert_eq!(unavailable.state, AttachmentAccessState::Remote as i32);
        assert!(unavailable.access_handle.is_empty());
        let ready = attachment_access_projection(&metadata, None, true);
        assert_eq!(ready.state, AttachmentAccessState::Ready as i32);
        assert_eq!(ready.transferred_bytes, 20);
    }

    #[test]
    fn checkpoint_progress_counts_only_committed_chunks_and_short_final_chunk() {
        let metadata = AttachmentPlaintextMetadata {
            object: Some(EncryptedObjectDescriptor {
                ciphertext_size: 49,
                chunk_size: 10,
                tag_size: 10,
                chunk_count: 3,
                ..Default::default()
            }),
            ..Default::default()
        };
        let mut transfer = AttachmentTransferRecord {
            attachment_id: String::new(),
            conversation_id: String::new(),
            message_id: String::new(),
            authority_station_id: String::new(),
            direction: 2,
            state: AttachmentTransferState::Transferring as i32,
            upload_id: String::new(),
            generation: 0,
            descriptor_sha256: vec![],
            completed_chunk_bitmap: vec![0b101],
            source_local_ref: String::new(),
            partial_local_ref: String::new(),
            object_key: vec![],
            base_nonce: vec![],
            plaintext_size: 19,
            chunk_size: 10,
            attempt_count: 0,
            next_attempt_at_unix_ms: 0,
            last_error_code: 0,
            updated_at_unix_ms: 0,
        };
        let progress = attachment_access_projection(&metadata, Some(&transfer), false);
        assert_eq!(progress.transferred_bytes, 29);
        assert_eq!(progress.state, AttachmentAccessState::Downloading as i32);
        transfer.state = AttachmentTransferState::Cancelled as i32;
        assert!(attachment_access_projection(&metadata, Some(&transfer), false).retryable);
        transfer.state = AttachmentTransferState::Terminal as i32;
        let terminal = attachment_access_projection(&metadata, Some(&transfer), false);
        assert_eq!(terminal.state, AttachmentAccessState::Failed as i32);
        assert!(!terminal.retryable);
    }
}
