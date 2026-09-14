package infrastructure

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	PrivateContentResourcePost    = "POST"
	PrivateContentResourceComment = "COMMENT"

	PrivateContentKeyKindEndpoint      = "ENDPOINT"
	PrivateContentKeyKindActorRecovery = "ACTOR_RECOVERY"
)

var (
	ErrPrivateContentConflict     = errors.New("social private content conflict")
	ErrPrivateContentInvalid      = errors.New("social private content invalid")
	ErrPrivateContentInvalidState = errors.New("social private content invalid state")
	ErrPrivateContentNotFound     = errors.New("social private content not found")
	ErrPrivateContentStalePlan    = errors.New("social private content stale plan")
	ErrPrivateContentExpiredPlan  = errors.New("social private content expired plan")
)

// PrivateContentWriteBoundary identifies a completed SQL write. A failpoint
// error returned after one of these boundaries aborts the owning transaction.
type PrivateContentWriteBoundary string

const (
	PrivateContentBoundaryPlanPreparing     PrivateContentWriteBoundary = "plan_preparing"
	PrivateContentBoundaryClaimResponse     PrivateContentWriteBoundary = "claim_response"
	PrivateContentBoundaryPlanSlots         PrivateContentWriteBoundary = "plan_slots"
	PrivateContentBoundaryPlanPrepared      PrivateContentWriteBoundary = "plan_prepared"
	PrivateContentBoundaryPlanConsumed      PrivateContentWriteBoundary = "plan_consumed"
	PrivateContentBoundaryPostFact          PrivateContentWriteBoundary = "post_fact"
	PrivateContentBoundaryCommentFact       PrivateContentWriteBoundary = "comment_fact"
	PrivateContentBoundaryAudienceSnapshot  PrivateContentWriteBoundary = "audience_snapshot"
	PrivateContentBoundaryRecipientGrants   PrivateContentWriteBoundary = "recipient_grants"
	PrivateContentBoundaryEndpointEnvelopes PrivateContentWriteBoundary = "endpoint_envelopes"
	PrivateContentBoundaryRecoveryEnvelopes PrivateContentWriteBoundary = "recovery_envelopes"
	PrivateContentBoundaryDeliveryIntents   PrivateContentWriteBoundary = "delivery_intents"
	PrivateContentBoundaryObjectAttachment  PrivateContentWriteBoundary = "object_attachment"
	PrivateContentBoundaryObjectGrants      PrivateContentWriteBoundary = "object_grants"
	PrivateContentBoundaryCommitProof       PrivateContentWriteBoundary = "commit_proof"
	PrivateContentBoundaryCommandReceipt    PrivateContentWriteBoundary = "command_receipt"
)

type PrivateContentFailpoint interface {
	AfterPrivateContentWrite(context.Context, PrivateContentWriteBoundary) error
}

type PrivateContentFailpointFunc func(
	context.Context,
	PrivateContentWriteBoundary,
) error

func (f PrivateContentFailpointFunc) AfterPrivateContentWrite(
	ctx context.Context,
	boundary PrivateContentWriteBoundary,
) error {
	return f(ctx, boundary)
}

type PrivateContentStoreOption func(*GORMPrivateContentStore)

func WithPrivateContentFailpoint(
	failpoint PrivateContentFailpoint,
) PrivateContentStoreOption {
	return func(store *GORMPrivateContentStore) {
		store.failpoint = failpoint
	}
}

type PreparingPlanResult struct {
	Plan        dbmodel.SocialPrivateContentPlan
	ExactReplay bool
}

type PreparedPlan struct {
	PlanID                 string
	CanonicalPrepareSHA256 []byte
	ClaimResponseBytes     []byte
	ClaimResponseSHA256    []byte
	CanonicalPlanSHA256    []byte
	SignedPlanBytes        []byte
	SignedPlanSHA256       []byte
	Slots                  []dbmodel.SocialPrivateContentPlanSlot
	PreparedAt             time.Time
}

type PreparedPlanResult struct {
	Plan        dbmodel.SocialPrivateContentPlan
	Slots       []dbmodel.SocialPrivateContentPlanSlot
	ExactReplay bool
}

type SubmitCommand struct {
	PlanID                string
	AuthorPTID            string
	CommandID             string
	CanonicalSubmitSHA256 []byte
	DomainCommitID        string
}

type SubmitResult struct {
	Receipt     dbmodel.SocialPrivateCommandReceipt
	ExactReplay bool
}

type SubmitMutationResult struct {
	ResponseBytes []byte
	CompletedAt   time.Time
}

type PrivateObjectAttachment struct {
	ObjectID         string
	ContentID        string
	DescriptorSHA256 []byte
	DomainCommitID   string
	AttachedAt       time.Time
}

// PrivateContentTransaction exposes repositories bound to exactly one Social
// transaction. Implementations never create or commit nested transactions.
type PrivateContentTransaction interface {
	ContentPreKeyValidationTransaction() federationdelivery.Transaction
	RejectStale(context.Context) error
	Expire(context.Context) error
	CreatePost(context.Context, dbmodel.SocialPrivateContentPost) error
	CreateComment(context.Context, dbmodel.SocialPrivateContentComment) error
	CreateAudienceSnapshot(
		context.Context,
		dbmodel.SocialPrivateAudienceSnapshot,
	) error
	CreateRecipientGrants(
		context.Context,
		[]dbmodel.SocialPrivateRecipientGrant,
	) error
	CreateEnvelopes(
		context.Context,
		[]dbmodel.SocialPrivateContentEnvelope,
	) error
	CreateDeliveryIntents(
		context.Context,
		[]dbmodel.SocialPrivateDeliveryIntent,
	) error
	AttachObjects(context.Context, []PrivateObjectAttachment) error
	CreateObjectGrants(
		context.Context,
		[]dbmodel.SocialPrivateObjectGrant,
	) error
	CreateCommitProof(
		context.Context,
		dbmodel.SocialPrivateCommitProof,
	) error
}

type SubmitMutation func(
	context.Context,
	PrivateContentTransaction,
	dbmodel.SocialPrivateContentPlan,
) (SubmitMutationResult, error)

// PrivateContentUnitOfWork owns all SQL state written by one private Social
// submit. ExecuteSubmit additionally owns plan consumption and the immutable
// command receipt.
type PrivateContentUnitOfWork interface {
	Execute(context.Context, func(PrivateContentTransaction) error) error
	ExecuteSubmit(context.Context, SubmitCommand, SubmitMutation) (SubmitResult, error)
}

type PrivateContentStore interface {
	PrivateContentUnitOfWork
	Migrate(context.Context) error
	FindPrepare(
		context.Context,
		string,
		string,
		[]byte,
	) (PreparingPlanResult, bool, error)
	ExpirePlan(context.Context, string, time.Time) error
	GetPrivatePost(
		context.Context,
		string,
		string,
		string,
	) (*PrivatePostReadModel, error)
	GetPrivateComment(
		context.Context,
		string,
		string,
		string,
		string,
	) (*PrivateCommentReadModel, error)
	ClaimPreparing(
		context.Context,
		dbmodel.SocialPrivateContentPlan,
	) (PreparingPlanResult, error)
	MarkPrepared(context.Context, PreparedPlan) (PreparedPlanResult, error)
}

func (s *GORMPrivateContentStore) ExpirePlan(
	ctx context.Context,
	planID string,
	expiredAt time.Time,
) error {
	if strings.TrimSpace(planID) == "" || expiredAt.IsZero() {
		return fmt.Errorf(
			"%w: plan ID and expiry time are required",
			ErrPrivateContentInvalid,
		)
	}
	return s.withSerializedTransaction(
		ctx,
		[]string{"prepare-plan:" + planID},
		func(tx *gorm.DB) error {
			plan, err := lockPrivateContentPlan(tx, planID)
			if err != nil {
				return err
			}
			switch plan.State {
			case dbmodel.SocialPrivatePlanStateExpired:
				return nil
			case dbmodel.SocialPrivatePlanStatePreparing,
				dbmodel.SocialPrivatePlanStatePreKeysClaimed,
				dbmodel.SocialPrivatePlanStatePrepared:
			default:
				return fmt.Errorf(
					"%w: plan %s is %s",
					ErrPrivateContentInvalidState,
					plan.PlanID,
					plan.State,
				)
			}
			if plan.ExpiresAt.After(expiredAt.UTC()) {
				return fmt.Errorf(
					"%w: plan %s has not expired",
					ErrPrivateContentInvalidState,
					plan.PlanID,
				)
			}
			update := tx.Model(&dbmodel.SocialPrivateContentPlan{}).
				Where(
					"plan_id = ? AND state = ?",
					plan.PlanID,
					plan.State,
				).
				Update("state", dbmodel.SocialPrivatePlanStateExpired)
			if update.Error != nil {
				return fmt.Errorf(
					"social private content expire plan: %w",
					update.Error,
				)
			}
			if update.RowsAffected != 1 {
				return fmt.Errorf(
					"%w: plan %s expiry raced",
					ErrPrivateContentInvalidState,
					plan.PlanID,
				)
			}
			return nil
		},
	)
}

type GORMPrivateContentStore struct {
	db        *gorm.DB
	failpoint PrivateContentFailpoint
}

type gormPrivateContentTransaction struct {
	db             *gorm.DB
	failpoint      PrivateContentFailpoint
	plan           *dbmodel.SocialPrivateContentPlan
	domainCommitID string
	terminalErr    error
}

type privateContentValidationTransaction struct {
	db *gorm.DB
}

var privateContentSQLiteLocks sync.Map

func (t privateContentValidationTransaction) DB() *gorm.DB {
	return t.db
}

