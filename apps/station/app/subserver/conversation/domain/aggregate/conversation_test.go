package aggregate_test

import (
	"reflect"
	"testing"
	"time"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

var testTime = time.Date(2026, time.September, 6, 10, 0, 0, 0, time.UTC)

const (
	testFederationID   valueobject.FederationID   = "federation-test"
	testAuthorityEpoch valueobject.AuthorityEpoch = 1
)

type testEventSealer struct{}

func (testEventSealer) Seal(input domainevent.RecordInput) (domainevent.Record, error) {
	canonical, err := (domainevent.CanonicalSealer{}).Seal(input)
	if err != nil {
		return domainevent.Record{}, err
	}
	return domainevent.SealTransportRecord(input, canonical.Hash, canonical.Bytes())
}

type conversationFixture struct {
	conversation *aggregate.Conversation
	owner        valueobject.Endpoint
	member       valueobject.Endpoint
	station      valueobject.StationID
	genesis      aggregate.Transition
}

func TestCreateDirect(t *testing.T) {
	alice := mustEndpoint(t, "ptid:alice", "alice-device")
	bob := mustEndpoint(t, "ptid:bob", "bob-device")
	station := valueobject.StationID("station-a")
	devices := []entity.MemberDevice{
		mustMemberDevice(t, alice, station),
		mustMemberDevice(t, bob, station),
	}
	deliveries := mustDeliveries(t, []valueobject.Endpoint{alice, bob}, station, "direct-genesis")

	create := func(participants []aggregate.Participant) (*aggregate.Conversation, aggregate.Transition) {
		t.Helper()

		conversation, transition, err := aggregate.CreateDirect(aggregate.CreateInput{
			AuthorityStation: station,
			FederationID:     testFederationID,
			AuthorityEpoch:   testAuthorityEpoch,
			Participants:     participants,
			Devices:          devices,
			CommandID:        valueobject.CommandID("direct-create"),
			Creator:          alice,
			Deliveries:       deliveries,
			EventPayload:     []byte("direct-created"),
			CreatedAt:        testTime,
			EventSealer:      testEventSealer{},
		})
		if err != nil {
			t.Fatalf("CreateDirect() error = %v", err)
		}

		return conversation, transition
	}

	forward, forwardTransition := create([]aggregate.Participant{
		{Actor: alice.Actor, HomeStation: station},
		{Actor: bob.Actor, HomeStation: station},
	})
	reverse, reverseTransition := create([]aggregate.Participant{
		{Actor: bob.Actor, HomeStation: station},
		{Actor: alice.Actor, HomeStation: station},
	})

	if forward.ID() != reverse.ID() {
		t.Fatalf("conversation IDs differ by participant order: %q != %q", forward.ID(), reverse.ID())
	}
	if forwardTransition.Event.ID != reverseTransition.Event.ID {
		t.Fatalf(
			"event IDs differ by participant order: %q != %q",
			forwardTransition.Event.ID,
			reverseTransition.Event.ID,
		)
	}
	if forwardTransition.Event.Hash != reverseTransition.Event.Hash {
		t.Fatal("genesis event hash differs by participant order")
	}
	if forward.Kind() != valueobject.ConversationKindDirect {
		t.Fatalf("Kind() = %q, want %q", forward.Kind(), valueobject.ConversationKindDirect)
	}
	head := forward.AuthorityHead()
	if head.Sequence != 1 || head.MembershipEpoch != 1 || head.MLSEpoch != 0 ||
		head.EventHash.IsZero() {
		t.Fatalf("AuthorityHead() = %+v, want direct genesis head", head)
	}
	for _, member := range forward.Members() {
		if member.Role != valueobject.MemberRoleMember || !member.Active() {
			t.Fatalf("direct member = %+v, want active member role", member)
		}
	}
}

func TestCreateGroup(t *testing.T) {
	fixture := mustCreateGroup(t)

	if fixture.conversation.Kind() != valueobject.ConversationKindGroup {
		t.Fatalf(
			"Kind() = %q, want %q",
			fixture.conversation.Kind(),
			valueobject.ConversationKindGroup,
		)
	}
	if fixture.conversation.Status() != valueobject.ConversationStatusActive {
		t.Fatalf("Status() = %q, want active", fixture.conversation.Status())
	}
	head := fixture.conversation.AuthorityHead()
	if head.Sequence != 1 || head.MembershipEpoch != 1 || head.MLSEpoch != 1 ||
		head.EventHash.IsZero() {
		t.Fatalf("AuthorityHead() = %+v, want group genesis head", head)
	}
	if fixture.genesis.Event.Fact.Kind != domainevent.KindConversationCreated {
		t.Fatalf(
			"genesis event kind = %q, want %q",
			fixture.genesis.Event.Fact.Kind,
			domainevent.KindConversationCreated,
		)
	}
	if got := fixture.conversation.ActiveEndpoints(); !reflect.DeepEqual(
		got,
		valueobject.SortEndpoints([]valueobject.Endpoint{fixture.owner, fixture.member}),
	) {
		t.Fatalf("ActiveEndpoints() = %+v, want both initial devices", got)
	}

	t.Run("owner must be a participant", func(t *testing.T) {
		owner := mustEndpoint(t, "ptid:owner", "owner-device")
		member := mustEndpoint(t, "ptid:member", "member-device")
		_, _, err := aggregate.CreateGroup(aggregate.CreateInput{
			ID:               valueobject.ConversationID("group-missing-owner"),
			FederationID:     testFederationID,
			AuthorityStation: fixture.station,
			AuthorityEpoch:   testAuthorityEpoch,
			Owner:            owner.Actor,
			Participants: []aggregate.Participant{
				{Actor: member.Actor, HomeStation: fixture.station},
			},
			Devices: []entity.MemberDevice{
				mustMemberDevice(t, member, fixture.station),
			},
			CommandID:    valueobject.CommandID("create-missing-owner"),
			Creator:      member,
			Deliveries:   mustDeliveries(t, []valueobject.Endpoint{member}, fixture.station, "genesis"),
			EventPayload: []byte("group-created"),
			CreatedAt:    testTime,
			EventSealer:  testEventSealer{},
		})
		assertErrorCode(t, err, conversationdomain.ErrorCodeInvalidArgument)
	})

	t.Run("creator must be an active member device", func(t *testing.T) {
		outsider := mustEndpoint(t, "ptid:outsider", "outsider-device")
		_, _, err := aggregate.CreateGroup(aggregate.CreateInput{
			ID:               valueobject.ConversationID("group-unauthorized-creator"),
			FederationID:     testFederationID,
			AuthorityStation: fixture.station,
			AuthorityEpoch:   testAuthorityEpoch,
			Owner:            fixture.owner.Actor,
			Participants: []aggregate.Participant{
				{Actor: fixture.owner.Actor, HomeStation: fixture.station},
			},
			Devices: []entity.MemberDevice{
				mustMemberDevice(t, fixture.owner, fixture.station),
			},
			CommandID: valueobject.CommandID("create-unauthorized"),
			Creator:   outsider,
			Deliveries: mustDeliveries(
				t,
				[]valueobject.Endpoint{fixture.owner},
				fixture.station,
				"genesis",
			),
			EventPayload: []byte("group-created"),
			CreatedAt:    testTime,
			EventSealer:  testEventSealer{},
		})
		assertErrorCode(t, err, conversationdomain.ErrorCodeUnauthorized)
	})

	t.Run("rejects delivery kinds that do not match group genesis roles", func(t *testing.T) {
		owner := mustEndpoint(t, "ptid:genesis-owner", "owner-device")
		member := mustEndpoint(t, "ptid:genesis-member", "member-device")
		_, _, err := aggregate.CreateGroup(aggregate.CreateInput{
			ID:               valueobject.ConversationID("group-invalid-delivery-kind"),
			FederationID:     testFederationID,
			AuthorityStation: fixture.station,
			AuthorityEpoch:   testAuthorityEpoch,
			Owner:            owner.Actor,
			Participants: []aggregate.Participant{
				{Actor: owner.Actor, HomeStation: fixture.station},
				{Actor: member.Actor, HomeStation: fixture.station},
			},
			Devices: []entity.MemberDevice{
				mustMemberDevice(t, owner, fixture.station),
				mustMemberDevice(t, member, fixture.station),
			},
			CommandID: valueobject.CommandID("create-invalid-delivery-kind"),
			Creator:   owner,
			Deliveries: mustDeliveries(
				t,
				[]valueobject.Endpoint{owner, member},
				fixture.station,
				"genesis",
			),
			EventPayload: []byte("group-created"),
			CreatedAt:    testTime,
			EventSealer:  testEventSealer{},
		})
		assertErrorCode(t, err, conversationdomain.ErrorCodeDeliverySetMismatch)
	})
}

func TestCreateRejectsInvalidDeviceProjection(t *testing.T) {
	owner := mustEndpoint(t, "ptid:device-owner", "owner-device")
	member := mustEndpoint(t, "ptid:device-member", "member-device")
	station := valueobject.StationID("station-a")

	tests := []struct {
		name   string
		mutate func(*entity.MemberDevice)
	}{
		{
			name: "device Home Station differs from actor membership",
			mutate: func(device *entity.MemberDevice) {
				device.HomeStation = "station-b"
			},
		},
		{
			name: "device joins after genesis",
			mutate: func(device *entity.MemberDevice) {
				device.JoinedAt = 2
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			memberDevice := mustMemberDevice(t, member, station)
			test.mutate(&memberDevice)

			_, _, err := aggregate.CreateGroup(aggregate.CreateInput{
				ID:               valueobject.ConversationID("group-invalid-device"),
				FederationID:     testFederationID,
				AuthorityStation: station,
				AuthorityEpoch:   testAuthorityEpoch,
				Owner:            owner.Actor,
				Participants: []aggregate.Participant{
					{Actor: owner.Actor, HomeStation: station},
					{Actor: member.Actor, HomeStation: station},
				},
				Devices: []entity.MemberDevice{
					mustMemberDevice(t, owner, station),
					memberDevice,
				},
				CommandID: valueobject.CommandID("create-invalid-device"),
				Creator:   owner,
				Deliveries: mustGroupCreationDeliveries(
					t,
					[]valueobject.Endpoint{owner, member},
					station,
					owner,
					"invalid-device",
				),
				EventPayload: []byte("group-created"),
				CreatedAt:    testTime,
				EventSealer:  testEventSealer{},
			})
			assertErrorCode(t, err, conversationdomain.ErrorCodeInvalidArgument)
		})
	}
}

func TestConversationRejectsNonTransportEventSealer(t *testing.T) {
	owner := mustEndpoint(t, "ptid:transport-owner", "owner-device")
	member := mustEndpoint(t, "ptid:transport-member", "member-device")
	station := valueobject.StationID("station-a")
	_, _, err := aggregate.CreateGroup(aggregate.CreateInput{
		ID:               "transport-sealer-group",
		FederationID:     testFederationID,
		AuthorityStation: station,
		AuthorityEpoch:   testAuthorityEpoch,
		Owner:            owner.Actor,
		Participants: []aggregate.Participant{
			{Actor: owner.Actor, HomeStation: station},
			{Actor: member.Actor, HomeStation: station},
		},
		Devices: []entity.MemberDevice{
			mustMemberDevice(t, owner, station),
			mustMemberDevice(t, member, station),
		},
		CommandID: "transport-sealer-create",
		Creator:   owner,
		Deliveries: mustGroupCreationDeliveries(
			t,
			[]valueobject.Endpoint{owner, member},
			station,
			owner,
			"transport-sealer",
		),
		EventPayload: []byte("transport-sealer-create"),
		CreatedAt:    testTime,
		EventSealer:  domainevent.CanonicalSealer{},
	})
	assertErrorCode(t, err, conversationdomain.ErrorCodeHashChainInvalid)
}

func TestConversationApplyCommand(t *testing.T) {
	t.Run("chains ordinary events from the authority head", func(t *testing.T) {
		fixture := mustCreateGroup(t)
		genesisHash := fixture.conversation.AuthorityHead().EventHash

		first := mustCommand(
			t,
			fixture,
			fixture.owner,
			"message-command-1",
			domainevent.KindMessageCommitted,
			testTime.Add(time.Minute),
		)
		firstTransition, err := fixture.conversation.ApplyCommand(first)
		if err != nil {
			t.Fatalf("ApplyCommand(first) error = %v", err)
		}
		if firstTransition.Event.Sequence != 2 ||
			firstTransition.Event.PreviousHash != genesisHash ||
			firstTransition.Event.Hash.IsZero() {
			t.Fatalf("first event = %+v, want sequence 2 chained to genesis", firstTransition.Event)
		}

		second := mustCommand(
			t,
			fixture,
			fixture.member,
			"message-command-2",
			domainevent.KindReactionCommitted,
			testTime.Add(2*time.Minute),
		)
		secondTransition, err := fixture.conversation.ApplyCommand(second)
		if err != nil {
			t.Fatalf("ApplyCommand(second) error = %v", err)
		}
		if secondTransition.Event.Sequence != 3 ||
			secondTransition.Event.PreviousHash != firstTransition.Event.Hash ||
			secondTransition.Event.Hash.IsZero() {
			t.Fatalf("second event = %+v, want sequence 3 chained to first", secondTransition.Event)
		}
		if secondTransition.Event.ID != valueobject.DeterministicEventID(
			fixture.conversation.ID(),
			second.ID,
		) {
			t.Fatalf("event ID = %q, want deterministic ID", secondTransition.Event.ID)
		}
	})

	tests := []struct {
		name     string
		mutate   func(*aggregate.Command)
		wantCode conversationdomain.ErrorCode
	}{
		{
			name: "stale membership epoch",
			mutate: func(command *aggregate.Command) {
				command.ObservedMembershipEpoch--
			},
			wantCode: conversationdomain.ErrorCodeStaleMembershipEpoch,
		},
		{
			name: "stale MLS epoch",
			mutate: func(command *aggregate.Command) {
				command.ObservedMLSEpoch--
			},
			wantCode: conversationdomain.ErrorCodeStaleMLSEpoch,
		},
		{
			name: "stale authority head plan hash",
			mutate: func(command *aggregate.Command) {
				command.DeliveryPlanHash = valueobject.HashBytes([]byte("stale-plan"))
			},
			wantCode: conversationdomain.ErrorCodeStaleAuthorityHead,
		},
		{
			name: "missing delivery",
			mutate: func(command *aggregate.Command) {
				command.Deliveries = command.Deliveries[:1]
			},
			wantCode: conversationdomain.ErrorCodeDeliverySetMismatch,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture := mustCreateGroup(t)
			command := mustCommand(
				t,
				fixture,
				fixture.owner,
				"rejected-command",
				domainevent.KindMessageCommitted,
				testTime.Add(time.Minute),
			)
			test.mutate(&command)

			_, err := fixture.conversation.ApplyCommand(command)
			assertErrorCode(t, err, test.wantCode)
			if fixture.conversation.AuthorityHead().Sequence != 1 {
				t.Fatalf(
					"rejected command advanced sequence to %d",
					fixture.conversation.AuthorityHead().Sequence,
				)
			}
		})
	}

	t.Run("unauthorized sender", func(t *testing.T) {
		fixture := mustCreateGroup(t)
		outsider := mustEndpoint(t, "ptid:outsider", "outsider-device")
		preparation, err := fixture.conversation.PrepareCommand(
			fixture.owner,
			fixture.conversation.ActiveEndpoints(),
		)
		if err != nil {
			t.Fatalf("PrepareCommand(owner) error = %v", err)
		}
		command := aggregate.Command{
			ID:                      valueobject.CommandID("outsider-command"),
			ConversationID:          fixture.conversation.ID(),
			AuthorityStation:        fixture.station,
			Sender:                  outsider,
			ObservedMembershipEpoch: preparation.Head.MembershipEpoch,
			ObservedMLSEpoch:        preparation.Head.MLSEpoch,
			DeliveryPlanHash:        preparation.DeliveryPlanHash,
			Kind:                    domainevent.KindMessageCommitted,
			MessageID:               valueobject.MessageID("outsider-message"),
			Payload:                 []byte("ciphertext"),
			Deliveries: mustDeliveries(
				t,
				preparation.RequiredEndpoints,
				fixture.station,
				"outsider",
			),
			RequiredEndpoints: preparation.RequiredEndpoints,
			CommittedAt:       testTime.Add(time.Minute),
		}

		_, err = fixture.conversation.ApplyCommand(command)
		assertErrorCode(t, err, conversationdomain.ErrorCodeUnauthorized)
	})
}

