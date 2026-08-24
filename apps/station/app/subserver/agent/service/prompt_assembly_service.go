// prompt_assembly_service.go — Typed ContextLedger pipeline assembly.
// Refactored from string-concat layers to a processor pipeline that emits
// typed ContextSegments (MCA-D04), inspired by LobeHub's ContextEngine
// pipeline pattern but with Station-owned source attribution, content hashes,
// token estimates, and inclusion/truncation decisions.
package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

const memoryGuidance = `## Memory
You have a persistent memory tool. Use it to save important facts about the user,
their preferences, technical environment, and project conventions.
Guidelines:
- Save user preferences immediately when learned
- User profile facts → target='user', working notes → target='memory'
- Keep entries atomic — one fact per entry
- When at capacity, replace least important entries
- NEVER store secrets, API keys, passwords, or tokens`

const skillsGuidance = `## Skills (mandatory)
Before replying, scan the skills below. If one clearly matches your task,
load it with skill_view(name) and follow its instructions.
If a skill has issues, fix it with skill_manage(action='patch').`

const localMCPGuidance = `## Local MCP Tools
Use local_mcp only when a capability must run on the user's Desktop runtime.
Arguments: server_name, tool_name, arguments. The Desktop local executor returns
the tool result to this same turn before you continue.`

const localBuiltinGuidance = `## Desktop-local Builtin Tools
Use local_file_read, local_workspace_list, local_clipboard_read,
local_clipboard_write, and local_shell_safe only for user-approved Desktop local
operations. These tools execute in Desktop Rust through the local tool bridge;
Station remains the turn owner and waits for the result before continuing.`

// ContextSegment is one ordered piece of the assembled prompt with
// provenance, hash, token estimate, and inclusion decision.
type ContextSegment struct {
	Type            model.ContextSegmentType
	Content         string
	SourceRefs      []string
	ContentHash     string
	EstimatedTokens int
	Decision        model.ContextSegmentDecision
	DecisionReason  string
	// KnowledgeChunks is populated only for KNOWLEDGE segments to avoid
	// a second retrieval call in the assembler.
	KnowledgeChunks []domain.KnowledgeChunkReference
}

// PromptAssemblyResult contains the assembled system prompt plus the typed
// ContextLedger segments for persistence and audit.
type PromptAssemblyResult struct {
	SystemPrompt       string
	Segments           []ContextSegment
	MemorySnapshotHash string
	SkillIndexHash     string
	SkillCount         int
	InjectedTokens     int
	KnowledgeChunks    []domain.KnowledgeChunkReference
}

// promptBuildInput carries all data needed by segment processors.
type promptBuildInput struct {
	ctx               context.Context
	agentID           string
	identity          string
	agentConfigPrompt string
	availableTools    []string
	userInput         string
	knowledgeResources []domain.KnowledgeResource
	memoryDisabled    bool
}

// segmentProcessor produces zero or more context segments.
type segmentProcessor interface {
	process(input *promptBuildInput) ([]ContextSegment, error)
}

// identityProcessor emits L1 Identity.
type identityProcessor struct{}

func (identityProcessor) process(in *promptBuildInput) ([]ContextSegment, error) {
	if strings.TrimSpace(in.identity) == "" {
		return nil, nil
	}
	return []ContextSegment{{
		Type:            model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_IDENTITY,
		Content:         in.identity,
		ContentHash:     sha256Hex(in.identity),
		EstimatedTokens: estimateTokens(in.identity),
		Decision:        model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_INCLUDED,
	}}, nil
}

// guidanceProcessor emits L2 Behavioral Guidance based on available tools.
type guidanceProcessor struct{}

func (guidanceProcessor) process(in *promptBuildInput) ([]ContextSegment, error) {
	var parts []string
	var sourceRefs []string

	if hasToolAvailable(in.availableTools, "memory") {
		parts = append(parts, memoryGuidance)
		sourceRefs = append(sourceRefs, "guidance:memory")
	}
	if hasToolAvailable(in.availableTools, "skill_view") || hasToolAvailable(in.availableTools, "skill_manage") {
		parts = append(parts, skillsGuidance)
		sourceRefs = append(sourceRefs, "guidance:skills")
	}
	if hasToolAvailable(in.availableTools, "local_mcp") {
		parts = append(parts, localMCPGuidance)
		sourceRefs = append(sourceRefs, "guidance:local_mcp")
	}
	if hasAnyToolAvailable(in.availableTools,
		"local_file_read", "local_workspace_list",
		"local_clipboard_read", "local_clipboard_write", "local_shell_safe",
	) {
		parts = append(parts, localBuiltinGuidance)
		sourceRefs = append(sourceRefs, "guidance:local_builtin")
	}

	if len(parts) == 0 {
		return nil, nil
	}
	content := strings.Join(parts, "\n\n")
	return []ContextSegment{{
		Type:            model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_POLICY,
		Content:         content,
		SourceRefs:      sourceRefs,
		ContentHash:     sha256Hex(content),
		EstimatedTokens: estimateTokens(content),
		Decision:        model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_INCLUDED,
	}}, nil
}

