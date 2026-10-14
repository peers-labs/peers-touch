package events

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

// realtimeEventModel is the durable event log for the canonical realtime plane.
// The in-memory ring buffer remains a hot cache; this table is the recovery
// source after process restart, ring eviction, and disconnected clients.
type realtimeEventModel struct {
	ID               uint64    `gorm:"column:id;primaryKey"`
	ActorPTID        string    `gorm:"column:actor_ptid;size:255;uniqueIndex:idx_realtime_actor_ptid_event,priority:1;index"`
	Sequence         uint64    `gorm:"column:sequence;not null;default:0;index"`
	EventID          string    `gorm:"column:event_id;size:64;uniqueIndex:idx_realtime_actor_ptid_event,priority:2;index"`
	TargetDeviceID   string    `gorm:"column:target_device_id;size:255;not null;default:'';index"`
	DeduplicationKey string    `gorm:"column:deduplication_key;size:255;not null;default:''"`
	KindBytes        []byte    `gorm:"column:kind_bytes;type:bytea"`
	CreatedAt        time.Time `gorm:"column:created_at;index"`
}

func (realtimeEventModel) TableName() string { return "realtime_events" }

type actorEventSequenceModel struct {
	ActorPTID             string `gorm:"column:actor_ptid;size:255;primaryKey"`
	LastCommittedSequence uint64 `gorm:"column:last_committed_sequence;not null"`
}

func (actorEventSequenceModel) TableName() string {
	return "realtime_actor_event_sequences"
}

type durableEventRecord struct {
	Sequence       uint64
	TargetDeviceID string
	Event          *realtime.StreamEvent
}

type durableEventHead struct {
	Sequence uint64
	EventID  string
}

type durableEventStore interface {
	Persist(
		actorPTID string,
		targetDeviceID string,
		ev *realtime.StreamEvent,
	) (durableEventRecord, error)
	ReplayRange(
		actorPTID string,
		afterSequence uint64,
		throughSequence uint64,
		limit int,
	) ([]durableEventRecord, error)
	Head(actorPTID string) (durableEventHead, bool, error)
	OldestSequence(actorPTID string) (uint64, bool, error)
	CursorSequence(actorPTID, eventID string) (uint64, bool, error)
}

type transactionalDurableEventStore interface {
	PersistInTransaction(
		context.Context,
		*gorm.DB,
		string,
		string,
		*realtime.StreamEvent,
	) (durableEventRecord, error)
}

type gormEventStore struct {
	db *gorm.DB
}

const realtimeEventWakeChannel = "peers_realtime_events"
const realtimeEventMigrationLockID int64 = 0x50544556454e5453

func newGormEventStore(db *gorm.DB) *gormEventStore {
	return &gormEventStore{db: db}
}

func (s *gormEventStore) AutoMigrate() error {
	if s.db.Dialector.Name() == "postgres" {
		return s.db.Transaction(func(transaction *gorm.DB) error {
			if err := transaction.Exec(
				"SELECT pg_advisory_xact_lock(?)",
				realtimeEventMigrationLockID,
			).Error; err != nil {
				return fmt.Errorf(
					"lock realtime event migration: %w",
					err,
				)
			}
			return migrateRealtimeEventStore(transaction)
		})
	}
	return migrateRealtimeEventStore(s.db)
}

func migrateRealtimeEventStore(database *gorm.DB) error {
	if err := renamePTIDColumn(database, realtimeEventModel{}.TableName(), "actor_id", "actor_ptid"); err != nil {
		return fmt.Errorf("migrate realtime event actor PTID column: %w", err)
	}
	if err := database.AutoMigrate(
		&realtimeEventModel{},
		&actorEventSequenceModel{},
	); err != nil {
		return err
	}
	if err := backfillRealtimeEventSequences(database); err != nil {
		return err
	}
	if err := database.Exec(`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_realtime_actor_ptid_sequence
		ON realtime_events (actor_ptid, sequence)
	`).Error; err != nil {
		return fmt.Errorf("create realtime event sequence index: %w", err)
	}
	return nil
}

func (s *gormEventStore) Persist(
	actorPTID string,
	targetDeviceID string,
	ev *realtime.StreamEvent,
) (durableEventRecord, error) {
	var stored durableEventRecord
	err := s.db.Transaction(func(transaction *gorm.DB) error {
		var err error
		stored, err = persistRealtimeEvent(
			transaction,
			actorPTID,
			targetDeviceID,
			ev,
		)
		return err
	})
	return stored, err
}

func (s *gormEventStore) PersistInTransaction(
	ctx context.Context,
	transaction *gorm.DB,
	actorPTID string,
	targetDeviceID string,
	ev *realtime.StreamEvent,
) (durableEventRecord, error) {
	if transaction == nil {
		return durableEventRecord{}, fmt.Errorf("events: transaction is required")
	}
	return persistRealtimeEvent(
		transaction.WithContext(ctx),
		actorPTID,
		targetDeviceID,
		ev,
	)
}

