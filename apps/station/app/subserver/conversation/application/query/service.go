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

// ConversationRoute identifies the canonical authority/follower route without
// exposing member or device projections.
type ConversationRoute struct {
	ConversationID   valueobject.ConversationID
	Source           Source
	FederationID     valueobject.FederationID
	AuthorityStation valueobject.StationID
	AuthorityEpoch   valueobject.AuthorityEpoch
	FollowerStatus   repository.FollowerStatus
}

type MessagePage struct {
	Events  []domainevent.Record
	HasMore bool
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

// ResolveRoute returns only the canonical authority/follower route. Callers
// must authorize their operation against immutable operation-specific truth.
func (s *Service) ResolveRoute(
	ctx context.Context,
	conversationID valueobject.ConversationID,
) (ConversationRoute, error) {
	var route ConversationRoute
	err := s.unitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		view, err := loadConversationView(ctx, transaction.Repositories, conversationID)
		if err != nil {
			return err
		}
		route = ConversationRoute{
			ConversationID:   view.Conversation.ID,
			Source:           view.Source,
			FederationID:     view.Conversation.FederationID,
			AuthorityStation: view.Conversation.AuthorityStation,
			AuthorityEpoch:   view.Conversation.AuthorityEpoch,
			FollowerStatus:   view.FollowerStatus,
		}
		return nil
	})
	return route, err
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

func (s *Service) ListMessages(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	actor valueobject.PTID,
	after valueobject.Sequence,
	limit int,
) (MessagePage, error) {
	if err := validatePageLimit("application.query_list_messages", limit); err != nil {
		return MessagePage{}, err
	}
	var events []domainevent.Record
	err := s.unitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		if err := authorizeConversationRead(
			ctx,
			transaction.Repositories,
			conversationID,
			actor,
			"application.query_list_messages",
		); err != nil {
			return err
		}
		var err error
		events, err = transaction.Repositories.Events.ListMessages(
			ctx,
			conversationID,
			after,
			limit+1,
		)
		return err
	})
	if err != nil {
		return MessagePage{}, err
	}
	return newMessagePage(events, limit), nil
}

func (s *Service) ListThreadMessages(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	actor valueobject.PTID,
	threadRootID valueobject.MessageID,
	after valueobject.Sequence,
	limit int,
) (MessagePage, error) {
	if threadRootID == "" {
		return MessagePage{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"application.query_list_thread_messages",
			"thread_root_message_id",
			"is required",
		)
	}
	if err := validatePageLimit("application.query_list_thread_messages", limit); err != nil {
		return MessagePage{}, err
	}
	var events []domainevent.Record
	err := s.unitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		if err := authorizeConversationRead(
			ctx,
			transaction.Repositories,
			conversationID,
			actor,
			"application.query_list_thread_messages",
		); err != nil {
			return err
		}
		var err error
		events, err = transaction.Repositories.Events.ListThreadMessages(
			ctx,
			conversationID,
			threadRootID,
			after,
			limit+1,
		)
		return err
	})
	if err != nil {
		return MessagePage{}, err
	}
	return newMessagePage(events, limit), nil
}

func (s *Service) ThreadCounts(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	actor valueobject.PTID,
	rootIDs []valueobject.MessageID,
) ([]repository.ThreadCount, error) {
	normalizedRoots, err := normalizeThreadRoots(rootIDs)
	if err != nil {
		return nil, err
	}
	var counts []repository.ThreadCount
	err = s.unitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		if err := authorizeConversationRead(
			ctx,
			transaction.Repositories,
			conversationID,
			actor,
			"application.query_thread_counts",
		); err != nil {
			return err
		}
		var err error
		counts, err = transaction.Repositories.Events.ThreadCounts(
			ctx,
			conversationID,
			normalizedRoots,
		)
		return err
	})
	return counts, err
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

func (s *Service) PendingLeaveIntents(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	actor valueobject.PTID,
	limit int,
) ([]repository.LeaveIntent, error) {
	if limit <= 0 || limit > 100 {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"application.query_pending_leave_intents",
			"limit",
			"must be between 1 and 100",
		)
	}
	var intents []repository.LeaveIntent
	err := s.unitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		if err := authorizeConversationRead(
			ctx,
			transaction.Repositories,
			conversationID,
			actor,
			"application.query_pending_leave_intents",
		); err != nil {
			return err
		}
		var err error
		intents, err = transaction.Repositories.LeaveIntents.ListPending(
			ctx,
			conversationID,
			actor,
			limit,
		)
		return err
	})

	return intents, err
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

func newMessagePage(events []domainevent.Record, limit int) MessagePage {
	page := MessagePage{Events: events}
	if len(page.Events) > limit {
		page.Events = page.Events[:limit]
		page.HasMore = true
	}
	return page
}

func authorizeConversationRead(
	ctx context.Context,
	repositories repository.Repositories,
	conversationID valueobject.ConversationID,
	actor valueobject.PTID,
	operation string,
) error {
	view, err := loadConversationView(ctx, repositories, conversationID)
	if err != nil {
		return err
	}
	if !snapshotHasActiveMember(view.Conversation, actor) {
		return unauthorized(operation)
	}
	return nil
}

func validatePageLimit(operation string, limit int) error {
	if limit > 0 && limit <= 500 {
		return nil
	}
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeInvalidArgument,
		operation,
		"limit",
		"must be between 1 and 500",
	)
}

func normalizeThreadRoots(
	rootIDs []valueobject.MessageID,
) ([]valueobject.MessageID, error) {
	if len(rootIDs) > 500 {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"application.query_thread_counts",
			"root_ids",
			"must contain at most 500 entries",
		)
	}
	unique := make(map[valueobject.MessageID]struct{}, len(rootIDs))
	for _, rootID := range rootIDs {
		if rootID == "" {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeInvalidArgument,
				"application.query_thread_counts",
				"root_ids",
				"cannot contain an empty message identity",
			)
		}
		unique[rootID] = struct{}{}
	}
	normalized := make([]valueobject.MessageID, 0, len(unique))
	for rootID := range unique {
		normalized = append(normalized, rootID)
	}
	sort.Slice(normalized, func(i int, j int) bool {
		return normalized[i] < normalized[j]
	})
	return normalized, nil
}

func unauthorized(operation string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeUnauthorized,
		operation,
		"actor",
		"is not an active conversation member",
	)
}
