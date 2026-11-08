package infrastructure

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type FeedChainRecord struct {
	ActorPTID         string `gorm:"column:actor_ptid;primaryKey;size:255"`
	ChainID           string `gorm:"primaryKey;size:128"`
	HomeStationPeerID string `gorm:"size:255;not null"`
	Genesis           []byte `gorm:"type:bytea;not null"`
	WriterGrant       []byte `gorm:"type:bytea;not null"`
	Sequence          uint64 `gorm:"not null"`
	HeadHash          []byte `gorm:"type:bytea;not null"`
	Forked            bool   `gorm:"not null"`
	UpdatedAt         time.Time
}

func (FeedChainRecord) TableName() string { return "social_feed_chains" }

type FeedEventRecord struct {
	ActorPTID string `gorm:"column:actor_ptid;primaryKey;size:255"`
	ChainID   string `gorm:"primaryKey;size:128"`
	Sequence  uint64 `gorm:"primaryKey;autoIncrement:false"`
	EventHash []byte `gorm:"type:bytea;not null"`
	Event     []byte `gorm:"type:bytea;not null"`
}

func (FeedEventRecord) TableName() string { return "social_feed_events" }

// One intent per chain/event. A worker materializes bounded per-Station outbox
// pages; the append transaction never enumerates every follower.
type FeedFanoutRecord struct {
	ActorPTID     string    `gorm:"column:actor_ptid;primaryKey;size:255"`
	ChainID       string    `gorm:"primaryKey;size:128"`
	Sequence      uint64    `gorm:"primaryKey;autoIncrement:false"`
	AfterStation  string    `gorm:"size:255;not null"`
	Completed     bool      `gorm:"not null;index"`
	NextAttemptAt time.Time `gorm:"not null;index"`
}

func (FeedFanoutRecord) TableName() string { return "social_feed_fanout" }

type FeedSubscriptionRecord struct {
	AuthorPTID        string    `gorm:"column:author_ptid;primaryKey;size:255"`
	ChainID           string    `gorm:"primaryKey;size:128"`
	SubscriberPTID    string    `gorm:"column:subscriber_ptid;primaryKey;size:255"`
	SubscriberStation string    `gorm:"size:255;not null;index"`
	AuthorStation     string    `gorm:"size:255;not null"`
	Revision          uint64    `gorm:"not null"`
	Enabled           bool      `gorm:"not null;index"`
	Dirty             bool      `gorm:"not null"`
	DirtyRevision     uint64    `gorm:"not null"`
	ThreadCursor      uint64    `gorm:"not null"`
	NextSyncAt        time.Time `gorm:"not null;index"`
}

func (FeedSubscriptionRecord) TableName() string { return "social_feed_subscriptions" }

// An interaction receipt proves authenticity, not full author-chain continuity.
type FeedInteractionRecord struct {
	ActorPTID        string    `gorm:"column:actor_ptid;primaryKey;size:255"`
	ChainID          string    `gorm:"primaryKey;size:128"`
	Sequence         uint64    `gorm:"primaryKey;autoIncrement:false"`
	EventHash        []byte    `gorm:"type:bytea;not null"`
	Interaction      []byte    `gorm:"type:bytea;not null"`
	TargetStation    string    `gorm:"size:255;not null;index"`
	HomeStation      string    `gorm:"size:255;not null"`
	Projected        bool      `gorm:"not null;index"`
	Forwarded        bool      `gorm:"not null;index"`
	OutboundFrameID  string    `gorm:"size:512;not null"`
	DeliveryRevision uint64    `gorm:"not null"`
	NextAttemptAt    time.Time `gorm:"not null;index"`
}

func (FeedInteractionRecord) TableName() string { return "social_feed_interactions" }

type FeedInteractionFanout struct {
	ActorPTID     string    `gorm:"column:actor_ptid;primaryKey;size:255"`
	ChainID       string    `gorm:"primaryKey;size:128"`
	Sequence      uint64    `gorm:"primaryKey;autoIncrement:false"`
	PostRef       string    `gorm:"not null;size:512"`
	AfterStation  string    `gorm:"not null;size:255"`
	Completed     bool      `gorm:"not null;index"`
	NextAttemptAt time.Time `gorm:"not null;index"`
}

func (FeedInteractionFanout) TableName() string { return "social_feed_interaction_fanout" }

