use std::fmt;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct XConfigError {
    pub code: &'static str,
}

impl XConfigError {
    pub fn new(code: &'static str) -> Self {
        Self { code }
    }
}

impl fmt::Display for XConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code)
    }
}

impl std::error::Error for XConfigError {}
