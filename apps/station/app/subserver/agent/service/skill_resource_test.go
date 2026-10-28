package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

func TestSkillVersionedResourcesUseImmutableBlobsAndPinnedReads(t *testing.T) {
	_, skills, _ := newSkillCapabilityTestServices(t)
	ctx := context.Background()

	created, _, err := skills.CreateSkill(
		ctx,
		"assistant",
		"Resource Skill",
		"Resources version one",
		"# Skill",
		domain.TrustLevelCommunity,
		&model.SkillResourceInput{
			Path:           "references/api.md",
			Content:        []byte("# API reference"),
			Kind:           model.SkillResourceKind_SKILL_RESOURCE_KIND_REFERENCE,
			ExecutionOwner: model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION,
		},
	)
	if err != nil {
		t.Fatalf("create skill with resource: %v", err)
	}
	resources, err := skills.ListSkillResources(ctx, "assistant", created.SkillID, created.Version)
	if err != nil {
		t.Fatalf("list resources: %v", err)
	}
	if len(resources) != 1 || resources[0].GetPath() != "references/api.md" {
		t.Fatalf("unexpected resources: %+v", resources)
	}
	resource, content, err := skills.ReadSkillResource(
		ctx, "assistant", created.SkillID, created.Version, "references/api.md",
	)
	if err != nil {
		t.Fatalf("read pinned resource: %v", err)
	}
	if string(content) != "# API reference" || resource.GetSize() != uint64(len(content)) {
		t.Fatalf("unexpected resource content: %+v %q", resource, content)
	}
	if _, _, err := skills.ReadSkillResource(
		ctx, "assistant", created.SkillID, created.Version, "../secret.md",
	); err == nil || !strings.Contains(err.Error(), "escapes") {
		t.Fatalf("expected traversal rejection, got %v", err)
	}

	versionTwoContent := "# Skill v2"
	if _, _, err := skills.UpdateSkill(
		ctx, "assistant", created.SkillID, nil, nil, &versionTwoContent,
	); err != nil {
		t.Fatalf("update skill content: %v", err)
	}
	v1, v1Content, err := skills.ReadSkillResource(
		ctx, "assistant", created.SkillID, 1, "references/api.md",
	)
	if err != nil {
		t.Fatalf("read immutable v1 resource after update: %v", err)
	}
	v2, _, err := skills.ReadSkillResource(
		ctx, "assistant", created.SkillID, 2, "references/api.md",
	)
	if err != nil {
		t.Fatalf("resource was not carried to v2: %v", err)
	}
	if v1.GetContentHash() != v2.GetContentHash() || string(v1Content) != "# API reference" {
		t.Fatalf("resource revision clone changed immutable content: v1=%+v v2=%+v", v1, v2)
	}

	registry := NewToolRegistryService(nil, skills)
	result := registry.Dispatch(ctx, &domain.ToolCallMeta{
		AgentID: "assistant",
		AuthorizedSkills: map[string]domain.AuthorizedSkillRef{
			"Resource Skill": {SkillID: created.SkillID, Version: 1},
		},
	}, "skill_resource_read", `{"skill_name":"Resource Skill","path":"references/api.md"}`)
	if result.IsError || !strings.Contains(result.Content, "# API reference") {
		t.Fatalf("authorized pinned resource tool failed: %+v", result)
	}
	denied := registry.Dispatch(ctx, &domain.ToolCallMeta{
		AgentID:          "assistant",
		AuthorizedSkills: map[string]domain.AuthorizedSkillRef{},
	}, "skill_resource_read", `{"skill_name":"Resource Skill","path":"references/api.md"}`)
	if !denied.IsError {
		t.Fatalf("unauthorized resource read succeeded: %+v", denied)
	}
}

