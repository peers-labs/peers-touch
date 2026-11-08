package infrastructure

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math"
	"time"

	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// These rows are projections of the original signed private command journal.
// No labels, plaintext choices or independent permission authority are stored.
type privatePollBallotModel struct {
	PostID     string `gorm:"column:post_id;primaryKey;size:128"`
	Generation uint64 `gorm:"column:generation;primaryKey"`
	ActorPTID  string `gorm:"column:actor_ptid;primaryKey;size:255"`
	CommandID  string `gorm:"column:command_id;size:255;not null"`
}

func (privatePollBallotModel) TableName() string { return "social_private_poll_ballots" }

type privatePollChoiceModel struct {
	PostID         string `gorm:"column:post_id;primaryKey;size:128"`
	Generation     uint64 `gorm:"column:generation;primaryKey"`
	ActorPTID      string `gorm:"column:actor_ptid;primaryKey;size:255"`
	OpaqueOptionID string `gorm:"column:opaque_option_id;primaryKey;size:64"`
}

func (privatePollChoiceModel) TableName() string { return "social_private_poll_choices" }

type privatePollStateModel struct {
	PostID             string    `gorm:"column:post_id;primaryKey;size:128"`
	Generation         uint64    `gorm:"column:generation;primaryKey"`
	ProjectionRevision uint64    `gorm:"column:projection_revision;not null"`
	CommandID          string    `gorm:"column:command_id;size:255;not null"`
	VoteActorPTID      string    `gorm:"column:vote_actor_ptid;size:255;not null"`
	AdmittedAt         time.Time `gorm:"column:admitted_at;not null"`
}

func (privatePollStateModel) TableName() string { return "social_private_poll_states" }

type privatePollProjectionModel struct {
	SourceStationPeerID string `gorm:"column:source_station_peer_id;primaryKey;size:512"`
	PostID              string `gorm:"column:post_id;primaryKey;size:128"`
	Generation          uint64 `gorm:"column:generation;primaryKey"`
	ViewerPTID          string `gorm:"column:viewer_ptid;primaryKey;size:255"`
	ProjectionRevision  uint64 `gorm:"column:projection_revision;not null"`
	ProjectionBytes     []byte `gorm:"column:projection_bytes;type:bytea;not null"`
}

func (privatePollProjectionModel) TableName() string { return "social_private_poll_projections" }

type PrivatePollMutation struct {
	Authority  *privatecontentpb.PrivatePollAuthority
	AdmittedAt time.Time
}

func localPrivatePollAuthority(database *gorm.DB, postID, actorPTID string) (*privatecontentpb.PrivatePollAuthority, error) {
	var post dbmodel.SocialPrivateContentPost
	if err := database.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("post_id = ? AND lifecycle_state = ? AND deleted_at IS NULL", postID, privateContentLifecycleActive).
		First(&post).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPrivateContentNotFound
		}
		return nil, err
	}
	if err := authorizePrivatePostViewer(database, post, actorPTID); err != nil {
		return nil, err
	}
	if post.Kind != "POLL" {
		return nil, socialdomain.NewPrivateContentError(socialdomain.PrivateContentPollNotPoll,
			"social.private_content.poll_authority", "parent", "is not a poll")
	}
	var plan dbmodel.SocialPrivateContentPlan
	if err := database.Where("content_id = ? AND generation = ? AND audience_snapshot_id = ? AND resource_kind = ?",
		post.ContentID, post.Generation, post.AudienceSnapshotID, PrivateContentResourcePost).First(&plan).Error; err != nil {
		return nil, err
	}
	digest := sha256.Sum256(plan.SubtypePrepareAuthorityBytes)
	authority := &privatecontentpb.PrivatePollAuthority{}
	if !bytes.Equal(digest[:], plan.SubtypePrepareAuthoritySHA256) ||
		!bytes.Equal(digest[:], post.SubtypeAuthoritySHA256) ||
		proto.Unmarshal(plan.SubtypePrepareAuthorityBytes, authority) != nil {
		return nil, ErrPrivateContentConflict
	}
	canonical, err := socialdomain.CanonicalProtoBytes(authority)
	if err != nil || !bytes.Equal(canonical, plan.SubtypePrepareAuthorityBytes) ||
		authority.GetResource().GetGeneration() != post.Generation {
		return nil, ErrPrivateContentConflict
	}
	if err := socialdomain.ValidatePrivatePollAuthority(authority, postID, "social.private_content.poll_authority"); err != nil {
		return nil, err
	}
	return authority, nil
}