// memoryProcessor emits L3 Memory Snapshot.
type memoryProcessor struct {
	memoryService *MemoryService
}

func (p memoryProcessor) process(in *promptBuildInput) ([]ContextSegment, error) {
	if in.memoryDisabled || p.memoryService == nil {
		return []ContextSegment{{
			Type:   model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_MEMORY,
			Decision: model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_REJECTED,
			DecisionReason: "memory_disabled",
		}}, nil
	}

	snapshot, err := p.memoryService.BuildRelevantSnapshot(in.ctx, in.agentID, in.userInput)
	if err != nil {
		return nil, fmt.Errorf("build memory snapshot: %w", err)
	}

	content := formatMemorySnapshot(snapshot)
	return []ContextSegment{{
		Type:            model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_MEMORY,
		Content:         content,
		SourceRefs:      []string{fmt.Sprintf("memory:agent=%s", in.agentID)},
		ContentHash:     sha256Hex(content),
		EstimatedTokens: estimateTokens(content),
		Decision:        model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_INCLUDED,
	}}, nil
}

// skillsProcessor emits L4 Skills Index.
type skillsProcessor struct {
	skillService *SkillService
}

func (p skillsProcessor) process(in *promptBuildInput) ([]ContextSegment, error) {
	if p.skillService == nil {
		return nil, nil
	}

	skillIndex, skillCount, err := p.skillService.BuildSkillIndex(in.ctx, in.agentID, in.availableTools)
	if err != nil {
		return nil, fmt.Errorf("build skill index: %w", err)
	}

	if skillIndex == "" {
		return []ContextSegment{{
			Type:           model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_SKILL_INDEX,
			Decision:       model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_REJECTED,
			DecisionReason: "no_skills_available",
		}}, nil
	}

	return []ContextSegment{{
		Type:            model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_SKILL_INDEX,
		Content:         skillIndex,
		SourceRefs:      []string{fmt.Sprintf("skills:agent=%s:count=%d", in.agentID, skillCount)},
		ContentHash:     sha256Hex(skillIndex),
		EstimatedTokens: estimateTokens(skillIndex),
		Decision:        model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_INCLUDED,
	}}, nil
}

// configPromptProcessor emits L5 Agent Config Prompt.
type configPromptProcessor struct{}

func (configPromptProcessor) process(in *promptBuildInput) ([]ContextSegment, error) {
	if strings.TrimSpace(in.agentConfigPrompt) == "" {
		return nil, nil
	}
	return []ContextSegment{{
		Type:            model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_MODEL_FACTS,
		Content:         in.agentConfigPrompt,
		ContentHash:     sha256Hex(in.agentConfigPrompt),
		EstimatedTokens: estimateTokens(in.agentConfigPrompt),
		Decision:        model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_INCLUDED,
	}}, nil
}

// knowledgeProcessor emits L6 Agent Knowledge Resources.
type knowledgeProcessor struct {
	retrieval *KnowledgeRetrievalService
}

func (p knowledgeProcessor) process(in *promptBuildInput) ([]ContextSegment, error) {
	if len(in.knowledgeResources) == 0 || p.retrieval == nil {
		return nil, nil
	}

	result, err := p.retrieval.Retrieve(in.ctx, in.knowledgeResources, in.userInput)
	if err != nil {
		logger.Warnf(in.ctx, "prompt assembly: knowledge retrieval failed for agent %s: %v", in.agentID, err)
		return []ContextSegment{{
			Type:           model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_KNOWLEDGE,
			Decision:       model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_REJECTED,
			DecisionReason: "retrieval_failed",
		}}, nil
	}

	if result.PromptBlock == "" {
		return nil, nil
	}

	refs := make([]string, 0, len(result.Chunks))
	for _, c := range result.Chunks {
		refs = append(refs, fmt.Sprintf("knowledge:%s", c.ResourceID))
	}

	return []ContextSegment{{
		Type:            model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_KNOWLEDGE,
		Content:         result.PromptBlock,
		SourceRefs:      refs,
		ContentHash:     sha256Hex(result.PromptBlock),
		EstimatedTokens: estimateTokens(result.PromptBlock),
		Decision:        model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_INCLUDED,
		KnowledgeChunks: result.Chunks,
	}}, nil
}

// timestampProcessor emits L7 Timestamp.
type timestampProcessor struct{}

func (timestampProcessor) process(_ *promptBuildInput) ([]ContextSegment, error) {
	content := fmt.Sprintf("Current time: %s", time.Now().UTC().Format(time.RFC3339))
	return []ContextSegment{{
		Type:            model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_CURRENT_INPUT,
		Content:         content,
		ContentHash:     sha256Hex(content),
		EstimatedTokens: estimateTokens(content),
		Decision:        model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_INCLUDED,
	}}, nil
}

type PromptAssemblyService struct {
	processors         []segmentProcessor
	memoryService      *MemoryService
	skillService       *SkillService
	knowledgeRetrieval *KnowledgeRetrievalService
}