func TestConversationApplyMembershipTransition(t *testing.T) {
	t.Run("adds and removes actors and devices", func(t *testing.T) {
		fixture := mustCreateGroup(t)
		charlie := mustEndpoint(t, "ptid:charlie", "charlie-device-1")
		charlieSecond := mustEndpoint(t, "ptid:charlie", "charlie-device-2")

		mustApplyMembershipChange(t, fixture, "add-charlie", entity.MembershipChange{
			Action:      entity.MembershipActionAddActor,
			Actor:       charlie.Actor,
			Device:      charlie.Device,
			HomeStation: fixture.station,
			Role:        valueobject.MemberRoleMember,
		})
		if !fixture.conversation.IsActiveMember(charlie.Actor) ||
			!containsEndpoint(fixture.conversation.ActiveEndpoints(), charlie) {
			t.Fatal("added actor and initial device are not active")
		}

		mustApplyMembershipChange(t, fixture, "add-charlie-device", entity.MembershipChange{
			Action:      entity.MembershipActionAddDevice,
			Actor:       charlieSecond.Actor,
			Device:      charlieSecond.Device,
			HomeStation: fixture.station,
		})
		if !containsEndpoint(fixture.conversation.ActiveEndpoints(), charlieSecond) {
			t.Fatal("added device is not active")
		}

		mustApplyMembershipChange(t, fixture, "remove-charlie-device", entity.MembershipChange{
			Action: entity.MembershipActionRemoveDevice,
			Actor:  charlie.Actor,
			Device: charlie.Device,
		})
		if containsEndpoint(fixture.conversation.ActiveEndpoints(), charlie) {
			t.Fatal("removed device remains active")
		}
		if !containsEndpoint(fixture.conversation.ActiveEndpoints(), charlieSecond) {
			t.Fatal("unrelated actor device was removed")
		}

		mustApplyMembershipChange(t, fixture, "remove-charlie", entity.MembershipChange{
			Action: entity.MembershipActionRemoveActor,
			Actor:  charlie.Actor,
		})
		if fixture.conversation.IsActiveMember(charlie.Actor) {
			t.Fatal("removed actor remains active")
		}
		if containsEndpoint(fixture.conversation.ActiveEndpoints(), charlieSecond) {
			t.Fatal("removed actor retains an active device")
		}

		head := fixture.conversation.AuthorityHead()
		if head.Sequence != 5 || head.MembershipEpoch != 5 || head.MLSEpoch != 5 {
			t.Fatalf("AuthorityHead() = %+v, want sequence and epochs at 5", head)
		}
	})

	t.Run("protects the owner", func(t *testing.T) {
		tests := []entity.MembershipChange{
			{
				Action: entity.MembershipActionRemoveActor,
				Actor:  valueobject.PTID("ptid:owner"),
			},
			{
				Action: entity.MembershipActionLeave,
				Actor:  valueobject.PTID("ptid:owner"),
			},
			{
				Action: entity.MembershipActionChangeRole,
				Actor:  valueobject.PTID("ptid:owner"),
				Role:   valueobject.MemberRoleMember,
			},
		}
		for _, change := range tests {
			fixture := mustCreateGroup(t)
			_, err := fixture.conversation.PreviewMembership(
				fixture.owner,
				[]entity.MembershipChange{change},
			)
			assertErrorCode(t, err, conversationdomain.ErrorCodeOwnerProtected)
		}
	})

	t.Run("rejects stale epochs and plan hashes", func(t *testing.T) {
		tests := []struct {
			name     string
			mutate   func(*aggregate.MembershipTransition)
			wantCode conversationdomain.ErrorCode
		}{
			{
				name: "membership epoch",
				mutate: func(transition *aggregate.MembershipTransition) {
					transition.FromMembership--
				},
				wantCode: conversationdomain.ErrorCodeStaleMembershipEpoch,
			},
			{
				name: "MLS epoch",
				mutate: func(transition *aggregate.MembershipTransition) {
					transition.FromMLS--
				},
				wantCode: conversationdomain.ErrorCodeStaleMembershipEpoch,
			},
			{
				name: "target MLS epoch",
				mutate: func(transition *aggregate.MembershipTransition) {
					transition.ToMLS = transition.FromMLS
				},
				wantCode: conversationdomain.ErrorCodeStaleMembershipEpoch,
			},
			{
				name: "authority plan hash",
				mutate: func(transition *aggregate.MembershipTransition) {
					transition.DeliveryPlanHash = valueobject.HashBytes([]byte("other-plan"))
				},
				wantCode: conversationdomain.ErrorCodeAuthorityPlanStale,
			},
		}
		for _, test := range tests {
			t.Run(test.name, func(t *testing.T) {
				fixture := mustCreateGroup(t)
				transition := mustMembershipTransition(
					t,
					fixture,
					"stale-membership",
					[]entity.MembershipChange{
						{
							Action:      entity.MembershipActionAddActor,
							Actor:       valueobject.PTID("ptid:charlie"),
							Device:      valueobject.DeviceID("charlie-device"),
							HomeStation: fixture.station,
							Role:        valueobject.MemberRoleMember,
						},
					},
				)
				test.mutate(&transition)

				_, err := fixture.conversation.ApplyMembershipTransition(transition)
				assertErrorCode(t, err, test.wantCode)
				if fixture.conversation.AuthorityHead().Sequence != 1 {
					t.Fatalf(
						"rejected membership transition advanced sequence to %d",
						fixture.conversation.AuthorityHead().Sequence,
					)
				}
			})
		}
	})

	t.Run("requires exact planned leaves and delivery kinds", func(t *testing.T) {
		fixture := mustCreateGroup(t)
		charlie := mustEndpoint(t, "ptid:charlie", "charlie-device")
		change := entity.MembershipChange{
			Action:      entity.MembershipActionAddActor,
			Actor:       charlie.Actor,
			Device:      charlie.Device,
			HomeStation: fixture.station,
			Role:        valueobject.MemberRoleMember,
		}

		missingPre := mustMembershipTransition(
			t,
			fixture,
			"missing-pre-endpoint",
			[]entity.MembershipChange{change},
		)
		missingPre.PreEndpoints = []valueobject.Endpoint{fixture.owner}
		missingPre.RequiredEndpoints = endpointUnion(
			missingPre.PreEndpoints,
			missingPre.PostEndpoints,
		)
		missingPre.Deliveries = mustMembershipDeliveries(
			t,
			missingPre,
			fixture.station,
			"missing-pre-endpoint",
		)
		_, err := fixture.conversation.ApplyMembershipTransition(missingPre)
		assertErrorCode(t, err, conversationdomain.ErrorCodeDeliverySetMismatch)

		wrongKind := mustMembershipTransition(
			t,
			fixture,
			"wrong-membership-kind",
			[]entity.MembershipChange{change},
		)
		for index := range wrongKind.Deliveries {
			if wrongKind.Deliveries[index].Recipient == charlie {
				wrongKind.Deliveries[index].Kind = valueobject.DeliveryKindMLSCommit
			}
		}
		_, err = fixture.conversation.ApplyMembershipTransition(wrongKind)
		assertErrorCode(t, err, conversationdomain.ErrorCodeDeliverySetMismatch)
	})
}

