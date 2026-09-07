use std::path::PathBuf;

fn main() {
    let proto_root = PathBuf::from("../../model");
    if !proto_root.join("domain/chat").exists() {
        return;
    }

    let proto_files: Vec<PathBuf> = [
        "domain/actor/actor.proto",
        "domain/chat/announcement.proto",
        "domain/chat/attachment.proto",
        "domain/chat/chat.proto",
        "domain/chat/command.proto",
        "domain/chat/conversation.proto",
        "domain/chat/conversation_api.proto",
        "domain/chat/direct_crypto.proto",
        "domain/chat/endpoint.proto",
        "domain/chat/event.proto",
        "domain/chat/federation.proto",
        "domain/chat/friend_chat.proto",
        "domain/chat/group_chat.proto",
        "domain/chat/group_mls.proto",
        "domain/chat/queue.proto",
        "domain/chat/receipt.proto",
        "domain/chat/sticker.proto",
        "domain/common/common.proto",
        "domain/federation/delivery.proto",
        "domain/key_exchange/key_exchange.proto",
        "domain/recovery/recovery.proto",
        "domain/social/relationship.proto",
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
        .expect("Failed to compile messaging-core proto files");
}
