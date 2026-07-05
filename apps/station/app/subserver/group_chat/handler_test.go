package group_chat

import (
	"bytes"
	"context"
	"slices"
	"strconv"
	"testing"
	"time"

	application_group_chat "github.com/peers-labs/peers-touch/station/app/subserver/group_chat/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/group_chat/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func TestHandleCreateAddsInitialMembersAndProjectsOwnerRole(t *testing.T) {
	sub := newTestSubServer()

	resp, err := sub.handleCreate(subjectContext("owner"), &chat.CreateGroupRequest{
		Name:              "Engineering",
		InitialMemberDids: []string{"admin", "member", "admin", "owner", ""},
	})
	if err != nil {
		t.Fatalf("handleCreate returned error: %v", err)
	}
	groupID := resp.GetGroup().GetUlid()
	if groupID == "" {
		t.Fatal("expected create response group ulid")
	}
	if resp.GetGroup().GetOwnerDid() != "owner" {
		t.Fatalf("expected owner did owner, got %s", resp.GetGroup().GetOwnerDid())
	}
	if resp.GetGroup().GetMemberCount() != 3 {
		t.Fatalf("expected member count 3 after de-duped initial members, got %d", resp.GetGroup().GetMemberCount())
	}

	members, total := sub.service.ListMembers(groupID, 20, 0)
	if total != 3 || len(members) != 3 {
		t.Fatalf("expected 3 members, got total=%d len=%d", total, len(members))
	}
	memberByDID := make(map[string]domain.Member, len(members))
	for _, member := range members {
		memberByDID[member.ActorDID] = member
	}
	if memberByDID["owner"].Role != domain.GroupRoleOwner {
		t.Fatalf("expected owner role owner, got %+v", memberByDID["owner"])
	}
	for _, did := range []string{"admin", "member"} {
		item, ok := memberByDID[did]
		if !ok {
			t.Fatalf("expected initial member %s", did)
		}
		if item.Role != domain.GroupRoleMember {
			t.Fatalf("expected %s role member, got %+v", did, item)
		}
	}
	if slices.ContainsFunc(members, func(member domain.Member) bool { return member.ActorDID == "" }) {
		t.Fatal("did not expect blank initial member")
	}
}

func TestHandleCreatePersistsInitialFederatedMembers(t *testing.T) {
	sub := newDBBackedAcceptanceSubServer(t, "create_initial_federated_members")

	resp, err := sub.handleCreate(subjectContext("owner"), &chat.CreateGroupRequest{
		Name: "Federated Engineering",
		InitialMemberDids: []string{
			"local-member",
			"remote-member",
		},
		InitialFederatedMembers: []*chat.FederatedActorRef{
			{
				ActorDid:          "remote-member",
				HomeStationPeerId: "station-b",
				HomeStationDomain: "station-b.example",
				FederatedHandle:   "remote-member@station-b.example",
				ProfileVersion:    42,
				FederationId:      "fed-station-b",
			},
		},
	})
	if err != nil {
		t.Fatalf("handleCreate returned error: %v", err)
	}
	groupID := resp.GetGroup().GetUlid()
	if groupID == "" {
		t.Fatal("expected create response group ulid")
	}
	if resp.GetGroup().GetMemberCount() != 3 {
		t.Fatalf("expected owner + local + remote members after de-dupe, got %d", resp.GetGroup().GetMemberCount())
	}

	remote, ok := sub.service.GetMember(groupID, "remote-member")
	if !ok {
		t.Fatal("expected remote member")
	}
	if remote.Actor.HomeStationPeerID != "station-b" ||
		remote.Actor.HomeStationDomain != "station-b.example" ||
		remote.Actor.FederatedHandle != "remote-member@station-b.example" ||
		remote.Actor.ProfileVersion != 42 ||
		remote.Actor.FederationID != "fed-station-b" {
		t.Fatalf("expected remote actor routing metadata to persist, got %+v", remote.Actor)
	}

	local, ok := sub.service.GetMember(groupID, "local-member")
	if !ok {
		t.Fatal("expected local member")
	}
	if local.Actor.HomeStationPeerID != "" {
		t.Fatalf("did not expect local member to get remote station metadata: %+v", local.Actor)
	}

	var event groupEventModel
	if err := sub.service.db.Where("group_ulid = ? AND seq = ?", groupID, int64(1)).First(&event).Error; err != nil {
		t.Fatalf("expected initial federated create event: %v", err)
	}
	if event.EventType != "group.created" || event.ActorDID != "owner" || event.AuthorityStationPeerID == "" {
		t.Fatalf("unexpected initial federated create event: %+v", event)
	}
	var outbox federationOutboxModel
	if err := sub.service.db.Where("group_ulid = ? AND seq = ? AND target_station_peer_id = ?", groupID, int64(1), "station-b").First(&outbox).Error; err != nil {
		t.Fatalf("expected initial federated create event outbox: %v", err)
	}
	if outbox.Status != federationOutboxStatusPending || outbox.EventULID != event.EventULID {
		t.Fatalf("unexpected initial federated create outbox: %+v event=%+v", outbox, event)
	}
}

func TestHandleAddFederatedMemberPersistsRoutingAndEnqueuesHistory(t *testing.T) {
	sub := newDBBackedAcceptanceSubServer(t, "add_federated_member_handler")
	created, err := sub.handleCreate(subjectContext("owner"), &chat.CreateGroupRequest{Name: "Federated Engineering"})
	if err != nil {
		t.Fatalf("handleCreate returned error: %v", err)
	}
	groupID := created.GetGroup().GetUlid()
	resp, err := sub.handleAddFederatedMember(subjectContext("owner"), &addFederatedMemberRequest{
		GroupUlid: groupID,
		Member: federatedActorRefRequest{
			ActorDID:          "remote-member",
			HomeStationPeerID: "station-b",
			HomeStationDomain: "station-b.example",
			FederatedHandle:   "remote-member@station-b.example",
			ProfileVersion:    7,
			FederationID:      "fed-station-b",
		},
	})
	if err != nil {
		t.Fatalf("handleAddFederatedMember returned error: %v", err)
	}
	if resp == nil || !resp.Success || resp.Group.GetMemberCount() != 2 || resp.Member.GetActorDid() != "remote-member" {
		t.Fatalf("unexpected add federated member response: %+v", resp)
	}
	remote, ok := sub.service.GetMember(groupID, "remote-member")
	if !ok {
		t.Fatal("expected remote member")
	}
	if remote.Actor.HomeStationPeerID != "station-b" ||
		remote.Actor.HomeStationDomain != "station-b.example" ||
		remote.Actor.FederatedHandle != "remote-member@station-b.example" ||
		remote.Actor.ProfileVersion != 7 ||
		remote.Actor.FederationID != "fed-station-b" {
		t.Fatalf("expected remote actor routing metadata to persist, got %+v", remote.Actor)
	}
	var rows []federationOutboxModel
	if err := sub.service.db.Where("group_ulid = ? AND target_station_peer_id = ?", groupID, "station-b").Order("seq ASC").Find(&rows).Error; err != nil {
		t.Fatalf("read federation outbox: %v", err)
	}
	if len(rows) != 2 || rows[0].Seq != 1 || rows[1].Seq != 2 {
		t.Fatalf("expected created+joined history outbox for late federated member, got %+v", rows)
	}
}

