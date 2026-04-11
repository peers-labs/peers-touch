// Package infrastructure — AdminRepository provides persistence operations
// for the DashboardAdmin aggregate root.
//
// Change History:
// - 2026-04-10: Initial implementation — full CRUD, super-user retirement.
// - 2026-04-10: Extracted from flat auth.go into DDD infrastructure layer.
package infrastructure

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	"gorm.io/gorm"
)

// AdminRepository defines persistence operations for DashboardAdmin.
type AdminRepository interface {
	Count(ctx context.Context) (int64, error)
	CountNonSuper(ctx context.Context) (int64, error)
	Create(ctx context.Context, admin *domain.DashboardAdmin) error
	FindByUsername(ctx context.Context, username string) (*domain.DashboardAdmin, error)
	FindByID(ctx context.Context, id uint64) (*domain.DashboardAdmin, error)
	FindActiveByID(ctx context.Context, id uint64) (*domain.DashboardAdmin, error)
	ListAll(ctx context.Context) ([]domain.DashboardAdmin, error)
	Update(ctx context.Context, admin *domain.DashboardAdmin, fields map[string]interface{}) error
	Delete(ctx context.Context, admin *domain.DashboardAdmin) error
	RetireSuperUsers(ctx context.Context) error
}

// adminRepository is the GORM-backed implementation of AdminRepository.
type adminRepository struct {
	db *gorm.DB
}

// NewAdminRepository constructs a GORM-backed AdminRepository.
func NewAdminRepository(db *gorm.DB) AdminRepository {
	return &adminRepository{db: db}
}

func (r *adminRepository) Count(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&domain.DashboardAdmin{}).Count(&count).Error
	return count, err
}

func (r *adminRepository) CountNonSuper(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&domain.DashboardAdmin{}).
		Where("is_super_user = ? AND deleted_at IS NULL", false).
		Count(&count).Error
	return count, err
}

func (r *adminRepository) Create(ctx context.Context, admin *domain.DashboardAdmin) error {
	return r.db.WithContext(ctx).Create(admin).Error
}

func (r *adminRepository) FindByUsername(ctx context.Context, username string) (*domain.DashboardAdmin, error) {
	var admin domain.DashboardAdmin
	err := r.db.WithContext(ctx).Where("username = ?", username).First(&admin).Error
	if err != nil {
		return nil, err
	}
	return &admin, nil
}

func (r *adminRepository) FindByID(ctx context.Context, id uint64) (*domain.DashboardAdmin, error) {
	var admin domain.DashboardAdmin
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&admin).Error
	if err != nil {
		return nil, err
	}
	return &admin, nil
}

func (r *adminRepository) FindActiveByID(ctx context.Context, id uint64) (*domain.DashboardAdmin, error) {
	var admin domain.DashboardAdmin
	err := r.db.WithContext(ctx).Where("id = ? AND disabled = ?", id, false).First(&admin).Error
	if err != nil {
		return nil, err
	}
	return &admin, nil
}

func (r *adminRepository) ListAll(ctx context.Context) ([]domain.DashboardAdmin, error) {
	var admins []domain.DashboardAdmin
	err := r.db.WithContext(ctx).Order("created_at ASC").Find(&admins).Error
	return admins, err
}

func (r *adminRepository) Update(ctx context.Context, admin *domain.DashboardAdmin, fields map[string]interface{}) error {
	return r.db.WithContext(ctx).Model(admin).Updates(fields).Error
}

func (r *adminRepository) Delete(ctx context.Context, admin *domain.DashboardAdmin) error {
	return r.db.WithContext(ctx).Delete(admin).Error
}

func (r *adminRepository) RetireSuperUsers(ctx context.Context) error {
	return r.db.WithContext(ctx).Model(&domain.DashboardAdmin{}).
		Where("is_super_user = ? AND disabled = ?", true, false).
		Update("disabled", true).Error
}
