package conversation

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	envinf "github.com/peers-labs/peers-touch/station/app/subserver/envelope/infrastructure"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

var testCommandSequence atomic.Uint64

func nextTestCommandID() string {
	return fmt.Sprintf("test-command-%d", testCommandSequence.Add(1))
}

func testOpaqueHash(value string) ([]byte, []byte) {
	opaque := []byte(value)
	hash := sha256.Sum256(opaque)
	return opaque, hash[:]
}

func testWelcome(ptid, deviceID, stationID, value string) *chat.MlsWelcomeDelivery {
	opaque, hash := testOpaqueHash(value)
	return &chat.MlsWelcomeDelivery{
		RecipientPtid:              ptid,
		RecipientDeviceId:          deviceID,
		RecipientHomeStationPeerId: stationID,
		OpaqueWelcomeBytes:         opaque,
		WelcomeSha256:              hash,
	}
}

func testTransition(
	id string,
	fromEpoch int64,
	changes []*chat.MembershipTransitionChange,
	welcomes ...*chat.MlsWelcomeDelivery,
) *chat.MembershipTransitionCommand {
	for _, change := range changes {
		if change.Action != chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD ||
			change.DeviceId != "" {
			continue
		}
		for _, welcome := range welcomes {
			if welcome.RecipientPtid == change.Ptid {
				change.DeviceId = welcome.RecipientDeviceId
				break
			}
		}
		if change.DeviceId == "" && change.Role == chat.MemberRole_MEMBER_ROLE_OWNER {
			change.DeviceId = "alice-device"
		}
	}
	opaque, hash := testOpaqueHash("commit-" + id)
	return &chat.MembershipTransitionCommand{
		TransitionId:         id,
		FromMembershipEpoch:  fromEpoch,
		FromMlsEpoch:         fromEpoch,
		ToMlsEpoch:           fromEpoch + 1,
		Changes:              changes,
		OpaqueMlsCommitBytes: opaque,
		CommitSha256:         hash,
		WelcomeDeliveries:    welcomes,
		IdempotencyKey:       id,
	}
}

