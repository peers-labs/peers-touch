package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

type ProviderConfigService struct{}

func NewProviderConfigService() *ProviderConfigService {
	return &ProviderConfigService{}
}

type ProviderCreateRequest struct {
	Scope             string
	ActorPTID         string
	ProviderID        string
	DisplayName       string
	BaseURL           string
	Protocol          string
	ConfigJSON        []byte
	CLIAdapterID      string
	BackendProviderID string
}

type ProviderUpdateRequest struct {
	Scope             string
	ActorPTID         string
	ProviderID        string
	Version           int64
	DisplayName       *string
	BaseURL           *string
	Enabled           *bool
	ConfigJSON        []byte
	BackendProviderID *string
}

type ProviderDeleteRequest struct {
	Scope      string
	ActorPTID  string
	ProviderID string
	Version    int64
}

func (s *ProviderConfigService) List(ctx context.Context, actorPTID string) ([]persistence.AgentProvider, error) {
	if err := s.RequirePersonal(ctx, actorPTID); err != nil {
		return nil, err
	}
	return s.ListOwned(ctx, ActorProviderOwner(actorPTID))
}

func (s *ProviderConfigService) Create(ctx context.Context, req ProviderCreateRequest) (*persistence.AgentProvider, error) {
	owner := requestProviderOwner(req.Scope, req.ActorPTID)
	if err := s.validateManagementOwner(ctx, owner); err != nil {
		return nil, err
	}
	if req.ProviderID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "provider_id is required", nil)
	}
	if cp := catalog.Find(req.ProviderID); cp != nil && req.CLIAdapterID != "" && cp.ID != req.CLIAdapterID {
		return nil, invalidCLIProfile("a catalog provider identity cannot be assigned to a different CLI")
	}
	if err := validateProviderConfiguration(req.ProviderID, req.ConfigJSON); err != nil {
		return nil, err
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	provider := newProviderRecord(req)
	if err := s.validateCLIProfile(ctx, provider); err != nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "invalid CLI profile", err)
	}
	if !providerRecordSupportedByFrozenProfile(provider) {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"provider runtime is not supported by the active Agent profile", nil)
	}

	if err := db.WithContext(ctx).Create(provider).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to create provider", err)
	}

	logger.Infof(ctx, "provider created: actor_ptid=%s, provider=%s, runtime=%s", req.ActorPTID, req.ProviderID, provider.RuntimeKind)
	return provider, nil
}

// Materialize creates a catalog Provider with its final configuration in one
// write. Version zero means absent and never overwrites a concurrent create.
func (s *ProviderConfigService) Materialize(ctx context.Context, req ProviderUpdateRequest) (*persistence.AgentProvider, error) {
	owner := requestProviderOwner(req.Scope, req.ActorPTID)
	if err := s.validateManagementOwner(ctx, owner); err != nil {
		return nil, err
	}
	if req.Version != 0 || catalog.Find(req.ProviderID) == nil {
		return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "catalog provider not found", nil)
	}
	if err := validateProviderConfiguration(req.ProviderID, req.ConfigJSON); err != nil {
		return nil, err
	}
	record := newProviderRecord(ProviderCreateRequest{Scope: owner.Scope, ActorPTID: owner.ActorPTID,
		ProviderID: req.ProviderID, ConfigJSON: req.ConfigJSON})
	if !providerRecordSupportedByFrozenProfile(record) {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "provider runtime is unsupported", nil)
	}
	if req.DisplayName != nil {
		record.DisplayName = *req.DisplayName
	}
	if req.BaseURL != nil {
		record.BaseURL = *req.BaseURL
	}
	if req.Enabled != nil {
		record.Enabled = *req.Enabled
	}
	if req.BackendProviderID != nil {
		record.BackendProviderID = *req.BackendProviderID
	}
	if err := s.validateCLIProfile(ctx, record); err != nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "invalid CLI profile", err)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	result := db.WithContext(ctx).Table(record.TableName()).
		Clauses(clause.OnConflict{DoNothing: true}).Create(map[string]any{
		"id": record.ID, "scope": record.Scope, "actor_ptid": record.ActorPTID, "name": record.Name,
		"display_name": record.DisplayName, "base_url": record.BaseURL, "config": record.Config,
		"source_type": record.SourceType, "runtime_kind": record.RuntimeKind, "cli_command": record.CliCommand,
		"cli_adapter_id": record.CLIAdapterID, "backend_provider_id": record.BackendProviderID,
		"protocol": record.Protocol, "enabled": record.Enabled, "version": int64(1),
		"access_revision": int64(0), "created_at": now, "updated_at": now,
	})
	if result.Error != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to configure provider", result.Error)
	}
	if result.RowsAffected != 1 {
		return nil, errcode.New(errcode.AgentVersionConflict, http.StatusConflict, "provider was configured concurrently", nil)
	}
	return s.GetOwned(ctx, owner, req.ProviderID)
}

