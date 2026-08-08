package infrastructure

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type CryptoBackupHeadModel struct {
	Ptid           string    `gorm:"column:ptid;size:255;primaryKey"`
	LatestRevision uint64    `gorm:"column:latest_revision;not null"`
	UpdatedAt      time.Time `gorm:"column:updated_at;not null"`
}

func (*CryptoBackupHeadModel) TableName() string { return "key_exchange_crypto_backup_heads" }

type CryptoBackupRevisionModel struct {
	ID             uint      `gorm:"column:id;primaryKey"`
	BackupID       string    `gorm:"column:backup_id;size:64;uniqueIndex;not null"`
	Ptid           string    `gorm:"column:ptid;size:255;uniqueIndex:uidx_crypto_backup_ptid_revision,priority:1;index;not null"`
	Revision       uint64    `gorm:"column:revision;uniqueIndex:uidx_crypto_backup_ptid_revision,priority:2;not null"`
	EncryptedBlob  []byte    `gorm:"column:encrypted_blob;type:bytea;not null"`
	Nonce          []byte    `gorm:"column:nonce;type:bytea;not null"`
	IntegrityTag   []byte    `gorm:"column:integrity_tag;type:bytea;not null"`
	KDFSalt        []byte    `gorm:"column:kdf_salt;type:bytea;not null"`
	KDFMemoryKiB   uint32    `gorm:"column:kdf_memory_cost_kib;not null"`
	KDFTimeCost    uint32    `gorm:"column:kdf_time_cost;not null"`
	KDFParallelism uint32    `gorm:"column:kdf_parallelism;not null"`
	KDFOutputLen   uint32    `gorm:"column:kdf_output_length;not null"`
	CreatedAt      time.Time `gorm:"column:created_at;index;not null"`
}

func (*CryptoBackupRevisionModel) TableName() string {
	return "key_exchange_crypto_backup_revisions"
}

func (*CryptoBackupRevisionModel) BeforeUpdate(*gorm.DB) error {
	return domain.ErrBackupImmutable
}

func (r *GormRepo) PutCryptoBackup(
	ctx context.Context,
	ptid string,
	input domain.NewCryptoBackup,
) (*domain.CryptoBackupRevision, error) {
	var stored CryptoBackupRevisionModel
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := time.Now().UTC()
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).
			Create(&CryptoBackupHeadModel{
				Ptid:      ptid,
				UpdatedAt: now,
			}).Error; err != nil {
			return fmt.Errorf("key_exchange: create crypto backup head: %w", err)
		}

		head := CryptoBackupHeadModel{Ptid: ptid}
		result := tx.Model(&head).
			Clauses(clause.Returning{Columns: []clause.Column{{Name: "latest_revision"}}}).
			Where("ptid = ?", ptid).
			Updates(map[string]any{
				"latest_revision": gorm.Expr("latest_revision + 1"),
				"updated_at":      now,
			})
		if result.Error != nil {
			return fmt.Errorf("key_exchange: advance crypto backup revision: %w", result.Error)
		}
		if result.RowsAffected != 1 || head.LatestRevision == 0 {
			return errors.New("key_exchange: crypto backup revision allocation failed")
		}

		stored = CryptoBackupRevisionModel{
			BackupID:       uuid.NewString(),
			Ptid:           ptid,
			Revision:       head.LatestRevision,
			EncryptedBlob:  append([]byte(nil), input.EncryptedBlob...),
			Nonce:          append([]byte(nil), input.Nonce...),
			IntegrityTag:   append([]byte(nil), input.IntegrityTag...),
			KDFSalt:        append([]byte(nil), input.KDF.Salt...),
			KDFMemoryKiB:   input.KDF.MemoryCostKiB,
			KDFTimeCost:    input.KDF.TimeCost,
			KDFParallelism: input.KDF.Parallelism,
			KDFOutputLen:   input.KDF.OutputLength,
			CreatedAt:      now,
		}
		if err := tx.Create(&stored).Error; err != nil {
			return fmt.Errorf("key_exchange: insert crypto backup revision: %w", err)
		}
		if head.LatestRevision > domain.BackupRetentionLimit {
			oldestRetained := head.LatestRevision - domain.BackupRetentionLimit + 1
			if err := tx.Where("ptid = ? AND revision < ?", ptid, oldestRetained).
				Delete(&CryptoBackupRevisionModel{}).Error; err != nil {
				return fmt.Errorf("key_exchange: prune crypto backup revisions: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return backupModelToDomain(&stored), nil
}

func (r *GormRepo) GetLatestCryptoBackup(
	ctx context.Context,
	ptid string,
) (*domain.CryptoBackupRevision, error) {
	var stored CryptoBackupRevisionModel
	err := r.db.WithContext(ctx).
		Where("ptid = ?", ptid).
		Order("revision DESC").
		Take(&stored).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrBackupNotFound
	}
	if err != nil {
		return nil, err
	}
	return backupModelToDomain(&stored), nil
}

func (r *GormRepo) ListCryptoBackups(
	ctx context.Context,
	ptid string,
	limit int,
) ([]domain.CryptoBackupRevision, error) {
	var stored []CryptoBackupRevisionModel
	if err := r.db.WithContext(ctx).
		Where("ptid = ?", ptid).
		Order("revision DESC").
		Limit(limit).
		Find(&stored).Error; err != nil {
		return nil, err
	}
	backups := make([]domain.CryptoBackupRevision, 0, len(stored))
	for index := range stored {
		backups = append(backups, *backupModelToDomain(&stored[index]))
	}
	return backups, nil
}

func backupModelToDomain(stored *CryptoBackupRevisionModel) *domain.CryptoBackupRevision {
	return &domain.CryptoBackupRevision{
		BackupID:       stored.BackupID,
		Ptid:           stored.Ptid,
		Revision:       stored.Revision,
		EncryptedBlob:  append([]byte(nil), stored.EncryptedBlob...),
		Nonce:          append([]byte(nil), stored.Nonce...),
		IntegrityTag:   append([]byte(nil), stored.IntegrityTag...),
		KDF: domain.BackupKDFParameters{
			Salt:          append([]byte(nil), stored.KDFSalt...),
			MemoryCostKiB: stored.KDFMemoryKiB,
			TimeCost:      stored.KDFTimeCost,
			Parallelism:   stored.KDFParallelism,
			OutputLength:  stored.KDFOutputLen,
		},
		CreatedAt: stored.CreatedAt,
	}
}
