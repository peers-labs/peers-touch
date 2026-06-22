pub mod streaming;

use crate::application::provider::{remote as provider_remote, state as provider_state};
use crate::contracts::{
    ChatCompletionInput, ChatConversationInput, ChatListMessagesInput, ChatMarkReadInput,
    ChatMessageInput, ChatRenameConversationInput, ChatSendMessageInput,
    ChatSetConversationModelInput, ChatUpdateMessageInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use crate::domain::chat::{self, Conversation, DeliveryVia, Message};
use crate::infrastructure::actor_bucket::actor_bucket_id;
use crate::infrastructure::realtime;

#[derive(Default)]
struct ChatStore {
    conversations: HashMap<String, Conversation>,
    messages: HashMap<String, Vec<Message>>,
}

impl ChatStore {
    fn seeded() -> Self {
        let mut store = Self::default();
        let conversation_id = "general".to_string();
        let first_message_id = chat::next_message_id(Some("bootstrap-1"));
        let timestamp = chat::now_ms();
        store.messages.insert(
            conversation_id.clone(),
            vec![Message {
                id: first_message_id.clone(),
                conversation_id: conversation_id.clone(),
                content: "welcome".to_string(),
                role: "system".to_string(),
                read: false,
                via: DeliveryVia::Relay,
                retry_count: 0,
                timestamp_ms: timestamp,
            }],
        );
        store.conversations.insert(
            conversation_id.clone(),
            Conversation {
                id: conversation_id,
                agent_id: "assistant".to_string(),
                title: "i18n:chat.conversation.general".to_string(),
                model: None,
                unread_count: 1,
                last_message_id: Some(first_message_id),
                last_timestamp_ms: timestamp,
            },
        );
        store
    }

    fn ensure_conversation(
        &mut self,
        conversation_id: &str,
        agent_id: &str,
        timestamp_ms: u128,
    ) -> &mut Conversation {
        self.messages
            .entry(conversation_id.to_string())
            .or_default();
        self.conversations
            .entry(conversation_id.to_string())
            .or_insert_with(|| Conversation {
                id: conversation_id.to_string(),
                agent_id: agent_id.to_string(),
                title: "i18n:chat.conversation.new".to_string(),
                model: None,
                unread_count: 0,
                last_message_id: None,
                last_timestamp_ms: timestamp_ms,
            })
    }
}

struct ChatStores {
    buckets: HashMap<String, ChatStore>,
}

static CHAT_STORES: OnceLock<Mutex<ChatStores>> = OnceLock::new();

fn chat_stores() -> &'static Mutex<ChatStores> {
    CHAT_STORES.get_or_init(|| {
        Mutex::new(ChatStores {
            buckets: HashMap::new(),
        })
    })
}

fn with_chat_app_result<F>(actor_id: &str, f: F) -> AppResult<StubPayload>
where
    F: FnOnce(&mut ChatStore) -> AppResult<StubPayload>,
{
    let key = actor_bucket_id(actor_id);
    let mut stores = match chat_stores().lock() {
        Ok(g) => g,
        Err(e) => {
            tracing::error!(error = %e, "Failed to acquire chat store lock");
            return internal_error(&format!("Failed to access chat store: {}", e));
        }
    };
    let store = stores.buckets.entry(key).or_insert_with(ChatStore::seeded);
    f(store)
}

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    let status = serde_json::to_string(&data).unwrap_or_else(|_| "{\"status\":\"ok\"}".to_string());
    AppResult::success(StubPayload {
        command: command.to_string(),
        status,
    })
}

fn invalid_argument(message: String) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InvalidArgument, message, None)
}

fn internal_error(message: &str) -> AppResult<StubPayload> {
    tracing::error!(error = message, "Internal error");
    AppResult::fail(ErrorCode::InternalError, message, None)
}