func TestConversationMessageActionsRemainDistinct(t *testing.T) {
	t.Run("actor hide is scoped to the requesting actor", func(t *testing.T) {
		fixture := mustCreateGroup(t)
		required := []valueobject.Endpoint{fixture.owner}
		preparation, err := fixture.conversation.PrepareCommand(fixture.owner, required)
		if err != nil {
			t.Fatal(err)
		}
		deliveries := mustDeliveries(t, required, fixture.station, "hide")
		deliveries[0].Kind = valueobject.DeliveryKindPublicEvent
		command := aggregate.Command{
			ID:                      valueobject.CommandID("hide-command"),
			ConversationID:          fixture.conversation.ID(),
			AuthorityStation:        fixture.station,
			Sender:                  fixture.owner,
			ObservedMembershipEpoch: preparation.Head.MembershipEpoch,
			ObservedMLSEpoch:        preparation.Head.MLSEpoch,
			DeliveryPlanHash:        preparation.DeliveryPlanHash,
			Kind:                    domainevent.KindMessageHiddenForActor,
			MessageID:               valueobject.MessageID("message-1"),
			Payload:                 []byte("hide-command"),
			Deliveries:              deliveries,
			RequiredEndpoints:       required,
			CommittedAt:             testTime.Add(time.Minute),
			EventSealer:             testEventSealer{},
		}

		transition, err := fixture.conversation.ApplyCommand(command)
		if err != nil {
			t.Fatal(err)
		}
		if transition.Event.Fact.Kind != domainevent.KindMessageHiddenForActor ||
			len(transition.Deliveries) != 1 ||
			transition.Deliveries[0].Recipient != fixture.owner {
			t.Fatalf("actor-hide transition = %+v", transition)
		}
	})

	t.Run("moderation requires a group administrator and a reason", func(t *testing.T) {
		fixture := mustCreateGroup(t)
		memberCommand := mustCommand(
			t,
			fixture,
			fixture.member,
			"member-moderation",
			domainevent.KindMessageModerated,
			testTime.Add(time.Minute),
		)
		memberCommand.ReasonCode = "group_policy_violation"
		_, err := fixture.conversation.ApplyCommand(memberCommand)
		assertErrorCode(t, err, conversationdomain.ErrorCodeUnauthorized)

		ownerCommand := mustCommand(
			t,
			fixture,
			fixture.owner,
			"owner-moderation",
			domainevent.KindMessageModerated,
			testTime.Add(time.Minute),
		)
		ownerCommand.ReasonCode = "group_policy_violation"
		transition, err := fixture.conversation.ApplyCommand(ownerCommand)
		if err != nil {
			t.Fatal(err)
		}
		if transition.Event.Fact.Kind != domainevent.KindMessageModerated {
			t.Fatalf("moderation event kind = %q", transition.Event.Fact.Kind)
		}
	})

	t.Run("forward is a new MLS destination message", func(t *testing.T) {
		fixture := mustCreateGroup(t)
		command := mustCommand(
			t,
			fixture,
			fixture.owner,
			"forward-command",
			domainevent.KindMessageForwarded,
			testTime.Add(time.Minute),
		)

		transition, err := fixture.conversation.ApplyCommand(command)
		if err != nil {
			t.Fatal(err)
		}
		if transition.Event.Fact.Kind != domainevent.KindMessageForwarded ||
			transition.Event.Fact.MessageID != command.MessageID {
			t.Fatalf("forward transition = %+v", transition)
		}
		for _, delivery := range transition.Deliveries {
			if delivery.Recipient == fixture.owner {
				if delivery.Kind != valueobject.DeliveryKindPublicEvent {
					t.Fatalf("forward sender delivery = %+v", delivery)
				}
				continue
			}
			if delivery.Kind != valueobject.DeliveryKindMLSApplication {
				t.Fatalf("forward recipient delivery = %+v", delivery)
			}
		}
	})
}

