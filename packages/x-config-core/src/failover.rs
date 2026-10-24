//! Origin failover driver (XCFG-D06).
//!
//! Transport, timeout, non-2xx, and envelope-size failures advance to the
//! next origin. An envelope rejected by signature or watermark admission also
//! advances, while [`crate::SnapshotCoordinator::accept_remote`] guarantees
//! that the current snapshot is never downgraded by a rejected candidate. The
//! first accepted origin wins; when every origin fails, the last error code
//! is returned for backoff and diagnostics.

use crate::cache::AcceptOutcome;
use crate::error::XConfigError;

/// Result of one conditional HTTP fetch against a single origin.
#[derive(Debug)]
pub enum SnapshotFetch {
    /// Server confirmed the local copy is still current (HTTP 304).
    NotModified { etag: Option<String> },
    /// Full envelope bytes plus the refreshed validator, if any.
    Envelope {
        bytes: Vec<u8>,
        etag: Option<String>,
    },
}

/// The origin that produced the winning fetch, by position in the URL list.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FailoverSuccess {
    NotModified {
        origin_index: usize,
        etag: Option<String>,
    },
    Accepted {
        origin_index: usize,
        etag: Option<String>,
    },
}

/// Try `urls` in failover order.
///
/// * `fetch_one` performs one conditional (or unconditional) HTTP fetch.
/// * `accept` runs signature, watermark, and cache admission for an envelope.
/// * `has_current` reports whether the runtime already holds a snapshot; a
///   304 response without one cannot bootstrap and triggers an unconditional
///   refetch from the same origin.
pub fn fetch_with_failover<FetchF, AcceptF>(
    urls: &[String],
    etag: Option<&str>,
    has_current: bool,
    mut fetch_one: FetchF,
    mut accept: AcceptF,
) -> Result<FailoverSuccess, XConfigError>
where
    FetchF: FnMut(&str, Option<&str>) -> Result<SnapshotFetch, XConfigError>,
    AcceptF: FnMut(&[u8]) -> Result<AcceptOutcome, XConfigError>,
{
    let mut last_error: Option<&'static str> = None;
    for (origin_index, url) in urls.iter().enumerate() {
        let attempt = match fetch_one(url, etag) {
            Ok(attempt) => attempt,
            Err(error) => {
                last_error = Some(error.code);
                continue;
            }
        };
        match attempt {
            SnapshotFetch::NotModified { etag: remote_etag } if has_current => {
                return Ok(FailoverSuccess::NotModified {
                    origin_index,
                    etag: remote_etag,
                });
            }
            SnapshotFetch::NotModified { .. } => {
                // The server honored a stale/foreign etag while the runtime
                // holds no snapshot; retry the same origin unconditionally.
                match fetch_one(url, None) {
                    Ok(SnapshotFetch::Envelope { bytes, etag }) => {
                        match accept_envelope(&mut accept, &bytes) {
                            Ok(()) => return Ok(FailoverSuccess::Accepted { origin_index, etag }),
                            Err(code) => last_error = Some(code),
                        }
                    }
                    Ok(SnapshotFetch::NotModified { .. }) => {
                        last_error = Some("x_config_http_status");
                    }
                    Err(error) => last_error = Some(error.code),
                }
            }
            SnapshotFetch::Envelope { bytes, etag } => match accept_envelope(&mut accept, &bytes) {
                Ok(()) => return Ok(FailoverSuccess::Accepted { origin_index, etag }),
                Err(code) => last_error = Some(code),
            },
        }
    }
    Err(XConfigError::new(
        last_error.unwrap_or("x_config_http_fetch"),
    ))
}

