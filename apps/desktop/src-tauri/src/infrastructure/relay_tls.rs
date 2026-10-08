#[cfg(any(test, feature = "acceptance-webdriver"))]
use base64::engine::general_purpose::STANDARD;
#[cfg(any(test, feature = "acceptance-webdriver"))]
use base64::Engine as _;

#[cfg(feature = "acceptance-webdriver")]
const ACCEPTANCE_RELAY_CA_ENV: &str = "PT_ACCEPTANCE_RELAY_CA_DER_B64";

pub(crate) fn acceptance_relay_ca_der() -> Result<Option<Vec<u8>>, &'static str> {
    #[cfg(feature = "acceptance-webdriver")]
    {
        let encoded = match std::env::var(ACCEPTANCE_RELAY_CA_ENV) {
            Ok(value) if !value.trim().is_empty() => value,
            Ok(_) => return Err("Relay trust anchor is empty"),
            Err(std::env::VarError::NotPresent) => return Ok(None),
            Err(std::env::VarError::NotUnicode(_)) => {
                return Err("Relay trust anchor is not valid UTF-8")
            }
        };
        return decode_acceptance_relay_ca(&encoded).map(Some);
    }

    #[cfg(not(feature = "acceptance-webdriver"))]
    {
        Ok(None)
    }
}

#[cfg(any(test, feature = "acceptance-webdriver"))]
fn decode_acceptance_relay_ca(encoded: &str) -> Result<Vec<u8>, &'static str> {
    STANDARD
        .decode(encoded)
        .map_err(|_| "Relay trust anchor is not valid base64")
        .and_then(|certificate| {
            if certificate.is_empty() {
                Err("Relay trust anchor is empty")
            } else {
                Ok(certificate)
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_acceptance_relay_ca_der() {
        assert_eq!(decode_acceptance_relay_ca("YWJj").unwrap(), b"abc".to_vec());
    }

    #[test]
    fn rejects_invalid_or_empty_acceptance_relay_ca() {
        assert!(decode_acceptance_relay_ca("***").is_err());
        assert!(decode_acceptance_relay_ca("").is_err());
    }

    #[test]
    fn production_path_has_no_implicit_acceptance_trust() {
        #[cfg(not(feature = "acceptance-webdriver"))]
        assert_eq!(acceptance_relay_ca_der().unwrap(), None);
    }
}
