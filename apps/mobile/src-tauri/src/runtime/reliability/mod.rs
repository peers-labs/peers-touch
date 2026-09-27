#[cfg(feature = "acceptance-harness")]
pub mod acceptance;
mod cleanup;
pub(crate) mod codec;
mod error;
mod friend_request;
mod key_hierarchy;
mod key_vault;
mod quarantine;
mod relationship;
mod reset;
mod root;
mod runtime_owner;
mod scope;

pub use cleanup::LogicalCleanupResult;
pub use error::{ReliabilityError, ReliabilityErrorKind, ReliabilityResult};
pub use friend_request::{
    FriendRequestResolution, FriendRequestResolver, FriendRequestResolverTransport,
    FriendRequestTransportFailure, PreparedFriendRequestAdmission,
};
pub use key_hierarchy::{ActivatedReliabilityScope, ReliabilityKeyManager, ScopeKeyContext};
pub use key_vault::{KeyVault, INSTALL_KEK_RECORD_ID, SCOPE_DEK_RECORD_PREFIX};
pub use quarantine::{LegacyQuarantine, LegacyQuarantineState};
pub use quarantine::{LegacyQuarantineAction, LegacyQuarantineActionResult};
pub use relationship::{
    PreparedRelationshipAdmission, RelationshipResolution, RelationshipResolver,
    RelationshipResolverTransport, RelationshipTransportFailure,
};
pub use reset::{ReliabilityReset, ReliabilityResetStatus, ReliabilityStoreCloser};
pub use root::{CanonicalReliabilityRoot, CanonicalScopePaths};
pub(crate) use runtime_owner::ActiveReliabilityScope;
pub use runtime_owner::{
    DraftDisposition, ReliabilityRuntime, ReliabilityRuntimeStatus, ReliabilityScopeCloseResult,
};
pub use scope::{ExactScope, RELIABILITY_SCHEMA_REVISION};
