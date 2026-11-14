package infrastructure

import (
	"fmt"
	"strings"

	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// MigrateInteractionSchema widens the shared reaction post identifier and
// reaction enum name so canonical private ULIDs and every known ReactionKind
// fit existing databases.
func MigrateInteractionSchema(database *gorm.DB) error {
	if database == nil {
		return fmt.Errorf("social: interaction database is required")
	}
	if !database.Migrator().HasTable(&dbmodel.SocialReaction{}) {
		return nil
	}
	if err := migrateSocialReactionTarget(database); err != nil {
		return err
	}

	columnTypes, err := database.Migrator().ColumnTypes(
		&dbmodel.SocialReaction{},
	)
	if err != nil {
		return fmt.Errorf("social: inspect reaction schema: %w", err)
	}
	for _, columnType := range columnTypes {
		if !strings.EqualFold(columnType.Name(), "post_id") {
			continue
		}
		if socialReactionPostIDIsText(columnType.DatabaseTypeName()) {
			return migrateSocialReactionKindColumn(database)
		}
		if err := database.Transaction(func(tx *gorm.DB) error {
			switch tx.Dialector.Name() {
			case "postgres":
				return tx.Exec(`
ALTER TABLE social_reactions
ALTER COLUMN post_id TYPE VARCHAR(128)
USING post_id::text`).Error
			case "mysql":
				return tx.Exec(`
ALTER TABLE social_reactions
MODIFY COLUMN post_id VARCHAR(128) NOT NULL`).Error
			case "sqlite":
				return migrateSQLiteSocialReactionSchema(tx)
			default:
				return fmt.Errorf(
					"unsupported database dialect %q",
					tx.Dialector.Name(),
				)
			}
		}); err != nil {
			return fmt.Errorf(
				"social: migrate social_reactions.post_id to text: %w",
				err,
			)
		}
		if err := validateSocialReactionPostID(database); err != nil {
			return err
		}
		return migrateSocialReactionKindColumn(database)
	}

	return fmt.Errorf("social: social_reactions.post_id is missing")
}

func migrateSocialReactionKindColumn(database *gorm.DB) error {
	columnTypes, err := database.Migrator().ColumnTypes(
		&dbmodel.SocialReaction{},
	)
	if err != nil {
		return fmt.Errorf("social: inspect reaction kind schema: %w", err)
	}
	for _, columnType := range columnTypes {
		if !strings.EqualFold(columnType.Name(), "kind") {
			continue
		}
		if socialReactionKindIsWideEnough(columnType) {
			return nil
		}
		if database.Dialector.Name() == "sqlite" {
			if err := database.Transaction(
				migrateSQLiteSocialReactionSchema,
			); err != nil {
				return fmt.Errorf(
					"social: widen social_reactions.kind: %w",
					err,
				)
			}
			return validateSocialReactionKind(database)
		}
		if err := database.Migrator().AlterColumn(
			&dbmodel.SocialReaction{},
			"Kind",
		); err != nil {
			return fmt.Errorf(
				"social: widen social_reactions.kind: %w",
				err,
			)
		}
		return validateSocialReactionKind(database)
	}
	return fmt.Errorf("social: social_reactions.kind is missing")
}

func migrateSQLiteSocialReactionSchema(database *gorm.DB) error {
	const legacyTable = "social_reactions_legacy_post_id"
	if database.Migrator().HasTable(legacyTable) {
		return fmt.Errorf("temporary table %s already exists", legacyTable)
	}
	hasComment := database.Migrator().HasColumn(&dbmodel.SocialReaction{}, "comment_id")
	if err := database.Exec(
		"ALTER TABLE social_reactions RENAME TO " + legacyTable,
	).Error; err != nil {
		return err
	}
	for _, index := range []string{
		"idx_sreaction_actor",
		"idx_sreaction_post_created",
	} {
		if err := database.Exec("DROP INDEX IF EXISTS " + index).Error; err != nil {
			return err
		}
	}
	if err := database.AutoMigrate(&dbmodel.SocialReaction{}); err != nil {
		return err
	}
	commentExpression := "''"
	if hasComment {
		commentExpression = "COALESCE(comment_id, '')"
	}
	if err := database.Exec(`
INSERT INTO social_reactions (
	post_id, comment_id, actor_id, kind, post_class, created_at
)
SELECT
	CAST(post_id AS TEXT), ` + commentExpression + `, actor_id, kind, post_class, created_at
FROM social_reactions_legacy_post_id`).Error; err != nil {
		return err
	}
	return database.Migrator().DropTable(legacyTable)
}

// AutoMigrate can add a column without replacing an existing composite PK.
// Reconcile the actual key, preserving both legacy post and typed-target rows.
func migrateSocialReactionTarget(database *gorm.DB) error {
	return database.Transaction(func(tx *gorm.DB) error {
		switch tx.Dialector.Name() {
		case "sqlite":
			var columns []struct {
				Name string
				PK   int
			}
			if err := tx.Raw("PRAGMA table_info(social_reactions)").Scan(&columns).Error; err != nil {
				return err
			}
			for _, column := range columns {
				if column.Name == "comment_id" && column.PK > 0 {
					return nil
				}
			}
			return migrateSQLiteSocialReactionSchema(tx)
		case "postgres":
			if err := tx.Exec("ALTER TABLE social_reactions ADD COLUMN IF NOT EXISTS comment_id VARCHAR(128) NOT NULL DEFAULT ''").Error; err != nil {
				return err
			}
			var key struct{ Name, Definition string }
			if err := tx.Raw(`SELECT conname AS name, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid = 'social_reactions'::regclass AND contype = 'p'`).Scan(&key).Error; err != nil {
				return err
			}
			if key.Definition == "PRIMARY KEY (post_id, comment_id, actor_id, kind)" {
				return nil
			}
			if key.Name != "" {
				quoted := `"` + strings.ReplaceAll(key.Name, `"`, `""`) + `"`
				if err := tx.Exec("ALTER TABLE social_reactions DROP CONSTRAINT " + quoted).Error; err != nil {
					return err
				}
			}
			return tx.Exec("ALTER TABLE social_reactions ADD PRIMARY KEY (post_id, comment_id, actor_id, kind)").Error
		case "mysql":
			if !tx.Migrator().HasColumn(&dbmodel.SocialReaction{}, "comment_id") {
				if err := tx.Migrator().AddColumn(&dbmodel.SocialReaction{}, "CommentID"); err != nil {
					return err
				}
			}
			var columns []struct{ ColumnName string }
			if err := tx.Raw(`SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_reactions' AND CONSTRAINT_NAME = 'PRIMARY'
ORDER BY ORDINAL_POSITION`).Scan(&columns).Error; err != nil {
				return err
			}
			for _, column := range columns {
				if column.ColumnName == "comment_id" {
					return nil
				}
			}
			return tx.Exec("ALTER TABLE social_reactions DROP PRIMARY KEY, ADD PRIMARY KEY (post_id, comment_id, actor_id, kind)").Error
		default:
			return fmt.Errorf("social: unsupported reaction dialect %q", tx.Dialector.Name())
		}
	})
}

func validateSocialReactionPostID(database *gorm.DB) error {
	columnTypes, err := database.Migrator().ColumnTypes(
		&dbmodel.SocialReaction{},
	)
	if err != nil {
		return fmt.Errorf("social: inspect migrated reaction schema: %w", err)
	}
	for _, columnType := range columnTypes {
		if strings.EqualFold(columnType.Name(), "post_id") {
			if socialReactionPostIDIsText(columnType.DatabaseTypeName()) {
				return nil
			}
			return fmt.Errorf(
				"social: social_reactions.post_id type is %q after migration",
				columnType.DatabaseTypeName(),
			)
		}
	}

	return fmt.Errorf("social: social_reactions.post_id is missing")
}

func socialReactionPostIDIsText(databaseType string) bool {
	switch strings.ToLower(strings.TrimSpace(databaseType)) {
	case "char", "character", "character varying", "longtext", "nvarchar", "text", "varchar":
		return true
	default:
		return false
	}
}

func validateSocialReactionKind(database *gorm.DB) error {
	columnTypes, err := database.Migrator().ColumnTypes(
		&dbmodel.SocialReaction{},
	)
	if err != nil {
		return fmt.Errorf("social: inspect migrated reaction kind schema: %w", err)
	}
	for _, columnType := range columnTypes {
		if strings.EqualFold(columnType.Name(), "kind") {
			if socialReactionKindIsWideEnough(columnType) {
				return nil
			}
			return fmt.Errorf(
				"social: social_reactions.kind remains too narrow after migration",
			)
		}
	}
	return fmt.Errorf("social: social_reactions.kind is missing")
}

func socialReactionKindIsWideEnough(columnType gorm.ColumnType) bool {
	switch strings.ToLower(strings.TrimSpace(columnType.DatabaseTypeName())) {
	case "text", "longtext":
		return true
	}
	length, ok := columnType.Length()
	return ok && length >= 32
}
