package infrastructure

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"gorm.io/gorm"
)

type DeviceRepository struct {
	store *touchactor.DeviceStore
}

func NewDeviceRepository(db *gorm.DB) (*DeviceRepository, error) {
	if db == nil {
		return nil, fmt.Errorf("messaging: device repository database is required")
	}
	return &DeviceRepository{store: touchactor.NewDeviceStore(db)}, nil
}

func (r *DeviceRepository) AutoMigrate() error {
	return r.store.AutoMigrate()
}

func (r *DeviceRepository) EnrollVerifiedDevice(
	ctx context.Context,
	enrollment domain.VerifiedDeviceEnrollment,
) error {
	return r.store.EnrollVerifiedLocal(ctx, touchactor.VerifiedLocalDeviceEnrollment{
		PTID:                      enrollment.PTID,
		DeviceID:                  enrollment.DeviceID,
		Label:                     enrollment.Label,
		HomeStationPeerID:         enrollment.HomeStationID,
		ActorIdentityPublicKey:    enrollment.ActorIdentityPublicKey,
		ActorIdentityFingerprint:  enrollment.ActorIdentityFingerprint,
		DeviceSigningPublicKey:    enrollment.DeviceSigningPublicKey,
		SigningKeyID:              enrollment.SigningKeyID,
		ProfileVersion:            enrollment.ProfileVersion,
		CanonicalCertificateBytes: enrollment.CanonicalCertificateBytes,
		ActorCrossSignature:       enrollment.ActorCrossSignature,
	})
}

var _ domain.DeviceEnrollmentRepository = (*DeviceRepository)(nil)