func (privateContentValidationTransaction) Outbox() federationdelivery.OutboxWriter {
	return nil
}

func (tx *gormPrivateContentTransaction) ContentPreKeyValidationTransaction() federationdelivery.Transaction {
	return privateContentValidationTransaction{db: tx.db}
}

func NewGORMPrivateContentStore(
	db *gorm.DB,
	options ...PrivateContentStoreOption,
) (*GORMPrivateContentStore, error) {
	if db == nil {
		return nil, fmt.Errorf("%w: database is required", ErrPrivateContentInvalid)
	}
	store := &GORMPrivateContentStore{db: db}
	for _, option := range options {
		if option != nil {
			option(store)
		}
	}
	return store, nil
}

func (s *GORMPrivateContentStore) Migrate(ctx context.Context) error {
	database := s.db.WithContext(ctx)
	if err := migratePrivateContentPost(database); err != nil {
		return fmt.Errorf("social private content migrate Post: %w", err)
	}
	models := make([]any, 0, len(dbmodel.SocialPrivateContentModels()))
	for _, model := range dbmodel.SocialPrivateContentModels() {
		if _, isPost := model.(*dbmodel.SocialPrivateContentPost); isPost {
			continue
		}
		models = append(models, model)
	}
	if err := database.AutoMigrate(models...); err != nil {
		return fmt.Errorf("social private content migrate: %w", err)
	}
	return nil
}

func migratePrivateContentPost(database *gorm.DB) error {
	const table = "social_private_posts"
	if !database.Migrator().HasTable(table) {
		return database.AutoMigrate(&dbmodel.SocialPrivateContentPost{})
	}

	binaryType := "BLOB"
	integerType := "INTEGER"
	switch database.Dialector.Name() {
	case "postgres":
		binaryType = "BYTEA"
		integerType = "BIGINT"
	case "mysql":
		binaryType = "LONGBLOB"
		integerType = "BIGINT"
	}
	columns := []struct {
		name       string
		definition string
	}{
		{name: "post_id", definition: "VARCHAR(128)"},
		{name: "content_id", definition: "VARCHAR(128)"},
		{name: "author_ptid", definition: "VARCHAR(255)"},
		{name: "generation", definition: integerType},
		{name: "audience_snapshot_id", definition: "VARCHAR(128)"},
		{name: "kind", definition: "VARCHAR(32)"},
		{name: "encrypted_payload_bytes", definition: binaryType},
		{name: "encrypted_payload_sha256", definition: binaryType},
		{name: "object_descriptor_set_sha256", definition: binaryType},
		{name: "mention_routing_sha256", definition: binaryType},
		{name: "subtype_authority_sha256", definition: binaryType},
		{name: "lifecycle_state", definition: "VARCHAR(32)"},
		{name: "reactions_count", definition: integerType},
	}
	for _, column := range columns {
		if database.Migrator().HasColumn(table, column.name) {
			continue
		}
		statement := fmt.Sprintf(
			"ALTER TABLE %s ADD COLUMN %s %s",
			table,
			column.name,
			column.definition,
		)
		if err := database.Exec(statement).Error; err != nil {
			return fmt.Errorf("add %s: %w", column.name, err)
		}
	}
	for _, index := range []struct {
		name   string
		column string
	}{
		{name: "uidx_social_private_post_id", column: "post_id"},
		{name: "uidx_social_private_post_content", column: "content_id"},
	} {
		if database.Migrator().HasIndex(table, index.name) {
			continue
		}
		statement := fmt.Sprintf(
			"CREATE UNIQUE INDEX %s ON %s (%s)",
			index.name,
			table,
			index.column,
		)
		if database.Dialector.Name() == "sqlite" ||
			database.Dialector.Name() == "postgres" {
			statement += fmt.Sprintf(
				" WHERE %s IS NOT NULL AND %s <> ''",
				index.column,
				index.column,
			)
		}
		if err := database.Exec(statement).Error; err != nil {
			return fmt.Errorf("create %s: %w", index.name, err)
		}
	}
	return nil
}

type PrivatePostReadModel struct {
	Post           dbmodel.SocialPrivateContentPost
	Snapshot       dbmodel.SocialPrivateAudienceSnapshot
	Envelope       dbmodel.SocialPrivateContentEnvelope
	Objects        []dbmodel.SocialPrivateObjectAttachment
	CommitProof    dbmodel.SocialPrivateCommitProof
	AuthorDeviceID string
}

type PrivateCommentReadModel struct {
	Comment        dbmodel.SocialPrivateContentComment
	Snapshot       dbmodel.SocialPrivateAudienceSnapshot
	Envelope       dbmodel.SocialPrivateContentEnvelope
	Objects        []dbmodel.SocialPrivateObjectAttachment
	CommitProof    dbmodel.SocialPrivateCommitProof
	AuthorDeviceID string
}

func (s *GORMPrivateContentStore) GetPrivatePost(
	ctx context.Context,
	postID string,
	viewerPTID string,
	viewerDeviceID string,
) (*PrivatePostReadModel, error) {
	if strings.TrimSpace(postID) == "" ||
		strings.TrimSpace(viewerPTID) == "" ||
		strings.TrimSpace(viewerDeviceID) == "" {
		return nil, fmt.Errorf(
			"%w: private Post read identity is incomplete",
			ErrPrivateContentInvalid,
		)
	}
	var result *PrivatePostReadModel
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var post dbmodel.SocialPrivateContentPost
		if err := tx.Where(
			"post_id = ? AND deleted_at IS NULL",
			postID,
		).First(&post).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrPrivateContentNotFound
			}
			return err
		}
		var snapshot dbmodel.SocialPrivateAudienceSnapshot
		if err := tx.Where(
			"snapshot_id = ?",
			post.AudienceSnapshotID,
		).First(&snapshot).Error; err != nil {
			return err
		}
		if viewerPTID != post.AuthorPTID {
			var currentRelationshipCount int64
			if err := tx.Model(
				&federatedRelationshipProjectionModel{},
			).Where(
				"owner_ptid = ? AND peer_ptid = ?",
				post.AuthorPTID,
				viewerPTID,
			).Count(&currentRelationshipCount).Error; err != nil {
				return err
			}
			if currentRelationshipCount != 1 {
				return ErrPrivateContentNotFound
			}
			var blockCount int64
			if err := tx.Model(&friendshipModel{}).
				Where(
					"status = ? AND ((actor_ptid = ? AND peer_ptid = ?) OR (actor_ptid = ? AND peer_ptid = ?))",
					friendshipStatusBlocked,
					post.AuthorPTID,
					viewerPTID,
					viewerPTID,
					post.AuthorPTID,
				).
				Count(&blockCount).Error; err != nil {
				return err
			}
			if blockCount != 0 {
				return ErrPrivateContentNotFound
			}
			var grantCount int64
			if err := tx.Model(
				&dbmodel.SocialPrivateRecipientGrant{},
			).Where(
				"snapshot_id = ? AND recipient_ptid = ? AND revoked_at IS NULL",
				post.AudienceSnapshotID,
				viewerPTID,
			).Count(&grantCount).Error; err != nil {
				return err
			}
			if grantCount != 1 {
				return ErrPrivateContentNotFound
			}
		}
		var envelope dbmodel.SocialPrivateContentEnvelope
		if err := tx.Where(
			"content_id = ? AND key_kind = ? AND recipient_ptid = ? AND recipient_device_id = ?",
			post.ContentID,
			PrivateContentKeyKindEndpoint,
			viewerPTID,
			viewerDeviceID,
		).First(&envelope).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrPrivateContentNotFound
			}
			return err
		}
		var objects []dbmodel.SocialPrivateObjectAttachment
		if err := tx.Where(
			"content_id = ? AND state = ? AND domain_commit_id <> ''",
			post.ContentID,
			dbmodel.SocialPrivateObjectAttached,
		).Order("object_id ASC").Find(&objects).Error; err != nil {
			return err
		}
		var proof dbmodel.SocialPrivateCommitProof
		if err := tx.Where(
			"content_id = ? AND generation = ?",
			post.ContentID,
			post.Generation,
		).First(&proof).Error; err != nil {
			return err
		}
		var plan dbmodel.SocialPrivateContentPlan
		if err := tx.Where(
			"content_id = ? AND generation = ?",
			post.ContentID,
			post.Generation,
		).First(&plan).Error; err != nil {
			return err
		}
		result = &PrivatePostReadModel{
			Post:           post,
			Snapshot:       snapshot,
			Envelope:       envelope,
			Objects:        objects,
			CommitProof:    proof,
			AuthorDeviceID: plan.AuthorDeviceID,
		}
		return nil
	})
	if errors.Is(err, ErrPrivateContentNotFound) {
		return nil, ErrPrivateContentNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("social private content read Post: %w", err)
	}
	return result, nil
}