pub fn chat_list_conversations(actor_id: &str) -> AppResult<StubPayload> {
    tracing::info!(command = "chat_list_conversations", "Listing conversations");
    with_chat_app_result(actor_id, |store| {
        let mut conversations: Vec<_> = store.conversations.values().cloned().collect();
        conversations.sort_by(|a, b| b.last_timestamp_ms.cmp(&a.last_timestamp_ms));
        let data = conversations
            .into_iter()
            .map(|conversation| {
                json!({
                    "id": conversation.id,
                    "title": conversation.title,
                    "modelName": conversation.model,
                    "unreadCount": conversation.unread_count,
                    "messageCount": store.messages.get(&conversation.id).map(|list| list.len()).unwrap_or(0),
                    "lastMessageId": conversation.last_message_id,
                    "lastTimestampMs": conversation.last_timestamp_ms
                })
            })
            .collect::<Vec<_>>();
        tracing::info!(
            command = "chat_list_conversations",
            count = data.len(),
            "Conversations listed"
        );
        realtime::publish_chat_event("chat_list_conversations", "all", None);
        success_payload(
            "chat_list_conversations",
            json!({
                "conversations": data
            }),
        )
    })
}

pub fn chat_list_messages(actor_id: &str, input: ChatListMessagesInput) -> AppResult<StubPayload> {
    tracing::info!(command = "chat_list_messages", conversation_id = %input.conversation_id, "Listing messages");
    let conversation_id = match chat::normalize_conversation_id(&input.conversation_id) {
        Ok(value) => value,
        Err(message) => return invalid_argument(message),
    };
    let limit = chat::resolve_limit(input.limit);
    let cursor = chat::parse_cursor(input.cursor.as_deref());

    let agent_id = chat::extract_agent_id(&conversation_id);
    with_chat_app_result(actor_id, |store| {
        let now = chat::now_ms();
        store.ensure_conversation(&conversation_id, &agent_id, now);
        let messages = store
            .messages
            .get(&conversation_id)
            .cloned()
            .unwrap_or_default();
        let start_index = cursor
            .as_ref()
            .and_then(|cursor_id| {
                messages
                    .iter()
                    .position(|message| message.id == cursor_id.as_str())
            })
            .map(|index| index.saturating_add(1))
            .unwrap_or(0);
        let page = messages
            .iter()
            .skip(start_index)
            .take(limit)
            .map(|message| {
                let via = match message.via {
                    DeliveryVia::P2p => "p2p",
                    DeliveryVia::Relay => "relay",
                };
                json!({
                    "id": message.id,
                    "role": message.role,
                    "conversationId": message.conversation_id,
                    "content": message.content,
                    "read": message.read,
                    "modelName": store
                        .conversations
                        .get(&conversation_id)
                        .and_then(|conversation| conversation.model.clone())
                        .unwrap_or_default(),
                    "via": via,
                    "retryCount": message.retry_count,
                    "createdAt": message.timestamp_ms
                })
            })
            .collect::<Vec<_>>();
        let next_cursor = page
            .last()
            .and_then(|item| item.get("id"))
            .and_then(|item| item.as_str())
            .map(|value| value.to_string());
        tracing::debug!(command = "chat_list_messages", conversation_id = %conversation_id, count = page.len(), "Messages retrieved");
        realtime::publish_chat_event(
            "chat_list_messages",
            &conversation_id,
            next_cursor.as_deref(),
        );
        success_payload(
            "chat_list_messages",
            json!({
                "conversationId": conversation_id,
                "nextCursor": next_cursor,
                "messages": page
            }),
        )
    })
}

pub fn chat_send_message(actor_id: &str, input: ChatSendMessageInput) -> AppResult<StubPayload> {
    tracing::info!(command = "chat_send_message", conversation_id = %input.conversation_id, "Sending message");
    let conversation_id = match chat::normalize_conversation_id(&input.conversation_id) {
        Ok(value) => value,
        Err(message) => return invalid_argument(message),
    };
    let content = match chat::normalize_content(&input.content) {
        Ok(value) => value,
        Err(message) => return invalid_argument(message),
    };
    let message_id = chat::next_message_id(input.client_message_id.as_deref());

    let agent_id = chat::extract_agent_id(&conversation_id);
    let timestamp_ms = chat::now_ms();
    with_chat_app_result(actor_id, |store| {
        let unread_count = {
            let conversation = store.ensure_conversation(&conversation_id, &agent_id, timestamp_ms);
            conversation.last_message_id = Some(message_id.clone());
            conversation.last_timestamp_ms = timestamp_ms;
            conversation.unread_count = conversation.unread_count.saturating_add(1);
            conversation.unread_count
        };
        store
            .messages
            .entry(conversation_id.clone())
            .or_default()
            .push(Message {
                id: message_id.clone(),
                conversation_id: conversation_id.clone(),
                content: content.clone(),
                role: "user".to_string(),
                read: false,
                via: DeliveryVia::Relay,
                retry_count: 0,
                timestamp_ms,
            });

        realtime::publish_chat_event("chat_send_message", &conversation_id, Some(&message_id));
        success_payload(
            "chat_send_message",
            json!({
                "conversationId": conversation_id,
                "messageId": message_id,
                "unreadCount": unread_count
            }),
        )
    })
}

