package db

import (
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"gorm.io/gorm"
)

const (
	accessPolicyTable              = "access_gate_policies"
	legacyAllowedActorIDsColumn    = "allowed_actor_ids"
	allowedActorPTIDsColumn        = "allowed_actor_ptids"
	accessAttemptTable             = "access_gate_attempts"
	legacyAccessAttemptActorColumn = "actor_id"
	accessAttemptActorPTIDColumn   = "actor_ptid"
	actorTable                     = "touch_actor"
)

type accessPolicyIdentityRow struct {
	ID                uint64         `gorm:"column:id"`
	AllowedActorIDs   sql.NullString `gorm:"column:allowed_actor_ids"`
	AllowedActorPTIDs sql.NullString `gorm:"column:allowed_actor_ptids"`
}

type accessAttemptIdentityRow struct {
	ID        string         `gorm:"column:id"`
	ActorID   sql.NullInt64  `gorm:"column:actor_id"`
	ActorPTID sql.NullString `gorm:"column:actor_ptid"`
}

// MigrateAccessGateActorIdentity performs the Access Gate PTID hard cut as one
// transaction. Legacy numeric identities are resolved only through
// touch_actor.id -> touch_actor.ptid; missing or divergent mappings abort the
// entire schema and data migration.
func MigrateAccessGateActorIdentity(rds *gorm.DB) error {
	if rds == nil {
		return errors.New("migrate Access Gate actor identity: database is nil")
	}

	hasLegacyPolicies := rds.Migrator().HasTable(accessPolicyTable) &&
		rds.Migrator().HasColumn(accessPolicyTable, legacyAllowedActorIDsColumn)
	hasLegacyAttempts := rds.Migrator().HasTable(accessAttemptTable) &&
		rds.Migrator().HasColumn(accessAttemptTable, legacyAccessAttemptActorColumn)
	if !hasLegacyPolicies && !hasLegacyAttempts {
		return nil
	}

	return rds.Transaction(func(tx *gorm.DB) error {
		if hasLegacyPolicies {
			if err := migrateAccessPolicyActorIdentity(tx); err != nil {
				return err
			}
		}
		if hasLegacyAttempts {
			if err := migrateAccessAttemptActorIdentity(tx); err != nil {
				return err
			}
		}
		return nil
	})
}

func migrateAccessPolicyActorIdentity(tx *gorm.DB) error {
	if err := addColumnIfMissing(
		tx,
		accessPolicyTable,
		allowedActorPTIDsColumn,
		"TEXT",
	); err != nil {
		return fmt.Errorf("add %s.%s: %w", accessPolicyTable, allowedActorPTIDsColumn, err)
	}

	var rows []accessPolicyIdentityRow
	if err := tx.Table(accessPolicyTable).
		Select("id, allowed_actor_ids, allowed_actor_ptids").
		Find(&rows).Error; err != nil {
		return fmt.Errorf("read legacy Access Gate policies: %w", err)
	}

	for _, row := range rows {
		mappedPTIDs, err := resolveLegacyActorIDList(tx, row.AllowedActorIDs.String)
		if err != nil {
			return fmt.Errorf("resolve Access Gate policy %d actor identities: %w", row.ID, err)
		}

		currentPTIDs := normalizeIdentityList(row.AllowedActorPTIDs.String)
		if mappedPTIDs != "" && currentPTIDs != "" && mappedPTIDs != currentPTIDs {
			return fmt.Errorf(
				"Access Gate policy %d has conflicting %s and %s values",
				row.ID,
				legacyAllowedActorIDsColumn,
				allowedActorPTIDsColumn,
			)
		}
		if currentPTIDs == "" && mappedPTIDs != "" {
			if err := tx.Table(accessPolicyTable).
				Where("id = ?", row.ID).
				Update(allowedActorPTIDsColumn, mappedPTIDs).Error; err != nil {
				return fmt.Errorf("backfill Access Gate policy %d PTIDs: %w", row.ID, err)
			}
		}
	}

	if err := dropColumn(tx, accessPolicyTable, legacyAllowedActorIDsColumn); err != nil {
		return fmt.Errorf("drop %s.%s: %w", accessPolicyTable, legacyAllowedActorIDsColumn, err)
	}
	return nil
}

