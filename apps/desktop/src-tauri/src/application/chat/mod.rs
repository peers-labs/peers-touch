use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{
    ChatCompletionInput, ChatConversationInput, ChatListMessagesInput, ChatMarkReadInput, ChatMessageInput,
    ChatRenameConversationInput, ChatSendMessageInput, ChatSetConversationModelInput, ChatUpdateMessageInput,
    StubPayload,
};
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use super::domain_chat::{self, Conversation, DeliveryVia, Message};
use super::infrastructure_p2p;
use super::infrastructure_realtime;

#[derive(Default)]
struct ChatStore {
    conversations: HashMap<String, Conversation>,
    messages: HashMap<String, Vec<Message>>,
}

impl ChatStore {
    fn seeded() -> Self {
        let mut store = Self::default();
        let conversation_id = "general".to_string();
        let first_message_id = domain_chat::next_message_id(Some("bootstrap-1"));
        let timestamp = domain_chat::now_ms();
        store.messages.insert(
            conversation_id.clone(),
            vec![Message {
                id: first_message_id.clone(),
                conversation_id: conversation_id.clone(),
                content: "welcome".to_string(),
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
                title: "General".to_string(),
                model: None,
                unread_count: 1,
                last_message_id: Some(first_message_id),
                last_timestamp_ms: timestamp,
            },
        );
        store
    }

    fn ensure_conversation(&mut self, conversation_id: &str, timestamp_ms: u128) -> &mut Conversation {
        self.messages
            .entry(conversation_id.to_string())
            .or_default();
        self.conversations
            .entry(conversation_id.to_string())
            .or_insert_with(|| Conversation {
                id: conversation_id.to_string(),
                title: "New Chat".to_string(),
                model: None,
                unread_count: 0,
                last_message_id: None,
                last_timestamp_ms: timestamp_ms,
            })
    }
}

static CHAT_STORE: OnceLock<Mutex<ChatStore>> = OnceLock::new();

fn chat_store() -> &'static Mutex<ChatStore> {
    CHAT_STORE.get_or_init(|| Mutex::new(ChatStore::seeded()))
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
    AppResult::fail(ErrorCode::InternalError, message, None)
}

pub fn chat_list_conversations() -> AppResult<StubPayload> {
    let connected = infrastructure_realtime::ensure_connected();
    let guard = match chat_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error("failed to access chat store"),
    };
    let mut conversations: Vec<_> = guard.conversations.values().cloned().collect();
    conversations.sort_by(|a, b| b.last_timestamp_ms.cmp(&a.last_timestamp_ms));
    let data = conversations
        .into_iter()
        .map(|conversation| {
            json!({
                "id": conversation.id,
                "title": conversation.title,
                "modelName": conversation.model,
                "unreadCount": conversation.unread_count,
                "messageCount": guard.messages.get(&conversation.id).map(|list| list.len()).unwrap_or(0),
                "lastMessageId": conversation.last_message_id,
                "lastTimestampMs": conversation.last_timestamp_ms
            })
        })
        .collect::<Vec<_>>();
    infrastructure_realtime::publish_chat_event("chat_list_conversations", "all", None);
    success_payload(
        "chat_list_conversations",
        json!({
            "realtimeConnected": connected,
            "conversations": data
        }),
    )
}

pub fn chat_list_messages(input: ChatListMessagesInput) -> AppResult<StubPayload> {
    let conversation_id = match domain_chat::normalize_conversation_id(&input.conversation_id) {
        Ok(value) => value,
        Err(message) => return invalid_argument(message),
    };
    let limit = domain_chat::resolve_limit(input.limit);
    let cursor = domain_chat::parse_cursor(input.cursor.as_deref());
    if !infrastructure_realtime::ensure_connected() {
        return AppResult::fail(ErrorCode::Conflict, "realtime unavailable", None);
    }

    let mut guard = match chat_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error("failed to access chat store"),
    };
    let now = domain_chat::now_ms();
    guard.ensure_conversation(&conversation_id, now);
    let messages = guard.messages.get(&conversation_id).cloned().unwrap_or_default();
    let start_index = cursor
        .as_ref()
        .and_then(|cursor_id| messages.iter().position(|message| message.id == cursor_id.as_str()))
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
                "role": if message.read { "CHAT_ROLE_ASSISTANT" } else { "CHAT_ROLE_USER" },
                "conversationId": message.conversation_id,
                "content": message.content,
                "read": message.read,
                "modelName": guard
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
    infrastructure_realtime::publish_chat_event("chat_list_messages", &conversation_id, next_cursor.as_deref());
    success_payload(
        "chat_list_messages",
        json!({
            "conversationId": conversation_id,
            "nextCursor": next_cursor,
            "messages": page
        }),
    )
}

