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

	if err := skills.ToggleSkill(ctx, "assistant", created.SkillID, true); err != nil {
		t.Fatalf("bind skill: %v", err)
	}
	assertSkillBindingState(t, db, created.SkillID, true, 1)
	assertSkillCapabilityVersion(
		t, db, created.SkillID, 1,
		model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE, false,
	)
	if err := skills.ToggleSkill(ctx, "assistant", created.SkillID, false); err != nil {
		t.Fatalf("disable Skill binding: %v", err)
	}
	assertSkillBindingState(t, db, created.SkillID, false, 2)
	assertSkillCapabilityVersion(
		t, db, created.SkillID, 1,
		model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE, false,
	)

	if err := skills.DeleteSkillByID(ctx, "assistant", created.SkillID); err != nil {
		t.Fatalf("delete skill: %v", err)
	}
	assertSkillCapabilityVersion(
		t, db, created.SkillID, 1,
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

	replacement := "Updated content that must roll back."
	if _, _, err := skills.UpdateSkill(
		ctx,
		"assistant",
		created.SkillID,
		nil,
		nil,
		&replacement,
	); err == nil {
		t.Fatal("Skill content update unexpectedly committed through manifest conflict")
	}
	var skill persistence.Skill
	if err := db.Where("id = ?", created.SkillID).First(&skill).Error; err != nil {
		t.Fatalf("reload skill: %v", err)
	}
	if skill.Version != 1 || skill.Content != "Keep capability authority consistent." {
		t.Fatalf("Skill mutation escaped rollback: version=%d content=%q", skill.Version, skill.Content)
	}
	assertSkillCapabilityVersion(
		t, db, created.SkillID, 1,
		model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE, false,
	)
}