func migrateAccessAttemptActorIdentity(tx *gorm.DB) error {
	if err := addColumnIfMissing(
		tx,
		accessAttemptTable,
		accessAttemptActorPTIDColumn,
		"VARCHAR(255)",
	); err != nil {
		return fmt.Errorf("add %s.%s: %w", accessAttemptTable, accessAttemptActorPTIDColumn, err)
	}

	var rows []accessAttemptIdentityRow
	if err := tx.Table(accessAttemptTable).
		Select("id, actor_id, actor_ptid").
		Find(&rows).Error; err != nil {
		return fmt.Errorf("read legacy Access Gate attempts: %w", err)
	}

	for _, row := range rows {
		mappedPTID := ""
		if row.ActorID.Valid && row.ActorID.Int64 != 0 {
			if row.ActorID.Int64 < 0 {
				return fmt.Errorf(
					"Access Gate attempt %q has invalid actor_id %d",
					row.ID,
					row.ActorID.Int64,
				)
			}
			resolved, err := resolveActorPTID(tx, uint64(row.ActorID.Int64))
			if err != nil {
				return fmt.Errorf("resolve Access Gate attempt %q actor identity: %w", row.ID, err)
			}
			mappedPTID = resolved
		}

		currentPTID := strings.TrimSpace(row.ActorPTID.String)
		if mappedPTID != "" && currentPTID != "" && mappedPTID != currentPTID {
			return fmt.Errorf(
				"Access Gate attempt %q has conflicting %s and %s values",
				row.ID,
				legacyAccessAttemptActorColumn,
				accessAttemptActorPTIDColumn,
			)
		}
		if currentPTID == "" && mappedPTID != "" {
			if err := tx.Table(accessAttemptTable).
				Where("id = ?", row.ID).
				Update(accessAttemptActorPTIDColumn, mappedPTID).Error; err != nil {
				return fmt.Errorf("backfill Access Gate attempt %q PTID: %w", row.ID, err)
			}
		}
	}

	if err := dropColumn(tx, accessAttemptTable, legacyAccessAttemptActorColumn); err != nil {
		return fmt.Errorf("drop %s.%s: %w", accessAttemptTable, legacyAccessAttemptActorColumn, err)
	}
	return nil
}

func resolveLegacyActorIDList(tx *gorm.DB, raw string) (string, error) {
	normalized := normalizeIdentityList(raw)
	if normalized == "" {
		return "", nil
	}

	ids := strings.Split(normalized, ",")
	ptids := make([]string, 0, len(ids))
	for _, rawID := range ids {
		actorID, err := strconv.ParseUint(rawID, 10, 64)
		if err != nil || actorID == 0 {
			return "", fmt.Errorf("invalid actor ID %q", rawID)
		}
		ptid, err := resolveActorPTID(tx, actorID)
		if err != nil {
			return "", err
		}
		ptids = append(ptids, ptid)
	}
	return strings.Join(ptids, ","), nil
}

func resolveActorPTID(tx *gorm.DB, actorID uint64) (string, error) {
	if !tx.Migrator().HasTable(actorTable) {
		return "", fmt.Errorf("%s is missing while resolving actor ID %d", actorTable, actorID)
	}

	var actorPTID sql.NullString
	err := tx.Table(actorTable).
		Select("ptid").
		Where("id = ?", actorID).
		Row().
		Scan(&actorPTID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("actor ID %d is unresolved", actorID)
	}
	if err != nil {
		return "", fmt.Errorf("query actor ID %d: %w", actorID, err)
	}

	ptid := strings.TrimSpace(actorPTID.String)
	if ptid == "" {
		return "", fmt.Errorf("actor ID %d resolves to an empty PTID", actorID)
	}
	return ptid, nil
}

func normalizeIdentityList(raw string) string {
	parts := strings.Split(raw, ",")
	normalized := make([]string, 0, len(parts))
	for _, part := range parts {
		if value := strings.TrimSpace(part); value != "" {
			normalized = append(normalized, value)
		}
	}
	return strings.Join(normalized, ",")
}

func addColumnIfMissing(tx *gorm.DB, table, column, columnType string) error {
	if tx.Migrator().HasColumn(table, column) {
		return nil
	}
	return tx.Exec(fmt.Sprintf(
		"ALTER TABLE %s ADD COLUMN %s %s",
		table,
		column,
		columnType,
	)).Error
}

func dropColumn(tx *gorm.DB, table, column string) error {
	return tx.Exec(fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", table, column)).Error
}
