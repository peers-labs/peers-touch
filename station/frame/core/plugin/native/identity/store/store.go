package store

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/frame/core/identity/model"

	"gorm.io/gorm"
)

// Store implements the resolver.Store interface using GORM
type Store struct {
	db *gorm.DB
}

// NewStore creates a new Store instance
func NewStore(db *gorm.DB) *Store {
	return &Store{
		db: db,
	}
}

// AutoMigrate migrates the database schema
func (s *Store) AutoMigrate() error {
	return s.db.AutoMigrate(
		&model.Identity{},
		&model.Key{},
		&model.Binding{},
		&model.Alias{},
	)
}

// GetIdentityByPTID retrieves an identity by its PTID string
func (s *Store) GetIdentityByPTID(ctx context.Context, ptid string) (*model.Identity, error) {
	var identity model.Identity
	if err := s.db.WithContext(ctx).Where("ptid = ?", ptid).First(&identity).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &identity, nil
}

// GetIdentityByID retrieves an identity by its ID
func (s *Store) GetIdentityByID(ctx context.Context, id uint64) (*model.Identity, error) {
	var identity model.Identity
	if err := s.db.WithContext(ctx).First(&identity, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &identity, nil
}

// GetIdentityByAlias retrieves an identity by one of its aliases
func (s *Store) GetIdentityByAlias(ctx context.Context, alias string) (*model.Identity, error) {
	var aliasRecord model.Alias
	if err := s.db.WithContext(ctx).Where("alias = ?", alias).First(&aliasRecord).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}

	var identity model.Identity
	if err := s.db.WithContext(ctx).First(&identity, aliasRecord.IdentityID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}

	return &identity, nil
}

// GetBinding retrieves a binding by provider and provider ID
func (s *Store) GetBinding(ctx context.Context, provider, providerID string) (*model.Binding, error) {
	var binding model.Binding
	if err := s.db.WithContext(ctx).Where("provider = ? AND provider_id = ?", provider, providerID).First(&binding).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &binding, nil
}

// CreateIdentity creates a new identity
func (s *Store) CreateIdentity(ctx context.Context, identity *model.Identity) error {
	return s.db.WithContext(ctx).Create(identity).Error
}

// CreateKey creates a new key
func (s *Store) CreateKey(ctx context.Context, key *model.Key) error {
	return s.db.WithContext(ctx).Create(key).Error
}

// CreateBinding creates a new binding
func (s *Store) CreateBinding(ctx context.Context, binding *model.Binding) error {
	return s.db.WithContext(ctx).Create(binding).Error
}
