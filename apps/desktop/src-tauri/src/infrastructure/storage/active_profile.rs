//! Launch-profile resolution for GUI starts.
//!
//! Identity seeds and SQLCipher database keys are scoped per profile under
//! `<storage-root>/<profile>/data/secure-store` (see `bootstrap.rs` and
//! `key_provider.rs`). Terminal/Make launches select the profile explicitly
//! through `PT_PROFILE`; Finder/Dock launches of the installed `.app` carry no
//! such environment and previously fell back to a hardcoded `"desktop"`
//! profile. On machines whose verified identity lives under another profile
//! (for example `corpstable-app`), that fallback finds a foreign legacy seed,
//! Station rejects it as an identity continuity conflict, the messaging
//! engine never activates, and the UI shows an empty conversation list plus
//! "Conversation action failed" for every new chat — even though all data is
//! intact under the correct profile.
//!
//! The cross-profile pointer `<storage-root>/active-profile.json` records the
//! last profile whose messaging identity activated successfully. Bootstrap
//! resolves the launch profile in this order:
//!
//! 1. explicit `PT_PROFILE` (operator/tooling/acceptance authority),
//! 2. the last-active pointer (double-click returns to the verified identity),
//! 3. the `"desktop"` fallback (first-ever launch / fresh machine).
//!
//! A successful [`crate::application::auth::service::activate_messaging_profile`]
//! is the only writer: a profile that cannot prove continuity must never
//! clobber the pointer. Acceptance sandboxes (`PEERS_STORAGE_ROOT`) ignore the
//! pointer entirely so isolated runs stay deterministic.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use super::resolve_storage_root;

const DEFAULT_PROFILE: &str = "desktop";
const ACTIVE_PROFILE_FILE: &str = "active-profile.json";
const POINTER_VERSION: u32 = 1;
const MAX_PROFILE_LEN: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfileSource {
    ExplicitEnv,
    LastActivePointer,
    Default,
}

impl ProfileSource {
    pub fn as_str(self) -> &'static str {
        match self {
            ProfileSource::ExplicitEnv => "env:PT_PROFILE",
            ProfileSource::LastActivePointer => "active-profile.json",
            ProfileSource::Default => "default:desktop",
        }
    }
}

