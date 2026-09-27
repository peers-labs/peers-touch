package infrastructure

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

const (
	maximumRecoverablePrivateContentQuerySize = 101
	recoverablePrivateContentActiveState      = "ACTIVE"
)

// RecoverablePrivateContentQuery is the bounded keyset request accepted by the
// Social private-content repository.
type RecoverablePrivateContentQuery struct {
	ActorPTID          string
	CursorCreatedAt    time.Time
	CursorResourceKind string
	CursorResourceID   string
	Limit              int
}

// RecoverablePrivateContentRecord contains only ciphertext and authority
// metadata needed to build one actor-scoped recovery projection.
type RecoverablePrivateContentRecord struct {
	ResourceKind string    `gorm:"column:resource_kind"`
	ResourceID   string    `gorm:"column:resource_id"`
	PostID       string    `gorm:"column:post_id"`
	ContentID    string    `gorm:"column:content_id"`
	Generation   uint64    `gorm:"column:generation"`
	AuthorPTID   string    `gorm:"column:author_ptid"`
	CreatedAt    time.Time `gorm:"column:created_at"`

	SnapshotID                     string `gorm:"column:snapshot_id"`
	CanonicalSnapshotSHA256        []byte `gorm:"column:canonical_snapshot_sha256"`
	EncryptedPayloadBytes          []byte `gorm:"column:encrypted_payload_bytes"`
	EncryptedPayloadSHA256         []byte `gorm:"column:encrypted_payload_sha256"`
	PlanID                         string `gorm:"column:plan_id"`
	AuthorDeviceID                 string `gorm:"column:author_device_id"`
	PlanCanonicalSHA256            []byte `gorm:"column:plan_canonical_sha256"`
	EnvelopeKeyKind                string `gorm:"column:envelope_key_kind"`
	EnvelopeRecipientPTID          string `gorm:"column:envelope_recipient_ptid"`
	EnvelopeRecipientDeviceID      string `gorm:"column:envelope_recipient_device_id"`
	EnvelopeOneTimeKeyID           string `gorm:"column:envelope_one_time_key_id"`
	EnvelopeRecipientSlotID        string `gorm:"column:envelope_recipient_slot_id"`
	EnvelopePrincipalEpoch         uint64 `gorm:"column:envelope_principal_epoch"`
	PreparedEnvelopeBytes          []byte `gorm:"column:prepared_envelope_bytes"`
	EnvelopeCanonicalPlanSHA256    []byte `gorm:"column:envelope_canonical_plan_sha256"`
	EnvelopePrincipalBindingSHA256 []byte `gorm:"column:envelope_principal_binding_sha256"`
	EnvelopeBindingSHA256          []byte `gorm:"column:envelope_binding_sha256"`
	EnvelopeSHA256                 []byte `gorm:"column:envelope_sha256"`
	EnvelopeSenderSignatureSHA256  []byte `gorm:"column:envelope_sender_signature_sha256"`
}

// ListRecoverablePrivateContent returns a bounded, globally ordered page
// candidate set after applying current Social authorization in SQL.
func (s *GORMPrivateContentStore) ListRecoverablePrivateContent(
	ctx context.Context,
	query RecoverablePrivateContentQuery,
) ([]RecoverablePrivateContentRecord, error) {
	if err := validateRecoverablePrivateContentQuery(query); err != nil {
		return nil, err
	}

	posts, err := s.listRecoverablePrivatePosts(ctx, query)
	if err != nil {
		return nil, fmt.Errorf(
			"social private content list recoverable Posts: %w",
			err,
		)
	}
	comments, err := s.listRecoverablePrivateComments(ctx, query)
	if err != nil {
		return nil, fmt.Errorf(
			"social private content list recoverable Comments: %w",
			err,
		)
	}

	records := append(posts, comments...)
	sort.Slice(records, func(left, right int) bool {
		return recoverableRecordBefore(records[left], records[right])
	})
	if len(records) > query.Limit {
		records = records[:query.Limit]
	}

	return records, nil
}

