use serde_json::Value;
use sha2::{Digest, Sha256};
use station_libp2p_http::{Request, RequestBody, Route, TrafficClass, TransportOwner};
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
    let transport = TransportOwner::start().expect("start Rust transport");
    let handle = transport.handle();

    let mut ping = handle
        .round_trip(&fixture.route, request(http::Method::GET, "/ping"))
        .expect("round trip ping");
    assert_eq!(ping.status.as_u16(), 200);
    assert_eq!(read_body(&mut ping.body), b"pong");

    let mut wrong_route = fixture.route.clone();
    wrong_route.inner_tls_spki_sha256[0] ^= 0xff;
    assert!(handle
        .round_trip(
            &wrong_route,
            request_with_body(http::Method::POST, "/side-effect", b"boom".to_vec()),
        )
        .is_err());
    let mut count = handle
        .round_trip(
            &fixture.route,
            request(http::Method::GET, "/side-effect-count"),
        )
        .expect("read side-effect count");
    assert_eq!(read_body(&mut count.body), b"0");

    let mut events_request = request(http::Method::GET, "/events");
    events_request.traffic_class = TrafficClass::Realtime;
    events_request.headers.insert(
        http::header::ACCEPT,
        http::HeaderValue::from_static("text/event-stream"),
    );
    let mut events = handle
        .round_trip(&fixture.route, events_request)
        .expect("open SSE");
    assert_eq!(read_body(&mut events.body), b"data: one\n\ndata: two\n\n");

    let mut blocked_request_one = request(http::Method::GET, "/events-blocking");
    blocked_request_one.traffic_class = TrafficClass::Realtime;
    let _blocked_event_one = handle
        .round_trip(&fixture.route, blocked_request_one)
        .expect("open first unread SSE");
    let mut blocked_request_two = request(http::Method::GET, "/events-blocking");
    blocked_request_two.traffic_class = TrafficClass::Realtime;
    let _blocked_event_two = handle
        .round_trip(&fixture.route, blocked_request_two)
        .expect("open second unread SSE");

    let upload = vec![0x5a; 32 * 1024 * 1024];
    let mut upload_request = request_with_body(http::Method::POST, "/upload", upload.clone());
    upload_request.traffic_class = TrafficClass::Bulk;
    upload_request.headers.insert(
        http::header::CONTENT_TYPE,
        http::HeaderValue::from_static("application/octet-stream"),
    );
    let mut response = handle
        .round_trip(&fixture.route, upload_request)
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

    let mut download_request = request(http::Method::GET, "/download");
    download_request.traffic_class = TrafficClass::Bulk;
    let mut download = handle
        .round_trip(&fixture.route, download_request)
        .expect("download 1 MiB attachment chunk");
    let body = read_body(&mut download.body);
    assert_eq!(body.len(), (1 << 20) + 16);
    assert!(body
        .iter()
        .enumerate()
        .all(|(index, byte)| *byte == (index % 251) as u8));

    drop(_blocked_event_one);
    drop(_blocked_event_two);
    transport
        .shutdown(Duration::from_secs(5))
        .expect("join Rust transport");
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
            route_generation: 1,
        },
    }
}

fn request(method: http::Method, path: &str) -> Request {
    let mut request = Request::new(method, path.parse().expect("request URI"));
    request.timeout = Duration::from_secs(30);
    request
}

fn request_with_body(method: http::Method, path: &str, body: Vec<u8>) -> Request {
    let mut request = request(method, path);
    request.body = RequestBody::Bytes(body);
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
