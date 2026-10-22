package service

import (
	"context"
	"strconv"
	"strings"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestSkillLifecycleOwnsCapabilityManifestLifecycle(t *testing.T) {
	db, skills, _ := newSkillCapabilityTestServices(t)
	ctx := context.Background()

	created, _, err := skills.CreateSkill(
		ctx,
		"assistant",
		"Acceptance Skill",
		"Exercises manifest lifecycle",
		"Preserve the user's request.",
		domain.TrustLevelCommunity,
	)
	if err != nil {
		t.Fatalf("create skill: %v", err)
	}
	assertSkillCapabilityVersion(
		t, db, created.SkillID, 1,
		model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE, false,
	)

	if err := skills.ToggleSkill(ctx, "assistant", created.SkillID, false); err != nil {
		t.Fatalf("disable skill: %v", err)
	}
	assertSkillCapabilityVersion(
		t, db, created.SkillID, 1,
		model.CapabilityAvailability_CAPABILITY_AVAILABILITY_BLOCKED, true,
	)
	assertSkillCapabilityVersion(
		t, db, created.SkillID, 2,
		model.CapabilityAvailability_CAPABILITY_AVAILABILITY_BLOCKED, false,
	)
	if err := skills.ToggleSkill(ctx, "assistant", created.SkillID, true); err != nil {
		t.Fatalf("re-enable skill: %v", err)
	}
	assertSkillCapabilityVersion(
		t, db, created.SkillID, 2,
		model.CapabilityAvailability_CAPABILITY_AVAILABILITY_BLOCKED, true,
	)
	assertSkillCapabilityVersion(
		t, db, created.SkillID, 3,
		model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE, false,
	)

	if err := skills.DeleteSkillByID(ctx, "assistant", created.SkillID); err != nil {
		t.Fatalf("delete skill: %v", err)
	}
	assertSkillCapabilityVersion(
		t, db, created.SkillID, 3,
		model.CapabilityAvailability_CAPABILITY_AVAILABILITY_BLOCKED, true,
	)
	var skillCount int64
	if err := db.Model(&persistence.Skill{}).
		Where("id = ?", created.SkillID).
		Count(&skillCount).Error; err != nil {
		t.Fatalf("count skills: %v", err)
	}
	if skillCount != 0 {
		t.Fatalf("deleted skill remains: count=%d", skillCount)
	}
}

func TestSkillCapabilityConflictRollsBackSkillMutation(t *testing.T) {
	db, skills, authority := newSkillCapabilityTestServices(t)
	ctx := context.Background()
	created, _, err := skills.CreateSkill(
		ctx,
		"assistant",
		"Atomic Skill",
		"Proves atomic mutation",
		"Keep capability authority consistent.",
		domain.TrustLevelCommunity,
	)
	if err != nil {
		t.Fatalf("create skill: %v", err)
	}
	manifests, err := authority.ListManifests(ctx, "ptid:person:test", nil)
	if err != nil || len(manifests) != 1 {
		t.Fatalf("list manifests: count=%d err=%v", len(manifests), err)
	}
	conflict := proto.Clone(manifests[0]).(*model.CapabilityManifest)
	conflict.Version = "2"
	conflict.DisplayMetadata.Name = "Conflicting immutable version"
	if _, err := authority.RegisterManifest(ctx, conflict); err != nil {
		t.Fatalf("seed manifest conflict: %v", err)
	}

	if err := skills.ToggleSkill(ctx, "assistant", created.SkillID, false); err == nil {
		t.Fatal("toggle unexpectedly committed through manifest conflict")
	}
	var skill persistence.Skill
	if err := db.Where("id = ?", created.SkillID).First(&skill).Error; err != nil {
		t.Fatalf("reload skill: %v", err)
	}
	if skill.Version != 1 || !skill.Enabled {
		t.Fatalf("skill mutation escaped rollback: version=%d enabled=%v", skill.Version, skill.Enabled)
	}
	assertSkillCapabilityVersion(
		t, db, created.SkillID, 1,
		model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE, false,
	)
}

func newSkillCapabilityTestServices(
	t *testing.T,
) (*gorm.DB, *SkillService, *CapabilityAuthorityService) {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(
		&persistence.Skill{},
		&persistence.SkillVersion{},
		&persistence.CapabilityManifest{},
	); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	authority := NewCapabilityAuthorityService(db)
	skills := NewSkillService(NewSkillsGuardService(), nil)
	skills.SetCapabilityAuthority(authority)
	return db, skills, authority
}

func assertSkillCapabilityVersion(
	t *testing.T,
	db *gorm.DB,
	skillID string,
	version int,
	availability model.CapabilityAvailability,
	retired bool,
) {
	t.Helper()
	var manifest persistence.CapabilityManifest
	if err := db.Where(
		"capability_id = ? AND version = ?",
		"skill:"+skillID,
		strconv.Itoa(version),
	).First(&manifest).Error; err != nil {
		t.Fatalf("load capability version %d: %v", version, err)
	}
	if manifest.Availability != int32(availability) {
		t.Fatalf(
			"version %d availability=%d want=%d",
			version, manifest.Availability, availability,
		)
	}
	if (manifest.RetiredAt != nil) != retired {
		t.Fatalf(
			"version %d retired=%v want=%v",
			version, manifest.RetiredAt != nil, retired,
		)
	}
}