func TestHandleAddFederatedMemberRejectsNonManager(t *testing.T) {
	sub := newDBBackedAcceptanceSubServer(t, "add_federated_member_non_manager")
	created, err := sub.handleCreate(subjectContext("owner"), &chat.CreateGroupRequest{
		Name:              "Federated Engineering",
		InitialMemberDids: []string{"member"},
	})
	if err != nil {
		t.Fatalf("handleCreate returned error: %v", err)
	}
	_, err = sub.handleAddFederatedMember(subjectContext("member"), &addFederatedMemberRequest{
		GroupUlid: created.GetGroup().GetUlid(),
		Member: federatedActorRefRequest{
			ActorDID:          "remote-member",
			HomeStationPeerID: "station-b",
		},
	})
	if err == nil {
		t.Fatal("expected non-manager federated add to be rejected")
	}
}

func TestHandleGetMessagesNextCursorDoesNotRepeatPage(t *testing.T) {
	sub := newTestSubServer()
	group := sub.service.CreateGroup("owner", "Engineering", "")
	for i := 0; i < 205; i++ {
		sub.service.SendMessage(group.ID, "owner", 1, "", "", "", nil, []byte("ciphertext-"+strconv.Itoa(i)))
	}

	first, err := sub.handleGetMessages(subjectContext("owner"), &chat.GetGroupMessagesRequest{
		GroupUlid: group.ID,
		Limit:     100,
	})
	if err != nil {
		t.Fatalf("first page returned error: %v", err)
	}
	if len(first.GetMessages()) != 100 || !first.GetHasMore() || first.GetNextCursor() == "" {
		t.Fatalf("unexpected first page len=%d hasMore=%v cursor=%q", len(first.GetMessages()), first.GetHasMore(), first.GetNextCursor())
	}
	if first.GetNextCursor() != first.GetMessages()[0].GetUlid() {
		t.Fatalf("expected next cursor to be oldest page item, cursor=%s oldest=%s newest=%s",
			first.GetNextCursor(), first.GetMessages()[0].GetUlid(), first.GetMessages()[len(first.GetMessages())-1].GetUlid())
	}

	seen := map[string]struct{}{}
	for _, msg := range first.GetMessages() {
		seen[msg.GetUlid()] = struct{}{}
	}
	second, err := sub.handleGetMessages(subjectContext("owner"), &chat.GetGroupMessagesRequest{
		GroupUlid:  group.ID,
		Limit:      100,
		BeforeUlid: first.GetNextCursor(),
	})
	if err != nil {
		t.Fatalf("second page returned error: %v", err)
	}
	if len(second.GetMessages()) != 100 {
		t.Fatalf("unexpected second page len=%d", len(second.GetMessages()))
	}
	for _, msg := range second.GetMessages() {
		if _, duplicate := seen[msg.GetUlid()]; duplicate {
			t.Fatalf("message %s repeated across pages", msg.GetUlid())
		}
		seen[msg.GetUlid()] = struct{}{}
	}
	if len(seen) != 200 {
		t.Fatalf("expected 200 unique messages across first two pages, got %d", len(seen))
	}
}

func TestHandleTransferOwnershipUpdatesGroupAndRoles(t *testing.T) {
	sub := newTestSubServer()
	group := sub.service.CreateGroup("owner", "Engineering", "")
	if _, ok := sub.service.AddMember(group.ID, "member", "owner"); !ok {
		t.Fatal("expected member add to succeed")
	}

	resp, err := sub.handleTransferOwnership(subjectContext("owner"), &chat.TransferGroupOwnershipRequest{
		GroupUlid:    group.ID,
		NextOwnerDid: "member",
	})
	if err != nil {
		t.Fatalf("handleTransferOwnership returned error: %v", err)
	}
	if resp.GetGroup().GetOwnerDid() != "member" {
		t.Fatalf("expected response owner member, got %s", resp.GetGroup().GetOwnerDid())
	}

	oldOwner, _ := sub.service.GetMember(group.ID, "owner")
	nextOwner, _ := sub.service.GetMember(group.ID, "member")
	if oldOwner.Role != domain.GroupRoleAdmin || nextOwner.Role != domain.GroupRoleOwner {
		t.Fatalf("expected old owner admin and next owner owner, got %d/%d", oldOwner.Role, nextOwner.Role)
	}
}

func TestHandleDissolveGroupArchivesState(t *testing.T) {
	sub := newTestSubServer()
	group := sub.service.CreateGroup("owner", "Engineering", "")
	if _, ok := sub.service.AddMember(group.ID, "member", "owner"); !ok {
		t.Fatal("expected member add to succeed")
	}
	sub.service.SendMessage(group.ID, "owner", 1, "", "", "", nil, []byte("ciphertext"))

	resp, err := sub.handleDissolve(subjectContext("owner"), &chat.DissolveGroupRequest{
		GroupUlid: group.ID,
	})
	if err != nil {
		t.Fatalf("handleDissolve returned error: %v", err)
	}
	if !resp.GetSuccess() {
		t.Fatal("expected dissolve response success")
	}
	archived, ok := sub.service.GetGroup(group.ID)
	if !ok {
		t.Fatal("expected group to remain readable")
	}
	if archived.Status != domain.GroupStatusDissolved || archived.DissolvedAt.IsZero() {
		t.Fatalf("expected dissolved group archive status, got %+v", archived)
	}
	if _, ok := sub.service.GetMember(group.ID, "member"); !ok {
		t.Fatal("expected members to remain readable")
	}
	if messages, err := sub.service.ListMessages(group.ID, "", 10); err != nil || len(messages) != 1 {
		t.Fatalf("expected history to remain readable, got len=%d err=%v", len(messages), err)
	}
}

func TestHandleUpdateMyNicknameUpdatesCurrentMember(t *testing.T) {
	sub := newTestSubServer()
	group := sub.service.CreateGroup("owner", "Engineering", "")
	if _, ok := sub.service.AddMember(group.ID, "member", "owner"); !ok {
		t.Fatal("expected member add to succeed")
	}

	resp, err := sub.handleUpdateMyNickname(subjectContext("member"), &chat.UpdateMyNicknameRequest{
		GroupUlid: group.ID,
		Nickname:  "Desk Member",
	})
	if err != nil {
		t.Fatalf("handleUpdateMyNickname returned error: %v", err)
	}
	if resp.GetMember().GetNickname() != "Desk Member" {
		t.Fatalf("expected response nickname Desk Member, got %s", resp.GetMember().GetNickname())
	}
	member, _ := sub.service.GetMember(group.ID, "member")
	if member.Nickname != "Desk Member" {
		t.Fatalf("expected stored nickname Desk Member, got %s", member.Nickname)
	}
}

