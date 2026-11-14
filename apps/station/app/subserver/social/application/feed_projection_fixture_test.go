package application

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"fmt"
	"strconv"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// These fixtures exercise the production signed projector; they are not a
// replacement public API. Unsigned service rejection is tested independently.
func (f *fixture) projectReceipt(ctx context.Context, postID, actor string, kind model.FeedEventKind, payload *model.FeedPayload) error {
	store, err := infrastructure.NewFeedLogStore(f.gdb)
	if err != nil {
		return err
	}
	if err := store.Migrate(ctx); err != nil {
		return err
	}
	post, err := f.moments.GetMoment(ctx, postID, actor)
	if err != nil || post == nil {
		return fmt.Errorf("fixture post unavailable: %v", err)
	}
	root := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{1}, 32))
	writer := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{2}, 32))
	sign := func(domain string, message proto.Message, key ed25519.PrivateKey) ([]byte, error) {
		wire, err := signedlog.SigningBytes(domain, message)
		if err != nil {
			return nil, err
		}
		return ed25519.Sign(key, wire), nil
	}
	genesis := &model.FeedGenesis{Statement: &model.FeedGenesisStatement{FormatVersion: 1,
		ActorPtid: actor, ChainId: domain.PublicFeedChainID, ActorIdentityPublicKey: root.Public().(ed25519.PublicKey)}}
	genesis.ActorSignature, err = sign(domain.FeedGenesisDomain, genesis.Statement, root)
	if err != nil {
		return err
	}
	genesisHash, _ := signedlog.Hash(domain.FeedGenesisDomain, genesis)
	grant := &model.FeedWriterGrant{Statement: &model.FeedWriterGrantStatement{FormatVersion: 1,
		ActorPtid: actor, ChainId: domain.PublicFeedChainID, GenesisHash: genesisHash,
		DeviceId: "fixture-device", SigningKeyId: "fixture-key", DevicePublicKey: writer.Public().(ed25519.PublicKey)}}
	grant.ActorSignature, err = sign(domain.FeedGrantDomain, grant.Statement, root)
	if err != nil {
		return err
	}
	if err := domain.VerifyFeedAuthorization(genesis, grant, actor, genesis.Statement.ActorIdentityPublicKey); err != nil {
		return err
	}
	var sequence uint64
	if err := f.gdb.Model(&infrastructure.FeedInteractionRecord{}).Select("COALESCE(MAX(sequence),0)").
		Where("actor_ptid = ?", actor).Scan(&sequence).Error; err != nil {
		return err
	}
	wire, err := signedlog.Canonical(payload)
	if err != nil {
		return err
	}
	hash := sha256.Sum256(wire)
	grantHash, _ := signedlog.Hash(domain.FeedGrantDomain, grant)
	event := &model.FeedEvent{Statement: &model.FeedEventStatement{FormatVersion: 1, ActorPtid: actor,
		ChainId: domain.PublicFeedChainID, Sequence: sequence + 1, PreviousHash: genesisHash,
		WriterGrantHash: grantHash, Kind: kind, PayloadHash: hash[:], CreatedAtUnixMs: time.Now().UnixMilli()}, Payload: wire}
	event.DeviceSignature, err = sign(domain.FeedEventDomain, event.Statement, writer)
	if err != nil {
		return err
	}
	if err := domain.VerifyFeedEvent(event, grant); err != nil {
		return err
	}
	return store.Transaction(ctx, func(tx *gorm.DB) error {
		object := &infrastructure.FeedObjectRecord{HomeStation: "station-a", ObjectKind: "post",
			ObjectID: postID, ActorPTID: post.AuthorPtid, LocalID: domain.ParseID(postID), Sequence: 1}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(object).Error; err != nil {
			return err
		}
		_, err := infrastructure.NewFeedProjector("station-a").StoreInteraction(ctx, tx,
			&model.FeedInteraction{Genesis: genesis, WriterGrant: grant, Event: event}, "station-a", true)
		return err
	})
}

func (f *fixture) projectReaction(ctx context.Context, postID, actor string, reaction model.ReactionKind, remove bool) ([]*model.ReactionSummary, error) {
	kind := model.FeedEventKind_FEED_EVENT_KIND_REACTION_SET
	if remove {
		kind = model.FeedEventKind_FEED_EVENT_KIND_REACTION_REMOVED
	}
	err := f.projectReceipt(ctx, postID, actor, kind, &model.FeedPayload{Mutation: &model.FeedPayload_Reaction{
		Reaction: &model.FeedReactionMutation{TargetPostRef: "oss://station-a/post/" + postID, ReactionKind: int32(reaction)}}})
	if err != nil {
		return nil, err
	}
	post, err := f.moments.GetMoment(ctx, postID, actor)
	if err != nil {
		return nil, err
	}
	summaries, err := f.reactions.Aggregate(ctx, postID, post.AuthorPtid, actor)
	return f.reactions.toProtoSummaries(summaries), err
}

func (f *fixture) projectComment(ctx context.Context, request *model.CreateCommentRequest, postID uint64, actor string) (*model.Comment, error) {
	request = proto.Clone(request).(*model.CreateCommentRequest)
	target := "oss://station-a/post/" + strconv.FormatUint(postID, 10)
	request.PostId = target
	if request.ReplyToCommentId != "" {
		request.ReplyToCommentId = "oss://station-a/comment/" + request.ReplyToCommentId
	}
	wire, err := signedlog.Canonical(request)
	if err != nil {
		return nil, err
	}
	commentID := id.NextID()
	err = f.projectReceipt(ctx, strconv.FormatUint(postID, 10), actor, model.FeedEventKind_FEED_EVENT_KIND_COMMENT_CREATED,
		&model.FeedPayload{Mutation: &model.FeedPayload_Comment{Comment: &model.FeedCommentMutation{
			CommentId: strconv.FormatUint(commentID, 10), TargetPostRef: target, CreateRequest: wire}}})
	if err != nil {
		return nil, err
	}
	return f.comments.GetByPost(ctx, postID, commentID, actor)
}

func (f *fixture) projectCommentDelete(ctx context.Context, commentID uint64, actor string) error {
	comment, err := f.repos.Comments.GetByID(ctx, commentID)
	if err != nil || comment == nil {
		return fmt.Errorf("fixture comment unavailable: %v", err)
	}
	postID := strconv.FormatUint(comment.PostID, 10)
	return f.projectReceipt(ctx, postID, actor, model.FeedEventKind_FEED_EVENT_KIND_COMMENT_TOMBSTONED,
		&model.FeedPayload{Mutation: &model.FeedPayload_Comment{Comment: &model.FeedCommentMutation{
			CommentId: strconv.FormatUint(commentID, 10), TargetPostRef: "oss://station-a/post/" + postID}}})
}

func (f *fixture) projectCommentReaction(ctx context.Context, postID, commentID, actor string, remove bool) error {
	kind := model.FeedEventKind_FEED_EVENT_KIND_REACTION_SET
	if remove {
		kind = model.FeedEventKind_FEED_EVENT_KIND_REACTION_REMOVED
	}
	return f.projectReceipt(ctx, postID, actor, kind, &model.FeedPayload{Mutation: &model.FeedPayload_Reaction{
		Reaction: &model.FeedReactionMutation{TargetPostRef: "oss://station-a/post/" + postID,
			TargetCommentRef: "oss://station-a/comment/" + commentID, ReactionKind: int32(model.ReactionKind_REACTION_LIKE)},
	}})
}
