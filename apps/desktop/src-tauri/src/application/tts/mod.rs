use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{StubPayload, TtsInput};
use serde_json::json;

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn invalid_argument(message: &str) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InvalidArgument, message, None)
}

pub fn tts_synthesize(input: TtsInput) -> AppResult<StubPayload> {
    if input.text.trim().is_empty() {
        return invalid_argument("text is required");
    }
    let _ = input.voice;
    let _ = input.speed;
    success_payload("tts_synthesize", json!({ "url":"data:audio/wav;base64," }))
}

pub fn tts_voices() -> AppResult<StubPayload> {
    success_payload(
        "tts_voices",
        json!({
            "voices":[
                {"id":"alloy","name":"Alloy","provider":"openai","language":"en-US"},
                {"id":"zh-CN-XiaoxiaoNeural","name":"Xiaoxiao","provider":"edge","language":"zh-CN"}
            ]
        }),
    )
}