pub fn chat_send_message(input: ChatSendMessageInput) -> AppResult<StubPayload> {
    let conversation_id = match domain_chat::normalize_conversation_id(&input.conversation_id) {
        Ok(value) => value,
        Err(message) => return invalid_argument(message),
    };
    let content = match domain_chat::normalize_content(&input.content) {
        Ok(value) => value,
        Err(message) => return invalid_argument(message),
    };
    let message_id = domain_chat::next_message_id(input.client_message_id.as_deref());

    let (via, retries) = match infrastructure_p2p::send_message(&conversation_id, &content) {
        Ok(()) => (DeliveryVia::P2p, 0u8),
        Err(_) => match infrastructure_realtime::send_relay_with_retry(&message_id, 2) {
            Ok(retries) => (DeliveryVia::Relay, retries),
            Err(message) => {
                return AppResult::fail(
                    ErrorCode::Conflict,
                    "message delivery failed",
                    Some(json!({
                        "conversationId": conversation_id,
                        "messageId": message_id,
                        "reason": message
                    })),
                )
            }
        },
    };

    let timestamp_ms = domain_chat::now_ms();
    let mut guard = match chat_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error("failed to access chat store"),
    };
    let unread_count = {
        let conversation = guard.ensure_conversation(&conversation_id, timestamp_ms);
        conversation.last_message_id = Some(message_id.clone());
        conversation.last_timestamp_ms = timestamp_ms;
        conversation.unread_count = conversation.unread_count.saturating_add(1);
        conversation.unread_count
    };
    guard
        .messages
        .entry(conversation_id.clone())
        .or_default()
        .push(Message {
            id: message_id.clone(),
            conversation_id: conversation_id.clone(),
            content: content.clone(),
            read: false,
            via,
            retry_count: retries,
            timestamp_ms,
        });

    infrastructure_realtime::publish_chat_event("chat_send_message", &conversation_id, Some(&message_id));
    let delivery = domain_chat::delivery_outcome(via, retries);
    success_payload(
        "chat_send_message",
        json!({
            "conversationId": conversation_id,
            "messageId": message_id,
            "delivery": delivery,
            "unreadCount": unread_count
        }),
    )
}

pub fn chat_mark_read(input: ChatMarkReadInput) -> AppResult<StubPayload> {
    let conversation_id = match domain_chat::normalize_conversation_id(&input.conversation_id) {
        Ok(value) => value,
        Err(message) => return invalid_argument(message),
    };
    let message_id = input.message_id.trim().to_string();
    if message_id.is_empty() {
        return invalid_argument("message_id is required".to_string());
    }

    let mut guard = match chat_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error("failed to access chat store"),
    };
    let messages = match guard.messages.get_mut(&conversation_id) {
        Some(messages) => messages,
        None => return AppResult::fail(ErrorCode::NotFound, "conversation not found", None),
    };
    let mut found = false;
    for message in messages.iter_mut() {
        if message.id == message_id.as_str() {
            found = true;
            message.read = true;
        }
    }
    if !found {
        return AppResult::fail(ErrorCode::NotFound, "message not found", None);
    }
    let unread_count = messages.iter().filter(|item| !item.read).count() as u32;
    if let Some(conversation) = guard.conversations.get_mut(&conversation_id) {
        conversation.unread_count = unread_count;
        conversation.last_timestamp_ms = domain_chat::now_ms();
    }
    infrastructure_realtime::publish_chat_event("chat_mark_read", &conversation_id, Some(&message_id));
    success_payload(
        "chat_mark_read",
        json!({
            "conversationId": conversation_id,
            "messageId": message_id,
            "unreadCount": unread_count
        }),
    )
}

