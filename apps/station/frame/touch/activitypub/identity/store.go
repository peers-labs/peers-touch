package identity

import (
	"context"
	"errors"
	"gorm.io/gorm"
)

// StoreImpl implements the identity.Store interface using GORM
type StoreImpl struct {
	db *gorm.DB
}

// NewStore returns a GORM-backed identity store.
func NewStore(db *gorm.DB) *StoreImpl { return &StoreImpl{db: db} }

// AutoMigrate runs schema migrations for identity tables.
func (s *StoreImpl) AutoMigrate() error {
	return s.db.AutoMigrate(&Identity{}, &Key{}, &Binding{}, &Alias{})
}

// GetIdentityByPTID finds an identity by PTID.
func (s *StoreImpl) GetIdentityByPTID(ctx context.Context, ptid string) (*Identity, error) {
	var m Identity
	if err := s.db.WithContext(ctx).Where("ptid = ?", ptid).First(&m).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &m, nil
}

// GetIdentityByID finds an identity by numeric ID.
func (s *StoreImpl) GetIdentityByID(ctx context.Context, id uint64) (*Identity, error) {
	var m Identity
	if err := s.db.WithContext(ctx).First(&m, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &m, nil
}

// GetIdentityByAlias finds an identity via alias string.
func (s *StoreImpl) GetIdentityByAlias(ctx context.Context, alias string) (*Identity, error) {
	var a Alias
	if err := s.db.WithContext(ctx).Where("alias = ?", alias).First(&a).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	var m Identity
	if err := s.db.WithContext(ctx).First(&m, a.IdentityID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &m, nil
}

// GetBinding retrieves a binding by provider and provider ID.
func (s *StoreImpl) GetBinding(ctx context.Context, provider, providerID string) (*Binding, error) {
	var b Binding
	if err := s.db.WithContext(ctx).Where("provider = ? AND provider_id = ?", provider, providerID).First(&b).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &b, nil
}

// CreateIdentity inserts a new identity row.
func (s *StoreImpl) CreateIdentity(ctx context.Context, m *Identity) error {
	return s.db.WithContext(ctx).Create(m).Error
}

// CreateKey inserts a new key row.
func (s *StoreImpl) CreateKey(ctx context.Context, k *Key) error {
	return s.db.WithContext(ctx).Create(k).Error
}

// CreateBinding inserts a new binding row.
func (s *StoreImpl) CreateBinding(ctx context.Context, b *Binding) error {
	return s.db.WithContext(ctx).Create(b).Error
}
