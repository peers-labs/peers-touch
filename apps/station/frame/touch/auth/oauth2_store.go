package auth

import (
	"context"
	"errors"
	"strings"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type OAuth2StateStore struct{}

func NewOAuth2StateStore() *OAuth2StateStore {
	return &OAuth2StateStore{}
}

func (s *OAuth2StateStore) db(ctx context.Context) (*gorm.DB, error) {
	return store.GetRDS(ctx)
}

func (s *OAuth2StateStore) ListProviders(ctx context.Context) ([]*coreauth.ConnectionProvider, error) {
	rds, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	var rows []*db.OAuth2ConnectionState
	if err := rds.WithContext(ctx).Order("provider_id asc").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]*coreauth.ConnectionProvider, 0, len(rows))
	for _, row := range rows {
		item := &coreauth.ConnectionProvider{
			ProviderID:       coreauth.OAuth2ProviderID(row.ProviderID),
			Name:             row.Name,
			Category:         row.Category,
			Status:           coreauth.ConnectionProviderStatus(row.Status),
			HasCredentials:   row.HasCredentials,
			CredentialSource: row.ConfigSource,
			LastError:        row.LastError,
		}
		if row.LastValidatedAt != nil {
			item.LastValidatedAtUnix = row.LastValidatedAt.Unix()
		}
		out = append(out, item)
	}
	return out, nil
}

func (s *OAuth2StateStore) GetProvider(ctx context.Context, providerID coreauth.OAuth2ProviderID) (*coreauth.ConnectionProvider, error) {
	rds, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	var row db.OAuth2ConnectionState
	if err := rds.WithContext(ctx).Where("provider_id = ?", string(providerID)).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	item := &coreauth.ConnectionProvider{
		ProviderID:       coreauth.OAuth2ProviderID(row.ProviderID),
		Name:             row.Name,
		Category:         row.Category,
		Status:           coreauth.ConnectionProviderStatus(row.Status),
		HasCredentials:   row.HasCredentials,
		CredentialSource: row.ConfigSource,
		LastError:        row.LastError,
	}
	if row.LastValidatedAt != nil {
		item.LastValidatedAtUnix = row.LastValidatedAt.Unix()
	}
	return item, nil
}

func (s *OAuth2StateStore) UpsertProvider(ctx context.Context, provider *coreauth.ConnectionProvider) error {
	rds, err := s.db(ctx)
	if err != nil {
		return err
	}
	var validatedAt *time.Time
	if provider.LastValidatedAtUnix > 0 {
		v := time.Unix(provider.LastValidatedAtUnix, 0).UTC()
		validatedAt = &v
	}
	model := &db.OAuth2ConnectionState{
		ProviderID:      string(provider.ProviderID),
		Name:            provider.Name,
		Category:        provider.Category,
		Status:          string(provider.Status),
		HasCredentials:  provider.HasCredentials,
		ConfigSource:    provider.CredentialSource,
		LastError:       provider.LastError,
		LastValidatedAt: validatedAt,
	}
	return rds.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "provider_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"name", "category", "status", "has_credentials", "config_source", "last_error", "last_validated_at", "updated_at"}),
	}).Create(model).Error
}

func (s *OAuth2StateStore) GetByProviderUser(ctx context.Context, providerID coreauth.OAuth2ProviderID, providerUserID string) (*coreauth.OAuth2Identity, uint64, error) {
	rds, err := s.db(ctx)
	if err != nil {
		return nil, 0, err
	}
	var row db.OAuth2IdentityBinding
	if err := rds.WithContext(ctx).
		Where("provider_id = ? AND provider_user_id = ?", string(providerID), providerUserID).
		First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, 0, nil
		}
		return nil, 0, err
	}
	return &coreauth.OAuth2Identity{
		ProviderID:     coreauth.OAuth2ProviderID(row.ProviderID),
		ProviderUserID: row.ProviderUserID,
		ProviderUnion:  row.ProviderUnion,
		Username:       row.Username,
		DisplayName:    row.DisplayName,
		AvatarURL:      row.AvatarURL,
		Email:          row.Email,
	}, row.ActorID, nil
}

func (s *OAuth2StateStore) ListByActor(ctx context.Context, actorID uint64) ([]*coreauth.OAuth2Identity, error) {
	rds, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	var rows []*db.OAuth2IdentityBinding
	if err := rds.WithContext(ctx).
		Where("actor_id = ?", actorID).
		Order("is_primary desc, provider_id asc").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]*coreauth.OAuth2Identity, 0, len(rows))
	for _, row := range rows {
		out = append(out, &coreauth.OAuth2Identity{
			ProviderID:     coreauth.OAuth2ProviderID(row.ProviderID),
			ProviderUserID: row.ProviderUserID,
			ProviderUnion:  row.ProviderUnion,
			Username:       row.Username,
			DisplayName:    row.DisplayName,
			AvatarURL:      row.AvatarURL,
			Email:          row.Email,
		})
	}
	return out, nil
}