func TestConversationRejectsMemberDeviceHomeStationChange(t *testing.T) {
	fixture := mustCreateGroup(t)
	secondDevice := mustEndpoint(t, string(fixture.member.Actor), "member-device-2")

	_, err := fixture.conversation.PreviewMembership(
		fixture.owner,
		[]entity.MembershipChange{{
			Action:      entity.MembershipActionAddDevice,
			Actor:       secondDevice.Actor,
			Device:      secondDevice.Device,
			HomeStation: "station-b",
		}},
	)
	assertErrorCode(t, err, conversationdomain.ErrorCodeDeviceConflict)
}

func TestConversationRejectsContradictoryMembershipBatch(t *testing.T) {
	tests := []struct {
		name     string
		changes  []entity.MembershipChange
		wantCode conversationdomain.ErrorCode
	}{
		{
			name: "add then remove actor",
			changes: []entity.MembershipChange{
				{
					Action:      entity.MembershipActionAddActor,
					Actor:       "ptid:batch-actor",
					Device:      "batch-device",
					HomeStation: "station-a",
					Role:        valueobject.MemberRoleMember,
				},
				{
					Action: entity.MembershipActionRemoveActor,
					Actor:  "ptid:batch-actor",
				},
			},
			wantCode: conversationdomain.ErrorCodeMembershipConflict,
		},
		{
			name: "remove then add same device",
			changes: []entity.MembershipChange{
				{
					Action: entity.MembershipActionRemoveDevice,
					Actor:  "ptid:member",
					Device: "member-device",
				},
				{
					Action:      entity.MembershipActionAddDevice,
					Actor:       "ptid:member",
					Device:      "member-device",
					HomeStation: "station-a",
				},
			},
			wantCode: conversationdomain.ErrorCodeDeviceConflict,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture := mustCreateGroup(t)
			_, err := fixture.conversation.PreviewMembership(fixture.owner, test.changes)
			assertErrorCode(t, err, test.wantCode)
		})
	}
}

func TestConversationActorRejoinAllowsHistoricalDeviceRoute(t *testing.T) {
	fixture := mustCreateGroup(t)
	mustApplyMembershipChange(t, fixture, "remove-member", entity.MembershipChange{
		Action: entity.MembershipActionRemoveActor,
		Actor:  fixture.member.Actor,
	})

	rejoined := mustEndpoint(t, string(fixture.member.Actor), "member-device-2")
	transition := mustMembershipTransition(
		t,
		fixture,
		"rejoin-member",
		[]entity.MembershipChange{{
			Action:      entity.MembershipActionAddActor,
			Actor:       rejoined.Actor,
			Device:      rejoined.Device,
			HomeStation: "station-b",
			Role:        valueobject.MemberRoleMember,
		}},
	)
	for index := range transition.Deliveries {
		if transition.Deliveries[index].Recipient != rejoined {
			continue
		}
		delivery, err := valueobject.NewPreparedDelivery(
			rejoined,
			"station-b",
			transition.Deliveries[index].Kind,
			transition.Deliveries[index].Opaque,
		)
		if err != nil {
			t.Fatal(err)
		}
		transition.Deliveries[index] = delivery
	}
	if _, err := fixture.conversation.ApplyMembershipTransition(transition); err != nil {
		t.Fatalf("ApplyMembershipTransition(rejoin) error = %v", err)
	}

	snapshot := fixture.conversation.Snapshot()
	if _, err := aggregate.Rehydrate(snapshot); err != nil {
		t.Fatalf("Rehydrate(rejoined actor) error = %v", err)
	}
	for _, device := range snapshot.Devices {
		switch device.Endpoint {
		case fixture.member:
			if device.Active || device.HomeStation != fixture.station {
				t.Fatalf("historical device = %+v, want inactive on original Home Station", device)
			}
		case rejoined:
			if !device.Active || device.HomeStation != "station-b" {
				t.Fatalf("rejoined device = %+v, want active on new Home Station", device)
			}
		}
	}
}

func TestConversationMemberAuthorityRoleAndMute(t *testing.T) {
	fixture, admin, member := mustCreateThreeMemberGroup(t)

	adminRole := valueobject.MemberRoleAdmin
	promote := mustMemberAuthorityCommand(
		t,
		fixture,
		fixture.owner,
		member.Actor,
		"promote-member",
		domainevent.MemberAuthorityActionUpdateMember,
		testTime.Add(time.Minute),
	)
	promote.Role = &adminRole
	if _, err := fixture.conversation.ApplyMemberAuthority(promote); err != nil {
		t.Fatalf("ApplyMemberAuthority(promote) error = %v", err)
	}
	if got := mustConversationMember(t, fixture.conversation, member.Actor).Role; got != adminRole {
		t.Fatalf("promoted role = %q, want %q", got, adminRole)
	}

	muted := true
	adminMutePeer := mustMemberAuthorityCommand(
		t,
		fixture,
		admin,
		member.Actor,
		"admin-mute-admin",
		domainevent.MemberAuthorityActionUpdateMember,
		testTime.Add(2*time.Minute),
	)
	adminMutePeer.Muted = &muted
	beforeDenied := fixture.conversation.Snapshot()
	_, err := fixture.conversation.ApplyMemberAuthority(adminMutePeer)
	assertErrorCode(t, err, conversationdomain.ErrorCodeUnauthorized)
	if !reflect.DeepEqual(beforeDenied, fixture.conversation.Snapshot()) {
		t.Fatal("denied admin mute mutated the aggregate")
	}

	memberRole := valueobject.MemberRoleMember
	demote := mustMemberAuthorityCommand(
		t,
		fixture,
		fixture.owner,
		member.Actor,
		"demote-member",
		domainevent.MemberAuthorityActionUpdateMember,
		testTime.Add(3*time.Minute),
	)
	demote.Role = &memberRole
	if _, err := fixture.conversation.ApplyMemberAuthority(demote); err != nil {
		t.Fatalf("ApplyMemberAuthority(demote) error = %v", err)
	}

	mutedUntil := testTime.Add(30 * time.Minute)
	adminMuteMember := mustMemberAuthorityCommand(
		t,
		fixture,
		admin,
		member.Actor,
		"admin-mute-member",
		domainevent.MemberAuthorityActionUpdateMember,
		testTime.Add(4*time.Minute),
	)
	adminMuteMember.Muted = &muted
	adminMuteMember.MutedUntil = &mutedUntil
	transition, err := fixture.conversation.ApplyMemberAuthority(adminMuteMember)
	if err != nil {
		t.Fatalf("ApplyMemberAuthority(mute) error = %v", err)
	}
	committed := mustConversationMember(t, fixture.conversation, member.Actor)
	if !committed.Muted || committed.MutedUntil == nil ||
		!committed.MutedUntil.Equal(mutedUntil) {
		t.Fatalf("committed mute state = %+v", committed)
	}
	if transition.Event.Fact.MemberAuthority == nil ||
		transition.Event.Fact.MemberAuthority.Muted == nil ||
		!*transition.Event.Fact.MemberAuthority.Muted {
		t.Fatalf("member authority fact = %+v", transition.Event.Fact.MemberAuthority)
	}

	blockedSend := mustCommand(
		t,
		fixture,
		member,
		"muted-send",
		domainevent.KindMessageCommitted,
		testTime.Add(5*time.Minute),
	)
	_, err = fixture.conversation.ApplyCommand(blockedSend)
	assertErrorCode(t, err, conversationdomain.ErrorCodeMemberMuted)

	allowedAfterDeadline := mustCommand(
		t,
		fixture,
		member,
		"send-after-mute-deadline",
		domainevent.KindMessageCommitted,
		mutedUntil.Add(time.Second),
	)
	if _, err := fixture.conversation.ApplyCommand(allowedAfterDeadline); err != nil {
		t.Fatalf("ApplyCommand(after mute deadline) error = %v", err)
	}

	ownerProtected := mustMemberAuthorityCommand(
		t,
		fixture,
		fixture.owner,
		fixture.owner.Actor,
		"mutate-owner",
		domainevent.MemberAuthorityActionUpdateMember,
		testTime.Add(31*time.Minute),
	)
	ownerProtected.Muted = &muted
	_, err = fixture.conversation.ApplyMemberAuthority(ownerProtected)
	assertErrorCode(t, err, conversationdomain.ErrorCodeOwnerProtected)

	nonMember := mustMemberAuthorityCommand(
		t,
		fixture,
		fixture.owner,
		"ptid:not-a-member",
		"mute-non-member",
		domainevent.MemberAuthorityActionUpdateMember,
		testTime.Add(32*time.Minute),
	)
	nonMember.Muted = &muted
	_, err = fixture.conversation.ApplyMemberAuthority(nonMember)
	assertErrorCode(t, err, conversationdomain.ErrorCodeTargetNotMember)
}

