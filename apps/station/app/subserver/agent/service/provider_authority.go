package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

const (
	ProviderScopeActor   = "actor"
	ProviderScopeStation = "station"
)

// ProviderOwner identifies configuration ownership. Execution always keeps
// the authenticated requesting actor separately.
type ProviderOwner struct {
	Scope     string
	ActorPTID string
}

func ActorProviderOwner(actorPTID string) ProviderOwner {
	return ProviderOwner{Scope: ProviderScopeActor, ActorPTID: strings.TrimSpace(actorPTID)}
}

func StationProviderOwner() ProviderOwner {
	return ProviderOwner{Scope: ProviderScopeStation}
}

func (o ProviderOwner) Validate() error {
	if (o.Scope == ProviderScopeActor && o.ActorPTID != "") ||
		(o.Scope == ProviderScopeStation && o.ActorPTID == "") {
		return nil
	}
	return errcode.New(errcode.AgentSecurityViolation, http.StatusForbidden,
		"invalid provider resource owner", nil)
}

func (o ProviderOwner) Query(db *gorm.DB) *gorm.DB {
	return db.Where("scope = ? AND actor_ptid = ?", o.Scope, o.ActorPTID)
}

func providerOwner(provider *persistence.AgentProvider) ProviderOwner {
	scope := provider.Scope
	if scope == "" {
		scope = ProviderScopeActor
	}
	return ProviderOwner{Scope: scope, ActorPTID: provider.ActorPTID}
}

func requestProviderOwner(scope, actorPTID string) ProviderOwner {
	if scope == "" {
		scope = ProviderScopeActor
	}
	return ProviderOwner{Scope: scope, ActorPTID: actorPTID}
}

func (s *ProviderConfigService) validateManagementOwner(ctx context.Context, owner ProviderOwner) error {
	if err := owner.Validate(); err != nil {
		return err
	}
	if owner.Scope == ProviderScopeActor {
		return s.RequirePersonal(ctx, owner.ActorPTID)
	}
	return nil
}

func (s *ProviderConfigService) Policy(ctx context.Context) (*persistence.ProviderPolicy, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	return readProviderPolicy(db.WithContext(ctx))
}

func readProviderPolicy(db *gorm.DB) (*persistence.ProviderPolicy, error) {
	policy := &persistence.ProviderPolicy{ID: "station", AIAllActors: true, AIActorPTIDs: "[]"}
	err := db.First(policy, "id = ?", policy.ID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return policy, nil
	}
	return policy, err
}

func (s *ProviderConfigService) RequirePersonal(ctx context.Context, actorPTID string) error {
	if err := ActorProviderOwner(actorPTID).Validate(); err != nil {
		return err
	}
	policy, err := s.Policy(ctx)
	if err != nil {
		return err
	}
	if !policy.PersonalProvidersEnabled {
		return errcode.New(errcode.AgentSecurityViolation, http.StatusForbidden,
			"personal provider management is disabled by Station policy", nil)
	}
	return nil
}

func (s *ProviderConfigService) SetPolicy(ctx context.Context, req *model.SetProviderPolicyRequest) (*persistence.ProviderPolicy, error) {
	if req == nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "provider policy is required", nil)
	}
	var actorsJSON string
	if access := req.AiUserAccess; access != nil {
		actors := make([]string, 0, len(access.ActorPtids))
		seen := map[string]bool{}
		for _, actor := range access.ActorPtids {
			actor = strings.TrimSpace(actor)
			if actor == "" || access.AllActors || seen[actor] {
				return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "invalid AI user allow list", nil)
			}
			seen[actor] = true
			actors = append(actors, actor)
		}
		sort.Strings(actors)
		data, err := json.Marshal(actors)
		if err != nil {
			return nil, err
		}
		actorsJSON = string(data)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var result *persistence.ProviderPolicy
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).
			Create(&persistence.ProviderPolicy{ID: "station"}).Error; err != nil {
			return err
		}
		policy, err := readProviderPolicy(tx.Clauses(clause.Locking{Strength: "UPDATE"}))
		if err != nil {
			return err
		}
		if policy.Revision != req.Revision {
			return errcode.New(errcode.AgentVersionConflict, http.StatusConflict,
				"provider policy revision changed", nil)
		}
		updates := map[string]any{}
		if policy.PersonalProvidersEnabled != req.PersonalProvidersEnabled {
			updates["personal_providers_enabled"] = req.PersonalProvidersEnabled
		}
		if access := req.AiUserAccess; access != nil &&
			(policy.AIAllActors != access.AllActors || policy.AIActorPTIDs != actorsJSON) {
			updates["ai_all_actors"] = access.AllActors
			updates["ai_actor_ptids"] = actorsJSON
		}
		if len(updates) > 0 {
			nextRevision := policy.Revision + 1
			updates["revision"] = nextRevision
			if err := tx.Model(policy).Updates(updates).Error; err != nil {
				return err
			}
			policy.PersonalProvidersEnabled = req.PersonalProvidersEnabled
			if access := req.AiUserAccess; access != nil {
				policy.AIAllActors, policy.AIActorPTIDs = access.AllActors, actorsJSON
			}
			policy.Revision = nextRevision
		}
		result = policy
		return nil
	})
	return result, err
}

