package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

func TestQuickCompletionUsesActorDefaultAndCurrentSharedGrant(t *testing.T) {
	defer setupTestCatalog()()
	db := openAdmissionTestDB(t, "quick_completion_shared_default")
	if err := db.AutoMigrate(&persistence.AgentRuntimeDefault{}); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	providers := NewProviderConfigService()
	var hits atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model    string `json:"model"`
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
			body.Model != "test-model" || len(body.Messages) != 1 ||
			body.Messages[0].Role != "user" || body.Messages[0].Content != "translate this" ||
			r.Header.Get("Authorization") != "Bearer quick-completion-key" {
			t.Error("one-shot completion did not preserve the owner-bound request")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"translated"},"finish_reason":"stop"}]}`))
	}))
	defer upstream.Close()
	record, err := providers.Create(ctx, ProviderCreateRequest{
		Scope: ProviderScopeStation, ProviderID: "test-provider", BaseURL: upstream.URL,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewCredentialConfigService().Set(ctx, CredentialSetRequest{
		Scope: ProviderScopeStation, ProviderID: record.Name, APIKey: "quick-completion-key",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := providers.SetAccess(ctx, record.Name, 0,
		[]persistence.ProviderAccessGrant{{ActorPTID: "actor-a", ModelID: "test-model"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := NewRuntimeDefaultService().SetRuntimeDefault(ctx, "actor-a", record.Name, "test-model", 0); err != nil {
		t.Fatal(err)
	}
	adapter := NewProviderService(nil)
	adapter.SetAdmissionResolver(NewRuntimeAdmissionResolver(providers, NewModelConfigService()))
	service := &TurnService{providerService: adapter}
	config := &TurnConfig{ActorID: "actor-a"}
	content, err := service.QuickCompletion(ctx, config, "translate this")
	if err != nil || content != "translated" || config.Provider != record.Name ||
		config.Model != "test-model" || hits.Load() != 1 {
		t.Fatalf("account default completion failed: %q %+v %v", content, config, err)
	}
	for _, denied := range []*TurnConfig{
		nil, {}, {ActorID: "actor-b"},
		{ActorID: "actor-b", Provider: record.Name, Model: "test-model"},
		{ActorID: "actor-a", Provider: record.Name, Model: "embed-model"},
		{ActorID: "actor-a", Provider: record.Name},
	} {
		if _, err := service.QuickCompletion(ctx, denied, "translate this"); err == nil {
			t.Fatalf("unauthorized one-shot configuration was dispatched: %+v", denied)
		}
	}
	if _, err := providers.SetAccess(ctx, record.Name, 1, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := service.QuickCompletion(ctx, &TurnConfig{ActorID: "actor-a"}, "translate this"); err == nil {
		t.Fatal("default completion reused a revoked shared grant")
	}
	if hits.Load() != 1 {
		t.Fatalf("denied completion reached upstream %d times", hits.Load())
	}
}

func TestProviderControlPlaneSharedDispatchAndRevocation(t *testing.T) {
	defer setupTestCatalog()()
	db := openAdmissionTestDB(t, "control_plane_dispatch")
	ctx := context.Background()
	providers := NewProviderConfigService()
	if _, err := providers.SetPolicy(ctx, &model.SetProviderPolicyRequest{}); err != nil {
		t.Fatal(err)
	}
	var hits atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer owner-bound-test-key" {
			t.Error("dispatch did not use the shared credential")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"control-plane-ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}`))
	}))
	defer upstream.Close()
	record, err := providers.Create(ctx, ProviderCreateRequest{Scope: ProviderScopeStation,
		ProviderID: "test-provider", BaseURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewCredentialConfigService().Set(ctx, CredentialSetRequest{
		Scope: ProviderScopeStation, ProviderID: record.Name, APIKey: "owner-bound-test-key",
	}); err != nil {
		t.Fatal(err)
	}
	resolver := NewRuntimeAdmissionResolver(providers, NewModelConfigService())
	if models, err := resolver.ListAvailableModels(ctx, "actor-a"); err != nil || len(models) != 0 {
		t.Fatalf("ungranted models escaped the catalog: %v %v", models, err)
	}
	grant := []persistence.ProviderAccessGrant{{ActorPTID: "actor-a", ModelID: "test-model"}}
	if _, err := providers.SetAccess(ctx, record.Name, 0, grant); err != nil {
		t.Fatal(err)
	}
	if models, err := resolver.ListAvailableModels(ctx, "actor-a"); err != nil || len(models) != 1 {
		t.Fatalf("granted model missing: %v %v", models, err)
	}
	if _, err := resolver.Resolve(ctx, "actor-b", record.Name, "test-model"); err == nil {
		t.Fatal("another actor used a targeted grant")
	}
	if _, err := resolver.Resolve(ctx, "actor-a", record.Name, "embed-model"); err == nil {
		t.Fatal("a model outside the grant was admitted")
	}
	lease, err := NewCredentialPoolService().Lease(ctx, "actor-a", record.Name, "test-model", domain.RotationRoundRobin)
	if err != nil || lease.CredentialID != record.ID {
		t.Fatalf("lease did not resolve the Station owner: %v %v", lease, err)
	}
	adapter := NewProviderService(nil)
	adapter.SetAdmissionResolver(resolver)
	call := &ProviderCallRequest{UserID: "actor-a", ProviderID: lease.CredentialID,
		ProviderType: record.Name, Model: "test-model", Messages: []domain.Message{{Role: domain.MessageRoleUser, Content: "test"}}}
	result, err := adapter.Call(ctx, call)
	if err != nil || result.Content != "control-plane-ok" || hits.Load() != 1 {
		t.Fatalf("shared HTTP dispatch failed: %v %v", result, err)
	}
	call.UserID = "actor-b"
	if _, err := adapter.Call(ctx, call); err == nil || hits.Load() != 1 {
		t.Fatal("storage UUID bypassed actor authorization")
	}
	call.UserID = "actor-a"
	snapshot, err := resolver.Resolve(ctx, call.UserID, record.Name, call.Model)
	if err != nil {
		t.Fatal(err)
	}
	call.ExpectedProviderConfigVersion = snapshot.ProviderConfigVersion
	call.ExpectedCapabilitySourceVersion = snapshot.Capabilities.GetProvenance().GetSourceVersion()
	call.BeforeDispatch = func(ctx context.Context) error {
		_, err := providers.SetAccess(ctx, record.Name, 1, nil)
		return err
	}
	if _, err := adapter.Call(ctx, call); err == nil || hits.Load() != 1 {
		t.Fatal("revocation between admission and dispatch did not close authority")
	}
	var persisted persistence.AgentProvider
	if err := db.First(&persisted, "id = ?", record.ID).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.Version != 2 {
		t.Fatal("access revocation changed unrelated provider configuration authority")
	}
}

func TestProviderControlPlaneGlobalAIUserPolicy(t *testing.T) {
	defer setupTestCatalog()()
	db := openAdmissionTestDB(t, "control_plane_global_ai_policy")
	if err := db.AutoMigrate(&persistence.AgentRuntimeDefault{}); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	providers := NewProviderConfigService()
	var hits atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer shared-verification-key" {
			t.Error("verification lost the owner-bound credential")
		}
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"OK"},"finish_reason":"stop"}]}`))
	}))
	defer upstream.Close()
	record, err := providers.Create(ctx, ProviderCreateRequest{
		Scope: ProviderScopeStation, ProviderID: "test-provider", BaseURL: upstream.URL,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewCredentialConfigService().Set(ctx, CredentialSetRequest{
		Scope: ProviderScopeStation, ProviderID: record.Name, APIKey: "shared-verification-key",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := providers.SetAccess(ctx, record.Name, 0,
		[]persistence.ProviderAccessGrant{{AllActors: true, ModelID: "test-model"}}); err != nil {
		t.Fatal(err)
	}
	policy, err := providers.SetPolicy(ctx, &model.SetProviderPolicyRequest{
		AiUserAccess: &model.AIUserAccess{ActorPtids: []string{"actor-a"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	resolver := NewRuntimeAdmissionResolver(providers, NewModelConfigService())
	calls := NewProviderService(nil)
	calls.SetAdmissionResolver(resolver)
	management := NewProviderManagementService(providers, NewModelConfigService(),
		NewCredentialConfigService(), NewRuntimeModelCatalog(), nil, nil)
	management.SetProviderService(calls)
	if models, err := resolver.ListAvailableModels(ctx, "actor-a"); err != nil || len(models) != 1 {
		t.Fatalf("globally allowed actor lost a granted model: %v %v", models, err)
	}
	if models, err := resolver.ListAvailableModels(ctx, "actor-b"); err != nil || len(models) != 0 {
		t.Fatalf("globally denied actor received models: %v %v", models, err)
	}
	request := &model.VerifyProviderModelRequest{ProviderId: record.Name, ModelId: "test-model", ActorPtid: "actor-b"}
	if _, err := management.VerifyModel(ctx, request); err == nil || hits.Load() != 0 {
		t.Fatal("administrator verification bypassed global user access")
	}
	request.ActorPtid = "actor-a"
	if result, err := management.VerifyModel(ctx, request); err != nil || !result.GetResponseReceived() || hits.Load() != 1 {
		t.Fatalf("authorized verification did not consume shared configuration: %v %v", result, err)
	}
	admission, err := resolver.Resolve(ctx, "actor-a", record.Name, "test-model")
	if err != nil {
		t.Fatal(err)
	}
	call := &ProviderCallRequest{UserID: "actor-a", ProviderID: record.ID, ProviderType: record.Name, Model: "test-model",
		Messages:                        []domain.Message{{Role: domain.MessageRoleUser, Content: "test"}},
		ExpectedProviderConfigVersion:   admission.ProviderConfigVersion,
		ExpectedCapabilitySourceVersion: admission.Capabilities.GetProvenance().GetSourceVersion(),
		BeforeDispatch: func(ctx context.Context) error {
			var err error
			policy, err = providers.SetPolicy(ctx, &model.SetProviderPolicyRequest{
				Revision: policy.Revision, AiUserAccess: &model.AIUserAccess{},
			})
			return err
		},
	}
	if _, err := calls.Call(ctx, call); err == nil || hits.Load() != 1 {
		t.Fatal("global revocation between admission and dispatch reached upstream")
	}
	if policy.AIAllActors || policy.AIActorPTIDs != "[]" {
		t.Fatal("the dispatch did not commit the empty global AI allow list")
	}
	if _, err := providers.SetPolicy(ctx, &model.SetProviderPolicyRequest{
		Revision: policy.Revision - 1, AiUserAccess: &model.AIUserAccess{AllActors: true},
	}); err == nil {
		t.Fatal("a stale policy restored AI authority")
	}
	if _, err := providers.SetPolicy(ctx, &model.SetProviderPolicyRequest{
		Revision: policy.Revision, PersonalProvidersEnabled: true,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := management.VerifyModel(ctx, request); err == nil || hits.Load() != 1 {
		t.Fatal("personal policy update or empty global list restored AI authority")
	}
}

func TestProviderControlPlaneSecretsFailClosedAndBindOwnership(t *testing.T) {
	defer setupTestCatalog()()
	db := openAdmissionTestDB(t, "control_plane_secrets")
	ctx := context.Background()
	providers := NewProviderConfigService()
	record, err := providers.Create(ctx, ProviderCreateRequest{Scope: ProviderScopeStation, ProviderID: "test-provider"})
	if err != nil {
		t.Fatal(err)
	}
	credentials := NewCredentialConfigService()
	t.Setenv("PT_SECRET_KEK", "")
	t.Setenv("PT_SECRET_KEK_FILE", "")
	if _, err := credentials.Set(ctx, CredentialSetRequest{Scope: ProviderScopeStation, ProviderID: record.Name, APIKey: "secret-value"}); err == nil {
		t.Fatal("credential persistence accepted a missing KEK")
	}
	if err := db.First(record, "id = ?", record.ID).Error; err != nil {
		t.Fatal(err)
	}
	if record.KeyVaults != "" || record.Version != 1 {
		t.Fatal("failed sealing mutated the Provider")
	}
	t.Setenv("PT_SECRET_KEK", "provider-focused-test-key-material")
	status, err := credentials.Set(ctx, CredentialSetRequest{Scope: ProviderScopeStation, ProviderID: record.Name, APIKey: "secret-value"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.First(record, "id = ?", record.ID).Error; err != nil {
		t.Fatal(err)
	}
	if strings.Contains(record.KeyVaults, "secret-value") || !ProviderCredentialConfigured(record) {
		t.Fatal("persisted credential is not encrypted")
	}
	key, err := providerCredentialAPIKey(record)
	if err != nil || key != "secret-value" {
		t.Fatal("owner-bound decryption failed")
	}
	transplanted := *record
	transplanted.Scope, transplanted.ActorPTID = ProviderScopeActor, "actor-a"
	if _, err := providerCredentialAPIKey(&transplanted); err == nil {
		t.Fatal("scope transplant decrypted")
	}
	transplanted = *record
	transplanted.ID = "different-record"
	if _, err := providerCredentialAPIKey(&transplanted); err == nil {
		t.Fatal("record transplant decrypted")
	}
	if _, err := credentials.Resolve(ctx, "actor-a", record.Name); err == nil {
		t.Fatal("actor resolve returned shared credentials")
	}
	if err := credentials.Delete(ctx, CredentialDeleteRequest{Scope: ProviderScopeStation, ProviderID: record.Name, Version: status.Version}); err != nil {
		t.Fatal(err)
	}
	if err := db.First(record, "id = ?", record.ID).Error; err != nil {
		t.Fatal(err)
	}
	if record.KeyVaults != "" || record.Version != 3 {
		t.Fatal("credential deletion did not revoke its provider revision")
	}
}

func TestProviderControlPlaneSharedIdentityPrecedesPersonal(t *testing.T) {
	defer setupTestCatalog()()
	openAdmissionTestDB(t, "control_plane_precedence")
	ctx := context.Background()
	providers := NewProviderConfigService()
	if _, err := providers.Create(ctx, ProviderCreateRequest{Scope: ProviderScopeStation, ProviderID: "test-provider"}); err != nil {
		t.Fatal(err)
	}
	if _, err := providers.Create(ctx, ProviderCreateRequest{ActorPTID: "actor-a", ProviderID: "test-provider"}); err != nil {
		t.Fatal(err)
	}
	if _, err := providers.ResolveForActor(ctx, "actor-a", "test-provider", "test-model"); err == nil {
		t.Fatal("a personal record shadowed denied shared authority")
	}
	if _, err := providers.SetPolicy(ctx, &model.SetProviderPolicyRequest{}); err != nil {
		t.Fatal(err)
	}
	if _, err := providers.Create(ctx, ProviderCreateRequest{ActorPTID: "actor-a", ProviderID: "private"}); err == nil {
		t.Fatal("personal management bypassed Station policy")
	}
	if _, err := providers.ListOwned(ctx, ActorProviderOwner("")); err == nil {
		t.Fatal("empty actor selected a shared owner")
	}
	if _, err := providers.ListOwned(ctx, ProviderOwner{Scope: ProviderScopeStation, ActorPTID: "actor-a"}); err == nil {
		t.Fatal("ambiguous shared owner was accepted")
	}
}