func TestConversationMemberAuthorityRejectsExpiredAndStaleCommands(t *testing.T) {
	tests := []struct {
		name   string
		code   conversationdomain.ErrorCode
		mutate func(*aggregate.MemberAuthorityCommand)
	}{
		{
			name: "command deadline expired",
			code: conversationdomain.ErrorCodeCommandExpired,
			mutate: func(command *aggregate.MemberAuthorityCommand) {
				command.Deadline = command.CommittedAt
			},
		},
		{
			name: "mute deadline expired",
			code: conversationdomain.ErrorCodeCommandExpired,
			mutate: func(command *aggregate.MemberAuthorityCommand) {
				mutedUntil := command.CommittedAt
				command.MutedUntil = &mutedUntil
			},
		},
		{
			name: "authority sequence stale",
			code: conversationdomain.ErrorCodeStaleAuthorityHead,
			mutate: func(command *aggregate.MemberAuthorityCommand) {
				command.ObservedAuthorityHead.Sequence--
			},
		},
		{
			name: "authority hash stale",
			code: conversationdomain.ErrorCodeStaleAuthorityHead,
			mutate: func(command *aggregate.MemberAuthorityCommand) {
				command.ObservedAuthorityHead.EventHash = valueobject.HashBytes([]byte("stale"))
			},
		},
		{
			name: "authority epoch stale",
			code: conversationdomain.ErrorCodeStaleAuthorityHead,
			mutate: func(command *aggregate.MemberAuthorityCommand) {
				command.ObservedAuthorityEpoch++
			},
		},
		{
			name: "membership epoch stale",
			code: conversationdomain.ErrorCodeStaleMembershipEpoch,
			mutate: func(command *aggregate.MemberAuthorityCommand) {
				command.ObservedMembershipEpoch--
			},
		},
		{
			name: "MLS epoch stale",
			code: conversationdomain.ErrorCodeStaleMLSEpoch,
			mutate: func(command *aggregate.MemberAuthorityCommand) {
				command.ObservedMLSEpoch--
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture := mustCreateGroup(t)
			muted := true
			command := mustMemberAuthorityCommand(
				t,
				fixture,
				fixture.owner,
				fixture.member.Actor,
				"rejected-member-command",
				domainevent.MemberAuthorityActionUpdateMember,
				testTime.Add(time.Minute),
			)
			command.Muted = &muted
			test.mutate(&command)
			before := fixture.conversation.Snapshot()

			_, err := fixture.conversation.ApplyMemberAuthority(command)
			assertErrorCode(t, err, test.code)
			if !reflect.DeepEqual(before, fixture.conversation.Snapshot()) {
				t.Fatal("rejected member authority command mutated the aggregate")
			}
		})
	}
}

func TestConversationOwnerTransferIsAtomicAndFollowerReconcilesSameState(t *testing.T) {
	fixture := mustCreateGroup(t)
	muted := true
	mute := mustMemberAuthorityCommand(
		t,
		fixture,
		fixture.owner,
		fixture.member.Actor,
		"mute-future-owner",
		domainevent.MemberAuthorityActionUpdateMember,
		testTime.Add(time.Minute),
	)
	mute.Muted = &muted
	if _, err := fixture.conversation.ApplyMemberAuthority(mute); err != nil {
		t.Fatalf("ApplyMemberAuthority(mute) error = %v", err)
	}
	before := fixture.conversation.Snapshot()

	transfer := mustMemberAuthorityCommand(
		t,
		fixture,
		fixture.owner,
		fixture.member.Actor,
		"transfer-owner",
		domainevent.MemberAuthorityActionTransferOwnership,
		testTime.Add(2*time.Minute),
	)
	transition, err := fixture.conversation.ApplyMemberAuthority(transfer)
	if err != nil {
		t.Fatalf("ApplyMemberAuthority(transfer) error = %v", err)
	}
	after := fixture.conversation.Snapshot()
	if after.Owner != fixture.member.Actor {
		t.Fatalf("owner = %q, want %q", after.Owner, fixture.member.Actor)
	}
	if after.Head.Sequence != before.Head.Sequence.Next() ||
		after.Head.MembershipEpoch != before.Head.MembershipEpoch.Next() ||
		after.Head.MLSEpoch != before.Head.MLSEpoch {
		t.Fatalf("owner transfer head = %+v, before = %+v", after.Head, before.Head)
	}
	previousOwner := mustConversationMember(t, fixture.conversation, fixture.owner.Actor)
	newOwner := mustConversationMember(t, fixture.conversation, fixture.member.Actor)
	if previousOwner.Role != valueobject.MemberRoleAdmin ||
		newOwner.Role != valueobject.MemberRoleOwner ||
		newOwner.Muted ||
		newOwner.MutedUntil != nil {
		t.Fatalf("atomic owner roles = previous %+v, new %+v", previousOwner, newOwner)
	}
	ownerCount := 0
	for _, member := range after.Members {
		if member.Active() && member.Role == valueobject.MemberRoleOwner {
			ownerCount++
		}
	}
	if ownerCount != 1 {
		t.Fatalf("active owner count = %d, want one", ownerCount)
	}
	mutation := transition.Event.Fact.MemberAuthority
	if mutation == nil ||
		mutation.PreviousOwner != fixture.owner.Actor ||
		mutation.Owner != fixture.member.Actor ||
		mutation.FromMembershipEpoch != before.Head.MembershipEpoch ||
		mutation.ToMembershipEpoch != after.Head.MembershipEpoch ||
		transition.Event.Fact.PostState == nil {
		t.Fatalf("owner transfer fact = %+v", mutation)
	}
	reconciled, err := aggregate.ReconcileCommittedMemberAuthorityProjection(
		before,
		*mutation,
		after,
	)
	if err != nil {
		t.Fatalf("ReconcileCommittedMemberAuthorityProjection() error = %v", err)
	}
	if reconciled.Owner != after.Owner ||
		!reflect.DeepEqual(reconciled.Members, after.Members) {
		t.Fatalf("reconciled snapshot = %+v, want %+v", reconciled, after)
	}

	for _, test := range []struct {
		name   string
		mutate func(*aggregate.Snapshot)
	}{
		{
			name: "no owner",
			mutate: func(snapshot *aggregate.Snapshot) {
				for index := range snapshot.Members {
					if snapshot.Members[index].Actor == snapshot.Owner {
						snapshot.Members[index].Role = valueobject.MemberRoleAdmin
					}
				}
			},
		},
		{
			name: "double owner",
			mutate: func(snapshot *aggregate.Snapshot) {
				for index := range snapshot.Members {
					if snapshot.Members[index].Actor == fixture.owner.Actor {
						snapshot.Members[index].Role = valueobject.MemberRoleOwner
					}
				}
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			contradictory := after
			contradictory.Members = append([]entity.Member(nil), after.Members...)
			test.mutate(&contradictory)
			if _, err := aggregate.ReconcileCommittedMemberAuthorityProjection(
				before,
				*mutation,
				contradictory,
			); err == nil {
				t.Fatal("follower reconciliation accepted contradictory owner state")
			}
		})
	}

	unauthorized := mustMemberAuthorityCommand(
		t,
		fixture,
		fixture.owner,
		fixture.owner.Actor,
		"former-owner-transfer",
		domainevent.MemberAuthorityActionTransferOwnership,
		testTime.Add(3*time.Minute),
	)
	_, err = fixture.conversation.ApplyMemberAuthority(unauthorized)
	assertErrorCode(t, err, conversationdomain.ErrorCodeUnauthorized)
}