func (s *GORMPrivateContentStore) LoadPrivatePollAuthority(
	ctx context.Context, transaction delivery.Transaction, sourceStationPeerID, postID, viewerPTID string,
) (*privatecontentpb.PrivatePollAuthority, error) {
	database, err := privateInteractionDatabase(s.db, transaction)
	if err != nil {
		return nil, err
	}
	database = database.WithContext(ctx)
	var local int64
	if err := database.Model(&dbmodel.SocialPrivateContentPost{}).Where("post_id = ?", postID).Count(&local).Error; err != nil {
		return nil, err
	}
	if local != 0 {
		return localPrivatePollAuthority(database, postID, viewerPTID)
	}
	var row remotePrivateResourceModel
	if err := database.Where("source_station_peer_id = ? AND content_id = ? AND target_actor_ptid = ? AND resource_kind = ? AND state = ?",
		sourceStationPeerID, postID, viewerPTID,
		int32(privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_POST),
		remotePrivateResourceStateActive).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPrivateContentNotFound
		}
		return nil, err
	}
	blocked, err := remotePrivateRelationshipBlocked(ctx, database, viewerPTID, row.AuthorPTID)
	if err != nil {
		return nil, err
	}
	if blocked {
		return nil, ErrPrivateContentNotFound
	}
	verification := &privatecontentpb.PrivateContentVerification{}
	if err := proto.Unmarshal(row.VerificationBytes, verification); err != nil {
		return nil, err
	}
	authority := verification.GetPollAuthority()
	if authority == nil {
		return nil, socialdomain.NewPrivateContentError(socialdomain.PrivateContentPollNotPoll,
			"social.private_content.poll_authority", "parent", "is not a poll")
	}
	if err := socialdomain.ValidatePrivatePollAuthority(authority, postID, "social.private_content.poll_authority"); err != nil {
		return nil, err
	}
	if authority.GetResource().GetGeneration() != row.Generation {
		return nil, ErrPrivateContentConflict
	}
	return authority, nil
}

func (s *GORMPrivateContentStore) MutatePrivatePoll(
	ctx context.Context, transaction delivery.Transaction, parent *securecontentpb.SecureResourceRef,
	actorPTID string, request *privatecontentpb.VotePrivatePollRequest, clock func() time.Time,
) (PrivatePollMutation, error) {
	if transaction == nil || transaction.DB() == nil || parent == nil || request == nil ||
		actorPTID == "" || clock == nil || parent.GetContentId() != request.GetPostId() {
		return PrivatePollMutation{}, ErrPrivateContentInvalid
	}
	database := transaction.DB().WithContext(ctx)
	authority, err := localPrivatePollAuthority(database, request.GetPostId(), actorPTID)
	if err != nil {
		return PrivatePollMutation{}, err
	}
	if !proto.Equal(parent, authority.GetResource()) {
		return PrivatePollMutation{}, ErrPrivateContentNotFound
	}
	now := clock().UTC()
	if err := socialdomain.ValidatePrivatePollVote(request, authority, now, "social.private_content.vote_poll"); err != nil {
		return PrivatePollMutation{}, err
	}
	var state privatePollStateModel
	err = database.Where("post_id = ? AND generation = ?", parent.GetContentId(), parent.GetGeneration()).First(&state).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return PrivatePollMutation{}, err
	}
	if state.ProjectionRevision >= math.MaxInt64 {
		return PrivatePollMutation{}, ErrPrivateContentConflict
	}
	ballot := privatePollBallotModel{PostID: request.GetPostId(), Generation: parent.GetGeneration(),
		ActorPTID: actorPTID, CommandID: request.GetCommandId()}
	if err := database.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "post_id"}, {Name: "generation"}, {Name: "actor_ptid"}},
		DoUpdates: clause.AssignmentColumns([]string{"command_id"}),
	}).Create(&ballot).Error; err != nil {
		return PrivatePollMutation{}, err
	}
	if err := database.Where("post_id = ? AND generation = ? AND actor_ptid = ?",
		ballot.PostID, ballot.Generation, actorPTID).Delete(&privatePollChoiceModel{}).Error; err != nil {
		return PrivatePollMutation{}, err
	}
	for _, option := range request.GetOpaqueOptionIds() {
		choice := privatePollChoiceModel{PostID: ballot.PostID, Generation: ballot.Generation,
			ActorPTID: actorPTID, OpaqueOptionID: hex.EncodeToString(option)}
		if err := database.Create(&choice).Error; err != nil {
			return PrivatePollMutation{}, err
		}
	}
	state = privatePollStateModel{PostID: ballot.PostID, Generation: ballot.Generation,
		ProjectionRevision: state.ProjectionRevision + 1, CommandID: request.GetCommandId(),
		VoteActorPTID: actorPTID, AdmittedAt: now.UTC()}
	if err := database.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "post_id"}, {Name: "generation"}},
		DoUpdates: clause.AssignmentColumns([]string{"projection_revision", "command_id", "vote_actor_ptid", "admitted_at"}),
	}).Create(&state).Error; err != nil {
		return PrivatePollMutation{}, err
	}
	return PrivatePollMutation{Authority: authority, AdmittedAt: now.UTC()}, nil
}

