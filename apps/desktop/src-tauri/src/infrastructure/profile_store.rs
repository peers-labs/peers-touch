use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use crate::domain::profile::{
    validate_bio, validate_display_name, validate_file_path, validate_location,
    validate_visibility, ProfileError, ProfileSnapshot, UploadKind, UploadOutcome,
};

use crate::infrastructure::actor_bucket::actor_bucket_id;

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

struct ProfileStores {
    buckets: HashMap<String, ProfileStore>,
}

static PROFILE_STORES: OnceLock<Mutex<ProfileStores>> = OnceLock::new();

fn profile_stores() -> &'static Mutex<ProfileStores> {
    PROFILE_STORES.get_or_init(|| {
        Mutex::new(ProfileStores {
            buckets: HashMap::new(),
        })
    })
}

fn with_profile_store_mut<T, F>(actor_ptid: &str, f: F) -> Result<T, ProfileError>
where
    F: FnOnce(&mut ProfileStore) -> Result<T, ProfileError>,
{
    let key = actor_bucket_id(actor_ptid)
        .map_err(|error| ProfileError::InvalidArgument(error.to_string()))?;
    let mut stores = profile_stores()
        .lock()
        .map_err(|_| ProfileError::Internal("failed to lock profile store".to_string()))?;
    let store = stores.buckets.entry(key).or_default();
    f(store)
}

pub fn get(actor_ptid: &str) -> Result<ProfileSnapshot, ProfileError> {
    with_profile_store_mut(actor_ptid, |store| Ok(snapshot_from(store)))
}

pub fn update(
    actor_ptid: &str,
    display_name: Option<String>,
    bio: Option<String>,
    location: Option<String>,
) -> Result<ProfileSnapshot, ProfileError> {
    with_profile_store_mut(actor_ptid, |store| {
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
        Ok(snapshot_from(store))
    })
}

pub fn update_privacy(
    actor_ptid: &str,
    visibility: String,
    allow_direct_message: bool,
) -> Result<ProfileSnapshot, ProfileError> {
    let normalized = validate_visibility(&visibility)?;
    with_profile_store_mut(actor_ptid, |store| {
        store.visibility = normalized;
        store.allow_direct_message = allow_direct_message;
        Ok(snapshot_from(store))
    })
}

pub fn upload(
    actor_ptid: &str,
    kind: UploadKind,
    file_path: &str,
) -> Result<UploadOutcome, ProfileError> {
    let path = validate_file_path(file_path)?;
    with_profile_store_mut(actor_ptid, |store| {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_stores_isolate_actors() {
        let a = "ptid:person:profile-a";
        let b = "ptid:person:profile-b";
        update(a, Some("Name A".to_string()), None, None).expect("update a");
        let snap_b_before = get(b).expect("b default");
        assert_ne!(snap_b_before.display_name, "Name A");
        let snap_a = get(a).expect("a");
        assert_eq!(snap_a.display_name, "Name A");
    }
}
