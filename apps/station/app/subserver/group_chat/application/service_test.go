package application

import (
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/group_chat/domain"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

func TestUpdateMemberByActorOwnerPromotesMember(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner":  {ActorDID: "owner", Role: domain.GroupRoleOwner},
		"member": {ActorDID: "member", Role: domain.GroupRoleMember},
	})
	service := NewService(repo)

	role := domain.GroupRoleAdmin
	member, err := service.UpdateMemberByActor("owner", "group-1", "member", &role, nil, nil)
	if err != nil {
		t.Fatalf("expected owner promotion to succeed: %v", err)
	}
	if member.Role != domain.GroupRoleAdmin {
		t.Fatalf("expected promoted role %d, got %d", domain.GroupRoleAdmin, member.Role)
	}
}

func TestUpdateMemberByActorAdminCannotChangeRole(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner":  {ActorDID: "owner", Role: domain.GroupRoleOwner},
		"admin":  {ActorDID: "admin", Role: domain.GroupRoleAdmin},
		"member": {ActorDID: "member", Role: domain.GroupRoleMember},
	})
	service := NewService(repo)

	role := domain.GroupRoleAdmin
	if _, err := service.UpdateMemberByActor("admin", "group-1", "member", &role, nil, nil); err != ErrPermissionDenied {
		t.Fatalf("expected admin role change to be denied, got %v", err)
	}
}

func TestUpdateMemberByActorAdminCanMuteMember(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner":  {ActorDID: "owner", Role: domain.GroupRoleOwner},
		"admin":  {ActorDID: "admin", Role: domain.GroupRoleAdmin},
		"member": {ActorDID: "member", Role: domain.GroupRoleMember},
	})
	service := NewService(repo)

	muted := true
	member, err := service.UpdateMemberByActor("admin", "group-1", "member", nil, &muted, nil)
	if err != nil {
		t.Fatalf("expected admin mute to succeed: %v", err)
	}
	if !member.Muted {
		t.Fatal("expected member to be muted")
	}
}

func TestRemoveMemberByActorAdminCannotRemoveAdmin(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner":       {ActorDID: "owner", Role: domain.GroupRoleOwner},
		"admin":       {ActorDID: "admin", Role: domain.GroupRoleAdmin},
		"other-admin": {ActorDID: "other-admin", Role: domain.GroupRoleAdmin},
	})
	service := NewService(repo)

	if err := service.RemoveMemberByActor("admin", "group-1", "other-admin"); err != ErrPermissionDenied {
		t.Fatalf("expected same-role removal to be denied, got %v", err)
	}
}

func TestRemoveMemberByActorOwnerCanRemoveAdmin(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner": {ActorDID: "owner", Role: domain.GroupRoleOwner},
		"admin": {ActorDID: "admin", Role: domain.GroupRoleAdmin},
	})
	service := NewService(repo)

	if err := service.RemoveMemberByActor("owner", "group-1", "admin"); err != nil {
		t.Fatalf("expected owner to remove admin, got %v", err)
	}
	if _, ok := repo.members["admin"]; ok {
		t.Fatal("expected admin member to be removed")
	}
}

func TestRemoveMemberByActorAdminCanRemoveMember(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner":  {ActorDID: "owner", Role: domain.GroupRoleOwner},
		"admin":  {ActorDID: "admin", Role: domain.GroupRoleAdmin},
		"member": {ActorDID: "member", Role: domain.GroupRoleMember},
	})
	service := NewService(repo)

	if err := service.RemoveMemberByActor("admin", "group-1", "member"); err != nil {
		t.Fatalf("expected admin to remove ordinary member, got %v", err)
	}
	if _, ok := repo.members["member"]; ok {
		t.Fatal("expected ordinary member to be removed")
	}
}

func TestRemoveMemberByActorMemberCannotRemoveMember(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner":        {ActorDID: "owner", Role: domain.GroupRoleOwner},
		"member":       {ActorDID: "member", Role: domain.GroupRoleMember},
		"other-member": {ActorDID: "other-member", Role: domain.GroupRoleMember},
	})
	service := NewService(repo)

	if err := service.RemoveMemberByActor("member", "group-1", "other-member"); err != ErrPermissionDenied {
		t.Fatalf("expected ordinary member removal to be denied, got %v", err)
	}
}