func (s *GORMPrivateContentStore) GetPrivateComment(
	ctx context.Context,
	postID string,
	commentID string,
	viewerPTID string,
	viewerDeviceID string,
) (*PrivateCommentReadModel, error) {
	if strings.TrimSpace(postID) == "" ||
		strings.TrimSpace(commentID) == "" ||
		strings.TrimSpace(viewerPTID) == "" ||
		strings.TrimSpace(viewerDeviceID) == "" {
		return nil, fmt.Errorf(
			"%w: private Comment read identity is incomplete",
			ErrPrivateContentInvalid,
		)
	}
	var result *PrivateCommentReadModel
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var comment dbmodel.SocialPrivateContentComment
		if err := tx.Where(
			"comment_id = ? AND post_id = ? AND deleted_at IS NULL",
			commentID,
			postID,
		).First(&comment).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrPrivateContentNotFound
			}
			return err
		}
		var parent dbmodel.SocialPrivateContentPost
		if err := tx.Where(
			"post_id = ? AND deleted_at IS NULL",
			postID,
		).First(&parent).Error; err != nil {
			return ErrPrivateContentNotFound
		}
		if viewerPTID != parent.AuthorPTID {
			var parentGrantCount int64
			if err := tx.Model(
				&dbmodel.SocialPrivateRecipientGrant{},
			).Where(
				"snapshot_id = ? AND recipient_ptid = ? AND revoked_at IS NULL",
				parent.AudienceSnapshotID,
				viewerPTID,
			).Count(&parentGrantCount).Error; err != nil {
				return err
			}
			if parentGrantCount != 1 {
				return ErrPrivateContentNotFound
			}
		}
		if viewerPTID != comment.AuthorPTID {
			var commentGrantCount int64
			if err := tx.Model(
				&dbmodel.SocialPrivateRecipientGrant{},
			).Where(
				"snapshot_id = ? AND recipient_ptid = ? AND revoked_at IS NULL",
				comment.InteractionSnapshotID,
				viewerPTID,
			).Count(&commentGrantCount).Error; err != nil {
				return err
			}
			if commentGrantCount != 1 {
				return ErrPrivateContentNotFound
			}
		}
		for _, ownerPTID := range []string{
			parent.AuthorPTID,
			comment.AuthorPTID,
		} {
			if viewerPTID == ownerPTID {
				continue
			}
			var relationshipCount int64
			if err := tx.Model(
				&federatedRelationshipProjectionModel{},
			).Where(
				"owner_ptid = ? AND peer_ptid = ?",
				ownerPTID,
				viewerPTID,
			).Count(&relationshipCount).Error; err != nil {
				return err
			}
			if relationshipCount != 1 {
				return ErrPrivateContentNotFound
			}
			var blockCount int64
			if err := tx.Model(&friendshipModel{}).
				Where(
					"status = ? AND ((actor_ptid = ? AND peer_ptid = ?) OR (actor_ptid = ? AND peer_ptid = ?))",
					friendshipStatusBlocked,
					ownerPTID,
					viewerPTID,
					viewerPTID,
					ownerPTID,
				).
				Count(&blockCount).Error; err != nil {
				return err
			}
			if blockCount != 0 {
				return ErrPrivateContentNotFound
			}
		}
		var snapshot dbmodel.SocialPrivateAudienceSnapshot
		if err := tx.Where(
			"snapshot_id = ?",
			comment.InteractionSnapshotID,
		).First(&snapshot).Error; err != nil {
			return err
		}
		var envelope dbmodel.SocialPrivateContentEnvelope
		if err := tx.Where(
			"content_id = ? AND key_kind = ? AND recipient_ptid = ? AND recipient_device_id = ?",
			comment.ContentID,
			PrivateContentKeyKindEndpoint,
			viewerPTID,
			viewerDeviceID,
		).First(&envelope).Error; err != nil {
			return ErrPrivateContentNotFound
		}
		var objects []dbmodel.SocialPrivateObjectAttachment
		if err := tx.Where(
			"content_id = ? AND state = ? AND domain_commit_id <> ''",
			comment.ContentID,
			dbmodel.SocialPrivateObjectAttached,
		).Order("object_id ASC").Find(&objects).Error; err != nil {
			return err
		}
		var proof dbmodel.SocialPrivateCommitProof
		if err := tx.Where(
			"content_id = ? AND generation = ?",
			comment.ContentID,
			comment.Generation,
		).First(&proof).Error; err != nil {
			return err
		}
		var plan dbmodel.SocialPrivateContentPlan
		if err := tx.Where(
			"content_id = ? AND generation = ?",
			comment.ContentID,
			comment.Generation,
		).First(&plan).Error; err != nil {
			return err
		}
		result = &PrivateCommentReadModel{
			Comment:        comment,
			Snapshot:       snapshot,
			Envelope:       envelope,
			Objects:        objects,
			CommitProof:    proof,
			AuthorDeviceID: plan.AuthorDeviceID,
		}
		return nil
	})
	if errors.Is(err, ErrPrivateContentNotFound) ||
		errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrPrivateContentNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("social private content read Comment: %w", err)
	}
	return result, nil
}

func (s *GORMPrivateContentStore) FindPrepare(
	ctx context.Context,
	authorPTID string,
	commandID string,
	canonicalPrepareSHA256 []byte,
) (PreparingPlanResult, bool, error) {
	if strings.TrimSpace(authorPTID) == "" ||
		strings.TrimSpace(commandID) == "" ||
		len(canonicalPrepareSHA256) != sha256.Size {
		return PreparingPlanResult{}, false, fmt.Errorf(
			"%w: prepare lookup identity is invalid",
			ErrPrivateContentInvalid,
		)
	}
	var plan dbmodel.SocialPrivateContentPlan
	err := s.db.WithContext(ctx).
		Where(
			"author_ptid = ? AND prepare_command_id = ?",
			authorPTID,
			commandID,
		).
		First(&plan).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return PreparingPlanResult{}, false, nil
	}
	if err != nil {
		return PreparingPlanResult{}, false, fmt.Errorf(
			"social private content find prepare: %w",
			err,
		)
	}
	if !bytes.Equal(
		plan.CanonicalPrepareSHA256,
		canonicalPrepareSHA256,
	) {
		return PreparingPlanResult{}, false, fmt.Errorf(
			"%w: prepare command was reused with a different hash",
			ErrPrivateContentConflict,
		)
	}
	if err := validatePersistedPreparingPlan(plan); err != nil {
		return PreparingPlanResult{}, false, err
	}
	return PreparingPlanResult{
		Plan:        clonePlan(plan),
		ExactReplay: true,
	}, true, nil
}

// ClaimPreparing durably commits the exact claim request before the caller
// invokes Key Exchange. Exact author/command replay returns the persisted row;
// any changed identity, bytes, or commitment is terminal conflict.
func (s *GORMPrivateContentStore) ClaimPreparing(
	ctx context.Context,
	candidate dbmodel.SocialPrivateContentPlan,
) (PreparingPlanResult, error) {
	if err := validatePreparingPlan(candidate); err != nil {
		return PreparingPlanResult{}, err
	}
	candidate.State = dbmodel.SocialPrivatePlanStatePreparing
	candidate.ClaimResponseBytes = nil
	candidate.ClaimResponseSHA256 = nil
	candidate.SignedPlanBytes = nil
	candidate.SignedPlanSHA256 = nil
	candidate.CanonicalPlanSHA256 = nil
	candidate.DomainCommitID = ""
	candidate.PreparedAt = nil
	candidate.ConsumedAt = nil

	var result PreparingPlanResult
	err := s.withSerializedTransaction(
		ctx,
		[]string{
			"prepare-command:" + candidate.AuthorPTID + ":" + candidate.PrepareCommandID,
			"prepare-plan:" + candidate.PlanID,
			fmt.Sprintf(
				"prepare-resource:%s:%d",
				candidate.ContentID,
				candidate.Generation,
			),
		},
		func(tx *gorm.DB) error {
			var matches []dbmodel.SocialPrivateContentPlan
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where(
					"plan_id = ? OR (author_ptid = ? AND prepare_command_id = ?) OR (content_id = ? AND generation = ?)",
					candidate.PlanID,
					candidate.AuthorPTID,
					candidate.PrepareCommandID,
					candidate.ContentID,
					candidate.Generation,
				).
				Find(&matches).Error; err != nil {
				return fmt.Errorf("social private content lock prepare identity: %w", err)
			}
			if len(matches) > 0 {
				if len(matches) != 1 || !samePreparingPlan(matches[0], candidate) {
					return fmt.Errorf(
						"%w: prepare identity or canonical claim request differs",
						ErrPrivateContentConflict,
					)
				}
				if err := validatePersistedPreparingPlan(matches[0]); err != nil {
					return err
				}
				result = PreparingPlanResult{
					Plan:        clonePlan(matches[0]),
					ExactReplay: true,
				}
				return nil
			}

			if err := tx.Create(&candidate).Error; err != nil {
				return fmt.Errorf("social private content insert PREPARING plan: %w", err)
			}
			if err := s.afterWrite(ctx, PrivateContentBoundaryPlanPreparing); err != nil {
				return err
			}
			result = PreparingPlanResult{Plan: clonePlan(candidate)}
			return nil
		},
	)
	return result, err
}

