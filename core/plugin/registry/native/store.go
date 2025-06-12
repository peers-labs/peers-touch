package native

import (
	"context"
	"errors"

	log "github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"gorm.io/gorm"
)

// setRegisterRecord saves the RegisterRecord to the database.
// It first checks if the record already exists by ID. If it does, it updates the record;
// otherwise, it creates a new record.
func (r *nativeRegistry) setRegisterRecord(ctx context.Context, record *RegisterRecord) error {
	if record == nil {
		return errors.New("register record cannot be nil")
	}

	rds, err := r.options.Store.RDS(ctx)
	if err != nil {
		log.Warnf(ctx, "[GetUserByName] Get db err: %v", err)
		return err
	}

	var existingRecord RegisterRecord
	err = rds.WithContext(ctx).Where("peer_id =?", record.PeerId).First(&existingRecord).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// Record does not exist, create a new one
			return rds.WithContext(ctx).Create(record).Error
		}
		// Other database errors
		return err
	}

	existingRecord.PeerName = record.PeerName
	existingRecord.EndStationMap = record.EndStationMap
	existingRecord.Version = record.Version
	existingRecord.Signature = record.Signature

	// Record exists, update it
	return rds.WithContext(ctx).Updates(&existingRecord).Error
}

func (r *nativeRegistry) autoMigrate(ctx context.Context) error {
	rds, err := r.options.Store.RDS(ctx)
	if err != nil {
		log.Warnf(ctx, "[GetUserByName] Get db err: %v", err)
		return err
	}

	return rds.AutoMigrate(&RegisterRecord{})
}
