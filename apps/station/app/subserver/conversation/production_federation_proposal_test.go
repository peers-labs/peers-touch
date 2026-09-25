package conversation

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/query"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestValidateConversationProposalFollowerHead(t *testing.T) {
	proposal := productionTestConversationProposal(t)
	valid := query.PublicHead{
		ConversationID:   valueobject.ConversationID("conversation-1"),
		Source:           query.SourceFollower,
		FederationID:     valueobject.FederationID("federation-1"),
		AuthorityStation: valueobject.StationID("station-four"),
		AuthorityEpoch:   valueobject.AuthorityEpoch(3),
		Status:           valueobject.ConversationStatusActive,
		FollowerStatus:   repository.FollowerStatusActive,
	}
	if err := validateConversationProposalFollowerHead(proposal, valid); err != nil {
		t.Fatalf("valid follower head rejected: %v", err)
	}

	tests := []struct {
		name   string
		mutate func(*query.PublicHead)
	}{
		{
			name: "authority source",
			mutate: func(head *query.PublicHead) {
				head.Source = query.SourceAuthority
			},
		},
		{
			name: "read-only follower",
			mutate: func(head *query.PublicHead) {
				head.FollowerStatus = repository.FollowerStatusReadOnly
			},
		},
		{
			name: "inactive conversation",
			mutate: func(head *query.PublicHead) {
				head.Status = valueobject.ConversationStatusDegradedReadOnly
			},
		},
		{
			name: "federation drift",
			mutate: func(head *query.PublicHead) {
				head.FederationID = "federation-other"
			},
		},
		{
			name: "authority drift",
			mutate: func(head *query.PublicHead) {
				head.AuthorityStation = "station-other"
			},
		},
		{
			name: "authority epoch drift",
			mutate: func(head *query.PublicHead) {
				head.AuthorityEpoch++
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			head := valid
			test.mutate(&head)
			err := validateConversationProposalFollowerHead(proposal, head)
			if !conversationdomain.IsCode(err, conversationdomain.ErrorCodeProposalBinding) {
				t.Fatalf("error = %v, want proposal binding", err)
			}
		})
	}
}