pub fn chat_mark_read(actor_id: &str, input: ChatMarkReadInput) -> AppResult<StubPayload> {
    let conversation_id = match chat::normalize_conversation_id(&input.conversation_id) {
        Ok(value) => value,
        Err(message) => return invalid_argument(message),
    };
    let message_id = input.message_id.trim().to_string();
    if message_id.is_empty() {
        return invalid_argument("message_id is required".to_string());
    }

    with_chat_app_result(actor_id, |store| {
        let messages = match store.messages.get_mut(&conversation_id) {
            Some(messages) => messages,
            None => return AppResult::fail(ErrorCode::NotFound, "Conversation not found", None),
        };
        let mut found = false;
        for message in messages.iter_mut() {
            if message.id == message_id.as_str() {
                found = true;
                message.read = true;
            }
        }
        if !found {
            return AppResult::fail(ErrorCode::NotFound, "Message not found", None);
        }
        let unread_count = messages.iter().filter(|item| !item.read).count() as u32;
        if let Some(conversation) = store.conversations.get_mut(&conversation_id) {
            conversation.unread_count = unread_count;
            conversation.last_timestamp_ms = chat::now_ms();
        }
        realtime::publish_chat_event("chat_mark_read", &conversation_id, Some(&message_id));
        success_payload(
            "chat_mark_read",
            json!({
                "conversationId": conversation_id,
                "messageId": message_id,
                "unreadCount": unread_count
            }),
        )
    })
}

pub fn chat_delete_conversation(
    actor_id: &str,
    input: ChatConversationInput,
) -> AppResult<StubPayload> {
    let conversation_id = match chat::normalize_conversation_id(&input.conversation_id) {
        Ok(value) => value,
        Err(message) => return invalid_argument(message),
    };
    with_chat_app_result(actor_id, |store| {
        store.conversations.remove(&conversation_id);
        store.messages.remove(&conversation_id);
        success_payload(
            "chat_delete_conversation",
            json!({ "ok": true, "conversationId": conversation_id }),
        )
    })
}

pub fn chat_rename_conversation(
    actor_id: &str,
    input: ChatRenameConversationInput,
) -> AppResult<StubPayload> {
    tracing::info!(command = "chat_rename_conversation", conversation_id = %input.conversation_id, title = %input.title, "Renaming conversation");
    let conversation_id = match chat::normalize_conversation_id(&input.conversation_id) {
        Ok(value) => value,
        Err(message) => return invalid_argument(message),
    };
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return invalid_argument("title is required".to_string());
    }
    let agent_id = chat::extract_agent_id(&conversation_id);
    with_chat_app_result(actor_id, |store| {
        let now = chat::now_ms();
        let conversation = store.ensure_conversation(&conversation_id, &agent_id, now);
        conversation.title = title.clone();
        conversation.last_timestamp_ms = now;
        success_payload(
            "chat_rename_conversation",
            json!({ "ok": true, "conversationId": conversation_id, "title": title }),
        )
    })
}

pub fn chat_duplicate_conversation(
    actor_id: &str,
    input: ChatConversationInput,
) -> AppResult<StubPayload> {
    let source_id = match chat::normalize_conversation_id(&input.conversation_id) {
        Ok(value) => value,
        Err(message) => return invalid_argument(message),
    };
    with_chat_app_result(actor_id, |store| {
        let source_conversation = match store.conversations.get(&source_id).cloned() {
            Some(conversation) => conversation,
            None => return AppResult::fail(ErrorCode::NotFound, "Conversation not found", None),
        };
        let now = chat::now_ms();
        let duplicated_id = format!("{}-copy-{}", source_id, now);
        let mut duplicated_conversation = source_conversation.clone();
        duplicated_conversation.id = duplicated_id.clone();
        duplicated_conversation.title = format!("{} Copy", source_conversation.title);
        duplicated_conversation.last_timestamp_ms = now;
        store
            .conversations
            .insert(duplicated_id.clone(), duplicated_conversation);
        let duplicated_messages = store
            .messages
            .get(&source_id)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|mut message| {
                message.id = chat::next_message_id(Some(&format!("{}-copy", message.id)));
                message.conversation_id = duplicated_id.clone();
                message
            })
            .collect::<Vec<_>>();
        store
            .messages
            .insert(duplicated_id.clone(), duplicated_messages);
        success_payload(
            "chat_duplicate_conversation",
            json!({ "ok": true, "conversationId": duplicated_id }),
        )
    })
}