func TestHandleAcceptProposalRejectsUnsignedProposal(t *testing.T) {
	sub := newTestSubServer()
	group := sub.service.CreateGroup("owner", "Engineering", "")

	if _, err := sub.handleAcceptProposal(subjectContext("owner"), &chat.AcceptGroupProposalRequest{
		Proposal: &chat.GroupProposal{
			ProposalUlid:            "proposal-1",
			GroupUlid:               group.ID,
			Actor:                   &chat.FederatedActorRef{ActorDid: "remote-actor"},
			Command:                 chat.GroupProposalCommand_GROUP_PROPOSAL_COMMAND_MESSAGE_APPEND,
			ObservedMembershipEpoch: group.MembershipEpoch,
		},
	}); err == nil {
		t.Fatal("expected unsigned proposal to be rejected")
	}
}

func TestHandleAcceptProposalReturnsCommittedEventAndReplay(t *testing.T) {
	sub := newTestSubServer()
	group := sub.service.CreateGroup("owner", "Engineering", "")
	addFederatedMemberForTest(t, sub, group.ID, "remote-actor", "station-b")
	req := &chat.AcceptGroupProposalRequest{
		Proposal: &chat.GroupProposal{
			ProposalUlid:            "proposal-1",
			GroupUlid:               group.ID,
			Actor:                   &chat.FederatedActorRef{ActorDid: "remote-actor", HomeStationPeerId: "station-b"},
			Command:                 chat.GroupProposalCommand_GROUP_PROPOSAL_COMMAND_MESSAGE_APPEND,
			CommandPayload:          []byte("opaque-command"),
			ObservedMembershipEpoch: group.MembershipEpoch,
			IdempotencyKey:          "proposal-1",
			SigningKeyId:            "remote-actor#1",
			Signature:               []byte("signature"),
		},
	}

	resp, err := sub.handleAcceptProposal(subjectContext("owner"), req)
	if err != nil {
		t.Fatalf("handleAcceptProposal returned error: %v", err)
	}
	if resp.GetIdempotentReplay() {
		t.Fatal("expected first acceptance not to be replay")
	}
	if resp.GetEvent().GetProposalUlid() != "proposal-1" || resp.GetEvent().GetActor().GetActorDid() != "remote-actor" {
		t.Fatalf("unexpected event response: %+v", resp.GetEvent())
	}
	replay, err := sub.handleAcceptProposal(subjectContext("owner"), req)
	if err != nil {
		t.Fatalf("handleAcceptProposal replay returned error: %v", err)
	}
	if !replay.GetIdempotentReplay() || replay.GetEvent().GetEventUlid() != resp.GetEvent().GetEventUlid() {
		t.Fatalf("expected idempotent replay of same event, first=%+v replay=%+v", resp.GetEvent(), replay.GetEvent())
	}
}

func TestAcceptProposalRouteRequiresFederationTokenAndPinsPeer(t *testing.T) {
	registerGroupChatFederationScope()
	const (
		localStation  = "station-a"
		remoteStation = "station-b"
		remoteActor   = "remote-actor"
	)
	sub := newTestSubServer()
	peerKeys := authfed.NewInMemoryPeerKeyStore()
	sub.federationProposalWrapper = serverwrapper.RequireFederationToken(
		groupChatProposalScopeName,
		peerKeys,
		httpadapter.StaticAudience(localStation),
	)
	group := sub.service.CreateGroup("owner", "Engineering", "")
	addFederatedMemberForTest(t, sub, group.ID, remoteActor, remoteStation)
	req := &chat.AcceptGroupProposalRequest{
		Proposal: &chat.GroupProposal{
			ProposalUlid:            "proposal-1",
			GroupUlid:               group.ID,
			Actor:                   &chat.FederatedActorRef{ActorDid: remoteActor, HomeStationPeerId: remoteStation},
			Command:                 chat.GroupProposalCommand_GROUP_PROPOSAL_COMMAND_MESSAGE_APPEND,
			CommandPayload:          []byte("opaque-command"),
			ObservedMembershipEpoch: group.MembershipEpoch,
			IdempotencyKey:          "proposal-1",
			SigningKeyId:            "remote-actor#1",
			Signature:               []byte("signature"),
		},
	}
	token := mintGroupChatProposalToken(t, remoteStation, localStation, remoteActor, group.ID, "proposal-1")

	response := invokeGroupChatHandler(t, sub, "gc-proposal-accept", req, token)
	if response.status != 200 {
		t.Fatalf("expected 200, got %d body=%s", response.status, response.body.String())
	}
	var decoded chat.AcceptGroupProposalResponse
	if err := protojson.Unmarshal(response.body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode response: %v body=%s", err, response.body.String())
	}
	if decoded.GetEvent().GetProposalUlid() != "proposal-1" || decoded.GetEvent().GetActor().GetActorDid() != remoteActor {
		t.Fatalf("unexpected committed event: %+v", decoded.GetEvent())
	}
	peer, err := peerKeys.Get(context.Background(), remoteStation)
	if err != nil {
		t.Fatalf("read peer key: %v", err)
	}
	if peer == nil || peer.StationID != remoteStation {
		t.Fatalf("expected TOFU peer key for %s, got %+v", remoteStation, peer)
	}

	response = invokeGroupChatHandler(t, sub, "gc-proposal-accept", req, token)
	if response.status != 200 {
		t.Fatalf("expected replay 200, got %d body=%s", response.status, response.body.String())
	}
	var replay chat.AcceptGroupProposalResponse
	if err := protojson.Unmarshal(response.body.Bytes(), &replay); err != nil {
		t.Fatalf("decode replay response: %v body=%s", err, response.body.String())
	}
	if !replay.GetIdempotentReplay() || replay.GetEvent().GetEventUlid() != decoded.GetEvent().GetEventUlid() {
		t.Fatalf("expected idempotent replay of same event, first=%+v replay=%+v", decoded.GetEvent(), replay.GetEvent())
	}
}

func TestAcceptProposalRouteRejectsFederationClaimMismatch(t *testing.T) {
	registerGroupChatFederationScope()
	const (
		localStation  = "station-a"
		remoteStation = "station-b"
		remoteActor   = "remote-actor"
	)
	sub := newTestSubServer()
	sub.federationProposalWrapper = serverwrapper.RequireFederationToken(
		groupChatProposalScopeName,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience(localStation),
	)
	group := sub.service.CreateGroup("owner", "Engineering", "")
	req := &chat.AcceptGroupProposalRequest{
		Proposal: &chat.GroupProposal{
			ProposalUlid:            "proposal-1",
			GroupUlid:               group.ID,
			Actor:                   &chat.FederatedActorRef{ActorDid: remoteActor, HomeStationPeerId: remoteStation},
			Command:                 chat.GroupProposalCommand_GROUP_PROPOSAL_COMMAND_MESSAGE_APPEND,
			ObservedMembershipEpoch: group.MembershipEpoch,
			IdempotencyKey:          "proposal-1",
			SigningKeyId:            "remote-actor#1",
			Signature:               []byte("signature"),
		},
	}
	token := mintGroupChatProposalToken(t, remoteStation, localStation, remoteActor, group.ID, "other-proposal")

	response := invokeGroupChatHandler(t, sub, "gc-proposal-accept", req, token)
	if response.status != 403 {
		t.Fatalf("expected claim mismatch 403, got %d body=%s", response.status, response.body.String())
	}
}

