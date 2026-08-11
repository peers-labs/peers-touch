pub trait Clock: Send + Sync {
    fn now_unix_ms(&self) -> i64;
}
