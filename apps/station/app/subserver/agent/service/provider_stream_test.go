package service

import "testing"

func TestParseOpenAIStreamDeltaText(t *testing.T) {
	delta, model, finishReason, ok := parseOpenAIStreamDelta(`{
		"model": "gpt-test",
		"choices": [
			{"delta": {"content": "hello"}, "finish_reason": null}
		]
	}`)

	if !ok {
		t.Fatal("expected delta to parse")
	}
	if delta.Type != "text" || delta.Content != "hello" {
		t.Fatalf("unexpected delta: %#v", delta)
	}
	if model != "gpt-test" {
		t.Fatalf("unexpected model: %q", model)
	}
	if finishReason != "" {
		t.Fatalf("unexpected finish reason: %q", finishReason)
	}
}

func TestParseOpenAIStreamDeltaThinking(t *testing.T) {
	delta, _, _, ok := parseOpenAIStreamDelta(`{
		"choices": [
			{"delta": {"reasoning_content": "think"}}
		]
	}`)

	if !ok {
		t.Fatal("expected reasoning delta to parse")
	}
	if delta.Type != "thinking" || delta.Content != "think" {
		t.Fatalf("unexpected reasoning delta: %#v", delta)
	}
}

func TestParseOllamaStreamDeltaText(t *testing.T) {
	delta, model, finishReason, inputTokens, outputTokens, ok := parseOllamaStreamDelta(`{
                "model": "llama-test",
                "message": {"content": "hello"},
                "done": false,
                "prompt_eval_count": 3,
                "eval_count": 5
        }`)

	if !ok {
		t.Fatal("expected ollama delta to parse")
	}
	if delta.Type != "text" || delta.Content != "hello" {
		t.Fatalf("unexpected ollama delta: %#v", delta)
	}
	if model != "llama-test" {
		t.Fatalf("unexpected model: %q", model)
	}
	if finishReason != "" {
		t.Fatalf("unexpected finish reason: %q", finishReason)
	}
	if inputTokens != 3 || outputTokens != 5 {
		t.Fatalf("unexpected token counts: input=%d output=%d", inputTokens, outputTokens)
	}
}

func TestParseOllamaStreamDeltaDoneMetadata(t *testing.T) {
	delta, model, finishReason, inputTokens, outputTokens, ok := parseOllamaStreamDelta(`{
                "model": "llama-test",
                "done": true,
                "done_reason": "stop",
                "prompt_eval_count": 7,
                "eval_count": 11
        }`)

	if ok {
		t.Fatalf("expected metadata-only chunk, got delta: %#v", delta)
	}
	if model != "llama-test" || finishReason != "stop" {
		t.Fatalf("unexpected metadata: model=%q finish=%q", model, finishReason)
	}
	if inputTokens != 7 || outputTokens != 11 {
		t.Fatalf("unexpected token counts: input=%d output=%d", inputTokens, outputTokens)
	}
}

func TestParseAnthropicStreamDeltaText(t *testing.T) {
	delta, model, finishReason, inputTokens, outputTokens, ok := parseAnthropicStreamDelta(`{
                "type": "content_block_delta",
                "delta": {"type": "text_delta", "text": "hello"}
        }`)

	if !ok {
		t.Fatal("expected anthropic text delta to parse")
	}
	if delta.Type != "text" || delta.Content != "hello" {
		t.Fatalf("unexpected anthropic delta: %#v", delta)
	}
	if model != "" || finishReason != "" || inputTokens != 0 || outputTokens != 0 {
		t.Fatalf("unexpected metadata: model=%q finish=%q input=%d output=%d", model, finishReason, inputTokens, outputTokens)
	}
}

func TestParseAnthropicStreamDeltaThinking(t *testing.T) {
	delta, _, _, _, _, ok := parseAnthropicStreamDelta(`{
                "type": "content_block_delta",
                "delta": {"type": "thinking_delta", "thinking": "reason"}
        }`)

	if !ok {
		t.Fatal("expected anthropic thinking delta to parse")
	}
	if delta.Type != "thinking" || delta.Content != "reason" {
		t.Fatalf("unexpected anthropic thinking delta: %#v", delta)
	}
}

func TestParseAnthropicStreamDeltaMetadata(t *testing.T) {
	_, model, _, inputTokens, outputTokens, ok := parseAnthropicStreamDelta(`{
                "type": "message_start",
                "message": {
                        "model": "claude-test",
                        "usage": {"input_tokens": 13, "output_tokens": 0}
                }
        }`)

	if ok {
		t.Fatal("expected message_start to be metadata only")
	}
	if model != "claude-test" || inputTokens != 13 || outputTokens != 0 {
		t.Fatalf("unexpected message_start metadata: model=%q input=%d output=%d", model, inputTokens, outputTokens)
	}

	_, _, finishReason, _, outputTokens, ok := parseAnthropicStreamDelta(`{
                "type": "message_delta",
                "delta": {"stop_reason": "end_turn"},
                "usage": {"output_tokens": 17}
        }`)

	if ok {
		t.Fatal("expected message_delta to be metadata only")
	}
	if finishReason != "end_turn" || outputTokens != 17 {
		t.Fatalf("unexpected message_delta metadata: finish=%q output=%d", finishReason, outputTokens)
	}
}
