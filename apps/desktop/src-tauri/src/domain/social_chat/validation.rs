/// Validate that a string field is not empty (after trimming whitespace).
///
/// Returns `Ok(())` when the value is non-blank, or `Err` with a human-readable
/// message that includes the field name.
pub fn validate_not_empty(field: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{field} is required"))
    } else {
        Ok(())
    }
}

/// Resolve a pagination `limit`, falling back to `default` and clamping to
/// `[1, max]`.
pub fn resolve_limit(limit: Option<u32>, default: u32, max: u32) -> u32 {
    limit.unwrap_or(default).clamp(1, max)
}

/// Resolve a pagination `offset`, falling back to `0`.
pub fn resolve_offset(offset: Option<u32>) -> u32 {
    offset.unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_not_empty_ok() {
        assert!(validate_not_empty("name", "hello").is_ok());
    }

    #[test]
    fn test_validate_not_empty_blank() {
        assert!(validate_not_empty("name", "").is_err());
        assert!(validate_not_empty("name", "   ").is_err());
    }

    #[test]
    fn test_resolve_limit_defaults() {
        assert_eq!(resolve_limit(None, 50, 200), 50);
        assert_eq!(resolve_limit(Some(0), 50, 200), 1);
        assert_eq!(resolve_limit(Some(300), 50, 200), 200);
        assert_eq!(resolve_limit(Some(100), 50, 200), 100);
    }

    #[test]
    fn test_resolve_offset() {
        assert_eq!(resolve_offset(None), 0);
        assert_eq!(resolve_offset(Some(10)), 10);
    }
}
