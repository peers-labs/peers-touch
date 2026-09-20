#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum StationOriginPolicy {
    HttpsOnly,
    Development,
}

impl StationOriginPolicy {
    pub(crate) const fn current_build() -> Self {
        if cfg!(debug_assertions) {
            Self::Development
        } else {
            Self::HttpsOnly
        }
    }

    const fn permits_http(self) -> bool {
        matches!(self, Self::Development)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum StationOriginError {
    Invalid,
    MissingHost,
    Insecure,
    NonCanonical,
    InvalidPort,
}

pub(crate) fn normalize_station_origin(
    value: &str,
    policy: StationOriginPolicy,
) -> Result<String, StationOriginError> {
    let parsed = reqwest::Url::parse(value.trim()).map_err(|_| StationOriginError::Invalid)?;
    let host = parsed.host_str().ok_or(StationOriginError::MissingHost)?;
    match parsed.scheme() {
        "https" => {}
        "http" if policy.permits_http() => {}
        "http" => return Err(StationOriginError::Insecure),
        _ => return Err(StationOriginError::Invalid),
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
            normalize_station_origin("https://Station.Example", StationOriginPolicy::HttpsOnly,),
            Ok("https://station.example:443".to_string()),
        );
    }

    #[test]
    fn development_policy_admits_canonical_remote_http() {
        assert_eq!(
            normalize_station_origin(
                "http://Station.Example:18080",
                StationOriginPolicy::Development,
            ),
            Ok("http://station.example:18080".to_string()),
        );
    }

    #[test]
    fn https_only_policy_rejects_remote_http() {
        assert_eq!(
            normalize_station_origin(
                "http://station.example:18080",
                StationOriginPolicy::HttpsOnly,
            ),
            Err(StationOriginError::Insecure),
        );
    }

    #[test]
    fn every_policy_rejects_non_origin_urls() {
        for value in [
            "ftp://station.example",
            "https://user@station.example",
            "https://station.example/path",
            "https://station.example?query=value",
            "https://station.example#fragment",
        ] {
            assert!(
                normalize_station_origin(value, StationOriginPolicy::Development).is_err(),
                "{value} must be rejected",
            );
            assert!(
                normalize_station_origin(value, StationOriginPolicy::HttpsOnly).is_err(),
                "{value} must be rejected",
            );
        }
    }
}
