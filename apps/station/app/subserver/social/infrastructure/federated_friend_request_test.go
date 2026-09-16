package infrastructure_test

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	gormlogger "gorm.io/gorm/logger"
)

const (
	alicePTID                = "ptid:p:alice"
	bobPTID                  = "ptid:p:bob"
	stationA                 = "station-a"
	stationB                 = "station-b"
	acceptedFriendshipStatus = int32(2)
)

func TestFederatedFriendRequestCrossStationAcceptConvergesWithoutRemoteActorRows(
	t *testing.T,
) {
	fixture := newFederatedFriendRequestFixture(t)
	deleteRemoteActorProjection(t, fixture.a.db, bobPTID)
	deleteRemoteActorProjection(t, fixture.b.db, alicePTID)
	command := fixture.command(
		t,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		"command-send",
		"request-accept",
		stationA,
		stationB,
		fixture.clock.Now(),
	)
	submitted, err := fixture.a.service.SubmitFriendRequestCommand(
		context.Background(),
		command,
	)
	if err != nil {
		t.Fatal(err)
	}
	if submitted.Duplicate ||
		submitted.Projection.AuthorityConfirmed ||
		submitted.Projection.State !=
			model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING {
		t.Fatalf("unexpected sender durable acceptance: %+v", submitted)
	}
	replayed, err := fixture.a.service.SubmitFriendRequestCommand(
		context.Background(),
		proto.Clone(command).(*model.FriendRequestCommand),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !replayed.Duplicate {
		t.Fatal("exact sender command replay was not idempotent")
	}

	fixture.dispatchOnce(t, fixture.a)
	assertProjectionState(
		t,
		fixture.b,
		"request-accept",
		model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING,
		1,
		true,
	)
	fixture.dispatchOnce(t, fixture.b)
	assertProjectionState(
		t,
		fixture.a,
		"request-accept",
		model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING,
		1,
		true,
	)
	returned, err := fixture.a.store.Command(
		context.Background(),
		domain.FriendRequestCommandRoleOutgoing,
		stationB,
		command.GetBody().GetCommandId(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if returned == nil || len(returned.ResultBytes) == 0 || returned.ResolvedAt == nil {
		t.Fatalf("sender command did not persist the returned result: %+v", returned)
	}
	var returnedResult model.FriendRequestCommandResult
	if err := proto.Unmarshal(returned.ResultBytes, &returnedResult); err != nil {
		t.Fatal(err)
	}
	if returnedResult.GetEvent().GetState() !=
		model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING {
		t.Fatalf("returned SEND result = %+v", &returnedResult)
	}

	fixture.clock.Advance(time.Minute)
	accept := fixture.command(
		t,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_ACCEPT,
		"command-accept",
		"request-accept",
		stationA,
		stationB,
		fixture.clock.Now(),
	)
	if _, err := fixture.b.service.SubmitFriendRequestCommand(
		context.Background(),
		accept,
	); err != nil {
		t.Fatal(err)
	}
	fixture.dispatchOnce(t, fixture.b)
	assertOutgoingCommandResult(
		t,
		fixture.b,
		accept,
		model.FriendRequestCommandResultKind_FRIEND_REQUEST_COMMAND_RESULT_KIND_COMMITTED,
		model.FriendRequestCommandErrorCode_FRIEND_REQUEST_COMMAND_ERROR_CODE_UNSPECIFIED,
		model.FriendRequestState_FRIEND_REQUEST_STATE_ACCEPTED,
	)
	assertProjectionState(
		t,
		fixture.b,
		"request-accept",
		model.FriendRequestState_FRIEND_REQUEST_STATE_ACCEPTED,
		2,
		true,
	)
	if relationship, err := fixture.b.store.Relationship(
		context.Background(),
		bobPTID,
		alicePTID,
	); err != nil || relationship == nil {
		t.Fatalf("receiver relationship = %+v, %v", relationship, err)
	}
	assertFriendshipProjection(t, fixture.b.db, bobPTID, alicePTID)

	fixture.dispatchOnce(t, fixture.b)
	assertProjectionState(
		t,
		fixture.a,
		"request-accept",
		model.FriendRequestState_FRIEND_REQUEST_STATE_ACCEPTED,
		2,
		true,
	)
	if relationship, err := fixture.a.store.Relationship(
		context.Background(),
		alicePTID,
		bobPTID,
	); err != nil || relationship == nil {
		t.Fatalf("sender relationship = %+v, %v", relationship, err)
	}
	assertFriendshipProjection(t, fixture.a.db, alicePTID, bobPTID)

	effectID := domain.DirectConversationEffectID("request-accept")
	effect, conversationID, err := fixture.a.store.DirectConversationEffect(
		context.Background(),
		effectID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if effect == nil || conversationID != "" {
		t.Fatalf("pending Direct effect = %+v conversation=%q", effect, conversationID)
	}
	if effect.FederationID != "federation:test" {
		t.Fatalf("pending Direct effect federation ID = %q", effect.FederationID)
	}
	port := newTestDirectConversationPort(t, fixture.a.db)
	worker, err := application.NewFriendRequestDirectEffectService(
		fixture.a.store,
		port,
		fixture.clock,
		application.FriendRequestDirectEffectPolicy{
			LeaseDuration: time.Minute,
			RetryInitial:  time.Second,
			RetryMaximum:  time.Minute,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	processed, err := worker.ProcessOne(context.Background(), "effect-worker-a")
	if err != nil || !processed {
		t.Fatalf("process Direct effect = %t, %v", processed, err)
	}
	if processed, err := worker.ProcessOne(
		context.Background(),
		"effect-worker-a",
	); err != nil || processed {
		t.Fatalf("completed effect replay = %t, %v", processed, err)
	}
	if port.Count(t) != 1 {
		t.Fatalf("Direct Conversation rows = %d, want 1", port.Count(t))
	}
	effect, conversationID, err = fixture.a.store.DirectConversationEffect(
		context.Background(),
		effectID,
	)
	if err != nil || effect == nil || conversationID == "" {
		t.Fatalf("completed Direct effect = %+v conversation=%q err=%v", effect, conversationID, err)
	}
}

func TestFederatedFriendRequestListReadsCanonicalProjections(t *testing.T) {
	fixture := newFederatedFriendRequestFixture(t)
	command := fixture.command(
		t,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		"command-list",
		"request-list",
		stationA,
		stationB,
		fixture.clock.Now(),
	)
	if _, err := fixture.a.service.SubmitFriendRequestCommand(
		context.Background(),
		command,
	); err != nil {
		t.Fatal(err)
	}
	fixture.dispatchOnce(t, fixture.a)

	projections, total, err := fixture.b.service.ListFriendRequestProjections(
		context.Background(),
		bobPTID,
		model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING,
		25,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(projections) != 1 {
		t.Fatalf("projection page total=%d items=%d", total, len(projections))
	}
	if projections[0].RequestID != "request-list" ||
		projections[0].FederationID != "federation:test" ||
		projections[0].Sender.GetPtid() != alicePTID ||
		projections[0].Receiver.GetPtid() != bobPTID {
		t.Fatalf("canonical projection = %+v", projections[0])
	}

	filtered, filteredTotal, err := fixture.b.service.ListFriendRequestProjections(
		context.Background(),
		bobPTID,
		model.FriendRequestState_FRIEND_REQUEST_STATE_ACCEPTED,
		25,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if filteredTotal != 0 || len(filtered) != 0 {
		t.Fatalf(
			"accepted projection page total=%d items=%d",
			filteredTotal,
			len(filtered),
		)
	}
}

func TestFederatedFriendRequestRejectReturnsWithoutRelationshipOrEffect(t *testing.T) {
	fixture := newFederatedFriendRequestFixture(t)
	requestID := "request-reject"
	send := fixture.command(
		t,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		"command-send-reject",
		requestID,
		stationA,
		stationB,
		fixture.clock.Now(),
	)
	if _, err := fixture.a.service.SubmitFriendRequestCommand(
		context.Background(),
		send,
	); err != nil {
		t.Fatal(err)
	}
	fixture.dispatchOnce(t, fixture.a)
	fixture.dispatchOnce(t, fixture.b)

	fixture.clock.Advance(time.Minute)
	reject := fixture.command(
		t,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_REJECT,
		"command-reject",
		requestID,
		stationA,
		stationB,
		fixture.clock.Now(),
	)
	if _, err := fixture.b.service.SubmitFriendRequestCommand(
		context.Background(),
		reject,
	); err != nil {
		t.Fatal(err)
	}
	fixture.dispatchOnce(t, fixture.b)
	assertOutgoingCommandResult(
		t,
		fixture.b,
		reject,
		model.FriendRequestCommandResultKind_FRIEND_REQUEST_COMMAND_RESULT_KIND_COMMITTED,
		model.FriendRequestCommandErrorCode_FRIEND_REQUEST_COMMAND_ERROR_CODE_UNSPECIFIED,
		model.FriendRequestState_FRIEND_REQUEST_STATE_REJECTED,
	)
	fixture.dispatchOnce(t, fixture.b)

	for _, station := range []*friendRequestStation{fixture.a, fixture.b} {
		assertProjectionState(
			t,
			station,
			requestID,
			model.FriendRequestState_FRIEND_REQUEST_STATE_REJECTED,
			2,
			true,
		)
	}
	if relationship, err := fixture.a.store.Relationship(
		context.Background(),
		alicePTID,
		bobPTID,
	); err != nil || relationship != nil {
		t.Fatalf("reject sender relationship = %+v, %v", relationship, err)
	}
	if effect, _, err := fixture.a.store.DirectConversationEffect(
		context.Background(),
		domain.DirectConversationEffectID(requestID),
	); err != nil || effect != nil {
		t.Fatalf("reject Direct effect = %+v, %v", effect, err)
	}

}

func TestMissingDecisionClosesLocalOutgoingWithDurableRejection(t *testing.T) {
	fixture := newFederatedFriendRequestFixture(t)
	accept := fixture.command(
		t,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_ACCEPT,
		"command-accept-missing",
		"request-missing",
		stationA,
		stationB,
		fixture.clock.Now(),
	)
	if _, err := fixture.b.service.SubmitFriendRequestCommand(
		context.Background(),
		accept,
	); err != nil {
		t.Fatal(err)
	}
	fixture.dispatchOnce(t, fixture.b)
	assertOutgoingCommandResult(
		t,
		fixture.b,
		accept,
		model.FriendRequestCommandResultKind_FRIEND_REQUEST_COMMAND_RESULT_KIND_REJECTED,
		model.FriendRequestCommandErrorCode_FRIEND_REQUEST_COMMAND_ERROR_CODE_NOT_FOUND,
		model.FriendRequestState_FRIEND_REQUEST_STATE_UNSPECIFIED,
	)
	if projection, err := fixture.b.store.Projection(
		context.Background(),
		accept.GetBody().GetRequestId(),
	); err != nil || projection != nil {
		t.Fatalf("missing decision projection = %+v, %v", projection, err)
	}
}

func TestFederatedFriendRequestAcceptRechecksReceiverBlockPolicy(t *testing.T) {
	fixture := newFederatedFriendRequestFixture(t)
	requestID := "request-blocked-after-pending"
	send := fixture.command(
		t,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		"command-send-before-block",
		requestID,
		stationA,
		stationB,
		fixture.clock.Now(),
	)
	if _, err := fixture.a.service.SubmitFriendRequestCommand(
		context.Background(),
		send,
	); err != nil {
		t.Fatal(err)
	}
	fixture.dispatchOnce(t, fixture.a)
	fixture.dispatchOnce(t, fixture.b)

	now := fixture.clock.Now()
	if err := fixture.b.db.Table("friend_chat_friendships").Create(
		map[string]any{
			"actor_ptid": bobPTID,
			"peer_ptid":  alicePTID,
			"status":     int32(3),
			"created_at": now,
			"updated_at": now,
		},
	).Error; err != nil {
		t.Fatal(err)
	}

	fixture.clock.Advance(time.Minute)
	accept := fixture.command(
		t,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_ACCEPT,
		"command-accept-blocked",
		requestID,
		stationA,
		stationB,
		fixture.clock.Now(),
	)
	if _, err := fixture.b.service.SubmitFriendRequestCommand(
		context.Background(),
		accept,
	); err != nil {
		t.Fatal(err)
	}
	fixture.dispatchOnce(t, fixture.b)

	assertOutgoingCommandResult(
		t,
		fixture.b,
		accept,
		model.FriendRequestCommandResultKind_FRIEND_REQUEST_COMMAND_RESULT_KIND_REJECTED,
		model.FriendRequestCommandErrorCode_FRIEND_REQUEST_COMMAND_ERROR_CODE_BLOCKED,
		model.FriendRequestState_FRIEND_REQUEST_STATE_UNSPECIFIED,
	)
	assertProjectionState(
		t,
		fixture.b,
		requestID,
		model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING,
		1,
		true,
	)
	if relationship, err := fixture.b.store.Relationship(
		context.Background(),
		bobPTID,
		alicePTID,
	); err != nil || relationship != nil {
		t.Fatalf("blocked accept relationship = %+v, %v", relationship, err)
	}
	if effect, _, err := fixture.b.store.DirectConversationEffect(
		context.Background(),
		domain.DirectConversationEffectID(requestID),
	); err != nil || effect != nil {
		t.Fatalf("blocked accept Direct effect = %+v, %v", effect, err)
	}
}

func TestFederatedFriendRequestAcceptIgnoresSendOnlyExistingRelationshipGuard(
	t *testing.T,
) {
	fixture := newFederatedFriendRequestFixture(t)
	requestID := "request-existing-before-accept"
	send := fixture.command(
		t,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		"command-send-before-existing",
		requestID,
		stationA,
		stationB,
		fixture.clock.Now(),
	)
	if _, err := fixture.a.service.SubmitFriendRequestCommand(
		context.Background(),
		send,
	); err != nil {
		t.Fatal(err)
	}
	fixture.dispatchOnce(t, fixture.a)
	fixture.dispatchOnce(t, fixture.b)

	now := fixture.clock.Now()
	if err := fixture.b.db.Table("friend_chat_friendships").Create(
		map[string]any{
			"actor_ptid": bobPTID,
			"peer_ptid":  alicePTID,
			"status":     int32(2),
			"created_at": now,
			"updated_at": now,
		},
	).Error; err != nil {
		t.Fatal(err)
	}

	fixture.clock.Advance(time.Minute)
	accept := fixture.command(
		t,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_ACCEPT,
		"command-accept-existing",
		requestID,
		stationA,
		stationB,
		fixture.clock.Now(),
	)
	if _, err := fixture.b.service.SubmitFriendRequestCommand(
		context.Background(),
		accept,
	); err != nil {
		t.Fatal(err)
	}
	fixture.dispatchOnce(t, fixture.b)

	assertOutgoingCommandResult(
		t,
		fixture.b,
		accept,
		model.FriendRequestCommandResultKind_FRIEND_REQUEST_COMMAND_RESULT_KIND_COMMITTED,
		model.FriendRequestCommandErrorCode_FRIEND_REQUEST_COMMAND_ERROR_CODE_UNSPECIFIED,
		model.FriendRequestState_FRIEND_REQUEST_STATE_ACCEPTED,
	)
	assertProjectionState(
		t,
		fixture.b,
		requestID,
		model.FriendRequestState_FRIEND_REQUEST_STATE_ACCEPTED,
		2,
		true,
	)
}

func TestReceiverRejectsSendPolicyBeforePendingMaterialization(t *testing.T) {
	tests := []struct {
		name      string
		seed      func(*testing.T, *friendRequestStation)
		errorCode model.FriendRequestCommandErrorCode
	}{
		{
			name: "receiver-local block",
			seed: func(t *testing.T, station *friendRequestStation) {
				t.Helper()
				now := station.clock.Now()
				if err := station.db.Table("friend_chat_friendships").Create(
					map[string]any{
						"actor_ptid": bobPTID,
						"peer_ptid":  alicePTID,
						"status":     int32(3),
						"created_at": now,
						"updated_at": now,
					},
				).Error; err != nil {
					t.Fatal(err)
				}
			},
			errorCode: model.FriendRequestCommandErrorCode_FRIEND_REQUEST_COMMAND_ERROR_CODE_BLOCKED,
		},
		{
			name: "existing receiver-local relationship",
			seed: func(t *testing.T, station *friendRequestStation) {
				t.Helper()
				err := station.store.Execute(
					context.Background(),
					func(transaction infrastructure.FederatedFriendRequestTransaction) error {
						return transaction.PutRelationship(
							context.Background(),
							domain.FriendRequestRelationshipProjection{
								OwnerPTID:         bobPTID,
								PeerPTID:          alicePTID,
								RequestID:         "existing-request",
								AcceptedEventID:   "existing-event",
								AcceptedEventHash: bytes.Repeat([]byte{0x71}, sha256.Size),
								AcceptedAt:        station.clock.Now(),
							},
						)
					},
				)
				if err != nil {
					t.Fatal(err)
				}
			},
			errorCode: model.FriendRequestCommandErrorCode_FRIEND_REQUEST_COMMAND_ERROR_CODE_ALREADY_FRIENDS,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture := newFederatedFriendRequestFixture(t)
			test.seed(t, fixture.b)
			command := fixture.command(
				t,
				model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
				"command-policy",
				"request-policy",
				stationA,
				stationB,
				fixture.clock.Now(),
			)
			if _, err := fixture.a.service.SubmitFriendRequestCommand(
				context.Background(),
				command,
			); err != nil {
				t.Fatal(err)
			}

			fixture.dispatchOnce(t, fixture.a)
			if projection, err := fixture.b.store.Projection(
				context.Background(),
				command.GetBody().GetRequestId(),
			); err != nil || projection != nil {
				t.Fatalf("receiver policy materialized projection = %+v, %v", projection, err)
			}
			authority, err := fixture.b.store.Command(
				context.Background(),
				domain.FriendRequestCommandRoleAuthority,
				stationB,
				command.GetBody().GetCommandId(),
			)
			if err != nil || authority == nil {
				t.Fatalf("receiver policy command = %+v, %v", authority, err)
			}
			var policyResult model.FriendRequestCommandResult
			if err := proto.Unmarshal(authority.ResultBytes, &policyResult); err != nil {
				t.Fatal(err)
			}
			if policyResult.GetKind() !=
				model.FriendRequestCommandResultKind_FRIEND_REQUEST_COMMAND_RESULT_KIND_REJECTED ||
				policyResult.GetErrorCode() != test.errorCode ||
				policyResult.GetEvent() != nil {
				t.Fatalf("receiver policy result = %+v", &policyResult)
			}

			fixture.dispatchOnce(t, fixture.b)
			outgoing, err := fixture.a.store.Command(
				context.Background(),
				domain.FriendRequestCommandRoleOutgoing,
				stationB,
				command.GetBody().GetCommandId(),
			)
			if err != nil ||
				outgoing == nil ||
				outgoing.ResolvedAt == nil ||
				!bytes.Equal(outgoing.ResultBytes, authority.ResultBytes) {
				t.Fatalf("sender policy result = %+v, %v", outgoing, err)
			}
			assertProjectionState(
				t,
				fixture.a,
				command.GetBody().GetRequestId(),
				model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING,
				0,
				false,
			)
		})
	}
}

func TestPendingResultHashConflictDoesNotAdvanceSenderProjection(t *testing.T) {
	fixture := newFederatedFriendRequestFixture(t)
	command := fixture.command(
		t,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		"command-result-conflict",
		"request-result-conflict",
		stationA,
		stationB,
		fixture.clock.Now(),
	)
	if _, err := fixture.a.service.SubmitFriendRequestCommand(
		context.Background(),
		command,
	); err != nil {
		t.Fatal(err)
	}
	commandHash, err := domain.FriendRequestCommandPayloadSHA256(command)
	if err != nil {
		t.Fatal(err)
	}
	_, event, err := domain.ApplyFriendRequestCommand(
		nil,
		command,
		stationB,
		fixture.clock.Now(),
	)
	if err != nil {
		t.Fatal(err)
	}
	commandHash[0] ^= 0xff
	resultPayload := &model.FriendRequestCommandResult{
		CommandId:            command.GetBody().GetCommandId(),
		RequestId:            command.GetBody().GetRequestId(),
		CommandPayloadSha256: commandHash,
		Kind:                 model.FriendRequestCommandResultKind_FRIEND_REQUEST_COMMAND_RESULT_KIND_COMMITTED,
		Event:                event,
	}
	result, err := fixture.a.receiver.Receive(
		context.Background(),
		friendRequestResultFrame(t, fixture.b, fixture.a, resultPayload),
	)
	if err != nil {
		t.Fatal(err)
	}
	if result != delivery.PayloadHashConflictResult() {
		t.Fatalf("pending result hash conflict = %+v", result)
	}
	assertProjectionState(
		t,
		fixture.a,
		command.GetBody().GetRequestId(),
		model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING,
		0,
		false,
	)
	outgoing, err := fixture.a.store.Command(
		context.Background(),
		domain.FriendRequestCommandRoleOutgoing,
		stationB,
		command.GetBody().GetCommandId(),
	)
	if err != nil || outgoing == nil || outgoing.ResolvedAt != nil {
		t.Fatalf("conflicting result resolved outgoing command = %+v, %v", outgoing, err)
	}
}

func TestRetryableResultFrameDoesNotResolveOrConsumeOriginalCommand(t *testing.T) {
	fixture := newFederatedFriendRequestFixture(t)
	command := fixture.command(
		t,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		"command-retryable-result",
		"request-retryable-result",
		stationA,
		stationB,
		fixture.clock.Now(),
	)
	if _, err := fixture.a.service.SubmitFriendRequestCommand(
		context.Background(),
		command,
	); err != nil {
		t.Fatal(err)
	}
	commandHash, err := domain.FriendRequestCommandPayloadSHA256(command)
	if err != nil {
		t.Fatal(err)
	}
	resultPayload := &model.FriendRequestCommandResult{
		CommandId:            command.GetBody().GetCommandId(),
		RequestId:            command.GetBody().GetRequestId(),
		CommandPayloadSha256: commandHash,
		Kind:                 model.FriendRequestCommandResultKind_FRIEND_REQUEST_COMMAND_RESULT_KIND_REJECTED,
		ErrorCode:            model.FriendRequestCommandErrorCode_FRIEND_REQUEST_COMMAND_ERROR_CODE_RETRY_LATER,
		Retryable:            true,
	}

	result, err := fixture.a.receiver.Receive(
		context.Background(),
		friendRequestResultFrame(t, fixture.b, fixture.a, resultPayload),
	)
	if err != nil {
		t.Fatal(err)
	}
	if result != delivery.TerminalResult(delivery.FrameErrorDomainRejected) {
		t.Fatalf("retryable result frame outcome = %+v", result)
	}

	outgoing, err := fixture.a.store.Command(
		context.Background(),
		domain.FriendRequestCommandRoleOutgoing,
		stationB,
		command.GetBody().GetCommandId(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if outgoing == nil ||
		outgoing.ResolvedAt != nil ||
		len(outgoing.ResultBytes) != 0 {
		t.Fatalf("retryable result resolved outgoing command = %+v", outgoing)
	}

	var originalFrame delivery.OutboxRecord
	if err := fixture.a.db.
		Where(
			"payload_kind = ? AND payload_id = ?",
			delivery.PayloadKindSocialFriendRequestCommand,
			command.GetBody().GetCommandId(),
		).
		First(&originalFrame).Error; err != nil {
		t.Fatal(err)
	}
	if originalFrame.State != delivery.OutboxStatePending {
		t.Fatalf("original command outbox state = %s, want pending", originalFrame.State)
	}
}

func TestFederatedFriendRequestExactReplayHashConflictAndSignatureRejection(t *testing.T) {
	fixture := newFederatedFriendRequestFixture(t)
	command := fixture.command(
		t,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		"command-replay",
		"request-replay",
		stationA,
		stationB,
		fixture.clock.Now(),
	)
	if _, err := fixture.a.service.SubmitFriendRequestCommand(
		context.Background(),
		command,
	); err != nil {
		t.Fatal(err)
	}
	if err := touchactor.NewDeviceStore(fixture.a.db).Revoke(
		context.Background(),
		alicePTID,
		alicePTID+":device",
	); err != nil {
		t.Fatal(err)
	}
	replayedAtSender, err := fixture.a.service.SubmitFriendRequestCommand(
		context.Background(),
		proto.Clone(command).(*model.FriendRequestCommand),
	)
	if err != nil || !replayedAtSender.Duplicate {
		t.Fatalf(
			"historical exact sender replay after revocation = %+v, %v",
			replayedAtSender,
			err,
		)
	}
	fixture.dispatchOnce(t, fixture.a)

	replayFrame := fixture.frame(
		t,
		fixture.a,
		command,
		"replay-frame",
		"replay-idempotency",
	)
	result, err := fixture.b.receiver.Receive(context.Background(), replayFrame)
	if err != nil {
		t.Fatal(err)
	}
	if result != delivery.DuplicateResult() {
		t.Fatalf("exact command replay result = %+v", result)
	}

	conflict := proto.Clone(command).(*model.FriendRequestCommand)
	conflict.Body.Message = "different exact command"
	fixture.signActorCommand(t, conflict)
	conflictFrame := fixture.frame(
		t,
		fixture.a,
		conflict,
		"conflict-frame",
		"conflict-idempotency",
	)
	result, err = fixture.b.receiver.Receive(context.Background(), conflictFrame)
	if err != nil {
		t.Fatal(err)
	}
	if result != delivery.PayloadHashConflictResult() {
		t.Fatalf("command hash conflict result = %+v", result)
	}
	assertProjectionState(
		t,
		fixture.b,
		"request-replay",
		model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING,
		1,
		true,
	)

	forgedFixture := newFederatedFriendRequestFixture(t)
	forged := forgedFixture.command(
		t,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		"command-forged",
		"request-forged",
		stationA,
		stationB,
		fixture.clock.Now(),
	)
	forged.ActorDeviceSignature[0] ^= 0xff
	if _, err := forgedFixture.a.service.SubmitFriendRequestCommand(
		context.Background(),
		forged,
	); domain.FederationErrorCodeOf(err) != domain.FederationErrorInvalidSignature {
		t.Fatalf("forged sender command error = %v", err)
	}
	if projection, err := forgedFixture.a.store.Projection(
		context.Background(),
		"request-forged",
	); err != nil || projection != nil {
		t.Fatalf("forged command projection = %+v, %v", projection, err)
	}
}

func TestSameStationFriendRequestUsesSharedDeliveryReceiver(t *testing.T) {
	clock := newFriendRequestClock()
	stationKey := newTestKey(0x61)
	aliceKey := newTestKey(0x62)
	bobKey := newTestKey(0x63)
	keyring := stationKeyring{
		"station-local": {
			keyID:     stationKey.keyID,
			publicKey: stationKey.publicKey,
		},
	}
	local := newFriendRequestStation(
		t,
		"station-local",
		clock,
		stationKey,
		keyring,
		map[string]testKey{
			alicePTID: aliceKey,
			bobPTID:   bobKey,
		},
	)
	transport := &routingFriendRequestTransport{
		localStationID: local.id,
		local:          local.localTransport,
		receivers:      map[string]delivery.FrameReceiver{local.id: local.receiver},
	}
	send := signedFriendRequestCommand(
		t,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		"local-send",
		"local-request",
		"station-local",
		"station-local",
		clock.Now(),
		aliceKey,
	)
	if _, err := local.service.SubmitFriendRequestCommand(
		context.Background(),
		send,
	); err != nil {
		t.Fatal(err)
	}
	dispatchStationOnce(t, local, transport)
	dispatchStationOnce(t, local, transport)

	clock.Advance(time.Minute)
	accept := signedFriendRequestCommand(
		t,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_ACCEPT,
		"local-accept",
		"local-request",
		"station-local",
		"station-local",
		clock.Now(),
		bobKey,
	)
	if _, err := local.service.SubmitFriendRequestCommand(
		context.Background(),
		accept,
	); err != nil {
		t.Fatal(err)
	}
	dispatchStationOnce(t, local, transport)
	dispatchStationOnce(t, local, transport)

	if transport.LocalCallCount() != 4 {
		t.Fatalf("same-Station local deliveries = %d, want 4", transport.LocalCallCount())
	}
	for owner, peer := range map[string]string{
		alicePTID: bobPTID,
		bobPTID:   alicePTID,
	} {
		relationship, err := local.store.Relationship(
			context.Background(),
			owner,
			peer,
		)
		if err != nil || relationship == nil {
			t.Fatalf("local relationship %s -> %s = %+v, %v", owner, peer, relationship, err)
		}
		assertFriendshipProjection(t, local.db, owner, peer)
	}
	effect, _, err := local.store.DirectConversationEffect(
		context.Background(),
		domain.DirectConversationEffectID("local-request"),
	)
	if err != nil || effect == nil {
		t.Fatalf("same-Station Direct effect = %+v, %v", effect, err)
	}
}

func TestReceiverUsesVerifiedRemoteActorDeviceProjectionAndRejectsInvalidAuthority(
	t *testing.T,
) {
	t.Run("verified remote projection", func(t *testing.T) {
		fixture := newFederatedFriendRequestFixture(t)
		key, err := touchactor.NewDeviceStore(fixture.b.db).ResolveSigningKey(
			context.Background(),
			alicePTID,
			alicePTID+":device",
			fixture.actorKeys[alicePTID].keyID,
		)
		if err != nil {
			t.Fatal(err)
		}
		if key.GetHomeStationPeerId() != stationA ||
			key.GetVerificationSource() !=
				model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE {
			t.Fatalf("receiver Actor Identity projection = %+v", key)
		}
		command := fixture.command(
			t,
			model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
			"command-verified-remote",
			"request-verified-remote",
			stationA,
			stationB,
			fixture.clock.Now(),
		)
		result, err := fixture.b.receiver.Receive(
			context.Background(),
			fixture.frame(
				t,
				fixture.a,
				command,
				"verified-remote-frame",
				"verified-remote-idempotency",
			),
		)
		if err != nil || result != delivery.AcceptedResult() {
			t.Fatalf("verified remote command result = %+v, %v", result, err)
		}
	})

	t.Run("wrong source Station", func(t *testing.T) {
		fixture := newFederatedFriendRequestFixture(t)
		command := fixture.command(
			t,
			model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
			"command-wrong-source",
			"request-wrong-source",
			stationA,
			stationB,
			fixture.clock.Now(),
		)
		frame := fixture.frame(
			t,
			fixture.a,
			command,
			"wrong-source-frame",
			"wrong-source-idempotency",
		)
		frame.SourceStationPeerId = stationB
		if err := delivery.SignFrame(
			context.Background(),
			frame,
			delivery.DefaultFramePolicy(stationB),
			fixture.b.stationSigner,
		); err != nil {
			t.Fatal(err)
		}
		assertReceiverRejectedWithoutSocialMutation(
			t,
			fixture.b,
			command,
			frame,
		)
	})

	t.Run("cold cache hydrates verified remote projection", func(t *testing.T) {
		fixture := newFederatedFriendRequestFixture(t)
		if err := fixture.b.db.
			Where("ptid = ? AND device_id = ?", alicePTID, alicePTID+":device").
			Delete(&touchactor.DeviceRecord{}).Error; err != nil {
			t.Fatal(err)
		}
		hydrationCalls := 0
		fixture.b.service.WithActorDeviceKeyResolver(
			friendRequestActorKeyResolverFunc(func(
				_ context.Context,
				actorPTID string,
				homeStationPeerID string,
			) ([]*model.VerifiedActorDeviceSigningKey, error) {
				hydrationCalls++
				if actorPTID != alicePTID ||
					homeStationPeerID != stationA {
					return nil, errors.New("unexpected hydration identity")
				}
				key := fixture.actorKeys[alicePTID]
				return []*model.VerifiedActorDeviceSigningKey{
					&model.VerifiedActorDeviceSigningKey{
						ActorPtid:          actorPTID,
						ActorDeviceId:      actorPTID + ":device",
						HomeStationPeerId:  homeStationPeerID,
						SigningKeyId:       key.keyID,
						Ed25519PublicKey:   append([]byte(nil), key.publicKey...),
						ProfileVersion:     1,
						VerificationSource: model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE,
						ValidFromUnixMs:    fixture.clock.Now().UnixMilli(),
					},
				}, nil
			}),
		)
		command := fixture.command(
			t,
			model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
			"command-cold-cache",
			"request-cold-cache",
			stationA,
			stationB,
			fixture.clock.Now(),
		)
		command.GetBody().GetSender().Acct = ""
		command.GetBody().GetReceiver().Acct = ""
		command.GetBody().GetAuthorizingDevice().GetActor().Acct = ""
		fixture.signActorCommand(t, command)
		result, err := fixture.b.receiver.Receive(
			context.Background(),
			fixture.frame(
				t,
				fixture.a,
				command,
				"cold-cache-frame",
				"cold-cache-idempotency",
			),
		)
		if err != nil || result != delivery.AcceptedResult() {
			t.Fatalf("cold-cache command result = %+v, %v", result, err)
		}
		if hydrationCalls != 1 {
			t.Fatalf("cold-cache hydration calls = %d, want 1", hydrationCalls)
		}
		var persistedBySocial int64
		if err := fixture.b.db.
			Model(&touchactor.DeviceRecord{}).
			Where("ptid = ? AND device_id = ?", alicePTID, alicePTID+":device").
			Count(&persistedBySocial).Error; err != nil {
			t.Fatal(err)
		}
		if persistedBySocial != 0 {
			t.Fatalf(
				"Social persisted %d remote Actor Identity rows, want 0",
				persistedBySocial,
			)
		}
		assertProjectionState(
			t,
			fixture.b,
			command.GetBody().GetRequestId(),
			model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING,
			1,
			true,
		)
	})

	t.Run("latest verified profile omission rejects cached remote key", func(t *testing.T) {
		fixture := newFederatedFriendRequestFixture(t)
		hydrationCalls := 0
		fixture.b.service.WithActorDeviceKeyResolver(
			friendRequestActorKeyResolverFunc(func(
				_ context.Context,
				actorPTID string,
				homeStationPeerID string,
			) ([]*model.VerifiedActorDeviceSigningKey, error) {
				hydrationCalls++
				if actorPTID != alicePTID || homeStationPeerID != stationA {
					return nil, errors.New("unexpected hydration identity")
				}

				return nil, nil
			}),
		)
		command := fixture.command(
			t,
			model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
			"command-profile-omission",
			"request-profile-omission",
			stationA,
			stationB,
			fixture.clock.Now(),
		)
		assertReceiverRejectedWithoutSocialMutation(
			t,
			fixture.b,
			command,
			fixture.frame(
				t,
				fixture.a,
				command,
				"profile-omission-frame",
				"profile-omission-idempotency",
			),
		)
		if hydrationCalls != 1 {
			t.Fatalf("profile omission hydration calls = %d, want 1", hydrationCalls)
		}
	})

	t.Run("latest verified profile rejects revoked cached remote key", func(t *testing.T) {
		fixture := newFederatedFriendRequestFixture(t)
		hydrationCalls := 0
		fixture.b.service.WithActorDeviceKeyResolver(
			friendRequestActorKeyResolverFunc(func(
				_ context.Context,
				actorPTID string,
				homeStationPeerID string,
			) ([]*model.VerifiedActorDeviceSigningKey, error) {
				hydrationCalls++
				key := fixture.actorKeys[alicePTID]
				return []*model.VerifiedActorDeviceSigningKey{{
					ActorPtid:          actorPTID,
					ActorDeviceId:      actorPTID + ":device",
					HomeStationPeerId:  homeStationPeerID,
					SigningKeyId:       key.keyID,
					Ed25519PublicKey:   append([]byte(nil), key.publicKey...),
					ProfileVersion:     2,
					VerificationSource: model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE,
					ValidFromUnixMs:    fixture.clock.Now().Add(-time.Hour).UnixMilli(),
					RevokedAtUnixMs:    fixture.clock.Now().UnixMilli(),
				}}, nil
			}),
		)
		command := fixture.command(
			t,
			model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
			"command-profile-revoked",
			"request-profile-revoked",
			stationA,
			stationB,
			fixture.clock.Now(),
		)
		assertReceiverRejectedWithoutSocialMutation(
			t,
			fixture.b,
			command,
			fixture.frame(
				t,
				fixture.a,
				command,
				"profile-revoked-frame",
				"profile-revoked-idempotency",
			),
		)
		if hydrationCalls != 1 {
			t.Fatalf("profile revocation hydration calls = %d, want 1", hydrationCalls)
		}
	})

	t.Run("missing remote identity projection is retryable", func(t *testing.T) {
		fixture := newFederatedFriendRequestFixture(t)
		if err := fixture.b.db.
			Where("ptid = ? AND device_id = ?", alicePTID, alicePTID+":device").
			Delete(&touchactor.DeviceRecord{}).Error; err != nil {
			t.Fatal(err)
		}
		command := fixture.command(
			t,
			model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
			"command-missing-identity",
			"request-missing-identity",
			stationA,
			stationB,
			fixture.clock.Now(),
		)
		frame := fixture.frame(
			t,
			fixture.a,
			command,
			"missing-identity-frame",
			"missing-identity-idempotency",
		)
		hydrationCalls := 0
		fixture.b.service.WithActorDeviceKeyResolver(
			friendRequestActorKeyResolverFunc(func(
				_ context.Context,
				actorPTID string,
				homeStationPeerID string,
			) ([]*model.VerifiedActorDeviceSigningKey, error) {
				hydrationCalls++
				if hydrationCalls == 1 {
					return nil, errors.New("verified profile is temporarily unavailable")
				}
				key := fixture.actorKeys[alicePTID]
				return []*model.VerifiedActorDeviceSigningKey{
					&model.VerifiedActorDeviceSigningKey{
						ActorPtid:          actorPTID,
						ActorDeviceId:      actorPTID + ":device",
						HomeStationPeerId:  homeStationPeerID,
						SigningKeyId:       key.keyID,
						Ed25519PublicKey:   append([]byte(nil), key.publicKey...),
						ProfileVersion:     1,
						VerificationSource: model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE,
						ValidFromUnixMs:    fixture.clock.Now().UnixMilli(),
					},
				}, nil
			}),
		)
		assertReceiverResultWithoutSocialMutation(
			t,
			fixture.b,
			command,
			frame,
			delivery.RetryableResult(delivery.FrameErrorOverloaded),
		)

		result, err := fixture.b.receiver.Receive(context.Background(), frame)
		if err != nil || result != delivery.AcceptedResult() {
			t.Fatalf("retried command result = %+v, %v", result, err)
		}
		if hydrationCalls != 2 {
			t.Fatalf("retry hydration calls = %d, want 2", hydrationCalls)
		}
	})

	t.Run("revoked remote key", func(t *testing.T) {
		fixture := newFederatedFriendRequestFixture(t)
		hydrationCalls := 0
		fixture.b.service.WithActorDeviceKeyResolver(
			friendRequestActorKeyResolverFunc(func(
				context.Context,
				string,
				string,
			) ([]*model.VerifiedActorDeviceSigningKey, error) {
				hydrationCalls++
				return nil, nil
			}),
		)
		if err := touchactor.NewDeviceStore(fixture.b.db).Revoke(
			context.Background(),
			alicePTID,
			alicePTID+":device",
		); err != nil {
			t.Fatal(err)
		}
		command := fixture.command(
			t,
			model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
			"command-revoked",
			"request-revoked",
			stationA,
			stationB,
			fixture.clock.Now(),
		)
		assertReceiverRejectedWithoutSocialMutation(
			t,
			fixture.b,
			command,
			fixture.frame(
				t,
				fixture.a,
				command,
				"revoked-frame",
				"revoked-idempotency",
			),
		)
		if hydrationCalls != 0 {
			t.Fatalf("revoked key hydration calls = %d, want 0", hydrationCalls)
		}
	})

	t.Run("unverified remote key", func(t *testing.T) {
		fixture := newFederatedFriendRequestFixture(t)
		hydrationCalls := 0
		fixture.b.service.WithActorDeviceKeyResolver(
			friendRequestActorKeyResolverFunc(func(
				context.Context,
				string,
				string,
			) ([]*model.VerifiedActorDeviceSigningKey, error) {
				hydrationCalls++
				return nil, nil
			}),
		)
		if err := fixture.b.db.Model(&touchactor.DeviceRecord{}).
			Where("ptid = ? AND device_id = ?", alicePTID, alicePTID+":device").
			Update(
				"verification_source",
				int32(model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_UNSPECIFIED),
			).Error; err != nil {
			t.Fatal(err)
		}
		command := fixture.command(
			t,
			model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
			"command-unverified",
			"request-unverified",
			stationA,
			stationB,
			fixture.clock.Now(),
		)
		assertReceiverRejectedWithoutSocialMutation(
			t,
			fixture.b,
			command,
			fixture.frame(
				t,
				fixture.a,
				command,
				"unverified-frame",
				"unverified-idempotency",
			),
		)
		if hydrationCalls != 0 {
			t.Fatalf("unverified key hydration calls = %d, want 0", hydrationCalls)
		}
	})

	t.Run("unproven rotated remote key", func(t *testing.T) {
		fixture := newFederatedFriendRequestFixture(t)
		hydrationCalls := 0
		fixture.b.service.WithActorDeviceKeyResolver(
			friendRequestActorKeyResolverFunc(func(
				context.Context,
				string,
				string,
			) ([]*model.VerifiedActorDeviceSigningKey, error) {
				hydrationCalls++
				return nil, nil
			}),
		)
		rotatedKey := newTestKey(0x72)
		command := signedFriendRequestCommand(
			t,
			model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
			"command-unproven-rotation",
			"request-unproven-rotation",
			stationA,
			stationB,
			fixture.clock.Now(),
			rotatedKey,
		)
		assertReceiverRejectedWithoutSocialMutation(
			t,
			fixture.b,
			command,
			fixture.frame(
				t,
				fixture.a,
				command,
				"unproven-rotation-frame",
				"unproven-rotation-idempotency",
			),
		)
		if hydrationCalls != 0 {
			t.Fatalf("unproven rotation hydration calls = %d, want 0", hydrationCalls)
		}
	})
}

func TestSenderTransactionRollsBackExactCommandAndProjectionWhenOutboxConflicts(
	t *testing.T,
) {
	fixture := newFederatedFriendRequestFixture(t)
	command := fixture.command(
		t,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		"command-sender-rollback",
		"request-sender-rollback",
		stationA,
		stationB,
		fixture.clock.Now(),
	)
	conflicting := conflictingOutboxFrame(
		t,
		fixture.a,
		delivery.PayloadKindSocialFriendRequestCommand,
		command.GetBody().GetCommandId(),
		command.GetBody().GetRequestId(),
		stationB,
		1,
	)
	if _, err := fixture.a.deliveryStore.Enqueue(
		context.Background(),
		conflicting,
		fixture.clock.Now(),
	); err != nil {
		t.Fatal(err)
	}

	if _, err := fixture.a.service.SubmitFriendRequestCommand(
		context.Background(),
		command,
	); !errors.Is(err, delivery.ErrPayloadHashConflict) {
		t.Fatalf("sender outbox conflict error = %v", err)
	}
	if projection, err := fixture.a.store.Projection(
		context.Background(),
		command.GetBody().GetRequestId(),
	); err != nil || projection != nil {
		t.Fatalf("rolled-back sender projection = %+v, %v", projection, err)
	}
	if record, err := fixture.a.store.Command(
		context.Background(),
		domain.FriendRequestCommandRoleOutgoing,
		stationB,
		command.GetBody().GetCommandId(),
	); err != nil || record != nil {
		t.Fatalf("rolled-back sender command = %+v, %v", record, err)
	}
}

func TestReceiverTransactionRollsBackMaterializationWhenResultOutboxConflicts(
	t *testing.T,
) {
	fixture := newFederatedFriendRequestFixture(t)
	command := fixture.command(
		t,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		"command-receiver-rollback",
		"request-receiver-rollback",
		stationA,
		stationB,
		fixture.clock.Now(),
	)
	conflicting := conflictingOutboxFrame(
		t,
		fixture.b,
		delivery.PayloadKindSocialFriendRequestResult,
		command.GetBody().GetCommandId(),
		command.GetBody().GetRequestId(),
		stationA,
		1,
	)
	if _, err := fixture.b.deliveryStore.Enqueue(
		context.Background(),
		conflicting,
		fixture.clock.Now(),
	); err != nil {
		t.Fatal(err)
	}
	commandFrame := fixture.frame(
		t,
		fixture.a,
		command,
		"receiver-rollback-frame",
		"receiver-rollback-idempotency",
	)
	if _, err := fixture.b.receiver.Receive(
		context.Background(),
		commandFrame,
	); !errors.Is(err, delivery.ErrPayloadHashConflict) {
		t.Fatalf("receiver result outbox conflict error = %v", err)
	}
	if projection, err := fixture.b.store.Projection(
		context.Background(),
		command.GetBody().GetRequestId(),
	); err != nil || projection != nil {
		t.Fatalf("rolled-back receiver projection = %+v, %v", projection, err)
	}
	if record, err := fixture.b.store.Command(
		context.Background(),
		domain.FriendRequestCommandRoleAuthority,
		stationB,
		command.GetBody().GetCommandId(),
	); err != nil || record != nil {
		t.Fatalf("rolled-back receiver command = %+v, %v", record, err)
	}
	var inboxCount int64
	if err := fixture.b.db.Model(&delivery.InboxRecord{}).Count(&inboxCount).Error; err != nil {
		t.Fatal(err)
	}
	if inboxCount != 0 {
		t.Fatalf("rolled-back receiver inbox rows = %d, want 0", inboxCount)
	}
}

func TestReceiverPolicyRejectionRollsBackCommandWhenResultOutboxConflicts(
	t *testing.T,
) {
	fixture := newFederatedFriendRequestFixture(t)
	now := fixture.clock.Now()
	if err := fixture.b.db.Table("friend_chat_friendships").Create(
		map[string]any{
			"actor_ptid": bobPTID,
			"peer_ptid":  alicePTID,
			"status":     int32(3),
			"created_at": now,
			"updated_at": now,
		},
	).Error; err != nil {
		t.Fatal(err)
	}
	command := fixture.command(
		t,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		"command-policy-rollback",
		"request-policy-rollback",
		stationA,
		stationB,
		now,
	)
	conflicting := conflictingOutboxFrame(
		t,
		fixture.b,
		delivery.PayloadKindSocialFriendRequestResult,
		command.GetBody().GetCommandId(),
		command.GetBody().GetRequestId(),
		stationA,
		1,
	)
	if _, err := fixture.b.deliveryStore.Enqueue(
		context.Background(),
		conflicting,
		now,
	); err != nil {
		t.Fatal(err)
	}

	if _, err := fixture.b.receiver.Receive(
		context.Background(),
		fixture.frame(
			t,
			fixture.a,
			command,
			"policy-rollback-frame",
			"policy-rollback-idempotency",
		),
	); !errors.Is(err, delivery.ErrPayloadHashConflict) {
		t.Fatalf("receiver policy result outbox conflict error = %v", err)
	}
	if projection, err := fixture.b.store.Projection(
		context.Background(),
		command.GetBody().GetRequestId(),
	); err != nil || projection != nil {
		t.Fatalf("rolled-back policy projection = %+v, %v", projection, err)
	}
	if record, err := fixture.b.store.Command(
		context.Background(),
		domain.FriendRequestCommandRoleAuthority,
		stationB,
		command.GetBody().GetCommandId(),
	); err != nil || record != nil {
		t.Fatalf("rolled-back policy command = %+v, %v", record, err)
	}
}

type friendRequestActorKeyResolverFunc func(
	context.Context,
	string,
	string,
) ([]*model.VerifiedActorDeviceSigningKey, error)

func (f friendRequestActorKeyResolverFunc) ResolveVerifiedActorDeviceSigningKey(
	ctx context.Context,
	transaction delivery.Transaction,
	actorPTID string,
	homeStationPeerID string,
	deviceID string,
	signingKeyID string,
) (*model.VerifiedActorDeviceSigningKey, error) {
	if transaction == nil || transaction.DB() == nil {
		return nil, errors.New("missing bound Social transaction")
	}
	keys, err := f(ctx, actorPTID, homeStationPeerID)
	if err != nil {
		return nil, err
	}
	for _, key := range keys {
		if key != nil &&
			key.GetActorDeviceId() == deviceID &&
			key.GetSigningKeyId() == signingKeyID {
			return key, nil
		}
	}
	return nil, nil
}

type federatedFriendRequestFixture struct {
	clock      *friendRequestClock
	actorKeys  map[string]testKey
	a          *friendRequestStation
	b          *friendRequestStation
	transports map[string]*routingFriendRequestTransport
}

func newFederatedFriendRequestFixture(t *testing.T) federatedFriendRequestFixture {
	t.Helper()
	clock := newFriendRequestClock()
	stationAKey := newTestKey(0x11)
	stationBKey := newTestKey(0x22)
	actorKeys := map[string]testKey{
		alicePTID: newTestKey(0x31),
		bobPTID:   newTestKey(0x41),
	}
	keyring := stationKeyring{
		stationA: {keyID: stationAKey.keyID, publicKey: stationAKey.publicKey},
		stationB: {keyID: stationBKey.keyID, publicKey: stationBKey.publicKey},
	}
	a := newFriendRequestStation(
		t,
		stationA,
		clock,
		stationAKey,
		keyring,
		actorKeys,
	)
	b := newFriendRequestStation(
		t,
		stationB,
		clock,
		stationBKey,
		keyring,
		actorKeys,
	)
	receivers := map[string]delivery.FrameReceiver{
		stationA: a.receiver,
		stationB: b.receiver,
	}
	return federatedFriendRequestFixture{
		clock:     clock,
		actorKeys: actorKeys,
		a:         a,
		b:         b,
		transports: map[string]*routingFriendRequestTransport{
			stationA: {
				localStationID: stationA,
				local:          a.localTransport,
				receivers:      receivers,
			},
			stationB: {
				localStationID: stationB,
				local:          b.localTransport,
				receivers:      receivers,
			},
		},
	}
}

func (f federatedFriendRequestFixture) command(
	t *testing.T,
	action model.FriendRequestAction,
	commandID string,
	requestID string,
	senderHome string,
	receiverHome string,
	createdAt time.Time,
) *model.FriendRequestCommand {
	t.Helper()
	key := f.actorKeys[alicePTID]
	if action != model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND {
		key = f.actorKeys[bobPTID]
	}
	return signedFriendRequestCommand(
		t,
		action,
		commandID,
		requestID,
		senderHome,
		receiverHome,
		createdAt,
		key,
	)
}

func (f federatedFriendRequestFixture) signActorCommand(
	t *testing.T,
	command *model.FriendRequestCommand,
) {
	t.Helper()
	key := f.actorKeys[command.GetBody().GetAuthorizingDevice().GetActor().GetPtid()]
	signFriendRequestCommand(t, command, key)
}

func (f federatedFriendRequestFixture) frame(
	t *testing.T,
	source *friendRequestStation,
	command *model.FriendRequestCommand,
	frameID string,
	idempotencyKey string,
) *delivery.Frame {
	t.Helper()
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(command)
	if err != nil {
		t.Fatal(err)
	}
	frame := &delivery.Frame{
		FormatVersion:       delivery.CurrentFormatVersion,
		FrameId:             frameID,
		SourceStationPeerId: commandSourceStationForTest(command.GetBody()),
		TargetStationPeerId: command.GetBody().GetReceiverHomeStationPeerId(),
		IdempotencyKey:      idempotencyKey,
		PayloadKind:         delivery.PayloadKindSocialFriendRequestCommand,
		PayloadId:           command.GetBody().GetCommandId(),
		OrderingKey:         "test-command:" + command.GetBody().GetRequestId(),
		OrderingSequence:    0,
		OpaquePayload:       payload,
		IssuedAt:            timestamppb.New(f.clock.Now()),
		ExpiresAt:           timestamppb.New(command.GetBody().GetExpiresAt().AsTime()),
	}
	if err := delivery.SignFrame(
		context.Background(),
		frame,
		delivery.DefaultFramePolicy(frame.TargetStationPeerId),
		source.stationSigner,
	); err != nil {
		t.Fatal(err)
	}
	return frame
}

func (f federatedFriendRequestFixture) dispatchOnce(
	t *testing.T,
	station *friendRequestStation,
) {
	t.Helper()
	dispatchStationOnce(t, station, f.transports[station.id])
}

type friendRequestStation struct {
	id             string
	db             *gorm.DB
	deliveryStore  *delivery.GORMRepository
	store          *infrastructure.GORMFederatedFriendRequestStore
	service        *application.FederatedFriendRequestService
	receiver       *delivery.DeliveryReceiver
	localTransport delivery.Transport
	stationSigner  stationSigner
	clock          *friendRequestClock
}

func newFriendRequestStation(
	t *testing.T,
	stationID string,
	clock *friendRequestClock,
	stationKey testKey,
	keyring stationKeyring,
	actorKeys map[string]testKey,
) *friendRequestStation {
	t.Helper()
	db := openFriendRequestSQLite(t)
	if err := db.AutoMigrate(&dbmodel.Actor{}, &dbmodel.Follow{}); err != nil {
		t.Fatal(err)
	}
	for index, actorPTID := range []string{alicePTID, bobPTID} {
		homeStationID := stationA
		if actorPTID == bobPTID {
			homeStationID = stationB
		}
		if stationID == "station-local" {
			homeStationID = stationID
		}
		actor := dbmodel.Actor{
			ID:                uint64(index + 1),
			PTID:              actorPTID,
			Namespace:         "peers",
			PreferredUsername: fmt.Sprintf("fixture-%d", index+1),
			Email:             fmt.Sprintf("fixture-%d@example.invalid", index+1),
			PasswordHash:      "fixture",
			Kind:              "p",
			FederatedHandle:   fmt.Sprintf("@fixture-%d@%s", index+1, homeStationID),
			HomeStationPeerID: homeStationID,
			Origin:            "local",
		}
		if err := db.Create(&actor).Error; err != nil {
			t.Fatal(err)
		}
	}
	actorDeviceStore := touchactor.NewDeviceStore(db)
	if err := actorDeviceStore.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	for ptid, key := range actorKeys {
		home := stationA
		if ptid == bobPTID {
			home = stationB
		}
		if stationID == "station-local" {
			home = stationID
		}
		if home == stationID {
			if err := actorDeviceStore.RegisterLocal(
				context.Background(),
				ptid,
				ptid+":device",
				"",
				home,
				key.keyID,
				key.publicKey,
				1,
			); err != nil {
				t.Fatal(err)
			}
		} else {
			if err := actorDeviceStore.UpsertVerifiedRemote(
				context.Background(),
				&model.VerifiedActorDeviceSigningKey{
					ActorPtid:          ptid,
					ActorDeviceId:      ptid + ":device",
					HomeStationPeerId:  home,
					SigningKeyId:       key.keyID,
					Ed25519PublicKey:   append([]byte(nil), key.publicKey...),
					ProfileVersion:     1,
					VerificationSource: model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE,
					ValidFromUnixMs:    clock.Now().UnixMilli(),
				},
			); err != nil {
				t.Fatal(err)
			}
		}
	}

	deliveryStore, err := delivery.NewGORMRepository(db, clock)
	if err != nil {
		t.Fatal(err)
	}
	if err := deliveryStore.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	socialStore, err := infrastructure.NewGORMFederatedFriendRequestStore(db, clock)
	if err != nil {
		t.Fatal(err)
	}
	if err := socialStore.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	signer := stationSigner{
		keyID:      stationKey.keyID,
		privateKey: stationKey.privateKey,
	}
	service, err := application.NewFederatedFriendRequestService(
		socialStore,
		signer,
		stationID,
		clock,
	)
	if err != nil {
		t.Fatal(err)
	}
	service.WithActorDeviceKeyResolver(friendRequestActorKeyResolverFunc(func(
		_ context.Context,
		actorPTID string,
		homeStationPeerID string,
	) ([]*model.VerifiedActorDeviceSigningKey, error) {
		key, ok := actorKeys[actorPTID]
		if !ok {
			return nil, nil
		}
		expectedHome := stationA
		if actorPTID == bobPTID {
			expectedHome = stationB
		}
		if homeStationPeerID != expectedHome {
			return nil, nil
		}
		return []*model.VerifiedActorDeviceSigningKey{{
			ActorPtid:          actorPTID,
			ActorDeviceId:      actorPTID + ":device",
			HomeStationPeerId:  homeStationPeerID,
			SigningKeyId:       key.keyID,
			Ed25519PublicKey:   append([]byte(nil), key.publicKey...),
			ProfileVersion:     1,
			VerificationSource: model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE,
			ValidFromUnixMs:    clock.Now().UnixMilli(),
		}}, nil
	}))
	registry := delivery.NewRegistry()
	if err := infrastructure.RegisterFederatedFriendRequestReceivers(
		registry,
		service,
	); err != nil {
		t.Fatal(err)
	}
	receiver, err := delivery.NewReceiver(delivery.ReceiverConfig{
		Policy:     delivery.DefaultFramePolicy(stationID),
		Verifier:   keyring,
		Registry:   registry,
		UnitOfWork: deliveryStore,
		Clock:      clock,
	})
	if err != nil {
		t.Fatal(err)
	}
	localTransport, err := infrastructure.NewSameStationFriendRequestTransport(receiver)
	if err != nil {
		t.Fatal(err)
	}
	return &friendRequestStation{
		id:             stationID,
		db:             db,
		deliveryStore:  deliveryStore,
		store:          socialStore,
		service:        service,
		receiver:       receiver,
		localTransport: localTransport,
		stationSigner:  signer,
		clock:          clock,
	}
}

func deleteRemoteActorProjection(
	t *testing.T,
	db *gorm.DB,
	actorPTID string,
) {
	t.Helper()
	if err := db.Exec(
		"DELETE FROM touch_actor WHERE ptid = ?",
		actorPTID,
	).Error; err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Table("touch_actor").
		Where("ptid = ?", actorPTID).
		Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("remote Actor projection %s count = %d, want 0", actorPTID, count)
	}
}

func assertFriendshipProjection(
	t *testing.T,
	db *gorm.DB,
	ownerPTID string,
	peerPTID string,
) {
	t.Helper()
	var count int64
	if err := db.Table("friend_chat_friendships").
		Where(
			"actor_ptid = ? AND peer_ptid = ? AND status = ?",
			ownerPTID,
			peerPTID,
			acceptedFriendshipStatus,
		).
		Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf(
			"friendship projection %s -> %s count = %d, want 1",
			ownerPTID,
			peerPTID,
			count,
		)
	}
}

func dispatchStationOnce(
	t *testing.T,
	station *friendRequestStation,
	transport delivery.Transport,
) {
	t.Helper()
	dispatcher, err := delivery.NewDispatcher(
		station.deliveryStore,
		transport,
		delivery.DispatcherConfig{
			WorkerID:      "worker-" + station.id,
			BatchSize:     16,
			LeaseDuration: time.Minute,
			IdleDelay:     time.Millisecond,
			RetryBackoff: delivery.RetryBackoff{
				Initial: time.Second,
				Maximum: time.Minute,
			},
		},
		station.clock,
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := dispatcher.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
}

type routingFriendRequestTransport struct {
	mu             sync.Mutex
	localStationID string
	local          delivery.Transport
	receivers      map[string]delivery.FrameReceiver
	localCalls     int
}

func (t *routingFriendRequestTransport) Deliver(
	ctx context.Context,
	frame *delivery.Frame,
) (delivery.Result, error) {
	if frame.GetTargetStationPeerId() == t.localStationID {
		t.mu.Lock()
		t.localCalls++
		t.mu.Unlock()
		return t.local.Deliver(ctx, frame)
	}
	receiver := t.receivers[frame.GetTargetStationPeerId()]
	if receiver == nil {
		return delivery.Result{}, errors.New("test Federation target is unavailable")
	}
	return receiver.Receive(ctx, frame)
}

func (t *routingFriendRequestTransport) LocalCallCount() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.localCalls
}

type friendRequestClock struct {
	mu  sync.RWMutex
	now time.Time
}

func newFriendRequestClock() *friendRequestClock {
	return &friendRequestClock{
		now: time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC),
	}
}

func (c *friendRequestClock) Now() time.Time {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.now
}

func (c *friendRequestClock) Advance(duration time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(duration)
}

type testKey struct {
	keyID      string
	publicKey  ed25519.PublicKey
	privateKey ed25519.PrivateKey
}

func newTestKey(seed byte) testKey {
	privateKey := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{seed}, ed25519.SeedSize))
	publicKey := privateKey.Public().(ed25519.PublicKey)
	fingerprint := sha256.Sum256(publicKey)
	return testKey{
		keyID:      hex.EncodeToString(fingerprint[:]),
		publicKey:  publicKey,
		privateKey: privateKey,
	}
}

type stationSigner struct {
	keyID      string
	privateKey ed25519.PrivateKey
}

func (s stationSigner) KeyID() string {
	return s.keyID
}

func (s stationSigner) Sign(
	_ context.Context,
	canonical []byte,
) ([]byte, error) {
	return ed25519.Sign(s.privateKey, canonical), nil
}

type stationVerificationKey struct {
	keyID     string
	publicKey ed25519.PublicKey
}

type stationKeyring map[string]stationVerificationKey

func (k stationKeyring) Verify(
	_ context.Context,
	sourceStationPeerID string,
	signingKeyID string,
	canonical []byte,
	signature []byte,
) error {
	key, ok := k[sourceStationPeerID]
	if !ok ||
		key.keyID != signingKeyID ||
		!ed25519.Verify(key.publicKey, canonical, signature) {
		return errors.New("Station signature is invalid")
	}
	return nil
}

func signedFriendRequestCommand(
	t *testing.T,
	action model.FriendRequestAction,
	commandID string,
	requestID string,
	senderHome string,
	receiverHome string,
	createdAt time.Time,
	key testKey,
) *model.FriendRequestCommand {
	t.Helper()
	sender := &model.ActorRef{
		Ptid: alicePTID,
		Acct: "alice@" + senderHome,
		Kind: model.ActorKind_ACTOR_KIND_PERSON,
	}
	receiver := &model.ActorRef{
		Ptid: bobPTID,
		Acct: "bob@" + receiverHome,
		Kind: model.ActorKind_ACTOR_KIND_PERSON,
	}
	authorizer := sender
	message := "hello"
	observed := model.FriendRequestState_FRIEND_REQUEST_STATE_UNSPECIFIED
	if action != model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND {
		authorizer = receiver
		message = ""
		observed = model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING
	}
	command := &model.FriendRequestCommand{
		Body: &model.FriendRequestCommandBody{
			FormatVersion:             domain.FriendRequestCommandFormatVersion,
			CommandId:                 commandID,
			RequestId:                 requestID,
			Action:                    action,
			Sender:                    sender,
			Receiver:                  receiver,
			SenderHomeStationPeerId:   senderHome,
			ReceiverHomeStationPeerId: receiverHome,
			Message:                   message,
			ObservedRequestState:      observed,
			CreatedAt:                 timestamppb.New(createdAt),
			ExpiresAt:                 timestamppb.New(createdAt.Add(time.Hour)),
			AuthorizingDevice: &model.ActorDeviceRef{
				Actor:    authorizer,
				DeviceId: authorizer.GetPtid() + ":device",
			},
			FederationId: "federation:test",
		},
		SigningKeyId: key.keyID,
	}
	signFriendRequestCommand(t, command, key)
	return command
}

func signFriendRequestCommand(
	t *testing.T,
	command *model.FriendRequestCommand,
	key testKey,
) {
	t.Helper()
	signingBytes, err := domain.FriendRequestCommandSigningBytes(command)
	if err != nil {
		t.Fatal(err)
	}
	command.ActorDeviceSignature = ed25519.Sign(key.privateKey, signingBytes)
}

func commandSourceStationForTest(body *model.FriendRequestCommandBody) string {
	if body.GetAction() == model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND {
		return body.GetSenderHomeStationPeerId()
	}
	return body.GetReceiverHomeStationPeerId()
}

func friendRequestResultFrame(
	t *testing.T,
	source *friendRequestStation,
	target *friendRequestStation,
	result *model.FriendRequestCommandResult,
) *delivery.Frame {
	t.Helper()
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	frame := &delivery.Frame{
		FormatVersion:       delivery.CurrentFormatVersion,
		FrameId:             "result-frame:" + result.GetCommandId(),
		SourceStationPeerId: source.id,
		TargetStationPeerId: target.id,
		IdempotencyKey:      "result-idempotency:" + result.GetCommandId(),
		PayloadKind:         delivery.PayloadKindSocialFriendRequestResult,
		PayloadId:           result.GetCommandId(),
		OrderingKey:         "test-result:" + result.GetRequestId(),
		OrderingSequence:    1,
		OpaquePayload:       payload,
		IssuedAt:            timestamppb.New(source.clock.Now()),
		ExpiresAt:           timestamppb.New(source.clock.Now().Add(time.Hour)),
	}
	if err := delivery.SignFrame(
		context.Background(),
		frame,
		delivery.DefaultFramePolicy(target.id),
		source.stationSigner,
	); err != nil {
		t.Fatal(err)
	}
	return frame
}

func assertProjectionState(
	t *testing.T,
	station *friendRequestStation,
	requestID string,
	state model.FriendRequestState,
	sequence int64,
	authorityConfirmed bool,
) {
	t.Helper()
	projection, err := station.store.Projection(context.Background(), requestID)
	if err != nil {
		t.Fatal(err)
	}
	if projection == nil ||
		projection.State != state ||
		projection.Sequence != sequence ||
		projection.AuthorityConfirmed != authorityConfirmed {
		t.Fatalf("station %s projection = %+v", station.id, projection)
	}
}

func assertOutgoingCommandResult(
	t *testing.T,
	station *friendRequestStation,
	command *model.FriendRequestCommand,
	kind model.FriendRequestCommandResultKind,
	errorCode model.FriendRequestCommandErrorCode,
	eventState model.FriendRequestState,
) {
	t.Helper()
	body := command.GetBody()
	record, err := station.store.Command(
		context.Background(),
		domain.FriendRequestCommandRoleOutgoing,
		body.GetReceiverHomeStationPeerId(),
		body.GetCommandId(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if record == nil || record.ResolvedAt == nil || len(record.ResultBytes) == 0 {
		t.Fatalf("outgoing command is not durably resolved: %+v", record)
	}
	var result model.FriendRequestCommandResult
	if err := proto.Unmarshal(record.ResultBytes, &result); err != nil {
		t.Fatal(err)
	}
	if err := domain.ValidateOutgoingFriendRequestCommandResult(
		*record,
		&result,
	); err != nil {
		t.Fatalf("outgoing result binding error = %v", err)
	}
	expectedHash, err := domain.FriendRequestCommandPayloadSHA256(command)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(result.GetCommandPayloadSha256(), expectedHash) ||
		result.GetKind() != kind ||
		result.GetErrorCode() != errorCode {
		t.Fatalf("outgoing result = %+v", &result)
	}
	if eventState == model.FriendRequestState_FRIEND_REQUEST_STATE_UNSPECIFIED {
		if result.GetEvent() != nil {
			t.Fatalf("rejected outgoing result has event = %+v", result.GetEvent())
		}
		return
	}
	if result.GetEvent() == nil || result.GetEvent().GetState() != eventState {
		t.Fatalf("outgoing result event = %+v, want state %s", result.GetEvent(), eventState)
	}
}

func assertReceiverRejectedWithoutSocialMutation(
	t *testing.T,
	station *friendRequestStation,
	command *model.FriendRequestCommand,
	frame *delivery.Frame,
) {
	t.Helper()
	assertReceiverResultWithoutSocialMutation(
		t,
		station,
		command,
		frame,
		delivery.TerminalResult(delivery.FrameErrorDomainRejected),
	)
}

func assertReceiverResultWithoutSocialMutation(
	t *testing.T,
	station *friendRequestStation,
	command *model.FriendRequestCommand,
	frame *delivery.Frame,
	expected delivery.Result,
) {
	t.Helper()
	result, err := station.receiver.Receive(context.Background(), frame)
	if err != nil {
		t.Fatal(err)
	}
	if result != expected {
		t.Fatalf("receiver result = %+v, want %+v", result, expected)
	}
	if projection, err := station.store.Projection(
		context.Background(),
		command.GetBody().GetRequestId(),
	); err != nil || projection != nil {
		t.Fatalf("rejected receiver projection = %+v, %v", projection, err)
	}
	if record, err := station.store.Command(
		context.Background(),
		domain.FriendRequestCommandRoleAuthority,
		command.GetBody().GetReceiverHomeStationPeerId(),
		command.GetBody().GetCommandId(),
	); err != nil || record != nil {
		t.Fatalf("rejected receiver command = %+v, %v", record, err)
	}
}

func conflictingOutboxFrame(
	t *testing.T,
	source *friendRequestStation,
	kind delivery.PayloadKind,
	payloadID string,
	requestID string,
	targetStationID string,
	orderingSequence int64,
) *delivery.Frame {
	t.Helper()
	identity := testStableFrameIdentity(
		kind.String(),
		source.id,
		targetStationID,
		payloadID,
	)
	orderingPrefix := "social-friend-request-command:"
	if kind == delivery.PayloadKindSocialFriendRequestResult {
		orderingPrefix = "social-friend-request-result:"
	}
	frame := &delivery.Frame{
		FormatVersion:       delivery.CurrentFormatVersion,
		FrameId:             "social-frame:" + identity,
		SourceStationPeerId: source.id,
		TargetStationPeerId: targetStationID,
		IdempotencyKey:      "social-idempotency:" + identity,
		PayloadKind:         kind,
		PayloadId:           payloadID,
		OrderingKey:         orderingPrefix + requestID,
		OrderingSequence:    orderingSequence,
		OpaquePayload:       []byte("conflicting canonical payload"),
		IssuedAt:            timestamppb.New(source.clock.Now()),
		ExpiresAt:           timestamppb.New(source.clock.Now().Add(time.Hour)),
	}
	if err := delivery.SignFrame(
		context.Background(),
		frame,
		delivery.DefaultFramePolicy(targetStationID),
		source.stationSigner,
	); err != nil {
		t.Fatal(err)
	}
	return frame
}

func testStableFrameIdentity(parts ...string) string {
	hasher := sha256.New()
	for _, part := range parts {
		_, _ = hasher.Write([]byte{0})
		_, _ = hasher.Write([]byte(part))
	}
	return hex.EncodeToString(hasher.Sum(nil))
}

func openFriendRequestSQLite(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open(
			"file:friend-request-"+uuid.NewString()+
				"?mode=memory&cache=shared&_busy_timeout=5000",
		),
		&gorm.Config{Logger: gormlogger.Default.LogMode(gormlogger.Silent)},
	)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() {
		if err := sqlDB.Close(); err != nil {
			t.Errorf("close SQLite: %v", err)
		}
	})
	return db
}

type testDirectConversationModel struct {
	EffectID       string `gorm:"column:effect_id;size:255;primaryKey"`
	ConversationID string `gorm:"column:conversation_id;size:255;not null;uniqueIndex"`
	ActorAPTID     string `gorm:"column:actor_a_ptid;size:255;not null"`
	ActorBPTID     string `gorm:"column:actor_b_ptid;size:255;not null"`
}

func (*testDirectConversationModel) TableName() string {
	return "test_direct_conversations"
}

type testDirectConversationPort struct {
	db *gorm.DB
}

func newTestDirectConversationPort(
	t *testing.T,
	db *gorm.DB,
) *testDirectConversationPort {
	t.Helper()
	if err := db.AutoMigrate(&testDirectConversationModel{}); err != nil {
		t.Fatal(err)
	}
	return &testDirectConversationPort{db: db}
}

func (p *testDirectConversationPort) EnsureDirectConversation(
	ctx context.Context,
	request application.EnsureDirectConversationRequest,
) (string, error) {
	actors := []string{request.ActorAPTID, request.ActorBPTID}
	sort.Strings(actors)
	digest := sha256.Sum256([]byte(actors[0] + "\x00" + actors[1]))
	conversationID := "direct:" + hex.EncodeToString(digest[:])
	candidate := testDirectConversationModel{
		EffectID:       request.EffectID,
		ConversationID: conversationID,
		ActorAPTID:     actors[0],
		ActorBPTID:     actors[1],
	}
	if err := p.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&candidate).Error; err != nil {
		return "", err
	}
	var persisted testDirectConversationModel
	if err := p.db.WithContext(ctx).
		Where("effect_id = ?", request.EffectID).
		First(&persisted).Error; err != nil {
		return "", err
	}
	if persisted.ConversationID != conversationID ||
		persisted.ActorAPTID != actors[0] ||
		persisted.ActorBPTID != actors[1] {
		return "", fmt.Errorf("Direct Conversation effect identity conflict")
	}
	return persisted.ConversationID, nil
}

func (p *testDirectConversationPort) Count(t *testing.T) int64 {
	t.Helper()
	var count int64
	if err := p.db.Model(&testDirectConversationModel{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	return count
}