pub fn chat_delete_conversation(input: ChatConversationInput) -> AppResult<StubPayload> {
    let conversation_id = match domain_chat::normalize_conversation_id(&input.conversation_id) {
        Ok(value) => value,
        Err(message) => return invalid_argument(message),
    };
    let mut guard = match chat_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error("failed to access chat store"),
    };
    guard.conversations.remove(&conversation_id);
    guard.messages.remove(&conversation_id);
    success_payload(
        "chat_delete_conversation",
        json!({ "ok": true, "conversationId": conversation_id }),
    )
}

pub fn chat_rename_conversation(input: ChatRenameConversationInput) -> AppResult<StubPayload> {
    let conversation_id = match domain_chat::normalize_conversation_id(&input.conversation_id) {
        Ok(value) => value,
        Err(message) => return invalid_argument(message),
    };
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return invalid_argument("title is required".to_string());
    }
    let mut guard = match chat_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error("failed to access chat store"),
    };
    let now = domain_chat::now_ms();
    let conversation = guard.ensure_conversation(&conversation_id, now);
    conversation.title = title.clone();
    conversation.last_timestamp_ms = now;
    success_payload(
        "chat_rename_conversation",
        json!({ "ok": true, "conversationId": conversation_id, "title": title }),
    )
}

pub fn chat_duplicate_conversation(input: ChatConversationInput) -> AppResult<StubPayload> {
    let source_id = match domain_chat::normalize_conversation_id(&input.conversation_id) {
        Ok(value) => value,
        Err(message) => return invalid_argument(message),
    };
    let mut guard = match chat_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error("failed to access chat store"),
    };
    let source_conversation = match guard.conversations.get(&source_id).cloned() {
        Some(conversation) => conversation,
        None => return AppResult::fail(ErrorCode::NotFound, "conversation not found", None),
    };
    let now = domain_chat::now_ms();
    let duplicated_id = format!("{}-copy-{}", source_id, now);
    let mut duplicated_conversation = source_conversation.clone();
    duplicated_conversation.id = duplicated_id.clone();
    duplicated_conversation.title = format!("{} Copy", source_conversation.title);
    duplicated_conversation.last_timestamp_ms = now;
    guard
        .conversations
        .insert(duplicated_id.clone(), duplicated_conversation);
    let duplicated_messages = guard
        .messages
        .get(&source_id)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|mut message| {
            message.id = domain_chat::next_message_id(Some(&format!("{}-copy", message.id)));
            message.conversation_id = duplicated_id.clone();
            message
        })
        .collect::<Vec<_>>();
    guard.messages.insert(duplicated_id.clone(), duplicated_messages);
    success_payload(
        "chat_duplicate_conversation",
        json!({ "ok": true, "conversationId": duplicated_id }),
    )
}

pub fn chat_smart_rename_conversation(input: ChatConversationInput) -> AppResult<StubPayload> {
    let conversation_id = match domain_chat::normalize_conversation_id(&input.conversation_id) {
        Ok(value) => value,
        Err(message) => return invalid_argument(message),
    };
    let mut guard = match chat_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error("failed to access chat store"),
    };
    let now = domain_chat::now_ms();
    let title = if let Some(messages) = guard.messages.get(&conversation_id) {
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
    let conversation = guard.ensure_conversation(&conversation_id, now);
    conversation.title = title.clone();
    conversation.last_timestamp_ms = now;
    success_payload(
        "chat_smart_rename_conversation",
        json!({ "ok": true, "conversationId": conversation_id, "title": title }),
    )
}

