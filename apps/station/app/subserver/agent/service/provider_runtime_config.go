package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

const (
	defaultCLIProviderTimeoutSeconds = 120
	minCLIProviderTimeoutSeconds     = 10
	maxCLIProviderTimeoutSeconds     = 3600
)

var providerEnvironmentKeyPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func DefaultProviderRuntimeConfig(
	provider *catalog.CatalogProvider,
) *model.ProviderRuntimeConfig {
	if provider == nil {
		return &model.ProviderRuntimeConfig{}
	}
	timeout := provider.DefaultTimeout
	if timeout <= 0 {
		timeout = defaultCLIProviderTimeoutSeconds
	}
	return &model.ProviderRuntimeConfig{
		DefaultModel:   provider.DefaultModel,
		StartupArgs:    []string{},
		Environment:    map[string]string{},
		TimeoutSeconds: int32(timeout),
	}
}

func EffectiveProviderRuntimeConfig(
	provider *catalog.CatalogProvider,
	record *persistence.AgentProvider,
) *model.ProviderRuntimeConfig {
	defaults := DefaultProviderRuntimeConfig(provider)
	if record == nil || len(record.Config) == 0 {
		return defaults
	}
	var configured model.ProviderRuntimeConfig
	if err := json.Unmarshal(record.Config, &configured); err != nil {
		return defaults
	}
	if strings.TrimSpace(configured.DefaultModel) == "" {
		configured.DefaultModel = defaults.DefaultModel
	}
	if configured.TimeoutSeconds <= 0 {
		configured.TimeoutSeconds = defaults.TimeoutSeconds
	}
	if configured.StartupArgs == nil {
		configured.StartupArgs = []string{}
	}
	if configured.Environment == nil {
		configured.Environment = map[string]string{}
	}
	return &configured
}

func EncodeProviderRuntimeConfig(
	provider *catalog.CatalogProvider,
	config *model.ProviderRuntimeConfig,
) ([]byte, error) {
	if err := ValidateProviderRuntimeConfig(provider, config); err != nil {
		return nil, err
	}
	return json.Marshal(config)
}

func ValidateProviderRuntimeConfig(
	provider *catalog.CatalogProvider,
	config *model.ProviderRuntimeConfig,
) error {
	if provider == nil ||
		!strings.EqualFold(strings.TrimSpace(provider.RuntimeKind), providerRuntimeCLI) {
		return fmt.Errorf("runtime configuration is available only for registered CLI providers")
	}
	if config == nil {
		return fmt.Errorf("runtime configuration is required")
	}
	if !provider.SupportsConfiguration("default-model") &&
		strings.TrimSpace(config.DefaultModel) != "" {
		return fmt.Errorf("default model is not configurable for this provider")
	}
	if defaultModel := strings.TrimSpace(config.DefaultModel); defaultModel != "" {
		found := defaultModel == strings.TrimSpace(provider.DefaultModel)
		for _, candidate := range provider.Models {
			if candidate.ID == defaultModel {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("default model is not in the Station model catalog")
		}
	}
	if !provider.SupportsConfiguration("startup-args") && len(config.StartupArgs) > 0 {
		return fmt.Errorf("startup arguments are not configurable for this provider")
	}
	if len(config.StartupArgs) > 64 {
		return fmt.Errorf("startup arguments exceed the allowed count")
	}
	for _, argument := range config.StartupArgs {
		if len(argument) > 4096 || hasProviderControlCharacter(argument) {
			return fmt.Errorf("startup arguments are invalid")
		}
	}
	if !provider.SupportsConfiguration("environment") && len(config.Environment) > 0 {
		return fmt.Errorf("environment is not configurable for this provider")
	}
	if len(config.Environment) > 64 {
		return fmt.Errorf("environment exceeds the allowed entry count")
	}
	for key, value := range config.Environment {
		upperKey := strings.ToUpper(key)
		if !providerEnvironmentKeyPattern.MatchString(key) ||
			len(value) > 8192 ||
			hasProviderControlCharacter(value) {
			return fmt.Errorf("environment contains an invalid entry")
		}
		if upperKey == "PATH" ||
			upperKey == "HOME" ||
			upperKey == "RUST_LOG" ||
			strings.HasPrefix(upperKey, "PEERS_TOUCH_") {
			return fmt.Errorf("environment cannot override Station-owned variables")
		}
		if strings.Contains(upperKey, "SECRET") ||
			strings.Contains(upperKey, "TOKEN") ||
			strings.Contains(upperKey, "PASSWORD") ||
			strings.HasSuffix(upperKey, "_KEY") {
			return fmt.Errorf("secret environment belongs in Station credential storage")
		}
	}
	if !provider.SupportsConfiguration("timeout") &&
		config.TimeoutSeconds != 0 {
		return fmt.Errorf("timeout is not configurable for this provider")
	}
	if config.TimeoutSeconds < minCLIProviderTimeoutSeconds ||
		config.TimeoutSeconds > maxCLIProviderTimeoutSeconds {
		return fmt.Errorf(
			"timeout must be between %d and %d seconds",
			minCLIProviderTimeoutSeconds,
			maxCLIProviderTimeoutSeconds,
		)
	}
	return nil
}

func hasProviderControlCharacter(value string) bool {
	for _, char := range value {
		if char == '\n' || char == '\r' || char == 0 {
			return true
		}
	}
	return false
}

// RuntimeDefaultService owns the actor-scoped explicit default provider/model.
type RuntimeDefaultService struct{}

func NewRuntimeDefaultService() *RuntimeDefaultService {
	return &RuntimeDefaultService{}
}

// GetRuntimeDefault returns the actor's default row. A missing row is reported
// as found=false, not as an error.
func (s *RuntimeDefaultService) GetRuntimeDefault(
	ctx context.Context,
	actorPTID string,
) (*persistence.AgentRuntimeDefault, bool, error) {
	db, err := runtimeDefaultDB(ctx)
	if err != nil {
		return nil, false, err
	}
	var row persistence.AgentRuntimeDefault
	if err := db.WithContext(ctx).
		Where("actor_ptid = ?", actorPTID).
		First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, false, nil
		}
		return nil, false, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to read runtime default", err)
	}
	return &row, true, nil
}

