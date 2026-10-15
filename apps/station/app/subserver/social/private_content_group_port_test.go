package social

import (
	"reflect"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
)

func TestGroupRecipientSnapshotPortMappingRoundTrip(t *testing.T) {
	conversationSnapshot := ports.GroupRecipientSnapshot{
		FederationID:        "federation-group-port",
		ConversationID:      "conversation-group-port",
		AuthorPTID:          "ptid:alice",
		MembershipEpoch:     7,
		AuthorityHeadSHA256: []byte("01234567890123456789012345678901"),
		Members: []ports.GroupRecipientMember{
			{
				ActorPTID:         "ptid:alice",
				HomeStationPeerID: "station-a",
			},
			{
				ActorPTID:         "ptid:bob",
				HomeStationPeerID: "station-b",
			},
		},
	}

	socialSnapshot := socialGroupRecipientSnapshot(conversationSnapshot)
	if socialSnapshot.FederationID != conversationSnapshot.FederationID {
		t.Fatalf(
			"Social Federation ID = %q, want %q",
			socialSnapshot.FederationID,
			conversationSnapshot.FederationID,
		)
	}
	roundTrip := conversationGroupRecipientSnapshot(socialSnapshot)
	if !reflect.DeepEqual(roundTrip, conversationSnapshot) {
		t.Fatalf(
			"Conversation Group snapshot round trip = %+v, want %+v",
			roundTrip,
			conversationSnapshot,
		)
	}
}