func TestDispatchProposalOutboxSubmitsToAuthorityHandler(t *testing.T) {
	registerGroupChatFederationScope()
	const (
		authorityStation = "station-a"
		actorStation     = "station-b"
		remoteActor      = "remote-actor"
	)
	authority := newTestSubServer()
	authorityPeerKeys := authfed.NewInMemoryPeerKeyStore()
	authority.federationProposalWrapper = serverwrapper.RequireFederationToken(
		groupChatProposalScopeName,
		authorityPeerKeys,
		httpadapter.StaticAudience(authorityStation),
	)
	group := authority.service.CreateGroup("owner", "Engineering", "")
	addFederatedMemberForTest(t, authority, group.ID, remoteActor, actorStation)

	actor := newTestSubServer()
	actor.proposalKeyCache = authfed.NewKeyCache(authfed.NewInMemoryKeyStore(), authfed.WithRecheckTTL(0))
	actor.proposalTransport = localGroupProposalTransport{t: t, authority: authority}
	proposal := domain.GroupProposal{
		ProposalULID:            "proposal-1",
		GroupID:                 group.ID,
		Actor:                   domain.FederatedActorRef{ActorDID: remoteActor, HomeStationPeerID: actorStation},
		Command:                 int32(chat.GroupProposalCommand_GROUP_PROPOSAL_COMMAND_MESSAGE_APPEND),
		CommandPayload:          []byte("opaque-command"),
		ObservedMembershipEpoch: group.MembershipEpoch,
		AuthorityStationPeerID:  authorityStation,
		AuthorityEpoch:          1,
		IdempotencyKey:          "proposal-1",
		SigningKeyID:            "remote-actor#1",
		Signature:               []byte("signature"),
		CreatedAt:               time.Now(),
	}
	if _, replay, err := actor.service.EnqueueProposalOutbox(proposal); err != nil || replay {
		t.Fatalf("enqueue proposal outbox replay=%v err=%v", replay, err)
	}

	if dispatched := actor.dispatchProposalOutbox(context.Background(), 10); dispatched != 1 {
		t.Fatalf("expected one dispatched proposal, got %d", dispatched)
	}
	item := actor.service.proposals["proposal-1"]
	if item.Status != proposalOutboxStatusAccepted {
		t.Fatalf("expected local outbox accepted, got %+v", item)
	}
	events := authority.service.groupEvents[group.ID]
	if len(events) != 1 || events[0].ProposalULID != "proposal-1" || events[0].Actor.ActorDID != remoteActor {
		t.Fatalf("expected authority committed proposal event, got %+v", events)
	}
	peer, err := authorityPeerKeys.Get(context.Background(), actorStation)
	if err != nil {
		t.Fatalf("read authority peer key: %v", err)
	}
	if peer == nil || peer.StationID != actorStation {
		t.Fatalf("expected authority TOFU peer key for %s, got %+v", actorStation, peer)
	}
}

func TestApplyGroupEventRouteAdvancesFollowerCursor(t *testing.T) {
	registerGroupChatFederationScope()
	const (
		localStation     = "station-b"
		authorityStation = "station-a"
	)
	sub := newTestSubServer()
	sub.federationEventWrapper = serverwrapper.RequireFederationToken(
		groupChatEventApplyScopeName,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience(localStation),
	)
	event := &chat.GroupEvent{
		EventUlid:              "event-1",
		GroupUlid:              "group-1",
		Seq:                    1,
		PrevHash:               "",
		EventHash:              "hash-1",
		EventType:              "group.proposal.accepted",
		AuthorityStationPeerId: authorityStation,
		AuthorityEpoch:         1,
		MembershipEpoch:        1,
	}
	token := mintGroupChatEventToken(t, authorityStation, localStation, event.GetGroupUlid(), event.GetEventUlid(), event.GetSeq())

	response := invokeGroupChatHandler(t, sub, "gc-event-apply", &chat.ApplyGroupEventRequest{Event: event}, token)
	if response.status != 200 {
		t.Fatalf("expected 200, got %d body=%s", response.status, response.body.String())
	}
	var decoded chat.ApplyGroupEventResponse
	if err := protojson.Unmarshal(response.body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode response: %v body=%s", err, response.body.String())
	}
	if decoded.GetLastAcceptedSeq() != 1 || decoded.GetLastEventHash() != "hash-1" || decoded.GetStatus() != "active" {
		t.Fatalf("unexpected follower cursor response: %+v", &decoded)
	}
}

func TestApplyGroupEventRouteIsIdempotentReplay(t *testing.T) {
	registerGroupChatFederationScope()
	const (
		localStation     = "station-b"
		authorityStation = "station-a"
	)
	sub := newTestSubServer()
	sub.federationEventWrapper = serverwrapper.RequireFederationToken(
		groupChatEventApplyScopeName,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience(localStation),
	)
	event := &chat.GroupEvent{
		EventUlid:              "event-1",
		GroupUlid:              "group-1",
		Seq:                    1,
		PrevHash:               "",
		EventHash:              "hash-1",
		EventType:              "group.proposal.accepted",
		AuthorityStationPeerId: authorityStation,
		AuthorityEpoch:         1,
		MembershipEpoch:        1,
	}
	token := mintGroupChatEventToken(t, authorityStation, localStation, event.GetGroupUlid(), event.GetEventUlid(), event.GetSeq())
	for i := 0; i < 2; i++ {
		response := invokeGroupChatHandler(t, sub, "gc-event-apply", &chat.ApplyGroupEventRequest{Event: event}, token)
		if response.status != 200 {
			t.Fatalf("expected replay attempt %d to return 200, got %d body=%s", i+1, response.status, response.body.String())
		}
		var decoded chat.ApplyGroupEventResponse
		if err := protojson.Unmarshal(response.body.Bytes(), &decoded); err != nil {
			t.Fatalf("decode replay response: %v body=%s", err, response.body.String())
		}
		if decoded.GetLastAcceptedSeq() != 1 || decoded.GetLastEventHash() != "hash-1" || decoded.GetStatus() != "active" {
			t.Fatalf("unexpected replay cursor response: %+v", &decoded)
		}
	}
}