type FeedReactionVersion struct {
	TargetRef string `gorm:"primaryKey;size:512"`
	ActorPTID string `gorm:"column:actor_ptid;primaryKey;size:255"`
	Kind      int32  `gorm:"primaryKey;autoIncrement:false"`
	Sequence  uint64 `gorm:"not null"`
}

func (FeedReactionVersion) TableName() string { return "social_feed_reaction_versions" }

type FeedLogStore struct{ database *gorm.DB }

type FeedQuarantineRecord struct {
	ActorPTID string `gorm:"column:actor_ptid;primaryKey;size:255"`
	ChainID   string `gorm:"primaryKey;size:128"`
}

func (FeedQuarantineRecord) TableName() string { return "social_feed_quarantines" }

func (s *FeedLogStore) QuarantineInteraction(ctx context.Context, tx *gorm.DB, actor, chain string) error {
	return tx.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).
		Create(&FeedQuarantineRecord{ActorPTID: actor, ChainID: chain}).Error
}

func checkFeedQuarantine(ctx context.Context, tx *gorm.DB, actor, chain string) error {
	var count int64
	if err := tx.WithContext(ctx).Model(&FeedQuarantineRecord{}).
		Where("actor_ptid = ? AND chain_id = ?", actor, chain).Count(&count).Error; err != nil {
		return err
	}
	if count != 0 {
		return domain.ErrFeedFork
	}
	return nil
}

func NewFeedLogStore(database *gorm.DB) (*FeedLogStore, error) {
	if database == nil {
		return nil, errors.New("feed database is required")
	}
	return &FeedLogStore{database: database}, nil
}

func (s *FeedLogStore) Migrate(ctx context.Context) error {
	if s.database.Migrator().HasColumn(&FeedReactionVersion{}, "post_ref") &&
		!s.database.Migrator().HasColumn(&FeedReactionVersion{}, "target_ref") {
		if err := s.database.Migrator().RenameColumn(&FeedReactionVersion{}, "post_ref", "target_ref"); err != nil {
			return err
		}
	}
	return s.database.WithContext(ctx).AutoMigrate(
		&FeedChainRecord{}, &FeedEventRecord{}, &FeedFanoutRecord{},
		&FeedSubscriptionRecord{}, &FeedInteractionRecord{},
		&FeedObjectRecord{},
		&FeedReactionVersion{},
		&FeedInteractionFanout{},
		&FeedThreadHead{}, &FeedThreadRecord{}, &FeedQuarantineRecord{},
	)
}

func (s *FeedLogStore) Transaction(ctx context.Context, run func(*gorm.DB) error) error {
	return s.database.WithContext(ctx).Transaction(run)
}

type feedTransaction struct {
	db          *gorm.DB
	outbox      delivery.OutboxWriter
	afterCommit []delivery.AfterCommitFunc
}

func (t *feedTransaction) DB() *gorm.DB                  { return t.db }
func (t *feedTransaction) Outbox() delivery.OutboxWriter { return t.outbox }
func (t *feedTransaction) AfterCommit(callback delivery.AfterCommitFunc) error {
	if callback == nil {
		return domain.ErrFeedInvalid
	}
	t.afterCommit = append(t.afterCommit, callback)
	return nil
}

type feedTransactionKey struct{}

func FeedTransactionContext(ctx context.Context, tx delivery.Transaction) context.Context {
	return context.WithValue(ctx, feedTransactionKey{}, tx)
}
func FeedTransactionFromContext(ctx context.Context) delivery.Transaction {
	tx, _ := ctx.Value(feedTransactionKey{}).(delivery.Transaction)
	return tx
}

func (s *FeedLogStore) Execute(ctx context.Context, run func(delivery.Transaction) error) error {
	var transaction *feedTransaction
	err := s.Transaction(ctx, func(tx *gorm.DB) error {
		outbox, err := delivery.NewGORMRepository(tx, delivery.SystemClock{})
		if err != nil {
			return err
		}
		transaction = &feedTransaction{db: tx, outbox: outbox}
		return run(transaction)
	})
	if err != nil {
		return err
	}
	for _, callback := range transaction.afterCommit {
		if err := callback(ctx); err != nil {
			return err
		}
	}
	return nil
}

type FeedApply func(context.Context, *gorm.DB, *model.FeedEvent) error