// MarkPrepared atomically stores the exact Key Exchange response, all claimed
// slot mappings, and the Station-signed plan.
func (s *GORMPrivateContentStore) MarkPrepared(
	ctx context.Context,
	prepared PreparedPlan,
) (PreparedPlanResult, error) {
	if err := validatePreparedPlan(prepared); err != nil {
		return PreparedPlanResult{}, err
	}

	var result PreparedPlanResult
	err := s.withSerializedTransaction(
		ctx,
		[]string{"prepare-plan:" + prepared.PlanID},
		func(tx *gorm.DB) error {
			plan, err := lockPrivateContentPlan(tx, prepared.PlanID)
			if err != nil {
				return err
			}
			if !bytes.Equal(
				plan.CanonicalPrepareSHA256,
				prepared.CanonicalPrepareSHA256,
			) {
				return fmt.Errorf(
					"%w: prepare hash changed before PREPARED",
					ErrPrivateContentConflict,
				)
			}
			if plan.State == dbmodel.SocialPrivatePlanStatePrepared {
				return loadPreparedReplay(tx, plan, prepared, &result)
			}
			if plan.State != dbmodel.SocialPrivatePlanStatePreparing &&
				plan.State != dbmodel.SocialPrivatePlanStatePreKeysClaimed {
				return fmt.Errorf(
					"%w: plan %s is %s",
					ErrPrivateContentInvalidState,
					plan.PlanID,
					plan.State,
				)
			}

			if err := tx.Model(&dbmodel.SocialPrivateContentPlan{}).
				Where("plan_id = ?", plan.PlanID).
				Updates(map[string]any{
					"claim_response_bytes":  cloneBytes(prepared.ClaimResponseBytes),
					"claim_response_sha256": cloneBytes(prepared.ClaimResponseSHA256),
					"state":                 dbmodel.SocialPrivatePlanStatePreKeysClaimed,
				}).Error; err != nil {
				return fmt.Errorf("social private content store claim response: %w", err)
			}
			if err := s.afterWrite(ctx, PrivateContentBoundaryClaimResponse); err != nil {
				return err
			}

			slots := cloneSlots(prepared.Slots)
			for index := range slots {
				slots[index].PlanID = plan.PlanID
			}
			if err := tx.Create(&slots).Error; err != nil {
				return fmt.Errorf("social private content store plan slots: %w", err)
			}
			if err := s.afterWrite(ctx, PrivateContentBoundaryPlanSlots); err != nil {
				return err
			}

			preparedAt := prepared.PreparedAt.UTC()
			update := tx.Model(&dbmodel.SocialPrivateContentPlan{}).
				Where(
					"plan_id = ? AND state = ?",
					plan.PlanID,
					dbmodel.SocialPrivatePlanStatePreKeysClaimed,
				).
				Updates(map[string]any{
					"signed_plan_bytes":     cloneBytes(prepared.SignedPlanBytes),
					"signed_plan_sha256":    cloneBytes(prepared.SignedPlanSHA256),
					"canonical_plan_sha256": cloneBytes(prepared.CanonicalPlanSHA256),
					"prepared_at":           preparedAt,
					"state":                 dbmodel.SocialPrivatePlanStatePrepared,
				})
			if update.Error != nil {
				return fmt.Errorf(
					"social private content mark plan PREPARED: %w",
					update.Error,
				)
			}
			if update.RowsAffected != 1 {
				return fmt.Errorf(
					"%w: plan %s was not PREKEYS_CLAIMED",
					ErrPrivateContentInvalidState,
					plan.PlanID,
				)
			}
			if err := s.afterWrite(ctx, PrivateContentBoundaryPlanPrepared); err != nil {
				return err
			}

			plan.ClaimResponseBytes = cloneBytes(prepared.ClaimResponseBytes)
			plan.ClaimResponseSHA256 = cloneBytes(prepared.ClaimResponseSHA256)
			plan.SignedPlanBytes = cloneBytes(prepared.SignedPlanBytes)
			plan.SignedPlanSHA256 = cloneBytes(prepared.SignedPlanSHA256)
			plan.CanonicalPlanSHA256 = cloneBytes(prepared.CanonicalPlanSHA256)
			plan.PreparedAt = &preparedAt
			plan.State = dbmodel.SocialPrivatePlanStatePrepared
			result = PreparedPlanResult{
				Plan:  clonePlan(plan),
				Slots: cloneSlots(slots),
			}
			return nil
		},
	)
	return result, err
}

func (s *GORMPrivateContentStore) Execute(
	ctx context.Context,
	fn func(PrivateContentTransaction) error,
) error {
	if fn == nil {
		return fmt.Errorf("%w: transaction callback is required", ErrPrivateContentInvalid)
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return fn(&gormPrivateContentTransaction{
			db:        tx,
			failpoint: s.failpoint,
		})
	})
}

// ExecuteSubmit serializes the plan and receipt identities, locks both rows,
// returns immutable exact replay without invoking mutate, and otherwise owns
// plan consumption plus receipt completion around the transaction-bound writes.
func (s *GORMPrivateContentStore) ExecuteSubmit(
	ctx context.Context,
	command SubmitCommand,
	mutate SubmitMutation,
) (SubmitResult, error) {
	if err := validateSubmitCommand(command); err != nil {
		return SubmitResult{}, err
	}
	if mutate == nil {
		return SubmitResult{}, fmt.Errorf(
			"%w: submit mutation callback is required",
			ErrPrivateContentInvalid,
		)
	}

	var (
		result      SubmitResult
		terminalErr error
	)
	err := s.withSerializedTransaction(
		ctx,
		[]string{
			"submit-plan:" + command.PlanID,
			"submit-command:" + command.AuthorPTID + ":" + command.CommandID,
		},
		func(tx *gorm.DB) error {
			plan, err := lockPrivateContentPlan(tx, command.PlanID)
			if err != nil {
				return err
			}
			if plan.AuthorPTID != command.AuthorPTID {
				return fmt.Errorf(
					"%w: submit author does not own plan",
					ErrPrivateContentConflict,
				)
			}

			receipt, found, err := lockPrivateContentReceipt(
				tx,
				command.AuthorPTID,
				command.CommandID,
			)
			if err != nil {
				return err
			}
			if found {
				if !sameSubmitReceipt(receipt, plan, command) {
					return fmt.Errorf(
						"%w: command receipt differs",
						ErrPrivateContentConflict,
					)
				}
				if err := validateExactDigest(
					"stored response",
					receipt.ResponseBytes,
					receipt.ResponseSHA256,
				); err != nil {
					return fmt.Errorf(
						"%w: %v",
						ErrPrivateContentConflict,
						err,
					)
				}
				result = SubmitResult{
					Receipt:     cloneReceipt(receipt),
					ExactReplay: true,
				}
				return nil
			}

			if plan.State != dbmodel.SocialPrivatePlanStatePrepared {
				return fmt.Errorf(
					"%w: plan %s is %s",
					ErrPrivateContentInvalidState,
					plan.PlanID,
					plan.State,
				)
			}

			bound := &gormPrivateContentTransaction{
				db:             tx,
				failpoint:      s.failpoint,
				plan:           &plan,
				domainCommitID: command.DomainCommitID,
			}
			mutationResult, err := mutate(ctx, bound, clonePlan(plan))
			if err != nil {
				return err
			}
			if bound.terminalErr != nil {
				terminalErr = bound.terminalErr
				return nil
			}
			if len(mutationResult.ResponseBytes) == 0 ||
				mutationResult.CompletedAt.IsZero() {
				return fmt.Errorf(
					"%w: canonical submit response and completion time are required",
					ErrPrivateContentInvalid,
				)
			}
			completedAt := mutationResult.CompletedAt.UTC()

			update := tx.Model(&dbmodel.SocialPrivateContentPlan{}).
				Where(
					"plan_id = ? AND state = ?",
					plan.PlanID,
					dbmodel.SocialPrivatePlanStatePrepared,
				).
				Updates(map[string]any{
					"state":            dbmodel.SocialPrivatePlanStateConsumed,
					"domain_commit_id": command.DomainCommitID,
					"consumed_at":      completedAt,
				})
			if update.Error != nil {
				return fmt.Errorf("social private content consume plan: %w", update.Error)
			}
			if update.RowsAffected != 1 {
				return fmt.Errorf(
					"%w: plan %s was not consumable",
					ErrPrivateContentInvalidState,
					plan.PlanID,
				)
			}
			if err := s.afterWrite(ctx, PrivateContentBoundaryPlanConsumed); err != nil {
				return err
			}

			responseDigest := sha256.Sum256(mutationResult.ResponseBytes)
			receipt = dbmodel.SocialPrivateCommandReceipt{
				AuthorPTID:            command.AuthorPTID,
				CommandID:             command.CommandID,
				PlanID:                plan.PlanID,
				CanonicalSubmitSHA256: cloneBytes(command.CanonicalSubmitSHA256),
				ResourceKind:          plan.ResourceKind,
				ContentID:             plan.ContentID,
				Generation:            plan.Generation,
				DomainCommitID:        command.DomainCommitID,
				ResponseBytes:         cloneBytes(mutationResult.ResponseBytes),
				ResponseSHA256:        responseDigest[:],
				CompletedAt:           completedAt,
			}
			if err := tx.Create(&receipt).Error; err != nil {
				return fmt.Errorf("social private content complete receipt: %w", err)
			}
			if err := s.afterWrite(ctx, PrivateContentBoundaryCommandReceipt); err != nil {
				return err
			}
			result = SubmitResult{Receipt: cloneReceipt(receipt)}
			return nil
		},
	)
	if err == nil && terminalErr != nil {
		return SubmitResult{}, terminalErr
	}
	return result, err
}

func (tx *gormPrivateContentTransaction) RejectStale(
	ctx context.Context,
) error {
	if err := tx.requireSubmit("", "", 0, ""); err != nil {
		return err
	}
	if tx.terminalErr != nil {
		return nil
	}
	update := tx.db.WithContext(ctx).
		Model(&dbmodel.SocialPrivateContentPlan{}).
		Where(
			"plan_id = ? AND state = ?",
			tx.plan.PlanID,
			dbmodel.SocialPrivatePlanStatePrepared,
		).
		Update("state", dbmodel.SocialPrivatePlanStateRejectedStale)
	if update.Error != nil {
		return fmt.Errorf("social private content reject stale plan: %w", update.Error)
	}
	if update.RowsAffected != 1 {
		return fmt.Errorf(
			"%w: plan %s was not rejectable",
			ErrPrivateContentInvalidState,
			tx.plan.PlanID,
		)
	}
	tx.terminalErr = ErrPrivateContentStalePlan
	tx.plan.State = dbmodel.SocialPrivatePlanStateRejectedStale
	return nil
}

