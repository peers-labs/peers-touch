package http_test

import (
	"bytes"
	"reflect"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	conversationhttp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/interface/http"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestMapMemberAuthorityCommandBindsAuthorityAndExactIdentity(t *testing.T) {
	now := time.Date(2026, time.September, 18, 10, 0, 0, 0, time.UTC)
	operator := valueobject.Endpoint{Actor: "ptid:owner", Device: "owner-1"}
	target := valueobject.PTID("ptid:member")
	eventHash := valueobject.HashBytes([]byte("member-authority-head"))
	preparation := aggregate.CommandPreparation{
		Kind:             valueobject.ConversationKindGroup,
		AuthorityStation: "station-a",
		Head: valueobject.AuthorityHead{
			Sequence:        9,
			EventHash:       eventHash,
			MembershipEpoch: 5,
			MLSEpoch:        3,
		},
		RequiredEndpoints: []valueobject.Endpoint{
			operator,
			{Actor: target, Device: "member-1"},
		},
		DeliveryPlanHash: valueobject.HashBytes([]byte("member-authority-delivery-plan")),
	}
	role := chat.MemberRole_MEMBER_ROLE_ADMIN
	muted := true
	mutedUntil := now.Add(time.Hour)
	wire := &chat.ConversationMemberAuthorityCommand{
		Version:                 1,
		CommandId:               "member-authority-1",
		ConversationId:          "conversation-1",
		Operator:                endpointProto(operator),
		TargetPtid:              string(target),
		Action:                  chat.ConversationMemberAuthorityAction_CONVERSATION_MEMBER_AUTHORITY_ACTION_UPDATE_MEMBER,
		Role:                    &role,
		Muted:                   &muted,
		MutedUntil:              timestamppb.New(mutedUntil),
		FederationId:            "federation-1",
		AuthorityStationPeerId:  "station-a",
		AuthorityEpoch:          4,
		AuthoritySequence:       9,
		AuthorityHash:           eventHash.Bytes(),
		ObservedMembershipEpoch: 5,
		ObservedMlsEpoch:        3,
		ClientTimestamp:         timestamppb.New(now),
		Deadline:                timestamppb.New(now.Add(5 * time.Minute)),
	}
	mapped, err := conversationhttp.MapMemberAuthorityCommand(
		conversationhttp.AuthenticatedActor{
			PTID:     string(operator.Actor),
			DeviceID: string(operator.Device),
		},
		wire,
		preparation,
		now,
	)
	if err != nil {
		t.Fatal(err)
	}
	if mapped.MemberAuthority == nil ||
		mapped.Command.Sender != operator ||
		mapped.MemberAuthority.Target != target ||
		mapped.MemberAuthority.Action != domainevent.MemberAuthorityActionUpdateMember ||
		mapped.MemberAuthority.Role == nil ||
		*mapped.MemberAuthority.Role != valueobject.MemberRoleAdmin ||
		mapped.MemberAuthority.Muted == nil ||
		!*mapped.MemberAuthority.Muted ||
		mapped.MemberAuthority.MutedUntil == nil ||
		!mapped.MemberAuthority.MutedUntil.Equal(mutedUntil) ||
		mapped.MemberAuthority.ObservedAuthorityHead != preparation.Head ||
		mapped.MemberAuthority.ObservedFederationID != "federation-1" ||
		mapped.MemberAuthority.ObservedAuthorityEpoch != 4 ||
		len(mapped.Command.Deliveries) != len(preparation.RequiredEndpoints) {
		t.Fatalf("mapped member authority command = %+v", mapped)
	}
	exactBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(wire)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(mapped.ExactCommandBytes, exactBytes) ||
		!bytes.Equal(mapped.Command.Payload, exactBytes) {
		t.Fatal("member authority exact command identity was not retained")
	}
	for _, delivery := range mapped.Command.Deliveries {
		if delivery.Kind != valueobject.DeliveryKindPublicEvent {
			t.Fatalf("member authority delivery = %+v", delivery)
		}
	}

	tests := []struct {
		name   string
		code   conversationdomain.ErrorCode
		mutate func(*chat.ConversationMemberAuthorityCommand)
		auth   conversationhttp.AuthenticatedActor
	}{
		{
			name: "authenticated operator mismatch",
			code: conversationdomain.ErrorCodeUnauthorized,
			auth: conversationhttp.AuthenticatedActor{
				PTID:     "ptid:other",
				DeviceID: "other-1",
			},
		},
		{
			name: "stale authority sequence",
			code: conversationdomain.ErrorCodeStaleAuthorityHead,
			mutate: func(command *chat.ConversationMemberAuthorityCommand) {
				command.AuthoritySequence--
			},
		},
		{
			name: "expired command deadline",
			code: conversationdomain.ErrorCodeCommandExpired,
			mutate: func(command *chat.ConversationMemberAuthorityCommand) {
				command.Deadline = timestamppb.New(now)
			},
		},
		{
			name: "mute deadline without mute patch",
			code: conversationdomain.ErrorCodeInvalidArgument,
			mutate: func(command *chat.ConversationMemberAuthorityCommand) {
				command.Muted = nil
			},
		},
	}
	defaultAuth := conversationhttp.AuthenticatedActor{
		PTID:     string(operator.Actor),
		DeviceID: string(operator.Device),
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			command := proto.Clone(wire).(*chat.ConversationMemberAuthorityCommand)
			if test.mutate != nil {
				test.mutate(command)
			}
			auth := test.auth
			if reflect.DeepEqual(auth, conversationhttp.AuthenticatedActor{}) {
				auth = defaultAuth
			}
			_, err := conversationhttp.MapMemberAuthorityCommand(
				auth,
				command,
				preparation,
				now,
			)
			if !conversationdomain.IsCode(err, test.code) {
				t.Fatalf("MapMemberAuthorityCommand() error = %v, want %s", err, test.code)
			}
		})
	}
}