func TestUpdateMemberByActorOwnerCannotBeChanged(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner":  {ActorDID: "owner", Role: domain.GroupRoleOwner},
		"member": {ActorDID: "member", Role: domain.GroupRoleMember},
	})
	service := NewService(repo)

	role := domain.GroupRoleMember
	if _, err := service.UpdateMemberByActor("member", "group-1", "owner", &role, nil, nil); err != ErrPermissionDenied {
		t.Fatalf("expected member role change to be denied, got %v", err)
	}
	if _, err := service.UpdateMemberByActor("owner", "group-1", "owner", &role, nil, nil); err != ErrCannotRemoveOwner {
		t.Fatalf("expected owner self-demotion to be denied, got %v", err)
	}
}

func TestRemoveMemberByActorOwnerCannotBeRemoved(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner": {ActorDID: "owner", Role: domain.GroupRoleOwner},
		"admin": {ActorDID: "admin", Role: domain.GroupRoleAdmin},
	})
	service := NewService(repo)

	if err := service.RemoveMemberByActor("admin", "group-1", "owner"); err != ErrCannotRemoveOwner {
		t.Fatalf("expected owner removal to be denied, got %v", err)
	}
}

func TestUpdateMemberByActorAdminCannotMuteAdminOrOwner(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner":       {ActorDID: "owner", Role: domain.GroupRoleOwner},
		"admin":       {ActorDID: "admin", Role: domain.GroupRoleAdmin},
		"other-admin": {ActorDID: "other-admin", Role: domain.GroupRoleAdmin},
	})
	service := NewService(repo)
	muted := true

	if _, err := service.UpdateMemberByActor("admin", "group-1", "other-admin", nil, &muted, nil); err != ErrPermissionDenied {
		t.Fatalf("expected admin muting admin to be denied, got %v", err)
	}
	if _, err := service.UpdateMemberByActor("admin", "group-1", "owner", nil, &muted, nil); err != ErrCannotRemoveOwner {
		t.Fatalf("expected admin muting owner to be denied, got %v", err)
	}
}

func TestUpdateMemberByActorRejectsInvalidRole(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner":  {ActorDID: "owner", Role: domain.GroupRoleOwner},
		"member": {ActorDID: "member", Role: domain.GroupRoleMember},
	})
	service := NewService(repo)

	role := int32(99)
	if _, err := service.UpdateMemberByActor("owner", "group-1", "member", &role, nil, nil); err != ErrInvalidRole {
		t.Fatalf("expected invalid role to be rejected, got %v", err)
	}
}

func TestInviteByActorRequiresMembership(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner": {ActorDID: "owner", Role: domain.GroupRoleOwner},
	})
	service := NewService(repo)

	if _, err := service.InviteByActor("stranger", "group-1", []string{"invitee"}); err != ErrNotMember {
		t.Fatalf("expected non-member invite to be denied, got %v", err)
	}
}

func TestJoinByActorRequiresInvitation(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner": {ActorDID: "owner", Role: domain.GroupRoleOwner},
	})
	service := NewService(repo)

	if _, err := service.JoinByActor("stranger", "group-1", ""); err != ErrInvalidInvitation {
		t.Fatalf("expected missing invitation to be rejected, got %v", err)
	}
	if _, ok := repo.members["stranger"]; ok {
		t.Fatal("expected stranger not to be added")
	}
}

func TestJoinByActorAcceptsPendingInvitationOnce(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner": {ActorDID: "owner", Role: domain.GroupRoleOwner},
	})
	repo.invitations["invite-1"] = domain.Invitation{
		ID:         "invite-1",
		GroupID:    "group-1",
		InviteeDID: "invitee",
		Status:     1,
		ExpireAt:   time.Now().Add(time.Hour),
	}
	service := NewService(repo)

	member, err := service.JoinByActor("invitee", "group-1", "invite-1")
	if err != nil {
		t.Fatalf("expected invitee join to succeed: %v", err)
	}
	if member.ActorDID != "invitee" {
		t.Fatalf("expected invitee membership, got %+v", member)
	}
	if _, err := service.JoinByActor("invitee", "group-1", "invite-1"); err != ErrInvalidInvitation {
		t.Fatalf("expected accepted invitation to be single-use, got %v", err)
	}
}

func TestJoinByActorRejectsExpiredInvitation(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner": {ActorDID: "owner", Role: domain.GroupRoleOwner},
	})
	repo.invitations["invite-1"] = domain.Invitation{
		ID:         "invite-1",
		GroupID:    "group-1",
		InviteeDID: "invitee",
		Status:     1,
		ExpireAt:   time.Now().Add(-time.Hour),
	}
	service := NewService(repo)

	if _, err := service.JoinByActor("invitee", "group-1", "invite-1"); err != ErrInvalidInvitation {
		t.Fatalf("expected expired invitation to be rejected, got %v", err)
	}
	if got := repo.invitations["invite-1"].Status; got != 4 {
		t.Fatalf("expected expired invitation status 4, got %d", got)
	}
	if _, ok := repo.members["invitee"]; ok {
		t.Fatal("expected expired invitee not to be added")
	}
}

