use super::*;
use ed25519_dalek::{Signer, SigningKey};
use prost::Message;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::mpsc;
use x_config_core::proto::{SignedXConfigSnapshot, XConfigSnapshotStatement};

struct Fixture {
    layout: StorageLayout,
    signer: SigningKey,
}

impl Fixture {
    fn new() -> Self {
        Self {
            layout: StorageLayout {
                app_name: "x-config-test".into(),
                root_source: "test".into(),
                root: std::env::temp_dir().join(format!("x-config-test-{}", uuid::Uuid::new_v4())),
                dirs: HashMap::new(),
            },
            signer: SigningKey::from_bytes(&[0x37; 32]),
        }
    }

    fn watermark_path(&self, channel: &str) -> PathBuf {
        self.layout
            .root
            .join("data/secure-store/x-config")
            .join(format!("{channel}.watermark.json"))
    }

    fn runtime(&self) -> XConfigRuntime {
        let meta = ClientMeta::new(&self.layout);
        let runtime = XConfigRuntime::new(&self.layout, meta);
        let mut state = runtime.state.lock().unwrap();
        state.override_origin = Some("http://127.0.0.1:18082".into());
        state.baked_origins.clear();
        state.coordinator = Some(SnapshotCoordinator::new(
            state.channel.clone(),
            PublisherKeyring::new([("test-publisher".into(), self.signer.verifying_key())])
                .unwrap(),
            DesktopWatermarkStore::new(
                &state.channel,
                self.layout.root.join("data/secure-store/x-config"),
            ),
            FileSnapshotCache::new(self.layout.root.join("cache/x-config"), &state.channel),
        ));
        drop(state);
        runtime
    }

    fn envelope(&self, channel: &str, sequence: u64, expires: i64) -> Vec<u8> {
        let timestamp = |ms: i64| prost_types::Timestamp {
            seconds: ms / 1_000,
            nanos: ((ms % 1_000) * 1_000_000) as i32,
        };
        let statement = XConfigSnapshotStatement {
            schema_version: 1,
            channel: channel.into(),
            sequence,
            issued_at: Some(timestamp(unix_ms() - 60_000)),
            expires_at: Some(timestamp(expires)),
            ..Default::default()
        }
        .encode_to_vec();
        let mut signed = x_config_core::SNAPSHOT_SIGNATURE_DOMAIN.to_vec();
        signed.extend_from_slice(&statement);
        SignedXConfigSnapshot {
            signing_key_id: "test-publisher".into(),
            statement_bytes: statement,
            ed25519_signature: self.signer.sign(&signed).to_bytes().to_vec(),
        }
        .encode_to_vec()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if self.layout.root.exists() {
            fs::remove_dir_all(&self.layout.root).unwrap();
        }
    }
}

#[test]
fn constructor_does_not_read_even_a_corrupt_watermark() {
    let fixture = Fixture::new();
    let meta = ClientMeta::new(&fixture.layout);
    let path = fixture.watermark_path(meta.channel());
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, b"corrupt").unwrap();
    let runtime = XConfigRuntime::new(&fixture.layout, meta);
    assert_eq!(runtime.projection().unwrap().freshness, "unavailable");
    assert_eq!(runtime.projection().unwrap().last_refresh_error, None);
    assert!(!runtime.state.lock().unwrap().initialized);
    let result = runtime
        .refresh_with(true, |_, _| panic!("unknown watermark must stop fetch"))
        .unwrap();
    assert_eq!(
        result.last_refresh_error.as_deref(),
        Some("watermark_decode")
    );
    assert!(!result.refreshing);
    assert!(result.next_refresh_at_unix_ms.unwrap() > unix_ms());
}

