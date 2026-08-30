use serde::Serialize;

pub type MobileResult<T> = Result<T, MobileError>;

#[derive(Debug, Serialize)]
pub struct MobileError {
    pub code: &'static str,
    pub message: String,
}

impl MobileError {
    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self {
            code: "MOBILE_INVALID_INPUT",
            message: message.into(),
        }
    }

    pub fn unsupported(message: impl Into<String>) -> Self {
        Self {
            code: "MOBILE_UNSUPPORTED_PLATFORM",
            message: message.into(),
        }
    }

    pub fn secure_storage(message: impl Into<String>) -> Self {
        Self {
            code: "MOBILE_SECURE_STORAGE",
            message: message.into(),
        }
    }

    pub fn crypto(message: impl Into<String>) -> Self {
        Self {
            code: "MOBILE_CRYPTO",
            message: message.into(),
        }
    }

    pub fn station_identity(message: impl Into<String>) -> Self {
        Self {
            code: "MOBILE_STATION_IDENTITY",
            message: message.into(),
        }
    }

    pub fn oauth(message: impl Into<String>) -> Self {
        Self {
            code: "MOBILE_OAUTH",
            message: message.into(),
        }
    }
}

impl std::fmt::Display for MobileError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for MobileError {}
