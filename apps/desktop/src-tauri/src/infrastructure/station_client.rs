use prost::Message;
use reqwest::blocking::Client;
use reqwest::Method;

pub(crate) fn station_base_url() -> String {
    std::env::var("PT_STATION_URL")
        .or_else(|_| std::env::var("STATION_URL"))
        .unwrap_or_else(|_| "http://127.0.0.1:18080".to_string())
        .trim_end_matches('/')
        .to_string()
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

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to create HTTP client");
            format!("create http client failed: {}", e)
        })?;

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
