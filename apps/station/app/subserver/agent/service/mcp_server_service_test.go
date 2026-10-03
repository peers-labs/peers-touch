package service

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMCPStationStdioExecutesWithoutClientLease(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 is required for the stdio MCP fixture")
	}
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(
		&persistence.McpServer{},
		&persistence.McpServerRevision{},
		&persistence.McpServerCommand{},
		&persistence.CapabilityManifest{},
	); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	registry := NewToolRegistryService(nil, nil)
	authority := NewCapabilityAuthorityService(db)
	service := NewMcpServerService(db, authority, registry)
	script := writeStationMcpFixture(t)

	request := &model.UpsertMcpServerRequest{
		Server: &model.McpServer{
			Name:           "station-fixture",
			Title:          "Station fixture",
			Transport:      model.McpTransport_MCP_TRANSPORT_STDIO,
			ExecutionOwner: model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION,
			Command:        "python3",
			Args:           []string{script},
			Enabled:        true,
		},
		IdempotencyKey: "station-fixture-create",
		StationSecrets: &model.McpServerSecrets{
			Env: map[string]string{"FIXTURE_SECRET": "station-secret-canary"},
		},
	}
	response, err := service.Upsert(
		context.Background(),
		"ptid:person:station-mcp",
		request,
	)
	if err != nil {
		t.Fatalf("upsert Station MCP server: %v", err)
	}
	server := response.GetServer()
	if server.GetStatus() != model.McpServerStatus_MCP_SERVER_STATUS_READY {
		t.Fatalf("server status = %s, want READY", server.GetStatus())
	}
	if len(server.GetTools()) != 1 || len(response.GetManifests()) != 1 {
		t.Fatalf("tool projection = %d manifests = %d, want 1/1", len(server.GetTools()), len(response.GetManifests()))
	}
	manifest := response.GetManifests()[0]
	if manifest.GetExecutionOwner() != model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION {
		t.Fatalf("manifest owner = %s, want STATION", manifest.GetExecutionOwner())
	}
	if manifest.GetSourceInstanceId() != server.GetTools()[0].GetProviderToolName() {
		t.Fatal("manifest source must resolve the provider-visible MCP tool name")
	}
	projected, err := json.Marshal(server)
	if err != nil {
		t.Fatalf("marshal MCP projection: %v", err)
	}
	if strings.Contains(string(projected), "station-secret-canary") {
		t.Fatal("MCP read projection exposed Station-local secret material")
	}

	result := registry.Dispatch(
		context.Background(),
		&domain.ToolCallMeta{ActorID: "ptid:person:station-mcp"},
		server.GetTools()[0].GetProviderToolName(),
		`{"value":"offline-desktop"}`,
	)
	if result.IsError || !strings.Contains(result.Content, "offline-desktop") {
		t.Fatalf("Station MCP dispatch result = %+v", result)
	}
	replay, err := service.Upsert(
		context.Background(),
		"ptid:person:station-mcp",
		request,
	)
	if err != nil || !replay.GetReplayed() ||
		replay.GetServer().GetRevision() != server.GetRevision() {
		t.Fatalf("MCP upsert replay = %+v, err=%v", replay, err)
	}
}

