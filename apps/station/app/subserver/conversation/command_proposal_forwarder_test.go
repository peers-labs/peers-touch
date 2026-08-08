package conversation

import (
	"context"
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/follower"
	envinf "github.com/peers-labs/peers-touch/station/app/subserver/envelope/infrastructure"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

type recordingProposalForwarder struct {
	calls  int
	result *chat.ConversationCommandProposalResult
	err    error
}

func (f *recordingProposalForwarder) Forward(
	_ context.Context,
	_ *chat.ConversationCommandProposal,
) (*chat.ConversationCommandProposalResult, error) {
	f.calls++
	return f.result, f.err
}

func TestHomeStationForwardsCommandBoundToFollowerHeadAndDevice(t *testing.T) {
	subserver, proposal, forwarder := newHomeProposalFixture(t)
	response, err := subserver.submitAuthenticatedConversationCommandProposal(
		context.Background(),
		proposal.ActorPtid,
		proposal.ActorDeviceId,
		proposal,
	)
	if err != nil {
		t.Fatal(err)
	}
	if response.Result == nil || !response.Result.Accepted || forwarder.calls != 1 {
		t.Fatalf("forwarded result=%+v calls=%d", response.Result, forwarder.calls)
	}
	if response.State != chat.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_ACCEPTED {
		t.Fatalf("state=%v, want accepted", response.State)
	}
}

func TestHomeStationExactReplayReturnsStoredResultWithoutReforwarding(t *testing.T) {
	subserver, proposal, forwarder := newHomeProposalFixture(t)
	for attempt := 0; attempt < 2; attempt++ {
		response, err := subserver.submitAuthenticatedConversationCommandProposal(
			context.Background(),
			proposal.ActorPtid,
			proposal.ActorDeviceId,
			proposal,
		)
		if err != nil {
			t.Fatal(err)
		}
		if response.State != chat.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_ACCEPTED {
			t.Fatalf("state=%v, want accepted", response.State)
		}
	}
	if forwarder.calls != 1 {
		t.Fatalf("exact replay reached authority %d times", forwarder.calls)
	}
	var inboxCount int64
	if err := subserver.db.Model(&envinf.InboxModel{}).Count(&inboxCount).Error; err != nil {
		t.Fatal(err)
	}
	if inboxCount != 1 {
		t.Fatalf("result inbox rows=%d, want 1", inboxCount)
	}
}

func TestHomeStationCommandHashConflictRejectsBeforeForward(t *testing.T) {
	subserver, proposal, forwarder := newHomeProposalFixture(t)
	if _, err := subserver.submitAuthenticatedConversationCommandProposal(
		context.Background(),
		proposal.ActorPtid,
		proposal.ActorDeviceId,
		proposal,
	); err != nil {
		t.Fatal(err)
	}
	conflict := proto.Clone(proposal).(*chat.ConversationCommandProposal)
	conflict.CommandSha256[0] ^= 0xff
	if _, err := subserver.submitAuthenticatedConversationCommandProposal(
		context.Background(),
		conflict.ActorPtid,
		conflict.ActorDeviceId,
		conflict,
	); err == nil {
		t.Fatal("command hash conflict was accepted")
	}
	if forwarder.calls != 1 {
		t.Fatalf("conflict reached authority: calls=%d", forwarder.calls)
	}
}

func TestHomeStationWorkerRecoversLostAuthorityResponse(t *testing.T) {
	subserver, proposal, forwarder := newHomeProposalFixture(t)
	forwarder.err = errors.New("authority response lost")
	response, err := subserver.submitAuthenticatedConversationCommandProposal(
		context.Background(),
		proposal.ActorPtid,
		proposal.ActorDeviceId,
		proposal,
	)
	if err != nil {
		t.Fatal(err)
	}
	if response.State != chat.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_RETRY_WAIT {
		t.Fatalf("state=%v, want retry wait", response.State)
	}
	forwarder.err = nil
	if err := subserver.db.Model(&conversationCommandProposalModel{}).
		Where("conversation_id = ? AND command_id = ?", proposal.Command.ConversationId, proposal.Command.CommandId).
		Update("next_retry_at", time.Now().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	subserver.processCommandProposalBatch(context.Background())
	stored, err := subserver.proposalStore.get(
		context.Background(),
		proposal.Command.ConversationId,
		proposal.Command.CommandId,
	)
	if err != nil {
		t.Fatal(err)
	}
	if stored.State != int32(chat.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_ACCEPTED) {
		t.Fatalf("state=%d, want accepted", stored.State)
	}
	if forwarder.calls != 2 {
		t.Fatalf("authority calls=%d, want retry", forwarder.calls)
	}
}

func TestHomeStationRejectsUnboundCommandBeforeDurableAccept(t *testing.T) {
	tests := []struct {
		name                string
		authenticatedPtid   string
		authenticatedDevice string
		mutate              func(*chat.ConversationCommandProposal)
	}{
		{
			name:                "wrong authenticated device",
			authenticatedPtid:   "alice",
			authenticatedDevice: "other-device",
			mutate:              func(*chat.ConversationCommandProposal) {},
		},
		{
			name:                "wrong Home Station",
			authenticatedPtid:   "alice",
			authenticatedDevice: "alice-device",
			mutate: func(proposal *chat.ConversationCommandProposal) {
				proposal.HomeStationPeerId = "station-c"
			},
		},
		{
			name:                "wrong authority epoch",
			authenticatedPtid:   "alice",
			authenticatedDevice: "alice-device",
			mutate: func(proposal *chat.ConversationCommandProposal) {
				proposal.AuthorityEpoch++
			},
		},
		{
			name:                "wrong authority Station",
			authenticatedPtid:   "alice",
			authenticatedDevice: "alice-device",
			mutate: func(proposal *chat.ConversationCommandProposal) {
				proposal.AuthorityStationPeerId = "station-c"
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			subserver, proposal, forwarder := newHomeProposalFixture(t)
			test.mutate(proposal)
			if _, err := subserver.submitAuthenticatedConversationCommandProposal(
				context.Background(),
				test.authenticatedPtid,
				test.authenticatedDevice,
				proposal,
			); err == nil {
				t.Fatal("unbound proposal was accepted")
			}
			if forwarder.calls != 0 {
				t.Fatalf("unbound proposal reached forwarder: calls=%d", forwarder.calls)
			}
			var count int64
			if err := subserver.db.Model(&conversationCommandProposalModel{}).Count(&count).Error; err != nil {
				t.Fatal(err)
			}
			if count != 0 {
				t.Fatalf("unbound proposal became durable: count=%d", count)
			}
		})
	}
}

func newHomeProposalFixture(
	t *testing.T,
) (*subServer, *chat.ConversationCommandProposal, *recordingProposalForwarder) {
	t.Helper()
	db := newTransitionTestDB(t)
	followerService := follower.NewService(db)
	if err := followerService.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&conversationCommandProposalModel{},
		&envinf.InboxModel{},
		&envinf.IdempotencyModel{},
	); err != nil {
		t.Fatal(err)
	}
	const conversationID = "remote-conversation"
	if err := db.Create(&follower.Head{
		ConversationID:         conversationID,
		FederationID:           "federation-1",
		AuthorityStationPeerID: "station-a",
		AuthorityEpoch:         4,
		GroupSeq:               8,
		MembershipEpoch:        3,
		MlsEpoch:               3,
		Status:                 "active",
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&follower.Member{
		ConversationID: conversationID,
		Ptid:           "alice",
		Status:         int32(chat.MemberStatus_MEMBER_STATUS_ACTIVE),
	}).Error; err != nil {
		t.Fatal(err)
	}
	forwarder := &recordingProposalForwarder{
		result: &chat.ConversationCommandProposalResult{
			CommandId: "command-1",
			Accepted:  true,
		},
	}
	subserver := &subServer{
		repo:              newPostgresConversationRepo(db),
		proposalForwarder: forwarder,
		proposalStore:     newCommandProposalStore(db),
		localStationID:    "station-b",
		db:                db,
	}
	command := &chat.ConversationCommand{
		CommandId:      "command-1",
		ConversationId: conversationID,
		SenderPtid:     "alice",
		SenderDeviceId: "alice-device",
		Payload: &chat.ConversationCommand_SendMessage{
			SendMessage: &chat.SendMessageCommand{
				GroupEncryptedPayload: []byte("opaque-mls-ciphertext"),
			},
		},
	}
	commandBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(command)
	if err != nil {
		t.Fatal(err)
	}
	commandHash := sha256.Sum256(commandBytes)
	now := time.Now()
	proposal := &chat.ConversationCommandProposal{
		Version:                conversationCommandProposalVersion,
		FederationId:           "federation-1",
		AuthorityStationPeerId: "station-a",
		HomeStationPeerId:      "station-b",
		ActorPtid:              "alice",
		ActorDeviceId:          "alice-device",
		ActorSigningKeyId:      "key-1",
		Command:                command,
		CommandSha256:          commandHash[:],
		ActorSignature:         make([]byte, 64),
		AuthorityEpoch:         4,
		CreatedAtUnixMs:        now.UnixMilli(),
		ExpiresAtUnixMs:        now.Add(2 * time.Minute).UnixMilli(),
	}
	return subserver, proto.Clone(proposal).(*chat.ConversationCommandProposal), forwarder
}