func persistRealtimeEvent(
	database *gorm.DB,
	actorPTID string,
	targetDeviceID string,
	ev *realtime.StreamEvent,
) (durableEventRecord, error) {
	if actorPTID == "" {
		return durableEventRecord{}, fmt.Errorf("events: empty actorPTID")
	}
	if ev == nil {
		return durableEventRecord{}, fmt.Errorf("events: nil event")
	}
	sequence, err := allocateRealtimeEventSequence(database, actorPTID)
	if err != nil {
		return durableEventRecord{}, err
	}
	stamped := proto.Clone(ev).(*realtime.StreamEvent)
	stamped.EventId = durableEventID(sequence)
	payload, err := proto.Marshal(stamped)
	if err != nil {
		return durableEventRecord{}, fmt.Errorf("marshal realtime event: %w", err)
	}
	now := time.UnixMilli(stamped.GetTsUnixMs()).UTC()
	if stamped.GetTsUnixMs() == 0 {
		now = time.Now().UTC()
	}
	item := realtimeEventModel{
		ActorPTID:        actorPTID,
		Sequence:         sequence,
		EventID:          stamped.GetEventId(),
		TargetDeviceID:   targetDeviceID,
		DeduplicationKey: stamped.GetEventId(),
		KindBytes:        payload,
		CreatedAt:        now,
	}
	if err := database.Create(&item).Error; err != nil {
		return durableEventRecord{}, fmt.Errorf("persist realtime event: %w", err)
	}
	if err := notifyRealtimeEventWake(
		database,
		actorPTID,
		sequence,
	); err != nil {
		return durableEventRecord{}, err
	}
	return durableEventRecord{
		Sequence:       sequence,
		TargetDeviceID: targetDeviceID,
		Event:          stamped,
	}, nil
}

func allocateRealtimeEventSequence(
	database *gorm.DB,
	actorPTID string,
) (uint64, error) {
	var result struct {
		Sequence uint64 `gorm:"column:last_committed_sequence"`
	}
	err := database.Raw(`
		INSERT INTO realtime_actor_event_sequences (
			actor_ptid,
			last_committed_sequence
		) VALUES (?, 1)
		ON CONFLICT (actor_ptid) DO UPDATE
		SET last_committed_sequence =
			realtime_actor_event_sequences.last_committed_sequence + 1
		RETURNING last_committed_sequence
	`, actorPTID).Scan(&result).Error
	if err != nil {
		return 0, fmt.Errorf("allocate realtime event sequence: %w", err)
	}
	if result.Sequence == 0 {
		return 0, fmt.Errorf("allocate realtime event sequence: zero sequence")
	}
	return result.Sequence, nil
}

func durableEventID(sequence uint64) string {
	return fmt.Sprintf("re-%020d", sequence)
}

func notifyRealtimeEventWake(
	database *gorm.DB,
	actorPTID string,
	sequence uint64,
) error {
	if database.Dialector.Name() != "postgres" {
		return nil
	}
	payload, err := json.Marshal(durableWakeHint{
		ActorPTID: actorPTID,
		Sequence:  sequence,
	})
	if err != nil {
		return fmt.Errorf("encode realtime event wake: %w", err)
	}
	if err := database.Exec(
		"SELECT pg_notify('"+realtimeEventWakeChannel+"', ?)",
		string(payload),
	).Error; err != nil {
		return fmt.Errorf("notify realtime event wake: %w", err)
	}
	return nil
}

func (s *gormEventStore) ReplayRange(
	actorPTID string,
	afterSequence uint64,
	throughSequence uint64,
	limit int,
) ([]durableEventRecord, error) {
	if actorPTID == "" || throughSequence <= afterSequence {
		return nil, nil
	}
	var rows []realtimeEventModel
	query := s.db.
		Where(
			"actor_ptid = ? AND sequence > ? AND sequence <= ?",
			actorPTID,
			afterSequence,
			throughSequence,
		).
		Order("sequence ASC")
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("replay realtime events: %w", err)
	}
	events := make([]durableEventRecord, 0, len(rows))
	for _, row := range rows {
		record, err := decodeDurableEvent(row)
		if err != nil {
			return nil, err
		}
		events = append(events, record)
	}
	return events, nil
}

func (s *gormEventStore) Head(
	actorPTID string,
) (durableEventHead, bool, error) {
	var row realtimeEventModel
	err := s.db.
		Where("actor_ptid = ?", actorPTID).
		Order("sequence DESC").
		Limit(1).
		Find(&row).Error
	if err != nil {
		return durableEventHead{}, false, fmt.Errorf(
			"load realtime event head: %w",
			err,
		)
	}
	if row.Sequence == 0 || row.EventID == "" {
		return durableEventHead{}, false, nil
	}
	return durableEventHead{
		Sequence: row.Sequence,
		EventID:  row.EventID,
	}, true, nil
}