pub fn chat_smart_rename_conversation(
    actor_id: &str,
    input: ChatConversationInput,
) -> AppResult<StubPayload> {
    let conversation_id = match chat::normalize_conversation_id(&input.conversation_id) {
        Ok(value) => value,
        Err(message) => return invalid_argument(message),
    };
    let agent_id = chat::extract_agent_id(&conversation_id);
    with_chat_app_result(actor_id, |store| {
        let now = chat::now_ms();
        let title = if let Some(messages) = store.messages.get(&conversation_id) {
            if let Some(last_message) = messages.last() {
                let content = last_message.content.trim();
                if content.is_empty() {
                    format!("Topic {}", now)
                } else {
                    content.chars().take(28).collect::<String>()
                }
            } else {
                format!("Topic {}", now)
            }
        } else {
            format!("Topic {}", now)
        };
        let conversation = store.ensure_conversation(&conversation_id, &agent_id, now);
        conversation.title = title.clone();
        conversation.last_timestamp_ms = now;
        success_payload(
            "chat_smart_rename_conversation",
            json!({ "ok": true, "conversationId": conversation_id, "title": title }),
        )
    })
}

pub fn chat_set_conversation_model(
    actor_id: &str,
    input: ChatSetConversationModelInput,
) -> AppResult<StubPayload> {
    let conversation_id = match chat::normalize_conversation_id(&input.conversation_id) {
        Ok(value) => value,
        Err(message) => return invalid_argument(message),
    };
    let model = input.model.trim().to_string();
    let agent_id = chat::extract_agent_id(&conversation_id);
    with_chat_app_result(actor_id, |store| {
        let now = chat::now_ms();
        let conversation = store.ensure_conversation(&conversation_id, &agent_id, now);
        conversation.model = if model.is_empty() {
            None
        } else {
            Some(model.clone())
        };
        conversation.last_timestamp_ms = now;
        success_payload(
            "chat_set_conversation_model",
            json!({ "ok": true, "conversationId": conversation_id, "model": model }),
        )
    })
}

pub fn chat_delete_message(actor_id: &str, input: ChatMessageInput) -> AppResult<StubPayload> {
    let message_id = input.message_id.trim().to_string();
    if message_id.is_empty() {
        return invalid_argument("message_id is required".to_string());
    }
    with_chat_app_result(actor_id, |store| {
        let target = store
            .messages
            .iter()
            .find_map(|(conversation_id, messages)| {
                messages
                    .iter()
                    .position(|message| message.id == message_id)
                    .map(|index| (conversation_id.clone(), index))
            });
        if let Some((conversation_id, index)) = target {
            if let Some(messages) = store.messages.get_mut(&conversation_id) {
                messages.remove(index);
                let unread_count = messages.iter().filter(|item| !item.read).count() as u32;
                let last_message_id = messages.last().map(|item| item.id.clone());
                if let Some(conversation) = store.conversations.get_mut(&conversation_id) {
                    conversation.unread_count = unread_count;
                    conversation.last_message_id = last_message_id;
                    conversation.last_timestamp_ms = chat::now_ms();
                }
            }
            return success_payload(
                "chat_delete_message",
                json!({ "ok": true, "conversationId": conversation_id, "messageId": message_id }),
            );
        }
        AppResult::fail(ErrorCode::NotFound, "Message not found", None)
    })
}