fn accept_envelope<AcceptF>(accept: &mut AcceptF, bytes: &[u8]) -> Result<(), &'static str>
where
    AcceptF: FnMut(&[u8]) -> Result<AcceptOutcome, XConfigError>,
{
    match accept(bytes) {
        Ok(AcceptOutcome::Advanced | AcceptOutcome::Unchanged) => Ok(()),
        Err(error) => Err(error.code),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fetch_error() -> XConfigError {
        XConfigError::new("x_config_http_fetch")
    }

    fn reject_error() -> XConfigError {
        XConfigError::new("snapshot_signature_invalid")
    }

    #[test]
    fn advances_past_dead_origins_to_first_accepted() {
        let urls = vec![
            "http://127.0.0.1:1/a".to_string(),
            "http://127.0.0.1:2/a".to_string(),
        ];
        let calls = std::cell::Cell::new(0u32);
        let result = fetch_with_failover(
            &urls,
            None,
            false,
            |_url, _etag| {
                calls.set(calls.get() + 1);
                if calls.get() == 1 {
                    Err(fetch_error())
                } else {
                    Ok(SnapshotFetch::Envelope {
                        bytes: vec![1, 2, 3],
                        etag: Some("v2".to_string()),
                    })
                }
            },
            |_bytes| Ok(AcceptOutcome::Advanced),
        )
        .expect("second origin succeeds");
        assert_eq!(
            result,
            FailoverSuccess::Accepted {
                origin_index: 1,
                etag: Some("v2".to_string()),
            }
        );
        assert_eq!(calls.get(), 2);
    }

    #[test]
    fn rejected_envelopes_advance_without_downgrade() {
        let urls = vec![
            "http://127.0.0.1:1/a".to_string(),
            "http://127.0.0.1:2/a".to_string(),
        ];
        let accepted = std::cell::Cell::new(false);
        let result = fetch_with_failover(
            &urls,
            None,
            true,
            |_url, _etag| {
                Ok(SnapshotFetch::Envelope {
                    bytes: vec![1],
                    etag: None,
                })
            },
            |_bytes| {
                if accepted.get() {
                    Ok(AcceptOutcome::Unchanged)
                } else {
                    accepted.set(true);
                    Err(reject_error())
                }
            },
        )
        .expect("second envelope accepted");
        assert_eq!(
            result,
            FailoverSuccess::Accepted {
                origin_index: 1,
                etag: None,
            }
        );
    }

    #[test]
    fn not_modified_with_current_snapshot_short_circuits() {
        let urls = vec!["http://127.0.0.1:1/a".to_string()];
        let accepts = std::cell::Cell::new(0u32);
        let result = fetch_with_failover(
            &urls,
            Some("v9"),
            true,
            |_url, _etag| {
                Ok(SnapshotFetch::NotModified {
                    etag: Some("v9".to_string()),
                })
            },
            |_bytes| {
                accepts.set(accepts.get() + 1);
                Ok(AcceptOutcome::Advanced)
            },
        )
        .expect("304 is success when current exists");
        assert_eq!(
            result,
            FailoverSuccess::NotModified {
                origin_index: 0,
                etag: Some("v9".to_string()),
            }
        );
        assert_eq!(accepts.get(), 0);
    }

    #[test]
    fn not_modified_without_current_refetches_unconditionally() {
        let urls = vec!["http://127.0.0.1:1/a".to_string()];
        let conditional = std::cell::Cell::new(true);
        let result = fetch_with_failover(
            &urls,
            Some("v9"),
            false,
            |_url, etag| {
                if conditional.get() {
                    conditional.set(false);
                    assert_eq!(etag, Some("v9"));
                    return Ok(SnapshotFetch::NotModified {
                        etag: Some("v9".to_string()),
                    });
                }
                assert_eq!(etag, None);
                Ok(SnapshotFetch::Envelope {
                    bytes: vec![9],
                    etag: Some("v10".to_string()),
                })
            },
            |_bytes| Ok(AcceptOutcome::Advanced),
        )
        .expect("unconditional refetch bootstraps");
        assert_eq!(
            result,
            FailoverSuccess::Accepted {
                origin_index: 0,
                etag: Some("v10".to_string()),
            }
        );
    }

    #[test]
    fn all_origins_failing_returns_last_error_code() {
        let urls = vec![
            "http://127.0.0.1:1/a".to_string(),
            "http://127.0.0.1:2/a".to_string(),
        ];
        let error = fetch_with_failover(
            &urls,
            None,
            false,
            |_url, _etag| Err(fetch_error()),
            |_bytes| Ok(AcceptOutcome::Advanced),
        )
        .expect_err("no origin available");
        assert_eq!(error.code, "x_config_http_fetch");

        let rejection = fetch_with_failover(
            &urls,
            None,
            false,
            |_url, _etag| {
                Ok(SnapshotFetch::Envelope {
                    bytes: vec![1],
                    etag: None,
                })
            },
            |_bytes| Err(reject_error()),
        )
        .expect_err("every envelope rejected");
        assert_eq!(rejection.code, "snapshot_signature_invalid");
    }
}