func validateProviderConfiguration(providerID string, raw []byte) error {
	if strings.TrimSpace(providerID) == "" || len(providerID) > 128 {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "provider identity is invalid", nil)
	}
	if len(raw) == 0 {
		return nil
	}
	var config map[string]any
	if len(raw) > 64*1024 || json.Unmarshal(raw, &config) != nil || config == nil {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "provider configuration must be a JSON object", nil)
	}
	var containsSecret func(any) bool
	containsSecret = func(value any) bool {
		switch typed := value.(type) {
		case map[string]any:
			for key, child := range typed {
				key = strings.ToUpper(strings.ReplaceAll(key, "-", "_"))
				if strings.Contains(key, "SECRET") || key == "TOKEN" || strings.HasSuffix(key, "_TOKEN") || strings.Contains(key, "PASSWORD") ||
					key == "APIKEY" || key == "KEY_VAULTS" || strings.HasSuffix(key, "_KEY") || containsSecret(child) {
					return true
				}
			}
		case []any:
			for _, child := range typed {
				if containsSecret(child) {
					return true
				}
			}
		}
		return false
	}
	if containsSecret(config) {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "provider secrets belong in credential storage", nil)
	}
	return nil
}

func newProviderRecord(req ProviderCreateRequest) *persistence.AgentProvider {
	provider := &persistence.AgentProvider{
		ID:                uuid.New().String(),
		Scope:             requestProviderOwner(req.Scope, req.ActorPTID).Scope,
		ActorPTID:         req.ActorPTID,
		Name:              req.ProviderID,
		DisplayName:       req.DisplayName,
		BaseURL:           req.BaseURL,
		Config:            req.ConfigJSON,
		SourceType:        "custom",
		RuntimeKind:       "http",
		Protocol:          req.Protocol,
		Enabled:           true,
		Version:           1,
		CLIAdapterID:      req.CLIAdapterID,
		BackendProviderID: req.BackendProviderID,
	}

	catalogID := req.ProviderID
	if req.CLIAdapterID != "" {
		catalogID = req.CLIAdapterID
		provider.RuntimeKind, provider.Protocol = providerRuntimeCLI, providerRuntimeCLI
	}
	if cp := catalog.Find(catalogID); cp != nil {
		if catalogID == req.ProviderID {
			provider.SourceType = "catalog"
		}
		provider.RuntimeKind = cp.RuntimeKind
		if cp.RuntimeKind == providerRuntimeCLI {
			provider.CLIAdapterID = cp.ID
		}
		provider.CliCommand = catalog.FormatArgv(cp.CLIArgv)
		if provider.DisplayName == "" {
			provider.DisplayName = cp.Name
		}
		if provider.BaseURL == "" {
			provider.BaseURL = cp.DefaultBaseURL
		}
		if provider.Protocol == "" {
			provider.Protocol = cp.Protocol
		}
	}

	return provider
}

// providerUpdateIsNoop reports whether an update request leaves every
// effective provider field unchanged. Runtime config JSON is compared by
// canonicalized value so equivalent formatting never bumps the version.
func providerUpdateIsNoop(provider *persistence.AgentProvider, req ProviderUpdateRequest) bool {
	if req.DisplayName != nil && *req.DisplayName != provider.DisplayName {
		return false
	}
	if req.BaseURL != nil && *req.BaseURL != provider.BaseURL {
		return false
	}
	if req.Enabled != nil && *req.Enabled != provider.Enabled {
		return false
	}
	if req.BackendProviderID != nil && *req.BackendProviderID != provider.BackendProviderID {
		return false
	}
	if len(req.ConfigJSON) > 0 && !canonicalJSONEqual(provider.Config, req.ConfigJSON) {
		return false
	}
	return true
}

// canonicalJSONEqual compares two JSON values by semantic content. Values
// that are not both valid JSON fall back to trimmed byte equality.
func canonicalJSONEqual(current, proposed []byte) bool {
	var currentValue, proposedValue any
	if json.Unmarshal(current, &currentValue) != nil ||
		json.Unmarshal(proposed, &proposedValue) != nil {
		return bytes.Equal(bytes.TrimSpace(current), bytes.TrimSpace(proposed))
	}
	currentCanonical, err := json.Marshal(currentValue)
	if err != nil {
		return false
	}
	proposedCanonical, err := json.Marshal(proposedValue)
	if err != nil {
		return false
	}
	return bytes.Equal(currentCanonical, proposedCanonical)
}

