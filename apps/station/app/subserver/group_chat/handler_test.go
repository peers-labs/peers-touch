package group_chat

import (
	"context"
	"slices"
	"testing"

	application_group_chat "github.com/peers-labs/peers-touch/station/app/subserver/group_chat/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/group_chat/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
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

func TestHandleDissolveGroupRemovesState(t *testing.T) {
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
	if _, ok := sub.service.GetGroup(group.ID); ok {
		t.Fatal("expected group to be removed")
	}
	if _, ok := sub.service.GetMember(group.ID, "member"); ok {
		t.Fatal("expected members to be removed")
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

func newTestSubServer() *subServer {
	svc := newTestService()
	return &subServer{
		service:    svc,
		appService: application_group_chat.NewService(svc),
	}
}

func subjectContext(actorDID string) context.Context {
	return auth.WithSubject(context.Background(), &auth.Subject{ID: actorDID})
}
