use crate::contracts::{
    ProviderModelAddInput, ProviderModelDeleteInput, ProviderModelFetchInput,
    ProviderModelToggleAllInput, ProviderModelToggleInput, ProviderModelUpdateInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};

fn not_implemented(cmd: &str) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InternalError, format!("{cmd} not yet implemented"), None)
}

pub fn model_add(_scope: Option<&str>, _input: ProviderModelAddInput) -> AppResult<StubPayload> {
    not_implemented("model_add")
}

pub fn model_update(_scope: Option<&str>, _input: ProviderModelUpdateInput) -> AppResult<StubPayload> {
    not_implemented("model_update")
}

pub fn model_delete(_scope: Option<&str>, _input: ProviderModelDeleteInput) -> AppResult<StubPayload> {
    not_implemented("model_delete")
}

pub fn model_fetch_remote(_scope: Option<&str>, _input: ProviderModelFetchInput) -> AppResult<StubPayload> {
    not_implemented("model_fetch_remote")
}

pub fn model_toggle(_scope: Option<&str>, _input: ProviderModelToggleInput) -> AppResult<StubPayload> {
    not_implemented("model_toggle")
}

pub fn model_toggle_all(_scope: Option<&str>, _input: ProviderModelToggleAllInput) -> AppResult<StubPayload> {
    not_implemented("model_toggle_all")
}
