use zeroize::Zeroizing;

use super::error::ReliabilityResult;

pub const INSTALL_KEK_RECORD_ID: &str = "peers-touch.mobile.reliability.install-kek.v1";
pub const SCOPE_DEK_RECORD_PREFIX: &str = "peers-touch.mobile.reliability.scope-dek.v2.";

/// Native secure-storage port for reliability key records.
///
/// Platform adapters must configure records as device-only and
/// non-synchronizing. Values are opaque bytes at this boundary; adapters backed
/// by string-only APIs must encode internally and never expose that encoding to
/// Web callers.
pub trait KeyVault: Send + Sync {
    fn load(&self, record_id: &str) -> ReliabilityResult<Option<Zeroizing<Vec<u8>>>>;

    fn store(&self, record_id: &str, value: &[u8]) -> ReliabilityResult<()>;

    /// Delete is idempotent: deleting an absent record succeeds.
    fn delete(&self, record_id: &str) -> ReliabilityResult<()>;

    /// Return only record identifiers beginning with `prefix`.
    ///
    /// Reset depends on this operation so an app-data index cannot become a
    /// second source of truth for secure key ownership.
    fn list(&self, prefix: &str) -> ReliabilityResult<Vec<String>>;
}