func TestSendMessageByActorRequiresMembership(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner": {ActorDID: "owner", Role: domain.GroupRoleOwner},
	})
	service := NewService(repo)

	if _, err := service.SendMessageByActor("stranger", "group-1", 1, "", "", "", nil, []byte("ciphertext"), 1); err != ErrNotMember {
		t.Fatalf("expected non-member send to be denied, got %v", err)
	}
}

func TestSendMessageByActorRejectsMutedMember(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"member": {ActorDID: "member", Role: domain.GroupRoleMember, Muted: true},
	})
	service := NewService(repo)

	if _, err := service.SendMessageByActor("member", "group-1", 1, "", "", "", nil, []byte("ciphertext"), 1); err != ErrMemberMuted {
		t.Fatalf("expected muted member send to be denied, got %v", err)
	}
}

func TestSendMessageByActorAllowsExpiredMute(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"member": {
			ActorDID:   "member",
			Role:       domain.GroupRoleMember,
			Muted:      true,
			MutedUntil: time.Now().Add(-time.Minute),
		},
	})
	service := NewService(repo)

	if _, err := service.SendMessageByActor("member", "group-1", 1, "", "", "", nil, []byte("ciphertext"), 1); err != nil {
		t.Fatalf("expected expired mute send to succeed, got %v", err)
	}
}

func TestSendMessageByActorRejectsStaleMembershipEpoch(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"member": {ActorDID: "member", Role: domain.GroupRoleMember},
	})
	repo.group.MembershipEpoch = 2
	service := NewService(repo)

	if _, err := service.SendMessageByActor("member", "group-1", 1, "", "", "", nil, []byte("ciphertext"), 1); err != ErrMembershipEpochStale {
		t.Fatalf("expected stale membership epoch to be denied, got %v", err)
	}
	if _, err := service.SendMessageByActor("member", "group-1", 1, "", "", "", nil, []byte("ciphertext"), 2); err != nil {
		t.Fatalf("expected current membership epoch to send, got %v", err)
	}
}

func TestAcceptProposalRequiresSignedEnvelope(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner": {ActorDID: "owner", Role: domain.GroupRoleOwner},
	})
	service := NewService(repo)

	_, _, err := service.AcceptProposal(domain.GroupProposal{
		ProposalULID:            "proposal-1",
		GroupID:                 "group-1",
		Actor:                   domain.FederatedActorRef{ActorDID: "remote-actor"},
		Command:                 1,
		ObservedMembershipEpoch: 1,
	})
	if err != ErrInvalidProposal {
		t.Fatalf("expected unsigned proposal to be rejected, got %v", err)
	}
}

func TestAcceptProposalCommitsSignedEnvelope(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner":        {ActorDID: "owner", Role: domain.GroupRoleOwner},
		"remote-actor": {ActorDID: "remote-actor", Actor: domain.FederatedActorRef{ActorDID: "remote-actor", HomeStationPeerID: "station-b"}, Role: domain.GroupRoleMember},
	})
	service := NewService(repo)

	event, replay, err := service.AcceptProposal(domain.GroupProposal{
		ProposalULID:            "proposal-1",
		GroupID:                 "group-1",
		Actor:                   domain.FederatedActorRef{ActorDID: "remote-actor", HomeStationPeerID: "station-b"},
		Command:                 1,
		ObservedMembershipEpoch: 1,
		IdempotencyKey:          "proposal-1",
		SigningKeyID:            "remote-actor#1",
		Signature:               []byte("signature"),
	})
	if err != nil {
		t.Fatalf("expected signed proposal to be accepted, got %v", err)
	}
	if replay {
		t.Fatal("expected first proposal acceptance not to be replay")
	}
	if event.ProposalULID != "proposal-1" || event.Actor.ActorDID != "remote-actor" {
		t.Fatalf("unexpected committed event: %+v", event)
	}
	if repo.acceptedProposal.ProposalULID != "proposal-1" {
		t.Fatalf("expected repo to receive proposal, got %+v", repo.acceptedProposal)
	}
}

