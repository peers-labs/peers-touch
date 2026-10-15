package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const postgresClusterIdentityLock = int64(0x5054434c55535449)

type postgresClusterIdentityRecord struct {
	Scope     string    `gorm:"column:scope;size:32;primaryKey"`
	Identity  string    `gorm:"column:identity;size:64;not null;uniqueIndex"`
	CreatedAt time.Time `gorm:"column:created_at;not null"`
}

func (postgresClusterIdentityRecord) TableName() string {
	return "station_cluster_identity"
}

// PostgresClusterIdentity returns a credential-free identity for one
// PostgreSQL database. Cluster admission compares this value across nodes so a
// node cannot become ready against a different database with a compatible
// schema.
func PostgresClusterIdentity(
	ctx context.Context,
	database *gorm.DB,
) (string, error) {
	if database == nil || database.Dialector.Name() != "postgres" {
		return "", fmt.Errorf("cluster backing requires PostgreSQL")
	}
	var record postgresClusterIdentityRecord
	if err := database.WithContext(ctx).
		First(&record, "scope = ?", "station").Error; err != nil {
		return "", fmt.Errorf("read PostgreSQL cluster backing identity: %w", err)
	}
	decoded, err := hex.DecodeString(strings.TrimSpace(record.Identity))
	if err != nil || len(decoded) != 32 {
		return "", fmt.Errorf("PostgreSQL cluster backing identity is invalid")
	}
	return record.Identity, nil
}

// MigratePostgresClusterIdentity creates the persistent, database-owned
// cluster identity before readiness evaluation begins.
func MigratePostgresClusterIdentity(
	ctx context.Context,
	database *gorm.DB,
) error {
	if database == nil || database.Dialector.Name() != "postgres" {
		return fmt.Errorf("cluster backing requires PostgreSQL")
	}
	var randomIdentity [32]byte
	if _, err := rand.Read(randomIdentity[:]); err != nil {
		return fmt.Errorf("generate PostgreSQL cluster backing identity: %w", err)
	}
	return database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(
			"SELECT pg_advisory_xact_lock(?)",
			postgresClusterIdentityLock,
		).Error; err != nil {
			return fmt.Errorf("lock PostgreSQL cluster backing identity: %w", err)
		}
		if err := tx.AutoMigrate(&postgresClusterIdentityRecord{}); err != nil {
			return fmt.Errorf("migrate PostgreSQL cluster backing identity: %w", err)
		}
		record := postgresClusterIdentityRecord{
			Scope:     "station",
			Identity:  hex.EncodeToString(randomIdentity[:]),
			CreatedAt: time.Now().UTC(),
		}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).
			Create(&record).Error; err != nil {
			return fmt.Errorf("create PostgreSQL cluster backing identity: %w", err)
		}
		return nil
	})
}