func (s *GORMPrivateContentStore) LocalPrivatePollProjection(
	ctx context.Context, transaction delivery.Transaction, authority *privatecontentpb.PrivatePollAuthority, viewerPTID string,
) (*privatecontentpb.PrivatePollProjection, error) {
	database, err := privateInteractionDatabase(s.db, transaction)
	if err != nil {
		return nil, err
	}
	database = database.WithContext(ctx)
	parent := authority.GetResource()
	current, err := localPrivatePollAuthority(database, parent.GetContentId(), viewerPTID)
	if err != nil || !proto.Equal(current, authority) {
		if err != nil {
			return nil, err
		}
		return nil, ErrPrivateContentConflict
	}
	projection := emptyPrivatePollProjection(authority)
	var state privatePollStateModel
	err = database.Where("post_id = ? AND generation = ?", parent.GetContentId(), parent.GetGeneration()).First(&state).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return projection, nil
	}
	if err != nil {
		return nil, err
	}
	projection.ProjectionRevision, projection.CommandId, projection.VoteActorPtid =
		state.ProjectionRevision, state.CommandID, state.VoteActorPTID
	var voters int64
	if err := database.Model(&privatePollBallotModel{}).Where("post_id = ? AND generation = ?",
		parent.GetContentId(), parent.GetGeneration()).Count(&voters).Error; err != nil {
		return nil, err
	}
	projection.VoterCount = uint64(voters)
	var counts []struct {
		OpaqueOptionID string
		VoteCount      uint64
	}
	if err := database.Model(&privatePollChoiceModel{}).Select("opaque_option_id, COUNT(*) AS vote_count").
		Where("post_id = ? AND generation = ?", parent.GetContentId(), parent.GetGeneration()).
		Group("opaque_option_id").Scan(&counts).Error; err != nil {
		return nil, err
	}
	var choices []privatePollChoiceModel
	if err := database.Where("post_id = ? AND generation = ? AND actor_ptid = ?",
		parent.GetContentId(), parent.GetGeneration(), viewerPTID).Find(&choices).Error; err != nil {
		return nil, err
	}
	for _, option := range projection.Options {
		key := hex.EncodeToString(option.OpaqueOptionId)
		for _, count := range counts {
			if count.OpaqueOptionID == key {
				option.VoteCount = count.VoteCount
			}
		}
		for _, choice := range choices {
			if choice.OpaqueOptionID == key {
				option.SelectedByViewer = true
			}
		}
	}
	for _, count := range counts {
		known := false
		for _, option := range projection.Options {
			known = known || count.OpaqueOptionID == hex.EncodeToString(option.OpaqueOptionId)
		}
		if !known {
			return nil, ErrPrivateContentConflict
		}
	}
	if err := socialdomain.ValidatePrivatePollProjection(projection, authority, "social.private_content.poll_projection"); err != nil {
		return nil, err
	}
	return projection, nil
}

func emptyPrivatePollProjection(authority *privatecontentpb.PrivatePollAuthority) *privatecontentpb.PrivatePollProjection {
	projection := &privatecontentpb.PrivatePollProjection{
		PostId: authority.GetResource().GetContentId(), OptionSetSha256: append([]byte(nil), authority.GetOptionSetSha256()...),
	}
	for _, option := range authority.GetOpaqueOptionIds() {
		projection.Options = append(projection.Options, &privatecontentpb.PrivatePollOptionResult{OpaqueOptionId: append([]byte(nil), option...)})
	}
	return projection
}

