pub trait LifecycleCancellation: Send + Sync {
    fn is_cancelled(&self) -> bool;
}
