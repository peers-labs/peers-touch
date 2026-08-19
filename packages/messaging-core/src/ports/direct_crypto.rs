/// Port trait for Double Ratchet cryptographic operations.
///
/// Implementations provide the concrete X25519/AES-256-GCM/HKDF primitives;
/// Core contains only protocol logic (validation, projection, commits).
pub trait DirectCrypto: Send + Sync {
    type SessionState: Clone + Send + Sync;
    type SkippedKey: Clone + Send + Sync;

    /// Decrypt a Double Ratchet ciphertext using the session state and skipped keys.
    /// Returns the plaintext and the new session state to persist.
    fn decrypt(
        &self,
        state: &Self::SessionState,
        wire: &DrCiphertextWire,
        skipped: &[Self::SkippedKey],
        aad: &[u8],
    ) -> Result<DrDecryptOutcome<Self::SessionState, Self::SkippedKey>, String>;

    /// Establish a new receiver session from X3DH parameters.
    fn establish_receiver_session(
        &self,
        params: &X3dhReceiverParams,
    ) -> Result<(Self::SessionState, Option<i32>), String>;
}

/// Wire-format ciphertext for the Double Ratchet.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DrCiphertextWire {
    pub version: u32,
    pub sender_dh: [u8; 32],
    pub n_send: u32,
    pub n_prev: u32,
    pub nonce: [u8; 12],
    pub ciphertext: Vec<u8>,
}

/// Result of a successful DR decryption.
pub struct DrDecryptOutcome<S, K> {
    pub plaintext: Vec<u8>,
    pub advanced_state: S,
    pub new_skipped: Vec<K>,
    pub consumed_skipped: Option<([u8; 32], u32)>,
}

/// Parameters for X3DH receiver-side session establishment.
pub struct X3dhReceiverParams {
    pub session_id: String,
    pub sender_identity_key: [u8; 32],
    pub sender_ephemeral_key: [u8; 32],
    pub receiver_identity_seed: [u8; 32],
    pub receiver_signed_prekey_seed: [u8; 32],
    pub one_time_prekey_id: Option<i32>,
    pub one_time_prekey_seed: Option<[u8; 32]>,
}
