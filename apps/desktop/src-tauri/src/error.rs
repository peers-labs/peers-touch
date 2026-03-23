use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    NotImplemented,
    InvalidArgument,
    Unauthorized,
    Forbidden,
    NotFound,
    Conflict,
    InternalError,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    pub details: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppResult<T: Serialize> {
    pub ok: bool,
    pub data: Option<T>,
    pub error: Option<AppError>,
}

impl<T: Serialize> AppResult<T> {
    pub fn success(data: T) -> Self {
        Self {
            ok: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn fail(code: ErrorCode, message: impl Into<String>, details: Option<serde_json::Value>) -> Self {
        Self {
            ok: false,
            data: None,
            error: Some(AppError {
                code,
                message: message.into(),
                details,
            }),
        }
    }
}