func (s *GORMPrivateContentStore) PutPrivatePollProjection(
	ctx context.Context, transaction delivery.Transaction, sourceStationPeerID, viewerPTID string,
	authority *privatecontentpb.PrivatePollAuthority, projection *privatecontentpb.PrivatePollProjection,
) (bool, error) {
	if sourceStationPeerID == "" || viewerPTID == "" || projection.GetProjectionRevision() == 0 {
		return false, ErrPrivateContentInvalid
	}
	if err := socialdomain.ValidatePrivatePollProjection(projection, authority, "social.private_content.poll_projection"); err != nil {
		return false, err
	}
	wire, err := socialdomain.CanonicalProtoBytes(projection)
	if err != nil {
		return false, err
	}
	database, err := privateInteractionDatabase(s.db, transaction)
	if err != nil {
		return false, err
	}
	row := privatePollProjectionModel{SourceStationPeerID: sourceStationPeerID, PostID: projection.GetPostId(),
		Generation: authority.GetResource().GetGeneration(), ViewerPTID: viewerPTID,
		ProjectionRevision: projection.GetProjectionRevision(), ProjectionBytes: wire}
	result := database.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row)
	if result.Error != nil || result.RowsAffected == 1 {
		return result.Error == nil, result.Error
	}
	var current privatePollProjectionModel
	key := database.WithContext(ctx).Where("source_station_peer_id = ? AND post_id = ? AND generation = ? AND viewer_ptid = ?",
		row.SourceStationPeerID, row.PostID, row.Generation, row.ViewerPTID)
	if err := key.First(&current).Error; err != nil {
		return false, err
	}
	if current.ProjectionRevision > row.ProjectionRevision {
		return false, nil
	}
	if current.ProjectionRevision == row.ProjectionRevision {
		if !bytes.Equal(current.ProjectionBytes, row.ProjectionBytes) {
			return false, ErrPrivateContentConflict
		}
		return false, nil
	}
	result = database.WithContext(ctx).Model(&privatePollProjectionModel{}).
		Where("source_station_peer_id = ? AND post_id = ? AND generation = ? AND viewer_ptid = ? AND projection_revision < ?",
			row.SourceStationPeerID, row.PostID, row.Generation, row.ViewerPTID, row.ProjectionRevision).
		UpdateColumns(map[string]any{"projection_revision": row.ProjectionRevision, "projection_bytes": wire})
	return result.RowsAffected == 1, result.Error
}

func (s *GORMPrivateContentStore) LoadPrivatePollProjection(
	ctx context.Context, transaction delivery.Transaction, sourceStationPeerID, viewerPTID string,
	authority *privatecontentpb.PrivatePollAuthority,
) (*privatecontentpb.PrivatePollProjection, error) {
	current, err := s.LoadPrivatePollAuthority(ctx, transaction, sourceStationPeerID, authority.GetResource().GetContentId(), viewerPTID)
	if err != nil {
		return nil, err
	}
	if !proto.Equal(current, authority) {
		return nil, ErrPrivateContentConflict
	}
	database, err := privateInteractionDatabase(s.db, transaction)
	if err != nil {
		return nil, err
	}
	var row privatePollProjectionModel
	err = database.WithContext(ctx).Where("source_station_peer_id = ? AND post_id = ? AND generation = ? AND viewer_ptid = ?",
		sourceStationPeerID, authority.GetResource().GetContentId(), authority.GetResource().GetGeneration(), viewerPTID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return emptyPrivatePollProjection(authority), nil
	}
	if err != nil {
		return nil, err
	}
	projection := &privatecontentpb.PrivatePollProjection{}
	if err := proto.Unmarshal(row.ProjectionBytes, projection); err != nil {
		return nil, err
	}
	wire, err := socialdomain.CanonicalProtoBytes(projection)
	if err != nil || !bytes.Equal(wire, row.ProjectionBytes) || projection.GetProjectionRevision() != row.ProjectionRevision {
		return nil, ErrPrivateContentConflict
	}
	if err := socialdomain.ValidatePrivatePollProjection(projection, authority, "social.private_content.poll_projection"); err != nil {
		return nil, err
	}
	return projection, nil
}
