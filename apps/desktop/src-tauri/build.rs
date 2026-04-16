use std::path::PathBuf;

fn main() {
    tauri_build::build();
    compile_protos();
}

/// Compile proto definitions used by the Desktop BFF layer.
/// Only packages actively consumed by Tauri commands / gateway are compiled
/// here; the remaining pre-generated model files stay as-is until the full
/// proto source tree is cleaned up (see social.proto duplicates).
fn compile_protos() {
    let proto_root = PathBuf::from("../../../model");
    if !proto_root.join("domain").exists() {
        return;
    }

    let proto_files: Vec<PathBuf> = [
        "domain/chat/chat.proto",
        "domain/chat/friend_chat.proto",
        "domain/chat/group_chat.proto",
        "domain/chat/announcement.proto",
        "domain/chat/sticker.proto",
        "domain/notification/notification.proto",
        "domain/actor/actor.proto",
        "domain/actor/actor_signup.proto",
        "domain/actor/actor_status.proto",
        "domain/actor/session.proto",
        "domain/actor/session_api.proto",
        "domain/actor/preferences.proto",
        "domain/auth/auth.proto",
        "domain/common/common.proto",
        "domain/core/core.proto",
        "domain/error/error.proto",
        "domain/events/events.proto",
        "domain/peer/peer.proto",
        "domain/oss/oss.proto",
        "domain/oauth/oauth.proto",
        "domain/manage/health.proto",
        "domain/applet/applet.proto",
        "domain/launcher/launcher.proto",
        "domain/message/conversation.proto",
        "domain/activity/activity.proto",
        "domain/activitypub/activitypub_api.proto",
        "domain/mastodon/account.proto",
        "domain/mastodon/app.proto",
        "domain/mastodon/notification.proto",
        "domain/mastodon/status.proto",
        "domain/ai_chat/chat.proto",
        "domain/ai_chat/provider.proto",
        "domain/ai_chat/ai_models.proto",
        "domain/ai_chat/session_messages.proto",
        "domain/ai_chat/message_messages.proto",
        "domain/ai_chat/access_control.proto",
        "domain/social/post.proto",
        "domain/social/comment.proto",
        "domain/social/media.proto",
        "domain/social/poll.proto",
        "domain/social/relationship.proto",
        "domain/agent/agent.proto",
        "domain/agent/skill.proto",
        "domain/agent/memory.proto",
        "domain/key_exchange/key_exchange.proto",
    ]
    .iter()
    .map(|p| proto_root.join(p))
    .filter(|p| p.exists())
    .collect();

    if proto_files.is_empty() {
        return;
    }

    for pf in &proto_files {
        println!("cargo:rerun-if-changed={}", pf.display());
    }

    prost_build::Config::new()
        .compile_protos(&proto_files, &[&proto_root])
        .expect("Failed to compile proto files");
}
