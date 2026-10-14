package persistence

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	conversationpersistence "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/persistence"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMigrateLegacyPublishingGrantsPreservesCredentialAndBotIdentity(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := conversationpersistence.MigrateCanonicalSchema(context.Background(), db); err != nil {
		t.Fatalf("migrate Conversation: %v", err)
	}
	if err := db.Exec(`
		CREATE TABLE bot_registration (
			id integer PRIMARY KEY AUTOINCREMENT,
			bot_ptid text NOT NULL UNIQUE,
			owner_ptid text NOT NULL,
			name text NOT NULL,
			state integer NOT NULL,
			webhook_id text NOT NULL UNIQUE,
			secret_hash text NOT NULL,
			secret_hint text NOT NULL,
			secret_delivered integer NOT NULL,
			delivery_scope integer NOT NULL,
			rate_limit_per_minute integer NOT NULL,
			created_at datetime NOT NULL,
			disabled_at datetime,
			revoked_at datetime
		)
	`).Error; err != nil {
		t.Fatalf("create legacy Bot table: %v", err)
	}
	createdAt := time.Date(2026, time.October, 14, 9, 0, 0, 0, time.UTC)
	if err := db.Exec(`
		INSERT INTO bot_registration(
			bot_ptid, owner_ptid, name, state, webhook_id, secret_hash,
			secret_hint, secret_delivered, delivery_scope,
			rate_limit_per_minute, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		"ptid:v1:actor:peers:b:legacy:bot",
		"ptid:v1:actor:peers:p:owner:person",
		"Legacy Bot",
		2,
		"wh_legacy",
		"hash",
		"hint",
		false,
		1,
		120,
		createdAt,
	).Error; err != nil {
		t.Fatalf("insert legacy Bot: %v", err)
	}
	rows, err := LoadLegacyPublishingGrants(db)
	if err != nil {
		t.Fatalf("load legacy grants: %v", err)
	}
	store := conversationpersistence.NewPublishingStore(db)
	for _, row := range rows {
		target, err := valueobject.DirectConversationID(
			valueobject.PTID(row.BotPTID),
			valueobject.PTID(row.OwnerPTID),
		)
		if err != nil {
			t.Fatal(err)
		}
		if err := store.CreateGrant(context.Background(), entity.PublishingGrant{
			ID:              row.PublishingID,
			Owner:           valueobject.PTID(row.OwnerPTID),
			Sender:          valueobject.PTID(row.BotPTID),
			Name:            row.Name,
			SourceNamespace: "bot." + row.BotPTID,
			DefaultTarget:   target,
			AllowedTargets:  []valueobject.ConversationID{target},
			SecretHash:      row.SecretHash,
			SecretHint:      row.SecretHint,
			CreatedAt:       row.CreatedAt,
			RatePerMinute:   row.RateLimitPerMinute,
		}); err != nil {
			t.Fatal(err)
		}
	}
	if err := CompleteLegacyPublishingCutover(db, rows); err != nil {
		t.Fatalf("complete legacy cutover: %v", err)
	}

	var bot BotRegistrationModel
	if err := db.Where("bot_ptid = ?", "ptid:v1:actor:peers:b:legacy:bot").
		First(&bot).Error; err != nil {
		t.Fatalf("load migrated Bot: %v", err)
	}
	if bot.PublishingID != "wh_legacy" {
		t.Fatalf("publishing ID = %q", bot.PublishingID)
	}
	var grant conversationpersistence.MessagePublishingGrantModel
	if err := db.Where("publishing_id = ?", "wh_legacy").First(&grant).Error; err != nil {
		t.Fatalf("load migrated grant: %v", err)
	}
	if grant.SenderPTID != bot.BotPtid || grant.SecretHash != "hash" {
		t.Fatalf("migrated grant = %+v", grant)
	}
	if db.Migrator().HasColumn(&BotRegistrationModel{}, "webhook_id") {
		t.Fatal("retired ingress identity column still exists")
	}
}
