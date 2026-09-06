package application

import (
	"context"
	"errors"
	"fmt"
	"sort"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

type MembershipReader struct {
	authorityUnitOfWork messaging.AuthorityUnitOfWork
	followers           messaging.FollowerRepository
	localStationID      string
}

func NewMembershipReader(
	authorityUnitOfWork messaging.AuthorityUnitOfWork,
	followers messaging.FollowerRepository,
	localStationID string,
) (*MembershipReader, error) {
	if authorityUnitOfWork == nil || followers == nil || localStationID == "" {
		return nil, fmt.Errorf("messaging: membership reader dependencies are invalid")
	}
	return &MembershipReader{
		authorityUnitOfWork: authorityUnitOfWork,
		followers:           followers,
		localStationID:      localStationID,
	}, nil
}

func (r *MembershipReader) RequireActive(
	ctx context.Context,
	conversationID string,
	ptid string,
) (*chat.MessagingConversationView, error) {
	if conversationID == "" || ptid == "" {
		return nil, messaging.ErrMembershipNotActive
	}
	authorityView, authorityFound, err := r.readAuthorityMembership(
		ctx,
		conversationID,
		ptid,
	)
	if err != nil {
		return nil, err
	}
	followerView, followerFound, err := r.readFollowerMembership(
		ctx,
		conversationID,
		ptid,
	)
	if err != nil {
		return nil, err
	}
	if authorityFound && followerFound {
		return nil, messaging.ErrMembershipSourceConflict
	}
	if authorityFound {
		return authorityView, nil
	}
	if followerFound {
		return followerView, nil
	}
	return nil, messaging.ErrMembershipNotActive
}

func (r *MembershipReader) ListActiveForActor(
	ctx context.Context,
	ptid string,
) ([]*chat.MessagingConversationView, error) {
	if ptid == "" {
		return nil, messaging.ErrMembershipNotActive
	}
	var authorityRows []messaging.AuthorityConversationView
	if err := r.authorityUnitOfWork.Execute(
		ctx,
		func(repositories messaging.AuthorityRepositories) error {
			rows, err := repositories.Authority.ListConversationsForActor(ctx, ptid)
			if err != nil {
				return err
			}
			authorityRows = rows
			return nil
		},
	); err != nil {
		return nil, err
	}
	followerRows, err := r.followers.ListActiveConversationsForActor(
		ctx,
		ptid,
		r.localStationID,
	)
	if err != nil {
		return nil, err
	}

	viewsByID := make(map[string]*chat.MessagingConversationView, len(authorityRows)+len(followerRows))
	for _, row := range authorityRows {
		if row.Conversation == nil {
			return nil, messaging.ErrConversationState
		}
		viewsByID[row.Conversation.ConversationID] = conversationView(
			row.Conversation,
			row.MemberPTIDs,
			r.localStationID,
		)
	}
	for _, row := range followerRows {
		if row.Conversation == nil ||
			row.Conversation.AuthorityStationID == r.localStationID {
			return nil, messaging.ErrMembershipSourceConflict
		}
		if _, exists := viewsByID[row.Conversation.ConversationID]; exists {
			return nil, messaging.ErrMembershipSourceConflict
		}
		viewsByID[row.Conversation.ConversationID] = followerConversationView(
			row.Conversation,
			row.MemberPTIDs,
		)
	}

	ids := make([]string, 0, len(viewsByID))
	for conversationID := range viewsByID {
		ids = append(ids, conversationID)
	}
	sort.Strings(ids)
	views := make([]*chat.MessagingConversationView, 0, len(ids))
	for _, conversationID := range ids {
		views = append(views, viewsByID[conversationID])
	}
	return views, nil
}

func (r *MembershipReader) readAuthorityMembership(
	ctx context.Context,
	conversationID string,
	ptid string,
) (*chat.MessagingConversationView, bool, error) {
	var conversation *messaging.AuthorityConversation
	var member *messaging.AuthorityMember
	var members []messaging.AuthorityMember
	found := false
	err := r.authorityUnitOfWork.Execute(
		ctx,
		func(repositories messaging.AuthorityRepositories) error {
			current, err := repositories.Authority.GetConversation(ctx, conversationID)
			if errors.Is(err, messaging.ErrNotFound) {
				return nil
			}
			if err != nil {
				return err
			}
			found = true
			conversation = current
			member, err = repositories.Authority.GetMember(ctx, conversationID, ptid)
			if errors.Is(err, messaging.ErrNotFound) {
				return nil
			}
			if err != nil {
				return err
			}
			members, err = repositories.Authority.ListActiveMembers(ctx, conversationID)
			return err
		},
	)
	if err != nil {
		return nil, false, err
	}
	if !found {
		return nil, false, nil
	}
	if conversation == nil || !conversation.Active || member == nil || !member.Active {
		return nil, true, messaging.ErrMembershipNotActive
	}
	memberPTIDs := make([]string, 0, len(members))
	for _, activeMember := range members {
		if activeMember.Active {
			memberPTIDs = append(memberPTIDs, activeMember.PTID)
		}
	}
	sort.Strings(memberPTIDs)
	return conversationView(conversation, memberPTIDs, r.localStationID), true, nil
}

func (r *MembershipReader) readFollowerMembership(
	ctx context.Context,
	conversationID string,
	ptid string,
) (*chat.MessagingConversationView, bool, error) {
	conversation, err := r.followers.GetConversation(ctx, conversationID)
	if errors.Is(err, messaging.ErrNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	if conversation.AuthorityStationID == r.localStationID {
		return nil, true, messaging.ErrMembershipSourceConflict
	}
	switch conversation.State {
	case messaging.FollowerConversationStateActive:
	case messaging.FollowerConversationStateGapWaitingResync:
		return nil, true, messaging.ErrFollowerGap
	case messaging.FollowerConversationStateForkProtectedReadOnly:
		return nil, true, messaging.ErrFollowerFork
	case messaging.FollowerConversationStateResyncUnavailableReadOnly:
		return nil, true, messaging.ErrFollowerReplayUnavailable
	default:
		return nil, true, messaging.ErrFollowerProjectionConflict
	}
	members, err := r.followers.ListMembers(ctx, conversationID)
	if err != nil {
		return nil, true, err
	}
	memberPTIDs := make([]string, 0, len(members))
	active := false
	for _, member := range members {
		if !member.Active {
			continue
		}
		memberPTIDs = append(memberPTIDs, member.PTID)
		if member.PTID == ptid && member.HomeStationID == r.localStationID {
			active = true
		}
	}
	if !active {
		return nil, true, messaging.ErrMembershipNotActive
	}
	sort.Strings(memberPTIDs)
	return followerConversationView(conversation, memberPTIDs), true, nil
}

func followerConversationView(
	conversation *messaging.FollowerConversation,
	memberPTIDs []string,
) *chat.MessagingConversationView {
	return &chat.MessagingConversationView{
		ConversationId:     conversation.ConversationID,
		Kind:               conversationKind(conversation.Kind),
		Name:               conversation.Name,
		OwnerPtid:          conversation.OwnerPTID,
		MemberPtids:        append([]string(nil), memberPTIDs...),
		MembershipEpoch:    conversation.MembershipEpoch,
		MlsEpoch:           conversation.MlsEpoch,
		Active:             conversation.State == messaging.FollowerConversationStateActive,
		AuthorityStationId: conversation.AuthorityStationID,
	}
}
