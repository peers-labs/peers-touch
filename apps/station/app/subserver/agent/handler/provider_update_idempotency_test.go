package handler

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
)

// TestProviderUpdateKeepsVersionForIdenticalConfig guards pinned
// conversation runtime authority: an unchanged provider re-configuration
// must not bump provider version, otherwise every bound conversation is
// wedged with AgentVersionConflict on its next turn.
func TestProviderUpdateKeepsVersionForIdenticalConfig(t *testing.T) {
	db := openTurnHandlerTestDB(t, "provider_update_idempotency")
	if err := db.AutoMigrate(
		&persistence.AgentProvider{},
		&persistence.Credential{},
	); err != nil {
		t.Fatalf("migrate provider tables: %v", err)
	}

	actorPTID := "ptid:v1:actor:peers:p:provider-idempotency"
	providerID := "ark"
	baseURL := "https://ark-cn-beijing.bytedance.net/api/v3"
	configJSON := []byte(`{"base_url":"` + baseURL + `"}`)
	enabled := true
	if err := db.Create(&persistence.AgentProvider{
		ID:          "provider-idempotency-1",
		ActorPTID:   actorPTID,
		Name:        providerID,
		DisplayName: providerID,
		BaseURL:     baseURL,
		Config:      []byte(`{"base_url":"` + baseURL + `"}`),
		RuntimeKind: "http",
		Protocol:    "openai-compatible",
		Enabled:     true,
		Version:     7,
	}).Error; err != nil {
		t.Fatalf("seed provider: %v", err)
	}

	handlers := NewProviderHandlers(
		service.NewProviderConfigService(),
		service.NewModelConfigService(),
		service.NewCredentialConfigService(),
		service.NewRuntimeAdmissionResolver(
			service.NewProviderConfigService(),
			service.NewModelConfigService(),
		),
		service.NewRuntimeModelCatalog(),
		service.NewProviderModelDiscoveryService(service.NewRuntimeModelCatalog()),
		service.NewRuntimeDefaultService(),
	)
	ctx := coreauth.WithSubject(context.Background(), &coreauth.Subject{ID: actorPTID})

	first, err := handlers.HandleProviderUpdate(ctx, &model.UpdateProviderRequest{
		ProviderId: providerID,
		Version:    7,
		BaseUrl:    &baseURL,
		Enabled:    &enabled,
		ConfigJson: configJSON,
	})
	if err != nil {
		t.Fatalf("identical provider update failed: %v", err)
	}
	if got := first.GetProvider().GetVersion(); got != 7 {
		t.Fatalf("identical update bumped version to %d, want 7", got)
	}

	// A second identical save with the same version must also stay a no-op.
	second, err := handlers.HandleProviderUpdate(ctx, &model.UpdateProviderRequest{
		ProviderId: providerID,
		Version:    7,
		BaseUrl:    &baseURL,
		Enabled:    &enabled,
		ConfigJson: []byte(`{ "base_url": "` + baseURL + `" }`),
	})
	if err != nil {
		t.Fatalf("reformatted identical provider update failed: %v", err)
	}
	if got := second.GetProvider().GetVersion(); got != 7 {
		t.Fatalf("semantically identical update bumped version to %d, want 7", got)
	}

	// A genuine change still advances the optimistic version.
	changedURL := "https://ark.example/alt/api/v3"
	changed, err := handlers.HandleProviderUpdate(ctx, &model.UpdateProviderRequest{
		ProviderId: providerID,
		Version:    7,
		BaseUrl:    &changedURL,
		Enabled:    &enabled,
		ConfigJson: []byte(`{"base_url":"` + changedURL + `"}`),
	})
	if err != nil {
		t.Fatalf("changed provider update failed: %v", err)
	}
	if got := changed.GetProvider().GetVersion(); got != 8 {
		t.Fatalf("effective change version = %d, want 8", got)
	}
}
