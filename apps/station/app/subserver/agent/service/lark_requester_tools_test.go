package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

type fakeChannelRequesterToolExecutor struct {
	turnID   string
	toolName string
	args     json.RawMessage
}

func (f *fakeChannelRequesterToolExecutor) ExecuteRequesterTool(
	_ context.Context,
	turnID string,
	toolName string,
	arguments json.RawMessage,
) (string, error) {
	f.turnID = turnID
	f.toolName = toolName
	f.args = append(json.RawMessage(nil), arguments...)
	return `{"ok":true}`, nil
}

func TestRegisterChannelRequesterToolsExposesGovernedManifests(t *testing.T) {
	registry := &ToolRegistryService{tools: make(map[string]*domain.ToolDefinition)}
	executor := &fakeChannelRequesterToolExecutor{}
	RegisterChannelRequesterTools(registry, executor)

	for _, name := range channelRequesterToolNames {
		definitions := registry.Definitions([]string{name})
		if len(definitions) != 1 {
			t.Fatalf("tool %s was not registered", name)
		}
		seed := capabilityToolManifestSeed(definitions[0]).manifest
		if seed.GetSecretBoundary() != "channel-requester" {
			t.Fatalf("tool %s secret boundary = %q", name, seed.GetSecretBoundary())
		}
		write := name == "lark_workspace_write" || name == "lark_api_write"
		if write {
			if seed.GetRiskClass() != "external-write" ||
				seed.GetDefaultApprovalPolicy() !=
					model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_MANUAL {
				t.Fatalf("write tool %s is not manually governed: %+v", name, seed)
			}
		} else if seed.GetRiskClass() != "external-read" ||
			seed.GetDefaultApprovalPolicy() !=
				model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO {
			t.Fatalf("read tool %s has unexpected policy: %+v", name, seed)
		}
	}

	readDefinition := registry.Definitions([]string{"lark_workspace_read"})[0]
	var schema map[string]any
	if err := json.Unmarshal(readDefinition.JSONSchema, &schema); err != nil {
		t.Fatal(err)
	}
	properties, _ := schema["properties"].(map[string]any)
	for _, field := range []string{
		"start_block_id",
		"end_block_id",
		"max_depth",
		"context_before",
		"context_after",
	} {
		if _, ok := properties[field]; !ok {
			t.Fatalf("workspace read schema is missing %s", field)
		}
	}

	result := registry.Dispatch(
		context.Background(),
		&domain.ToolCallMeta{TurnID: "turn-channel"},
		"lark_workspace_read",
		`{"operation":"schema","schema":"drive.files.list"}`,
	)
	if result.IsError || result.Content != `{"ok":true}` {
		t.Fatalf("dispatch result = %+v", result)
	}
	if executor.turnID != "turn-channel" ||
		executor.toolName != "lark_workspace_read" {
		t.Fatalf("executor received turn=%q tool=%q", executor.turnID, executor.toolName)
	}
}