// SetRuntimeDefault upserts the actor's default under optimistic revision
// control. expectedRevision 0 creates the first selection; any other value
// must match the current revision.
func (s *RuntimeDefaultService) SetRuntimeDefault(
	ctx context.Context,
	actorPTID string,
	providerID string,
	modelID string,
	expectedRevision int64,
) (*persistence.AgentRuntimeDefault, error) {
	db, err := runtimeDefaultDB(ctx)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	var existing persistence.AgentRuntimeDefault
	findErr := db.WithContext(ctx).
		Where("actor_ptid = ?", actorPTID).
		First(&existing).Error
	switch {
	case findErr == nil:
		if expectedRevision != 0 && existing.Revision != expectedRevision {
			return nil, errcode.New(errcode.AgentVersionConflict, http.StatusConflict,
				fmt.Sprintf("runtime default revision conflict: current=%d submitted=%d",
					existing.Revision, expectedRevision), nil)
		}
		updates := map[string]any{
			"default_provider_id": providerID,
			"default_model_id":    modelID,
			"revision":            gorm.Expr("revision + 1"),
			"updated_at":          now,
		}
		if err := db.WithContext(ctx).
			Model(&persistence.AgentRuntimeDefault{}).
			Where("id = ?", existing.ID).
			Updates(updates).Error; err != nil {
			return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to update runtime default", err)
		}
		if err := db.WithContext(ctx).
			Where("id = ?", existing.ID).
			First(&existing).Error; err != nil {
			return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to reload runtime default", err)
		}
		return &existing, nil
	case errors.Is(findErr, gorm.ErrRecordNotFound):
		if expectedRevision != 0 {
			return nil, errcode.New(errcode.AgentVersionConflict, http.StatusConflict,
				"runtime default does not exist for the submitted revision", nil)
		}
		row := &persistence.AgentRuntimeDefault{
			ActorPTID:         actorPTID,
			DefaultProviderID: providerID,
			DefaultModelID:    modelID,
			Revision:          1,
			CreatedAt:         now,
			UpdatedAt:         now,
		}
		if err := db.WithContext(ctx).Create(row).Error; err != nil {
			return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to persist runtime default", err)
		}
		return row, nil
	default:
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to query runtime default", findErr)
	}
}

func runtimeDefaultDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"database unavailable", err)
	}
	return db, nil
}
