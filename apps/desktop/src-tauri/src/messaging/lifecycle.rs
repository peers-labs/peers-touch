use super::{CommandRetryPolicy, MessagingEngine};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

const LIFECYCLE_INTERVAL: Duration = Duration::from_secs(2);
const DRAIN_BATCH_LIMIT: u32 = 100;

struct LifecycleState {
    stopped: bool,
    token: String,
    last_error: Option<String>,
}

pub struct MessagingLifecycleWorker {
    state: Arc<(Mutex<LifecycleState>, Condvar)>,
    handle: Option<JoinHandle<()>>,
}

impl MessagingLifecycleWorker {
    pub fn start(engine: Arc<MessagingEngine>, token: String) -> Result<Self, String> {
        if token.trim().is_empty() {
            return Err("messaging lifecycle worker requires token".to_string());
        }
        let state = Arc::new((
            Mutex::new(LifecycleState {
                stopped: false,
                token,
                last_error: None,
            }),
            Condvar::new(),
        ));
        let thread_state = state.clone();
        let handle = thread::Builder::new()
            .name(format!("messaging:{}", engine.profile_id()))
            .spawn(move || {
                lifecycle_loop(thread_state, move |token| run_cycle(&engine, token));
            })
            .map_err(|error| format!("start messaging lifecycle worker: {error}"))?;
        Ok(Self {
            state,
            handle: Some(handle),
        })
    }

    pub fn refresh_token(&self, token: String) -> Result<(), String> {
        if token.trim().is_empty() {
            return Err("messaging lifecycle token is empty".to_string());
        }
        let (state, wake) = self.state.as_ref();
        let mut state = state
            .lock()
            .map_err(|_| "messaging lifecycle state lock poisoned".to_string())?;
        if state.stopped {
            return Err("messaging lifecycle worker is stopped".to_string());
        }
        state.token = token;
        wake.notify_one();
        Ok(())
    }

    pub fn token(&self) -> Result<String, String> {
        let state = self
            .state
            .0
            .lock()
            .map_err(|_| "messaging lifecycle state lock poisoned".to_string())?;
        if state.stopped {
            return Err("messaging lifecycle worker is stopped".to_string());
        }
        Ok(state.token.clone())
    }

    pub fn wake(&self) -> Result<(), String> {
        let (state, wake) = self.state.as_ref();
        let state = state
            .lock()
            .map_err(|_| "messaging lifecycle state lock poisoned".to_string())?;
        if state.stopped {
            return Err("messaging lifecycle worker is stopped".to_string());
        }
        wake.notify_one();
        Ok(())
    }

    #[cfg(test)]
    pub fn last_error(&self) -> Result<Option<String>, String> {
        self.state
            .0
            .lock()
            .map(|state| state.last_error.clone())
            .map_err(|_| "messaging lifecycle state lock poisoned".to_string())
    }

    pub fn stop(mut self) -> Result<(), String> {
        self.request_stop()?;
        self.join()
    }

    fn request_stop(&self) -> Result<(), String> {
        let (state, wake) = self.state.as_ref();
        let mut state = state
            .lock()
            .map_err(|_| "messaging lifecycle state lock poisoned".to_string())?;
        state.stopped = true;
        wake.notify_one();
        Ok(())
    }

    fn join(&mut self) -> Result<(), String> {
        let Some(handle) = self.handle.take() else {
            return Ok(());
        };
        handle
            .join()
            .map_err(|_| "messaging lifecycle worker panicked".to_string())
    }
}

impl Drop for MessagingLifecycleWorker {
    fn drop(&mut self) {
        let _ = self.request_stop();
        let _ = self.join();
    }
}

fn lifecycle_loop<F>(state: Arc<(Mutex<LifecycleState>, Condvar)>, mut run: F)
where
    F: FnMut(&str) -> Result<(), String>,
{
    loop {
        let token = {
            let guard = match state.0.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            if guard.stopped {
                return;
            }
            guard.token.clone()
        };
        let result = run(&token);
        let mut guard = match state.0.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let next_error = result.err();
        if next_error != guard.last_error {
            match next_error.as_deref() {
                Some(error) => tracing::warn!(error = %error, "messaging lifecycle cycle failed"),
                None => tracing::info!("messaging lifecycle cycle recovered"),
            }
        }
        guard.last_error = next_error;
        if guard.stopped {
            return;
        }
        let waited = state.1.wait_timeout(guard, LIFECYCLE_INTERVAL);
        match waited {
            Ok((next, _)) if next.stopped => return,
            Ok(_) => {}
            Err(_) => return,
        }
    }
}

fn run_cycle(engine: &MessagingEngine, token: &str) -> Result<(), String> {
    let mut failures = Vec::new();
    if let Err(error) = engine.enroll_pending_device(token, "Desktop".to_string()) {
        failures.push(format!("enrollment: {error}"));
    }
    if let Err(error) = engine.publish_prekeys(token) {
        failures.push(format!("prekeys: {error}"));
    }
    if let Err(error) = engine.publish_mls_key_packages(token) {
        failures.push(format!("MLS KeyPackages: {error}"));
    }
    if let Err(error) = engine.resume_membership_intent_once(token) {
        failures.push(format!("membership intent: {error}"));
    }
    if let Err(error) = engine.resume_message_draft_once(token, super::engine::now_unix_ms()) {
        failures.push(format!("message draft: {error}"));
    }
    if let Err(error) = engine.dispatch_command_once(
        token,
        super::engine::now_unix_ms(),
        CommandRetryPolicy {
            initial_delay_ms: 1_000,
            maximum_delay_ms: 300_000,
        },
    ) {
        failures.push(format!("command dispatch: {error}"));
    }
    if let Err(error) = engine.drain_once(token, DRAIN_BATCH_LIMIT) {
        failures.push(format!("queue drain: {error}"));
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn lifecycle_loop_runs_immediately_and_stops_on_wake() {
        let state = Arc::new((
            Mutex::new(LifecycleState {
                stopped: false,
                token: "token-a".to_string(),
                last_error: None,
            }),
            Condvar::new(),
        ));
        let calls = Arc::new(AtomicUsize::new(0));
        let thread_state = state.clone();
        let thread_calls = calls.clone();
        let handle = thread::spawn(move || {
            lifecycle_loop(thread_state, |token| {
                assert_eq!(token, "token-a");
                thread_calls.fetch_add(1, Ordering::SeqCst);
                Ok(())
            });
        });
        while calls.load(Ordering::SeqCst) == 0 {
            thread::yield_now();
        }
        {
            let mut guard = state.0.lock().unwrap();
            guard.stopped = true;
            state.1.notify_one();
        }
        handle.join().unwrap();
        let stopped_at = calls.load(Ordering::SeqCst);
        thread::sleep(Duration::from_millis(10));
        assert_eq!(calls.load(Ordering::SeqCst), stopped_at);
    }
}