func TestSkillPromptUsesOnlyPinnedBindingAndExactBodyVersion(t *testing.T) {
	db, skills, _ := newSkillCapabilityTestServices(t)
	ctx := context.Background()
	bound, _, err := skills.CreateSkill(
		ctx,
		"assistant",
		"Bound Skill",
		"Bound description",
		"Version one body.",
		domain.TrustLevelCommunity,
	)
	if err != nil {
		t.Fatalf("create bound Skill: %v", err)
	}
	if _, _, err := skills.CreateSkill(
		ctx,
		"assistant",
		"Unbound Skill",
		"Must not enter the index",
		"Unbound body.",
		domain.TrustLevelCommunity,
	); err != nil {
		t.Fatalf("create unbound Skill: %v", err)
	}
	var row persistence.Skill
	if err := db.First(&row, "id = ?", bound.SkillID).Error; err != nil {
		t.Fatalf("read bound Skill: %v", err)
	}
	manifest := capabilitySkillManifestSeed(row).manifest
	capability := AuthorizedCapability{
		Manifest: manifest,
		Binding: &model.AgentCapabilityBinding{
			BindingId:         "skill-binding",
			AgentId:           "assistant",
			CapabilityId:      manifest.GetCapabilityId(),
			CapabilityVersion: manifest.GetVersion(),
			Enabled:           true,
			Revision:          1,
			ApprovalPolicy:    model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO,
		},
	}
	authorized := &AuthorizedCapabilitySet{
		byCapability: map[string]AuthorizedCapability{
			authorizedCapabilityKey(manifest.GetCapabilityId(), manifest.GetVersion()): capability,
		},
		bySource: map[string]AuthorizedCapability{
			authorizedSourceKey(manifest.GetSourceKind(), manifest.GetSourceInstanceId()): capability,
		},
	}
	toolNames := authorized.ToolNames()
	if len(toolNames) != 1 || toolNames[0] != "skill_view" {
		t.Fatalf("authorized Skill tools = %v, want [skill_view]", toolNames)
	}
	resolved, ok := authorized.ResolveToolCall(
		"skill_view",
		`{"name":"Bound Skill"}`,
	)
	if !ok || resolved.Binding.GetBindingId() != "skill-binding" {
		t.Fatalf("skill_view did not resolve the pinned Skill binding: %+v", resolved)
	}
	if _, ok := authorized.ResolveToolCall(
		"skill_view",
		`{"name":"Unbound Skill"}`,
	); ok {
		t.Fatal("skill_view resolved an unbound Skill")
	}
	refs := authorized.ToolSchemaSourceRefs("skill_view")
	expectedRef := "capability:" + manifest.GetCapabilityId() + "@" + manifest.GetVersion()
	if len(refs) != 1 || refs[0] != expectedRef {
		t.Fatalf("skill_view schema refs = %v, want [%s]", refs, expectedRef)
	}
	index, count, err := skills.BuildAuthorizedSkillIndex(
		ctx,
		"assistant",
		toolNames,
		authorized,
	)
	if err != nil {
		t.Fatalf("build pinned Skill index: %v", err)
	}
	if count != 1 ||
		!strings.Contains(index, "Bound Skill") ||
		strings.Contains(index, "Unbound Skill") {
		t.Fatalf("Skill index escaped binding authority: count=%d index=%q", count, index)
	}

	versionTwo := "Version two body."
	if _, _, err := skills.UpdateSkill(
		ctx,
		"assistant",
		bound.SkillID,
		nil,
		nil,
		&versionTwo,
	); err != nil {
		t.Fatalf("update bound Skill content: %v", err)
	}
	registry := NewToolRegistryService(nil, skills)
	result := registry.Dispatch(
		ctx,
		&domain.ToolCallMeta{
			AgentID: "assistant",
			AuthorizedSkills: map[string]domain.AuthorizedSkillRef{
				"Bound Skill": {
					SkillID: bound.SkillID,
					Version: 1,
				},
			},
		},
		"skill_view",
		`{"name":"Bound Skill"}`,
	)
	if result.IsError ||
		!strings.Contains(result.Content, "Version one body.") ||
		strings.Contains(result.Content, versionTwo) {
		t.Fatalf("skill_view did not load the pinned body version: %+v", result)
	}
	denied := registry.Dispatch(
		ctx,
		&domain.ToolCallMeta{
			AgentID:          "assistant",
			AuthorizedSkills: map[string]domain.AuthorizedSkillRef{},
		},
		"skill_view",
		`{"name":"Bound Skill"}`,
	)
	if !denied.IsError {
		t.Fatalf("skill_view loaded an unbound Skill: %+v", denied)
	}
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
		&persistence.Agent{},
		&persistence.Skill{},
		&persistence.SkillVersion{},
		&persistence.SkillResource{},
		&persistence.ImmutableContentBlob{},
		&persistence.CapabilityManifest{},
		&persistence.AgentCapabilityBinding{},
		&persistence.CapabilityBindingCommand{},
	); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	if err := db.Create(&persistence.Agent{
		ID:             "assistant",
		Name:           "Assistant",
		ThinkingMode:   string(domain.ThinkingModeAuto),
		Visibility:     string(domain.AgentVisibilityPrivate),
		OwnerActorPTID: "ptid:person:test",
		Version:        1,
	}).Error; err != nil {
		t.Fatalf("seed Agent: %v", err)
	}
	authority := NewCapabilityAuthorityService(db)
	skills := NewSkillService(NewSkillsGuardService(), nil)
	skills.SetCapabilityAuthority(authority)
	return db, skills, authority
}

func assertSkillBindingState(
	t *testing.T,
	db *gorm.DB,
	skillID string,
	enabled bool,
	revision uint64,
) {
	t.Helper()
	var binding persistence.AgentCapabilityBinding
	if err := db.Where(
		"agent_id = ? AND capability_id = ? AND capability_version = ? AND tombstoned_at IS NULL",
		"assistant",
		"skill:"+skillID,
		"1",
	).First(&binding).Error; err != nil {
		t.Fatalf("load Skill binding: %v", err)
	}
	if binding.Enabled != enabled || binding.Revision != revision {
		t.Fatalf("Skill binding = %+v, want enabled=%v revision=%d", binding, enabled, revision)
	}
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