func (s *GORMPrivateContentStore) listRecoverablePrivatePosts(
	ctx context.Context,
	query RecoverablePrivateContentQuery,
) ([]RecoverablePrivateContentRecord, error) {
	rows := make([]RecoverablePrivateContentRecord, 0, query.Limit)
	database := s.db.WithContext(ctx).
		Table("social_private_posts AS resource").
		Select(
			recoverablePrivateContentSelect(
				"resource.post_id",
				"resource.post_id",
			),
			PrivateContentResourcePost,
		).
		Joins(`
JOIN social_private_audience_snapshots AS snapshot
  ON snapshot.snapshot_id = resource.audience_snapshot_id
 AND snapshot.resource_kind = ?
 AND snapshot.resource_id = resource.post_id
 AND snapshot.post_id = resource.post_id
 AND snapshot.audience_kind = ?`,
			PrivateContentResourcePost,
			"FRIENDS",
		).
		Joins(`
JOIN social_private_content_envelopes AS recovery_envelope
  ON recovery_envelope.content_id = resource.content_id
 AND recovery_envelope.key_kind = ?
 AND recovery_envelope.recipient_ptid = ?
 AND recovery_envelope.recipient_device_id = ''`,
			PrivateContentKeyKindActorRecovery,
			query.ActorPTID,
		).
		Joins(`
JOIN social_private_content_plans AS recovery_plan
  ON recovery_plan.plan_id = recovery_envelope.plan_id
 AND recovery_plan.content_id = resource.content_id
 AND recovery_plan.generation = resource.generation
 AND recovery_plan.resource_kind = ?
 AND recovery_plan.state = ?
 AND recovery_plan.domain_commit_id <> ''`,
			PrivateContentResourcePost,
			dbmodel.SocialPrivatePlanStateConsumed,
		).
		Where(
			"resource.deleted_at IS NULL AND resource.lifecycle_state = ?",
			recoverablePrivateContentActiveState,
		).
		Where(
			recoverablePrivateContentAuthorizationSQL(
				"snapshot.snapshot_id",
				"resource.author_ptid",
			),
			query.ActorPTID,
			query.ActorPTID,
			query.ActorPTID,
		).
		Where(
			"NOT "+recoverablePrivateContentBlockExistsSQL("resource.author_ptid"),
			true,
			query.ActorPTID,
			query.ActorPTID,
		).
		Where(
			recoverablePrivateContentHasSingleEnvelopeSQL(),
			PrivateContentKeyKindActorRecovery,
			query.ActorPTID,
		)
	database = applyRecoverablePrivateContentCursor(
		database,
		query,
		PrivateContentResourcePost,
		"resource.post_id",
	)
	if err := database.
		Order("resource.created_at DESC").
		Order("resource.post_id DESC").
		Limit(query.Limit).
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	return rows, nil
}

func (s *GORMPrivateContentStore) listRecoverablePrivateComments(
	ctx context.Context,
	query RecoverablePrivateContentQuery,
) ([]RecoverablePrivateContentRecord, error) {
	rows := make([]RecoverablePrivateContentRecord, 0, query.Limit)
	database := s.db.WithContext(ctx).
		Table("social_private_comments AS resource").
		Select(
			recoverablePrivateContentSelect(
				"resource.comment_id",
				"resource.post_id",
			),
			PrivateContentResourceComment,
		).
		Joins(`
JOIN social_private_posts AS parent
  ON parent.post_id = resource.post_id
 AND parent.deleted_at IS NULL
 AND parent.lifecycle_state = ?`,
			recoverablePrivateContentActiveState,
		).
		Joins(`
JOIN social_private_audience_snapshots AS snapshot
  ON snapshot.snapshot_id = resource.interaction_snapshot_id
 AND snapshot.resource_kind = ?
 AND snapshot.resource_id = resource.comment_id
 AND snapshot.post_id = resource.post_id
 AND snapshot.audience_kind = ?`,
			PrivateContentResourceComment,
			"FRIENDS",
		).
		Joins(`
JOIN social_private_content_envelopes AS recovery_envelope
  ON recovery_envelope.content_id = resource.content_id
 AND recovery_envelope.key_kind = ?
 AND recovery_envelope.recipient_ptid = ?
 AND recovery_envelope.recipient_device_id = ''`,
			PrivateContentKeyKindActorRecovery,
			query.ActorPTID,
		).
		Joins(`
JOIN social_private_content_plans AS recovery_plan
  ON recovery_plan.plan_id = recovery_envelope.plan_id
 AND recovery_plan.content_id = resource.content_id
 AND recovery_plan.generation = resource.generation
 AND recovery_plan.resource_kind = ?
 AND recovery_plan.state = ?
 AND recovery_plan.domain_commit_id <> ''`,
			PrivateContentResourceComment,
			dbmodel.SocialPrivatePlanStateConsumed,
		).
		Where(
			"resource.deleted_at IS NULL AND resource.lifecycle_state = ?",
			recoverablePrivateContentActiveState,
		).
		Where(
			recoverablePrivateContentAuthorizationSQL(
				"snapshot.snapshot_id",
				"resource.author_ptid",
			),
			query.ActorPTID,
			query.ActorPTID,
			query.ActorPTID,
		).
		Where(
			"NOT "+recoverablePrivateContentBlockExistsSQL("resource.author_ptid"),
			true,
			query.ActorPTID,
			query.ActorPTID,
		).
		Where(
			recoverablePrivateContentParentAuthorizationSQL(),
			query.ActorPTID,
			query.ActorPTID,
			query.ActorPTID,
			true,
			query.ActorPTID,
			query.ActorPTID,
		).
		Where(
			recoverablePrivateContentHasSingleEnvelopeSQL(),
			PrivateContentKeyKindActorRecovery,
			query.ActorPTID,
		)
	database = applyRecoverablePrivateContentCursor(
		database,
		query,
		PrivateContentResourceComment,
		"resource.comment_id",
	)
	if err := database.
		Order("resource.created_at DESC").
		Order("resource.comment_id DESC").
		Limit(query.Limit).
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	return rows, nil
}

