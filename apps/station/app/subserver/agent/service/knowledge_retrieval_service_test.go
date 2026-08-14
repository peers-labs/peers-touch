package service

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
)

func TestKnowledgeRetrievalChunksEmbedsAndRanksBoundResources(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "knowledge.md")
	if err := os.WriteFile(path, []byte("Agent memory: use postgres jsonb indexes for turn trace diagnostics."), 0o600); err != nil {
		t.Fatalf("write knowledge file: %v", err)
	}

	svc := NewKnowledgeRetrievalService(nil)
	result, err := svc.Retrieve(context.Background(), []domain.KnowledgeResource{{
		ResourceID: "kr_1",
		Type:       domain.KnowledgeResourceTypeDocument,
		Title:      "Trace diagnostics",
		Source:     path,
		Policy:     domain.KnowledgeResourcePolicyAlways,
	}}, "How should turn trace diagnostics use jsonb?")
	if err != nil {
		t.Fatalf("Retrieve returned error: %v", err)
	}
	if len(result.Chunks) != 1 {
		t.Fatalf("expected one retrieved chunk, got %d", len(result.Chunks))
	}
	if result.Chunks[0].ResourceID != "kr_1" {
		t.Fatalf("expected resource id kr_1, got %q", result.Chunks[0].ResourceID)
	}
	if result.Chunks[0].Score <= 0 {
		t.Fatalf("expected positive retrieval score, got %f", result.Chunks[0].Score)
	}
	if !strings.Contains(result.PromptBlock, "<knowledge_context>") {
		t.Fatalf("expected prompt block to include knowledge tag, got %q", result.PromptBlock)
	}
}

func TestKnowledgeRetrievalSkipsDisabledResources(t *testing.T) {
	svc := NewKnowledgeRetrievalService(nil)
	result, err := svc.Retrieve(context.Background(), []domain.KnowledgeResource{{
		ResourceID: "kr_disabled",
		Type:       domain.KnowledgeResourceTypeDocument,
		Title:      "Disabled",
		Source:     "disabled resource content",
		Policy:     domain.KnowledgeResourcePolicyDisabled,
	}}, "disabled")
	if err != nil {
		t.Fatalf("Retrieve returned error: %v", err)
	}
	if len(result.Chunks) != 0 || result.PromptBlock != "" {
		t.Fatalf("expected disabled resource to be skipped, got chunks=%d block=%q", len(result.Chunks), result.PromptBlock)
	}
}
