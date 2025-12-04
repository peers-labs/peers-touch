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

func NewStore(db *gorm.DB) *StoreImpl { return &StoreImpl{db: db} }

func (s *StoreImpl) AutoMigrate() error {
	return s.db.AutoMigrate(&Identity{}, &Key{}, &Binding{}, &Alias{})
}

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

func (s *StoreImpl) CreateIdentity(ctx context.Context, m *Identity) error {
	return s.db.WithContext(ctx).Create(m).Error
}

func (s *StoreImpl) CreateKey(ctx context.Context, k *Key) error {
	return s.db.WithContext(ctx).Create(k).Error
}

func (s *StoreImpl) CreateBinding(ctx context.Context, b *Binding) error {
	return s.db.WithContext(ctx).Create(b).Error
}
