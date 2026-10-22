use crate::error::XConfigError;
use crate::signature::{
    verify_cached_snapshot, verify_snapshot, PublisherKeyring, VerifiedSnapshot,
};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SecureWatermark {
    pub channel: String,
    pub signing_key_id: String,
    pub sequence: u64,
    pub statement_sha256: [u8; 32],
}

pub trait SecureWatermarkStore {
    fn load(&self, channel: &str) -> Result<Option<SecureWatermark>, XConfigError>;
    fn save(&mut self, watermark: &SecureWatermark) -> Result<(), XConfigError>;
}

pub trait SnapshotCacheStore {
    fn load_candidates(
        &self,
        channel: &str,
        committed: Option<&SnapshotCacheKey>,
    ) -> Result<Vec<Vec<u8>>, XConfigError>;
    fn save(
        &mut self,
        channel: &str,
        key: &SnapshotCacheKey,
        envelope_bytes: &[u8],
    ) -> Result<(), XConfigError>;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SnapshotCacheKey {
    pub sequence: u64,
    pub generation_sha256: [u8; 32],
}

impl SnapshotCacheKey {
    fn from_snapshot(snapshot: &VerifiedSnapshot) -> Self {
        Self::from_parts(
            &snapshot.statement.channel,
            &snapshot.signing_key_id,
            snapshot.statement.sequence,
            &snapshot.statement_sha256,
        )
    }

    pub fn from_watermark(watermark: &SecureWatermark) -> Self {
        Self::from_parts(
            &watermark.channel,
            &watermark.signing_key_id,
            watermark.sequence,
            &watermark.statement_sha256,
        )
    }

    fn from_parts(
        channel: &str,
        signing_key_id: &str,
        sequence: u64,
        statement_sha256: &[u8; 32],
    ) -> Self {
        let mut digest = Sha256::new();
        digest.update(channel.as_bytes());
        digest.update([0]);
        digest.update(signing_key_id.as_bytes());
        digest.update([0]);
        digest.update(sequence.to_be_bytes());
        digest.update(statement_sha256);
        Self {
            sequence,
            generation_sha256: digest.finalize().into(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AcceptOutcome {
    Advanced,
    Unchanged,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SnapshotOrigin {
    Embedded,
    Persisted,
}

pub struct SnapshotCoordinator<W, C> {
    channel: String,
    keyring: PublisherKeyring,
    watermark_store: W,
    cache_store: C,
    current: Option<VerifiedSnapshot>,
    current_origin: Option<SnapshotOrigin>,
}

impl<W, C> SnapshotCoordinator<W, C>
where
    W: SecureWatermarkStore,
    C: SnapshotCacheStore,
{
    pub fn new(
        channel: impl Into<String>,
        keyring: PublisherKeyring,
        watermark_store: W,
        cache_store: C,
    ) -> Self {
        Self {
            channel: channel.into(),
            keyring,
            watermark_store,
            cache_store,
            current: None,
            current_origin: None,
        }
    }

    pub fn initialize(
        &mut self,
        embedded: Option<&[u8]>,
        now_unix_ms: i64,
    ) -> Result<Option<&VerifiedSnapshot>, XConfigError> {
        let watermark = self.watermark_store.load(&self.channel)?;
        let embedded = embedded.and_then(|bytes| {
            verify_cached_snapshot(bytes, &self.channel, &self.keyring, now_unix_ms).ok()
        });
        let committed_cache_key = watermark.as_ref().map(SnapshotCacheKey::from_watermark);
        let cached = self
            .cache_store
            .load_candidates(&self.channel, committed_cache_key.as_ref())?
            .into_iter()
            .filter_map(|bytes| {
                verify_cached_snapshot(&bytes, &self.channel, &self.keyring, now_unix_ms).ok()
            })
            .collect::<Vec<_>>();
        let selected = match watermark.as_ref() {
            Some(watermark) => cached
                .into_iter()
                .find(|candidate| watermark_matches(watermark, candidate))
                .map(|candidate| (candidate, SnapshotOrigin::Persisted))
                .or_else(|| {
                    embedded
                        .filter(|candidate| watermark_matches(watermark, candidate))
                        .map(|candidate| (candidate, SnapshotOrigin::Embedded))
                }),
            None => embedded.map(|candidate| (candidate, SnapshotOrigin::Embedded)),
        };
        if let Some((snapshot, origin)) = selected {
            self.current = Some(snapshot);
            self.current_origin = Some(origin);
        } else {
            self.current = None;
            self.current_origin = None;
        }
        Ok(self.current.as_ref())
    }

    pub fn accept_remote(
        &mut self,
        envelope_bytes: &[u8],
        now_unix_ms: i64,
    ) -> Result<AcceptOutcome, XConfigError> {
        let candidate = verify_snapshot(envelope_bytes, &self.channel, &self.keyring, now_unix_ms)?;
        let watermark = self.watermark_store.load(&self.channel)?;
        watermark_allows(watermark.as_ref(), &candidate)?;
        if let Some(current) = self.current.as_ref() {
            compare_snapshots(current, &candidate)?;
            if current.statement.sequence == candidate.statement.sequence {
                return Ok(AcceptOutcome::Unchanged);
            }
        }
        let next_watermark = SecureWatermark {
            channel: self.channel.clone(),
            signing_key_id: candidate.signing_key_id.clone(),
            sequence: candidate.statement.sequence,
            statement_sha256: candidate.statement_sha256,
        };
        let cache_key = SnapshotCacheKey::from_snapshot(&candidate);
        self.cache_store
            .save(&self.channel, &cache_key, &candidate.envelope_bytes)?;
        self.watermark_store.save(&next_watermark)?;
        self.current = Some(candidate);
        self.current_origin = Some(SnapshotOrigin::Persisted);
        Ok(AcceptOutcome::Advanced)
    }

    pub fn current(&self) -> Option<&VerifiedSnapshot> {
        self.current.as_ref()
    }

    pub fn current_origin(&self) -> Option<SnapshotOrigin> {
        self.current_origin
    }

    pub fn into_stores(self) -> (W, C) {
        (self.watermark_store, self.cache_store)
    }
}

fn watermark_allows(
    watermark: Option<&SecureWatermark>,
    candidate: &VerifiedSnapshot,
) -> Result<(), XConfigError> {
    let Some(watermark) = watermark else {
        return Ok(());
    };
    if watermark.channel != candidate.statement.channel
        || candidate.statement.sequence < watermark.sequence
        || (candidate.statement.sequence == watermark.sequence
            && (candidate.statement_sha256 != watermark.statement_sha256
                || candidate.signing_key_id != watermark.signing_key_id))
    {
        return Err(XConfigError::new("snapshot_watermark_rollback"));
    }
    Ok(())
}

fn watermark_matches(watermark: &SecureWatermark, candidate: &VerifiedSnapshot) -> bool {
    watermark.channel == candidate.statement.channel
        && watermark.sequence == candidate.statement.sequence
        && watermark.statement_sha256 == candidate.statement_sha256
        && watermark.signing_key_id == candidate.signing_key_id
}

fn compare_snapshots(
    current: &VerifiedSnapshot,
    candidate: &VerifiedSnapshot,
) -> Result<(), XConfigError> {
    if candidate.statement.sequence < current.statement.sequence {
        return Err(XConfigError::new("snapshot_sequence_rollback"));
    }
    if candidate.statement.sequence == current.statement.sequence
        && (candidate.statement_bytes != current.statement_bytes
            || candidate.signing_key_id != current.signing_key_id)
    {
        return Err(XConfigError::new("snapshot_sequence_conflict"));
    }
    Ok(())
}
