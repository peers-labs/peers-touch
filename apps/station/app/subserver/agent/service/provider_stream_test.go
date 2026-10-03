package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	providercli "github.com/peers-labs/peers-touch/station/app/subserver/agent/service/cli"
)

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

func TestParseOllamaStreamDeltaThinking(t *testing.T) {
	delta, _, _, _, _, ok := parseOllamaStreamDelta(`{
		"model": "qwen-test",
		"message": {"thinking": "inspect the request"},
		"done": false
	}`)

	if !ok {
		t.Fatal("expected ollama thinking delta to parse")
	}
	if delta.Type != "thinking" || delta.Content != "inspect the request" {
		t.Fatalf("unexpected ollama thinking delta: %#v", delta)
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

func TestParseOllamaStreamToolCall(t *testing.T) {
	calls, err := parseOllamaStreamToolCalls(`{
		"message": {
			"tool_calls": [{
				"id": "provider-call-1",
				"function": {
					"index": 0,
					"name": "skills_list",
					"arguments": {"category": "installed"}
				}
			}]
		},
		"done": false
	}`)
	if err != nil {
		t.Fatalf("parse ollama ToolCall: %v", err)
	}
	if len(calls) != 1 ||
		calls[0].ID != "provider-call-1" ||
		calls[0].Name != "skills_list" ||
		calls[0].Arguments != `{"category":"installed"}` {
		t.Fatalf("unexpected ollama ToolCalls: %+v", calls)
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

func TestProviderServiceExecutesCatalogCLIWithoutCredential(t *testing.T) {
	openAdmissionTestDB(t, "provider_catalog_cli")
	root := t.TempDir()
	commandPath := filepath.Join(root, "traecli")
	if err := os.WriteFile(commandPath, []byte(`#!/bin/sh
cat >/dev/null
printf '%s\n' '{"type":"delta","content":"station cli response"}'
printf '%s\n' '{"type":"done"}'
`), 0o755); err != nil {
		t.Fatalf("write CLI fixture: %v", err)
	}

	provider := NewProviderService(nil)
	provider.cliExecutor = providercli.NewExecutor(&providercli.WorkspaceManager{
		BaseDir: filepath.Join(root, "workspaces"),
	})
	catalogProvider := catalog.Find("trae-cli")
	if catalogProvider == nil {
		t.Fatal("trae-cli catalog provider is missing")
	}
	originalCommand := catalogProvider.CliCommand
	catalogProvider.CliCommand = commandPath
	t.Cleanup(func() {
		catalogProvider.CliCommand = originalCommand
	})

	var streamed string
	response, err := provider.Call(context.Background(), &ProviderCallRequest{
		ProviderID:   "trae-cli",
		ProviderType: "trae-cli",
		UserID:       "actor-1",
		AgentID:      "agent-1",
		Model:        "default",
		SystemPrompt: "answer directly",
		Messages: []domain.Message{
			{Role: domain.MessageRoleUser, Content: "hello"},
		},
		DeltaSink: func(_ context.Context, delta ProviderDelta) error {
			if delta.Type == "text" {
				streamed += delta.Content
			}
			return nil
		},
	})
	if err != nil {
		t.Fatalf("Call() error = %v", err)
	}
	if response.Content != "station cli response" ||
		streamed != response.Content ||
		!response.Streamed ||
		response.Provider != "cli" {
		t.Fatalf("unexpected CLI response: response=%+v streamed=%q", response, streamed)
	}
}

func TestProviderServiceReturnsTypedCLIBinaryMissing(t *testing.T) {
	db := openAdmissionTestDB(t, "provider_cli_missing_binary")
	catalogProvider := catalog.Find("trae-cli")
	if catalogProvider == nil {
		t.Fatal("trae-cli catalog provider is missing")
	}
	originalCommand := catalogProvider.CliCommand
	catalogProvider.CliCommand = "peers-touch-cli-that-does-not-exist"
	t.Cleanup(func() {
		catalogProvider.CliCommand = originalCommand
	})
	if err := db.Create(&persistence.AgentProvider{
		ID:          "provider-row",
		ActorPTID:   "actor-1",
		Name:        "trae-cli",
		DisplayName: "TRAE CLI",
		SourceType:  "catalog",
		RuntimeKind: "cli",
		Protocol:    "cli",
		CliCommand:  "peers-touch-cli-that-does-not-exist",
		Enabled:     true,
		Version:     1,
	}).Error; err != nil {
		t.Fatalf("seed CLI provider: %v", err)
	}

	_, err := NewProviderService(nil).Call(context.Background(), &ProviderCallRequest{
		ProviderID:   "trae-cli",
		ProviderType: "trae-cli",
		UserID:       "actor-1",
		Model:        "default",
		Messages: []domain.Message{
			{Role: domain.MessageRoleUser, Content: "hello"},
		},
	})
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) ||
		bizErr.Code != errcode.AgentRuntimeUnavailable ||
		bizErr.Payload.GetDetails()["reason_code"] != "cli_binary_missing" {
		t.Fatalf("Call() error = %T %v, want typed CLI binary unavailable", err, err)
	}
}

func TestProviderServiceIgnoresPersistedCLICommand(t *testing.T) {
	db := openAdmissionTestDB(t, "provider_cli_registered_command")
	root := t.TempDir()
	expectedOutput := filepath.Join(root, "registered-output")
	persistedOutput := filepath.Join(root, "persisted-output")
	registeredCommand := filepath.Join(root, "registered")
	persistedCommand := filepath.Join(root, "persisted")
	for path, content := range map[string]string{
		registeredCommand: `#!/bin/sh
cat >/dev/null
touch "$1"
printf '%s\n' '{"type":"done","content":"registered"}'
`,
		persistedCommand: `#!/bin/sh
cat >/dev/null
touch "$1"
printf '%s\n' '{"type":"done","content":"persisted"}'
`,
	} {
		if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
			t.Fatalf("write CLI fixture: %v", err)
		}
	}
	catalogProvider := catalog.Find("trae-cli")
	if catalogProvider == nil {
		t.Fatal("trae-cli catalog provider is missing")
	}
	originalCommand := catalogProvider.CliCommand
	catalogProvider.CliCommand = registeredCommand + " " + expectedOutput
	t.Cleanup(func() {
		catalogProvider.CliCommand = originalCommand
	})
	if err := db.Create(&persistence.AgentProvider{
		ID:          "provider-row",
		ActorPTID:   "actor-1",
		Name:        "trae-cli",
		DisplayName: "TRAE CLI",
		SourceType:  "catalog",
		RuntimeKind: "cli",
		Protocol:    "cli",
		CliCommand:  persistedCommand + " " + persistedOutput,
		Enabled:     true,
		Version:     1,
	}).Error; err != nil {
		t.Fatalf("seed CLI provider: %v", err)
	}

	provider := NewProviderService(nil)
	provider.cliExecutor = providercli.NewExecutor(&providercli.WorkspaceManager{
		BaseDir: filepath.Join(root, "workspaces"),
	})
	response, err := provider.Call(context.Background(), &ProviderCallRequest{
		ProviderID:   "trae-cli",
		ProviderType: "trae-cli",
		UserID:       "actor-1",
		Model:        "default",
		Messages: []domain.Message{
			{Role: domain.MessageRoleUser, Content: "hello"},
		},
	})
	if err != nil {
		t.Fatalf("Call() error = %v", err)
	}
	if response.Content != "registered" {
		t.Fatalf("Call() content = %q, want registered", response.Content)
	}
	if _, err := os.Stat(expectedOutput); err != nil {
		t.Fatalf("registered command did not run: %v", err)
	}
	if _, err := os.Stat(persistedOutput); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("persisted command unexpectedly ran: %v", err)
	}
}

func TestProviderCallWithRetryBypassesCredentialLeaseForCLI(t *testing.T) {
	showAPIKey := false
	catalog.SetForTesting([]catalog.CatalogProvider{{
		ID:          "test-cli",
		Name:        "Test CLI",
		Enabled:     true,
		ShowAPIKey:  &showAPIKey,
		Protocol:    "cli",
		RuntimeKind: "cli",
		CliCommand:  "test-cli",
		Models: []catalog.CatalogModel{{
			ID:            "default",
			DisplayName:   "Default",
			Type:          "chat",
			Enabled:       true,
			ContextWindow: 128000,
			Capabilities:  []string{"text-input", "text-output", "streaming"},
		}},
	}})
	t.Cleanup(catalog.RestoreForTesting)

	db := openRuntimeAuthorityDB(t, "provider_cli_credentialless_turn")
	if err := db.AutoMigrate(
		&persistence.AgentProvider{},
		&persistence.AgentModel{},
	); err != nil {
		t.Fatalf("migrate CLI runtime authority: %v", err)
	}
	seedRuntimeAuthorityRows(t, db, "turn-1", "attempt-1")
	resolver := NewRuntimeAdmissionResolver(
		NewProviderConfigService(),
		NewModelConfigService(),
	)
	admission, err := resolver.Resolve(
		context.Background(),
		"ptid:person:owner",
		"test-cli",
		"default",
	)
	if err != nil {
		t.Fatalf("resolve CLI runtime: %v", err)
	}
	config := runtimeAuthorityConfig("turn-1", "attempt-1")
	config.Provider = "test-cli"
	config.Model = "default"
	config.ThinkingMode = domain.ThinkingModeAuto
	config.RuntimeBudget = cloneRuntimeBudget(admission.Budget)
	config.RuntimeCapabilities = admission.Capabilities

	service := &TurnService{
		admissionResolver: resolver,
		compression:       NewCompressionService(),
	}
	if err := service.persistRuntimeAuthority(
		context.Background(),
		config,
		admission,
		runtimeAuthorityReadiness(config, admission),
		11,
	); err != nil {
		t.Fatalf("persist CLI runtime authority: %v", err)
	}
	providerCalls := 0
	service.providerCall = func(
		ctx context.Context,
		request *ProviderCallRequest,
	) (*ProviderCallResponse, error) {
		providerCalls++
		if request.ProviderID != "test-cli" {
			t.Fatalf("CLI call provider reference = %q, want logical provider id", request.ProviderID)
		}
		if err := request.BeforeDispatch(ctx); err != nil {
			return nil, err
		}
		return &ProviderCallResponse{
			Content:  "credentialless response",
			Model:    "default",
			Provider: "test-cli",
			Streamed: true,
		}, nil
	}

	response, _, records, streamed, err := service.providerCallWithRetry(
		context.Background(),
		config,
		config.TurnID,
		&domain.TurnTrace{},
		"system",
		[]domain.Message{{Role: domain.MessageRoleUser, Content: "hello"}},
	)
	if err != nil {
		t.Fatalf("providerCallWithRetry() error = %v", err)
	}
	if response != "credentialless response" || !streamed || providerCalls != 1 {
		t.Fatalf("unexpected CLI result: response=%q streamed=%v calls=%d", response, streamed, providerCalls)
	}
	if len(records) != 1 || records[0].CredentialID != "" {
		t.Fatalf("CLI provider must not lease an HTTP credential: %+v", records)
	}
}
