use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::process::Command;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedError {
    pub message: String,
    pub detail: Option<String>,
    pub action: Option<ErrorAction>,
    pub provider_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ErrorAction {
    ReauthCli {
        cli_id: String,
        label: String,
    },
    OpenProviderSettings {
        provider_id: String,
        label: String,
    },
    CheckConnection {
        label: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ProviderKind {
    Direct,
    Cli,
}

struct ResolverEntry {
    kind: ProviderKind,
    resolve: fn(&str, &str) -> Option<ResolvedError>,
}

static RESOLVERS: &[(&str, ResolverEntry)] = &[
    ("trae-cli", ResolverEntry { kind: ProviderKind::Cli, resolve: resolve_trae_cli_error }),
    ("codex-cli", ResolverEntry { kind: ProviderKind::Cli, resolve: resolve_codex_cli_error }),
    ("claude-cli", ResolverEntry { kind: ProviderKind::Cli, resolve: resolve_claude_cli_error }),
    ("openai", ResolverEntry { kind: ProviderKind::Direct, resolve: resolve_openai_error }),
    ("bytedance-ark", ResolverEntry { kind: ProviderKind::Direct, resolve: resolve_ark_error }),
    ("ark", ResolverEntry { kind: ProviderKind::Direct, resolve: resolve_ark_error }),
    ("anthropic", ResolverEntry { kind: ProviderKind::Direct, resolve: resolve_anthropic_error }),
];

static DIRECT_RESOLVERS: &[fn(&str, &str) -> Option<ResolvedError>] = &[
    resolve_generic_auth_error,
    resolve_generic_rate_limit,
];

pub fn resolve_error(provider_id: &str, raw_message: &str) -> ResolvedError {
    let provider_lower = provider_id.to_lowercase();
    let msg_lower = raw_message.to_lowercase();

    for (id, entry) in RESOLVERS {
        if provider_lower.contains(id) || msg_lower.contains(id) {
            if let Some(resolved) = (entry.resolve)(provider_id, raw_message) {
                return resolved;
            }
        }
    }

    for resolver in DIRECT_RESOLVERS {
        if let Some(resolved) = resolver(provider_id, raw_message) {
            return resolved;
        }
    }

    ResolvedError {
        message: truncate_message(raw_message, 300),
        detail: if raw_message.len() > 300 { Some(raw_message.to_string()) } else { None },
        action: None,
        provider_id: Some(provider_id.to_string()),
    }
}

static CLI_BINARY_MAP: &[(&str, &str)] = &[
    ("traecli", "trae-cli"),
    ("codex", "codex-cli"),
    ("claude", "claude-cli"),
];

pub fn resolve_cli_error(cli_command: &str, raw_message: &str) -> ResolvedError {
    let cmd_lower = cli_command.to_lowercase();
    let cmd_base = cmd_lower.split_whitespace().next().unwrap_or(&cmd_lower);
    let cmd_normalized: String = cmd_base.chars().filter(|c| c.is_alphanumeric()).collect();

    for (binary, provider_id) in CLI_BINARY_MAP {
        let binary_normalized: String = binary.chars().filter(|c| c.is_alphanumeric()).collect();
        if cmd_normalized == binary_normalized || cmd_base.contains(binary) {
            return resolve_error(provider_id, raw_message);
        }
    }

    for (id, entry) in RESOLVERS {
        if entry.kind == ProviderKind::Cli && cmd_lower.contains(id) {
            if let Some(resolved) = (entry.resolve)(id, raw_message) {
                return resolved;
            }
        }
    }
    resolve_error(cli_command, raw_message)
}

fn resolve_trae_cli_error(_provider: &str, msg: &str) -> Option<ResolvedError> {
    let lower = msg.to_lowercase();
    if lower.contains("access token has expired") || lower.contains("token expired") || lower.contains("log out and sign in") || lower.contains("not authenticated") || lower.contains("please login") || lower.contains("please sign in") || lower.contains("unauthorized") || (lower.contains("auth") && lower.contains("failed")) {
        return Some(ResolvedError {
            message: "Your Trae session has expired. Please sign in again.".to_string(),
            detail: Some(msg.to_string()),
            action: Some(ErrorAction::ReauthCli {
                cli_id: "trae-cli".to_string(),
                label: "Sign in to Trae".to_string(),
            }),
            provider_id: Some("trae-cli".to_string()),
        });
    }
    if lower.contains("rate limit") || lower.contains("too many requests") || lower.contains("429") {
        return Some(ResolvedError {
            message: "Trae is rate-limited. Wait a moment and try again.".to_string(),
            detail: Some(msg.to_string()),
            action: None,
            provider_id: Some("trae-cli".to_string()),
        });
    }
    if lower.contains("binary not found") || lower.contains("not installed") || (lower.contains("not found") && lower.contains("cli")) {
        return Some(ResolvedError {
            message: "Trae CLI is not installed on this Station. Install traecli on the Station server to use this provider.".to_string(),
            detail: Some(msg.to_string()),
            action: Some(ErrorAction::CheckConnection {
                label: "Check Station setup".to_string(),
            }),
            provider_id: Some("trae-cli".to_string()),
        });
    }
    None
}

fn resolve_codex_cli_error(_provider: &str, msg: &str) -> Option<ResolvedError> {
    let lower = msg.to_lowercase();
    if lower.contains("not authenticated") || lower.contains("login required") || lower.contains("token expired") || lower.contains("auth failed") || lower.contains("please login") || lower.contains("unauthorized") {
        return Some(ResolvedError {
            message: "Your Codex session has expired. Please sign in again.".to_string(),
            detail: Some(msg.to_string()),
            action: Some(ErrorAction::ReauthCli {
                cli_id: "codex-cli".to_string(),
                label: "Sign in to Codex".to_string(),
            }),
            provider_id: Some("codex-cli".to_string()),
        });
    }
    if lower.contains("binary not found") || lower.contains("not installed") || (lower.contains("not found") && lower.contains("cli")) {
        return Some(ResolvedError {
            message: "Codex CLI is not installed on this Station. Install codex on the Station server to use this provider.".to_string(),
            detail: Some(msg.to_string()),
            action: Some(ErrorAction::CheckConnection {
                label: "Check Station setup".to_string(),
            }),
            provider_id: Some("codex-cli".to_string()),
        });
    }
    None
}

fn resolve_claude_cli_error(_provider: &str, msg: &str) -> Option<ResolvedError> {
    let lower = msg.to_lowercase();
    if lower.contains("not authenticated") || lower.contains("api key") && (lower.contains("invalid") || lower.contains("missing") || lower.contains("expired")) || lower.contains("unauthorized") || lower.contains("login required") {
        if lower.contains("api key") {
            return Some(ResolvedError {
                message: "Your Anthropic API key is invalid or missing. Check your settings.".to_string(),
                detail: Some(msg.to_string()),
                action: Some(ErrorAction::OpenProviderSettings {
                    provider_id: "anthropic".to_string(),
                    label: "Open Settings".to_string(),
                }),
                provider_id: Some("claude-cli".to_string()),
            });
        }
        return Some(ResolvedError {
            message: "Your Claude Code session needs authentication. Please sign in.".to_string(),
            detail: Some(msg.to_string()),
            action: Some(ErrorAction::ReauthCli {
                cli_id: "claude-cli".to_string(),
                label: "Sign in to Claude".to_string(),
            }),
            provider_id: Some("claude-cli".to_string()),
        });
    }
    if lower.contains("binary not found") || lower.contains("not installed") || (lower.contains("not found") && lower.contains("cli")) {
        return Some(ResolvedError {
            message: "Claude CLI is not installed on this Station. Install claude on the Station server to use this provider.".to_string(),
            detail: Some(msg.to_string()),
            action: Some(ErrorAction::CheckConnection {
                label: "Check Station setup".to_string(),
            }),
            provider_id: Some("claude-cli".to_string()),
        });
    }
    None
}

fn resolve_openai_error(_provider: &str, msg: &str) -> Option<ResolvedError> {
    let lower = msg.to_lowercase();
    if lower.contains("invalid api key") || lower.contains("incorrect api key") || lower.contains("401") || lower.contains("unauthorized") {
        return Some(ResolvedError {
            message: "Your OpenAI API key is invalid. Check your credentials.".to_string(),
            detail: Some(msg.to_string()),
            action: Some(ErrorAction::OpenProviderSettings {
                provider_id: "openai".to_string(),
                label: "Open Settings".to_string(),
            }),
            provider_id: Some("openai".to_string()),
        });
    }
    if lower.contains("rate limit") || lower.contains("429") || lower.contains("too many requests") {
        return Some(ResolvedError {
            message: "OpenAI rate limit reached. Wait a moment and try again.".to_string(),
            detail: Some(msg.to_string()),
            action: None,
            provider_id: Some("openai".to_string()),
        });
    }
    if lower.contains("insufficient quota") || lower.contains("billing") || lower.contains("quota exceeded") {
        return Some(ResolvedError {
            message: "Your OpenAI quota has been exceeded. Check your billing.".to_string(),
            detail: Some(msg.to_string()),
            action: Some(ErrorAction::OpenProviderSettings {
                provider_id: "openai".to_string(),
                label: "Open Settings".to_string(),
            }),
            provider_id: Some("openai".to_string()),
        });
    }
    None
}

fn resolve_ark_error(_provider: &str, msg: &str) -> Option<ResolvedError> {
    let lower = msg.to_lowercase();
    if lower.contains("unauthorized") || lower.contains("401") || lower.contains("invalid api key") || lower.contains("authentication failed") || lower.contains("auth failed") || lower.contains("invalid authorization") {
        return Some(ResolvedError {
            message: "Your Ark/Seed API key is invalid. Check your credentials.".to_string(),
            detail: Some(msg.to_string()),
            action: Some(ErrorAction::OpenProviderSettings {
                provider_id: "bytedance-ark".to_string(),
                label: "Open Settings".to_string(),
            }),
            provider_id: Some("bytedance-ark".to_string()),
        });
    }
    if lower.contains("rate limit") || lower.contains("429") || lower.contains("too many requests") {
        return Some(ResolvedError {
            message: "Ark rate limit reached. Wait a moment and try again.".to_string(),
            detail: Some(msg.to_string()),
            action: None,
            provider_id: Some("bytedance-ark".to_string()),
        });
    }
    if lower.contains("no credentials") || lower.contains("no credential") || lower.contains("credential not found") || lower.contains("runtime is not ready") || lower.contains("not found for actor") || (lower.contains("provider") && lower.contains("not found")) {
        return Some(ResolvedError {
            message: "No API key configured for this provider. Add your credentials in Settings.".to_string(),
            detail: Some(msg.to_string()),
            action: Some(ErrorAction::OpenProviderSettings {
                provider_id: "bytedance-ark".to_string(),
                label: "Open Settings".to_string(),
            }),
            provider_id: Some("bytedance-ark".to_string()),
        });
    }
    None
}

fn resolve_anthropic_error(_provider: &str, msg: &str) -> Option<ResolvedError> {
    let lower = msg.to_lowercase();
    if lower.contains("invalid api key") || lower.contains("401") || lower.contains("unauthorized") || lower.contains("authentication_error") {
        return Some(ResolvedError {
            message: "Your Anthropic API key is invalid. Check your credentials.".to_string(),
            detail: Some(msg.to_string()),
            action: Some(ErrorAction::OpenProviderSettings {
                provider_id: "anthropic".to_string(),
                label: "Open Settings".to_string(),
            }),
            provider_id: Some("anthropic".to_string()),
        });
    }
    if lower.contains("rate limit") || lower.contains("429") || lower.contains("too many requests") {
        return Some(ResolvedError {
            message: "Anthropic rate limit reached. Wait a moment and try again.".to_string(),
            detail: Some(msg.to_string()),
            action: None,
            provider_id: Some("anthropic".to_string()),
        });
    }
    None
}

fn resolve_generic_auth_error(_provider: &str, msg: &str) -> Option<ResolvedError> {
    let lower = msg.to_lowercase();
    if (lower.contains("no credentials") || lower.contains("no credential") || lower.contains("credential not found") || lower.contains("runtime is not ready") || lower.contains("not found for actor") || (lower.contains("provider") && lower.contains("not found"))) && !lower.contains("trae") && !lower.contains("codex") && !lower.contains("claude") && !lower.contains("binary not found") {
        return Some(ResolvedError {
            message: "No credentials configured for this provider. Add your API key in Settings.".to_string(),
            detail: Some(msg.to_string()),
            action: Some(ErrorAction::OpenProviderSettings {
                provider_id: _provider.to_string(),
                label: "Open Settings".to_string(),
            }),
            provider_id: Some(_provider.to_string()),
        });
    }
    if lower.contains("invalid api key") || lower.contains("incorrect api key") || (lower.contains("401") && !lower.contains("http")) {
        return Some(ResolvedError {
            message: "The API key is invalid. Check your credentials in Settings.".to_string(),
            detail: Some(msg.to_string()),
            action: Some(ErrorAction::OpenProviderSettings {
                provider_id: _provider.to_string(),
                label: "Open Settings".to_string(),
            }),
            provider_id: Some(_provider.to_string()),
        });
    }
    if lower.contains("cli provider execution failed") && (lower.contains("binary not found") || lower.contains("not installed")) {
        let cli_name = msg.split("binary not found:").nth(1)
            .and_then(|s| s.split_whitespace().next())
            .unwrap_or("the CLI tool");
        return Some(ResolvedError {
            message: format!("{} is not installed on this Station. Install it on the Station server to use this provider.", cli_name),
            detail: Some(msg.to_string()),
            action: Some(ErrorAction::CheckConnection {
                label: "Check Station setup".to_string(),
            }),
            provider_id: None,
        });
    }
    None
}

fn resolve_generic_rate_limit(_provider: &str, msg: &str) -> Option<ResolvedError> {
    let lower = msg.to_lowercase();
    if lower.contains("rate limit") || lower.contains("429") || lower.contains("too many requests") {
        return Some(ResolvedError {
            message: "Rate limit reached. Wait a moment and try again.".to_string(),
            detail: Some(msg.to_string()),
            action: None,
            provider_id: Some(_provider.to_string()),
        });
    }
    None
}

fn truncate_message(msg: &str, max: usize) -> String {
    if msg.len() <= max {
        msg.to_string()
    } else {
        format!("{}...", &msg[..max])
    }
}

#[tauri::command]
pub async fn resolve_error_action(app: tauri::AppHandle, action: Value) -> Result<Value, String> {
    let action: ErrorAction = serde_json::from_value(action).map_err(|e| format!("invalid action: {e}"))?;
    match action {
        ErrorAction::ReauthCli { cli_id, .. } => {
            let binary = match cli_id.as_str() {
                "trae-cli" => "traecli",
                "codex-cli" => "codex",
                "claude-cli" => "claude",
                other => return Err(format!("unknown CLI: {other}")),
            };
            let path = crate::application::provider::enriched_path();
            let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());

            let script = format!(
                "tell application \"Terminal\" to do script \"export PATH={}; export HOME={}; {} login; echo; echo 'Press Enter or close this window when done.'; read\"",
                escape_applescript(&path),
                escape_applescript(&home),
                binary
            );

            match Command::new("osascript")
                .arg("-e")
                .arg(&script)
                .status()
            {
                Ok(status) if status.success() => Ok(json!({
                    "ok": true,
                    "reauth": true,
                    "message": "Authentication window opened in Terminal. Complete sign-in there, then retry."
                })),
                Ok(_) => {
                    let _ = Command::new("open")
                        .arg("-a")
                        .arg("Terminal")
                        .status();
                    Ok(json!({
                        "ok": true,
                        "reauth": true,
                        "message": "Terminal opened. Run: ".to_string() + binary + " login"
                    }))
                }
                Err(e) => Err(format!("failed to open Terminal for {binary} login: {e}")),
            }
        }
        ErrorAction::OpenProviderSettings { provider_id, .. } => {
            let _ = app.emit("provider:open-settings", json!({ "providerId": provider_id }));
            Ok(json!({ "ok": true, "opened": true }))
        }
        ErrorAction::CheckConnection { .. } => {
            Ok(json!({ "ok": true }))
        }
    }
}

fn escape_applescript(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

pub fn wrap_stream_error(provider_id: &str, provider_kind: ProviderKind, raw_error: &str, cli_command: Option<&str>) -> Value {
    let resolved = match provider_kind {
        ProviderKind::Cli => {
            if let Some(cmd) = cli_command {
                resolve_cli_error(cmd, raw_error)
            } else {
                resolve_error(provider_id, raw_error)
            }
        }
        ProviderKind::Direct => resolve_error(provider_id, raw_error),
    };
    json!({
        "type": "error",
        "error": resolved.message,
        "detail": resolved.detail,
        "resolution": resolved.action,
        "providerId": resolved.provider_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trae_cli_token_expired() {
        let resolved = resolve_cli_error("traecli", "Your Trae access token has expired and cannot be refreshed. Please log out and sign in again.");
        assert_eq!(resolved.message, "Your Trae session has expired. Please sign in again.");
        assert!(matches!(resolved.action, Some(ErrorAction::ReauthCli { cli_id: ref id, .. }) if id == "trae-cli"));
    }

    #[test]
    fn test_codex_cli_auth_error() {
        let resolved = resolve_cli_error("codex", "Error: not authenticated");
        assert!(resolved.message.contains("Codex session"));
        assert!(matches!(resolved.action, Some(ErrorAction::ReauthCli { .. })));
    }

    #[test]
    fn test_openai_invalid_key() {
        let resolved = resolve_error("openai", "Invalid API key provided");
        assert!(resolved.message.contains("API key is invalid"));
        assert!(matches!(resolved.action, Some(ErrorAction::OpenProviderSettings { .. })));
    }

    #[test]
    fn test_ark_no_credentials() {
        let resolved = resolve_error("bytedance-ark", "no credentials registered for provider");
        assert!(resolved.message.contains("No API key configured"));
        assert!(matches!(resolved.action, Some(ErrorAction::OpenProviderSettings { .. })));
    }

    #[test]
    fn test_runtime_not_ready_generic() {
        let resolved = resolve_error("bytedance-ark", "The selected runtime is not ready. Check model credentials and try again.");
        assert!(resolved.message.contains("No API key configured") || resolved.message.contains("credential"));
    }

    #[test]
    fn test_rate_limit_openai() {
        let resolved = resolve_error("openai", "Rate limit exceeded. Please retry after 20s.");
        assert!(resolved.message.contains("rate limit") || resolved.message.contains("Rate limit"));
        assert!(resolved.action.is_none());
    }

    #[test]
    fn test_wrap_stream_error_structure() {
        let wrapped = wrap_stream_error("trae-cli", ProviderKind::Cli, "token expired", Some("traecli"));
        assert_eq!(wrapped["type"], "error");
        assert!(wrapped["error"].as_str().unwrap().len() > 0);
        assert!(wrapped["resolution"].is_object());
    }

    #[test]
    fn test_unknown_error_falls_through() {
        let resolved = resolve_error("unknown-provider", "Something weird happened with code XYZ");
        assert_eq!(resolved.message, "Something weird happened with code XYZ");
        assert!(resolved.action.is_none());
    }

    #[test]
    fn test_ark_provider_not_found() {
        let resolved = resolve_error("ark", r#"{"code":400,"error":"[AGENT_5005] provider \"ark\" not found for actor: record not found"}"#);
        assert!(resolved.message.contains("No API key configured") || resolved.message.contains("credentials"), "message was: {}", resolved.message);
        assert!(matches!(resolved.action, Some(ErrorAction::OpenProviderSettings { .. })), "action was: {:?}", resolved.action);
    }

    #[test]
    fn test_trae_cli_binary_not_found() {
        let resolved = resolve_cli_error("traecli exec -", r#"{"code":502,"error":"[AGENT_5001] CLI provider execution failed: cli binary not found: traecli (install it on this Station)"}"#);
        assert!(resolved.message.contains("not installed") || resolved.message.contains("Trae CLI"), "message was: {}", resolved.message);
        assert!(resolved.action.is_some(), "should have action");
    }

    #[test]
    fn test_generic_cli_binary_not_found() {
        let resolved = resolve_error("unknown-cli", r#"{"code":502,"error":"[AGENT_5001] CLI provider execution failed: cli binary not found: traecli (install it on this Station)"}"#);
        assert!(resolved.message.contains("traecli") && resolved.message.contains("not installed"), "message was: {}", resolved.message);
    }
}
