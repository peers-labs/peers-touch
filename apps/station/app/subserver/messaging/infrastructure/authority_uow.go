package infrastructure

import (
	"context"
	"fmt"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	"gorm.io/gorm"
)

type AuthorityUnitOfWork struct {
	db     *gorm.DB
	limits messaging.QueueLimits
}

func NewAuthorityUnitOfWork(
	db *gorm.DB,
	limits messaging.QueueLimits,
) (*AuthorityUnitOfWork, error) {
	if db == nil {
		return nil, fmt.Errorf("messaging: authority database is required")
	}
	if limits.MaxUnackedItems <= 0 || limits.MaxUnackedBytes <= 0 {
		return nil, fmt.Errorf("messaging: positive device queue limits are required")
	}
	return &AuthorityUnitOfWork{db: db, limits: limits}, nil
}

func (u *AuthorityUnitOfWork) AutoMigrate() error {
	if err := NewAuthorityRepository(u.db).AutoMigrate(); err != nil {
		return err
	}
	if err := NewMlsKeyPackageStore(u.db).AutoMigrate(); err != nil {
		return err
	}
	if err := NewAuthorityPlanRepository(u.db).AutoMigrate(); err != nil {
		return err
	}
	if err := NewFederationRepository(u.db).AutoMigrate(); err != nil {
		return err
	}
	endpointManifests, err := NewEndpointManifestRepository(u.db)
	if err != nil {
		return err
	}
	if err := endpointManifests.AutoMigrate(); err != nil {
		return err
	}
	queue, err := NewQueueRepository(u.db, u.limits)
	if err != nil {
		return err
	}
	return queue.AutoMigrate()
}

func (u *AuthorityUnitOfWork) Execute(
	ctx context.Context,
	fn func(messaging.AuthorityRepositories) error,
) error {
	return u.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		queue, err := NewQueueRepository(tx, u.limits)
		if err != nil {
			return err
		}
		endpointManifests, err := NewEndpointManifestRepository(tx)
		if err != nil {
			return err
		}
		return fn(messaging.AuthorityRepositories{
			Authority:         NewAuthorityRepository(tx),
			Devices:           NewDeviceDirectory(tx),
			Queue:             queue,
			Federation:        NewFederationRepository(tx),
			EndpointManifests: endpointManifests,
			KeyPackages:       NewMlsKeyPackageStore(tx),
			Plans:             NewAuthorityPlanRepository(tx),
		})
	})
}