#[test]
fn inaccessible_watermark_does_not_fetch_and_can_retry_after_recovery() {
    let fixture = Fixture::new();
    let runtime = fixture.runtime();
    let channel = runtime.projection().unwrap().channel;
    let path = fixture.watermark_path(&channel);
    fs::create_dir_all(&path).unwrap(); // Read fails; this is not NotFound.
    let result = runtime
        .refresh_with(true, |_, _| panic!("denied read must stop fetch"))
        .unwrap();
    assert_eq!(result.last_refresh_error.as_deref(), Some("watermark_read"));
    assert!(!runtime.state.lock().unwrap().initialized);
    runtime
        .refresh_with(false, |_, _| panic!("backoff must suppress retry"))
        .unwrap();
    fs::remove_dir(&path).unwrap();
    let envelope = fixture.envelope(&channel, 1, unix_ms() + 60_000);
    let result = runtime
        .refresh_with(true, |_, _| {
            Ok(SnapshotFetch::Envelope {
                bytes: envelope.clone(),
                etag: Some("first".into()),
            })
        })
        .unwrap();
    assert_eq!(result.sequence, Some(1));
    assert_eq!(result.last_refresh_error, None);
}

#[test]
fn readers_and_forced_refresh_do_not_wait_for_a_blocked_worker() {
    let fixture = Fixture::new();
    let runtime = Arc::new(fixture.runtime());
    let (entered_tx, entered_rx) = mpsc::channel();
    let (resume_tx, resume_rx) = mpsc::channel();
    let worker_runtime = Arc::clone(&runtime);
    let worker = std::thread::spawn(move || {
        worker_runtime.refresh_with(true, |_, _| {
            entered_tx.send(()).unwrap();
            resume_rx.recv_timeout(Duration::from_secs(3)).unwrap();
            Err(XConfigError::new("test_network_unavailable"))
        })
    });
    entered_rx.recv_timeout(Duration::from_secs(3)).unwrap();
    let (read_tx, read_rx) = mpsc::channel();
    let reader_runtime = Arc::clone(&runtime);
    let reader = std::thread::spawn(move || {
        let projection = reader_runtime.projection().unwrap();
        let coalesced = reader_runtime
            .refresh_with(true, |_, _| panic!("duplicate fetch"))
            .unwrap();
        let error = reader_runtime
            .suggestion_material("missing")
            .unwrap_err()
            .code;
        read_tx
            .send((projection.refreshing, coalesced.refreshing, error))
            .unwrap();
    });
    let result = read_rx.recv_timeout(Duration::from_millis(500));
    resume_tx.send(()).unwrap();
    let done = worker.join().unwrap().unwrap();
    reader.join().unwrap();
    assert_eq!(
        result.unwrap(),
        (true, true, "x_config_snapshot_unavailable")
    );
    assert!(!done.refreshing);
    assert_eq!(
        done.last_refresh_error.as_deref(),
        Some("test_network_unavailable")
    );
}

#[test]
fn cached_snapshot_is_published_before_fetch_and_stales_by_clock() {
    let fixture = Fixture::new();
    let runtime = fixture.runtime();
    let channel = runtime.projection().unwrap().channel;
    let expires = unix_ms() + 60_000;
    let envelope = fixture.envelope(&channel, 7, expires);
    runtime
        .state
        .lock()
        .unwrap()
        .coordinator
        .as_mut()
        .unwrap()
        .accept_remote(&envelope, unix_ms())
        .unwrap();
    let result = runtime
        .refresh_with(true, |_, _| {
            let view = runtime.read_view().unwrap();
            assert_eq!(view.projection(unix_ms()).sequence, Some(7));
            assert_eq!(view.projection(expires).freshness, "stale");
            Err(XConfigError::new("test_network_unavailable"))
        })
        .unwrap();
    assert_eq!(result.sequence, Some(7));
    assert_eq!(result.freshness, "current");
}

