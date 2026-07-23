use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Duration, Instant};

use super::station_api::{self, CredentialStatus, ResolvedCredential, StationApiError, StationModel, StationProvider};

const CACHE_TTL: Duration = Duration::from_secs(60);

struct CacheEntry {
    providers: Vec<StationProvider>,
    models: HashMap<String, Vec<StationModel>>,
    credentials: HashMap<String, CredentialStatus>,
    fetched_at: Instant,
}

static CACHE: RwLock<Option<HashMap<String, CacheEntry>>> = RwLock::new(None);

pub fn get_providers(token: &str, scope: &str) -> Result<Vec<StationProvider>, StationApiError> {
    if let Some(cached) = read_if_fresh(scope) {
        return Ok(cached.providers.clone());
    }
    refresh(token, scope)?;
    read_if_fresh(scope)
        .map(|e| e.providers.clone())
        .ok_or_else(|| StationApiError::Internal("cache refresh failed".into()))
}

pub fn get_models(
    token: &str,
    scope: &str,
    provider_id: &str,
) -> Result<Vec<StationModel>, StationApiError> {
    ensure_fresh(token, scope)?;

    let guard = CACHE.read().unwrap();
    if let Some(map) = guard.as_ref() {
        if let Some(entry) = map.get(scope) {
            if let Some(models) = entry.models.get(provider_id) {
                return Ok(models.clone());
            }
        }
    }
    drop(guard);

    let models = station_api::list_models(token, provider_id)?;

    let mut guard = CACHE.write().unwrap();
    let map = guard.get_or_insert_with(HashMap::new);
    if let Some(entry) = map.get_mut(scope) {
        entry.models.insert(provider_id.to_string(), models.clone());
    }

    Ok(models)
}

pub fn get_credential_status(
    token: &str,
    scope: &str,
    provider_id: &str,
) -> Result<CredentialStatus, StationApiError> {
    ensure_fresh(token, scope)?;

    let guard = CACHE.read().unwrap();
    if let Some(map) = guard.as_ref() {
        if let Some(entry) = map.get(scope) {
            if let Some(status) = entry.credentials.get(provider_id) {
                return Ok(status.clone());
            }
        }
    }
    drop(guard);

    let status = station_api::credential_status(token, provider_id)?;

    let mut guard = CACHE.write().unwrap();
    let map = guard.get_or_insert_with(HashMap::new);
    if let Some(entry) = map.get_mut(scope) {
        entry.credentials.insert(provider_id.to_string(), status.clone());
    }

    Ok(status)
}

pub fn invalidate(scope: &str) {
    let mut guard = CACHE.write().unwrap();
    if let Some(map) = guard.as_mut() {
        map.remove(scope);
    }
}

pub fn invalidate_all() {
    let mut guard = CACHE.write().unwrap();
    *guard = None;
}

pub fn refresh(token: &str, scope: &str) -> Result<(), StationApiError> {
    let providers = station_api::list_providers(token)?;

    let mut guard = CACHE.write().unwrap();
    let map = guard.get_or_insert_with(HashMap::new);
    map.insert(
        scope.to_string(),
        CacheEntry {
            providers,
            models: HashMap::new(),
            credentials: HashMap::new(),
            fetched_at: Instant::now(),
        },
    );

    Ok(())
}

pub fn find_provider(
    token: &str,
    scope: &str,
    provider_id: &str,
) -> Result<Option<StationProvider>, StationApiError> {
    let providers = get_providers(token, scope)?;
    Ok(providers.into_iter().find(|p| p.name == provider_id))
}

pub fn resolve_credential(
    token: &str,
    provider_id: &str,
) -> Result<ResolvedCredential, StationApiError> {
    station_api::resolve_credential(token, provider_id)
}

fn ensure_fresh(token: &str, scope: &str) -> Result<(), StationApiError> {
    if read_if_fresh(scope).is_none() {
        refresh(token, scope)?;
    }
    Ok(())
}

fn read_if_fresh(scope: &str) -> Option<CacheEntryRef> {
    let guard = CACHE.read().unwrap();
    let map = guard.as_ref()?;
    let entry = map.get(scope)?;
    if entry.fetched_at.elapsed() < CACHE_TTL {
        Some(CacheEntryRef {
            providers: entry.providers.clone(),
        })
    } else {
        None
    }
}

struct CacheEntryRef {
    providers: Vec<StationProvider>,
}
