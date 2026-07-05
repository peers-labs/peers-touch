package group_chat

import (
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/group_chat/domain"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestGroupSettingsBackgroundNormalization(t *testing.T) {
	for _, tc := range []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty", input: "", want: "default"},
		{name: "blank", input: "  ", want: "default"},
		{name: "default", input: "default", want: "default"},
		{name: "paper", input: "paper", want: "paper"},
		{name: "mint", input: "mint", want: "mint"},
		{name: "dusk", input: "dusk", want: "dusk"},
		{name: "calm", input: "calm", want: "calm"},
		{name: "graphite", input: "graphite", want: "graphite"},
		{name: "unknown", input: "neon", want: "default"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := normalizedSettingBackground(tc.input); got != tc.want {
				t.Fatalf("normalizedSettingBackground(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestRemoveMemberReturnsFalseWhenMemberMissing(t *testing.T) {
	svc := &service{
		groups:       map[string]*group{},
		messages:     map[string][]message{},
		messagesByID: map[string]message{},
		members:      map[string]map[string]*member{},
		invitations:  map[string]*invitation{},
		settings:     map[string]map[string]groupSetting{},
		offline:      map[string][]offlineMessage{},
		unread:       map[string]map[string]int64{},
		threadReads:  map[string]threadRead{},
	}
	group := svc.CreateGroup("owner", "Engineering", "")

	if svc.RemoveMember(group.ID, "missing-member") {
		t.Fatal("expected removing a missing member to return false")
	}
}

func TestCreateGroupProjectsOwnerMembershipRole(t *testing.T) {
	svc := newTestService()
	group := svc.CreateGroup("owner", "Engineering", "")

	member, ok := svc.GetMember(group.ID, "owner")
	if !ok {
		t.Fatal("expected creator to be a group member")
	}
	if member.Role != domain.GroupRoleOwner {
		t.Fatalf("expected creator role owner, got %d", member.Role)
	}

	members, total := svc.ListMembers(group.ID, 20, 0)
	if total != 1 || len(members) != 1 {
		t.Fatalf("expected one group member, got total=%d len=%d", total, len(members))
	}
	if members[0].ActorDID != "owner" || members[0].Role != domain.GroupRoleOwner {
		t.Fatalf("expected listed owner role, got %+v", members[0])
	}
}

func TestCreateGroupProjectsOwnerMembershipRoleWithDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:create_group_owner_role?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&groupModel{}, &memberModel{}, &outboxModel{}, &groupEventModel{}); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}
	svc := &service{db: db}

	group := svc.CreateGroup("owner", "Engineering", "")

	member, ok := svc.GetMember(group.ID, "owner")
	if !ok {
		t.Fatal("expected creator to be a group member")
	}
	if member.Role != domain.GroupRoleOwner {
		t.Fatalf("expected creator role owner from db, got %d", member.Role)
	}

	members, total := svc.ListMembers(group.ID, 20, 0)
	if total != 1 || len(members) != 1 {
		t.Fatalf("expected one group member from db, got total=%d len=%d", total, len(members))
	}
	if members[0].ActorDID != "owner" || members[0].Role != domain.GroupRoleOwner {
		t.Fatalf("expected listed db owner role, got %+v", members[0])
	}
}

func TestInvitationAcceptanceWithDBRequiresPendingAndUnexpired(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:group_invitation_acceptance?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&invitationModel{}); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}
	svc := &service{db: db}

	inv := svc.CreateInvitation("group-1", "owner", "invitee")
	if inv.ExpireAt.IsZero() || !inv.ExpireAt.After(inv.CreatedAt) {
		t.Fatalf("expected invitation expiration after creation, got created=%v expire=%v", inv.CreatedAt, inv.ExpireAt)
	}

	groupID, ok := svc.AcceptInvitation(inv.ID, "invitee")
	if !ok || groupID != "group-1" {
		t.Fatalf("expected pending invitation acceptance, group=%s ok=%v", groupID, ok)
	}
	if _, ok := svc.AcceptInvitation(inv.ID, "invitee"); ok {
		t.Fatal("expected accepted invitation to be single-use")
	}

	now := time.Now()
	expired := invitationModel{
		ULID:       "expired-invite",
		GroupULID:  "group-1",
		InviterDID: "owner",
		InviteeDID: "late",
		Status:     groupInvitationStatusPending,
		ExpireAt:   now.Add(-time.Hour),
		CreatedAt:  now.Add(-2 * time.Hour),
		UpdatedAt:  now.Add(-2 * time.Hour),
	}
	if err := db.Create(&expired).Error; err != nil {
		t.Fatalf("create expired invite: %v", err)
	}
	if _, ok := svc.AcceptInvitation("expired-invite", "late"); ok {
		t.Fatal("expected expired invitation acceptance to fail")
	}
	var row invitationModel
	if err := db.Where("ulid = ?", "expired-invite").First(&row).Error; err != nil {
		t.Fatalf("read expired invite: %v", err)
	}
	if row.Status != groupInvitationStatusExpired {
		t.Fatalf("expected expired invite status %d, got %d", groupInvitationStatusExpired, row.Status)
	}
}

func TestTransferOwnershipUpdatesOwnerAndRoles(t *testing.T) {
	svc := newTestService()
	group := svc.CreateGroup("owner", "Engineering", "")
	if _, ok := svc.AddMember(group.ID, "member", "owner"); !ok {
		t.Fatal("expected member add to succeed")
	}

	updated, ok := svc.TransferOwnership(group.ID, "owner", "member")
	if !ok {
		t.Fatal("expected transfer ownership to succeed")
	}
	if updated.OwnerDID != "member" {
		t.Fatalf("expected group owner member, got %s", updated.OwnerDID)
	}
	oldOwner, _ := svc.GetMember(group.ID, "owner")
	nextOwner, _ := svc.GetMember(group.ID, "member")
	if oldOwner.Role != 2 || nextOwner.Role != 3 {
		t.Fatalf("expected old owner admin and new owner owner, got %d/%d", oldOwner.Role, nextOwner.Role)
	}
}

func TestMembershipEpochBumpsOnMemberAddRemove(t *testing.T) {
	svc := newTestService()
	group := svc.CreateGroup("owner", "Engineering", "")
	if group.MembershipEpoch != 1 {
		t.Fatalf("expected initial membership epoch 1, got %d", group.MembershipEpoch)
	}
	if _, ok := svc.AddMember(group.ID, "member", "owner"); !ok {
		t.Fatal("expected member add to succeed")
	}
	afterAdd, ok := svc.GetGroup(group.ID)
	if !ok {
		t.Fatal("expected group after add")
	}
	if afterAdd.MembershipEpoch != 2 {
		t.Fatalf("expected epoch 2 after add, got %d", afterAdd.MembershipEpoch)
	}
	if !svc.RemoveMember(group.ID, "member") {
		t.Fatal("expected member remove to succeed")
	}
	afterRemove, ok := svc.GetGroup(group.ID)
	if !ok {
		t.Fatal("expected group after remove")
	}
	if afterRemove.MembershipEpoch != 3 {
		t.Fatalf("expected epoch 3 after remove, got %d", afterRemove.MembershipEpoch)
	}
}

