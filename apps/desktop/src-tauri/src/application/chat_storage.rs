use crate::infrastructure::local_chat_store::{self, LocalChatRecord};
use crate::model::chat;

pub fn ingest_friend_messages_proto(user_scope: &str, messages: &[chat::FriendChatMessage]) -> Result<(), String> {
    local_chat_store::ingest_friend_messages_proto(user_scope, messages)
}

pub fn ingest_group_messages_proto(user_scope: &str, messages: &[chat::GroupMessage]) -> Result<(), String> {
    local_chat_store::ingest_group_messages_proto(user_scope, messages)
}

pub fn search_friend_messages(user_scope: &str, query: &str, limit: usize) -> Result<Vec<LocalChatRecord>, String> {
    local_chat_store::search_local(user_scope, "friend", query, limit)
}

pub fn search_group_messages(user_scope: &str, query: &str, limit: usize) -> Result<Vec<LocalChatRecord>, String> {
    local_chat_store::search_local(user_scope, "group", query, limit)
}

pub fn set_scope_cursor(user_scope: &str, scope: &str, cursor: &str) -> Result<(), String> {
    local_chat_store::set_sync_cursor(user_scope, scope, cursor)
}

pub fn get_scope_cursor(user_scope: &str, scope: &str) -> Result<Option<String>, String> {
    local_chat_store::get_sync_cursor(user_scope, scope)
}

pub fn get_chat_key_version(user_scope: &str) -> Result<Option<i32>, String> {
    local_chat_store::get_chat_key_version(user_scope)
}

pub fn rotate_chat_key(user_scope: &str, next_version: i32) -> Result<i32, String> {
    local_chat_store::rotate_chat_key(user_scope, next_version)
}
