use serde_json::Value;
use sha2::{Digest, Sha256};
use station_libp2p_http::{Route, Transport};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

struct Fixture {
    child: Child,
    route: Route,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if let Some(stdin) = self.child.stdin.as_mut() {
            let _ = stdin.write_all(b"\n");
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn rust_client_reaches_go_station_over_standard_circuit() {
    let fixture = start_fixture();
    let transport = Transport::start().expect("start Rust transport");

    let mut ping = transport
        .round_trip(
            &fixture.route,
            b"GET /ping HTTP/1.1\r\nHost: station\r\nContent-Length: 0\r\n\r\n",
        )
        .expect("round trip ping");
    assert_eq!(ping.status.as_u16(), 200);
    assert_eq!(read_body(&mut ping.body), b"pong");

    let mut wrong_route = fixture.route.clone();
    wrong_route.inner_tls_spki_sha256[0] ^= 0xff;
    assert!(transport
        .round_trip(
            &wrong_route,
            b"POST /side-effect HTTP/1.1\r\nHost: station\r\nContent-Length: 4\r\n\r\nboom",
        )
        .is_err());
    let mut count = transport
        .round_trip(
            &fixture.route,
            b"GET /side-effect-count HTTP/1.1\r\nHost: station\r\nContent-Length: 0\r\n\r\n",
        )
        .expect("read side-effect count");
    assert_eq!(read_body(&mut count.body), b"0");

    let mut events = transport
        .round_trip(
            &fixture.route,
            b"GET /events HTTP/1.1\r\nHost: station\r\nAccept: text/event-stream\r\nContent-Length: 0\r\n\r\n",
        )
        .expect("open SSE");
    assert_eq!(read_body(&mut events.body), b"data: one\n\ndata: two\n\n");

    let _blocked_event_one = transport
        .round_trip(
            &fixture.route,
            b"GET /events-blocking HTTP/1.1\r\nHost: station\r\nAccept: text/event-stream\r\nContent-Length: 0\r\n\r\n",
        )
        .expect("open first unread SSE");
    let _blocked_event_two = transport
        .round_trip(
            &fixture.route,
            b"GET /events-blocking HTTP/1.1\r\nHost: station\r\nAccept: text/event-stream\r\nContent-Length: 0\r\n\r\n",
        )
        .expect("open second unread SSE");

    let upload = vec![0x5a; 32 * 1024 * 1024];
    let request = upload_request(&upload);
    let mut response = transport
        .round_trip(&fixture.route, &request)
        .expect("upload 32 MiB");
    assert_eq!(read_body(&mut response.body), b"33554432");
    let expected = hex(Sha256::digest(&upload).as_slice());
    assert_eq!(
        response
            .headers
            .get("x-content-sha256")
            .and_then(|value| value.to_str().ok()),
        Some(expected.as_str())
    );

    let mut download = transport
        .round_trip(
            &fixture.route,
            b"GET /download HTTP/1.1\r\nHost: station\r\nContent-Length: 0\r\n\r\n",
        )
        .expect("download 1 MiB attachment chunk");
    let body = read_body(&mut download.body);
    assert_eq!(body.len(), (1 << 20) + 16);
    assert!(body
        .iter()
        .enumerate()
        .all(|(index, byte)| *byte == (index % 251) as u8));
}

fn start_fixture() -> Fixture {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .expect("repository root")
        .to_path_buf();
    let mut child = Command::new("go")
        .args(["run", "./cmd/node-connectivity-fixture"])
        .current_dir(root.join("apps/station/frame/core/plugin/native"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("start Go fixture");
    let stdout = child.stdout.take().expect("fixture stdout");
    let (sender, receiver) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut line = String::new();
        let result = BufReader::new(stdout).read_line(&mut line).map(|_| line);
        let _ = sender.send(result);
    });
    let line = receiver
        .recv_timeout(Duration::from_secs(90))
        .expect("Go fixture startup timed out")
        .expect("read Go fixture projection");
    let projection: Value = serde_json::from_str(&line).expect("decode Go fixture projection");
    let spki = decode_32(projection["spkiSha256"].as_str().expect("SPKI projection"));
    Fixture {
        child,
        route: Route {
            node_peer_id: projection["nodePeerId"]
                .as_str()
                .expect("Node PeerID projection")
                .to_string(),
            dial_multiaddr: projection["route"]
                .as_str()
                .expect("route projection")
                .to_string(),
            inner_tls_spki_sha256: spki,
        },
    }
}

fn upload_request(body: &[u8]) -> Vec<u8> {
    let mut request = format!(
        "POST /upload HTTP/1.1\r\nHost: station\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\n\r\n",
        body.len()
    )
    .into_bytes();
    request.extend_from_slice(body);
    request
}

fn read_body(reader: &mut impl Read) -> Vec<u8> {
    let mut body = Vec::new();
    reader.read_to_end(&mut body).expect("read response body");
    body
}

fn decode_32(value: &str) -> [u8; 32] {
    assert_eq!(value.len(), 64);
    let mut output = [0_u8; 32];
    for (index, byte) in output.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).expect("hex byte");
    }
    output
}

fn hex(value: &[u8]) -> String {
    value.iter().map(|byte| format!("{byte:02x}")).collect()
}
