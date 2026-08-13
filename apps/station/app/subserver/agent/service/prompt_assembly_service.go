// prompt_assembly_service.go — System Prompt layered assembly service.
// Created: 2026-04-11 — initial implementation of the 6-layer prompt assembly pipeline.
// 2026-04-11 — Phase 6: added InjectedTokens and CacheBreakpoints to
//
//	PromptAssemblyResult per architecture spec §3.2.
//
// 2026-04-11 — Phase 7: added L6 Context Files (.hermes.md / AGENTS.md / etc.)
//
//	and L8 Platform Hints. Renumbered old L6 Timestamp to L7. Assembly now
//	composes eight ordered layers per architecture spec §3.2.
//
// 2026-06-17 — Agent rebuild P0-1: added local_mcp guidance so Station can
//
//	request Desktop-local MCP execution through the local tool bridge.
//
// 2026-06-17 — Agent rebuild P1-5: added Desktop-local builtin tool guidance
//
//	for schema-first file, clipboard, and safe workspace operations.
package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
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

// contextFileNames lists the files to scan for external knowledge injection,
// in priority order (first match wins). Per architecture spec §3.2 Layer 6.
var contextFileNames = []string{
	".hermes.md", "HERMES.md",
	"AGENTS.md", "agents.md",
	"CLAUDE.md", "claude.md",
	".cursorrules",
}

// contextFileMaxChars is the maximum characters to inject from a context file.
// Per hermes: 20,000 chars, 70% head + 20% tail truncation.
const contextFileMaxChars = 20000

// platformHints provides platform-specific behavioral hints injected as L8.
var platformHints = map[string]string{
	"cli":      "You are running in a CLI terminal. Use plain text formatting. No markdown images.",
	"desktop":  "You are running in a desktop application. Markdown is supported. Use concise formatting.",
	"mobile":   "You are running on a mobile device. Keep responses short and scannable. Avoid wide code blocks.",
	"whatsapp": "You are running on WhatsApp. Keep messages under 4096 chars. No markdown support.",
	"telegram": "You are running on Telegram. Basic markdown supported. Keep messages concise.",
}

type PromptAssemblyResult struct {
	SystemPrompt       string
	MemorySnapshotHash string
	SkillIndexHash     string
	SkillCount         int
	InjectedTokens     int
	KnowledgeChunks    []domain.KnowledgeChunkReference
}

type PromptAssemblyService struct {
	memoryService      *MemoryService
	skillService       *SkillService
	knowledgeRetrieval *KnowledgeRetrievalService
}

func NewPromptAssemblyService(memSvc *MemoryService, skillSvc *SkillService) *PromptAssemblyService {
	var embeddingProvider MemoryEmbeddingProvider
	if memSvc != nil {
		embeddingProvider = memSvc.MemoryEmbeddingProvider()
	}
	return &PromptAssemblyService{
		memoryService:      memSvc,
		skillService:       skillSvc,
		knowledgeRetrieval: NewKnowledgeRetrievalService(embeddingProvider),
	}
}

// Assemble builds the final system prompt by composing ordered layers:
//
//		L1 Identity → L2 Behavioral Guidance → L3 Memory Snapshot →
//	     L4 Skills Index → L5 Agent Config Prompt → L6 Agent Knowledge →
//	     L7 Context Files → L8 Timestamp → L9 Platform Hints
func (s *PromptAssemblyService) Assemble(
	ctx context.Context,
	agentID string,
	identity string,
	agentConfigPrompt string,
	platform string,
	availableTools []string,
	workspaceRoot string,
	userInput string,
	knowledgeResources []domain.KnowledgeResource,
) (*PromptAssemblyResult, error) {

	var layers []string

	// L1 — Identity
	layers = append(layers, identity)

	// L2 — Behavioral Guidance (conditional)
	if guidance := s.buildGuidanceLayer(availableTools); guidance != "" {
		layers = append(layers, guidance)
	}

	// L3 — Memory Snapshot
	snapshot, err := s.memoryService.BuildRelevantSnapshot(ctx, agentID, userInput)
	if err != nil {
		logger.Errorf(ctx, "prompt assembly: failed to build memory snapshot for agent %s: %v", agentID, err)
		return nil, fmt.Errorf("build memory snapshot: %w", err)
	}
	memoryBlock := formatMemorySnapshot(snapshot)
	layers = append(layers, memoryBlock)

	// L4 — Skills Index
	skillIndex, skillCount, err := s.skillService.BuildSkillIndex(ctx, agentID, platform, availableTools)
	if err != nil {
		logger.Errorf(ctx, "prompt assembly: failed to build skill index for agent %s: %v", agentID, err)
		return nil, fmt.Errorf("build skill index: %w", err)
	}
	if skillIndex != "" {
		layers = append(layers, skillIndex)
	}

	// L5 — Agent Config System Prompt
	if agentConfigPrompt != "" {
		layers = append(layers, agentConfigPrompt)
	}

	// L6 — Agent Knowledge Resources
	var knowledgeChunks []domain.KnowledgeChunkReference
	if len(knowledgeResources) > 0 && s.knowledgeRetrieval != nil {
		retrievalResult, retrievalErr := s.knowledgeRetrieval.Retrieve(ctx, knowledgeResources, userInput)
		if retrievalErr != nil {
			logger.Warnf(ctx, "prompt assembly: knowledge retrieval failed for agent %s: %v", agentID, retrievalErr)
		} else if retrievalResult.PromptBlock != "" {
			layers = append(layers, retrievalResult.PromptBlock)
			knowledgeChunks = retrievalResult.Chunks
		}
	}

	// L7 — Context Files (.hermes.md / AGENTS.md / CLAUDE.md / .cursorrules)
	if workspaceRoot != "" {
		if ctxFileBlock := s.loadContextFile(ctx, workspaceRoot); ctxFileBlock != "" {
			layers = append(layers, ctxFileBlock)
		}
	}

	// L8 — Timestamp + Model Info
	layers = append(layers, fmt.Sprintf("Current time: %s", time.Now().UTC().Format(time.RFC3339)))

	// L9 — Platform Hints
	if hint, ok := platformHints[platform]; ok {
		layers = append(layers, hint)
	}

	systemPrompt := strings.Join(layers, "\n\n")

	logger.Infof(ctx, "prompt assembly: assembled %d layers for agent %s, skill_count=%d",
		len(layers), agentID, skillCount)

	return &PromptAssemblyResult{
		SystemPrompt:       systemPrompt,
		MemorySnapshotHash: sha256Hex(memoryBlock),
		SkillIndexHash:     sha256Hex(skillIndex),
		SkillCount:         skillCount,
		InjectedTokens:     len(systemPrompt) / 4,
		KnowledgeChunks:    knowledgeChunks,
	}, nil
}

