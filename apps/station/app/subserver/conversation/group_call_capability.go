package conversation

import (
	"bytes"
	"context"
	"fmt"
	"sort"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

// PrepareSnapshot returns the current active Group recipient authority through
// the Conversation UOW.
func (s *subServer) PrepareSnapshot(
	ctx context.Context,
	rawConversationID string,
	authorPTID string,
) (ports.GroupRecipientSnapshot, error) {
	conversationID, author, err := groupSnapshotIdentity(
		rawConversationID,
		authorPTID,
	)
	if err != nil {
		return ports.GroupRecipientSnapshot{}, err
	}
	unitOfWork, err := s.groupSnapshotUnitOfWork()
	if err != nil {
		return ports.GroupRecipientSnapshot{}, err
	}

	var prepared ports.GroupRecipientSnapshot
	err = unitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		snapshot, loadErr := transaction.Repositories.Authority.Get(
			ctx,
			conversationID,
		)
		if loadErr != nil {
			return loadErr
		}
		prepared, loadErr = groupRecipientSnapshot(snapshot, author)

		return loadErr
	})
	if err != nil {
		return ports.GroupRecipientSnapshot{}, err
	}

	return cloneGroupRecipientSnapshot(prepared), nil
}

// WithSubmitFence verifies an expected Group recipient snapshot while holding
// the canonical Conversation row lock through the supplied commit callback.
func (s *subServer) WithSubmitFence(
	ctx context.Context,
	expected ports.GroupRecipientSnapshot,
	commit func(ports.GroupRecipientSnapshot) error,
) error {
	if commit == nil {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"conversation.group_recipient_snapshot.submit_fence",
			"commit",
			"is required",
		)
	}
	conversationID, author, err := groupSnapshotIdentity(
		expected.ConversationID,
		expected.AuthorPTID,
	)
	if err != nil {
		return err
	}
	if err := validateGroupRecipientSnapshot(expected); err != nil {
		return err
	}
	unitOfWork, err := s.groupSnapshotUnitOfWork()
	if err != nil {
		return err
	}

	return unitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		current, loadErr := transaction.Repositories.Authority.LoadForUpdate(
			ctx,
			conversationID,
		)
		if loadErr != nil {
			return loadErr
		}
		verified, loadErr := groupRecipientSnapshot(current, author)
		if loadErr != nil {
			return loadErr
		}
		if !equalGroupRecipientSnapshots(expected, verified) {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeStaleAuthorityHead,
				"conversation.group_recipient_snapshot.submit_fence",
				"expected_snapshot",
				"does not match the current Group authority",
			)
		}

		return commit(cloneGroupRecipientSnapshot(verified))
	})
}

func (s *subServer) groupSnapshotUnitOfWork() (ports.UnitOfWork, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.composition == nil || s.composition.UnitOfWork == nil {
		return nil, fmt.Errorf(
			"Conversation Group recipient capability is unavailable",
		)
	}

	return s.composition.UnitOfWork, nil
}

func groupSnapshotIdentity(
	rawConversationID string,
	rawAuthorPTID string,
) (valueobject.ConversationID, valueobject.PTID, error) {
	conversationID, err := valueobject.NewConversationID(rawConversationID)
	if err != nil || string(conversationID) != rawConversationID {
		return "", "", conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"conversation.group_recipient_snapshot.identity",
			"conversation_id",
			"must be canonical",
		)
	}
	author, err := valueobject.NewPTID(rawAuthorPTID)
	if err != nil || string(author) != rawAuthorPTID {
		return "", "", conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"conversation.group_recipient_snapshot.identity",
			"author_ptid",
			"must be canonical",
		)
	}

	return conversationID, author, nil
}

func groupRecipientSnapshot(
	snapshot aggregate.Snapshot,
	author valueobject.PTID,
) (ports.GroupRecipientSnapshot, error) {
	if snapshot.Kind != valueobject.ConversationKindGroup ||
		snapshot.Status != valueobject.ConversationStatusActive {
		return ports.GroupRecipientSnapshot{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeNotFound,
			"conversation.group_recipient_snapshot.prepare",
			"conversation",
			"is not an active Group",
		)
	}
	if snapshot.Head.MembershipEpoch == 0 || snapshot.Head.EventHash.IsZero() {
		return ports.GroupRecipientSnapshot{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeStaleAuthorityHead,
			"conversation.group_recipient_snapshot.prepare",
			"authority_head",
			"is incomplete",
		)
	}

	members := make(
		[]ports.GroupRecipientMember,
		0,
		len(snapshot.Members),
	)
	authorActive := false
	for _, member := range snapshot.Members {
		if !member.Active() {
			continue
		}
		if member.Actor == author {
			authorActive = true
		}
		members = append(members, ports.GroupRecipientMember{
			ActorPTID:         string(member.Actor),
			HomeStationPeerID: string(member.HomeStation),
		})
	}
	if !authorActive {
		return ports.GroupRecipientSnapshot{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"conversation.group_recipient_snapshot.prepare",
			"author_ptid",
			"is not an active Group member",
		)
	}
	sort.Slice(members, func(left int, right int) bool {
		return members[left].ActorPTID < members[right].ActorPTID
	})

	result := ports.GroupRecipientSnapshot{
		FederationID:        string(snapshot.FederationID),
		ConversationID:      string(snapshot.ID),
		AuthorPTID:          string(author),
		MembershipEpoch:     uint64(snapshot.Head.MembershipEpoch),
		AuthorityHeadSHA256: snapshot.Head.EventHash.Bytes(),
		Members:             members,
	}
	if err := validateGroupRecipientSnapshot(result); err != nil {
		return ports.GroupRecipientSnapshot{}, err
	}

	return result, nil
}