func TestSkillClientOwnedResourcesAreNotStationReadable(t *testing.T) {
	db, skills, _ := newSkillCapabilityTestServices(t)
	ctx := context.Background()
	created, _, err := skills.CreateSkill(
		ctx,
		"assistant",
		"Client Resource Skill",
		"Client-owned script",
		"# Skill",
		domain.TrustLevelCommunity,
		&model.SkillResourceInput{
			Path:           "scripts/run.sh",
			Content:        []byte("#!/bin/sh\n"),
			Kind:           model.SkillResourceKind_SKILL_RESOURCE_KIND_SCRIPT,
			ExecutionOwner: model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY,
		},
	)
	if err != nil {
		t.Fatalf("create client-owned resource: %v", err)
	}
	if _, _, err := skills.ReadSkillResource(
		ctx, "assistant", created.SkillID, 1, "scripts/run.sh",
	); err == nil || !strings.Contains(err.Error(), "client-owned") {
		t.Fatalf("expected client-owned Station read rejection, got %v", err)
	}

	scriptHash := sha256HexBytes(t, []byte("#!/bin/sh\n"))
	var metadata persistence.SkillResource
	if err := db.Where(
		"skill_id = ? AND version = ? AND path = ?",
		created.SkillID, 1, "scripts/run.sh",
	).First(&metadata).Error; err != nil {
		t.Fatalf("client-owned resource metadata must be pinned: %v", err)
	}
	if metadata.ContentHash != scriptHash ||
		metadata.ExecutionOwner != model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY.String() {
		t.Fatalf("unexpected client-owned metadata row: %+v", metadata)
	}
	var blobCount int64
	if err := db.Model(&persistence.ImmutableContentBlob{}).
		Where("content_hash = ?", scriptHash).
		Count(&blobCount).Error; err != nil {
		t.Fatalf("count client-owned blobs: %v", err)
	}
	if blobCount != 0 {
		t.Fatalf("client-owned body entered immutable blob store: %d row(s)", blobCount)
	}
}

func TestSkillMixedPackageBlobsOnlyStationOwnedBodies(t *testing.T) {
	db, skills, _ := newSkillCapabilityTestServices(t)
	ctx := context.Background()
	created, _, err := skills.CreateSkill(
		ctx,
		"assistant",
		"Mixed Resource Skill",
		"Mixed owners",
		"# Skill",
		domain.TrustLevelCommunity,
		&model.SkillResourceInput{
			Path:           "references/api.md",
			Content:        []byte("# API reference"),
			Kind:           model.SkillResourceKind_SKILL_RESOURCE_KIND_REFERENCE,
			ExecutionOwner: model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION,
		},
		&model.SkillResourceInput{
			Path:           "scripts/run.sh",
			Content:        []byte("#!/bin/sh\n"),
			Kind:           model.SkillResourceKind_SKILL_RESOURCE_KIND_SCRIPT,
			ExecutionOwner: model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY,
		},
	)
	if err != nil {
		t.Fatalf("create mixed-owner package: %v", err)
	}
	stationHash := sha256HexBytes(t, []byte("# API reference"))
	clientHash := sha256HexBytes(t, []byte("#!/bin/sh\n"))

	var metadataCount int64
	if err := db.Model(&persistence.SkillResource{}).
		Where("skill_id = ? AND version = ?", created.SkillID, 1).
		Count(&metadataCount).Error; err != nil {
		t.Fatalf("count pinned metadata: %v", err)
	}
	if metadataCount != 2 {
		t.Fatalf("both resources must have metadata rows, got %d", metadataCount)
	}
	for _, tc := range []struct {
		name     string
		hash     string
		expected bool
	}{
		{name: "station body", hash: stationHash, expected: true},
		{name: "client body", hash: clientHash, expected: false},
	} {
		var count int64
		if err := db.Model(&persistence.ImmutableContentBlob{}).
			Where("content_hash = ?", tc.hash).
			Count(&count).Error; err != nil {
			t.Fatalf("count blob for %s: %v", tc.name, err)
		}
		if (count == 1) != tc.expected {
			t.Fatalf("%s blob presence = %v, want %v", tc.name, count == 1, tc.expected)
		}
	}
}

func sha256HexBytes(t *testing.T, content []byte) string {
	t.Helper()
	sum := sha256.Sum256(content)
	return hex.EncodeToString(sum[:])
}
