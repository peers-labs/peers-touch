package persistence

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"slices"
	"sync"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"gorm.io/gorm"
)

var sqliteTransactionLocks sync.Map

type TransactionalAdapters struct {
	Identity               ports.IdentityDirectory
	Federation             ports.FederationDirectory
	DeviceInbox            ports.DeviceInboxWriter
	FederationOutbox       ports.FederationOutboxWriter
	DeliveryCommitments    ports.AuthorityDeliveryCommitmentWriter
	ObjectGrants           ports.ObjectGrantWriter
	KeyPackageReservations ports.KeyPackageReservations
}

type TransactionalAdapterFactory interface {
	Bind(tx *gorm.DB) (TransactionalAdapters, error)
}

type UnitOfWork struct {
	db       *gorm.DB
	adapters TransactionalAdapterFactory
	sealer   domainevent.Sealer
}

func NewUnitOfWork(
	db *gorm.DB,
	adapters TransactionalAdapterFactory,
	sealer domainevent.Sealer,
) (*UnitOfWork, error) {
	if db == nil || adapters == nil || sealer == nil {
		return nil, fmt.Errorf(
			"conversation persistence: database, transactional adapters, and canonical event sealer are required",
		)
	}
	if err := requireCanonicalSchema(db); err != nil {
		return nil, err
	}
	return &UnitOfWork{db: db, adapters: adapters, sealer: sealer}, nil
}

func requireCanonicalSchema(db *gorm.DB) error {
	type uniqueIndexContract struct {
		name    string
		columns []string
	}
	required := []struct {
		model          any
		columns        []string
		forbidden      []string
		primaryColumns []string
		uniqueIndexes  []uniqueIndexContract
	}{
		{
			model: &ConversationModel{},
			columns: []string{
				"current_sequence",
				"current_event_hash",
				"federation_id",
				"authority_epoch",
			},
			forbidden:      []string{"current_seq"},
			primaryColumns: []string{"conversation_id"},
		},
		{
			model:          &ConversationMemberModel{},
			columns:        []string{"joined_sequence", "left_sequence"},
			forbidden:      []string{"id", "joined_at"},
			primaryColumns: []string{"conversation_id", "ptid"},
		},
		{
			model:          &ConversationMemberDeviceModel{},
			columns:        []string{"joined_sequence", "left_sequence"},
			forbidden:      []string{"id", "updated_at"},
			primaryColumns: []string{"conversation_id", "ptid", "device_id"},
		},
		{
			model: &ConversationEventModel{},
			columns: []string{
				"sequence",
				"command_id",
				"message_id",
				"message_author_ptid",
				"hash_scheme",
				"domain_snapshot_bytes",
			},
			forbidden:      []string{"id", "group_seq", "transition_id", "commit_sha256"},
			primaryColumns: []string{"event_id"},
			uniqueIndexes: []uniqueIndexContract{
				{
					name:    "uidx_conversation_event_sequence",
					columns: []string{"conversation_id", "sequence"},
				},
				{
					name:    "uidx_conversation_event_command",
					columns: []string{"conversation_id", "command_id"},
				},
				{
					name:    "uidx_conversation_message",
					columns: []string{"conversation_id", "message_id"},
				},
			},
		},
		{
			model:          &ConversationCommandReceiptModel{},
			columns:        []string{"event_id"},
			forbidden:      []string{"id"},
			primaryColumns: []string{"conversation_id", "command_id"},
		},
		{
			model: &ConversationAuthorityPlanModel{},
			columns: []string{
				"federation_id",
				"authority_epoch",
				"authority_plan_sha256",
				"snapshot_bytes",
			},
			primaryColumns: []string{"plan_id"},
		},
		{
			model:          &ConversationMemberSettingsModel{},
			columns:        []string{"cleared_at_unix_ms"},
			primaryColumns: []string{"conversation_id", "ptid"},
		},
		{
			model:          &ConversationReadCursorModel{},
			columns:        []string{"last_read_sequence"},
			primaryColumns: []string{"conversation_id", "ptid"},
		},
		{
			model: &ConversationLeaveIntentModel{},
			columns: []string{
				"version",
				"federation_id",
				"actor_signing_key_id",
				"authority_epoch",
				"authority_hash",
				"signing_bytes",
				"created_at",
				"transition_id",
			},
			forbidden:      []string{"intent_bytes", "status", "consumed_by"},
			primaryColumns: []string{"intent_id"},
		},
		{
			model: &ConversationFollowerHeadModel{},
			columns: []string{
				"snapshot_bytes",
				"federation_id",
				"authority_epoch",
			},
			forbidden:      []string{"transition_id", "commit_sha256", "status"},
			primaryColumns: []string{"conversation_id"},
		},
		{
			model:          &ConversationFollowerStateModel{},
			columns:        []string{"status"},
			primaryColumns: []string{"conversation_id"},
		},
		{
			model:          &ConversationFollowerPendingEventModel{},
			columns:        []string{"sequence", "event_hash", "event_bytes", "domain_snapshot_bytes"},
			primaryColumns: []string{"conversation_id", "sequence"},
			uniqueIndexes: []uniqueIndexContract{
				{
					name:    "uidx_conversation_follower_pending_event",
					columns: []string{"event_id"},
				},
			},
		},
		{
			model:          &ConversationFollowerMemberModel{},
			columns:        []string{"status"},
			forbidden:      []string{"id", "role", "actor_home_station_peer_id"},
			primaryColumns: []string{"conversation_id", "ptid"},
		},
	}
	for _, contract := range required {
		if !db.Migrator().HasTable(contract.model) {
			return fmt.Errorf(
				"conversation persistence: canonical schema is not installed; CA-W5 migration must create %T",
				contract.model,
			)
		}
		for _, column := range contract.columns {
			if !db.Migrator().HasColumn(contract.model, column) {
				return fmt.Errorf(
					"conversation persistence: canonical schema is not installed; CA-W5 migration must create %T.%s",
					contract.model,
					column,
				)
			}
		}
		for _, column := range contract.forbidden {
			if db.Migrator().HasColumn(contract.model, column) {
				return fmt.Errorf(
					"conversation persistence: legacy column %T.%s blocks the CA-W5 hard cut",
					contract.model,
					column,
				)
			}
		}
		if len(contract.primaryColumns) > 0 {
			if err := requirePrimaryColumns(db, contract.model, contract.primaryColumns); err != nil {
				return err
			}
		}
		for _, index := range contract.uniqueIndexes {
			if err := requireUniqueIndex(db, contract.model, index.name, index.columns); err != nil {
				return err
			}
		}
	}
	return nil
}