func validateGroupRecipientSnapshot(snapshot ports.GroupRecipientSnapshot) error {
	federationID, err := valueobject.NewFederationID(snapshot.FederationID)
	if err != nil || string(federationID) != snapshot.FederationID {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"conversation.group_recipient_snapshot.validate",
			"federation_id",
			"must be canonical",
		)
	}
	if snapshot.ConversationID == "" ||
		snapshot.AuthorPTID == "" ||
		snapshot.MembershipEpoch == 0 ||
		len(snapshot.AuthorityHeadSHA256) != 32 ||
		len(snapshot.Members) == 0 {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"conversation.group_recipient_snapshot.validate",
			"snapshot",
			"is incomplete",
		)
	}
	previous := ""
	authorFound := false
	for _, member := range snapshot.Members {
		if member.ActorPTID == "" ||
			member.HomeStationPeerID == "" ||
			member.ActorPTID <= previous {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeInvalidArgument,
				"conversation.group_recipient_snapshot.validate",
				"members",
				"must be canonical, unique, and ordered",
			)
		}
		if member.ActorPTID == snapshot.AuthorPTID {
			authorFound = true
		}
		previous = member.ActorPTID
	}
	if !authorFound {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"conversation.group_recipient_snapshot.validate",
			"author_ptid",
			"is not an active Group member",
		)
	}

	return nil
}

func equalGroupRecipientSnapshots(
	left ports.GroupRecipientSnapshot,
	right ports.GroupRecipientSnapshot,
) bool {
	if left.FederationID != right.FederationID ||
		left.ConversationID != right.ConversationID ||
		left.AuthorPTID != right.AuthorPTID ||
		left.MembershipEpoch != right.MembershipEpoch ||
		!bytes.Equal(left.AuthorityHeadSHA256, right.AuthorityHeadSHA256) ||
		len(left.Members) != len(right.Members) {
		return false
	}
	for index := range left.Members {
		if left.Members[index] != right.Members[index] {
			return false
		}
	}

	return true
}

func cloneGroupRecipientSnapshot(
	snapshot ports.GroupRecipientSnapshot,
) ports.GroupRecipientSnapshot {
	snapshot.AuthorityHeadSHA256 = append(
		[]byte(nil),
		snapshot.AuthorityHeadSHA256...,
	)
	snapshot.Members = append(
		[]ports.GroupRecipientMember(nil),
		snapshot.Members...,
	)

	return snapshot
}

// ResolveGroupCallAuthority returns the canonical Conversation routing scope
// only when actorPTID is an active member of an active Group conversation.
func (s *subServer) ResolveGroupCallAuthority(
	ctx context.Context,
	rawConversationID string,
	actorPTID string,
) (
	authorityStationPeerID string,
	federationID string,
	authorityEpoch uint64,
	memberHomeStationPeerID string,
	activeMember bool,
	err error,
) {
	conversationID, err := valueobject.NewConversationID(rawConversationID)
	if err != nil {
		return "", "", 0, "", false, err
	}
	actor, err := valueobject.NewPTID(actorPTID)
	if err != nil {
		return "", "", 0, "", false, err
	}
	view, err := s.composition.QueryService.Get(ctx, conversationID, actor)
	if err != nil {
		if conversationdomain.IsCode(err, conversationdomain.ErrorCodeNotFound) ||
			conversationdomain.IsCode(err, conversationdomain.ErrorCodeUnauthorized) {
			return "", "", 0, "", false, nil
		}
		return "", "", 0, "", false, err
	}
	snapshot := view.Conversation
	if snapshot.Kind != valueobject.ConversationKindGroup ||
		snapshot.Status != valueobject.ConversationStatusActive {
		return "", "", 0, "", false, nil
	}
	var memberHomeStation valueobject.StationID
	for _, member := range snapshot.Members {
		if member.Actor == actor && member.Active() {
			memberHomeStation = member.HomeStation
			break
		}
	}
	if memberHomeStation == "" {
		return "", "", 0, "", false, nil
	}

	return string(snapshot.AuthorityStation),
		string(snapshot.FederationID),
		uint64(snapshot.AuthorityEpoch),
		string(memberHomeStation),
		true,
		nil
}
