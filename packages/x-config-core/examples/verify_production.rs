//! Read public production bytes through the same verification kernel as clients.
use x_config_core::{
    project_suggestions, select_release, verify_snapshot, XConfigError, Freshness,
    PublisherKeyring, SecureWatermark, SecureWatermarkStore, SnapshotCacheKey,
    SnapshotCacheStore, SnapshotCoordinator,
};
use x_config_core::proto::{ClientArchitecture, ClientPlatform};
use serde::Deserialize;
use std::{fs, io::{self, Read}, time::{SystemTime, UNIX_EPOCH}};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    snapshot_file: String,
    keyring_file: String,
    channel: String,
    expected_sequence: u64,
}

#[derive(Default)]
struct Watermark(Option<SecureWatermark>);

impl SecureWatermarkStore for Watermark {
    fn load(&self, _: &str) -> Result<Option<SecureWatermark>, XConfigError> {
        Ok(self.0.clone())
    }
    fn save(&mut self, value: &SecureWatermark) -> Result<(), XConfigError> {
        self.0 = Some(value.clone());
        Ok(())
    }
}

#[derive(Default)]
struct Cache(Vec<Vec<u8>>);

impl SnapshotCacheStore for Cache {
    fn load_candidates(&self, _: &str, _: Option<&SnapshotCacheKey>)
        -> Result<Vec<Vec<u8>>, XConfigError> {
        Ok(self.0.clone())
    }
    fn save(&mut self, _: &str, _: &SnapshotCacheKey, bytes: &[u8])
        -> Result<(), XConfigError> {
        self.0.push(bytes.to_vec());
        Ok(())
    }
}

fn run() -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let mut raw = String::new();
    io::stdin().take(65537).read_to_string(&mut raw)?;
    let cfg: Input = serde_json::from_str(&raw)?;
    let bytes = fs::read(&cfg.snapshot_file)?;
    let keyring = PublisherKeyring::from_json(&fs::read(&cfg.keyring_file)?)?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as i64;
    let verified = verify_snapshot(&bytes, &cfg.channel, &keyring, now)?;
    if verified.statement.sequence != cfg.expected_sequence {
        return Err("production_sequence_mismatch".into());
    }
    let suggestions = project_suggestions(&verified, now, Freshness::Current);
    if suggestions.is_empty() || !suggestions.iter().all(|value| value.actionable) {
        return Err("production_suggestions_unavailable".into());
    }
    let mut tampered = bytes.clone();
    let last = tampered.len()-1;
    tampered[last] ^= 1;
    if verify_snapshot(&tampered, &cfg.channel, &keyring, now).is_ok()
        || verify_snapshot(&bytes, "wrong-channel", &keyring, now).is_ok()
        || verify_snapshot(&bytes, &cfg.channel, &keyring, verified.expires_at_unix_ms+1).is_ok() {
        return Err("production_negative_control_failed".into());
    }
    let watermark = SecureWatermark {
        channel: cfg.channel.clone(),
        signing_key_id: verified.signing_key_id.clone(),
        sequence: verified.statement.sequence+1,
        statement_sha256: verified.statement_sha256,
    };
    let mut coordinator = SnapshotCoordinator::new(
        cfg.channel.clone(), keyring.clone(), Watermark(Some(watermark)), Cache::default());
    if coordinator.accept_remote(&bytes, now).is_ok() {
        return Err("production_rollback_admitted".into());
    }
    let mut clients = Vec::new();
    for (platform, architecture) in [
        (ClientPlatform::Macos, ClientArchitecture::Arm64),
        (ClientPlatform::Windows, ClientArchitecture::X8664),
        (ClientPlatform::Ios, ClientArchitecture::Arm64),
        (ClientPlatform::Android, ClientArchitecture::Arm64),
    ] {
        let snapshot = verify_snapshot(&bytes, &cfg.channel, &keyring, now)?;
        let release = select_release(&snapshot, platform, architecture, "0.0.0", now);
        if let Some(value) = &release {
            if value.platform != platform as i32
                || (value.architecture != architecture as i32
                    && value.architecture != ClientArchitecture::Universal as i32) {
                return Err("production_release_target_mismatch".into());
            }
        }
        clients.push(serde_json::json!({
            "platform": platform as i32, "architecture": architecture as i32,
            "releaseSelected": release.is_some(),
        }));
    }
    Ok(serde_json::json!({
        "sequence": verified.statement.sequence,
        "signatureVerified": true, "tamperDenied": true, "wrongChannelDenied": true,
        "expiryDenied": true, "rollbackDenied": true, "suggestionCount": suggestions.len(),
        "releaseTargeting": clients, "nativeUIProven": false,
    }))
}

fn main() {
    match run() {
        Ok(value) => println!("{}", value),
        Err(_) => {
            eprintln!("production_core_verification_failed");
            std::process::exit(1);
        }
    }
}
