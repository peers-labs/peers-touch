package application

import (
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/group_chat/domain"
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

func TestSendMessageByActorRequiresMembership(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"owner": {ActorDID: "owner", Role: domain.GroupRoleOwner},
	})
	service := NewService(repo)

	if _, err := service.SendMessageByActor("stranger", "group-1", 1, "", "", "", nil, []byte("ciphertext")); err != ErrNotMember {
		t.Fatalf("expected non-member send to be denied, got %v", err)
	}
}

func TestSendMessageByActorRejectsMutedMember(t *testing.T) {
	repo := newFakeRepo(map[string]domain.Member{
		"member": {ActorDID: "member", Role: domain.GroupRoleMember, Muted: true},
	})
	service := NewService(repo)

	if _, err := service.SendMessageByActor("member", "group-1", 1, "", "", "", nil, []byte("ciphertext")); err != ErrMemberMuted {
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

	if _, err := service.SendMessageByActor("member", "group-1", 1, "", "", "", nil, []byte("ciphertext")); err != nil {
		t.Fatalf("expected expired mute send to succeed, got %v", err)
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

type fakeRepo struct {
	members   map[string]domain.Member
	dissolved bool
}

func newFakeRepo(members map[string]domain.Member) *fakeRepo {
	for actorDID, member := range members {
		member.GroupID = "group-1"
		member.ActorDID = actorDID
		members[actorDID] = member
	}
	return &fakeRepo{members: members}
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
	return &domain.Group{ID: groupID}, true
}

func (r *fakeRepo) GetMember(groupID, actorDID string) (*domain.Member, bool) {
	member, ok := r.members[actorDID]
	if !ok {
		return nil, false
	}
	return &member, true
}

func (r *fakeRepo) AddMember(groupID, actorDID, inviterDID string) (*domain.Member, bool) {
	return nil, false
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
	r.dissolved = true
	return true
}

func (r *fakeRepo) UpdateGroup(groupID string, name, description *string, muted *bool) (*domain.Group, bool) {
	return &domain.Group{ID: groupID}, true
}

func (r *fakeRepo) ListMembers(groupID string, limit, offset int) ([]domain.Member, int) {
	return nil, 0
}

func (r *fakeRepo) CreateInvitation(groupID, inviterDID, inviteeDID string) domain.Invitation {
	return domain.Invitation{}
}

func (r *fakeRepo) AcceptInvitation(invitationID, actorDID string) (string, bool) {
	return "", false
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
