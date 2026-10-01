package db

import (
	"context"
	"fmt"
	"regexp"

	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

var migrationIdentifierPattern = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)

// AutoMigrate helps to migrate the database schema, like create table.
// call it after store is initiated
func init() {
	store.InitTableHooks(func(ctx context.Context, rds *gorm.DB) {
		if err := migrateTouchIdentityColumns(rds); err != nil {
			panic(fmt.Errorf("migrate touch identity columns: %w", err))
		}
		if err := migrateSocialIdentityColumns(rds); err != nil {
			panic(fmt.Errorf("migrate social identity columns: %w", err))
		}

		err := rds.AutoMigrate(
			// Actor models
			&Actor{}, &ActorTouchMeta{}, &PeerAddress{}, &ActorStatus{},
			// OAuth models
			&OAuthClient{}, &OAuthAuthCode{}, &OAuthToken{},
			&OAuth2IdentityBinding{}, &OAuth2TokenState{}, &OAuth2ConnectionState{},
			&OAuthBridgeAssertion{},
			// Chat models
			&Conversation{}, &ConvMember{}, &Message{},
			&Attachment{}, &Receipt{}, &Reaction{}, &KeyEpoch{},
			// Social — Moments family (see docs/architecture/social/moments.md §6).
			//
			// Public / private posts physically separated via table-name
			// prefix (D1.A) so a SQL bug in the public path can never read
			// from the private one. CUSTOM_ALLOW/DENY actor lists, comments,
			// reactions, and circles each get their own table.
			&SocialPublicPost{}, &SocialPrivatePost{},
			&SocialMomentDelivery{},
			&SocialPrivateAudienceGrant{},
			&SocialComment{}, &SocialReaction{},
			&SocialCircle{}, &SocialCircleMember{},
			&SocialStationModerationPolicy{},
			// Cross-domain relationship (kept generic — used by social subserver
			// today, may be reused by chat / oss later).
			&Follow{},
			// Station access gate. Policy is the Dashboard-managed source of
			// truth; attempts are the persisted lifecycle/state-machine record;
			// invite codes are Station-issued credentials for the invite.code gate.
			&AccessPolicy{}, &AccessAttempt{}, &AccessGateSubmission{}, &AccessInviteCode{},
			&OAuthAttempt{}, &OAuthSessionCandidate{}, &OAuthCredentialEnvelope{},
		)
		if err != nil {
			panic(fmt.Errorf("auto migrate failed: %v", err))
		}
	})
}

type stringIdentityColumnRename struct {
	table string
	from  string
	to    string
}

func migrateTouchIdentityColumns(rds *gorm.DB) error {
	return migrateStringIdentityColumns(rds, []stringIdentityColumnRename{
		{table: "touch_conv_member", from: "did", to: "ptid"},
		{table: "touch_message", from: "sender_did", to: "sender_ptid"},
		{table: "touch_receipt", from: "member_did", to: "member_ptid"},
		{table: "touch_reaction", from: "member_did", to: "member_ptid"},
	})
}

func migrateSocialIdentityColumns(rds *gorm.DB) error {
	return migrateStringIdentityColumns(rds, []stringIdentityColumnRename{
		{table: "social_private_audience_grants", from: "actor_did", to: "actor_ptid"},
		{table: "social_circle_members", from: "member_did", to: "actor_ptid"},
		{table: "social_circle_members", from: "actor_did", to: "actor_ptid"},
	})
}

func migrateStringIdentityColumns(rds *gorm.DB, renames []stringIdentityColumnRename) error {
	return rds.Transaction(func(tx *gorm.DB) error {
		for _, rename := range renames {
			if err := MigrateStringIdentityColumn(tx, rename.table, rename.from, rename.to); err != nil {
				return fmt.Errorf(
					"rename legacy identity column %s.%s to %s: %w",
					rename.table,
					rename.from,
					rename.to,
					err,
				)
			}
		}
		return nil
	})
}

// MigrateStringIdentityColumn performs the PTID hard cut for one persisted
// string identity column. If both names exist, divergent non-empty values fail
// closed before the legacy column is removed.
func MigrateStringIdentityColumn(rds *gorm.DB, table, from, to string) error {
	for _, identifier := range []string{table, from, to} {
		if !migrationIdentifierPattern.MatchString(identifier) {
			return fmt.Errorf("invalid migration identifier %q", identifier)
		}
	}

	if !rds.Migrator().HasTable(table) || !rds.Migrator().HasColumn(table, from) {
		return nil
	}

	return rds.Transaction(func(tx *gorm.DB) error {
		migrator := tx.Migrator()
		if !migrator.HasColumn(table, to) {
			return migrator.RenameColumn(table, from, to)
		}

		var conflicts int64
		conflictPredicate := fmt.Sprintf(
			"%s IS NOT NULL AND %s <> '' AND %s IS NOT NULL AND %s <> '' AND %s <> %s",
			from,
			from,
			to,
			to,
			from,
			to,
		)
		if err := tx.Table(table).Where(conflictPredicate).Count(&conflicts).Error; err != nil {
			return fmt.Errorf("count divergent identity rows: %w", err)
		}
		if conflicts > 0 {
			return fmt.Errorf(
				"%s has %d rows with divergent %s and %s values",
				table,
				conflicts,
				from,
				to,
			)
		}

		backfill := fmt.Sprintf(
			"UPDATE %s SET %s = %s WHERE (%s IS NULL OR %s = '') AND %s IS NOT NULL",
			table,
			to,
			from,
			to,
			to,
			from,
		)
		if err := tx.Exec(backfill).Error; err != nil {
			return fmt.Errorf("backfill %s from %s: %w", to, from, err)
		}
		dropLegacy := fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", table, from)
		if err := tx.Exec(dropLegacy).Error; err != nil {
			return fmt.Errorf("drop legacy column %s: %w", from, err)
		}
		return nil
	})
}
