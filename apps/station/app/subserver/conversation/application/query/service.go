package query

import (
	"context"
	"sort"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

type Source string

const (
	SourceAuthority Source = "authority"
	SourceFollower  Source = "follower"
)

type ConversationView struct {
	Conversation   aggregate.Snapshot
	Source         Source
	FollowerStatus repository.FollowerStatus
}

type PublicHead struct {
	ConversationID   valueobject.ConversationID
	Source           Source
	FederationID     valueobject.FederationID
	AuthorityStation valueobject.StationID
	AuthorityEpoch   valueobject.AuthorityEpoch
	Head             valueobject.AuthorityHead
	Status           valueobject.ConversationStatus
	FollowerStatus   repository.FollowerStatus
}

type Service struct {
	unitOfWork ports.UnitOfWork
}

func NewService(unitOfWork ports.UnitOfWork) (*Service, error) {
	if unitOfWork == nil {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"application.new_query_service",
			"unit_of_work",
			"is required",
		)
	}
	return &Service{unitOfWork: unitOfWork}, nil
}

func (s *Service) Get(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	actor valueobject.PTID,
) (ConversationView, error) {
	var view ConversationView
	err := s.unitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		var err error
		view, err = loadConversationView(ctx, transaction.Repositories, conversationID)
		if err != nil {
			return err
		}
		if !snapshotHasActiveMember(view.Conversation, actor) {
			return unauthorized("application.query_get")
		}
		return nil
	})
	return view, err
}

func (s *Service) List(
	ctx context.Context,
	actor valueobject.PTID,
) ([]ConversationView, error) {
	var views []ConversationView
	err := s.unitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		authority, err := transaction.Repositories.Authority.ListByActor(ctx, actor)
		if err != nil {
			return err
		}
		followers, err := transaction.Repositories.Followers.ListByActor(ctx, actor)
		if err != nil {
			return err
		}
		byID := make(map[valueobject.ConversationID]ConversationView, len(authority)+len(followers))
		for _, snapshot := range authority {
			byID[snapshot.ID] = ConversationView{Conversation: snapshot, Source: SourceAuthority}
		}
		for _, follower := range followers {
			if _, duplicate := byID[follower.Conversation.ID]; duplicate {
				return conversationdomain.NewError(
					conversationdomain.ErrorCodeCommandConflict,
					"application.query_list",
					"conversation_id",
					"appears as both authority and follower projection",
				)
			}
			byID[follower.Conversation.ID] = ConversationView{
				Conversation:   follower.Conversation,
				Source:         SourceFollower,
				FollowerStatus: follower.Status,
			}
		}
		views = make([]ConversationView, 0, len(byID))
		for _, view := range byID {
			views = append(views, view)
		}
		sort.Slice(views, func(i int, j int) bool {
			if views[i].Conversation.UpdatedAt.Equal(views[j].Conversation.UpdatedAt) {
				return views[i].Conversation.ID < views[j].Conversation.ID
			}
			return views[i].Conversation.UpdatedAt.After(views[j].Conversation.UpdatedAt)
		})
		return nil
	})
	return views, err
}

func (s *Service) Members(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	actor valueobject.PTID,
) ([]entity.Member, error) {
	view, err := s.Get(ctx, conversationID, actor)
	if err != nil {
		return nil, err
	}
	members := append([]entity.Member(nil), view.Conversation.Members...)
	sort.Slice(members, func(i int, j int) bool {
		return members[i].Actor < members[j].Actor
	})
	return members, nil
}

func (s *Service) Events(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	actor valueobject.PTID,
	after valueobject.Sequence,
	limit int,
) ([]domainevent.Record, error) {
	if limit <= 0 || limit > 500 {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"application.query_events",
			"limit",
			"must be between 1 and 500",
		)
	}
	var events []domainevent.Record
	err := s.unitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		view, err := loadConversationView(ctx, transaction.Repositories, conversationID)
		if err != nil {
			return err
		}
		if !snapshotHasActiveMember(view.Conversation, actor) {
			return unauthorized("application.query_events")
		}
		events, err = transaction.Repositories.Events.List(ctx, conversationID, after, limit)
		return err
	})
	return events, err
}

func (s *Service) PublicHead(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	actor valueobject.PTID,
) (PublicHead, error) {
	view, err := s.Get(ctx, conversationID, actor)
	if err != nil {
		return PublicHead{}, err
	}
	return PublicHead{
		ConversationID:   conversationID,
		Source:           view.Source,
		FederationID:     view.Conversation.FederationID,
		AuthorityStation: view.Conversation.AuthorityStation,
		AuthorityEpoch:   view.Conversation.AuthorityEpoch,
		Head:             view.Conversation.Head,
		Status:           view.Conversation.Status,
		FollowerStatus:   view.FollowerStatus,
	}, nil
}

func (s *Service) MemberSettings(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	actor valueobject.PTID,
) (repository.MemberSettings, error) {
	var settings repository.MemberSettings
	err := s.unitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		snapshot, err := transaction.Repositories.Authority.Get(ctx, conversationID)
		if err != nil {
			return err
		}
		if !snapshotHasActiveMember(snapshot, actor) {
			return unauthorized("application.query_member_settings")
		}
		settings, err = transaction.Repositories.MemberSettings.Get(ctx, conversationID, actor)
		return err
	})
	return settings, err
}

func (s *Service) ReadCursor(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	actor valueobject.PTID,
) (repository.ReadCursor, error) {
	var cursor repository.ReadCursor
	err := s.unitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		snapshot, err := transaction.Repositories.Authority.Get(ctx, conversationID)
		if err != nil {
			return err
		}
		if !snapshotHasActiveMember(snapshot, actor) {
			return unauthorized("application.query_read_cursor")
		}
		cursor, err = transaction.Repositories.ReadCursors.Get(ctx, conversationID, actor)
		return err
	})
	return cursor, err
}

func loadConversationView(
	ctx context.Context,
	repositories repository.Repositories,
	conversationID valueobject.ConversationID,
) (ConversationView, error) {
	authority, authorityErr := repositories.Authority.Get(ctx, conversationID)
	follower, followerErr := repositories.Followers.Get(ctx, conversationID)
	if authorityErr == nil && followerErr == nil {
		return ConversationView{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeCommandConflict,
			"application.query_conversation",
			"conversation_id",
			"appears as both authority and follower projection",
		)
	}
	if authorityErr != nil &&
		!conversationdomain.IsCode(authorityErr, conversationdomain.ErrorCodeNotFound) {
		return ConversationView{}, authorityErr
	}
	if followerErr != nil &&
		!conversationdomain.IsCode(followerErr, conversationdomain.ErrorCodeNotFound) {
		return ConversationView{}, followerErr
	}
	if authorityErr == nil {
		return ConversationView{Conversation: authority, Source: SourceAuthority}, nil
	}
	if followerErr != nil {
		return ConversationView{}, followerErr
	}
	return ConversationView{
		Conversation:   follower.Conversation,
		Source:         SourceFollower,
		FollowerStatus: follower.Status,
	}, nil
}

func snapshotHasActiveMember(snapshot aggregate.Snapshot, actor valueobject.PTID) bool {
	for _, member := range snapshot.Members {
		if member.Actor == actor && member.Active() {
			return true
		}
	}
	return false
}

func unauthorized(operation string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeUnauthorized,
		operation,
		"actor",
		"is not an active conversation member",
	)
}
