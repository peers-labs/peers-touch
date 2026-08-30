package schema

import (
	"fmt"

	"gorm.io/gorm"
)

const (
	noteTable            = "official_applet_notes"
	legacyOwnerColumn    = "owner_id"
	canonicalOwnerColumn = "owner_ptid"
)

// MigrateOwnerPTIDColumn performs the one-way Note owner naming cut before
// AutoMigrate observes the canonical model.
func MigrateOwnerPTIDColumn(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("note owner PTID migration requires database")
	}
	if !db.Migrator().HasTable(noteTable) {
		return nil
	}

	return db.Transaction(func(tx *gorm.DB) error {
		hasLegacy := tx.Migrator().HasColumn(noteTable, legacyOwnerColumn)
		hasCanonical := tx.Migrator().HasColumn(noteTable, canonicalOwnerColumn)

		if hasLegacy && hasCanonical {
			return fmt.Errorf(
				"migrate %s owner identity: both %s and %s exist",
				noteTable,
				legacyOwnerColumn,
				canonicalOwnerColumn,
			)
		}
		if !hasLegacy {
			return nil
		}
		if err := tx.Migrator().RenameColumn(noteTable, legacyOwnerColumn, canonicalOwnerColumn); err != nil {
			return fmt.Errorf(
				"rename %s.%s to %s: %w",
				noteTable,
				legacyOwnerColumn,
				canonicalOwnerColumn,
				err,
			)
		}
		return nil
	})
}