func TestAcceptProposalRequiresCurrentMembership(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner": {ActorDID: "owner", Role: domain.GroupRoleOwner},
	})
	service := NewService(repo)

	_, _, err := service.AcceptProposal(domain.GroupProposal{
		ProposalULID:            "proposal-1",
		GroupID:                 "group-1",
		Actor:                   domain.FederatedActorRef{ActorDID: "remote-actor", HomeStationPeerID: "station-b"},
		Command:                 1,
		ObservedMembershipEpoch: 1,
		IdempotencyKey:          "proposal-1",
		SigningKeyID:            "remote-actor#1",
		Signature:               []byte("signature"),
	})
	if err != ErrNotMember {
		t.Fatalf("expected non-member proposal actor to be rejected, got %v", err)
	}
}

func TestEnqueueProposalOutboxRequiresAuthorityAndSignedEnvelope(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{})
	service := NewService(repo)

	_, _, err := service.EnqueueProposalOutbox(domain.GroupProposal{
		ProposalULID: "proposal-1",
		GroupID:      "group-1",
		Actor: domain.FederatedActorRef{
			ActorDID:          "remote-actor",
			HomeStationPeerID: "station-b",
		},
		Command:      1,
		SigningKeyID: "remote-actor#1",
		Signature:    []byte("signature"),
	})
	if err != ErrInvalidProposal {
		t.Fatalf("expected missing authority to be rejected, got %v", err)
	}
}

func TestEnqueueProposalOutboxStoresSignedEnvelope(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{})
	service := NewService(repo)

	item, replay, err := service.EnqueueProposalOutbox(domain.GroupProposal{
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
	})
	if err != nil {
		t.Fatalf("expected proposal outbox enqueue to succeed, got %v", err)
	}
	if replay {
		t.Fatal("expected first proposal enqueue not to be replay")
	}
	if item.ProposalULID != "proposal-1" || item.AuthorityStationPeerID != "station-a" || item.Status != "pending" {
		t.Fatalf("unexpected outbox item: %+v", item)
	}
	if repo.proposalOutbox.ProposalULID != "proposal-1" {
		t.Fatalf("expected repo to receive proposal, got %+v", repo.proposalOutbox)
	}
}

func TestEnqueueGroupSkdmOutboxStoresOpaqueEnvelope(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"alice": {ActorDID: "alice", Role: domain.GroupRoleOwner},
		"bob": {
			ActorDID: "bob",
			Role:     domain.GroupRoleMember,
			Actor: domain.FederatedActorRef{
				ActorDID:          "bob",
				HomeStationPeerID: "station-b",
			},
		},
	})
	service := NewService(repo)

	item, replay, err := service.EnqueueGroupSkdmOutbox(domain.GroupSkdmEnvelope{
		GroupID:                    "group-1",
		MembershipEpoch:            1,
		SenderDID:                  "alice",
		SenderKeyID:                7,
		RecipientDID:               "bob",
		RecipientDeviceID:          "bob-device-1",
		RecipientHomeStationPeerID: "station-b",
		EncryptedPayload:           []byte("sealed-skdm-payload"),
		IdempotencyKey:             "skdm-1",
	})
	if err != nil {
		t.Fatalf("expected opaque SKDM envelope to enqueue, got %v", err)
	}
	if replay {
		t.Fatal("expected first SKDM enqueue not to be replay")
	}
	if item.Status != "pending" || item.IdempotencyKey != "skdm-1" {
		t.Fatalf("unexpected SKDM outbox item: %+v", item)
	}
	if repo.skdmOutbox.IdempotencyKey != "skdm-1" {
		t.Fatalf("expected repo to receive SKDM envelope, got %+v", repo.skdmOutbox)
	}
}

func TestEnqueueGroupSkdmOutboxRejectsRawSenderKeyMaterial(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"alice": {ActorDID: "alice", Role: domain.GroupRoleOwner},
		"bob":   {ActorDID: "bob", Role: domain.GroupRoleMember},
	})
	service := NewService(repo)
	raw, err := proto.Marshal(&chat.SenderKeyDistributionMessage{
		GroupUlid:   "group-1",
		SenderDid:   "alice",
		SenderKeyId: 7,
		ChainKey:    []byte("raw-chain-key"),
	})
	if err != nil {
		t.Fatalf("marshal raw SKDM: %v", err)
	}

	_, _, err = service.EnqueueGroupSkdmOutbox(domain.GroupSkdmEnvelope{
		GroupID:                    "group-1",
		MembershipEpoch:            1,
		SenderDID:                  "alice",
		SenderKeyID:                7,
		RecipientDID:               "bob",
		RecipientDeviceID:          "bob-device-1",
		RecipientHomeStationPeerID: "station-b",
		EncryptedPayload:           raw,
		IdempotencyKey:             "skdm-raw",
	})
	if err != ErrInvalidSkdmEnvelope {
		t.Fatalf("expected raw Sender Key material to be rejected, got %v", err)
	}
	if repo.skdmOutbox.IdempotencyKey != "" {
		t.Fatalf("raw SKDM reached repo persistence: %+v", repo.skdmOutbox)
	}
}

