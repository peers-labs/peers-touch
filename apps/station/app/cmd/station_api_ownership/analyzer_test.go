package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestAnalyzePassesForDeclaredCanonicalRoute(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "docs/registry.yaml", `
schema_version: 1
status: accepted_target
scope: test
activation:
  state: active
  gate_enabled: true
  requirements: []
governed_prefixes: [/conversation/]
owner_roots:
  station.conversation:
    - apps/station/app/subserver/conversation/subserver.go
ddd_layers:
  - name: conversation.domain
    root: apps/station/app/subserver/conversation/domain
    forbidden_imports: [net/http]
capabilities:
  - id: chat.create
    domain_owner: station.conversation
    truth_owner: conversation.authority
    exposure: client
    canonical_route: {method: POST, path: /conversation/create}
    request_proto: peers_touch.model.chat.v1.CreateRequest
    response_proto: peers_touch.model.chat.v1.CreateResponse
    truth_stores: [conversations]
    allowed_dependencies: []
    forbidden_aliases: []
    superseded_symbols: []
target_absent_routes: []
target_absent_prefixes: [/messaging/]
target_absent_truth_stores: []
`)
	writeFixture(t, root, "apps/station/app/subserver/conversation/subserver.go", `
package conversation

import "github.com/peers-labs/peers-touch/station/frame/core/server"

const routeBase = "/conversation"
const createRoute = routeBase + "/create"

func handlers() {
	// server.NewTypedHandler("comment-only", "/conversation/comment-only", server.POST, nil)
	_ = server.NewTypedHandler[CreateRequest, CreateResponse](
		"conversation-create",
		createRoute,
		server.POST,
		nil,
	)
}
`)
	writeFixture(t, root, "model/domain/chat/chat.proto", `
syntax = "proto3";
package peers_touch.model.chat.v1;
message CreateRequest {}
message CreateResponse {}
`)

	report := analyze(testOptions(root))
	if report.Status != "PASS" {
		t.Fatalf("status = %s, diagnostics = %+v", report.Status, report.Diagnostics)
	}
	if len(report.Routes) != 1 {
		t.Fatalf("routes = %d, want 1", len(report.Routes))
	}
	if report.Routes[0].Path != "/conversation/create" ||
		report.Routes[0].Method != "POST" {
		t.Fatalf("unexpected route: %+v", report.Routes[0])
	}
}

func TestAnalyzeReportsEveryFailClosedOwnershipCondition(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "docs/registry.yaml", `
schema_version: 1
status: accepted_target
scope: test
activation:
  state: active
  gate_enabled: true
  requirements: []
governed_prefixes:
  - /conversation/
  - /device/
  - /messaging/
owner_roots:
  station.conversation:
    - apps/station/app/subserver/owner
ddd_layers:
  - name: conversation.domain
    root: apps/station/app/subserver/conversation/domain
    forbidden_imports: [net/http]
capabilities:
  - id: chat.canonical
    domain_owner: station.conversation
    truth_owner: conversation.authority
    exposure: client
    canonical_route: {method: POST, path: /conversation/canonical}
    request_proto: peers_touch.model.chat.v1.CanonicalRequest
    response_proto: peers_touch.model.chat.v1.CanonicalResponse
    truth_stores: [conversations]
    allowed_dependencies: []
    forbidden_aliases:
      - {method: POST, path: /messaging/canonical}
    superseded_symbols:
      - peers_touch.model.chat.v1.SupersededRequest
  - id: chat.missing
    domain_owner: station.conversation
    truth_owner: conversation.authority
    exposure: client
    canonical_route: {method: POST, path: /conversation/missing}
    request_proto: peers_touch.model.chat.v1.MissingRequest
    response_proto: peers_touch.model.chat.v1.CanonicalResponse
    truth_stores: [conversations]
    allowed_dependencies: []
    forbidden_aliases: []
    superseded_symbols: []
target_absent_routes:
  - {method: POST, path: /device/register}
target_absent_prefixes:
  - /messaging/
target_absent_truth_stores:
  - forbidden_truth
`)
	writeFixture(t, root, "apps/station/app/subserver/wrong/subserver.go", `
package wrong

import "github.com/peers-labs/peers-touch/station/frame/core/server"

func handlers() {
	_ = server.NewTypedHandler("canonical-one", "/conversation/canonical", server.POST, nil)
	_ = server.NewTypedHandler("canonical-two", "/conversation/canonical", server.POST, nil)
	_ = server.NewTypedHandler("undeclared", "/conversation/extra", server.GET, nil)
	_ = server.NewTypedHandler("alias", "/messaging/canonical", server.POST, nil)
	_ = server.NewTypedHandler("prefix", "/messaging/other", server.GET, nil)
	_ = server.NewTypedHandler("absent", "/device/register", server.POST, nil)
}

type staleModel struct{}

func (staleModel) TableName() string { return "forbidden_truth" }
`)
	writeFixture(t, root, "model/domain/chat/chat.proto", `
syntax = "proto3";
package peers_touch.model.chat.v1;
message CanonicalRequest {}
message CanonicalResponse {}
message SupersededRequest {}
`)

	report := analyze(testOptions(root))
	if report.Status != "FAIL" {
		t.Fatalf("status = %s, want FAIL", report.Status)
	}

	codes := make(map[string]bool)
	for _, item := range report.Diagnostics {
		codes[item.Code] = true
	}
	for _, code := range []string{
		"duplicate_method_path",
		"forbidden_alias",
		"forbidden_prefix",
		"forbidden_route",
		"forbidden_truth_store_identifier",
		"missing_canonical_proto_symbol",
		"missing_canonical_route",
		"owner_root_mismatch",
		"superseded_proto_symbol",
		"undeclared_governed_route",
	} {
		if !codes[code] {
			t.Errorf("missing diagnostic code %q in %+v", code, report.Diagnostics)
		}
	}
}

