package persistence

import (
	"context"
	"errors"

	actoridentitydomain "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	actoridentitypersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/domain/repository"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Repository struct {
	db *gorm.DB
}

var _ repository.RevisionRepository = (*Repository)(nil)

func NewRepository(db *gorm.DB) (*Repository, error) {
	if db == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			"persistence.new_repository",
			"database",
			"is required",
		)
	}
	return &Repository{db: db}, nil
}

func (r *Repository) Migrate(ctx context.Context) error {
	if err := r.db.WithContext(ctx).AutoMigrate(&RecoveryRevisionModel{}); err != nil {
		return domain.WrapError(
			domain.ErrorCodePersistence,
			"persistence.migrate",
			"recovery_revisions",
			"failed to install the canonical recovery schema",
			err,
		)
	}
	return nil
}

func (r *Repository) StoreRecoveryRevision(
	ctx context.Context,
	revision domain.Revision,
) (repository.StoreResult, error) {
	const operation = "persistence.store_recovery_revision"

	var stored repository.StoreResult
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := requireActiveDeviceForMutation(
			tx,
			revision.PTID,
			revision.CreatedByDeviceID,
			operation,
		); err != nil {
			return err
		}

		model := recoveryRevisionModelFromDomain(revision)
		result := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "revision_id"}},
			DoNothing: true,
		}).Create(&model)
		if result.Error != nil {
			return domain.WrapError(
				domain.ErrorCodePersistence,
				operation,
				"recovery_revisions",
				"failed to insert the immutable revision",
				result.Error,
			)
		}
		if result.RowsAffected == 1 {
			stored = repository.StoreResult{
				Revision: revision.Clone(),
			}

			return nil
		}

		existing, err := readByRevisionID(tx, revision.RevisionID)
		if err != nil {
			return err
		}
		if !existing.SameImmutableContent(revision) {
			return domain.NewError(
				domain.ErrorCodeRevisionConflict,
				operation,
				"revision_id",
				"already identifies different immutable recovery content",
			)
		}
		stored = repository.StoreResult{
			Revision: existing.Clone(),
			Replay:   true,
		}

		return nil
	})
	if err != nil {
		var typed *domain.Error
		if errors.As(err, &typed) {
			return repository.StoreResult{}, err
		}

		return repository.StoreResult{}, domain.WrapError(
			domain.ErrorCodePersistence,
			operation,
			"recovery_revisions",
			"failed to store the immutable revision",
			err,
		)
	}

	return stored, nil
}

func (r *Repository) ReadLatestRecoveryRevision(
	ctx context.Context,
	ptid string,
) (domain.Revision, error) {
	var model RecoveryRevisionModel
	err := r.db.WithContext(ctx).
		Where("ptid = ?", ptid).
		Order("created_at DESC, revision_id DESC").
		First(&model).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.Revision{}, domain.NewError(
			domain.ErrorCodeRevisionNotFound,
			"persistence.read_latest_recovery_revision",
			"ptid",
			"no recovery revision exists for the actor",
		)
	}
	if err != nil {
		return domain.Revision{}, domain.WrapError(
			domain.ErrorCodePersistence,
			"persistence.read_latest_recovery_revision",
			"recovery_revisions",
			"failed to read the latest revision",
			err,
		)
	}
	return recoveryRevisionFromModel(model), nil
}

func readByRevisionID(
	db *gorm.DB,
	revisionID string,
) (domain.Revision, error) {
	var model RecoveryRevisionModel
	err := db.
		Where("revision_id = ?", revisionID).
		First(&model).
		Error
	if err != nil {
		return domain.Revision{}, domain.WrapError(
			domain.ErrorCodePersistence,
			"persistence.read_recovery_revision",
			"revision_id",
			"failed to read the existing immutable revision",
			err,
		)
	}
	return recoveryRevisionFromModel(model), nil
}

func requireActiveDeviceForMutation(
	tx *gorm.DB,
	ptid string,
	deviceID string,
	operation string,
) error {
	err := actoridentitypersistence.RequireActiveDeviceForMutation(
		tx,
		actoridentitypersistence.DeviceLocator{
			PTID:     ptid,
			DeviceID: deviceID,
		},
	)
	if err == nil {
		return nil
	}
	if actoridentitydomain.IsCode(
		err,
		actoridentitydomain.ErrorCodeUnauthorized,
	) {
		return domain.NewError(
			domain.ErrorCodeUnauthorized,
			operation,
			"device_id",
			"is not an active verified actor device",
		)
	}

	return domain.WrapError(
		domain.ErrorCodePersistence,
		operation,
		"actor_devices",
		"failed to authorize the actor device in the mutation transaction",
		err,
	)
}

func recoveryRevisionModelFromDomain(revision domain.Revision) RecoveryRevisionModel {
	return RecoveryRevisionModel{
		RevisionID:             revision.RevisionID,
		PTID:                   revision.PTID,
		FormatVersion:          revision.FormatVersion,
		EncryptedArchive:       append([]byte(nil), revision.EncryptedArchive...),
		EncryptedArchiveSHA256: append([]byte(nil), revision.EncryptedArchiveSHA256...),
		CreatedByDeviceID:      revision.CreatedByDeviceID,
		CreatedAt:              revision.CreatedAt.UTC(),
	}
}

func recoveryRevisionFromModel(model RecoveryRevisionModel) domain.Revision {
	return domain.Revision{
		RevisionID:             model.RevisionID,
		PTID:                   model.PTID,
		FormatVersion:          model.FormatVersion,
		EncryptedArchive:       append([]byte(nil), model.EncryptedArchive...),
		EncryptedArchiveSHA256: append([]byte(nil), model.EncryptedArchiveSHA256...),
		CreatedByDeviceID:      model.CreatedByDeviceID,
		CreatedAt:              model.CreatedAt.UTC(),
	}
}