func TestEnqueueGroupSkdmOutboxValidatesEpochAndRecipientHome(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"alice": {ActorDID: "alice", Role: domain.GroupRoleOwner},
		"bob": {
			ActorDID: "bob",
			Role:     domain.GroupRoleMember,
			Actor: domain.FederatedActorRef{
				ActorDID:          "bob",
				HomeStationPeerID: "station-b",
			},
		},
	})
	repo.group.MembershipEpoch = 2
	service := NewService(repo)
	envelope := domain.GroupSkdmEnvelope{
		GroupID:                    "group-1",
		MembershipEpoch:            1,
		SenderDID:                  "alice",
		SenderKeyID:                7,
		RecipientDID:               "bob",
		RecipientDeviceID:          "bob-device-1",
		RecipientHomeStationPeerID: "station-b",
		EncryptedPayload:           []byte("sealed-skdm-payload"),
		IdempotencyKey:             "skdm-stale",
	}
	if _, _, err := service.EnqueueGroupSkdmOutbox(envelope); err != ErrMembershipEpochStale {
		t.Fatalf("expected stale membership epoch, got %v", err)
	}

	envelope.MembershipEpoch = 2
	envelope.RecipientHomeStationPeerID = "station-c"
	if _, _, err := service.EnqueueGroupSkdmOutbox(envelope); err != ErrInvalidSkdmEnvelope {
		t.Fatalf("expected recipient home station mismatch to be rejected, got %v", err)
	}
}

func TestListMessagesByActorRequiresMembership(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner": {ActorDID: "owner", Role: domain.GroupRoleOwner},
	})
	service := NewService(repo)

	if _, err := service.ListMessagesByActor("stranger", "group-1", "", 10); err != ErrNotMember {
		t.Fatalf("expected non-member message read to be denied, got %v", err)
	}
}

func TestTransferOwnershipByActorOwnerTransfersToMember(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner":  {ActorDID: "owner", Role: domain.GroupRoleOwner},
		"member": {ActorDID: "member", Role: domain.GroupRoleMember},
	})
	service := NewService(repo)

	group, err := service.TransferOwnershipByActor("owner", "group-1", "member")
	if err != nil {
		t.Fatalf("expected owner transfer to succeed: %v", err)
	}
	if group.OwnerDID != "member" {
		t.Fatalf("expected new owner member, got %s", group.OwnerDID)
	}
	if repo.members["owner"].Role != domain.GroupRoleAdmin {
		t.Fatalf("expected old owner to become admin, got %d", repo.members["owner"].Role)
	}
	if repo.members["member"].Role != domain.GroupRoleOwner {
		t.Fatalf("expected member to become owner, got %d", repo.members["member"].Role)
	}
}

func TestTransferOwnershipByActorRejectsAdmin(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner":  {ActorDID: "owner", Role: domain.GroupRoleOwner},
		"admin":  {ActorDID: "admin", Role: domain.GroupRoleAdmin},
		"member": {ActorDID: "member", Role: domain.GroupRoleMember},
	})
	service := NewService(repo)

	if _, err := service.TransferOwnershipByActor("admin", "group-1", "member"); err != ErrPermissionDenied {
		t.Fatalf("expected admin transfer to be denied, got %v", err)
	}
}

func TestDissolveGroupByActorRequiresOwner(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner": {ActorDID: "owner", Role: domain.GroupRoleOwner},
		"admin": {ActorDID: "admin", Role: domain.GroupRoleAdmin},
	})
	service := NewService(repo)

	if err := service.DissolveGroupByActor("admin", "group-1"); err != ErrPermissionDenied {
		t.Fatalf("expected admin dissolve to be denied, got %v", err)
	}
	if err := service.DissolveGroupByActor("owner", "group-1"); err != nil {
		t.Fatalf("expected owner dissolve to succeed, got %v", err)
	}
	if !repo.dissolved {
		t.Fatal("expected repo group to be dissolved")
	}
}

