package application

import (
	"context"
	"errors"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

// ReadForViewer performs one bounded, authenticated foreground PUBLIC refresh.
// Follow subscriptions schedule automatic replication only; a point read
// never changes a follow edge or acquires an automatic subscription.
func (s *FeedLogService) ReadForViewer(ctx context.Context, viewer string,
	request *model.ReadFeedRequest) (*model.ReadFeedResponse, error) {
	if viewer == "" || request == nil || request.ActorPtid == "" ||
		request.ChainId != domain.PublicFeedChainID || request.Limit > 64 {
		return nil, domain.ErrFeedInvalid
	}
	viewerHome, err := s.actors.ResolveActorHomeStationPeerID(ctx, viewer)
	if err != nil {
		return nil, err
	}
	if viewerHome != s.localStation {
		return nil, domain.ErrFeedWriter
	}
	if err := s.authorizeFeedReader(ctx, viewer, request.ActorPtid); err != nil {
		return nil, err
	}
	home, err := s.actors.ResolveActorHomeStationPeerID(ctx, request.ActorPtid)
	if err != nil {
		return nil, err
	}
	var pulled *model.ReadFeedResponse
	if home != s.localStation {
		sequence, err := s.store.LocalSequence(ctx, request.ActorPtid)
		if err != nil {
			return nil, err
		}
		var cursor uint64
		if err := s.store.Transaction(ctx, func(tx *gorm.DB) error {
			var head infrastructure.FeedThreadHead
			err := tx.Where("author_ptid = ?", request.ActorPtid).Take(&head).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			cursor = head.Cursor
			return err
		}); err != nil {
			return nil, err
		}
		if s.pull == nil {
			return nil, domain.ErrFeedInvalid
		}
		pullContext, cancel := context.WithTimeout(ctx, 5*time.Second)
		pulled, err = s.pull(pullContext, home, viewer, &model.ReadFeedRequest{
			ActorPtid: request.ActorPtid, ChainId: domain.PublicFeedChainID,
			AfterSequence: sequence, Limit: 32, IncludeThread: true,
			AfterThreadCursor: cursor, ExplicitPublicRead: true,
		})
		cancel()
		if err != nil {
			return nil, err
		}
		if pulled == nil || pulled.Bundle == nil || pulled.Head == nil ||
			pulled.Head.ActorPtid != request.ActorPtid ||
			pulled.Head.ChainId != domain.PublicFeedChainID ||
			pulled.Head.Sequence < sequence || len(pulled.Head.EventHash) != 32 ||
			len(pulled.Bundle.Events) > 32 || len(pulled.ThreadEntries) > 32 ||
			proto.Size(pulled) > signedlog.MaxMessageBytes {
			return nil, domain.ErrFeedInvalid
		}
		if len(pulled.Bundle.Events) > 0 {
			if err := s.Import(ctx, request.ActorPtid, home, pulled.Bundle); err != nil {
				return nil, err
			}
		}
		if err := s.verifyPulledHead(ctx, request.ActorPtid, pulled); err != nil {
			return nil, err
		}
		if err := s.importThread(ctx, request.ActorPtid, home, cursor, pulled, nil); err != nil {
			return nil, err
		}
	}
	// Block/moderation can change during the remote leg. It must also hold
	// at exposure; offline errors cannot be downgraded to stale success.
	response, err := s.read(ctx, request, viewer)
	if err == nil && pulled != nil {
		// Native retains only the independently verified page prefix. Keep
		// the source's advertised tail distinct: has_more cannot be true
		// while head claims that the imported page is already the final tail.
		if pulled.Head.Sequence > response.Head.Sequence {
			response.Head = proto.Clone(pulled.Head).(*model.FeedHead)
		}
		response.HasMore = response.HasMore || pulled.HasMore
		response.ThreadHasMore = response.ThreadHasMore || pulled.ThreadHasMore
	}
	return response, err
}

func (s *FeedLogService) authorizeFeedReader(ctx context.Context, viewer, author string) error {
	return s.store.Execute(ctx, func(tx delivery.Transaction) error {
		return NewPublicReadPort(infrastructure.NewRepos(tx.DB())).
			AuthorizeFeed(ctx, viewer, author)
	})
}