func TestMembershipEpochBumpsOnMemberAddRemoveWithDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:membership_epoch_add_remove?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&groupModel{}, &memberModel{}, &outboxModel{}, &groupEventModel{}); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}
	svc := &service{db: db}
	group := svc.CreateGroup("owner", "Engineering", "")
	if group.MembershipEpoch != 1 {
		t.Fatalf("expected initial membership epoch 1, got %d", group.MembershipEpoch)
	}
	if _, ok := svc.AddMember(group.ID, "member", "owner"); !ok {
		t.Fatal("expected member add to succeed")
	}
	afterAdd, ok := svc.GetGroup(group.ID)
	if !ok {
		t.Fatal("expected group after add")
	}
	if afterAdd.MembershipEpoch != 2 {
		t.Fatalf("expected epoch 2 after add, got %d", afterAdd.MembershipEpoch)
	}
	if !svc.RemoveMember(group.ID, "member") {
		t.Fatal("expected member remove to succeed")
	}
	afterRemove, ok := svc.GetGroup(group.ID)
	if !ok {
		t.Fatal("expected group after remove")
	}
	if afterRemove.MembershipEpoch != 3 {
		t.Fatalf("expected epoch 3 after remove, got %d", afterRemove.MembershipEpoch)
	}
}

func TestAuthorityEventLogSequencesLocalMutationsWithDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:authority_event_log?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&groupModel{}, &memberModel{}, &messageModel{}, &MessageAttachmentModel{}, &offlineModel{}, &outboxModel{}, &groupEventModel{}); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}
	svc := &service{db: db}

	group := svc.CreateGroup("owner", "Engineering", "")
	if _, ok := svc.AddMember(group.ID, "member", "owner"); !ok {
		t.Fatal("expected member add to succeed")
	}
	msg := svc.SendMessage(group.ID, "owner", 1, "", "", "", nil, []byte("secret-ciphertext"))
	if msg.ID == "" {
		t.Fatal("expected message append to succeed")
	}
	if !svc.RemoveMember(group.ID, "member") {
		t.Fatal("expected member remove to succeed")
	}

	var events []groupEventModel
	if err := db.Where("group_ulid = ?", group.ID).Order("seq ASC").Find(&events).Error; err != nil {
		t.Fatalf("read authority events: %v", err)
	}
	if len(events) != 4 {
		t.Fatalf("expected 4 authority events, got %d: %+v", len(events), events)
	}
	wantTypes := []string{
		"group.created",
		"group.member.joined",
		"group.message.appended",
		"group.member.removed",
	}
	prevHash := ""
	for i, event := range events {
		wantSeq := int64(i + 1)
		if event.Seq != wantSeq {
			t.Fatalf("event %d seq = %d, want %d", i, event.Seq, wantSeq)
		}
		if event.EventType != wantTypes[i] {
			t.Fatalf("event %d type = %s, want %s", i, event.EventType, wantTypes[i])
		}
		if event.PrevHash != prevHash {
			t.Fatalf("event %d prev_hash = %s, want %s", i, event.PrevHash, prevHash)
		}
		wantHash := hashGroupAuthorityEvent(event.PrevHash, event.GroupULID, event.Seq, event.EventType, event.ActorDID, event.MessageULID, event.MembershipEpoch, event.Payload)
		if event.EventHash != wantHash {
			t.Fatalf("event %d hash = %s, want %s", i, event.EventHash, wantHash)
		}
		if event.AuthorityStationPeerID != foundationLocalAuthorityStation || event.AuthorityEpoch != foundationAuthorityEpoch {
			t.Fatalf("event %d authority = %s/%d", i, event.AuthorityStationPeerID, event.AuthorityEpoch)
		}
		prevHash = event.EventHash
	}
	messageEvent := events[2]
	if messageEvent.MessageULID != msg.ID {
		t.Fatalf("message event ulid = %s, want %s", messageEvent.MessageULID, msg.ID)
	}
	if strings.Contains(messageEvent.Payload, "secret-ciphertext") {
		t.Fatalf("message event payload leaked encrypted body bytes: %s", messageEvent.Payload)
	}
}

func TestListAuthorityEventsAfterWithDBReturnsOrderedWindow(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:authority_event_sync?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&groupModel{}, &memberModel{}, &messageModel{}, &MessageAttachmentModel{}, &offlineModel{}, &outboxModel{}, &groupEventModel{}); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}
	svc := &service{db: db}

	group := svc.CreateGroup("owner", "Engineering", "")
	if _, ok := svc.AddMember(group.ID, "member", "owner"); !ok {
		t.Fatal("expected member add to succeed")
	}
	msg := svc.SendMessage(group.ID, "owner", 1, "", "", "", nil, []byte("ciphertext"))
	if msg.ID == "" {
		t.Fatal("expected message append to succeed")
	}

	events, err := svc.ListAuthorityEventsAfter(group.ID, 1, 2)
	if err != nil {
		t.Fatalf("list authority events: %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("expected two events, got %d: %+v", len(events), events)
	}
	if events[0].Seq != 2 || events[1].Seq != 3 {
		t.Fatalf("expected ordered seq 2,3 after cursor 1, got %d,%d", events[0].Seq, events[1].Seq)
	}
	if events[1].EventType != "group.message.appended" || events[1].MessageID != msg.ID {
		t.Fatalf("unexpected tail event: %+v", events[1])
	}
}

func TestListAuthorityEventsAfterInMemoryReturnsOrderedWindow(t *testing.T) {
	svc := newTestService()
	svc.groupEvents["group-1"] = []domain.GroupEvent{
		{EventULID: "event-1", GroupID: "group-1", Seq: 1, EventHash: "hash-1"},
		{EventULID: "event-2", GroupID: "group-1", Seq: 2, EventHash: "hash-2"},
		{EventULID: "event-3", GroupID: "group-1", Seq: 3, EventHash: "hash-3"},
	}

	events, err := svc.ListAuthorityEventsAfter("group-1", 1, 1)
	if err != nil {
		t.Fatalf("list authority events: %v", err)
	}
	if len(events) != 1 || events[0].Seq != 2 || events[0].EventHash != "hash-2" {
		t.Fatalf("expected one event at seq 2, got %+v", events)
	}
}

