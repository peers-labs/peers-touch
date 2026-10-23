use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use search_core::{CancelToken, SearchError};

type RequestKey = (String, String, String);

#[derive(Default)]
pub struct SearchRequests {
    state: Mutex<RequestState>,
}

#[derive(Default)]
struct RequestState {
    active: HashMap<RequestKey, CancelToken>,
    // A cancel IPC may arrive before the matching read is admitted. Remember
    // it briefly; completed IDs do not cancel a later deliberate reuse.
    early_cancels: HashMap<RequestKey, Instant>,
    retired: HashMap<RequestKey, Instant>,
}

impl RequestState {
    fn prune(&mut self) {
        let now = Instant::now();
        self.early_cancels.retain(|_, until| *until > now);
        self.retired.retain(|_, until| *until > now);
    }

    fn retire(&mut self, key: &RequestKey) {
        self.active.remove(key);
        if self.retired.len() >= 512 {
            if let Some(oldest) = self
                .retired
                .iter()
                .min_by_key(|(_, until)| **until)
                .map(|(key, _)| key.clone())
            {
                self.retired.remove(&oldest);
            }
        }
        self.retired
            .insert(key.clone(), Instant::now() + Duration::from_secs(10));
    }
}

pub struct SearchRequest {
    owner: Arc<SearchRequests>,
    key: RequestKey,
    pub cancel: CancelToken,
    completed: bool,
}

impl SearchRequests {
    pub fn begin(
        self: &Arc<Self>,
        window: &str,
        account: &str,
        id: &str,
    ) -> Result<SearchRequest, SearchError> {
        if id.trim().is_empty() || id.len() > 128 {
            return Err(SearchError::InvalidQuery);
        }
        let key = (window.to_owned(), account.to_owned(), id.to_owned());
        let mut state = self
            .state
            .lock()
            .map_err(|_| SearchError::SourceUnavailable("request registry".into()))?;
        state.prune();
        if state.early_cancels.remove(&key).is_some() {
            return Err(SearchError::Cancelled);
        }
        if state.active.contains_key(&key) || state.active.len() >= 128 {
            return Err(SearchError::InvalidQuery);
        }
        let cancel = CancelToken::new();
        state.retired.remove(&key);
        state.active.insert(key.clone(), cancel.clone());
        Ok(SearchRequest {
            owner: self.clone(),
            key,
            cancel,
            completed: false,
        })
    }

    pub fn cancel(&self, window: &str, account: &str, id: &str) -> Result<bool, SearchError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| SearchError::SourceUnavailable("request registry".into()))?;
        state.prune();
        let key = (window.to_owned(), account.to_owned(), id.to_owned());
        if let Some(token) = state.active.get(&key) {
            token.cancel();
            Ok(true)
        } else {
            if !state.retired.contains_key(&key) && state.early_cancels.len() < 512 {
                state
                    .early_cancels
                    .insert(key, Instant::now() + Duration::from_secs(10));
            }
            Ok(false)
        }
    }
}

impl SearchRequest {
    /// Linearize completion against cancel: exactly one can win.
    pub fn complete(&mut self) -> Result<(), SearchError> {
        let mut state = self
            .owner
            .state
            .lock()
            .map_err(|_| SearchError::SourceUnavailable("request registry".into()))?;
        let result = self.cancel.check();
        state.retire(&self.key);
        self.completed = true;
        result
    }
}

impl Drop for SearchRequest {
    fn drop(&mut self) {
        if self.completed {
            return;
        }
        if let Ok(mut state) = self.owner.state.lock() {
            state.retire(&self.key);
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
