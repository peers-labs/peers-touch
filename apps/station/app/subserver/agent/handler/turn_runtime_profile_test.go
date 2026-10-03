package handler

import (
	"context"
	"strings"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"google.golang.org/protobuf/encoding/protojson"
)

func newCLIAdmissionTestHandlers() (*TurnHandlers, context.Context) {
	ctx := coreauth.WithSubject(
		context.Background(),
		&coreauth.Subject{ID: "ptid:person:owner"},
	)
	handlers := NewTurnHandlers(
		&service.TurnService{},
		service.NewToolRegistryService(nil, nil),
		nil,
		service.NewConversationService(),
	)
	return handlers, ctx
}

func TestExecuteTurnAllowsCLIProviderToReachRuntimeAdmission(t *testing.T) {
	db := openTurnHandlerTestDB(t, "turn_handler_cli_provider_sync")
	handlers, ctx := newCLIAdmissionTestHandlers()

	_, err := handlers.HandleExecuteTurn(ctx, &model.ExecuteTurnRequest{
		ConversationId: "missing-cli-provider-sync",
		AgentId:        "agent-1",
		UserInput:      "hello",
		Provider:       stringPointer("trae-cli"),
		Model:          stringPointer("default"),
	})
	if err == nil || !strings.Contains(err.Error(), "runtime admission authority is required") {
		t.Fatalf("CLI provider did not reach runtime admission: %v", err)
	}
	if strings.Contains(err.Error(), "runtime_not_advertised") {
		t.Fatalf("CLI provider was rejected by the retired handler guard: %v", err)
	}
	assertConversationNotCreated(t, db, "missing-cli-provider-sync")
}

func TestExecuteTurnStreamAllowsCLIProviderToReachRuntimeAdmission(t *testing.T) {
	db := openTurnHandlerTestDB(t, "turn_handler_cli_provider_stream")
	handlers, ctx := newCLIAdmissionTestHandlers()
	body, err := protojson.Marshal(&model.ExecuteTurnRequest{
		ConversationId: "missing-cli-provider-stream",
		AgentId:        "agent-1",
		UserInput:      "hello",
		Provider:       stringPointer("trae-cli"),
		Model:          stringPointer("default"),
	})
	if err != nil {
		t.Fatalf("encode CLI stream request: %v", err)
	}
	response := &fakeStreamResponse{}
	if err := handlers.HandleExecuteTurnStream(
		ctx,
		&fakeTurnRequest{body: body},
		response,
	); err != nil {
		t.Fatalf("execute CLI stream handler: %v", err)
	}
	payload := response.body.String()
	if !strings.Contains(payload, "runtime admission authority is required") {
		t.Fatalf("CLI provider did not reach runtime admission: %q", payload)
	}
	if strings.Contains(payload, "runtime_not_advertised") {
		t.Fatalf("CLI provider was rejected by the retired handler guard: %q", payload)
	}
	assertConversationNotCreated(t, db, "missing-cli-provider-stream")
}

func stringPointer(value string) *string {
	return &value
}