func TestMembershipTransitionGenesisAddRemoveAndReplay(t *testing.T) {
	ctx := context.Background()
	db := newTransitionTestDB(t)
	repo := newPostgresConversationRepo(db)
	service := NewConversationService(
		repo,
		nil,
		"station-a",
		NewPostgresTransitionUnitOfWork(db),
	)

	genesis := testTransition(
		"transition-genesis",
		0,
		[]*chat.MembershipTransitionChange{
			{
				Ptid:                   "alice",
				ActorHomeStationPeerId: "station-a",
				Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
				Role:                   chat.MemberRole_MEMBER_ROLE_OWNER,
			},
			{
				Ptid:                   "bob",
				ActorHomeStationPeerId: "station-b",
				Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
				Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
			},
		},
		testWelcome("bob", "bob-device", "station-b", "welcome-bob"),
	)

	conversation, genesisEvent, err := service.CreateGroup(
		ctx,
		"family",
		"alice",
		"station-a",
		"alice-device",
		"",
		"",
		genesis,
	)
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	if conversation.MembershipEpoch != 1 || conversation.MlsEpoch != 1 {
		t.Fatalf(
			"genesis epochs = (%d,%d), want (1,1)",
			conversation.MembershipEpoch,
			conversation.MlsEpoch,
		)
	}
	if genesisEvent.GroupSeq != 2 {
		t.Fatalf("genesis transition seq = %d, want 2", genesisEvent.GroupSeq)
	}
	if !bytesEqual(
		genesisEvent.GetMembershipTransitionCommitted().CommitSha256,
		genesis.CommitSha256,
	) {
		t.Fatal("genesis event commit hash mismatch")
	}

	charlieTransition := testTransition(
		"transition-add-charlie",
		1,
		[]*chat.MembershipTransitionChange{{
			Ptid:                   "charlie",
			ActorHomeStationPeerId: "station-c",
			Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
			Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
		}},
		testWelcome("charlie", "charlie-device", "station-c", "welcome-charlie"),
	)
	addCommand := &chat.ConversationCommand{
		CommandId:      nextTestCommandID(),
		ConversationId: conversation.ConversationId,
		SenderPtid:     "alice",
		SenderDeviceId: "alice-device",
		Payload: &chat.ConversationCommand_MembershipTransition{
			MembershipTransition: charlieTransition,
		},
	}
	addEvent, err := service.SubmitCommand(ctx, addCommand)
	if err != nil {
		t.Fatalf("add charlie: %v", err)
	}
	if addEvent.MembershipEpoch != 2 ||
		addEvent.GetMembershipTransitionCommitted().ToMlsEpoch != 2 {
		t.Fatal("add transition did not bind membership and MLS epoch 2")
	}

	var outboxBeforeReplay int64
	if err := db.Model(&envinf.OutboxModel{}).Count(&outboxBeforeReplay).Error; err != nil {
		t.Fatal(err)
	}
	var receiptsBeforeReplay int64
	if err := db.Model(&conversationCommandReceiptModel{}).Count(&receiptsBeforeReplay).Error; err != nil {
		t.Fatal(err)
	}
	if receiptsBeforeReplay != 1 {
		t.Fatalf("transition command receipts = %d, want 1", receiptsBeforeReplay)
	}
	replayed, err := service.SubmitCommand(ctx, addCommand)
	if err != nil {
		t.Fatalf("exact replay: %v", err)
	}
	if replayed.EventId != addEvent.EventId {
		t.Fatalf("replay event = %s, want %s", replayed.EventId, addEvent.EventId)
	}
	var outboxAfterReplay int64
	if err := db.Model(&envinf.OutboxModel{}).Count(&outboxAfterReplay).Error; err != nil {
		t.Fatal(err)
	}
	if outboxAfterReplay != outboxBeforeReplay {
		t.Fatalf("exact replay added outbox rows: before=%d after=%d", outboxBeforeReplay, outboxAfterReplay)
	}
	var receiptsAfterReplay int64
	if err := db.Model(&conversationCommandReceiptModel{}).Count(&receiptsAfterReplay).Error; err != nil {
		t.Fatal(err)
	}
	if receiptsAfterReplay != receiptsBeforeReplay {
		t.Fatalf("exact replay duplicated command receipts: before=%d after=%d", receiptsBeforeReplay, receiptsAfterReplay)
	}

	removeBob := testTransition(
		"transition-remove-bob",
		2,
		[]*chat.MembershipTransitionChange{{
			Ptid:   "bob",
			Action: chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_REMOVE,
		}},
	)
	removeEvent, err := service.SubmitCommand(ctx, &chat.ConversationCommand{
		CommandId:      nextTestCommandID(),
		ConversationId: conversation.ConversationId,
		SenderPtid:     "alice",
		SenderDeviceId: "alice-device",
		Payload: &chat.ConversationCommand_MembershipTransition{
			MembershipTransition: removeBob,
		},
	})
	if err != nil {
		t.Fatalf("remove bob: %v", err)
	}
	if removeEvent.MembershipEpoch != 3 ||
		removeEvent.GetMembershipTransitionCommitted().ToMlsEpoch != 3 {
		t.Fatal("remove transition did not bind membership and MLS epoch 3")
	}
	bob, err := repo.GetMember(ctx, conversation.ConversationId, "bob")
	if err != nil {
		t.Fatal(err)
	}
	if bob.MemberStatus != chat.MemberStatus_MEMBER_STATUS_REMOVED {
		t.Fatalf("bob status = %v, want removed", bob.MemberStatus)
	}

	commitKey := removeBob.TransitionId + ":commit:bob:bob-device:" +
		hexString(removeBob.CommitSha256)
	var bobCommitRows int64
	if err := db.Model(&envinf.OutboxModel{}).
		Where("idempotency_key = ?", commitKey).
		Count(&bobCommitRows).Error; err != nil {
		t.Fatal(err)
	}
	if bobCommitRows != 1 {
		t.Fatalf("removed bob commit deliveries = %d, want 1", bobCommitRows)
	}
}