func requireUniqueIndex(
	db *gorm.DB,
	model any,
	name string,
	expectedColumns []string,
) error {
	if db.Dialector.Name() == "postgres" {
		return requirePostgresUniqueIndex(db, model, name, expectedColumns)
	}
	indexes, err := db.Migrator().GetIndexes(model)
	if err != nil {
		return fmt.Errorf(
			"conversation persistence: inspect unique indexes for %T: %w",
			model,
			err,
		)
	}
	for _, index := range indexes {
		if index.Name() != name {
			continue
		}
		unique, known := index.Unique()
		if !known || !unique || !slices.Equal(index.Columns(), expectedColumns) {
			return fmt.Errorf(
				"conversation persistence: canonical schema requires unique index %s(%v) on %T",
				name,
				expectedColumns,
				model,
			)
		}
		return nil
	}
	return fmt.Errorf(
		"conversation persistence: canonical schema is not installed; CA-W5 migration must create unique index %s(%v) on %T",
		name,
		expectedColumns,
		model,
	)
}

type postgresIndexColumn struct {
	IsUnique   bool
	IsPartial  bool
	IsValid    bool
	IsReady    bool
	Ordinal    int
	ColumnName *string
}

func requirePostgresUniqueIndex(
	db *gorm.DB,
	model any,
	name string,
	expectedColumns []string,
) error {
	statement := &gorm.Statement{DB: db}
	if err := statement.Parse(model); err != nil {
		return fmt.Errorf(
			"conversation persistence: resolve table for unique index %s on %T: %w",
			name,
			model,
			err,
		)
	}

	var columns []postgresIndexColumn
	if err := db.Raw(`
		SELECT
			index_definition.indisunique AS is_unique,
			index_definition.indpred IS NOT NULL AS is_partial,
			index_definition.indisvalid AS is_valid,
			index_definition.indisready AS is_ready,
			index_column.ordinality AS ordinal,
			table_column.attname AS column_name
		FROM pg_catalog.pg_index AS index_definition
		JOIN pg_catalog.pg_class AS index_relation
			ON index_relation.oid = index_definition.indexrelid
		JOIN pg_catalog.pg_class AS table_relation
			ON table_relation.oid = index_definition.indrelid
		JOIN pg_catalog.pg_namespace AS table_namespace
			ON table_namespace.oid = table_relation.relnamespace
		CROSS JOIN LATERAL unnest(index_definition.indkey)
			WITH ORDINALITY AS index_column(attnum, ordinality)
		LEFT JOIN pg_catalog.pg_attribute AS table_column
			ON table_column.attrelid = table_relation.oid
			AND table_column.attnum = index_column.attnum
		WHERE table_namespace.nspname = current_schema()
			AND table_relation.relname = ?
			AND index_relation.relname = ?
			AND index_column.ordinality <= index_definition.indnkeyatts
		ORDER BY index_column.ordinality
	`, statement.Schema.Table, name).Scan(&columns).Error; err != nil {
		return fmt.Errorf(
			"conversation persistence: inspect PostgreSQL unique index %s on %T: %w",
			name,
			model,
			err,
		)
	}

	actualColumns := make([]string, 0, len(columns))
	for _, column := range columns {
		if !column.IsUnique ||
			column.IsPartial ||
			!column.IsValid ||
			!column.IsReady ||
			column.Ordinal != len(actualColumns)+1 ||
			column.ColumnName == nil {
			return fmt.Errorf(
				"conversation persistence: canonical schema requires valid non-partial unique index %s(%v) on %T",
				name,
				expectedColumns,
				model,
			)
		}
		actualColumns = append(actualColumns, *column.ColumnName)
	}
	if !slices.Equal(actualColumns, expectedColumns) {
		return fmt.Errorf(
			"conversation persistence: canonical schema requires valid non-partial unique index %s(%v) on %T",
			name,
			expectedColumns,
			model,
		)
	}
	return nil
}