func TestConversationUpdateSettings(t *testing.T) {
	fixture := mustCreateGroup(t)
	name := "  Project Room  "
	description := "  Shared planning  "
	timer := uint32(3600)
	command := aggregate.SettingsCommand{
		Command: mustCommand(
			t,
			fixture,
			fixture.owner,
			"settings-command",
			domainevent.KindConversationSettings,
			testTime.Add(time.Minute),
		),
		Patch: valueobject.SettingsPatch{
			Name:                  &name,
			Description:           &description,
			DisappearTimerSeconds: &timer,
		},
	}

	transition, err := fixture.conversation.UpdateSettings(command)
	if err != nil {
		t.Fatalf("UpdateSettings() error = %v", err)
	}
	settings := fixture.conversation.Settings()
	if settings.Name != "Project Room" ||
		settings.Description != "Shared planning" ||
		settings.DisappearTimerSeconds != timer {
		t.Fatalf("Settings() = %+v, want applied and normalized patch", settings)
	}
	if transition.Event.Fact.Kind != domainevent.KindConversationSettings ||
		transition.Event.PreviousHash != fixture.genesis.Event.Hash {
		t.Fatalf("settings event = %+v, want chained settings fact", transition.Event)
	}

	t.Run("rejects unsupported visibility", func(t *testing.T) {
		fixture := mustCreateGroup(t)
		visibility := valueobject.ConversationVisibility("secret")
		_, err := fixture.conversation.UpdateSettings(aggregate.SettingsCommand{
			Command: mustCommand(
				t,
				fixture,
				fixture.owner,
				"invalid-visibility-command",
				domainevent.KindConversationSettings,
				testTime.Add(time.Minute),
			),
			Patch: valueobject.SettingsPatch{Visibility: &visibility},
		})
		assertErrorCode(t, err, conversationdomain.ErrorCodeInvalidArgument)
	})

	t.Run("ordinary member cannot update group settings", func(t *testing.T) {
		fixture := mustCreateGroup(t)
		command := aggregate.SettingsCommand{
			Command: mustCommand(
				t,
				fixture,
				fixture.member,
				"member-settings-command",
				domainevent.KindConversationSettings,
				testTime.Add(time.Minute),
			),
			Patch: valueobject.SettingsPatch{Name: &name},
		}

		_, err := fixture.conversation.UpdateSettings(command)
		assertErrorCode(t, err, conversationdomain.ErrorCodeUnauthorized)
	})
}

func TestConversationProtectsCanonicalOwner(t *testing.T) {
	tests := []struct {
		name   string
		change entity.MembershipChange
	}{
		{
			name: "cannot promote another actor to owner",
			change: entity.MembershipChange{
				Action: entity.MembershipActionChangeRole,
				Actor:  "ptid:member",
				Role:   valueobject.MemberRoleOwner,
			},
		},
		{
			name: "cannot add a second owner",
			change: entity.MembershipChange{
				Action:      entity.MembershipActionAddActor,
				Actor:       "ptid:other-owner",
				Device:      "other-owner-device",
				HomeStation: "station-a",
				Role:        valueobject.MemberRoleOwner,
			},
		},
		{
			name: "cannot remove the owner's final active endpoint",
			change: entity.MembershipChange{
				Action: entity.MembershipActionRemoveDevice,
				Actor:  "ptid:owner",
				Device: "owner-device",
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture := mustCreateGroup(t)
			_, err := fixture.conversation.PreviewMembership(
				fixture.owner,
				[]entity.MembershipChange{test.change},
			)
			assertErrorCode(t, err, conversationdomain.ErrorCodeOwnerProtected)
		})
	}
}

func TestConversationDissolve(t *testing.T) {
	fixture := mustCreateGroup(t)
	memberCommand := aggregate.DissolveCommand{
		Command: mustCommand(
			t,
			fixture,
			fixture.member,
			"member-dissolve",
			domainevent.KindConversationDissolved,
			testTime.Add(time.Minute),
		),
	}
	_, err := fixture.conversation.Dissolve(memberCommand)
	assertErrorCode(t, err, conversationdomain.ErrorCodeUnauthorized)

	ownerCommand := aggregate.DissolveCommand{
		Command: mustCommand(
			t,
			fixture,
			fixture.owner,
			"owner-dissolve",
			domainevent.KindConversationDissolved,
			testTime.Add(2*time.Minute),
		),
	}
	transition, err := fixture.conversation.Dissolve(ownerCommand)
	if err != nil {
		t.Fatalf("Dissolve(owner) error = %v", err)
	}
	if fixture.conversation.Status() != valueobject.ConversationStatusDissolved {
		t.Fatalf("Status() = %q, want dissolved", fixture.conversation.Status())
	}
	if transition.Event.Fact.Kind != domainevent.KindConversationDissolved {
		t.Fatalf(
			"dissolve event kind = %q, want %q",
			transition.Event.Fact.Kind,
			domainevent.KindConversationDissolved,
		)
	}

	_, err = fixture.conversation.PrepareCommand(
		fixture.owner,
		fixture.conversation.ActiveEndpoints(),
	)
	assertErrorCode(t, err, conversationdomain.ErrorCodeInactive)
}

func TestRehydrateRejectsMalformedPersistedMembershipState(t *testing.T) {
	fixture := mustCreateGroup(t)
	valid := fixture.conversation.Snapshot()

	tests := []struct {
		name   string
		mutate func(*aggregate.Snapshot)
	}{
		{
			name: "unsupported conversation status",
			mutate: func(snapshot *aggregate.Snapshot) {
				snapshot.Status = "corrupt"
			},
		},
		{
			name: "zero group membership epoch",
			mutate: func(snapshot *aggregate.Snapshot) {
				snapshot.Head.MembershipEpoch = 0
			},
		},
		{
			name: "zero group MLS epoch",
			mutate: func(snapshot *aggregate.Snapshot) {
				snapshot.Head.MLSEpoch = 0
			},
		},
		{
			name: "divergent group epochs",
			mutate: func(snapshot *aggregate.Snapshot) {
				snapshot.Head.MLSEpoch = snapshot.Head.MembershipEpoch.Next()
			},
		},
		{
			name: "unsupported member role",
			mutate: func(snapshot *aggregate.Snapshot) {
				snapshot.Members[0].Role = "corrupt"
			},
		},
		{
			name: "unsupported member status",
			mutate: func(snapshot *aggregate.Snapshot) {
				snapshot.Members[0].Status = "corrupt"
			},
		},
		{
			name: "member without Home Station",
			mutate: func(snapshot *aggregate.Snapshot) {
				snapshot.Members[0].HomeStation = ""
			},
		},
		{
			name: "member without joined sequence",
			mutate: func(snapshot *aggregate.Snapshot) {
				snapshot.Members[0].JoinedAt = 0
			},
		},
		{
			name: "active member with leave sequence",
			mutate: func(snapshot *aggregate.Snapshot) {
				snapshot.Members[0].LeftAt = snapshot.Head.Sequence
			},
		},
		{
			name: "duplicate member",
			mutate: func(snapshot *aggregate.Snapshot) {
				snapshot.Members = append(snapshot.Members, snapshot.Members[0])
			},
		},
		{
			name: "orphaned device",
			mutate: func(snapshot *aggregate.Snapshot) {
				snapshot.Devices[0].Endpoint.Actor = "ptid:orphan"
			},
		},
		{
			name: "duplicate endpoint",
			mutate: func(snapshot *aggregate.Snapshot) {
				snapshot.Devices = append(snapshot.Devices, snapshot.Devices[0])
			},
		},
		{
			name: "device without Home Station",
			mutate: func(snapshot *aggregate.Snapshot) {
				snapshot.Devices[0].HomeStation = ""
			},
		},
		{
			name: "active device with leave sequence",
			mutate: func(snapshot *aggregate.Snapshot) {
				snapshot.Devices[0].LeftAt = snapshot.Head.Sequence
			},
		},
		{
			name: "device lifecycle beyond head",
			mutate: func(snapshot *aggregate.Snapshot) {
				snapshot.Devices[0].JoinedAt = snapshot.Head.Sequence.Next()
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			snapshot := valid
			snapshot.Members = append([]entity.Member(nil), valid.Members...)
			snapshot.Devices = append([]entity.MemberDevice(nil), valid.Devices...)
			test.mutate(&snapshot)

			if _, err := aggregate.Rehydrate(snapshot); err == nil {
				t.Fatal("Rehydrate() accepted malformed persisted state")
			}
		})
	}
}

