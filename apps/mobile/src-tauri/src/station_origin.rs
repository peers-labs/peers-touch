#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum StationOriginError {
    Invalid,
    MissingHost,
    NonCanonical,
    InvalidPort,
}

pub(crate) fn normalize_station_origin(value: &str) -> Result<String, StationOriginError> {
    let parsed = reqwest::Url::parse(value.trim()).map_err(|_| StationOriginError::Invalid)?;
    let host = parsed.host_str().ok_or(StationOriginError::MissingHost)?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(StationOriginError::Invalid);
    }
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(StationOriginError::NonCanonical);
    }

    let port = parsed
        .port_or_known_default()
        .ok_or(StationOriginError::InvalidPort)?;
    let host = host.to_ascii_lowercase();
    let authority = if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    };
    Ok(format!("{}://{authority}", parsed.scheme()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonicalizes_secure_origins() {
        assert_eq!(
            normalize_station_origin("https://Station.Example"),
            Ok("https://station.example:443".to_string()),
        );
    }

    #[test]
    fn user_selected_policy_admits_canonical_remote_http() {
        assert_eq!(
            normalize_station_origin("http://Station.Example:18080"),
            Ok("http://station.example:18080".to_string()),
        );
    }

    #[test]
    fn user_selected_policy_rejects_non_origin_urls() {
        for value in [
            "ftp://station.example",
            "https://user@station.example",
            "https://station.example/path",
            "https://station.example?query=value",
            "https://station.example#fragment",
        ] {
            assert!(
                normalize_station_origin(value).is_err(),
                "{value} must be rejected",
            );
        }
    }

    #[test]
    fn explicit_http_station_profiles_are_available_in_every_build() {
        assert_eq!(
            normalize_station_origin("http://192.0.2.10:18280"),
            Ok("http://192.0.2.10:18280".to_string()),
        );
    }
}
