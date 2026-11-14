package infrastructure

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Disposable projection of accepted ballots. Rejected newer events preserve
// an Actor's last accepted full selection.
type FeedPollVersion struct {
	PostRef    string `gorm:"primaryKey;size:512"`
	ActorPTID  string `gorm:"column:actor_ptid;primaryKey;size:255"`
	Sequence   uint64 `gorm:"not null"`
	Selections string `gorm:"not null"`
}

func (FeedPollVersion) TableName() string { return "social_feed_poll_versions" }

// A supplemental Home decision does not change the immutable Actor receipt.
func FeedInteractionCanonicalBytes(receipt *model.FeedInteraction) ([]byte, error) {
	if receipt == nil {
		return nil, domain.ErrFeedInvalid
	}
	base := proto.Clone(receipt).(*model.FeedInteraction)
	base.PollAdmission = nil
	return signedlog.Canonical(base)
}

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

func FeedPollDefinitionAt(ctx context.Context, tx *gorm.DB, target string) (*model.FeedPollDefinition, *FeedObjectRecord, error) {
	home, id, err := domain.FeedTargetPost(target)
	if err != nil {
		return nil, nil, err
	}
	var object FeedObjectRecord
	err = tx.WithContext(ctx).Where("home_station = ? AND object_kind = 'post' AND object_id = ?", home, id).Take(&object).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, domain.ErrFeedGap
	}
	if err != nil {
		return nil, nil, err
	}
	request, created, err := OriginalFeedPostRequest(ctx, tx, &object)
	if err != nil {
		return nil, nil, err
	}
	definition, err := domain.FeedPollDefinitionFor(request.GetPoll(), created)
	return definition, &object, err
}

func (p *FeedProjector) projectPollBallot(ctx context.Context, tx *gorm.DB,
	receipt *model.FeedInteraction, post *db.SocialPublicPost) error {
	if receipt.PollAdmission == nil {
		return domain.ErrFeedGap
	}
	payload := &model.FeedPayload{}
	if err := signedlog.Decode(receipt.Event.Payload, payload); err != nil {
		return err
	}
	ballot := payload.GetPollBallot()
	definition, _, err := FeedPollDefinitionAt(ctx, tx, ballot.TargetPostRef)
	if err != nil {
		return err
	}
	if err := domain.ValidateFeedPollAdmission(receipt.PollAdmission, receipt.Event, definition); err != nil {
		return err
	}
	if receipt.PollAdmission.Statement.Result != model.FeedPollAdmissionResult_FEED_POLL_ADMISSION_RESULT_ACCEPTED ||
		post.DeletedAt != nil {
		return nil
	}
	version := FeedPollVersion{PostRef: ballot.TargetPostRef, ActorPTID: receipt.Event.Statement.ActorPtid}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&version).Error; err != nil {
		return err
	}
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("post_ref = ? AND actor_ptid = ?", version.PostRef, version.ActorPTID).Take(&version).Error; err != nil {
		return err
	}
	if version.Sequence >= receipt.Event.Statement.Sequence {
		return nil
	}
	wire, err := json.Marshal(ballot.OptionIndices)
	if err != nil {
		return err
	}
	return tx.Model(&version).Updates(map[string]interface{}{
		"sequence": receipt.Event.Statement.Sequence, "selections": string(wire),
	}).Error
}
