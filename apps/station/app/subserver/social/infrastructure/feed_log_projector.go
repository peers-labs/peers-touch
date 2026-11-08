package infrastructure

import (
	"context"
	"errors"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// FeedObjectRecord keeps writer-allocated object IDs scoped to their home
// Station. Remote IDs are translated to Station-local projection IDs so two
// unrelated Stations cannot overwrite each other's numeric primary keys.
type FeedObjectRecord struct {
	HomeStation string `gorm:"primaryKey;size:255"`
	ObjectKind  string `gorm:"primaryKey;size:16"`
	ObjectID    string `gorm:"primaryKey;size:20"`
	ActorPTID   string `gorm:"column:actor_ptid;not null;size:255"`
	LocalID     uint64 `gorm:"not null;uniqueIndex"`
	Sequence    uint64 `gorm:"not null"`
}

func (FeedObjectRecord) TableName() string { return "social_feed_objects" }

type FeedProjectionObserver func(context.Context, *gorm.DB, *model.FeedEvent, uint64, string) error
type FeedProjector struct {
	localStation string
	observer     FeedProjectionObserver
}

func (p *FeedProjector) SetObserver(observer FeedProjectionObserver) { p.observer = observer }
func (p *FeedProjector) observe(ctx context.Context, tx *gorm.DB, event *model.FeedEvent, postID uint64, author string) error {
	if p.observer == nil {
		return nil
	}
	return p.observer(ctx, tx, event, postID, author)
}

func NewFeedProjector(localStation string) *FeedProjector {
	return &FeedProjector{localStation: localStation}
}

// Apply is called only after the entire append batch passes verification.
// Interaction receipts retain portable proof and can be projected without
// importing the interacting author's unrelated log prefix.
func (p *FeedProjector) Apply(ctx context.Context, tx *gorm.DB, event *model.FeedEvent) error {
	payload := &model.FeedPayload{}
	if err := signedlog.Decode(event.Payload, payload); err != nil {
		return err
	}
	var chain FeedChainRecord
	if err := tx.WithContext(ctx).Where("actor_ptid = ? AND chain_id = ?",
		event.Statement.ActorPtid, event.Statement.ChainId).Take(&chain).Error; err != nil {
		return err
	}
	if mutation := payload.GetPost(); mutation != nil {
		if err := p.applyPost(ctx, tx, &chain, event, mutation); err != nil {
			return err
		}
		var object FeedObjectRecord
		if err := tx.Where("home_station = ? AND object_kind = 'post' AND object_id = ?", chain.HomeStationPeerID, mutation.PostId).Take(&object).Error; err != nil {
			return err
		}
		return p.observe(ctx, tx, event, object.LocalID, chain.ActorPTID)
	}
	receipt := &model.FeedInteraction{Genesis: &model.FeedGenesis{}, WriterGrant: &model.FeedWriterGrant{}, Event: event}
	if err := signedlog.Decode(chain.Genesis, receipt.Genesis); err != nil {
		return err
	}
	if err := signedlog.Decode(chain.WriterGrant, receipt.WriterGrant); err != nil {
		return err
	}
	_, err := p.StoreInteraction(ctx, tx, receipt, chain.HomeStationPeerID, chain.HomeStationPeerID != p.localStation)
	return err
}

func (p *FeedProjector) applyPost(ctx context.Context, tx *gorm.DB, chain *FeedChainRecord,
	event *model.FeedEvent, mutation *model.FeedPostMutation) error {
	objectID, err := domain.FeedObjectID(mutation.PostId)
	if err != nil {
		return err
	}
	when := time.UnixMilli(event.Statement.CreatedAtUnixMs).UTC()
	key := FeedObjectRecord{HomeStation: chain.HomeStationPeerID, ObjectKind: "post", ObjectID: mutation.PostId}
	var object FeedObjectRecord
	err = tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("home_station = ? AND object_kind = ? AND object_id = ?",
			key.HomeStation, key.ObjectKind, key.ObjectID).Take(&object).Error
	kind := event.Statement.Kind
	if kind == model.FeedEventKind_FEED_EVENT_KIND_POST_CREATED {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			if err != nil {
				return err
			}
			return domain.ErrFeedInvalid
		}
		key.ActorPTID, key.LocalID, key.Sequence = chain.ActorPTID, objectID, event.Statement.Sequence
		if chain.HomeStationPeerID != p.localStation {
			key.LocalID = id.NextID()
		}
		object = key
	} else {
		if err != nil {
			return err
		}
		if object.ActorPTID != chain.ActorPTID {
			return domain.ErrFeedWriter
		}
	}
	authorID, err := NewActorIdentity(tx).RequireID(ctx, chain.ActorPTID)
	if err != nil {
		return err
	}
	if kind == model.FeedEventKind_FEED_EVENT_KIND_POST_TOMBSTONED {
		if len(mutation.CreateRequest) != 0 {
			return domain.ErrFeedInvalid
		}
		result := tx.WithContext(ctx).Model(&db.SocialPublicPost{}).
			Where("id = ? AND author_id = ?", object.LocalID, authorID).
			Updates(map[string]interface{}{"deleted_at": when, "updated_at": when})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return domain.ErrFeedInvalid
		}
		return tx.Model(&object).Update("sequence", event.Statement.Sequence).Error
	}
	request := &model.CreatePostRequest{}
	if err := signedlog.Decode(mutation.CreateRequest, request); err != nil {
		return err
	}
	if !domain.IsPublic(request.Audience) {
		return domain.ErrFeedInvalid
	}
	if chain.HomeStationPeerID == p.localStation {
		if err := domain.ValidatePostMedia(ctx, request, NewOssMediaResolver(tx)); err != nil {
			return err
		}
	}
	post, err := domain.NewPostConverter().CreateRequestToDomain(request, chain.ActorPTID, nil)
	if err != nil {
		return err
	}
	row, err := domain.NewPostConverter().DomainToPublicDB(post)
	if err != nil {
		return err
	}
	row.ID, row.AuthorID = object.LocalID, authorID
	row.CreatedAt, row.UpdatedAt = when, when
	if kind == model.FeedEventKind_FEED_EVENT_KIND_POST_CREATED {
		if err := tx.Create(&object).Error; err != nil {
			return err
		}
		return tx.Create(row).Error
	}
	row.EditedAt = &when
	result := tx.WithContext(ctx).Model(&db.SocialPublicPost{}).
		Where("id = ? AND author_id = ? AND deleted_at IS NULL", object.LocalID, authorID).
		Select("type", "text_body", "attachments_json", "mentions_json", "link_preview_json",
			"repost_of_ref", "edited_at", "updated_at").Updates(row)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return domain.ErrFeedInvalid
	}
	return tx.Model(&object).Update("sequence", event.Statement.Sequence).Error
}