func TestMCPOwnerChangeRetiresPinnedManifest(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 is required for the stdio MCP fixture")
	}
	db, err := gorm.Open(sqlite.Open("file:owner-change?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(
		&persistence.McpServer{},
		&persistence.McpServerRevision{},
		&persistence.McpServerCommand{},
		&persistence.CapabilityManifest{},
	); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	registry := NewToolRegistryService(nil, nil)
	service := NewMcpServerService(db, NewCapabilityAuthorityService(db), registry)
	script := writeStationMcpFixture(t)
	created, err := service.Upsert(
		context.Background(),
		"ptid:person:owner-change",
		&model.UpsertMcpServerRequest{
			Server: &model.McpServer{
				Name:           "owner-change",
				Transport:      model.McpTransport_MCP_TRANSPORT_STDIO,
				ExecutionOwner: model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION,
				Command:        "python3",
				Args:           []string{script},
				Enabled:        true,
			},
			IdempotencyKey: "owner-change-create",
		},
	)
	if err != nil {
		t.Fatalf("create Station MCP server: %v", err)
	}
	oldManifest := created.GetManifests()[0]
	changed, err := service.Upsert(
		context.Background(),
		"ptid:person:owner-change",
		&model.UpsertMcpServerRequest{
			Server: &model.McpServer{
				ServerId:       created.GetServer().GetServerId(),
				Name:           "owner-change",
				Transport:      model.McpTransport_MCP_TRANSPORT_STDIO,
				ExecutionOwner: model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY,
				Command:        "python3",
				Args:           []string{script},
				Enabled:        true,
				Tools: []*model.McpToolDescriptor{{
					ToolName:        "echo",
					Description:     "Echo",
					InputSchemaJson: `{"type":"object","properties":{"value":{"type":"string"}}}`,
				}},
			},
			ExpectedRevision: 1,
			IdempotencyKey:   "owner-change-client",
		},
	)
	if err != nil {
		t.Fatalf("change MCP owner: %v", err)
	}
	if changed.GetManifests()[0].GetExecutionOwner() !=
		model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY {
		t.Fatal("new MCP manifest did not pin CLIENT_CAPABILITY owner")
	}
	if changed.GetManifests()[0].GetSourceInstanceId() ==
		oldManifest.GetSourceInstanceId() {
		t.Fatal("MCP owner change reused the old provider tool identity")
	}
	var historical persistence.CapabilityManifest
	if err := db.Where(
		"capability_id = ? AND version = ?",
		oldManifest.GetCapabilityId(),
		oldManifest.GetVersion(),
	).First(&historical).Error; err != nil {
		t.Fatalf("load historical manifest: %v", err)
	}
	if historical.RetiredAt == nil ||
		historical.ExecutionOwner != int32(model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION) {
		t.Fatal("owner change did not retain and retire the Station-pinned manifest")
	}
	result := registry.Dispatch(
		context.Background(),
		&domain.ToolCallMeta{ActorID: "ptid:person:owner-change"},
		oldManifest.GetSourceInstanceId(),
		`{"value":"pinned-owner"}`,
	)
	if result.IsError || !strings.Contains(result.Content, "pinned-owner") {
		t.Fatalf("in-flight Station-owned MCP call lost its pinned runtime: %+v", result)
	}
}

func TestMCPClientOwnerRejectsStationSecretsAndCrossActorReads(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:client-secret-boundary?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(
		&persistence.McpServer{},
		&persistence.McpServerRevision{},
		&persistence.McpServerCommand{},
		&persistence.CapabilityManifest{},
	); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	service := NewMcpServerService(
		db,
		NewCapabilityAuthorityService(db),
		NewToolRegistryService(nil, nil),
	)
	request := &model.UpsertMcpServerRequest{
		Server: &model.McpServer{
			Name:           "desktop-fixture",
			Transport:      model.McpTransport_MCP_TRANSPORT_STDIO,
			ExecutionOwner: model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY,
			Command:        "python3",
			Args:           []string{"fixture.py"},
			Enabled:        true,
			Tools: []*model.McpToolDescriptor{{
				ToolName:        "echo",
				InputSchemaJson: `{"type":"object","properties":{}}`,
			}},
		},
		IdempotencyKey: "desktop-fixture-create",
		StationSecrets: &model.McpServerSecrets{
			Env: map[string]string{"TOKEN": "must-stay-on-desktop"},
		},
	}
	if _, err := service.Upsert(
		context.Background(),
		"ptid:person:desktop-owner",
		request,
	); err == nil {
		t.Fatal("client-owned MCP accepted Station-side secret material")
	}
	request.StationSecrets = nil
	created, err := service.Upsert(
		context.Background(),
		"ptid:person:desktop-owner",
		request,
	)
	if err != nil {
		t.Fatalf("create client-owned MCP server: %v", err)
	}
	if _, err := service.Get(
		context.Background(),
		"ptid:person:other",
		&model.GetMcpServerRequest{ServerId: created.GetServer().GetServerId()},
	); err == nil {
		t.Fatal("cross-actor MCP read succeeded")
	}
}

func writeStationMcpFixture(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "mcp_fixture.py")
	script := `import json
import os
import sys

def read_frame():
    line = sys.stdin.buffer.readline()
    if not line:
        return None
    return json.loads(line)

def write_frame(value):
    body = json.dumps(value, separators=(",", ":")).encode() + b"\n"
    sys.stdout.buffer.write(body)
    sys.stdout.buffer.flush()

while True:
    request = read_frame()
    if request is None:
        break
    method = request.get("method")
    if method == "notifications/initialized":
        continue
    if method == "initialize":
        result = {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "fixture", "version": "1"}}
    elif method == "tools/list":
        result = {"tools": [{"name": "echo", "description": "Echo", "inputSchema": {"type": "object", "properties": {"value": {"type": "string"}}}}]}
    elif method == "tools/call":
        result = {"content": [{"type": "text", "text": request["params"]["arguments"].get("value", "")}], "secretSeen": bool(os.environ.get("FIXTURE_SECRET"))}
    else:
        result = {}
    write_frame({"jsonrpc": "2.0", "id": request.get("id"), "result": result})
`
	if err := os.WriteFile(path, []byte(script), 0o600); err != nil {
		t.Fatalf("write MCP fixture: %v", err)
	}
	return path
}