pub fn chat_set_conversation_model(input: ChatSetConversationModelInput) -> AppResult<StubPayload> {
    let conversation_id = match domain_chat::normalize_conversation_id(&input.conversation_id) {
        Ok(value) => value,
        Err(message) => return invalid_argument(message),
    };
    let model = input.model.trim().to_string();
    let mut guard = match chat_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error("failed to access chat store"),
    };
    let now = domain_chat::now_ms();
    let conversation = guard.ensure_conversation(&conversation_id, now);
    conversation.model = if model.is_empty() { None } else { Some(model.clone()) };
    conversation.last_timestamp_ms = now;
    success_payload(
        "chat_set_conversation_model",
        json!({ "ok": true, "conversationId": conversation_id, "model": model }),
    )
}

pub fn chat_delete_message(input: ChatMessageInput) -> AppResult<StubPayload> {
    let message_id = input.message_id.trim().to_string();
    if message_id.is_empty() {
        return invalid_argument("message_id is required".to_string());
    }
    let mut guard = match chat_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error("failed to access chat store"),
    };
    let target = guard.messages.iter().find_map(|(conversation_id, messages)| {
        messages
            .iter()
            .position(|message| message.id == message_id)
            .map(|index| (conversation_id.clone(), index))
    });
    if let Some((conversation_id, index)) = target {
        if let Some(messages) = guard.messages.get_mut(&conversation_id) {
            messages.remove(index);
            let unread_count = messages.iter().filter(|item| !item.read).count() as u32;
            let last_message_id = messages.last().map(|item| item.id.clone());
            if let Some(conversation) = guard.conversations.get_mut(&conversation_id) {
                conversation.unread_count = unread_count;
                conversation.last_message_id = last_message_id;
                conversation.last_timestamp_ms = domain_chat::now_ms();
            }
        }
        return success_payload(
            "chat_delete_message",
            json!({ "ok": true, "conversationId": conversation_id, "messageId": message_id }),
        );
    }
    AppResult::fail(ErrorCode::NotFound, "message not found", None)
}

pub fn chat_update_message(input: ChatUpdateMessageInput) -> AppResult<StubPayload> {
    let message_id = input.message_id.trim().to_string();
    if message_id.is_empty() {
        return invalid_argument("message_id is required".to_string());
    }
    let content = match domain_chat::normalize_content(&input.content) {
        Ok(content) => content,
        Err(message) => return invalid_argument(message),
    };
    let mut guard = match chat_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error("failed to access chat store"),
    };
    let target = guard.messages.iter().find_map(|(conversation_id, messages)| {
        messages
            .iter()
            .position(|message| message.id == message_id)
            .map(|index| (conversation_id.clone(), index))
    });
    if let Some((conversation_id, index)) = target {
        let timestamp_ms = domain_chat::now_ms();
        if let Some(messages) = guard.messages.get_mut(&conversation_id) {
            if let Some(message) = messages.get_mut(index) {
                message.content = content.clone();
                message.timestamp_ms = timestamp_ms;
            }
        }
        if let Some(conversation) = guard.conversations.get_mut(&conversation_id) {
            conversation.last_message_id = Some(message_id.clone());
            conversation.last_timestamp_ms = timestamp_ms;
        }
        return success_payload(
            "chat_update_message",
            json!({ "ok": true, "conversationId": conversation_id, "messageId": message_id }),
        );
    }
    AppResult::fail(ErrorCode::NotFound, "message not found", None)
}

pub fn chat_stop(input: ChatConversationInput) -> AppResult<StubPayload> {
    let conversation_id = match domain_chat::normalize_conversation_id(&input.conversation_id) {
        Ok(value) => value,
        Err(message) => return invalid_argument(message),
    };
    success_payload(
        "chat_stop",
        json!({ "ok": true, "conversationId": conversation_id, "stopped": true }),
    )
}

pub fn chat_completion_once(input: ChatCompletionInput) -> AppResult<StubPayload> {
    let session_id = input.session_id.trim().to_string();
    if session_id.is_empty() {
        return invalid_argument("session_id is required".to_string());
    }
    let content = match domain_chat::normalize_content(&input.message) {
        Ok(content) => content,
        Err(message) => return invalid_argument(message),
    };
    let model = input.model.unwrap_or_default();
    success_payload(
        "chat_completion_once",
        json!({
            "text": format!("Echo: {}", content),
            "model": model
        }),
    )
}
