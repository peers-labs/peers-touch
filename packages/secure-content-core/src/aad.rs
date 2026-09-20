const OBJECT_CHUNK_AAD_DOMAIN: &str = "peers-touch:attachment:aes-256-gcm-chunked:1";

pub fn object_chunk_nonce(base_nonce: &[u8; 12], chunk_index: u32) -> [u8; 12] {
    let mut nonce = *base_nonce;
    nonce[8..12].copy_from_slice(&chunk_index.to_be_bytes());
    nonce
}

pub fn object_chunk_aad(chunk_index: u32, plaintext_size: u64, chunk_size: u32) -> Vec<u8> {
    format!("{OBJECT_CHUNK_AAD_DOMAIN}:{chunk_index}:{plaintext_size}:{chunk_size}").into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_nonce_uses_the_final_counter_word() {
        let base = [0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0, 0, 0, 0];
        assert_eq!(
            object_chunk_nonce(&base, 0x0102_0304),
            [0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 1, 2, 3, 4]
        );
    }

    #[test]
    fn chunk_aad_preserves_the_existing_cross_client_contract() {
        assert_eq!(
            object_chunk_aad(7, 33, 16),
            b"peers-touch:attachment:aes-256-gcm-chunked:1:7:33:16"
        );
    }
}