// AppendTx authenticates and applies a contiguous bundle in one SQL transaction.
// ErrFeedFork is a committed quarantine outcome: callers must not roll it back.
// All other errors must roll back the transaction.
func (s *FeedLogStore) AppendTx(
	ctx context.Context, tx *gorm.DB, bundle *model.FeedBundle,
	actorPTID, homeStation string, trustedRoot []byte, apply FeedApply, fanout bool,
) (*model.FeedHead, bool, error) {
	if tx == nil || bundle == nil || homeStation == "" || apply == nil ||
		len(bundle.Events) == 0 || len(bundle.Events) > 64 {
		return nil, false, domain.ErrFeedInvalid
	}
	if _, err := signedlog.Canonical(bundle); err != nil {
		return nil, false, domain.ErrFeedInvalid
	}
	if err := domain.VerifyFeedAuthorization(bundle.Genesis, bundle.WriterGrant, actorPTID, trustedRoot); err != nil {
		return nil, false, err
	}
	if err := checkFeedQuarantine(ctx, tx, actorPTID, domain.PublicFeedChainID); err != nil {
		return nil, false, err
	}
	for _, event := range bundle.Events {
		if err := domain.VerifyFeedEvent(event, bundle.WriterGrant); err != nil {
			return nil, false, err
		}
	}
	genesis, err := signedlog.Canonical(bundle.Genesis)
	if err != nil {
		return nil, false, err
	}
	grant, err := signedlog.Canonical(bundle.WriterGrant)
	if err != nil {
		return nil, false, err
	}
	initialHash, err := signedlog.Hash(domain.FeedGenesisDomain, bundle.Genesis)
	if err != nil {
		return nil, false, err
	}
	chain := FeedChainRecord{
		ActorPTID: actorPTID, ChainID: domain.PublicFeedChainID,
		HomeStationPeerID: homeStation, Genesis: genesis, WriterGrant: grant,
		HeadHash: initialHash, UpdatedAt: time.Now().UTC(),
	}
	if err := tx.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&chain).Error; err != nil {
		return nil, false, err
	}
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("actor_ptid = ? AND chain_id = ?", actorPTID, domain.PublicFeedChainID).
		Take(&chain).Error; err != nil {
		return nil, false, err
	}
	if chain.Forked {
		return nil, false, domain.ErrFeedFork
	}
	if !bytes.Equal(chain.Genesis, genesis) || !bytes.Equal(chain.WriterGrant, grant) {
		return nil, false, domain.ErrFeedWriter
	}
	if chain.HomeStationPeerID != homeStation {
		return nil, false, domain.ErrFeedWriter
	}
	if err := s.verifyStoredHead(ctx, tx, &chain, bundle.Genesis, bundle.WriterGrant); err != nil {
		return nil, false, err
	}
	head := &model.FeedHead{ActorPtid: actorPTID, ChainId: chain.ChainID, Sequence: chain.Sequence, EventHash: chain.HeadHash}
	duplicate := true
	var pending []*model.FeedEvent
	for _, event := range bundle.Events {
		hash, err := domain.FeedEventHash(event)
		if err != nil {
			return nil, false, err
		}
		sequence := event.Statement.Sequence
		var receipt FeedInteractionRecord
		receiptErr := tx.Where("actor_ptid = ? AND chain_id = ? AND sequence = ?", actorPTID, chain.ChainID, sequence).Take(&receipt).Error
		if receiptErr == nil {
			expected, err := signedlog.Canonical(&model.FeedInteraction{
				Genesis: bundle.Genesis, WriterGrant: bundle.WriterGrant, Event: event,
			})
			if err != nil {
				return nil, false, err
			}
			if receipt.HomeStation != homeStation || !bytes.Equal(receipt.Interaction, expected) {
				return nil, false, s.quarantine(ctx, tx, &chain)
			}
		} else if !errors.Is(receiptErr, gorm.ErrRecordNotFound) {
			return nil, false, receiptErr
		}
		if sequence <= head.Sequence {
			var existing FeedEventRecord
			if err := tx.Where("actor_ptid = ? AND chain_id = ? AND sequence = ?", actorPTID, chain.ChainID, sequence).Take(&existing).Error; err != nil {
				return nil, false, err
			}
			if bytes.Equal(existing.EventHash, hash) {
				expected, err := signedlog.Canonical(event)
				if err != nil || !bytes.Equal(existing.Event, expected) {
					return nil, false, domain.ErrFeedInvalid
				}
				continue
			}
			return nil, false, s.quarantine(ctx, tx, &chain)
		}
		next, err := domain.AdvanceFeedHead(head, event)
		if errors.Is(err, domain.ErrFeedFork) {
			return nil, false, s.quarantine(ctx, tx, &chain)
		}
		if err != nil {
			return nil, false, err
		}
		pending = append(pending, event)
		head, duplicate = next, false
	}
	callbackOwner, _ := FeedTransactionFromContext(ctx).(*feedTransaction)
	callbackCount := 0
	if callbackOwner != nil {
		callbackCount = len(callbackOwner.afterCommit)
	}
	if err := tx.SavePoint("feed_append_projection").Error; err != nil {
		return nil, false, err
	}
	for _, event := range pending {
		sequence := event.Statement.Sequence
		hash, err := domain.FeedEventHash(event)
		if err != nil {
			return nil, false, err
		}
		encoded, err := signedlog.Canonical(event)
		if err != nil {
			return nil, false, err
		}
		if err := tx.Create(&FeedEventRecord{ActorPTID: actorPTID, ChainID: chain.ChainID, Sequence: sequence, EventHash: hash, Event: encoded}).Error; err != nil {
			return nil, false, err
		}
		if err := apply(ctx, tx, event); err != nil {
			if errors.Is(err, domain.ErrFeedFork) {
				if rollback := tx.RollbackTo("feed_append_projection").Error; rollback != nil {
					return nil, false, rollback
				}
				if callbackOwner != nil {
					callbackOwner.afterCommit = callbackOwner.afterCommit[:callbackCount]
				}
				return nil, false, s.quarantine(ctx, tx, &chain)
			}
			return nil, false, err
		}
		if fanout {
			if err := tx.Create(&FeedFanoutRecord{ActorPTID: actorPTID, ChainID: chain.ChainID, Sequence: sequence}).Error; err != nil {
				return nil, false, err
			}
		}
	}
	result := tx.Model(&FeedChainRecord{}).
		Where("actor_ptid = ? AND chain_id = ? AND sequence = ?", actorPTID, chain.ChainID, chain.Sequence).
		Updates(map[string]interface{}{"sequence": head.Sequence, "head_hash": head.EventHash, "updated_at": time.Now().UTC()})
	if result.Error != nil {
		return nil, false, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, false, errors.New("FEED_CONCURRENT_WRITE")
	}
	return head, duplicate, nil
}