func requirePrimaryColumns(db *gorm.DB, model any, expected []string) error {
	columnTypes, err := db.Migrator().ColumnTypes(model)
	if err != nil {
		return fmt.Errorf(
			"conversation persistence: inspect primary key for %T: %w",
			model,
			err,
		)
	}
	actual := make(map[string]struct{}, len(expected))
	for _, column := range columnTypes {
		primary, known := column.PrimaryKey()
		if known && primary {
			actual[column.Name()] = struct{}{}
		}
	}
	if len(actual) != len(expected) {
		return fmt.Errorf(
			"conversation persistence: canonical schema is not installed; CA-W5 migration must create primary key %v on %T",
			expected,
			model,
		)
	}
	for _, column := range expected {
		if _, exists := actual[column]; !exists {
			return fmt.Errorf(
				"conversation persistence: canonical schema is not installed; CA-W5 migration must include %T.%s in its primary key",
				model,
				column,
			)
		}
	}
	return nil
}

func (u *UnitOfWork) Execute(
	ctx context.Context,
	fn func(ports.Transaction) error,
) error {
	return u.execute(ctx, "", fn)
}

func (u *UnitOfWork) ExecuteSerialized(
	ctx context.Context,
	key string,
	fn func(ports.Transaction) error,
) error {
	if key == "" {
		return fmt.Errorf("conversation persistence: serialization key is required")
	}
	if u.db.Dialector.Name() == "sqlite" {
		lockValue, _ := sqliteTransactionLocks.LoadOrStore(key, &sync.Mutex{})
		lock := lockValue.(*sync.Mutex)
		lock.Lock()
		defer lock.Unlock()
		return u.execute(ctx, "", fn)
	}
	return u.execute(ctx, key, fn)
}

func (u *UnitOfWork) execute(
	ctx context.Context,
	serializationKey string,
	fn func(ports.Transaction) error,
) error {
	if fn == nil {
		return fmt.Errorf("conversation persistence: transaction callback is required")
	}
	return u.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if serializationKey != "" {
			if tx.Dialector.Name() != "postgres" {
				return fmt.Errorf(
					"conversation persistence: serialized transactions are unsupported for %s",
					tx.Dialector.Name(),
				)
			}
			hash := sha256.Sum256([]byte(serializationKey))
			lockID := int64(binary.BigEndian.Uint64(hash[:8]))
			if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", lockID).Error; err != nil {
				return fmt.Errorf("conversation persistence: acquire creation lock: %w", err)
			}
		}
		adapters, err := u.adapters.Bind(tx)
		if err != nil {
			return fmt.Errorf("conversation persistence: bind transactional adapters: %w", err)
		}
		return fn(ports.Transaction{
			Repositories: repository.Repositories{
				Authority:      newAuthorityRepository(tx),
				Events:         newEventRepository(tx, u.sealer),
				Receipts:       newReceiptRepository(tx),
				AuthorityPlans: newAuthorityPlanRepository(tx),
				MemberSettings: newMemberSettingsRepository(tx),
				ReadCursors:    newReadCursorRepository(tx),
				LeaveIntents:   newLeaveIntentRepository(tx),
				Followers:      newFollowerRepository(tx, u.sealer),
			},
			Identity:               adapters.Identity,
			Federation:             adapters.Federation,
			DeviceInbox:            adapters.DeviceInbox,
			FederationOutbox:       adapters.FederationOutbox,
			DeliveryCommitments:    adapters.DeliveryCommitments,
			ObjectGrants:           adapters.ObjectGrants,
			KeyPackageReservations: adapters.KeyPackageReservations,
		})
	})
}