func NewPromptAssemblyService(memSvc *MemoryService, skillSvc *SkillService) *PromptAssemblyService {
	var embeddingProvider MemoryEmbeddingProvider
	if memSvc != nil {
		embeddingProvider = memSvc.MemoryEmbeddingProvider()
	}
	knowledgeRetrieval := NewKnowledgeRetrievalService(embeddingProvider)

	return &PromptAssemblyService{
		memoryService:      memSvc,
		skillService:       skillSvc,
		knowledgeRetrieval: knowledgeRetrieval,
		processors: []segmentProcessor{
			identityProcessor{},
			guidanceProcessor{},
			memoryProcessor{memoryService: memSvc},
			skillsProcessor{skillService: skillSvc},
			configPromptProcessor{},
			knowledgeProcessor{retrieval: knowledgeRetrieval},
			timestampProcessor{},
		},
	}
}

// Assemble runs the segment pipeline and joins included segments into the
// final system prompt. Each segment carries provenance for the ContextLedger.
func (s *PromptAssemblyService) Assemble(
	ctx context.Context,
	agentID string,
	identity string,
	agentConfigPrompt string,
	availableTools []string,
	userInput string,
	knowledgeResources []domain.KnowledgeResource,
	memoryDisabled bool,
) (*PromptAssemblyResult, error) {

	input := &promptBuildInput{
		ctx:               ctx,
		agentID:           agentID,
		identity:          identity,
		agentConfigPrompt: agentConfigPrompt,
		availableTools:    availableTools,
		userInput:         userInput,
		knowledgeResources: knowledgeResources,
		memoryDisabled:    memoryDisabled,
	}

	var segments []ContextSegment
	var layers []string
	var memoryHash, skillHash string
	var skillCount int
	var knowledgeChunks []domain.KnowledgeChunkReference

	for _, proc := range s.processors {
		procs, err := proc.process(input)
		if err != nil {
			return nil, err
		}
		for _, seg := range procs {
			segments = append(segments, seg)
			if seg.Decision == model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_INCLUDED && seg.Content != "" {
				layers = append(layers, seg.Content)
			}
			switch seg.Type {
			case model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_MEMORY:
				memoryHash = seg.ContentHash
			case model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_SKILL_INDEX:
				skillHash = seg.ContentHash
				skillCount = countSkillsFromRef(seg.SourceRefs)
			case model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_KNOWLEDGE:
				if len(seg.KnowledgeChunks) > 0 {
					knowledgeChunks = seg.KnowledgeChunks
				}
			}
		}
	}

	systemPrompt := strings.Join(layers, "\n\n")

	logger.Infof(ctx, "prompt assembly: assembled %d segments (%d included) for agent %s, skill_count=%d",
		len(segments), len(layers), agentID, skillCount)

	return &PromptAssemblyResult{
		SystemPrompt:       systemPrompt,
		Segments:           segments,
		MemorySnapshotHash: memoryHash,
		SkillIndexHash:     skillHash,
		SkillCount:         skillCount,
		InjectedTokens:     len(systemPrompt) / 4,
		KnowledgeChunks:    knowledgeChunks,
	}, nil
}

func countSkillsFromRef(refs []string) int {
	for _, ref := range refs {
		var count int
		if _, err := fmt.Sscanf(ref, "skills:agent=%*[^:]:count=%d", &count); err == nil {
			return count
		}
	}
	return 0
}

func formatMemorySnapshot(snap *domain.MemorySnapshot) string {
	memUsed := len(snap.MemoryContent)
	memLimit := domain.MemoryCharLimitMemory
	memPercent := 0
	if memLimit > 0 {
		memPercent = memUsed * 100 / memLimit
	}
	memContent := snap.MemoryContent
	if memContent == "" {
		memContent = "(empty)"
	}

	userUsed := len(snap.UserContent)
	userLimit := domain.MemoryCharLimitUser
	userPercent := 0
	if userLimit > 0 {
		userPercent = userUsed * 100 / userLimit
	}
	userContent := snap.UserContent
	if userContent == "" {
		userContent = "(empty)"
	}
	personaContent := snap.PersonaContent
	if personaContent == "" {
		personaContent = "(empty)"
	}

	return fmt.Sprintf(`<memory_snapshot>
PERSONA
===
%s

MEMORY (your personal notes) [%d%% — %d/%d chars]
===
%s

USER PROFILE (who the user is) [%d%% — %d/%d chars]
===
%s
</memory_snapshot>`,
		personaContent,
		memPercent, memUsed, memLimit, memContent,
		userPercent, userUsed, userLimit, userContent,
	)
}

func sha256Hex(data string) string {
	h := sha256.Sum256([]byte(data))
	return hex.EncodeToString(h[:])
}

func hasToolAvailable(tools []string, name string) bool {
	for _, t := range tools {
		if t == name {
			return true
		}
	}
	return false
}

func hasAnyToolAvailable(tools []string, names ...string) bool {
	for _, name := range names {
		if hasToolAvailable(tools, name) {
			return true
		}
	}
	return false
}

// estimateTokens provides a rough token estimate (chars/4).
func estimateTokens(content string) int {
	return len(content) / 4
}

// truncate shortens a string to maxLen with an ellipsis marker.
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
