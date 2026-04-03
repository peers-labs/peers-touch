use std::path::Path;
use std::sync::{LazyLock, Mutex};

use crate::domain::profile::{
    validate_bio, validate_display_name, validate_file_path, validate_location,
    validate_visibility, ProfileError, ProfileSnapshot, UploadKind, UploadOutcome,
};

#[derive(Clone)]
struct ProfileStore {
    display_name: String,
    bio: String,
    location: String,
    avatar_url: String,
    header_url: String,
    visibility: String,
    allow_direct_message: bool,
}

impl Default for ProfileStore {
    fn default() -> Self {
        Self {
            display_name: "Peers User".to_string(),
            bio: "Hello from peers-touch".to_string(),
            location: "Earth".to_string(),
            avatar_url: "https://cdn.peers.touch/default-avatar.png".to_string(),
            header_url: "https://cdn.peers.touch/default-header.png".to_string(),
            visibility: "friends".to_string(),
            allow_direct_message: true,
        }
    }
}

static PROFILE_STORE: LazyLock<Mutex<ProfileStore>> =
    LazyLock::new(|| Mutex::new(ProfileStore::default()));

pub fn get() -> Result<ProfileSnapshot, ProfileError> {
    let store = PROFILE_STORE
        .lock()
        .map_err(|_| ProfileError::Internal("failed to lock profile store".to_string()))?;
    Ok(snapshot_from(&store))
}

pub fn update(
    display_name: Option<String>,
    bio: Option<String>,
    location: Option<String>,
) -> Result<ProfileSnapshot, ProfileError> {
    let mut store = PROFILE_STORE
        .lock()
        .map_err(|_| ProfileError::Internal("failed to lock profile store".to_string()))?;
    if let Some(value) = display_name {
        store.display_name = validate_display_name(&value)?;
    }
    if let Some(value) = bio {
        validate_bio(&value)?;
        store.bio = value;
    }
    if let Some(value) = location {
        validate_location(&value)?;
        store.location = value;
    }
    Ok(snapshot_from(&store))
}

pub fn update_privacy(
    visibility: String,
    allow_direct_message: bool,
) -> Result<ProfileSnapshot, ProfileError> {
    let normalized = validate_visibility(&visibility)?;
    let mut store = PROFILE_STORE
        .lock()
        .map_err(|_| ProfileError::Internal("failed to lock profile store".to_string()))?;
    store.visibility = normalized;
    store.allow_direct_message = allow_direct_message;
    Ok(snapshot_from(&store))
}

pub fn upload(kind: UploadKind, file_path: &str) -> Result<UploadOutcome, ProfileError> {
    let path = validate_file_path(file_path)?;
    let mut store = PROFILE_STORE
        .lock()
        .map_err(|_| ProfileError::Internal("failed to lock profile store".to_string()))?;
    let (field, old_value) = match kind {
        UploadKind::Avatar => ("avatar", store.avatar_url.clone()),
        UploadKind::Header => ("header", store.header_url.clone()),
    };
    let optimistic_value = format!("file://{}", path.replace('\\', "/"));
    match kind {
        UploadKind::Avatar => {
            store.avatar_url = optimistic_value.clone();
        }
        UploadKind::Header => {
            store.header_url = optimistic_value.clone();
        }
    }
    if should_fail(&path) {
        match kind {
            UploadKind::Avatar => {
                store.avatar_url = old_value;
            }
            UploadKind::Header => {
                store.header_url = old_value;
            }
        }
        return Ok(UploadOutcome {
            field: field.to_string(),
            value: "rolled_back".to_string(),
            rolled_back: true,
        });
    }
    Ok(UploadOutcome {
        field: field.to_string(),
        value: optimistic_value,
        rolled_back: false,
    })
}

fn should_fail(path: &str) -> bool {
    let normalized = path.to_ascii_lowercase();
    if normalized.contains("fail") {
        return true;
    }
    if normalized.starts_with("mock://") {
        return false;
    }
    !Path::new(path).exists()
}

fn snapshot_from(store: &ProfileStore) -> ProfileSnapshot {
    ProfileSnapshot {
        display_name: store.display_name.clone(),
        bio: store.bio.clone(),
        location: store.location.clone(),
        avatar_url: store.avatar_url.clone(),
        header_url: store.header_url.clone(),
        visibility: store.visibility.clone(),
        allow_direct_message: store.allow_direct_message,
    }
}
