use serde::Deserialize;
use serde_json::json;

use crate::application::native_surface::{self, NativeNotificationRoute};
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};

const MAX_TITLE_CHARS: usize = 200;
const MAX_BODY_CHARS: usize = 1_000;
const MAX_ID_CHARS: usize = 128;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockBadgeInput {
    /// Number of conversations with unread messages (BOT-D13). Deliberately a
    /// conversation count rather than a raw message count.
    unread_conversation_count: Option<i64>,
}

/// Set the native dock / taskbar badge to the unread-conversation count.
#[tauri::command]
pub fn native_dock_set_badge(input: DockBadgeInput) -> AppResult<StubPayload> {
    let count = input.unread_conversation_count.unwrap_or(0).max(0) as u64;
    native_surface::set_dock_badge(count);
    AppResult::success(StubPayload {
        command: "native_dock_set_badge".to_string(),
        status: json!({ "applied": true, "unreadConversationCount": count }).to_string(),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeNotificationInput {
    /// Stable per-event id; reusing it replaces the prior notification.
    notification_id: String,
    title: String,
    body: String,
    /// Conversation ULID to open on tap.
    session_ulid: Option<String>,
    /// In-app navigation target, restricted to the `chat/` route family.
    target: Option<String>,
    /// Notification-center thread identifier for grouping / collapse.
    group_key: Option<String>,
    play_sound: Option<bool>,
}

/// Show one native user notification after the UI has already applied focus /
/// mute / collapse gating. Tapping it emits a `desktop:notification-tap`.
#[tauri::command]
pub fn native_notification_show(input: NativeNotificationInput) -> AppResult<StubPayload> {
    let notification_id = input.notification_id.trim();
    let title = input.title.trim();
    if notification_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "notification id is required",
            None,
        );
    }
    if notification_id.chars().count() > MAX_ID_CHARS {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "notification id exceeds length limit",
            None,
        );
    }
    if title.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "notification title is required",
            None,
        );
    }
    if let Some(target) = input.target.as_deref() {
        if !is_safe_in_app_target(target) {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "notification target must be an in-app chat route",
                Some(json!({ "target": target })),
            );
        }
    }

    let route = NativeNotificationRoute {
        notification_id: notification_id.to_string(),
        title: truncate_chars(title, MAX_TITLE_CHARS).to_string(),
        body: truncate_chars(input.body.trim(), MAX_BODY_CHARS).to_string(),
        session_ulid: clean_optional(input.session_ulid),
        target: clean_optional(input.target),
        group_key: clean_optional(input.group_key),
        play_sound: input.play_sound.unwrap_or(false),
    };

    if let Err(error) = native_surface::post_notification(route) {
        tracing::warn!(error = %error, "native notification delivery unavailable");
        return AppResult::fail(
            ErrorCode::InternalError,
            "native notification delivery is unavailable",
            Some(json!({ "error": error })),
        );
    }

    AppResult::success(StubPayload {
        command: "native_notification_show".to_string(),
        status: json!({ "scheduled": true, "notificationId": notification_id }).to_string(),
    })
}

/// Restrict deep-link targets to the in-app conversation family so a
/// notification can never launch an external scheme (BOT-A34).
///
/// Conversation ids are single route segments carrying an optional kind
/// prefix (`direct-<hex>` for one-to-one, `group-<hex>` for groups, or a bare
/// Crockford/ULID token), so only ASCII alphanumerics, `-`, and `_` are
/// admitted. This still rejects schemes (`:`), path traversal (`.`/`/`),
/// queries (`?`/`#`), spaces, and control bytes.
fn is_safe_in_app_target(target: &str) -> bool {
    let Some(rest) = target.strip_prefix("chat/") else {
        return false;
    };
    let len = rest.len();
    (1..=64).contains(&len)
        && rest
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

fn truncate_chars(value: &str, max_chars: usize) -> &str {
    match value.char_indices().nth(max_chars) {
        Some((index, _)) => &value[..index],
        None => value,
    }
}

#[cfg(test)]
mod tests {
    use super::is_safe_in_app_target;

    #[test]
    fn accepts_in_app_chat_route() {
        assert!(is_safe_in_app_target("chat/01J61Z9Q0G8T9M0E9Y4W5KDP7H"));
    }

    #[test]
    fn accepts_prefixed_conversation_routes() {
        // One-to-one conversation id produced for a bot DM.
        assert!(is_safe_in_app_target(
            "chat/direct-2b9a05a818bba583907a0d0d6566956e"
        ));
        // Group conversation id.
        assert!(is_safe_in_app_target(
            "chat/group-01J61Z9Q0G8T9M0E9Y4W5KDP7H"
        ));
        assert!(is_safe_in_app_target("chat/legacy_1"));
    }

    #[test]
    fn rejects_external_schemes_and_malformed_routes() {
        assert!(!is_safe_in_app_target("https://evil.example/x"));
        assert!(!is_safe_in_app_target("javascript:alert(1)"));
        assert!(!is_safe_in_app_target("peers-touch://x"));
        assert!(!is_safe_in_app_target("chat/../secret"));
        assert!(!is_safe_in_app_target("chat/a/b"));
        assert!(!is_safe_in_app_target("chat/a:b"));
        assert!(!is_safe_in_app_target("chat/a.b"));
        assert!(!is_safe_in_app_target("chat/a?x=1"));
        assert!(!is_safe_in_app_target("chat/"));
        assert!(!is_safe_in_app_target("other/abc"));
    }
}