func (s *FeedLogStore) quarantine(ctx context.Context, tx *gorm.DB, chain *FeedChainRecord) error {
	if err := tx.WithContext(ctx).Model(chain).Update("forked", true).Error; err != nil {
		return err
	}
	return domain.ErrFeedFork
}

func (s *FeedLogStore) Read(ctx context.Context, tx *gorm.DB, request *model.ReadFeedRequest) (*model.ReadFeedResponse, error) {
	if tx == nil || request == nil || request.ActorPtid == "" || request.ChainId != domain.PublicFeedChainID {
		return nil, domain.ErrFeedInvalid
	}
	limit := int(request.Limit)
	if limit == 0 {
		limit = 32
	}
	if limit > 64 {
		return nil, domain.ErrFeedInvalid
	}
	var chain FeedChainRecord
	if err := checkFeedQuarantine(ctx, tx, request.ActorPtid, request.ChainId); err != nil {
		return nil, err
	}
	if err := tx.WithContext(ctx).Where("actor_ptid = ? AND chain_id = ?", request.ActorPtid, request.ChainId).Take(&chain).Error; err != nil {
		return nil, err
	}
	if chain.Forked {
		return nil, domain.ErrFeedFork
	}
	if request.AfterSequence > chain.Sequence {
		return nil, domain.ErrFeedRollback
	}
	bundle := &model.FeedBundle{Genesis: &model.FeedGenesis{}, WriterGrant: &model.FeedWriterGrant{}}
	if err := signedlog.Decode(chain.Genesis, bundle.Genesis); err != nil {
		return nil, err
	}
	if err := signedlog.Decode(chain.WriterGrant, bundle.WriterGrant); err != nil {
		return nil, err
	}
	if err := s.verifyStoredHead(ctx, tx, &chain, bundle.Genesis, bundle.WriterGrant); err != nil {
		return nil, err
	}
	previous, err := signedlog.Hash(domain.FeedGenesisDomain, bundle.Genesis)
	if err != nil {
		return nil, err
	}
	if request.AfterSequence > 0 {
		row, err := s.verifiedEvent(ctx, tx, &chain, request.AfterSequence, bundle.WriterGrant)
		if err != nil {
			return nil, err
		}
		previous = row.EventHash
	}
	cursor := &model.FeedHead{ActorPtid: chain.ActorPTID, ChainId: chain.ChainID,
		Sequence: request.AfterSequence, EventHash: previous}
	var rows []FeedEventRecord
	if err := tx.Where("actor_ptid = ? AND chain_id = ? AND sequence > ? AND sequence <= ?", request.ActorPtid, request.ChainId, request.AfterSequence, chain.Sequence).
		Order("sequence").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		event := &model.FeedEvent{}
		if err := signedlog.Decode(row.Event, event); err != nil {
			return nil, err
		}
		if err := domain.VerifyFeedEvent(event, bundle.WriterGrant); err != nil {
			return nil, err
		}
		if event.Statement.Sequence != row.Sequence {
			return nil, domain.ErrFeedInvalid
		}
		next, err := domain.AdvanceFeedHead(cursor, event)
		if err != nil {
			return nil, err
		}
		if !bytes.Equal(next.EventHash, row.EventHash) {
			return nil, domain.ErrFeedInvalid
		}
		candidate := proto.Clone(bundle).(*model.FeedBundle)
		candidate.Events = append(candidate.Events, event)
		if proto.Size(candidate) > signedlog.MaxMessageBytes {
			if len(bundle.Events) == 0 {
				return nil, fmt.Errorf("feed event exceeds response budget")
			}
			break
		}
		bundle.Events = append(bundle.Events, event)
		cursor = next
	}
	last := request.AfterSequence
	if len(bundle.Events) > 0 {
		last = bundle.Events[len(bundle.Events)-1].Statement.Sequence
	}
	if last < chain.Sequence && len(bundle.Events) == 0 {
		return nil, domain.ErrFeedGap
	}
	response := &model.ReadFeedResponse{Bundle: bundle,
		Head:    &model.FeedHead{ActorPtid: chain.ActorPTID, ChainId: chain.ChainID, Sequence: chain.Sequence, EventHash: chain.HeadHash},
		HasMore: last < chain.Sequence}
	if request.IncludeThread {
		if err := s.readThread(ctx, tx, request, response); err != nil {
			return nil, err
		}
	}
	return response, nil
}