func (tx *gormPrivateContentTransaction) Expire(
	ctx context.Context,
) error {
	if err := tx.requireSubmit("", "", 0, ""); err != nil {
		return err
	}
	if tx.terminalErr != nil {
		return fmt.Errorf(
			"%w: plan already has a terminal transition",
			ErrPrivateContentInvalidState,
		)
	}
	update := tx.db.WithContext(ctx).
		Model(&dbmodel.SocialPrivateContentPlan{}).
		Where(
			"plan_id = ? AND state = ?",
			tx.plan.PlanID,
			dbmodel.SocialPrivatePlanStatePrepared,
		).
		Update("state", dbmodel.SocialPrivatePlanStateExpired)
	if update.Error != nil {
		return fmt.Errorf("social private content expire submit plan: %w", update.Error)
	}
	if update.RowsAffected != 1 {
		return fmt.Errorf(
			"%w: plan %s was not expirable",
			ErrPrivateContentInvalidState,
			tx.plan.PlanID,
		)
	}
	tx.terminalErr = ErrPrivateContentExpiredPlan
	tx.plan.State = dbmodel.SocialPrivatePlanStateExpired
	return nil
}

func (tx *gormPrivateContentTransaction) CreatePost(
	ctx context.Context,
	post dbmodel.SocialPrivateContentPost,
) error {
	if err := tx.requireSubmit(
		PrivateContentResourcePost,
		post.ContentID,
		post.Generation,
		post.AuthorPTID,
	); err != nil {
		return err
	}
	if strings.TrimSpace(post.PostID) == "" ||
		strings.TrimSpace(post.AudienceSnapshotID) == "" ||
		len(post.EncryptedPayloadBytes) == 0 ||
		strings.TrimSpace(post.LifecycleState) == "" {
		return fmt.Errorf("%w: complete encrypted Post fact is required", ErrPrivateContentInvalid)
	}
	if err := validateExactDigest(
		"encrypted payload",
		post.EncryptedPayloadBytes,
		post.EncryptedPayloadSHA256,
	); err != nil {
		return err
	}
	if err := validateDigest(
		"object descriptor set",
		post.ObjectDescriptorSetSHA256,
	); err != nil {
		return err
	}
	for field, digest := range map[string][]byte{
		"mention routing":   post.MentionRoutingSHA256,
		"subtype authority": post.SubtypeAuthoritySHA256,
	} {
		if err := validateOptionalDigest(field, digest); err != nil {
			return err
		}
	}
	if err := tx.createPrivateContentPost(ctx, post); err != nil {
		return fmt.Errorf("social private content create Post fact: %w", err)
	}
	return tx.afterWrite(ctx, PrivateContentBoundaryPostFact)
}

func (tx *gormPrivateContentTransaction) createPrivateContentPost(
	ctx context.Context,
	post dbmodel.SocialPrivateContentPost,
) error {
	if !tx.db.Migrator().HasColumn(
		&dbmodel.SocialPrivateContentPost{},
		"author_id",
	) {
		return tx.db.WithContext(ctx).Create(&post).Error
	}

	authorID, err := NewActorIdentity(tx.db).RequireID(ctx, post.AuthorPTID)
	if err != nil {
		return fmt.Errorf("resolve encrypted Post author: %w", err)
	}
	values := map[string]any{
		"id":                           id.NextID(),
		"author_id":                    authorID,
		"type":                         post.Kind,
		"audience_kind":                "FRIENDS",
		"audience_target_id":           0,
		"audience_base_kind":           "",
		"audience_key_envelopes_json":  "",
		"text_body":                    "",
		"attachments_json":             "",
		"mentions_json":                "",
		"link_preview_json":            "",
		"reactions_count_json":         "",
		"repost_of_ref":                "",
		"comments_count":               post.CommentsCount,
		"views_count":                  0,
		"created_at":                   post.CreatedAt,
		"updated_at":                   post.UpdatedAt,
		"post_id":                      post.PostID,
		"content_id":                   post.ContentID,
		"author_ptid":                  post.AuthorPTID,
		"generation":                   post.Generation,
		"audience_snapshot_id":         post.AudienceSnapshotID,
		"kind":                         post.Kind,
		"encrypted_payload_bytes":      cloneBytes(post.EncryptedPayloadBytes),
		"encrypted_payload_sha256":     cloneBytes(post.EncryptedPayloadSHA256),
		"object_descriptor_set_sha256": cloneBytes(post.ObjectDescriptorSetSHA256),
		"mention_routing_sha256":       cloneBytes(post.MentionRoutingSHA256),
		"subtype_authority_sha256":     cloneBytes(post.SubtypeAuthoritySHA256),
		"lifecycle_state":              post.LifecycleState,
		"reactions_count":              post.ReactionsCount,
	}
	return tx.db.WithContext(ctx).
		Table(post.TableName()).
		Create(values).Error
}

func (tx *gormPrivateContentTransaction) CreateComment(
	ctx context.Context,
	comment dbmodel.SocialPrivateContentComment,
) error {
	if err := tx.requireSubmit(
		PrivateContentResourceComment,
		comment.ContentID,
		comment.Generation,
		comment.AuthorPTID,
	); err != nil {
		return err
	}
	if strings.TrimSpace(comment.CommentID) == "" ||
		strings.TrimSpace(comment.PostID) == "" ||
		strings.TrimSpace(comment.InteractionSnapshotID) == "" ||
		len(comment.EncryptedPayloadBytes) == 0 ||
		strings.TrimSpace(comment.LifecycleState) == "" {
		return fmt.Errorf(
			"%w: complete encrypted Comment fact is required",
			ErrPrivateContentInvalid,
		)
	}
	if err := validateExactDigest(
		"encrypted payload",
		comment.EncryptedPayloadBytes,
		comment.EncryptedPayloadSHA256,
	); err != nil {
		return err
	}
	if err := validateDigest(
		"object descriptor set",
		comment.ObjectDescriptorSetSHA256,
	); err != nil {
		return err
	}
	if err := validateOptionalDigest(
		"mention routing",
		comment.MentionRoutingSHA256,
	); err != nil {
		return err
	}
	if err := tx.db.WithContext(ctx).Create(&comment).Error; err != nil {
		return fmt.Errorf("social private content create Comment fact: %w", err)
	}
	return tx.afterWrite(ctx, PrivateContentBoundaryCommentFact)
}

func (tx *gormPrivateContentTransaction) CreateAudienceSnapshot(
	ctx context.Context,
	snapshot dbmodel.SocialPrivateAudienceSnapshot,
) error {
	if err := tx.requireSubmit("", "", 0, ""); err != nil {
		return err
	}
	if snapshot.SnapshotID != tx.plan.AudienceSnapshotID ||
		snapshot.ResourceKind != tx.plan.ResourceKind ||
		strings.TrimSpace(snapshot.ResourceID) == "" ||
		strings.TrimSpace(snapshot.PostID) == "" ||
		strings.TrimSpace(snapshot.AudienceKind) == "" {
		return fmt.Errorf(
			"%w: audience snapshot does not match submit plan",
			ErrPrivateContentInvalid,
		)
	}
	if err := validateDigest("audience snapshot", snapshot.CanonicalSnapshotSHA256); err != nil {
		return err
	}
	if err := tx.db.WithContext(ctx).Create(&snapshot).Error; err != nil {
		return fmt.Errorf("social private content create audience snapshot: %w", err)
	}
	return tx.afterWrite(ctx, PrivateContentBoundaryAudienceSnapshot)
}

func (tx *gormPrivateContentTransaction) CreateRecipientGrants(
	ctx context.Context,
	grants []dbmodel.SocialPrivateRecipientGrant,
) error {
	if err := tx.requireSubmit("", "", 0, ""); err != nil {
		return err
	}
	if len(grants) == 0 {
		return fmt.Errorf("%w: recipient grants are required", ErrPrivateContentInvalid)
	}
	for _, grant := range grants {
		if grant.SnapshotID != tx.plan.AudienceSnapshotID ||
			strings.TrimSpace(grant.RecipientPTID) == "" ||
			grant.GrantedAt.IsZero() {
			return fmt.Errorf(
				"%w: recipient grant does not match submit plan",
				ErrPrivateContentInvalid,
			)
		}
	}
	if err := tx.db.WithContext(ctx).Create(&grants).Error; err != nil {
		return fmt.Errorf("social private content create recipient grants: %w", err)
	}
	return tx.afterWrite(ctx, PrivateContentBoundaryRecipientGrants)
}

func (tx *gormPrivateContentTransaction) CreateEnvelopes(
	ctx context.Context,
	envelopes []dbmodel.SocialPrivateContentEnvelope,
) error {
	if err := tx.requireSubmit("", "", 0, ""); err != nil {
		return err
	}
	if len(envelopes) == 0 {
		return fmt.Errorf("%w: content envelopes are required", ErrPrivateContentInvalid)
	}

	endpoint := make([]dbmodel.SocialPrivateContentEnvelope, 0, len(envelopes))
	recovery := make([]dbmodel.SocialPrivateContentEnvelope, 0, len(envelopes))
	for _, envelope := range envelopes {
		if err := tx.validateEnvelope(ctx, envelope); err != nil {
			return err
		}
		switch envelope.KeyKind {
		case PrivateContentKeyKindEndpoint:
			endpoint = append(endpoint, envelope)
		case PrivateContentKeyKindActorRecovery:
			recovery = append(recovery, envelope)
		default:
			return fmt.Errorf(
				"%w: unsupported envelope key kind %q",
				ErrPrivateContentInvalid,
				envelope.KeyKind,
			)
		}
	}
	for _, group := range []struct {
		rows     []dbmodel.SocialPrivateContentEnvelope
		boundary PrivateContentWriteBoundary
	}{
		{rows: endpoint, boundary: PrivateContentBoundaryEndpointEnvelopes},
		{rows: recovery, boundary: PrivateContentBoundaryRecoveryEnvelopes},
	} {
		if len(group.rows) == 0 {
			continue
		}
		if err := tx.db.WithContext(ctx).Create(&group.rows).Error; err != nil {
			return fmt.Errorf("social private content create envelopes: %w", err)
		}
		if err := tx.afterWrite(ctx, group.boundary); err != nil {
			return err
		}
	}
	return nil
}

