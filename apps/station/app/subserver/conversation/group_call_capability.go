package conversation

import (
	"context"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

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
