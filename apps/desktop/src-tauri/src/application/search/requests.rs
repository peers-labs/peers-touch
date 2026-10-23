use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use search_core::{CancelToken, SearchError};

type RequestKey = (String, String, String);

#[derive(Default)]
pub struct SearchRequests {
    active: Mutex<HashMap<RequestKey, CancelToken>>,
}

pub struct SearchRequest {
    owner: Arc<SearchRequests>,
    key: RequestKey,
    pub cancel: CancelToken,
    completed: bool,
}

impl SearchRequests {
    pub fn begin(
        self: &Arc<Self>, window: &str, account: &str, id: &str,
    ) -> Result<SearchRequest, SearchError> {
        if id.trim().is_empty() || id.len() > 128 {
            return Err(SearchError::InvalidQuery);
        }
        let key = (window.to_owned(), account.to_owned(), id.to_owned());
        let mut active = self.active.lock()
            .map_err(|_| SearchError::SourceUnavailable("request registry".into()))?;
        if active.contains_key(&key) || active.len() >= 128 {
            return Err(SearchError::InvalidQuery);
        }
        let cancel = CancelToken::new();
        active.insert(key.clone(), cancel.clone());
        Ok(SearchRequest { owner: self.clone(), key, cancel, completed: false })
    }

    pub fn cancel(&self, window: &str, account: &str, id: &str) -> Result<bool, SearchError> {
        let active = self.active.lock()
            .map_err(|_| SearchError::SourceUnavailable("request registry".into()))?;
        let key = (window.to_owned(), account.to_owned(), id.to_owned());
        if let Some(token) = active.get(&key) {
            token.cancel();
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

impl SearchRequest {
    /// Linearize completion against cancel: exactly one can win.
    pub fn complete(&mut self) -> Result<(), SearchError> {
        let mut active = self.owner.active.lock()
            .map_err(|_| SearchError::SourceUnavailable("request registry".into()))?;
        let result = self.cancel.check();
        active.remove(&self.key);
        self.completed = true;
        result
    }
}

impl Drop for SearchRequest {
    fn drop(&mut self) {
        if self.completed { return; }
        if let Ok(mut active) = self.owner.active.lock() {
            active.remove(&self.key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_is_scoped_truthful_and_releases_requests() {
        let owner = Arc::new(SearchRequests::default());
        let request = owner.begin("main", "alice", "one").unwrap();
        assert!(!owner.cancel("main", "bob", "one").unwrap());
        assert!(!owner.cancel("second", "alice", "one").unwrap());
        assert!(owner.begin("main", "alice", "one").is_err());
        assert!(owner.cancel("main", "alice", "one").unwrap());
        assert_eq!(request.cancel.check(), Err(SearchError::Cancelled));
        drop(request);
        assert!(!owner.cancel("main", "alice", "one").unwrap());
        assert!(owner.begin("main", "alice", "one").is_ok());
    }

    #[test]
    fn completion_retires_the_request_before_a_later_cancel() {
        let owner = Arc::new(SearchRequests::default());
        let mut request = owner.begin("main", "alice", "one").unwrap();
        request.complete().unwrap();
        assert!(!owner.cancel("main", "alice", "one").unwrap());
        let next = owner.begin("main", "alice", "one").unwrap();
        drop(request);
        assert!(owner.cancel("main", "alice", "one").unwrap());
        assert_eq!(next.cancel.check(), Err(SearchError::Cancelled));
    }
}