func TestMapSubmitCommandBindsAuthenticatedEndpointAndDeliverySet(t *testing.T) {
	now := time.Date(2026, time.September, 6, 13, 0, 0, 0, time.UTC)
	alice := valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"}
	bob := valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"}
	planHash := valueobject.HashBytes([]byte("delivery-plan"))
	bobPayload := []byte("bob-ciphertext")
	bobHash := valueobject.HashBytes(bobPayload)
	wire := &chat.ChatCommand{
		CommandId:               "command-1",
		ConversationId:          "conversation-1",
		Sender:                  &chat.CryptoEndpoint{Ptid: string(alice.Actor), DeviceId: string(alice.Device)},
		ObservedMembershipEpoch: 2,
		ObservedMlsEpoch:        1,
		ClientTimestamp:         timestamppb.New(now),
		DeliveryPlanSha256:      planHash.Bytes(),
		AuthorityStationPeerId:  "station-a",
		Payload: &chat.ChatCommand_SendMessage{
			SendMessage: &chat.SendMessageIntent{
				MessageId: "message-1",
				DirectPayloads: []*chat.PreparedEndpointPayload{{
					Recipient:     &chat.CryptoEndpoint{Ptid: string(bob.Actor), DeviceId: string(bob.Device)},
					Kind:          chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_DIRECT_CIPHERTEXT,
					OpaquePayload: bobPayload,
					PayloadSha256: bobHash.Bytes(),
				}},
			},
		},
	}
	request, err := conversationhttp.MapSubmitCommand(
		conversationhttp.AuthenticatedActor{
			PTID:     string(alice.Actor),
			DeviceID: string(alice.Device),
		},
		localCommandRequest(wire),
		aggregate.CommandPreparation{
			Kind:             valueobject.ConversationKindDirect,
			AuthorityStation: "station-a",
			Head: valueobject.AuthorityHead{
				MembershipEpoch: 2,
				MLSEpoch:        1,
			},
			RequiredEndpoints: []valueobject.Endpoint{alice, bob},
			DeliveryPlanHash:  planHash,
		},
		nil,
		now,
	)
	if err != nil {
		t.Fatal(err)
	}
	if request.Command.ConversationID != "conversation-1" ||
		request.Command.Kind != domainevent.KindMessageCommitted ||
		request.Command.MessageID != "message-1" ||
		len(request.Command.Deliveries) != 2 {
		t.Fatalf("mapped request = %+v", request)
	}
	if request.Command.Deliveries[0].Recipient != alice ||
		request.Command.Deliveries[0].Kind != valueobject.DeliveryKindPublicEvent {
		t.Fatalf("sender delivery = %+v", request.Command.Deliveries[0])
	}
	if request.Command.Deliveries[1].Recipient != bob ||
		request.Command.Deliveries[1].Kind != valueobject.DeliveryKindDirectCiphertext {
		t.Fatalf("recipient delivery = %+v", request.Command.Deliveries[1])
	}
	var marker chat.PublicEventMarker
	if err := proto.Unmarshal(request.Command.Deliveries[0].Opaque, &marker); err != nil {
		t.Fatalf("decode public event marker: %v", err)
	}
	if marker.ConversationId != wire.ConversationId ||
		marker.EventId != string(valueobject.DeterministicEventID(
			valueobject.ConversationID(wire.ConversationId),
			valueobject.CommandID(wire.CommandId),
		)) ||
		marker.CommandId != wire.CommandId ||
		marker.SendingEndpoint.Ptid != string(alice.Actor) {
		t.Fatalf("public event marker = %+v", &marker)
	}
	if len(request.ExactCommandBytes) == 0 {
		t.Fatal("exact command bytes were not retained")
	}

	if _, err := conversationhttp.MapSubmitCommand(
		conversationhttp.AuthenticatedActor{PTID: "ptid:mallory", DeviceID: "mallory-1"},
		localCommandRequest(wire),
		aggregate.CommandPreparation{},
		nil,
		now,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeUnauthorized) {
		t.Fatalf("identity mismatch error = %v", err)
	}

	t.Run("rejects a tampered declared payload hash", func(t *testing.T) {
		tampered := proto.Clone(wire).(*chat.ChatCommand)
		tampered.GetSendMessage().DirectPayloads[0].PayloadSha256 = make([]byte, 32)
		_, err := conversationhttp.MapSubmitCommand(
			conversationhttp.AuthenticatedActor{
				PTID:     string(alice.Actor),
				DeviceID: string(alice.Device),
			},
			localCommandRequest(tampered),
			aggregate.CommandPreparation{
				Kind:              valueobject.ConversationKindDirect,
				AuthorityStation:  "station-a",
				RequiredEndpoints: []valueobject.Endpoint{alice, bob},
				DeliveryPlanHash:  planHash,
			},
			nil,
			now,
		)
		if !conversationdomain.IsCode(err, conversationdomain.ErrorCodeDeliverySetMismatch) {
			t.Fatalf("tampered payload hash error = %v", err)
		}
	})

	t.Run("rejects duplicate endpoint payloads", func(t *testing.T) {
		duplicate := proto.Clone(wire).(*chat.ChatCommand)
		duplicate.GetSendMessage().DirectPayloads = append(
			duplicate.GetSendMessage().DirectPayloads,
			proto.Clone(duplicate.GetSendMessage().DirectPayloads[0]).(*chat.PreparedEndpointPayload),
		)
		_, err := conversationhttp.MapSubmitCommand(
			conversationhttp.AuthenticatedActor{
				PTID:     string(alice.Actor),
				DeviceID: string(alice.Device),
			},
			localCommandRequest(duplicate),
			aggregate.CommandPreparation{
				Kind:              valueobject.ConversationKindDirect,
				AuthorityStation:  "station-a",
				RequiredEndpoints: []valueobject.Endpoint{alice, bob},
				DeliveryPlanHash:  planHash,
			},
			nil,
			now,
		)
		if !conversationdomain.IsCode(err, conversationdomain.ErrorCodeDeliverySetMismatch) {
			t.Fatalf("duplicate endpoint error = %v", err)
		}
	})

	t.Run("rejects a payload for the wrong conversation kind", func(t *testing.T) {
		groupPayload := proto.Clone(wire).(*chat.ChatCommand)
		groupPayload.GetSendMessage().DirectPayloads = nil
		groupPayload.GetSendMessage().MlsApplicationPayload = []byte("mls")
		groupPayload.GetSendMessage().MlsApplicationPayloadSha256 =
			valueobject.HashBytes([]byte("mls")).Bytes()
		_, err := conversationhttp.MapSubmitCommand(
			conversationhttp.AuthenticatedActor{
				PTID:     string(alice.Actor),
				DeviceID: string(alice.Device),
			},
			localCommandRequest(groupPayload),
			aggregate.CommandPreparation{
				Kind:              valueobject.ConversationKindDirect,
				AuthorityStation:  "station-a",
				RequiredEndpoints: []valueobject.Endpoint{alice, bob},
				DeliveryPlanHash:  planHash,
			},
			nil,
			now,
		)
		if !conversationdomain.IsCode(err, conversationdomain.ErrorCodeDeliverySetMismatch) {
			t.Fatalf("Direct conversation accepted MLS payload: %v", err)
		}

		_, err = conversationhttp.MapSubmitCommand(
			conversationhttp.AuthenticatedActor{
				PTID:     string(alice.Actor),
				DeviceID: string(alice.Device),
			},
			localCommandRequest(wire),
			aggregate.CommandPreparation{
				Kind:              valueobject.ConversationKindGroup,
				AuthorityStation:  "station-a",
				RequiredEndpoints: []valueobject.Endpoint{alice, bob},
				DeliveryPlanHash:  planHash,
			},
			nil,
			now,
		)
		if !conversationdomain.IsCode(err, conversationdomain.ErrorCodeDeliverySetMismatch) {
			t.Fatalf("Group conversation accepted Direct payloads: %v", err)
		}
	})

	t.Run("rejects a mismatched authority Station", func(t *testing.T) {
		mismatched := proto.Clone(wire).(*chat.ChatCommand)
		mismatched.AuthorityStationPeerId = "station-b"
		_, err := conversationhttp.MapSubmitCommand(
			conversationhttp.AuthenticatedActor{
				PTID:     string(alice.Actor),
				DeviceID: string(alice.Device),
			},
			localCommandRequest(mismatched),
			aggregate.CommandPreparation{
				Kind:              valueobject.ConversationKindDirect,
				AuthorityStation:  "station-a",
				RequiredEndpoints: []valueobject.Endpoint{alice, bob},
				DeliveryPlanHash:  planHash,
			},
			nil,
			now,
		)
		if !conversationdomain.IsCode(err, conversationdomain.ErrorCodeStaleAuthorityHead) {
			t.Fatalf("authority Station mismatch error = %v", err)
		}
	})
}