func TestAnalyzeProducesDeterministicJSON(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "docs/registry.yaml", `
schema_version: 1
status: accepted_target
scope: test
activation:
  state: active
  gate_enabled: true
  requirements: []
governed_prefixes: [/conversation/]
owner_roots: {}
ddd_layers:
  - name: conversation.domain
    root: apps/station/app/subserver/conversation/domain
    forbidden_imports: [net/http]
capabilities:
  - id: chat.missing
    domain_owner: station.conversation
    truth_owner: conversation.authority
    exposure: client
    canonical_route: {method: POST, path: /conversation/missing}
    request_proto: peers_touch.model.chat.v1.Request
    response_proto: peers_touch.model.chat.v1.Response
    truth_stores: []
    allowed_dependencies: []
    forbidden_aliases: []
    superseded_symbols: []
target_absent_routes: []
target_absent_prefixes: []
target_absent_truth_stores: []
`)
	writeFixture(t, root, "apps/station/app/subserver/conversation/subserver.go", `
package conversation

import "github.com/peers-labs/peers-touch/station/frame/core/server"

func handlers() {
	_ = server.NewTypedHandler("z", "/conversation/z", server.POST, nil)
	_ = server.NewTypedHandler("a", "/conversation/a", server.GET, nil)
}
`)
	writeFixture(t, root, "model/domain/chat/chat.proto", `
syntax = "proto3";
package peers_touch.model.chat.v1;
message Request {}
message Response {}
`)

	first, err := json.Marshal(analyze(testOptions(root)))
	if err != nil {
		t.Fatalf("marshal first report: %v", err)
	}
	second, err := json.Marshal(analyze(testOptions(root)))
	if err != nil {
		t.Fatalf("marshal second report: %v", err)
	}
	if string(first) != string(second) {
		t.Fatalf("reports differ:\nfirst:  %s\nsecond: %s", first, second)
	}
}

func TestAnalyzeRejectsForbiddenConversationDDDImport(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "docs/registry.yaml", `
schema_version: 1
status: accepted_target
scope: test
activation:
  state: active
  gate_enabled: true
  requirements: []
governed_prefixes: [/conversation/]
owner_roots: {}
ddd_layers:
  - name: conversation.domain
    root: apps/station/app/subserver/conversation/domain
    forbidden_imports:
      - net/http
      - gorm.io
capabilities: []
target_absent_routes: []
target_absent_prefixes: []
target_absent_truth_stores: []
`)
	writeFixture(t, root, "apps/station/app/subserver/conversation/domain/aggregate.go", `
package domain

import "net/http"

var _ = http.MethodGet
`)
	writeFixture(t, root, "apps/station/app/subserver/conversation/domain/aggregate_test.go", `
package domain_test

import "gorm.io/gorm"

var _ *gorm.DB
`)

	report := analyze(testOptions(root))
	if report.Status != "FAIL" {
		t.Fatalf("status = %s, want FAIL", report.Status)
	}
	if len(report.Diagnostics) != 1 {
		t.Fatalf("diagnostics = %+v, want exactly one forbidden import", report.Diagnostics)
	}
	item := report.Diagnostics[0]
	if item.Code != "forbidden_ddd_import" ||
		item.Identifier != "net/http" ||
		item.Owner != "conversation.domain" {
		t.Fatalf("unexpected diagnostic: %+v", item)
	}
}

func TestContainsIdentifierFindsTruthStoreInsideSQL(t *testing.T) {
	for _, value := range []string{
		"messaging_events",
		"SELECT * FROM messaging_events WHERE conversation_id = ?",
		"JOIN messaging_events AS events ON events.id = receipts.event_id",
	} {
		if !containsIdentifier(value, "messaging_events") {
			t.Fatalf("expected truth-store identifier in %q", value)
		}
	}
	for _, value := range []string{
		"messaging_events_archive",
		"prefix_messaging_events",
	} {
		if containsIdentifier(value, "messaging_events") {
			t.Fatalf("matched non-identifier occurrence in %q", value)
		}
	}
}

func testOptions(root string) analysisOptions {
	return analysisOptions{
		Root:              root,
		RegistryPath:      "docs/registry.yaml",
		RegistrationRoots: []string{"apps/station/app"},
		SourceRoots:       []string{"apps/station/app", "model/domain"},
		ProtoRoots:        []string{"model/domain"},
	}
}

func writeFixture(t *testing.T, root, relativePath, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(relativePath))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("create fixture directory: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write fixture %s: %v", relativePath, err)
	}
}