func TestAuthorityEventLogIdempotencyWithDB(t *testing.T) {
	db, openErr := gorm.Open(sqlite.Open("file:authority_event_idempotency?mode=memory&cache=shared"), &gorm.Config{})
	if openErr != nil {
		t.Fatalf("open sqlite: %v", openErr)
	}
	if migrateErr := db.AutoMigrate(&groupModel{}, &groupEventModel{}); migrateErr != nil {
		t.Fatalf("auto migrate: %v", migrateErr)
	}
	now := time.Now()
	if createErr := db.Create(&groupModel{
		ULID:            "group-1",
		Name:            "Engineering",
		OwnerDID:        "owner",
		MemberCount:     1,
		Status:          domain.GroupStatusActive,
		MembershipEpoch: 1,
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Error; createErr != nil {
		t.Fatalf("create group: %v", createErr)
	}

	const idempotencyKey = "proposal-1"
	var first *groupEventModel
	if txErr := db.Transaction(func(tx *gorm.DB) error {
		var appendErr error
		first, _, appendErr = appendAuthorityEventWithIdempotencyTx(
			tx,
			now,
			"group-1",
			"group.remote_proposal.accepted",
			"actor-a",
			"",
			1,
			foundationLocalAuthorityStation,
			foundationAuthorityEpoch,
			"proposal-1",
			`{"proposal_ulid":"proposal-1","command":"noop"}`,
			idempotencyKey,
		)
		return appendErr
	}); txErr != nil {
		t.Fatalf("first append: %v", txErr)
	}
	var second *groupEventModel
	if txErr := db.Transaction(func(tx *gorm.DB) error {
		var appendErr error
		second, _, appendErr = appendAuthorityEventWithIdempotencyTx(
			tx,
			now.Add(time.Second),
			"group-1",
			"group.remote_proposal.accepted",
			"actor-a",
			"",
			1,
			foundationLocalAuthorityStation,
			foundationAuthorityEpoch,
			"proposal-1",
			`{"proposal_ulid":"proposal-1","command":"noop"}`,
			idempotencyKey,
		)
		return appendErr
	}); txErr != nil {
		t.Fatalf("idempotent append: %v", txErr)
	}
	if first.EventULID != second.EventULID || first.EventHash != second.EventHash || second.Seq != 1 {
		t.Fatalf("expected duplicate proposal to return existing event, first=%+v second=%+v", first, second)
	}
	var count int64
	if countErr := db.Model(&groupEventModel{}).Where("group_ulid = ?", "group-1").Count(&count).Error; countErr != nil {
		t.Fatalf("count events: %v", countErr)
	}
	if count != 1 {
		t.Fatalf("expected idempotent retry not to append, got %d events", count)
	}

	conflictErr := db.Transaction(func(tx *gorm.DB) error {
		_, _, appendErr := appendAuthorityEventWithIdempotencyTx(
			tx,
			now.Add(2*time.Second),
			"group-1",
			"group.remote_proposal.accepted",
			"actor-a",
			"",
			1,
			foundationLocalAuthorityStation,
			foundationAuthorityEpoch,
			"proposal-1",
			`{"proposal_ulid":"proposal-1","command":"different"}`,
			idempotencyKey,
		)
		return appendErr
	})
	if !errors.Is(conflictErr, errAuthorityEventIdempotencyConflict) {
		t.Fatalf("expected idempotency conflict, got %v", conflictErr)
	}
}

func TestAcceptProposalWithDBIsIdempotent(t *testing.T) {
	db, openErr := gorm.Open(sqlite.Open("file:accept_proposal_idempotent?mode=memory&cache=shared"), &gorm.Config{})
	if openErr != nil {
		t.Fatalf("open sqlite: %v", openErr)
	}
	if migrateErr := db.AutoMigrate(&groupModel{}, &memberModel{}, &groupEventModel{}, &federationOutboxModel{}); migrateErr != nil {
		t.Fatalf("auto migrate: %v", migrateErr)
	}
	now := time.Now()
	if createErr := db.Create(&groupModel{
		ULID:            "group-1",
		Name:            "Engineering",
		OwnerDID:        "owner",
		MemberCount:     1,
		Status:          domain.GroupStatusActive,
		MembershipEpoch: 1,
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Error; createErr != nil {
		t.Fatalf("create group: %v", createErr)
	}
	if createErr := db.Create([]memberModel{
		{
			GroupULID:              "group-1",
			ActorDID:               "owner",
			ActorHomeStationPeerID: foundationLocalAuthorityStation,
			Role:                   domain.GroupRoleOwner,
			JoinedAt:               now,
			CreatedAt:              now,
			UpdatedAt:              now,
		},
		{
			GroupULID:              "group-1",
			ActorDID:               "remote-actor",
			ActorHomeStationPeerID: "station-b",
			Role:                   domain.GroupRoleMember,
			JoinedAt:               now,
			CreatedAt:              now,
			UpdatedAt:              now,
		},
		{
			GroupULID:              "group-1",
			ActorDID:               "carol",
			ActorHomeStationPeerID: "station-c",
			Role:                   domain.GroupRoleMember,
			JoinedAt:               now,
			CreatedAt:              now,
			UpdatedAt:              now,
		},
		{
			GroupULID: "group-1",
			ActorDID:  "local-shadow",
			Role:      domain.GroupRoleMember,
			JoinedAt:  now,
			CreatedAt: now,
			UpdatedAt: now,
		},
	}).Error; createErr != nil {
		t.Fatalf("create members: %v", createErr)
	}
	svc := &service{db: db}
	proposal := domain.GroupProposal{
		ProposalULID:            "proposal-1",
		GroupID:                 "group-1",
		Actor:                   domain.FederatedActorRef{ActorDID: "remote-actor", HomeStationPeerID: "station-b"},
		Command:                 1,
		CommandPayload:          []byte("opaque-command"),
		ObservedMembershipEpoch: 1,
		IdempotencyKey:          "proposal-1",
		SigningKeyID:            "remote-actor#1",
		Signature:               []byte("signature"),
		CreatedAt:               now,
	}

	first, replay, err := svc.AcceptProposal(proposal)
	if err != nil {
		t.Fatalf("accept proposal: %v", err)
	}
	if replay {
		t.Fatal("expected first proposal not to be replay")
	}
	second, replay, err := svc.AcceptProposal(proposal)
	if err != nil {
		t.Fatalf("replay proposal: %v", err)
	}
	if !replay {
		t.Fatal("expected duplicate proposal to be replay")
	}
	if first.EventULID != second.EventULID || first.EventHash != second.EventHash || second.ProposalULID != "proposal-1" {
		t.Fatalf("expected same committed event on replay, first=%+v second=%+v", first, second)
	}
	var count int64
	if countErr := db.Model(&groupEventModel{}).Where("group_ulid = ?", "group-1").Count(&count).Error; countErr != nil {
		t.Fatalf("count events: %v", countErr)
	}
	if count != 1 {
		t.Fatalf("expected one committed proposal event, got %d", count)
	}
	var outboxRows []federationOutboxModel
	if readErr := db.Where("event_ulid = ? AND status = ?", first.EventULID, federationOutboxStatusPending).Order("target_station_peer_id ASC").Find(&outboxRows).Error; readErr != nil {
		t.Fatalf("read federation outbox: %v", readErr)
	}
	gotTargets := make([]string, 0, len(outboxRows))
	for _, row := range outboxRows {
		gotTargets = append(gotTargets, row.TargetStationPeerID)
	}
	wantTargets := []string{"station-b", "station-c"}
	if !slices.Equal(gotTargets, wantTargets) {
		t.Fatalf("expected federation fan-out targets %v, got %v rows=%+v", wantTargets, gotTargets, outboxRows)
	}
	var remoteMember memberModel
	if readErr := db.Where("group_ulid = ? AND actor_did = ?", "group-1", "remote-actor").First(&remoteMember).Error; readErr != nil {
		t.Fatalf("read remote member: %v", readErr)
	}
	if remoteMember.ActorHomeStationPeerID != "station-b" {
		t.Fatalf("expected proposal actor ref to be synced into member row, got %+v", remoteMember)
	}
	if strings.Contains(string(first.EventPayload), "opaque-command") {
		t.Fatalf("event payload leaked command bytes: %s", string(first.EventPayload))
	}
}

func TestAcceptProposalWithDBIngestsLifecycleActorRefs(t *testing.T) {
	db, openErr := gorm.Open(sqlite.Open("file:accept_proposal_lifecycle_actor_refs?mode=memory&cache=shared"), &gorm.Config{})
	if openErr != nil {
		t.Fatalf("open sqlite: %v", openErr)
	}
	if migrateErr := db.AutoMigrate(&groupModel{}, &memberModel{}, &groupEventModel{}, &federationOutboxModel{}); migrateErr != nil {
		t.Fatalf("auto migrate: %v", migrateErr)
	}
	now := time.Now()
	if createErr := db.Create(&groupModel{
		ULID:            "group-1",
		Name:            "Engineering",
		OwnerDID:        "owner",
		MemberCount:     3,
		Status:          domain.GroupStatusActive,
		MembershipEpoch: 2,
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Error; createErr != nil {
		t.Fatalf("create group: %v", createErr)
	}
	if createErr := db.Create([]memberModel{
		{
			GroupULID:              "group-1",
			ActorDID:               "owner",
			ActorHomeStationPeerID: foundationLocalAuthorityStation,
			Role:                   domain.GroupRoleOwner,
			JoinedAt:               now,
			CreatedAt:              now,
			UpdatedAt:              now,
		},
		{
			GroupULID:              "group-1",
			ActorDID:               "remote-actor",
			ActorHomeStationPeerID: "station-b",
			Role:                   domain.GroupRoleMember,
			JoinedAt:               now,
			CreatedAt:              now,
			UpdatedAt:              now,
		},
		{
			GroupULID:              "group-1",
			ActorDID:               "carol",
			ActorHomeStationPeerID: "station-c",
			Role:                   domain.GroupRoleMember,
			JoinedAt:               now,
			CreatedAt:              now,
			UpdatedAt:              now,
		},
	}).Error; createErr != nil {
		t.Fatalf("create members: %v", createErr)
	}
	payload, marshalErr := proto.Marshal(&chat.GroupMemberJoinCommandPayload{
		Member: &chat.FederatedActorRef{
			ActorDid:          "dave",
			HomeStationPeerId: "station-d",
			FederatedHandle:   "dave@station-d",
			ProfileVersion:    7,
			FederationId:      "foundation",
		},
		Role:              chat.GroupRole_GROUP_ROLE_MEMBER,
		Nickname:          "Dave",
		InvitedByActorDid: "remote-actor",
	})
	if marshalErr != nil {
		t.Fatalf("marshal join payload: %v", marshalErr)
	}
	svc := &service{db: db}
	event, replay, err := svc.AcceptProposal(domain.GroupProposal{
		ProposalULID:            "proposal-join-dave",
		GroupID:                 "group-1",
		Actor:                   domain.FederatedActorRef{ActorDID: "remote-actor", HomeStationPeerID: "station-b"},
		Command:                 int32(chat.GroupProposalCommand_GROUP_PROPOSAL_COMMAND_MEMBER_JOIN),
		CommandPayload:          payload,
		ObservedMembershipEpoch: 2,
		IdempotencyKey:          "proposal-join-dave",
		SigningKeyID:            "remote-actor#1",
		Signature:               []byte("signature"),
		CreatedAt:               now,
	})
	if err != nil {
		t.Fatalf("accept proposal: %v", err)
	}
	if replay {
		t.Fatal("expected first proposal not to be replay")
	}
	var dave memberModel
	if readErr := db.Where("group_ulid = ? AND actor_did = ?", "group-1", "dave").First(&dave).Error; readErr != nil {
		t.Fatalf("read joined member actor ref: %v", readErr)
	}
	if dave.ActorHomeStationPeerID != "station-d" || dave.ActorFederatedHandle != "dave@station-d" || dave.ActorProfileVersion != 7 || dave.Nickname != "Dave" || dave.InvitedBy != "remote-actor" {
		t.Fatalf("joined member ActorRef was not ingested: %+v", dave)
	}
	var outboxRows []federationOutboxModel
	if readErr := db.Where("event_ulid = ? AND status = ?", event.EventULID, federationOutboxStatusPending).Order("target_station_peer_id ASC").Find(&outboxRows).Error; readErr != nil {
		t.Fatalf("read federation outbox: %v", readErr)
	}
	gotTargets := make([]string, 0, len(outboxRows))
	for _, row := range outboxRows {
		gotTargets = append(gotTargets, row.TargetStationPeerID)
	}
	wantTargets := []string{"station-b", "station-c", "station-d"}
	if !slices.Equal(gotTargets, wantTargets) {
		t.Fatalf("expected lifecycle fan-out targets %v, got %v rows=%+v", wantTargets, gotTargets, outboxRows)
	}
	if strings.Contains(string(event.EventPayload), "station-d") || strings.Contains(string(event.EventPayload), "dave@station-d") {
		t.Fatalf("event payload leaked command ActorRef bytes: %s", string(event.EventPayload))
	}
}

func TestEnqueueProposalOutboxWithDBIsIdempotent(t *testing.T) {
	db, openErr := gorm.Open(sqlite.Open("file:proposal_outbox_idempotent?mode=memory&cache=shared"), &gorm.Config{})
	if openErr != nil {
		t.Fatalf("open sqlite: %v", openErr)
	}
	if migrateErr := db.AutoMigrate(&groupProposalOutboxModel{}); migrateErr != nil {
		t.Fatalf("auto migrate: %v", migrateErr)
	}
	now := time.Now()
	svc := &service{db: db}
	proposal := domain.GroupProposal{
		ProposalULID:            "proposal-1",
		GroupID:                 "group-1",
		Actor:                   domain.FederatedActorRef{ActorDID: "remote-actor", HomeStationPeerID: "station-b"},
		Command:                 1,
		CommandPayload:          []byte("opaque-command"),
		ObservedMembershipEpoch: 2,
		AuthorityStationPeerID:  "station-a",
		AuthorityEpoch:          1,
		IdempotencyKey:          "proposal-1",
		SigningKeyID:            "remote-actor#1",
		Signature:               []byte("signature"),
		CreatedAt:               now,
	}

	first, replay, err := svc.EnqueueProposalOutbox(proposal)
	if err != nil {
		t.Fatalf("enqueue proposal outbox: %v", err)
	}
	if replay {
		t.Fatal("expected first enqueue not to be replay")
	}
	if first.Status != proposalOutboxStatusPending || first.AuthorityStationPeerID != "station-a" || first.ObservedMembershipEpoch != 2 {
		t.Fatalf("unexpected first outbox item: %+v", first)
	}
	second, replay, err := svc.EnqueueProposalOutbox(proposal)
	if err != nil {
		t.Fatalf("replay proposal outbox: %v", err)
	}
	if !replay {
		t.Fatal("expected duplicate enqueue to be replay")
	}
	if second.ProposalULID != first.ProposalULID || second.IdempotencyKey != first.IdempotencyKey {
		t.Fatalf("expected duplicate enqueue to return same outbox identity, first=%+v second=%+v", first, second)
	}
	var rows []groupProposalOutboxModel
	if readErr := db.Find(&rows).Error; readErr != nil {
		t.Fatalf("read proposal outbox: %v", readErr)
	}
	if len(rows) != 1 {
		t.Fatalf("expected one proposal outbox row, got %d", len(rows))
	}
	row := rows[0]
	if row.Status != proposalOutboxStatusPending || row.ProposalULID != "proposal-1" || row.IdempotencyKey != "proposal-1" {
		t.Fatalf("unexpected persisted proposal outbox row: %+v", row)
	}
	if strings.Contains(row.Payload, "opaque-command") {
		t.Fatalf("proposal outbox payload leaked raw command bytes: %s", row.Payload)
	}
	pending, pendingErr := svc.ListPendingProposalOutbox(10, now)
	if pendingErr != nil {
		t.Fatalf("list pending proposal outbox: %v", pendingErr)
	}
	if len(pending) != 1 || pending[0].Proposal.ProposalULID != "proposal-1" || string(pending[0].Proposal.CommandPayload) != "opaque-command" {
		t.Fatalf("expected pending proposal with intact signed envelope, got %+v", pending)
	}
	nextAttemptAt := now.Add(time.Minute)
	if !svc.MarkProposalOutboxRetry("proposal-1", "authority unavailable", nextAttemptAt) {
		t.Fatal("expected mark retry to update proposal outbox")
	}
	pending, pendingErr = svc.ListPendingProposalOutbox(10, now)
	if pendingErr != nil {
		t.Fatalf("list pending proposal outbox after retry: %v", pendingErr)
	}
	if len(pending) != 0 {
		t.Fatalf("expected retry_wait row to be hidden until next_attempt_at, got %+v", pending)
	}
	pending, pendingErr = svc.ListPendingProposalOutbox(10, nextAttemptAt.Add(time.Second))
	if pendingErr != nil {
		t.Fatalf("list due retry proposal outbox: %v", pendingErr)
	}
	if len(pending) != 1 || pending[0].AttemptCount != 1 || pending[0].LastError != "authority unavailable" {
		t.Fatalf("expected due retry proposal outbox item, got %+v", pending)
	}
	if !svc.MarkProposalOutboxAccepted("proposal-1") {
		t.Fatal("expected mark accepted to update proposal outbox")
	}
	pending, pendingErr = svc.ListPendingProposalOutbox(10, nextAttemptAt.Add(2*time.Second))
	if pendingErr != nil {
		t.Fatalf("list pending proposal outbox after accepted: %v", pendingErr)
	}
	if len(pending) != 0 {
		t.Fatalf("expected accepted proposal to leave pending queue, got %+v", pending)
	}

	conflict := proposal
	conflict.Command = 2
	if _, _, conflictErr := svc.EnqueueProposalOutbox(conflict); !errors.Is(conflictErr, errProposalOutboxIdempotencyConflict) {
		t.Fatalf("expected proposal outbox idempotency conflict, got %v", conflictErr)
	}
}

func TestEnqueueGroupSkdmOutboxWithDBIsOpaqueAndIdempotent(t *testing.T) {
	db, openErr := gorm.Open(sqlite.Open("file:skdm_outbox_idempotent?mode=memory&cache=shared"), &gorm.Config{})
	if openErr != nil {
		t.Fatalf("open sqlite: %v", openErr)
	}
	if migrateErr := db.AutoMigrate(&groupSkdmOutboxModel{}); migrateErr != nil {
		t.Fatalf("auto migrate: %v", migrateErr)
	}
	now := time.Now()
	svc := &service{db: db}
	envelope := domain.GroupSkdmEnvelope{
		GroupID:                    "group-1",
		MembershipEpoch:            3,
		SenderDID:                  "alice",
		SenderKeyID:                11,
		RecipientDID:               "bob",
		RecipientDeviceID:          "bob-device-1",
		RecipientHomeStationPeerID: "station-b",
		EncryptedPayload:           []byte("sealed-skdm-payload"),
		IdempotencyKey:             "skdm-1",
		CreatedAt:                  now,
	}

	first, replay, err := svc.EnqueueGroupSkdmOutbox(envelope)
	if err != nil {
		t.Fatalf("enqueue SKDM outbox: %v", err)
	}
	if replay {
		t.Fatal("expected first SKDM enqueue not to be replay")
	}
	if first.Status != skdmOutboxStatusPending || first.MembershipEpoch != 3 || first.RecipientDeviceID != "bob-device-1" {
		t.Fatalf("unexpected first SKDM outbox item: %+v", first)
	}
	second, replay, err := svc.EnqueueGroupSkdmOutbox(envelope)
	if err != nil {
		t.Fatalf("replay SKDM outbox: %v", err)
	}
	if !replay {
		t.Fatal("expected duplicate SKDM enqueue to be replay")
	}
	if second.OutboxULID != first.OutboxULID || second.IdempotencyKey != first.IdempotencyKey {
		t.Fatalf("expected duplicate SKDM enqueue to return same outbox identity, first=%+v second=%+v", first, second)
	}
	var rows []groupSkdmOutboxModel
	if readErr := db.Find(&rows).Error; readErr != nil {
		t.Fatalf("read SKDM outbox: %v", readErr)
	}
	if len(rows) != 1 {
		t.Fatalf("expected one SKDM outbox row, got %d", len(rows))
	}
	row := rows[0]
	if row.EncryptedPayload == nil || string(row.EncryptedPayload) != "sealed-skdm-payload" {
		t.Fatalf("expected only sealed SKDM payload to persist, got %+v", row)
	}
	if strings.Contains(string(row.EncryptedPayload), "raw-chain-key") {
		t.Fatalf("SKDM outbox row leaked raw chain key material: %+v", row)
	}
	pending, pendingErr := svc.ListPendingGroupSkdmOutbox(10, now)
	if pendingErr != nil {
		t.Fatalf("list pending SKDM outbox: %v", pendingErr)
	}
	if len(pending) != 1 || pending[0].OutboxULID != first.OutboxULID || string(pending[0].EncryptedPayload) != "sealed-skdm-payload" {
		t.Fatalf("expected pending SKDM outbox with sealed payload, got %+v", pending)
	}
	nextAttemptAt := now.Add(time.Minute)
	if !svc.MarkGroupSkdmOutboxRetry(first.OutboxULID, "recipient station unavailable", nextAttemptAt) {
		t.Fatal("expected mark retry to update SKDM outbox")
	}
	pending, pendingErr = svc.ListPendingGroupSkdmOutbox(10, now)
	if pendingErr != nil {
		t.Fatalf("list pending SKDM outbox after retry: %v", pendingErr)
	}
	if len(pending) != 0 {
		t.Fatalf("expected retry_wait SKDM row to be hidden until next_attempt_at, got %+v", pending)
	}
	pending, pendingErr = svc.ListPendingGroupSkdmOutbox(10, nextAttemptAt.Add(time.Second))
	if pendingErr != nil {
		t.Fatalf("list due retry SKDM outbox: %v", pendingErr)
	}
	if len(pending) != 1 || pending[0].AttemptCount != 1 || pending[0].LastError != "recipient station unavailable" {
		t.Fatalf("expected due retry SKDM outbox item, got %+v", pending)
	}
	if !svc.MarkGroupSkdmOutboxDelivered(first.OutboxULID) {
		t.Fatal("expected mark delivered to update SKDM outbox")
	}
	pending, pendingErr = svc.ListPendingGroupSkdmOutbox(10, nextAttemptAt.Add(2*time.Second))
	if pendingErr != nil {
		t.Fatalf("list pending SKDM outbox after delivered: %v", pendingErr)
	}
	if len(pending) != 0 {
		t.Fatalf("expected delivered SKDM to leave pending queue, got %+v", pending)
	}

	conflict := envelope
	conflict.RecipientDeviceID = "bob-device-2"
	if _, _, conflictErr := svc.EnqueueGroupSkdmOutbox(conflict); conflictErr == nil || !strings.Contains(conflictErr.Error(), "idempotency conflict") {
		t.Fatalf("expected SKDM outbox idempotency conflict, got %v", conflictErr)
	}
}

func TestFollowerProjectionReadOnlyOnForkWithDB(t *testing.T) {
	db, openErr := gorm.Open(sqlite.Open("file:follower_projection_fork?mode=memory&cache=shared"), &gorm.Config{})
	if openErr != nil {
		t.Fatalf("open sqlite: %v", openErr)
	}
	if migrateErr := db.AutoMigrate(&groupFollowerProjectionModel{}); migrateErr != nil {
		t.Fatalf("auto migrate: %v", migrateErr)
	}
	now := time.Now()
	first := groupEventModel{
		GroupULID:              "group-1",
		Seq:                    1,
		PrevHash:               "",
		EventType:              "group.created",
		ActorDID:               "owner",
		MembershipEpoch:        1,
		AuthorityStationPeerID: "station-a",
		AuthorityEpoch:         1,
		Payload:                `{"owner_did":"owner"}`,
	}
	first.EventHash = hashGroupAuthorityEvent(first.PrevHash, first.GroupULID, first.Seq, first.EventType, first.ActorDID, first.MessageULID, first.MembershipEpoch, first.Payload)
	if txErr := db.Transaction(func(tx *gorm.DB) error {
		_, err := applyFollowerEventTx(tx, now, first)
		return err
	}); txErr != nil {
		t.Fatalf("apply first follower event: %v", txErr)
	}
	var projection groupFollowerProjectionModel
	if readErr := db.Where("group_ulid = ? AND authority_station_peer_id = ?", "group-1", "station-a").First(&projection).Error; readErr != nil {
		t.Fatalf("read projection: %v", readErr)
	}
	if projection.Status != followerProjectionStatusActive || projection.LastSeq != 1 || projection.LastEventHash != first.EventHash {
		t.Fatalf("expected active projection at seq 1, got %+v", projection)
	}

	fork := groupEventModel{
		GroupULID:              "group-1",
		Seq:                    3,
		PrevHash:               "forked-prev-hash",
		EventType:              "group.member.joined",
		ActorDID:               "member",
		MembershipEpoch:        2,
		AuthorityStationPeerID: "station-a",
		AuthorityEpoch:         1,
		Payload:                `{"actor_did":"member"}`,
	}
	fork.EventHash = hashGroupAuthorityEvent(fork.PrevHash, fork.GroupULID, fork.Seq, fork.EventType, fork.ActorDID, fork.MessageULID, fork.MembershipEpoch, fork.Payload)
	_, forkErr := applyFollowerEventTx(db, now.Add(time.Second), fork)
	if !errors.Is(forkErr, errFollowerProjectionForkProtection) {
		t.Fatalf("expected fork protection, got %v", forkErr)
	}
	if readErr := db.Where("group_ulid = ? AND authority_station_peer_id = ?", "group-1", "station-a").First(&projection).Error; readErr != nil {
		t.Fatalf("read projection after fork: %v", readErr)
	}
	if projection.Status != followerProjectionStatusReadOnly || projection.LastSeq != 1 || projection.LastEventHash != first.EventHash || projection.ProtectionReason == "" {
		t.Fatalf("expected read-only protected projection preserving last accepted event, got %+v", projection)
	}
}

func TestApplyFederationEventWithDBAdvancesFollowerCursor(t *testing.T) {
	db, openErr := gorm.Open(sqlite.Open("file:apply_federation_event_cursor?mode=memory&cache=shared"), &gorm.Config{})
	if openErr != nil {
		t.Fatalf("open sqlite: %v", openErr)
	}
	if migrateErr := db.AutoMigrate(&groupFollowerProjectionModel{}); migrateErr != nil {
		t.Fatalf("auto migrate: %v", migrateErr)
	}
	svc := &service{db: db}
	projection, err := svc.ApplyFederationEvent(domain.GroupEvent{
		EventULID:              "event-1",
		GroupID:                "group-1",
		Seq:                    1,
		EventHash:              "hash-1",
		EventType:              "group.proposal.accepted",
		MembershipEpoch:        1,
		AuthorityStationPeerID: "station-a",
		AuthorityEpoch:         1,
		CreatedAt:              time.Now(),
	})
	if err != nil {
		t.Fatalf("apply federation event: %v", err)
	}
	if projection.Status != followerProjectionStatusActive || projection.LastSeq != 1 || projection.LastEventHash != "hash-1" {
		t.Fatalf("unexpected projection response: %+v", projection)
	}
	var row groupFollowerProjectionModel
	if readErr := db.Where("group_ulid = ? AND authority_station_peer_id = ?", "group-1", "station-a").First(&row).Error; readErr != nil {
		t.Fatalf("read follower projection: %v", readErr)
	}
	if row.LastSeq != projection.LastSeq || row.LastEventHash != projection.LastEventHash || row.Status != projection.Status {
		t.Fatalf("persisted projection differs from response row=%+v response=%+v", row, projection)
	}
}

func TestApplyFederationEventWithDBIsIdempotentReplay(t *testing.T) {
	db, openErr := gorm.Open(sqlite.Open("file:apply_federation_event_replay?mode=memory&cache=shared"), &gorm.Config{})
	if openErr != nil {
		t.Fatalf("open sqlite: %v", openErr)
	}
	if migrateErr := db.AutoMigrate(&groupFollowerProjectionModel{}); migrateErr != nil {
		t.Fatalf("auto migrate: %v", migrateErr)
	}
	svc := &service{db: db}
	event := domain.GroupEvent{
		EventULID:              "event-1",
		GroupID:                "group-1",
		Seq:                    1,
		EventHash:              "hash-1",
		EventType:              "group.proposal.accepted",
		MembershipEpoch:        1,
		AuthorityStationPeerID: "station-a",
		AuthorityEpoch:         1,
		CreatedAt:              time.Now(),
	}
	first, err := svc.ApplyFederationEvent(event)
	if err != nil {
		t.Fatalf("apply first federation event: %v", err)
	}
	replay, err := svc.ApplyFederationEvent(event)
	if err != nil {
		t.Fatalf("expected idempotent replay, got %v", err)
	}
	if replay.LastSeq != first.LastSeq || replay.LastEventHash != first.LastEventHash || replay.Status != followerProjectionStatusActive {
		t.Fatalf("unexpected replay projection first=%+v replay=%+v", first, replay)
	}
	var row groupFollowerProjectionModel
	if readErr := db.Where("group_ulid = ? AND authority_station_peer_id = ?", "group-1", "station-a").First(&row).Error; readErr != nil {
		t.Fatalf("read follower projection: %v", readErr)
	}
	if row.Status != followerProjectionStatusActive || row.ProtectionReason != "" {
		t.Fatalf("expected replay to preserve active projection without protection, got %+v", row)
	}
}

func TestMaterializeFollowerProjectionWithDBIsUpsertOnlyAndOpaque(t *testing.T) {
	db, openErr := gorm.Open(sqlite.Open("file:follower_projection_materialize?mode=memory&cache=shared"), &gorm.Config{})
	if openErr != nil {
		t.Fatalf("open sqlite: %v", openErr)
	}
	if migrateErr := db.AutoMigrate(&groupModel{}, &memberModel{}, &messageModel{}, &MessageAttachmentModel{}, &outboxModel{}, &groupEventModel{}); migrateErr != nil {
		t.Fatalf("auto migrate: %v", migrateErr)
	}
	svc := &service{db: db}
	group := domain.Group{
		ID:              "group-1",
		Name:            "Engineering",
		OwnerDID:        "owner",
		MemberCount:     2,
		Status:          domain.GroupStatusActive,
		MembershipEpoch: 1,
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}
	members := []domain.Member{
		{GroupID: group.ID, ActorDID: "owner", Role: domain.GroupRoleOwner, JoinedAt: time.Now()},
		{
			GroupID:  group.ID,
			ActorDID: "bob",
			Actor: domain.FederatedActorRef{
				ActorDID:          "bob",
				HomeStationPeerID: "station-b",
				HomeStationDomain: "station-b.example",
			},
			Role:     domain.GroupRoleMember,
			JoinedAt: time.Now(),
		},
	}
	messages := []domain.Message{
		{
			ID:               "message-1",
			GroupID:          group.ID,
			SenderDID:        "owner",
			Type:             int32(chat.GroupMessageType_GROUP_MESSAGE_TYPE_TEXT),
			Content:          "plaintext must not persist",
			EncryptedPayload: []byte("ciphertext"),
			Attachments: []domain.Attachment{
				{CID: "cid-1", Filename: "file.txt", MimeType: "text/plain", Size: 7, Visibility: "chat"},
			},
			SentAt: time.Now(),
		},
	}

	if err := svc.MaterializeFollowerProjection(group, members, messages); err != nil {
		t.Fatalf("materialize first projection: %v", err)
	}
	if err := svc.MaterializeFollowerProjection(group, members, messages); err != nil {
		t.Fatalf("materialize replay projection: %v", err)
	}
	var groupCount, memberCount, messageCount, attachmentCount, outboxCount, eventCount int64
	if err := db.Model(&groupModel{}).Count(&groupCount).Error; err != nil {
		t.Fatalf("count groups: %v", err)
	}
	if err := db.Model(&memberModel{}).Count(&memberCount).Error; err != nil {
		t.Fatalf("count members: %v", err)
	}
	if err := db.Model(&messageModel{}).Count(&messageCount).Error; err != nil {
		t.Fatalf("count messages: %v", err)
	}
	if err := db.Model(&MessageAttachmentModel{}).Count(&attachmentCount).Error; err != nil {
		t.Fatalf("count attachments: %v", err)
	}
	if err := db.Model(&outboxModel{}).Count(&outboxCount).Error; err != nil {
		t.Fatalf("count outbox: %v", err)
	}
	if err := db.Model(&groupEventModel{}).Count(&eventCount).Error; err != nil {
		t.Fatalf("count events: %v", err)
	}
	if groupCount != 1 || memberCount != 2 || messageCount != 1 || attachmentCount != 1 || outboxCount != 0 || eventCount != 0 {
		t.Fatalf("unexpected materialized counts group=%d member=%d message=%d attachment=%d outbox=%d event=%d", groupCount, memberCount, messageCount, attachmentCount, outboxCount, eventCount)
	}
	var msgRow messageModel
	if err := db.Where("ulid = ?", "message-1").First(&msgRow).Error; err != nil {
		t.Fatalf("read message row: %v", err)
	}
	if msgRow.Content != "" || string(msgRow.EncryptedPayload) != "ciphertext" {
		t.Fatalf("expected opaque encrypted message, content=%q payload=%q", msgRow.Content, string(msgRow.EncryptedPayload))
	}
	var bob memberModel
	if err := db.Where("group_ulid = ? AND actor_did = ?", group.ID, "bob").First(&bob).Error; err != nil {
		t.Fatalf("read bob member: %v", err)
	}
	if bob.ActorHomeStationPeerID != "station-b" || bob.ActorHomeStationDomain != "station-b.example" {
		t.Fatalf("expected bob routing metadata, got %+v", bob)
	}
}

func TestApplyFederationEventWithDBPersistsReadOnlyOnFork(t *testing.T) {
	db, openErr := gorm.Open(sqlite.Open("file:apply_federation_event_fork?mode=memory&cache=shared"), &gorm.Config{})
	if openErr != nil {
		t.Fatalf("open sqlite: %v", openErr)
	}
	if migrateErr := db.AutoMigrate(&groupFollowerProjectionModel{}); migrateErr != nil {
		t.Fatalf("auto migrate: %v", migrateErr)
	}
	svc := &service{db: db}
	if _, err := svc.ApplyFederationEvent(domain.GroupEvent{
		EventULID:              "event-1",
		GroupID:                "group-1",
		Seq:                    1,
		EventHash:              "hash-1",
		EventType:              "group.proposal.accepted",
		MembershipEpoch:        1,
		AuthorityStationPeerID: "station-a",
		AuthorityEpoch:         1,
		CreatedAt:              time.Now(),
	}); err != nil {
		t.Fatalf("apply first federation event: %v", err)
	}

	projection, forkErr := svc.ApplyFederationEvent(domain.GroupEvent{
		EventULID:              "event-3",
		GroupID:                "group-1",
		Seq:                    3,
		PrevHash:               "forked-prev-hash",
		EventHash:              "hash-3",
		EventType:              "group.member.joined",
		MembershipEpoch:        2,
		AuthorityStationPeerID: "station-a",
		AuthorityEpoch:         1,
		CreatedAt:              time.Now(),
	})
	if !errors.Is(forkErr, errFollowerProjectionForkProtection) {
		t.Fatalf("expected fork protection, got %v", forkErr)
	}
	if projection.Status != followerProjectionStatusReadOnly || projection.LastSeq != 1 || projection.LastEventHash != "hash-1" || projection.ProtectionReason == "" {
		t.Fatalf("expected read-only projection response preserving accepted cursor, got %+v", projection)
	}
	var row groupFollowerProjectionModel
	if readErr := db.Where("group_ulid = ? AND authority_station_peer_id = ?", "group-1", "station-a").First(&row).Error; readErr != nil {
		t.Fatalf("read follower projection: %v", readErr)
	}
	if row.Status != followerProjectionStatusReadOnly || row.LastSeq != 1 || row.LastEventHash != "hash-1" || row.ProtectionReason == "" {
		t.Fatalf("expected persisted read-only projection preserving accepted cursor, got %+v", row)
	}
}

func TestFollowerProjectionDegradedWithDBDoesNotOverrideReadOnly(t *testing.T) {
	db, openErr := gorm.Open(sqlite.Open("file:follower_projection_degraded?mode=memory&cache=shared"), &gorm.Config{})
	if openErr != nil {
		t.Fatalf("open sqlite: %v", openErr)
	}
	if migrateErr := db.AutoMigrate(&groupFollowerProjectionModel{}); migrateErr != nil {
		t.Fatalf("auto migrate: %v", migrateErr)
	}
	now := time.Now()
	rows := []groupFollowerProjectionModel{
		{
			GroupULID:              "group-active",
			AuthorityStationPeerID: "station-a",
			AuthorityEpoch:         1,
			LastSeq:                1,
			LastEventHash:          "hash-1",
			Status:                 followerProjectionStatusActive,
			CreatedAt:              now,
			UpdatedAt:              now,
		},
		{
			GroupULID:              "group-read-only",
			AuthorityStationPeerID: "station-a",
			AuthorityEpoch:         1,
			LastSeq:                1,
			LastEventHash:          "hash-1",
			Status:                 followerProjectionStatusReadOnly,
			ProtectionReason:       "fork",
			CreatedAt:              now,
			UpdatedAt:              now,
		},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatalf("seed projections: %v", err)
	}
	svc := &service{db: db}

	if !svc.MarkFollowerProjectionDegraded("group-active", "station-a", "authority unavailable") {
		t.Fatal("expected active projection to become degraded")
	}
	if svc.MarkFollowerProjectionDegraded("group-read-only", "station-a", "authority unavailable") {
		t.Fatal("expected read-only projection to reject degraded overwrite")
	}
	projections, err := svc.ListFollowerProjections(10)
	if err != nil {
		t.Fatalf("list follower projections: %v", err)
	}
	if len(projections) != 1 || projections[0].GroupID != "group-active" || projections[0].Status != followerProjectionStatusDegraded {
		t.Fatalf("expected only degraded active projection to be listed for retry, got %+v", projections)
	}
	if !svc.MarkFollowerProjectionActive("group-active", "station-a") {
		t.Fatal("expected degraded projection to restore active")
	}
	var readOnly groupFollowerProjectionModel
	if err := db.Where("group_ulid = ?", "group-read-only").First(&readOnly).Error; err != nil {
		t.Fatalf("read read-only projection: %v", err)
	}
	if readOnly.Status != followerProjectionStatusReadOnly || readOnly.ProtectionReason != "fork" {
		t.Fatalf("read-only projection was overwritten: %+v", readOnly)
	}
}

func TestDissolveGroupMarksArchiveAndRetainsHistory(t *testing.T) {
	svc := newTestService()
	group := svc.CreateGroup("owner", "Engineering", "")
	svc.SendMessage(group.ID, "owner", 1, "", "", "", nil, []byte("ciphertext"))

	if !svc.DissolveGroup(group.ID) {
		t.Fatal("expected dissolve group to succeed")
	}
	archived, ok := svc.GetGroup(group.ID)
	if !ok {
		t.Fatal("expected dissolved group to remain readable")
	}
	if archived.Status != domain.GroupStatusDissolved || archived.DissolvedAt.IsZero() {
		t.Fatalf("expected dissolved group archive status, got %+v", archived)
	}
	if _, ok := svc.GetMember(group.ID, "owner"); !ok {
		t.Fatal("expected members to remain readable")
	}
	if messages, err := svc.ListMessages(group.ID, "", 10); err != nil || len(messages) != 1 {
		t.Fatalf("expected messages to remain readable, got len=%d err=%v", len(messages), err)
	}
}

func TestDissolveGroupWithDBMarksArchiveAndRetainsHistory(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:dissolve_group_archive?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&groupModel{}, &memberModel{}, &messageModel{}, &MessageAttachmentModel{}, &invitationModel{}, &outboxModel{}, &groupEventModel{}); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}
	svc := &service{db: db}
	group := svc.CreateGroup("owner", "Engineering", "")
	svc.SendMessage(group.ID, "owner", 1, "", "", "", nil, []byte("ciphertext"))
	inv := svc.CreateInvitation(group.ID, "owner", "invitee")

	if !svc.DissolveGroup(group.ID) {
		t.Fatal("expected dissolve group to succeed")
	}
	archived, ok := svc.GetGroup(group.ID)
	if !ok {
		t.Fatal("expected dissolved group to remain readable")
	}
	if archived.Status != domain.GroupStatusDissolved || archived.DissolvedAt.IsZero() {
		t.Fatalf("expected dissolved group archive status, got %+v", archived)
	}
	if _, ok := svc.GetMember(group.ID, "owner"); !ok {
		t.Fatal("expected members to remain readable")
	}
	if messages, err := svc.ListMessages(group.ID, "", 10); err != nil || len(messages) != 1 {
		t.Fatalf("expected messages to remain readable, got len=%d err=%v", len(messages), err)
	}
	var invRow invitationModel
	if err := db.Where("ulid = ?", inv.ID).First(&invRow).Error; err != nil {
		t.Fatalf("read invitation: %v", err)
	}
	if invRow.Status != groupInvitationStatusExpired {
		t.Fatalf("expected pending invitation to expire on dissolve, got %d", invRow.Status)
	}
}

func newTestService() *service {
	return &service{
		groups:       map[string]*group{},
		messages:     map[string][]message{},
		messagesByID: map[string]message{},
		members:      map[string]map[string]*member{},
		invitations:  map[string]*invitation{},
		settings:     map[string]map[string]groupSetting{},
		offline:      map[string][]offlineMessage{},
		unread:       map[string]map[string]int64{},
		threadReads:  map[string]threadRead{},
		groupEvents:  map[string][]domain.GroupEvent{},
		followers:    map[string]domain.FollowerProjection{},
		proposals:    map[string]domain.GroupProposalOutboxItem{},
		skdmOutbox:   map[string]domain.GroupSkdmEnvelope{},
	}
}
