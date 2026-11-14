use crate::attachment::validate_chat_encrypted_object_descriptor;
use crate::proto::chat::{
    AttachmentContentKind, AttachmentPlaintextMetadata, MessageMention, MessagePrivateContent,
    VoiceNoteMetadata,
};
use prost::Message;
use secure_content_core::object::OBJECT_MAX_PLAINTEXT_SIZE;
use std::collections::HashSet;

pub const MESSAGE_PRIVATE_CONTENT_FORMAT_VERSION: u32 = 1;
pub const MESSAGE_MAX_ATTACHMENT_COUNT: usize = 10;
pub const MESSAGE_MAX_VOICE_NOTE_DURATION_MS: u32 = 60 * 60 * 1000;
pub const MESSAGE_MAX_VOICE_NOTE_CODEC_BYTES: usize = 127;
pub const MESSAGE_MAX_VOICE_NOTE_WAVEFORM_SAMPLES: usize = 256;
pub const MESSAGE_MAX_VOICE_NOTE_WAVEFORM_VALUE: u32 = 255;
/// Upper bound on distinct @-mentions per message.
pub const MESSAGE_MAX_MENTIONS: usize = 50;

/// Mention payload carried in the ciphertext (see model/domain/chat/attachment.proto).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct MessageMentions {
    pub mentions: Vec<MessageMention>,
    pub mention_all: bool,
}

impl MessageMentions {
    pub fn empty() -> Self {
        Self::default()
    }

    /// Project the mention set out of a decoded private-content envelope.
    /// Receive paths use this once after decryption; later stages never
    /// re-decrypt just to read mentions.
    pub fn from_private_content(content: &MessagePrivateContent) -> Self {
        Self {
            mentions: content.mentions.clone(),
            mention_all: content.mention_all,
        }
    }
}

pub fn encode_message_private_content(
    text: &str,
    attachments: &[AttachmentPlaintextMetadata],
) -> Result<Vec<u8>, String> {
    encode_message_private_content_with_mentions(text, attachments, &MessageMentions::empty())
}

pub fn encode_message_private_content_with_mentions(
    text: &str,
    attachments: &[AttachmentPlaintextMetadata],
    extra: &MessageMentions,
) -> Result<Vec<u8>, String> {
    let content = MessagePrivateContent {
        format_version: MESSAGE_PRIVATE_CONTENT_FORMAT_VERSION,
        text: text.to_string(),
        attachments: attachments.to_vec(),
        mentions: extra.mentions.to_vec(),
        mention_all: extra.mention_all,
    };
    validate_message_private_content(&content)?;
    Ok(content.encode_to_vec())
}

pub fn decode_message_private_content(bytes: &[u8]) -> Result<MessagePrivateContent, String> {
    let content = MessagePrivateContent::decode(bytes)
        .map_err(|_| "messaging private content protobuf is invalid".to_string())?;
    validate_message_private_content(&content)?;
    if content.encode_to_vec() != bytes {
        return Err("messaging private content protobuf is not canonical".to_string());
    }
    Ok(content)
}

pub fn validate_message_private_content(content: &MessagePrivateContent) -> Result<(), String> {
    if content.format_version != MESSAGE_PRIVATE_CONTENT_FORMAT_VERSION {
        return Err("messaging private content format version is unsupported".to_string());
    }
    if content.text.is_empty() && content.attachments.is_empty() {
        return Err("messaging private content is empty".to_string());
    }
    if content.attachments.len() > MESSAGE_MAX_ATTACHMENT_COUNT {
        return Err("messaging private content attachment count exceeds policy".to_string());
    }

    let mut attachment_ids = HashSet::with_capacity(content.attachments.len());
    let mut previous_attachment_id: Option<&str> = None;
    let mut total_plaintext_size = 0_u64;
    for attachment in &content.attachments {
        validate_attachment_plaintext_metadata(attachment)?;
        if previous_attachment_id
            .is_some_and(|previous| previous >= attachment.attachment_id.as_str())
        {
            return Err(
                "messaging private content attachments are not strictly sorted".to_string(),
            );
        }
        if !attachment_ids.insert(attachment.attachment_id.as_str()) {
            return Err("messaging private content has duplicate attachment ID".to_string());
        }
        previous_attachment_id = Some(attachment.attachment_id.as_str());
        total_plaintext_size = total_plaintext_size
            .checked_add(attachment.plaintext_size)
            .ok_or_else(|| "messaging attachment aggregate size exceeds policy".to_string())?;
    }
    if total_plaintext_size > OBJECT_MAX_PLAINTEXT_SIZE {
        return Err("messaging attachment aggregate size exceeds policy".to_string());
    }
    validate_mentions(content)?;
    Ok(())
}