func (tx *gormPrivateContentTransaction) CreateDeliveryIntents(
	ctx context.Context,
	intents []dbmodel.SocialPrivateDeliveryIntent,
) error {
	if err := tx.requireSubmit("", "", 0, ""); err != nil {
		return err
	}
	if len(intents) == 0 {
		return fmt.Errorf("%w: delivery intents are required", ErrPrivateContentInvalid)
	}
	for _, intent := range intents {
		if strings.TrimSpace(intent.IntentID) == "" ||
			intent.ContentID != tx.plan.ContentID ||
			intent.DomainCommitID != tx.domainCommitID ||
			strings.TrimSpace(intent.RecipientPTID) == "" ||
			strings.TrimSpace(intent.RecipientDeviceID) == "" ||
			strings.TrimSpace(intent.IdempotencyKey) == "" ||
			intent.State != dbmodel.SocialPrivateDeliveryIntentStatePending {
			return fmt.Errorf(
				"%w: delivery intent does not match submit transaction",
				ErrPrivateContentInvalid,
			)
		}
		if err := validateExactDigest(
			"delivery payload",
			intent.OpaquePayload,
			intent.PayloadSHA256,
		); err != nil {
			return err
		}
	}
	if err := tx.db.WithContext(ctx).Create(&intents).Error; err != nil {
		return fmt.Errorf("social private content create delivery intents: %w", err)
	}
	return tx.afterWrite(ctx, PrivateContentBoundaryDeliveryIntents)
}

func (tx *gormPrivateContentTransaction) AttachObjects(
	ctx context.Context,
	attachments []PrivateObjectAttachment,
) error {
	if err := tx.requireSubmit("", "", 0, ""); err != nil {
		return err
	}
	if len(attachments) == 0 {
		return fmt.Errorf("%w: object attachments are required", ErrPrivateContentInvalid)
	}
	for _, attachment := range attachments {
		if strings.TrimSpace(attachment.ObjectID) == "" ||
			attachment.ContentID != tx.plan.ContentID ||
			attachment.DomainCommitID != tx.domainCommitID ||
			attachment.AttachedAt.IsZero() {
			return fmt.Errorf(
				"%w: object attachment does not match submit transaction",
				ErrPrivateContentInvalid,
			)
		}
		if err := validateDigest("object descriptor", attachment.DescriptorSHA256); err != nil {
			return err
		}
		var object dbmodel.SocialPrivateObjectAttachment
		if err := tx.db.WithContext(ctx).
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"object_id = ? AND content_id = ? AND descriptor_sha256 = ? AND state = ? AND domain_commit_id = ''",
				attachment.ObjectID,
				attachment.ContentID,
				attachment.DescriptorSHA256,
				dbmodel.SocialPrivateObjectCompleteUnattached,
			).
			First(&object).Error; err != nil {
			return fmt.Errorf(
				"%w: object %s is missing, mismatched, or already attached",
				ErrPrivateContentConflict,
				attachment.ObjectID,
			)
		}
		uploadUpdate := tx.db.WithContext(ctx).
			Model(&dbmodel.SocialPrivateObjectUpload{}).
			Where(
				"upload_id = ? AND generation = ? AND state = ?",
				object.UploadID,
				object.UploadGeneration,
				dbmodel.SocialPrivateObjectCompleteUnattached,
			).
			Updates(map[string]any{
				"state":      dbmodel.SocialPrivateObjectAttached,
				"updated_at": attachment.AttachedAt.UTC(),
			})
		if uploadUpdate.Error != nil {
			return fmt.Errorf(
				"social private content attach object upload: %w",
				uploadUpdate.Error,
			)
		}
		if uploadUpdate.RowsAffected != 1 {
			return fmt.Errorf(
				"%w: object upload %s is not attachable",
				ErrPrivateContentConflict,
				attachment.ObjectID,
			)
		}
		objectUpdate := tx.db.WithContext(ctx).
			Model(&dbmodel.SocialPrivateObjectAttachment{}).
			Where(
				"object_id = ? AND state = ? AND domain_commit_id = ''",
				attachment.ObjectID,
				dbmodel.SocialPrivateObjectCompleteUnattached,
			).
			Updates(map[string]any{
				"state":            dbmodel.SocialPrivateObjectAttached,
				"domain_commit_id": attachment.DomainCommitID,
				"attached_at":      attachment.AttachedAt.UTC(),
				"updated_at":       attachment.AttachedAt.UTC(),
			})
		if objectUpdate.Error != nil {
			return fmt.Errorf(
				"social private content attach object: %w",
				objectUpdate.Error,
			)
		}
		if objectUpdate.RowsAffected != 1 {
			return fmt.Errorf(
				"%w: object %s attach raced",
				ErrPrivateContentConflict,
				attachment.ObjectID,
			)
		}
	}
	return tx.afterWrite(ctx, PrivateContentBoundaryObjectAttachment)
}

func (tx *gormPrivateContentTransaction) CreateObjectGrants(
	ctx context.Context,
	grants []dbmodel.SocialPrivateObjectGrant,
) error {
	if err := tx.requireSubmit("", "", 0, ""); err != nil {
		return err
	}
	if len(grants) == 0 {
		return fmt.Errorf("%w: object grants are required", ErrPrivateContentInvalid)
	}
	for _, grant := range grants {
		if strings.TrimSpace(grant.ObjectID) == "" ||
			strings.TrimSpace(grant.PrincipalKind) == "" ||
			strings.TrimSpace(grant.PrincipalPTID) == "" ||
			grant.DomainCommitID != tx.domainCommitID ||
			grant.GrantedAt.IsZero() {
			return fmt.Errorf(
				"%w: object grant does not match submit transaction",
				ErrPrivateContentInvalid,
			)
		}
	}
	if err := tx.db.WithContext(ctx).Create(&grants).Error; err != nil {
		return fmt.Errorf("social private content create object grants: %w", err)
	}
	return tx.afterWrite(ctx, PrivateContentBoundaryObjectGrants)
}

func (tx *gormPrivateContentTransaction) CreateCommitProof(
	ctx context.Context,
	proof dbmodel.SocialPrivateCommitProof,
) error {
	if err := tx.requireSubmit(
		proof.ResourceKind,
		proof.ContentID,
		proof.Generation,
		"",
	); err != nil {
		return err
	}
	if proof.DomainCommitID != tx.domainCommitID ||
		strings.TrimSpace(proof.StationSigningKeyID) == "" ||
		proof.CommittedAt.IsZero() {
		return fmt.Errorf(
			"%w: commit proof does not match submit transaction",
			ErrPrivateContentInvalid,
		)
	}
	if err := validateExactDigest(
		"commit proof",
		proof.CanonicalProofBytes,
		proof.CanonicalProofSHA256,
	); err != nil {
		return err
	}
	if err := tx.db.WithContext(ctx).Create(&proof).Error; err != nil {
		return fmt.Errorf("social private content create commit proof: %w", err)
	}
	return tx.afterWrite(ctx, PrivateContentBoundaryCommitProof)
}

func (tx *gormPrivateContentTransaction) validateEnvelope(
	ctx context.Context,
	envelope dbmodel.SocialPrivateContentEnvelope,
) error {
	if envelope.ContentID != tx.plan.ContentID ||
		envelope.PlanID != tx.plan.PlanID ||
		strings.TrimSpace(envelope.RecipientSlotID) == "" ||
		strings.TrimSpace(envelope.RecipientPTID) == "" ||
		strings.TrimSpace(envelope.OneTimeKeyID) == "" {
		return fmt.Errorf(
			"%w: envelope does not match submit plan",
			ErrPrivateContentInvalid,
		)
	}
	if envelope.KeyKind == PrivateContentKeyKindEndpoint &&
		strings.TrimSpace(envelope.RecipientDeviceID) == "" {
		return fmt.Errorf(
			"%w: endpoint envelope requires recipient device",
			ErrPrivateContentInvalid,
		)
	}
	if envelope.KeyKind == PrivateContentKeyKindActorRecovery &&
		envelope.RecipientDeviceID != "" {
		return fmt.Errorf(
			"%w: recovery envelope cannot bind a device",
			ErrPrivateContentInvalid,
		)
	}
	if err := validateExactDigest(
		"content envelope",
		envelope.PreparedEnvelopeBytes,
		envelope.EnvelopeSHA256,
	); err != nil {
		return err
	}
	for field, digest := range map[string][]byte{
		"canonical plan":    envelope.CanonicalPlanSHA256,
		"principal binding": envelope.PrincipalBindingSHA256,
		"envelope binding":  envelope.BindingSHA256,
		"sender signature":  envelope.SenderSignatureSHA256,
	} {
		if err := validateDigest(field, digest); err != nil {
			return err
		}
	}

	var slot dbmodel.SocialPrivateContentPlanSlot
	if err := tx.db.WithContext(ctx).
		Where(
			"plan_id = ? AND recipient_slot_id = ?",
			tx.plan.PlanID,
			envelope.RecipientSlotID,
		).
		First(&slot).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return fmt.Errorf(
				"%w: recipient slot %s is missing",
				ErrPrivateContentConflict,
				envelope.RecipientSlotID,
			)
		}
		return fmt.Errorf("social private content load envelope slot: %w", err)
	}
	if slot.KeyKind != envelope.KeyKind ||
		slot.OneTimeKeyID != envelope.OneTimeKeyID ||
		slot.RecipientPTID != envelope.RecipientPTID ||
		slot.RecipientDeviceID != envelope.RecipientDeviceID ||
		slot.PrincipalEpoch != envelope.PrincipalEpoch ||
		!bytes.Equal(
			tx.plan.CanonicalPlanSHA256,
			envelope.CanonicalPlanSHA256,
		) ||
		!bytes.Equal(
			slot.PrincipalBindingSHA256,
			envelope.PrincipalBindingSHA256,
		) {
		return fmt.Errorf(
			"%w: envelope recipient binding differs from claimed slot",
			ErrPrivateContentConflict,
		)
	}
	return nil
}

