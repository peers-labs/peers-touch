package persistence

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestMigrateCanonicalSchemaDropsRetiredColumnsBeforeGroupCreate(t *testing.T) {
	db := openIsolatedPostgres(t)
	ctx := context.Background()
	if err := MigrateCanonicalSchema(ctx, db); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`
		ALTER TABLE conversations
		ADD COLUMN disappear_timer_seconds BIGINT NOT NULL
	`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`
		ALTER TABLE conversation_member_settings
		ADD COLUMN cleared_at_unix_ms BIGINT NOT NULL
	`).Error; err != nil {
		t.Fatal(err)
	}

	if err := MigrateCanonicalSchema(ctx, db); err != nil {
		t.Fatal(err)
	}
	for _, retired := range []struct {
		model  any
		column string
	}{
		{model: &ConversationModel{}, column: "disappear_timer_seconds"},
		{model: &ConversationMemberSettingsModel{}, column: "cleared_at_unix_ms"},
	} {
		if db.Migrator().HasColumn(retired.model, retired.column) {
			t.Fatalf("retired column %T.%s survived canonical migration", retired.model, retired.column)
		}
	}

	unitOfWork, err := NewUnitOfWork(
		db,
		postgresTestAdapterFactory{},
		domainevent.CanonicalSealer{},
	)
	if err != nil {
		t.Fatal(err)
	}
	owner, err := valueobject.NewEndpoint("ptid:schema-owner", "schema-owner-device")
	if err != nil {
		t.Fatal(err)
	}
	device, err := entity.NewMemberDevice(owner, "station-a", 1)
	if err != nil {
		t.Fatal(err)
	}
	delivery, err := valueobject.NewPreparedDelivery(
		owner,
		"station-a",
		valueobject.DeliveryKindPublicEvent,
		[]byte("schema-owner-created"),
	)
	if err != nil {
		t.Fatal(err)
	}
	group, _, err := aggregate.CreateGroup(aggregate.CreateInput{
		ID:               "schema-hard-cut-group",
		FederationID:     "schema-hard-cut-federation",
		AuthorityStation: "station-a",
		AuthorityEpoch:   1,
		Owner:            owner.Actor,
		Participants: []aggregate.Participant{
			{Actor: owner.Actor, HomeStation: "station-a"},
		},
		Devices: []entity.MemberDevice{device},
		Settings: valueobject.ConversationSettings{
			Name:       "Schema hard cut",
			Visibility: valueobject.ConversationVisibilityPrivate,
		},
		CommandID:    "schema-hard-cut-create",
		Creator:      owner,
		Deliveries:   []valueobject.PreparedDelivery{delivery},
		EventPayload: []byte("schema-hard-cut-group-created"),
		CreatedAt:    time.Date(2026, 10, 5, 17, 0, 0, 0, time.UTC),
		EventSealer:  domainevent.CanonicalSealer{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := unitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		return transaction.Repositories.Authority.Create(ctx, group.Snapshot())
	}); err != nil {
		t.Fatalf("persist group after retired-column hard cut: %v", err)
	}
}

func TestRequirePostgresUniqueIndexRejectsNonCanonicalDefinitions(t *testing.T) {
	db := openIsolatedPostgres(t)
	if err := db.AutoMigrate(&ConversationEventModel{}); err != nil {
		t.Fatal(err)
	}

	const indexName = "uidx_conversation_event_command"
	expectedColumns := []string{"conversation_id", "command_id"}
	if err := requireUniqueIndex(
		db,
		&ConversationEventModel{},
		indexName,
		expectedColumns,
	); err != nil {
		t.Fatalf("canonical index rejected: %v", err)
	}

	t.Run("reversed keys", func(t *testing.T) {
		replacePostgresIndex(
			t,
			db,
			indexName,
			`CREATE UNIQUE INDEX uidx_conversation_event_command
				ON conversation_events (command_id, conversation_id)`,
		)
		if err := requireUniqueIndex(
			db,
			&ConversationEventModel{},
			indexName,
			expectedColumns,
		); err == nil {
			t.Fatal("reversed PostgreSQL index keys were accepted")
		}
	})

	t.Run("partial predicate", func(t *testing.T) {
		replacePostgresIndex(
			t,
			db,
			indexName,
			`CREATE UNIQUE INDEX uidx_conversation_event_command
				ON conversation_events (conversation_id, command_id)
				WHERE command_id <> ''`,
		)
		if err := requireUniqueIndex(
			db,
			&ConversationEventModel{},
			indexName,
			expectedColumns,
		); err == nil {
			t.Fatal("partial PostgreSQL unique index was accepted")
		}
	})
}

func replacePostgresIndex(t *testing.T, db *gorm.DB, name string, definition string) {
	t.Helper()
	if err := db.Exec(`DROP INDEX IF EXISTS "` + name + `"`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(definition).Error; err != nil {
		t.Fatal(err)
	}
}

func openIsolatedPostgres(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("MESSAGING_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("MESSAGING_TEST_POSTGRES_DSN is not configured")
	}

	admin, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open PostgreSQL test database: %v", err)
	}
	schema := "conversation_ddd_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := admin.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
		t.Fatalf("create isolated PostgreSQL schema: %v", err)
	}
	t.Cleanup(func() {
		sqlDB, dbErr := admin.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	})
	t.Cleanup(func() {
		if err := admin.Exec(`DROP SCHEMA IF EXISTS "` + schema + `" CASCADE`).Error; err != nil {
			t.Errorf("drop isolated PostgreSQL schema: %v", err)
		}
	})

	isolated, err := gorm.Open(
		postgres.Open(postgresDSNWithSearchPath(t, dsn, schema)),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open isolated PostgreSQL test schema: %v", err)
	}
	t.Cleanup(func() {
		sqlDB, dbErr := isolated.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	})
	return isolated
}

func postgresDSNWithSearchPath(t *testing.T, dsn string, schema string) string {
	t.Helper()
	if strings.Contains(dsn, "://") {
		parsed, err := url.Parse(dsn)
		if err != nil {
			t.Fatalf("parse PostgreSQL DSN: %v", err)
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		return parsed.String()
	}
	return strings.TrimSpace(dsn) + " search_path=" + schema
}

type postgresTestAdapterFactory struct{}

func (postgresTestAdapterFactory) Bind(*gorm.DB) (TransactionalAdapters, error) {
	return TransactionalAdapters{}, nil
}