func recoverablePrivateContentSelect(
	resourceIDColumn string,
	postIDColumn string,
) string {
	return fmt.Sprintf(`
? AS resource_kind,
%s AS resource_id,
%s AS post_id,
resource.content_id AS content_id,
resource.generation AS generation,
resource.author_ptid AS author_ptid,
resource.created_at AS created_at,
snapshot.snapshot_id AS snapshot_id,
snapshot.canonical_snapshot_sha256 AS canonical_snapshot_sha256,
resource.encrypted_payload_bytes AS encrypted_payload_bytes,
resource.encrypted_payload_sha256 AS encrypted_payload_sha256,
recovery_plan.plan_id AS plan_id,
recovery_plan.author_device_id AS author_device_id,
recovery_plan.canonical_plan_sha256 AS plan_canonical_sha256,
recovery_envelope.key_kind AS envelope_key_kind,
recovery_envelope.recipient_ptid AS envelope_recipient_ptid,
recovery_envelope.recipient_device_id AS envelope_recipient_device_id,
recovery_envelope.one_time_key_id AS envelope_one_time_key_id,
recovery_envelope.recipient_slot_id AS envelope_recipient_slot_id,
recovery_envelope.principal_epoch AS envelope_principal_epoch,
recovery_envelope.prepared_envelope_bytes AS prepared_envelope_bytes,
recovery_envelope.canonical_plan_sha256 AS envelope_canonical_plan_sha256,
recovery_envelope.principal_binding_sha256 AS envelope_principal_binding_sha256,
recovery_envelope.binding_sha256 AS envelope_binding_sha256,
recovery_envelope.envelope_sha256 AS envelope_sha256,
recovery_envelope.sender_signature_sha256 AS envelope_sender_signature_sha256`,
		resourceIDColumn,
		postIDColumn,
	)
}

func recoverablePrivateContentBlockExistsSQL(
	authorColumn string,
) string {
	return fmt.Sprintf(`
EXISTS (
  SELECT 1
    FROM social_directional_relationships AS blocked
   WHERE blocked.blocked = ?
     AND (
       (blocked.actor_ptid = %s AND blocked.target_actor_ptid = ?)
       OR
       (blocked.actor_ptid = ? AND blocked.target_actor_ptid = %s)
     )
)`,
		authorColumn,
		authorColumn,
	)
}

func recoverablePrivateContentAuthorizationSQL(
	snapshotColumn string,
	authorColumn string,
) string {
	return fmt.Sprintf(`
(
  %s = ?
  OR (
    EXISTS (
      SELECT 1
        FROM social_private_recipient_grants AS current_grant
       WHERE current_grant.snapshot_id = %s
         AND current_grant.recipient_ptid = ?
         AND current_grant.revoked_at IS NULL
    )
    AND EXISTS (
      SELECT 1
        FROM social_relationship_projections AS current_friend
       WHERE current_friend.owner_ptid = %s
         AND current_friend.peer_ptid = ?
    )
  )
)`,
		authorColumn,
		snapshotColumn,
		authorColumn,
	)
}