pub fn chat_update_message(
    actor_id: &str,
    input: ChatUpdateMessageInput,
) -> AppResult<StubPayload> {
    let message_id = input.message_id.trim().to_string();
    if message_id.is_empty() {
        return invalid_argument("message_id is required".to_string());
    }
    let content = match chat::normalize_content(&input.content) {
        Ok(content) => content,
        Err(message) => return invalid_argument(message),
    };
    with_chat_app_result(actor_id, |store| {
        let target = store
            .messages
            .iter()
            .find_map(|(conversation_id, messages)| {
                messages
                    .iter()
                    .position(|message| message.id == message_id)
                    .map(|index| (conversation_id.clone(), index))
            });
        if let Some((conversation_id, index)) = target {
            let timestamp_ms = chat::now_ms();
            if let Some(messages) = store.messages.get_mut(&conversation_id) {
                if let Some(message) = messages.get_mut(index) {
                    message.content = content.clone();
                    message.timestamp_ms = timestamp_ms;
                }
            }
            if let Some(conversation) = store.conversations.get_mut(&conversation_id) {
                conversation.last_message_id = Some(message_id.clone());
                conversation.last_timestamp_ms = timestamp_ms;
            }
            return success_payload(
                "chat_update_message",
                json!({ "ok": true, "conversationId": conversation_id, "messageId": message_id }),
            );
        }
        AppResult::fail(ErrorCode::NotFound, "Message not found", None)
    })
}

pub fn chat_stop(_actor_id: &str, input: ChatConversationInput) -> AppResult<StubPayload> {
    let conversation_id = match chat::normalize_conversation_id(&input.conversation_id) {
        Ok(value) => value,
        Err(message) => return invalid_argument(message),
    };
    success_payload(
        "chat_stop",
        json!({ "ok": true, "conversationId": conversation_id, "stopped": true }),
    )
}

pub fn chat_completion_once(actor_id: &str, input: ChatCompletionInput) -> AppResult<StubPayload> {
    tracing::info!(command = "chat_completion_once", session_id = %input.session_id, model = ?input.model, "Starting completion");
    let session_id = input.session_id.trim().to_string();
    if session_id.is_empty() {
        return invalid_argument("session_id is required".to_string());
    }
    let content = match chat::normalize_content(&input.message) {
        Ok(content) => content,
        Err(message) => return invalid_argument(message),
    };
    let provider_id = input
        .provider_id
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    let model_hint = input.model.as_deref().unwrap_or("").trim().to_string();
    let provider_id = if provider_id.is_empty() && !model_hint.is_empty() {
        provider_state::with_provider_store(None, |store| {
            store
                .providers
                .iter()
                .find(|p| {
                    p.enabled
                        && (p.check_model == model_hint
                            || p.models.iter().any(|m| m.id == model_hint))
                })
                .map(|p| p.id.clone())
        })
        .ok()
        .flatten()
        .unwrap_or_default()
    } else {
        provider_id
    };
    if provider_id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "Provider ID is required", None);
    }
    let provider_data = match provider_state::with_provider_store(None, |store| {
        store
            .providers
            .iter()
            .find(|p| p.id == provider_id)
            .cloned()
    }) {
        Ok(Some(provider)) => provider,
        _ => return AppResult::fail(ErrorCode::NotFound, "Provider not found", None),
    };
    if !provider_data.enabled {
        return AppResult::fail(ErrorCode::InvalidArgument, "Provider is disabled", None);
    }
    let api_key = serde_json::from_str::<serde_json::Value>(&provider_data.key_vaults)
        .ok()
        .and_then(|v| v.get("api_key").and_then(|k| k.as_str()).map(String::from))
        .unwrap_or_default();
    let config: serde_json::Value =
        serde_json::from_str(&provider_data.config_json).unwrap_or_default();
    let base_url = config
        .get("base_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if base_url.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "Provider base URL is required",
            None,
        );
    }
    let provider_protocol = config
        .get("protocol")
        .and_then(|v| v.as_str())
        .map(String::from);
    let model_id = input.model.as_deref().unwrap_or("").trim().to_string();
    let model_id = if model_id.is_empty() {
        provider_data.check_model.clone()
    } else {
        model_id
    };
    if model_id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "Model is required", None);
    }
    let model_record = provider_data.models.iter().find(|m| m.id == model_id);
    let effective_protocol = provider_remote::resolve_model_protocol(
        model_record.and_then(|m| m.protocol_override.as_deref()),
        provider_protocol.as_deref(),
    );
    match provider_remote::chat_completion(
        &base_url,
        &api_key,
        &model_id,
        Some(effective_protocol),
        &content,
    ) {
        Ok(result) => {
            tracing::info!(command = "chat_completion_once", session_id = %session_id, model = %model_id, "Completion succeeded");
            let agent_id = chat::extract_agent_id(&session_id);
            with_chat_app_result(actor_id, |store| {
                let now = chat::now_ms();
                store.ensure_conversation(&session_id, &agent_id, now);

                let user_msg_id = chat::next_message_id(None);
                store
                    .messages
                    .entry(session_id.clone())
                    .or_default()
                    .push(Message {
                        id: user_msg_id.clone(),
                        conversation_id: session_id.clone(),
                        content: content.clone(),
                        role: "user".to_string(),
                        read: false,
                        via: DeliveryVia::Relay,
                        retry_count: 0,
                        timestamp_ms: now,
                    });

                let assistant_msg_id = chat::next_message_id(None);
                let assistant_now = chat::now_ms();
                store
                    .messages
                    .entry(session_id.clone())
                    .or_default()
                    .push(Message {
                        id: assistant_msg_id.clone(),
                        conversation_id: session_id.clone(),
                        content: result.text.clone(),
                        role: "assistant".to_string(),
                        read: false,
                        via: DeliveryVia::Relay,
                        retry_count: 0,
                        timestamp_ms: assistant_now,
                    });

                if let Some(conversation) = store.conversations.get_mut(&session_id) {
                    conversation.last_message_id = Some(assistant_msg_id);
                    conversation.last_timestamp_ms = assistant_now;
                    conversation.unread_count = conversation.unread_count.saturating_add(2);
                }

                success_payload(
                    "chat_completion_once",
                    json!({
                        "text": result.text,
                        "model": result.model,
                        "provider_id": provider_id
                    }),
                )
            })
        }
        Err(err) => {
            tracing::error!(command = "chat_completion_once", session_id = %session_id, model = %model_id, error = %err, "Completion failed");
            AppResult::fail(
                ErrorCode::InternalError,
                format!("Chat completion failed: {}", err),
                None,
            )
        }
    }
}