func TestApplyGroupEventRouteRejectsFederationClaimMismatch(t *testing.T) {
	registerGroupChatFederationScope()
	const (
		localStation     = "station-b"
		authorityStation = "station-a"
	)
	sub := newTestSubServer()
	sub.federationEventWrapper = serverwrapper.RequireFederationToken(
		groupChatEventApplyScopeName,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience(localStation),
	)
	event := &chat.GroupEvent{
		EventUlid:              "event-1",
		GroupUlid:              "group-1",
		Seq:                    1,
		EventHash:              "hash-1",
		EventType:              "group.proposal.accepted",
		AuthorityStationPeerId: authorityStation,
		AuthorityEpoch:         1,
		MembershipEpoch:        1,
	}
	token := mintGroupChatEventToken(t, authorityStation, localStation, event.GetGroupUlid(), event.GetEventUlid(), 2)

	response := invokeGroupChatHandler(t, sub, "gc-event-apply", &chat.ApplyGroupEventRequest{Event: event}, token)
	if response.status != 403 {
		t.Fatalf("expected claim mismatch 403, got %d body=%s", response.status, response.body.String())
	}
}

func TestApplyGroupEventRoutePublishesFederationEventToLocalMembers(t *testing.T) {
	registerGroupChatFederationScope()
	bus := startGroupChatEventsSubServer(t)

	const (
		localStation     = "station-b"
		authorityStation = "station-a"
	)
	sub := newTestSubServer()
	sub.federationEventWrapper = serverwrapper.RequireFederationToken(
		groupChatEventApplyScopeName,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience(localStation),
	)
	group := sub.service.CreateGroup("owner", "Engineering", "")
	if _, ok := sub.service.AddMember(group.ID, "carol", "owner"); !ok {
		t.Fatal("expected add member to succeed")
	}

	streamCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	subscription, unsubscribe, err := bus.Subscribe(streamCtx, "carol", "desktop-1", "")
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	defer unsubscribe()

	event := &chat.GroupEvent{
		EventUlid:              "event-1",
		GroupUlid:              group.ID,
		Seq:                    1,
		EventHash:              "hash-1",
		EventType:              "group.proposal.accepted",
		AuthorityStationPeerId: authorityStation,
		AuthorityEpoch:         1,
		MembershipEpoch:        group.MembershipEpoch,
		MessageUlid:            "message-1",
		Actor:                  &chat.FederatedActorRef{ActorDid: "did:peer:bob"},
	}
	token := mintGroupChatEventToken(t, authorityStation, localStation, group.ID, "event-1", 1)

	response := invokeGroupChatHandler(t, sub, "gc-event-apply", &chat.ApplyGroupEventRequest{Event: event}, token)
	if response.status != 200 {
		t.Fatalf("expected 200, got %d body=%s", response.status, response.body.String())
	}

	got := waitRealtimeEvent(t, subscription.Events, 100*time.Millisecond)
	federationEvent := got.GetGroupFederationEvent()
	if federationEvent == nil {
		t.Fatalf("expected group federation event, got %+v", got)
	}
	if federationEvent.GetGroupUlid() != group.ID ||
		federationEvent.GetEventUlid() != "event-1" ||
		federationEvent.GetSeq() != 1 ||
		federationEvent.GetEventType() != "group.proposal.accepted" ||
		federationEvent.GetAuthorityStationPeerId() != authorityStation ||
		federationEvent.GetEventHash() != "hash-1" ||
		federationEvent.GetMessageUlid() != "message-1" ||
		federationEvent.GetActorDid() != "did:peer:bob" {
		t.Fatalf("unexpected group federation event: %+v", federationEvent)
	}
}

func TestSyncGroupEventsRouteReturnsEventsAfterCursor(t *testing.T) {
	registerGroupChatFederationScope()
	const (
		authorityStation = "station-a"
		followerStation  = "station-b"
	)
	sub := newTestSubServer()
	sub.federationSyncWrapper = serverwrapper.RequireFederationToken(
		groupChatEventSyncScopeName,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience(authorityStation),
	)
	group := sub.service.CreateGroup("owner", "Engineering", "")
	sub.service.groupEvents[group.ID] = []domain.GroupEvent{
		{
			EventULID:              "event-1",
			GroupID:                group.ID,
			Seq:                    1,
			EventHash:              "hash-1",
			EventType:              "group.created",
			AuthorityStationPeerID: authorityStation,
			AuthorityEpoch:         1,
			MembershipEpoch:        group.MembershipEpoch,
		},
		{
			EventULID:              "event-2",
			GroupID:                group.ID,
			Seq:                    2,
			PrevHash:               "hash-1",
			EventHash:              "hash-2",
			EventType:              "group.member.joined",
			AuthorityStationPeerID: authorityStation,
			AuthorityEpoch:         1,
			MembershipEpoch:        group.MembershipEpoch,
		},
		{
			EventULID:              "event-3",
			GroupID:                group.ID,
			Seq:                    3,
			PrevHash:               "hash-2",
			EventHash:              "hash-3",
			EventType:              "group.proposal.accepted",
			AuthorityStationPeerID: authorityStation,
			AuthorityEpoch:         1,
			MembershipEpoch:        group.MembershipEpoch,
		},
	}
	req := &chat.SyncGroupEventsRequest{GroupUlid: group.ID, AfterSeq: 1, Limit: 10}
	token := mintGroupChatEventSyncToken(t, followerStation, authorityStation, group.ID)

	response := invokeGroupChatHandler(t, sub, "gc-event-sync", req, token)
	if response.status != 200 {
		t.Fatalf("expected 200, got %d body=%s", response.status, response.body.String())
	}
	var decoded chat.SyncGroupEventsResponse
	if err := protojson.Unmarshal(response.body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode response: %v body=%s", err, response.body.String())
	}
	if len(decoded.GetEvents()) != 2 || decoded.GetEvents()[0].GetSeq() != 2 || decoded.GetEvents()[1].GetSeq() != 3 {
		t.Fatalf("expected events after seq 1, got %+v", decoded.GetEvents())
	}
	if decoded.GetLastSeq() != 3 || decoded.GetLastEventHash() != "hash-3" {
		t.Fatalf("unexpected sync cursor: seq=%d hash=%s", decoded.GetLastSeq(), decoded.GetLastEventHash())
	}
}

func TestSyncGroupEventsRouteRejectsFederationClaimMismatch(t *testing.T) {
	registerGroupChatFederationScope()
	const (
		authorityStation = "station-a"
		followerStation  = "station-b"
	)
	sub := newTestSubServer()
	sub.federationSyncWrapper = serverwrapper.RequireFederationToken(
		groupChatEventSyncScopeName,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience(authorityStation),
	)
	group := sub.service.CreateGroup("owner", "Engineering", "")
	token := mintGroupChatEventSyncToken(t, followerStation, authorityStation, "other-group")

	response := invokeGroupChatHandler(t, sub, "gc-event-sync", &chat.SyncGroupEventsRequest{GroupUlid: group.ID, AfterSeq: 0, Limit: 10}, token)
	if response.status != 403 {
		t.Fatalf("expected claim mismatch 403, got %d body=%s", response.status, response.body.String())
	}
}