func recoverablePrivateContentParentAuthorizationSQL() string {
	return `
(
  parent.author_ptid = ?
  OR (
    EXISTS (
      SELECT 1
        FROM social_private_recipient_grants AS parent_grant
       WHERE parent_grant.snapshot_id = parent.audience_snapshot_id
         AND parent_grant.recipient_ptid = ?
         AND parent_grant.revoked_at IS NULL
    )
    AND EXISTS (
      SELECT 1
        FROM social_relationship_projections AS parent_friend
       WHERE parent_friend.owner_ptid = parent.author_ptid
         AND parent_friend.peer_ptid = ?
    )
    AND NOT EXISTS (
      SELECT 1
        FROM social_directional_relationships AS parent_block
       WHERE parent_block.blocked = ?
         AND (
           (parent_block.actor_ptid = parent.author_ptid
             AND parent_block.target_actor_ptid = ?)
           OR
           (parent_block.actor_ptid = ?
             AND parent_block.target_actor_ptid = parent.author_ptid)
         )
    )
  )
)`
}

func recoverablePrivateContentHasSingleEnvelopeSQL() string {
	return `
NOT EXISTS (
  SELECT 1
    FROM social_private_content_envelopes AS duplicate_envelope
   WHERE duplicate_envelope.content_id = recovery_envelope.content_id
     AND duplicate_envelope.key_kind = ?
     AND duplicate_envelope.recipient_ptid = ?
     AND duplicate_envelope.recipient_device_id = ''
     AND duplicate_envelope.one_time_key_id <> recovery_envelope.one_time_key_id
)`
}

func applyRecoverablePrivateContentCursor(
	database *gorm.DB,
	query RecoverablePrivateContentQuery,
	resourceKind string,
	resourceIDColumn string,
) *gorm.DB {
	if query.CursorCreatedAt.IsZero() {
		return database
	}
	switch strings.Compare(resourceKind, query.CursorResourceKind) {
	case -1:
		return database.Where(
			"resource.created_at < ?",
			query.CursorCreatedAt,
		)
	case 1:
		return database.Where(
			"resource.created_at <= ?",
			query.CursorCreatedAt,
		)
	default:
		return database.Where(
			fmt.Sprintf(
				"(resource.created_at < ? OR (resource.created_at = ? AND %s < ?))",
				resourceIDColumn,
			),
			query.CursorCreatedAt,
			query.CursorCreatedAt,
			query.CursorResourceID,
		)
	}
}

func validateRecoverablePrivateContentQuery(
	query RecoverablePrivateContentQuery,
) error {
	if strings.TrimSpace(query.ActorPTID) == "" ||
		query.ActorPTID != strings.TrimSpace(query.ActorPTID) ||
		strings.ContainsRune(query.ActorPTID, '\x00') ||
		len(query.ActorPTID) > 255 {
		return fmt.Errorf(
			"%w: canonical actor PTID is required",
			ErrPrivateContentInvalid,
		)
	}
	if query.Limit < 1 ||
		query.Limit > maximumRecoverablePrivateContentQuerySize {
		return fmt.Errorf(
			"%w: recovery query limit must be between 1 and %d",
			ErrPrivateContentInvalid,
			maximumRecoverablePrivateContentQuerySize,
		)
	}
	cursorFields := 0
	if !query.CursorCreatedAt.IsZero() {
		cursorFields++
	}
	if query.CursorResourceKind != "" {
		cursorFields++
	}
	if query.CursorResourceID != "" {
		cursorFields++
	}
	if cursorFields != 0 && cursorFields != 3 {
		return fmt.Errorf(
			"%w: recovery cursor is incomplete",
			ErrPrivateContentInvalid,
		)
	}
	if cursorFields == 3 &&
		query.CursorResourceKind != PrivateContentResourcePost &&
		query.CursorResourceKind != PrivateContentResourceComment {
		return fmt.Errorf(
			"%w: recovery cursor resource kind is invalid",
			ErrPrivateContentInvalid,
		)
	}

	return nil
}

func recoverableRecordBefore(
	left RecoverablePrivateContentRecord,
	right RecoverablePrivateContentRecord,
) bool {
	if !left.CreatedAt.Equal(right.CreatedAt) {
		return left.CreatedAt.After(right.CreatedAt)
	}
	if left.ResourceKind != right.ResourceKind {
		return left.ResourceKind < right.ResourceKind
	}

	return left.ResourceID > right.ResourceID
}
