package infrastructure

import (
	"bytes"
	"context"
	"errors"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type RecoveryRevisionModel struct {
	RevisionID       string    `gorm:"column:revision_id;size:128;primaryKey"`
	PTID             string    `gorm:"column:ptid;size:255;not null;index:idx_recovery_latest"`
	FormatVersion    uint32    `gorm:"column:format_version;not null"`
	EncryptedArchive []byte    `gorm:"column:encrypted_archive;type:bytea;not null"`
	ArchiveSHA256    []byte    `gorm:"column:archive_sha256;type:bytea;not null"`
	CreatedByDevice  string    `gorm:"column:created_by_device_id;size:255;not null"`
	CreatedAt        time.Time `gorm:"column:created_at;not null;index:idx_recovery_latest"`
}

func (*RecoveryRevisionModel) TableName() string {
	return "messaging_recovery_revisions"
}

type RecoveryRepository struct {
	db *gorm.DB
}

func NewRecoveryRepository(db *gorm.DB) *RecoveryRepository {
	return &RecoveryRepository{db: db}
}

func (r *RecoveryRepository) AutoMigrate() error {
	return r.db.AutoMigrate(&RecoveryRevisionModel{})
}

func (r *RecoveryRepository) PutRecoveryRevision(
	ctx context.Context,
	revision *messaging.RecoveryRevision,
) error {
	model := &RecoveryRevisionModel{
		RevisionID:       revision.RevisionID,
		PTID:             revision.PTID,
		FormatVersion:    revision.FormatVersion,
		EncryptedArchive: revision.EncryptedArchive,
		ArchiveSHA256:    revision.ArchiveSHA256,
		CreatedByDevice:  revision.CreatedByDevice,
		CreatedAt:        revision.CreatedAt,
	}
	result := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(model)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	var existing RecoveryRevisionModel
	if err := r.db.WithContext(ctx).
		Where("revision_id = ?", revision.RevisionID).
		First(&existing).Error; err != nil {
		return err
	}
	if existing.PTID != revision.PTID ||
		existing.FormatVersion != revision.FormatVersion ||
		existing.CreatedByDevice != revision.CreatedByDevice ||
		!bytes.Equal(existing.ArchiveSHA256, revision.ArchiveSHA256) ||
		!bytes.Equal(existing.EncryptedArchive, revision.EncryptedArchive) {
		return messaging.ErrRecoveryIntegrity
	}
	return nil
}

func (r *RecoveryRepository) GetLatestRecoveryRevision(
	ctx context.Context,
	ptid string,
) (*messaging.RecoveryRevision, error) {
	var model RecoveryRevisionModel
	if err := r.db.WithContext(ctx).
		Where("ptid = ?", ptid).
		Order("created_at DESC, revision_id DESC").
		First(&model).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, messaging.ErrNotFound
		}
		return nil, err
	}
	return &messaging.RecoveryRevision{
		RevisionID:       model.RevisionID,
		PTID:             model.PTID,
		FormatVersion:    model.FormatVersion,
		EncryptedArchive: append([]byte(nil), model.EncryptedArchive...),
		ArchiveSHA256:    append([]byte(nil), model.ArchiveSHA256...),
		CreatedByDevice:  model.CreatedByDevice,
		CreatedAt:        model.CreatedAt,
	}, nil
}