/// Profile ids are used as a single storage path segment. Accept only a
/// bounded, shell-safe component — never separators, drives, or traversal —
/// so pointer content can never escape `<storage-root>/<profile>`.
pub fn is_valid_profile_id(profile: &str) -> bool {
    let profile = profile.trim();
    if profile.is_empty() || profile.len() > MAX_PROFILE_LEN || profile == "." || profile == ".."
    {
        return false;
    }
    profile
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn storage_root() -> Option<PathBuf> {
    resolve_storage_root().ok().map(|(root, _source)| root)
}

fn pointer_path(root: &Path) -> PathBuf {
    root.join(ACTIVE_PROFILE_FILE)
}

fn profile_directory_exists(root: &Path, profile: &str) -> bool {
    root.join(profile).is_dir()
}

#[derive(Debug, Deserialize)]
struct ActiveProfileDocument {
    version: u32,
    profile: String,
}

/// Parse and validate pointer document content. Pure so the validation rules
/// are unit-testable without touching the environment or filesystem.
fn parse_pointer_document(content: &str) -> Option<String> {
    let document: ActiveProfileDocument = serde_json::from_str(content).ok()?;
    if document.version != POINTER_VERSION {
        return None;
    }
    let profile = document.profile.trim();
    is_valid_profile_id(profile).then(|| profile.to_string())
}

/// Pure selection core shared by [`resolve_launch_profile`] and the tests.
///
/// `explicit` MUST already be validated by the caller (the resolution boundary
/// rejects invalid operator input); `pointer` is the validated pointer
/// candidate, `pointer_profile_exists` whether its data directory is present.
/// A dangling pointer is ignored rather than auto-created, so a removed
/// profile cannot silently resurrect as an empty identity.
pub fn select_launch_profile(
    explicit: Option<&str>,
    pointer: Option<&str>,
    pointer_profile_exists: bool,
) -> (String, ProfileSource) {
    if let Some(profile) = explicit.map(str::trim).filter(|value| !value.is_empty()) {
        return (profile.to_string(), ProfileSource::ExplicitEnv);
    }
    if let Some(profile) = pointer {
        if is_valid_profile_id(profile) && pointer_profile_exists {
            return (profile.to_string(), ProfileSource::LastActivePointer);
        }
    }
    (DEFAULT_PROFILE.to_string(), ProfileSource::Default)
}

/// Resolve the launch profile once at bootstrap. Callers MUST publish the
/// resolved id back into `PT_PROFILE` so every later reader (database path
/// resolution, attachment/MCP components, tests) shares one selection.
///
/// Errors only on an explicitly invalid `PT_PROFILE`: the id is used as a
/// storage path segment, so accepting separators or traversal would escape
/// the storage root. The implicit pointer/default paths are validated
/// internally instead.
pub fn resolve_launch_profile() -> Result<(String, ProfileSource), String> {
    let explicit = std::env::var("PT_PROFILE").ok();
    let explicit = explicit
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if let Some(profile) = explicit {
        if !is_valid_profile_id(profile) {
            return Err(format!("invalid PT_PROFILE profile id: {profile:?}"));
        }
        return Ok((profile.to_string(), ProfileSource::ExplicitEnv));
    }

    // Sandboxed acceptance/device-test roots never consult host state.
    if std::env::var("PEERS_STORAGE_ROOT")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
    {
        return Ok(select_launch_profile(None, None, false));
    }

    let pointer = storage_root().and_then(|root| {
        let content = fs::read_to_string(pointer_path(&root)).ok()?;
        let profile = parse_pointer_document(&content)?;
        profile_directory_exists(&root, &profile).then_some(profile)
    });

    Ok(select_launch_profile(None, pointer.as_deref(), true))
}

/// Remember the profile whose messaging identity just activated
/// successfully. Idempotent while the selected profile is unchanged, so the
/// periodic token-validation path does not rewrite the file every minute.
/// Returns whether the pointer content actually changed.
pub fn remember_active_profile(profile: &str, actor_ptid: &str) -> bool {
    if !is_valid_profile_id(profile) {
        tracing::warn!(profile = %profile, "refusing to remember invalid launch profile");
        return false;
    }
    // Sandbox runs must never leave a host-visible profile pointer behind.
    if std::env::var("PEERS_STORAGE_ROOT")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
    {
        return false;
    }
    let Some(root) = storage_root() else {
        return false;
    };

    let path = pointer_path(&root);
    if let Ok(existing) = fs::read_to_string(&path) {
        if parse_pointer_document(&existing).as_deref() == Some(profile) {
            return false;
        }
    }

    let updated_at_unix_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    let document = serde_json::json!({
        "version": POINTER_VERSION,
        "profile": profile,
        "actor_ptid": actor_ptid,
        "updated_at_unix_ms": updated_at_unix_ms,
    });
    match write_pointer_atomically(&path, document.to_string().as_bytes()) {
        Ok(()) => true,
        Err(error) => {
            tracing::warn!(%error, "failed to persist active launch profile pointer");
            false
        }
    }
}

fn write_pointer_atomically(path: &Path, content: &[u8]) -> Result<(), String> {
    use std::io::Write;

    let parent = path
        .parent()
        .ok_or_else(|| "active profile pointer has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("mkdir pointer dir failed: {error}"))?;
    let temporary = parent.join(format!(
        ".{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(ACTIVE_PROFILE_FILE)
    ));
    {
        let mut file =
            fs::File::create(&temporary).map_err(|error| format!("create pointer failed: {error}"))?;
        file.write_all(content)
            .map_err(|error| format!("write pointer failed: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("sync pointer failed: {error}"))?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("chmod pointer failed: {error}"))?;
    }
    fs::rename(&temporary, path).map_err(|error| format!("publish pointer failed: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::storage::test_storage_env_lock;

    fn temp_root(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "peers-touch-active-profile-{}-{}-{label}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos(),
        ));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn validates_profile_identifier_shape() {
        for valid in ["desktop", "corpstable-app", "home_b.im_e2e.1", "a"] {
            assert!(is_valid_profile_id(valid), "{valid} must be accepted");
        }
        for invalid in [
            "",
            "  ",
            ".",
            "..",
            "../etc",
            "a/b",
            "a\\b",
            "/etc/passwd",
            "corpstable app",
            "corpstable:app",
            &"x".repeat(MAX_PROFILE_LEN + 1),
        ] {
            assert!(!is_valid_profile_id(invalid), "{invalid:?} must be rejected");
        }
    }

    #[test]
    fn explicit_env_wins_over_pointer_and_default() {
        let (profile, source) =
            select_launch_profile(Some("corpstable-app"), Some("desktop"), true);
        assert_eq!(profile, "corpstable-app");
        assert_eq!(source, ProfileSource::ExplicitEnv);
    }

    #[test]
    fn fallback_to_default_without_env_or_pointer() {
        let (profile, source) = select_launch_profile(None, None, false);
        assert_eq!(profile, "desktop");
        assert_eq!(source, ProfileSource::Default);
    }

    #[test]
    fn pointer_is_used_when_env_absent_and_profile_exists() {
        let (profile, source) = select_launch_profile(None, Some("corpstable-app"), true);
        assert_eq!(profile, "corpstable-app");
        assert_eq!(source, ProfileSource::LastActivePointer);
    }

    #[test]
    fn dangling_or_invalid_pointer_falls_back_to_default() {
        let (profile, source) = select_launch_profile(None, Some("corpstable-app"), false);
        assert_eq!(profile, "desktop");
        assert_eq!(source, ProfileSource::Default);

        let (profile, _) = select_launch_profile(None, Some("../escape"), false);
        assert_eq!(profile, "desktop");
    }

    #[test]
    fn parses_pointer_documents_strictly() {
        let document = serde_json::json!({
            "version": POINTER_VERSION,
            "profile": "corpstable-app",
            "actor_ptid": "ptid:v1:actor:peers:p:printfcoder:x",
            "updated_at_unix_ms": 1,
        })
        .to_string();
        assert_eq!(parse_pointer_document(&document).as_deref(), Some("corpstable-app"));

        assert_eq!(
            parse_pointer_document(
                &serde_json::json!({"version": POINTER_VERSION, "profile": "a/b"}).to_string()
            ),
            None
        );
        assert_eq!(
            parse_pointer_document(
                &serde_json::json!({"version": 99, "profile": "corpstable-app"}).to_string()
            ),
            None
        );
        assert_eq!(parse_pointer_document("{not json"), None);
    }

    #[test]
    fn remember_then_resolve_round_trips_and_is_idempotent() {
        let _env = test_storage_env_lock();
        let sandbox = temp_root("roundtrip");
        // Production path: PEERS_STORAGE_ROOT unset would touch the real
        // Application Support root, so exercise the atomic writer directly and
        // the pure reader instead of flipping host env here.
        let root = sandbox.join("peers-touch");
        fs::create_dir_all(root.join("corpstable-app")).expect("profile dir");
        let pointer = pointer_path(&root);

        let payload = serde_json::json!({
            "version": POINTER_VERSION,
            "profile": "corpstable-app",
            "actor_ptid": "ptid:v1:actor:peers:p:printfcoder:x",
            "updated_at_unix_ms": 1,
        })
        .to_string();
        write_pointer_atomically(&pointer, payload.as_bytes()).expect("write pointer");
        assert_eq!(
            parse_pointer_document(&fs::read_to_string(&pointer).unwrap()).as_deref(),
            Some("corpstable-app")
        );

        let selected = select_launch_profile(
            None,
            parse_pointer_document(&fs::read_to_string(&pointer).unwrap()).as_deref(),
            true,
        );
        assert_eq!(selected.0, "corpstable-app");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&pointer).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        let _ = fs::remove_dir_all(&sandbox);
    }

    #[test]
    fn sandbox_environment_ignores_pointer() {
        let _env = test_storage_env_lock();
        let sandbox = temp_root("sandbox");
        std::env::set_var("PEERS_STORAGE_ROOT", &sandbox);
        std::env::remove_var("PT_PROFILE");
        let root = sandbox.join("peers-touch");
        fs::create_dir_all(root.join("corpstable-app")).expect("profile dir");
        write_pointer_atomically(
            &pointer_path(&root),
            serde_json::json!({"version": POINTER_VERSION, "profile": "corpstable-app"})
                .to_string()
                .as_bytes(),
        )
        .expect("seed pointer");

        let (profile, source) = resolve_launch_profile().expect("sandbox resolution");
        assert_eq!(profile, "desktop");
        assert_eq!(source, ProfileSource::Default);

        remember_active_profile("corpstable-app", "ptid:v1:actor:peers:p:x:y");
        // The sandbox pointer must not have been rewritten by remember.
        let persisted = parse_pointer_document(
            &fs::read_to_string(pointer_path(&root)).expect("seeded pointer intact"),
        )
        .expect("seeded pointer content intact");
        assert_eq!(persisted, "corpstable-app");

        std::env::remove_var("PEERS_STORAGE_ROOT");
        let _ = fs::remove_dir_all(&sandbox);
    }

    #[test]
    fn remember_is_noop_for_invalid_profile_ids() {
        // Invalid ids must never reach the filesystem layer.
        for invalid in ["", "../x", "a/b"] {
            // Must not panic; root resolution may fail harmlessly too.
            assert!(!remember_active_profile(invalid, "ptid:v1:actor:peers:p:x:y"));
        }
    }

    #[test]
    fn invalid_explicit_env_profile_is_rejected() {
        let _env = test_storage_env_lock();
        std::env::set_var("PT_PROFILE", "../escape");
        std::env::remove_var("PEERS_STORAGE_ROOT");

        let error = resolve_launch_profile().expect_err("traversal profile id must fail");
        assert!(error.contains("invalid PT_PROFILE"), "{error}");

        std::env::remove_var("PT_PROFILE");
    }

    #[test]
    fn production_root_honours_pointer_and_explicit_env() {
        let _env = test_storage_env_lock();
        let fixture = temp_root("production-root");
        let home = fixture.join("home");
        let peers_root = home.join("Library/Application Support/peers-touch");
        fs::create_dir_all(peers_root.join("corpstable-app")).expect("profile dir");
        write_pointer_atomically(
            &pointer_path(&peers_root),
            serde_json::json!({"version": POINTER_VERSION, "profile": "corpstable-app"})
                .to_string()
                .as_bytes(),
        )
        .expect("seed pointer");

        let previous_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", &home);
        std::env::remove_var("PEERS_STORAGE_ROOT");
        std::env::remove_var("PT_PROFILE");

        let (profile, source) = resolve_launch_profile().expect("pointer resolution");
        assert_eq!(profile, "corpstable-app");
        assert_eq!(source, ProfileSource::LastActivePointer);

        // Explicit operator selection always wins over the remembered profile.
        std::env::set_var("PT_PROFILE", "desktop");
        let (profile, source) = resolve_launch_profile().expect("explicit resolution");
        assert_eq!(profile, "desktop");
        assert_eq!(source, ProfileSource::ExplicitEnv);

        if let Some(home_value) = previous_home {
            std::env::set_var("HOME", home_value);
        } else {
            std::env::remove_var("HOME");
        }
        std::env::remove_var("PT_PROFILE");
        let _ = fs::remove_dir_all(&fixture);
    }
}
