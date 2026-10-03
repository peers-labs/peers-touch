package auth

import (
	"context"
	"errors"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	db "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// OAuth2IdentityStore implements coreauth.OAuth2IdentityStore backed by GORM.
// Stateless: every method resolves *gorm.DB via store.GetRDS(ctx).
type OAuth2IdentityStore struct{}

var _ coreauth.OAuth2IdentityStore = (*OAuth2IdentityStore)(nil)

var identityStore *OAuth2IdentityStore

// GetOAuth2IdentityStore returns the package-level OAuth2IdentityStore instance.
func GetOAuth2IdentityStore() *OAuth2IdentityStore {
	if identityStore == nil {
		identityStore = &OAuth2IdentityStore{}
	}
	return identityStore
}

// GetByProviderUser looks up an OAuth2 identity binding by provider + provider user ID.
// Returns (nil, 0, gorm.ErrRecordNotFound) when no record exists.
func (s *OAuth2IdentityStore) GetByProviderUser(
	ctx context.Context,
	providerID coreauth.OAuth2ProviderID,
	providerUserID string,
) (*coreauth.OAuth2Identity, uint64, error) {

	rds, err := store.GetRDS(ctx)
	if err != nil {
		log.Warnf(ctx, "[OAuth2IdentityStore.GetByProviderUser] get db: %v", err)
		return nil, 0, err
	}

	var row db.OAuth2IdentityBinding
	err = rds.
		Where("provider_id = ? AND provider_user_id = ?", string(providerID), providerUserID).
		First(&row).Error

	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, 0, gorm.ErrRecordNotFound
	}
	if err != nil {
		log.Warnf(ctx, "[OAuth2IdentityStore.GetByProviderUser] query: %v", err)
		return nil, 0, err
	}

	return rowToIdentity(&row), row.ActorID, nil
}

// ListByActor returns all OAuth2 identity bindings for a given actor.
func (s *OAuth2IdentityStore) ListByActor(
	ctx context.Context,
	actorID uint64,
) ([]*coreauth.OAuth2Identity, error) {

	rds, err := store.GetRDS(ctx)
	if err != nil {
		log.Warnf(ctx, "[OAuth2IdentityStore.ListByActor] get db: %v", err)
		return nil, err
	}

	var rows []db.OAuth2IdentityBinding
	if err = rds.Where("actor_id = ?", actorID).Find(&rows).Error; err != nil {
		log.Warnf(ctx, "[OAuth2IdentityStore.ListByActor] query: %v", err)
		return nil, err
	}

	out := make([]*coreauth.OAuth2Identity, 0, len(rows))
	for i := range rows {
		out = append(out, rowToIdentity(&rows[i]))
	}
	return out, nil
}

// BindActor creates or updates an OAuth2 identity binding.
// Upsert: if (provider_id, provider_user_id) already exists, update; else insert.
func (s *OAuth2IdentityStore) BindActor(
	ctx context.Context,
	actorID uint64,
	identity *coreauth.OAuth2Identity,
	primary bool,
) error {

	rds, err := store.GetRDS(ctx)
	if err != nil {
		log.Warnf(ctx, "[OAuth2IdentityStore.BindActor] get db: %v", err)
		return err
	}
	return bindOAuthIdentity(ctx, rds, actorID, identity, primary)
}

func bindOAuthIdentity(
	ctx context.Context,
	rds *gorm.DB,
	actorID uint64,
	identity *coreauth.OAuth2Identity,
	primary bool,
) error {
	var existing db.OAuth2IdentityBinding
	err := rds.
		Where("provider_id = ? AND provider_user_id = ?", string(identity.ProviderID), identity.ProviderUserID).
		First(&existing).Error

	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		log.Warnf(ctx, "[OAuth2IdentityStore.BindActor] lookup: %v", err)
		return err
	}

	if errors.Is(err, gorm.ErrRecordNotFound) {
		row := db.OAuth2IdentityBinding{
			ActorID:        actorID,
			ProviderID:     string(identity.ProviderID),
			ProviderUserID: identity.ProviderUserID,
			ProviderUnion:  identity.ProviderUnion,
			Username:       identity.Username,
			DisplayName:    identity.DisplayName,
			AvatarURL:      identity.AvatarURL,
			Email:          identity.Email,
			EmailVerified:  identity.EmailVerified,
			IsPrimary:      primary,
		}
		if err = rds.Create(&row).Error; err != nil {
			log.Warnf(ctx, "[OAuth2IdentityStore.BindActor] create: %v", err)
			return err
		}
		log.Infof(ctx, "[OAuth2IdentityStore.BindActor] bound actor=%d provider=%s user=%s",
			actorID, identity.ProviderID, identity.ProviderUserID)
		return nil
	}
	if existing.ActorID != actorID {
		return coreauth.ErrOAuthIdentityConflict
	}

	updates := map[string]interface{}{
		"provider_union": identity.ProviderUnion,
		"username":       identity.Username,
		"display_name":   identity.DisplayName,
		"avatar_url":     identity.AvatarURL,
		"email":          identity.Email,
		"email_verified": identity.EmailVerified,
	}
	if primary {
		updates["is_primary"] = true
	}
	if err = rds.Model(&existing).Updates(updates).Error; err != nil {
		log.Warnf(ctx, "[OAuth2IdentityStore.BindActor] update: %v", err)
		return err
	}

	log.Infof(ctx, "[OAuth2IdentityStore.BindActor] updated actor=%d provider=%s user=%s",
		actorID, identity.ProviderID, identity.ProviderUserID)
	return nil
}

func rowToIdentity(row *db.OAuth2IdentityBinding) *coreauth.OAuth2Identity {
	return &coreauth.OAuth2Identity{
		ProviderID:     coreauth.OAuth2ProviderID(row.ProviderID),
		ProviderUserID: row.ProviderUserID,
		ProviderUnion:  row.ProviderUnion,
		Username:       row.Username,
		DisplayName:    row.DisplayName,
		AvatarURL:      row.AvatarURL,
		Email:          row.Email,
		EmailVerified:  row.EmailVerified,
	}
}