func TestRehydrateRejectsMalformedDirectState(t *testing.T) {
	alice := mustEndpoint(t, "ptid:direct-alice", "alice-device")
	bob := mustEndpoint(t, "ptid:direct-bob", "bob-device")
	station := valueobject.StationID("station-a")
	conversation, _, err := aggregate.CreateDirect(aggregate.CreateInput{
		FederationID:     testFederationID,
		AuthorityStation: station,
		AuthorityEpoch:   testAuthorityEpoch,
		Participants: []aggregate.Participant{
			{Actor: alice.Actor, HomeStation: station},
			{Actor: bob.Actor, HomeStation: station},
		},
		Devices: []entity.MemberDevice{
			mustMemberDevice(t, alice, station),
			mustMemberDevice(t, bob, station),
		},
		CommandID:    "direct-rehydrate",
		Creator:      alice,
		Deliveries:   mustDeliveries(t, []valueobject.Endpoint{alice, bob}, station, "direct-rehydrate"),
		EventPayload: []byte("direct-rehydrate"),
		CreatedAt:    testTime,
		EventSealer:  testEventSealer{},
	})
	if err != nil {
		t.Fatal(err)
	}
	valid := conversation.Snapshot()
	charlie, err := entity.NewMember(
		"ptid:direct-charlie",
		valueobject.MemberRoleMember,
		station,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name   string
		mutate func(*aggregate.Snapshot)
	}{
		{
			name: "non-deterministic conversation ID",
			mutate: func(snapshot *aggregate.Snapshot) {
				snapshot.ID = "direct-other"
			},
		},
		{
			name: "non-canonical owner",
			mutate: func(snapshot *aggregate.Snapshot) {
				snapshot.Owner = bob.Actor
				if snapshot.Owner == valid.Owner {
					snapshot.Owner = alice.Actor
				}
			},
		},
		{
			name: "extra member",
			mutate: func(snapshot *aggregate.Snapshot) {
				snapshot.Members = append(snapshot.Members, charlie)
			},
		},
		{
			name: "owner role",
			mutate: func(snapshot *aggregate.Snapshot) {
				snapshot.Members[0].Role = valueobject.MemberRoleOwner
			},
		},
		{
			name: "advanced membership epoch",
			mutate: func(snapshot *aggregate.Snapshot) {
				snapshot.Head.MembershipEpoch = 2
			},
		},
		{
			name: "non-zero MLS epoch",
			mutate: func(snapshot *aggregate.Snapshot) {
				snapshot.Head.MLSEpoch = 1
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			snapshot := valid
			snapshot.Members = append([]entity.Member(nil), valid.Members...)
			snapshot.Devices = append([]entity.MemberDevice(nil), valid.Devices...)
			test.mutate(&snapshot)

			if _, err := aggregate.Rehydrate(snapshot); err == nil {
				t.Fatal("Rehydrate() accepted malformed persisted Direct state")
			}
		})
	}
}

func TestUpdateSettingsEventUsesNormalizedCommittedValues(t *testing.T) {
	fixture := mustCreateGroup(t)
	name := "  Normalized Group  "
	description := "  Normalized description  "
	avatar := "  object-avatar  "
	command := aggregate.SettingsCommand{
		Command: mustCommand(
			t,
			fixture,
			fixture.owner,
			"normalized-settings",
			domainevent.KindConversationSettings,
			testTime.Add(time.Minute),
		),
		Patch: valueobject.SettingsPatch{
			Name:           &name,
			Description:    &description,
			AvatarObjectID: &avatar,
		},
	}

	transition, err := fixture.conversation.UpdateSettings(command)
	if err != nil {
		t.Fatal(err)
	}
	settings := fixture.conversation.Settings()
	if settings.Name != "Normalized Group" ||
		settings.Description != "Normalized description" ||
		settings.AvatarObjectID != "object-avatar" {
		t.Fatalf("committed settings = %+v", settings)
	}
	eventPatch := transition.Event.Fact.SettingsPatch
	if eventPatch.Name == nil || *eventPatch.Name != settings.Name ||
		eventPatch.Description == nil || *eventPatch.Description != settings.Description ||
		eventPatch.AvatarObjectID == nil || *eventPatch.AvatarObjectID != settings.AvatarObjectID {
		t.Fatalf("event settings patch = %+v, committed settings = %+v", eventPatch, settings)
	}
}

func mustCreateGroup(t *testing.T) conversationFixture {
	t.Helper()

	owner := mustEndpoint(t, "ptid:owner", "owner-device")
	member := mustEndpoint(t, "ptid:member", "member-device")
	station := valueobject.StationID("station-a")
	conversation, transition, err := aggregate.CreateGroup(aggregate.CreateInput{
		ID:               valueobject.ConversationID("group-1"),
		FederationID:     testFederationID,
		AuthorityStation: station,
		AuthorityEpoch:   testAuthorityEpoch,
		Owner:            owner.Actor,
		Participants: []aggregate.Participant{
			{Actor: owner.Actor, HomeStation: station},
			{Actor: member.Actor, HomeStation: station},
		},
		Devices: []entity.MemberDevice{
			mustMemberDevice(t, owner, station),
			mustMemberDevice(t, member, station),
		},
		Settings: valueobject.ConversationSettings{
			Name:       "Initial Group",
			Visibility: "private",
		},
		CommandID: valueobject.CommandID("create-group"),
		Creator:   owner,
		Deliveries: mustGroupCreationDeliveries(
			t,
			[]valueobject.Endpoint{owner, member},
			station,
			owner,
			"group-genesis",
		),
		EventPayload: []byte("group-created"),
		CreatedAt:    testTime,
		EventSealer:  testEventSealer{},
	})
	if err != nil {
		t.Fatalf("CreateGroup() error = %v", err)
	}

	return conversationFixture{
		conversation: conversation,
		owner:        owner,
		member:       member,
		station:      station,
		genesis:      transition,
	}
}

func mustCreateThreeMemberGroup(
	t *testing.T,
) (conversationFixture, valueobject.Endpoint, valueobject.Endpoint) {
	t.Helper()

	owner := mustEndpoint(t, "ptid:authority-owner", "owner-device")
	admin := mustEndpoint(t, "ptid:authority-admin", "admin-device")
	member := mustEndpoint(t, "ptid:authority-member", "member-device")
	station := valueobject.StationID("station-a")
	conversation, transition, err := aggregate.CreateGroup(aggregate.CreateInput{
		ID:               valueobject.ConversationID("group-member-authority"),
		FederationID:     testFederationID,
		AuthorityStation: station,
		AuthorityEpoch:   testAuthorityEpoch,
		Owner:            owner.Actor,
		Participants: []aggregate.Participant{
			{Actor: owner.Actor, HomeStation: station},
			{Actor: admin.Actor, HomeStation: station, Role: valueobject.MemberRoleAdmin},
			{Actor: member.Actor, HomeStation: station, Role: valueobject.MemberRoleMember},
		},
		Devices: []entity.MemberDevice{
			mustMemberDevice(t, owner, station),
			mustMemberDevice(t, admin, station),
			mustMemberDevice(t, member, station),
		},
		Settings: valueobject.ConversationSettings{
			Name:       "Member Authority Group",
			Visibility: "private",
		},
		CommandID: valueobject.CommandID("create-member-authority-group"),
		Creator:   owner,
		Deliveries: mustGroupCreationDeliveries(
			t,
			[]valueobject.Endpoint{owner, admin, member},
			station,
			owner,
			"member-authority-genesis",
		),
		EventPayload: []byte("member-authority-group-created"),
		CreatedAt:    testTime,
		EventSealer:  testEventSealer{},
	})
	if err != nil {
		t.Fatalf("CreateGroup(member authority) error = %v", err)
	}

	return conversationFixture{
		conversation: conversation,
		owner:        owner,
		member:       member,
		station:      station,
		genesis:      transition,
	}, admin, member
}

func mustMemberAuthorityCommand(
	t *testing.T,
	fixture conversationFixture,
	operator valueobject.Endpoint,
	target valueobject.PTID,
	id string,
	action domainevent.MemberAuthorityAction,
	at time.Time,
) aggregate.MemberAuthorityCommand {
	t.Helper()

	command := mustCommand(
		t,
		fixture,
		operator,
		id,
		domainevent.KindMemberAuthority,
		at,
	)
	return aggregate.MemberAuthorityCommand{
		Command:                command,
		Action:                 action,
		Target:                 target,
		ObservedAuthorityHead:  fixture.conversation.AuthorityHead(),
		ObservedFederationID:   fixture.conversation.FederationID(),
		ObservedAuthorityEpoch: fixture.conversation.AuthorityEpoch(),
		Deadline:               at.Add(5 * time.Minute),
	}
}

func mustConversationMember(
	t *testing.T,
	conversation *aggregate.Conversation,
	actor valueobject.PTID,
) entity.Member {
	t.Helper()

	for _, member := range conversation.Members() {
		if member.Actor == actor {
			return member
		}
	}
	t.Fatalf("member %q is missing", actor)
	return entity.Member{}
}