func TestDissolvedGroupRejectsWrites(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner":  {ActorDID: "owner", Role: domain.GroupRoleOwner},
		"admin":  {ActorDID: "admin", Role: domain.GroupRoleAdmin},
		"member": {ActorDID: "member", Role: domain.GroupRoleMember},
	})
	repo.group.Status = domain.GroupStatusDissolved
	repo.invitations["invite-1"] = domain.Invitation{
		ID:         "invite-1",
		GroupID:    "group-1",
		InviteeDID: "invitee",
		Status:     1,
		ExpireAt:   time.Now().Add(time.Hour),
	}
	service := NewService(repo)

	if _, err := service.SendMessageByActor("owner", "group-1", 1, "", "", "", nil, []byte("ciphertext"), 1); err != ErrGroupDissolved {
		t.Fatalf("expected dissolved send to be denied, got %v", err)
	}
	if _, err := service.InviteByActor("owner", "group-1", []string{"invitee"}); err != ErrGroupDissolved {
		t.Fatalf("expected dissolved invite to be denied, got %v", err)
	}
	if _, err := service.JoinByActor("invitee", "group-1", "invite-1"); err != ErrGroupDissolved {
		t.Fatalf("expected dissolved join to be denied, got %v", err)
	}
	if got := repo.invitations["invite-1"].Status; got != 1 {
		t.Fatalf("expected dissolved join not to consume invitation, got status %d", got)
	}
	name := "next"
	if _, err := service.UpdateGroupByActor("owner", "group-1", &name, nil, nil); err != ErrGroupDissolved {
		t.Fatalf("expected dissolved update to be denied, got %v", err)
	}
	if err := service.LeaveByActor("member", "group-1"); err != ErrGroupDissolved {
		t.Fatalf("expected dissolved leave to be denied, got %v", err)
	}
	if _, err := service.TransferOwnershipByActor("owner", "group-1", "member"); err != ErrGroupDissolved {
		t.Fatalf("expected dissolved transfer to be denied, got %v", err)
	}
	if err := service.RemoveMemberByActor("owner", "group-1", "member"); err != ErrGroupDissolved {
		t.Fatalf("expected dissolved remove to be denied, got %v", err)
	}
	muted := true
	if _, err := service.UpdateMemberByActor("owner", "group-1", "member", nil, &muted, nil); err != ErrGroupDissolved {
		t.Fatalf("expected dissolved member update to be denied, got %v", err)
	}
	if _, err := service.RecallMessageByActor("owner", "group-1", "message-1"); err != ErrGroupDissolved {
		t.Fatalf("expected dissolved recall to be denied, got %v", err)
	}
	if _, err := service.EditMessageByActor("owner", "group-1", "message-1", "new", nil); err != ErrGroupDissolved {
		t.Fatalf("expected dissolved edit to be denied, got %v", err)
	}
	if _, err := service.DeleteMessageByActor("owner", "group-1", "message-1"); err != ErrGroupDissolved {
		t.Fatalf("expected dissolved delete to be denied, got %v", err)
	}
}

type fakeRepo struct {
	members          map[string]domain.Member
	invitations      map[string]domain.Invitation
	group            domain.Group
	dissolved        bool
	acceptedProposal domain.GroupProposal
	proposalOutbox   domain.GroupProposal
	skdmOutbox       domain.GroupSkdmEnvelope
	authorityEvents  []domain.GroupEvent
}

func newFakeRepo(members map[string]domain.Member) *fakeRepo {
	for actorDID, member := range members {
		member.GroupID = "group-1"
		member.ActorDID = actorDID
		members[actorDID] = member
	}
	return &fakeRepo{
		members:     members,
		invitations: make(map[string]domain.Invitation),
		group: domain.Group{
			ID:              "group-1",
			Status:          domain.GroupStatusActive,
			MembershipEpoch: 1,
		},
	}
}

func (r *fakeRepo) CreateGroup(ownerDID, name, description string) domain.Group {
	return domain.Group{}
}

func (r *fakeRepo) ListGroups(actorDID string) []domain.Group {
	return nil
}

func (r *fakeRepo) SendMessage(groupID, senderDID string, messageType int32, content, replyToID, threadRootID string, attachments []domain.Attachment, encryptedPayload []byte) domain.Message {
	return domain.Message{}
}

func (r *fakeRepo) ListMessages(groupID, beforeUlid string, limit int) ([]domain.Message, error) {
	return nil, nil
}

