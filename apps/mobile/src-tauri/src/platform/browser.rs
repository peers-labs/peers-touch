use tauri::{AppHandle, Runtime};
use tauri_plugin_opener::OpenerExt;

use crate::error::{MobileError, MobileResult};

pub fn open_external<R: Runtime>(app: &AppHandle<R>, value: &str) -> MobileResult<()> {
    let url = validate_authorize_url(value)?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|error| MobileError::oauth(format!("failed to launch OAuth browser: {error}")))
}

fn validate_authorize_url(value: &str) -> MobileResult<tauri::Url> {
    let url = tauri::Url::parse(value.trim())
        .map_err(|_| MobileError::invalid_input("OAuth authorize URL is invalid"))?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(MobileError::invalid_input(
            "OAuth authorize URL must be an HTTPS URL without credentials",
        ));
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authorize_url_requires_https_without_credentials() {
        assert!(validate_authorize_url("https://github.com/login/oauth/authorize").is_ok());
        assert!(validate_authorize_url("http://github.com/login/oauth/authorize").is_err());
        assert!(validate_authorize_url("https://user@example.com/oauth").is_err());
        assert!(validate_authorize_url("peers-touch://oauth/callback").is_err());
    }
}