func (s *OAuth2StateStore) BindActor(ctx context.Context, actorID uint64, identity *coreauth.OAuth2Identity, primary bool) error {
	rds, err := s.db(ctx)
	if err != nil {
		return err
	}
	return rds.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if primary {
			if err := tx.Model(&db.OAuth2IdentityBinding{}).
				Where("actor_id = ?", actorID).
				Updates(map[string]any{"is_primary": false}).Error; err != nil {
				return err
			}
		}
		model := &db.OAuth2IdentityBinding{
			ActorID:        actorID,
			ProviderID:     string(identity.ProviderID),
			ProviderUserID: identity.ProviderUserID,
			ProviderUnion:  identity.ProviderUnion,
			Username:       identity.Username,
			DisplayName:    identity.DisplayName,
			AvatarURL:      identity.AvatarURL,
			Email:          strings.TrimSpace(identity.Email),
			IsPrimary:      primary,
		}
		return tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "provider_id"}, {Name: "provider_user_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"actor_id", "provider_union", "username", "display_name", "avatar_url", "email", "is_primary", "updated_at"}),
		}).Create(model).Error
	})
}

func (s *OAuth2StateStore) GetByActorProvider(ctx context.Context, actorID uint64, providerID coreauth.OAuth2ProviderID) (*coreauth.OAuth2TokenState, error) {
	rds, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	var row db.OAuth2TokenState
	if err := rds.WithContext(ctx).
		Where("actor_id = ? AND provider_id = ?", actorID, string(providerID)).
		First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	out := &coreauth.OAuth2TokenState{
		ProviderID:   coreauth.OAuth2ProviderID(row.ProviderID),
		AccessToken:  row.AccessToken,
		RefreshToken: row.RefreshToken,
		TokenType:    row.TokenType,
		Scope:        row.Scope,
		Status:       row.Status,
		LastError:    row.LastError,
	}
	if !row.ExpiresAt.IsZero() {
		out.ExpiresAtUnix = row.ExpiresAt.Unix()
	}
	if row.RefreshExpiresAt != nil {
		out.RefreshExpiresAt = row.RefreshExpiresAt.Unix()
	}
	if row.LastRefreshAt != nil {
		out.LastRefreshAtUnix = row.LastRefreshAt.Unix()
	}
	return out, nil
}

func (s *OAuth2StateStore) SaveByActorProvider(ctx context.Context, actorID uint64, token *coreauth.OAuth2TokenState) error {
	rds, err := s.db(ctx)
	if err != nil {
		return err
	}
	var expiresAt time.Time
	if token.ExpiresAtUnix > 0 {
		expiresAt = time.Unix(token.ExpiresAtUnix, 0).UTC()
	}
	var refreshExpiresAt *time.Time
	if token.RefreshExpiresAt > 0 {
		v := time.Unix(token.RefreshExpiresAt, 0).UTC()
		refreshExpiresAt = &v
	}
	var lastRefreshAt *time.Time
	if token.LastRefreshAtUnix > 0 {
		v := time.Unix(token.LastRefreshAtUnix, 0).UTC()
		lastRefreshAt = &v
	}
	model := &db.OAuth2TokenState{
		ActorID:          actorID,
		ProviderID:       string(token.ProviderID),
		AccessToken:      token.AccessToken,
		RefreshToken:     token.RefreshToken,
		TokenType:        token.TokenType,
		Scope:            token.Scope,
		ExpiresAt:        expiresAt,
		RefreshExpiresAt: refreshExpiresAt,
		Status:           token.Status,
		LastRefreshAt:    lastRefreshAt,
		LastError:        token.LastError,
	}
	return rds.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "actor_id"}, {Name: "provider_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"access_token", "refresh_token", "token_type", "scope", "expires_at", "refresh_expires_at", "status", "last_refresh_at", "last_error", "updated_at"}),
	}).Create(model).Error
}

func (s *OAuth2StateStore) MarkReauthRequired(ctx context.Context, actorID uint64, providerID coreauth.OAuth2ProviderID, reason string) error {
	rds, err := s.db(ctx)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	return rds.WithContext(ctx).Model(&db.OAuth2TokenState{}).
		Where("actor_id = ? AND provider_id = ?", actorID, string(providerID)).
		Updates(map[string]any{
			"status":          "reauth_required",
			"last_error":      reason,
			"last_refresh_at": &now,
		}).Error
}
