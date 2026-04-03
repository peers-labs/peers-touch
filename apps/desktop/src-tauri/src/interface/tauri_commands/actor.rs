use crate::application::social_chat::actor_service;
use crate::error::{AppResult, ErrorCode};
use prost::Message;

#[tauri::command]
pub fn actor_search_actors(token: String, query: String) -> AppResult<Vec<u8>> {
    match actor_service::search_actors(&token, &query) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(e) => AppResult::fail(ErrorCode::InternalError, &e, None),
    }
}

#[tauri::command]
pub fn actor_get_my_profile(token: String) -> AppResult<Vec<u8>> {
    match actor_service::get_my_profile(&token) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(e) => AppResult::fail(ErrorCode::InternalError, &e, None),
    }
}