func (s *gormEventStore) OldestSequence(
	actorPTID string,
) (uint64, bool, error) {
	var row realtimeEventModel
	err := s.db.
		Where("actor_ptid = ?", actorPTID).
		Order("sequence ASC").
		Limit(1).
		Find(&row).Error
	if err != nil {
		return 0, false, fmt.Errorf(
			"load oldest realtime event: %w",
			err,
		)
	}
	if row.Sequence == 0 {
		return 0, false, nil
	}
	return row.Sequence, true, nil
}

func (s *gormEventStore) CursorSequence(
	actorPTID string,
	eventID string,
) (uint64, bool, error) {
	if actorPTID == "" || eventID == "" {
		return 0, false, nil
	}
	var row realtimeEventModel
	err := s.db.
		Select("sequence").
		Where("actor_ptid = ? AND event_id = ?", actorPTID, eventID).
		Limit(1).
		Find(&row).Error
	if err != nil {
		return 0, false, fmt.Errorf(
			"resolve realtime event cursor: %w",
			err,
		)
	}
	if row.Sequence == 0 {
		return 0, false, nil
	}
	return row.Sequence, true, nil
}

func decodeDurableEvent(
	row realtimeEventModel,
) (durableEventRecord, error) {
	ev := &realtime.StreamEvent{}
	if err := proto.Unmarshal(row.KindBytes, ev); err != nil {
		return durableEventRecord{}, fmt.Errorf(
			"unmarshal realtime event %s: %w",
			row.EventID,
			err,
		)
	}
	if ev.GetEventId() != row.EventID {
		return durableEventRecord{}, fmt.Errorf(
			"realtime event %s payload identity mismatch",
			row.EventID,
		)
	}
	return durableEventRecord{
		Sequence:       row.Sequence,
		TargetDeviceID: row.TargetDeviceID,
		Event:          ev,
	}, nil
}

func backfillRealtimeEventSequences(database *gorm.DB) error {
	return database.Transaction(func(transaction *gorm.DB) error {
		var actors []string
		if err := transaction.Model(&realtimeEventModel{}).
			Distinct("actor_ptid").
			Order("actor_ptid ASC").
			Pluck("actor_ptid", &actors).Error; err != nil {
			return fmt.Errorf(
				"list realtime actors for sequence migration: %w",
				err,
			)
		}
		for _, actorPTID := range actors {
			var rows []realtimeEventModel
			if err := transaction.
				Where("actor_ptid = ?", actorPTID).
				Order("created_at ASC").
				Order("id ASC").
				Find(&rows).Error; err != nil {
				return fmt.Errorf(
					"load realtime actor events for sequence migration: %w",
					err,
				)
			}
			var zeroCount int
			var maxSequence uint64
			for _, row := range rows {
				if row.Sequence == 0 {
					zeroCount++
					continue
				}
				if row.Sequence > maxSequence {
					maxSequence = row.Sequence
				}
			}
			if zeroCount != 0 && zeroCount != len(rows) {
				return fmt.Errorf(
					"realtime actor %s has partially assigned event sequences",
					actorPTID,
				)
			}
			if zeroCount == len(rows) {
				for index := range rows {
					sequence := uint64(index + 1)
					if err := transaction.Model(&realtimeEventModel{}).
						Where("id = ?", rows[index].ID).
						Update("sequence", sequence).Error; err != nil {
						return fmt.Errorf(
							"backfill realtime event sequence: %w",
							err,
						)
					}
					maxSequence = sequence
				}
			}
			if maxSequence == 0 {
				continue
			}
			var head actorEventSequenceModel
			if err := transaction.
				Where("actor_ptid = ?", actorPTID).
				FirstOrCreate(
					&head,
					actorEventSequenceModel{
						ActorPTID:             actorPTID,
						LastCommittedSequence: maxSequence,
					},
				).Error; err != nil {
				return fmt.Errorf(
					"create realtime actor sequence head: %w",
					err,
				)
			}
			if head.LastCommittedSequence > maxSequence {
				return fmt.Errorf(
					"realtime actor %s sequence head %d exceeds event log %d",
					actorPTID,
					head.LastCommittedSequence,
					maxSequence,
				)
			}
			if head.LastCommittedSequence < maxSequence {
				if err := transaction.Model(&head).Update(
					"last_committed_sequence",
					maxSequence,
				).Error; err != nil {
					return fmt.Errorf(
						"advance realtime actor sequence head: %w",
						err,
					)
				}
			}
		}
		return nil
	})
}

func renamePTIDColumn(db *gorm.DB, table, legacy, canonical string) error {
	if !db.Migrator().HasTable(table) || !db.Migrator().HasColumn(table, legacy) {
		return nil
	}
	if db.Migrator().HasColumn(table, canonical) {
		return fmt.Errorf("%s contains both %s and %s", table, legacy, canonical)
	}
	if db.Dialector.Name() == "sqlite" {
		return db.Exec(
			"ALTER TABLE " + table + " RENAME COLUMN " + legacy + " TO " + canonical,
		).Error
	}
	return db.Migrator().RenameColumn(table, legacy, canonical)
}
