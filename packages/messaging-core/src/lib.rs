pub mod codec;
pub mod contracts;
pub mod crypto;
pub mod identity;
pub mod inbox;
pub mod outbox;
pub mod ports;
pub mod proto;
pub mod recovery;
pub mod store;

// Re-export proto sub-modules at crate root so prost-generated cross-package
// references (`super::super::common::v1::...` from within `proto::chat`) resolve.
pub use proto::{actor, common, key_exchange};