pub fn list_conversations_by_agent(actor_id: &str, agent_name: &str) -> Vec<serde_json::Value> {
    let key = actor_bucket_id(actor_id);
    let mut stores = match chat_stores().lock() {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = %e, "Failed to acquire chat store lock");
            return vec![];
        }
    };
    let store = stores.buckets.entry(key).or_insert_with(ChatStore::seeded);
    let mut conversations: Vec<_> = store
        .conversations
        .values()
        .filter(|c| c.agent_id == agent_name)
        .cloned()
        .collect();
    conversations.sort_by(|a, b| b.last_timestamp_ms.cmp(&a.last_timestamp_ms));
    let result: Vec<_> = conversations
        .into_iter()
        .map(|c| {
            json!({
                "id": c.id,
                "key": c.id,
                "agent_name": c.agent_id,
                "title": c.title,
                "message_count": store.messages.get(&c.id).map(|list| list.len()).unwrap_or(0),
                "model_override": c.model,
                "created_at": c.last_timestamp_ms,
                "updated_at": c.last_timestamp_ms
            })
        })
        .collect();
    tracing::debug!(command = "list_conversations_by_agent", agent_name = %agent_name, count = result.len(), "Agent conversations retrieved");
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_stores_isolate_actors() {
        let a = "actor-chat-a";
        let b = "actor-chat-b";
        let send_a = ChatSendMessageInput {
            conversation_id: "conv-a-only".to_string(),
            content: "only-a".to_string(),
            client_message_id: None,
        };
        let r = chat_send_message(a, send_a);
        assert!(r.ok, "send a");
        let out_b = chat_list_conversations(b);
        assert!(out_b.ok, "list b");
        let payload = out_b.data.expect("data");
        let v: serde_json::Value = serde_json::from_str(&payload.status).expect("json");
        let has_a_conv = v
            .get("conversations")
            .and_then(|c| c.as_array())
            .map(|list| {
                list.iter()
                    .any(|row| row.get("id").and_then(|x| x.as_str()) == Some("conv-a-only"))
            })
            .unwrap_or(false);
        assert!(!has_a_conv, "B must not list A's ad-hoc conversation");
    }
}