/// Validate @-mentions: bounded count, unique targets, in-bounds non-overlapping
/// UTF-16 offsets into `text`, and a non-empty display snapshot.
fn validate_mentions(content: &MessagePrivateContent) -> Result<(), String> {
    let mentions = &content.mentions;
    if mentions.len() > MESSAGE_MAX_MENTIONS {
        return Err("messaging private content mention count exceeds policy".to_string());
    }
    // Mention offsets index the text, so a non-text message cannot carry them.
    if !mentions.is_empty() && content.text.is_empty() {
        return Err("messaging private content mentions require text".to_string());
    }
    let text_units = content.text.encode_utf16().count() as u64;
    let mut mentioned_actors = HashSet::with_capacity(mentions.len());
    let mut previous_end: u64 = 0;
    for mention in mentions {
        let actor = mention.actor_ptid.trim();
        if actor.is_empty() || !actor.starts_with("ptid:") {
            return Err("messaging private content mention actor is invalid".to_string());
        }
        if mention.display.trim().is_empty() || mention.display.chars().count() > 256 {
            return Err("messaging private content mention display is invalid".to_string());
        }
        if !mentioned_actors.insert(actor) {
            return Err("messaging private content has duplicate mention target".to_string());
        }
        let start = u64::from(mention.offset);
        let length = u64::from(mention.length);
        if length == 0 || start < previous_end || start + length > text_units {
            return Err("messaging private content mention range is invalid".to_string());
        }
        previous_end = start + length;
    }
    Ok(())
}

pub fn validate_attachment_plaintext_metadata(
    attachment: &AttachmentPlaintextMetadata,
) -> Result<(), String> {
    let object = attachment
        .object
        .as_ref()
        .ok_or_else(|| "messaging attachment object descriptor is missing".to_string())?;
    if attachment.attachment_id.trim().is_empty()
        || attachment.filename.trim().is_empty()
        || attachment.filename.len() > 1024
        || attachment.mime_type.trim().is_empty()
        || attachment.mime_type.len() > 255
        || attachment.plaintext_size == 0
        || attachment.plaintext_size > OBJECT_MAX_PLAINTEXT_SIZE
        || attachment.plaintext_sha256.len() != 32
        || attachment.object_key.len() != 32
        || attachment.base_nonce.len() != 12
        || attachment.base_nonce[8..] != [0, 0, 0, 0]
    {
        return Err("messaging attachment private metadata is invalid".to_string());
    }
    match AttachmentContentKind::try_from(attachment.content_kind) {
        Ok(AttachmentContentKind::Unspecified | AttachmentContentKind::File)
            if attachment.duration_ms == 0 => {}
        Ok(AttachmentContentKind::VoiceNote)
            if attachment.duration_ms > 0
                && attachment
                    .mime_type
                    .to_ascii_lowercase()
                    .starts_with("audio/") => {}
        _ => return Err("messaging attachment private media metadata is invalid".to_string()),
    }
    validate_voice_note_metadata(&attachment.mime_type, attachment.voice_note.as_ref())?;
    validate_chat_encrypted_object_descriptor(object)?;
    let expected_chunk_count = attachment
        .plaintext_size
        .div_ceil(u64::from(object.chunk_size));
    if expected_chunk_count != u64::from(object.chunk_count)
        || object.ciphertext_size
            != attachment
                .plaintext_size
                .saturating_add(u64::from(object.tag_size) * u64::from(object.chunk_count))
    {
        return Err("messaging attachment private metadata does not match descriptor".to_string());
    }
    Ok(())
}

