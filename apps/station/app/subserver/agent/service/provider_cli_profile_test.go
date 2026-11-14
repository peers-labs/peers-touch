package service

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	providercli "github.com/peers-labs/peers-touch/station/app/subserver/agent/service/cli"
	"google.golang.org/protobuf/encoding/protojson"
)

func TestCLIProfileReferencesConnectionWithoutCopyingItsAuthority(t *testing.T) {
	defer setupTestCatalog()()
	cp := catalog.CatalogProvider{ID: "codex-cli", Name: "Codex", Builtin: true, RuntimeKind: "cli", Protocol: "cli",
		CLIArgv: []string{"codex", "exec", "--json", "-"}, CredentialEnvKey: "CODEX_API_KEY",
		BackendProtocols: []string{"responses"}, Capabilities: []string{"streaming"},
		Configurable: []string{"default-model", "startup-args", "environment", "timeout"}, DefaultTimeout: 120}
	catalog.SetForTesting(append(catalog.List(), cp))
	db := openAdmissionTestDB(t, t.Name())
	ctx, owner := context.Background(), StationProviderOwner()
	providers, models := NewProviderConfigService(), NewModelConfigService()
	management := NewProviderManagementService(providers, models, NewCredentialConfigService(), NewRuntimeModelCatalog(), nil, nil)
	backend, err := providers.Create(ctx, ProviderCreateRequest{Scope: owner.Scope, ProviderID: "test-provider", BaseURL: "https://models.example/v1"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := management.SetCredential(ctx, owner, &model.SetCredentialRequest{ProviderId: backend.Name, ApiKey: "private-upstream-key"}); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	capture := filepath.Join(root, "invocation")
	binary := "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$PROFILE_CAPTURE\"\nprintf '%s' \"$CODEX_API_KEY\" > \"$PROFILE_CAPTURE.key\"\ncat > \"$PROFILE_CAPTURE.prompt\"\nprintf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"profile-ok\"}}' '{\"type\":\"turn.completed\"}'\n"
	if err := os.WriteFile(filepath.Join(root, "codex"), []byte(binary), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", root+":"+os.Getenv("PATH"))
	config := &model.ProviderRuntimeConfig{DefaultModel: "test-model", TimeoutSeconds: 120, GlobalPrompt: "shared-profile-prompt",
		Environment: map[string]string{"PROFILE_CAPTURE": capture}}
	created, err := management.Create(ctx, owner, &model.CreateProviderRequest{ProviderId: "team-codex", DisplayName: "Team coding",
		CliAdapterId: cp.ID, BackendProviderId: backend.ID, RuntimeConfig: config})
	if err != nil {
		t.Fatal(err)
	}
	profile := created.Provider
	if profile.Builtin || profile.CliAdapterId != cp.ID || profile.Id == cp.ID || profile.BackendProviderId != backend.ID || profile.ShowApiKey || profile.CredentialStatus != "configured" {
		t.Fatal("profile projection lost its adapter, identity or connection")
	}
	if raw, _ := protojson.Marshal(profile); strings.Contains(string(raw), "private-upstream-key") {
		t.Fatal("management projection exposed the source credential")
	}
	stored, err := providers.GetOwned(ctx, owner, profile.Id)
	if err != nil || stored.KeyVaults != "" {
		t.Fatal("profile copied source credentials")
	}
	if _, err := management.SetCredential(ctx, owner, &model.SetCredentialRequest{ProviderId: profile.Id, ApiKey: "second-key"}); err == nil {
		t.Fatal("a second credential owner was accepted")
	}
	if _, err := providers.SetAccess(ctx, profile.Id, 0, []persistence.ProviderAccessGrant{{ActorPTID: "actor-a", AllModels: true}}); err != nil {
		t.Fatal(err)
	}
	resolver := NewRuntimeAdmissionResolver(providers, models)
	if _, err := resolver.Resolve(ctx, "actor-a", profile.Id, "test-model"); err == nil {
		t.Fatal("profile grant bypassed the source grant")
	}
	if _, err := providers.SetAccess(ctx, backend.Name, 0, []persistence.ProviderAccessGrant{{ActorPTID: "actor-a", ModelID: "test-model"}}); err != nil {
		t.Fatal(err)
	}
	admission, err := resolver.Resolve(ctx, "actor-a", profile.Id, "test-model")
	if err != nil || admission.Capabilities.GetAgentic().GetNativeTools() {
		t.Fatalf("CLI admission did not project its own capabilities: %v", err)
	}
	available, err := resolver.ListAvailableModels(ctx, "actor-a")
	found := false
	for _, item := range available {
		found = found || item.ProviderID == profile.Id && item.ID == "test-model" && item.ProviderName == "Team coding"
	}
	if err != nil || !found {
		t.Fatalf("named CLI profile is missing from the Desktop projection: %v", err)
	}
	if _, err := models.Create(ctx, ModelCreateRequest{Scope: owner.Scope, ProviderID: profile.Id,
		ModelID: "shadow-model", DisplayName: "Shadow", Enabled: true, ContextWindow: 200000}); err == nil {
		t.Fatal("referenced profile acquired a second model-definition owner")
	}
	for _, request := range []*model.CreateProviderRequest{
		{ProviderId: "cycle", CliAdapterId: cp.ID, BackendProviderId: profile.RecordId, RuntimeConfig: config},
		{ProviderId: "test-provider", CliAdapterId: cp.ID, RuntimeConfig: config},
		{ProviderId: "unknown-cli", CliAdapterId: "unregistered", RuntimeConfig: config},
		{ProviderId: "malformed", CliAdapterId: cp.ID, ConfigJson: []byte(`{"default_model":123}`)},
	} {
		if _, err := management.Create(ctx, owner, request); err == nil {
			t.Fatal("invalid CLI identity, source or configuration was accepted")
		}
	}
	calls := NewProviderService(nil)
	calls.SetAdmissionResolver(resolver)
	calls.cliExecutor = providercli.NewExecutor(&providercli.WorkspaceManager{BaseDir: filepath.Join(root, "state")})
	req := &ProviderCallRequest{UserID: "actor-a", ProviderID: profile.Id, ProviderType: profile.Id, Model: "test-model",
		Messages: []domain.Message{{Role: domain.MessageRoleUser, Content: "hello"}}}
	reply, err := calls.Call(ctx, req)
	if err != nil || reply.Content != "profile-ok" {
		t.Fatalf("profile dispatch failed: %v", err)
	}
	args, _ := os.ReadFile(capture)
	key, _ := os.ReadFile(capture + ".key")
	prompt, _ := os.ReadFile(capture + ".prompt")
	if !strings.Contains(string(args), `base_url="https://models.example/v1"`) || strings.Contains(string(args), "private-upstream-key") ||
		string(key) != "private-upstream-key" || !strings.Contains(string(prompt), "shared-profile-prompt") {
		t.Fatal("execution did not consume the referenced connection and prompt")
	}
	req.ExpectedProviderConfigVersion = admission.ProviderConfigVersion
	req.ExpectedCapabilitySourceVersion = admission.Capabilities.Provenance.SourceVersion
	req.BeforeDispatch = func(context.Context) error {
		_, err := providers.SetAccess(ctx, backend.Name, 1, nil)
		return err
	}
	if _, err := calls.Call(ctx, req); err == nil {
		t.Fatal("revocation between admission and dispatch reached the CLI")
	}
	if _, err := providers.SetAccess(ctx, backend.Name, 2, []persistence.ProviderAccessGrant{{ActorPTID: "actor-a", AllModels: true}}); err != nil {
		t.Fatal(err)
	}
	rename := "Renamed profile"
	if _, err := management.Update(ctx, owner, &model.UpdateProviderRequest{ProviderId: profile.Id, Version: profile.Version, DisplayName: &rename}); err != nil {
		t.Fatal(err)
	}
	if _, err := management.Update(ctx, owner, &model.UpdateProviderRequest{ProviderId: profile.Id, Version: profile.Version, RuntimeConfig: config}); err == nil {
		t.Fatal("stale configuration overwrote a newer revision")
	}
	backend, _ = providers.GetOwned(ctx, owner, backend.Name)
	if err := providers.Delete(ctx, ProviderDeleteRequest{Scope: owner.Scope, ProviderID: backend.Name, Version: backend.Version}); err != nil {
		t.Fatal(err)
	}
	if _, err := providers.Create(ctx, ProviderCreateRequest{Scope: owner.Scope, ProviderID: backend.Name}); err != nil {
		t.Fatal(err)
	}
	if _, err := resolver.Resolve(ctx, "actor-a", profile.Id, "test-model"); err == nil {
		t.Fatal("recreating a named source silently rebound a profile")
	}
	if _, err := management.List(ctx, owner); err != nil {
		t.Fatalf("a deleted source blocked all management reads: %v", err)
	}
	// Legacy conversion keeps the resource and grant identity unchanged.
	raw, _ := json.Marshal(config)
	legacy := persistence.AgentProvider{ID: "legacy", Scope: owner.Scope, Name: cp.ID, RuntimeKind: "cli", Protocol: "cli", Config: raw, Version: 7}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := MigrateCLIAdapterIdentities(db); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.First(&legacy, "id = ?", legacy.ID).Error; err != nil || legacy.CLIAdapterID != cp.ID || legacy.Version != 7 {
		t.Fatal("migration changed an existing provider identity or version")
	}
}

func TestCLIProfileDefaultCASAndDeletionPreserveActorDefault(t *testing.T) {
	catalog.RestoreForTesting()
	db := openAdmissionTestDB(t, t.Name())
	if err := db.AutoMigrate(&persistence.AgentRuntimeDefault{}); err != nil {
		t.Fatal(err)
	}
	ctx, owner := context.Background(), StationProviderOwner()
	providers := NewProviderConfigService()
	management := NewProviderManagementService(providers, NewModelConfigService(), NewCredentialConfigService(), nil, nil, nil)
	for _, id := range []string{"team-a", "team-b"} {
		if _, err := management.Create(ctx, owner, &model.CreateProviderRequest{ProviderId: id, CliAdapterId: "codex-cli"}); err != nil {
			t.Fatal(err)
		}
	}
	first, err := management.SetCLIProfileDefault(ctx, owner, &model.SetCLIProfileDefaultRequest{CliAdapterId: "codex-cli", ProviderId: "team-a"})
	if err != nil || first.GetProfileDefault().GetRevision() != 1 {
		t.Fatalf("default profile was not created: %v", err)
	}
	if _, err := management.SetCLIProfileDefault(ctx, owner, &model.SetCLIProfileDefaultRequest{CliAdapterId: "codex-cli", ProviderId: "team-b"}); err == nil {
		t.Fatal("stale revision replaced the default profile")
	}
	if _, err := management.SetCLIProfileDefault(ctx, owner, &model.SetCLIProfileDefaultRequest{CliAdapterId: "claude-cli", ProviderId: "team-a", ExpectedRevision: 1}); err == nil {
		t.Fatal("default profile crossed adapters")
	}
	if _, err := NewRuntimeDefaultService().SetRuntimeDefault(ctx, "actor-a", "personal-default", "personal-model", 0); err != nil {
		t.Fatal(err)
	}
	if _, err := management.Delete(ctx, owner, &model.DeleteProviderRequest{ProviderId: "team-a", Version: 1}); err != nil {
		t.Fatal(err)
	}
	list, err := management.List(ctx, owner)
	if err != nil || len(list.CliProfileDefaults) != 1 ||
		list.CliProfileDefaults[0].ProviderId != "" || list.CliProfileDefaults[0].Revision != 2 {
		t.Fatalf("deletion did not clear the default atomically: %v", err)
	}
	if _, err := management.SetCLIProfileDefault(ctx, owner, &model.SetCLIProfileDefaultRequest{CliAdapterId: "codex-cli", ProviderId: "team-b", ExpectedRevision: 1}); err == nil {
		t.Fatal("stale preference resurrected a deleted default")
	}
	if _, err := management.SetCLIProfileDefault(ctx, owner, &model.SetCLIProfileDefaultRequest{CliAdapterId: "codex-cli", ProviderId: "team-b", ExpectedRevision: 2}); err != nil {
		t.Fatal(err)
	}
	personal, _, err := NewRuntimeDefaultService().GetRuntimeDefault(ctx, "actor-a")
	if err != nil || personal.DefaultProviderID != "personal-default" || personal.Revision != 1 {
		t.Fatal("administrator profile defaults changed an actor's model selection")
	}
}
