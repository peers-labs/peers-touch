package infrastructure

import (
	"bytes"
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/gorm"
)

// FeedInteractionCanonicalBytes returns the canonical bytes used to dedup a
// stored interaction receipt. The immutable Actor receipt is canonicalized
// as-is.
func FeedInteractionCanonicalBytes(receipt *model.FeedInteraction) ([]byte, error) {
	if receipt == nil {
		return nil, domain.ErrFeedInvalid
	}
	return signedlog.Canonical(receipt)
}

// OriginalFeedPostRequest reconstructs the signed CreatePostRequest for a
// public post object from its retained, hash-verified feed event prefix. It
// is content-kind agnostic and shared by the projection/edit paths.
func OriginalFeedPostRequest(ctx context.Context, tx *gorm.DB, object *FeedObjectRecord) (*model.CreatePostRequest, int64, error) {
	if object == nil || object.ObjectKind != "post" {
		return nil, 0, domain.ErrFeedInvalid
	}
	var chain FeedChainRecord
	if err := tx.WithContext(ctx).Where("actor_ptid = ? AND chain_id = ?",
		object.ActorPTID, domain.PublicFeedChainID).Take(&chain).Error; err != nil {
		return nil, 0, err
	}
	genesis, grant := &model.FeedGenesis{}, &model.FeedWriterGrant{}
	if chain.HomeStationPeerID != object.HomeStation ||
		signedlog.Decode(chain.Genesis, genesis) != nil ||
		signedlog.Decode(chain.WriterGrant, grant) != nil ||
		grant.GetStatement().GetActorPtid() != object.ActorPTID {
		return nil, 0, domain.ErrFeedInvalid
	}
	if err := (&FeedLogStore{database: tx}).verifyStoredHead(ctx, tx, &chain, genesis, grant); err != nil {
		return nil, 0, err
	}
	if object.CreatedSequence > chain.Sequence {
		return nil, 0, domain.ErrFeedGap
	}
	verify := func(row *FeedEventRecord) (*model.CreatePostRequest, int64, error) {
		event := &model.FeedEvent{}
		if row.Sequence == 0 || row.Sequence > chain.Sequence ||
			row.ActorPTID != object.ActorPTID || row.ChainID != domain.PublicFeedChainID ||
			signedlog.Decode(row.Event, event) != nil || domain.VerifyFeedEvent(event, grant) != nil ||
			event.Statement.Sequence != row.Sequence ||
			event.Statement.Kind != model.FeedEventKind_FEED_EVENT_KIND_POST_CREATED {
			return nil, 0, domain.ErrFeedInvalid
		}
		hash, err := domain.FeedEventHash(event)
		if err != nil || !bytes.Equal(hash, row.EventHash) {
			return nil, 0, domain.ErrFeedInvalid
		}
		payload := &model.FeedPayload{}
		if signedlog.Decode(event.Payload, payload) != nil || payload.GetPost() == nil ||
			payload.GetPost().PostId != object.ObjectID {
			return nil, 0, domain.ErrFeedInvalid
		}
		request := &model.CreatePostRequest{}
		if signedlog.Decode(payload.GetPost().CreateRequest, request) != nil {
			return nil, 0, domain.ErrFeedInvalid
		}
		return request, event.Statement.CreatedAtUnixMs, nil
	}
	if object.CreatedSequence != 0 {
		var row FeedEventRecord
		if err := tx.Where("actor_ptid = ? AND chain_id = ? AND sequence = ?",
			object.ActorPTID, domain.PublicFeedChainID, object.CreatedSequence).Take(&row).Error; err != nil {
			return nil, 0, err
		}
		return verify(&row)
	}
	// Repair pre-index rows from their retained signed prefix in bounded pages.
	var after uint64
	for {
		var rows []FeedEventRecord
		if err := tx.Where("actor_ptid = ? AND chain_id = ? AND sequence > ? AND sequence <= ?",
			object.ActorPTID, domain.PublicFeedChainID, after, chain.Sequence).
			Order("sequence").Limit(64).Find(&rows).Error; err != nil {
			return nil, 0, err
		}
		for _, row := range rows {
			event := &model.FeedEvent{}
			if signedlog.Decode(row.Event, event) != nil {
				return nil, 0, domain.ErrFeedInvalid
			}
			after = row.Sequence
			if event.Statement == nil || event.Statement.Kind != model.FeedEventKind_FEED_EVENT_KIND_POST_CREATED {
				continue
			}
			payload := &model.FeedPayload{}
			if signedlog.Decode(event.Payload, payload) != nil {
				return nil, 0, domain.ErrFeedInvalid
			}
			if payload.GetPost().GetPostId() != object.ObjectID {
				continue
			}
			request, created, err := verify(&row)
			if err != nil {
				return nil, 0, err
			}
			if err := tx.Model(object).Update("created_sequence", row.Sequence).Error; err != nil {
				return nil, 0, err
			}
			object.CreatedSequence = row.Sequence
			return request, created, nil
		}
		if len(rows) < 64 {
			return nil, 0, domain.ErrFeedGap
		}
	}
}