func (tx *gormPrivateContentTransaction) requireSubmit(
	resourceKind string,
	contentID string,
	generation uint64,
	authorPTID string,
) error {
	if tx.plan == nil || tx.domainCommitID == "" {
		return fmt.Errorf(
			"%w: repository requires an ExecuteSubmit transaction",
			ErrPrivateContentInvalidState,
		)
	}
	if resourceKind != "" && resourceKind != tx.plan.ResourceKind {
		return fmt.Errorf("%w: resource kind differs from plan", ErrPrivateContentConflict)
	}
	if contentID != "" && contentID != tx.plan.ContentID {
		return fmt.Errorf("%w: content ID differs from plan", ErrPrivateContentConflict)
	}
	if generation != 0 && generation != tx.plan.Generation {
		return fmt.Errorf("%w: generation differs from plan", ErrPrivateContentConflict)
	}
	if authorPTID != "" && authorPTID != tx.plan.AuthorPTID {
		return fmt.Errorf("%w: author differs from plan", ErrPrivateContentConflict)
	}
	return nil
}

func (tx *gormPrivateContentTransaction) afterWrite(
	ctx context.Context,
	boundary PrivateContentWriteBoundary,
) error {
	if tx.failpoint == nil {
		return nil
	}
	if err := tx.failpoint.AfterPrivateContentWrite(ctx, boundary); err != nil {
		return fmt.Errorf(
			"social private content failpoint after %s: %w",
			boundary,
			err,
		)
	}
	return nil
}

func (s *GORMPrivateContentStore) afterWrite(
	ctx context.Context,
	boundary PrivateContentWriteBoundary,
) error {
	if s.failpoint == nil {
		return nil
	}
	if err := s.failpoint.AfterPrivateContentWrite(ctx, boundary); err != nil {
		return fmt.Errorf(
			"social private content failpoint after %s: %w",
			boundary,
			err,
		)
	}
	return nil
}

func (s *GORMPrivateContentStore) withSerializedTransaction(
	ctx context.Context,
	keys []string,
	fn func(*gorm.DB) error,
) error {
	if fn == nil {
		return fmt.Errorf("%w: transaction callback is required", ErrPrivateContentInvalid)
	}
	keys = uniqueSortedStrings(keys)
	if s.db.Dialector.Name() == "sqlite" {
		locks := make([]*sync.Mutex, 0, len(keys))
		for _, key := range keys {
			value, _ := privateContentSQLiteLocks.LoadOrStore(
				fmt.Sprintf("%p:%s", s.db, key),
				&sync.Mutex{},
			)
			lock := value.(*sync.Mutex)
			lock.Lock()
			locks = append(locks, lock)
		}
		defer func() {
			for index := len(locks) - 1; index >= 0; index-- {
				locks[index].Unlock()
			}
		}()
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if tx.Dialector.Name() == "postgres" {
			for _, key := range keys {
				digest := sha256.Sum256([]byte(key))
				lockID := int64(binary.BigEndian.Uint64(digest[:8]))
				if err := tx.Exec(
					"SELECT pg_advisory_xact_lock(?)",
					lockID,
				).Error; err != nil {
					return fmt.Errorf(
						"social private content acquire transaction lock: %w",
						err,
					)
				}
			}
		}
		return fn(tx)
	})
}

func lockPrivateContentPlan(
	tx *gorm.DB,
	planID string,
) (dbmodel.SocialPrivateContentPlan, error) {
	var plan dbmodel.SocialPrivateContentPlan
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("plan_id = ?", planID).
		First(&plan).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return plan, fmt.Errorf("%w: plan %s", ErrPrivateContentNotFound, planID)
	}
	if err != nil {
		return plan, fmt.Errorf("social private content lock plan: %w", err)
	}
	return plan, nil
}

func lockPrivateContentReceipt(
	tx *gorm.DB,
	authorPTID string,
	commandID string,
) (dbmodel.SocialPrivateCommandReceipt, bool, error) {
	var receipt dbmodel.SocialPrivateCommandReceipt
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("author_ptid = ? AND command_id = ?", authorPTID, commandID).
		First(&receipt).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return receipt, false, nil
	}
	if err != nil {
		return receipt, false, fmt.Errorf(
			"social private content lock command receipt: %w",
			err,
		)
	}
	return receipt, true, nil
}

func loadPreparedReplay(
	tx *gorm.DB,
	plan dbmodel.SocialPrivateContentPlan,
	prepared PreparedPlan,
	result *PreparedPlanResult,
) error {
	if !bytes.Equal(plan.ClaimResponseBytes, prepared.ClaimResponseBytes) ||
		!bytes.Equal(plan.ClaimResponseSHA256, prepared.ClaimResponseSHA256) ||
		!bytes.Equal(plan.SignedPlanBytes, prepared.SignedPlanBytes) ||
		!bytes.Equal(plan.SignedPlanSHA256, prepared.SignedPlanSHA256) ||
		!bytes.Equal(plan.CanonicalPlanSHA256, prepared.CanonicalPlanSHA256) {
		return fmt.Errorf(
			"%w: PREPARED plan bytes or commitments differ",
			ErrPrivateContentConflict,
		)
	}
	var persisted []dbmodel.SocialPrivateContentPlanSlot
	if err := tx.Where("plan_id = ?", plan.PlanID).
		Order("recipient_slot_id ASC").
		Find(&persisted).Error; err != nil {
		return fmt.Errorf("social private content load prepared slots: %w", err)
	}
	requested := cloneSlots(prepared.Slots)
	for index := range requested {
		requested[index].PlanID = plan.PlanID
	}
	if !sameSlots(persisted, requested) {
		return fmt.Errorf(
			"%w: PREPARED plan slots differ",
			ErrPrivateContentConflict,
		)
	}
	*result = PreparedPlanResult{
		Plan:        clonePlan(plan),
		Slots:       cloneSlots(persisted),
		ExactReplay: true,
	}
	return nil
}

func validatePreparingPlan(plan dbmodel.SocialPrivateContentPlan) error {
	for name, value := range map[string]string{
		"plan ID":              plan.PlanID,
		"author PTID":          plan.AuthorPTID,
		"prepare command ID":   plan.PrepareCommandID,
		"content ID":           plan.ContentID,
		"resource kind":        plan.ResourceKind,
		"author device ID":     plan.AuthorDeviceID,
		"author home Station":  plan.AuthorHomeStationPeerID,
		"audience snapshot ID": plan.AudienceSnapshotID,
	} {
		if strings.TrimSpace(value) == "" || value != strings.TrimSpace(value) {
			return fmt.Errorf("%w: %s is required and canonical", ErrPrivateContentInvalid, name)
		}
	}
	if plan.ResourceKind != PrivateContentResourcePost &&
		plan.ResourceKind != PrivateContentResourceComment {
		return fmt.Errorf("%w: unsupported resource kind", ErrPrivateContentInvalid)
	}
	if plan.Generation == 0 || plan.ExpiresAt.IsZero() {
		return fmt.Errorf(
			"%w: generation and expiry are required",
			ErrPrivateContentInvalid,
		)
	}
	if plan.State != "" &&
		plan.State != dbmodel.SocialPrivatePlanStatePreparing {
		return fmt.Errorf("%w: new plan must be PREPARING", ErrPrivateContentInvalid)
	}
	if len(plan.ClaimResponseBytes) != 0 ||
		len(plan.ClaimResponseSHA256) != 0 ||
		len(plan.SignedPlanBytes) != 0 ||
		len(plan.SignedPlanSHA256) != 0 ||
		len(plan.CanonicalPlanSHA256) != 0 ||
		plan.DomainCommitID != "" ||
		plan.PreparedAt != nil ||
		plan.ConsumedAt != nil {
		return fmt.Errorf(
			"%w: PREPARING plan cannot contain prepared or consumed state",
			ErrPrivateContentInvalid,
		)
	}
	if err := validateDigest(
		"authorization snapshot",
		plan.AuthorizationSnapshotSHA256,
	); err != nil {
		return err
	}
	if err := validateExactDigest(
		"canonical prepare",
		plan.CanonicalPrepareBytes,
		plan.CanonicalPrepareSHA256,
	); err != nil {
		return err
	}
	return validateExactDigest(
		"claim request",
		plan.ClaimRequestBytes,
		plan.ClaimRequestSHA256,
	)
}

func validatePersistedPreparingPlan(
	plan dbmodel.SocialPrivateContentPlan,
) error {
	if err := validateDigest(
		"persisted authorization snapshot",
		plan.AuthorizationSnapshotSHA256,
	); err != nil {
		return fmt.Errorf("%w: %v", ErrPrivateContentConflict, err)
	}
	if err := validateExactDigest(
		"persisted canonical prepare",
		plan.CanonicalPrepareBytes,
		plan.CanonicalPrepareSHA256,
	); err != nil {
		return fmt.Errorf("%w: %v", ErrPrivateContentConflict, err)
	}
	if err := validateExactDigest(
		"persisted claim request",
		plan.ClaimRequestBytes,
		plan.ClaimRequestSHA256,
	); err != nil {
		return fmt.Errorf("%w: %v", ErrPrivateContentConflict, err)
	}
	return nil
}