func providerRecordSupportedByFrozenProfile(provider *persistence.AgentProvider) bool {
	if provider == nil {
		return false
	}
	return ProviderRuntimeAdvertised(provider.RuntimeKind, provider.Protocol)
}

func (s *ProviderConfigService) Update(ctx context.Context, req ProviderUpdateRequest) (*persistence.AgentProvider, error) {
	owner := requestProviderOwner(req.Scope, req.ActorPTID)
	if err := s.validateManagementOwner(ctx, owner); err != nil {
		return nil, err
	}
	if err := validateProviderConfiguration(req.ProviderID, req.ConfigJSON); err != nil {
		return nil, err
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var provider persistence.AgentProvider
	if err := owner.Query(db.WithContext(ctx)).
		Where("name = ?", req.ProviderID).
		First(&provider).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound,
				fmt.Sprintf("provider %q not found", req.ProviderID), nil)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to query provider", err)
	}
	if !providerRecordSupportedByFrozenProfile(&provider) {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"provider runtime is not supported by the active Agent profile", nil)
	}

	if provider.Version != req.Version {
		return nil, errcode.New(errcode.AgentVersionConflict, http.StatusConflict,
			fmt.Sprintf("version conflict: current=%d, submitted=%d", provider.Version, req.Version), nil)
	}
	proposed := provider
	if req.BackendProviderID != nil {
		proposed.BackendProviderID = *req.BackendProviderID
	}
	if req.BaseURL != nil {
		proposed.BaseURL = *req.BaseURL
	}
	if req.ConfigJSON != nil {
		proposed.Config = req.ConfigJSON
	}
	if err := s.validateCLIProfile(ctx, &proposed); err != nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "invalid CLI profile", err)
	}

	// A configuration save that changes no effective field must remain a
	// no-op. Provider version participates in the pinned conversation
	// runtime authority, so unconditional bumps wedged every bound
	// conversation after an identical re-configuration.
	if providerUpdateIsNoop(&provider, req) {
		logger.Infof(ctx, "provider update unchanged, keeping version: actor_ptid=%s, provider=%s, version=%d",
			req.ActorPTID, req.ProviderID, provider.Version)
		return &provider, nil
	}

	// A configuration save that changes no effective field must remain a
	// no-op. Provider version participates in the pinned conversation
	// runtime authority, so unconditional bumps wedged every bound
	// conversation after an identical re-configuration.
	if providerUpdateIsNoop(&provider, req) {
		logger.Infof(ctx, "provider update unchanged, keeping version: actor_ptid=%s, provider=%s, version=%d",
			req.ActorPTID, req.ProviderID, provider.Version)
		return &provider, nil
	}

	newVersion := provider.Version + 1
	updates := map[string]interface{}{
		"version":    newVersion,
		"updated_at": time.Now(),
	}
	if req.DisplayName != nil {
		updates["display_name"] = *req.DisplayName
	}
	if req.BaseURL != nil {
		updates["base_url"] = *req.BaseURL
	}
	if req.Enabled != nil {
		updates["enabled"] = *req.Enabled
	}
	if req.ConfigJSON != nil {
		updates["config"] = req.ConfigJSON
	}
	if req.BackendProviderID != nil {
		updates["backend_provider_id"] = *req.BackendProviderID
	}

	result := db.WithContext(ctx).
		Model(&provider).
		Where("version = ?", req.Version).
		Updates(updates)
	if result.Error != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to update provider", result.Error)
	}
	if result.RowsAffected != 1 {
		return nil, errcode.New(errcode.AgentVersionConflict, http.StatusConflict, "provider changed during update", nil)
	}

	// Re-read to return authoritative state
	if err := owner.Query(db.WithContext(ctx)).
		Where("name = ?", req.ProviderID).
		First(&provider).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to re-read provider after update", err)
	}

	logger.Infof(ctx, "provider updated: actor_ptid=%s, provider=%s, version=%d", req.ActorPTID, req.ProviderID, provider.Version)
	return &provider, nil
}