func (s *FeedLogStore) verifiedEvent(ctx context.Context, tx *gorm.DB, chain *FeedChainRecord,
	sequence uint64, grant *model.FeedWriterGrant) (*FeedEventRecord, error) {
	var row FeedEventRecord
	if err := tx.WithContext(ctx).Where("actor_ptid = ? AND chain_id = ? AND sequence = ?",
		chain.ActorPTID, chain.ChainID, sequence).Take(&row).Error; err != nil {
		return nil, err
	}
	event := &model.FeedEvent{}
	if err := signedlog.Decode(row.Event, event); err != nil {
		return nil, err
	}
	if err := domain.VerifyFeedEvent(event, grant); err != nil {
		return nil, err
	}
	if event.Statement.Sequence != sequence {
		return nil, domain.ErrFeedInvalid
	}
	hash, err := domain.FeedEventHash(event)
	if err != nil || !bytes.Equal(hash, row.EventHash) {
		return nil, domain.ErrFeedInvalid
	}
	return &row, nil
}

func (s *FeedLogStore) verifyStoredHead(ctx context.Context, tx *gorm.DB, chain *FeedChainRecord,
	genesis *model.FeedGenesis, grant *model.FeedWriterGrant) error {
	if genesis == nil || genesis.Statement == nil {
		return domain.ErrFeedInvalid
	}
	if err := domain.VerifyFeedAuthorization(genesis, grant, chain.ActorPTID,
		genesis.Statement.ActorIdentityPublicKey); err != nil {
		return err
	}
	if chain.Sequence == 0 {
		hash, err := signedlog.Hash(domain.FeedGenesisDomain, genesis)
		if err != nil || !bytes.Equal(hash, chain.HeadHash) {
			return domain.ErrFeedInvalid
		}
		return nil
	}
	row, err := s.verifiedEvent(ctx, tx, chain, chain.Sequence, grant)
	if err != nil {
		return err
	}
	if !bytes.Equal(row.EventHash, chain.HeadHash) {
		return domain.ErrFeedInvalid
	}
	return nil
}