func TestSyncGroupProjectionRouteReturnsOpaqueProjection(t *testing.T) {
	registerGroupChatFederationScope()
	const (
		authorityStation = "station-a"
		followerStation  = "station-b"
	)
	sub := newTestSubServer()
	sub.federationProjectionWrapper = serverwrapper.RequireFederationToken(
		groupChatProjectionSyncScopeName,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience(authorityStation),
	)
	group := sub.service.CreateGroup("owner", "Engineering", "")
	addFederatedMemberForTest(t, sub, group.ID, "bob", followerStation)
	sub.service.SendMessage(group.ID, "owner", int32(chat.GroupMessageType_GROUP_MESSAGE_TYPE_TEXT), "", "", "", nil, []byte("ciphertext-1"))
	sub.service.groupEvents[group.ID] = []domain.GroupEvent{
		{
			EventULID:              "event-1",
			GroupID:                group.ID,
			Seq:                    1,
			EventHash:              "hash-1",
			EventType:              "group.message.appended",
			Actor:                  domain.FederatedActorRef{ActorDID: "owner"},
			MessageID:              "message-1",
			MembershipEpoch:        group.MembershipEpoch,
			AuthorityStationPeerID: authorityStation,
			AuthorityEpoch:         1,
		},
	}
	req := &chat.SyncGroupProjectionRequest{
		GroupUlid:        group.ID,
		AppliedSeq:       1,
		AppliedEventHash: "hash-1",
		MemberLimit:      10,
		MessageLimit:     10,
	}
	token := mintGroupChatProjectionSyncToken(t, followerStation, authorityStation, group.ID, 1, "hash-1")

	response := invokeGroupChatHandler(t, sub, "gc-projection-sync", req, token)
	if response.status != 200 {
		t.Fatalf("expected 200, got %d body=%s", response.status, response.body.String())
	}
	var decoded chat.SyncGroupProjectionResponse
	if err := protojson.Unmarshal(response.body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode response: %v body=%s", err, response.body.String())
	}
	if decoded.GetGroup().GetUlid() != group.ID || decoded.GetLastEventSeq() != 1 || decoded.GetLastEventHash() != "hash-1" {
		t.Fatalf("unexpected projection cursor/group: %+v", &decoded)
	}
	if decoded.GetMemberTotal() != 2 || len(decoded.GetMembers()) != 2 {
		t.Fatalf("expected owner+bob members, got total=%d members=%+v", decoded.GetMemberTotal(), decoded.GetMembers())
	}
	var bob *chat.GroupMember
	for _, member := range decoded.GetMembers() {
		if member.GetActorDid() == "bob" {
			bob = member
			break
		}
	}
	if bob == nil || bob.GetActorHomeStationPeerId() != followerStation {
		t.Fatalf("expected bob routing metadata, got %+v", bob)
	}
	if len(decoded.GetMessages()) != 1 {
		t.Fatalf("expected one message, got %+v", decoded.GetMessages())
	}
	msg := decoded.GetMessages()[0]
	if msg.GetContent() != "" || string(msg.GetEncryptedPayload()) != "ciphertext-1" {
		t.Fatalf("expected opaque encrypted message without content, got content=%q payload=%q", msg.GetContent(), string(msg.GetEncryptedPayload()))
	}
}

func TestSyncGroupProjectionRouteRejectsCursorMismatch(t *testing.T) {
	registerGroupChatFederationScope()
	const (
		authorityStation = "station-a"
		followerStation  = "station-b"
	)
	sub := newTestSubServer()
	sub.federationProjectionWrapper = serverwrapper.RequireFederationToken(
		groupChatProjectionSyncScopeName,
		authfed.NewInMemoryPeerKeyStore(),
		httpadapter.StaticAudience(authorityStation),
	)
	group := sub.service.CreateGroup("owner", "Engineering", "")
	sub.service.groupEvents[group.ID] = []domain.GroupEvent{
		{
			EventULID:              "event-1",
			GroupID:                group.ID,
			Seq:                    1,
			EventHash:              "hash-1",
			EventType:              "group.message.appended",
			Actor:                  domain.FederatedActorRef{ActorDID: "owner"},
			MembershipEpoch:        group.MembershipEpoch,
			AuthorityStationPeerID: authorityStation,
			AuthorityEpoch:         1,
		},
	}
	req := &chat.SyncGroupProjectionRequest{GroupUlid: group.ID, AppliedSeq: 1, AppliedEventHash: "stale-hash"}
	token := mintGroupChatProjectionSyncToken(t, followerStation, authorityStation, group.ID, 1, "stale-hash")

	response := invokeGroupChatHandler(t, sub, "gc-projection-sync", req, token)
	if response.status != 409 {
		t.Fatalf("expected cursor mismatch 409, got %d body=%s", response.status, response.body.String())
	}
}

func TestHandleSubmitGroupSkdmEnvelopeEnqueuesOpaqueEnvelope(t *testing.T) {
	sub := newTestSubServer()
	group := sub.service.CreateGroup("alice", "Engineering", "")
	addFederatedMemberForTest(t, sub, group.ID, "bob", "station-b")
	req := &chat.SubmitGroupSkdmEnvelopeRequest{
		Envelope: &chat.GroupSkdmEnvelope{
			GroupUlid:                  group.ID,
			MembershipEpoch:            group.MembershipEpoch,
			SenderDid:                  "alice",
			SenderKeyId:                7,
			RecipientDid:               "bob",
			RecipientDeviceId:          "bob-device-1",
			RecipientHomeStationPeerId: "station-b",
			EncryptedPayload:           []byte("sealed-skdm-payload"),
			IdempotencyKey:             "skdm-1",
		},
	}

	resp, err := sub.handleSubmitGroupSkdmEnvelope(subjectContext("alice"), req)
	if err != nil {
		t.Fatalf("handleSubmitGroupSkdmEnvelope returned error: %v", err)
	}
	if resp.GetStatus() != skdmOutboxStatusPending || resp.GetIdempotentReplay() {
		t.Fatalf("unexpected SKDM submit response: %+v", resp)
	}
	item := sub.service.skdmOutbox["skdm-1"]
	if item.GroupID != group.ID || item.RecipientDID != "bob" || string(item.EncryptedPayload) != "sealed-skdm-payload" {
		t.Fatalf("expected sealed SKDM envelope in outbox, got %+v", item)
	}

	replay, err := sub.handleSubmitGroupSkdmEnvelope(subjectContext("alice"), req)
	if err != nil {
		t.Fatalf("handleSubmitGroupSkdmEnvelope replay returned error: %v", err)
	}
	if !replay.GetIdempotentReplay() || replay.GetOutboxUlid() != resp.GetOutboxUlid() {
		t.Fatalf("expected idempotent replay of same SKDM outbox row, first=%+v replay=%+v", resp, replay)
	}
}