pub fn validate_voice_note_metadata(
    mime_type: &str,
    voice_note: Option<&VoiceNoteMetadata>,
) -> Result<(), String> {
    let Some(voice_note) = voice_note else {
        return Ok(());
    };
    if !mime_type.to_ascii_lowercase().starts_with("audio/")
        || voice_note.duration_ms == 0
        || voice_note.duration_ms > MESSAGE_MAX_VOICE_NOTE_DURATION_MS
        || voice_note.codec.trim().is_empty()
        || voice_note.codec.len() > MESSAGE_MAX_VOICE_NOTE_CODEC_BYTES
        || voice_note.codec.chars().any(char::is_control)
        || voice_note.waveform.len() > MESSAGE_MAX_VOICE_NOTE_WAVEFORM_SAMPLES
        || voice_note
            .waveform
            .iter()
            .any(|sample| *sample > MESSAGE_MAX_VOICE_NOTE_WAVEFORM_VALUE)
    {
        return Err("messaging voice note metadata is invalid".to_string());
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn test_attachment_metadata(attachment_id: &str) -> AttachmentPlaintextMetadata {
    use crate::proto::chat::{
        AttachmentEncryptionSuite, AttachmentNonceStrategy, EncryptedObjectDescriptor,
    };
    use secure_content_core::object::{OBJECT_CHUNK_SIZE, OBJECT_TAG_SIZE};
    use sha2::{Digest, Sha256};

    let plaintext_size = 7_u64;
    let ciphertext = vec![3_u8; plaintext_size as usize + OBJECT_TAG_SIZE as usize];
    AttachmentPlaintextMetadata {
        attachment_id: attachment_id.to_string(),
        filename: "report.txt".to_string(),
        mime_type: "text/plain".to_string(),
        plaintext_size,
        plaintext_sha256: Sha256::digest(b"content").to_vec(),
        object_key: vec![5; 32],
        base_nonce: vec![0; 12],
        object: Some(EncryptedObjectDescriptor {
            object_id: format!("object-{attachment_id}"),
            storage_ref: format!("opaque/{attachment_id}"),
            ciphertext_size: ciphertext.len() as u64,
            ciphertext_sha256: Sha256::digest(&ciphertext).to_vec(),
            media_type: "application/octet-stream".to_string(),
            chunk_size: OBJECT_CHUNK_SIZE,
            chunk_count: 1,
            encryption_suite: AttachmentEncryptionSuite::Aes256GcmChunked as i32,
            tag_size: OBJECT_TAG_SIZE,
            nonce_strategy: AttachmentNonceStrategy::Counter32Be as i32,
            chunk_ciphertext_sha256: vec![Sha256::digest(&ciphertext).to_vec()],
        }),
        content_kind: AttachmentContentKind::File as i32,
        duration_ms: 0,
        voice_note: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_content_round_trips_canonical_protobuf() {
        let expected = MessagePrivateContent {
            format_version: MESSAGE_PRIVATE_CONTENT_FORMAT_VERSION,
            text: "exact plaintext".to_string(),
            attachments: vec![test_attachment_metadata("attachment-1")],
            mentions: vec![],
            mention_all: false,
        };
        let encoded =
            encode_message_private_content(&expected.text, &expected.attachments).unwrap();
        assert_eq!(decode_message_private_content(&encoded).unwrap(), expected);
    }

    #[test]
    fn private_content_rejects_raw_text_and_invalid_metadata() {
        assert!(decode_message_private_content(b"raw plaintext").is_err());

        let mut duplicate = MessagePrivateContent {
            format_version: MESSAGE_PRIVATE_CONTENT_FORMAT_VERSION,
            text: String::new(),
            attachments: vec![
                test_attachment_metadata("attachment-1"),
                test_attachment_metadata("attachment-1"),
            ],
            mentions: vec![],
            mention_all: false,
        };
        assert!(validate_message_private_content(&duplicate).is_err());

        duplicate.attachments.pop();
        duplicate.attachments[0].base_nonce[11] = 1;
        assert!(validate_message_private_content(&duplicate).is_err());

        let mut invalid_voice = test_attachment_metadata("attachment-voice");
        invalid_voice.voice_note = Some(VoiceNoteMetadata {
            duration_ms: 1_000,
            codec: "audio/webm;codecs=opus".to_string(),
            waveform: Vec::new(),
        });
        assert!(validate_message_private_content(&MessagePrivateContent {
            format_version: MESSAGE_PRIVATE_CONTENT_FORMAT_VERSION,
            text: String::new(),
            attachments: vec![invalid_voice],
            mentions: vec![],
            mention_all: false,
        })
        .is_err());
    }

    #[test]
    fn mention_round_trips_and_rejects_invalid_ranges() {
        use crate::proto::chat::MessageMention;

        let text = "hi @bob and @carol";
        // "@bob" starts at UTF-16 offset 3, length 4.
        let mentions = vec![
            MessageMention {
                actor_ptid: "ptid:peer:bob".to_string(),
                offset: 3,
                length: 4,
                display: "bob".to_string(),
            },
            MessageMention {
                actor_ptid: "ptid:peer:carol".to_string(),
                offset: 12,
                length: 6,
                display: "carol".to_string(),
            },
        ];
        let encoded = encode_message_private_content_with_mentions(
            text,
            &[],
            &MessageMentions {
                mentions: mentions.clone(),
                mention_all: false,
            },
        )
        .unwrap();
        let decoded = decode_message_private_content(&encoded).unwrap();
        assert_eq!(decoded.mentions, mentions);
        assert!(!decoded.mention_all);

        // Out-of-bounds offset is rejected.
        let bad_range = MessageMentions {
            mentions: vec![MessageMention {
                actor_ptid: "ptid:peer:bob".to_string(),
                offset: 100,
                length: 4,
                display: "bob".to_string(),
            }],
            mention_all: false,
        };
        assert!(encode_message_private_content_with_mentions(text, &[], &bad_range).is_err());

        // Duplicate target is rejected.
        let duplicate = MessageMentions {
            mentions: vec![
                MessageMention {
                    actor_ptid: "ptid:peer:bob".to_string(),
                    offset: 3,
                    length: 4,
                    display: "bob".to_string(),
                },
                MessageMention {
                    actor_ptid: "ptid:peer:bob".to_string(),
                    offset: 12,
                    length: 6,
                    display: "bob".to_string(),
                },
            ],
            mention_all: false,
        };
        assert!(encode_message_private_content_with_mentions(text, &[], &duplicate).is_err());

        // Mention without text is rejected.
        assert!(encode_message_private_content_with_mentions(
            "",
            &[],
            &MessageMentions {
                mentions: vec![MessageMention {
                    actor_ptid: "ptid:peer:bob".to_string(),
                    offset: 0,
                    length: 1,
                    display: "bob".to_string(),
                }],
                mention_all: false,
            }
        )
        .is_err());
    }

    #[test]
    fn voice_note_requires_audio_mime_and_positive_duration() {
        let mut voice = test_attachment_metadata("voice-1");
        voice.mime_type = "audio/webm".to_string();
        voice.content_kind = AttachmentContentKind::VoiceNote as i32;
        voice.duration_ms = 1_250;
        assert!(validate_attachment_plaintext_metadata(&voice).is_ok());

        voice.duration_ms = 0;
        assert!(validate_attachment_plaintext_metadata(&voice).is_err());
        voice.duration_ms = 1_250;
        voice.mime_type = "application/octet-stream".to_string();
        assert!(validate_attachment_plaintext_metadata(&voice).is_err());
    }
}