func (s *ProviderConfigService) ListOwned(ctx context.Context, owner ProviderOwner) ([]persistence.AgentProvider, error) {
	if err := owner.Validate(); err != nil {
		return nil, err
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var providers []persistence.AgentProvider
	err = owner.Query(db.WithContext(ctx)).Order("created_at ASC").Find(&providers).Error
	return providers, err
}

func (s *ProviderConfigService) GetOwned(ctx context.Context, owner ProviderOwner, providerID string) (*persistence.AgentProvider, error) {
	if err := owner.Validate(); err != nil {
		return nil, err
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var provider persistence.AgentProvider
	err = owner.Query(db.WithContext(ctx)).First(&provider, "name = ?", providerID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "provider not found", nil)
	}
	return &provider, err
}

// ListEffective selects one owner per logical Provider before applying grants.
// A denied Station Provider cannot be shadowed by a personal Provider.
func (s *ProviderConfigService) ListEffective(ctx context.Context, actorPTID string) ([]persistence.AgentProvider, error) {
	if err := ActorProviderOwner(actorPTID).Validate(); err != nil {
		return nil, err
	}
	shared, err := s.ListOwned(ctx, StationProviderOwner())
	if err != nil {
		return nil, err
	}
	policy, err := s.Policy(ctx)
	if err != nil {
		return nil, err
	}
	if !policy.PersonalProvidersEnabled {
		return shared, nil
	}
	personal, err := s.ListOwned(ctx, ActorProviderOwner(actorPTID))
	if err != nil {
		return nil, err
	}
	names := make(map[string]bool, len(shared))
	for _, provider := range shared {
		names[provider.Name] = true
	}
	for _, provider := range personal {
		if !names[provider.Name] {
			shared = append(shared, provider)
		}
	}
	return shared, nil
}

func (s *ProviderConfigService) ResolveForActor(ctx context.Context, actorPTID, providerID, modelID string) (*persistence.AgentProvider, error) {
	providers, err := s.ListEffective(ctx, actorPTID)
	if err != nil {
		return nil, err
	}
	for i := range providers {
		if providers[i].Name == providerID {
			if err := s.Authorize(ctx, actorPTID, &providers[i], modelID); err != nil {
				return nil, err
			}
			return &providers[i], nil
		}
	}
	return nil, errcode.New(errcode.AgentProviderDisabled, http.StatusForbidden,
		"provider is not authorized for this actor", nil)
}

func (s *ProviderConfigService) Authorize(ctx context.Context, actorPTID string, provider *persistence.AgentProvider, modelID string) error {
	if err := ActorProviderOwner(actorPTID).Validate(); err != nil {
		return err
	}
	policy, err := s.Policy(ctx)
	if err != nil {
		return err
	}
	if !policy.AIAllActors {
		var actors []string
		if err := json.Unmarshal([]byte(policy.AIActorPTIDs), &actors); err != nil {
			return errcode.New(errcode.AgentSecurityViolation, http.StatusForbidden, "AI user policy is unavailable", err)
		}
		allowed := false
		for _, actor := range actors {
			allowed = allowed || actor == actorPTID
		}
		if !allowed {
			return errcode.New(errcode.AgentSecurityViolation, http.StatusForbidden, "AI access is not granted for this user", nil)
		}
	}
	owner := providerOwner(provider)
	if err := owner.Validate(); err != nil {
		return err
	}
	if !provider.Enabled {
		return errcode.New(errcode.AgentProviderDisabled, http.StatusForbidden, "provider is disabled", nil)
	}
	if provider.BackendProviderID != "" {
		backend, err := s.CLIBackend(ctx, provider)
		if err != nil {
			return err
		}
		effective, err := s.ResolveForActor(ctx, actorPTID, backend.Name, modelID)
		if err != nil {
			return err
		}
		if effective.ID != backend.ID {
			return errcode.New(errcode.AgentSecurityViolation, http.StatusForbidden, "model connection is not the effective owner", nil)
		}
	}
	if owner.Scope == ProviderScopeActor {
		if owner.ActorPTID != actorPTID {
			return errcode.New(errcode.AgentSecurityViolation, http.StatusForbidden, "provider belongs to another actor", nil)
		}
		return s.RequirePersonal(ctx, actorPTID)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	query := db.WithContext(ctx).Model(&persistence.ProviderAccessGrant{}).
		Where("provider_record_id = ? AND (all_actors = ? OR actor_ptid = ?)", provider.ID, true, actorPTID)
	if modelID != "" {
		query = query.Where("all_models = ? OR model_id = ?", true, modelID)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return errcode.New(errcode.AgentSecurityViolation, http.StatusForbidden, "provider model access is not granted", nil)
	}
	return nil
}

func (s *ProviderConfigService) CanUse(ctx context.Context, actorPTID string, provider *persistence.AgentProvider, modelID string) (bool, error) {
	err := s.Authorize(ctx, actorPTID, provider, modelID)
	var denied *errcode.BizError
	if errors.As(err, &denied) && denied.HTTPStatus == http.StatusForbidden {
		return false, nil
	}
	return err == nil, err
}

func (s *ProviderConfigService) Access(ctx context.Context, providerID string) (*persistence.AgentProvider, []persistence.ProviderAccessGrant, error) {
	provider, err := s.GetOwned(ctx, StationProviderOwner(), providerID)
	if err != nil {
		return nil, nil, err
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, nil, err
	}
	var grants []persistence.ProviderAccessGrant
	err = db.WithContext(ctx).Where("provider_record_id = ?", provider.ID).
		Order("id ASC").Find(&grants).Error
	return provider, grants, err
}

func (s *ProviderConfigService) SetAccess(ctx context.Context, providerID string, revision int64, grants []persistence.ProviderAccessGrant) (*persistence.AgentProvider, error) {
	seen := map[string]bool{}
	for i := range grants {
		grant := &grants[i]
		grant.ActorPTID = strings.TrimSpace(grant.ActorPTID)
		grant.ModelID = strings.TrimSpace(grant.ModelID)
		if grant.AllActors == (grant.ActorPTID != "") || grant.AllModels == (grant.ModelID != "") {
			return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
				"each grant requires exactly one actor selector and one model selector", nil)
		}
		key := grant.ActorPTID + "\x00" + grant.ModelID
		if seen[key] {
			return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "duplicate provider access grant", nil)
		}
		seen[key] = true
		grant.ID = uuid.NewString()
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var provider persistence.AgentProvider
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := StationProviderOwner().Query(tx).Clauses(clause.Locking{Strength: "UPDATE"}).
			First(&provider, "name = ?", providerID).Error; err != nil {
			return err
		}
		if provider.AccessRevision != revision {
			return errcode.New(errcode.AgentVersionConflict, http.StatusConflict, "provider access revision changed", nil)
		}
		if err := tx.Where("provider_record_id = ?", provider.ID).Delete(&persistence.ProviderAccessGrant{}).Error; err != nil {
			return err
		}
		for i := range grants {
			grants[i].ProviderRecordID = provider.ID
		}
		if len(grants) > 0 {
			if err := tx.Create(&grants).Error; err != nil {
				return err
			}
		}
		provider.AccessRevision++
		return tx.Model(&provider).Update("access_revision", provider.AccessRevision).Error
	})
	return &provider, err
}
