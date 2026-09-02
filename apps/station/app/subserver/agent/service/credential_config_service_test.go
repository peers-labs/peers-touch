package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
)

func TestCredentialSetMaterializesCatalogProviderAndUpdatesCredential(t *testing.T) {
	db := openCredentialConfigTestDB(t)
	service := NewCredentialConfigService()
	ctx := context.Background()
	request := CredentialSetRequest{
		ActorPTID:  "actor-a",
		ProviderID: "ark",
		APIKey:     "test-key-with-\"-quote",
	}

	status, err := service.setWithDB(ctx, db, request)
	if err != nil {
		t.Fatalf("set first credential: %v", err)
	}
	if !status.Configured || status.Status != "active" || status.Version != 1 {
		t.Fatalf("unexpected first credential status: %+v", status)
	}

	var provider persistence.AgentProvider
	if err := db.Where("actor_ptid = ? AND name = ?", request.ActorPTID, request.ProviderID).
		First(&provider).Error; err != nil {
		t.Fatalf("read materialized provider: %v", err)
	}
	if provider.SourceType != "catalog" {
		t.Fatalf("provider source = %q, want catalog", provider.SourceType)
	}
	if provider.BaseURL != "https://ark.cn-beijing.volces.com/api/v3" {
		t.Fatalf("provider base URL = %q", provider.BaseURL)
	}

	var vault map[string]string
	if err := json.Unmarshal([]byte(provider.KeyVaults), &vault); err != nil {
		t.Fatalf("decode key vault: %v", err)
	}
	if vault["api_key"] != request.APIKey {
		t.Fatal("structured key vault did not preserve the credential")
	}

	request.APIKey = "replacement-key"
	status, err = service.setWithDB(ctx, db, request)
	if err != nil {
		t.Fatalf("replace credential: %v", err)
	}
	if status.Version != 2 {
		t.Fatalf("replacement credential version = %d, want 2", status.Version)
	}

	var providerCount int64
	if err := db.Model(&persistence.AgentProvider{}).
		Where("actor_ptid = ? AND name = ?", request.ActorPTID, request.ProviderID).
		Count(&providerCount).Error; err != nil {
		t.Fatalf("count providers: %v", err)
	}
	if providerCount != 1 {
		t.Fatalf("provider count = %d, want 1", providerCount)
	}
}

func TestCredentialSetRejectsUnknownProviderWithoutCreatingRecord(t *testing.T) {
	db := openCredentialConfigTestDB(t)
	service := NewCredentialConfigService()
	request := CredentialSetRequest{
		ActorPTID:  "actor-a",
		ProviderID: "unknown-provider",
		APIKey:     "test-key",
	}

	if _, err := service.setWithDB(context.Background(), db, request); err == nil {
		t.Fatal("expected unknown provider credential registration to fail")
	}

	var count int64
	if err := db.Model(&persistence.AgentProvider{}).Count(&count).Error; err != nil {
		t.Fatalf("count providers: %v", err)
	}
	if count != 0 {
		t.Fatalf("unknown provider created %d provider records", count)
	}
}

func openCredentialConfigTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := "file:" + uuid.NewString() + "?mode=memory&cache=shared"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&persistence.AgentProvider{}, &persistence.Credential{}); err != nil {
		t.Fatalf("migrate credential config tables: %v", err)
	}
	return db
}