#[test]
fn failed_commit_or_rollback_never_publishes_a_candidate() {
    let fixture = Fixture::new();
    let runtime = fixture.runtime();
    let channel = runtime.projection().unwrap().channel;
    let first = fixture.envelope(&channel, 3, unix_ms() + 60_000);
    runtime
        .refresh_with(true, |_, _| {
            Ok(SnapshotFetch::Envelope {
                bytes: first.clone(),
                etag: None,
            })
        })
        .unwrap();
    let path = fixture.watermark_path(&channel);
    let committed = fs::read(&path).unwrap();
    fs::write(&path, b"corrupt").unwrap();
    let second = fixture.envelope(&channel, 4, unix_ms() + 60_000);
    let denied = runtime
        .refresh_with(true, |_, _| {
            Ok(SnapshotFetch::Envelope {
                bytes: second.clone(),
                etag: None,
            })
        })
        .unwrap();
    assert_eq!(denied.sequence, Some(3));
    assert_eq!(
        denied.last_refresh_error.as_deref(),
        Some("watermark_decode")
    );
    fs::write(&path, committed).unwrap();
    let old = fixture.envelope(&channel, 2, unix_ms() + 60_000);
    let rollback = runtime
        .refresh_with(true, |_, _| {
            Ok(SnapshotFetch::Envelope {
                bytes: old.clone(),
                etag: None,
            })
        })
        .unwrap();
    assert_eq!(rollback.sequence, Some(3));
    assert_eq!(
        rollback.last_refresh_error.as_deref(),
        Some("snapshot_watermark_rollback")
    );
}

#[test]
fn unwinding_worker_clears_refreshing_and_preserves_read_access() {
    let fixture = Fixture::new();
    let runtime = fixture.runtime();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        runtime.refresh_with(true, |_, _| panic!("worker failure"))
    }));
    assert!(result.is_err());
    let view = runtime.projection().unwrap();
    assert!(!view.refreshing);
    assert_eq!(
        view.last_refresh_error.as_deref(),
        Some("x_config_refresh_aborted")
    );
    assert_eq!(
        runtime.refresh(true).unwrap_err().code,
        "x_config_state_lock"
    );
}

#[test]
fn expired_remote_snapshot_is_rejected_without_publication() {
    let fixture = Fixture::new();
    let runtime = fixture.runtime();
    let channel = runtime.projection().unwrap().channel;
    let expired = fixture.envelope(&channel, 8, unix_ms() - 1);
    let result = runtime
        .refresh_with(true, |_, _| {
            Ok(SnapshotFetch::Envelope {
                bytes: expired.clone(),
                etag: None,
            })
        })
        .unwrap();
    assert_eq!(result.sequence, None);
    assert_eq!(
        result.last_refresh_error.as_deref(),
        Some("snapshot_statement_fields")
    );
    assert!(!fixture.watermark_path(&channel).exists());
}

#[test]
fn override_origin_must_be_a_bare_admitted_base_url() {
    let _guard = crate::infrastructure::storage::test_storage_env_lock();
    std::env::set_var("PEERS_X_CONFIG_URL", "https://distribution.example/");
    assert_eq!(
        configured_override_origin().unwrap().as_deref(),
        Some("https://distribution.example")
    );
    for origin in [
        "http://distribution.example",
        "https://distribution.example/base",
    ] {
        std::env::set_var("PEERS_X_CONFIG_URL", origin);
        assert!(configured_override_origin().is_err());
    }
    std::env::set_var("PEERS_X_CONFIG_URL", "http://10.0.0.5:18082");
    assert_eq!(
        configured_override_origin().unwrap().as_deref(),
        Some("http://10.0.0.5:18082")
    );
    std::env::remove_var("PEERS_X_CONFIG_URL");
}

#[test]
fn refresh_targets_compose_override_advertised_and_baked_origins() {
    let targets: Vec<String> = effective_origins(
        Some("http://127.0.0.1:18082"),
        &["https://mirror.example.test".into()],
        &["http://10.37.221.38:18082".into()],
    )
    .into_iter()
    .filter_map(|origin| snapshot_url(&origin, "corpstable").map(|url| url.to_string()))
    .collect();
    assert_eq!(
        targets,
        vec![
            "http://127.0.0.1:18082/channels/corpstable/latest.pb",
            "https://mirror.example.test/channels/corpstable/latest.pb",
            "http://10.37.221.38:18082/channels/corpstable/latest.pb",
        ]
    );
}

#[test]
fn platform_projection_never_executes_release_metadata() {
    assert!(matches!(
        current_platform(),
        ClientPlatform::Macos | ClientPlatform::Windows | ClientPlatform::Linux
    ));
    assert!(matches!(
        current_architecture(),
        ClientArchitecture::Arm64 | ClientArchitecture::X8664 | ClientArchitecture::Unspecified
    ));
}
