package group_chat

import (
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/group_chat/domain"
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
	if err := db.AutoMigrate(&groupModel{}, &memberModel{}, &outboxModel{}); err != nil {
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

func TestDissolveGroupRemovesGroupState(t *testing.T) {
	svc := newTestService()
	group := svc.CreateGroup("owner", "Engineering", "")
	svc.SendMessage(group.ID, "owner", 1, "", "", "", nil, []byte("ciphertext"))

	if !svc.DissolveGroup(group.ID) {
		t.Fatal("expected dissolve group to succeed")
	}
	if _, ok := svc.GetGroup(group.ID); ok {
		t.Fatal("expected group to be removed")
	}
	if _, ok := svc.GetMember(group.ID, "owner"); ok {
		t.Fatal("expected members to be removed")
	}
	if messages, err := svc.ListMessages(group.ID, "", 10); err != nil || len(messages) != 0 {
		t.Fatalf("expected messages to be removed, got len=%d err=%v", len(messages), err)
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
	}
}
