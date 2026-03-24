use crate::error::AppResult;
use crate::interface::contracts::{StubPayload, TtsInput};

#[path = "../../application/tts/mod.rs"]
mod application_tts;

#[tauri::command]
pub fn tts_synthesize(input: TtsInput) -> AppResult<StubPayload> {
    application_tts::tts_synthesize(input)
}

#[tauri::command]
pub fn tts_voices() -> AppResult<StubPayload> {
    application_tts::tts_voices()
}