func (s *ProviderConfigService) Delete(ctx context.Context, req ProviderDeleteRequest) error {
	owner := requestProviderOwner(req.Scope, req.ActorPTID)
	if err := s.validateManagementOwner(ctx, owner); err != nil {
		return err
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var provider persistence.AgentProvider
		if err := owner.Query(tx).Clauses(clause.Locking{Strength: "UPDATE"}).Where("name = ?", req.ProviderID).
			First(&provider).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return errcode.New(errcode.AgentNotFound, http.StatusNotFound,
					fmt.Sprintf("provider %q not found", req.ProviderID), nil)
			}
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to query provider", err)
		}

		if provider.Version != req.Version {
			return errcode.New(errcode.AgentVersionConflict, http.StatusConflict,
				fmt.Sprintf("version conflict: current=%d, submitted=%d", provider.Version, req.Version), nil)
		}

		if err := owner.Query(tx).Where("provider = ?", req.ProviderID).
			Delete(&persistence.Credential{}).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to cascade delete credentials", err)
		}

		if err := owner.Query(tx).Where("provider_id = ?", req.ProviderID).
			Delete(&persistence.AgentModel{}).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to cascade delete models", err)
		}

		if err := tx.Where("provider_record_id = ?", provider.ID).Delete(&persistence.ProviderAccessGrant{}).Error; err != nil {
			return err
		}
		if err := owner.Query(tx.Model(&persistence.CLIProfileDefault{})).
			Where("default_provider_record_id = ?", provider.ID).
			Updates(map[string]any{"default_provider_record_id": "", "revision": gorm.Expr("revision + 1"), "updated_at": time.Now().UTC()}).Error; err != nil {
			return err
		}
		if err := tx.Delete(&provider).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to delete provider", err)
		}

		logger.Infof(ctx, "provider deleted with cascade: actor_ptid=%s, provider=%s", req.ActorPTID, req.ProviderID)
		return nil
	})
}

func (s *ProviderConfigService) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"database unavailable", err)
	}
	return db, nil
}

// HideModel appends a model ID to the provider's hidden_models list.
func (s *ProviderConfigService) HideModel(ctx context.Context, actorPTID, providerID, modelID string) error {
	if err := s.RequirePersonal(ctx, actorPTID); err != nil {
		return err
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	var provider persistence.AgentProvider
	if err := db.WithContext(ctx).
		Where("actor_ptid = ? AND name = ?", actorPTID, providerID).
		First(&provider).Error; err != nil {
		return errcode.New(errcode.AgentNotFound, http.StatusNotFound,
			fmt.Sprintf("provider %q not found", providerID), err)
	}

	hidden := parseHiddenModels(provider.HiddenModels)
	for _, h := range hidden {
		if h == modelID {
			return nil
		}
	}
	hidden = append(hidden, modelID)
	hiddenJSON, _ := json.Marshal(hidden)

	if err := db.WithContext(ctx).Model(&provider).
		Update("hidden_models", string(hiddenJSON)).Error; err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to update hidden_models", err)
	}
	return nil
}

// UnhideModel removes a model ID from the provider's hidden_models list.
func (s *ProviderConfigService) UnhideModel(ctx context.Context, actorPTID, providerID, modelID string) error {
	if err := s.RequirePersonal(ctx, actorPTID); err != nil {
		return err
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	var provider persistence.AgentProvider
	if err := db.WithContext(ctx).
		Where("actor_ptid = ? AND name = ?", actorPTID, providerID).
		First(&provider).Error; err != nil {
		return nil
	}

	hidden := parseHiddenModels(provider.HiddenModels)
	if len(hidden) == 0 {
		return nil
	}

	newHidden := make([]string, 0, len(hidden))
	for _, h := range hidden {
		if h != modelID {
			newHidden = append(newHidden, h)
		}
	}
	if len(newHidden) == len(hidden) {
		return nil
	}

	hiddenJSON, _ := json.Marshal(newHidden)
	if err := db.WithContext(ctx).Model(&provider).
		Update("hidden_models", string(hiddenJSON)).Error; err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to update hidden_models", err)
	}
	return nil
}

// GetHiddenModels returns the list of hidden model IDs for a provider.
func (s *ProviderConfigService) GetHiddenModels(ctx context.Context, actorPTID, providerID string) ([]string, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var provider persistence.AgentProvider
	if err := db.WithContext(ctx).
		Where("actor_ptid = ? AND name = ?", actorPTID, providerID).
		First(&provider).Error; err != nil {
		return nil, nil
	}
	return parseHiddenModels(provider.HiddenModels), nil
}

func parseHiddenModels(raw string) []string {
	if raw == "" {
		return nil
	}
	var models []string
	_ = json.Unmarshal([]byte(raw), &models)
	return models
}