func TestSubmitGroupSkdmRouteEnqueuesPendingEnvelope(t *testing.T) {
	sub := newTestSubServer()
	provider := auth.NewJWTProvider("test-secret", time.Hour)
	_, token, err := provider.Authenticate(context.Background(), auth.Credentials{SubjectID: "alice"})
	if err != nil {
		t.Fatalf("mint actor token: %v", err)
	}
	sub.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))
	group := sub.service.CreateGroup("alice", "Engineering", "")
	addFederatedMemberForTest(t, sub, group.ID, "bob", "station-b")
	req := &chat.SubmitGroupSkdmEnvelopeRequest{
		Envelope: &chat.GroupSkdmEnvelope{
			GroupUlid:                  group.ID,
			MembershipEpoch:            group.MembershipEpoch,
			SenderDid:                  "alice",
			SenderKeyId:                7,
			RecipientDid:               "bob",
			RecipientDeviceId:          "bob-device-1",
			RecipientHomeStationPeerId: "station-b",
			EncryptedPayload:           []byte("sealed-skdm-payload"),
			IdempotencyKey:             "skdm-route-1",
		},
	}

	response := invokeGroupChatHandler(t, sub, "gc-skdm-submit", req, token.Value)
	if response.status != 200 {
		t.Fatalf("expected 200, got %d body=%s", response.status, response.body.String())
	}
	var decoded chat.SubmitGroupSkdmEnvelopeResponse
	if err := protojson.Unmarshal(response.body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode response: %v body=%s", err, response.body.String())
	}
	if decoded.GetStatus() != skdmOutboxStatusPending || decoded.GetOutboxUlid() == "" || decoded.GetIdempotentReplay() {
		t.Fatalf("unexpected SKDM route response: %+v", &decoded)
	}

	response = invokeGroupChatHandler(t, sub, "gc-skdm-submit", req, token.Value)
	if response.status != 200 {
		t.Fatalf("expected replay 200, got %d body=%s", response.status, response.body.String())
	}
	var replay chat.SubmitGroupSkdmEnvelopeResponse
	if err := protojson.Unmarshal(response.body.Bytes(), &replay); err != nil {
		t.Fatalf("decode replay response: %v body=%s", err, response.body.String())
	}
	if !replay.GetIdempotentReplay() || replay.GetOutboxUlid() != decoded.GetOutboxUlid() {
		t.Fatalf("expected idempotent SKDM route replay, first=%+v replay=%+v", &decoded, &replay)
	}
}

func TestDeliverGroupSkdmEnvelopePublishesToRecipientDevice(t *testing.T) {
	bus := startGroupChatEventsSubServer(t)

	sub := newTestSubServer()
	group := sub.service.CreateGroup("alice", "Engineering", "")
	addFederatedMemberForTest(t, sub, group.ID, "bob", "station-b")

	streamCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	targetSub, unsubscribeTarget, err := bus.Subscribe(streamCtx, "bob", "bob-device-1", "")
	if err != nil {
		t.Fatalf("subscribe target: %v", err)
	}
	defer unsubscribeTarget()
	otherSub, unsubscribeOther, err := bus.Subscribe(streamCtx, "bob", "bob-device-2", "")
	if err != nil {
		t.Fatalf("subscribe other: %v", err)
	}
	defer unsubscribeOther()

	resp, err := sub.handleDeliverGroupSkdmEnvelope(context.Background(), &chat.SubmitGroupSkdmEnvelopeRequest{
		Envelope: &chat.GroupSkdmEnvelope{
			GroupUlid:                  group.ID,
			MembershipEpoch:            group.MembershipEpoch,
			SenderDid:                  "alice",
			SenderKeyId:                7,
			RecipientDid:               "bob",
			RecipientDeviceId:          "bob-device-1",
			RecipientHomeStationPeerId: "station-b",
			EncryptedPayload:           []byte("sealed-skdm-payload"),
			IdempotencyKey:             "skdm-deliver-1",
		},
	})
	if err != nil {
		t.Fatalf("deliver skdm: %v", err)
	}
	if resp.GetStatus() != skdmOutboxStatusDelivered {
		t.Fatalf("expected delivered status, got %+v", resp)
	}
	if item := sub.service.skdmOutbox["skdm-deliver-1"]; item.Status != skdmOutboxStatusDelivered {
		t.Fatalf("expected target outbox row delivered, got %+v", item)
	}

	got := waitRealtimeEvent(t, targetSub.Events, 100*time.Millisecond)
	delivered := got.GetGroupSkdmEnvelopeDelivered()
	if delivered == nil {
		t.Fatalf("expected group skdm delivery event, got %+v", got)
	}
	if delivered.GetGroupUlid() != group.ID ||
		delivered.GetMembershipEpoch() != group.MembershipEpoch ||
		delivered.GetSenderDid() != "alice" ||
		delivered.GetSenderKeyId() != 7 ||
		delivered.GetRecipientDid() != "bob" ||
		delivered.GetRecipientDeviceId() != "bob-device-1" ||
		delivered.GetIdempotencyKey() != "skdm-deliver-1" ||
		string(delivered.GetEncryptedPayload()) != "sealed-skdm-payload" {
		t.Fatalf("unexpected skdm delivery event: %+v", delivered)
	}
	select {
	case ev := <-otherSub.Events:
		t.Fatalf("non-target device received SKDM event: %+v", ev)
	case <-time.After(20 * time.Millisecond):
	}
}

func TestHandleSubmitGroupSkdmEnvelopeRejectsSenderSubjectMismatch(t *testing.T) {
	sub := newTestSubServer()
	group := sub.service.CreateGroup("alice", "Engineering", "")
	addFederatedMemberForTest(t, sub, group.ID, "bob", "station-b")

	_, err := sub.handleSubmitGroupSkdmEnvelope(subjectContext("mallory"), &chat.SubmitGroupSkdmEnvelopeRequest{
		Envelope: &chat.GroupSkdmEnvelope{
			GroupUlid:                  group.ID,
			MembershipEpoch:            group.MembershipEpoch,
			SenderDid:                  "alice",
			SenderKeyId:                7,
			RecipientDid:               "bob",
			RecipientDeviceId:          "bob-device-1",
			RecipientHomeStationPeerId: "station-b",
			EncryptedPayload:           []byte("sealed-skdm-payload"),
			IdempotencyKey:             "skdm-1",
		},
	})
	if err == nil {
		t.Fatal("expected sender subject mismatch to be rejected")
	}
}

func waitRealtimeEvent(t *testing.T, events <-chan *realtime.StreamEvent, timeout time.Duration) *realtime.StreamEvent {
	t.Helper()
	select {
	case ev := <-events:
		return ev
	case <-time.After(timeout):
		t.Fatal("timed out waiting for realtime event")
	}
	return nil
}

func newTestSubServer() *subServer {
	svc := newTestService()
	return &subServer{
		service:    svc,
		appService: application_group_chat.NewService(svc),
	}
}

