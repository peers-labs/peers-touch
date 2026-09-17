#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EncryptionLevel {
    L0,
    L1,
    L2,
}

#[derive(Debug, Clone)]
pub struct DatabaseOpenSpec {
    pub app_name: String,
    pub domain: String,
    pub profile: String,
    pub user_scope: String,
    pub encryption_level: EncryptionLevel,
    pub key_ref: String,
    pub schema_version: i32,
}

impl DatabaseOpenSpec {
    pub fn new_chat_main(user_scope: String) -> Self {
        let app_name = desktop_app_name();
        let key_ref = if app_name == "desktop" {
            format!("chat/main/{user_scope}")
        } else {
            format!("chat/{app_name}/main/{user_scope}")
        };
        Self {
            app_name,
            domain: "chat".to_string(),
            profile: "main".to_string(),
            user_scope: user_scope.clone(),
            encryption_level: EncryptionLevel::L2,
            key_ref,
            schema_version: 1,
        }
    }

    pub fn new_secure_content_main(user_scope: String) -> Self {
        let app_name = desktop_app_name();
        let key_ref = if app_name == "desktop" {
            format!("secure-content/main/{user_scope}")
        } else {
            format!("secure-content/{app_name}/main/{user_scope}")
        };
        Self {
            app_name,
            domain: "secure-content".to_string(),
            profile: "main".to_string(),
            user_scope,
            encryption_level: EncryptionLevel::L2,
            key_ref,
            schema_version: 1,
        }
    }
}

fn desktop_app_name() -> String {
    std::env::var("PT_PROFILE")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "desktop".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn chat_main_uses_default_desktop_key_ref_for_existing_data() {
        let _guard = env_lock().lock().expect("env lock");
        std::env::remove_var("PT_PROFILE");

        let spec = DatabaseOpenSpec::new_chat_main("actor-1".to_string());

        assert_eq!(spec.app_name, "desktop");
        assert_eq!(spec.key_ref, "chat/main/actor-1");
    }

    #[test]
    fn chat_main_isolates_non_default_profile_storage_and_key_ref() {
        let _guard = env_lock().lock().expect("env lock");
        std::env::set_var("PT_PROFILE", "home-b-im-e2e-fresh");

        let spec = DatabaseOpenSpec::new_chat_main("actor-2".to_string());

        assert_eq!(spec.app_name, "home-b-im-e2e-fresh");
        assert_eq!(spec.key_ref, "chat/home-b-im-e2e-fresh/main/actor-2");

        std::env::remove_var("PT_PROFILE");
    }

    #[test]
    fn secure_content_uses_an_independent_encrypted_database_and_key() {
        let _guard = env_lock().lock().expect("env lock");
        std::env::remove_var("PT_PROFILE");

        let spec = DatabaseOpenSpec::new_secure_content_main("actor-1".to_string());

        assert_eq!(spec.domain, "secure-content");
        assert_eq!(spec.profile, "main");
        assert_eq!(spec.encryption_level, EncryptionLevel::L2);
        assert_eq!(spec.key_ref, "secure-content/main/actor-1");
        assert_ne!(
            spec.key_ref,
            DatabaseOpenSpec::new_chat_main("actor-1".to_string()).key_ref
        );
    }
}