func TestExistingConversationProposalReplayRequiresExactBytes(t *testing.T) {
	database, err := gorm.Open(
		sqlite.Open("file:conversation-proposal-replay-"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.AutoMigrate(&federationdelivery.OutboxRecord{}); err != nil {
		t.Fatal(err)
	}
	proposal := productionTestConversationProposal(t)
	payload, err := deterministicProductionProto(proposal)
	if err != nil {
		t.Fatal(err)
	}
	frame := &federationdelivery.Frame{
		SourceStationPeerId: "station-five",
		TargetStationPeerId: proposal.GetAuthorityStationPeerId(),
		PayloadKind:         federationdelivery.PayloadKindConversationAuthorityCommand,
		PayloadId:           proposal.GetCommand().GetCommandId(),
		OpaquePayload:       payload,
	}
	frameBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(frame)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.September, 8, 12, 0, 0, 0, time.UTC)
	record := federationdelivery.OutboxRecord{
		FrameID:             "frame-1",
		SourceStationPeerID: "station-five",
		TargetStationPeerID: "station-four",
		IdempotencyKey:      "proposal-command-1",
		PayloadKind:         int32(federationdelivery.PayloadKindConversationAuthorityCommand),
		PayloadID:           "command-1",
		OrderingKey:         "conversation-authority-command:conversation-1",
		OrderingSequence:    1,
		FrameBytes:          frameBytes,
		PayloadSHA256:       federationdelivery.PayloadSHA256(payload),
		CanonicalSHA256:     make([]byte, 32),
		State:               federationdelivery.OutboxStatePending,
		NextAttemptAt:       now,
		ExpiresAt:           now.Add(time.Minute),
		CreatedAt:           now,
	}
	if err := database.Create(&record).Error; err != nil {
		t.Fatal(err)
	}

	exact, err := existingConversationProposalReplay(
		context.Background(),
		database,
		"station-five",
		proposal,
		now,
	)
	if err != nil || !exact {
		t.Fatalf("exact replay = %v, %v", exact, err)
	}

	conflict := proto.Clone(proposal).(*chatmodel.ConversationCommandProposal)
	conflict.AuthorityEpoch++
	exact, err = existingConversationProposalReplay(
		context.Background(),
		database,
		"station-five",
		conflict,
		now,
	)
	if exact || !conversationdomain.IsCode(err, conversationdomain.ErrorCodeCommandConflict) {
		t.Fatalf("conflicting replay = %v, %v", exact, err)
	}

	for _, test := range []struct {
		state federationdelivery.OutboxState
		code  conversationdomain.ErrorCode
	}{
		{
			state: federationdelivery.OutboxStateExpired,
			code:  conversationdomain.ErrorCodeProposalExpired,
		},
		{
			state: federationdelivery.OutboxStateTerminal,
			code:  conversationdomain.ErrorCodeProposalInvalid,
		},
	} {
		if err := database.Model(&federationdelivery.OutboxRecord{}).
			Where("frame_id = ?", record.FrameID).
			Update("state", test.state).Error; err != nil {
			t.Fatal(err)
		}
		exact, err = existingConversationProposalReplay(
			context.Background(),
			database,
			"station-five",
			proposal,
			now,
		)
		if exact || !conversationdomain.IsCode(err, test.code) {
			t.Fatalf("%s replay = %v, %v", test.state, exact, err)
		}
	}

	if err := database.Model(&federationdelivery.OutboxRecord{}).
		Where("frame_id = ?", record.FrameID).
		Updates(map[string]any{
			"state":      federationdelivery.OutboxStatePending,
			"expires_at": now,
		}).Error; err != nil {
		t.Fatal(err)
	}
	exact, err = existingConversationProposalReplay(
		context.Background(),
		database,
		"station-five",
		proposal,
		now,
	)
	if exact || !conversationdomain.IsCode(err, conversationdomain.ErrorCodeProposalExpired) {
		t.Fatalf("logically expired replay = %v, %v", exact, err)
	}
}

func TestValidateNewConversationProposalRejectsExpiredAndUnsupportedCommands(t *testing.T) {
	proposal := productionTestConversationProposal(t)
	if err := validateNewConversationProposal(proposal, time.UnixMilli(2_000)); err != nil {
		t.Fatalf("valid proposal rejected: %v", err)
	}

	if err := validateNewConversationProposal(
		proposal,
		time.UnixMilli(proposal.GetExpiresAtUnixMs()),
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeProposalExpired) {
		t.Fatalf("expired proposal error = %v", err)
	}

	unsupported := proto.Clone(proposal).(*chatmodel.ConversationCommandProposal)
	unsupported.Command.Payload = nil
	commandBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(unsupported.Command)
	if err != nil {
		t.Fatal(err)
	}
	unsupported.CommandSha256 = federationdelivery.PayloadSHA256(commandBytes)
	if err := validateNewConversationProposal(
		unsupported,
		time.UnixMilli(2_000),
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeProposalInvalid) {
		t.Fatalf("unsupported proposal error = %v", err)
	}
}

func TestValidateNewConversationProposalAcceptsBoundMemberAuthority(t *testing.T) {
	proposal := productionTestMemberAuthorityProposal(t)
	if err := validateNewConversationProposal(proposal, time.UnixMilli(2_000)); err != nil {
		t.Fatalf("valid member-authority proposal rejected: %v", err)
	}

	tampered := proto.Clone(proposal).(*chatmodel.ConversationCommandProposal)
	tampered.MemberAuthorityCommand.AuthorityEpoch++
	if err := validateNewConversationProposal(
		tampered,
		time.UnixMilli(2_000),
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeProposalBinding) {
		t.Fatalf("member-authority authority mismatch error = %v", err)
	}
}

func productionTestConversationProposal(t *testing.T) *chatmodel.ConversationCommandProposal {
	t.Helper()
	command := &chatmodel.ChatCommand{
		CommandId:              "command-1",
		ConversationId:         "conversation-1",
		Sender:                 &chatmodel.CryptoEndpoint{Ptid: "ptid:bob", DeviceId: "bob-device"},
		AuthorityStationPeerId: "station-four",
		Payload: &chatmodel.ChatCommand_SendMessage{
			SendMessage: &chatmodel.SendMessageIntent{MessageId: "message-1"},
		},
	}
	commandBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(command)
	if err != nil {
		t.Fatal(err)
	}

	return &chatmodel.ConversationCommandProposal{
		Version:                1,
		FederationId:           "federation-1",
		AuthorityStationPeerId: "station-four",
		AuthorityEpoch:         3,
		HomeStationPeerId:      "station-five",
		ActorPtid:              "ptid:bob",
		ActorDeviceId:          "bob-device",
		ActorSigningKeyId:      "signing-key-1",
		Command:                command,
		CommandSha256:          federationdelivery.PayloadSHA256(commandBytes),
		ActorSignature:         make([]byte, 64),
		CreatedAtUnixMs:        1_000,
		ExpiresAtUnixMs:        301_000,
	}
}

func productionTestMemberAuthorityProposal(
	t *testing.T,
) *chatmodel.ConversationCommandProposal {
	t.Helper()
	command := &chatmodel.ConversationMemberAuthorityCommand{
		Version:                 1,
		CommandId:               "member-command-1",
		ConversationId:          "conversation-1",
		Operator:                &chatmodel.CryptoEndpoint{Ptid: "ptid:bob", DeviceId: "bob-device"},
		TargetPtid:              "ptid:alice",
		Action:                  chatmodel.ConversationMemberAuthorityAction_CONVERSATION_MEMBER_AUTHORITY_ACTION_UPDATE_MEMBER,
		FederationId:            "federation-1",
		AuthorityStationPeerId:  "station-four",
		AuthorityEpoch:          3,
		AuthoritySequence:       2,
		AuthorityHash:           make([]byte, 32),
		ObservedMembershipEpoch: 1,
		ObservedMlsEpoch:        1,
		ClientTimestamp:         timestamppb.New(time.UnixMilli(1_000)),
		Deadline:                timestamppb.New(time.UnixMilli(301_000)),
	}
	commandBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(command)
	if err != nil {
		t.Fatal(err)
	}
	return &chatmodel.ConversationCommandProposal{
		Version:                1,
		FederationId:           command.GetFederationId(),
		AuthorityStationPeerId: command.GetAuthorityStationPeerId(),
		AuthorityEpoch:         command.GetAuthorityEpoch(),
		HomeStationPeerId:      "station-five",
		ActorPtid:              command.GetOperator().GetPtid(),
		ActorDeviceId:          command.GetOperator().GetDeviceId(),
		ActorSigningKeyId:      "signing-key-1",
		CommandSha256:          federationdelivery.PayloadSHA256(commandBytes),
		ActorSignature:         make([]byte, 64),
		CreatedAtUnixMs:        command.GetClientTimestamp().AsTime().UnixMilli(),
		ExpiresAtUnixMs:        command.GetDeadline().AsTime().UnixMilli(),
		MemberAuthorityCommand: command,
	}
}
