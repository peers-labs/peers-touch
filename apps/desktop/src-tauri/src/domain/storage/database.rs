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
        Self {
            app_name: "desktop".to_string(),
            domain: "chat".to_string(),
            profile: "main".to_string(),
            user_scope: user_scope.clone(),
            encryption_level: EncryptionLevel::L2,
            key_ref: format!("chat/main/{user_scope}"),
            schema_version: 1,
        }
    }
}
