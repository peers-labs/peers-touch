use crate::error::AppResult;
use crate::contracts::{StubPayload, TtsInput};

use crate::application::tts as application_tts;

#[tauri::command]
pub fn tts_synthesize(input: TtsInput) -> AppResult<StubPayload> {
    application_tts::tts_synthesize(input)
}

#[tauri::command]
pub fn tts_voices() -> AppResult<StubPayload> {
    application_tts::tts_voices()
}
