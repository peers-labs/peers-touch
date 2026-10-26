//! Authenticated continuations. There is no unsigned offset cursor path.

pub mod authenticated;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CursorError {
    #[error("search cursor is malformed")]
    Malformed,
}