func addFederatedMemberForTest(t *testing.T, sub *subServer, groupID, actorDID, homeStationPeerID string) {
	t.Helper()
	if sub.service.members == nil {
		sub.service.members = map[string]map[string]*member{}
	}
	if sub.service.members[groupID] == nil {
		sub.service.members[groupID] = map[string]*member{}
	}
	sub.service.members[groupID][actorDID] = &member{
		GroupID:  groupID,
		ActorDID: actorDID,
		Actor: domain.FederatedActorRef{
			ActorDID:          actorDID,
			HomeStationPeerID: homeStationPeerID,
		},
		Role:     domain.GroupRoleMember,
		JoinedAt: time.Now(),
	}
}

func subjectContext(actorDID string) context.Context {
	return auth.WithSubject(context.Background(), &auth.Subject{ID: actorDID})
}

func mintGroupChatProposalToken(t *testing.T, issuer, audience, subject, groupID, proposalID string) string {
	t.Helper()
	cache := authfed.NewKeyCache(authfed.NewInMemoryKeyStore(), authfed.WithRecheckTTL(0))
	if _, err := cache.Get(context.Background()); err != nil {
		t.Fatalf("warm federation key cache: %v", err)
	}
	token, err := authfed.Mint(context.Background(), cache, authfed.MintRequest{
		Scope:    groupChatProposalScopeName,
		Issuer:   issuer,
		Audience: audience,
		Subject:  subject,
		TTL:      30 * time.Second,
		Custom: map[string]string{
			groupChatProposalClaimGroup:    groupID,
			groupChatProposalClaimProposal: proposalID,
			groupChatProposalClaimActor:    subject,
		},
	})
	if err != nil {
		t.Fatalf("mint federation token: %v", err)
	}
	return token
}

func mintGroupChatEventToken(t *testing.T, issuer, audience, groupID, eventID string, seq int64) string {
	t.Helper()
	cache := authfed.NewKeyCache(authfed.NewInMemoryKeyStore(), authfed.WithRecheckTTL(0))
	if _, err := cache.Get(context.Background()); err != nil {
		t.Fatalf("warm federation key cache: %v", err)
	}
	token, err := authfed.Mint(context.Background(), cache, authfed.MintRequest{
		Scope:    groupChatEventApplyScopeName,
		Issuer:   issuer,
		Audience: audience,
		Subject:  issuer,
		TTL:      30 * time.Second,
		Custom: map[string]string{
			groupChatProposalClaimGroup: groupID,
			groupChatEventClaimEvent:    eventID,
			groupChatEventClaimSeq:      strconv.FormatInt(seq, 10),
		},
	})
	if err != nil {
		t.Fatalf("mint federation event token: %v", err)
	}
	return token
}

func mintGroupChatEventSyncToken(t *testing.T, issuer, audience, groupID string) string {
	t.Helper()
	cache := authfed.NewKeyCache(authfed.NewInMemoryKeyStore(), authfed.WithRecheckTTL(0))
	if _, err := cache.Get(context.Background()); err != nil {
		t.Fatalf("warm federation key cache: %v", err)
	}
	token, err := authfed.Mint(context.Background(), cache, authfed.MintRequest{
		Scope:    groupChatEventSyncScopeName,
		Issuer:   issuer,
		Audience: audience,
		Subject:  issuer,
		TTL:      30 * time.Second,
		Custom: map[string]string{
			groupChatProposalClaimGroup: groupID,
		},
	})
	if err != nil {
		t.Fatalf("mint federation event sync token: %v", err)
	}
	return token
}

func mintGroupChatProjectionSyncToken(t *testing.T, issuer, audience, groupID string, appliedSeq int64, appliedEventHash string) string {
	t.Helper()
	cache := authfed.NewKeyCache(authfed.NewInMemoryKeyStore(), authfed.WithRecheckTTL(0))
	if _, err := cache.Get(context.Background()); err != nil {
		t.Fatalf("warm federation key cache: %v", err)
	}
	token, err := authfed.Mint(context.Background(), cache, authfed.MintRequest{
		Scope:    groupChatProjectionSyncScopeName,
		Issuer:   issuer,
		Audience: audience,
		Subject:  issuer,
		TTL:      30 * time.Second,
		Custom: map[string]string{
			groupChatProposalClaimGroup: groupID,
			groupChatEventClaimSeq:      strconv.FormatInt(appliedSeq, 10),
			groupChatEventClaimEvent:    appliedEventHash,
		},
	})
	if err != nil {
		t.Fatalf("mint federation projection sync token: %v", err)
	}
	return token
}

func invokeGroupChatHandler(t *testing.T, sub *subServer, name string, msg proto.Message, token string) *testResponse {
	t.Helper()
	var target server.Handler
	for _, handler := range sub.Handlers() {
		if handler.Name() == name {
			target = handler
			break
		}
	}
	if target == nil {
		t.Fatalf("handler %s not found", name)
	}
	body, err := protojson.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	endpoint := target.Handler()
	wrappers := target.Wrappers()
	for i := len(wrappers) - 1; i >= 0; i-- {
		endpoint = wrappers[i](endpoint)
	}
	req := &testRequest{
		method: server.POST,
		path:   target.Path(),
		body:   body,
		header: map[string]string{
			"Content-Type":  "application/json",
			"Authorization": "Bearer " + token,
		},
	}
	resp := &testResponse{header: map[string]string{}}
	if err := endpoint(context.Background(), req, resp); err != nil {
		t.Fatalf("invoke handler: %v", err)
	}
	return resp
}

type localGroupProposalTransport struct {
	t         *testing.T
	authority *subServer
}

func (tr localGroupProposalTransport) SubmitGroupProposal(ctx context.Context, authorityStationPeerID string, req *chat.AcceptGroupProposalRequest, token string) (*chat.AcceptGroupProposalResponse, error) {
	_ = ctx
	_ = authorityStationPeerID
	response := invokeGroupChatHandler(tr.t, tr.authority, "gc-proposal-accept", req, token)
	if response.status != 200 {
		return nil, proposalDispatchError(response.status, response.body.String())
	}
	var decoded chat.AcceptGroupProposalResponse
	if err := protojson.Unmarshal(response.body.Bytes(), &decoded); err != nil {
		return nil, err
	}
	return &decoded, nil
}

type testRequest struct {
	method server.Method
	path   string
	body   []byte
	header map[string]string
}

func (r *testRequest) Context() context.Context  { return context.Background() }
func (r *testRequest) Header() map[string]string { return r.header }
func (r *testRequest) Method() server.Method     { return r.method }
func (r *testRequest) Path() string              { return r.path }
func (r *testRequest) Body() []byte              { return r.body }

type testResponse struct {
	header map[string]string
	status int
	body   bytes.Buffer
}

func (r *testResponse) Header() map[string]string { return r.header }
func (r *testResponse) SetHeader(key, value string) {
	if r.header == nil {
		r.header = map[string]string{}
	}
	r.header[key] = value
}
func (r *testResponse) Write(data []byte) (int, error) { return r.body.Write(data) }
func (r *testResponse) WriteHeader(status int)         { r.status = status }
func (r *testResponse) Status() int                    { return r.status }
