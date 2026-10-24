//! Origin validation for snapshot endpoints.
//!
//! Public origins must use HTTPS. Plain HTTP is accepted only for IP
//! literals on loopback or private corp networks; ed25519 signature
//! verification remains the integrity boundary regardless of transport.

use std::net::{Ipv4Addr, Ipv6Addr};
use url::Url;

pub fn valid_snapshot_origin(url: &Url) -> bool {
    let has_host = url.host_str().is_some();
    let clean = url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none();
    if !has_host || !clean {
        return false;
    }
    match url.scheme() {
        "https" => true,
        "http" => match url.host() {
            Some(url::Host::Ipv4(ip)) => private_ipv4(ip),
            // Mobile corp networks are IPv4; allow loopback on v6 only
            // because ULA detection would otherwise risk a broad surface.
            Some(url::Host::Ipv6(ip)) => ip == Ipv6Addr::LOCALHOST,
            Some(url::Host::Domain(_)) | None => false,
        },
        _ => false,
    }
}

fn private_ipv4(ip: Ipv4Addr) -> bool {
    ip.is_loopback() || ip.is_private() || ip.is_link_local()
}
