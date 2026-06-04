use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use serde::Serialize;

use crate::error::MobileResult;

#[derive(Debug, Serialize)]
pub struct StationProbeResult {
    url: String,
    online: bool,
    label: Option<String>,
    checked_at: u64,
}

#[tauri::command]
pub async fn station_probe(url: String) -> MobileResult<StationProbeResult> {
    let checked_at = current_unix_millis();
    let target = parse_station_target(&url);
    let label = target.as_ref().map(|target| target.label.clone());

    let online = match target {
        Some(target) => {
            tauri::async_runtime::spawn_blocking(move || probe_tcp(&target.host, target.port))
                .await
                .unwrap_or(false)
        }
        None => false,
    };

    Ok(StationProbeResult {
        url: url.trim_end_matches('/').to_string(),
        online,
        label,
        checked_at,
    })
}

struct StationTarget {
    host: String,
    port: u16,
    label: String,
}

fn parse_station_target(url: &str) -> Option<StationTarget> {
    let raw = url.trim().trim_end_matches('/');
    let (scheme, rest) = raw.split_once("://")?;
    let authority = rest.split('/').next()?.split('@').next_back()?;
    let host_port = authority.split('?').next()?.split('#').next()?;

    let (host, port) = parse_host_port(host_port, scheme)?;
    let label = format!("{host}:{port}");

    Some(StationTarget { host, port, label })
}

fn parse_host_port(value: &str, scheme: &str) -> Option<(String, u16)> {
    if value.starts_with('[') {
        let end = value.find(']')?;
        let host = value[1..end].to_string();
        let port = value
            .get(end + 2..)
            .and_then(|port| port.parse::<u16>().ok())
            .unwrap_or_else(|| default_port(scheme));
        return Some((host, port));
    }

    let mut parts = value.rsplitn(2, ':');
    let last = parts.next()?;
    let before_last = parts.next();

    match before_last {
        Some(host) => Some((host.to_string(), last.parse::<u16>().ok()?)),
        None => Some((last.to_string(), default_port(scheme))),
    }
}

fn default_port(scheme: &str) -> u16 {
    if scheme.eq_ignore_ascii_case("http") {
        80
    } else {
        443
    }
}

fn probe_tcp(host: &str, port: u16) -> bool {
    let Ok(mut addrs) = (host, port).to_socket_addrs() else {
        return false;
    };

    addrs.any(|addr| TcpStream::connect_timeout(&addr, Duration::from_secs(3)).is_ok())
}

fn current_unix_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}
