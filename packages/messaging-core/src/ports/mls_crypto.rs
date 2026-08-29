/// Port trait for MLS (Message Layer Security) group operations.
///
/// Implementations provide the concrete OpenMLS primitives;
/// Core contains only protocol logic (dispatch, validation, commits).
pub trait MlsCrypto: Send + Sync {
    type GroupState: Send + Sync;

    /// Decrypt an MLS application message and return the plaintext.
    fn decrypt_application_message(
        &self,
        group_state: &mut Self::GroupState,
        ciphertext: &[u8],
    ) -> Result<MlsDecryptOutcome, String>;

    /// Process a commit message (membership transitions, epoch advancement).
    fn process_commit(
        &self,
        group_state: &mut Self::GroupState,
        commit: &[u8],
    ) -> Result<MlsCommitOutcome, String>;

    /// Process a welcome message to join a group.
    fn process_welcome(&self, welcome: &[u8]) -> Result<Self::GroupState, String>;

    /// Serialize group state for durable persistence.
    fn serialize_group_state(&self, state: &Self::GroupState) -> Result<Vec<u8>, String>;

    /// Deserialize group state from persisted bytes.
    fn deserialize_group_state(&self, bytes: &[u8]) -> Result<Self::GroupState, String>;
}

/// Result of MLS application message decryption.
pub struct MlsDecryptOutcome {
    pub plaintext: Vec<u8>,
    pub sender_leaf_index: u32,
    pub epoch: u64,
}

/// Result of processing an MLS commit.
pub struct MlsCommitOutcome {
    pub new_epoch: u64,
    pub members_added: Vec<String>,
    pub members_removed: Vec<String>,
}
