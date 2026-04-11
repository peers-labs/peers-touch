use prost::Message;
use reqwest::blocking::Client;
use reqwest::Method;
use serde_json::Value;

pub(crate) fn station_base_url() -> String {
    std::env::var("PT_STATION_URL")
        .or_else(|_| std::env::var("STATION_URL"))
        .unwrap_or_else(|_| "http://127.0.0.1:18080".to_string())
        .trim_end_matches('/')
        .to_string()
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to create HTTP client");
            format!("create http client failed: {}", e)
        })
}

// JSON POST without auth — used for login where no token exists yet.
pub(crate) fn post_json_no_auth(
    path: &str,
    body: Value,
) -> Result<Value, String> {
    let url = format!("{}{}", station_base_url(), path);
    tracing::info!(path = %path, "→ station (json, no-auth)");

    let start = std::time::Instant::now();
    let client = build_client()?;

    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .map_err(|e| {
            let elapsed = start.elapsed().as_millis();
            tracing::error!(path = %path, elapsed_ms = elapsed, error = %e, "← station NETWORK_ERROR");
            format!("request failed: {}", e)
        })?;

    let status = resp.status();
    let elapsed = start.elapsed().as_millis();

    let result: Value = resp.json().map_err(|e| {
        tracing::error!(path = %path, error = %e, "← station JSON_ERROR");
        format!("decode json response failed: {}", e)
    })?;

    if !status.is_success() {
        let msg = result.get("message")
            .or_else(|| result.get("msg"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        tracing::warn!(path = %path, status = status.as_u16(), elapsed_ms = elapsed, "← station FAIL");
        return Err(format!("station returned {}: {}", status.as_u16(), msg));
    }

    tracing::info!(path = %path, status = status.as_u16(), elapsed_ms = elapsed, "← station OK (json, no-auth)");
    Ok(result)
}

// JSON-based request for chat APIs (friend_chat, group_chat).
// Sends/receives JSON with Content-Type: application/json.
pub(crate) fn request_json(
    method: Method,
    path: &str,
    token: &str,
    query: Option<&[(&str, String)]>,
    body: Option<Value>,
) -> Result<Value, String> {
    let url = format!("{}{}", station_base_url(), path);
    tracing::info!(method = %method, path = %path, "→ station (json)");

    let start = std::time::Instant::now();
    let client = build_client()?;

    let mut req = client.request(method.clone(), &url).bearer_auth(token);

    if let Some(q) = query {
        req = req.query(q);
    }

    if let Some(b) = body {
        req = req
            .header("Content-Type", "application/json")
            .json(&b);
    } else {
        req = req.header("Content-Type", "application/json");
    }

    req = req.header("Accept", "application/json");

    let resp = req.send().map_err(|e| {
        let elapsed = start.elapsed().as_millis();
        tracing::error!(path = %path, elapsed_ms = elapsed, error = %e, "← station NETWORK_ERROR");
        format!("request failed: {}", e)
    })?;

    let status = resp.status();
    let elapsed = start.elapsed().as_millis();

    if !status.is_success() {
        let code = status.as_u16();
        let text = resp.text().unwrap_or_default();
        tracing::warn!(path = %path, status = code, elapsed_ms = elapsed, body = %text, "← station FAIL");
        return Err(format!("station returned {} : {}", code, text));
    }

    let result: Value = resp.json().map_err(|e| {
        tracing::error!(path = %path, error = %e, "← station JSON_ERROR");
        format!("decode json response failed: {}", e)
    })?;

    tracing::info!(path = %path, status = status.as_u16(), elapsed_ms = elapsed, "← station OK (json)");
    Ok(result)
}

pub(crate) fn request_proto<Req, Resp>(
    method: Method,
    path: &str,
    token: &str,
    query: Option<&[(&str, String)]>,
    body: Option<&Req>,
) -> Result<Resp, String>
where
    Req: Message,
    Resp: Message + Default,
{
    let url = format!("{}{}", station_base_url(), path);
    let body_len = body.map(|b| b.encoded_len()).unwrap_or(0);
    tracing::info!(
        method = %method,
        path = %path,
        body_bytes = body_len,
        "→ station"
    );

    let start = std::time::Instant::now();
    let client = build_client()?;

    let mut req = client
        .request(method.clone(), &url)
        .bearer_auth(token);

    if let Some(q) = query {
        req = req.query(q);
    }

    if let Some(b) = body {
        let buf = b.encode_to_vec();
        req = req
            .header("Content-Type", "application/protobuf")
            .body(buf);
    } else {
        req = req.header("Content-Type", "application/protobuf");
    }

    req = req.header("Accept", "application/protobuf");

    let resp = req.send().map_err(|e| {
        let elapsed = start.elapsed().as_millis();
        tracing::error!(path = %path, elapsed_ms = elapsed, error = %e, "← station NETWORK_ERROR");
        format!("request failed: {}", e)
    })?;

    let status = resp.status();
    let elapsed = start.elapsed().as_millis();

    if !status.is_success() {
        let code = status.as_u16();
        let text = resp.text().unwrap_or_default();
        tracing::warn!(path = %path, status = code, elapsed_ms = elapsed, body = %text, "← station FAIL");
        return Err(format!("station returned {} : {}", code, text));
    }

    let bytes = resp.bytes().map_err(|e| {
        tracing::error!(path = %path, error = %e, "← station DECODE_ERROR");
        format!("read body failed: {}", e)
    })?;

    let resp_len = bytes.len();
    let result = Resp::decode(bytes.as_ref()).map_err(|e| {
        tracing::error!(path = %path, error = %e, "← station PROTO_ERROR");
        format!("decode proto response failed: {}", e)
    })?;

    tracing::info!(
        path = %path,
        status = status.as_u16(),
        elapsed_ms = elapsed,
        resp_bytes = resp_len,
        "← station OK"
    );

    Ok(result)
}

/// Upload a local file to Station OSS via multipart/form-data POST.
pub(crate) fn upload_multipart(
    path: &str,
    token: &str,
    file_path: &str,
) -> Result<serde_json::Value, String> {
    let url = format!("{}{}", station_base_url(), path);
    tracing::info!(path = %path, file = %file_path, "→ station (multipart upload)");

    let start = std::time::Instant::now();
    let client = build_client()?;

    let form = reqwest::blocking::multipart::Form::new()
        .file("file", file_path)
        .map_err(|e| format!("failed to open file for upload: {}", e))?;

    let resp = client
        .post(&url)
        .bearer_auth(token)
        .multipart(form)
        .send()
        .map_err(|e| {
            let elapsed = start.elapsed().as_millis();
            tracing::error!(path = %path, elapsed_ms = elapsed, error = %e, "← station NETWORK_ERROR (multipart)");
            format!("upload request failed: {}", e)
        })?;

    let status = resp.status();
    let elapsed = start.elapsed().as_millis();

    let result: serde_json::Value = resp.json().map_err(|e| {
        tracing::error!(path = %path, error = %e, "← station JSON_ERROR (multipart)");
        format!("decode json response failed: {}", e)
    })?;

    if !status.is_success() {
        let msg = result.get("error").and_then(|v| v.as_str()).unwrap_or("unknown error");
        tracing::warn!(path = %path, status = status.as_u16(), elapsed_ms = elapsed, "← station FAIL (multipart)");
        return Err(format!("station returned {}: {}", status.as_u16(), msg));
    }

    tracing::info!(path = %path, status = status.as_u16(), elapsed_ms = elapsed, "← station OK (multipart)");
    Ok(result)
}