func validatePreparedPlan(prepared PreparedPlan) error {
	if strings.TrimSpace(prepared.PlanID) == "" ||
		prepared.PreparedAt.IsZero() {
		return fmt.Errorf(
			"%w: plan ID and prepared time are required",
			ErrPrivateContentInvalid,
		)
	}
	if err := validateDigest(
		"canonical prepare",
		prepared.CanonicalPrepareSHA256,
	); err != nil {
		return err
	}
	if err := validateExactDigest(
		"claim response",
		prepared.ClaimResponseBytes,
		prepared.ClaimResponseSHA256,
	); err != nil {
		return err
	}
	if err := validateExactDigest(
		"signed plan",
		prepared.SignedPlanBytes,
		prepared.SignedPlanSHA256,
	); err != nil {
		return err
	}
	if err := validateDigest(
		"canonical plan",
		prepared.CanonicalPlanSHA256,
	); err != nil {
		return err
	}
	if len(prepared.Slots) == 0 {
		return fmt.Errorf("%w: prepared plan slots are required", ErrPrivateContentInvalid)
	}
	previous := ""
	for _, slot := range prepared.Slots {
		if strings.TrimSpace(slot.RecipientSlotID) == "" ||
			(previous != "" && slot.RecipientSlotID <= previous) ||
			strings.TrimSpace(slot.ClaimID) == "" ||
			strings.TrimSpace(slot.OneTimeKeyID) == "" ||
			strings.TrimSpace(slot.RecipientPTID) == "" ||
			len(slot.ClaimedPreKeyBytes) == 0 {
			return fmt.Errorf(
				"%w: prepared slots must be complete and strictly ordered",
				ErrPrivateContentInvalid,
			)
		}
		if slot.PlanID != "" && slot.PlanID != prepared.PlanID {
			return fmt.Errorf("%w: slot plan ID differs", ErrPrivateContentConflict)
		}
		if slot.KeyKind != PrivateContentKeyKindEndpoint &&
			slot.KeyKind != PrivateContentKeyKindActorRecovery {
			return fmt.Errorf("%w: unsupported slot key kind", ErrPrivateContentInvalid)
		}
		if slot.KeyKind == PrivateContentKeyKindEndpoint &&
			strings.TrimSpace(slot.RecipientDeviceID) == "" {
			return fmt.Errorf("%w: endpoint slot requires a device", ErrPrivateContentInvalid)
		}
		if slot.KeyKind == PrivateContentKeyKindActorRecovery &&
			slot.RecipientDeviceID != "" {
			return fmt.Errorf("%w: recovery slot cannot bind a device", ErrPrivateContentInvalid)
		}
		if err := validateExactDigest(
			"claimed PreKey",
			slot.ClaimedPreKeyBytes,
			slot.ClaimedPreKeySHA256,
		); err != nil {
			return err
		}
		if err := validateDigest(
			"principal binding",
			slot.PrincipalBindingSHA256,
		); err != nil {
			return err
		}
		previous = slot.RecipientSlotID
	}
	return nil
}

func validateSubmitCommand(command SubmitCommand) error {
	for name, value := range map[string]string{
		"plan ID":          command.PlanID,
		"author PTID":      command.AuthorPTID,
		"command ID":       command.CommandID,
		"domain commit ID": command.DomainCommitID,
	} {
		if strings.TrimSpace(value) == "" || value != strings.TrimSpace(value) {
			return fmt.Errorf("%w: %s is required and canonical", ErrPrivateContentInvalid, name)
		}
	}
	return validateDigest("canonical submit", command.CanonicalSubmitSHA256)
}

func samePreparingPlan(
	persisted dbmodel.SocialPrivateContentPlan,
	candidate dbmodel.SocialPrivateContentPlan,
) bool {
	return persisted.PlanID == candidate.PlanID &&
		persisted.AuthorPTID == candidate.AuthorPTID &&
		persisted.PrepareCommandID == candidate.PrepareCommandID &&
		persisted.ContentID == candidate.ContentID &&
		persisted.Generation == candidate.Generation &&
		persisted.ResourceKind == candidate.ResourceKind &&
		persisted.AuthorDeviceID == candidate.AuthorDeviceID &&
		persisted.AuthorHomeStationPeerID == candidate.AuthorHomeStationPeerID &&
		persisted.AudienceSnapshotID == candidate.AudienceSnapshotID &&
		bytes.Equal(persisted.CanonicalPrepareBytes, candidate.CanonicalPrepareBytes) &&
		bytes.Equal(persisted.CanonicalPrepareSHA256, candidate.CanonicalPrepareSHA256)
}

func sameSubmitReceipt(
	receipt dbmodel.SocialPrivateCommandReceipt,
	plan dbmodel.SocialPrivateContentPlan,
	command SubmitCommand,
) bool {
	return receipt.PlanID == plan.PlanID &&
		receipt.ResourceKind == plan.ResourceKind &&
		receipt.ContentID == plan.ContentID &&
		receipt.Generation == plan.Generation &&
		bytes.Equal(
			receipt.CanonicalSubmitSHA256,
			command.CanonicalSubmitSHA256,
		)
}

func sameSlots(
	left []dbmodel.SocialPrivateContentPlanSlot,
	right []dbmodel.SocialPrivateContentPlanSlot,
) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		a := left[index]
		b := right[index]
		if a.PlanID != b.PlanID ||
			a.RecipientSlotID != b.RecipientSlotID ||
			a.ClaimID != b.ClaimID ||
			a.OneTimeKeyID != b.OneTimeKeyID ||
			a.KeyKind != b.KeyKind ||
			a.RecipientPTID != b.RecipientPTID ||
			a.RecipientDeviceID != b.RecipientDeviceID ||
			a.PrincipalEpoch != b.PrincipalEpoch ||
			!bytes.Equal(a.ClaimedPreKeyBytes, b.ClaimedPreKeyBytes) ||
			!bytes.Equal(a.ClaimedPreKeySHA256, b.ClaimedPreKeySHA256) ||
			!bytes.Equal(a.PrincipalBindingSHA256, b.PrincipalBindingSHA256) {
			return false
		}
	}
	return true
}

func validateExactDigest(name string, value []byte, digest []byte) error {
	if len(value) == 0 {
		return fmt.Errorf("%w: %s bytes are required", ErrPrivateContentInvalid, name)
	}
	if err := validateDigest(name, digest); err != nil {
		return err
	}
	calculated := sha256.Sum256(value)
	if !bytes.Equal(calculated[:], digest) {
		return fmt.Errorf("%w: %s hash differs from bytes", ErrPrivateContentInvalid, name)
	}
	return nil
}

func validateOptionalDigest(name string, digest []byte) error {
	if len(digest) == 0 {
		return nil
	}
	return validateDigest(name, digest)
}

func validateDigest(name string, digest []byte) error {
	if len(digest) != sha256.Size {
		return fmt.Errorf(
			"%w: %s SHA-256 must be %d bytes",
			ErrPrivateContentInvalid,
			name,
			sha256.Size,
		)
	}
	return nil
}

func uniqueSortedStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func clonePlan(plan dbmodel.SocialPrivateContentPlan) dbmodel.SocialPrivateContentPlan {
	plan.CanonicalPrepareBytes = cloneBytes(plan.CanonicalPrepareBytes)
	plan.AuthorizationSnapshotSHA256 = cloneBytes(
		plan.AuthorizationSnapshotSHA256,
	)
	plan.CanonicalPrepareSHA256 = cloneBytes(plan.CanonicalPrepareSHA256)
	plan.ClaimRequestBytes = cloneBytes(plan.ClaimRequestBytes)
	plan.ClaimRequestSHA256 = cloneBytes(plan.ClaimRequestSHA256)
	plan.ClaimResponseBytes = cloneBytes(plan.ClaimResponseBytes)
	plan.ClaimResponseSHA256 = cloneBytes(plan.ClaimResponseSHA256)
	plan.SignedPlanBytes = cloneBytes(plan.SignedPlanBytes)
	plan.SignedPlanSHA256 = cloneBytes(plan.SignedPlanSHA256)
	plan.CanonicalPlanSHA256 = cloneBytes(plan.CanonicalPlanSHA256)
	return plan
}

func cloneReceipt(
	receipt dbmodel.SocialPrivateCommandReceipt,
) dbmodel.SocialPrivateCommandReceipt {
	receipt.CanonicalSubmitSHA256 = cloneBytes(receipt.CanonicalSubmitSHA256)
	receipt.ResponseBytes = cloneBytes(receipt.ResponseBytes)
	receipt.ResponseSHA256 = cloneBytes(receipt.ResponseSHA256)
	return receipt
}

func cloneSlots(
	slots []dbmodel.SocialPrivateContentPlanSlot,
) []dbmodel.SocialPrivateContentPlanSlot {
	cloned := make([]dbmodel.SocialPrivateContentPlanSlot, len(slots))
	copy(cloned, slots)
	for index := range cloned {
		cloned[index].ClaimedPreKeyBytes = cloneBytes(cloned[index].ClaimedPreKeyBytes)
		cloned[index].ClaimedPreKeySHA256 = cloneBytes(cloned[index].ClaimedPreKeySHA256)
		cloned[index].PrincipalBindingSHA256 = cloneBytes(
			cloned[index].PrincipalBindingSHA256,
		)
	}
	return cloned
}

func cloneBytes(value []byte) []byte {
	return append([]byte(nil), value...)
}

var _ PrivateContentStore = (*GORMPrivateContentStore)(nil)
var _ PrivateContentTransaction = (*gormPrivateContentTransaction)(nil)
