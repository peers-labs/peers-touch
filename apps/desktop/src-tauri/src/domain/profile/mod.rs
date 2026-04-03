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

pub fn validate_display_name(value: &str) -> Result<String, ProfileError> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(ProfileError::InvalidArgument(
            "display_name is empty".to_string(),
        ));
    }
    if normalized.len() > 80 {
        return Err(ProfileError::InvalidArgument(
            "display_name is too long".to_string(),
        ));
    }
    Ok(normalized.to_string())
}

pub fn validate_bio(value: &str) -> Result<(), ProfileError> {
    if value.len() > 280 {
        return Err(ProfileError::InvalidArgument("bio is too long".to_string()));
    }
    Ok(())
}

pub fn validate_location(value: &str) -> Result<(), ProfileError> {
    if value.len() > 120 {
        return Err(ProfileError::InvalidArgument(
            "location is too long".to_string(),
        ));
    }
    Ok(())
}

pub fn validate_visibility(visibility: &str) -> Result<String, ProfileError> {
    let normalized = visibility.trim().to_ascii_lowercase();
    if !matches!(normalized.as_str(), "public" | "friends" | "private") {
        return Err(ProfileError::InvalidArgument(
            "visibility must be public|friends|private".to_string(),
        ));
    }
    Ok(normalized)
}

pub fn validate_file_path(file_path: &str) -> Result<String, ProfileError> {
    let path = file_path.trim();
    if path.is_empty() {
        return Err(ProfileError::InvalidArgument(
            "file_path is required".to_string(),
        ));
    }
    if path.len() > 1024 {
        return Err(ProfileError::InvalidArgument(
            "file_path is too long".to_string(),
        ));
    }
    Ok(path.to_string())
}