func TestMapSubmitCommandRejectsProposalSubmission(t *testing.T) {
	_, err := conversationhttp.MapSubmitCommand(
		conversationhttp.AuthenticatedActor{
			PTID:     "ptid:alice",
			DeviceID: "alice-1",
		},
		&chat.SubmitConversationAuthorityCommandRequest{
			Submission: &chat.SubmitConversationAuthorityCommandRequest_Proposal{
				Proposal: &chat.ConversationCommandProposal{},
			},
		},
		aggregate.CommandPreparation{},
		nil,
		time.Date(2026, time.September, 7, 12, 0, 0, 0, time.UTC),
	)
	if !conversationdomain.IsCode(err, conversationdomain.ErrorCodeInvalidArgument) {
		t.Fatalf("proposal submission error = %v", err)
	}
}

func TestMapDissolveCommandAndEvent(t *testing.T) {
	now := time.Date(2026, time.September, 6, 13, 30, 0, 0, time.UTC)
	owner := valueobject.Endpoint{Actor: "ptid:owner", Device: "owner-1"}
	member := valueobject.Endpoint{Actor: "ptid:member", Device: "member-1"}
	planHash := valueobject.HashBytes([]byte("dissolve-plan"))
	wire := &chat.ChatCommand{
		CommandId:               "dissolve-1",
		ConversationId:          "conversation-1",
		Sender:                  endpointProto(owner),
		ObservedMembershipEpoch: 2,
		ObservedMlsEpoch:        3,
		ClientTimestamp:         timestamppb.New(now),
		DeliveryPlanSha256:      planHash.Bytes(),
		AuthorityStationPeerId:  "station-a",
		Payload: &chat.ChatCommand_DissolveConversation{
			DissolveConversation: &chat.DissolveConversationIntent{},
		},
	}
	mapped, err := conversationhttp.MapSubmitCommand(
		conversationhttp.AuthenticatedActor{
			PTID:     string(owner.Actor),
			DeviceID: string(owner.Device),
		},
		localCommandRequest(wire),
		aggregate.CommandPreparation{
			Kind:              valueobject.ConversationKindGroup,
			AuthorityStation:  "station-a",
			RequiredEndpoints: []valueobject.Endpoint{owner, member},
			DeliveryPlanHash:  planHash,
		},
		nil,
		now,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !mapped.Dissolve ||
		mapped.Command.Kind != domainevent.KindConversationDissolved ||
		len(mapped.Command.Deliveries) != 2 {
		t.Fatalf("mapped dissolve request = %+v", mapped)
	}
	record, err := (conversationhttp.ProtobufEventSealer{}).Seal(domainevent.RecordInput{
		ID:               "event-dissolve",
		ConversationID:   "conversation-1",
		Sequence:         4,
		CommandID:        "dissolve-1",
		Actor:            owner,
		PreviousHash:     valueobject.HashBytes([]byte("event-3")),
		CommittedAt:      now,
		MembershipEpoch:  2,
		MLSEpoch:         3,
		AuthorityStation: "station-a",
		Fact:             domainevent.NewConversationDissolvedFact(mapped.ExactCommandBytes),
	})
	if err != nil {
		t.Fatal(err)
	}
	var event chat.ConversationEvent
	if err := proto.Unmarshal(record.Bytes(), &event); err != nil {
		t.Fatal(err)
	}
	if event.GetConversationDissolved().GetDissolvedByPtid() != string(owner.Actor) {
		t.Fatalf("dissolved event = %+v", &event)
	}
}

func TestMapMembershipCommandUsesCanonicalEndpointPayloads(t *testing.T) {
	now := time.Date(2026, time.September, 6, 13, 0, 0, 0, time.UTC)
	owner := valueobject.Endpoint{Actor: "ptid:owner", Device: "owner-1"}
	member := valueobject.Endpoint{Actor: "ptid:member", Device: "member-1"}
	added := valueobject.Endpoint{Actor: "ptid:added", Device: "added-1"}
	planHash := valueobject.HashBytes([]byte("membership-plan"))
	welcome := []byte("welcome")
	commit := []byte("commit")
	plan := entity.AuthorityPlan{
		ID:             "plan-1",
		ConversationID: "conversation-1",
		Requester:      owner,
		AuthorityHead: valueobject.AuthorityHead{
			Sequence:        3,
			EventHash:       valueobject.HashBytes([]byte("event-3")),
			MembershipEpoch: 2,
			MLSEpoch:        2,
		},
		Changes: []entity.MembershipChange{{
			Action:      entity.MembershipActionAddActor,
			Actor:       added.Actor,
			Device:      added.Device,
			HomeStation: "station-b",
			Role:        valueobject.MemberRoleMember,
		}},
		PreEndpoints:  []valueobject.Endpoint{owner, member},
		PostEndpoints: []valueobject.Endpoint{owner, member, added},
		AddedEndpoints: []valueobject.Endpoint{
			added,
		},
		Hash: planHash,
	}
	wire := &chat.ChatCommand{
		CommandId:               "membership-1",
		ConversationId:          "conversation-1",
		Sender:                  endpointProto(owner),
		ObservedMembershipEpoch: 2,
		ObservedMlsEpoch:        2,
		ClientTimestamp:         timestamppb.New(now),
		DeliveryPlanSha256:      planHash.Bytes(),
		AuthorityStationPeerId:  "station-a",
		Payload: &chat.ChatCommand_MembershipTransition{
			MembershipTransition: &chat.MembershipTransitionIntent{
				TransitionId:        "transition-1",
				FromMembershipEpoch: 2,
				FromMlsEpoch:        2,
				ToMlsEpoch:          3,
				MlsCommit:           commit,
				MlsCommitSha256:     valueobject.HashBytes(commit).Bytes(),
				WelcomePayloads: []*chat.PreparedEndpointPayload{{
					Recipient:     endpointProto(added),
					Kind:          chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_WELCOME,
					OpaquePayload: welcome,
					PayloadSha256: valueobject.HashBytes(welcome).Bytes(),
				}},
				AuthorityPlanId:     string(plan.ID),
				AuthorityPlanSha256: planHash.Bytes(),
			},
		},
	}
	mapped, err := conversationhttp.MapSubmitCommand(
		conversationhttp.AuthenticatedActor{
			PTID:     string(owner.Actor),
			DeviceID: string(owner.Device),
		},
		localCommandRequest(wire),
		aggregate.CommandPreparation{
			Kind:             valueobject.ConversationKindGroup,
			AuthorityStation: "station-a",
		},
		&plan,
		now,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(mapped.Command.Deliveries) != 3 {
		t.Fatalf("deliveries = %+v", mapped.Command.Deliveries)
	}
	eventID := valueobject.DeterministicEventID("conversation-1", "membership-1")
	for _, delivery := range mapped.Command.Deliveries {
		switch delivery.Kind {
		case valueobject.DeliveryKindPublicEvent:
			var marker chat.PublicEventMarker
			if err := proto.Unmarshal(delivery.Opaque, &marker); err != nil {
				t.Fatal(err)
			}
			if marker.EventId != string(eventID) || marker.SendingEndpoint.Ptid != string(owner.Actor) {
				t.Fatalf("public marker = %+v", &marker)
			}
		case valueobject.DeliveryKindMLSCommit, valueobject.DeliveryKindMLSWelcome:
			var payload chat.MlsQueuePayload
			if err := proto.Unmarshal(delivery.Opaque, &payload); err != nil {
				t.Fatal(err)
			}
			if payload.EventId != string(eventID) ||
				payload.AuthoritySequence != 4 ||
				payload.ToMembershipEpoch != 3 ||
				payload.ToMlsEpoch != 3 {
				t.Fatalf("MLS queue payload = %+v", &payload)
			}
			if delivery.Kind == valueobject.DeliveryKindMLSCommit &&
				!bytes.Equal(payload.OpaqueMlsBytes, commit) {
				t.Fatalf("commit payload = %q", payload.OpaqueMlsBytes)
			}
			if delivery.Kind == valueobject.DeliveryKindMLSWelcome &&
				!bytes.Equal(payload.OpaqueMlsBytes, welcome) {
				t.Fatalf("welcome payload = %q", payload.OpaqueMlsBytes)
			}
		default:
			t.Fatalf("unexpected delivery = %+v", delivery)
		}
	}

	t.Run("genesis sender receives public marker without welcome", func(t *testing.T) {
		genesisPlan := plan
		genesisPlan.AuthorityHead = valueobject.AuthorityHead{}
		genesisPlan.PreEndpoints = nil
		genesisPlan.PostEndpoints = []valueobject.Endpoint{owner, added}
		genesisPlan.AddedEndpoints = []valueobject.Endpoint{owner, added}

		genesis := proto.Clone(wire).(*chat.ChatCommand)
		genesis.ObservedMembershipEpoch = 0
		genesis.ObservedMlsEpoch = 0
		genesis.GetMembershipTransition().FromMembershipEpoch = 0
		genesis.GetMembershipTransition().FromMlsEpoch = 0
		genesis.GetMembershipTransition().ToMlsEpoch = 1

		mapped, err := conversationhttp.MapSubmitCommand(
			conversationhttp.AuthenticatedActor{
				PTID:     string(owner.Actor),
				DeviceID: string(owner.Device),
			},
			localCommandRequest(genesis),
			aggregate.CommandPreparation{
				Kind:             valueobject.ConversationKindGroup,
				AuthorityStation: "station-a",
			},
			&genesisPlan,
			now,
		)
		if err != nil {
			t.Fatal(err)
		}
		if len(mapped.Command.Deliveries) != 2 {
			t.Fatalf("genesis deliveries = %+v", mapped.Command.Deliveries)
		}
		for _, delivery := range mapped.Command.Deliveries {
			switch delivery.Recipient {
			case owner:
				if delivery.Kind != valueobject.DeliveryKindPublicEvent {
					t.Fatalf("genesis sender delivery = %+v", delivery)
				}
			case added:
				if delivery.Kind != valueobject.DeliveryKindMLSWelcome {
					t.Fatalf("genesis added endpoint delivery = %+v", delivery)
				}
			default:
				t.Fatalf("unexpected genesis delivery = %+v", delivery)
			}
		}
	})

	t.Run("removed sender receives retirement instead of public marker", func(t *testing.T) {
		selfRemovalPlan := plan
		selfRemovalPlan.Changes = []entity.MembershipChange{{
			Action:      entity.MembershipActionRemoveDevice,
			Actor:       owner.Actor,
			Device:      owner.Device,
			HomeStation: "station-a",
		}}
		selfRemovalPlan.PostEndpoints = []valueobject.Endpoint{member}
		selfRemovalPlan.AddedEndpoints = nil
		selfRemovalPlan.RemovedEndpoints = []valueobject.Endpoint{owner}

		selfRemoval := proto.Clone(wire).(*chat.ChatCommand)
		selfRemoval.GetMembershipTransition().Changes = []*chat.MessagingMembershipChangeIntent{{
			Action:   chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_REMOVE_DEVICE,
			Ptid:     string(owner.Actor),
			DeviceId: string(owner.Device),
		}}
		selfRemoval.GetMembershipTransition().WelcomePayloads = nil

		mapped, err := conversationhttp.MapSubmitCommand(
			conversationhttp.AuthenticatedActor{
				PTID:     string(owner.Actor),
				DeviceID: string(owner.Device),
			},
			localCommandRequest(selfRemoval),
			aggregate.CommandPreparation{
				Kind:             valueobject.ConversationKindGroup,
				AuthorityStation: "station-a",
			},
			&selfRemovalPlan,
			now,
		)
		if err != nil {
			t.Fatal(err)
		}
		for _, delivery := range mapped.Command.Deliveries {
			if delivery.Recipient == owner &&
				delivery.Kind != valueobject.DeliveryKindMLSRetirement {
				t.Fatalf("removed sender delivery = %+v", delivery)
			}
		}
	})

	tampered := proto.Clone(wire).(*chat.ChatCommand)
	tampered.GetMembershipTransition().MlsCommitSha256 = make([]byte, 32)
	_, err = conversationhttp.MapSubmitCommand(
		conversationhttp.AuthenticatedActor{
			PTID:     string(owner.Actor),
			DeviceID: string(owner.Device),
		},
		localCommandRequest(tampered),
		aggregate.CommandPreparation{
			Kind:             valueobject.ConversationKindGroup,
			AuthorityStation: "station-a",
		},
		&plan,
		now,
	)
	if !conversationdomain.IsCode(err, conversationdomain.ErrorCodeDeliverySetMismatch) {
		t.Fatalf("tampered MLS commit hash error = %v", err)
	}

	tamperedPlan := proto.Clone(wire).(*chat.ChatCommand)
	tamperedPlan.GetMembershipTransition().AuthorityPlanSha256 = make([]byte, 32)
	_, err = conversationhttp.MapSubmitCommand(
		conversationhttp.AuthenticatedActor{
			PTID:     string(owner.Actor),
			DeviceID: string(owner.Device),
		},
		localCommandRequest(tamperedPlan),
		aggregate.CommandPreparation{
			Kind:             valueobject.ConversationKindGroup,
			AuthorityStation: "station-a",
		},
		&plan,
		now,
	)
	if !conversationdomain.IsCode(err, conversationdomain.ErrorCodeAuthorityPlanStale) {
		t.Fatalf("tampered authority plan error = %v", err)
	}
}

func TestMapEventAndRejectCodes(t *testing.T) {
	now := time.Date(2026, time.September, 6, 13, 0, 0, 0, time.UTC)
	command := &chat.ChatCommand{
		CommandId:       "command-1",
		ConversationId:  "conversation-1",
		Sender:          &chat.CryptoEndpoint{Ptid: "ptid:alice", DeviceId: "alice-1"},
		ClientTimestamp: timestamppb.New(now),
		Payload: &chat.ChatCommand_SendMessage{
			SendMessage: &chat.SendMessageIntent{MessageId: "message-1"},
		},
	}
	commandBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(command)
	if err != nil {
		t.Fatal(err)
	}
	record, err := domainevent.NewRecord(domainevent.RecordInput{
		ID:               "event-1",
		ConversationID:   "conversation-1",
		Sequence:         1,
		CommandID:        "command-1",
		Actor:            valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"},
		CommittedAt:      now,
		MembershipEpoch:  1,
		AuthorityStation: "station-a",
		Fact: domainevent.NewCommandCommittedFact(
			domainevent.KindMessageCommitted,
			"message-1",
			commandBytes,
		),
	})
	if err != nil {
		t.Fatal(err)
	}
	wire, err := conversationhttp.MapEvent(record)
	if err != nil {
		t.Fatal(err)
	}
	if wire.EventId != "event-1" || wire.GetMessageCommitted().MessageId != "message-1" ||
		wire.Actor.Ptid != "ptid:alice" {
		t.Fatalf("mapped event = %+v", wire)
	}

	input := domainevent.RecordInput{
		ID:               "event-transport",
		ConversationID:   "conversation-1",
		Sequence:         1,
		CommandID:        "command-1",
		Actor:            valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"},
		CommittedAt:      now,
		MembershipEpoch:  1,
		AuthorityStation: "station-a",
		Fact: domainevent.NewCommandCommittedFact(
			domainevent.KindMessageCommitted,
			"message-1",
			commandBytes,
		),
	}
	sealed, err := (conversationhttp.ProtobufEventSealer{}).Seal(input)
	if err != nil {
		t.Fatal(err)
	}
	sealedWire, err := conversationhttp.MapEvent(sealed)
	if err != nil {
		t.Fatal(err)
	}
	sealedWire.EventHash = nil
	canonical, err := proto.MarshalOptions{Deterministic: true}.Marshal(sealedWire)
	if err != nil {
		t.Fatal(err)
	}
	if sealed.Hash != valueobject.HashBytes(canonical) ||
		sealed.HashScheme != domainevent.HashSchemeTransport {
		t.Fatalf("transport-sealed event = %+v", sealed)
	}
	var committed chat.ConversationEvent
	if err := proto.Unmarshal(sealed.Bytes(), &committed); err != nil {
		t.Fatalf("decode committed event bytes: %v", err)
	}
	if !bytes.Equal(committed.EventHash, sealed.Hash.Bytes()) {
		t.Fatalf("committed event hash = %x, want %x", committed.EventHash, sealed.Hash)
	}

	cases := []struct {
		code conversationdomain.ErrorCode
		want chat.ConversationCommandRejectCode
	}{
		{
			code: conversationdomain.ErrorCodeCommandConflict,
			want: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_COMMAND_CONFLICT,
		},
		{
			code: conversationdomain.ErrorCodeStaleAuthorityHead,
			want: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_AUTHORITY_HEAD_STALE,
		},
		{
			code: conversationdomain.ErrorCodeDeliverySetMismatch,
			want: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_DELIVERY_SET,
		},
		{
			code: conversationdomain.ErrorCodeAuthorityPlanExpired,
			want: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_AUTHORITY_PLAN_EXPIRED,
		},
		{
			code: conversationdomain.ErrorCodeInvalidArgument,
			want: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_INVALID_PROPOSAL,
		},
		{
			code: conversationdomain.ErrorCodeNotFound,
			want: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_CONVERSATION_STATE,
		},
		{
			code: conversationdomain.ErrorCodeOwnerProtected,
			want: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_OWNER_PROTECTED,
		},
		{
			code: conversationdomain.ErrorCodeTargetNotMember,
			want: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_TARGET_NOT_MEMBER,
		},
		{
			code: conversationdomain.ErrorCodeCommandExpired,
			want: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_MEMBER_COMMAND_EXPIRED,
		},
		{
			code: conversationdomain.ErrorCodeMemberMuted,
			want: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_MEMBER_MUTED,
		},
		{
			code: conversationdomain.ErrorCodeMembershipConflict,
			want: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_CONVERSATION_STATE,
		},
		{
			code: conversationdomain.ErrorCodeDeviceConflict,
			want: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_CONVERSATION_STATE,
		},
		{
			code: conversationdomain.ErrorCodeHashChainInvalid,
			want: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_GROUP_READ_ONLY,
		},
		{
			code: conversationdomain.ErrorCodeReadOnly,
			want: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_GROUP_READ_ONLY,
		},
		{
			code: conversationdomain.ErrorCodeProposalInvalid,
			want: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_INVALID_PROPOSAL,
		},
		{
			code: conversationdomain.ErrorCodeProposalExpired,
			want: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_COMMAND_EXPIRED,
		},
		{
			code: conversationdomain.ErrorCodeProposalBinding,
			want: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_FIELD_BINDING_MISMATCH,
		},
		{
			code: conversationdomain.ErrorCodeProposalSignature,
			want: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_INVALID_ACTOR_SIGNATURE,
		},
		{
			code: conversationdomain.ErrorCodeActorKeyUnavailable,
			want: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_ACTOR_KEY_UNAVAILABLE,
		},
		{
			code: conversationdomain.ErrorCodeActorKeyRevoked,
			want: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_ACTOR_KEY_REVOKED,
		},
		{
			code: conversationdomain.ErrorCodeFederationInactive,
			want: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_INACTIVE_FEDERATION_STATION,
		},
	}
	for _, test := range cases {
		err := conversationdomain.NewError(test.code, "test", "field", "message")
		if got := conversationhttp.MapRejectCode(err); got != test.want {
			t.Fatalf("MapRejectCode(%q) = %v, want %v", test.code, got, test.want)
		}
	}
}

func TestProtobufEventSealerBindsAppliedSettingsPatch(t *testing.T) {
	now := time.Date(2026, time.September, 6, 13, 0, 0, 0, time.UTC)
	name := "Bound Name"
	wireVisibility := chat.GroupVisibilityV1_GROUP_VISIBILITY_V1_PRIVATE
	visibility := valueobject.ConversationVisibilityPrivate
	command := &chat.ChatCommand{
		CommandId:       "settings-command",
		ConversationId:  "conversation-1",
		Sender:          &chat.CryptoEndpoint{Ptid: "ptid:alice", DeviceId: "alice-1"},
		ClientTimestamp: timestamppb.New(now),
		Payload: &chat.ChatCommand_UpdateConversation{
			UpdateConversation: &chat.UpdateConversationIntent{
				Name:       &name,
				Visibility: &wireVisibility,
			},
		},
	}
	commandBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(command)
	if err != nil {
		t.Fatal(err)
	}
	sealer := conversationhttp.ProtobufEventSealer{}
	sealed, err := sealer.Seal(domainevent.RecordInput{
		ID:               "settings-event",
		ConversationID:   "conversation-1",
		Sequence:         2,
		CommandID:        "settings-command",
		Actor:            valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"},
		PreviousHash:     valueobject.HashBytes([]byte("previous")),
		CommittedAt:      now,
		MembershipEpoch:  1,
		AuthorityStation: "station-a",
		Fact: domainevent.NewSettingsChangedFact(valueobject.SettingsPatch{
			Name:       &name,
			Visibility: &visibility,
		}, commandBytes),
	})
	if err != nil {
		t.Fatal(err)
	}
	wire, err := conversationhttp.MapEvent(sealed)
	if err != nil {
		t.Fatal(err)
	}
	if wire.GetConversationUpdated().GetName() != name ||
		wire.GetConversationUpdated().GetVisibility() != wireVisibility {
		t.Fatalf("mapped settings event = %+v", wire.GetConversationUpdated())
	}

	tampered := sealed.Clone()
	tamperedName := "Tampered Name"
	tampered.Fact.SettingsPatch.Name = &tamperedName
	if _, err := domainevent.Verify(
		tampered,
		sealer,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeHashChainInvalid) {
		t.Fatalf("tampered settings patch verification error = %v", err)
	}
}

func TestProtobufCommandProposalSigningEncoderBindsAcceptedD17Fields(t *testing.T) {
	commandHash := valueobject.HashBytes([]byte("canonical-command"))
	encoded, err := (conversationhttp.ProtobufCommandProposalSigningEncoder{}).
		EncodeCommandProposalSigningInput(ports.CommandProposalSigningInput{
			Version:             1,
			FederationID:        "federation-1",
			AuthorityStation:    "station-a",
			AuthorityEpoch:      7,
			HomeStation:         "station-b",
			ConversationID:      "conversation-1",
			CommandID:           "command-1",
			CommandKind:         domainevent.KindMessageCommitted,
			Actor:               valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-1"},
			SigningKeyID:        "alice-signing-key",
			CommandHash:         commandHash,
			CreatedAtUnixMillis: 1000,
			ExpiresAtUnixMillis: 2000,
		})
	if err != nil {
		t.Fatal(err)
	}
	var signingInput chat.ConversationCommandProposalSigningInput
	if err := proto.Unmarshal(encoded, &signingInput); err != nil {
		t.Fatal(err)
	}
	if signingInput.Version != 1 ||
		signingInput.FederationId != "federation-1" ||
		signingInput.AuthorityStationPeerId != "station-a" ||
		signingInput.AuthorityEpoch != 7 ||
		signingInput.HomeStationPeerId != "station-b" ||
		signingInput.ConversationId != "conversation-1" ||
		signingInput.CommandId != "command-1" ||
		signingInput.CommandKind !=
			chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_SEND_MESSAGE ||
		signingInput.ActorPtid != "ptid:alice" ||
		signingInput.ActorDeviceId != "alice-1" ||
		signingInput.ActorSigningKeyId != "alice-signing-key" ||
		!bytes.Equal(signingInput.CommandSha256, commandHash.Bytes()) ||
		signingInput.CreatedAtUnixMs != 1000 ||
		signingInput.ExpiresAtUnixMs != 2000 {
		t.Fatalf("signing input = %+v", &signingInput)
	}
}

func endpointProto(endpoint valueobject.Endpoint) *chat.CryptoEndpoint {
	return &chat.CryptoEndpoint{
		Ptid:     string(endpoint.Actor),
		DeviceId: string(endpoint.Device),
	}
}

func localCommandRequest(
	command *chat.ChatCommand,
) *chat.SubmitConversationAuthorityCommandRequest {
	return &chat.SubmitConversationAuthorityCommandRequest{
		Submission: &chat.SubmitConversationAuthorityCommandRequest_Command{
			Command: command,
		},
	}
}