// buildGuidanceLayer composes the L2 behavioral guidance based on available tools.
func (s *PromptAssemblyService) buildGuidanceLayer(availableTools []string) string {
	var parts []string

	if hasToolAvailable(availableTools, "memory") {
		parts = append(parts, memoryGuidance)
	}

	if hasToolAvailable(availableTools, "skill_view") || hasToolAvailable(availableTools, "skill_manage") {
		parts = append(parts, skillsGuidance)
	}

	if hasToolAvailable(availableTools, "local_mcp") {
		parts = append(parts, localMCPGuidance)
	}

	if hasAnyToolAvailable(availableTools,
		"local_file_read",
		"local_workspace_list",
		"local_clipboard_read",
		"local_clipboard_write",
		"local_shell_safe",
	) {
		parts = append(parts, localBuiltinGuidance)
	}

	return strings.Join(parts, "\n\n")
}

// formatMemorySnapshot renders the memory snapshot into the prompt-ready tagged block.
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

// loadContextFile walks from workspaceRoot upward through parent directories
// (stopping at the git root or filesystem root) and scans each directory for
// context files in priority order. Returns the first match's content wrapped
// in <context_file> tags, truncated to contextFileMaxChars using 70% head +
// 20% tail strategy. Performs security scanning before injection.
func (s *PromptAssemblyService) loadContextFile(ctx context.Context, workspaceRoot string) string {
	dirs := s.collectSearchDirs(workspaceRoot)

	for _, dir := range dirs {
		for _, name := range contextFileNames {
			filePath := filepath.Join(dir, name)
			data, err := os.ReadFile(filePath)
			if err != nil {
				continue
			}

			content := string(data)
			if content == "" {
				continue
			}

			if hasDangerousContent(content) {
				logger.Warnf(ctx, "context file %s rejected: contains dangerous content", filePath)
				continue
			}

			if len(content) > contextFileMaxChars {
				headSize := contextFileMaxChars * 70 / 100
				tailSize := contextFileMaxChars * 20 / 100
				content = content[:headSize] + "\n\n[... truncated ...]\n\n" + content[len(content)-tailSize:]
			}

			logger.Infof(ctx, "context file loaded: %s (%d chars)", filePath, len(content))
			return fmt.Sprintf("<context_file source=%q>\n%s\n</context_file>", name, content)
		}
	}

	return ""
}

// collectSearchDirs returns workspaceRoot and its ancestors up to the git root
// (inclusive). If no .git is found, only workspaceRoot is returned.
func (s *PromptAssemblyService) collectSearchDirs(workspaceRoot string) []string {
	dirs := []string{workspaceRoot}

	dir := workspaceRoot
	for {
		if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
			if dir != workspaceRoot {
				dirs = append(dirs, dir)
			}
			break
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		if parent != workspaceRoot {
			dirs = append(dirs, parent)
		}
		dir = parent
	}

	return dirs
}

// hasDangerousContent performs a lightweight scan for prompt injection patterns
// and invisible unicode characters in context file content.
func hasDangerousContent(content string) bool {
	lower := strings.ToLower(content)
	dangerousPatterns := []string{
		"ignore previous instructions",
		"ignore all previous",
		"you are now",
		"new persona",
		"system prompt:",
		"<|im_start|>",
		"[inst]",
	}
	for _, p := range dangerousPatterns {
		if strings.Contains(lower, p) {
			return true
		}
	}

	// Check invisible unicode (zero-width characters).
	invisibleChars := []rune{
		'\u200B', '\u200C', '\u200D', '\u200E', '\u200F',
		'\u202A', '\u202B', '\u202C', '\u202D', '\u202E',
		'\u2060', '\u2061', '\u2062', '\u2063', '\u2064',
		'\uFEFF', '\u00AD',
	}
	for _, c := range content {
		for _, inv := range invisibleChars {
			if c == inv {
				return true
			}
		}
	}

	return false
}