func (r *fakeRepo) ListThreadMessages(groupID, rootUlid, afterUlid string, limit int) ([]domain.Message, error) {
	return nil, nil
}

func (r *fakeRepo) ThreadCounts(groupID, actorDID string, rootULIDs []string) ([]domain.ThreadCount, error) {
	return nil, nil
}

func (r *fakeRepo) MarkThreadRead(actorDID, groupID, rootULID, lastReadULID string) error {
	return nil
}

func (r *fakeRepo) UnreadCount(actorDID, groupID string) int64 {
	return 0
}

func (r *fakeRepo) MarkRead(actorDID, groupID string) (int64, int64) {
	return 0, 0
}

func (r *fakeRepo) GetGroup(groupID string) (*domain.Group, bool) {
	if r.group.ID != groupID {
		return nil, false
	}
	next := r.group
	return &next, true
}

func (r *fakeRepo) GetMember(groupID, actorDID string) (*domain.Member, bool) {
	member, ok := r.members[actorDID]
	if !ok {
		return nil, false
	}
	return &member, true
}

func (r *fakeRepo) AddMember(groupID, actorDID, inviterDID string) (*domain.Member, bool) {
	member := domain.Member{
		GroupID:   groupID,
		ActorDID:  actorDID,
		Role:      domain.GroupRoleMember,
		InvitedBy: inviterDID,
		JoinedAt:  time.Now(),
	}
	r.members[actorDID] = member
	r.group.MembershipEpoch++
	return &member, true
}

func (r *fakeRepo) UpdateMember(groupID, actorDID string, role *int32, muted *bool, mutedUntil *time.Time) (*domain.Member, bool) {
	member, ok := r.members[actorDID]
	if !ok {
		return nil, false
	}
	if role != nil {
		member.Role = *role
	}
	if muted != nil {
		member.Muted = *muted
	}
	if mutedUntil != nil {
		member.MutedUntil = *mutedUntil
	}
	r.members[actorDID] = member
	return &member, true
}

func (r *fakeRepo) RemoveMember(groupID, actorDID string) bool {
	if _, ok := r.members[actorDID]; !ok {
		return false
	}
	delete(r.members, actorDID)
	r.group.MembershipEpoch++
	return true
}

func (r *fakeRepo) TransferOwnership(groupID, currentOwnerDID, nextOwnerDID string) (*domain.Group, bool) {
	currentOwner, ok := r.members[currentOwnerDID]
	if !ok || currentOwner.Role != domain.GroupRoleOwner {
		return nil, false
	}
	nextOwner, ok := r.members[nextOwnerDID]
	if !ok || nextOwner.Role == domain.GroupRoleOwner {
		return nil, false
	}
	currentOwner.Role = domain.GroupRoleAdmin
	nextOwner.Role = domain.GroupRoleOwner
	nextOwner.Muted = false
	nextOwner.MutedUntil = time.Time{}
	r.members[currentOwnerDID] = currentOwner
	r.members[nextOwnerDID] = nextOwner
	return &domain.Group{ID: groupID, OwnerDID: nextOwnerDID}, true
}

func (r *fakeRepo) DissolveGroup(groupID string) bool {
	if r.group.ID != groupID {
		return false
	}
	r.group.Status = domain.GroupStatusDissolved
	r.group.DissolvedAt = time.Now()
	r.dissolved = true
	return true
}

func (r *fakeRepo) AcceptProposal(proposal domain.GroupProposal) (domain.GroupEvent, bool, error) {
	r.acceptedProposal = proposal
	return domain.GroupEvent{
		EventULID:       "event-1",
		GroupID:         proposal.GroupID,
		Seq:             1,
		EventType:       "group.proposal.accepted",
		Actor:           proposal.Actor,
		MembershipEpoch: proposal.ObservedMembershipEpoch,
		ProposalULID:    proposal.ProposalULID,
		IdempotencyKey:  proposal.IdempotencyKey,
		EventPayload:    []byte("proposal"),
		CreatedAt:       time.Now(),
	}, false, nil
}

func (r *fakeRepo) EnqueueProposalOutbox(proposal domain.GroupProposal) (domain.GroupProposalOutboxItem, bool, error) {
	r.proposalOutbox = proposal
	return domain.GroupProposalOutboxItem{
		ProposalULID:            proposal.ProposalULID,
		GroupID:                 proposal.GroupID,
		Actor:                   proposal.Actor,
		Command:                 proposal.Command,
		AuthorityStationPeerID:  proposal.AuthorityStationPeerID,
		AuthorityEpoch:          proposal.AuthorityEpoch,
		ObservedMembershipEpoch: proposal.ObservedMembershipEpoch,
		IdempotencyKey:          proposal.IdempotencyKey,
		Status:                  "pending",
		CreatedAt:               time.Now(),
		UpdatedAt:               time.Now(),
	}, false, nil
}

