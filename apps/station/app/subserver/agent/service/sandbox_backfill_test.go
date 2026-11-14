package service

import (
	"encoding/json"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/sandbox"
)

func localToolDefinition() *domain.ToolDefinition {
	return &domain.ToolDefinition{
		Name:        "local_shell_exec",
		Description: "run a shell command",
		JSONSchema:  json.RawMessage(`{"type":"object"}`),
	}
}

func backfillSeedsForLocalTool() []capabilityManifestSeed {
	definition := localToolDefinition()
	seeds := []capabilityManifestSeed{capabilityToolManifestSeed(definition)}
	if capabilityID, ok := sandbox.SandboxCapabilityForTool(definition.Name); ok {
		seeds = append(seeds, sandboxToolManifestSeed(definition, capabilityID))
	}
	return seeds
}

func configAgent(id, executorKind string) persistence.Agent {
	config := map[string]any{"tools": []string{"local_shell_exec"}}
	if executorKind != "" {
		config["executorKind"] = executorKind
	}
	raw, _ := json.Marshal(config)
	return persistence.Agent{
		ID: id, OwnerActorPTID: "ptid:person:owner", Version: 1, ConfigJSON: string(raw),
	}
}

func TestSandboxToolManifestSeedIsStationOwned(t *testing.T) {
	seed := sandboxToolManifestSeed(localToolDefinition(), sandbox.SandboxCapabilityShellAllowlist)
	m := seed.manifest
	if m.GetExecutionOwner() != model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION {
		t.Fatalf("owner=%v", m.GetExecutionOwner())
	}
	if m.GetSourceKind() != model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_BUILTIN_TOOL {
		t.Fatalf("kind=%v", m.GetSourceKind())
	}
	if m.GetSourceInstanceId() != "local_shell_exec" {
		t.Fatalf("source instance=%q (tool name must be unchanged)", m.GetSourceInstanceId())
	}
	if m.GetCapabilityId() != sandbox.SandboxCapabilityShellAllowlist || m.GetVersion() != "1" {
		t.Fatalf("identity=%s@%s", m.GetCapabilityId(), m.GetVersion())
	}
}

func TestScanAgentConfigsSelectsExecutorByKind(t *testing.T) {
	s := &CapabilityBackfillService{}
	agents := []persistence.Agent{
		configAgent("agent-desktop", ""),
		configAgent("agent-sandbox", "workspace_sandbox"),
	}
	_, bindings, rejections := s.scanAgentConfigs(agents, backfillSeedsForLocalTool(), nil)
	if len(rejections) != 0 {
		t.Fatalf("unexpected rejections: %+v", rejections)
	}
	bound := map[string]string{}
	for _, b := range bindings {
		bound[b.agentID] = b.capabilityID
	}
	if bound["agent-desktop"] != sandbox.CapabilityShellAllowlist {
		t.Fatalf("desktop binding=%q", bound["agent-desktop"])
	}
	if bound["agent-sandbox"] != sandbox.SandboxCapabilityShellAllowlist {
		t.Fatalf("sandbox binding=%q", bound["agent-sandbox"])
	}
}

func TestAgentConfigUsesSandboxExecutor(t *testing.T) {
	sandboxConfig := legacyAgentChatConfig{ExecutorKind: "WORKSPACE_SANDBOX"}
	if !agentConfigUsesSandboxExecutor(sandboxConfig) {
		t.Fatalf("camelCase enum should be recognized")
	}
	snake := legacyAgentChatConfig{ExecutorKindSnake: "workspace_sandbox"}
	if !agentConfigUsesSandboxExecutor(snake) {
		t.Fatalf("snake_case value should be recognized")
	}
	desktop := legacyAgentChatConfig{ExecutorKind: "desktop_device"}
	if agentConfigUsesSandboxExecutor(desktop) {
		t.Fatalf("desktop executor must not be classified as sandbox")
	}
}
