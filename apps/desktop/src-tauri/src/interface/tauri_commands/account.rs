use crate::error::AppResult;
use crate::interface::contracts::{AccountIdInput, AccountUpsertOAuthInput, StubPayload};

#[path = "../../application/account/mod.rs"]
mod application_account;

#[tauri::command]
pub fn account_list() -> AppResult<StubPayload> {
    application_account::account_list()
}

#[tauri::command]
pub fn account_get_active() -> AppResult<StubPayload> {
    application_account::account_get_active()
}

#[tauri::command]
pub fn account_switch(input: AccountIdInput) -> AppResult<StubPayload> {
    application_account::account_switch(input)
}

#[tauri::command]
pub fn account_upsert_oauth(input: AccountUpsertOAuthInput) -> AppResult<StubPayload> {
    application_account::account_upsert_oauth(input)
}