func (r *fakeRepo) EnqueueGroupSkdmOutbox(envelope domain.GroupSkdmEnvelope) (domain.GroupSkdmEnvelope, bool, error) {
	r.skdmOutbox = envelope
	envelope.OutboxULID = "gcskdm-1"
	envelope.Status = "pending"
	envelope.CreatedAt = time.Now()
	envelope.UpdatedAt = envelope.CreatedAt
	return envelope, false, nil
}

func (r *fakeRepo) ApplyFederationEvent(event domain.GroupEvent) (domain.FollowerProjection, error) {
	return domain.FollowerProjection{
		GroupID:                event.GroupID,
		AuthorityStationPeerID: event.AuthorityStationPeerID,
		AuthorityEpoch:         event.AuthorityEpoch,
		LastSeq:                event.Seq,
		LastEventHash:          event.EventHash,
		Status:                 "active",
	}, nil
}

func (r *fakeRepo) ListAuthorityEventsAfter(groupID string, afterSeq int64, limit int) ([]domain.GroupEvent, error) {
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	events := make([]domain.GroupEvent, 0, limit)
	for _, event := range r.authorityEvents {
		if event.GroupID != groupID || event.Seq <= afterSeq {
			continue
		}
		events = append(events, event)
		if len(events) >= limit {
			break
		}
	}
	return events, nil
}

func (r *fakeRepo) UpdateGroup(groupID string, name, description *string, muted *bool) (*domain.Group, bool) {
	return &domain.Group{ID: groupID}, true
}

func (r *fakeRepo) ListMembers(groupID string, limit, offset int) ([]domain.Member, int) {
	return nil, 0
}

func (r *fakeRepo) CreateInvitation(groupID, inviterDID, inviteeDID string) domain.Invitation {
	invitation := domain.Invitation{
		ID:         "invite-" + inviteeDID,
		GroupID:    groupID,
		InviterDID: inviterDID,
		InviteeDID: inviteeDID,
		Status:     1,
		ExpireAt:   time.Now().Add(time.Hour),
		CreatedAt:  time.Now(),
	}
	r.invitations[invitation.ID] = invitation
	return invitation
}

func (r *fakeRepo) AcceptInvitation(invitationID, actorDID string) (string, bool) {
	invitation, ok := r.invitations[invitationID]
	if !ok || invitation.InviteeDID != actorDID || invitation.Status != 1 {
		return "", false
	}
	if !invitation.ExpireAt.IsZero() && !invitation.ExpireAt.After(time.Now()) {
		invitation.Status = 4
		r.invitations[invitationID] = invitation
		return "", false
	}
	invitation.Status = 2
	r.invitations[invitationID] = invitation
	return invitation.GroupID, true
}

func (r *fakeRepo) RecallMessage(actorDID, groupID, messageULID string, recallWindow time.Duration) (domain.MutationOutcome, error) {
	return domain.MutationOutcome{}, nil
}

func (r *fakeRepo) EditMessage(actorDID, groupID, messageULID, newContent string, newCiphertext []byte, editWindow time.Duration) (domain.MutationOutcome, error) {
	return domain.MutationOutcome{}, nil
}

func (r *fakeRepo) DeleteMessage(actorDID, groupID, messageULID string) (domain.MutationOutcome, error) {
	return domain.MutationOutcome{}, nil
}

func (r *fakeRepo) SearchMessages(groupID, query string, limit int) ([]domain.Message, error) {
	return nil, nil
}

func (r *fakeRepo) UpdateNickname(groupID, actorDID, nickname string) (*domain.Member, bool) {
	return nil, false
}

func (r *fakeRepo) GetSettings(groupID, actorDID string) domain.GroupSetting {
	return domain.GroupSetting{}
}

func (r *fakeRepo) UpdateSettings(groupID, actorDID string, muted, pinned, showNickname, alertEnabled *bool, background *string, clearedAtUnixMs *int64) {
}

func (r *fakeRepo) GetOfflineMessages(actorDID string, limit int) []domain.OfflineMessage {
	return nil
}

func (r *fakeRepo) AckOffline(ulids []string) {
}

func (r *fakeRepo) Stats() (int32, int32, int64, int32) {
	return 0, 0, 0, 0
}