func TestMembershipTransitionDeviceRemovalAndLeaveTrackAllLeaves(t *testing.T) {
	ctx := context.Background()
	db := newTransitionTestDB(t)
	repo := newPostgresConversationRepo(db)
	service := NewConversationService(
		repo,
		nil,
		"station-a",
		NewPostgresTransitionUnitOfWork(db),
	)
	genesis := testTransition(
		"device-leaf-genesis",
		0,
		[]*chat.MembershipTransitionChange{
			{
				Ptid:                   "alice",
				ActorHomeStationPeerId: "station-a",
				Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
				Role:                   chat.MemberRole_MEMBER_ROLE_OWNER,
				DeviceId:               "alice-device",
			},
			{
				Ptid:                   "bob",
				ActorHomeStationPeerId: "station-b",
				Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
				Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
				DeviceId:               "bob-device-1",
			},
			{
				Ptid:                   "bob",
				ActorHomeStationPeerId: "station-b",
				Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD_DEVICE,
				DeviceId:               "bob-device-2",
			},
		},
		testWelcome("bob", "bob-device-1", "station-b", "welcome-bob-1"),
		testWelcome("bob", "bob-device-2", "station-b", "welcome-bob-2"),
	)
	conversation, _, err := service.CreateGroup(
		ctx,
		"family",
		"alice",
		"station-a",
		"alice-device",
		"",
		"",
		genesis,
	)
	if err != nil {
		t.Fatal(err)
	}

	removeDevice := testTransition(
		"remove-bob-device-1",
		1,
		[]*chat.MembershipTransitionChange{{
			Ptid:     "bob",
			Action:   chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_REMOVE_DEVICE,
			DeviceId: "bob-device-1",
		}},
	)
	if _, err := service.SubmitCommand(ctx, &chat.ConversationCommand{
		CommandId:      nextTestCommandID(),
		ConversationId: conversation.ConversationId,
		SenderPtid:     "alice",
		SenderDeviceId: "alice-device",
		Payload: &chat.ConversationCommand_MembershipTransition{
			MembershipTransition: removeDevice,
		},
	}); err != nil {
		t.Fatal(err)
	}
	activeDevices, err := repo.ListMemberDevices(ctx, conversation.ConversationId, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(activeDevices) != 2 ||
		!hasActiveMemberDevice(activeDevices, "alice", "alice-device") ||
		!hasActiveMemberDevice(activeDevices, "bob", "bob-device-2") {
		t.Fatalf("unexpected active devices after exact removal: %+v", activeDevices)
	}
	bob, err := repo.GetMember(ctx, conversation.ConversationId, "bob")
	if err != nil {
		t.Fatal(err)
	}
	if bob.MemberStatus != chat.MemberStatus_MEMBER_STATUS_ACTIVE {
		t.Fatalf("bob status = %v, want active", bob.MemberStatus)
	}

	leave := testTransition(
		"bob-leave",
		2,
		[]*chat.MembershipTransitionChange{{
			Ptid:   "bob",
			Action: chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_LEAVE,
		}},
	)
	leave.LeaveIntentId = "bob-leave-intent"
	now := time.Now()
	if err := newPostgresLeaveIntentRepository(db).CreateVerified(
		ctx,
		&chat.MlsLeaveIntent{
			Version:                 mlsLeaveIntentVersion,
			IntentId:                leave.LeaveIntentId,
			AuthorityStationPeerId:  "station-a",
			AuthorityEpoch:          conversation.AuthorityEpoch,
			HomeStationPeerId:       "station-b",
			ConversationId:          conversation.ConversationId,
			ActorPtid:               "bob",
			ActorDeviceId:           "bob-device-2",
			ObservedMembershipEpoch: 2,
			ObservedMlsEpoch:        2,
			CreatedAtUnixMs:         now.UnixMilli(),
			ExpiresAtUnixMs:         now.Add(5 * time.Minute).UnixMilli(),
		},
	); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SubmitCommand(ctx, &chat.ConversationCommand{
		CommandId:      nextTestCommandID(),
		ConversationId: conversation.ConversationId,
		SenderPtid:     "alice",
		SenderDeviceId: "alice-device",
		Payload: &chat.ConversationCommand_MembershipTransition{
			MembershipTransition: leave,
		},
	}); err != nil {
		t.Fatal(err)
	}
	activeDevices, err = repo.ListMemberDevices(ctx, conversation.ConversationId, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(activeDevices) != 1 ||
		!hasActiveMemberDevice(activeDevices, "alice", "alice-device") {
		t.Fatalf("unexpected active devices after leave: %+v", activeDevices)
	}
	bob, err = repo.GetMember(ctx, conversation.ConversationId, "bob")
	if err != nil {
		t.Fatal(err)
	}
	if bob.MemberStatus != chat.MemberStatus_MEMBER_STATUS_LEFT {
		t.Fatalf("bob status = %v, want left", bob.MemberStatus)
	}
	var storedIntent mlsLeaveIntentModel
	if err := db.First(&storedIntent, "intent_id = ?", leave.LeaveIntentId).Error; err != nil {
		t.Fatal(err)
	}
	if storedIntent.Status != "consumed" || storedIntent.ConsumedBy != leave.TransitionId {
		t.Fatalf("leave intent was not atomically consumed: %+v", storedIntent)
	}
	var leaveRows []envinf.OutboxModel
	if err := db.Where(
		"idempotency_key LIKE ?",
		leave.TransitionId+":%",
	).Find(&leaveRows).Error; err != nil {
		t.Fatal(err)
	}
	eventDeliveries := 0
	commitDeliveries := 0
	for _, row := range leaveRows {
		var envelope chat.StationEnvelope
		if err := proto.Unmarshal(row.EnvelopeBytes, &envelope); err != nil {
			t.Fatal(err)
		}
		if envelope.RecipientPtid != "bob" {
			continue
		}
		switch envelope.PayloadType {
		case chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_COMMITTED_EVENT:
			eventDeliveries++
		case chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_MLS_TRANSITION_DELIVERY:
			commitDeliveries++
		}
	}
	if eventDeliveries != 1 || commitDeliveries != 1 {
		t.Fatalf(
			"departing bob deliveries = event:%d commit:%d, want exact pair",
			eventDeliveries,
			commitDeliveries,
		)
	}
}

func TestMembershipTransitionRejectsStaleEpochWithoutWrites(t *testing.T) {
	ctx := context.Background()
	db := newTransitionTestDB(t)
	repo := newPostgresConversationRepo(db)
	service := NewConversationService(
		repo,
		nil,
		"station-a",
		NewPostgresTransitionUnitOfWork(db),
	)
	genesis := testTransition(
		"stale-genesis",
		0,
		[]*chat.MembershipTransitionChange{{
			Ptid:                   "alice",
			ActorHomeStationPeerId: "station-a",
			Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
			Role:                   chat.MemberRole_MEMBER_ROLE_OWNER,
		}},
	)
	conversation, _, err := service.CreateGroup(
		ctx,
		"family",
		"alice",
		"station-a",
		"alice-device",
		"",
		"",
		genesis,
	)
	if err != nil {
		t.Fatal(err)
	}

	var eventsBefore int64
	if err := db.Model(&conversationEventModel{}).Count(&eventsBefore).Error; err != nil {
		t.Fatal(err)
	}
	stale := testTransition(
		"stale-add",
		0,
		[]*chat.MembershipTransitionChange{{
			Ptid:                   "bob",
			ActorHomeStationPeerId: "station-b",
			Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
			Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
		}},
	)
	_, err = service.SubmitCommand(ctx, &chat.ConversationCommand{
		CommandId:      nextTestCommandID(),
		ConversationId: conversation.ConversationId,
		SenderPtid:     "alice",
		SenderDeviceId: "alice-device",
		Payload: &chat.ConversationCommand_MembershipTransition{
			MembershipTransition: stale,
		},
	})
	if err == nil {
		t.Fatal("stale transition was accepted")
	}
	var eventsAfter int64
	if err := db.Model(&conversationEventModel{}).Count(&eventsAfter).Error; err != nil {
		t.Fatal(err)
	}
	if eventsAfter != eventsBefore {
		t.Fatalf("stale transition wrote events: before=%d after=%d", eventsBefore, eventsAfter)
	}
}

func TestMembershipTransitionRejectsCommandIDReuseWithDifferentContent(t *testing.T) {
	ctx := context.Background()
	db := newTransitionTestDB(t)
	repo := newPostgresConversationRepo(db)
	service := NewConversationService(
		repo,
		nil,
		"station-a",
		NewPostgresTransitionUnitOfWork(db),
	)
	genesis := testTransition(
		"conflict-genesis",
		0,
		[]*chat.MembershipTransitionChange{{
			Ptid:                   "alice",
			ActorHomeStationPeerId: "station-a",
			Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
			Role:                   chat.MemberRole_MEMBER_ROLE_OWNER,
		}},
	)
	conversation, _, err := service.CreateGroup(
		ctx,
		"family",
		"alice",
		"station-a",
		"alice-device",
		"",
		"",
		genesis,
	)
	if err != nil {
		t.Fatal(err)
	}

	accepted := testTransition(
		"conflicting-transition",
		1,
		[]*chat.MembershipTransitionChange{{
			Ptid:                   "bob",
			ActorHomeStationPeerId: "station-b",
			Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
			Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
		}},
		testWelcome("bob", "bob-device", "station-b", "welcome-bob"),
	)
	command := &chat.ConversationCommand{
		CommandId:      nextTestCommandID(),
		ConversationId: conversation.ConversationId,
		SenderPtid:     "alice",
		SenderDeviceId: "alice-device",
		Payload: &chat.ConversationCommand_MembershipTransition{
			MembershipTransition: accepted,
		},
	}
	if _, err := service.SubmitCommand(ctx, command); err != nil {
		t.Fatalf("accept transition: %v", err)
	}

	conflicting := proto.Clone(accepted).(*chat.MembershipTransitionCommand)
	conflicting.Changes[0].Ptid = "charlie"
	conflicting.Changes[0].ActorHomeStationPeerId = "station-c"
	command.Payload = &chat.ConversationCommand_MembershipTransition{
		MembershipTransition: conflicting,
	}
	_, err = service.SubmitCommand(ctx, command)
	var transitionErr *TransitionError
	if !errors.As(err, &transitionErr) || transitionErr.Code != "COMMAND_CONFLICT" {
		t.Fatalf("conflicting replay error = %v, want COMMAND_CONFLICT", err)
	}
	command.CommandId = nextTestCommandID()
	command.Payload = &chat.ConversationCommand_MembershipTransition{
		MembershipTransition: accepted,
	}
	_, err = service.SubmitCommand(ctx, command)
	if !errors.As(err, &transitionErr) || transitionErr.Code != "COMMAND_CONFLICT" {
		t.Fatalf("transition-id replay under new command error = %v, want COMMAND_CONFLICT", err)
	}
	if _, err := repo.GetMember(ctx, conversation.ConversationId, "charlie"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("conflicting replay wrote charlie membership: %v", err)
	}
}

func TestMembershipTransitionAdmissionLimits(t *testing.T) {
	command := &chat.ConversationCommand{
		CommandId:      nextTestCommandID(),
		SenderPtid:     "alice",
		SenderDeviceId: "alice-device",
	}
	change := &chat.MembershipTransitionChange{
		Ptid:                   "bob",
		DeviceId:               "bob-device",
		ActorHomeStationPeerId: "station-b",
		Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD_DEVICE,
	}
	newTransition := func() *chat.MembershipTransitionCommand {
		commit := make([]byte, maxMlsCommitBytes)
		commitHash := sha256.Sum256(commit)
		return &chat.MembershipTransitionCommand{
			TransitionId:         "limits",
			FromMembershipEpoch:  1,
			FromMlsEpoch:         1,
			ToMlsEpoch:           2,
			Changes:              []*chat.MembershipTransitionChange{change},
			OpaqueMlsCommitBytes: commit,
			CommitSha256:         commitHash[:],
			IdempotencyKey:       "limits",
		}
	}

	atCommitLimit := newTransition()
	if err := validateMembershipTransitionInput(command, atCommitLimit); err != nil {
		t.Fatalf("128 KiB Commit rejected: %v", err)
	}

	overCommitLimit := newTransition()
	overCommitLimit.OpaqueMlsCommitBytes = make([]byte, maxMlsCommitBytes+1)
	overCommitHash := sha256.Sum256(overCommitLimit.OpaqueMlsCommitBytes)
	overCommitLimit.CommitSha256 = overCommitHash[:]
	assertTransitionErrorCode(t, validateMembershipTransitionInput(command, overCommitLimit), "PAYLOAD_TOO_LARGE")

	atWelcomeLimit := newTransition()
	welcomeBytes := make([]byte, maxMlsWelcomeBytes)
	welcomeHash := sha256.Sum256(welcomeBytes)
	atWelcomeLimit.WelcomeDeliveries = []*chat.MlsWelcomeDelivery{{
		RecipientPtid:              "bob",
		RecipientDeviceId:          "bob-device",
		RecipientHomeStationPeerId: "station-b",
		OpaqueWelcomeBytes:         welcomeBytes,
		WelcomeSha256:              welcomeHash[:],
	}}
	if err := validateMembershipTransitionInput(command, atWelcomeLimit); err != nil {
		t.Fatalf("8 MiB Welcome payload rejected: %v", err)
	}

	overWelcomeLimit := newTransition()
	overWelcomeBytes := make([]byte, maxMlsWelcomeBytes+1)
	overWelcomeHash := sha256.Sum256(overWelcomeBytes)
	overWelcomeLimit.WelcomeDeliveries = []*chat.MlsWelcomeDelivery{{
		RecipientPtid:              "bob",
		RecipientDeviceId:          "bob-device",
		RecipientHomeStationPeerId: "station-b",
		OpaqueWelcomeBytes:         overWelcomeBytes,
		WelcomeSha256:              overWelcomeHash[:],
	}}
	assertTransitionErrorCode(t, validateMembershipTransitionInput(command, overWelcomeLimit), "PAYLOAD_TOO_LARGE")

	atDeliveryLimit := newTransition()
	opaqueWelcome, welcomeDigest := testOpaqueHash("welcome")
	for i := 0; i < maxTransitionDeliveries; i++ {
		atDeliveryLimit.WelcomeDeliveries = append(
			atDeliveryLimit.WelcomeDeliveries,
			&chat.MlsWelcomeDelivery{
				RecipientPtid:              "bob",
				RecipientDeviceId:          string(rune(i + 1)),
				RecipientHomeStationPeerId: "station-b",
				OpaqueWelcomeBytes:         opaqueWelcome,
				WelcomeSha256:              welcomeDigest,
			},
		)
	}
	if err := validateMembershipTransitionInput(command, atDeliveryLimit); err != nil {
		t.Fatalf("200 Welcome deliveries rejected: %v", err)
	}
	overDeliveryLimit := proto.Clone(atDeliveryLimit).(*chat.MembershipTransitionCommand)
	overDeliveryLimit.WelcomeDeliveries = append(
		overDeliveryLimit.WelcomeDeliveries,
		proto.Clone(overDeliveryLimit.WelcomeDeliveries[0]).(*chat.MlsWelcomeDelivery),
	)
	assertTransitionErrorCode(t, validateMembershipTransitionInput(command, overDeliveryLimit), "TOO_MANY_RECIPIENTS")
}

func TestMembershipTransitionRejectsDivergedAuthorityHeads(t *testing.T) {
	ctx := context.Background()
	db := newTransitionTestDB(t)
	repo := newPostgresConversationRepo(db)
	service := NewConversationService(
		repo,
		nil,
		"station-a",
		NewPostgresTransitionUnitOfWork(db),
	)
	genesis := testTransition(
		"diverged-genesis",
		0,
		[]*chat.MembershipTransitionChange{{
			Ptid:                   "alice",
			ActorHomeStationPeerId: "station-a",
			Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
			Role:                   chat.MemberRole_MEMBER_ROLE_OWNER,
		}},
	)
	conversation, _, err := service.CreateGroup(
		ctx,
		"family",
		"alice",
		"station-a",
		"alice-device",
		"",
		"",
		genesis,
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&conversationModel{}).
		Where("conversation_id = ?", conversation.ConversationId).
		Update("mls_epoch", 0).Error; err != nil {
		t.Fatal(err)
	}

	transition := testTransition(
		"diverged-add",
		1,
		[]*chat.MembershipTransitionChange{{
			Ptid:                   "bob",
			ActorHomeStationPeerId: "station-b",
			Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
			Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
		}},
	)
	transition.FromMlsEpoch = 0
	_, err = service.SubmitCommand(ctx, &chat.ConversationCommand{
		CommandId:      nextTestCommandID(),
		ConversationId: conversation.ConversationId,
		SenderPtid:     "alice",
		SenderDeviceId: "alice-device",
		Payload: &chat.ConversationCommand_MembershipTransition{
			MembershipTransition: transition,
		},
	})
	assertTransitionErrorCode(t, err, "GROUP_READ_ONLY")
	if _, err := repo.GetMember(ctx, conversation.ConversationId, "bob"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("diverged transition wrote bob membership: %v", err)
	}
}

func TestMembershipTransitionDeliversCommitToSiblingDevices(t *testing.T) {
	ctx := context.Background()
	db := newTransitionTestDB(t)
	repo := newPostgresConversationRepo(db)
	service := NewConversationService(
		repo,
		nil,
		"station-a",
		NewPostgresTransitionUnitOfWork(db),
	)
	genesis := testTransition(
		"device-genesis",
		0,
		[]*chat.MembershipTransitionChange{
			{
				Ptid:                   "alice",
				ActorHomeStationPeerId: "station-a",
				Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
				Role:                   chat.MemberRole_MEMBER_ROLE_OWNER,
			},
			{
				Ptid:                   "bob",
				ActorHomeStationPeerId: "station-b",
				Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
				Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
			},
		},
		testWelcome("bob", "bob-device", "station-b", "welcome-bob"),
	)
	conversation, _, err := service.CreateGroup(
		ctx,
		"family",
		"alice",
		"station-a",
		"alice-device",
		"",
		"",
		genesis,
	)
	if err != nil {
		t.Fatal(err)
	}

	addSibling := testTransition(
		"add-alice-sibling",
		1,
		[]*chat.MembershipTransitionChange{{
			Ptid:                   "alice",
			DeviceId:               "alice-device-2",
			ActorHomeStationPeerId: "station-a",
			Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD_DEVICE,
		}},
		testWelcome("alice", "alice-device-2", "station-a", "welcome-alice-sibling"),
	)
	if _, err := service.SubmitCommand(ctx, &chat.ConversationCommand{
		CommandId:      nextTestCommandID(),
		ConversationId: conversation.ConversationId,
		SenderPtid:     "alice",
		SenderDeviceId: "alice-device",
		Payload: &chat.ConversationCommand_MembershipTransition{
			MembershipTransition: addSibling,
		},
	}); err != nil {
		t.Fatalf("add sibling device: %v", err)
	}

	removeBob := testTransition(
		"device-remove-bob",
		2,
		[]*chat.MembershipTransitionChange{{
			Ptid:   "bob",
			Action: chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_REMOVE,
		}},
	)
	if _, err := service.SubmitCommand(ctx, &chat.ConversationCommand{
		CommandId:      nextTestCommandID(),
		ConversationId: conversation.ConversationId,
		SenderPtid:     "alice",
		SenderDeviceId: "alice-device",
		Payload: &chat.ConversationCommand_MembershipTransition{
			MembershipTransition: removeBob,
		},
	}); err != nil {
		t.Fatalf("remove bob: %v", err)
	}

	siblingKey := removeBob.TransitionId + ":commit:alice:alice-device-2:" +
		hexString(removeBob.CommitSha256)
	var siblingRows int64
	if err := db.Model(&envinf.InboxModel{}).
		Where("idempotency_key = ?", siblingKey).
		Count(&siblingRows).Error; err != nil {
		t.Fatal(err)
	}
	if siblingRows != 1 {
		t.Fatalf("sibling device commit deliveries = %d, want 1", siblingRows)
	}

	senderKey := removeBob.TransitionId + ":commit:alice:alice-device:" +
		hexString(removeBob.CommitSha256)
	var senderRows int64
	if err := db.Model(&envinf.InboxModel{}).
		Where("idempotency_key = ?", senderKey).
		Count(&senderRows).Error; err != nil {
		t.Fatal(err)
	}
	if senderRows != 0 {
		t.Fatalf("sender device received its own Commit: rows=%d", senderRows)
	}
}

func TestMembershipTransitionRequiresWelcomeAndProtectsOwnerTruth(t *testing.T) {
	addWithoutWelcome := testTransition(
		"missing-welcome",
		1,
		[]*chat.MembershipTransitionChange{{
			Ptid:                   "bob",
			ActorHomeStationPeerId: "station-b",
			Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
			Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
		}},
	)
	assertTransitionErrorCode(t, validateWelcomeTargets(addWithoutWelcome, "", ""), "INVALID_TRANSITION")

	assertTransitionErrorCode(
		t,
		validateTransitionOwnership(
			"alice",
			"admin",
			[]*chat.MembershipTransitionChange{{
				Ptid:   "admin",
				Action: chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ROLE_CHANGE,
				Role:   chat.MemberRole_MEMBER_ROLE_OWNER,
			}},
		),
		"PERMISSION_DENIED",
	)
	assertTransitionErrorCode(
		t,
		validateTransitionOwnership(
			"alice",
			"alice",
			[]*chat.MembershipTransitionChange{{
				Ptid:   "alice",
				Action: chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_REMOVE,
			}},
		),
		"PERMISSION_DENIED",
	)
}

func TestMembershipTransitionCountsAllLogicalDeliveries(t *testing.T) {
	members := make([]*chat.ConversationMember, 0, 100)
	devices := make([]MemberDevice, 0, 100)
	for i := 0; i < 100; i++ {
		ptid := fmt.Sprintf("member-%d", i)
		members = append(members, &chat.ConversationMember{
			Ptid:         ptid,
			MemberStatus: chat.MemberStatus_MEMBER_STATUS_ACTIVE,
		})
		devices = append(devices, MemberDevice{
			Ptid:     ptid,
			DeviceID: fmt.Sprintf("device-%d", i),
			Active:   true,
		})
	}
	transition := testTransition(
		"delivery-limit",
		1,
		[]*chat.MembershipTransitionChange{{
			Ptid:                   "new-member",
			ActorHomeStationPeerId: "station-b",
			Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
			Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
		}},
		testWelcome("new-member", "new-device", "station-b", "welcome-new"),
	)
	assertTransitionErrorCode(
		t,
		validateTransitionDeliveryAdmission(
			members,
			devices,
			&chat.ConversationCommand{
				CommandId:      nextTestCommandID(),
				SenderPtid:     "member-0",
				SenderDeviceId: "device-0",
			},
			transition,
		),
		"TOO_MANY_RECIPIENTS",
	)
}

func TestMembershipTransitionConcurrentExactDuplicate(t *testing.T) {
	ctx := context.Background()
	db := newTransitionTestDB(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	repo := newPostgresConversationRepo(db)
	service := NewConversationService(
		repo,
		nil,
		"station-a",
		NewPostgresTransitionUnitOfWork(db),
	)
	conversation := createOwnerOnlyTransitionGroup(t, ctx, service, "concurrent-replay-genesis")
	transition := testTransition(
		"concurrent-replay",
		1,
		[]*chat.MembershipTransitionChange{{
			Ptid:                   "bob",
			ActorHomeStationPeerId: "station-b",
			Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
			Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
		}},
		testWelcome("bob", "bob-device", "station-b", "welcome-bob"),
	)
	command := &chat.ConversationCommand{
		CommandId:      nextTestCommandID(),
		ConversationId: conversation.ConversationId,
		SenderPtid:     "alice",
		SenderDeviceId: "alice-device",
		Payload: &chat.ConversationCommand_MembershipTransition{
			MembershipTransition: transition,
		},
	}

	events := make([]*chat.CommittedConversationEvent, 2)
	errs := make([]error, 2)
	var wait sync.WaitGroup
	wait.Add(2)
	for i := range events {
		go func(index int) {
			defer wait.Done()
			events[index], errs[index] = service.SubmitCommand(ctx, command)
		}(i)
	}
	wait.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatalf("concurrent exact replay: %v", err)
		}
	}
	if events[0].EventId != events[1].EventId {
		t.Fatalf("concurrent replay events differ: %s != %s", events[0].EventId, events[1].EventId)
	}
	var eventRows int64
	if err := db.Model(&conversationEventModel{}).
		Where("conversation_id = ? AND transition_id = ?", conversation.ConversationId, transition.TransitionId).
		Count(&eventRows).Error; err != nil {
		t.Fatal(err)
	}
	if eventRows != 1 {
		t.Fatalf("concurrent replay event rows = %d, want 1", eventRows)
	}
}

func TestMembershipTransitionConcurrentDistinctCommandsUseOneEpoch(t *testing.T) {
	ctx := context.Background()
	db := newTransitionTestDB(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	repo := newPostgresConversationRepo(db)
	service := NewConversationService(
		repo,
		nil,
		"station-a",
		NewPostgresTransitionUnitOfWork(db),
	)
	conversation := createOwnerOnlyTransitionGroup(t, ctx, service, "concurrent-distinct-genesis")
	transitions := []*chat.MembershipTransitionCommand{
		testTransition(
			"concurrent-add-bob",
			1,
			[]*chat.MembershipTransitionChange{{
				Ptid:                   "bob",
				ActorHomeStationPeerId: "station-b",
				Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
				Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
			}},
			testWelcome("bob", "bob-device", "station-b", "welcome-bob"),
		),
		testTransition(
			"concurrent-add-charlie",
			1,
			[]*chat.MembershipTransitionChange{{
				Ptid:                   "charlie",
				ActorHomeStationPeerId: "station-c",
				Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
				Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
			}},
			testWelcome("charlie", "charlie-device", "station-c", "welcome-charlie"),
		),
	}

	errs := make([]error, len(transitions))
	var wait sync.WaitGroup
	wait.Add(len(transitions))
	for i, transition := range transitions {
		go func(index int, candidate *chat.MembershipTransitionCommand) {
			defer wait.Done()
			_, errs[index] = service.SubmitCommand(ctx, &chat.ConversationCommand{
				CommandId:      nextTestCommandID(),
				ConversationId: conversation.ConversationId,
				SenderPtid:     "alice",
				SenderDeviceId: "alice-device",
				Payload: &chat.ConversationCommand_MembershipTransition{
					MembershipTransition: candidate,
				},
			})
		}(i, transition)
	}
	wait.Wait()
	successes := 0
	stale := 0
	for _, err := range errs {
		if err == nil {
			successes++
			continue
		}
		var transitionErr *TransitionError
		if errors.As(err, &transitionErr) && transitionErr.Code == "EPOCH_STALE" {
			stale++
		}
	}
	if successes != 1 || stale != 1 {
		t.Fatalf("concurrent distinct results: successes=%d stale=%d errors=%v", successes, stale, errs)
	}
	persisted, err := repo.GetConversation(ctx, conversation.ConversationId)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.MembershipEpoch != 2 || persisted.MlsEpoch != 2 {
		t.Fatalf("concurrent distinct epochs = (%d,%d), want (2,2)", persisted.MembershipEpoch, persisted.MlsEpoch)
	}
}

func createOwnerOnlyTransitionGroup(
	t *testing.T,
	ctx context.Context,
	service *DefaultService,
	transitionID string,
) *chat.Conversation {
	t.Helper()
	genesis := testTransition(
		transitionID,
		0,
		[]*chat.MembershipTransitionChange{{
			Ptid:                   "alice",
			ActorHomeStationPeerId: "station-a",
			Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
			Role:                   chat.MemberRole_MEMBER_ROLE_OWNER,
		}},
	)
	conversation, _, err := service.CreateGroup(
		ctx,
		"family",
		"alice",
		"station-a",
		"alice-device",
		"",
		"",
		genesis,
	)
	if err != nil {
		t.Fatal(err)
	}
	return conversation
}

type persistedNotificationSpy struct {
	db          *gorm.DB
	notified    int
	missingRows int
}

func (s *persistedNotificationSpy) SubmitEvent(
	context.Context,
	*chat.Conversation,
	[]*chat.ConversationMember,
	*chat.CommittedConversationEvent,
) error {
	return nil
}

func (s *persistedNotificationSpy) SubmitReceipt(
	context.Context,
	*chat.MessageReceipt,
	string,
	string,
) error {
	return nil
}

func (s *persistedNotificationSpy) NotifyPersisted(
	_ context.Context,
	item *chat.DeviceInboxItem,
) {
	s.notified++
	var count int64
	if err := s.db.Model(&envinf.InboxModel{}).
		Where("inbox_item_id = ?", item.InboxItemId).
		Count(&count).Error; err != nil || count != 1 {
		s.missingRows++
	}
}

func TestMembershipTransitionNotifiesOnlyAfterInboxCommit(t *testing.T) {
	ctx := context.Background()
	db := newTransitionTestDB(t)
	repo := newPostgresConversationRepo(db)
	notifier := &persistedNotificationSpy{db: db}
	service := NewConversationService(
		repo,
		notifier,
		"station-a",
		NewPostgresTransitionUnitOfWork(db),
	)
	genesis := testTransition(
		"notify-genesis",
		0,
		[]*chat.MembershipTransitionChange{{
			Ptid:                   "alice",
			ActorHomeStationPeerId: "station-a",
			Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
			Role:                   chat.MemberRole_MEMBER_ROLE_OWNER,
		}},
	)
	if _, _, err := service.CreateGroup(
		ctx,
		"family",
		"alice",
		"station-a",
		"alice-device",
		"",
		"",
		genesis,
	); err != nil {
		t.Fatal(err)
	}
	if notifier.notified != 2 {
		t.Fatalf("post-commit notifications = %d, want 2", notifier.notified)
	}
	if notifier.missingRows != 0 {
		t.Fatalf("notifications observed %d uncommitted inbox rows", notifier.missingRows)
	}
}

func assertTransitionErrorCode(t *testing.T, err error, code string) {
	t.Helper()
	var transitionErr *TransitionError
	if !errors.As(err, &transitionErr) || transitionErr.Code != code {
		t.Fatalf("transition error = %v, want %s", err, code)
	}
}

func bytesEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func hexString(value []byte) string {
	const digits = "0123456789abcdef"
	result := make([]byte, len(value)*2)
	for i, b := range value {
		result[i*2] = digits[b>>4]
		result[i*2+1] = digits[b&0x0f]
	}
	return string(result)
}
