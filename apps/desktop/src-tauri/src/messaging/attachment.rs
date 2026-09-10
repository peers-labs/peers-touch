pub use messaging_core::attachment::{
    attachment_chunk_aad, attachment_chunk_nonce, decrypt_attachment_chunk,
    encrypt_attachment_chunk, validate_encrypted_object_descriptor,
    validate_encrypted_object_upload_spec, AttachmentCryptoMaterial, EncryptedAttachmentChunk,
    ATTACHMENT_CHUNK_SIZE, ATTACHMENT_MAX_PLAINTEXT_SIZE, ATTACHMENT_TAG_SIZE,
};
