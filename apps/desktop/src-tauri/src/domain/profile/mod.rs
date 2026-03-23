use std::path::Path;
use std::sync::{LazyLock, Mutex};

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

#[derive(Debug)]
pub enum ProfileError {
    InvalidArgument(String),
    Conflict(String),
    Internal(String),
}

#[derive(Debug, Clone)]
pub struct ProfileSnapshot {
    pub display_name: String,
    pub bio: String,
    pub location: String,
    pub avatar_url: String,
    pub header_url: String,
    pub visibility: String,
    pub allow_direct_message: bool,
}

pub enum UploadKind {
    Avatar,
    Header,
}

pub struct UploadOutcome {
    pub field: String,
    pub value: String,
    pub rolled_back: bool,
}

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
        let normalized = value.trim();
        if normalized.is_empty() {
            return Err(ProfileError::InvalidArgument("display_name is empty".to_string()));
        }
        if normalized.len() > 80 {
            return Err(ProfileError::InvalidArgument(
                "display_name is too long".to_string(),
            ));
        }
        store.display_name = normalized.to_string();
    }
    if let Some(value) = bio {
        if value.len() > 280 {
            return Err(ProfileError::InvalidArgument("bio is too long".to_string()));
        }
        store.bio = value;
    }
    if let Some(value) = location {
        if value.len() > 120 {
            return Err(ProfileError::InvalidArgument(
                "location is too long".to_string(),
            ));
        }
        store.location = value;
    }
    Ok(snapshot_from(&store))
}

pub fn update_privacy(
    visibility: String,
    allow_direct_message: bool,
) -> Result<ProfileSnapshot, ProfileError> {
    let normalized = visibility.trim().to_ascii_lowercase();
    if !matches!(normalized.as_str(), "public" | "friends" | "private") {
        return Err(ProfileError::InvalidArgument(
            "visibility must be public|friends|private".to_string(),
        ));
    }
    let mut store = PROFILE_STORE
        .lock()
        .map_err(|_| ProfileError::Internal("failed to lock profile store".to_string()))?;
    store.visibility = normalized;
    store.allow_direct_message = allow_direct_message;
    Ok(snapshot_from(&store))
}

pub fn upload(kind: UploadKind, file_path: &str) -> Result<UploadOutcome, ProfileError> {
    let path = file_path.trim();
    if path.is_empty() {
        return Err(ProfileError::InvalidArgument("file_path is required".to_string()));
    }
    if path.len() > 1024 {
        return Err(ProfileError::InvalidArgument("file_path is too long".to_string()));
    }
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
    if should_fail(path) {
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
