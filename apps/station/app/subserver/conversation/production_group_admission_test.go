package conversation

import (
	"testing"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

func TestValidateBoundMembershipAdmissionRequiresPlannedInvitee(t *testing.T) {
	headHash := valueobject.HashBytes([]byte("authority-head"))
	conversation := aggregate.Snapshot{
		ID:               "conversation-1",
		FederationID:     "federation-1",
		AuthorityStation: "station-authority",
		AuthorityEpoch:   7,
		Head: valueobject.AuthorityHead{
			Sequence:        11,
			EventHash:       headHash,
			MembershipEpoch: 3,
			MLSEpoch:        3,
		},
	}
	requester := valueobject.Endpoint{
		Actor:  "ptid:alice",
		Device: "alice-device",
	}
	fulfillment := &chatmodel.GroupAdmissionFulfillment{
		GrantId:                  "grant-1",
		InvitationId:             "invitation-1",
		InviteePtid:              "ptid:bob",
		InviteeHomeStationPeerId: "station-bob",
	}
	grant := &chatmodel.GroupAdmissionGrant{
		GrantId:                  fulfillment.GetGrantId(),
		InvitationId:             fulfillment.GetInvitationId(),
		ConversationId:           string(conversation.ID),
		FederationId:             string(conversation.FederationID),
		AuthorityStationPeerId:   string(conversation.AuthorityStation),
		AuthorityEpoch:           int64(conversation.AuthorityEpoch),
		InviterPtid:              string(requester.Actor),
		InviterDeviceId:          string(requester.Device),
		InviteePtid:              "ptid:bob",
		InviteeHomeStationPeerId: fulfillment.GetInviteeHomeStationPeerId(),
		State:                    chatmodel.GroupAdmissionGrantState_GROUP_ADMISSION_GRANT_STATE_BOUND_TO_PLAN,
		AuthoritySequence:        int64(conversation.Head.Sequence),
		AuthorityHash:            conversation.Head.EventHash.Bytes(),
		BoundAuthorityPlanId:     "plan-1",
	}
	plan := entity.AuthorityPlan{
		ID:             "plan-1",
		ConversationID: conversation.ID,
		FederationID:   conversation.FederationID,
		AuthorityEpoch: conversation.AuthorityEpoch,
		Requester:      requester,
		AuthorityHead:  conversation.Head,
		Changes: []entity.MembershipChange{
			{
				Action:      entity.MembershipActionAddActor,
				Actor:       "ptid:bob",
				HomeStation: "station-bob",
				Role:        valueobject.MemberRoleMember,
			},
		},
	}

	if err := validateBoundMembershipAdmission(
		conversation,
		requester,
		"station-bob",
		fulfillment,
		grant,
		plan,
	); err != nil {
		t.Fatalf("matching admission binding: %v", err)
	}

	plan.Changes[0].Actor = "ptid:carol"
	err := validateBoundMembershipAdmission(
		conversation,
		requester,
		"station-bob",
		fulfillment,
		grant,
		plan,
	)
	if !conversationdomain.IsCode(
		err,
		conversationdomain.ErrorCodeProposalBinding,
	) {
		t.Fatalf("mismatched planned invitee error = %v", err)
	}
}

func TestGroupAdmissionRequestIDIncludesAuthorityPlan(t *testing.T) {
	request := &chatmodel.GroupAdmissionEvaluationRequest{
		ConversationId:         "conversation-1",
		FederationId:           "federation-1",
		AuthorityStationPeerId: "station-authority",
		AuthorityEpoch:         1,
		AuthorityPlanId:        "plan-1",
		Inviter: &actormodel.ActorDeviceRef{
			Actor:    &actormodel.ActorRef{Ptid: "ptid:alice"},
			DeviceId: "alice-device",
		},
		Invitee:                 &actormodel.ActorRef{Ptid: "ptid:bob"},
		ObservedMembershipEpoch: 3,
		ObservedMlsEpoch:        3,
		AuthoritySequence:       4,
		AuthorityHash:           make([]byte, 32),
	}
	requester := valueobject.Endpoint{
		Actor:  "ptid:alice",
		Device: "alice-device",
	}
	first := groupAdmissionRequestID(request, requester)
	request.AuthorityPlanId = "plan-2"
	second := groupAdmissionRequestID(request, requester)
	if first == second {
		t.Fatal("distinct authority plans produced the same admission request ID")
	}
}

func TestGroupAdmissionTransitionCompletionsCoverGenesisMembers(t *testing.T) {
	transition := &chatmodel.MembershipTransitionIntent{
		AuthorityPlanId: "plan-1",
		GenesisAdmissionFulfillments: []*chatmodel.GroupAdmissionFulfillment{
			{
				GrantId:                  "grant-bob",
				InviteePtid:              "ptid:bob",
				InviteeHomeStationPeerId: "station-bob",
			},
			{
				GrantId:                  "grant:carol",
				InviteePtid:              "ptid:carol",
				InviteeHomeStationPeerId: "station-carol",
			},
		},
	}
	event := &chatmodel.ConversationEvent{
		ConversationId:         "conversation-1",
		AuthorityStationPeerId: "station-authority",
		Payload: &chatmodel.ConversationEvent_MembershipTransitionCommitted{
			MembershipTransitionCommitted: &chatmodel.MembershipTransitionCommittedFact{
				TransitionId: "transition-1",
				Changes: []*chatmodel.MessagingMembershipChangeCommitted{
					{
						Action: chatmodel.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_ACTOR,
						Ptid:   "ptid:alice",
					},
					{
						Action:            chatmodel.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_ACTOR,
						Ptid:              "ptid:bob",
						HomeStationPeerId: "station-bob",
					},
					{
						Action:            chatmodel.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_ACTOR,
						Ptid:              "ptid:carol",
						HomeStationPeerId: "station-carol",
					},
				},
				PostState: &chatmodel.ConversationAuthoritySnapshot{
					FederationId:   "federation-1",
					AuthorityEpoch: 1,
				},
			},
		},
	}

	completions, err := groupAdmissionTransitionCompletions(transition, event)
	if err != nil {
		t.Fatal(err)
	}
	if len(completions) != 2 ||
		completions[0].GetActorPtid() != "ptid:bob" ||
		completions[1].GetActorPtid() != "ptid:carol" {
		t.Fatalf("genesis admission completions = %+v", completions)
	}
}
