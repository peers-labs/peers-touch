package infrastructure

import (
	"context"
	"testing"

	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

func TestCircleRepoPostgresRemoveMembersReconcilesMemberCount(t *testing.T) {
	database, _ := openPrivateContentStorePostgres(t)
	if err := database.AutoMigrate(
		&dbmodel.Actor{},
		&dbmodel.SocialCircle{},
		&dbmodel.SocialCircleMember{},
	); err != nil {
		t.Fatal(err)
	}

	owner := dbmodel.Actor{
		ID:                7001,
		PTID:              "ptid:circle-owner",
		Namespace:         "peers",
		PreferredUsername: "circle-owner",
		Email:             "circle-owner@example.test",
		PasswordHash:      "test-only",
		FederatedHandle:   "@circle-owner@example.test",
	}
	circle := dbmodel.SocialCircle{
		ID:          7002,
		OwnerID:     owner.ID,
		Name:        "Friends",
		MemberCount: 9,
	}
	member := dbmodel.SocialCircleMember{
		CircleID:  circle.ID,
		ActorPtid: "ptid:member",
	}
	if err := database.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&circle).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&member).Error; err != nil {
		t.Fatal(err)
	}

	repository := NewCircleRepository(database)
	removed, total, err := repository.RemoveMembers(
		context.Background(),
		circle.ID,
		[]string{member.ActorPtid},
	)
	if err != nil {
		t.Fatalf("remove PostgreSQL circle member: %v", err)
	}
	if removed != 1 || total != 0 {
		t.Fatalf("removed/total = %d/%d, want 1/0", removed, total)
	}

	var stored dbmodel.SocialCircle
	if err := database.First(&stored, circle.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.MemberCount != total {
		t.Fatalf(
			"stored member_count = %d, want authoritative total %d",
			stored.MemberCount,
			total,
		)
	}
}