func mustCommand(
	t *testing.T,
	fixture conversationFixture,
	sender valueobject.Endpoint,
	id string,
	kind domainevent.Kind,
	at time.Time,
) aggregate.Command {
	t.Helper()

	required := fixture.conversation.ActiveEndpoints()
	preparation, err := fixture.conversation.PrepareCommand(sender, required)
	if err != nil {
		t.Fatalf("PrepareCommand() error = %v", err)
	}
	deliveries := mustDeliveries(t, required, fixture.station, id)
	for index := range deliveries {
		switch {
		case deliveries[index].Recipient == sender:
			deliveries[index].Kind = valueobject.DeliveryKindPublicEvent
		case kind == domainevent.KindMessageCommitted ||
			kind == domainevent.KindMessageForwarded ||
			kind == domainevent.KindMessageEdited:
			deliveries[index].Kind = valueobject.DeliveryKindMLSApplication
		default:
			deliveries[index].Kind = valueobject.DeliveryKindPublicEvent
		}
	}

	command := aggregate.Command{
		ID:                      valueobject.CommandID(id),
		ConversationID:          fixture.conversation.ID(),
		AuthorityStation:        fixture.station,
		Sender:                  sender,
		ObservedMembershipEpoch: preparation.Head.MembershipEpoch,
		ObservedMLSEpoch:        preparation.Head.MLSEpoch,
		DeliveryPlanHash:        preparation.DeliveryPlanHash,
		Kind:                    kind,
		MessageID:               valueobject.MessageID("message-" + id),
		Payload:                 []byte("payload-" + id),
		Deliveries:              deliveries,
		RequiredEndpoints:       preparation.RequiredEndpoints,
		CommittedAt:             at,
		EventSealer:             testEventSealer{},
	}
	if kind == domainevent.KindReactionCommitted {
		command.Reaction = "like"
	}
	return command
}

func mustMembershipTransition(
	t *testing.T,
	fixture conversationFixture,
	id string,
	changes []entity.MembershipChange,
) aggregate.MembershipTransition {
	t.Helper()

	preview, err := fixture.conversation.PreviewMembership(fixture.owner, changes)
	if err != nil {
		t.Fatalf("PreviewMembership() error = %v", err)
	}
	required := endpointUnion(preview.PreEndpoints, preview.PostEndpoints)
	planHash := valueobject.HashBytes([]byte("authority-plan-" + id))
	deliveries := mustDeliveries(t, required, fixture.station, id)
	added := endpointKeys(preview.AddedEndpoints)
	removed := endpointKeys(preview.RemovedEndpoints)
	for index := range deliveries {
		switch {
		case containsEndpointKeySet(removed, deliveries[index].Recipient):
			deliveries[index].Kind = valueobject.DeliveryKindMLSRetirement
		case containsEndpointKeySet(added, deliveries[index].Recipient):
			deliveries[index].Kind = valueobject.DeliveryKindMLSWelcome
		case deliveries[index].Recipient == fixture.owner:
			deliveries[index].Kind = valueobject.DeliveryKindPublicEvent
		default:
			deliveries[index].Kind = valueobject.DeliveryKindMLSCommit
		}
	}

	return aggregate.MembershipTransition{
		Command: aggregate.Command{
			ID:                      valueobject.CommandID(id),
			ConversationID:          fixture.conversation.ID(),
			AuthorityStation:        fixture.station,
			Sender:                  fixture.owner,
			ObservedMembershipEpoch: preview.Head.MembershipEpoch,
			ObservedMLSEpoch:        preview.Head.MLSEpoch,
			DeliveryPlanHash:        planHash,
			Kind:                    domainevent.KindMembershipCommitted,
			Payload:                 []byte("membership-" + id),
			Deliveries:              deliveries,
			RequiredEndpoints:       required,
			CommittedAt:             testTime.Add(time.Duration(preview.Head.Sequence) * time.Minute),
			EventSealer:             testEventSealer{},
		},
		TransitionID:      valueobject.TransitionID("transition-" + id),
		AuthorityPlanID:   valueobject.PlanID("plan-" + id),
		AuthorityPlanHash: planHash,
		FromMembership:    preview.Head.MembershipEpoch,
		FromMLS:           preview.Head.MLSEpoch,
		ToMLS:             preview.Head.MLSEpoch.Next(),
		Changes:           changes,
		PreEndpoints:      preview.PreEndpoints,
		PostEndpoints:     preview.PostEndpoints,
	}
}

func mustApplyMembershipChange(
	t *testing.T,
	fixture conversationFixture,
	id string,
	change entity.MembershipChange,
) aggregate.Transition {
	t.Helper()

	transition := mustMembershipTransition(t, fixture, id, []entity.MembershipChange{change})
	result, err := fixture.conversation.ApplyMembershipTransition(transition)
	if err != nil {
		t.Fatalf("ApplyMembershipTransition(%s) error = %v", id, err)
	}

	return result
}

func mustEndpoint(t *testing.T, actor string, device string) valueobject.Endpoint {
	t.Helper()

	endpoint, err := valueobject.NewEndpoint(actor, device)
	if err != nil {
		t.Fatalf("NewEndpoint(%q, %q) error = %v", actor, device, err)
	}

	return endpoint
}

func mustMemberDevice(
	t *testing.T,
	endpoint valueobject.Endpoint,
	station valueobject.StationID,
) entity.MemberDevice {
	t.Helper()

	device, err := entity.NewMemberDevice(endpoint, station, 1)
	if err != nil {
		t.Fatalf("NewMemberDevice(%+v) error = %v", endpoint, err)
	}

	return device
}

func mustDeliveries(
	t *testing.T,
	endpoints []valueobject.Endpoint,
	station valueobject.StationID,
	label string,
) []valueobject.PreparedDelivery {
	t.Helper()

	deliveries := make([]valueobject.PreparedDelivery, 0, len(endpoints))
	for index, endpoint := range endpoints {
		delivery, err := valueobject.NewPreparedDelivery(
			endpoint,
			station,
			valueobject.DeliveryKindConversation,
			[]byte(label+"-"+string(rune('a'+index))),
		)
		if err != nil {
			t.Fatalf("NewPreparedDelivery(%+v) error = %v", endpoint, err)
		}
		deliveries = append(deliveries, delivery)
	}

	return deliveries
}

func mustGroupCreationDeliveries(
	t *testing.T,
	endpoints []valueobject.Endpoint,
	station valueobject.StationID,
	creator valueobject.Endpoint,
	label string,
) []valueobject.PreparedDelivery {
	deliveries := mustDeliveries(t, endpoints, station, label)
	for index := range deliveries {
		if deliveries[index].Recipient == creator {
			deliveries[index].Kind = valueobject.DeliveryKindPublicEvent
		} else {
			deliveries[index].Kind = valueobject.DeliveryKindMLSWelcome
		}
	}
	return deliveries
}

func mustMembershipDeliveries(
	t *testing.T,
	transition aggregate.MembershipTransition,
	station valueobject.StationID,
	label string,
) []valueobject.PreparedDelivery {
	t.Helper()
	deliveries := mustDeliveries(t, transition.RequiredEndpoints, station, label)
	added := endpointKeys(endpointDifference(transition.PostEndpoints, transition.PreEndpoints))
	removed := endpointKeys(endpointDifference(transition.PreEndpoints, transition.PostEndpoints))
	for index := range deliveries {
		switch {
		case containsEndpointKeySet(removed, deliveries[index].Recipient):
			deliveries[index].Kind = valueobject.DeliveryKindMLSRetirement
		case containsEndpointKeySet(added, deliveries[index].Recipient):
			deliveries[index].Kind = valueobject.DeliveryKindMLSWelcome
		case deliveries[index].Recipient == transition.Sender:
			deliveries[index].Kind = valueobject.DeliveryKindPublicEvent
		default:
			deliveries[index].Kind = valueobject.DeliveryKindMLSCommit
		}
	}
	return deliveries
}

func endpointKeys(endpoints []valueobject.Endpoint) map[string]struct{} {
	result := make(map[string]struct{}, len(endpoints))
	for _, endpoint := range endpoints {
		result[endpoint.Key()] = struct{}{}
	}
	return result
}

func containsEndpointKeySet(endpoints map[string]struct{}, target valueobject.Endpoint) bool {
	_, exists := endpoints[target.Key()]
	return exists
}

func endpointUnion(
	left []valueobject.Endpoint,
	right []valueobject.Endpoint,
) []valueobject.Endpoint {
	byKey := make(map[string]valueobject.Endpoint, len(left)+len(right))
	for _, endpoint := range append(append([]valueobject.Endpoint(nil), left...), right...) {
		byKey[endpoint.Key()] = endpoint
	}
	result := make([]valueobject.Endpoint, 0, len(byKey))
	for _, endpoint := range byKey {
		result = append(result, endpoint)
	}

	return valueobject.SortEndpoints(result)
}

func endpointDifference(
	left []valueobject.Endpoint,
	right []valueobject.Endpoint,
) []valueobject.Endpoint {
	rightKeys := endpointKeys(right)
	result := make([]valueobject.Endpoint, 0, len(left))
	for _, endpoint := range left {
		if !containsEndpointKeySet(rightKeys, endpoint) {
			result = append(result, endpoint)
		}
	}
	return valueobject.SortEndpoints(result)
}

func containsEndpoint(endpoints []valueobject.Endpoint, target valueobject.Endpoint) bool {
	for _, endpoint := range endpoints {
		if endpoint == target {
			return true
		}
	}

	return false
}

func assertErrorCode(t *testing.T, err error, want conversationdomain.ErrorCode) {
	t.Helper()

	if !conversationdomain.IsCode(err, want) {
		t.Fatalf("error = %v (code %q), want code %q", err, conversationdomain.CodeOf(err), want)
	}
}
